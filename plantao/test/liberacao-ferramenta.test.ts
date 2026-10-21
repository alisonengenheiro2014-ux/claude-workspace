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

  it("cliente que não está bloqueado: nada a liberar", async () => {
    const ctx = await ctxPara("5511900000001");
    expect(await runTool("desbloqueio_confianca", { dias_pedidos: 2 }, ctx)).toMatchObject({ liberado: false });
  });

  it("desligada na configuração: recusa sem tocar no SGP", async () => {
    const ctx = { ...(await ctxPara("5511900000002")), desbloqueio: false };
    await expect(runTool("desbloqueio_confianca", { dias_pedidos: 2 }, ctx)).rejects.toThrow("após o pagamento");
  });
});
