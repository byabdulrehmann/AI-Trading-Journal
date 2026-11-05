"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { money, toneOf } from "@/lib/client/format";
import { CSV_FIELDS, MAX_UPLOAD_BYTES, invalidRowsCsv, type ColumnMapping, type CsvField, type ImportOptions, type ImportPreview, type ImportResult, type InvalidRow, type RowResult } from "@/lib/domain/csv";
import { ADAPTERS } from "@/lib/domain/import/adapters";
import { computePnl } from "@/lib/domain/trade-math";
import { Badge, Button, Dialog, Field, cx, inputClass } from "../ui";

interface ImportChoices extends ImportOptions {
  sheet?: string;
  adapter?: string;
  mapping?: ColumnMapping;
}

interface Batch {
  id: string;
  filename: string;
  format: string;
  adapter: string;
  total_rows: number;
  imported: number;
  duplicates: number;
  invalid: number;
  status: string;
  created_at: string;
}

const SAMPLE_CSV = `symbol,side,open time,close time,entry,exit,qty,stop,target,commission
EURUSD,buy,2026-10-27 09:05,2026-10-27 10:40,1.0812,1.0841,100000,1.0795,1.0850,7
XAUUSD,sell,2026-10-28 14:10,2026-10-28 15:02,2662.5,2668.1,10,2667.0,2652.0,4`;

function downloadInvalidRows(name: string, rows: InvalidRow[]) {
  const url = URL.createObjectURL(new Blob([invalidRowsCsv(rows)], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/\.[^.]+$/, "")}-invalid-rows.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const sectionTitle = "mb-2 text-[13px] font-semibold text-ink-soft";

function ErrorList({ rows, fileName }: { rows: InvalidRow[]; fileName: string }) {
  if (rows.length === 0) return null;
  return (
    <section aria-label="Rows with problems">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-ink-soft">{rows.length} {rows.length === 1 ? "row" : "rows"} won&apos;t be imported</h3>
        <Button variant="ghost" size="sm" onClick={() => downloadInvalidRows(fileName, rows)}>Download as CSV</Button>
      </div>
      <div className="max-h-40 overflow-y-auto rounded-md border border-line p-3 text-[13px]" tabIndex={0}>
        {rows.slice(0, 200).map((r) => (
          <p key={r.line} className="text-ink-soft"><span className="num text-muted">Line {r.line}:</span> {r.errors.join("; ")}</p>
        ))}
        {rows.length > 200 && <p className="mt-1 text-muted">Showing the first 200. The download has all {rows.length}.</p>}
      </div>
    </section>
  );
}

function PreviewTable({ rows, currency }: { rows: RowResult[]; currency?: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full text-[13px]">
        <caption className="sr-only">Rows that will be imported</caption>
        <thead className="bg-sunken text-left text-muted">
          <tr>{["Line", "Symbol", "Side", "Opened", "Entry", "Exit", "Size", "Net P&L", "Check"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="num divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.line} className={r.mismatch ? "bg-loss-soft" : undefined}>
              <td className="px-3 py-1.5 text-muted">{r.line}</td>
              <td className="px-3 py-1.5">{r.trade!.symbol}</td>
              <td className="px-3 py-1.5">{r.trade!.side}</td>
              <td className="whitespace-nowrap px-3 py-1.5">{new Date(r.trade!.openedAt).toLocaleString()}</td>
              <td className="px-3 py-1.5">{r.trade!.entryPrice}</td>
              <td className="px-3 py-1.5">{r.trade!.exitPrice ?? "open"}</td>
              <td className="px-3 py-1.5">{r.trade!.quantity}</td>
              <td className={cx("px-3 py-1.5", toneOf(computePnl(r.trade!)))}>{r.trade!.exitPrice === null ? "open" : money(computePnl(r.trade!), currency, true)}</td>
              <td className="px-3 py-1.5 font-sans text-[12.5px] text-ink-soft">{r.warnings?.join("; ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function History({ batches, onUndo, busy }: { batches: Batch[]; onUndo: (id: string) => void; busy: boolean }) {
  if (batches.length === 0) return null;
  return (
    <section aria-label="Import history">
      <h3 className={sectionTitle}>Earlier imports</h3>
      <ul className="max-h-44 divide-y divide-line overflow-y-auto rounded-md border border-line text-[13px]">
        {batches.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate" title={b.filename}>{b.filename}</span>
            <span className="num text-muted">{new Date(b.created_at).toLocaleDateString()}</span>
            <span className="num text-muted">{b.imported} imported · {b.duplicates} duplicate · {b.invalid} invalid</span>
            {b.invalid > 0 && <a className="text-accent hover:underline" href={`/api/imports/${b.id}/errors`} aria-label={`Download invalid rows of ${b.filename}`}>Errors</a>}
            {b.status === "undone" ? <Badge>Undone</Badge> : <Button variant="ghost" size="sm" disabled={busy} onClick={() => onUndo(b.id)} aria-label={`Undo import of ${b.filename}`}>Undo</Button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { accounts, refresh, toast } = useApp();
  const active = accounts.filter((a) => !a.archived);
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [choices, setChoices] = useState<ImportChoices>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const acct = accountId ?? active[0]?.id ?? null;
  const currency = accounts.find((a) => a.id === acct)?.currency;

  const loadHistory = useCallback(() => {
    api<{ imports: Batch[] }>("/api/imports").then((r) => setBatches(r.imports)).catch(() => setBatches([]));
  }, []);
  useEffect(() => {
    if (open) loadHistory();
  }, [open, loadHistory]);

  const send = <T,>(f: File, account: number, c: ImportChoices, commit: boolean) => {
    const form = new FormData();
    form.append("file", f);
    form.append("options", JSON.stringify({ ...c, accountId: account, commit }));
    return api<T>("/api/imports", { method: "POST", body: form });
  };

  const inspect = async (f: File, c: ImportChoices, account = acct) => {
    if (!account) return;
    const request = ++latest.current;
    setBusy(true);
    setError(null);
    try {
      const res = await send<ImportPreview>(f, account, c, false);
      if (request !== latest.current) return;
      setPreview(res);
      setChoices(c);
    } catch (e) {
      if (request !== latest.current) return;
      setError(e instanceof Error ? e.message : "Couldn't read the file.");
      setPreview(null);
    } finally {
      if (request === latest.current) setBusy(false);
    }
  };

  const reset = () => {
    latest.current++;
    setFile(null);
    setPreview(null);
    setChoices({});
    setResult(null);
    setError(null);
    setBusy(false);
  };

  const pick = (f: File | undefined) => {
    if (!f) return;
    setResult(null);
    setFile(f);
    setChoices({});
    setPreview(null);
    if (f.size > MAX_UPLOAD_BYTES) return setError("Files over 10 MB aren't supported.");
    void inspect(f, {});
  };

  const change = (next: ImportChoices) => {
    if (file) void inspect(file, next);
  };

  const undo = async (id: string) => {
    setBusy(true);
    try {
      const { removed } = await api<{ removed: number }>(`/api/imports/${id}`, { method: "DELETE" });
      await refresh();
      toast({ message: `Import removed: ${removed} trades.` });
      if (result?.batch === id) reset();
      loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't undo that import.");
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!acct || !file || !preview) return;
    setBusy(true);
    setError(null);
    try {
      // The mapping on screen is sent, so the commit reads the file exactly as the preview did.
      const res = await send<ImportResult>(file, acct, { ...choices, mapping: preview.mapping, adapter: preview.adapter, sheet: preview.sheet ?? undefined }, true);
      setResult(res);
      setPreview(null);
      await refresh();
      loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed. Nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  const setSymbolEntry = (key: "contractSizes" | "symbolMap", symbol: string, value: string | number | null) => {
    const entries: Record<string, string | number> = { ...choices[key] };
    if (value === null || value === "") delete entries[symbol];
    else entries[symbol] = value;
    change({ ...choices, mapping: preview?.mapping, [key]: entries });
  };

  const columnLabel = (headers: string[], h: string, i: number) => {
    const repeated = headers.indexOf(h) !== headers.lastIndexOf(h);
    return `${h.trim() || "(no name)"}${repeated || !h.trim() ? ` · column ${i + 1}` : ""}`;
  };

  const shown = preview ? [...new Map([...preview.flagged.slice(0, 50), ...preview.preview.slice(0, 8)].map((r) => [r.line, r])).values()].sort((a, b) => a.line - b.line) : [];

  return (
    <Dialog open={open} onClose={onClose} title="Import trades" wide>
      <div className="space-y-5">
        {result ? (
          <section aria-label="Import summary" className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-[13.5px]" role="status">
              <Badge tone="profit">{result.imported} imported</Badge>
              <Badge tone="info">{result.duplicates} already imported</Badge>
              <Badge tone={result.invalid ? "loss" : "neutral"}>{result.invalid} invalid</Badge>
              <span className="text-muted">of {result.total} rows</span>
              {result.mismatches > 0 && <Badge tone="loss">{result.mismatches} differ from the broker&apos;s profit</Badge>}
            </div>
            <ErrorList rows={result.errors} fileName={file?.name ?? "import"} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={busy} onClick={() => void undo(result.batch)}>Undo this import</Button>
              <Button variant="primary" onClick={() => { reset(); onClose(); }}>Done</Button>
            </div>
          </section>
        ) : (
          <>
            <p className="text-[13.5px] text-muted">Export your trade history as .csv or .xlsx. Nothing is saved until you press Import, and you can undo a whole import afterwards.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Import into account">
                {(p) => (
                  <select {...p} className={inputClass} value={acct ?? ""} onChange={(e) => { const id = Number(e.target.value); setAccountId(id); if (file) void inspect(file, choices, id); }}>
                    {active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                )}
              </Field>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files[0]); }}
                className={cx("rounded-md", dragging && "ring-2 ring-accent")}
              >
                <Field label="File (drop it here or browse)" hint={file?.name ?? "CSV or XLSX, up to 10 MB and 20,000 rows"}>
                  {(p) => <input {...p} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className={cx(inputClass, "py-1.5 file:mr-3 file:rounded file:border-0 file:bg-raised file:px-2 file:py-1 file:text-ink")} onChange={(e) => pick(e.target.files?.[0])} />}
                </Field>
              </div>
            </div>
            {!preview && !file && (
              <button type="button" className="text-[13px] text-accent hover:underline" onClick={() => pick(new File([SAMPLE_CSV], "example.csv", { type: "text/csv" }))}>
                Try with a two-row example file
              </button>
            )}
          </>
        )}
        {error && <p role="alert" className="rounded-md border border-loss/50 bg-loss-soft px-3 py-2 text-[13.5px]">{error}</p>}

        {preview && !result && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {preview.sheets.length > 1 && (
                <Field label="Sheet">
                  {(p) => (
                    <select {...p} className={inputClass} value={preview.sheet ?? ""} onChange={(e) => change({ ...choices, sheet: e.target.value, mapping: undefined })}>
                      {preview.sheets.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                </Field>
              )}
              <Field label="File type" hint={preview.adapterMatched ? `Header found on line ${preview.headerLine}` : "This type's columns weren't found. Match them below"}>
                {(p) => (
                  <select {...p} className={inputClass} value={preview.adapter} onChange={(e) => change({ ...choices, adapter: e.target.value, mapping: undefined })}>
                    {ADAPTERS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                )}
              </Field>
              <Field label="Number format" hint="Rows that depend on this stay out until you choose">
                {(p) => (
                  <select {...p} className={inputClass} value={choices.numberFormat ?? ""} onChange={(e) => change({ ...choices, mapping: preview.mapping, numberFormat: (e.target.value || undefined) as ImportOptions["numberFormat"] })}>
                    <option value="">Not chosen</option>
                    <option value="dot">1,234.56 (dot for decimals)</option>
                    <option value="comma">1.234,56 (comma for decimals)</option>
                  </select>
                )}
              </Field>
              <Field label="Date format" hint="Rows that depend on this stay out until you choose">
                {(p) => (
                  <select {...p} className={inputClass} value={choices.dateOrder ?? ""} onChange={(e) => change({ ...choices, mapping: preview.mapping, dateOrder: (e.target.value || undefined) as ImportOptions["dateOrder"] })}>
                    <option value="">Not chosen</option>
                    <option value="dmy">Day first (31/12/2026)</option>
                    <option value="mdy">Month first (12/31/2026)</option>
                  </select>
                )}
              </Field>
            </div>

            <details open={!preview.adapterMatched || preview.adapter === "generic"}>
              <summary className={cx(sectionTitle, "cursor-pointer")}>Match columns</summary>
              <div className="grid gap-3 sm:grid-cols-3">
                {(Object.keys(CSV_FIELDS) as CsvField[]).map((f) => (
                  <Field key={f} label={`${CSV_FIELDS[f].label}${CSV_FIELDS[f].required ? " *" : ""}`}>
                    {(p) => (
                      <select
                        {...p}
                        className={cx(inputClass, "h-9")}
                        value={preview.mapping[f] ?? ""}
                        onChange={(e) => {
                          const next = { ...preview.mapping };
                          if (e.target.value === "") delete next[f];
                          else next[f] = Number(e.target.value);
                          change({ ...choices, adapter: preview.adapter, mapping: next });
                        }}
                      >
                        <option value="">Not in file</option>
                        {preview.headers.map((h, i) => <option key={i} value={i}>{columnLabel(preview.headers, h, i)}</option>)}
                      </select>
                    )}
                  </Field>
                ))}
              </div>
            </details>

            {preview.unknownSides.length > 0 && (
              <section aria-label="Direction mapping">
                <h3 className={sectionTitle}>Directions not recognised</h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  {preview.unknownSides.map((s) => (
                    <Field key={s} label={`"${s}" means`}>
                      {(p) => (
                        <select
                          {...p}
                          className={cx(inputClass, "h-9")}
                          value={choices.sideMap?.[s.toLowerCase()] ?? ""}
                          onChange={(e) => {
                            const sideMap = { ...choices.sideMap };
                            if (e.target.value) sideMap[s.toLowerCase()] = e.target.value as "long" | "short";
                            else delete sideMap[s.toLowerCase()];
                            change({ ...choices, mapping: preview.mapping, sideMap });
                          }}
                        >
                          <option value="">Not a trade</option>
                          <option value="long">Long (buy)</option>
                          <option value="short">Short (sell)</option>
                        </select>
                      )}
                    </Field>
                  ))}
                </div>
              </section>
            )}

            {preview.symbols.length > 0 && (
              <section aria-label="Symbols">
                <h3 className="mb-1 text-[13px] font-semibold text-ink-soft">Symbols and contract size</h3>
                <p className="mb-2 text-[13px] text-muted">
                  Contract size is what 1 unit of size earns when the price moves by 1.00. Leave it at 1 if your file gives size in units or shares. If it gives lots or contracts, enter your broker&apos;s size (one EURUSD lot is usually 100,000), or profit will be far off. Rename a symbol to match your journal, such as EURUSD.M to EURUSD.
                </p>
                <div className="grid max-h-56 gap-x-3 gap-y-2 overflow-y-auto sm:grid-cols-2">
                  {preview.symbols.map(({ symbol, contractSize }) => (
                    <div key={symbol} className="grid grid-cols-2 gap-2">
                      <Field label={`${symbol}: store as`}>
                        {(p) => <input {...p} maxLength={20} placeholder={symbol} className={cx(inputClass, "h-9")} defaultValue={choices.symbolMap?.[symbol] ?? ""} onBlur={(e) => { if (e.target.value.trim() !== (choices.symbolMap?.[symbol] ?? "")) setSymbolEntry("symbolMap", symbol, e.target.value.trim()); }} />}
                      </Field>
                      {preview.mapping.multiplier === undefined && (
                        <Field label="Contract size">
                          {(p) => <input {...p} key={contractSize ?? "none"} type="number" min="0" step="any" placeholder="1" className={cx(inputClass, "h-9")} defaultValue={contractSize ?? ""} onBlur={(e) => { const n = Number(e.target.value); if (e.target.value !== String(contractSize ?? "")) setSymbolEntry("contractSizes", symbol, n > 0 ? n : null); }} />}
                        </Field>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="flex flex-wrap items-center gap-2 text-[13.5px]" role="status">
              <Badge tone="profit">{preview.valid} ready</Badge>
              <Badge tone={preview.invalid ? "loss" : "neutral"}>{preview.invalid} with problems</Badge>
              <Badge tone="info">{preview.duplicates} already imported</Badge>
              <span className="text-muted">of {preview.total} rows</span>
              <span className="text-muted">· Net P&amp;L of ready rows:</span>
              <span className={cx("num", toneOf(preview.netPnl))}>{money(preview.netPnl, currency, true)}</span>
            </div>
            {preview.mismatches > 0 && (
              <p className="rounded-md border border-loss/50 bg-loss-soft px-3 py-2 text-[13.5px]">
                {preview.mismatches} {preview.mismatches === 1 ? "row differs" : "rows differ"} from the file&apos;s profit by more than 1%. This usually means a wrong contract size. They can still be imported, using the calculated figure.
              </p>
            )}
            {!preview.feesMapped && <p className="text-[13px] text-muted">No commission or swap column is matched, so fees for these trades will read as 0.</p>}
            {preview.trailingRows > 0 && <p className="text-[13px] text-muted">{preview.trailingRows} {preview.trailingRows === 1 ? "row" : "rows"} below the trades table (such as Orders and Deals sections) {preview.trailingRows === 1 ? "isn't" : "aren't"} read.</p>}
            {preview.duplicates > 0 && (
              <p className="text-[13px] text-muted">
                Already imported, skipped: line {preview.duplicateLines.slice(0, 20).join(", ")}{preview.duplicateLines.length > 20 ? ` and ${preview.duplicateLines.length - 20} more` : ""}.
              </p>
            )}
            <ErrorList rows={preview.errors} fileName={preview.fileName} />
            <PreviewTable rows={shown} currency={currency} />
          </>
        )}

        {!result && (
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button variant="primary" onClick={() => void commit()} disabled={busy || !preview || preview.valid === 0}>
              {busy ? "Working…" : preview ? `Import ${preview.valid} trades` : "Import"}
            </Button>
          </div>
        )}
        <History batches={batches} onUndo={(id) => void undo(id)} busy={busy} />
      </div>
    </Dialog>
  );
}
