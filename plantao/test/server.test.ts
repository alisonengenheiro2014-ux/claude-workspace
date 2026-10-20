import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import type { IncomingMessage } from "../src/channels/types.js";
import type { Router } from "../src/router.js";
import { buildServer } from "../src/server.js";

const cfg = loadConfig({ META_APP_SECRET: "segredo", META_VERIFY_TOKEN: "verifica" });

function fakeRouter() {
  const got: IncomingMessage[] = [];
  return { got, router: { handle: async (m: IncomingMessage) => (got.push(m), "agente") } as unknown as Router };
}

const body = JSON.stringify({
  entry: [{ changes: [{ value: { metadata: { display_phone_number: "55" }, messages: [{ id: "w1", from: "5511900000001", timestamp: "1", type: "text", text: { body: "oi" } }] } }] }],
});
const sign = (s: string, secret = "segredo") => "sha256=" + createHmac("sha256", secret).update(s).digest("hex");

describe("servidor HTTP", () => {
  it("health", async () => {
    const app = buildServer(cfg, fakeRouter().router);
    expect((await app.inject({ url: "/health" })).json()).toEqual({ ok: true });
  });

  it("verificação do webhook pela Meta", async () => {
    const app = buildServer(cfg, fakeRouter().router);
    const ok = await app.inject({ url: "/webhooks/meta?hub.mode=subscribe&hub.verify_token=verifica&hub.challenge=123" });
    expect(ok.body).toBe("123");
    const bad = await app.inject({ url: "/webhooks/meta?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=123" });
    expect(bad.statusCode).toBe(403);
  });

  it("aceita mensagem assinada e recusa sem assinatura", async () => {
    const { got, router } = fakeRouter();
    const app = buildServer(cfg, router);
    const ok = await app.inject({ method: "POST", url: "/webhooks/meta", payload: body, headers: { "content-type": "application/json", "x-hub-signature-256": sign(body) } });
    expect(ok.statusCode).toBe(200);
    expect(got.map((m) => m.text)).toEqual(["oi"]);
    const bad = await app.inject({ method: "POST", url: "/webhooks/meta", payload: body, headers: { "content-type": "application/json", "x-hub-signature-256": sign(body, "outro") } });
    expect(bad.statusCode).toBe(401);
    expect(got).toHaveLength(1);
  });
});
