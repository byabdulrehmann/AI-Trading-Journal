"use client";

import { dateTime, duration, money } from "@/lib/client/format";
import { DEFAULT_COLUMNS, JOURNAL_COLUMNS, type Account, type JournalColumn, type Trade } from "@/lib/domain/types";
import { SideBadge, SourceBadge, StatusBadge } from "./badges";

const nice = (s: string) => s.replace(/_/g, " ");
const none = <span className="text-muted">None</span>;
const price = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 8 }));

export interface ColumnDef {
  label: string;
  /** The sort this column's head offers, when there is one. */
  sort?: string;
  /** Where it starts showing, as a class. Narrow screens keep what fits. */
  show: string;
  numeric?: boolean;
  cell: (t: Trade, ctx: { accounts: Account[] }) => React.ReactNode;
}

const text = (v: React.ReactNode) => <span className="block max-w-32 truncate text-[13px] text-ink-soft">{v}</span>;
const mono = "num text-[12.5px] whitespace-nowrap text-ink-soft";

export const COLUMN_DEFS: Record<JournalColumn, ColumnDef> = {
  side: { label: "Side", show: "hidden md:table-cell", cell: (t) => <SideBadge side={t.side} /> },
  opened: { label: "Opened", sort: "openedAt", show: "hidden sm:table-cell", cell: (t) => <span className={mono}>{dateTime(t.openedAt)}</span> },
  closed: { label: "Closed", sort: "closedAt", show: "hidden xl:table-cell", cell: (t) => <span className={mono}>{dateTime(t.closedAt)}</span> },
  hold: { label: "Held", sort: "hold", show: "hidden lg:table-cell", numeric: true, cell: (t) => <span className={mono}>{duration(t.holdingMinutes)}</span> },
  strategy: { label: "Strategy", show: "hidden xl:table-cell", cell: (t) => text(t.strategy || none) },
  setup: { label: "Setup", show: "hidden lg:table-cell", cell: (t) => text(t.setup || none) },
  tags: { label: "Tags", show: "hidden lg:table-cell", cell: (t) => text([...t.tags, ...t.strategyTags].join(", ") || none) },
  mistakes: { label: "Mistakes", show: "hidden lg:table-cell", cell: (t) => text(t.mistakes.map(nice).join(", ") || none) },
  emotion: { label: "Emotion", show: "hidden lg:table-cell", cell: (t) => <span className="text-[13px] text-ink-soft capitalize">{t.emotionBefore ?? "—"}</span> },
  grade: { label: "Grade", show: "hidden lg:table-cell", cell: (t) => <span className="text-[13px] text-ink-soft">{t.grade ?? "—"}</span> },
  account: { label: "Account", show: "hidden lg:table-cell", cell: (t, { accounts }) => text(accounts.find((a) => a.id === t.accountId)?.name ?? "—") },
  assetClass: { label: "Asset", show: "hidden lg:table-cell", cell: (t) => <span className="text-[13px] text-ink-soft capitalize">{t.assetClass}</span> },
  source: { label: "Source", show: "hidden lg:table-cell", cell: (t) => <SourceBadge source={t.source} /> },
  status: { label: "Status", show: "hidden md:table-cell", cell: (t) => <StatusBadge status={t.status} /> },
  entry: { label: "Entry", show: "hidden lg:table-cell", numeric: true, cell: (t) => <span className={mono}>{price(t.entryPrice)}</span> },
  exit: { label: "Exit", show: "hidden lg:table-cell", numeric: true, cell: (t) => <span className={mono}>{price(t.exitPrice)}</span> },
  size: { label: "Size", sort: "quantity", show: "hidden lg:table-cell", numeric: true, cell: (t) => <span className={mono}>{t.quantity}</span> },
  fees: { label: "Costs", show: "hidden lg:table-cell", numeric: true, cell: (t, { accounts }) => <span className={mono}>{money(t.commission + t.swap + t.otherFees, accounts.find((a) => a.id === t.accountId)?.currency)}</span> },
  plannedR: { label: "Planned R", show: "hidden lg:table-cell", numeric: true, cell: (t) => <span className={mono}>{t.plannedR === null ? "—" : `${t.plannedR.toFixed(2)}R`}</span> },
};

/** Which columns show, in the table's own order, whatever order they were saved in. */
export const visibleColumns = (saved: readonly JournalColumn[] | null | undefined): JournalColumn[] => {
  const on = new Set(saved ?? DEFAULT_COLUMNS);
  return JOURNAL_COLUMNS.filter((c) => on.has(c));
};
