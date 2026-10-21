import type Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it } from "vitest";
import type { CreateMessage } from "../src/agent/agent.js";
import { BASE_INICIAL } from "../src/agent/knowledge.js";
import type { ChannelGateway, IncomingMessage } from "../src/channels/types.js";
import { HORARIO_PADRAO } from "../src/hours.js";
import { Router, type RouterDeps } from "../src/router.js";
import { MockSgp } from "../src/sgp/mock.js";
import { MemoryStore } from "../src/store/memory.js";

// respostas roteirizadas do modelo: cada chamada consome a próxima
type Step = { text?: string; tools?: { name: string; input: unknown }[] };
function scripted(steps: Step[]) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const create: CreateMessage = async (params) => {
    calls.push(structuredClone(params));
    const step = steps.shift() ?? { text: "ok" };
    const content: any[] = [];
    if (step.text) content.push({ type: "text", text: step.text, citations: null });
    for (const [i, t] of (step.tools ?? []).entries()) content.push({ type: "tool_use", id: `tu_${calls.length}_${i}`, name: t.name, input: t.input });
    return {
      id: "msg", type: "message", role: "assistant", model: "fake", content,
      stop_reason: step.tools?.length ? "tool_use" : "end_turn", stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    } as unknown as Anthropic.Message;
  };
  return { create, calls };
}

const sp = (iso: string) => new Date(`${iso}-03:00`);
const NOITE = sp("2026-10-20T23:30:00");
const TARDE = sp("2026-10-20T15:00:00");

let n = 0;
const msg = (from: string, text: string, extra: Partial<IncomingMessage> = {}): IncomingMessage => ({
  channel: "meta", channelNumber: "551130000000", channelMessageId: `id-${++n}`, from, text, receivedAt: new Date(), ...extra,
});

describe("roteador", () => {
  let store: MemoryStore;
  let sgp: MockSgp;
  let sent: { to: string; text: string }[];
  let gateway: ChannelGateway;

  const build = (create: CreateMessage, now: Date, over: Partial<RouterDeps> = {}) =>
    new Router({
      store, sgp, gateway,
      agent: { create, model: "fake", empresa: "Maxgiga" },
      vision: { create: async () => { throw new Error("visão não esperada"); }, model: "fake" },
      transcribe: null,
      extractFrames: async () => [],
      hours: () => ({ windows: HORARIO_PADRAO, holidays: [], timeZone: "America/Sao_Paulo" }),
      knowledge: () => BASE_INICIAL,
      now: () => now,
      ...over,
    });

  beforeEach(() => {
    store = new MemoryStore();
    sgp = new MockSgp();
    sent = [];
    gateway = { sendText: async (to, text) => void sent.push({ to, text }), downloadMedia: async () => ({ data: Buffer.from(""), mimeType: "image/jpeg" }) };
  });

  it("no horário da equipe não responde e não chama a IA", async () => {
    const llm = scripted([]);
    const out = await build(llm.create, TARDE).handle(msg("5511900000003", "oi"));
    expect(out).toBe("equipe_atendendo");
    expect(llm.calls).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("fora do horário: LOS vermelho vira chamado prioritário, sem pedir reinício", async () => {
    const llm = scripted([
      { tools: [{ name: "identificar_cliente", input: { cpf: "" } }] },
      { tools: [{ name: "status_conexao", input: {} }, { name: "verificar_massivo", input: {} }] },
      { tools: [{ name: "registrar_pendencia", input: { tipo: "chamado_tecnico", prioridade: 1, resumo: "LOS vermelho", detalhes: "ONU com LOS vermelho" } }] },
      { text: "Registrei o chamado. A equipe volta amanhã às 08:00." },
    ]);
    const out = await build(llm.create, NOITE).handle(msg("5511900000003", "tô sem net e a luz LOS tá vermelha"));
    expect(out).toBe("agente");
    expect(sent.at(-1)?.text).toContain("Registrei");
    const pend = await store.listPending();
    expect(pend).toMatchObject([{ kind: "chamado_tecnico", priority: 1, sgpTicketId: "CH-1001" }]);
    expect(store.contacts[0]).toMatchObject({ sgpCustomerId: "1003", kind: "cliente" });
    // resultados das duas ferramentas paralelas voltam numa única mensagem
    const third = llm.calls[2].messages;
    const lastUser = third.at(-1)!;
    expect(Array.isArray(lastUser.content) && lastUser.content.filter((b: any) => b.type === "tool_result")).toHaveLength(2);
    // contexto do momento vai fora do bloco em cache
    const system = llm.calls[0].system as Anthropic.TextBlockParam[];
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(system[1].text).toContain("amanhã às 08:00");
  });

  it("ferramenta de conta sem identificar o cliente devolve erro ao modelo, sem vazar dados", async () => {
    const llm = scripted([{ tools: [{ name: "faturas_em_aberto", input: {} }] }, { text: "Me passa seu CPF?" }]);
    await build(llm.create, NOITE).handle(msg("5511999999999", "quero meu boleto"));
    const result = (llm.calls[1].messages.at(-1)!.content as any[])[0];
    expect(result).toMatchObject({ type: "tool_result", is_error: true });
    expect(result.content).toContain("não identificado");
  });

  it("massivo: responde na hora sem IA, mesmo no horário comercial", async () => {
    await store.createIncident({ areaType: "pon", areaId: "PON-2/1", status: "confirmado", message: "Rompimento de fibra na sua região.", eta: null });
    const llm = scripted([]);
    const router = build(llm.create, TARDE);
    const out = await router.handle(msg("5511900000003", "caiu tudo aqui"));
    expect(out).toBe("massivo_sem_ia");
    expect(llm.calls).toHaveLength(0);
    expect(sent[0].text).toContain("Rompimento de fibra");
    expect(store.incidentContacts).toHaveLength(1);
  });

  it("massivo: cliente de outra região segue o fluxo normal", async () => {
    await store.createIncident({ areaType: "pon", areaId: "PON-9/9", status: "confirmado", message: "Rompimento.", eta: null });
    const llm = scripted([{ text: "Oi! Como posso ajudar?" }]);
    const out = await build(llm.create, NOITE).handle(msg("5511900000003", "oi"));
    expect(out).toBe("agente");
  });

  it("webhook repetido não gera segunda resposta", async () => {
    const llm = scripted([{ text: "Oi!" }, { text: "Oi de novo!" }]);
    const router = build(llm.create, NOITE);
    const m = msg("5511900000001", "oi");
    await router.handle(m);
    expect(await router.handle({ ...m })).toBe("duplicada");
    expect(sent).toHaveLength(1);
  });

  it("mensagens seguidas do mesmo cliente são atendidas em ordem, uma conversa só", async () => {
    const llm = scripted([{ text: "resposta 1" }, { text: "resposta 2" }]);
    const router = build(llm.create, NOITE);
    await Promise.all([router.handle(msg("5511900000001", "oi")), router.handle(msg("5511900000001", "tá aí?"))]);
    expect(sent.map((s) => s.text)).toEqual(["resposta 1", "resposta 2"]);
    expect(store.conversations).toHaveLength(1);
    // a segunda chamada já enxerga a primeira resposta no histórico
    expect(llm.calls[1].messages.map((m) => m.content)).toEqual(["oi", "resposta 1", "tá aí?"]);
  });

  it("foto da ONU vira leitura estruturada no histórico", async () => {
    const llm = scripted([{ text: "Vi que a luz LOS está vermelha." }]);
    const vision = {
      model: "fake",
      create: async () => ({
        content: [{ type: "text", text: JSON.stringify({ equipamento_identificado: true, led_power: "aceso_verde", led_pon: "apagado", led_los: "aceso_vermelho", confianca: "alta", observacao: "foto nítida" }) }],
        stop_reason: "end_turn",
      }) as any,
    };
    await build(llm.create, NOITE, { vision }).handle(
      msg("5511900000003", "", { text: undefined, media: { kind: "image", mediaId: "m1", mimeType: "image/jpeg" } }),
    );
    const contents = llm.calls[0].messages.map((m) => m.content as string);
    expect(contents.some((c) => c.includes("LOS: aceso_vermelho"))).toBe(true);
  });

  it("áudio é transcrito e entra como fala do cliente", async () => {
    const llm = scripted([{ text: "Entendi, vamos ver sua conexão." }]);
    await build(llm.create, NOITE, { transcribe: async () => "minha internet caiu faz uma hora" }).handle(
      msg("5511900000003", "", { text: undefined, media: { kind: "audio", mediaId: "a1", mimeType: "audio/ogg" } }),
    );
    const contents = llm.calls[0].messages.map((m) => m.content as string);
    expect(contents).toContain("[áudio transcrito] minha internet caiu faz uma hora");
  });

  it("falha do modelo não trava a fila do cliente", async () => {
    let fail = true;
    const llm = scripted([{ text: "voltei" }]);
    const flaky: CreateMessage = async (p) => {
      if (fail) { fail = false; throw new Error("timeout"); }
      return llm.create(p);
    };
    const router = build(flaky, NOITE);
    await expect(router.handle(msg("5511900000001", "oi"))).rejects.toThrow("timeout");
    expect(await router.handle(msg("5511900000001", "oi de novo"))).toBe("agente");
    expect(sent.at(-1)?.text).toBe("voltei");
  });
});

describe("registros", () => {
  it("telefone aparece mascarado", async () => {
    const { mascarar } = await import("../src/router.js");
    expect(mascarar("5511900000003")).toBe("5511*****03");
  });
});
