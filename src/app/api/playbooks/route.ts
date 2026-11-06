import { missedSummary, playbookStats } from "@/lib/domain/metrics";
import { PlaybookInput } from "@/lib/domain/playbooks";
import { requireUser } from "@/lib/server/auth";
import { filtersFrom } from "@/lib/server/filters";
import { body, fail, json } from "@/lib/server/http";
import { checklistTotals, createPlaybook, listMissed, listPlaybooks, playbookNameTaken } from "@/lib/server/repo/playbooks";
import { currencyScope } from "@/lib/server/scope";

/** Every playbook with its figures for the filters on screen, plus the trades with none. Missed trades ignore the filters. */
export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const filters = filtersFrom(new URL(req.url).searchParams);
  if (filters instanceof Response) return filters;
  const { currency, currencies, trades } = currencyScope(user.id, filters);
  const checks = checklistTotals(user.id);
  const missed = listMissed(user.id, Boolean(filters.includeSample));
  const statsFor = (name: string) => playbookStats(trades.filter((t) => t.strategy === name), checks);
  return json({
    currency,
    currencies,
    playbooks: listPlaybooks(user.id, Boolean(filters.includeSample)).map((p) => ({ ...p, stats: statsFor(p.name), missed: missedSummary(missed.filter((m) => m.strategyId === p.id)) })),
    unassigned: statsFor(""),
  });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, PlaybookInput);
  if (data instanceof Response) return data;
  if (playbookNameTaken(user.id, data.name)) return fail("You already have a playbook with that name.", 422, [{ path: "name", message: "You already have a playbook with that name." }]);
  return json({ playbook: createPlaybook(user.id, data) }, 201);
}
