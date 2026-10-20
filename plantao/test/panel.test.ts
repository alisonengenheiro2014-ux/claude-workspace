import { beforeEach, describe, expect, it } from "vitest";
import type { ChannelGateway } from "../src/channels/types.js";
import { loadConfig } from "../src/config.js";
import { hashPassword, readSession, signSession } from "../src/panel/auth.js";
import type { Router } from "../src/router.js";
import { buildServer } from "../src/server.js";
import { MemoryStore } from "../src/store/memory.js";

const SECRET = "x".repeat(40);
const cfg = loadConfig({});
const noRouter = { handle: async () => "agente" } as unknown as Router;

describe("sessão", () => {
  it("assinada, expira e não aceita adulteração", () => {
    const now = Date.now();
    const s = signSession("u1", SECRET, now);
    expect(readSession(s, SECRET, now)).toBe("u1");
    expect(readSession(s, "outro-segredo".repeat(3), now)).toBeNull();
    expect(readSession(s.replace("u1", "u2"), SECRET, now)).toBeNull();
    expect(readSession(s, SECRET, now + 13 * 3_600_000)).toBeNull();
  });
});

describe("painel", () => {
  let store: MemoryStore;
  let sent: { to: string; text: string }[];
  let app: ReturnType<typeof buildServer>;
  let adminCookie: string;
  let atendenteCookie: string;

  const form = (data: Record<string, string>) => ({
    payload: new URLSearchParams(data).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  const cookie = (c: string) => ({ cookie: `plantao_sessao=${encodeURIComponent(c)}` });

  beforeEach(async () => {
    store = new MemoryStore();
    sent = [];
    const gateway: ChannelGateway = { sendText: async (to, text) => void sent.push({ to, text }), downloadMedia: async () => { throw new Error(); } };
    app = buildServer(cfg, noRouter, { store, gateway, sessionSecret: SECRET, secureCookie: false });
    const admin = await store.createUser({ name: "Admin", email: "admin@maxgiga.test", passwordHash: await hashPassword("senha-forte-123"), role: "admin" });
    const at = await store.createUser({ name: "Bia", email: "bia@maxgiga.test", passwordHash: await hashPassword("outra-senha-123"), role: "atendente" });
    adminCookie = signSession(admin.id, SECRET);
    atendenteCookie = signSession(at.id, SECRET);
  });

  it("sem login vai para a tela de entrar", async () => {
    const res = await app.inject({ url: "/painel" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/login");
  });

  it("login certo cria cookie seguro; senha errada não", async () => {
    const bad = await app.inject({ method: "POST", url: "/login", ...form({ email: "admin@maxgiga.test", senha: "errada" }) });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: "POST", url: "/login", ...form({ email: "ADMIN@maxgiga.test", senha: "senha-forte-123" }) });
    expect(ok.statusCode).toBe(302);
    const setCookie = String(ok.headers["set-cookie"]);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
  });

  it("fila mostra pendências por prioridade e marca como feito", async () => {
    const c = await store.upsertContact("5511900000003");
    const conv = await store.openConversation(c.id, "meta", "n");
    await store.createPending({ conversationId: conv.id, kind: "outro", priority: 3, summary: "quer trocar de plano", data: {}, sgpTicketId: null });
    const p1 = await store.createPending({ conversationId: conv.id, kind: "chamado_tecnico", priority: 1, summary: "LOS vermelho <script>", data: { telefone: c.phone }, sgpTicketId: "CH-1" });
    const page = await app.inject({ url: "/painel", headers: cookie(atendenteCookie) });
    expect(page.statusCode).toBe(200);
    expect(page.body.indexOf("LOS vermelho")).toBeLessThan(page.body.indexOf("quer trocar de plano"));
    expect(page.body).toContain("LOS vermelho &lt;script&gt;");
    expect(page.body).not.toContain("<script>");
    await app.inject({ method: "POST", url: `/pendencias/${p1.id}/feito`, headers: cookie(atendenteCookie) });
    expect((await store.listPending("aberto")).map((p) => p.summary)).toEqual(["quer trocar de plano"]);
  });

  it("conversa mostra o histórico", async () => {
    const c = await store.upsertContact("5511900000001");
    const conv = await store.openConversation(c.id, "meta", "n");
    await store.addMessage({ conversationId: conv.id, author: "cliente", body: "sem internet" });
    await store.addMessage({ conversationId: conv.id, author: "ia", body: "vamos ver" });
    const page = await app.inject({ url: `/conversas/${conv.id}`, headers: cookie(atendenteCookie) });
    expect(page.body).toContain("sem internet");
    expect(page.body).toContain("vamos ver");
  });

  it("massivo: abrir, atualizar previsão avisa quem chamou nas últimas 24h, normalizar avisa de novo", async () => {
    const h = { ...cookie(atendenteCookie) };
    await app.inject({ method: "POST", url: "/incidentes", ...form({ areaType: "pon", areaId: "PON-2/1", message: "Rompimento na sua região.", eta: "" }), headers: { ...form({}).headers, ...h } });
    const [inc] = await store.listOpenIncidents();
    expect(inc).toMatchObject({ areaType: "pon", areaId: "PON-2/1", status: "confirmado" });

    const a = await store.upsertContact("5511900000003");
    const b = await store.upsertContact("5511900000004");
    await store.linkIncidentContact(inc.id, a.id);
    await store.linkIncidentContact(inc.id, b.id);
    // b falou há mais de 24h: fora da janela gratuita, não recebe
    store.incidentContacts.find((x) => x.contactId === b.id)!.lastContactAt = new Date(Date.now() - 25 * 3_600_000);

    const upd = await app.inject({ method: "POST", url: `/incidentes/${inc.id}/previsao`, ...form({ eta: "2026-10-21T06:30" }), headers: { ...form({}).headers, ...h } });
    expect(decodeURIComponent(upd.headers.location as string)).toContain("1 cliente(s) avisado(s)");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "5511900000003" });
    expect(sent[0].text).toContain("21/10, 06:30");
    expect((await store.getIncident(inc.id))!.eta?.toISOString()).toBe("2026-10-21T09:30:00.000Z");

    await app.inject({ method: "POST", url: `/incidentes/${inc.id}/resolver`, headers: h });
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toContain("normalizada");
    expect(await store.listOpenIncidents()).toEqual([]);
  });

  it("não deixa abrir dois massivos na mesma área (no Postgres o índice único garante)", async () => {
    const h = { ...form({}).headers, ...cookie(atendenteCookie) };
    const data = form({ areaType: "pon", areaId: "PON-1/1", message: "queda" });
    await app.inject({ method: "POST", url: "/incidentes", payload: data.payload, headers: h });
    expect(await store.listOpenIncidents()).toHaveLength(1);
  });

  it("horários: só admin altera e o formulário é validado", async () => {
    const at = await app.inject({ url: "/config/horarios", headers: cookie(atendenteCookie) });
    expect(at.statusCode).toBe(403);

    const headers = { ...form({}).headers, ...cookie(adminCookie) };
    const bad = await app.inject({ method: "POST", url: "/config/horarios", payload: new URLSearchParams({ aberto_1: "on", abre_1: "21:00", fecha_1: "08:00" }).toString(), headers });
    expect(bad.statusCode).toBe(400);

    const ok = await app.inject({
      method: "POST", url: "/config/horarios",
      payload: new URLSearchParams({ aberto_1: "on", abre_1: "08:00", fecha_1: "18:00", aberto_6: "on", abre_6: "08:00", fecha_6: "12:00", feriados: "2026-11-02\n2026-11-15" }).toString(),
      headers,
    });
    expect(ok.statusCode).toBe(302);
    expect(await store.getHours()).toEqual({
      windows: [{ weekday: 1, opensAt: "08:00", closesAt: "18:00" }, { weekday: 6, opensAt: "08:00", closesAt: "12:00" }],
      holidays: ["2026-11-02", "2026-11-15"],
    });
  });

  it("base: atendente só lê, admin cadastra e edita", async () => {
    const headersAt = { ...form({}).headers, ...cookie(atendenteCookie) };
    const denied = await app.inject({ method: "POST", url: "/base", payload: new URLSearchParams({ kind: "plano", title: "x", body: "y" }).toString(), headers: headersAt });
    expect(denied.statusCode).toBe(403);

    const headers = { ...form({}).headers, ...cookie(adminCookie) };
    await app.inject({ method: "POST", url: "/base", payload: new URLSearchParams({ kind: "plano", title: "500 Mega", body: "R$ 99,90 por mês", active: "1" }).toString(), headers });
    const [item] = await store.listKnowledge(true);
    expect(item).toMatchObject({ kind: "plano", title: "500 Mega", active: true });
    await app.inject({ method: "POST", url: "/base", payload: new URLSearchParams({ id: item.id, kind: "plano", title: "500 Mega", body: "R$ 109,90 por mês", active: "0" }).toString(), headers });
    expect(await store.listKnowledge()).toEqual([]);
    expect((await store.listKnowledge(true))[0].body).toBe("R$ 109,90 por mês");
  });
});
