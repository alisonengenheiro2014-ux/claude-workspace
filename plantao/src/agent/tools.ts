// Ferramentas que o agente pode chamar. O cliente fica preso à conversa: o modelo nunca escolhe
// de quem são os dados, só pede "o cliente desta conversa".
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { SgpClient, SgpCustomer } from "../sgp/types.js";
import type { Contact, Conversation, Store } from "../store/types.js";
import { searchKnowledge, type KnowledgeItem } from "./knowledge.js";

export interface ToolContext {
  store: Store;
  sgp: SgpClient;
  contact: Contact;
  conversation: Conversation;
  knowledge: KnowledgeItem[];
  customer: SgpCustomer | null; // preenchido por identificar_cliente
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
    description: "Solicita o desbloqueio de confiança para o cliente identificado que está bloqueado por débito.",
    input_schema: obj({}, []),
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
        tipo: { type: "string", enum: ["chamado_tecnico", "pre_venda", "conferir_pagamento", "outro"] },
        prioridade: { type: "integer", enum: [1, 2, 3] },
        resumo: { type: "string", description: "Uma ou duas frases para a equipe entender sem ler a conversa toda" },
        detalhes: { type: "string", description: "Dados coletados: nome, endereço, melhor horário, luzes da ONU, etc." },
      },
      ["tipo", "prioridade", "resumo", "detalhes"],
    ),
  },
  {
    name: "consultar_base",
    description: "Busca na base de conhecimento do provedor: planos, preços, cobertura, perguntas frequentes, luzes da ONU.",
    input_schema: obj({ assunto: { type: "string" } }, ["assunto"]),
  },
].map((t) => ({ ...t, strict: true }));

const needCustomer = (ctx: ToolContext) => {
  if (!ctx.customer) throw new ToolError("cliente ainda não identificado: chame identificar_cliente antes");
  return ctx.customer;
};

export class ToolError extends Error {}

const SegundaVia = z.object({ fatura_id: z.string().min(1) });
const Cobertura = z.object({ cep: z.string().min(5), numero: z.string() });
const Pendencia = z.object({
  tipo: z.enum(["chamado_tecnico", "pre_venda", "conferir_pagamento", "outro"]),
  prioridade: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  resumo: z.string().min(1),
  detalhes: z.string(),
});
const Identificar = z.object({ cpf: z.string() });
const Assunto = z.object({ assunto: z.string() });

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
      const c = needCustomer(ctx);
      const r = await ctx.sgp.trustUnlock(c.id);
      return r.ok ? { liberado: true, valido_ate: r.validUntil } : { liberado: false, motivo: r.reason };
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
      if (p.tipo === "chamado_tecnico" && ctx.customer) {
        ticketId = (await ctx.sgp.openTicket(ctx.customer.id, p.resumo, p.detalhes)).ticketId;
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
      return { registrado: true, protocolo_chamado: ticketId };
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
