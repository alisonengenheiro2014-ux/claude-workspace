import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().default(3000),
  PUBLIC_BASE_URL: z.string().default(""),
  SESSION_SECRET: z.string().default(""),
  TZ_ATENDIMENTO: z.string().default("America/Sao_Paulo"),
  DATABASE_URL: z.string().optional(),

  MODEL_CONVERSA: z.string().default("claude-haiku-5-5"),
  MODEL_VISAO: z.string().default("claude-sonnet-5-5"),

  CANAL: z.enum(["meta", "chatmix"]).default("meta"),
  META_ACCESS_TOKEN: z.string().default(""),
  META_PHONE_NUMBER_ID: z.string().default(""),
  META_APP_SECRET: z.string().default(""),
  META_VERIFY_TOKEN: z.string().default(""),

  SGP_MODO: z.enum(["mock", "http"]).default("mock"),
  SGP_BASE_URL: z.string().default(""),
  SGP_APP: z.string().default(""),
  SGP_TOKEN: z.string().default(""),
  SGP_OCORRENCIA_TIPO: z.coerce.number().default(5),
  SGP_SINAL_MINIMO_DBM: z.coerce.number().default(-30),

  TRANSCRICAO_URL: z.string().default(""),
  TRANSCRICAO_MODELO: z.string().default("Systran/faster-whisper-small"),

  EMPRESA_NOME: z.string().default("Maxgiga"),

  VARREDURA_MINUTOS: z.coerce.number().min(1).default(2),
  MASSIVO_MIN_CLIENTES: z.coerce.number().min(1).default(3),
  MASSIVO_PERCENTUAL: z.coerce.number().min(1).max(100).default(60),
  CONVERSA_INATIVA_HORAS: z.coerce.number().min(1).default(12),
  RETENCAO_DIAS: z.coerce.number().min(7).default(180),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Env.parse(env);
}
