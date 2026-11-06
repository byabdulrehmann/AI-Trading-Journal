/**
 * Calendar parts of an instant in a chosen time zone. With no zone, this computer's.
 * The one place that turns instants into days and hours, so a day means the same on every page.
 */
export interface ZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** Sunday is 0. */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

export function zoneParts(ms: number, tz?: string): ZoneParts {
  if (!tz) {
    const d = new Date(ms);
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes(), weekday: d.getDay() };
  }
  const p = Object.fromEntries(formatter(tz).formatToParts(ms).map((x) => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour), minute: Number(p.minute), weekday: WEEKDAYS[p.weekday] };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function zoneDateKey(iso: string | number, tz?: string): string {
  const p = zoneParts(typeof iso === "number" ? iso : Date.parse(iso), tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * The instant a wall-clock time falls on in a zone. Days and months may overflow, as in new Date(y, m, d + 1).
 * A time skipped by a clock change lands just after the change.
 */
export function zoneInstant(year: number, month: number, day: number, hour = 0, minute = 0, tz?: string): number {
  if (!tz) return new Date(year, month - 1, day, hour, minute).getTime();
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wall;
  // Twice, because the first guess can sit on the other side of a clock change.
  for (let i = 0; i < 2; i++) {
    const p = zoneParts(guess, tz);
    guess += wall - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  }
  return guess;
}
