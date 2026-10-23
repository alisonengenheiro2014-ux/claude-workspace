// Recebe cada mensagem e decide: ignorar (equipe atendendo), responder o massivo sem IA, ou chamar o agente.
import { runAgentTurn, type AgentDeps } from "./agent/agent.js";
import type { KnowledgeItem } from "./agent/knowledge.js";
import type { ToolContext } from "./agent/tools.js";
import { AtendimentoComHumano, type ChannelGateway, type IncomingMessage } from "./channels/types.js";
import { isHumanHours, nextOpeningText, type HoursConfig } from "./hours.js";
import type { Transcriber } from "./media/audio.js";
import { describeReading, readEquipment, type CreateBetaMessage } from "./media/vision.js";
import type { SgpClient, SgpCustomer } from "./sgp/types.js";
import type { Incident, PendingKind, Store } from "./store/types.js";

export interface RouterDeps {
  store: Store;
  sgp: SgpClient;
  gateway: ChannelGateway;
  agent: AgentDeps;
  vision: { create: CreateBetaMessage; model: string };
  transcribe: Transcriber | null;
  extractFrames: (video: Buffer) => Promise<{ data: Buffer; mimeType: string }[]>;
  hours: () => Promise<HoursConfig> | HoursConfig;
  knowledge: () => Promise<KnowledgeItem[]> | KnowledgeItem[];
  now?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
  // fila humana por tipo de pendência, para canais com filas (MaxChat)
  filas?: Partial<Record<PendingKind, string>>;
  // homologação: se preenchida, só estes telefones são atendidos (os demais nem são gravados)
  telefonesLiberados?: string[];
}

// nos registros, só o começo e o fim do telefone
export const mascarar = (phone: string) => (phone.length > 6 ? `${phone.slice(0, 4)}*****${phone.slice(-2)}` : "***");

const MEDIA_LABEL = { image: "[foto recebida]", audio: "[áudio recebido]", video: "[vídeo recebido]" } as const;

export type Outcome = "fora_da_homologacao" | "duplicada" | "equipe_atendendo" | "humano_assumiu" | "massivo_sem_ia" | "agente";

export function incidentMessage(inc: Incident, retorno: string): string {
  const previsao = inc.eta
    ? ` A previsão de normalização é ${inc.eta.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}.`
    : " Assim que tivermos previsão, avisamos por aqui.";
  return `${inc.message}${previsao}\nNão precisa abrir chamado: seu atendimento já está registrado nessa ocorrência. Se depois de normalizar ainda ficar sem internet, é só responder aqui. (Equipe de atendimento volta ${retorno}.)`;
}

export class Router {
  private queues = new Map<string, Promise<unknown>>();
  constructor(private deps: RouterDeps) {}

  // mensagens do mesmo cliente são processadas uma de cada vez, na ordem de chegada
  handle(msg: IncomingMessage): Promise<Outcome> {
    const prev = this.queues.get(msg.from) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(() => this.process(msg));
    this.queues.set(msg.from, next);
    next.finally(() => {
      if (this.queues.get(msg.from) === next) this.queues.delete(msg.from);
    }).catch(() => undefined);
    return next;
  }

  private async findCustomer(cpf: string | null, phone: string): Promise<SgpCustomer | null> {
    try {
      return await this.deps.sgp.findCustomer(cpf ? { cpf } : { phone });
    } catch (err) {
      this.deps.log?.("falha ao consultar cliente no SGP", err);
      return null;
    }
  }

  private async process(msg: IncomingMessage): Promise<Outcome> {
    const liberados = this.deps.telefonesLiberados;
    if (liberados?.length && !liberados.includes(msg.from)) return "fora_da_homologacao";
    const { store, gateway } = this.deps;
    const now = this.deps.now?.() ?? new Date();
    const hours = await this.deps.hours();
    const retorno = nextOpeningText(now, hours);

    const contact = await store.upsertContact(msg.from);
    if (msg.profileName && !contact.name) await store.updateContact(contact.id, { name: msg.profileName });
    const conversation = await store.openConversation(contact.id, msg.channel, msg.channelNumber);

    const firstText = msg.text?.trim() || null;
    const isNew = await store.addMessage({
      conversationId: conversation.id,
      author: "cliente",
      body: firstText ?? (msg.media ? MEDIA_LABEL[msg.media.kind] : null),
      channelMessageId: msg.channelMessageId,
    });
    if (!isNew) return "duplicada";
    if (conversation.status === "humano") return "humano_assumiu";

    // massivo vale 24h: a equipe não dá conta de 140 conversas nem no horário comercial
    const customer = await this.findCustomer(contact.cpf, contact.phone);
    const incident = customer ? await store.openIncidentForArea(customer.area) : null;
    if (incident && conversation.incidentId !== incident.id) {
      await store.linkIncidentContact(incident.id, contact.id);
      await store.updateConversation(conversation.id, { topic: "massivo", incidentId: incident.id });
      const text = incidentMessage(incident, retorno);
      if (!(await this.enviar(msg.from, text, conversation.id))) return "humano_assumiu";
      return "massivo_sem_ia";
    }

    // cliente respondendo à pergunta "sua internet voltou?" depois do massivo: a IA fecha o atendimento
    const posMassivo = conversation.closingAt !== null;
    if (posMassivo) await store.setClosingAt(conversation.id, null);
    // no horário da equipe a IA fica quieta, a menos que o canal avise que não há ninguém logado
    if (!incident && !posMassivo && isHumanHours(now, hours) && msg.agentsOnline !== false) return "equipe_atendendo";

    if (msg.media) await this.processMedia(msg, conversation.id);

    const ctx: ToolContext = {
      store,
      sgp: this.deps.sgp,
      contact,
      conversation,
      knowledge: await this.deps.knowledge(),
      customer: contact.sgpCustomerId ? customer : null,
      desbloqueio: this.deps.agent.desbloqueio,
      regras: this.deps.agent.regrasLiberacao,
      now,
    };
    const result = await runAgentTurn(
      {
        history: await store.history(conversation.id),
        agora: now.toLocaleString("pt-BR", { timeZone: hours.timeZone, weekday: "long", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }),
        retornoEquipe: retorno,
        incidente: incident ? incident.message : null,
        posMassivo,
      },
      ctx,
      this.deps.agent,
    );
    this.deps.log?.("agente respondeu", { de: mascarar(msg.from), ferramentas: result.toolCalls, parada: result.stopReason });
    if (!(await this.enviar(msg.from, result.reply, conversation.id))) return "humano_assumiu";
    if (result.toolCalls.includes("registrar_pendencia")) await this.transferir(msg.from, conversation.id);
    return "agente";
  }

  // envia e grava; se o canal avisar que um atendente assumiu, a IA sai do atendimento
  private async enviar(phone: string, text: string, conversationId: string): Promise<boolean> {
    try {
      await this.deps.gateway.sendText(phone, text);
    } catch (err) {
      if (!(err instanceof AtendimentoComHumano)) throw err;
      await this.deps.store.updateConversation(conversationId, { status: "humano" });
      return false;
    }
    await this.deps.store.addMessage({ conversationId, author: "ia", body: text });
    return true;
  }

  // com fila humana no canal, a pendência vira atendimento na fila certa, já com o resumo
  private async transferir(phone: string, conversationId: string) {
    if (!this.deps.gateway.transfer) return;
    const pend = (await this.deps.store.listPending("aberto")).filter((p) => p.conversationId === conversationId).at(-1);
    if (!pend) return;
    try {
      await this.deps.gateway.transfer(phone, {
        department: this.deps.filas?.[pend.kind] ?? "suporte",
        reason: [pend.summary, (pend.data as { detalhes?: string })?.detalhes].filter(Boolean).join(" | "),
        priority: pend.priority === 1 ? "alta" : pend.priority === 3 ? "baixa" : "normal",
      });
    } catch (err) {
      // a pendência continua no painel mesmo se a transferência falhar
      this.deps.log?.("falha ao transferir para a fila", err);
    }
  }

  // um atendente assumiu no canal: a IA para de responder nesse atendimento
  async humanoAssumiu(phone: string) {
    const contact = await this.deps.store.upsertContact(phone);
    const conv = await this.deps.store.openConversation(contact.id, "maxchat", "");
    await this.deps.store.updateConversation(conv.id, { status: "humano" });
  }

  async atendimentoEncerrado(phone: string) {
    const contact = await this.deps.store.upsertContact(phone);
    const conv = await this.deps.store.openConversation(contact.id, "maxchat", "");
    await this.deps.store.updateConversation(conv.id, { status: "closed" });
  }

  // transforma áudio em texto e foto/vídeo em leitura das luzes; tudo entra no histórico
  private async processMedia(msg: IncomingMessage, conversationId: string) {
    const { store, gateway } = this.deps;
    const media = msg.media!;
    try {
      const file = await gateway.downloadMedia(media.mediaId);
      if (media.kind === "audio") {
        if (!this.deps.transcribe) throw new Error("transcrição não configurada");
        const text = await this.deps.transcribe(file.data, file.mimeType);
        await store.addMessage({ conversationId, author: "cliente", body: `[áudio transcrito] ${text}` });
      } else {
        const images = media.kind === "video" ? await this.deps.extractFrames(file.data) : [file];
        const reading = await readEquipment(images, this.deps.vision);
        await store.addMessage({ conversationId, author: "sistema", body: describeReading(reading) });
      }
    } catch (err) {
      this.deps.log?.("falha ao processar mídia", err);
      const aviso =
        media.kind === "audio"
          ? "[não foi possível ouvir o áudio: peça para o cliente escrever]"
          : "[não foi possível analisar a imagem: peça outra foto ou descreva as luzes]";
      await store.addMessage({ conversationId, author: "sistema", body: aviso });
    }
  }
}
