// Transcreve áudio num servidor compatível com /v1/audio/transcriptions (ex.: faster-whisper na própria VPS).

export type Transcriber = (audio: Buffer, mimeType: string) => Promise<string>;

export function httpTranscriber(url: string, model: string): Transcriber {
  return async (audio, mimeType) => {
    const form = new FormData();
    const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mpeg") ? "mp3" : "m4a";
    form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), `audio.${ext}`);
    form.append("model", model);
    form.append("language", "pt");
    const res = await fetch(url, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`transcrição respondeu ${res.status}`);
    const json = (await res.json()) as { text?: string };
    return (json.text ?? "").trim();
  };
}
