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
    expect(await migrate(pool)).toEqual(["001_init.sql"]);
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
});
