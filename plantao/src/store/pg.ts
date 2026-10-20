import pg from "pg";
import type { Contact, Conversation, Incident, KnowledgeRow, PendingItem, Store, StoredMessage, User } from "./types.js";

const toContact = (r: any): Contact => ({
  id: r.id, phone: r.phone, name: r.name, cpf: r.cpf, sgpCustomerId: r.sgp_customer_id, kind: r.kind,
});
const toConversation = (r: any): Conversation => ({
  id: r.id, contactId: r.contact_id, channel: r.channel, channelNumber: r.channel_number,
  status: r.status, topic: r.topic, incidentId: r.incident_id, createdAt: r.created_at,
});
const toIncident = (r: any): Incident => ({
  id: r.id, areaType: r.area_type, areaId: r.area_id, status: r.status, message: r.message, eta: r.eta,
});
const toUser = (r: any): User => ({ id: r.id, name: r.name, email: r.email, passwordHash: r.password_hash, role: r.role });
const toKnowledge = (r: any): KnowledgeRow => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, active: r.active });
const toPending = (r: any): PendingItem => ({
  id: r.id, conversationId: r.conversation_id, kind: r.kind, priority: r.priority, summary: r.summary,
  data: r.data, sgpTicketId: r.sgp_ticket_id, status: r.status, createdAt: r.created_at,
});

export class PgStore implements Store {
  constructor(private pool: pg.Pool) {}

  async upsertContact(phone: string) {
    const { rows } = await this.pool.query(
      `insert into contacts (phone) values ($1)
       on conflict (phone) do update set updated_at = now()
       returning *`,
      [phone],
    );
    return toContact(rows[0]);
  }

  async updateContact(id: string, patch: Partial<Omit<Contact, "id" | "phone">>) {
    const { rows } = await this.pool.query(
      `update contacts set
         name = coalesce($2, name), cpf = coalesce($3, cpf),
         sgp_customer_id = coalesce($4, sgp_customer_id), kind = coalesce($5, kind), updated_at = now()
       where id = $1 returning *`,
      [id, patch.name ?? null, patch.cpf ?? null, patch.sgpCustomerId ?? null, patch.kind ?? null],
    );
    return toContact(rows[0]);
  }

  async openConversation(contactId: string, channel: Conversation["channel"], channelNumber: string) {
    // o índice único parcial garante uma conversa aberta por contato, mesmo com webhooks simultâneos
    const { rows } = await this.pool.query(
      `insert into conversations (contact_id, channel, channel_number, ai_started_at)
       values ($1, $2, $3, now())
       on conflict (contact_id) where status <> 'closed' do nothing
       returning *`,
      [contactId, channel, channelNumber],
    );
    if (rows[0]) return toConversation(rows[0]);
    const existing = await this.pool.query(
      `select * from conversations where contact_id = $1 and status <> 'closed'`,
      [contactId],
    );
    return toConversation(existing.rows[0]);
  }

  async updateConversation(id: string, patch: Partial<Pick<Conversation, "status" | "topic" | "incidentId">>) {
    await this.pool.query(
      `update conversations set
         status = coalesce($2, status), topic = coalesce($3, topic),
         incident_id = coalesce($4, incident_id), updated_at = now(),
         closed_at = case when $2 = 'closed' then now() else closed_at end
       where id = $1`,
      [id, patch.status ?? null, patch.topic ?? null, patch.incidentId ?? null],
    );
  }

  async addMessage(m: { conversationId: string; author: StoredMessage["author"]; body: string | null; channelMessageId?: string }) {
    const { rowCount } = await this.pool.query(
      `insert into messages (conversation_id, author, body, channel_message_id)
       values ($1, $2, $3, $4) on conflict (channel_message_id) do nothing`,
      [m.conversationId, m.author, m.body, m.channelMessageId ?? null],
    );
    return rowCount === 1;
  }

  async history(conversationId: string, limit = 40) {
    const { rows } = await this.pool.query(
      `select * from (select * from messages where conversation_id = $1 order by sent_at desc limit $2) t
       order by sent_at asc`,
      [conversationId, limit],
    );
    return rows.map((r) => ({ id: r.id, conversationId: r.conversation_id, author: r.author, body: r.body, sentAt: r.sent_at }));
  }

  async openIncidentForArea(area: { pop: string; olt: string; pon: string }) {
    const { rows } = await this.pool.query(
      `select * from incidents
       where status in ('suspeito','confirmado')
         and ((area_type = 'pop' and area_id = $1) or (area_type = 'olt' and area_id = $2) or (area_type = 'pon' and area_id = $3))
       order by started_at limit 1`,
      [area.pop, area.olt, area.pon],
    );
    return rows[0] ? toIncident(rows[0]) : null;
  }

  async createIncident(i: Omit<Incident, "id">) {
    const { rows } = await this.pool.query(
      `insert into incidents (area_type, area_id, status, message, eta, detected_by)
       values ($1, $2, $3, $4, $5, 'equipe') returning *`,
      [i.areaType, i.areaId, i.status, i.message, i.eta],
    );
    return toIncident(rows[0]);
  }

  async linkIncidentContact(incidentId: string, contactId: string) {
    await this.pool.query(
      `insert into incident_contacts (incident_id, contact_id) values ($1, $2)
       on conflict (incident_id, contact_id) do update set last_contact_at = now()`,
      [incidentId, contactId],
    );
  }

  async createPending(p: Omit<PendingItem, "id" | "status" | "createdAt">) {
    const { rows } = await this.pool.query(
      `insert into pending_items (conversation_id, kind, priority, summary, data, sgp_ticket_id)
       values ($1, $2, $3, $4, $5, $6) returning *`,
      [p.conversationId, p.kind, p.priority, p.summary, p.data, p.sgpTicketId],
    );
    return toPending(rows[0]);
  }

  async listPending(status?: PendingItem["status"]) {
    const { rows } = await this.pool.query(
      `select * from pending_items where ($1::text is null or status = $1) order by priority, created_at`,
      [status ?? null],
    );
    return rows.map(toPending);
  }

  async createUser(u: Omit<User, "id">) {
    const { rows } = await this.pool.query(
      `insert into users (name, email, password_hash, role) values ($1, $2, $3, $4) returning *`,
      [u.name, u.email, u.passwordHash, u.role],
    );
    return toUser(rows[0]);
  }

  async findUserByEmail(email: string) {
    const { rows } = await this.pool.query(`select * from users where email = $1`, [email]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findUser(id: string) {
    const { rows } = await this.pool.query(`select * from users where id = $1`, [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async markPendingDone(id: string, userId: string) {
    await this.pool.query(
      `update pending_items set status = 'feito', done_by = $2, done_at = now(), updated_at = now() where id = $1`,
      [id, userId],
    );
  }

  async getConversation(id: string) {
    const { rows } = await this.pool.query(
      `select c.*, row_to_json(k.*) as contact from conversations c join contacts k on k.id = c.contact_id where c.id = $1`,
      [id],
    );
    return rows[0] ? { ...toConversation(rows[0]), contact: toContact(rows[0].contact) } : null;
  }

  async listOpenIncidents() {
    const { rows } = await this.pool.query(
      `select i.*, (select count(*) from incident_contacts ic where ic.incident_id = i.id)::int as contacts_count
       from incidents i where status in ('suspeito','confirmado') order by started_at`,
    );
    return rows.map((r) => ({ ...toIncident(r), contactsCount: r.contacts_count, startedAt: r.started_at }));
  }

  async getIncident(id: string) {
    const { rows } = await this.pool.query(`select * from incidents where id = $1`, [id]);
    return rows[0] ? toIncident(rows[0]) : null;
  }

  async updateIncident(id: string, patch: Partial<Pick<Incident, "status" | "message" | "eta">>) {
    await this.pool.query(
      `update incidents set
         status = coalesce($2, status), message = coalesce($3, message),
         eta = case when $4::boolean then $5 else eta end, updated_at = now(),
         resolved_at = case when $2 in ('resolvido','descartado') then now() else resolved_at end
       where id = $1`,
      [id, patch.status ?? null, patch.message ?? null, "eta" in patch, patch.eta ?? null],
    );
  }

  async incidentContactsInWindow(incidentId: string, since: Date) {
    const { rows } = await this.pool.query(
      `select k.* from incident_contacts ic join contacts k on k.id = ic.contact_id
       where ic.incident_id = $1 and ic.last_contact_at >= $2`,
      [incidentId, since],
    );
    return rows.map(toContact);
  }

  async getHours() {
    const w = await this.pool.query(
      `select weekday, to_char(opens_at, 'HH24:MI') as opens_at, to_char(closes_at, 'HH24:MI') as closes_at
       from business_hours order by weekday, opens_at`,
    );
    const h = await this.pool.query(`select to_char(day, 'YYYY-MM-DD') as day from holidays order by day`);
    return {
      windows: w.rows.map((r) => ({ weekday: r.weekday, opensAt: r.opens_at, closesAt: r.closes_at })),
      holidays: h.rows.map((r) => r.day),
    };
  }

  async setHours(windows: { weekday: number; opensAt: string; closesAt: string }[], holidays: string[]) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from business_hours");
      for (const w of windows) {
        await client.query(`insert into business_hours (weekday, opens_at, closes_at) values ($1, $2, $3)`, [w.weekday, w.opensAt, w.closesAt]);
      }
      await client.query("delete from holidays");
      for (const d of holidays) await client.query(`insert into holidays (day) values ($1)`, [d]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  async listKnowledge(includeInactive = false) {
    const { rows } = await this.pool.query(
      `select * from knowledge_items where $1 or active order by kind, title`,
      [includeInactive],
    );
    return rows.map(toKnowledge);
  }

  async saveKnowledge(k: Omit<KnowledgeRow, "id"> & { id?: string }) {
    const { rows } = k.id
      ? await this.pool.query(
          `update knowledge_items set kind = $2, title = $3, body = $4, active = $5, updated_at = now() where id = $1 returning *`,
          [k.id, k.kind, k.title, k.body, k.active],
        )
      : await this.pool.query(
          `insert into knowledge_items (kind, title, body, active) values ($1, $2, $3, $4) returning *`,
          [k.kind, k.title, k.body, k.active],
        );
    return toKnowledge(rows[0]);
  }

  async stats(since: Date) {
    const { rows } = await this.pool.query(
      `select
         (select count(*) from conversations where created_at >= $1)::int as conversas,
         (select count(*) from conversations where created_at >= $1 and status in ('ia','closed'))::int as resolvidas_ia,
         (select count(*) from pending_items where status = 'aberto')::int as pendentes,
         (select count(*) from conversations where created_at >= $1 and topic = 'massivo')::int as massivo`,
      [since],
    );
    const r = rows[0];
    return { conversas: r.conversas, resolvidasIa: r.resolvidas_ia, pendentes: r.pendentes, massivo: r.massivo };
  }
}
