// Ferramentas que o agente pode chamar. O cliente fica preso à conversa: o modelo nunca escolhe
// de quem são os dados, só pede "o cliente desta conversa".
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { SgpClient, SgpCustomer } from "../sgp/types.js";
import type { Contact, Conversation, Store } from "../store/types.js";
import { decidirLiberacao, inicioDoCiclo, REGRAS_PADRAO, type RegrasLiberacao } from "../policy/liberacao.js";
import { searchKnowledge, type KnowledgeItem } from "./knowledge.js";

export interface ToolContext {
  store: Store;
  sgp: SgpClient;
  contact: Contact;
  conversation: Conversation;
  knowledge: KnowledgeItem[];
  customer: SgpCustomer | null; // preenchido por identificar_cliente
  desbloqueio?: boolean; // liberação de confiança ligada? (o prazo é decidido pela regra, não pela IA)
  regras?: RegrasLiberacao;
  now?: Date;
}

const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
});

export const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: "identificar_cliente",
    description:
      "Identifica o cliente no sistema do provedor pelo telefone desta conversa ou pelo CPF do titular. Chame antes de qualquer consulta de conta. Passe cpf vazio para tentar pelo telefone.",
    input_schema: obj({ cpf: { type: "string", description: "CPF do titular, só números, ou vazio" } }, ["cpf"]),
  },
  {
    name: "status_conexao",
    description: "Mostra se a conexão do cliente identificado está online ou offline e se está bloqueada por débito.",
    input_schema: obj({}, []),
  },
  {
    name: "verificar_massivo",
    description: "Verifica se há queda em massa (massivo) aberta na região do cliente identificado.",
    input_schema: obj({}, []),
  },
  {
    name: "faturas_em_aberto",
    description: "Lista as faturas em aberto ou vencidas do cliente identificado.",
    input_schema: obj({}, []),
  },
  {
    name: "segunda_via",
    description: "Gera a segunda via (link do boleto e PIX copia-e-cola) de uma fatura do cliente identificado.",
    input_schema: obj({ fatura_id: { type: "string" } }, ["fatura_id"]),
  },
  {
    name: "desbloqueio_confianca",
    description:
      "Pede a liberação de confiança para o cliente identificado que está bloqueado por débito. O sistema aplica as regras da empresa e devolve o prazo liberado (pode ser menor que o pedido) ou a recusa.",
    input_schema: obj(
      { dias_pedidos: { type: "integer", description: "Quantos dias o cliente pediu; 0 se não disse" } },
      ["dias_pedidos"],
    ),
  },
  {
    name: "verificar_cobertura",
    description: "Verifica se há cobertura de fibra num endereço, para quem quer contratar.",
    input_schema: obj({ cep: { type: "string" }, numero: { type: "string" } }, ["cep", "numero"]),
  },
  {
    name: "registrar_pendencia",
    description:
      "Registra um item para a equipe tratar quando voltar. Para chamado técnico, também abre o chamado no sistema. Prioridade 1 = urgente (LOS, cliente muito irritado), 2 = normal, 3 = pode esperar.",
    input_schema: obj(
      {
        tipo: { type: "string", enum: ["chamado_tecnico", "pre_venda", "conferir_pagamento", "cancelamento", "outro"] },
        prioridade: { type: "integer", enum: [1, 2, 3] },
        resumo: { type: "string", description: "Uma ou duas frases para a equipe entender sem ler a conversa toda" },
        detalhes: { type: "string", description: "Dados coletados: nome, endereço, melhor horário, luzes da ONU, etc." },
      },
      ["tipo", "prioridade", "resumo", "detalhes"],
    ),
  },
  {
    name: "finalizar_atendimento",
    description: "Encerra o atendimento depois que o cliente confirmou que está tudo resolvido. Chame junto com a mensagem de despedida.",
    input_schema: obj({ resumo: { type: "string", description: "Uma frase sobre como terminou" } }, ["resumo"]),
  },
  {
    name: "consultar_base",
    description: "Busca na base de conhecimento do provedor: planos, preços, cobertura, perguntas frequentes, luzes da ONU.",
    input_schema: obj({ assunto: { type: "string" } }, ["assunto"]),
  },
].map((t) => ({ ...t, strict: true }));

// sem desbloqueio de confiança, a ferramenta nem é oferecida ao modelo
export function toolDefs(opts: { desbloqueio: boolean }): Anthropic.Tool[] {
  return TOOL_DEFS.filter((t) => opts.desbloqueio || t.name !== "desbloqueio_confianca");
}

const needCustomer = (ctx: ToolContext) => {
  if (!ctx.customer) throw new ToolError("cliente ainda não identificado: chame identificar_cliente antes");
  return ctx.customer;
};

export class ToolError extends Error {}

const SegundaVia = z.object({ fatura_id: z.string().min(1) });
const Cobertura = z.object({ cep: z.string().min(5), numero: z.string() });
const Pendencia = z.object({
  tipo: z.enum(["chamado_tecnico", "pre_venda", "conferir_pagamento", "cancelamento", "outro"]),
  prioridade: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  resumo: z.string().min(1),
  detalhes: z.string(),
});
const Identificar = z.object({ cpf: z.string() });
const Assunto = z.object({ assunto: z.string() });
const DiasPedidos = z.object({ dias_pedidos: z.number().int().min(0).max(60) });

export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<unknown> {
  switch (name) {
    case "identificar_cliente": {
      const { cpf } = Identificar.parse(input);
      const found = await ctx.sgp.findCustomer(cpf.trim() ? { cpf } : { phone: ctx.contact.phone });
      if (!found) return { encontrado: false, dica: cpf ? "CPF não encontrado" : "telefone não cadastrado: peça o CPF do titular" };
      ctx.customer = found;
      await ctx.store.updateContact(ctx.contact.id, { name: found.name, cpf: found.cpf, sgpCustomerId: found.id, kind: "cliente" });
      return { encontrado: true, nome: found.name, plano: found.plan };
    }
    case "status_conexao": {
      const c = needCustomer(ctx);
      const s = await ctx.sgp.connectionStatus(c.id);
      return { conexao: s.state, bloqueado_por_debito: s.suspended, desde: s.since };
    }
    case "verificar_massivo": {
      const c = needCustomer(ctx);
      const inc = await ctx.store.openIncidentForArea(c.area);
      if (!inc) return { massivo: false };
      await ctx.store.linkIncidentContact(inc.id, ctx.contact.id);
      await ctx.store.updateConversation(ctx.conversation.id, { topic: "massivo", incidentId: inc.id });
      return { massivo: true, mensagem: inc.message, previsao: inc.eta?.toISOString() ?? null };
    }
    case "faturas_em_aberto": {
      const c = needCustomer(ctx);
      const invoices = await ctx.sgp.openInvoices(c.id);
      await ctx.store.updateConversation(ctx.conversation.id, { topic: "financeiro" });
      return invoices.map((i) => ({
        fatura_id: i.id, vencimento: i.dueDate, valor: (i.amountCents / 100).toFixed(2), situacao: i.status,
      }));
    }
    case "segunda_via": {
      const c = needCustomer(ctx);
      const { fatura_id } = SegundaVia.parse(input);
      const copy = await ctx.sgp.invoiceCopy(c.id, fatura_id);
      return { boleto: copy.boletoUrl, pix_copia_e_cola: copy.pixCopiaECola };
    }
    case "desbloqueio_confianca": {
      if (!ctx.desbloqueio) throw new ToolError("desbloqueio não permitido: a liberação só acontece após o pagamento");
      const c = needCustomer(ctx);
      const { dias_pedidos } = DiasPedidos.parse(input);
      const status = await ctx.sgp.connectionStatus(c.id);
      if (!status.suspended) return { liberado: false, motivo: "o cliente não está bloqueado por débito" };

      const agora = ctx.now ?? new Date();
      const perfil = await ctx.sgp.customerProfile(c.id);
      // o "mês" é o ciclo de vencimento da fatura do cliente
      const noCiclo = await ctx.store.countUnlocksSince(c.id, inicioDoCiclo(perfil.diaVencimento, agora));
      const decisao = decidirLiberacao(perfil, noCiclo, agora, dias_pedidos > 0 ? dias_pedidos * 24 : null, ctx.regras ?? REGRAS_PADRAO);
      if (!decisao.permitido) {
        return {
          liberado: false,
          orientacao: "Não é possível liberar agora. Explique com gentileza, sem citar o motivo interno, envie a segunda via e registre uma pendência 'outro' (prioridade 2) para a equipe analisar.",
          motivo_interno_para_a_pendencia: decisao.motivo,
        };
      }
      const r = await ctx.sgp.trustUnlock(c.id, decisao.horas);
      if (!r.ok) return { liberado: false, orientacao: "O sistema do provedor recusou a liberação. Envie a segunda via e registre uma pendência 'outro' para a equipe.", motivo_interno_para_a_pendencia: r.reason };
      await ctx.store.recordUnlock({ sgpCustomerId: c.id, conversationId: ctx.conversation.id, hours: decisao.horas, rule: decisao.regra });
      const pediuMais = dias_pedidos * 24 > decisao.horas;
      return {
        liberado: true,
        prazo_liberado: decisao.horas % 24 === 0 ? `${decisao.horas / 24} dia(s)` : `${decisao.horas} horas`,
        valido_ate: r.validUntil ?? null,
        pediu_mais_que_o_possivel: pediuMais,
        ...(pediuMais
          ? { orientacao: "Informe o prazo liberado. Se o cliente precisar de mais tempo, ofereça que um atendente analise: registre uma pendência 'outro' (prioridade 2) com os dias pedidos e os liberados, diga quando a equipe volta e não encerre o atendimento." }
          : {}),
      };
    }
    case "verificar_cobertura": {
      const { cep, numero } = Cobertura.parse(input);
      await ctx.store.updateConversation(ctx.conversation.id, { topic: "pre_venda" });
      const r = await ctx.sgp.checkCoverage(cep, numero);
      return r.covered === null
        ? { tem_cobertura: "nao_verificado", observacao: "registre como pré-venda: a equipe confirma a cobertura" }
        : { tem_cobertura: r.covered, observacao: r.note ?? null };
    }
    case "registrar_pendencia": {
      const p = Pendencia.parse(input);
      let ticketId: string | null = null;
      let osExistente: { id: string; motivo: string; agendamento: string | null } | null = null;
      if (p.tipo === "chamado_tecnico" && ctx.customer) {
        // já existe OS aberta para o contrato? não abre outra
        const abertas = await ctx.sgp.openOrders(ctx.customer.id).catch(() => []);
        if (abertas.length) {
          osExistente = abertas[0];
          ticketId = abertas[0].id;
        } else {
          ticketId = (await ctx.sgp.openTicket(ctx.customer.id, p.resumo, p.detalhes)).ticketId;
        }
      }
      await ctx.store.createPending({
        conversationId: ctx.conversation.id,
        kind: p.tipo,
        priority: p.prioridade,
        summary: p.resumo,
        data: { detalhes: p.detalhes, cliente: ctx.customer?.id ?? null, telefone: ctx.contact.phone },
        sgpTicketId: ticketId,
      });
      await ctx.store.updateConversation(ctx.conversation.id, { status: "aguardando_equipe" });
      return osExistente
        ? { registrado: true, os_ja_aberta: osExistente, orientacao: "Já existe uma ordem de serviço aberta: não abra outra. Informe o cliente (e o agendamento, se houver)." }
        : { registrado: true, protocolo_chamado: ticketId };
    }
    case "finalizar_atendimento": {
      await ctx.store.updateConversation(ctx.conversation.id, { status: "closed" });
      return { encerrado: true };
    }
    case "consultar_base": {
      const { assunto } = Assunto.parse(input);
      const hits = searchKnowledge(ctx.knowledge, assunto);
      return hits.length ? hits.map((k) => ({ titulo: k.title, conteudo: k.body })) : { nada_encontrado: true };
    }
    default:
      throw new ToolError(`ferramenta desconhecida: ${name}`);
  }
}
