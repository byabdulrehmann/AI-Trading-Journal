"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { useApp } from "@/lib/client/app-state";
import { useFetch } from "@/lib/client/use-fetch";
import type { Note, NoteSummary } from "@/lib/domain/notes";
import { Button } from "@/components/ui";

/** The notes linked to a trade or a day, and a way to start one already linked. */
export function LinkedNotes({ tradeId, day, title, sample, onLeave }: { tradeId?: number; day?: string; title: string; sample?: boolean; onLeave?: () => void }) {
  const router = useRouter();
  const { toast } = useApp();
  const query = tradeId ? `tradeId=${tradeId}` : `day=${day}`;
  const sampleParam = sample ? "&includeSample=1" : "";
  const { data } = useFetch<{ notes: NoteSummary[] }>(`/api/notes?${query}${sampleParam}`);
  const notes = data?.notes ?? [];

  const start = async () => {
    try {
      const links = tradeId ? [{ kind: "trade", tradeId }] : [{ kind: "day", day }];
      const res = await api<{ note: Note }>("/api/notes", { method: "POST", json: { title, links } });
      onLeave?.();
      router.push(`/notebook?note=${res.note.id}${sampleParam}`);
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Couldn't create the note.", tone: "error" });
    }
  };

  return (
    <section className="border-t border-line pt-4" aria-label="Linked notes" data-testid="linked-notes">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-medium text-ink">Notebook</h3>
        <Button size="sm" variant="ghost" className="max-sm:h-11" onClick={() => void start()}>Write a note</Button>
      </div>
      {notes.length > 0 && (
        <ul className="mt-1 divide-y divide-line border-y border-line text-[13.5px]">
          {notes.map((n) => (
            <li key={n.id}>
              <Link href={`/notebook?note=${n.id}${sampleParam}`} onClick={onLeave} className="block py-1.5 hover:bg-raised">
                <span className="font-medium text-ink">{n.title || "Untitled"}</span>
                <span className="mt-0.5 line-clamp-1 block text-[12.5px] text-muted">{n.preview}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
