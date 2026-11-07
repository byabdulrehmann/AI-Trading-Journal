import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { filtersFrom } from "@/lib/server/filters";
import { body, json } from "@/lib/server/http";
import { getTrade, listTrades } from "@/lib/server/repo/journal";
import { tradeBars } from "@/lib/server/tradeBars";

const Body = z.object({ limit: z.number().int().min(1).max(25).default(10), skip: z.array(z.number().int().positive()).max(5000).default([]) });

/**
 * Reads MAE and MFE for closed trades not read yet, a few at a time so the page can show progress.
 * Trades with no prices come back in `failed`, for the caller to skip next time.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, Body);
  if (data instanceof Response) return data;
  const filters = filtersFrom(new URL(req.url).searchParams);
  if (filters instanceof Response) return filters;
  const skip = new Set(data.skip);
  const pending = listTrades(user.id, { ...filters, closedOnly: true }).filter((t) => t.mae === null && !skip.has(t.id));
  const failed: number[] = [];
  let reason: string | null = null;
  let read = 0;
  for (const t of pending.slice(0, data.limit)) {
    const full = getTrade(user.id, t.id);
    if (!full) continue;
    const r = await tradeBars(user.id, full);
    if (r.bars.length) read++;
    else {
      failed.push(t.id);
      reason = r.reason;
    }
  }
  return json({ read, failed, reason, remaining: Math.max(0, pending.length - Math.min(pending.length, data.limit)) });
}
