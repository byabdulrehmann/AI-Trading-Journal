import { z } from "zod";
import { SESSIONS } from "./engine/instruments";

/**
 * Auto-tag rules: "when a trade matches all of these, add this tag". A rule tags a trade once.
 * If the trader removes the tag later, it stays removed.
 */
export const RULE_FIELDS = {
  symbol: { label: "Symbol", ops: ["is", "contains"], result: false },
  side: { label: "Side", ops: ["is"], result: false, options: ["long", "short"] },
  session: { label: "Session", ops: ["is"], result: false, options: SESSIONS },
  weekday: { label: "Day opened", ops: ["is"], result: false, options: ["1", "2", "3", "4", "5", "6", "0"] },
  hour: { label: "Hour opened", ops: ["from", "before"], result: false },
  news: { label: "Minutes from high-impact news", ops: ["within"], result: false },
  hold: { label: "Minutes held", ops: ["under", "over"], result: true },
  r: { label: "Result in R", ops: ["under", "over"], result: true },
  pnl: { label: "Net P&L", ops: ["under", "over"], result: true },
} as const;
export type RuleField = keyof typeof RULE_FIELDS;
export const OP_LABELS: Record<string, string> = { is: "is", contains: "contains", from: "is at or after", before: "is before", within: "is at most", under: "is under", over: "is over" };

const Condition = z
  .object({ field: z.enum(Object.keys(RULE_FIELDS) as [RuleField, ...RuleField[]]), op: z.string(), value: z.string().trim().min(1, "Enter a value").max(30) })
  .superRefine((c, ctx) => {
    const f = RULE_FIELDS[c.field];
    if (!(f.ops as readonly string[]).includes(c.op)) ctx.addIssue({ code: "custom", path: ["op"], message: "Pick how to compare" });
    if ("options" in f && !(f.options as readonly string[]).includes(c.value)) ctx.addIssue({ code: "custom", path: ["value"], message: "Pick a value" });
    if (["hour", "news", "hold", "r", "pnl"].includes(c.field) && !Number.isFinite(Number(c.value))) ctx.addIssue({ code: "custom", path: ["value"], message: "Enter a number" });
    if (c.field === "hour" && !(Number.isInteger(Number(c.value)) && Number(c.value) >= 0 && Number(c.value) <= 23)) ctx.addIssue({ code: "custom", path: ["value"], message: "Enter an hour from 0 to 23" });
    if ((c.field === "news" || c.field === "hold") && Number(c.value) < 0) ctx.addIssue({ code: "custom", path: ["value"], message: "Enter 0 or more" });
  });
export type RuleCondition = z.output<typeof Condition>;

export const TagRuleInput = z.object({
  tag: z.string().trim().min(1, "Name the tag").max(30),
  conditions: z.array(Condition).min(1, "Add a condition").max(5),
});
export type TagRuleInput = z.output<typeof TagRuleInput>;

export interface TradeFacts {
  symbol: string;
  side: string;
  session: string | null;
  /** In the trader's time zone. Sunday is 0. */
  weekday: number;
  hour: number;
  closed: boolean;
  holdMinutes: number | null;
  r: number | null;
  pnl: number | null;
  /** Minutes from the open to the nearest high-impact event for this symbol. */
  newsMinutes: number | null;
}

function test(c: RuleCondition, f: TradeFacts): boolean {
  const n = Number(c.value);
  const cmp = (x: number | null) => x !== null && (c.op === "under" ? x < n : x > n);
  switch (c.field) {
    case "symbol":
      return c.op === "is" ? f.symbol.toUpperCase() === c.value.toUpperCase() : f.symbol.toUpperCase().includes(c.value.toUpperCase());
    case "side":
      return f.side === c.value;
    case "session":
      return f.session === c.value;
    case "weekday":
      return f.weekday === n;
    case "hour":
      return c.op === "from" ? f.hour >= n : f.hour < n;
    case "news":
      return f.newsMinutes !== null && f.newsMinutes <= n;
    case "hold":
      return cmp(f.holdMinutes);
    case "r":
      return cmp(f.r);
    case "pnl":
      return cmp(f.pnl);
  }
}

/** True or false, or "later" while a rule about the result waits for the trade to close. */
export function ruleMatches(conditions: RuleCondition[], f: TradeFacts): boolean | "later" {
  if (!conditions.every((c) => RULE_FIELDS[c.field].result || test(c, f))) return false;
  if (!f.closed && conditions.some((c) => RULE_FIELDS[c.field].result)) return "later";
  return conditions.every((c) => test(c, f));
}
