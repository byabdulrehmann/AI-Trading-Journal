"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { api, fieldErrors } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { dateOnly } from "@/lib/client/format";
import { useFetch } from "@/lib/client/use-fetch";
import type { Note, NoteSummary } from "@/lib/domain/notes";
import { NoteEditor } from "@/components/notebook/NoteEditor";
import { Suspended } from "@/components/Suspended";
import { Badge, Button, EmptyState, Field, PageHeader, Spinner, cx, inputClass } from "@/components/ui";

interface Folder {
  id: number;
  name: string;
  isSample: boolean;
  count: number;
}
interface Listing {
  notes: NoteSummary[];
  folders: Folder[];
  tags: string[];
  templates: { builtIn: { name: string; body: string }[]; own: { id: number; name: string; body: string }[] };
}

export default function NotebookPage() {
  return (
    <Suspended>
      <Notebook />
    </Suspended>
  );
}

const folderLink = "flex min-h-8 w-full items-center justify-between gap-2 px-2 text-left text-[13.5px] hover:bg-raised max-lg:min-h-11";

function Notebook() {
  const search = useSearchParams();
  const router = useRouter();
  const { toast } = useApp();
  const folder = search.get("folder") ?? "";
  const tag = search.get("tag") ?? "";
  const sample = search.get("includeSample") === "1";
  const noteId = Number(search.get("note")) || null;
  const [q, setQ] = useState(search.get("q") ?? "");
  const [query, setQuery] = useState(search.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const params = new URLSearchParams();
  if (folder) params.set("folder", folder);
  if (tag) params.set("tag", tag);
  if (query.trim()) params.set("q", query.trim());
  if (sample) params.set("includeSample", "1");
  const { data, error, reload } = useFetch<Listing>(`/api/notes?${params}`);
  const open = useFetch<{ note: Note }>(noteId ? `/api/notes/${noteId}` : null);

  const hrefWith = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    return qs ? `/notebook?${qs}` : "/notebook";
  };

  const create = async (body = "", title = "") => {
    try {
      const res = await api<{ note: Note }>("/api/notes", { method: "POST", json: { title, body, folderId: Number(folder) || null } });
      reload();
      router.push(hrefWith({ note: String(res.note.id) }), { scroll: false });
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Couldn't create a note.", tone: "error" });
    }
  };

  const saveTemplate = async (name: string, body: string) => {
    try {
      await api("/api/notes/templates", { method: "POST", json: { name, body } });
      toast({ message: `Template "${name.trim()}" saved.`, tone: "success" });
      reload();
      return true;
    } catch (e) {
      toast({ message: fieldErrors(e).name ?? (e instanceof Error ? e.message : "Couldn't save the template."), tone: "error" });
      return false;
    }
  };

  if (error && !data) return <EmptyState title="Couldn't load your notebook" body={error} action={<Button onClick={reload}>Try again</Button>} />;
  if (!data) return <Spinner label="Loading your notebook" />;

  const note = noteId && open.data?.note.id === noteId ? open.data.note : null;
  const missing = Boolean(noteId && open.error);
  const allTemplates = [...data.templates.own.map((t) => ({ key: `own:${t.id}`, ...t })), ...data.templates.builtIn.map((t) => ({ key: `built:${t.name}`, ...t }))];

  return (
    <div>
      <PageHeader
        title="Notebook"
        description="Plans, reviews and anything else worth keeping. Link a note to a trade or a day, and it shows there too."
        actions={
          <>
            <select
              aria-label="New note from a template"
              className="h-9 border border-line-strong bg-transparent px-2 text-[13.5px] text-ink max-sm:h-11"
              value=""
              onChange={(e) => {
                const t = allTemplates.find((x) => x.key === e.target.value);
                if (t) void create(t.body, t.name);
              }}
            >
              <option value="">From a template</option>
              {allTemplates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
            </select>
            <Button className="max-sm:h-11" onClick={() => void create()}>New note</Button>
          </>
        }
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-6 lg:grid-cols-[13rem_18rem_minmax(0,1fr)]">
        <nav aria-label="Folders and tags" className={cx("min-w-0 space-y-4", Boolean(noteId) && "max-lg:hidden")}>
          <section>
            <h2 className="mb-1 text-[13px] font-medium text-ink">Folders</h2>
            <ul data-testid="folders">
              <li><Link href={hrefWith({ folder: null, note: null })} scroll={false} aria-current={!folder ? "page" : undefined} className={cx(folderLink, !folder && "bg-raised shadow-[inset_2px_0_0_var(--accent)]")}>All notes</Link></li>
              <li><Link href={hrefWith({ folder: "none", note: null })} scroll={false} aria-current={folder === "none" ? "page" : undefined} className={cx(folderLink, folder === "none" && "bg-raised shadow-[inset_2px_0_0_var(--accent)]")}>No folder</Link></li>
              {data.folders.map((f) => <FolderRow key={f.id} folder={f} active={folder === String(f.id)} href={hrefWith({ folder: String(f.id), note: null })} onChanged={reload} onDeleted={() => { reload(); if (folder === String(f.id)) router.push(hrefWith({ folder: null }), { scroll: false }); }} />)}
            </ul>
            <NewFolder onCreated={reload} />
          </section>
          {data.tags.length > 0 && (
            <section>
              <h2 className="mb-1 text-[13px] font-medium text-ink">Tags</h2>
              <ul className="flex flex-wrap gap-1" data-testid="note-tags">
                {data.tags.map((t) => (
                  <li key={t}><Link href={hrefWith({ tag: tag === t ? null : t, note: null })} scroll={false} aria-current={tag === t ? "true" : undefined} className={cx("inline-flex min-h-7 items-center border px-2 text-[12.5px] max-lg:min-h-11", tag === t ? "border-accent text-ink" : "border-line-strong text-ink-soft hover:text-ink")}>{t}</Link></li>
                ))}
              </ul>
            </section>
          )}
          {data.templates.own.length > 0 && (
            <section>
              <h2 className="mb-1 text-[13px] font-medium text-ink">Your templates</h2>
              <ul className="divide-y divide-line border-y border-line text-[13px]">
                {data.templates.own.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 py-0.5">
                    <span className="min-w-0 truncate text-ink-soft">{t.name}</span>
                    <Button size="sm" variant="ghost" className="max-sm:h-11" aria-label={`Delete template ${t.name}`} onClick={async () => { await api(`/api/notes/templates/${t.id}`, { method: "DELETE" }); reload(); }}>Delete</Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </nav>

        <section aria-label="Notes" className={cx("min-w-0", Boolean(noteId) && "max-lg:hidden")}>
          <label htmlFor="note-search" className="sr-only">Search notes</label>
          <input
            id="note-search"
            type="search"
            className={cx(inputClass, "mb-2 h-8 text-[13px] max-lg:h-11")}
            placeholder="Search titles, text and tags"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => setQuery(e.target.value), 250);
            }}
          />
          {data.notes.length === 0 ? (
            <p className="border-y border-line py-4 text-[13.5px] text-muted">{query || tag || folder ? "No notes match." : "No notes yet. Start one, or use a template above."}</p>
          ) : (
            <ul className="divide-y divide-line border-y border-line" data-testid="note-list">
              {data.notes.map((n) => (
                <li key={n.id}>
                  <Link href={hrefWith({ note: String(n.id) })} scroll={false} aria-current={n.id === noteId ? "page" : undefined} className={cx("block px-2 py-2 hover:bg-raised", n.id === noteId && "bg-raised shadow-[inset_2px_0_0_var(--accent)]")}>
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-[14px] font-medium text-ink">{n.title || "Untitled"}</span>
                      <span className="num shrink-0 text-[12px] text-muted">{dateOnly(n.updatedAt)}</span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-muted">{n.preview || "Empty"}</span>
                    {n.isSample && <Badge tone="info" className="mt-1">Sample</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="min-w-0">
          {noteId && <Link href={hrefWith({ note: null })} scroll={false} className="mb-3 inline-block text-[13px] text-ink-soft underline underline-offset-2 hover:text-ink lg:hidden">All notes</Link>}
          {missing ? (
            <EmptyState title="That note isn't here" body="It may have been deleted." action={<Link href={hrefWith({ note: null })} scroll={false} className="text-[13.5px] text-ink underline underline-offset-2">Back to your notes</Link>} />
          ) : note ? (
            <NoteEditor key={note.id} note={note} folders={data.folders} sample={sample} onChanged={reload} onDeleted={() => { reload(); router.push(hrefWith({ note: null }), { scroll: false }); }} onSaveTemplate={saveTemplate} />
          ) : noteId ? (
            <Spinner label="Opening the note" />
          ) : (
            <p className="border-y border-line py-6 text-[13.5px] text-muted max-lg:hidden">Pick a note, or start a new one.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function FolderRow({ folder, active, href, onChanged, onDeleted }: { folder: Folder; active: boolean; href: string; onChanged: () => void; onDeleted: () => void }) {
  const { toast } = useApp();
  const [renaming, setRenaming] = useState(false);
  const rename = async (name: string) => {
    setRenaming(false);
    if (!name.trim() || name.trim() === folder.name) return;
    try {
      await api(`/api/notes/folders/${folder.id}`, { method: "PATCH", json: { name } });
      onChanged();
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Couldn't rename it.", tone: "error" });
    }
  };
  return (
    <li className="group relative">
      {renaming ? (
        <input
          aria-label={`New name for ${folder.name}`}
          autoFocus
          className={cx(inputClass, "h-8 text-[13px]")}
          defaultValue={folder.name}
          maxLength={60}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setRenaming(false);
          }}
          onBlur={(e) => void rename(e.target.value)}
        />
      ) : (
        <div className={cx("flex items-center", active && "bg-raised shadow-[inset_2px_0_0_var(--accent)]")}>
          <Link href={href} scroll={false} aria-current={active ? "page" : undefined} className={cx(folderLink, "min-w-0 flex-1")}>
            <span className="min-w-0 truncate">{folder.name}</span>
            <span className="num text-[12px] text-muted">{folder.count}</span>
          </Link>
          <span className="absolute inset-y-0 right-0 flex items-center gap-1 bg-raised pl-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            <button type="button" aria-label={`Rename ${folder.name}`} title="Rename" className="px-1 text-[12px] text-muted hover:text-ink max-lg:min-h-11" onClick={() => setRenaming(true)}>Rename</button>
            <button
              type="button"
              aria-label={`Delete ${folder.name}`}
              title="Delete"
              className="px-1 text-[12px] text-muted hover:text-loss max-lg:min-h-11"
              onClick={async () => {
                if (!confirm(`Delete the folder "${folder.name}"? Its notes stay, in no folder.`)) return;
                try {
                  await api(`/api/notes/folders/${folder.id}`, { method: "DELETE" });
                  onDeleted();
                } catch (e) {
                  toast({ message: e instanceof Error ? e.message : "Couldn't delete it.", tone: "error" });
                }
              }}
            >
              Delete
            </button>
          </span>
        </div>
      )}
    </li>
  );
}

function NewFolder({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  return (
    <form
      className="mt-2 flex items-start gap-1.5"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api("/api/notes/folders", { method: "POST", json: { name } });
          setName("");
          setError(undefined);
          onCreated();
        } catch (err) {
          setError(fieldErrors(err).name ?? (err instanceof Error ? err.message : "Couldn't create it."));
        }
      }}
    >
      <Field label="New folder" error={error} className="min-w-0 flex-1">
        {(p) => <input {...p} className={cx(inputClass, "h-8 text-[13px] max-lg:h-11")} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Button size="sm" type="submit" className="mt-[1.45rem] max-lg:h-11" disabled={!name.trim()}>Add</Button>
    </form>
  );
}
