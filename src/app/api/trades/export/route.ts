import { tradesCsv } from "@/lib/domain/csv";
import { requireUser } from "@/lib/server/auth";
import { filtersFrom } from "@/lib/server/filters";
import { fail } from "@/lib/server/http";
import { listAccounts, listTrades } from "@/lib/server/repo/journal";

const MAX_IDS = 500;

/** The trades matching the filters, or just ?ids=1,2,3, as a CSV that Jarvis can import again. */
export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const params = new URL(req.url).searchParams;
  const rawIds = params.get("ids");
  if (rawIds !== null && !/^\d+(,\d+)*$/.test(rawIds)) return fail("Invalid trade ids.", 400);
  const ids = rawIds === null ? null : new Set(rawIds.split(",").map(Number));
  if (ids && ids.size > MAX_IDS) return fail(`Export up to ${MAX_IDS} selected trades at a time.`, 400);
  const filters = filtersFrom(params);
  if (filters instanceof Response) return filters;
  // A selection was picked from the screen, sample rows included, so the filters don't apply to it.
  const trades = ids ? listTrades(user.id, { includeSample: true }).filter((t) => ids.has(t.id)) : listTrades(user.id, filters);
  return new Response(tradesCsv(trades, listAccounts(user.id)), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="jarvis-trades-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
