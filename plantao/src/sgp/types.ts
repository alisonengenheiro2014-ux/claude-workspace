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

export interface TrustUnlockResult {
  ok: boolean;
  reason?: string; // ex.: "já usado este mês"
  validUntil?: string;
}

export interface CoverageResult {
  covered: boolean;
  note?: string;
}

export interface SgpClient {
  findCustomer(query: { cpf?: string; phone?: string }): Promise<SgpCustomer | null>;
  connectionStatus(customerId: string): Promise<ConnectionStatus>;
  openInvoices(customerId: string): Promise<Invoice[]>;
  invoiceCopy(customerId: string, invoiceId: string): Promise<InvoiceCopy>;
  trustUnlock(customerId: string): Promise<TrustUnlockResult>;
  checkCoverage(cep: string, number: string): Promise<CoverageResult>;
  openTicket(customerId: string, reason: string, details: string): Promise<{ ticketId: string }>;
}
