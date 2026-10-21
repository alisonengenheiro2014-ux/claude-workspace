// Os exemplos que a Maxgiga descreveu, um por teste.
import { describe, expect, it } from "vitest";
import { decidirLiberacao, type PerfilCliente } from "../src/policy/liberacao.js";

const agora = new Date("2026-10-21T22:00:00-03:00");
const mesesAtras = (m: number) => new Date(agora.getTime() - m * 30 * 86_400_000);
const perfil = (meses: number, faturasPagas: number, atrasosRecentes = 0): PerfilCliente => ({
  clienteDesde: mesesAtras(meses), faturasPagas, atrasosRecentes,
});

describe("liberação de confiança", () => {
  it("cliente novo, nenhuma fatura paga, primeira vez: no máximo 24h, mesmo pedindo 5 dias", () => {
    expect(decidirLiberacao(perfil(1, 0), 0, agora, 120)).toMatchObject({ permitido: true, horas: 24, regra: "cliente_novo" });
  });

  it("cliente novo pedindo de novo no mês: não libera, vai para a equipe", () => {
    expect(decidirLiberacao(perfil(1, 0), 1, agora, 24)).toMatchObject({ permitido: false, regra: "novo_reincidente" });
  });

  it("cliente com 1 a 2 meses que já pagou: 24h", () => {
    expect(decidirLiberacao(perfil(2, 1), 0, agora, null)).toMatchObject({ permitido: true, horas: 24, regra: "cliente_recente" });
  });

  it("cliente com 3 a 4 meses: até 48h", () => {
    expect(decidirLiberacao(perfil(3.5, 3), 0, agora, null)).toMatchObject({ permitido: true, horas: 48, regra: "cliente_intermediario" });
    expect(decidirLiberacao(perfil(4, 4), 0, agora, 120)).toMatchObject({ horas: 48 });
  });

  it("cliente com 6 meses ou mais, pagando em dia: até 5 dias", () => {
    expect(decidirLiberacao(perfil(8, 8), 0, agora, 120)).toMatchObject({ permitido: true, horas: 120, regra: "cliente_antigo_em_dia" });
  });

  it("libera o que o cliente pediu quando é menos que o máximo (arredondando para dias)", () => {
    expect(decidirLiberacao(perfil(8, 8), 0, agora, 72)).toMatchObject({ horas: 72, maxHoras: 120 });
    expect(decidirLiberacao(perfil(8, 8), 0, agora, 30)).toMatchObject({ horas: 48 });
  });

  it("cliente antigo que atrasa bastante: cai para 48h", () => {
    expect(decidirLiberacao(perfil(10, 10, 3), 0, agora, 120)).toMatchObject({ horas: 48, regra: "cliente_antigo_com_atrasos" });
  });

  it("dia 1 liberou 5 dias, dia 25 pede de novo: no máximo 24h", () => {
    expect(decidirLiberacao(perfil(12, 12), 1, agora, 120)).toMatchObject({ permitido: true, horas: 24, regra: "segunda_no_mes" });
  });

  it("terceira vez em 30 dias: não libera", () => {
    expect(decidirLiberacao(perfil(12, 12), 2, agora, 24)).toMatchObject({ permitido: false, regra: "limite_mensal" });
  });

  it("sem data de início do contrato: trata como cliente recente (o mais seguro)", () => {
    expect(decidirLiberacao({ clienteDesde: null, faturasPagas: 5, atrasosRecentes: 0 }, 0, agora, 120)).toMatchObject({ horas: 24 });
  });
});
