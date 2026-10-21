// SGP simulado para desenvolvimento e testes. Dados fictícios: nenhum cliente real.
import type {
  ConnectionSnapshot,
  ConnectionStatus,
  CoverageResult,
  Invoice,
  InvoiceCopy,
  SgpClient,
  SgpCustomer,
  TrustUnlockResult,
} from "./types.js";

export interface MockRecord {
  customer: SgpCustomer;
  status: ConnectionStatus;
  invoices: Invoice[];
  unlockUsed: boolean;
}

const area = (pon: string) => ({ pop: "POP-CENTRO", olt: "OLT-01", pon });

// cliente fictício extra, para montar cenários (ex.: uma PON inteira caindo)
export function mockRecord(id: string, pon: string, online = true, olt = "OLT-01"): MockRecord {
  return {
    customer: { id, name: `Cliente ${id}`, cpf: id.padStart(11, "0"), phones: [`55119${id.padStart(8, "0")}`], plan: "300 Mega", area: { pop: "POP-CENTRO", olt, pon } },
    status: { state: online ? "online" : "offline", suspended: false, since: "2026-10-01T00:00:00Z" },
    invoices: [],
    unlockUsed: false,
  };
}

export function defaultMockData(): MockRecord[] {
  return [
    {
      customer: { id: "1001", name: "Ana Teste", cpf: "11111111111", phones: ["5511900000001"], plan: "500 Mega", area: area("PON-1/1") },
      status: { state: "online", suspended: false, since: "2026-10-19T10:00:00Z" },
      invoices: [],
      unlockUsed: false,
    },
    {
      customer: { id: "1002", name: "Bruno Teste", cpf: "22222222222", phones: ["5511900000002"], plan: "300 Mega", area: area("PON-1/2") },
      status: { state: "offline", suspended: true, since: "2026-10-18T03:00:00Z" },
      invoices: [{ id: "F-2002", dueDate: "2026-10-05", amountCents: 9990, status: "vencida" }],
      unlockUsed: false,
    },
    {
      customer: { id: "1003", name: "Carla Teste", cpf: "33333333333", phones: ["5511900000003"], plan: "700 Mega", area: area("PON-2/1") },
      status: { state: "offline", suspended: false, since: "2026-10-20T01:10:00Z" },
      invoices: [{ id: "F-3001", dueDate: "2026-10-25", amountCents: 12990, status: "aberta" }],
      unlockUsed: false,
    },
  ];
}

export class MockSgp implements SgpClient {
  private tickets = 0;
  constructor(private records: MockRecord[] = defaultMockData()) {}

  private rec(customerId: string): MockRecord {
    const r = this.records.find((x) => x.customer.id === customerId);
    if (!r) throw new Error(`cliente ${customerId} não encontrado`);
    return r;
  }

  async listConnections(): Promise<ConnectionSnapshot[]> {
    return this.records.map((r) => ({ customerId: r.customer.id, area: r.customer.area, online: r.status.state === "online" }));
  }

  // só para testes e simulador: derruba ou religa todos os clientes de uma PON
  setPonState(pon: string, online: boolean) {
    for (const r of this.records.filter((x) => x.customer.area.pon === pon)) {
      r.status = { ...r.status, state: online ? "online" : "offline", since: new Date().toISOString() };
    }
  }

  async findCustomer(q: { cpf?: string; phone?: string }) {
    const cpf = q.cpf?.replace(/\D/g, "");
    const phone = q.phone?.replace(/\D/g, "");
    const r = this.records.find(
      (x) => (cpf && x.customer.cpf === cpf) || (phone && x.customer.phones.includes(phone)),
    );
    return r?.customer ?? null;
  }

  async connectionStatus(customerId: string) {
    return this.rec(customerId).status;
  }

  async openInvoices(customerId: string) {
    return this.rec(customerId).invoices;
  }

  async invoiceCopy(customerId: string, invoiceId: string): Promise<InvoiceCopy> {
    const inv = this.rec(customerId).invoices.find((i) => i.id === invoiceId);
    if (!inv) throw new Error(`fatura ${invoiceId} não pertence ao cliente`);
    return {
      boletoUrl: `https://boletos.exemplo.invalid/${invoiceId}.pdf`,
      pixCopiaECola: `00020126PIXEXEMPLO${invoiceId}`,
    };
  }

  async trustUnlock(customerId: string): Promise<TrustUnlockResult> {
    const r = this.rec(customerId);
    if (!r.status.suspended) return { ok: false, reason: "cliente não está bloqueado" };
    if (r.unlockUsed) return { ok: false, reason: "desbloqueio de confiança já usado neste mês" };
    r.unlockUsed = true;
    r.status = { state: "online", suspended: false, since: new Date().toISOString() };
    return { ok: true, validUntil: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10) };
  }

  async checkCoverage(cep: string): Promise<CoverageResult> {
    const digits = cep.replace(/\D/g, "");
    return digits.startsWith("0") ? { covered: false, note: "fora da área atendida" } : { covered: true };
  }

  async openTicket(_customerId: string, _reason: string, _details: string) {
    this.tickets += 1;
    return { ticketId: `CH-${1000 + this.tickets}` };
  }
}
