// Conversa com o agente pelo terminal, sem WhatsApp e com o SGP simulado.
// Uso: ANTHROPIC_API_KEY=... npm run simular [-- --telefone 5511900000003]
// Comandos: /foto <arquivo>  /video <arquivo>  /audio <arquivo>  /massivo <PON>  /pendencias  /sair
import { readFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { buildRouter } from "./app.js";
import type { ChannelGateway, IncomingMessage } from "./channels/types.js";
import { loadConfig } from "./config.js";
import { MemoryStore } from "./store/memory.js";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".mp4": "video/mp4", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
};

const files = new Map<string, string>();
const gateway: ChannelGateway = {
  async sendText(_to, text) {
    console.log(`\n\x1b[32mAssistente:\x1b[0m ${text}\n`);
  },
  async downloadMedia(mediaId) {
    const file = files.get(mediaId)!;
    return { data: await readFile(file), mimeType: MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream" };
  },
};

const args = process.argv.slice(2);
const telefone = args.includes("--telefone") ? args[args.indexOf("--telefone") + 1] : "5511900000003";

const cfg = loadConfig({ ...process.env, DATABASE_URL: "", SGP_MODO: "mock" });
const store = new MemoryStore();
// sem janelas de atendimento: o simulador sempre roda como "fora do horário"
const { router } = buildRouter(cfg, { gateway, store, hours: { windows: [], holidays: [], timeZone: cfg.TZ_ATENDIMENTO } });

console.log(`Simulador do plantão (fora do horário). Cliente: ${telefone}. Clientes de teste: 5511900000001 (online), ...002 (bloqueado), ...003 (offline).`);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let n = 0;
for (;;) {
  const line = (await rl.question("\x1b[36mVocê:\x1b[0m ")).trim();
  if (!line) continue;
  if (line === "/sair") break;
  if (line === "/pendencias") {
    console.table((await store.listPending()).map((p) => ({ prioridade: p.priority, tipo: p.kind, resumo: p.summary, chamado: p.sgpTicketId })));
    continue;
  }
  if (line.startsWith("/massivo ")) {
    const pon = line.slice(9).trim();
    await store.createIncident({ areaType: "pon", areaId: pon, status: "confirmado", message: "Identificamos uma queda de sinal na fibra que atende a sua região e a equipe técnica já está trabalhando no reparo.", eta: null });
    console.log(`(massivo aberto na ${pon})`);
    continue;
  }
  const msg: IncomingMessage = {
    channel: "meta", channelNumber: "teste", channelMessageId: `sim-${++n}`, from: telefone, receivedAt: new Date(),
  };
  const media = line.match(/^\/(foto|video|audio)\s+(.+)$/);
  if (media) {
    const id = `arquivo-${n}`;
    files.set(id, media[2]);
    const kind = media[1] === "foto" ? "image" : media[1] === "video" ? "video" : "audio";
    msg.media = { kind, mediaId: id, mimeType: MIME[path.extname(media[2]).toLowerCase()] ?? "" };
  } else {
    msg.text = line;
  }
  const outcome = await router.handle(msg);
  if (outcome !== "agente" && outcome !== "massivo_sem_ia") console.log(`(${outcome})`);
}
rl.close();
