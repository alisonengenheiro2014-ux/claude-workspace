// Integração com Postgres real. Roda só com TEST_DATABASE_URL definido (banco descartável).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate.js";
import { PgStore } from "../src/store/pg.js";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("PgStore", () => {
  let pool: pg.Pool;
  let store: PgStore;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await pool.query("drop schema public cascade; create schema public;");
    expect(await migrate(pool)).toEqual(["001_init.sql", "002_seed.sql", "003_despedida_e_liberacao.sql", "004_liberacao_confianca.sql"]);
    expect(await migrate(pool)).toEqual([]);
    store = new PgStore(pool);
  });
  afterAll(() => pool?.end());

  it("contato, conversa única aberta e mensagem idempotente", async () => {
    const c = await store.upsertContact("5511900000003");
    expect((await store.upsertContact("5511900000003")).id).toBe(c.id);
    const [a, b] = await Promise.all([
      store.openConversation(c.id, "meta", "551130000000"),
      store.openConversation(c.id, "meta", "551130000000"),
    ]);
    expect(a.id).toBe(b.id);
    expect(await store.addMessage({ conversationId: a.id, author: "cliente", body: "oi", channelMessageId: "w1" })).toBe(true);
    expect(await store.addMessage({ conversationId: a.id, author: "cliente", body: "oi", channelMessageId: "w1" })).toBe(false);
    await store.addMessage({ conversationId: a.id, author: "ia", body: "olá" });
    expect((await store.history(a.id)).map((m) => m.body)).toEqual(["oi", "olá"]);
    const updated = await store.updateContact(c.id, { name: "Carla", sgpCustomerId: "1003", kind: "cliente" });
    expect(updated).toMatchObject({ name: "Carla", sgpCustomerId: "1003", kind: "cliente" });
  });

  it("incidente por área, vínculo e pendências por prioridade", async () => {
    const inc = await store.createIncident({ areaType: "olt", areaId: "OLT-01", status: "confirmado", message: "queda", eta: null });
    const found = await store.openIncidentForArea({ pop: "X", olt: "OLT-01", pon: "Y" });
    expect(found?.id).toBe(inc.id);
    expect(await store.openIncidentForArea({ pop: "X", olt: "OLT-02", pon: "Y" })).toBeNull();
    await expect(
      store.createIncident({ areaType: "olt", areaId: "OLT-01", status: "suspeito", message: "dup", eta: null }),
    ).rejects.toThrow();

    const c = await store.upsertContact("5511900000001");
    await store.linkIncidentContact(inc.id, c.id);
    await store.linkIncidentContact(inc.id, c.id);
    const conv = await store.openConversation(c.id, "meta", "n");
    await store.updateConversation(conv.id, { topic: "massivo", incidentId: inc.id });
    await store.createPending({ conversationId: conv.id, kind: "outro", priority: 3, summary: "baixa", data: {}, sgpTicketId: null });
    await store.createPending({ conversationId: conv.id, kind: "chamado_tecnico", priority: 1, summary: "LOS", data: { a: 1 }, sgpTicketId: "CH-1" });
    const list = await store.listPending("aberto");
    expect(list.map((p) => p.summary)).toEqual(["LOS", "baixa"]);
    expect(list[0].data).toEqual({ a: 1 });
  });

  it("seed de horários e base; salvar horários e itens da base", async () => {
    const h = await store.getHours();
    expect(h.windows).toHaveLength(6);
    expect(h.windows[0]).toEqual({ weekday: 1, opensAt: "08:00", closesAt: "21:00" });
    expect(h.windows.at(-1)).toEqual({ weekday: 6, opensAt: "08:00", closesAt: "12:00" });
    await store.setHours([{ weekday: 2, opensAt: "09:00", closesAt: "17:30" }], ["2026-12-25"]);
    expect(await store.getHours()).toEqual({ windows: [{ weekday: 2, opensAt: "09:00", closesAt: "17:30" }], holidays: ["2026-12-25"] });

    expect((await store.listKnowledge()).length).toBe(4);
    expect((await store.listKnowledge()).some((k) => k.title === "Liberação de confiança")).toBe(true);
    const k = await store.saveKnowledge({ kind: "plano", title: "300 Mega", body: "R$ 89,90", active: true });
    await store.saveKnowledge({ ...k, active: false });
    expect((await store.listKnowledge()).some((x) => x.id === k.id)).toBe(false);
    expect((await store.listKnowledge(true)).some((x) => x.id === k.id)).toBe(true);
  });

  it("usuários, conversa com contato, massivo e estatísticas", async () => {
    const u = await store.createUser({ name: "Bia", email: "bia@t.test", passwordHash: "scrypt$aa$bb", role: "atendente" });
    expect((await store.findUserByEmail("bia@t.test"))?.id).toBe(u.id);
    expect((await store.findUser(u.id))?.role).toBe("atendente");
    await expect(store.createUser({ name: "x", email: "bia@t.test", passwordHash: "x", role: "admin" })).rejects.toThrow();

    const c = await store.upsertContact("5511911112222");
    const conv = await store.openConversation(c.id, "meta", "n");
    const full = await store.getConversation(conv.id);
    expect(full?.contact.phone).toBe("5511911112222");

    const inc = await store.createIncident({ areaType: "pon", areaId: "PON-7/7", status: "confirmado", message: "queda", eta: null });
    await store.linkIncidentContact(inc.id, c.id);
    const eta = new Date("2026-10-21T09:30:00Z");
    await store.updateIncident(inc.id, { eta });
    expect((await store.getIncident(inc.id))?.eta?.toISOString()).toBe(eta.toISOString());
    await store.updateIncident(inc.id, { message: "nova msg" });
    expect((await store.getIncident(inc.id))?.eta?.toISOString()).toBe(eta.toISOString());
    const open = (await store.listOpenIncidents()).find((i) => i.id === inc.id);
    expect(open?.contactsCount).toBe(1);
    expect((await store.incidentContactsInWindow(inc.id, new Date(Date.now() - 86_400_000))).map((x) => x.id)).toEqual([c.id]);
    expect(await store.incidentContactsInWindow(inc.id, new Date(Date.now() + 60_000))).toEqual([]);
    await store.updateIncident(inc.id, { status: "resolvido" });
    expect((await store.listOpenIncidents()).some((i) => i.id === inc.id)).toBe(false);

    const p = await store.createPending({ conversationId: conv.id, kind: "outro", priority: 2, summary: "s", data: {}, sgpTicketId: null });
    const before = await store.stats(new Date(Date.now() - 86_400_000));
    await store.markPendingDone(p.id, u.id);
    const after = await store.stats(new Date(Date.now() - 86_400_000));
    expect(after.pendentes).toBe(before.pendentes - 1);
    expect(after.conversas).toBeGreaterThanOrEqual(3);
  });

  it("leituras do SGP, massivo automático, conversas paradas e retenção", async () => {
    const t1 = new Date("2026-10-21T02:00:00Z");
    await store.saveSnapshots([
      { customerId: "a", area: { pop: "P", olt: "O", pon: "N1" }, online: true, changedAt: t1 },
      { customerId: "b", area: { pop: "P", olt: "O", pon: "N1" }, online: false, changedAt: t1 },
    ], t1);
    const t2 = new Date("2026-10-21T02:02:00Z");
    // "b" saiu do SGP (cancelado): some da tabela
    await store.saveSnapshots([{ customerId: "a", area: { pop: "P", olt: "O", pon: "N1" }, online: false, changedAt: t2 }], t2);
    const snaps = await store.loadSnapshots();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ customerId: "a", online: false, area: { pon: "N1" } });
    expect(snaps[0].changedAt.toISOString()).toBe(t2.toISOString());

    const auto = await store.createIncident({ areaType: "pon", areaId: "N1", status: "suspeito", message: "auto", eta: null, detectedBy: "varredura" });
    expect((await store.getIncident(auto.id))?.detectedBy).toBe("varredura");

    const c = await store.upsertContact("5511977776666");
    const conv = await store.openConversation(c.id, "meta", "n");
    await store.addMessage({ conversationId: conv.id, author: "cliente", body: "antiga" });
    await pool.query(`update messages set sent_at = now() - interval '200 days' where conversation_id = $1`, [conv.id]);
    expect(await store.closeIdleConversations(new Date(Date.now() - 12 * 3_600_000))).toBeGreaterThanOrEqual(1);
    expect((await store.getConversation(conv.id))?.status).toBe("closed");
    expect(await store.deleteMessagesBefore(new Date(Date.now() - 180 * 86_400_000))).toBe(1);
    expect(await store.history(conv.id)).toEqual([]);
  });

  it("prazo de despedida pós-massivo", async () => {
    const c = await store.upsertContact("5511955554444");
    const conv = await store.openConversation(c.id, "meta", "n");
    expect(conv.closingAt).toBeNull();
    const at = new Date(Date.now() + 30 * 60_000);
    await store.setClosingAt(conv.id, at);
    expect(await store.dueClosings(new Date())).toEqual([]);
    const due = await store.dueClosings(new Date(Date.now() + 31 * 60_000));
    expect(due.map((d) => [d.conversation.id, d.contact.phone])).toEqual([[conv.id, "5511955554444"]]);
    await store.updateConversation(conv.id, { status: "closed" });
    expect(await store.dueClosings(new Date(Date.now() + 31 * 60_000))).toEqual([]);
  });

  it("histórico de liberações de confiança", async () => {
    await store.recordUnlock({ sgpCustomerId: "1002", conversationId: null, hours: 120, rule: "cliente_antigo_em_dia" });
    expect(await store.countUnlocksSince("1002", new Date(Date.now() - 30 * 86_400_000))).toBe(1);
    expect(await store.countUnlocksSince("1002", new Date(Date.now() + 60_000))).toBe(0);
    expect(await store.countUnlocksSince("9999", new Date(0))).toBe(0);
  });
});
