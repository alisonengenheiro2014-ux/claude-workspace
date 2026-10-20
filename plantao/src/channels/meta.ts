// WhatsApp Cloud API (Meta) direta. Usada em testes e como alternativa ao Chat Mix.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChannelGateway, IncomingMessage } from "./types.js";

const GRAPH = "https://graph.facebook.com/v23.0";

export class MetaGateway implements ChannelGateway {
  constructor(
    private accessToken: string,
    private phoneNumberId: string,
  ) {}

  async sendText(to: string, text: string) {
    const res = await fetch(`${GRAPH}/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Meta respondeu ${res.status}: ${await res.text()}`);
  }

  async downloadMedia(mediaId: string) {
    const auth = { authorization: `Bearer ${this.accessToken}` };
    const meta = await fetch(`${GRAPH}/${mediaId}`, { headers: auth });
    if (!meta.ok) throw new Error(`Meta mídia ${mediaId}: ${meta.status}`);
    const { url, mime_type } = (await meta.json()) as { url: string; mime_type: string };
    const file = await fetch(url, { headers: auth });
    if (!file.ok) throw new Error(`Meta download ${mediaId}: ${file.status}`);
    return { data: Buffer.from(await file.arrayBuffer()), mimeType: mime_type };
  }
}

// Confere a assinatura X-Hub-Signature-256 com o segredo do app.
export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith("sha256=") || !appSecret) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Converte o payload do webhook em mensagens normalizadas (ignora status de entrega).
export function parseMetaWebhook(body: any): IncomingMessage[] {
  const out: IncomingMessage[] = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const number = value.metadata?.display_phone_number ?? "";
      const names = new Map<string, string>((value.contacts ?? []).map((c: any) => [c.wa_id, c.profile?.name]));
      for (const m of value.messages ?? []) {
        const base = {
          channel: "meta" as const,
          channelNumber: number,
          channelMessageId: m.id,
          from: String(m.from).replace(/\D/g, ""),
          profileName: names.get(m.from),
          receivedAt: new Date(Number(m.timestamp) * 1000),
        };
        if (m.type === "text") out.push({ ...base, text: m.text?.body ?? "" });
        else if (m.type === "image" || m.type === "audio" || m.type === "video") {
          const media = m[m.type];
          out.push({
            ...base,
            text: media?.caption,
            media: { kind: m.type, mediaId: media.id, mimeType: media.mime_type },
          });
        } else if (m.type === "voice") {
          out.push({ ...base, media: { kind: "audio", mediaId: m.voice.id, mimeType: m.voice.mime_type } });
        } else {
          out.push({ ...base, text: `[mensagem do tipo ${m.type}]` });
        }
      }
    }
  }
  return out;
}
