// Canal MaxChat: o MaxChat recebe o WhatsApp (Evolution API), avisa o Plantão por webhook e envia
// as respostas pelo mesmo número. Contrato em docs/integracao-maxchat.md.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChannelGateway, IncomingMessage, TransferInfo } from "./types.js";

export class MaxChatGateway implements ChannelGateway {
  private fetchFn: typeof fetch;
  constructor(
    private apiUrl: string,
    private token: string,
    fetchFn?: typeof fetch,
  ) {
    if (!apiUrl || !token) throw new Error("MAXCHAT_API_URL e MAXCHAT_API_TOKEN são obrigatórios no canal maxchat");
    this.apiUrl = apiUrl.replace(/\/$/, "");
    this.fetchFn = fetchFn ?? fetch;
  }

  private async post(path: string, body: unknown) {
    const res = await this.fetchFn(`${this.apiUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`MaxChat ${path} respondeu ${res.status}`);
  }

  // o MaxChat responde no atendimento aberto desse telefone, pelo mesmo canal em que ele chegou
  sendText(to: string, text: string) {
    return this.post("/api/v1/bot/messages", { phone: to, text });
  }

  transfer(to: string, info: TransferInfo) {
    return this.post("/api/v1/bot/transfer", { phone: to, department: info.department, reason: info.reason, priority: info.priority });
  }

  // a mídia chega como link temporário (Cloudflare R2); o "mediaId" é o próprio link
  async downloadMedia(mediaId: string) {
    const res = await this.fetchFn(mediaId, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`mídia do MaxChat respondeu ${res.status}`);
    return { data: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get("content-type") ?? "application/octet-stream" };
  }
}

export function verifyMaxChatSignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!header?.startsWith("sha256=") || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type MaxChatEvent =
  | { kind: "message"; message: IncomingMessage }
  | { kind: "humano"; phone: string } // atendente assumiu ou o robô foi desligado no atendimento
  | { kind: "encerrado"; phone: string }
  | { kind: "ignorar" };

const MEDIA_KINDS = { image: "image", audio: "audio", ptt: "audio", video: "video" } as const;

export function parseMaxChatWebhook(body: any): MaxChatEvent {
  const phone = String(body?.contact?.phone ?? "").replace(/\D/g, "");
  if (!phone) return { kind: "ignorar" };
  if (body.event === "ticket.assigned") return { kind: "humano", phone };
  if (body.event === "ticket.closed") return { kind: "encerrado", phone };
  if (body.event !== "message.received") return { kind: "ignorar" };
  // atendimento já com uma pessoa: o robô não responde
  if (body.ticket?.bot_enabled === false || body.ticket?.assigned_user_id) return { kind: "humano", phone };

  const m = body.message ?? {};
  const mediaKind = MEDIA_KINDS[m.type as keyof typeof MEDIA_KINDS];
  const message: IncomingMessage = {
    channel: "maxchat",
    channelNumber: String(body.channel_id ?? ""),
    channelMessageId: String(m.id ?? body.event_id ?? ""),
    from: phone,
    profileName: body.contact?.name ?? undefined,
    text: m.text ?? m.caption ?? undefined,
    receivedAt: body.timestamp ? new Date(body.timestamp) : new Date(),
    agentsOnline: typeof body.agents_online === "boolean" ? body.agents_online : undefined,
  };
  if (mediaKind && m.media_url) message.media = { kind: mediaKind, mediaId: String(m.media_url), mimeType: String(m.mime_type ?? "") };
  else if (!m.text && m.type && m.type !== "text") message.text = `[mensagem do tipo ${m.type}]`;
  return { kind: "message", message };
}
