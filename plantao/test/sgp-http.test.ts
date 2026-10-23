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

  it("busca por telefone usa /api/ura/consultacliente/ com campo telefone", async () => {
    const semResultado = { msg: "CPF/CNPJ ou Contrato ID Não informados", contratos: [] };
    const { sgp, calls } = fakeSgp({
      "/api/ura/consultacliente/": (body) => body.telefone === "11900000003" ? consulta : semResultado,
      "/api/fttx/onu/list/": () => onu,
    });
    expect((await sgp.findCustomer({ phone: "5511900000003" }))?.id).toBe("88");
    expect(calls[0]).toMatchObject({ path: "/api/ura/consultacliente/", body: expect.objectContaining({ telefone: "11900000003" }) });
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
    expect(await sgp.trustUnlock("88", 72)).toEqual({ ok: true, validUntil: "2026-10-24" });
    expect(calls[0].body).toEqual({ app: "plantao", token: "tok", contrato: "88", dias: 3 });
    resposta = { status: 1, liberado: false, msg: "Promessa de pagamento já utilizada" };
    expect(await sgp.trustUnlock("88", 24)).toEqual({ ok: false, reason: "Promessa de pagamento já utilizada" });
  });

  it("perfil para a regra de liberação: tempo de casa, faturas pagas e atrasos", async () => {
    const { sgp, calls } = fakeSgp({
      "/api/ura/consultacliente/": () => ({ contratos: [{ contratoId: 88, contratoStatus: 4, dataCadastro: "15/02/2026" }] }),
      "/api/ura/titulos/": () => ({ titulos: [
        { id: 1, vencimento: "05/09/2026", dataPagamento: "20/09/2026" }, // 15 dias de atraso
        { id: 2, vencimento: "05/08/2026", dataPagamento: "05/08/2026" },
        { id: 3, vencimento: "05/03/2026", dataPagamento: "30/03/2026" }, // atraso, mas há mais de 6 meses
        { id: 4, vencimento: "05/10/2026" }, // em aberto
      ] }),
    });
    const p = await sgp.customerProfile("88");
    expect(p.pagamentos).toEqual([
      { vencimento: "2026-09-05", pagamento: "2026-09-20" },
      { vencimento: "2026-08-05", pagamento: "2026-08-05" },
      { vencimento: "2026-03-05", pagamento: "2026-03-30" },
    ]);
    expect(p.diaVencimento).toBe(5);
    expect(p.clienteDesde?.toISOString().slice(0, 10)).toBe("2026-02-15");
    // o histórico precisa das faturas pagas também, não só das em aberto
    expect(calls.find((c) => c.path === "/api/ura/titulos/")?.body.apenas_titulos_em_aberto).toBeUndefined();
  });

  it("ordens de serviço abertas do contrato (rota testada pela Maxgiga)", async () => {
    const { sgp, calls } = fakeSgp({
      "/api/os/list/": () => [
        { os_id: 501, contrato_id: 88, os_status_txt: "Aberta", os_motivo_descricao: "Sem sinal", os_data_agendamento: "2026-10-22 09:00" },
        { os_id: 502, contrato_id: 88, os_status_txt: "Finalizada", os_data_finalizacao: "2026-10-01" },
        { os_id: 503, contrato_id: 99, os_status_txt: "Aberta" },
      ],
    });
    expect(await sgp.openOrders("88")).toEqual([{ id: "501", status: "Aberta", motivo: "Sem sinal", agendamento: "2026-10-22 09:00" }]);
    expect(calls[0].body).toMatchObject({ app: "plantao", token: "tok", mes: "10", ano: "2026" });
  });

  it("aceita SGP_BASE_URL com /api no fim, como a Maxgiga usa", async () => {
    const calls: string[] = [];
    const fetchFn = (async (input: URL | string) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ status: 1, protocolo: "1" }), { status: 200 });
    }) as typeof fetch;
    const sgp = new HttpSgp({ baseUrl: "https://maxgiga.sgp.tsmx.com.br/api", app: "a", token: "t", fetchFn });
    await sgp.openTicket("88", "x", "y");
    expect(calls[0]).toBe("https://maxgiga.sgp.tsmx.com.br/api/ura/chamado/");
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
