// Gateway para o MaxChat (sistema próprio da Maxgiga).
// Envia mensagens via POST /api/v1/mensagem e recebe via webhook configurável.
import type { ChannelGateway, IncomingMessage } from "./types.js";

export class MaxChatGateway implements ChannelGateway {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private channelNumber: string,
  ) {}

  async sendText(to: string, text: string) {
    // MaxChat espera o número no formato E.164 com +
    const phone = to.startsWith("+") ? to : `+${to}`;
    const res = await fetch(`${this.baseUrl}/api/v1/mensagem`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ clientPhone: phone, message: text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`MaxChat respondeu ${res.status}: ${await res.text()}`);
  }

  // MaxChat (QR Session) não tem endpoint de mídia exposto ainda;
  // quando o webhook entregar mediaUrl já baixamos o binário diretamente.
  async downloadMedia(mediaId: string) {
    const res = await fetch(mediaId, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`download de mídia MaxChat falhou: ${res.status}`);
    const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
    return { data: Buffer.from(await res.arrayBuffer()), mimeType };
  }

  get number() {
    return this.channelNumber;
  }
}

// Converte o payload do webhook MaxChat em mensagens normalizadas.
// Formato esperado (MaxChat envia na automação):
// {
//   "event": "message",
//   "channelNumber": "5527999990000",   // número da empresa
//   "messageId": "abc123",
//   "from": "5527988887777",            // número do cliente (somente dígitos ou com +55)
//   "name": "João Silva",               // nome do perfil (opcional)
//   "timestamp": 1700000000,            // unix seconds
//   "type": "text" | "image" | "audio" | "video",
//   "text": "oi, minha internet caiu",  // para type=text ou legenda de mídia
//   "mediaUrl": "https://..."           // para type=image/audio/video
// }
export function parseMaxChatWebhook(body: unknown, defaultChannelNumber: string): IncomingMessage[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;

  // ignora eventos que não são mensagens de entrada (ex: confirmação de envio)
  if (b["event"] && b["event"] !== "message") return [];

  const from = String(b["from"] ?? "").replace(/\D/g, "");
  const messageId = String(b["messageId"] ?? b["id"] ?? "");
  const channelNumber = String(b["channelNumber"] ?? b["channel"] ?? defaultChannelNumber);
  const timestamp = Number(b["timestamp"] ?? 0);
  const profileName = b["name"] ? String(b["name"]) : undefined;
  const text = b["text"] ? String(b["text"]) : undefined;
  const mediaUrl = b["mediaUrl"] ? String(b["mediaUrl"]) : undefined;
  const type = String(b["type"] ?? "text");

  if (!from || !messageId) return [];

  const base = {
    channel: "chatmix" as const,
    channelNumber,
    channelMessageId: messageId,
    from,
    profileName,
    receivedAt: timestamp ? new Date(timestamp * 1000) : new Date(),
  };

  if (type === "text") {
    return [{ ...base, text: text ?? "" }];
  }

  if (type === "image" || type === "audio" || type === "video") {
    if (!mediaUrl) return [{ ...base, text: `[${type} sem URL]` }];
    return [{ ...base, text, media: { kind: type, mediaId: mediaUrl, mimeType: "" } }];
  }

  if (type === "voice") {
    if (!mediaUrl) return [{ ...base, text: "[áudio sem URL]" }];
    return [{ ...base, media: { kind: "audio", mediaId: mediaUrl, mimeType: "" } }];
  }

  return [{ ...base, text: `[mensagem do tipo ${type}]` }];
}
