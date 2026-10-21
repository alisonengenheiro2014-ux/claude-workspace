// Regra de liberação de confiança da Maxgiga. Decisão do sistema, não da IA: a IA só conversa
// e informa o prazo que esta função devolver.

export interface Pagamento {
  vencimento: string; // AAAA-MM-DD
  pagamento: string; // AAAA-MM-DD
}

export interface PerfilCliente {
  clienteDesde: Date | null; // início do contrato; desconhecido = tratado como cliente recente
  pagamentos: Pagamento[]; // faturas já pagas
  diaVencimento: number | null; // dia do mês em que vencem as faturas (define o ciclo de 30 dias)
}

export interface RegrasLiberacao {
  horasClienteNovo: number; // sem nenhuma fatura paga, ou menos de mesesIntermediario de casa
  mesesIntermediario: number; // a partir daqui, até horasIntermediario
  horasIntermediario: number;
  mesesAntigo: number; // a partir daqui, e pagando em dia, até diasAntigo
  diasAntigo: number;
  diasTolerancia: number; // pagar até X dias depois do vencimento ainda conta como em dia
  minFaturasAnalise: number; // "em dia" só vale com pelo menos esse número de faturas pagas analisadas
  horasSegundaNoCiclo: number; // segunda liberação no mesmo ciclo de vencimento
  maxPorCiclo: number; // a partir daqui, nega e passa para a equipe
}

export const REGRAS_PADRAO: RegrasLiberacao = {
  horasClienteNovo: 24,
  mesesIntermediario: 3,
  horasIntermediario: 48,
  mesesAntigo: 6,
  diasAntigo: 5,
  diasTolerancia: 2,
  minFaturasAnalise: 3,
  horasSegundaNoCiclo: 24,
  maxPorCiclo: 2,
};

export type Decisao =
  | { permitido: true; horas: number; maxHoras: number; regra: string }
  | { permitido: false; motivo: string; regra: string };

const DIA_MS = 86_400_000;
const MES_MS = 30 * DIA_MS;

export function mesesDeCasa(desde: Date | null, agora: Date): number {
  if (!desde) return 0;
  return Math.max(0, (agora.getTime() - desde.getTime()) / MES_MS);
}

// Em dia: as últimas faturas pagas (no mínimo minFaturasAnalise, até 6) foram pagas até o vencimento
// ou no máximo diasTolerancia dias depois.
export function pagaEmDia(pagamentos: Pagamento[], regras: RegrasLiberacao = REGRAS_PADRAO): boolean {
  const ultimas = [...pagamentos].sort((a, b) => b.vencimento.localeCompare(a.vencimento)).slice(0, 6);
  if (ultimas.length < regras.minFaturasAnalise) return false;
  return ultimas.every((p) => (Date.parse(p.pagamento) - Date.parse(p.vencimento)) / DIA_MS <= regras.diasTolerancia);
}

// Início do ciclo atual: o último dia de vencimento até hoje (no fuso de São Paulo).
// Sem dia de vencimento conhecido, usa os últimos 30 dias.
export function inicioDoCiclo(diaVencimento: number | null, agora: Date): Date {
  if (!diaVencimento) return new Date(agora.getTime() - MES_MS);
  const sp = new Date(agora.getTime() - 3 * 3_600_000); // Brasil sem horário de verão: UTC-3
  let ano = sp.getUTCFullYear();
  let mes = sp.getUTCMonth();
  const diaNoMes = (a: number, m: number) => Math.min(diaVencimento, new Date(Date.UTC(a, m + 1, 0)).getUTCDate());
  if (sp.getUTCDate() < diaNoMes(ano, mes)) {
    mes -= 1;
    if (mes < 0) { mes = 11; ano -= 1; }
  }
  return new Date(Date.UTC(ano, mes, diaNoMes(ano, mes), 3)); // 00:00 em São Paulo
}

export function decidirLiberacao(
  perfil: PerfilCliente,
  liberacoesNoCiclo: number,
  agora: Date,
  pedidoHoras: number | null,
  regras: RegrasLiberacao = REGRAS_PADRAO,
): Decisao {
  const meses = mesesDeCasa(perfil.clienteDesde, agora);

  if (liberacoesNoCiclo >= regras.maxPorCiclo) {
    return { permitido: false, motivo: `já teve ${liberacoesNoCiclo} liberações neste ciclo de vencimento`, regra: "limite_do_ciclo" };
  }
  // cliente que nunca pagou: só a primeira vez, e no máximo o prazo de cliente novo
  if (perfil.pagamentos.length === 0) {
    if (liberacoesNoCiclo > 0) return { permitido: false, motivo: "cliente sem nenhuma fatura paga e já teve uma liberação", regra: "novo_reincidente" };
    return conceder(regras.horasClienteNovo, pedidoHoras, "cliente_novo");
  }

  let maxHoras: number;
  let regra: string;
  if (meses >= regras.mesesAntigo && pagaEmDia(perfil.pagamentos, regras)) {
    maxHoras = regras.diasAntigo * 24;
    regra = "cliente_antigo_em_dia";
  } else if (meses >= regras.mesesIntermediario) {
    maxHoras = regras.horasIntermediario;
    regra = meses >= regras.mesesAntigo ? "cliente_antigo_com_atrasos" : "cliente_intermediario";
  } else {
    maxHoras = regras.horasClienteNovo;
    regra = "cliente_recente";
  }

  // segunda liberação no mesmo ciclo: no máximo 24h, para qualquer perfil
  if (liberacoesNoCiclo > 0) {
    maxHoras = Math.min(maxHoras, regras.horasSegundaNoCiclo);
    regra = "segunda_no_ciclo";
  }
  return conceder(maxHoras, pedidoHoras, regra);
}

function conceder(maxHoras: number, pedidoHoras: number | null, regra: string): Decisao {
  const pedido = pedidoHoras && pedidoHoras > 0 ? pedidoHoras : maxHoras;
  // o SGP libera em dias inteiros: arredonda o pedido para cima em blocos de 24h, sem passar do máximo
  const horas = Math.min(maxHoras, Math.ceil(pedido / 24) * 24);
  return { permitido: true, horas, maxHoras, regra };
}
