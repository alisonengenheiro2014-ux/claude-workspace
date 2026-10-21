import { describe, expect, it } from "vitest";
import { HttpSgp, toCents, toIsoDate } from "../src/sgp/http.js";

// SGP falso: responde por rota, no formato das integrações públicas
function fakeSgp(routes: Record<string, (body: any) => unknown>) {
  const calls: { path: string; body: any }[] = [];
  const fetchFn = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : Object.fromEntries(url.searchParams);
    calls.push({ path: url.pathname, body });
    const handler = routes[url.pathname];
    if (!handler) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(handler(body)), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const sgp = new HttpSgp({ baseUrl: "https://sgp.test", app: "plantao", token: "tok", fetchFn, now: () => new Date("2026-10-21T12:00:00Z") });
  return { sgp, calls };
}

const consulta = {
  msg: "ok",
  contratos: [
    { contratoId: 77, contratoStatus: 2, razaoSocial: "Carla Teste", cpfCnpj: "333.333.333-33", planoInternet: "100 Mega", telefones: [] },
    { contratoId: 88, contratoStatus: 1, razaoSocial: "Carla Teste", cpfCnpj: "333.333.333-33", planoInternet: "500 Mega", telefones: [{ contato: "(11) 90000-0003" }] },
  ],
};
const onu = { results: [{ olt_name: "OLT-CENTRO", slot: 1, pon: 4, onuid: 12, info_rx: "-21.5", info_date: "2026-10-21T11:58:00Z" }] };

describe("conversões", () => {
  it("valores e datas nos formatos do SGP", () => {
    expect(toCents("129,90")).toBe(12990);
    expect(toCents("1.299,90")).toBe(129990);
    expect(toCents("129.90")).toBe(12990);
    expect(toCents(99.9)).toBe(9990);
    expect(toIsoDate("10/10/2026")).toBe("2026-10-10");
    expect(toIsoDate("2026-10-10T00:00:00")).toBe("2026-10-10");
  });
});

describe("SGP via API", () => {
  it("busca por CPF: escolhe o contrato ativo, lê telefone e área da ONU, manda app e token no corpo", async () => {
    const { sgp, calls } = fakeSgp({ "/api/ura/consultacliente/": () => consulta, "/api/fttx/onu/list/": () => onu });
    const c = await sgp.findCustomer({ cpf: "333.333.333-33" });
    expect(c).toEqual({
      id: "88", name: "Carla Teste", cpf: "33333333333", phones: ["5511900000003"], plan: "500 Mega",
      area: { pop: "", olt: "OLT-CENTRO", pon: "OLT-CENTRO:1/4" },
    });
    expect(calls[0]).toEqual({ path: "/api/ura/consultacliente/", body: { app: "plantao", token: "tok", cpfcnpj: "33333333333" } });
  });

  it("busca por telefone usa a listagem de clientes (com cache)", async () => {
    const { sgp, calls } = fakeSgp({
      "/api/ura/clientes/": () => ({ clientes: [{ nome: "Outro", cpfcnpj: "111", telefones: ["11999990000"] }, { nome: "Carla", cpfcnpj: "333.333.333-33", telefones: [{ contato: "11 90000-0003" }] }] }),
      "/api/ura/consultacliente/": () => consulta,
      "/api/fttx/onu/list/": () => onu,
    });
    expect((await sgp.findCustomer({ phone: "5511900000003" }))?.id).toBe("88");
    await sgp.findCustomer({ phone: "5511900000003" });
    expect(calls.filter((c) => c.path === "/api/ura/clientes/")).toHaveLength(1);
    expect(await sgp.findCustomer({ phone: "5521988887777" })).toBeNull();
  });

  it("status: sinal bom = online; contrato suspenso = bloqueado", async () => {
    const { sgp } = fakeSgp({
      "/api/ura/consultacliente/": () => ({ contratos: [{ contratoId: 88, contratoStatus: 4 }] }),
      "/api/fttx/onu/list/": () => onu,
    });
    expect(await sgp.connectionStatus("88")).toMatchObject({ state: "online", suspended: true });
  });

  it("status: ONU sem sinal = offline", async () => {
    const { sgp } = fakeSgp({
      "/api/ura/consultacliente/": () => ({ contratos: [{ contratoId: 88, contratoStatus: 1 }] }),
      "/api/fttx/onu/list/": () => ({ results: [{ olt_name: "O", slot: 1, pon: 1, info_rx: null }] }),
    });
    expect((await sgp.connectionStatus("88")).state).toBe("offline");
  });

  it("faturas em aberto e segunda via", async () => {
    const titulos = {
      titulos: [
        { id: 501, vencimento: "05/10/2026", valor: "99,90", linhadigitavel: "23790.00000", link: "https://sgp.test/boleto/501", pix_copia_cola: "000201PIX501" },
        { id: 502, vencimento: "05/11/2026", valorTotal: "99,90", link: "https://sgp.test/boleto/502" },
        { id: 400, vencimento: "05/09/2026", valor: "99,90", dataPagamento: "04/09/2026" },
      ],
    };
    const { sgp, calls } = fakeSgp({ "/api/ura/titulos/": () => titulos });
    expect(await sgp.openInvoices("88")).toEqual([
      { id: "501", dueDate: "2026-10-05", amountCents: 9990, status: "vencida" },
      { id: "502", dueDate: "2026-11-05", amountCents: 9990, status: "aberta" },
    ]);
    expect(calls[0].body).toMatchObject({ contrato: "88", apenas_titulos_em_aberto: 1 });
    expect(await sgp.invoiceCopy("88", "501")).toEqual({ boletoUrl: "https://sgp.test/boleto/501", pixCopiaECola: "000201PIX501" });
    expect(await sgp.invoiceCopy("88", "502")).toEqual({ boletoUrl: "https://sgp.test/boleto/502", pixCopiaECola: "" });
    await expect(sgp.invoiceCopy("88", "999")).rejects.toThrow("não pertence");
  });

  it("desbloqueio de confiança: liberado e recusado", async () => {
    let resposta: any = { status: 1, liberado: true, liberado_dias: 3, protocolo: "123" };
    const { sgp, calls } = fakeSgp({ "/api/ura/liberacaopromessa/": () => resposta });
    expect(await sgp.trustUnlock("88")).toEqual({ ok: true, validUntil: "2026-10-24" });
    expect(calls[0].body).toEqual({ app: "plantao", token: "tok", contrato: "88" });
    resposta = { status: 1, liberado: false, msg: "Promessa de pagamento já utilizada" };
    expect(await sgp.trustUnlock("88")).toEqual({ ok: false, reason: "Promessa de pagamento já utilizada" });
  });

  it("chamado devolve o protocolo", async () => {
    const { sgp, calls } = fakeSgp({ "/api/ura/chamado/": () => ({ status: 1, protocolo: "20261021-0042" }) });
    expect(await sgp.openTicket("88", "LOS vermelho", "foto da ONU")).toEqual({ ticketId: "20261021-0042" });
    expect(calls[0].body).toMatchObject({ contrato: "88", ocorrenciatipo: 5, conteudo: "LOS vermelho\n\nfoto da ONU" });
  });

  it("varredura lê todas as ONUs: sem sinal = offline, sem contrato = ignorada", async () => {
    const { sgp } = fakeSgp({
      "/api/fttx/onu/list/": () => ({ results: [
        { contrato: 1, olt_name: "O1", slot: 1, pon: 2, info_rx: "-19" },
        { contrato: 2, olt_name: "O1", slot: 1, pon: 2, info_rx: "-40" },
        { olt_name: "O1", slot: 1, pon: 2, info_rx: "-20" },
      ] }),
    });
    expect(await sgp.listConnections()).toEqual([
      { customerId: "1", area: { pop: "", olt: "O1", pon: "O1:1/2" }, online: true },
      { customerId: "2", area: { pop: "", olt: "O1", pon: "O1:1/2" }, online: false },
    ]);
  });

  it("erro HTTP e credencial errada viram erro", async () => {
    const { sgp } = fakeSgp({});
    await expect(sgp.openTicket("88", "x", "y")).rejects.toThrow("404");
    const bad = fakeSgp({ "/api/ura/chamado/": () => ({ status: 0, erro: "Credenciais inválidas" }) });
    await expect(bad.sgp.openTicket("88", "x", "y")).rejects.toThrow("Credenciais inválidas");
  });
});
