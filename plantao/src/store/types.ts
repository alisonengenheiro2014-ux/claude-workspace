// Persistência. Duas implementações: memória (testes e simulador) e Postgres (produção).

export type Author = "cliente" | "ia" | "humano" | "sistema";
export type ConversationStatus = "ia" | "aguardando_equipe" | "humano" | "closed";
export type Topic = "sem_internet" | "financeiro" | "pre_venda" | "visita_tecnica" | "massivo" | "outro";
export type PendingKind = "chamado_tecnico" | "pre_venda" | "conferir_pagamento" | "outro";

export interface Contact {
  id: string;
  phone: string;
  name: string | null;
  cpf: string | null;
  sgpCustomerId: string | null;
  kind: "desconhecido" | "cliente" | "lead";
}

export interface Conversation {
  id: string;
  contactId: string;
  channel: "chatmix" | "meta";
  channelNumber: string;
  status: ConversationStatus;
  topic: Topic | null;
  incidentId: string | null;
  createdAt: Date;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  author: Author;
  body: string | null;
  sentAt: Date;
}

export interface Incident {
  id: string;
  areaType: "pop" | "olt" | "pon" | "manual";
  areaId: string;
  status: "suspeito" | "confirmado" | "resolvido" | "descartado";
  message: string;
  eta: Date | null;
}

export interface PendingItem {
  id: string;
  conversationId: string;
  kind: PendingKind;
  priority: 1 | 2 | 3;
  summary: string;
  data: Record<string, unknown>;
  sgpTicketId: string | null;
  status: "aberto" | "feito";
  createdAt: Date;
}

export interface Store {
  upsertContact(phone: string): Promise<Contact>;
  updateContact(id: string, patch: Partial<Omit<Contact, "id" | "phone">>): Promise<Contact>;
  openConversation(contactId: string, channel: Conversation["channel"], channelNumber: string): Promise<Conversation>;
  updateConversation(id: string, patch: Partial<Pick<Conversation, "status" | "topic" | "incidentId">>): Promise<void>;
  // retorna false se a mensagem do canal já foi gravada (webhook repetido)
  addMessage(m: { conversationId: string; author: Author; body: string | null; channelMessageId?: string }): Promise<boolean>;
  history(conversationId: string, limit?: number): Promise<StoredMessage[]>;
  openIncidentForArea(area: { pop: string; olt: string; pon: string }): Promise<Incident | null>;
  createIncident(i: Omit<Incident, "id">): Promise<Incident>;
  linkIncidentContact(incidentId: string, contactId: string): Promise<void>;
  createPending(p: Omit<PendingItem, "id" | "status" | "createdAt">): Promise<PendingItem>;
  listPending(status?: PendingItem["status"]): Promise<PendingItem[]>;
}
