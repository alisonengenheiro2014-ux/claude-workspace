import Fastify from "fastify";
import { pathToFileURL } from "node:url";
import { buildRouter } from "./app.js";
import { parseMetaWebhook, verifyMetaSignature } from "./channels/meta.js";
import { loadConfig, type Config } from "./config.js";
import type { Router } from "./router.js";

export function buildServer(cfg: Config, router: Router) {
  const app = Fastify({ logger: { level: "info" } });

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

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cfg = loadConfig();
  const { router } = buildRouter(cfg);
  const app = buildServer(cfg, router);
  app.listen({ port: cfg.PORT, host: "0.0.0.0" }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
