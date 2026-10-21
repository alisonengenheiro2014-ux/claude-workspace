// A ferramenta de liberação aplicando a regra, com o SGP simulado.
import { describe, expect, it } from "vitest";
import { runTool, type ToolContext } from "../src/agent/tools.js";
import { MockSgp } from "../src/sgp/mock.js";
import { MemoryStore } from "../src/store/memory.js";

async function ctxPara(phone: string, store = new MemoryStore(), sgp = new MockSgp()): Promise<ToolContext> {
  const contact = await store.upsertContact(phone);
  return {
    store, sgp, contact, knowledge: [], desbloqueio: true,
    conversation: await store.openConversation(contact.id, "meta", "n"),
    customer: await sgp.findCustomer({ phone }),
  };
}

describe("ferramenta de liberação de confiança", () => {
  it("cliente antigo em dia pede 6 dias: libera 5 e avisa que pediu mais que o possível", async () => {
    const ctx = await ctxPara("5511900000002"); // Bruno: 8 meses, 7 faturas pagas, sem atraso
    const r: any = await runTool("desbloqueio_confianca", { dias_pedidos: 6 }, ctx);
    expect(r).toMatchObject({ liberado: true, prazo_liberado: "5 dia(s)", pediu_mais_que_o_possivel: true });
    expect(r.orientacao).toContain("não encerre");
    expect((ctx.store as MemoryStore).unlocks).toMatchObject([{ sgpCustomerId: "1002", hours: 120, rule: "cliente_antigo_em_dia" }]);
  });

  it("cliente novo que nunca pagou pede 5 dias: libera só 24h", async () => {
    const ctx = await ctxPara("5511900000004"); // Diego: 1 mês, nenhuma fatura paga
    const r: any = await runTool("desbloqueio_confianca", { dias_pedidos: 5 }, ctx);
    expect(r).toMatchObject({ liberado: true, prazo_liberado: "1 dia(s)", pediu_mais_que_o_possivel: true });
  });

  it("dia 1 liberou 5 dias, dia 25 pede de novo: 24h; terceira vez: não libera", async () => {
    const store = new MemoryStore();
    const sgp = new MockSgp();
    const ctx = await ctxPara("5511900000002", store, sgp);
    await runTool("desbloqueio_confianca", { dias_pedidos: 5 }, ctx);
    // volta a ficar bloqueado e pede de novo
    (sgp as any).records.find((r: any) => r.customer.id === "1002").status.suspended = true;
    const segunda: any = await runTool("desbloqueio_confianca", { dias_pedidos: 5 }, ctx);
    expect(segunda).toMatchObject({ liberado: true, prazo_liberado: "1 dia(s)" });
    (sgp as any).records.find((r: any) => r.customer.id === "1002").status.suspended = true;
    const terceira: any = await runTool("desbloqueio_confianca", { dias_pedidos: 1 }, ctx);
    expect(terceira.liberado).toBe(false);
    expect(terceira.orientacao).toContain("pendência");
    expect(store.unlocks).toHaveLength(2);
  });

  it("pediu dentro do prazo: sem orientação extra", async () => {
    const r: any = await runTool("desbloqueio_confianca", { dias_pedidos: 3 }, await ctxPara("5511900000002"));
    expect(r).toMatchObject({ liberado: true, prazo_liberado: "3 dia(s)", pediu_mais_que_o_possivel: false });
    expect(r.orientacao).toBeUndefined();
  });

  it("cliente que não está bloqueado: nada a liberar", async () => {
    const ctx = await ctxPara("5511900000001");
    expect(await runTool("desbloqueio_confianca", { dias_pedidos: 2 }, ctx)).toMatchObject({ liberado: false });
  });

  it("desligada na configuração: recusa sem tocar no SGP", async () => {
    const ctx = { ...(await ctxPara("5511900000002")), desbloqueio: false };
    await expect(runTool("desbloqueio_confianca", { dias_pedidos: 2 }, ctx)).rejects.toThrow("após o pagamento");
  });

  it("chamado técnico com OS já aberta: não abre outra e informa o agendamento", async () => {
    const sgp = new MockSgp();
    (sgp as any).records.find((r: any) => r.customer.id === "1003").ordens = [{ id: "OS-77", status: "Aberta", motivo: "Sem sinal", agendamento: "2026-10-22 09:00" }];
    const ctx = await ctxPara("5511900000003", new MemoryStore(), sgp);
    const r: any = await runTool("registrar_pendencia", { tipo: "chamado_tecnico", prioridade: 1, resumo: "LOS", detalhes: "LOS vermelho" }, ctx);
    expect(r.os_ja_aberta).toMatchObject({ id: "OS-77", agendamento: "2026-10-22 09:00" });
    expect((await ctx.store.listPending())[0].sgpTicketId).toBe("OS-77");
  });
});
