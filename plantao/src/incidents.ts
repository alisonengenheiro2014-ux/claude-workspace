// Ações da equipe sobre um massivo: abrir, atualizar previsão (avisa quem chamou) e encerrar.
import type { ChannelGateway } from "./channels/types.js";
import { AtendimentoComHumano } from "./channels/types.js";
import type { Incident, Store } from "./store/types.js";

const DAY = 24 * 3_600_000;

// pausa com uma pequena variação, para os envios em massa não saírem em rajada
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms + Math.floor(Math.random() * ms * 0.25)));

export interface IncidentDeps {
  store: Store;
  gateway: ChannelGateway;
  now?: () => Date;
  despedidaMinutos?: number; // depois de normalizar, quanto esperar a resposta do cliente antes da despedida
  intervaloEnvioMs?: number; // pausa entre uma mensagem e outra nos avisos em massa
}

export function formatEta(eta: Date, timeZone = "America/Sao_Paulo"): string {
  return eta.toLocaleString("pt-BR", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Avisa todos que falaram com a gente nas últimas 24h (dentro da janela gratuita da Meta).
async function broadcast(deps: IncidentDeps, incidentId: string, text: string, closingAt?: Date): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const contacts = await deps.store.incidentContactsInWindow(incidentId, new Date(now.getTime() - DAY));
  let sent = 0;
  for (const c of contacts) {
    const conv = await deps.store.openConversation(c.id, "meta", "");
    // quem está falando com um atendente não recebe mensagem automática
    if (conv.status === "humano") continue;
    if (sent > 0 && deps.intervaloEnvioMs) await pausa(deps.intervaloEnvioMs);
    try {
      await deps.gateway.sendText(c.phone, text);
      await deps.store.addMessage({ conversationId: conv.id, author: "sistema", body: text });
      if (closingAt) await deps.store.setClosingAt(conv.id, closingAt);
      sent++;
    } catch (err) {
      if (err instanceof AtendimentoComHumano) await deps.store.updateConversation(conv.id, { status: "humano" });
      // um envio que falha não impede os outros
    }
  }
  return sent;
}

export async function openIncident(
  deps: IncidentDeps,
  i: { areaType: Incident["areaType"]; areaId: string; message: string; eta: Date | null },
): Promise<Incident> {
  return deps.store.createIncident({ ...i, status: "confirmado" });
}

export async function updateIncidentEta(deps: IncidentDeps, id: string, eta: Date | null, message?: string) {
  await deps.store.updateIncident(id, { eta, ...(message ? { message } : {}) });
  const text = eta
    ? `Atualização sobre a queda na sua região: a nova previsão de normalização é ${formatEta(eta)}. Seguimos trabalhando no reparo.`
    : "Atualização sobre a queda na sua região: a equipe técnica segue no reparo e avisaremos assim que tivermos previsão.";
  return broadcast(deps, id, text);
}

export const MENSAGEM_NORMALIZOU =
  "Boa notícia: a conexão na sua região foi normalizada! Sua internet já voltou por aí? Me responde aqui pra eu confirmar. Se ainda estiver sem, desligue o aparelho da fibra da tomada por 30 segundos e ligue de novo.";

// Encerra o massivo, pergunta a quem chamou se a internet voltou e abre o prazo para a despedida automática.
export async function resolveIncident(deps: IncidentDeps, id: string) {
  await deps.store.updateIncident(id, { status: "resolvido" });
  const now = deps.now?.() ?? new Date();
  const closingAt = new Date(now.getTime() + (deps.despedidaMinutos ?? 30) * 60_000);
  return broadcast(deps, id, MENSAGEM_NORMALIZOU, closingAt);
}

export async function discardIncident(deps: IncidentDeps, id: string) {
  await deps.store.updateIncident(id, { status: "descartado" });
}
