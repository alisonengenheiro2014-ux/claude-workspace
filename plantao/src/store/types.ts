import type { StoredSnapshot } from "../jobs/detector.js";

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
  detectedBy?: "varredura" | "equipe";
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
  createIncident(i: Omit<Incident, "id"> & { detectedBy?: "varredura" | "equipe" }): Promise<Incident>;
  linkIncidentContact(incidentId: string, contactId: string): Promise<void>;
  createPending(p: Omit<PendingItem, "id" | "status" | "createdAt">): Promise<PendingItem>;
  listPending(status?: PendingItem["status"]): Promise<PendingItem[]>;

  // --- painel ---
  createUser(u: Omit<User, "id">): Promise<User>;
  findUserByEmail(email: string): Promise<User | null>;
  findUser(id: string): Promise<User | null>;
  markPendingDone(id: string, userId: string): Promise<void>;
  getConversation(id: string): Promise<(Conversation & { contact: Contact }) | null>;
  listOpenIncidents(): Promise<(Incident & { contactsCount: number; startedAt: Date })[]>;
  getIncident(id: string): Promise<Incident | null>;
  updateIncident(id: string, patch: Partial<Pick<Incident, "status" | "message" | "eta">>): Promise<void>;
  // contatos do incidente que falaram nas últimas 24h (janela grátis da Meta)
  incidentContactsInWindow(incidentId: string, since: Date): Promise<Contact[]>;
  getHours(): Promise<{ windows: { weekday: number; opensAt: string; closesAt: string }[]; holidays: string[] }>;
  setHours(windows: { weekday: number; opensAt: string; closesAt: string }[], holidays: string[]): Promise<void>;
  listKnowledge(includeInactive?: boolean): Promise<KnowledgeRow[]>;
  saveKnowledge(k: Omit<KnowledgeRow, "id"> & { id?: string }): Promise<KnowledgeRow>;
  // --- rotinas ---
  loadSnapshots(): Promise<StoredSnapshot[]>;
  saveSnapshots(snaps: StoredSnapshot[], checkedAt: Date): Promise<void>;
  // fecha conversas sem mensagem desde "before"; devolve quantas
  closeIdleConversations(before: Date): Promise<number>;
  // LGPD: apaga mensagens anteriores a "before"; devolve quantas
  deleteMessagesBefore(before: Date): Promise<number>;
  stats(since: Date): Promise<{ conversas: number; resolvidasIa: number; pendentes: number; massivo: number }>;
}

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: "admin" | "atendente";
}

export interface KnowledgeRow {
  id: string;
  kind: "plano" | "cobertura" | "faq" | "roteiro_onu" | "politica";
  title: string;
  body: string;
  active: boolean;
}
