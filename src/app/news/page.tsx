"use client";

import { useState } from "react";
import { api, fieldErrors } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { timeOnly, zoneName } from "@/lib/client/format";
import { useFetch } from "@/lib/client/use-fetch";
import { IMPACTS, IMPACT_LABELS, type EventData, type Impact } from "@/lib/domain/econ";
import { zoneDateKey, zoneInstant } from "@/lib/domain/zone";
import { Suspended } from "@/components/Suspended";
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, Notice, PageHeader, Segmented, Spinner, cx, inputClass } from "@/components/ui";

interface Event extends EventData {
  id: number;
  source: "manual" | "csv";
}
interface Rule {
  id: number;
  tag: string;
  conditions: { field: string }[];
}

const impactTone = (i: Impact) => ({ high: "loss", medium: "warn", low: "neutral", holiday: "info" }[i] as "loss" | "warn" | "neutral" | "info");
const dayLabel = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });
const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const zones = (): string[] => (typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []);

export default function NewsPage() {
  return (
    <Suspended>
      <Calendar />
    </Suspended>
  );
}

function Calendar() {
  const { settings, toast } = useApp();
  const tz = settings?.timeZone || undefined;
  const { data, error, reload } = useFetch<{ events: Event[] }>("/api/events");
  const rules = useFetch<{ rules: Rule[] }>("/api/tag-rules");
  const [show, setShow] = useState<"upcoming" | "past" | "all">("upcoming");
  const [impact, setImpact] = useState<"all" | "high">("all");
  const [currency, setCurrency] = useState("");
  const [dialog, setDialog] = useState<"add" | "import" | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const [today] = useState(() => zoneDateKey(Date.now(), tz));
  const all = data?.events ?? [];
  const shown = all
    .filter((e) => (show === "all" ? true : show === "upcoming" ? zoneDateKey(e.at, tz) >= today : zoneDateKey(e.at, tz) < today))
    .filter((e) => impact === "all" || e.impact === "high")
    .filter((e) => !currency || e.currency === currency);
  if (show === "past") shown.reverse();
  const days = Map.groupBy(shown, (e) => zoneDateKey(e.at, tz));
  const hasNewsRule = rules.data?.rules.some((r) => r.conditions.some((c) => c.field === "news"));

  const remove = async (e: Event) => {
    try {
      await api(`/api/events/${e.id}`, { method: "DELETE" });
      reload();
    } catch (err) {
      toast({ message: message(err, "Couldn't delete it."), tone: "error" });
    }
  };
  const addNewsRule = async () => {
    try {
      const r = await api<{ tagged: number }>("/api/tag-rules", { method: "POST", json: { tag: "News", conditions: [{ field: "news", op: "within", value: "15" }] } });
      rules.reload();
      toast({ message: `Added the rule. ${r.tagged} trade${r.tagged === 1 ? "" : "s"} tagged News so far.`, tone: "success" });
    } catch (err) {
      toast({ message: message(err, "Couldn't add the rule."), tone: "error" });
    }
  };

  return (
    <div>
      <PageHeader
        title="Economic calendar"
        description="Events you add by hand or import from a calendar CSV you downloaded. Jarvis doesn't fetch news from anywhere, so this holds only what you put in."
        actions={<><Button onClick={() => setDialog("import")}>Import CSV</Button><Button variant="primary" onClick={() => setDialog("add")}>Add event</Button></>}
      />
      {data && all.length > 0 && rules.data && !hasNewsRule && (
        <div className="mb-4">
          <Notice tone="info" action={<Button size="sm" onClick={() => void addNewsRule()}>Add the rule</Button>}>
            Tag trades opened within 15 minutes of a high-impact event for their symbol as News, so reports can show how you trade around it. You can change or delete the rule in Settings.
          </Notice>
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Segmented label="Show" value={show} onChange={setShow} options={[{ value: "upcoming", label: "Today and later" }, { value: "past", label: "Past" }, { value: "all", label: "All" }]} />
        <Segmented label="Impact" value={impact} onChange={setImpact} options={[{ value: "all", label: "Any impact" }, { value: "high", label: "High only" }]} />
        <label className="sr-only" htmlFor="ev-currency">Currency</label>
        <select id="ev-currency" className={cx(inputClass, "w-auto")} value={currency} onChange={(e) => setCurrency(e.target.value)}>
          <option value="">All currencies</option>
          {[...new Set(all.map((e) => e.currency))].sort().map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>

      {error && !data ? (
        <EmptyState title="Couldn't load the calendar" body={error} action={<Button onClick={reload}>Try again</Button>} />
      ) : !data ? (
        <Spinner label="Loading the calendar" />
      ) : all.length === 0 ? (
        <EmptyState title="No events yet" body="Add the releases you watch, such as payrolls, CPI or rate decisions, or import a week of them from a CSV." action={<Button variant="primary" onClick={() => setDialog("add")}>Add event</Button>} />
      ) : shown.length === 0 ? (
        <p className="text-[13.5px] text-muted">No events match. Try another filter.</p>
      ) : (
        <div className="flex flex-col gap-4" data-testid="events">
          {[...days].map(([day, events]) => (
            <Card key={day}>
              <CardHeader title={dayLabel(day)} subtitle={day === today ? "Today" : undefined} />
              <div className="overflow-x-auto">
                <table className="w-full text-[13.5px]">
                  <thead className="text-left text-[12.5px] text-muted">
                    <tr className="border-b border-line">
                      <th scope="col" className="py-1.5 font-normal">Time, {zoneName()}</th>
                      <th scope="col" className="py-1.5 pl-3 font-normal">Event</th>
                      <th scope="col" className="py-1.5 pl-3 text-right font-normal max-sm:hidden">Actual</th>
                      <th scope="col" className="py-1.5 pl-3 text-right font-normal max-sm:hidden">Forecast</th>
                      <th scope="col" className="py-1.5 pl-3 text-right font-normal max-sm:hidden">Previous</th>
                      <td />
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e) => (
                      <tr key={e.id} className="border-b border-line" data-testid="event">
                        <td className="num py-1.5 whitespace-nowrap">{e.allDay ? "All day" : timeOnly(e.at)}</td>
                        <td className="py-1.5 pl-3">
                          <span className="num mr-2 text-ink-soft">{e.currency}</span>
                          {e.title} <Badge tone={impactTone(e.impact)} className="ml-1">{IMPACT_LABELS[e.impact]}</Badge>
                        </td>
                        <td className="num py-1.5 pl-3 text-right max-sm:hidden">{e.actual || "—"}</td>
                        <td className="num py-1.5 pl-3 text-right text-ink-soft max-sm:hidden">{e.forecast || "—"}</td>
                        <td className="num py-1.5 pl-3 text-right text-ink-soft max-sm:hidden">{e.previous || "—"}</td>
                        <td className="py-1.5 pl-3 text-right"><Button size="sm" variant="ghost" aria-label={`Delete ${e.currency} ${e.title}`} onClick={() => void remove(e)}>Delete</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}

      {all.length > 0 && (
        <div className="mt-8 border-t border-line pt-4">
          <h2 className="text-[14px] font-medium">Clear the calendar</h2>
          <p className="mt-1 text-[13px] text-muted">Deletes all {all.length} events. Tags already added to trades stay.</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <label htmlFor="confirm-clear" className="sr-only">Type DELETE to confirm</label>
            <input id="confirm-clear" className={cx(inputClass, "sm:w-56")} placeholder="Type DELETE to confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
            <Button variant="danger" disabled={confirmText !== "DELETE"} onClick={async () => { await api("/api/events", { method: "DELETE", json: { confirm: "DELETE" } }); setConfirmText(""); reload(); }}>Delete all events</Button>
          </div>
        </div>
      )}

      <AddEvent open={dialog === "add"} onClose={() => setDialog(null)} onSaved={reload} />
      <ImportEvents open={dialog === "import"} onClose={() => setDialog(null)} onSaved={reload} />
    </div>
  );
}

function AddEvent({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { settings, toast } = useApp();
  const tz = settings?.timeZone || undefined;
  const blank = () => ({ date: zoneDateKey(Date.now(), tz), time: "", currency: "USD", title: "", impact: "high" as Impact, forecast: "", previous: "", actual: "" });
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof ReturnType<typeof blank>, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const [y, m, d] = form.date.split("-").map(Number);
    const [h, mi] = form.time ? form.time.split(":").map(Number) : [0, 0];
    const at = form.date ? new Date(zoneInstant(y, m, d, h, mi, tz)).toISOString() : "";
    try {
      const r = await api<{ tagged: number }>("/api/events", { method: "POST", json: { at, allDay: !form.time, currency: form.currency, title: form.title, impact: form.impact, forecast: form.forecast, previous: form.previous, actual: form.actual } });
      toast({ message: r.tagged ? `Event added. ${r.tagged} trade tag${r.tagged === 1 ? "" : "s"} added by your rules.` : "Event added.", tone: "success" });
      setForm((f) => ({ ...blank(), date: f.date, currency: f.currency }));
      setErrors({});
      onSaved();
      onClose();
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(fe);
      if (!Object.keys(fe).length) toast({ message: message(err, "Couldn't add it."), tone: "error" });
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Add an event">
      <form onSubmit={save} className="grid grid-cols-2 gap-x-4 gap-y-3" noValidate>
        <Field label="Date" error={errors.at}>{(p) => <input {...p} data-autofocus type="date" className={cx(inputClass, "num")} value={form.date} onChange={(e) => set("date", e.target.value)} />}</Field>
        <Field label={`Time, ${zoneName()}`} hint="Leave empty for an all-day event.">{(p) => <input {...p} type="time" className={cx(inputClass, "num")} value={form.time} onChange={(e) => set("time", e.target.value)} />}</Field>
        <Field label="Event" error={errors.title} className="col-span-2">{(p) => <input {...p} className={inputClass} maxLength={120} placeholder="Non-farm payrolls" value={form.title} onChange={(e) => set("title", e.target.value)} />}</Field>
        <Field label="Currency" error={errors.currency}>{(p) => <input {...p} className={cx(inputClass, "uppercase")} maxLength={3} value={form.currency} onChange={(e) => set("currency", e.target.value)} />}</Field>
        <Field label="Impact" error={errors.impact}>{(p) => <select {...p} className={inputClass} value={form.impact} onChange={(e) => set("impact", e.target.value)}>{IMPACTS.map((i) => <option key={i} value={i}>{IMPACT_LABELS[i]}</option>)}</select>}</Field>
        <Field label="Forecast" error={errors.forecast}>{(p) => <input {...p} className={cx(inputClass, "num")} maxLength={30} value={form.forecast} onChange={(e) => set("forecast", e.target.value)} />}</Field>
        <Field label="Previous" error={errors.previous}>{(p) => <input {...p} className={cx(inputClass, "num")} maxLength={30} value={form.previous} onChange={(e) => set("previous", e.target.value)} />}</Field>
        <Field label="Actual" error={errors.actual} hint="Optional, once it's out.">{(p) => <input {...p} className={cx(inputClass, "num")} maxLength={30} value={form.actual} onChange={(e) => set("actual", e.target.value)} />}</Field>
        <div className="col-span-2 flex justify-end gap-2"><Button type="button" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary">Add event</Button></div>
      </form>
    </Dialog>
  );
}

interface Preview {
  count: number;
  preview: EventData[];
  errors: { line: number; message: string }[];
  errorCount: number;
}

function ImportEvents({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { settings, toast } = useApp();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [zone, setZone] = useState(settings?.timeZone ?? "");
  const [dayFirst, setDayFirst] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  const read = async (text: string, z: string, df: boolean) => {
    setPreview(null);
    setProblem("");
    if (!text) return;
    try {
      setPreview(await api<Preview>("/api/events/import", { method: "POST", json: { csv: text, zone: z, dayFirst: df } }));
    } catch (err) {
      setProblem(message(err, "Couldn't read the file."));
    }
  };
  const close = () => {
    setCsv("");
    setFileName("");
    setPreview(null);
    setProblem("");
    onClose();
  };
  const commit = async () => {
    setBusy(true);
    try {
      const r = await api<{ added: number; skipped: number; tagged: number }>("/api/events/import", { method: "POST", json: { csv, zone, dayFirst, commit: true } });
      toast({ message: `Imported ${r.added} event${r.added === 1 ? "" : "s"}${r.skipped ? `, ${r.skipped} already there` : ""}${r.tagged ? `. ${r.tagged} trade tag${r.tagged === 1 ? "" : "s"} added by your rules` : ""}.`, tone: "success" });
      onSaved();
      close();
    } catch (err) {
      setProblem(message(err, "Couldn't import it."));
    } finally {
      setBusy(false);
    }
  };
  const showZone = (iso: string, allDay: boolean) => new Date(iso).toLocaleString("en-US", { timeZone: zone || undefined, month: "short", day: "numeric", ...(allDay ? {} : { hour: "numeric", minute: "2-digit" }) }) + (allDay ? ", all day" : "");

  return (
    <Dialog open={open} onClose={close} title="Import events from a CSV" wide>
      <div className="flex flex-col gap-4">
        <p className="text-[13.5px] text-ink-soft">The first row must name the columns. Jarvis needs a date, currency, event and impact column, and reads time, actual, forecast and previous when they are there. Dates like 2026-11-06, 11-06-2026 or 06/11/2026 work, with times like 13:30 or 8:30am.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="File">
            {(p) => (
              <input {...p} type="file" accept=".csv,text/csv" className="text-[13px]" onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const text = await f.text();
                setCsv(text);
                setFileName(f.name);
                void read(text, zone, dayFirst);
              }} />
            )}
          </Field>
          <Field label="Times in the file are in" hint="The zone the calendar was set to when you exported it.">
            {(p) => (
              <select {...p} className={inputClass} value={zone} onChange={(e) => { setZone(e.target.value); void read(csv, e.target.value, dayFirst); }}>
                <option value="">This computer&apos;s time zone</option>
                {zones().map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
              </select>
            )}
          </Field>
          <Field label="Dates with slashes" hint="Like 06/11/2026.">
            {(p) => (
              <select {...p} className={inputClass} value={dayFirst ? "day" : "month"} onChange={(e) => { setDayFirst(e.target.value === "day"); void read(csv, zone, e.target.value === "day"); }}>
                <option value="month">Month first (US)</option>
                <option value="day">Day first</option>
              </select>
            )}
          </Field>
        </div>
        {problem && <Notice tone="loss">{problem}</Notice>}
        {preview && (
          <div data-testid="import-preview">
            <p className="text-[13.5px]"><strong className="font-medium">{preview.count}</strong> event{preview.count === 1 ? "" : "s"} read from {fileName}{preview.errorCount ? `, ${preview.errorCount} row${preview.errorCount === 1 ? "" : "s"} skipped` : ""}.</p>
            {preview.preview.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[13px] text-ink-soft">
                {preview.preview.map((e, i) => <li key={i}><span className="num">{showZone(e.at, e.allDay)}</span>: {e.currency} {e.title} ({IMPACT_LABELS[e.impact].toLowerCase()})</li>)}
              </ul>
            )}
            {preview.errors.length > 0 && (
              <details className="mt-2 text-[13px]">
                <summary className="cursor-pointer text-warn">Rows that couldn&apos;t be read</summary>
                <ul className="mt-1 space-y-0.5 text-muted">{preview.errors.map((e) => <li key={e.line}>Line {e.line}: {e.message}</li>)}</ul>
              </details>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!preview?.count || busy} onClick={() => void commit()}>{preview?.count ? `Import ${preview.count} event${preview.count === 1 ? "" : "s"}` : "Import"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
