// Monta as dependências a partir da configuração.
import Anthropic from "@anthropic-ai/sdk";
import pg from "pg";
import { anthropicCreate } from "./agent/agent.js";
import { BASE_INICIAL } from "./agent/knowledge.js";
import { MaxChatGateway } from "./channels/maxchat.js";
import { MetaGateway } from "./channels/meta.js";
import type { ChannelGateway } from "./channels/types.js";
import type { Config } from "./config.js";
import { HORARIO_PADRAO, type HoursConfig } from "./hours.js";
import { httpTranscriber } from "./media/audio.js";
import { extractFrames } from "./media/video.js";
import { Router } from "./router.js";
import { HttpSgp } from "./sgp/http.js";
import { MockSgp } from "./sgp/mock.js";
import { MemoryStore } from "./store/memory.js";
import { PgStore } from "./store/pg.js";
import type { Store } from "./store/types.js";

export function buildRouter(cfg: Config, opts: { gateway?: ChannelGateway; store?: Store; hours?: HoursConfig } = {}) {
  const client = new Anthropic();
  const store = opts.store ?? (cfg.DATABASE_URL ? new PgStore(new pg.Pool({ connectionString: cfg.DATABASE_URL })) : new MemoryStore());
  const sgp = cfg.SGP_MODO === "http" ? new HttpSgp({ baseUrl: cfg.SGP_BASE_URL, app: cfg.SGP_APP, token: cfg.SGP_TOKEN, ocorrenciaTipo: cfg.SGP_OCORRENCIA_TIPO, sinalMinimoDbm: cfg.SGP_SINAL_MINIMO_DBM }) : new MockSgp();
  const gateway =
    opts.gateway ??
    (cfg.CANAL === "maxchat"
      ? new MaxChatGateway(cfg.MAXCHAT_API_URL, cfg.MAXCHAT_API_TOKEN)
      : new MetaGateway(cfg.META_ACCESS_TOKEN, cfg.META_PHONE_NUMBER_ID));
  if (cfg.CANAL === "chatmix" && !opts.gateway) {
    throw new Error("canal Chat Mix ainda não implementado: aguardando a documentação da API do Chat Mix");
  }

  const router = new Router({
    store,
    sgp,
    gateway,
    agent: { create: anthropicCreate(client), model: cfg.MODEL_CONVERSA, empresa: cfg.EMPRESA_NOME, desbloqueio: cfg.DESBLOQUEIO_CONFIANCA,
      regrasLiberacao: {
        horasClienteNovo: cfg.LIBERACAO_HORAS_CLIENTE_NOVO,
        mesesIntermediario: cfg.LIBERACAO_MESES_INTERMEDIARIO,
        horasIntermediario: cfg.LIBERACAO_HORAS_INTERMEDIARIO,
        mesesAntigo: cfg.LIBERACAO_MESES_ANTIGO,
        diasAntigo: cfg.LIBERACAO_DIAS_ANTIGO,
        diasTolerancia: cfg.LIBERACAO_DIAS_TOLERANCIA,
        minFaturasAnalise: cfg.LIBERACAO_MIN_FATURAS_ANALISE,
        horasSegundaNoCiclo: cfg.LIBERACAO_HORAS_SEGUNDA_NO_CICLO,
        maxPorCiclo: cfg.LIBERACAO_MAX_POR_CICLO,
      } },
    vision: { create: (p) => client.beta.messages.create(p), model: cfg.MODEL_VISAO },
    transcribe: cfg.TRANSCRICAO_URL ? httpTranscriber(cfg.TRANSCRICAO_URL, cfg.TRANSCRICAO_MODELO) : null,
    extractFrames: (video) => extractFrames(video),
    // horários e base são editados no painel; sem nada cadastrado, valem os padrões
    hours: async () => {
      if (opts.hours) return opts.hours;
      const h = await store.getHours();
      return { windows: h.windows.length ? h.windows : HORARIO_PADRAO, holidays: h.holidays, timeZone: cfg.TZ_ATENDIMENTO };
    },
    knowledge: async () => {
      const items = await store.listKnowledge();
      return items.length ? items : BASE_INICIAL;
    },
    filas: { chamado_tecnico: cfg.MAXCHAT_FILA_SUPORTE, outro: cfg.MAXCHAT_FILA_SUPORTE, conferir_pagamento: cfg.MAXCHAT_FILA_FINANCEIRO, pre_venda: cfg.MAXCHAT_FILA_COMERCIAL },
    log: (msg, extra) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, extra: extra instanceof Error ? extra.message : extra })),
  });
  return { router, store, sgp, gateway };
}
