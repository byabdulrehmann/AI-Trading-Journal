import { z } from "zod";
import { round } from "./trade-math";

export const RULE_GROUPS = ["Entry", "Exit", "Risk", "Mindset"] as const;
export type RuleGroup = (typeof RULE_GROUPS)[number];

const RuleInput = z.object({
  /** Kept when a rule is edited, so trades already checked against it stay checked. */
  id: z.number().int().positive().optional(),
  group: z.enum(RULE_GROUPS),
  text: z.string().trim().min(1, "Write the rule").max(200),
});

export const PlaybookInput = z.object({
  name: z.string().trim().min(1, "Name the playbook").max(60),
  description: z.string().max(2000).default(""),
  rules: z.array(RuleInput).max(50).default([]),
});
export type PlaybookInput = z.output<typeof PlaybookInput>;

/** Parse, then pass through `onlySent`: this schema alone fills in defaults for missing fields. */
export const PlaybookPatch = PlaybookInput.partial();

export interface PlaybookRule {
  id: number;
  group: RuleGroup;
  text: string;
}

export const ChecksInput = z.object({
  /** The rules followed: the rest count as missed. Null clears the answers, so the trade counts as not reviewed. */
  checked: z.array(z.number().int().positive()).max(50).nullable(),
});

const dateTime = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Enter a valid date and time");

export const MissedInput = z
  .object({
    strategyId: z.number().int().positive().nullable().default(null),
    symbol: z.string().trim().min(1, "Symbol is required").max(20).toUpperCase(),
    side: z.enum(["long", "short"]),
    at: dateTime,
    entryPrice: z.number().positive("Entry must be above 0"),
    stopPrice: z.number().positive("Stop must be above 0").nullable().default(null),
    exitPrice: z.number().positive("Exit must be above 0").nullable().default(null),
    reason: z.string().trim().max(500).default(""),
  })
  .superRefine((m, ctx) => {
    if (m.stopPrice !== null && (m.side === "long" ? m.stopPrice >= m.entryPrice : m.stopPrice <= m.entryPrice)) {
      ctx.addIssue({ code: "custom", path: ["stopPrice"], message: m.side === "long" ? "For a long, the stop sits below entry" : "For a short, the stop sits above entry" });
    }
  });
export type MissedInput = z.output<typeof MissedInput>;

export interface MissedTrade extends MissedInput {
  id: number;
  isSample: boolean;
  /** What it would have made in units of its risk. Null without both a stop and an exit. */
  r: number | null;
  createdAt: string;
}

/** R of a trade not taken: price distance to the exit, in units of the distance to the stop. */
export function missedR(m: Pick<MissedInput, "side" | "entryPrice" | "stopPrice" | "exitPrice">): number | null {
  if (m.stopPrice === null || m.exitPrice === null) return null;
  const risk = Math.abs(m.entryPrice - m.stopPrice);
  if (risk === 0) return null;
  return round(((m.side === "long" ? 1 : -1) * (m.exitPrice - m.entryPrice)) / risk, 2);
}

export const PLAYBOOK_TEMPLATES: { name: string; description: string; rules: { group: RuleGroup; text: string }[] }[] = [
  {
    name: "Opening range breakout",
    description: "Trade the first decisive break of the opening range, in the direction of the day's bias.",
    rules: [
      { group: "Entry", text: "The opening range is marked before the break" },
      { group: "Entry", text: "A bar closes outside the range, not just a wick" },
      { group: "Entry", text: "Volume on the break is above the average of the range" },
      { group: "Exit", text: "Part of the position comes off at 1R" },
      { group: "Risk", text: "Stop sits beyond the far side or the middle of the range" },
      { group: "Risk", text: "No second attempt after two failed breaks" },
    ],
  },
  {
    name: "VWAP pullback",
    description: "Join an established move when price comes back to the volume-weighted average.",
    rules: [
      { group: "Entry", text: "Price has been holding one side of VWAP" },
      { group: "Entry", text: "The pullback reaches VWAP on lower volume" },
      { group: "Entry", text: "A reversal bar confirms before entry" },
      { group: "Exit", text: "Target is at least the prior swing" },
      { group: "Risk", text: "Stop sits beyond the pullback's low or high" },
    ],
  },
  {
    name: "Range fade",
    description: "Sell the top and buy the bottom of a range that is clearly holding.",
    rules: [
      { group: "Entry", text: "The range has at least two touches on each side" },
      { group: "Entry", text: "Momentum slows into the edge before entry" },
      { group: "Entry", text: "No major news is due during the trade" },
      { group: "Exit", text: "Out at the middle of the range or the far side" },
      { group: "Risk", text: "Stop sits just outside the range" },
    ],
  },
  {
    name: "Trend continuation",
    description: "Add to a clear trend on a shallow, orderly pause.",
    rules: [
      { group: "Entry", text: "Higher timeframe trend agrees" },
      { group: "Entry", text: "The pause is shallower than the last move" },
      { group: "Entry", text: "Entry is on the break of the pause" },
      { group: "Exit", text: "Trail the stop behind each new swing" },
      { group: "Risk", text: "Reward is at least twice the risk" },
    ],
  },
  {
    name: "News drift",
    description: "Wait out the first reaction to a release, then trade the direction that holds.",
    rules: [
      { group: "Entry", text: "At least the first few minutes after the release have passed" },
      { group: "Entry", text: "The first reaction's direction is still holding" },
      { group: "Exit", text: "Out before the next scheduled release" },
      { group: "Risk", text: "Size is reduced for wider spreads" },
      { group: "Mindset", text: "Not chasing a move already underway" },
    ],
  },
];
