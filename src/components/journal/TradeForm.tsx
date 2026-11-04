"use client";

import { useMemo, useState } from "react";
import { api, fieldErrors } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { money, rFmt, toLocalInput } from "@/lib/client/format";
import { EMOTIONS, GRADES, type Trade, type TradeData } from "@/lib/domain/types";
import { computePlannedR, computePnl, computeR, plannedRisk } from "@/lib/domain/trade-math";
import { Button, Dialog, Field, Segmented, cx, inputClass } from "../ui";

interface FormState {
  accountId: string;
  symbol: string;
  side: "long" | "short";
  openedAt: string;
  status: "open" | "closed";
  closedAt: string;
  entryPrice: string;
  exitPrice: string;
  quantity: string;
  multiplier: string;
  stopPrice: string;
  targetPrice: string;
  fees: string;
  setup: string;
  tags: string;
  emotionBefore: string;
  emotionAfter: string;
  followedPlan: "" | "yes" | "no";
  grade: string;
  planNotes: string;
  notes: string;
}

const blank = (accountId: number | undefined): FormState => ({
  accountId: accountId ? String(accountId) : "",
  symbol: "",
  side: "long",
  openedAt: toLocalInput(new Date().toISOString()),
  status: "closed",
  closedAt: toLocalInput(new Date().toISOString()),
  entryPrice: "",
  exitPrice: "",
  quantity: "",
  multiplier: "1",
  stopPrice: "",
  targetPrice: "",
  fees: "0",
  setup: "",
  tags: "",
  emotionBefore: "",
  emotionAfter: "",
  followedPlan: "",
  grade: "",
  planNotes: "",
  notes: "",
});

const fromTrade = (t: Trade): FormState => ({
  accountId: String(t.accountId),
  symbol: t.symbol,
  side: t.side,
  openedAt: toLocalInput(t.openedAt),
  status: t.closedAt ? "closed" : "open",
  closedAt: toLocalInput(t.closedAt ?? new Date().toISOString()),
  entryPrice: String(t.entryPrice),
  exitPrice: t.exitPrice === null ? "" : String(t.exitPrice),
  quantity: String(t.quantity),
  multiplier: String(t.multiplier),
  stopPrice: t.stopPrice === null ? "" : String(t.stopPrice),
  targetPrice: t.targetPrice === null ? "" : String(t.targetPrice),
  fees: String(t.fees),
  setup: t.setup,
  tags: t.tags.join(", "),
  emotionBefore: t.emotionBefore ?? "",
  emotionAfter: t.emotionAfter ?? "",
  followedPlan: t.followedPlan === null ? "" : t.followedPlan ? "yes" : "no",
  grade: t.grade ?? "",
  planNotes: t.planNotes,
  notes: t.notes,
});

const n = (s: string) => (s.trim() === "" ? null : Number(s));

function toPayload(f: FormState): TradeData {
  return {
    accountId: Number(f.accountId),
    symbol: f.symbol,
    side: f.side,
    openedAt: f.openedAt ? new Date(f.openedAt).toISOString() : "",
    closedAt: f.status === "closed" && f.closedAt ? new Date(f.closedAt).toISOString() : null,
    entryPrice: n(f.entryPrice) as number,
    exitPrice: f.status === "closed" ? n(f.exitPrice) : null,
    quantity: n(f.quantity) as number,
    multiplier: n(f.multiplier) ?? 1,
    stopPrice: n(f.stopPrice),
    targetPrice: n(f.targetPrice),
    fees: n(f.fees) ?? 0,
    setup: f.setup,
    tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
    emotionBefore: (f.emotionBefore || null) as TradeData["emotionBefore"],
    emotionAfter: (f.emotionAfter || null) as TradeData["emotionAfter"],
    followedPlan: f.followedPlan === "" ? null : f.followedPlan === "yes",
    grade: (f.grade || null) as TradeData["grade"],
    planNotes: f.planNotes,
    notes: f.notes,
  };
}

export function TradeFormDialog() {
  const { editing, editTrade } = useApp();
  return (
    <Dialog open={editing !== null} onClose={() => editTrade(null)} title={editing === "new" ? "Log a trade" : "Edit trade"} wide>
      {/* Keyed so each open starts from fresh state. */}
      {editing !== null && <TradeFormBody key={editing === "new" ? "new" : editing.id} editing={editing} />}
    </Dialog>
  );
}

function TradeFormBody({ editing }: { editing: Trade | "new" }) {
  const { editTrade, accounts, settings, refresh, toast, openTrade } = useApp();
  const activeAccounts = accounts.filter((a) => !a.archived);
  const [form, setForm] = useState<FormState>(() =>
    editing === "new" ? blank(settings?.defaultAccountId ?? activeAccounts[0]?.id) : fromTrade(editing),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Live preview of derived numbers, using the same math as the server.
  const preview = useMemo(() => {
    const p = toPayload(form);
    if (!p.entryPrice || !p.quantity) return null;
    return { pnl: computePnl(p), r: computeR(p), plannedR: computePlannedR(p), risk: plannedRisk(p) };
  }, [form]);

  const currency = accounts.find((a) => String(a.id) === form.accountId)?.currency ?? "USD";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const payload = toPayload(form);
      const res =
        editing !== "new"
          ? await api<{ trade: Trade }>(`/api/trades/${editing.id}`, { method: "PUT", json: payload })
          : await api<{ trade: Trade }>("/api/trades", { method: "POST", json: payload });
      await refresh();
      editTrade(null);
      toast({ message: editing === "new" ? `Logged ${res.trade.symbol}.` : "Trade updated.", tone: "success", action: { label: "View", run: () => openTrade(res.trade.id) } });
    } catch (err) {
      setErrors(fieldErrors(err));
      if (!Object.keys(fieldErrors(err)).length) toast({ message: err instanceof Error ? err.message : "Couldn't save.", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  const err = (k: string) => errors[k];

  return (
      <form onSubmit={submit} noValidate className="space-y-6">
        <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <legend className="mb-2 text-[12px] font-semibold tracking-wide text-muted uppercase">The trade</legend>
          <Field label="Account" error={err("accountId")}>
            {(p) => (
              <select {...p} className={inputClass} value={form.accountId} onChange={(e) => set("accountId", e.target.value)}>
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Symbol" error={err("symbol")}>
            {(p) => <input {...p} className={inputClass} value={form.symbol} onChange={(e) => set("symbol", e.target.value)} placeholder="EURUSD" autoComplete="off" required />}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-soft">Direction</span>
            <Segmented label="Direction" value={form.side} onChange={(v) => set("side", v)} options={[{ value: "long", label: "Long" }, { value: "short", label: "Short" }]} />
          </div>
          <Field label="Entry price" error={err("entryPrice")}>
            {(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={form.entryPrice} onChange={(e) => set("entryPrice", e.target.value)} required />}
          </Field>
          <Field label="Size" error={err("quantity")} hint="Units, lots or contracts">
            {(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} required />}
          </Field>
          <Field label="Multiplier" error={err("multiplier")} hint="Point value per unit (1 for most)">
            {(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={form.multiplier} onChange={(e) => set("multiplier", e.target.value)} />}
          </Field>
          <Field label="Opened" error={err("openedAt")}>
            {(p) => <input {...p} type="datetime-local" className={inputClass} value={form.openedAt} onChange={(e) => set("openedAt", e.target.value)} />}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-soft">Status</span>
            <Segmented label="Status" value={form.status} onChange={(v) => set("status", v)} options={[{ value: "closed", label: "Closed" }, { value: "open", label: "Still open" }]} />
          </div>
          {form.status === "closed" ? (
            <Field label="Closed" error={err("closedAt")}>
              {(p) => <input {...p} type="datetime-local" className={inputClass} value={form.closedAt} onChange={(e) => set("closedAt", e.target.value)} />}
            </Field>
          ) : (
            <div />
          )}
          {form.status === "closed" && (
            <Field label="Exit price" error={err("exitPrice")}>
              {(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={form.exitPrice} onChange={(e) => set("exitPrice", e.target.value)} />}
            </Field>
          )}
          <Field label="Fees" hint="Negative for a credit, such as swap paid to you" error={err("fees")}>
            {(p) => <input {...p} className={cx(inputClass, "num")} inputMode="text" value={form.fees} onChange={(e) => set("fees", e.target.value)} />}
          </Field>
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <legend className="mb-2 text-[12px] font-semibold tracking-wide text-muted uppercase">The plan</legend>
          <Field label="Stop" error={err("stopPrice")} hint="Where the idea is wrong">
            {(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={form.stopPrice} onChange={(e) => set("stopPrice", e.target.value)} />}
          </Field>
          <Field label="Target" error={err("targetPrice")}>
            {(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={form.targetPrice} onChange={(e) => set("targetPrice", e.target.value)} />}
          </Field>
          <Field label="Setup" error={err("setup")}>
            {(p) => <input {...p} className={inputClass} value={form.setup} onChange={(e) => set("setup", e.target.value)} placeholder="Breakout, pullback…" />}
          </Field>
          <Field label="Plan notes" className="sm:col-span-3" error={err("planNotes")}>
            {(p) => <textarea {...p} rows={2} className={cx(inputClass, "h-auto py-2")} value={form.planNotes} onChange={(e) => set("planNotes", e.target.value)} placeholder="Why this trade, what would make you exit" />}
          </Field>
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <legend className="mb-2 text-[12px] font-semibold tracking-wide text-muted uppercase">Review</legend>
          <Field label="Feeling before">
            {(p) => (
              <select {...p} className={inputClass} value={form.emotionBefore} onChange={(e) => set("emotionBefore", e.target.value)}>
                <option value="">—</option>
                {EMOTIONS.map((x) => <option key={x}>{x}</option>)}
              </select>
            )}
          </Field>
          <Field label="Feeling after">
            {(p) => (
              <select {...p} className={inputClass} value={form.emotionAfter} onChange={(e) => set("emotionAfter", e.target.value)}>
                <option value="">—</option>
                {EMOTIONS.map((x) => <option key={x}>{x}</option>)}
              </select>
            )}
          </Field>
          <Field label="Followed plan?">
            {(p) => (
              <select {...p} className={inputClass} value={form.followedPlan} onChange={(e) => set("followedPlan", e.target.value as FormState["followedPlan"])}>
                <option value="">Not answered</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            )}
          </Field>
          <Field label="Grade">
            {(p) => (
              <select {...p} className={inputClass} value={form.grade} onChange={(e) => set("grade", e.target.value)}>
                <option value="">—</option>
                {GRADES.map((g) => <option key={g}>{g}</option>)}
              </select>
            )}
          </Field>
          <Field label="Tags" className="sm:col-span-4" hint="Comma-separated" error={err("tags")}>
            {(p) => <input {...p} className={inputClass} value={form.tags} onChange={(e) => set("tags", e.target.value)} placeholder="london-open, a-setup" />}
          </Field>
          <Field label="Notes" className="sm:col-span-4" error={err("notes")}>
            {(p) => <textarea {...p} rows={3} className={cx(inputClass, "h-auto py-2")} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="What happened, what you'd repeat or change" />}
          </Field>
        </fieldset>

        <div className="sticky bottom-0 -mx-5 -mb-4 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-5 py-3">
          <div className="num text-[13px] text-muted" aria-live="polite">
            {preview ? (
              <>
                P&L <span className="text-ink">{money(preview.pnl, currency, true)}</span> · R <span className="text-ink">{rFmt(preview.r)}</span> · planned{" "}
                <span className="text-ink">{preview.plannedR === null ? "—" : `${preview.plannedR}R`}</span> · risk <span className="text-ink">{money(preview.risk, currency)}</span>
              </>
            ) : (
              "Enter entry and size to preview P&L"
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => editTrade(null)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save trade"}
            </Button>
          </div>
        </div>
      </form>
  );
}
