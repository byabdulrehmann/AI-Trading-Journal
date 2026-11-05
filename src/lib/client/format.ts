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

/** Whole-unit shorthand for tight spots such as a phone-width calendar cell. */
export function compactMoney(n: number): string {
  const abs = Math.abs(n);
  const text = abs >= 1e6 ? `${(abs / 1e6).toFixed(1)}m` : abs >= 1e3 ? `${(abs / 1e3).toFixed(1)}k` : abs.toFixed(0);
  return `${n < 0 ? "−" : n > 0 ? "+" : ""}${text}`;
}

/** The engine's null profit factor means nothing to divide by, which is good news when there are wins. */
export function profitFactorText(m: { profitFactor: number | null; losses: number; wins: number }): string {
  if (m.profitFactor !== null) return m.profitFactor.toFixed(2);
  return m.losses === 0 && m.wins > 0 ? "No losses" : "—";
}

export const SESSION_LABELS: Record<string, string> = {
  sydney: "Sydney",
  tokyo: "Tokyo",
  london: "London",
  new_york: "New York",
  overlap_london_ny: "London/NY overlap",
  off_hours: "Off hours",
};

export const fileSize = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
