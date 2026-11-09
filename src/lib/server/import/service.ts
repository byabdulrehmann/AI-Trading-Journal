import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ADAPTERS, detectTable } from "@/lib/domain/import/adapters";
import {
  CSV_FIELDS,
  MAX_DATA_ROWS,
  cellText,
  invalidRowsCsv,
  mapRows,
  side,
  tradeKey,
  type Cell,
  type ColumnMapping,
  type CsvField,
  type ImportPreview,
  type ImportResult,
  type InvalidRow,
  type RowResult,
} from "@/lib/domain/csv";
import { computePnl, round } from "@/lib/domain/trade-math";
import { dataPath, db } from "../db";
import { recordActivity } from "../repo/activity";
import { existingSourceKeys, getAccount, importTrades, listInstruments } from "../repo/journal";
import { UploadError } from "./errors";
import { readUpload } from "./upload";

const fieldKeys = Object.keys(CSV_FIELDS) as [CsvField, ...CsvField[]];

/** The non-file part of a multipart upload, sent as JSON in the `options` field. */
export const ImportRequest = z.object({
  accountId: z.number().int().positive(),
  /** false = preview only (nothing is written); true = import the valid rows. */
  commit: z.boolean().default(false),
  sheet: z.string().max(200).optional(),
  adapter: z.enum(ADAPTERS.map((a) => a.id) as [string, ...string[]]).optional(),
  mapping: z.partialRecord(z.enum(fieldKeys), z.number().int().min(0)).optional(),
  numberFormat: z.enum(["dot", "comma"]).optional(),
  dateOrder: z.enum(["dmy", "mdy"]).optional(),
  contractSizes: z.record(z.string(), z.number().positive()).optional(),
  symbolMap: z.record(z.string(), z.string().trim().min(1).max(20)).optional(),
  sideMap: z.record(z.string(), z.enum(["long", "short"])).optional(),
});
export type ImportRequest = z.output<typeof ImportRequest>;

export interface UploadedFile {
  name: string;
  bytes: Uint8Array;
}

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

/** One key per row, stable across re-imports. Occurrence numbers keep identical partial fills apart. */
function assignSourceKeys(results: RowResult[], rows: Cell[][], mapping: ColumnMapping): void {
  const seen = new Map<string, number>();
  const tickets = new Map<string, number>();
  for (const [i, r] of results.entries()) {
    if (!r.ok || !r.trade) continue;
    const ticket = mapping.sourceId === undefined ? "" : cellText(rows[i][mapping.sourceId]).trim();
    if (ticket) {
      const first = tickets.get(ticket);
      if (first !== undefined) {
        // Two different rows can't both be this ticket, and picking one would be a guess.
        results[i] = { line: r.line, ok: false, errors: [`Ticket ${ticket.slice(0, 40)} is also on line ${first}`] };
        continue;
      }
      tickets.set(ticket, r.line);
      r.sourceKey = `ticket:${ticket}`;
    } else {
      const key = tradeKey(r.trade);
      const occurrence = (seen.get(key) ?? 0) + 1;
      seen.set(key, occurrence);
      r.sourceKey = `row:${sha256(`${key}|${occurrence}`).slice(0, 40)}`;
    }
  }
}

/** Soft-deleted trades keep their key and the unique index still covers them, so inserting one again would fail the whole import. */
function keysInUse(userId: number, accountId: number): Set<string> {
  const deleted = db()
    .prepare("SELECT source_key FROM trades WHERE user_id = ? AND account_id = ? AND source_key IS NOT NULL AND deleted_at IS NOT NULL")
    .all(userId, accountId) as { source_key: string }[];
  const keys = existingSourceKeys(userId, accountId);
  for (const r of deleted) keys.add(r.source_key);
  return keys;
}

interface Analysis {
  preview: ImportPreview;
  rows: { trade: NonNullable<RowResult["trade"]>; sourceKey: string }[];
  invalidRows: InvalidRow[];
}

function analyse(userId: number, file: UploadedFile, req: ImportRequest): Analysis {
  if (!getAccount(userId, req.accountId)) throw new UploadError("That account doesn't exist.", 404);
  const upload = readUpload(file.name, file.bytes, req.sheet);
  const table = detectTable(upload.rows, req.adapter);
  if (table.rows.length === 0) throw new UploadError("The file needs a header row and at least one trade.");
  if (table.rows.length > MAX_DATA_ROWS) throw new UploadError(`Import up to ${MAX_DATA_ROWS.toLocaleString("en-US")} rows at a time. This file has ${table.rows.length.toLocaleString("en-US")}.`, 413);

  const mapping = req.mapping ?? table.mapping;
  const known = Object.fromEntries(listInstruments(userId, req.accountId).flatMap((i) => (i.contractSize && i.contractSize > 0 ? [[i.symbol, i.contractSize]] : [])));
  const contractSizes: Record<string, number> = { ...known, ...req.contractSizes };
  const cells = table.rows.map((r) => r.cells);
  const results = mapRows(cells, mapping, req.accountId, { ...req, contractSizes }, table.rows.map((r) => r.line));
  assignSourceKeys(results, cells, mapping);

  const existing = keysInUse(userId, req.accountId);
  const fresh: RowResult[] = [];
  const duplicateLines: number[] = [];
  const invalidRows: InvalidRow[] = [];
  results.forEach((r, i) => {
    if (r.ok && r.sourceKey && existing.has(r.sourceKey)) duplicateLines.push(r.line);
    else if (r.ok) fresh.push(r);
    else invalidRows.push({ line: r.line, errors: r.errors, raw: cells[i].map(cellText).join(" | ").slice(0, 300) });
  });

  const col = (field: CsvField, row: Cell[]) => (mapping[field] === undefined ? "" : cellText(row[mapping[field]]).trim());
  const symbols = [...new Set(cells.map((row) => col("symbol", row).toUpperCase()).filter(Boolean))].sort().slice(0, 200);
  const sides = [...new Set(cells.map((row) => col("side", row)).filter(Boolean))];
  const flagged = fresh.filter((r) => r.warnings?.length);

  return {
    rows: fresh.map((r) => ({ trade: r.trade!, sourceKey: r.sourceKey! })),
    invalidRows,
    preview: {
      fileName: file.name,
      sha256: sha256(file.bytes),
      format: upload.format,
      sheets: upload.sheets,
      sheet: upload.sheet,
      adapter: table.adapter,
      adapterMatched: table.matched,
      headerLine: table.headerLine,
      headers: table.headers,
      mapping,
      total: results.length,
      valid: fresh.length,
      invalid: invalidRows.length,
      duplicates: duplicateLines.length,
      duplicateLines,
      trailingRows: table.trailingRows,
      netPnl: round(fresh.reduce((sum, r) => sum + (computePnl(r.trade!) ?? 0), 0)),
      mismatches: fresh.filter((r) => r.mismatch).length,
      symbols: symbols.map((symbol) => ({ symbol, contractSize: contractSizes[symbol] ?? contractSizes[req.symbolMap?.[symbol]?.toUpperCase() ?? ""] ?? null })),
      unknownSides: sides.filter((s) => side(s, req.sideMap) === null).slice(0, 50),
      feesMapped: mapping.fees !== undefined || mapping.swap !== undefined,
      preview: fresh.slice(0, 50),
      flagged: flagged.slice(0, 500),
      errors: invalidRows,
    },
  };
}

/** Reads the file and reports what would happen. Nothing is written. */
export function previewImport(userId: number, file: UploadedFile, req: ImportRequest): ImportPreview {
  return analyse(userId, file, req).preview;
}

/** The original file is kept under a random name; if the transaction fails, it goes too and nothing remains. */
export function commitImport(userId: number, file: UploadedFile, req: ImportRequest): ImportResult {
  const { preview, rows, invalidRows } = analyse(userId, file, req);
  if (rows.length === 0) throw new UploadError("No valid rows to import.");
  const storedName = `${randomUUID()}.${preview.format}`;
  const stored = path.join(/*turbopackIgnore: true*/ dataPath("imports"), storedName);
  writeFileSync(stored, file.bytes, { flag: "wx" });
  try {
    const { batch, count } = importTrades(userId, req.accountId, rows, {
      filename: file.name.slice(0, 200),
      fileSha256: preview.sha256,
      storedName,
      format: preview.format,
      adapter: preview.adapter,
      options: { sheet: preview.sheet, mapping: preview.mapping, numberFormat: req.numberFormat, dateOrder: req.dateOrder, contractSizes: req.contractSizes, symbolMap: req.symbolMap, sideMap: req.sideMap },
      totalRows: preview.total,
      duplicates: preview.duplicates,
      invalid: preview.invalid,
      errors: invalidRows,
    });
    recordActivity(userId, "import.committed", { rows: count });
    return { batch, imported: count, duplicates: preview.duplicates, invalid: preview.invalid, total: preview.total, mismatches: preview.mismatches, errors: invalidRows };
  } catch (e) {
    rmSync(stored, { force: true });
    throw e;
  }
}

/** The invalid rows stored on a batch, as CSV. Null if it isn't this user's batch. */
export function batchErrorsCsv(userId: number, batch: string): string | null {
  const row = db().prepare("SELECT errors FROM import_batches WHERE id = ? AND user_id = ?").get(batch, userId) as { errors: string } | undefined;
  return row ? invalidRowsCsv(JSON.parse(row.errors) as InvalidRow[]) : null;
}
