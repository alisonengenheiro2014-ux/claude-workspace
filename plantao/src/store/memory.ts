import { randomUUID } from "node:crypto";
import type { Contact, Conversation, Incident, KnowledgeRow, PendingItem, Store, StoredMessage, User } from "./types.js";

export class MemoryStore implements Store {
  contacts: Contact[] = [];
  conversations: Conversation[] = [];
  messages: (StoredMessage & { channelMessageId?: string })[] = [];
  incidents: (Incident & { startedAt: Date })[] = [];
  incidentContacts: { incidentId: string; contactId: string; lastContactAt: Date }[] = [];
  users: User[] = [];
  knowledge: KnowledgeRow[] = [];
  hours: { windows: { weekday: number; opensAt: string; closesAt: string }[]; holidays: string[] } = { windows: [], holidays: [] };
  pending: PendingItem[] = [];

  async upsertContact(phone: string) {
    let c = this.contacts.find((x) => x.phone === phone);
    if (!c) {
      c = { id: randomUUID(), phone, name: null, cpf: null, sgpCustomerId: null, kind: "desconhecido" };
      this.contacts.push(c);
    }
    return c;
  }

  async updateContact(id: string, patch: Partial<Omit<Contact, "id" | "phone">>) {
    const c = this.contacts.find((x) => x.id === id)!;
    Object.assign(c, patch);
    return c;
  }

  async openConversation(contactId: string, channel: Conversation["channel"], channelNumber: string) {
    const open = this.conversations.find((x) => x.contactId === contactId && x.status !== "closed");
    if (open) return open;
    const conv: Conversation = {
      id: randomUUID(), contactId, channel, channelNumber, status: "ia", topic: null, incidentId: null, createdAt: new Date(),
    };
    this.conversations.push(conv);
    return conv;
  }

  async updateConversation(id: string, patch: Partial<Pick<Conversation, "status" | "topic" | "incidentId">>) {
    Object.assign(this.conversations.find((x) => x.id === id)!, patch);
  }

  async addMessage(m: { conversationId: string; author: StoredMessage["author"]; body: string | null; channelMessageId?: string }) {
    if (m.channelMessageId && this.messages.some((x) => x.channelMessageId === m.channelMessageId)) return false;
    this.messages.push({ id: randomUUID(), sentAt: new Date(), ...m });
    return true;
  }

  async history(conversationId: string, limit = 40) {
    return this.messages.filter((x) => x.conversationId === conversationId).slice(-limit);
  }

  async openIncidentForArea(area: { pop: string; olt: string; pon: string }) {
    return (
      this.incidents.find(
        (i) =>
          (i.status === "suspeito" || i.status === "confirmado") &&
          ((i.areaType === "pop" && i.areaId === area.pop) ||
            (i.areaType === "olt" && i.areaId === area.olt) ||
            (i.areaType === "pon" && i.areaId === area.pon)),
      ) ?? null
    );
  }

  async createIncident(i: Omit<Incident, "id">) {
    const inc = { id: randomUUID(), startedAt: new Date(), ...i };
    this.incidents.push(inc);
    return inc;
  }

  async linkIncidentContact(incidentId: string, contactId: string) {
    const link = this.incidentContacts.find((x) => x.incidentId === incidentId && x.contactId === contactId);
    if (link) link.lastContactAt = new Date();
    else this.incidentContacts.push({ incidentId, contactId, lastContactAt: new Date() });
  }

  async createPending(p: Omit<PendingItem, "id" | "status" | "createdAt">) {
    const item: PendingItem = { id: randomUUID(), status: "aberto", createdAt: new Date(), ...p };
    this.pending.push(item);
    return item;
  }

  async listPending(status?: PendingItem["status"]) {
    return this.pending
      .filter((p) => !status || p.status === status)
      .sort((a, b) => a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime());
  }

  async createUser(u: Omit<User, "id">) {
    if (this.users.some((x) => x.email === u.email)) throw new Error("e-mail já cadastrado");
    const user = { id: randomUUID(), ...u };
    this.users.push(user);
    return user;
  }

  async findUserByEmail(email: string) {
    return this.users.find((u) => u.email === email) ?? null;
  }

  async findUser(id: string) {
    return this.users.find((u) => u.id === id) ?? null;
  }

  async markPendingDone(id: string, _userId: string) {
    const p = this.pending.find((x) => x.id === id);
    if (p) p.status = "feito";
  }

  async getConversation(id: string) {
    const conv = this.conversations.find((c) => c.id === id);
    if (!conv) return null;
    return { ...conv, contact: this.contacts.find((c) => c.id === conv.contactId)! };
  }

  async listOpenIncidents() {
    return this.incidents
      .filter((i) => i.status === "suspeito" || i.status === "confirmado")
      .map((i) => ({ ...i, contactsCount: this.incidentContacts.filter((x) => x.incidentId === i.id).length }));
  }

  async getIncident(id: string) {
    return this.incidents.find((i) => i.id === id) ?? null;
  }

  async updateIncident(id: string, patch: Partial<Pick<Incident, "status" | "message" | "eta">>) {
    const inc = this.incidents.find((i) => i.id === id);
    if (inc) Object.assign(inc, patch);
  }

  async incidentContactsInWindow(incidentId: string, since: Date) {
    return this.incidentContacts
      .filter((x) => x.incidentId === incidentId && x.lastContactAt >= since)
      .map((x) => this.contacts.find((c) => c.id === x.contactId)!);
  }

  async getHours() {
    return this.hours;
  }

  async setHours(windows: { weekday: number; opensAt: string; closesAt: string }[], holidays: string[]) {
    this.hours = { windows, holidays };
  }

  async listKnowledge(includeInactive = false) {
    return this.knowledge.filter((k) => includeInactive || k.active);
  }

  async saveKnowledge(k: Omit<KnowledgeRow, "id"> & { id?: string }) {
    const existing = k.id ? this.knowledge.find((x) => x.id === k.id) : undefined;
    if (existing) return Object.assign(existing, k);
    const row = { ...k, id: randomUUID() };
    this.knowledge.push(row);
    return row;
  }

  async stats(since: Date) {
    const convs = this.conversations.filter((c) => c.createdAt >= since);
    return {
      conversas: convs.length,
      resolvidasIa: convs.filter((c) => c.status === "ia" || c.status === "closed").length,
      pendentes: this.pending.filter((p) => p.status === "aberto").length,
      massivo: convs.filter((c) => c.topic === "massivo").length,
    };
  }
}
