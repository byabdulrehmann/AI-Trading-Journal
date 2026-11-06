"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { dateTime } from "@/lib/client/format";
import { useFetch } from "@/lib/client/use-fetch";
import type { Note, NoteLink } from "@/lib/domain/notes";
import type { Trade } from "@/lib/domain/types";
import { RichText } from "@/components/jarvis/RichText";
import { Badge, Button, Field, Segmented, cx, inputClass } from "@/components/ui";

const SAVE_AFTER_MS = 800;
const parseTags = (text: string) => [...new Set(text.split(",").map((t) => t.trim()).filter(Boolean))];

const TOOLS: { label: string; title: string; apply: (selected: string) => string }[] = [
  { label: "Heading", title: "Heading", apply: (s) => `\n## ${s || "Heading"}\n` },
  { label: "Bold", title: "Bold", apply: (s) => `**${s || "bold"}**` },
  { label: "List", title: "Bulleted list", apply: (s) => (s ? s.split("\n").map((l) => `- ${l}`).join("\n") : "\n- ") },
  { label: "Checklist", title: "Checklist", apply: (s) => (s ? s.split("\n").map((l) => `- [ ] ${l}`).join("\n") : "\n- [ ] ") },
  { label: "Trade", title: "Link a trade by its number", apply: (s) => `[#${/^\d+$/.test(s) ? s : "123"}]` },
];

type Draft = { title: string; body: string; folderId: number | null; tags: string };

/** Saves itself shortly after you stop typing, and when you leave the note. */
export function NoteEditor({ note, folders, sample, onChanged, onDeleted, onSaveTemplate }: { note: Note; folders: { id: number; name: string }[]; sample: boolean; onChanged: () => void; onDeleted: () => void; onSaveTemplate: (name: string, body: string) => Promise<boolean> }) {
  const { toast, openTrade } = useApp();
  const [draft, setDraft] = useState<Draft>({ title: note.title, body: note.body, folderId: note.folderId, tags: note.tags.join(", ") });
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [status, setStatus] = useState("");
  const [links, setLinks] = useState<NoteLink[]>(note.links);
  const [versions, setVersions] = useState(note.versions);
  const [templateName, setTemplateName] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dirty = useRef<Draft | null>(null);

  const flush = async () => {
    clearTimeout(timer.current);
    const d = dirty.current;
    if (!d) return;
    dirty.current = null;
    setStatus("Saving");
    try {
      const res = await api<{ note: Note }>(`/api/notes/${note.id}`, { method: "PATCH", json: { title: d.title, body: d.body, folderId: d.folderId, tags: parseTags(d.tags) } });
      setVersions(res.note.versions);
      setStatus(dirty.current ? "Saving" : "Saved");
      onChanged();
    } catch (e) {
      setStatus("Not saved");
      toast({ message: e instanceof Error ? e.message : "Couldn't save this note.", tone: "error" });
    }
  };

  const change = (patch: Partial<Draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    dirty.current = next;
    setStatus("Unsaved");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
  };

  // Leaving the note, or closing the tab, must not lose what was just typed.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => {
    const beforeLeaving = () => {
      const d = dirty.current;
      if (d) void fetch(`/api/notes/${note.id}`, { method: "PATCH", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ title: d.title, body: d.body, folderId: d.folderId, tags: parseTags(d.tags) }) });
    };
    window.addEventListener("pagehide", beforeLeaving);
    return () => {
      window.removeEventListener("pagehide", beforeLeaving);
      void flushRef.current();
    };
  }, [note.id]);

  const applyTool = (apply: (s: string) => string) => {
    const el = area.current;
    if (!el) return;
    const [start, end] = [el.selectionStart, el.selectionEnd];
    const inserted = apply(draft.body.slice(start, end));
    change({ body: draft.body.slice(0, start) + inserted + draft.body.slice(end) });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + inserted.length, start + inserted.length);
    });
  };

  const saveLinks = async (next: { kind: "trade"; tradeId: number }[] | { kind: "day"; day: string }[] | (NoteLink | { kind: "trade"; tradeId: number } | { kind: "day"; day: string })[]) => {
    try {
      const res = await api<{ note: Note }>(`/api/notes/${note.id}`, { method: "PATCH", json: { links: next.map((l) => (l.kind === "trade" ? { kind: "trade", tradeId: l.tradeId } : { kind: "day", day: l.day })) } });
      setLinks(res.note.links);
      onChanged();
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Couldn't save the link.", tone: "error" });
    }
  };

  const remove = async () => {
    clearTimeout(timer.current);
    dirty.current = null;
    try {
      await api(`/api/notes/${note.id}`, { method: "DELETE" });
      onDeleted();
      toast({
        message: "Note deleted.",
        action: {
          label: "Undo",
          run: async () => {
            await api(`/api/notes/${note.id}`, { method: "POST", json: { action: "undelete" } });
            onChanged();
          },
        },
      });
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Couldn't delete.", tone: "error" });
    }
  };

  const restore = async (versionId: number) => {
    await flush();
    try {
      const res = await api<{ note: Note }>(`/api/notes/${note.id}`, { method: "POST", json: { action: "restoreVersion", versionId } });
      setDraft((d) => ({ ...d, title: res.note.title, body: res.note.body }));
      setVersions(res.note.versions);
      setStatus("Restored");
      onChanged();
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Couldn't restore that version.", tone: "error" });
    }
  };

  return (
    <article className="min-w-0 space-y-4" aria-label="Note">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span role="status" data-testid="note-status" className="text-[13px] text-muted">{status || `Edited ${dateTime(note.updatedAt)}`}</span>
        <span className="flex flex-wrap items-center gap-2">
          {note.isSample && <Badge tone="info">Sample</Badge>}
          <a href={`/api/notes/${note.id}?format=markdown`} download className="inline-flex h-8 items-center border border-line-strong px-3 text-[13px] font-medium hover:bg-raised max-sm:h-11">Download</a>
          <Button size="sm" variant="danger" className="max-sm:h-11" onClick={() => void remove()}>Delete note</Button>
        </span>
      </div>

      <input aria-label="Title" className={cx(inputClass, "h-10 text-[18px] font-medium")} placeholder="Untitled" maxLength={200} value={draft.title} onChange={(e) => change({ title: e.target.value })} onBlur={() => void flush()} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Folder">
          {(p) => (
            <select {...p} className={inputClass} value={draft.folderId ?? ""} onChange={(e) => change({ folderId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">No folder</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Tags" hint="Separate them with commas">
          {(p) => <input {...p} className={inputClass} value={draft.tags} onChange={(e) => change({ tags: e.target.value })} onBlur={() => void flush()} />}
        </Field>
      </div>

      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <Segmented label="Editor view" value={mode} onChange={setMode} options={[{ value: "write", label: "Write" }, { value: "preview", label: "Preview" }]} />
          {mode === "write" && (
            <span role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-1">
              {TOOLS.map((t) => <Button key={t.label} size="sm" variant="ghost" className="max-sm:h-11" title={t.title} onClick={() => applyTool(t.apply)}>{t.label}</Button>)}
            </span>
          )}
        </div>
        {mode === "write" ? (
          <textarea ref={area} aria-label="Note body" rows={18} maxLength={100_000} className={cx(inputClass, "h-auto py-2 leading-relaxed")} value={draft.body} onChange={(e) => change({ body: e.target.value })} onBlur={() => void flush()} />
        ) : (
          <div className="min-h-64 border border-line px-3 py-2 text-[14px] leading-relaxed text-ink-soft" data-testid="note-preview">
            {draft.body.trim() ? <RichText text={draft.body} /> : <p className="text-muted">Nothing to preview yet.</p>}
          </div>
        )}
      </div>

      <LinkEditor links={links} sample={sample} onSave={saveLinks} openTrade={openTrade} />

      <details className="border-t border-line pt-3 text-[13.5px]" data-testid="versions">
        <summary className="cursor-pointer font-medium text-ink">Earlier versions ({versions.length})</summary>
        {versions.length === 0 ? (
          <p className="mt-2 text-muted">Jarvis keeps a copy of the note when you come back to change it after a few minutes.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 py-1.5">
                <span className="num text-[12.5px] text-muted">{dateTime(v.createdAt)}</span>
                <span className="min-w-0 flex-1 basis-40 truncate text-ink-soft">{v.title || "Untitled"}: {v.preview || "Empty"}</span>
                <Button size="sm" variant="ghost" className="max-sm:h-11" onClick={() => void restore(v.id)}>Restore</Button>
              </li>
            ))}
          </ul>
        )}
      </details>

      <form
        className="flex flex-wrap items-end gap-2 border-t border-line pt-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await onSaveTemplate(templateName, draft.body)) setTemplateName("");
        }}
      >
        <Field label="Save as a template">
          {(p) => <input {...p} className={cx(inputClass, "w-56!")} maxLength={60} placeholder="Template name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />}
        </Field>
        <Button type="submit" className="max-sm:h-11" disabled={!templateName.trim()}>Save template</Button>
      </form>
    </article>
  );
}

function LinkEditor({ links, sample, onSave, openTrade }: { links: NoteLink[]; sample: boolean; onSave: (next: (NoteLink | { kind: "trade"; tradeId: number } | { kind: "day"; day: string })[]) => Promise<void>; openTrade: (id: number) => void }) {
  const [day, setDay] = useState("");
  const [q, setQ] = useState("");
  const found = useFetch<{ trades: Trade[] }>(q.trim() ? `/api/trades?q=${encodeURIComponent(q.trim())}&pageSize=6${sample ? "&includeSample=1" : ""}` : null);
  const linked = new Set(links.map((l) => l.tradeId));

  return (
    <section className="border-t border-line pt-3" aria-label="Linked trades and days" data-testid="note-links">
      <h3 className="text-[13px] font-medium text-ink">Linked trades and days</h3>
      {links.length === 0 ? (
        <p className="mt-1 text-[13px] text-muted">Link this note to a trade or a day, and it shows there too.</p>
      ) : (
        <ul className="mt-1 divide-y divide-line border-y border-line text-[13.5px]">
          {links.map((l) => (
            <li key={l.tradeId ?? l.day} className="flex items-center gap-2 py-1">
              {l.kind === "trade" ? (
                <button type="button" className="min-h-8 flex-1 text-left font-medium hover:underline" onClick={() => openTrade(l.tradeId as number)}>{l.label}</button>
              ) : (
                <a href={`/day?date=${l.day}`} className="num min-h-8 flex-1 leading-8 hover:underline">{l.label}</a>
              )}
              <Button size="sm" variant="ghost" className="max-sm:h-11" aria-label={`Remove link to ${l.label}`} onClick={() => void onSave(links.filter((x) => x !== l))}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div>
          <Field label="Find a trade to link" hint="Symbol, notes or #number">
            {(p) => <input {...p} type="search" className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} />}
          </Field>
          {q.trim() && found.data && (
            <ul className="mt-1 divide-y divide-line border-y border-line text-[13px]" data-testid="trade-results">
              {found.data.trades.filter((t) => !linked.has(t.id)).map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="flex w-full min-h-8 items-center justify-between gap-3 text-left hover:bg-raised max-sm:min-h-11"
                    onClick={() => {
                      setQ("");
                      void onSave([...links, { kind: "trade", tradeId: t.id }]);
                    }}
                  >
                    <span className="font-medium">{t.symbol}, #{t.id}</span>
                    <span className="num text-[12.5px] text-muted">{dateTime(t.openedAt)}</span>
                  </button>
                </li>
              ))}
              {found.data.trades.filter((t) => !linked.has(t.id)).length === 0 && <li className="py-1.5 text-muted">No trades to link match that.</li>}
            </ul>
          )}
        </div>
        <div className="flex items-start gap-2">
          <Field label="Link a day" className="min-w-0 flex-1">
            {(p) => <input {...p} type="date" className={cx(inputClass, "num text-[13px]")} value={day} onChange={(e) => setDay(e.target.value)} />}
          </Field>
          <Button className="mt-[1.5rem] max-sm:h-11" disabled={!day} onClick={() => { void onSave([...links, { kind: "day", day }]); setDay(""); }}>Add</Button>
        </div>
      </div>
    </section>
  );
}
