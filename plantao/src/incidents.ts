// Ações da equipe sobre um massivo: abrir, atualizar previsão (avisa quem chamou) e encerrar.
import type { ChannelGateway } from "./channels/types.js";
import type { Incident, Store } from "./store/types.js";

const DAY = 24 * 3_600_000;

export interface IncidentDeps {
  store: Store;
  gateway: ChannelGateway;
  now?: () => Date;
}

export function formatEta(eta: Date, timeZone = "America/Sao_Paulo"): string {
  return eta.toLocaleString("pt-BR", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Avisa todos que falaram com a gente nas últimas 24h (dentro da janela gratuita da Meta).
async function broadcast(deps: IncidentDeps, incidentId: string, text: string): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const contacts = await deps.store.incidentContactsInWindow(incidentId, new Date(now.getTime() - DAY));
  let sent = 0;
  for (const c of contacts) {
    try {
      await deps.gateway.sendText(c.phone, text);
      const conv = await deps.store.openConversation(c.id, "meta", "");
      await deps.store.addMessage({ conversationId: conv.id, author: "sistema", body: text });
      sent++;
    } catch {
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

export async function resolveIncident(deps: IncidentDeps, id: string) {
  await deps.store.updateIncident(id, { status: "resolvido" });
  return broadcast(
    deps,
    id,
    "Boa notícia: a conexão na sua região foi normalizada. Se a sua internet ainda não voltou, desligue a ONU da tomada por 30 segundos e ligue de novo. Se continuar sem funcionar, é só responder aqui.",
  );
}

export async function discardIncident(deps: IncidentDeps, id: string) {
  await deps.store.updateIncident(id, { status: "descartado" });
}
