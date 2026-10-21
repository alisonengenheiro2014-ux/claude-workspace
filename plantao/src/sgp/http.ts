// Cliente da API REST do SGP. Os caminhos abaixo são provisórios: serão ajustados
// quando tivermos a documentação e o token do SGP da Maxgiga.
import type { SgpClient } from "./types.js";

export class HttpSgp implements SgpClient {
  constructor(
    private baseUrl: string,
    private token: string,
  ) {
    if (!baseUrl || !token) throw new Error("SGP_BASE_URL e SGP_TOKEN são obrigatórios no modo http");
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(new URL(path, this.baseUrl), {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${this.token}`, ...init.headers },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`SGP ${path} respondeu ${res.status}`);
    return (await res.json()) as T;
  }

  private pending(op: string): never {
    throw new Error(`SGP: operação "${op}" aguardando confirmação dos endpoints`);
  }

  listConnections(): never { return this.pending("listConnections"); }
  findCustomer(): never { return this.pending("findCustomer"); }
  connectionStatus(): never { return this.pending("connectionStatus"); }
  openInvoices(): never { return this.pending("openInvoices"); }
  invoiceCopy(): never { return this.pending("invoiceCopy"); }
  trustUnlock(): never { return this.pending("trustUnlock"); }
  checkCoverage(): never { return this.pending("checkCoverage"); }
  openTicket(): never { return this.pending("openTicket"); }
}
