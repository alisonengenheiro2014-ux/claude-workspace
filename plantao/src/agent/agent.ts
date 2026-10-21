// Laço do agente: manda o histórico ao modelo, executa as ferramentas pedidas e devolve a resposta final.
import Anthropic from "@anthropic-ai/sdk";
import type { StoredMessage } from "../store/types.js";
import { contextBlock, systemPrompt } from "./prompt.js";
import { runTool, toolDefs, ToolError, type ToolContext } from "./tools.js";

export type CreateMessage = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

export interface AgentDeps {
  create: CreateMessage;
  model: string;
  empresa: string;
  desbloqueio?: boolean;
  maxSteps?: number;
}

export interface AgentTurnInput {
  history: StoredMessage[]; // inclui a mensagem nova do cliente
  agora: string;
  retornoEquipe: string;
  incidente: string | null;
  posMassivo?: boolean;
}

export interface AgentResult {
  reply: string;
  stopReason: Anthropic.Message["stop_reason"];
  toolCalls: string[];
}

const FALLBACK_REPLY =
  "Tive um problema para concluir seu atendimento agora. Já deixei registrado para a nossa equipe, que vai te responder assim que voltar.";

export function toMessages(history: StoredMessage[]): Anthropic.MessageParam[] {
  const msgs: Anthropic.MessageParam[] = [];
  for (const m of history) {
    if (!m.body) continue;
    if (m.author === "cliente") msgs.push({ role: "user", content: m.body });
    else if (m.author === "ia") msgs.push({ role: "assistant", content: m.body });
    else if (m.author === "humano") msgs.push({ role: "assistant", content: `[atendente da equipe] ${m.body}` });
    else msgs.push({ role: "user", content: `[sistema] ${m.body}` });
  }
  // a conversa enviada ao modelo precisa começar pelo cliente
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  return msgs;
}

export async function runAgentTurn(input: AgentTurnInput, ctx: ToolContext, deps: AgentDeps): Promise<AgentResult> {
  const messages = toMessages(input.history);
  const toolCalls: string[] = [];
  const maxSteps = deps.maxSteps ?? 8;

  for (let step = 0; step < maxSteps; step++) {
    const response = await deps.create({
      model: deps.model,
      max_tokens: 4000,
      output_config: { effort: "low" },
      system: [
        // bloco estável primeiro: entra no cache junto com as ferramentas
        { type: "text", text: systemPrompt(deps.empresa, { desbloqueio: !!deps.desbloqueio }), cache_control: { type: "ephemeral" } },
        {
          type: "text",
          text: contextBlock({
            agora: input.agora,
            retornoEquipe: input.retornoEquipe,
            clienteIdentificado: ctx.customer ? `${ctx.customer.name} (plano ${ctx.customer.plan})` : null,
            incidente: input.incidente,
            posMassivo: input.posMassivo,
          }),
        },
      ],
      tools: toolDefs({ desbloqueio: !!deps.desbloqueio }),
      messages,
    });

    if (response.stop_reason === "refusal") {
      return { reply: FALLBACK_REPLY, stopReason: response.stop_reason, toolCalls };
    }

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { reply: text || FALLBACK_REPLY, stopReason: response.stop_reason, toolCalls };
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      toolCalls.push(use.name);
      try {
        const out = await runTool(use.name, use.input, ctx);
        results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(out) });
      } catch (err) {
        const msg = err instanceof ToolError ? err.message : `falha ao consultar o sistema: ${(err as Error).message}`;
        results.push({ type: "tool_result", tool_use_id: use.id, content: msg, is_error: true });
      }
    }
    // todos os resultados numa única mensagem
    messages.push({ role: "user", content: results });
  }

  return { reply: FALLBACK_REPLY, stopReason: null, toolCalls };
}

export function anthropicCreate(client = new Anthropic()): CreateMessage {
  return (params) => client.messages.create(params);
}
