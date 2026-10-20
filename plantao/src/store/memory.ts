import { randomUUID } from "node:crypto";
import type { Contact, Conversation, Incident, PendingItem, Store, StoredMessage } from "./types.js";

export class MemoryStore implements Store {
  contacts: Contact[] = [];
  conversations: Conversation[] = [];
  messages: (StoredMessage & { channelMessageId?: string })[] = [];
  incidents: Incident[] = [];
  incidentContacts: { incidentId: string; contactId: string }[] = [];
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
    const inc = { id: randomUUID(), ...i };
    this.incidents.push(inc);
    return inc;
  }

  async linkIncidentContact(incidentId: string, contactId: string) {
    if (!this.incidentContacts.some((x) => x.incidentId === incidentId && x.contactId === contactId)) {
      this.incidentContacts.push({ incidentId, contactId });
    }
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
}
