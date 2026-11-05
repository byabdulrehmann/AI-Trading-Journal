import { requireUser } from "@/lib/server/auth";
import { fail } from "@/lib/server/http";
import { batchErrorsCsv } from "@/lib/server/import/service";

/** Downloads the rows a past import couldn't use. */
export async function GET(_req: Request, ctx: { params: Promise<{ batch: string }> }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { batch } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(batch)) return fail("Invalid import id.", 404);
  const csv = batchErrorsCsv(user.id, batch);
  if (csv === null) return fail("That import doesn't exist.", 404);
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="import-${batch}-errors.csv"` } });
}
