// Decide se há atendimento humano num dado instante, no fuso da empresa.

export interface HoursWindow {
  weekday: number; // 0 = domingo
  opensAt: string; // "08:00"
  closesAt: string; // "21:00"
}

export interface HoursConfig {
  windows: HoursWindow[];
  holidays: string[]; // "2026-12-25"
  timeZone: string;
}

// Horário informado pela Maxgiga: seg a sex 8h-21h, sábado 8h-12h, domingo sem equipe.
export const HORARIO_PADRAO: HoursWindow[] = [
  ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, opensAt: "08:00", closesAt: "21:00" })),
  { weekday: 6, opensAt: "08:00", closesAt: "12:00" },
];

function localParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function isHumanHours(at: Date, cfg: HoursConfig): boolean {
  const local = localParts(at, cfg.timeZone);
  if (cfg.holidays.includes(local.date)) return false;
  return cfg.windows.some(
    (w) =>
      w.weekday === local.weekday &&
      local.minutes >= toMinutes(w.opensAt) &&
      local.minutes < toMinutes(w.closesAt),
  );
}

// Próxima abertura, em texto para o cliente ("amanhã às 08:00", "segunda às 08:00").
export function nextOpeningText(at: Date, cfg: HoursConfig): string {
  const dias = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const local = localParts(at, cfg.timeZone);
  for (let offset = 0; offset <= 14; offset++) {
    const probe = new Date(at.getTime() + offset * 86_400_000);
    const p = localParts(probe, cfg.timeZone);
    if (cfg.holidays.includes(p.date)) continue;
    const windows = cfg.windows
      .filter((w) => w.weekday === p.weekday)
      .filter((w) => offset > 0 || toMinutes(w.opensAt) > local.minutes)
      .sort((a, b) => toMinutes(a.opensAt) - toMinutes(b.opensAt));
    if (windows.length) {
      const quando = offset === 0 ? "hoje" : offset === 1 ? "amanhã" : dias[p.weekday];
      return `${quando} às ${windows[0].opensAt}`;
    }
  }
  return "no próximo dia útil";
}
