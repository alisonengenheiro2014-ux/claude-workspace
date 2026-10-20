import { describe, expect, it } from "vitest";
import { HORARIO_PADRAO, isHumanHours, nextOpeningText, type HoursConfig } from "../src/hours.js";

const cfg: HoursConfig = { windows: HORARIO_PADRAO, holidays: ["2026-11-02"], timeZone: "America/Sao_Paulo" };
// São Paulo = UTC-3
const sp = (iso: string) => new Date(`${iso}-03:00`);

describe("horário humano", () => {
  it("terça 10h tem equipe", () => expect(isHumanHours(sp("2026-10-20T10:00:00"), cfg)).toBe(true));
  it("terça 21h já é plantão (fecha às 21h)", () => expect(isHumanHours(sp("2026-10-20T21:00:00"), cfg)).toBe(false));
  it("terça 20h59 ainda tem equipe", () => expect(isHumanHours(sp("2026-10-20T20:59:00"), cfg)).toBe(true));
  it("sábado 11h tem equipe", () => expect(isHumanHours(sp("2026-10-24T11:00:00"), cfg)).toBe(true));
  it("sábado 13h é plantão", () => expect(isHumanHours(sp("2026-10-24T13:00:00"), cfg)).toBe(false));
  it("domingo é plantão", () => expect(isHumanHours(sp("2026-10-25T10:00:00"), cfg)).toBe(false));
  it("feriado é plantão", () => expect(isHumanHours(sp("2026-11-02T10:00:00"), cfg)).toBe(false));
  it("usa o fuso de SP mesmo quando em UTC já é outro dia", () =>
    // 23h de segunda em SP = 02h de terça em UTC
    expect(isHumanHours(new Date("2026-10-20T02:00:00Z"), cfg)).toBe(false));
});

describe("texto de retorno da equipe", () => {
  it("de madrugada: hoje às 08:00", () => expect(nextOpeningText(sp("2026-10-20T03:00:00"), cfg)).toBe("hoje às 08:00"));
  it("terça 22h: amanhã às 08:00", () => expect(nextOpeningText(sp("2026-10-20T22:00:00"), cfg)).toBe("amanhã às 08:00"));
  it("sábado 15h: segunda às 08:00", () => expect(nextOpeningText(sp("2026-10-24T15:00:00"), cfg)).toBe("segunda às 08:00"));
  it("domingo antes do feriado de segunda: terça às 08:00", () =>
    expect(nextOpeningText(sp("2026-11-01T15:00:00"), cfg)).toBe("terça às 08:00"));
});
