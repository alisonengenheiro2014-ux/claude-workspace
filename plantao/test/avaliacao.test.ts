// Confere o avaliador com um modelo roteirizado (a avaliação de verdade usa a IA real: npm run avaliar).
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { CreateMessage } from "../src/agent/agent.js";
import { CENARIOS } from "../src/avaliacao/cenarios.js";
import { custoUsd, rodarCenario } from "../src/avaliacao/rodar.js";

function scripted(steps: { text?: string; tools?: { name: string; input: unknown }[] }[]): CreateMessage {
  let i = 0;
  return async () => {
    const step = steps[i++] ?? { text: "ok" };
    const content: any[] = [];
    if (step.text) content.push({ type: "text", text: step.text, citations: null });
    for (const [k, t] of (step.tools ?? []).entries()) content.push({ type: "tool_use", id: `t${i}_${k}`, name: t.name, input: t.input });
    return {
      id: "m", type: "message", role: "assistant", model: "fake", content, stop_sequence: null,
      stop_reason: step.tools?.length ? "tool_use" : "end_turn",
      usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 },
    } as unknown as Anthropic.Message;
  };
}

const cenario = (id: string) => CENARIOS.find((c) => c.id === id)!;

describe("avaliador de cenários", () => {
  it("todos os cenários têm id único e ao menos uma regra", () => {
    const ids = CENARIOS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CENARIOS) expect(Object.keys(c.esperado).length).toBeGreaterThan(0);
  });

  it("aprova quando o agente faz o certo (LOS vermelho)", async () => {
    const r = await rodarCenario(cenario("los-vermelho"), scripted([
      { tools: [{ name: "identificar_cliente", input: { cpf: "" } }] },
      { tools: [{ name: "status_conexao", input: {} }] },
      { text: "Pode me mandar uma foto das luzes do aparelho?" },
      { tools: [{ name: "registrar_pendencia", input: { tipo: "chamado_tecnico", prioridade: 1, resumo: "LOS", detalhes: "LOS vermelho" } }] },
      { text: "Abri um chamado prioritário. A equipe técnica trata amanhã às 08:00." },
    ]), "claude-haiku-5-5");
    expect(r.falhas).toEqual([]);
    expect(r.passou).toBe(true);
    expect(r.tokens).toEqual({ entrada: 5000, saida: 500, cache: 20000 });
  });

  it("reprova e explica quando o agente erra (manda reiniciar e não abre chamado)", async () => {
    const r = await rodarCenario(cenario("los-vermelho"), scripted([
      { text: "Desliga o aparelho da tomada e liga de novo." },
      { text: "Tenta reiniciar de novo." },
    ]), "claude-haiku-5-5");
    expect(r.passou).toBe(false);
    expect(r.falhas).toContain("não chamou registrar_pendencia");
    expect(r.falhas.some((f) => f.startsWith("não registrou pendência chamado_tecnico"))).toBe(true);
  });

  it("pega valor inventado", async () => {
    const r = await rodarCenario(cenario("preco-sem-base"), scripted([
      { tools: [{ name: "consultar_base", input: { assunto: "preço 500 mega" } }] },
      { text: "O plano de 500 Mega sai por R$ 99,90." },
    ]), "claude-haiku-5-5");
    expect(r.falhas).toEqual(["resposta contém /R\\$\\s?\\d/"]);
  });

  it("estima custo", () => {
    expect(custoUsd({ entrada: 1_000_000, saida: 0, cache: 0 }, "claude-haiku-5-5")).toBeCloseTo(0.1);
    expect(custoUsd({ entrada: 0, saida: 0, cache: 0 }, "modelo-desconhecido")).toBeNull();
  });
});
