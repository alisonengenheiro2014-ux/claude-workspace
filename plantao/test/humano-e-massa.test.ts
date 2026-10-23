import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { CreateMessage } from "../src/agent/agent.js";
import { MaxChatGateway } from "../src/channels/maxchat.js";
import { AtendimentoComHumano, type ChannelGateway, type TransferInfo } from "../src/channels/types.js";
import { resolveIncident } from "../src/incidents.js";
import { despedidas } from "../src/jobs/routines.js";
import { Router } from "../src/router.js";
import { MockSgp } from "../src/sgp/mock.js";
import { MemoryStore } from "../src/store/memory.js";

const fala = (text: string): CreateMessage => async () =>
  ({ id: "m", type: "message", role: "assistant", model: "f", content: [{ type: "text", text, citations: null }],
     stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } }) as unknown as Anthropic.Message;

const pendencia = (tipo: string): CreateMessage => {
  let i = 0;
  return async () => (i++ === 0
    ? { content: [{ type: "tool_use", id: "t1", name: "registrar_pendencia", input: { tipo, prioridade: 2, resumo: "Quer cancelar", detalhes: "mudou de cidade" } }], stop_reason: "tool_use" }
    : { content: [{ type: "text", text: "Registrei, a equipe entra em contato.", citations: null }], stop_reason: "end_turn" }) as unknown as Anthropic.Message;
};

function router(store: MemoryStore, gateway: ChannelGateway, create: CreateMessage) {
  return new Router({
    store, sgp: new MockSgp(), gateway,
    agent: { create, model: "f", empresa: "Maxgiga" },
    vision: { create: async () => { throw new Error(); }, model: "f" }, transcribe: null, extractFrames: async () => [],
    hours: () => ({ windows: [], holidays: [], timeZone: "America/Sao_Paulo" }), knowledge: () => [],
    filas: { cancelamento: "cancelamentos" },
  });
}
const msg = (from: string, id: string) => ({ channel: "maxchat" as const, channelNumber: "c", channelMessageId: id, from, text: "oi", receivedAt: new Date() });

describe("atendente assumiu no MaxChat", () => {
  it("MaxChat responde 409: a IA sai do atendimento e não grava a resposta como enviada", async () => {
    const fetchFn = (async () => new Response("{}", { status: 409 })) as unknown as typeof fetch;
    const store = new MemoryStore();
    const r = router(store, new MaxChatGateway("https://maxchat.test", "t", fetchFn), fala("Oi!"));
    expect(await r.handle(msg("5511900000001", "a1"))).toBe("humano_assumiu");
    expect(store.conversations[0].status).toBe("humano");
    expect(store.messages.filter((m) => m.author === "ia")).toEqual([]);
  });

  it("aviso de massivo e despedida não vão para quem está com atendente", async () => {
    const store = new MemoryStore();
    const enviados: string[] = [];
    const gateway: ChannelGateway = { sendText: async (to) => void enviados.push(to), downloadMedia: async () => { throw new Error(); } };
    const inc = await store.createIncident({ areaType: "pon", areaId: "P", status: "confirmado", message: "queda", eta: null });
    for (const phone of ["5511900000001", "5511900000002"]) {
      const c = await store.upsertContact(phone);
      await store.linkIncidentContact(inc.id, c.id);
      await store.openConversation(c.id, "maxchat", "c");
    }
    store.conversations[1].status = "humano";
    const t0 = new Date();
    await resolveIncident({ store, gateway, now: () => t0 }, inc.id);
    expect(enviados).toEqual(["5511900000001"]);
    store.conversations[0].status = "humano"; // atendente assumiu antes do prazo da despedida
    expect(await despedidas({ store, gateway }, new Date(t0.getTime() + 31 * 60_000))).toBe(0);
    expect(enviados).toEqual(["5511900000001"]);
  });

  it("canal recusa no meio do envio em massa: marca humano e segue para os próximos", async () => {
    const store = new MemoryStore();
    const enviados: string[] = [];
    const gateway: ChannelGateway = {
      sendText: async (to) => { if (to.endsWith("1")) throw new AtendimentoComHumano(to); enviados.push(to); },
      downloadMedia: async () => { throw new Error(); },
    };
    const inc = await store.createIncident({ areaType: "pon", areaId: "P", status: "confirmado", message: "queda", eta: null });
    for (const phone of ["5511900000001", "5511900000002"]) {
      await store.linkIncidentContact(inc.id, (await store.upsertContact(phone)).id);
    }
    expect(await resolveIncident({ store, gateway }, inc.id)).toBe(1);
    expect(enviados).toEqual(["5511900000002"]);
    expect(store.conversations.find((c) => c.contactId === store.contacts[0].id)?.status).toBe("humano");
  });

  it("envio em massa espera entre uma mensagem e outra", async () => {
    const store = new MemoryStore();
    const horas: number[] = [];
    const gateway: ChannelGateway = { sendText: async () => void horas.push(Date.now()), downloadMedia: async () => { throw new Error(); } };
    const inc = await store.createIncident({ areaType: "pon", areaId: "P", status: "confirmado", message: "queda", eta: null });
    for (const phone of ["5511900000001", "5511900000002", "5511900000003"]) {
      await store.linkIncidentContact(inc.id, (await store.upsertContact(phone)).id);
    }
    await resolveIncident({ store, gateway, intervaloEnvioMs: 40 }, inc.id);
    expect(horas).toHaveLength(3);
    expect(horas[1] - horas[0]).toBeGreaterThanOrEqual(38);
    expect(horas[2] - horas[1]).toBeGreaterThanOrEqual(38);
  });
});

describe("cancelamento", () => {
  it("pedido de cancelamento vai para a fila de cancelamentos", async () => {
    const store = new MemoryStore();
    const transfers: TransferInfo[] = [];
    const gateway: ChannelGateway = { sendText: async () => {}, downloadMedia: async () => { throw new Error(); }, transfer: async (_t, i) => void transfers.push(i) };
    await router(store, gateway, pendencia("cancelamento")).handle(msg("5511900000001", "c1"));
    expect((await store.listPending())[0].kind).toBe("cancelamento");
    expect(transfers).toEqual([{ department: "cancelamentos", reason: "Quer cancelar | mudou de cidade", priority: "normal" }]);
  });
});
