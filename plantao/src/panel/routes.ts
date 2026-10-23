// Rotas do painel da equipe.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ChannelGateway } from "../channels/types.js";
import { discardIncident, openIncident, resolveIncident, updateIncidentEta } from "../incidents.js";
import type { KnowledgeRow, Store, User } from "../store/types.js";
import { parseCookies, readSession, signSession, verifyPassword } from "./auth.js";
import { conversationPage, dashboard, hoursPage, knowledgePage, layout, loginPage } from "./views.js";

export interface PanelDeps {
  store: Store;
  gateway: ChannelGateway;
  sessionSecret: string;
  secureCookie: boolean;
  now?: () => Date;
  despedidaMinutos?: number;
  intervaloEnvioMs?: number;
}

const COOKIE = "plantao_sessao";

// datetime-local chega sem fuso; o Brasil não tem horário de verão desde 2019
export const parseLocalDateTime = (v: unknown): Date | null => (typeof v === "string" && v ? new Date(`${v}:00-03:00`) : null);

const html = (reply: FastifyReply, body: string, code = 200) => reply.code(code).type("text/html; charset=utf-8").send(body);

export function registerPanel(app: FastifyInstance, deps: PanelDeps) {
  const { store } = deps;

  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  const currentUser = async (req: FastifyRequest): Promise<User | null> => {
    const id = readSession(parseCookies(req.headers.cookie)[COOKIE], deps.sessionSecret);
    return id ? store.findUser(id) : null;
  };

  // exige login (e papel admin quando pedido); devolve null se já respondeu
  const guard = async (req: FastifyRequest, reply: FastifyReply, role?: "admin") => {
    const user = await currentUser(req);
    if (!user) {
      reply.redirect("/login");
      return null;
    }
    if (role && user.role !== role) {
      html(reply, layout("Sem permissão", "<h1>Sem permissão</h1><p>Peça a um administrador.</p>", user), 403);
      return null;
    }
    return user;
  };

  const setSession = (reply: FastifyReply, value: string, maxAge: number) =>
    reply.header(
      "set-cookie",
      `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${deps.secureCookie ? "; Secure" : ""}`,
    );

  app.get("/", (_req, reply) => reply.redirect("/painel"));

  app.get("/login", (_req, reply) => html(reply, loginPage()));

  app.post("/login", async (req, reply) => {
    const { email = "", senha = "" } = (req.body ?? {}) as Record<string, string>;
    const user = await store.findUserByEmail(email.trim().toLowerCase());
    if (!user || !(await verifyPassword(senha, user.passwordHash))) {
      return html(reply, loginPage("E-mail ou senha incorretos."), 401);
    }
    setSession(reply, signSession(user.id, deps.sessionSecret), 12 * 3600);
    return reply.redirect("/painel");
  });

  app.post("/sair", (_req, reply) => {
    setSession(reply, "", 0);
    return reply.redirect("/login");
  });

  app.get("/painel", async (req, reply) => {
    const user = await guard(req, reply);
    if (!user) return;
    const now = deps.now?.() ?? new Date();
    const q = req.query as Record<string, string>;
    return html(
      reply,
      dashboard({
        user,
        stats: await store.stats(new Date(now.getTime() - 24 * 3_600_000)),
        pending: await store.listPending("aberto"),
        incidents: await store.listOpenIncidents(),
        flash: q.aviso,
      }),
    );
  });

  app.post("/pendencias/:id/feito", async (req, reply) => {
    const user = await guard(req, reply);
    if (!user) return;
    await store.markPendingDone((req.params as { id: string }).id, user.id);
    return reply.redirect("/painel");
  });

  app.get("/conversas/:id", async (req, reply) => {
    const user = await guard(req, reply);
    if (!user) return;
    const conversation = await store.getConversation((req.params as { id: string }).id);
    if (!conversation) return html(reply, layout("Não encontrada", "<h1>Conversa não encontrada</h1>", user), 404);
    return html(reply, conversationPage({ user, conversation, messages: await store.history(conversation.id, 500) }));
  });

  // --- massivo ---
  const incidentDeps = { store, gateway: deps.gateway, now: deps.now, despedidaMinutos: deps.despedidaMinutos, intervaloEnvioMs: deps.intervaloEnvioMs };
  const AREAS = ["pon", "olt", "pop"] as const;

  app.post("/incidentes", async (req, reply) => {
    const user = await guard(req, reply);
    if (!user) return;
    const b = (req.body ?? {}) as Record<string, string>;
    const areaType = AREAS.find((a) => a === b.areaType);
    if (!areaType || !b.areaId?.trim() || !b.message?.trim()) return reply.redirect("/painel?aviso=Preencha%20área%20e%20mensagem");
    try {
      await openIncident(incidentDeps, { areaType, areaId: b.areaId.trim(), message: b.message.trim(), eta: parseLocalDateTime(b.eta) });
    } catch {
      return reply.redirect("/painel?aviso=" + encodeURIComponent("Já existe um massivo aberto nessa área."));
    }
    return reply.redirect("/painel?aviso=" + encodeURIComponent("Massivo aberto. Quem chamar dessa área recebe a mensagem na hora."));
  });

  app.post("/incidentes/:id/previsao", async (req, reply) => {
    const user = await guard(req, reply);
    if (!user) return;
    const n = await updateIncidentEta(incidentDeps, (req.params as { id: string }).id, parseLocalDateTime((req.body as any)?.eta));
    return reply.redirect("/painel?aviso=" + encodeURIComponent(`Previsão atualizada. ${n} cliente(s) avisado(s).`));
  });

  app.post("/incidentes/:id/resolver", async (req, reply) => {
    const user = await guard(req, reply);
    if (!user) return;
    const n = await resolveIncident(incidentDeps, (req.params as { id: string }).id);
    return reply.redirect("/painel?aviso=" + encodeURIComponent(`Massivo encerrado. ${n} cliente(s) avisado(s).`));
  });

  app.post("/incidentes/:id/confirmar", async (req, reply) => {
    const user = await guard(req, reply);
    if (!user) return;
    await store.updateIncident((req.params as { id: string }).id, { status: "confirmado" });
    return reply.redirect("/painel?aviso=Massivo%20confirmado");
  });

  app.post("/incidentes/:id/descartar", async (req, reply) => {
    const user = await guard(req, reply);
    if (!user) return;
    await discardIncident(incidentDeps, (req.params as { id: string }).id);
    return reply.redirect("/painel?aviso=Massivo%20descartado");
  });

  // --- horários ---
  app.get("/config/horarios", async (req, reply) => {
    const user = await guard(req, reply, "admin");
    if (!user) return;
    const h = await store.getHours();
    return html(reply, hoursPage({ user, ...h, flash: (req.query as Record<string, string>).aviso }));
  });

  app.post("/config/horarios", async (req, reply) => {
    const user = await guard(req, reply, "admin");
    if (!user) return;
    const b = (req.body ?? {}) as Record<string, string>;
    const time = /^\d{2}:\d{2}$/;
    const windows = [0, 1, 2, 3, 4, 5, 6]
      .filter((d) => b[`aberto_${d}`])
      .map((d) => ({ weekday: d, opensAt: b[`abre_${d}`], closesAt: b[`fecha_${d}`] }));
    const holidays = (b.feriados ?? "").split(/\s+/).filter(Boolean);
    const invalid =
      windows.some((w) => !time.test(w.opensAt) || !time.test(w.closesAt) || w.closesAt <= w.opensAt) ||
      holidays.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d));
    if (invalid) {
      return html(reply, hoursPage({ user, windows, holidays, flash: "Confira os horários (fechar depois de abrir) e as datas (AAAA-MM-DD)." }), 400);
    }
    await store.setHours(windows, holidays);
    return reply.redirect("/config/horarios?aviso=Horários%20salvos");
  });

  // --- base de conhecimento ---
  const KINDS: KnowledgeRow["kind"][] = ["plano", "cobertura", "faq", "roteiro_onu", "politica"];

  app.get("/base", async (req, reply) => {
    const user = await guard(req, reply);
    if (!user) return;
    return html(reply, knowledgePage({ user, items: await store.listKnowledge(true), flash: (req.query as Record<string, string>).aviso }));
  });

  app.post("/base", async (req, reply) => {
    const user = await guard(req, reply, "admin");
    if (!user) return;
    const b = (req.body ?? {}) as Record<string, string>;
    const kind = KINDS.find((k) => k === b.kind);
    if (!kind || !b.title?.trim() || !b.body?.trim()) return reply.redirect("/base?aviso=Preencha%20tipo,%20título%20e%20conteúdo");
    await store.saveKnowledge({ id: b.id || undefined, kind, title: b.title.trim(), body: b.body.trim(), active: b.active !== "0" });
    return reply.redirect("/base?aviso=Salvo");
  });
}
