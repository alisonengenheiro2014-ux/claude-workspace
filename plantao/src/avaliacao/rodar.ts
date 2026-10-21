// Roda os cenários contra a IA e mostra o que passou, o que falhou e quanto custou.
// Uso: ANTHROPIC_API_KEY=... npm run avaliar [-- --cenario los-vermelho] [-- --modelo claude-sonnet-5-5]
import Anthropic from "@anthropic-ai/sdk";
import { pathToFileURL } from "node:url";
import { anthropicCreate, type CreateMessage } from "../agent/agent.js";
import { BASE_INICIAL } from "../agent/knowledge.js";
import type { ChannelGateway } from "../channels/types.js";
import { HORARIO_PADRAO } from "../hours.js";
import type { CreateBetaMessage } from "../media/vision.js";
import { Router } from "../router.js";
import { MockSgp } from "../sgp/mock.js";
import { MemoryStore } from "../store/memory.js";
import { CENARIOS, type Cenario } from "./cenarios.js";

// terça 23h30 em São Paulo: fora do horário da equipe
const NOITE = new Date("2026-10-20T23:30:00-03:00");

export interface Resultado {
  id: string;
  passou: boolean;
  falhas: string[];
  ferramentas: string[];
  respostas: string[];
  tokens: { entrada: number; saida: number; cache: number };
}

export async function rodarCenario(c: Cenario, create: CreateMessage, model: string): Promise<Resultado> {
  const store = new MemoryStore();
  const sgp = new MockSgp();
  const respostas: string[] = [];
  const ferramentas: string[] = [];
  const tokens = { entrada: 0, saida: 0, cache: 0 };

  // registra as ferramentas pedidas e o consumo de cada chamada
  const medido: CreateMessage = async (p) => {
    const r = await create(p);
    for (const b of r.content) if (b.type === "tool_use") ferramentas.push(b.name);
    tokens.entrada += r.usage.input_tokens + (r.usage.cache_creation_input_tokens ?? 0);
    tokens.cache += r.usage.cache_read_input_tokens ?? 0;
    tokens.saida += r.usage.output_tokens;
    return r;
  };

  let leituraAtual: unknown = null;
  let audioAtual = "";
  const gateway: ChannelGateway = {
    sendText: async (_to, text) => void respostas.push(text),
    downloadMedia: async () => ({ data: Buffer.from("x"), mimeType: "image/jpeg" }),
  };
  // a leitura da foto vem pronta do cenário: aqui avaliamos a conversa, não a visão
  const vision: CreateBetaMessage = async () =>
    ({ content: [{ type: "text", text: JSON.stringify(leituraAtual) }], stop_reason: "end_turn" }) as unknown as Anthropic.Beta.BetaMessage;

  const router = new Router({
    store, sgp, gateway,
    agent: { create: medido, model, empresa: "Maxgiga" },
    vision: { create: vision, model: "cenario" },
    transcribe: async () => audioAtual,
    extractFrames: async () => [],
    hours: () => ({ windows: HORARIO_PADRAO, holidays: [], timeZone: "America/Sao_Paulo" }),
    knowledge: () => BASE_INICIAL,
    now: () => NOITE,
  });

  let n = 0;
  for (const m of c.mensagens) {
    const base = { channel: "meta" as const, channelNumber: "teste", channelMessageId: `${c.id}-${++n}`, from: c.telefone, receivedAt: NOITE };
    if ("texto" in m) await router.handle({ ...base, text: m.texto });
    else if ("foto" in m) {
      leituraAtual = m.foto;
      await router.handle({ ...base, media: { kind: "image", mediaId: "f", mimeType: "image/jpeg" } });
    } else {
      audioAtual = m.audio;
      await router.handle({ ...base, media: { kind: "audio", mediaId: "a", mimeType: "audio/ogg" } });
    }
  }

  const falhas: string[] = [];
  const e = c.esperado;
  for (const f of e.chamaFerramentas ?? []) if (!ferramentas.includes(f)) falhas.push(`não chamou ${f}`);
  for (const f of e.naoChamaFerramentas ?? []) if (ferramentas.includes(f)) falhas.push(`chamou ${f} sem poder`);
  const pend = await store.listPending();
  if (e.pendencia === "nenhuma" && pend.length) falhas.push(`registrou pendência sem precisar (${pend[0].kind})`);
  if (e.pendencia && e.pendencia !== "nenhuma") {
    const { tipo, prioridadeMax } = e.pendencia;
    const p = pend.find((x) => !tipo || x.kind === tipo);
    const nome = tipo ?? "de qualquer tipo";
    if (!p) falhas.push(`não registrou pendência ${nome}${pend.length ? ` (registrou ${pend.map((x) => x.kind).join(", ")})` : ""}`);
    else if (prioridadeMax && p.priority > prioridadeMax) falhas.push(`pendência ${nome} com prioridade ${p.priority}, esperado até ${prioridadeMax}`);
  }
  const todas = respostas.join("\n");
  for (const r of e.respostaContem ?? []) if (!r.test(todas)) falhas.push(`resposta não menciona ${r}`);
  for (const r of e.respostaNaoContem ?? []) if (r.test(todas)) falhas.push(`resposta contém ${r}`);

  return { id: c.id, passou: falhas.length === 0, falhas, ferramentas, respostas, tokens };
}

// preço por milhão de tokens (US$), para estimar o custo por conversa
const PRECOS: Record<string, { entrada: number; saida: number; cache: number }> = {
  "claude-haiku-5-5": { entrada: 0.1, saida: 0.5, cache: 0.01 },
  "claude-sonnet-5-5": { entrada: 2, saida: 10, cache: 0.2 },
  "claude-opus-5-5": { entrada: 4, saida: 20, cache: 0.2 },
};

export function custoUsd(t: Resultado["tokens"], model: string): number | null {
  const p = PRECOS[model];
  return p ? (t.entrada * p.entrada + t.saida * p.saida + t.cache * p.cache) / 1e6 : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (n: string) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : undefined);
  const model = arg("modelo") ?? process.env.MODEL_CONVERSA ?? "claude-haiku-5-5";
  const filtro = arg("cenario");
  const cenarios = CENARIOS.filter((c) => !filtro || c.id === filtro);
  const create = anthropicCreate(new Anthropic());
  const dolar = Number(process.env.DOLAR ?? 5.5);

  console.log(`Avaliando ${cenarios.length} cenário(s) com ${model}\n`);
  const resultados: Resultado[] = [];
  for (const c of cenarios) {
    const r = await rodarCenario(c, create, model).catch((err) => ({
      id: c.id, passou: false, falhas: [`erro: ${(err as Error).message}`], ferramentas: [], respostas: [], tokens: { entrada: 0, saida: 0, cache: 0 },
    }));
    resultados.push(r);
    console.log(`${r.passou ? "✔" : "✘"} ${c.id} — ${c.descricao}`);
    for (const f of r.falhas) console.log(`    • ${f}`);
    if (!r.passou || process.argv.includes("--detalhes")) {
      console.log(`    ferramentas: ${r.ferramentas.join(", ") || "nenhuma"}`);
      for (const t of r.respostas) console.log(`    IA: ${t.replace(/\n/g, " ")}`);
    }
  }
  const ok = resultados.filter((r) => r.passou).length;
  const custos = resultados.map((r) => custoUsd(r.tokens, model)).filter((x): x is number => x !== null);
  console.log(`\nResultado: ${ok}/${resultados.length} cenários ok`);
  if (custos.length) {
    const media = custos.reduce((a, b) => a + b, 0) / custos.length;
    console.log(`Custo médio por conversa: US$ ${media.toFixed(4)} (~R$ ${(media * dolar).toFixed(3)}); 600 conversas/mês ≈ R$ ${(media * dolar * 600).toFixed(0)}`);
  }
  process.exit(ok === resultados.length ? 0 : 1);
}
