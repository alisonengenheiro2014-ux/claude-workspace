import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { ChannelGateway } from "../src/channels/types.js";
import { HORARIO_PADRAO } from "../src/hours.js";
import { manutencao, normalizacao, startScheduler, varreduraSgp } from "../src/jobs/routines.js";
import { Router } from "../src/router.js";
import { MockSgp, mockRecord } from "../src/sgp/mock.js";
import { MemoryStore } from "../src/store/memory.js";

const t0 = new Date("2026-10-21T02:00:00Z");
const at = (min: number) => new Date(t0.getTime() + min * 60_000);

function setup() {
  const store = new MemoryStore();
  const sgp = new MockSgp(["11", "12", "13", "14", "15"].map((id) => mockRecord(id, "PON-5/1")).concat([mockRecord("21", "PON-5/2")]));
  const sent: { to: string; text: string }[] = [];
  const gateway: ChannelGateway = { sendText: async (to, text) => void sent.push({ to, text }), downloadMedia: async () => { throw new Error(); } };
  return { store, sgp, sent, gateway, deps: { store, sgp, gateway } };
}

describe("rotinas de massivo", () => {
  it("queda da PON abre massivo suspeito, cliente que chama recebe a mensagem sem IA, volta normaliza e avisa", async () => {
    const { store, sgp, sent, gateway, deps } = setup();
    await varreduraSgp(deps, at(0)); // leitura base, tudo online
    expect(await store.listOpenIncidents()).toEqual([]);

    sgp.setPonState("PON-5/1", false);
    expect(await varreduraSgp(deps, at(2))).toEqual(["pon:PON-5/1"]);
    expect(await varreduraSgp(deps, at(4))).toEqual([]); // não duplica
    const [inc] = await store.listOpenIncidents();
    expect(inc).toMatchObject({ status: "suspeito", detectedBy: "varredura", areaId: "PON-5/1" });

    // cliente da PON chama (no horário comercial): massivo responde sem IA
    const noLlm = async () => { throw new Error("não deveria chamar a IA"); };
    const router = new Router({
      store, sgp, gateway,
      agent: { create: noLlm as unknown as (p: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>, model: "x", empresa: "Maxgiga" },
      vision: { create: noLlm as any, model: "x" }, transcribe: null, extractFrames: async () => [],
      hours: () => ({ windows: HORARIO_PADRAO, holidays: [], timeZone: "America/Sao_Paulo" }), knowledge: () => [],
      now: () => new Date("2026-10-21T15:00:00-03:00"),
    });
    const phone11 = "5511900000011";
    const phone12 = "5511900000012";
    for (const from of [phone11, phone12]) {
      expect(await router.handle({ channel: "meta", channelNumber: "n", channelMessageId: `m-${from}`, from, text: "caiu", receivedAt: new Date() })).toBe("massivo_sem_ia");
    }
    expect(sent).toHaveLength(2);
    // o roteador acha o cliente pelo telefone; para a normalização, o contato precisa estar ligado ao SGP
    for (const [phone, id] of [[phone11, "11"], [phone12, "12"]]) {
      const c = store.contacts.find((x) => x.phone === phone)!;
      await store.updateContact(c.id, { sgpCustomerId: id });
    }

    // 4 min depois volta quase tudo, mas o cliente 12 segue offline: ainda não encerra (mínimo 5 min de massivo)
    sgp.setPonState("PON-5/1", true);
    (sgp as any).records.find((r: any) => r.customer.id === "12").status.state = "offline";
    await varreduraSgp(deps, at(4));
    expect(await normalizacao(deps, at(4))).toEqual([]);

    // 10 min: 4 de 5 online (80%) ainda está abaixo do limite padrão de 90%
    await varreduraSgp(deps, at(10));
    expect(await normalizacao(deps, at(10))).toEqual([]);

    // com o limite configurado em 80%, encerra
    const encerrados = await normalizacao({ ...deps, detector: { minClients: 3, minRatio: 0.6, windowMinutes: 10, recoveredRatio: 0.8 } }, at(12));
    expect(encerrados).toEqual([inc.id]);
    expect(sent.slice(2).map((s) => s.to).sort()).toEqual([phone11, phone12]);
    expect(sent[2].text).toContain("normalizada");
    // quem segue offline vira chamado individual
    const pend = await store.listPending("aberto");
    expect(pend).toHaveLength(1);
    expect(pend[0]).toMatchObject({ kind: "chamado_tecnico", priority: 2 });
    expect((pend[0].data as any).cliente).toBe("12");
  });

  it("não abre massivo automático em área que já tem massivo da equipe", async () => {
    const { store, sgp, deps } = setup();
    await varreduraSgp(deps, at(0));
    await store.createIncident({ areaType: "olt", areaId: "OLT-01", status: "confirmado", message: "manual", eta: null });
    sgp.setPonState("PON-5/1", false);
    expect(await varreduraSgp(deps, at(2))).toEqual([]);
  });

  it("manutenção fecha conversa parada e apaga histórico antigo", async () => {
    const store = new MemoryStore();
    const c = await store.upsertContact("5511900000001");
    const conv = await store.openConversation(c.id, "meta", "n");
    await store.addMessage({ conversationId: conv.id, author: "cliente", body: "oi" });
    store.messages[0].sentAt = new Date(Date.now() - 200 * 86_400_000);
    const r = await manutencao(store, new Date(), { inativaHoras: 12, retencaoDias: 180 });
    expect(r).toEqual({ fechadas: 1, apagadas: 1 });
    expect((await store.openConversation(c.id, "meta", "n")).id).not.toBe(conv.id);
  });

  it("agendador não sobrepõe a mesma rotina", async () => {
    let running = 0;
    let max = 0;
    const stop = startScheduler([{ name: "lenta", everyMs: 5, run: async () => {
      running++; max = Math.max(max, running);
      await new Promise((r) => setTimeout(r, 30));
      running--;
    } }]);
    await new Promise((r) => setTimeout(r, 80));
    stop();
    expect(max).toBe(1);
  });
});
