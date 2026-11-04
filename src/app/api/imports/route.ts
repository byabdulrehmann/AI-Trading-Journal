import { z } from "zod";
import { CSV_FIELDS, guessMapping, mapRows, parseCsv, tradeKey, type CsvField } from "@/lib/domain/csv";
import { body, dynamic, fail, json } from "@/lib/server/http";
import { computePnl, round } from "@/lib/domain/trade-math";
import { getAccount, importTrades, listTrades } from "@/lib/server/repo/journal";
import { recordActivity } from "@/lib/server/repo/activity";

const fieldKeys = Object.keys(CSV_FIELDS) as [CsvField, ...CsvField[]];

const Body = z.object({
  csv: z.string().min(1, "The file is empty").max(5_000_000, "Files over 5 MB aren't supported yet"),
  accountId: z.number().int().positive(),
  mapping: z.partialRecord(z.enum(fieldKeys), z.number().int().min(0)).optional(),
  numberFormat: z.enum(["dot", "comma"]).optional(),
  dateOrder: z.enum(["dmy", "mdy"]).optional(),
  contractSizes: z.record(z.string(), z.number().positive()).optional(),
  /** false = preview only (nothing is written); true = import the valid rows. */
  commit: z.boolean().default(false),
});

export async function POST(req: Request) {
  await dynamic();
  const data = await body(req, Body);
  if (data instanceof Response) return data;
  if (!getAccount(data.accountId)) return fail("That account doesn't exist.", 422);

  const rows = parseCsv(data.csv);
  if (rows.length < 2) return fail("The file needs a header row and at least one trade.", 422);
  const [headers, ...records] = rows;
  if (records.length > 5000) return fail("Import up to 5,000 rows at a time.", 422);
  const mapping = data.mapping ?? guessMapping(headers);
  const existing = new Set(listTrades({ accountId: data.accountId }).map(tradeKey));
  const results = mapRows(records, mapping, data.accountId, data).map((r) =>
    r.trade && existing.has(tradeKey(r.trade)) ? { line: r.line, ok: false, duplicate: true, errors: [] } : r,
  );
  const valid = results.filter((r) => r.ok);
  const duplicates = results.filter((r) => r.duplicate).length;

  if (!data.commit) {
    return json({
      headers,
      mapping,
      total: results.length,
      valid: valid.length,
      invalid: results.length - valid.length - duplicates,
      duplicates,
      netPnl: round(valid.reduce((sum, r) => sum + (computePnl(r.trade!) ?? 0), 0)),
      symbols: [...new Set(valid.map((r) => r.trade!.symbol))].sort(),
      preview: results.slice(0, 50),
      errors: results.filter((r) => !r.ok && !r.duplicate).slice(0, 50),
    });
  }
  if (valid.length === 0) return fail("No valid rows to import.", 422);
  const { batch, count } = importTrades(valid.map((r) => r.trade!));
  recordActivity("import.committed", { rows: count });
  return json({ batch, imported: count, skipped: results.length - count - duplicates, duplicates }, 201);
}
