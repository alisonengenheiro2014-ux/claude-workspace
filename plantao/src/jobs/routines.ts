// Rotinas automáticas: varredura do SGP (abre massivo), normalização (encerra e avisa) e manutenção.
import type { ChannelGateway } from "../channels/types.js";
import { resolveIncident } from "../incidents.js";
import type { SgpClient } from "../sgp/types.js";
import type { Store } from "../store/types.js";
import { DETECTOR_PADRAO, detectOutages, mergeSnapshots, onlineRatio, type DetectorConfig } from "./detector.js";

export interface RoutineDeps {
  store: Store;
  sgp: SgpClient;
  gateway: ChannelGateway;
  detector?: DetectorConfig;
  log?: (msg: string, extra?: unknown) => void;
}

export const MENSAGEM_AUTOMATICA =
  "Identificamos uma instabilidade na rede que atende a sua região e a equipe técnica já foi acionada.";

const MIN_DURACAO_MS = 5 * 60_000; // não encerra um massivo com menos de 5 minutos (evita pisca-pisca)
const DAY = 24 * 3_600_000;

// Lê o SGP, guarda o estado e abre massivo "suspeito" nas áreas que acabaram de cair.
export async function varreduraSgp(deps: RoutineDeps, now: Date): Promise<string[]> {
  const cfg = deps.detector ?? DETECTOR_PADRAO;
  const snaps = mergeSnapshots(await deps.store.loadSnapshots(), await deps.sgp.listConnections(), now);
  await deps.store.saveSnapshots(snaps, now);

  const abertos: string[] = [];
  for (const area of detectOutages(snaps, now, cfg)) {
    const sample = snaps.find((s) => s.area[area.type] === area.id)!;
    if (await deps.store.openIncidentForArea(sample.area)) continue; // já existe massivo cobrindo essa área
    try {
      await deps.store.createIncident({
        areaType: area.type, areaId: area.id, status: "suspeito", message: MENSAGEM_AUTOMATICA, eta: null, detectedBy: "varredura",
      });
      abertos.push(`${area.type}:${area.id}`);
      deps.log?.("massivo detectado", area);
    } catch (err) {
      deps.log?.("massivo já aberto na área", { area, err: (err as Error).message });
    }
  }
  return abertos;
}

// Encerra massivos cuja área voltou, avisa quem chamou e cria chamado para quem continua offline.
export async function normalizacao(deps: RoutineDeps, now: Date): Promise<string[]> {
  const cfg = deps.detector ?? DETECTOR_PADRAO;
  const snaps = await deps.store.loadSnapshots();
  const byCustomer = new Map(snaps.map((s) => [s.customerId, s]));
  const encerrados: string[] = [];

  for (const inc of await deps.store.listOpenIncidents()) {
    if (inc.areaType === "manual") continue;
    if (now.getTime() - inc.startedAt.getTime() < MIN_DURACAO_MS) continue;
    const ratio = onlineRatio(snaps, { type: inc.areaType, id: inc.areaId });
    if (ratio === null || ratio < cfg.recoveredRatio) continue;

    // antes de avisar, separa quem ainda está sem conexão
    const contatos = await deps.store.incidentContactsInWindow(inc.id, new Date(now.getTime() - DAY));
    await resolveIncident({ store: deps.store, gateway: deps.gateway, now: () => now }, inc.id);
    for (const c of contatos) {
      const snap = c.sgpCustomerId ? byCustomer.get(c.sgpCustomerId) : undefined;
      if (!snap || snap.online) continue;
      const conv = await deps.store.openConversation(c.id, "meta", "");
      await deps.store.createPending({
        conversationId: conv.id,
        kind: "chamado_tecnico",
        priority: 2,
        summary: "Continua offline depois que o massivo da região normalizou.",
        data: { detalhes: `Massivo ${inc.areaType.toUpperCase()} ${inc.areaId} encerrado; cliente segue offline no SGP.`, cliente: c.sgpCustomerId, telefone: c.phone },
        sgpTicketId: null,
      });
    }
    encerrados.push(inc.id);
    deps.log?.("massivo normalizado", { id: inc.id, area: `${inc.areaType}:${inc.areaId}` });
  }
  return encerrados;
}

// Fecha conversas paradas (a próxima mensagem abre um atendimento novo) e apaga histórico antigo (LGPD).
export async function manutencao(store: Store, now: Date, opts: { inativaHoras: number; retencaoDias: number }) {
  const fechadas = await store.closeIdleConversations(new Date(now.getTime() - opts.inativaHoras * 3_600_000));
  const apagadas = await store.deleteMessagesBefore(new Date(now.getTime() - opts.retencaoDias * DAY));
  return { fechadas, apagadas };
}

// Agendador simples: cada tarefa roda no seu intervalo e nunca se sobrepõe a si mesma.
export function startScheduler(
  tasks: { name: string; everyMs: number; run: () => Promise<unknown> }[],
  log: (msg: string, extra?: unknown) => void = () => {},
) {
  const timers = tasks.map((t) => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await t.run();
      } catch (err) {
        log(`rotina ${t.name} falhou`, (err as Error).message);
      } finally {
        running = false;
      }
    };
    return setInterval(tick, t.everyMs);
  });
  return () => timers.forEach(clearInterval);
}
