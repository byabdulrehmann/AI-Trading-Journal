"use client";

import { useRef, useState } from "react";
import { api, fieldErrors } from "@/lib/client/api";
import type { Facets } from "@/lib/client/analytics";
import { useApp } from "@/lib/client/app-state";
import { SESSION_LABELS, fileSize, fromLocalInput, money, rFmt, toLocalInput } from "@/lib/client/format";
import { useFetch } from "@/lib/client/use-fetch";
import { ASSET_CLASSES, SESSIONS, classifySymbol, normalizeSymbol, parsePair, resolveFxRate, sessionFor } from "@/lib/domain/engine/instruments";
import { computePosition, type PositionResult } from "@/lib/domain/engine/position";
import { EMOTIONS, GRADES, MISTAKES, TradeInput, type Attachment, type Trade } from "@/lib/domain/types";
import type { InstrumentSpec } from "@/lib/server/repo/journal";
import { decimalsOf } from "@/lib/client/ladder";
import { Button, Dialog, Field, Notice, Segmented, Spinner, cx, inputClass } from "../ui";
import { PriceLadder } from "./PriceLadder";

interface FillRow {
  key: number;
  role: "entry" | "exit";
  price: string;
  quantity: string;
  /** Local datetime-input value. */
  at: string;
  /** The stored time, kept while `at` is untouched so seconds survive an edit. */
  iso?: string;
}

const RATINGS = ["confidence", "discipline", "fear", "greed"] as const;
const FLAGS = [
  ["revengeTrade", "Revenge trade"],
  ["overtrading", "Overtrading"],
  ["impulsiveEntry", "Impulsive entry"],
  ["earlyExit", "Early exit"],
] as const;
const ATTACH_KINDS = [
  ["chart", "Chart"],
  ["entry", "Entry screenshot"],
  ["exit", "Exit screenshot"],
  ["document", "Document"],
] as const;
const nice = (s: string) => s.replace(/_/g, " ");

const blank = (accountId: number | undefined, fees?: { commission: number; otherFees: number }) => {
  const nowLocal = toLocalInput(new Date().toISOString());
  return {
    accountId: accountId ? String(accountId) : "",
    symbol: "",
    side: "long" as "long" | "short",
    assetClass: "",
    optionRight: "" as "" | "call" | "put",
    strike: "",
    expiry: "",
    session: "",
    strategy: "",
    openedAt: nowLocal,
    closedAt: nowLocal,
    entryPrice: "",
    exitPrice: "",
    quantity: "",
    /** Null: follow the instrument spec. A string: what the user typed. */
    multiplier: null as string | null,
    stopPrice: "",
    targetPrice: "",
    commission: fees?.commission ? String(fees.commission) : "",
    swap: "",
    otherFees: fees?.otherFees ? String(fees.otherFees) : "",
    fxRate: "",
    useFills: false,
    fills: [] as FillRow[],
    setup: "",
    planNotes: "",
    entryReason: "",
    exitReason: "",
    notes: "",
    lessons: "",
    emotionBefore: "",
    emotionAfter: "",
    mistakes: [] as string[],
    strategyTags: "",
    tags: "",
    confidence: "",
    discipline: "",
    fear: "",
    greed: "",
    revengeTrade: false,
    overtrading: false,
    impulsiveEntry: false,
    earlyExit: false,
    ruleViolations: "",
    followedPlan: "",
    grade: "",
  };
};
type FormState = ReturnType<typeof blank>;

const str = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

function fromTrade(t: Trade): FormState {
  const execs = t.executions ?? [];
  const simple = execs.filter((e) => e.role === "entry").length <= 1 && execs.filter((e) => e.role === "exit").length <= 1 && t.remainingQty === (t.status === "closed" ? 0 : t.quantity);
  return {
    ...blank(t.accountId),
    symbol: t.symbol,
    side: t.side,
    assetClass: t.assetClass,
    optionRight: t.optionRight ?? "",
    strike: t.strike === null ? "" : String(t.strike),
    expiry: t.expiry ?? "",
    session: t.session && t.session !== sessionFor(t.openedAt) ? t.session : "",
    strategy: t.strategy,
    openedAt: toLocalInput(t.openedAt),
    closedAt: toLocalInput(t.closedAt ?? new Date().toISOString()),
    entryPrice: String(t.entryPrice),
    exitPrice: str(t.exitPrice),
    quantity: String(t.quantity),
    multiplier: String(t.multiplier),
    stopPrice: str(t.stopPrice),
    targetPrice: str(t.targetPrice),
    commission: t.commission ? String(t.commission) : "",
    swap: t.swap ? String(t.swap) : "",
    otherFees: t.otherFees ? String(t.otherFees) : "",
    fxRate: str(t.fxRate),
    useFills: !simple || t.source === "mt5",
    fills: execs.map((e) => ({ key: e.id, role: e.role, price: String(e.price), quantity: String(e.quantity), at: toLocalInput(e.executedAt), iso: e.executedAt })),
    setup: t.setup,
    planNotes: t.planNotes,
    entryReason: t.entryReason,
    exitReason: t.exitReason,
    notes: t.notes,
    lessons: t.lessons,
    emotionBefore: t.emotionBefore ?? "",
    emotionAfter: t.emotionAfter ?? "",
    mistakes: t.mistakes,
    strategyTags: t.strategyTags.join(", "),
    tags: t.tags.join(", "),
    confidence: str(t.confidence),
    discipline: str(t.discipline),
    fear: str(t.fear),
    greed: str(t.greed),
    revengeTrade: t.revengeTrade,
    overtrading: t.overtrading,
    impulsiveEntry: t.impulsiveEntry,
    earlyExit: t.earlyExit,
    ruleViolations: t.ruleViolations,
    followedPlan: t.followedPlan === null ? "" : t.followedPlan ? "yes" : "no",
    grade: t.grade ?? "",
  };
}

/** Blank is null; anything unreadable is NaN, for validation to catch. */
const n = (s: string) => (s.trim() === "" ? null : Number(s));
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const toIso = (local: string, kept?: string | null) => (kept && toLocalInput(kept) === local ? kept : fromLocalInput(local));
const good = (v: number | null): v is number => v !== null && Number.isFinite(v) && v > 0;

function fillsOf(f: FormState) {
  const pick = (role: "entry" | "exit") => f.fills.filter((x) => x.role === role).map((x) => ({ price: n(x.price), qty: n(x.quantity) }));
  const usable = (xs: { price: number | null; qty: number | null }[]) => xs.filter((x): x is { price: number; qty: number } => good(x.price) && good(x.qty));
  return { entries: usable(pick("entry")), exits: usable(pick("exit")) };
}

function toPayload(f: FormState, multiplier: string, trade: Trade | null) {
  const common = {
    accountId: Number(f.accountId),
    symbol: f.symbol,
    side: f.side,
    multiplier: n(multiplier) ?? 1,
    stopPrice: n(f.stopPrice),
    targetPrice: n(f.targetPrice),
    commission: n(f.commission) ?? 0,
    swap: n(f.swap) ?? 0,
    otherFees: n(f.otherFees) ?? 0,
    fxRate: n(f.fxRate),
    assetClass: f.assetClass || null,
    optionRight: f.assetClass === "option" ? f.optionRight || null : null,
    strike: f.assetClass === "option" ? n(f.strike) : null,
    expiry: f.assetClass === "option" ? f.expiry || null : null,
    session: f.session || null,
    strategy: f.strategy,
    strategyTags: list(f.strategyTags),
    setup: f.setup,
    tags: list(f.tags),
    emotionBefore: f.emotionBefore || null,
    emotionAfter: f.emotionAfter || null,
    followedPlan: f.followedPlan === "" ? null : f.followedPlan === "yes",
    grade: f.grade || null,
    planNotes: f.planNotes,
    notes: f.notes,
    entryReason: f.entryReason,
    exitReason: f.exitReason,
    lessons: f.lessons,
    mistakes: f.mistakes,
    confidence: n(f.confidence),
    discipline: n(f.discipline),
    fear: n(f.fear),
    greed: n(f.greed),
    revengeTrade: f.revengeTrade,
    overtrading: f.overtrading,
    impulsiveEntry: f.impulsiveEntry,
    earlyExit: f.earlyExit,
    ruleViolations: f.ruleViolations,
  };
  if (!f.useFills) {
    const exit = n(f.exitPrice);
    return {
      ...common,
      openedAt: toIso(f.openedAt, trade?.openedAt),
      closedAt: exit === null ? null : toIso(f.closedAt, trade?.closedAt),
      entryPrice: n(f.entryPrice),
      exitPrice: exit,
      quantity: n(f.quantity),
      executions: null,
    };
  }
  const { entries, exits } = fillsOf(f);
  const pos = entries.length ? computePosition({ side: f.side, symbol: "", accountCurrency: "", contractSize: 1, fxRate: 1, entries, exits }) : null;
  const executions = f.fills.map((x) => ({ role: x.role, price: n(x.price), quantity: n(x.quantity), executedAt: toIso(x.at, x.iso) }));
  const times = (role: string) => executions.filter((e) => e.role === role).map((e) => e.executedAt).filter(Boolean).sort();
  return {
    ...common,
    openedAt: times("entry")[0] ?? "",
    closedAt: pos?.status === "closed" ? (times("exit").at(-1) ?? null) : null,
    entryPrice: pos?.avgEntry ?? null,
    exitPrice: pos?.avgExit ?? null,
    quantity: pos?.enteredQty ?? null,
    executions,
  };
}

/** Field problems before anything is sent. The server checks again with the same schema. */
function validate(payload: ReturnType<typeof toPayload>, f: FormState): Record<string, string> {
  const errors: Record<string, string> = {};
  const required = f.useFills ? [] : ([["entryPrice", "Enter the entry price"], ["quantity", "Enter the size"]] as const);
  const raw: Record<string, string> = { entryPrice: f.entryPrice, exitPrice: f.exitPrice, quantity: f.quantity, stopPrice: f.stopPrice, targetPrice: f.targetPrice, commission: f.commission, swap: f.swap, otherFees: f.otherFees, fxRate: f.fxRate };
  if (f.multiplier !== null) raw.multiplier = f.multiplier;
  for (const [k, v] of Object.entries(raw)) if (v.trim() !== "" && !Number.isFinite(Number(v))) errors[k] = "Enter a number";
  for (const [k, m] of required) if (raw[k].trim() === "") errors[k] = m;
  if (!f.accountId) errors.accountId = "Choose an account";
  if (f.useFills && !f.fills.some((x) => x.role === "entry")) errors.fills = "Add at least one entry fill";
  f.fills.forEach((x, i) => {
    if (!f.useFills) return;
    if (!good(n(x.price))) errors[`executions.${i}.price`] = "Price above 0";
    if (!good(n(x.quantity))) errors[`executions.${i}.quantity`] = "Size above 0";
    if (!x.at) errors[`executions.${i}.executedAt`] = "Enter a time";
  });
  if (Object.keys(errors).length) return errors;
  const parsed = TradeInput.safeParse(payload);
  if (!parsed.success) for (const i of parsed.error.issues) errors[i.path.join(".")] ??= i.message;
  return errors;
}

export function TradeFormDialog() {
  const { editing, editTrade, loading } = useApp();
  const existing = useFetch<{ trade: Trade }>(typeof editing === "number" ? `/api/trades/${editing}` : null);
  const trade = existing.data?.trade.id === editing ? existing.data!.trade : null;
  return (
    <Dialog open={editing !== null} onClose={() => editTrade(null)} title={editing === "new" ? "Log a trade" : `Edit trade #${editing}`} wide persistent>
      {/* The body picks its default account once, when it mounts, so it waits for the accounts. */}
      {editing === "new" && (loading ? <Spinner label="Loading your accounts" /> : <TradeFormBody key="new" trade={null} />)}
      {typeof editing === "number" && (trade ? <TradeFormBody key={trade.id} trade={trade} /> : existing.error ? <p className="text-[14px] text-loss">{existing.error}</p> : <Spinner label="Loading the trade" />)}
    </Dialog>
  );
}

function Section({ title, summary, defaultOpen, force, children }: { title: string; summary?: string; defaultOpen?: boolean; force?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const shown = open || force;
  return (
    <section className="border-b border-line">
      <h3>
        <button type="button" aria-expanded={shown} onClick={() => setOpen(!shown)} className="flex w-full items-center gap-2 py-1.5 text-left text-[14px] font-medium hover:bg-raised pointer-coarse:py-3">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={cx("shrink-0 text-muted transition-transform", shown && "rotate-90")} fill="currentColor"><path d="M3 1l5 4-5 4z" /></svg>
          <span className="shrink-0">{title}</span>
          {summary && <span className="min-w-0 truncate font-normal text-[12.5px] text-muted">{summary}</span>}
        </button>
      </h3>
      {shown && <div className="pb-4">{children}</div>}
    </section>
  );
}

export function Rating({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[13px] text-ink-soft first-letter:uppercase">{label}</span>
      <div role="radiogroup" aria-label={`${label}, 1 to 5`} className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === String(v)}
            onClick={() => onChange(value === String(v) ? "" : String(v))}
            className={cx("num h-8 w-8 border text-[13px] pointer-coarse:h-11 pointer-coarse:w-11", value === String(v) ? "border-accent bg-accent-soft text-ink" : "border-line-strong text-muted hover:text-ink")}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

const grid = "grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-3";
const area = cx(inputClass, "h-auto py-1.5");

function TradeFormBody({ trade }: { trade: Trade | null }) {
  const { editTrade, accounts, settings, refresh, toast, openTrade } = useApp();
  const selectable = accounts.filter((a) => a.id === trade?.accountId || (!a.archived && a.source !== "backtest"));
  const defaultAccount = selectable.find((a) => a.id === settings?.defaultAccountId && !a.isSample) ?? selectable.find((a) => !a.isSample) ?? selectable[0];
  const [form, setForm] = useState<FormState>(() => (trade ? fromTrade(trade) : blank(defaultAccount?.id, settings?.feeDefaults)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<{ file: File; kind: Attachment["kind"] }[]>([]);
  const [attachKind, setAttachKind] = useState<Attachment["kind"]>("chart");
  const [attachments, setAttachments] = useState(trade?.attachments ?? []);
  const nextFill = useRef(-1);
  const formRef = useRef<HTMLFormElement>(null);

  const { data: facets } = useFetch<Facets>("/api/facets");
  const specs = useFetch<{ instruments: InstrumentSpec[] }>(form.accountId ? `/api/instruments?accountId=${form.accountId}` : null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => (e[k] ? Object.fromEntries(Object.entries(e).filter(([x]) => x !== k)) : e));
  };
  const err = (k: string) => errors[k];
  const locked = trade?.source === "mt5";

  const account = accounts.find((a) => String(a.id) === form.accountId);
  const currency = account?.currency ?? "USD";
  const symbol = form.symbol.trim().toUpperCase();
  const spec = specs.data?.instruments.find((i) => i.symbol === symbol) ?? specs.data?.instruments.find((i) => normalizeSymbol(i.symbol) === normalizeSymbol(symbol));
  const multiplier = form.multiplier ?? String(spec?.contractSize ?? (form.assetClass === "option" ? 100 : 1));
  const assetClass = form.assetClass || spec?.assetClass || classifySymbol(symbol);
  const suggestedSession = form.openedAt ? sessionFor(fromLocalInput(form.openedAt)) : null;

  // Live figures from the same engine the server uses, so the preview can't disagree with the saved trade.
  const simpleEntry = n(form.entryPrice);
  const simpleExit = n(form.exitPrice);
  const simpleQty = n(form.quantity);
  const { entries, exits } = form.useFills
    ? fillsOf(form)
    : { entries: good(simpleEntry) && good(simpleQty) ? [{ price: simpleEntry, qty: simpleQty }] : [], exits: good(simpleExit) && good(simpleQty) ? [{ price: simpleExit, qty: simpleQty }] : [] };
  const finite = (s: string) => (Number.isFinite(n(s)) ? n(s) : null);
  const fxRate = good(n(form.fxRate)) ? n(form.fxRate) : null;
  let preview: PositionResult | null = null;
  if (entries.length) {
    try {
      preview = computePosition({
        side: form.side,
        symbol,
        accountCurrency: currency,
        profitCurrency: spec?.profitCurrency,
        contractSize: good(n(multiplier)) ? (n(multiplier) as number) : 1,
        fxRate,
        entries,
        exits,
        commission: finite(form.commission) ?? 0,
        swap: finite(form.swap) ?? 0,
        otherFees: finite(form.otherFees) ?? 0,
        stopPrice: good(n(form.stopPrice)) ? n(form.stopPrice) : null,
        targetPrice: good(n(form.targetPrice)) ? n(form.targetPrice) : null,
        // The broker's figure stands for synced trades: it already applied its own contract size and rate.
        brokerProfit: locked && exits.length ? trade?.grossPnl : null,
      });
    } catch {
      preview = null; // Numbers too extreme for the engine: validation will say so on save.
    }
  }

  const rateNeeded = !locked && symbol !== "" && resolveFxRate({ symbol, accountCurrency: currency, profitCurrency: spec?.profitCurrency, avgExit: preview?.avgExit ?? preview?.avgEntry, provided: null }) === null;
  const profitCurrency = spec?.profitCurrency ?? parsePair(symbol)?.quote;

  const qty = preview?.enteredQty ?? 0;
  const mult = n(multiplier) ?? 0;
  const lotsLike = (assetClass === "forex" && qty > 0 && qty < 1000) || (assetClass === "metal" && qty > 0 && qty < 100);
  const notional = preview ? preview.avgEntry * qty * mult : 0;
  const notionalText = `${notional.toLocaleString("en-US", { maximumFractionDigits: 2 })}${profitCurrency ? ` ${profitCurrency}` : ""}`;

  const setFill = (key: number, patch: Partial<FillRow>) => set("fills", form.fills.map((x) => (x.key === key ? { ...x, ...patch, ...(patch.at !== undefined ? { iso: undefined } : {}) } : x)));
  const addFill = (role: "entry" | "exit") => set("fills", [...form.fills, { key: nextFill.current--, role, price: "", quantity: role === "exit" && preview ? String(preview.remainingQty || "") : "", at: toLocalInput(new Date().toISOString()) }]);

  const startFills = () => {
    const seeded: FillRow[] = form.fills.length
      ? form.fills
      : [
          { key: nextFill.current--, role: "entry", price: form.entryPrice, quantity: form.quantity, at: form.openedAt },
          ...(form.exitPrice ? [{ key: nextFill.current--, role: "exit" as const, price: form.exitPrice, quantity: form.quantity, at: form.closedAt }] : []),
        ];
    setForm((f) => ({ ...f, useFills: true, fills: seeded }));
  };
  const stopFills = () => {
    const last = form.fills.filter((x) => x.role === "exit").at(-1);
    const first = form.fills.find((x) => x.role === "entry");
    setForm((f) => ({
      ...f,
      useFills: false,
      fills: [],
      entryPrice: preview ? String(preview.avgEntry) : f.entryPrice,
      exitPrice: str(preview?.avgExit),
      quantity: preview ? String(preview.enteredQty) : f.quantity,
      openedAt: first?.at ?? f.openedAt,
      closedAt: last?.at ?? f.closedAt,
    }));
  };

  const createAccount = async () => {
    const res = await api<{ account: { id: number } }>("/api/accounts", { method: "POST", json: { name: "Main account", currency: settings?.baseCurrency ?? "USD" } });
    await refresh();
    set("accountId", String(res.account.id));
  };

  const removeAttachment = async (a: Attachment) => {
    try {
      await api(`/api/attachments/${a.id}`, { method: "DELETE" });
      setAttachments((xs) => xs.filter((x) => x.id !== a.id));
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Couldn't remove that file.", tone: "error" });
    }
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload = toPayload(form, multiplier, trade);
    const problems = validate(payload, form);
    setErrors(problems);
    if (Object.keys(problems).length) {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus());
      return;
    }
    setSaving(true);
    try {
      const res = trade
        ? await api<{ trade: Trade }>(`/api/trades/${trade.id}`, { method: "PUT", json: payload })
        : await api<{ trade: Trade }>("/api/trades", { method: "POST", json: payload });
      const failed: string[] = [];
      for (const p of pending) {
        const body = new FormData();
        body.set("file", p.file);
        body.set("kind", p.kind);
        await api(`/api/trades/${res.trade.id}/attachments`, { method: "POST", body }).catch((x: Error) => failed.push(`${p.file.name}: ${x.message}`));
      }
      await refresh();
      editTrade(null);
      toast({ message: trade ? "Trade updated." : `Logged ${res.trade.symbol}.`, tone: "success", action: { label: "View", run: () => openTrade(res.trade.id) } });
      if (failed.length) toast({ message: `Not attached. ${failed.join(" ")}`, tone: "error" });
    } catch (x) {
      const fields = fieldErrors(x);
      setErrors(fields);
      if (!Object.keys(fields).length) toast({ message: x instanceof Error ? x.message : "Couldn't save.", tone: "error" });
      else requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus());
    } finally {
      setSaving(false);
    }
  }

  const hasErr = (...keys: string[]) => keys.some((k) => Object.keys(errors).some((e) => e === k || e.startsWith(`${k}.`)));
  const fillsAreSimple = (preview?.status !== "partial") && form.fills.filter((x) => x.role === "entry").length <= 1 && form.fills.filter((x) => x.role === "exit").length <= 1;
  const wrongDirectionBadge = preview?.pnlStatus === "over_closed" ? "The exits add up to more than the entries." : null;

  // The ladder reads the same parsed values as the preview. Fills feed it their averages, and those can't be dragged.
  const usable = (s: string) => (good(n(s)) ? n(s) : null);
  const ladderEntry = form.useFills ? (preview?.avgEntry ?? null) : usable(form.entryPrice);
  const ladderExit = form.useFills ? (preview?.avgExit ?? null) : usable(form.exitPrice);
  const entryText = form.useFills ? (form.fills.find((x) => x.role === "entry")?.price ?? "") : form.entryPrice;
  const ladderDecimals = decimalsOf(entryText) ?? Math.max(decimalsOf(form.stopPrice) ?? 0, decimalsOf(form.targetPrice) ?? 0, decimalsOf(form.exitPrice) ?? 0, 2);

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="-mt-1">
      {locked && (
        <div className="mb-2">
          <Notice tone="info">This trade comes from MT5, so its prices, sizes, times and costs belong to the broker and stay as synced. You can still edit the stop, target and all your notes.</Notice>
        </div>
      )}
      {selectable.length === 0 && (
        <div className="mb-2">
          <Notice action={<Button size="sm" onClick={() => void createAccount()}>Create Main account</Button>}>You need an account to log trades in.</Notice>
        </div>
      )}
      <datalist id="trade-symbols">{facets?.symbols.map((s) => <option key={s} value={s} />)}</datalist>
      <datalist id="trade-strategies">{facets?.strategies.map((s) => <option key={s} value={s} />)}</datalist>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-6 md:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="min-w-0">
          <section aria-label="Basic" className={grid}>
            <Field label="Instrument" error={err("symbol")}>
              {(p) => <input {...p} data-autofocus={!locked || undefined} list="trade-symbols" className={cx(inputClass, "uppercase")} value={form.symbol} disabled={locked} onChange={(e) => set("symbol", e.target.value)} placeholder="EURUSD" autoComplete="off" />}
            </Field>
            <div className="flex flex-col gap-1">
              <span className="text-[13px] text-ink-soft">Direction</span>
              {locked ? <p className="flex h-9 items-center text-[14px] capitalize">{form.side}</p> : <Segmented label="Direction" value={form.side} onChange={(v) => set("side", v)} options={[{ value: "long", label: "Long" }, { value: "short", label: "Short" }]} />}
            </div>
            <Field label="Account" error={err("accountId")}>
              {(p) => (
                <select {...p} className={inputClass} value={form.accountId} disabled={locked} onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value, multiplier: trade ? f.multiplier : null }))}>
                  {selectable.length === 0 && <option value="">No accounts yet</option>}
                  {selectable.map((a) => <option key={a.id} value={a.id}>{a.name}{a.isSample ? " (sample)" : ""}</option>)}
                </select>
              )}
            </Field>
            <Field label="Strategy" error={err("strategy")} hint="A new name is created on save.">
              {(p) => <input {...p} list="trade-strategies" className={inputClass} value={form.strategy} maxLength={60} onChange={(e) => set("strategy", e.target.value)} autoComplete="off" />}
            </Field>
            {!form.useFills && (
              <>
                <Field label="Entry date and time" error={err("openedAt")} className="col-span-2 md:col-span-1">
                  {(p) => <input {...p} type="datetime-local" className={cx(inputClass, "num text-[13px]")} value={form.openedAt} disabled={locked} onChange={(e) => set("openedAt", e.target.value)} />}
                </Field>
                <Field label="Exit date and time" error={err("closedAt")} className="col-span-2 md:col-span-1" hint={form.exitPrice.trim() ? undefined : "Used once there is an exit price."}>
                  {(p) => <input {...p} type="datetime-local" className={cx(inputClass, "num text-[13px]")} value={form.closedAt} disabled={locked} onChange={(e) => set("closedAt", e.target.value)} />}
                </Field>
              </>
            )}
          </section>

          <section aria-label="Execution" className={cx(grid, "mt-3 border-t border-line pt-3")}>
            {form.useFills ? (
              <p className="col-span-2 self-center text-[13px] text-muted md:col-span-3">Entry, exit and size come from the fills below.</p>
            ) : (
              <>
                <Field label="Entry" error={err("entryPrice")}>
                  {(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={form.entryPrice} disabled={locked} onChange={(e) => set("entryPrice", e.target.value)} />}
                </Field>
                <Field label="Exit" error={err("exitPrice")} hint="Blank while open.">
                  {(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={form.exitPrice} disabled={locked} onChange={(e) => set("exitPrice", e.target.value)} />}
                </Field>
                <Field label="Quantity" error={err("quantity")} hint="Lots, units or contracts.">
                  {(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={form.quantity} disabled={locked} onChange={(e) => set("quantity", e.target.value)} />}
                </Field>
              </>
            )}
            <Field label="Stop" error={err("stopPrice")}>
              {(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={form.stopPrice} onChange={(e) => set("stopPrice", e.target.value)} />}
            </Field>
            <Field label="Target" error={err("targetPrice")}>
              {(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={form.targetPrice} onChange={(e) => set("targetPrice", e.target.value)} />}
            </Field>
            <Field
              label="Contract multiplier"
              error={err("multiplier")}
              hint={form.multiplier === null && spec?.contractSize != null ? (spec.source === "mt5" ? "From the broker's MT5 spec." : "Last entered for this account.") : "Units per 1 of quantity."}
            >
              {(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={multiplier} disabled={locked} onChange={(e) => set("multiplier", e.target.value)} />}
            </Field>
            <Field label="Commission" error={err("commission")}>
              {(p) => <input {...p} className={cx(inputClass, "num")} inputMode="text" value={form.commission} disabled={locked} placeholder="0" onChange={(e) => set("commission", e.target.value)} />}
            </Field>
            <Field label="Swap" error={err("swap")} hint="Negative for a credit.">
              {(p) => <input {...p} className={cx(inputClass, "num")} inputMode="text" value={form.swap} disabled={locked} placeholder="0" onChange={(e) => set("swap", e.target.value)} />}
            </Field>
            <Field label="Other fees" error={err("otherFees")}>
              {(p) => <input {...p} className={cx(inputClass, "num")} inputMode="text" value={form.otherFees} disabled={locked} placeholder="0" onChange={(e) => set("otherFees", e.target.value)} />}
            </Field>
            {(rateNeeded || (form.fxRate !== "" && !locked)) && (
              <Field label={`Rate, ${profitCurrency ?? "profit currency"} to ${currency}`} error={err("fxRate")} hint="Without it, P&L stays pending." className="col-span-2 md:col-span-1">
                {(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={form.fxRate} onChange={(e) => set("fxRate", e.target.value)} />}
              </Field>
            )}
          </section>
          {preview && lotsLike && mult === 1 && !locked && (
            <div className="mt-2">
              <Notice>
                A quantity of <span className="num">{qty}</span> with a multiplier of 1 on {symbol} means <span className="num">{qty}</span> units, notional <span className="num">{notionalText}</span>. If you mean lots, enter your broker&apos;s contract size as the multiplier. It differs between brokers, so Jarvis won&apos;t assume one.
              </Notice>
            </div>
          )}
        </div>

        <PriceLadder
          className="mt-4 h-80 md:mt-0 md:h-auto"
          side={form.side}
          entry={ladderEntry}
          stop={usable(form.stopPrice)}
          target={usable(form.targetPrice)}
          exit={ladderExit}
          decimals={ladderDecimals}
          lockedExit={locked ? "mt5" : form.useFills ? "fills" : null}
          preview={preview}
          currency={currency}
          onChange={(field, text) => set(field, text)}
          note={preview && qty > 0 && !lotsLike ? `Position ${(qty * mult).toLocaleString("en-US", { maximumFractionDigits: 4 })} units = ${qty} × ${mult}, notional ${notionalText}` : null}
        />
      </div>

      <div className="mt-3 border-t border-line">
        <Section title="Asset class and session" summary={`${form.assetClass || `Auto: ${assetClass}`}, ${form.session ? SESSION_LABELS[form.session] : `suggested: ${suggestedSession ? SESSION_LABELS[suggestedSession] : "none"}`}`} force={form.assetClass === "option" || hasErr("assetClass", "session", "optionRight", "strike", "expiry")}>
          <div className={grid}>
            <Field label="Asset class" error={err("assetClass")}>
              {(p) => (
                <select {...p} className={cx(inputClass, "capitalize")} value={form.assetClass} disabled={locked} onChange={(e) => set("assetClass", e.target.value)}>
                  <option value="">Auto: {assetClass}</option>
                  {ASSET_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
            </Field>
            <Field label="Session" error={err("session")}>
              {(p) => (
                <select {...p} className={inputClass} value={form.session} disabled={locked} onChange={(e) => set("session", e.target.value)}>
                  <option value="">Suggested: {suggestedSession ? SESSION_LABELS[suggestedSession] : "none"}</option>
                  {SESSIONS.map((s) => <option key={s} value={s}>{SESSION_LABELS[s]}</option>)}
                </select>
              )}
            </Field>
            {form.assetClass === "option" && (
              <>
                <Field label="Call or put" error={err("optionRight")}>
                  {(p) => (
                    <select {...p} className={inputClass} value={form.optionRight} disabled={locked} onChange={(e) => set("optionRight", e.target.value as FormState["optionRight"])}>
                      <option value="">Choose</option>
                      <option value="call">Call</option>
                      <option value="put">Put</option>
                    </select>
                  )}
                </Field>
                <Field label="Strike" error={err("strike")}>
                  {(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={form.strike} disabled={locked} onChange={(e) => set("strike", e.target.value)} />}
                </Field>
                <Field label="Expiry" error={err("expiry")}>
                  {(p) => <input {...p} type="date" className={cx(inputClass, "num text-[13px]")} value={form.expiry} disabled={locked} onChange={(e) => set("expiry", e.target.value)} />}
                </Field>
              </>
            )}
          </div>
        </Section>

        <Section title="Partial fills" summary={form.useFills ? `${form.fills.length} fills` : "Scaling in or out"} force={form.useFills || hasErr("executions", "fills")}>
          {!form.useFills ? (
            <Button size="sm" onClick={startFills}>Enter separate fills</Button>
          ) : (
            <>
              {err("fills") && <p className="mb-2 text-[12.5px] text-loss">{err("fills")}</p>}
              <ul className="space-y-2">
                {form.fills.map((x, i) => (
                  <li key={x.key} className="grid grid-cols-2 items-start gap-2 sm:grid-cols-[6.5rem_1fr_1fr_1.4fr_auto]">
                    <Field label="Side">
                      {(p) => (
                        <select {...p} className={inputClass} value={x.role} disabled={locked} onChange={(e) => setFill(x.key, { role: e.target.value as FillRow["role"] })}>
                          <option value="entry">Entry</option>
                          <option value="exit">Exit</option>
                        </select>
                      )}
                    </Field>
                    <Field label="Price" error={err(`executions.${i}.price`)}>
                      {(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={x.price} disabled={locked} onChange={(e) => setFill(x.key, { price: e.target.value })} />}
                    </Field>
                    <Field label="Size" error={err(`executions.${i}.quantity`)}>
                      {(p) => <input {...p} className={cx(inputClass, "num")} inputMode="decimal" value={x.quantity} disabled={locked} onChange={(e) => setFill(x.key, { quantity: e.target.value })} />}
                    </Field>
                    <Field label="Time" className="col-span-2 sm:col-span-1" error={err(`executions.${i}.executedAt`)}>
                      {(p) => <input {...p} type="datetime-local" className={cx(inputClass, "num text-[13px]")} value={x.at} disabled={locked} onChange={(e) => setFill(x.key, { at: e.target.value })} />}
                    </Field>
                    {!locked && <Button size="sm" variant="ghost" className="self-end" onClick={() => set("fills", form.fills.filter((y) => y.key !== x.key))} aria-label={`Remove fill ${i + 1}`}>Remove</Button>}
                  </li>
                ))}
              </ul>
              {!locked && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => addFill("entry")}>Add entry</Button>
                  <Button size="sm" onClick={() => addFill("exit")}>Add exit</Button>
                  <Button size="sm" variant="ghost" disabled={!fillsAreSimple} title={fillsAreSimple ? undefined : "Only a single entry and a full exit fit the simple form."} onClick={stopFills}>Back to one entry and exit</Button>
                </div>
              )}
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
                <div className="flex gap-2"><dt className="text-muted">Avg entry</dt><dd className="num">{preview ? preview.avgEntry : "—"}</dd></div>
                <div className="flex gap-2"><dt className="text-muted">Avg exit</dt><dd className="num">{preview?.avgExit ?? "—"}</dd></div>
                <div className="flex gap-2"><dt className="text-muted">Remaining</dt><dd className="num">{preview ? preview.remainingQty : "—"}</dd></div>
              </dl>
              {wrongDirectionBadge && <p className="mt-1 text-[12.5px] text-loss">{wrongDirectionBadge}</p>}
            </>
          )}
        </Section>

        <Section title="Analysis" summary="Reasons, emotions, mistakes, lessons, tags" force={hasErr("setup", "planNotes", "entryReason", "exitReason", "notes", "lessons", "tags", "strategyTags")} defaultOpen={Boolean(trade && (trade.setup || trade.notes || trade.planNotes))}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Setup name" error={err("setup")} hint="Short, so trades can be grouped by it.">
              {(p) => <input {...p} className={inputClass} value={form.setup} maxLength={60} onChange={(e) => set("setup", e.target.value)} />}
            </Field>
            <Field label="Setup description" error={err("planNotes")}>
              {(p) => <textarea {...p} rows={2} className={area} value={form.planNotes} onChange={(e) => set("planNotes", e.target.value)} />}
            </Field>
            <Field label="Entry reason" error={err("entryReason")}>
              {(p) => <textarea {...p} rows={2} className={area} value={form.entryReason} onChange={(e) => set("entryReason", e.target.value)} />}
            </Field>
            <Field label="Exit reason" error={err("exitReason")}>
              {(p) => <textarea {...p} rows={2} className={area} value={form.exitReason} onChange={(e) => set("exitReason", e.target.value)} />}
            </Field>
            <Field label="Notes" error={err("notes")}>
              {(p) => <textarea {...p} rows={2} className={area} value={form.notes} onChange={(e) => set("notes", e.target.value)} />}
            </Field>
            <Field label="Lessons" error={err("lessons")}>
              {(p) => <textarea {...p} rows={2} className={area} value={form.lessons} onChange={(e) => set("lessons", e.target.value)} />}
            </Field>
            <Field label="Feeling before" error={err("emotionBefore")}>
              {(p) => (
                <select {...p} className={cx(inputClass, "capitalize")} value={form.emotionBefore} onChange={(e) => set("emotionBefore", e.target.value)}>
                  <option value="">Not recorded</option>
                  {EMOTIONS.map((x) => <option key={x}>{x}</option>)}
                </select>
              )}
            </Field>
            <Field label="Feeling after" error={err("emotionAfter")}>
              {(p) => (
                <select {...p} className={cx(inputClass, "capitalize")} value={form.emotionAfter} onChange={(e) => set("emotionAfter", e.target.value)}>
                  <option value="">Not recorded</option>
                  {EMOTIONS.map((x) => <option key={x}>{x}</option>)}
                </select>
              )}
            </Field>
            <div className="sm:col-span-2">
              <span className="text-[13px] text-ink-soft" id="mistakes-label">Mistakes</span>
              <div role="group" aria-labelledby="mistakes-label" className="mt-1 flex flex-wrap gap-1.5">
                {MISTAKES.map((m) => {
                  const on = form.mistakes.includes(m);
                  return (
                    <button key={m} type="button" aria-pressed={on} onClick={() => set("mistakes", on ? form.mistakes.filter((x) => x !== m) : [...form.mistakes, m])} className={cx("border px-2 py-1 text-[13px] pointer-coarse:py-2.5", on ? "border-accent bg-accent-soft text-ink" : "border-line-strong text-muted hover:text-ink")}>
                      {nice(m)}
                    </button>
                  );
                })}
              </div>
            </div>
            <Field label="Strategy tags" error={err("strategyTags")} hint="Comma-separated.">
              {(p) => <input {...p} className={inputClass} value={form.strategyTags} onChange={(e) => set("strategyTags", e.target.value)} />}
            </Field>
            <Field label="Custom tags" error={err("tags")} hint="Comma-separated.">
              {(p) => <input {...p} className={inputClass} value={form.tags} onChange={(e) => set("tags", e.target.value)} />}
            </Field>
          </div>
        </Section>

        <Section title="Psychology" summary="Ratings, behaviour flags, plan, grade" force={hasErr("ruleViolations")}>
          <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {RATINGS.map((r) => <Rating key={r} label={r} value={form[r]} onChange={(v) => set(r, v)} />)}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            {FLAGS.map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-[13.5px]">
                <input type="checkbox" className="accent-[var(--accent)]" checked={form[k]} onChange={(e) => set(k, e.target.checked)} />
                {label}
              </label>
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_10rem_6rem]">
            <Field label="Rule violations" error={err("ruleViolations")}>
              {(p) => <input {...p} className={inputClass} value={form.ruleViolations} onChange={(e) => set("ruleViolations", e.target.value)} />}
            </Field>
            <Field label="Followed plan?">
              {(p) => (
                <select {...p} className={inputClass} value={form.followedPlan} onChange={(e) => set("followedPlan", e.target.value)}>
                  <option value="">Not answered</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              )}
            </Field>
            <Field label="Grade">
              {(p) => (
                <select {...p} className={inputClass} value={form.grade} onChange={(e) => set("grade", e.target.value)}>
                  <option value="">None</option>
                  {GRADES.map((g) => <option key={g}>{g}</option>)}
                </select>
              )}
            </Field>
          </div>
        </Section>

        <Section title="Attachments" summary={attachments.length + pending.length ? `${attachments.length + pending.length} ${attachments.length + pending.length === 1 ? "file" : "files"}` : "Screenshots and documents"} defaultOpen={attachments.length > 0}>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Attachment kind" className={cx(inputClass, "!w-auto")} value={attachKind} onChange={(e) => setAttachKind(e.target.value as Attachment["kind"])}>
              {ATTACH_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <label className="inline-flex h-9 cursor-pointer items-center border border-line-strong px-3 text-[13px] font-medium hover:bg-raised focus-within:outline-2 focus-within:outline-[var(--focus)]">
              Choose files
              <input
                type="file"
                multiple
                accept=".png,.jpg,.jpeg,.webp,.pdf"
                className="sr-only"
                onChange={(e) => {
                  const chosen = [...(e.target.files ?? [])];
                  setPending((xs) => [...xs, ...chosen.map((file) => ({ file, kind: attachKind }))]);
                  e.target.value = "";
                }}
              />
            </label>
            <span className="text-[12.5px] text-muted">PNG, JPEG, WEBP or PDF, up to 10 MB each. Files upload when you save.</span>
          </div>
          {(attachments.length > 0 || pending.length > 0) && (
            <ul className="mt-2.5 divide-y divide-line text-[13.5px]">
              {attachments.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-1.5">
                  <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate underline-offset-2 hover:underline">{a.filename}</a>
                  <span className="text-[12.5px] text-muted">{a.kind}, <span className="num">{fileSize(a.size)}</span></span>
                  <Button size="sm" variant="ghost" onClick={() => void removeAttachment(a)}>Remove</Button>
                </li>
              ))}
              {pending.map((p, i) => (
                <li key={`${p.file.name}${i}`} className="flex items-center gap-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate">{p.file.name}</span>
                  <span className="text-[12.5px] text-muted">{p.kind}, <span className="num">{fileSize(p.file.size)}</span>, not saved yet</span>
                  <Button size="sm" variant="ghost" onClick={() => setPending((xs) => xs.filter((_, j) => j !== i))}>Remove</Button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="sticky -bottom-4 z-10 -mx-card -mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line bg-surface px-card py-2.5">
        <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-[12.5px]" aria-live="polite">
          {preview ? (
            <>
              <PreviewItem label="Gross" value={preview.pnlStatus === "needs_rate" ? "needs rate" : money(preview.grossPnl, currency, true)} />
              <PreviewItem label="Net" value={preview.pnlStatus === "needs_rate" ? "needs rate" : money(preview.netPnl, currency, true)} />
              <PreviewItem label="Risk" value={money(preview.initialRisk, currency)} />
              <PreviewItem label="R" value={rFmt(preview.rMultiple)} />
              <PreviewItem label="Planned" value={preview.plannedR === null ? "—" : `${preview.plannedR}R`} />
            </>
          ) : (
            <span className="text-muted">Enter entry and quantity to preview the result.</span>
          )}
        </dl>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={() => editTrade(null)}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={saving || selectable.length === 0}>{saving ? "Saving" : "Save trade"}</Button>
        </div>
      </div>
    </form>
  );
}

function PreviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="num text-ink">{value}</dd>
    </div>
  );
}
