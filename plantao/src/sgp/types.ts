// Contrato com o SGP. A implementação HTTP real é ligada quando os endpoints forem confirmados.

export interface SgpCustomer {
  id: string;
  name: string;
  cpf: string;
  phones: string[];
  plan: string;
  area: { pop: string; olt: string; pon: string };
}

export type ConnectionState = "online" | "offline";

export interface ConnectionStatus {
  state: ConnectionState;
  suspended: boolean; // bloqueado por débito
  since: string; // ISO
}

export interface Invoice {
  id: string;
  dueDate: string; // YYYY-MM-DD
  amountCents: number;
  status: "aberta" | "vencida";
}

export interface InvoiceCopy {
  boletoUrl: string;
  pixCopiaECola: string;
}

import type { PerfilCliente } from "../policy/liberacao.js";

export interface TrustUnlockResult {
  ok: boolean;
  reason?: string; // ex.: "já usado este mês"
  validUntil?: string;
}

export interface OrdemServico {
  id: string;
  status: string;
  motivo: string;
  agendamento: string | null; // ISO, quando há visita marcada
}

export interface CoverageResult {
  covered: boolean | null; // null = não foi possível verificar
  note?: string;
}

export interface ConnectionSnapshot {
  customerId: string;
  area: { pop: string; olt: string; pon: string };
  online: boolean;
}

export interface SgpClient {
  // todas as conexões de uma vez, para a varredura de massivo
  listConnections(): Promise<ConnectionSnapshot[]>;
  findCustomer(query: { cpf?: string; phone?: string }): Promise<SgpCustomer | null>;
  connectionStatus(customerId: string): Promise<ConnectionStatus>;
  openInvoices(customerId: string): Promise<Invoice[]>;
  invoiceCopy(customerId: string, invoiceId: string): Promise<InvoiceCopy>;
  // histórico usado pela regra de liberação: tempo de casa, faturas pagas e atrasos
  customerProfile(customerId: string): Promise<PerfilCliente>;
  trustUnlock(customerId: string, horas: number): Promise<TrustUnlockResult>;
  checkCoverage(cep: string, number: string): Promise<CoverageResult>;
  openTicket(customerId: string, reason: string, details: string): Promise<{ ticketId: string }>;
  // OSs ainda abertas do contrato (para não abrir chamado duplicado)
  openOrders(customerId: string): Promise<OrdemServico[]>;
}
