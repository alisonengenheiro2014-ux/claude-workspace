// Detecção de massivo a partir das leituras do SGP. Funções puras: recebem o estado e devolvem decisões.
import type { ConnectionSnapshot } from "../sgp/types.js";

export interface StoredSnapshot extends ConnectionSnapshot {
  changedAt: Date; // quando o cliente mudou de estado pela última vez
}

export interface DetectorConfig {
  minClients: number; // mínimo de clientes caídos para considerar massivo
  minRatio: number; // fração da área que caiu
  windowMinutes: number; // as quedas precisam ter acontecido dentro desta janela
  recoveredRatio: number; // fração online para considerar normalizado
}

export const DETECTOR_PADRAO: DetectorConfig = { minClients: 3, minRatio: 0.6, windowMinutes: 10, recoveredRatio: 0.9 };

export type AreaType = "pon" | "olt" | "pop";
export interface AreaRef {
  type: AreaType;
  id: string;
}

// Junta a leitura nova com a anterior, guardando quando cada cliente mudou de estado.
export function mergeSnapshots(prev: StoredSnapshot[], current: ConnectionSnapshot[], now: Date): StoredSnapshot[] {
  const before = new Map(prev.map((s) => [s.customerId, s]));
  return current.map((c) => {
    const old = before.get(c.customerId);
    const changedAt = old && old.online === c.online ? old.changedAt : now;
    return { ...c, changedAt };
  });
}

const areaId = (s: ConnectionSnapshot, type: AreaType) => s.area[type];

function groupBy(snaps: StoredSnapshot[], type: AreaType): Map<string, StoredSnapshot[]> {
  const map = new Map<string, StoredSnapshot[]>();
  for (const s of snaps) {
    const key = areaId(s, type);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  return map;
}

// Áreas que acabaram de cair, da menor para a maior: uma OLT só entra quando duas ou mais PONs dela
// caíram (e a OLT como um todo passa no critério); um POP, quando duas ou mais OLTs caíram.
// Assim uma rede que passa toda por uma PON gera massivo da PON, não do POP.
export function detectOutages(snaps: StoredSnapshot[], now: Date, cfg: DetectorConfig = DETECTOR_PADRAO): AreaRef[] {
  const since = now.getTime() - cfg.windowMinutes * 60_000;
  const isDown = (group: StoredSnapshot[]) => {
    const recentDrops = group.filter((s) => !s.online && s.changedAt.getTime() >= since).length;
    const offline = group.filter((s) => !s.online).length;
    return recentDrops >= cfg.minClients && offline / group.length >= cfg.minRatio;
  };
  // filhos distintos de cada área maior (PONs de cada OLT, OLTs de cada POP)
  const children = (parent: AreaType, child: AreaType, parentId: string, down: Set<string>) =>
    new Set(snaps.filter((s) => s.area[parent] === parentId && down.has(s.area[child])).map((s) => s.area[child])).size;

  const downPons = new Set([...groupBy(snaps, "pon")].filter(([, g]) => isDown(g)).map(([id]) => id));
  const downOlts = new Set(
    [...groupBy(snaps, "olt")].filter(([id, g]) => children("olt", "pon", id, downPons) >= 2 && isDown(g)).map(([id]) => id),
  );
  const downPops = new Set(
    [...groupBy(snaps, "pop")].filter(([id, g]) => children("pop", "olt", id, downOlts) >= 2 && isDown(g)).map(([id]) => id),
  );

  const out: AreaRef[] = [...downPops].map((id) => ({ type: "pop" as const, id }));
  for (const id of downOlts) {
    const inPop = snaps.some((s) => s.area.olt === id && downPops.has(s.area.pop));
    if (!inPop) out.push({ type: "olt", id });
  }
  for (const id of downPons) {
    const covered = snaps.some((s) => s.area.pon === id && (downOlts.has(s.area.olt) || downPops.has(s.area.pop)));
    if (!covered) out.push({ type: "pon", id });
  }
  return out;
}

// Fração online de uma área; null se a área não tem clientes conhecidos.
export function onlineRatio(snaps: StoredSnapshot[], area: AreaRef): number | null {
  const group = snaps.filter((s) => areaId(s, area.type) === area.id);
  if (!group.length) return null;
  return group.filter((s) => s.online).length / group.length;
}
