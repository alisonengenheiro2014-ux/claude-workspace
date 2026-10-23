import type Anthropic from "@anthropic-ai/sdk";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CreateMessage } from "../src/agent/agent.js";
import { MaxChatGateway, parseMaxChatWebhook, verifyMaxChatSignature } from "../src/channels/maxchat.js";
import type { ChannelGateway, TransferInfo } from "../src/channels/types.js";
import { loadConfig } from "../src/config.js";
import { Router } from "../src/router.js";
import { buildServer } from "../src/server.js";
import { MockSgp } from "../src/sgp/mock.js";
import { MemoryStore } from "../src/store/memory.js";

const evento = (over: any = {}) => ({
  event: "message.received",
  event_id: "ev-1",
  ticket_id: "T-10",
  channel_id: "whatsapp-suporte",
  contact: { phone: "+55 11 90000-0003", name: "Carla" },
  message: { id: "msg-1", type: "text", text: "to sem internet" },
  ticket: { status: "open", assigned_user_id: null, bot_enabled: true },
  timestamp: "2026-10-23T02:10:00Z",
  ...over,
});

describe("webhook do MaxChat", () => {
  it("mensagem de texto vira mensagem normalizada", () => {
    const ev = parseMaxChatWebhook(evento());
    expect(ev).toMatchObject({ kind: "message", message: { channel: "maxchat", from: "5511900000003", text: "to sem internet", channelMessageId: "msg-1", profileName: "Carla" } });
  });

  it("áudio de voz (ptt) e foto viram mídia com o link do R2", () => {
    const audio = parseMaxChatWebhook(evento({ message: { id: "m2", type: "ptt", media_url: "https://r2.test/a.ogg", mime_type: "audio/ogg" } }));
    expect(audio).toMatchObject({ kind: "message", message: { media: { kind: "audio", mediaId: "https://r2.test/a.ogg" } } });
    const foto = parseMaxChatWebhook(evento({ message: { id: "m3", type: "image", media_url: "https://r2.test/f.jpg", caption: "olha a luz" } }));
    expect(foto).toMatchObject({ kind: "message", message: { text: "olha a luz", media: { kind: "image" } } });
  });

  it("atendimento com atendente ou robô desligado: a IA não responde", () => {
    expect(parseMaxChatWebhook(evento({ ticket: { bot_enabled: false } }))).toEqual({ kind: "humano", phone: "5511900000003" });
    expect(parseMaxChatWebhook(evento({ ticket: { assigned_user_id: "u7", bot_enabled: true } }))).toEqual({ kind: "humano", phone: "5511900000003" });
    expect(parseMaxChatWebhook(evento({ event: "ticket.assigned" }))).toEqual({ kind: "humano", phone: "5511900000003" });
    expect(parseMaxChatWebhook(evento({ event: "ticket.closed" }))).toEqual({ kind: "encerrado", phone: "5511900000003" });
    expect(parseMaxChatWebhook({ event: "message.received" })).toEqual({ kind: "ignorar" });
  });

  it("assinatura HMAC", () => {
    const raw = Buffer.from(JSON.stringify(evento()));
    const sig = "sha256=" + createHmac("sha256", "segredo").update(raw).digest("hex");
    expect(verifyMaxChatSignature(raw, sig, "segredo")).toBe(true);
    expect(verifyMaxChatSignature(raw, sig, "outro")).toBe(false);
  });
});

describe("envio pelo MaxChat", () => {
  it("responde e transfere com o token do robô", async () => {
    const calls: { url: string; body: any; auth: string | null }[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get("authorization") });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const gw = new MaxChatGateway("https://maxchat.test/", "tok-robo", fetchFn);
    await gw.sendText("5511900000003", "oi");
    await gw.transfer("5511900000003", { department: "suporte", reason: "LOS", priority: "alta" });
    expect(calls).toEqual([
      { url: "https://maxchat.test/api/v1/bot/messages", body: { phone: "5511900000003", text: "oi" }, auth: "Bearer tok-robo" },
      { url: "https://maxchat.test/api/v1/bot/transfer", body: { phone: "5511900000003", department: "suporte", reason: "LOS", priority: "alta" }, auth: "Bearer tok-robo" },
    ]);
  });
});

function scripted(steps: { text?: string; tools?: { name: string; input: unknown }[] }[]): CreateMessage {
  return async () => {
    const s = steps.shift() ?? { text: "ok" };
    const content: any[] = [];
    if (s.text) content.push({ type: "text", text: s.text, citations: null });
    for (const [i, t] of (s.tools ?? []).entries()) content.push({ type: "tool_use", id: `t${steps.length}${i}`, name: t.name, input: t.input });
    return { id: "m", type: "message", role: "assistant", model: "f", content, stop_sequence: null,
      stop_reason: s.tools?.length ? "tool_use" : "end_turn", usage: { input_tokens: 0, output_tokens: 0 } } as unknown as Anthropic.Message;
  };
}

describe("roteador com fila humana", () => {
  const montar = (create: CreateMessage) => {
    const store = new MemoryStore();
    const transfers: { to: string; info: TransferInfo }[] = [];
    const sent: string[] = [];
    const gateway: ChannelGateway = {
      sendText: async (_to, t) => void sent.push(t),
      downloadMedia: async () => { throw new Error(); },
      transfer: async (to, info) => void transfers.push({ to, info }),
    };
    const router = new Router({
      store, sgp: new MockSgp(), gateway,
      agent: { create, model: "f", empresa: "Maxgiga" },
      vision: { create: async () => { throw new Error(); }, model: "f" }, transcribe: null, extractFrames: async () => [],
      hours: () => ({ windows: [], holidays: [], timeZone: "America/Sao_Paulo" }), knowledge: () => [],
      filas: { chamado_tecnico: "suporte", conferir_pagamento: "financeiro" },
    });
    return { store, transfers, sent, router };
  };

  it("pendência registrada pela IA vai para a fila certa, com o resumo e a prioridade", async () => {
    const { transfers, router } = montar(scripted([
      { tools: [{ name: "registrar_pendencia", input: { tipo: "conferir_pagamento", prioridade: 2, resumo: "Pagou por PIX", detalhes: "R$ 99,90 às 22h" } }] },
      { text: "Registrei seu comprovante." },
    ]));
    await router.handle({ channel: "maxchat", channelNumber: "c", channelMessageId: "x1", from: "5511900000002", text: "já paguei", receivedAt: new Date() });
    expect(transfers).toEqual([{ to: "5511900000002", info: { department: "financeiro", reason: "Pagou por PIX | R$ 99,90 às 22h", priority: "normal" } }]);
  });

  it("sem pendência, não transfere", async () => {
    const { transfers, router } = montar(scripted([{ text: "Oi!" }]));
    await router.handle({ channel: "maxchat", channelNumber: "c", channelMessageId: "x2", from: "5511900000001", text: "oi", receivedAt: new Date() });
    expect(transfers).toEqual([]);
  });

  it("depois que um atendente assume, a IA fica quieta", async () => {
    const { router, sent } = montar(scripted([{ text: "não deveria responder" }]));
    await router.humanoAssumiu("5511900000001");
    const out = await router.handle({ channel: "maxchat", channelNumber: "c", channelMessageId: "x3", from: "5511900000001", text: "oi", receivedAt: new Date() });
    expect(out).toBe("humano_assumiu");
    expect(sent).toEqual([]);
  });
});

describe("rota /webhooks/maxchat", () => {
  it("aceita evento assinado, recusa sem assinatura", async () => {
    const cfg = loadConfig({ MAXCHAT_WEBHOOK_SECRET: "segredo" });
    const recebidas: string[] = [];
    const router = { handle: async (m: any) => void recebidas.push(m.text), humanoAssumiu: async () => {}, atendimentoEncerrado: async () => {} } as unknown as Router;
    const app = buildServer(cfg, router);
    const body = JSON.stringify(evento());
    const sig = "sha256=" + createHmac("sha256", "segredo").update(body).digest("hex");
    const ok = await app.inject({ method: "POST", url: "/webhooks/maxchat", payload: body, headers: { "content-type": "application/json", "x-maxchat-signature": sig } });
    expect(ok.statusCode).toBe(200);
    expect(recebidas).toEqual(["to sem internet"]);
    const bad = await app.inject({ method: "POST", url: "/webhooks/maxchat", payload: body, headers: { "content-type": "application/json" } });
    expect(bad.statusCode).toBe(401);
  });
});
