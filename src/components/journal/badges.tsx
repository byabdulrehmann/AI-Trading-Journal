import type { Trade } from "@/lib/domain/types";
import { Badge } from "../ui";

const SOURCE: Record<Trade["source"], { label: string; tone: "neutral" | "info" | "accent" }> = {
  manual: { label: "Manual", tone: "neutral" },
  csv: { label: "Imported", tone: "neutral" },
  mt5: { label: "MT5", tone: "accent" },
  sample: { label: "Sample", tone: "info" },
};

export const SourceBadge = ({ source }: { source: Trade["source"] }) => <Badge tone={SOURCE[source].tone}>{SOURCE[source].label}</Badge>;

export function StatusBadge({ status }: { status: Trade["status"] }) {
  if (status === "closed") return <Badge>Closed</Badge>;
  return <Badge tone="warn">{status === "open" ? "Open" : "Partial"}</Badge>;
}

export const SideBadge = ({ side }: { side: Trade["side"] }) => <Badge tone={side === "long" ? "profit" : "loss"}>{side === "long" ? "Long" : "Short"}</Badge>;

/** Why a trade has no P&L figure yet, or null when it's fine. */
export function PnlIssue({ status }: { status: Trade["pnlStatus"] }) {
  if (status === "needs_rate") return <span title="A conversion rate to the account currency is missing. Edit the trade to enter it."><Badge tone="warn">P&amp;L pending</Badge></span>;
  if (status === "over_closed") return <span title="The exits add up to more than the entries. Edit the fills."><Badge tone="loss">Check fills</Badge></span>;
  return null;
}
