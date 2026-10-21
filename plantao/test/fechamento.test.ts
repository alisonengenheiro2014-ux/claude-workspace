import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { CreateMessage } from "../src/agent/agent.js";
import { systemPrompt } from "../src/agent/prompt.js";
import { runTool, toolDefs, type ToolContext } from "../src/agent/tools.js";
import type { ChannelGateway } from "../src/channels/types.js";
import { HORARIO_PADRAO } from "../src/hours.js";
import { MENSAGEM_NORMALIZOU, resolveIncident } from "../src/incidents.js";
import { despedidas, MENSAGEM_DESPEDIDA } from "../src/jobs/routines.js";
import { Router } from "../src/router.js";
import { MockSgp } from "../src/sgp/mock.js";
import { MemoryStore } from "../src/store/memory.js";

describe("liberação só após pagamento", () => {
  it("por padrão o desbloqueio nem é oferecido à IA e as regras proíbem liberar", () => {
    expect(toolDefs({ desbloqueio: false }).map((t) => t.name)).not.toContain("desbloqueio_confianca");
    expect(toolDefs({ desbloqueio: true }).map((t) => t.name)).toContain("desbloqueio_confianca");
    expect(systemPrompt("Maxgiga")).toContain("Nunca libere, desbloqueie nem prometa liberação");
    expect(systemPrompt("Maxgiga")).not.toContain("desbloqueio_confianca");
  });

  it("mesmo que a IA tente chamar, o sistema recusa e não mexe no SGP", async () => {
    const store = new MemoryStore();
    const sgp = new MockSgp();
    const contact = await store.upsertContact("5511900000002");
    const ctx: ToolContext = {
      store, sgp, contact, knowledge: [],
      conversation: await store.openConversation(contact.id, "meta", "n"),
      customer: await sgp.findCustomer({ phone: "5511900000002" }),
    };
    await expect(runTool("desbloqueio_confianca", {}, ctx)).rejects.toThrow("só acontece após o pagamento");
    expect((await sgp.connectionStatus("1002")).suspended).toBe(true);
  });
});

// modelo roteirizado que também guarda o que recebeu
function scripted(steps: { text?: string; tools?: { name: string; input: unknown }[] }[]) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const create: CreateMessage = async (p) => {
    calls.push(structuredClone(p));
    const s = steps.shift() ?? { text: "ok" };
    const content: any[] = [];
    if (s.text) content.push({ type: "text", text: s.text, citations: null });
    for (const [i, t] of (s.tools ?? []).entries()) content.push({ type: "tool_use", id: `t${calls.length}${i}`, name: t.name, input: t.input });
    return { id: "m", type: "message", role: "assistant", model: "f", content, stop_sequence: null,
      stop_reason: s.tools?.length ? "tool_use" : "end_turn", usage: { input_tokens: 0, output_tokens: 0 } } as unknown as Anthropic.Message;
  };
  return { create, calls };
}

describe("fim do massivo: confirmação e despedida", () => {
  async function setup() {
    const store = new MemoryStore();
    const sent: { to: string; text: string }[] = [];
    const gateway: ChannelGateway = { sendText: async (to, text) => void sent.push({ to, text }), downloadMedia: async () => { throw new Error(); } };
    const inc = await store.createIncident({ areaType: "pon", areaId: "PON-2/1", status: "confirmado", message: "queda", eta: null });
    const c = await store.upsertContact("5511900000003");
    await store.linkIncidentContact(inc.id, c.id);
    const t0 = new Date();
    await resolveIncident({ store, gateway, now: () => t0, despedidaMinutos: 30 }, inc.id);
    return { store, sent, gateway, c, t0 };
  }

  it("ao normalizar, pergunta se voltou e marca o prazo da despedida", async () => {
    const { store, sent, t0 } = await setup();
    expect(sent[0].text).toBe(MENSAGEM_NORMALIZOU);
    expect(store.conversations[0].closingAt?.getTime()).toBe(t0.getTime() + 30 * 60_000);
  });

  it("cliente confirma (mesmo no horário da equipe): a IA agradece e encerra", async () => {
    const { store, sent, gateway } = await setup();
    const llm = scripted([
      { tools: [{ name: "finalizar_atendimento", input: { resumo: "cliente confirmou que voltou" } }] },
      { text: "Que ótimo! Obrigada pela paciência. Qualquer coisa, é só chamar." },
    ]);
    const router = new Router({
      store, sgp: new MockSgp(), gateway,
      agent: { create: llm.create, model: "f", empresa: "Maxgiga" },
      vision: { create: async () => { throw new Error(); }, model: "f" }, transcribe: null, extractFrames: async () => [],
      hours: () => ({ windows: HORARIO_PADRAO, holidays: [], timeZone: "America/Sao_Paulo" }), knowledge: () => [],
      now: () => new Date("2026-10-20T15:00:00-03:00"), // terça à tarde: equipe trabalhando
    });
    const out = await router.handle({ channel: "meta", channelNumber: "n", channelMessageId: "w1", from: "5511900000003", text: "voltou sim, obrigado!", receivedAt: new Date() });
    expect(out).toBe("agente");
    expect((llm.calls[0].system as Anthropic.TextBlockParam[])[1].text).toContain("foi normalizada e perguntamos se a internet dele voltou");
    expect(sent.at(-1)?.text).toContain("Obrigada pela paciência");
    expect(store.conversations[0]).toMatchObject({ status: "closed", closingAt: null });
    // já encerrado: a rotina não manda despedida
    expect(await despedidas({ store, gateway }, new Date(Date.now() + 3_600_000))).toBe(0);
  });

  it("cliente não responde: depois do prazo a despedida sai uma vez e o atendimento fecha", async () => {
    const { store, sent, gateway, t0 } = await setup();
    expect(await despedidas({ store, gateway }, new Date(t0.getTime() + 29 * 60_000))).toBe(0);
    expect(await despedidas({ store, gateway }, new Date(t0.getTime() + 31 * 60_000))).toBe(1);
    expect(sent.at(-1)).toEqual({ to: "5511900000003", text: MENSAGEM_DESPEDIDA });
    expect(store.conversations[0].status).toBe("closed");
    expect(await despedidas({ store, gateway }, new Date(t0.getTime() + 60 * 60_000))).toBe(0);
  });

  it("finalizar_atendimento fecha a conversa", async () => {
    const store = new MemoryStore();
    const contact = await store.upsertContact("5511900000001");
    const conversation = await store.openConversation(contact.id, "meta", "n");
    await runTool("finalizar_atendimento", { resumo: "ok" }, { store, sgp: new MockSgp(), contact, conversation, knowledge: [], customer: null });
    expect(store.conversations[0].status).toBe("closed");
  });
});
