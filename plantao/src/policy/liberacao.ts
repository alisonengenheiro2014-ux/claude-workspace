// Regra de liberação de confiança da Maxgiga. Decisão do sistema, não da IA: a IA só conversa
// e informa o prazo que esta função devolver.

export interface PerfilCliente {
  clienteDesde: Date | null; // início do contrato; desconhecido = tratado como cliente novo
  faturasPagas: number; // total de faturas já pagas
  atrasosRecentes: number; // faturas pagas com atraso nos últimos 6 meses
}

export interface RegrasLiberacao {
  horasClienteNovo: number; // sem nenhuma fatura paga, ou menos de mesesIntermediario de casa
  mesesIntermediario: number; // a partir daqui, até horasIntermediario
  horasIntermediario: number;
  mesesAntigo: number; // a partir daqui, e pagando em dia, até diasAntigo
  diasAntigo: number;
  atrasosToleradosAntigo: number; // acima disso, o cliente antigo cai para o prazo intermediário
  horasSegundaNoMes: number; // segunda liberação dentro de 30 dias
  maxPorMes: number; // a partir daqui, nega e passa para a equipe
}

export const REGRAS_PADRAO: RegrasLiberacao = {
  horasClienteNovo: 24,
  mesesIntermediario: 3,
  horasIntermediario: 48,
  mesesAntigo: 6,
  diasAntigo: 5,
  atrasosToleradosAntigo: 1,
  horasSegundaNoMes: 24,
  maxPorMes: 2,
};

export type Decisao =
  | { permitido: true; horas: number; maxHoras: number; regra: string }
  | { permitido: false; motivo: string; regra: string };

const MES_MS = 30 * 86_400_000;

export function mesesDeCasa(desde: Date | null, agora: Date): number {
  if (!desde) return 0;
  return Math.max(0, (agora.getTime() - desde.getTime()) / MES_MS);
}

export function decidirLiberacao(
  perfil: PerfilCliente,
  liberacoesUltimos30Dias: number,
  agora: Date,
  pedidoHoras: number | null,
  regras: RegrasLiberacao = REGRAS_PADRAO,
): Decisao {
  const meses = mesesDeCasa(perfil.clienteDesde, agora);

  if (liberacoesUltimos30Dias >= regras.maxPorMes) {
    return { permitido: false, motivo: `já teve ${liberacoesUltimos30Dias} liberações nos últimos 30 dias`, regra: "limite_mensal" };
  }
  // cliente que nunca pagou: só a primeira vez, e no máximo o prazo de cliente novo
  if (perfil.faturasPagas === 0) {
    if (liberacoesUltimos30Dias > 0) return { permitido: false, motivo: "cliente sem nenhuma fatura paga e já teve uma liberação", regra: "novo_reincidente" };
    return conceder(regras.horasClienteNovo, pedidoHoras, "cliente_novo");
  }

  let maxHoras: number;
  let regra: string;
  if (meses >= regras.mesesAntigo && perfil.atrasosRecentes <= regras.atrasosToleradosAntigo) {
    maxHoras = regras.diasAntigo * 24;
    regra = "cliente_antigo_em_dia";
  } else if (meses >= regras.mesesIntermediario) {
    maxHoras = regras.horasIntermediario;
    regra = meses >= regras.mesesAntigo ? "cliente_antigo_com_atrasos" : "cliente_intermediario";
  } else {
    maxHoras = regras.horasClienteNovo;
    regra = "cliente_recente";
  }

  // segunda liberação dentro do mês: no máximo 24h, para qualquer perfil
  if (liberacoesUltimos30Dias > 0) {
    maxHoras = Math.min(maxHoras, regras.horasSegundaNoMes);
    regra = "segunda_no_mes";
  }
  return conceder(maxHoras, pedidoHoras, regra);
}

function conceder(maxHoras: number, pedidoHoras: number | null, regra: string): Decisao {
  const pedido = pedidoHoras && pedidoHoras > 0 ? pedidoHoras : maxHoras;
  // o SGP libera em dias inteiros: arredonda o pedido para cima em blocos de 24h, sem passar do máximo
  const horas = Math.min(maxHoras, Math.ceil(pedido / 24) * 24);
  return { permitido: true, horas, maxHoras, regra };
}
