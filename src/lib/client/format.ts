export function money(n: number | null | undefined, currency = "USD", signed = false): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = n < 0 ? "−" : signed && n > 0 ? "+" : "";
  return `${sign}${currencySymbol(currency)}${abs}`;
}

function currencySymbol(c: string) {
  return { USD: "$", EUR: "€", GBP: "£", JPY: "¥" }[c] ?? `${c} `;
}

export const pct = (x: number | null | undefined, dp = 0) =>
  x === null || x === undefined ? "—" : `${(x * 100).toFixed(dp)}%`;

export const rFmt = (r: number | null | undefined) =>
  r === null || r === undefined ? "—" : `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(2)}R`;

export function dateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function dateOnly(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function duration(minutes: number | null) {
  if (minutes === null) return "—";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 60 * 24) return `${(minutes / 60).toFixed(1)} h`;
  return `${(minutes / 1440).toFixed(1)} d`;
}

export const toneOf = (n: number | null | undefined) =>
  n === null || n === undefined || n === 0 ? "text-ink-soft" : n > 0 ? "text-profit" : "text-loss";

/** "2026-11-03T09:30" for <input type="datetime-local"> in local time. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}
