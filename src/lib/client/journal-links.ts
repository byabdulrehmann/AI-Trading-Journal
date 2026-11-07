const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Links to the journal keep the filters already on screen. `period` and the calendar's own params mean nothing there. */
export function journalHref(search: string, patch: Record<string, string>): string {
  const next = new URLSearchParams(search);
  for (const k of ["period", "month", "day", "page", "tab"]) next.delete(k);
  // Analytics counts closed trades, so the list it opens must too.
  next.set("closedOnly", "1");
  for (const [k, v] of Object.entries(patch)) next.set(k, v);
  return `/journal?${next.toString()}`;
}

/** The local days a period key covers, by close date because that's how periods are counted. Null for a key that isn't one. */
export function periodRange(period: "day" | "week" | "month" | "year", key: string): { closedFrom: string; closedTo: string } | null {
  const [y, m, d] = key.split("-").map(Number);
  if (!y) return null;
  if (period === "year") return { closedFrom: `${y}-01-01`, closedTo: `${y}-12-31` };
  if (!m) return null;
  if (period === "month") return { closedFrom: ymd(new Date(y, m - 1, 1)), closedTo: ymd(new Date(y, m, 0)) };
  if (!d) return null;
  if (period === "day") return { closedFrom: ymd(new Date(y, m - 1, d)), closedTo: ymd(new Date(y, m - 1, d)) };
  return { closedFrom: ymd(new Date(y, m - 1, d)), closedTo: ymd(new Date(y, m - 1, d + 6)) };
}
