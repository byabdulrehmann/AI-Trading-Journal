import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { body, fail, json } from "@/lib/server/http";
import { MAX_UPLOAD_BYTES } from "@/lib/domain/csv";
import { parseEventsCsv } from "@/lib/domain/econ";
import { isValidZone } from "@/lib/domain/zone";
import { importEvents } from "@/lib/server/news";

const Body = z.object({
  csv: z.string().min(1, "Choose a file").max(MAX_UPLOAD_BYTES, "That file is too big"),
  zone: z.string().refine((v) => v === "" || isValidZone(v), "Pick a time zone"),
  dayFirst: z.boolean().default(false),
  /** False: only read the file and say what it holds. */
  commit: z.boolean().default(false),
});

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, Body);
  if (data instanceof Response) return data;
  const r = parseEventsCsv(data.csv, { zone: data.zone || undefined, dayFirst: data.dayFirst });
  if (r.missing.length) return fail(`The file needs these columns: ${r.missing.join(", ")}. Check that its first row names the columns.`, 422);
  if (!data.commit) return json({ count: r.events.length, preview: r.events.slice(0, 5), errors: r.errors.slice(0, 50), errorCount: r.errors.length });
  if (!r.events.length) return fail("No events could be read from the file.", 422);
  return json({ ...importEvents(user.id, r.events), errorCount: r.errors.length });
}
