"use client";

import { useState } from "react";
import { api } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { money, toneOf } from "@/lib/client/format";
import { CSV_FIELDS, type ColumnMapping, type CsvField, type ImportOptions, type RowResult } from "@/lib/domain/csv";
import { computePnl } from "@/lib/domain/trade-math";
import { Badge, Button, Dialog, Field, cx, inputClass } from "../ui";

interface Preview {
  headers: string[];
  mapping: ColumnMapping;
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  netPnl: number;
  symbols: string[];
  preview: RowResult[];
  errors: RowResult[];
}

const SAMPLE_CSV = `symbol,side,open time,close time,entry,exit,qty,stop,target,commission
EURUSD,buy,2026-10-27 09:05,2026-10-27 10:40,1.0812,1.0841,100000,1.0795,1.0850,7
XAUUSD,sell,2026-10-28 14:10,2026-10-28 15:02,2662.5,2668.1,10,2667.0,2652.0,4`;

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { accounts, refresh, toast } = useApp();
  const active = accounts.filter((a) => !a.archived);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [accountId, setAccountId] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [options, setOptions] = useState<ImportOptions>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const acct = accountId ?? active[0]?.id ?? null;
  const currency = accounts.find((a) => a.id === acct)?.currency;

  const reset = () => {
    setCsv("");
    setFileName("");
    setPreview(null);
    setMapping({});
    setOptions({});
    setError(null);
  };

  const inspect = async (text: string, map?: ColumnMapping, opts = options) => {
    if (!acct) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<Preview>("/api/imports", { method: "POST", json: { csv: text, accountId: acct, mapping: map, ...opts, commit: false } });
      setPreview(res);
      setMapping(res.mapping);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read the file.");
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5_000_000) return setError("Files over 5 MB aren't supported yet.");
    const text = await f.text();
    setFileName(f.name);
    setCsv(text);
    await inspect(text);
  };

  const changeOptions = (next: ImportOptions) => {
    setOptions(next);
    void inspect(csv, mapping, next);
  };

  const setContractSize = (symbol: string, raw: string) => {
    const sizes = { ...options.contractSizes };
    const n = Number(raw);
    if (raw.trim() !== "" && n > 0) sizes[symbol] = n;
    else delete sizes[symbol];
    changeOptions({ ...options, contractSizes: sizes });
  };

  const commit = async () => {
    if (!acct) return;
    setBusy(true);
    try {
      const res = await api<{ batch: string; imported: number; skipped: number; duplicates: number }>("/api/imports", { method: "POST", json: { csv, accountId: acct, mapping, ...options, commit: true } });
      await refresh();
      onClose();
      reset();
      toast({
        message: `Imported ${res.imported} trades${res.skipped ? `, skipped ${res.skipped} invalid rows` : ""}${res.duplicates ? `, skipped ${res.duplicates} already imported` : ""}.`,
        tone: "success",
        action: {
          label: "Undo import",
          run: async () => {
            await api(`/api/imports/${res.batch}`, { method: "DELETE" });
            await refresh();
            toast({ message: "Import removed." });
          },
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Import trades from CSV" wide>
      <div className="space-y-5">
        <p className="text-[13.5px] text-muted">
          Export your trade history from your platform as CSV. Nothing is saved until you press Import; you can undo a whole import afterwards.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Import into account">
            {(p) => (
              <select {...p} className={inputClass} value={acct ?? ""} onChange={(e) => setAccountId(Number(e.target.value))}>
                {active.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
          </Field>
          <Field label="CSV file" hint={fileName || "Header row required"}>
            {(p) => <input {...p} type="file" accept=".csv,text/csv" className={cx(inputClass, "py-1.5 file:mr-3 file:rounded file:border-0 file:bg-raised file:px-2 file:py-1 file:text-ink")} onChange={(e) => void onFile(e.target.files?.[0])} />}
          </Field>
        </div>
        {!preview && (
          <button type="button" className="text-[13px] text-accent hover:underline" onClick={() => { setCsv(SAMPLE_CSV); setFileName("example.csv"); void inspect(SAMPLE_CSV); }}>
            Try with a two-row example file
          </button>
        )}
        {error && <p role="alert" className="rounded-md border border-loss/50 bg-loss-soft px-3 py-2 text-[13.5px]">{error}</p>}

        {preview && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Number format" hint="Rows that depend on this stay out until you choose">
                {(p) => (
                  <select {...p} className={inputClass} value={options.numberFormat ?? ""} onChange={(e) => changeOptions({ ...options, numberFormat: (e.target.value || undefined) as ImportOptions["numberFormat"] })}>
                    <option value="">Not chosen</option>
                    <option value="dot">1,234.56 (dot for decimals)</option>
                    <option value="comma">1.234,56 (comma for decimals)</option>
                  </select>
                )}
              </Field>
              <Field label="Date format" hint="Rows that depend on this stay out until you choose">
                {(p) => (
                  <select {...p} className={inputClass} value={options.dateOrder ?? ""} onChange={(e) => changeOptions({ ...options, dateOrder: (e.target.value || undefined) as ImportOptions["dateOrder"] })}>
                    <option value="">Not chosen</option>
                    <option value="dmy">Day first (31/12/2026)</option>
                    <option value="mdy">Month first (12/31/2026)</option>
                  </select>
                )}
              </Field>
            </div>

            <div>
              <h3 className="mb-2 text-[13px] font-semibold text-ink-soft">Match columns</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                {(Object.keys(CSV_FIELDS) as CsvField[]).map((f) => (
                  <Field key={f} label={`${CSV_FIELDS[f].label}${CSV_FIELDS[f].required ? " *" : ""}`}>
                    {(p) => (
                      <select
                        {...p}
                        className={cx(inputClass, "h-9")}
                        value={mapping[f] ?? ""}
                        onChange={(e) => {
                          const next = { ...mapping };
                          if (e.target.value === "") delete next[f];
                          else next[f] = Number(e.target.value);
                          setMapping(next);
                          void inspect(csv, next);
                        }}
                      >
                        <option value="">— not in file —</option>
                        {preview.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                      </select>
                    )}
                  </Field>
                ))}
              </div>
            </div>

            {mapping.multiplier === undefined && preview.symbols.length > 0 && (
              <div>
                <h3 className="mb-1 text-[13px] font-semibold text-ink-soft">Contract size</h3>
                <p className="mb-2 text-[13px] text-muted">
                  What 1 unit of size earns when the price moves by 1.00. Leave it at 1 if your file gives size in units or shares. If it gives lots or contracts, enter your broker&apos;s contract size (one EURUSD lot is usually 100,000), or profit will be far too small.
                </p>
                <div className="grid gap-3 sm:grid-cols-4">
                  {preview.symbols.map((s) => (
                    <Field key={s} label={s}>
                      {(p) => <input {...p} type="number" min="0" step="any" placeholder="1" className={cx(inputClass, "h-9")} defaultValue={options.contractSizes?.[s] ?? ""} onBlur={(e) => { if (e.target.value !== String(options.contractSizes?.[s] ?? "")) setContractSize(s, e.target.value); }} />}
                    </Field>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
              <Badge tone="profit">{preview.valid} ready</Badge>
              {preview.invalid > 0 && <Badge tone="loss">{preview.invalid} with problems</Badge>}
              {preview.duplicates > 0 && <Badge tone="info">{preview.duplicates} already imported, will be skipped</Badge>}
              <span className="text-muted">of {preview.total} rows</span>
              <span className="text-muted">· Net P&amp;L of ready rows:</span>
              <span className={cx("num", toneOf(preview.netPnl))}>{money(preview.netPnl, currency, true)}</span>
            </div>

            {preview.errors.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-md border border-line p-3 text-[13px]">
                {preview.errors.map((r) => (
                  <p key={r.line} className="text-ink-soft">
                    <span className="num text-muted">Line {r.line}:</span> {r.errors.join("; ")}
                  </p>
                ))}
              </div>
            )}

            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full text-[13px]">
                <thead className="bg-sunken text-left text-muted">
                  <tr>{["Line", "Symbol", "Side", "Opened", "Entry", "Exit", "Size", "Net P&L"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody className="num divide-y divide-line">
                  {preview.preview.filter((r) => r.ok).slice(0, 8).map((r) => (
                    <tr key={r.line}>
                      <td className="px-3 py-1.5 text-muted">{r.line}</td>
                      <td className="px-3 py-1.5">{r.trade!.symbol}</td>
                      <td className="px-3 py-1.5">{r.trade!.side}</td>
                      <td className="px-3 py-1.5">{new Date(r.trade!.openedAt).toLocaleString()}</td>
                      <td className="px-3 py-1.5">{r.trade!.entryPrice}</td>
                      <td className="px-3 py-1.5">{r.trade!.exitPrice ?? "open"}</td>
                      <td className="px-3 py-1.5">{r.trade!.quantity}</td>
                      <td className={cx("px-3 py-1.5", toneOf(computePnl(r.trade!)))}>{r.trade!.exitPrice === null ? "open" : money(computePnl(r.trade!), currency, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="ghost" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button variant="primary" onClick={commit} disabled={busy || !preview || preview.valid === 0}>
            {busy ? "Working…" : preview ? `Import ${preview.valid} trades` : "Import"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
