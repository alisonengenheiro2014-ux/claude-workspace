import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseMetaWebhook, verifyMetaSignature } from "../src/channels/meta.js";

const payload = {
  entry: [{
    changes: [{
      value: {
        metadata: { display_phone_number: "551130000000" },
        contacts: [{ wa_id: "5511900000003", profile: { name: "Carla" } }],
        messages: [
          { id: "wamid.1", from: "5511900000003", timestamp: "1760000000", type: "text", text: { body: "sem internet" } },
          { id: "wamid.2", from: "5511900000003", timestamp: "1760000001", type: "image", image: { id: "m1", mime_type: "image/jpeg", caption: "olha" } },
          { id: "wamid.3", from: "5511900000003", timestamp: "1760000002", type: "audio", audio: { id: "m2", mime_type: "audio/ogg" } },
        ],
      },
    }],
  }],
};

describe("webhook da Meta", () => {
  it("normaliza texto, imagem e áudio", () => {
    const msgs = parseMetaWebhook(payload);
    expect(msgs).toHaveLength(3);
    expect(msgs[0]).toMatchObject({ channelMessageId: "wamid.1", from: "5511900000003", text: "sem internet", profileName: "Carla" });
    expect(msgs[1].media).toEqual({ kind: "image", mediaId: "m1", mimeType: "image/jpeg" });
    expect(msgs[1].text).toBe("olha");
    expect(msgs[2].media?.kind).toBe("audio");
  });

  it("ignora payload só de status de entrega", () => {
    expect(parseMetaWebhook({ entry: [{ changes: [{ value: { statuses: [{ id: "x" }] } }] }] })).toEqual([]);
  });

  it("aceita assinatura correta e recusa a errada", () => {
    const raw = Buffer.from(JSON.stringify(payload));
    const sig = "sha256=" + createHmac("sha256", "segredo").update(raw).digest("hex");
    expect(verifyMetaSignature(raw, sig, "segredo")).toBe(true);
    expect(verifyMetaSignature(raw, sig, "outro")).toBe(false);
    expect(verifyMetaSignature(raw, undefined, "segredo")).toBe(false);
  });
});
