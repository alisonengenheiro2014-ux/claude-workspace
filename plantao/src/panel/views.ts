// HTML do painel, renderizado no servidor. Sem JavaScript: só formulários.
import type { Contact, Conversation, Incident, KnowledgeRow, PendingItem, StoredMessage, User } from "../store/types.js";

export const esc = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const dt = (d: Date | null | undefined) =>
  d ? d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--text:#1d2330;--muted:#5d6675;--line:#e2e6ec;--accent:#0b6e4f;--on-accent:#fff;--danger:#b42318;--warn:#9a6700;--chip:#eef1f5}
@media (prefers-color-scheme:dark){:root{--bg:#12151b;--card:#1b2029;--text:#e7eaf0;--muted:#9aa3b2;--line:#2b3240;--accent:#3fb68b;--on-accent:#0d1512;--danger:#f97066;--warn:#f5b84a;--chip:#252c38}}
*{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--text)}
header{display:flex;gap:16px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--card);flex-wrap:wrap}
header strong{margin-right:auto}header a{color:var(--text);text-decoration:none}header a:hover{text-decoration:underline}
main{max-width:1100px;margin:0 auto;padding:16px}h1{font-size:20px;margin:8px 0 16px}h2{font-size:16px;margin:24px 0 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:12px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
.stat b{display:block;font-size:26px}.stat span{color:var(--muted)}
.row{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
.chip{display:inline-block;padding:2px 8px;border-radius:999px;background:var(--chip);font-size:12px;margin-right:6px}
.p1{color:var(--danger);font-weight:600}.p2{color:var(--warn)}.muted{color:var(--muted)}
button,.btn{background:var(--accent);color:var(--on-accent);border:0;border-radius:8px;padding:8px 14px;font:inherit;cursor:pointer;text-decoration:none;display:inline-block}
button.ghost{background:transparent;color:var(--text);border:1px solid var(--line)}button.danger{background:var(--danger);color:#fff}
input,select,textarea{font:inherit;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);width:100%}
label{display:block;margin:8px 0 4px;color:var(--muted);font-size:13px}form.inline{display:inline}
.msg{padding:8px 12px;border-radius:10px;margin:6px 0;max-width:80%;white-space:pre-wrap}
.cliente{background:var(--chip)}.ia,.humano{background:var(--accent);color:var(--on-accent);margin-left:auto}.sistema{font-size:13px;color:var(--muted);border:1px dashed var(--line);max-width:100%}
.thread{display:flex;flex-direction:column}.msg small{color:inherit;opacity:.75}main a{color:var(--accent)}table{width:100%;border-collapse:collapse}td,th{padding:6px;border-bottom:1px solid var(--line);text-align:left}
.error{color:var(--danger)}
`;

export function layout(title: string, body: string, user?: User | null): string {
  const nav = user
    ? `<a href="/painel">Fila</a><a href="/base">Base</a>${user.role === "admin" ? `<a href="/config/horarios">Horários</a>` : ""}
       <form class="inline" method="post" action="/sair"><button class="ghost">Sair (${esc(user.name)})</button></form>`
    : "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Plantão</title><style>${CSS}</style></head>
<body><header><strong>Plantão</strong>${nav}</header><main>${body}</main></body></html>`;
}

export function loginPage(error?: string): string {
  return layout(
    "Entrar",
    `<div class="card" style="max-width:380px;margin:40px auto"><h1>Entrar no painel</h1>
     ${error ? `<p class="error">${esc(error)}</p>` : ""}
     <form method="post" action="/login">
       <label for="email">E-mail</label><input id="email" name="email" type="email" required autofocus>
       <label for="senha">Senha</label><input id="senha" name="senha" type="password" required>
       <p><button>Entrar</button></p>
     </form></div>`,
  );
}

const KIND_LABEL: Record<PendingItem["kind"], string> = {
  chamado_tecnico: "Chamado técnico",
  pre_venda: "Pré-venda",
  conferir_pagamento: "Conferir pagamento",
  cancelamento: "Cancelamento",
  outro: "Outro",
};

export function dashboard(p: {
  user: User;
  stats: { conversas: number; resolvidasIa: number; pendentes: number; massivo: number };
  pending: PendingItem[];
  incidents: (Incident & { contactsCount: number; startedAt: Date })[];
  flash?: string;
}): string {
  const fila = p.pending.length
    ? p.pending
        .map(
          (x) => `<div class="card"><div class="row"><div>
            <span class="chip p${x.priority}">P${x.priority}</span><span class="chip">${KIND_LABEL[x.kind]}</span>
            ${x.sgpTicketId ? `<span class="chip">Chamado ${esc(x.sgpTicketId)}</span>` : ""}
            <p>${esc(x.summary)}</p>
            <p class="muted">${esc((x.data as any)?.detalhes ?? "")}</p>
            <p class="muted">${dt(x.createdAt)} · tel. ${esc((x.data as any)?.telefone ?? "")}</p></div>
            <div><a class="btn" href="/conversas/${x.conversationId}">Ver conversa</a>
            <form class="inline" method="post" action="/pendencias/${x.id}/feito"><button class="ghost">Feito</button></form></div>
          </div></div>`,
        )
        .join("")
    : `<p class="muted">Nada pendente. 🎉</p>`;

  const incidentes = p.incidents.length
    ? p.incidents
        .map(
          (i) => `<div class="card"><div class="row"><div>
            <span class="chip ${i.status === "suspeito" ? "p2" : "p1"}">${i.status}</span>${i.detectedBy === "varredura" ? `<span class="chip">detectado automaticamente</span>` : ""}
            <span class="chip">${i.areaId.toLowerCase().startsWith(i.areaType) ? esc(i.areaId) : `${i.areaType.toUpperCase()} ${esc(i.areaId)}`}</span>
            <span class="chip">${i.contactsCount} cliente(s) chamaram</span>
            <p>${esc(i.message)}</p><p class="muted">Desde ${dt(i.startedAt)} · previsão ${dt(i.eta)}</p></div></div>
            <form method="post" action="/incidentes/${i.id}/previsao" class="row">
              <div style="flex:1;min-width:200px"><label>Nova previsão</label><input type="datetime-local" name="eta"></div>
              <div style="align-self:flex-end"><button>Atualizar e avisar clientes</button></div>
            </form>
            <p>${i.status === "suspeito" ? `<form class="inline" method="post" action="/incidentes/${i.id}/confirmar"><button>Confirmar massivo</button></form> ` : ""}<form class="inline" method="post" action="/incidentes/${i.id}/resolver"><button>Normalizou: avisar clientes</button></form>
            <form class="inline" method="post" action="/incidentes/${i.id}/descartar"><button class="ghost">Descartar (alarme falso)</button></form></p>
          </div>`,
        )
        .join("")
    : `<p class="muted">Nenhum massivo aberto.</p>`;

  return layout(
    "Fila",
    `${p.flash ? `<div class="card">${esc(p.flash)}</div>` : ""}
    <h1>Fila da manhã</h1>
    <div class="grid">
      <div class="card stat"><b>${p.stats.conversas}</b><span>conversas nas últimas 24h</span></div>
      <div class="card stat"><b>${p.stats.resolvidasIa}</b><span>sem precisar da equipe</span></div>
      <div class="card stat"><b>${p.stats.pendentes}</b><span>pendências abertas</span></div>
      <div class="card stat"><b>${p.stats.massivo}</b><span>atendidas por massivo</span></div>
    </div>
    <h2>Massivo</h2>${incidentes}
    <details class="card"><summary>Abrir massivo</summary>
      <form method="post" action="/incidentes">
        <div class="grid">
          <div><label>Área</label><select name="areaType"><option value="pon">PON</option><option value="olt">OLT</option><option value="pop">POP</option></select></div>
          <div><label>Identificação (igual ao SGP)</label><input name="areaId" required placeholder="ex.: PON-2/1"></div>
          <div><label>Previsão (opcional)</label><input type="datetime-local" name="eta"></div>
        </div>
        <label>Mensagem para os clientes</label>
        <textarea name="message" rows="3" required>Identificamos uma queda na rede que atende a sua região e a equipe técnica já está trabalhando no reparo.</textarea>
        <p><button>Abrir massivo</button></p>
      </form></details>
    <h2>Pendências</h2>${fila}`,
    p.user,
  );
}

export function conversationPage(p: { user: User; conversation: Conversation & { contact: Contact }; messages: StoredMessage[] }): string {
  const c = p.conversation.contact;
  const msgs = p.messages
    .map((m) => `<div class="msg ${m.author}"><small>${m.author} · ${dt(m.sentAt)}</small><br>${esc(m.body)}</div>`)
    .join("");
  return layout(
    "Conversa",
    `<p><a href="/painel">← Voltar</a></p><h1>${esc(c.name ?? c.phone)}</h1>
     <p class="muted">Telefone ${esc(c.phone)}${c.sgpCustomerId ? ` · cliente SGP ${esc(c.sgpCustomerId)}` : ""} · status ${esc(p.conversation.status)}${p.conversation.topic ? ` · ${esc(p.conversation.topic)}` : ""}</p>
     <div class="card thread">${msgs || `<p class="muted">Sem mensagens.</p>`}</div>`,
    p.user,
  );
}

const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export function hoursPage(p: { user: User; windows: { weekday: number; opensAt: string; closesAt: string }[]; holidays: string[]; flash?: string }): string {
  const rows = DIAS.map((nome, d) => {
    const w = p.windows.find((x) => x.weekday === d);
    return `<tr><td>${nome}</td>
      <td><input type="checkbox" name="aberto_${d}" ${w ? "checked" : ""} aria-label="Equipe atende ${nome}"></td>
      <td><input type="time" name="abre_${d}" value="${esc(w?.opensAt ?? "08:00")}"></td>
      <td><input type="time" name="fecha_${d}" value="${esc(w?.closesAt ?? "18:00")}"></td></tr>`;
  }).join("");
  return layout(
    "Horários",
    `${p.flash ? `<div class="card">${esc(p.flash)}</div>` : ""}<h1>Horário da equipe</h1>
     <p class="muted">Fora destes horários o agente atende sozinho. Em massivo, ele responde a qualquer hora.</p>
     <form method="post" action="/config/horarios" class="card">
       <table><thead><tr><th>Dia</th><th>Equipe atende</th><th>Abre</th><th>Fecha</th></tr></thead><tbody>${rows}</tbody></table>
       <label>Feriados (um por linha, AAAA-MM-DD)</label>
       <textarea name="feriados" rows="4">${esc(p.holidays.join("\n"))}</textarea>
       <p><button>Salvar</button></p>
     </form>`,
    p.user,
  );
}

const KB_KINDS: KnowledgeRow["kind"][] = ["plano", "cobertura", "faq", "roteiro_onu", "politica"];

export function knowledgePage(p: { user: User; items: KnowledgeRow[]; flash?: string }): string {
  const form = (k?: KnowledgeRow) => `<form method="post" action="/base">
      ${k ? `<input type="hidden" name="id" value="${esc(k.id)}">` : ""}
      <div class="grid"><div><label>Tipo</label><select name="kind">${KB_KINDS.map((x) => `<option ${k?.kind === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      <div><label>Título</label><input name="title" required value="${esc(k?.title)}"></div>
      <div><label>Ativo</label><select name="active"><option value="1" ${k?.active !== false ? "selected" : ""}>sim</option><option value="0" ${k?.active === false ? "selected" : ""}>não</option></select></div></div>
      <label>Conteúdo (o agente só usa o que está escrito aqui)</label><textarea name="body" rows="4" required>${esc(k?.body)}</textarea>
      <p><button>${k ? "Salvar" : "Adicionar"}</button></p></form>`;
  const editable = p.user.role === "admin";
  return layout(
    "Base de conhecimento",
    `${p.flash ? `<div class="card">${esc(p.flash)}</div>` : ""}<h1>Base de conhecimento</h1>
     <p class="muted">Planos, preços, cobertura e respostas que o agente pode usar. O que não estiver aqui, ele não inventa.</p>
     ${editable ? `<details class="card"><summary>Adicionar item</summary>${form()}</details>` : ""}
     ${p.items
       .map(
         (k) => `<div class="card"><span class="chip">${k.kind}</span>${k.active ? "" : `<span class="chip">inativo</span>`}<strong>${esc(k.title)}</strong>
           ${editable ? `<details><summary>Editar</summary>${form(k)}</details>` : `<p>${esc(k.body)}</p>`}</div>`,
       )
       .join("")}`,
    p.user,
  );
}
