import "server-only";
import { z } from "zod";
import { ASSET_CLASSES } from "@/lib/domain/engine/instruments";
import { EMOTIONS, GRADES, MISTAKES } from "@/lib/domain/types";
import type { TradeFilters } from "./repo/journal";
import { fail } from "./http";

const FilterQuery = z.object({
  accountId: z.coerce.number().int().positive().optional(),
  symbol: z.string().trim().max(30).optional(),
  strategy: z.string().trim().max(60).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  source: z.enum(["manual", "csv", "sample", "mt5"]).optional(),
  outcome: z.enum(["win", "loss", "breakeven", "open", "pending"]).optional(),
  closedFrom: z.iso.datetime().optional(),
  closedTo: z.iso.datetime().optional(),
  plan: z.enum(["on", "off", "unanswered"]).optional(),
  session: z.string().trim().max(30).optional(),
  side: z.enum(["long", "short"]).optional(),
  weekday: z.coerce.number().int().min(0).max(6).optional(),
  hour: z.coerce.number().int().min(0).max(23).optional(),
  closedOnly: z.enum(["1"]).optional(),
  tag: z.string().trim().max(30).optional(),
  mistake: z.enum(MISTAKES).optional(),
  emotion: z.enum(EMOTIONS).optional(),
  grade: z.enum(GRADES).optional(),
  assetClass: z.enum(ASSET_CLASSES).optional(),
  rMin: z.coerce.number().min(-1e6).max(1e6).optional(),
  rMax: z.coerce.number().min(-1e6).max(1e6).optional(),
  holdMin: z.coerce.number().min(0).max(1e9).optional(),
  holdMax: z.coerce.number().min(0).max(1e9).optional(),
  q: z.string().trim().max(100).optional(),
  currency: z.string().trim().length(3).optional(),
  includeSample: z.enum(["1"]).optional(),
});

/** Reads the shared trade filters from a query string. Empty values mean "not filtered". */
export function filtersFrom(params: URLSearchParams): TradeFilters | Response {
  const raw = Object.fromEntries([...params].filter(([k, v]) => v !== "" && k in FilterQuery.shape));
  const parsed = FilterQuery.safeParse(raw);
  if (!parsed.success) return fail("Invalid filters.", 400, parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  const { includeSample, closedOnly, ...rest } = parsed.data;
  return { ...rest, includeSample: includeSample === "1", closedOnly: closedOnly === "1" };
}
