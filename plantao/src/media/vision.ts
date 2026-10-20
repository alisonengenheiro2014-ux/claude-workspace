// Lê as luzes da ONU numa foto (ou em quadros de um vídeo) e devolve um diagnóstico estruturado.
import type Anthropic from "@anthropic-ai/sdk";

export type LedState = "aceso_verde" | "aceso_vermelho" | "piscando" | "apagado" | "nao_visivel";

export interface EquipmentReading {
  equipamento_identificado: boolean;
  led_power: LedState;
  led_pon: LedState;
  led_los: LedState;
  confianca: "alta" | "media" | "baixa";
  observacao: string;
}

export type CreateBetaMessage = (
  params: Anthropic.Beta.MessageCreateParamsNonStreaming,
) => Promise<Anthropic.Beta.BetaMessage>;

const LED = { type: "string", enum: ["aceso_verde", "aceso_vermelho", "piscando", "apagado", "nao_visivel"] };

const SCHEMA = {
  type: "object",
  properties: {
    equipamento_identificado: { type: "boolean" },
    led_power: LED,
    led_pon: LED,
    led_los: LED,
    confianca: { type: "string", enum: ["alta", "media", "baixa"] },
    observacao: { type: "string" },
  },
  required: ["equipamento_identificado", "led_power", "led_pon", "led_los", "confianca", "observacao"],
  additionalProperties: false,
};

const INSTRUCOES = `Você analisa imagens enviadas por clientes de um provedor de fibra óptica.
Procure a ONU/ONT (o aparelho da fibra) e leia as luzes POWER (ou PWR), PON e LOS.
- Só afirme uma cor ou estado se a luz estiver claramente visível. Na dúvida, use "nao_visivel" e confiança baixa.
- Se houver várias imagens, elas são quadros de um mesmo vídeo em ordem: uma luz que acende e apaga entre quadros está "piscando".
- Em "observacao", escreva em português, numa frase, o que dificultou a leitura ou o que chamou atenção (ex.: "foto escura", "aparelho é só o roteador, sem ONU").`;

export async function readEquipment(
  images: { data: Buffer; mimeType: string }[],
  deps: { create: CreateBetaMessage; model: string },
): Promise<EquipmentReading | null> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.mimeType as "image/jpeg", data: img.data.toString("base64") },
  }));
  content.push({ type: "text", text: "Leia as luzes do equipamento." });

  const response = await deps.create({
    model: deps.model,
    max_tokens: 2000,
    // se um classificador recusar, o próprio servidor tenta outro modelo
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: INSTRUCOES,
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") return null;
  const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text");
  if (!text) return null;
  return JSON.parse(text.text) as EquipmentReading;
}

// Resumo em texto para o agente da conversa.
export function describeReading(r: EquipmentReading | null): string {
  if (!r) return "[análise da imagem indisponível]";
  if (!r.equipamento_identificado) return `[imagem analisada: ONU não identificada. ${r.observacao}]`;
  return `[leitura da ONU pela imagem — POWER: ${r.led_power}, PON: ${r.led_pon}, LOS: ${r.led_los}; confiança ${r.confianca}. ${r.observacao}]`;
}
