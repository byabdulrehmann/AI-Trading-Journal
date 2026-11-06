import { zoneInstant } from "@/lib/domain/zone";
import { displayZone } from "./format";

const pad = (n: number) => String(n).padStart(2, "0");

// Calendar days are built from local parts only, never by adding 24 hours, so DST changes can't shift a day.
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const fromKey = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d ?? 1);
};

export const monthKeyOf = (d: Date) => dayKey(d).slice(0, 7);

/** Monday-first weeks covering a month, spilling into its neighbours. */
export function weeksOf(year: number, month: number): Date[][] {
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const count = new Date(year, month + 1, 0).getDate();
  const rows = Math.ceil((offset + count) / 7);
  return Array.from({ length: rows }, (_, r) => Array.from({ length: 7 }, (_, c) => new Date(year, month, 1 - offset + r * 7 + c)));
}

/** The instants a day covers in the display zone, for a query. Not always 24 hours apart. */
export function dayWindow(key: string): { start: string; end: string } {
  const [y, m, d] = key.split("-").map(Number);
  const tz = displayZone();
  return { start: new Date(zoneInstant(y, m, d, 0, 0, tz)).toISOString(), end: new Date(zoneInstant(y, m, d + 1, 0, 0, tz) - 1).toISOString() };
}
