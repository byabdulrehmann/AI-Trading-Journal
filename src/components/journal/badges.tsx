import type { Trade } from "@/lib/domain/types";

const label = "text-[12.5px] whitespace-nowrap";

const SOURCE: Record<Trade["source"], string> = { manual: "Manual", csv: "Imported", mt5: "MT5", sample: "Sample", backtest: "Backtest" };

/** Quiet words, not pills. Sky blue marks sample data and a position still running, the second state; green and red stay with money. */
export const SourceBadge = ({ source }: { source: Trade["source"] }) => <span className={`${label} ${source === "sample" || source === "backtest" ? "text-info" : "text-muted"}`}>{SOURCE[source]}</span>;

export function StatusBadge({ status }: { status: Trade["status"] }) {
  if (status === "closed") return <span className={`${label} text-muted`}>Closed</span>;
  return <span className={`${label} text-info`}>{status === "open" ? "Open" : "Partial"}</span>;
}

export const SideBadge = ({ side }: { side: Trade["side"] }) => <span className={`${label} text-ink-soft`}>{side === "long" ? "Long" : "Short"}</span>;

/** Why a trade has no P&L figure yet, or null when it's fine. */
export function PnlIssue({ status }: { status: Trade["pnlStatus"] }) {
  if (status === "needs_rate") return <span title="A conversion rate to the account currency is missing. Edit the trade to enter it." className={`${label} font-sans text-warn`}>P&amp;L pending</span>;
  if (status === "over_closed") return <span title="The exits add up to more than the entries. Edit the fills." className={`${label} font-sans text-warn`}>Check fills</span>;
  return null;
}
