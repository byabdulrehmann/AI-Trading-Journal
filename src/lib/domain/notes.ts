import { z } from "zod";

const LinkInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("trade"), tradeId: z.number().int().positive() }),
  z.object({ kind: z.literal("day"), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date") }),
]);
export type NoteLinkInput = z.output<typeof LinkInput>;

const tags = z.array(z.string().trim().min(1).max(30)).max(20).transform((list) => [...new Set(list)]);

export const NoteInput = z.object({
  title: z.string().trim().max(200).default(""),
  body: z.string().max(100_000, "A note can hold up to 100,000 characters").default(""),
  folderId: z.number().int().positive().nullable().default(null),
  tags: tags.default([]),
  links: z.array(LinkInput).max(100).default([]),
});
export type NoteInput = z.output<typeof NoteInput>;

/** Parse, then pass through `onlySent`: this schema alone fills in defaults for missing fields. */
export const NotePatch = NoteInput.partial();

export const FolderInput = z.object({ name: z.string().trim().min(1, "Name the folder").max(60) });
export const TemplateInput = z.object({ name: z.string().trim().min(1, "Name the template").max(60), body: z.string().max(100_000).default("") });

export interface NoteLink {
  kind: "trade" | "day";
  tradeId: number | null;
  day: string | null;
  /** For a trade, its symbol and when it opened. */
  label: string;
}

export interface NoteSummary {
  id: number;
  title: string;
  preview: string;
  folderId: number | null;
  tags: string[];
  isSample: boolean;
  updatedAt: string;
}

export interface Note extends NoteSummary {
  body: string;
  links: NoteLink[];
  createdAt: string;
  versions: NoteVersion[];
}

export interface NoteVersion {
  id: number;
  title: string;
  preview: string;
  createdAt: string;
}

/** A snapshot isn't kept for every keystroke of a sitting: only when this long has passed since the last one. */
export const VERSION_GAP_MS = 5 * 60_000;
export const VERSIONS_KEPT = 50;

/** Whether an edit should keep what's about to be replaced. */
export function shouldSnapshot(changed: boolean, lastSnapshotAt: string | null, at: string): boolean {
  if (!changed) return false;
  return lastSnapshotAt === null || Date.parse(at) - Date.parse(lastSnapshotAt) >= VERSION_GAP_MS;
}

export const previewOf = (body: string, length = 160) => {
  // The words, not the formatting marks around them.
  const flat = body.replace(/^\s*(#{1,3}\s+|[-*]\s+(\[[ xX]\]\s*)?|\d+[.)]\s+)/gm, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length)}...` : flat;
};

export const NOTE_TEMPLATES: { name: string; body: string }[] = [
  {
    name: "Trading plan",
    body: "## Markets I trade\n\n## When I trade\n\n## Setups I take\n\n- \n\n## Position sizing\n\n## Most I can lose\n\n- Per trade:\n- Per day:\n- Per week:\n\n## When I stop for the day\n\n- ",
  },
  {
    name: "Loss recap",
    body: "## What happened\n\n## What I did right\n\n- \n\n## What I did wrong\n\n- \n\n## Was this a good loss?\n\n## What changes next time\n\n- [ ] ",
  },
  {
    name: "Weekly review",
    body: "## The numbers\n\n## Best trade, and why\n\n## Worst trade, and why\n\n## Rules I broke\n\n- \n\n## What I'll work on next week\n\n- [ ] ",
  },
  {
    name: "Monthly review",
    body: "## How the month went\n\n## What's working\n\n- \n\n## What isn't\n\n- \n\n## Setups to drop or add\n\n## Goal for next month\n\n",
  },
  {
    name: "Setup study",
    body: "## The setup\n\n## Trades that show it\n\nLink one with its number, such as [#123].\n\n## When it works\n\n## When it fails\n\n",
  },
];
