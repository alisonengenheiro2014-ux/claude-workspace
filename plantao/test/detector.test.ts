import { describe, expect, it } from "vitest";
import { detectOutages, mergeSnapshots, onlineRatio, type StoredSnapshot } from "../src/jobs/detector.js";

const now = new Date("2026-10-21T02:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);
const snap = (id: string, pon: string, online: boolean, changedMinAgo = 60, olt = "OLT-01"): StoredSnapshot => ({
  customerId: id, area: { pop: "POP-1", olt, pon }, online, changedAt: ago(changedMinAgo),
});

describe("detector de massivo", () => {
  it("guarda quando cada cliente mudou de estado", () => {
    const prev = [snap("1", "A", true, 120), snap("2", "A", true, 120)];
    const merged = mergeSnapshots(prev, [{ ...prev[0] }, { ...prev[1], online: false }], now);
    expect(merged[0].changedAt).toEqual(ago(120));
    expect(merged[1].changedAt).toEqual(now);
  });

  it("PON com 4 de 5 clientes caindo agora vira massivo", () => {
    const s = [snap("1", "A", false, 2), snap("2", "A", false, 3), snap("3", "A", false, 1), snap("4", "A", false, 4), snap("5", "A", true)];
    expect(detectOutages(s, now)).toEqual([{ type: "pon", id: "A" }]);
  });

  it("clientes offline há horas (inadimplentes, viagem) não disparam massivo", () => {
    const s = [snap("1", "A", false, 300), snap("2", "A", false, 400), snap("3", "A", false, 500), snap("4", "A", true)];
    expect(detectOutages(s, now)).toEqual([]);
  });

  it("dois clientes caindo não bastam (mínimo 3)", () => {
    const s = [snap("1", "A", false, 1), snap("2", "A", false, 1), snap("3", "A", true)];
    expect(detectOutages(s, now)).toEqual([]);
  });

  it("poucos caídos numa área grande não é massivo (abaixo de 60%)", () => {
    const s = [snap("1", "A", false, 1), snap("2", "A", false, 1), snap("3", "A", false, 1), ...["4", "5", "6", "7", "8"].map((id) => snap(id, "A", true))];
    expect(detectOutages(s, now)).toEqual([]);
  });

  it("OLT inteira caindo vira um massivo da OLT, não um por PON", () => {
    const s = ["1", "2", "3"].map((id) => snap(id, "A", false, 1)).concat(["4", "5", "6"].map((id) => snap(id, "B", false, 2)));
    s.push(snap("7", "C", false, 1, "OLT-02"), snap("8", "C", true, 60, "OLT-02"));
    expect(detectOutages(s, now)).toEqual([{ type: "olt", id: "OLT-01" }]);
  });

  it("rede inteira numa PON só: massivo da PON, não do POP", () => {
    const s = ["1", "2", "3", "4"].map((id) => snap(id, "A", false, 1));
    expect(detectOutages(s, now)).toEqual([{ type: "pon", id: "A" }]);
  });

  it("duas OLTs caindo no mesmo POP vira massivo do POP", () => {
    const s = [
      ...["1", "2", "3"].map((id) => snap(id, "A", false, 1)), ...["4", "5", "6"].map((id) => snap(id, "B", false, 1)),
      ...["7", "8", "9"].map((id) => snap(id, "C", false, 1, "OLT-02")), ...["10", "11", "12"].map((id) => snap(id, "D", false, 1, "OLT-02")),
    ];
    expect(detectOutages(s, now)).toEqual([{ type: "pop", id: "POP-1" }]);
  });

  it("fração online da área", () => {
    const s = [snap("1", "A", true), snap("2", "A", false), snap("3", "B", false)];
    expect(onlineRatio(s, { type: "pon", id: "A" })).toBe(0.5);
    expect(onlineRatio(s, { type: "pon", id: "Z" })).toBeNull();
  });
});
