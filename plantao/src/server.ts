import Fastify from "fastify";
import { pathToFileURL } from "node:url";
import { buildRouter } from "./app.js";
import { parseMetaWebhook, verifyMetaSignature } from "./channels/meta.js";
import { parseMaxChatWebhook } from "./channels/maxchat.js";
import { loadConfig, type Config } from "./config.js";
import { DETECTOR_PADRAO } from "./jobs/detector.js";
import { despedidas, manutencao, normalizacao, startScheduler, varreduraSgp } from "./jobs/routines.js";
import { registerPanel, type PanelDeps } from "./panel/routes.js";
import type { Router } from "./router.js";

export function buildServer(cfg: Config, router: Router, panel?: PanelDeps) {
  const app = Fastify({ logger: { level: process.env.NODE_ENV === "test" ? "silent" : "info" } });
  if (panel) registerPanel(app, panel);

  // guarda o corpo bruto para conferir a assinatura da Meta
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => {
    try {
      done(null, { raw: body, json: body.length ? JSON.parse(body.toString("utf8")) : {} });
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.get("/health", async () => ({ ok: true }));

  // verificação do webhook na configuração do app da Meta
  app.get("/webhooks/meta", async (req, reply) => {
    const q = req.query as Record<string, string>;
    if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === cfg.META_VERIFY_TOKEN) {
      return reply.type("text/plain").send(q["hub.challenge"]);
    }
    return reply.code(403).send();
  });

  app.post("/webhooks/meta", async (req, reply) => {
    const { raw, json } = req.body as { raw: Buffer; json: unknown };
    if (!verifyMetaSignature(raw, req.headers["x-hub-signature-256"] as string | undefined, cfg.META_APP_SECRET)) {
      return reply.code(401).send();
    }
    // responde 200 na hora; o processamento segue em segundo plano
    for (const msg of parseMetaWebhook(json)) {
      router.handle(msg).catch((err) => req.log.error({ err, from: msg.from }, "falha ao processar mensagem"));
    }
    return reply.code(200).send();
  });

  // Webhook do MaxChat — o MaxChat chama este endpoint a cada nova mensagem recebida.
  // Configure a URL de automação no MaxChat como: https://<seu-domínio>/webhooks/maxchat
  app.post("/webhooks/maxchat", async (req, reply) => {
    const { json } = req.body as { raw: Buffer; json: unknown };
    // Se tiver segredo configurado, valida pelo header X-MaxChat-Secret
    const secret = cfg.MAXCHAT_WEBHOOK_SECRET;
    if (secret) {
      const given = req.headers["x-maxchat-secret"] as string | undefined;
      if (given !== secret) return reply.code(401).send();
    }
    for (const msg of parseMaxChatWebhook(json, cfg.MAXCHAT_CHANNEL_NUMBER)) {
      router.handle(msg).catch((err) => req.log.error({ err, from: msg.from }, "falha ao processar mensagem maxchat"));
    }
    return reply.code(200).send();
  });

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cfg = loadConfig();
  if (cfg.SESSION_SECRET.length < 32) throw new Error("defina SESSION_SECRET com pelo menos 32 caracteres no .env");
  const { router, store, gateway, sgp } = buildRouter(cfg);
  const app = buildServer(cfg, router, {
    store,
    gateway,
    sessionSecret: cfg.SESSION_SECRET,
    secureCookie: cfg.PUBLIC_BASE_URL.startsWith("https://"),
    despedidaMinutos: cfg.DESPEDIDA_MINUTOS,
  });
  const log = (msg: string, extra?: unknown) => app.log.info({ extra }, msg);
  const routineDeps = {
    store, sgp, gateway, log, despedidaMinutos: cfg.DESPEDIDA_MINUTOS,
    detector: { ...DETECTOR_PADRAO, minClients: cfg.MASSIVO_MIN_CLIENTES, minRatio: cfg.MASSIVO_PERCENTUAL / 100 },
  };
  startScheduler(
    [
      // a varredura só faz sentido com o SGP real ou simulado respondendo
      { name: "varredura", everyMs: cfg.VARREDURA_MINUTOS * 60_000, run: async () => {
        await varreduraSgp(routineDeps, new Date());
        await normalizacao(routineDeps, new Date());
      } },
      { name: "despedidas", everyMs: 60_000, run: () => despedidas(routineDeps, new Date()) },
      { name: "manutencao", everyMs: 60 * 60_000, run: () =>
        manutencao(store, new Date(), { inativaHoras: cfg.CONVERSA_INATIVA_HORAS, retencaoDias: cfg.RETENCAO_DIAS }) },
    ],
    log,
  );
  app.listen({ port: cfg.PORT, host: "0.0.0.0" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
