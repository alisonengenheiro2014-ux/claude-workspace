// Os exemplos que a Maxgiga descreveu, um por teste.
import { describe, expect, it } from "vitest";
import { decidirLiberacao, inicioDoCiclo, pagaEmDia, type Pagamento, type PerfilCliente } from "../src/policy/liberacao.js";

const agora = new Date("2026-10-21T22:00:00-03:00");
const mesesAtras = (m: number) => new Date(agora.getTime() - m * 30 * 86_400_000);
// n faturas mensais vencendo dia 10, pagas com "atraso" dias de diferença (negativo = adiantado)
const pagamentos = (n: number, atraso = 0): Pagamento[] =>
  Array.from({ length: n }, (_, i) => {
    const venc = new Date(Date.UTC(2026, 8 - i, 10));
    const pago = new Date(venc.getTime() + atraso * 86_400_000);
    return { vencimento: venc.toISOString().slice(0, 10), pagamento: pago.toISOString().slice(0, 10) };
  });
const perfil = (meses: number, pags: Pagamento[]): PerfilCliente => ({ clienteDesde: mesesAtras(meses), pagamentos: pags, diaVencimento: 10 });

describe("pagando em dia", () => {
  it("pagou antes, no dia ou até 2 dias depois: em dia", () => {
    expect(pagaEmDia(pagamentos(4, -3))).toBe(true);
    expect(pagaEmDia(pagamentos(4, 0))).toBe(true);
    expect(pagaEmDia(pagamentos(4, 2))).toBe(true);
  });

  it("3 dias ou mais de atraso: não está em dia", () => {
    expect(pagaEmDia(pagamentos(4, 3))).toBe(false);
  });

  it("um único atraso grande entre as últimas faturas já tira do em dia", () => {
    const p = pagamentos(5, 0);
    p[1] = { ...p[1], pagamento: "2026-08-20" }; // venceu 10/08, pagou 20/08
    expect(pagaEmDia(p)).toBe(false);
  });

  it("menos de 3 faturas pagas: não dá para afirmar que está em dia", () => {
    expect(pagaEmDia(pagamentos(2, 0))).toBe(false);
  });
});

describe("ciclo de vencimento", () => {
  it("vence dia 10: em 21/10 o ciclo começou em 10/10", () => {
    expect(inicioDoCiclo(10, agora).toISOString()).toBe("2026-10-10T03:00:00.000Z");
  });
  it("vence dia 25: em 21/10 o ciclo começou em 25/09", () => {
    expect(inicioDoCiclo(25, agora).toISOString()).toBe("2026-09-25T03:00:00.000Z");
  });
  it("vence dia 31 em mês curto: usa o último dia do mês", () => {
    expect(inicioDoCiclo(31, new Date("2026-03-05T12:00:00-03:00")).toISOString()).toBe("2026-02-28T03:00:00.000Z");
  });
  it("sem dia de vencimento conhecido: últimos 30 dias", () => {
    expect(inicioDoCiclo(null, agora).getTime()).toBe(agora.getTime() - 30 * 86_400_000);
  });
});

describe("liberação de confiança", () => {
  it("cliente novo, nenhuma fatura paga, primeira vez: no máximo 24h, mesmo pedindo 5 dias", () => {
    expect(decidirLiberacao(perfil(1, []), 0, agora, 120)).toMatchObject({ permitido: true, horas: 24, regra: "cliente_novo" });
  });

  it("cliente novo pedindo de novo no ciclo: não libera, vai para a equipe", () => {
    expect(decidirLiberacao(perfil(1, []), 1, agora, 24)).toMatchObject({ permitido: false, regra: "novo_reincidente" });
  });

  it("de 1 a 3 meses, já pagou: 24h", () => {
    expect(decidirLiberacao(perfil(2, pagamentos(1)), 0, agora, 72)).toMatchObject({ permitido: true, horas: 24, maxHoras: 24, regra: "cliente_recente" });
  });

  it("de 3 a 6 meses: até 48h", () => {
    expect(decidirLiberacao(perfil(3.5, pagamentos(3)), 0, agora, null)).toMatchObject({ permitido: true, horas: 48, regra: "cliente_intermediario" });
    expect(decidirLiberacao(perfil(4, pagamentos(4)), 0, agora, 120)).toMatchObject({ horas: 48 });
  });

  it("6 meses ou mais, pagando em dia: até 5 dias", () => {
    expect(decidirLiberacao(perfil(8, pagamentos(7, 1)), 0, agora, 120)).toMatchObject({ permitido: true, horas: 120, regra: "cliente_antigo_em_dia" });
  });

  it("libera o que o cliente pediu quando é menos que o máximo (arredondando para dias)", () => {
    expect(decidirLiberacao(perfil(8, pagamentos(7)), 0, agora, 72)).toMatchObject({ horas: 72, maxHoras: 120 });
    expect(decidirLiberacao(perfil(8, pagamentos(7)), 0, agora, 30)).toMatchObject({ horas: 48 });
  });

  it("6 meses ou mais, mas pagando com atraso: cai para 48h", () => {
    expect(decidirLiberacao(perfil(10, pagamentos(10, 5)), 0, agora, 120)).toMatchObject({ horas: 48, regra: "cliente_antigo_com_atrasos" });
  });

  it("dia 1 liberou 5 dias, dia 25 pede de novo no mesmo ciclo: no máximo 24h", () => {
    expect(decidirLiberacao(perfil(12, pagamentos(12)), 1, agora, 120)).toMatchObject({ permitido: true, horas: 24, regra: "segunda_no_ciclo" });
  });

  it("terceira vez no mesmo ciclo: não libera", () => {
    expect(decidirLiberacao(perfil(12, pagamentos(12)), 2, agora, 24)).toMatchObject({ permitido: false, regra: "limite_do_ciclo" });
  });

  it("sem data de início do contrato: trata como cliente recente (o mais seguro)", () => {
    expect(decidirLiberacao({ clienteDesde: null, pagamentos: pagamentos(5), diaVencimento: 10 }, 0, agora, 120)).toMatchObject({ horas: 24 });
  });
});
