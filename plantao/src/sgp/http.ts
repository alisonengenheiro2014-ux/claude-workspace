// Cliente da API do SGP (rotas "URA", POST com JSON e credenciais app + token no corpo).
// As rotas e campos seguem integrações públicas que já usam o SGP em produção; as respostas variam
// entre versões do SGP, por isso a leitura aceita nomes alternativos. Conferir com o SGP da Maxgiga.
import type { PerfilCliente } from "../policy/liberacao.js";
import type {
  ConnectionSnapshot,
  ConnectionStatus,
  CoverageResult,
  Invoice,
  InvoiceCopy,
  OrdemServico,
  SgpClient,
  SgpCustomer,
  TrustUnlockResult,
} from "./types.js";

export interface HttpSgpOptions {
  baseUrl: string;
  app: string;
  token: string;
  ocorrenciaTipo?: number; // tipo de ocorrência usado ao abrir chamado (lista em /api/os/ocorrencia/tipo/list/)
  sinalMinimoDbm?: number; // abaixo disso a ONU é considerada sem sinal (offline)
  fetchFn?: typeof fetch;
  now?: () => Date;
}

type Json = Record<string, any>;

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

// primeiro campo presente entre os nomes alternativos
const pick = (o: Json | undefined, ...keys: string[]) => {
  for (const k of keys) if (o && o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  return undefined;
};
const firstArray = (o: Json, ...keys: string[]): Json[] => {
  for (const k of keys) if (Array.isArray(o?.[k])) return o[k];
  return Array.isArray(o) ? (o as Json[]) : [];
};

// "129,90" | "129.90" | 129.9 -> centavos
export function toCents(v: unknown): number {
  if (typeof v === "number") return Math.round(v * 100);
  const s = String(v ?? "0").trim();
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  return Math.round(Number(normalized) * 100) || 0;
}

// "10/10/2026" | "2026-10-10" -> "2026-10-10"
export function toIsoDate(v: unknown): string {
  const s = String(v ?? "");
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : s.slice(0, 10);
}

const isFalsy = (v: unknown) => ["0", "false", "nao", "não", "n", "erro", "error"].includes(String(v).toLowerCase());

export class SgpError extends Error {}

export class HttpSgp implements SgpClient {
  private fetchFn: typeof fetch;
  private clientesCache: { at: number; rows: Json[] } | null = null;

  constructor(private opts: HttpSgpOptions) {
    if (!opts.baseUrl || !opts.app || !opts.token) throw new Error("SGP_BASE_URL, SGP_APP e SGP_TOKEN são obrigatórios no modo http");
    this.fetchFn = opts.fetchFn ?? fetch;
    // as rotas já começam com /api: aceita SGP_BASE_URL com ou sem /api no fim
    this.opts = { ...opts, baseUrl: opts.baseUrl.replace(/\/api\/?$/, "").replace(/\/$/, "") };
  }

  private async post(path: string, body: Json, timeoutMs = 15_000): Promise<Json> {
    const res = await this.fetchFn(new URL(path, this.opts.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app: this.opts.app, token: this.opts.token, ...body }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = "";
      try { detail = ` — ${(JSON.parse(text) as Json).detail ?? text.slice(0, 120)}`; } catch {}
      throw new SgpError(`SGP ${path} respondeu ${res.status}${detail}`);
    }
    const json = text ? (JSON.parse(text) as Json) : {};
    if (isFalsy(json.status) && json.erro) throw new SgpError(String(json.erro));
    return json;
  }

  private async get(path: string): Promise<Json> {
    const url = new URL(path, this.opts.baseUrl);
    url.searchParams.set("app", this.opts.app);
    url.searchParams.set("token", this.opts.token);
    const res = await this.fetchFn(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      let detail = "";
      try { const t = await res.text(); detail = ` — ${(JSON.parse(t) as Json).detail ?? t.slice(0, 120)}`; } catch {}
      throw new SgpError(`SGP ${path} respondeu ${res.status}${detail}`);
    }
    return (await res.json()) as Json;
  }

  // contrato ativo (ou o primeiro) de um cliente
  private async contractFor(filter: Json): Promise<{ contrato: Json; raw: Json } | null> {
    const raw = await this.post("/api/ura/consultacliente/", filter);
    const contratos = firstArray(raw, "contratos", "dados", "data", "clientes");
    if (!contratos.length) return null;
    const ativo = contratos.find((c) => String(pick(c, "contratoStatus", "status")) === "1") ?? contratos[0];
    return { contrato: ativo, raw };
  }

  private async onu(contratoId: string): Promise<Json | null> {
    try {
      const list = await this.get(`/api/fttx/onu/list/?contrato=${encodeURIComponent(contratoId)}`);
      return firstArray(list, "results", "onus", "dados", "data")[0] ?? null;
    } catch {
      return null; // sem módulo FTTX ou sem ONU vinculada
    }
  }

  private areaFrom(onu: Json | null): SgpCustomer["area"] {
    if (!onu) return { pop: "", olt: "", pon: "" };
    const olt = String(pick(onu, "olt_name", "olt") ?? "");
    const slot = pick(onu, "slot");
    const pon = pick(onu, "pon");
    return { pop: String(pick(onu, "pop", "pop_name") ?? ""), olt, pon: pon !== undefined ? `${olt}:${slot ?? 0}/${pon}` : "" };
  }

  private async customerFromContract(c: Json, raw: Json): Promise<SgpCustomer> {
    const id = String(pick(c, "contratoId", "contrato", "idContrato", "id"));
    // coleta telefones do contrato ativo e de todos os contratos da resposta (SGP pode ter o telefone em qualquer um)
    const allContratos = firstArray(raw, "contratos", "dados", "data", "clientes");
    const allPhoneEntries = firstArray(c, "telefones", "contatos")
      .concat(firstArray(raw, "telefones", "contatos"))
      .concat(allContratos.flatMap((ct) => firstArray(ct, "telefones", "contatos")));
    const phones = [...new Set(
      allPhoneEntries
        .map((t) => digits(typeof t === "object" ? pick(t, "contato", "numero", "telefone") : t))
        .filter((p) => p.length >= 10)
        .map((p) => (p.startsWith("55") ? p : `55${p}`))
    )];
    return {
      id,
      name: String(pick(c, "razaoSocial", "nome") ?? pick(raw, "razaoSocial", "nome") ?? ""),
      cpf: digits(pick(c, "cpfCnpj", "cpfcnpj") ?? pick(raw, "cpfCnpj", "cpfcnpj")),
      phones,
      plan: String(pick(c, "planoInternet", "plano", "servicoPlano") ?? ""),
      area: this.areaFrom(await this.onu(id)),
    };
  }

  // a busca por telefone usa a listagem de clientes (SGP não filtra por telefone); guarda por 10 min
  private async clientesListing(): Promise<Json[]> {
    if (this.clientesCache && Date.now() - this.clientesCache.at < 10 * 60_000) return this.clientesCache.rows;
    const rows: Json[] = [];
    for (let offset = 0; offset < 50_000; offset += 100) {
      const page = await this.post("/api/ura/clientes/", { offset, limit: 100 }, 90_000);
      const items = firstArray(page, "clientes", "contratos", "dados", "data", "results", "items");
      rows.push(...items);
      if (items.length < 100) break;
    }
    this.clientesCache = { at: Date.now(), rows };
    return rows;
  }

  async findCustomer(q: { cpf?: string; phone?: string }): Promise<SgpCustomer | null> {
    let cpf = digits(q.cpf);
    if (!cpf && q.phone) {
      const phone = digits(q.phone).replace(/^55/, "");
      const phoneMatches = (entries: Json[]) => entries.some((t) => {
        const p = digits(typeof t === "object" ? pick(t, "contato", "numero", "telefone") : t);
        return p.length >= 10 && (phone.endsWith(p.slice(-10)) || p.endsWith(phone.slice(-10)));
      });
      // listagem /api/ura/clientes/ retorna contatos aninhados: { contatos: { telefones: [], celulares: [] } }
      const match = (await this.clientesListing()).find((r) => {
        const nested = r.contatos as Json | undefined;
        return phoneMatches(firstArray(r, "telefones"))
          || phoneMatches(firstArray(nested ?? {}, "telefones", "celulares"))
          || firstArray(r, "contratos").some((c) => phoneMatches(firstArray(c, "telefones", "contatos")));
      });
      cpf = digits(pick(match, "cpfcnpj", "cpfCnpj"));
    }
    if (!cpf) return null;
    const found = await this.contractFor({ cpfcnpj: cpf });
    return found ? this.customerFromContract(found.contrato, found.raw) : null;
  }

  async connectionStatus(customerId: string): Promise<ConnectionStatus> {
    const found = await this.contractFor({ contrato: customerId });
    const c = found?.contrato ?? {};
    const suspended = String(pick(c, "contratoStatus", "status")) === "4" || ["1", "true", "sim"].includes(String(pick(c, "bloqueado")).toLowerCase());
    const onu = await this.onu(customerId);
    const rx = Number(pick(onu ?? {}, "info_rx", "rx"));
    const online = onu ? Number.isFinite(rx) && rx > (this.opts.sinalMinimoDbm ?? -30) : !suspended;
    return { state: online ? "online" : "offline", suspended, since: String(pick(onu ?? {}, "info_date") ?? (this.opts.now?.() ?? new Date()).toISOString()) };
  }

  private async titulos(customerId: string, apenasEmAberto = true): Promise<Json[]> {
    const raw = await this.post("/api/ura/titulos/", { contrato: customerId, ...(apenasEmAberto ? { apenas_titulos_em_aberto: 1 } : {}), limit: 24 });
    return firstArray(raw, "titulos", "titulo", "faturas", "dados", "data");
  }

  // tempo de casa, datas de pagamento e dia de vencimento, para a regra de liberação de confiança
  async customerProfile(customerId: string): Promise<PerfilCliente> {
    const found = await this.contractFor({ contrato: customerId });
    const c = found?.contrato ?? {};
    const desdeRaw = pick(c, "dataCadastro", "data_cadastro", "dataAtivacao", "data_ativacao", "dataInstalacao", "data_instalacao", "dataInicio", "data_inicio", "dataContrato");
    const desde = desdeRaw ? new Date(`${toIsoDate(desdeRaw)}T12:00:00-03:00`) : null;
    const titulos = await this.titulos(customerId, false);
    const pagamentos = titulos
      .filter((t) => pick(t, "dataPagamento", "data_pagamento"))
      .map((t) => ({ vencimento: toIsoDate(pick(t, "vencimento", "dataVencimento")), pagamento: toIsoDate(pick(t, "dataPagamento", "data_pagamento")) }));
    const vencimentos = titulos.map((t) => toIsoDate(pick(t, "vencimento", "dataVencimento"))).filter(Boolean).sort();
    const diaVencimento = vencimentos.length ? Number(vencimentos.at(-1)!.slice(8, 10)) || null : null;
    return { clienteDesde: desde && !Number.isNaN(desde.getTime()) ? desde : null, pagamentos, diaVencimento };
  }

  // rota testada pela Maxgiga; devolve só OSs abertas, por isso não serve para histórico
  async openOrders(customerId: string): Promise<OrdemServico[]> {
    const now = this.opts.now?.() ?? new Date();
    const raw = await this.post("/api/os/list/", { mes: String(now.getMonth() + 1), ano: String(now.getFullYear()) });
    return firstArray(raw, "ordens", "os", "dados", "data", "results")
      .filter((o) => String(pick(o, "contrato_id", "contrato")) === customerId && !pick(o, "os_data_finalizacao"))
      .map((o) => ({
        id: String(pick(o, "os_id", "id")),
        status: String(pick(o, "os_status_txt", "os_status") ?? ""),
        motivo: String(pick(o, "os_motivo_descricao") ?? ""),
        agendamento: pick(o, "os_data_agendamento") ? String(pick(o, "os_data_agendamento")) : null,
      }));
  }

  async openInvoices(customerId: string): Promise<Invoice[]> {
    const today = (this.opts.now?.() ?? new Date()).toISOString().slice(0, 10);
    return (await this.titulos(customerId))
      .filter((t) => !pick(t, "dataPagamento"))
      .map((t) => {
        const dueDate = toIsoDate(pick(t, "vencimento", "dataVencimento"));
        return {
          id: String(pick(t, "id", "numerodocumento")),
          dueDate,
          amountCents: toCents(pick(t, "valorTotal", "valor", "valorCorrigido")),
          status: dueDate < today ? ("vencida" as const) : ("aberta" as const),
        };
      });
  }

  async invoiceCopy(customerId: string, invoiceId: string): Promise<InvoiceCopy> {
    const t = (await this.titulos(customerId)).find((x) => String(pick(x, "id", "numerodocumento")) === invoiceId);
    if (!t) throw new SgpError(`fatura ${invoiceId} não pertence ao cliente`);
    const pix = pick(t, "pix_copia_cola", "pixCopiaCola", "codigopix", "pix", "qrcode");
    return {
      boletoUrl: String(pick(t, "link", "linkboleto", "link_cobranca") ?? ""),
      pixCopiaECola: String((typeof pix === "object" ? pick(pix, "copiaecola", "copia_cola", "payload", "qrcode") : pix) ?? pick(t, "linhadigitavel", "linha_digitavel") ?? ""),
    };
  }

  async trustUnlock(customerId: string, horas: number): Promise<TrustUnlockResult> {
    // "dias" informa o prazo decidido pela regra; confirmar no SGP da Maxgiga se a rota respeita esse campo
    const r = await this.post("/api/ura/liberacaopromessa/", { contrato: customerId, dias: Math.max(1, Math.round(horas / 24)) });
    const liberado = pick(r, "liberado");
    const msg = pick(r, "msg", "mensagem", "message");
    if ((liberado !== undefined && isFalsy(liberado)) || isFalsy(r.status)) return { ok: false, reason: String(msg ?? "não liberado pelo sistema") };
    const dias = Number(pick(r, "liberado_dias", "liberadoDias", "dias"));
    const until = Number.isFinite(dias) && dias > 0 ? new Date((this.opts.now?.() ?? new Date()).getTime() + dias * 86_400_000).toISOString().slice(0, 10) : undefined;
    return { ok: true, validUntil: until };
  }

  // o SGP não expõe consulta de viabilidade nessas rotas: a equipe confirma a cobertura
  async checkCoverage(): Promise<CoverageResult> {
    return { covered: null, note: "verificação automática indisponível; a equipe confirma a cobertura" };
  }

  async openTicket(customerId: string, reason: string, details: string) {
    const r = await this.post("/api/ura/chamado/", {
      contrato: customerId,
      ocorrenciatipo: this.opts.ocorrenciaTipo ?? 5,
      conteudo: `${reason}\n\n${details}`.slice(0, 4000),
    });
    return { ticketId: String(pick(r, "protocolo", "chamado", "ocorrencia", "os", "ordemservico", "id", "numero") ?? "") };
  }

  // varredura de massivo: todas as ONUs com sinal; sem sinal = offline
  async listConnections(): Promise<ConnectionSnapshot[]> {
    const list = await this.get("/api/fttx/onu/list/");
    return firstArray(list, "results", "onus", "dados", "data")
      .map((onu) => {
        const contrato = pick(onu, "contrato", "contrato_id", "servico_contrato");
        const rx = Number(pick(onu, "info_rx", "rx"));
        return contrato === undefined
          ? null
          : { customerId: String(contrato), area: this.areaFrom(onu), online: Number.isFinite(rx) && rx > (this.opts.sinalMinimoDbm ?? -30) };
      })
      .filter((x): x is ConnectionSnapshot => x !== null);
  }
}
