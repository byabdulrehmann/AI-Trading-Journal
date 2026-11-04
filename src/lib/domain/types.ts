import { z } from "zod";

export const EMOTIONS = [
  "calm",
  "focused",
  "confident",
  "hesitant",
  "anxious",
  "frustrated",
  "impatient",
  "fearful",
  "overconfident",
  "tired",
] as const;

export const GRADES = ["A", "B", "C", "D", "F"] as const;

const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "Enter a valid date and time");

const optionalNumber = z
  .union([z.number(), z.null()])
  .optional()
  .transform((v) => (v === undefined ? null : v));

export const AccountInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  broker: z.string().trim().max(60).default(""),
  currency: z.string().trim().length(3, "Use a 3-letter code like USD").toUpperCase().default("USD"),
  startingBalance: z.number().min(0, "Balance can't be negative").default(0),
});
export type AccountInput = z.infer<typeof AccountInput>;

/** Parse, then pass through `onlySent`: this schema alone fills in defaults for missing fields. */
export const AccountUpdate = AccountInput.partial().extend({ archived: z.boolean().optional() });

export interface Account extends AccountInput {
  id: number;
  archived: boolean;
  isSample: boolean;
  createdAt: string;
}

export const TradeInput = z
  .object({
    accountId: z.number().int().positive(),
    symbol: z.string().trim().min(1, "Symbol is required").max(20).toUpperCase(),
    side: z.enum(["long", "short"]),
    openedAt: isoDate,
    closedAt: z.union([isoDate, z.null()]).optional().transform((v) => v ?? null),
    entryPrice: z.number().positive("Entry must be above 0"),
    exitPrice: optionalNumber,
    quantity: z.number().positive("Size must be above 0"),
    multiplier: z.number().positive().default(1),
    stopPrice: optionalNumber,
    targetPrice: optionalNumber,
    /** Negative when the trade earned more than it cost, such as swap paid to the trader. */
    fees: z.number().default(0),
    setup: z.string().trim().max(60).default(""),
    tags: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
    emotionBefore: z.enum(EMOTIONS).nullable().default(null),
    emotionAfter: z.enum(EMOTIONS).nullable().default(null),
    followedPlan: z.boolean().nullable().default(null),
    grade: z.enum(GRADES).nullable().default(null),
    planNotes: z.string().max(4000).default(""),
    notes: z.string().max(8000).default(""),
  })
  .superRefine((t, ctx) => {
    if ((t.exitPrice === null) !== (t.closedAt === null)) {
      ctx.addIssue({
        code: "custom",
        path: ["exitPrice"],
        message: "A closed trade needs both an exit price and a close time",
      });
    }
    if (t.closedAt && Date.parse(t.closedAt) < Date.parse(t.openedAt)) {
      ctx.addIssue({ code: "custom", path: ["closedAt"], message: "Close time is before open time" });
    }
    if (t.stopPrice !== null) {
      const wrongSide = t.side === "long" ? t.stopPrice >= t.entryPrice : t.stopPrice <= t.entryPrice;
      if (wrongSide)
        ctx.addIssue({
          code: "custom",
          path: ["stopPrice"],
          message: t.side === "long" ? "For a long, the stop sits below entry" : "For a short, the stop sits above entry",
        });
    }
    if (t.targetPrice !== null) {
      const wrongSide = t.side === "long" ? t.targetPrice <= t.entryPrice : t.targetPrice >= t.entryPrice;
      if (wrongSide)
        ctx.addIssue({
          code: "custom",
          path: ["targetPrice"],
          message: t.side === "long" ? "For a long, the target sits above entry" : "For a short, the target sits below entry",
        });
    }
  });
export type TradeInput = z.input<typeof TradeInput>;
export type TradeData = z.output<typeof TradeInput>;

export interface Trade extends TradeData {
  id: number;
  source: "manual" | "csv" | "sample";
  importBatch: string | null;
  createdAt: string;
  updatedAt: string;
  /** Derived; null while the trade is open. */
  pnl: number | null;
  /** Derived from the planned stop; null without a stop or while open. */
  rMultiple: number | null;
  /** Planned reward:risk from stop and target, when both are set. */
  plannedR: number | null;
}

export const COACHING_STYLES = ["direct", "supportive", "analytical"] as const;
export const SHARING_LEVELS = ["metrics", "trades", "trades_with_notes"] as const;

export const Settings = z.object({
  displayName: z.string().trim().max(40).default(""),
  theme: z.enum(["system", "dark", "light"]).default("system"),
  baseCurrency: z.string().length(3).default("USD"),
  defaultAccountId: z.number().int().nullable().default(null),
  onboardingDismissed: z.boolean().default(false),
  dismissedPatterns: z.array(z.string()).default([]),
  followedInstruments: z.array(z.string()).max(50).default(["EURUSD", "XAUUSD", "US100"]),
  jarvis: z
    .object({
      enabled: z.boolean().default(true),
      provider: z.string().default("demo"),
      model: z.string().nullable().default(null),
      coachingStyle: z.enum(COACHING_STYLES).default("supportive"),
      /** What the context builder may send to an external model provider. */
      sharing: z.enum(SHARING_LEVELS).default("trades"),
      memoryEnabled: z.boolean().default(true),
      behaviouralInsights: z.boolean().default(true),
      reflectionPrompts: z.boolean().default(true),
    })
    .default({
      enabled: true,
      provider: "demo",
      model: null,
      coachingStyle: "supportive",
      sharing: "trades",
      memoryEnabled: true,
      behaviouralInsights: true,
      reflectionPrompts: true,
    }),
  /** Explicit opt-in. Nothing is written to the activity log while false. */
  activityTracking: z.boolean().default(false),
});
export type Settings = z.infer<typeof Settings>;

/** Parse, then pass through `onlySent`: this schema alone fills in defaults for missing fields. */
export const SettingsUpdate = Settings.omit({ jarvis: true })
  .partial()
  .extend({ jarvis: Settings.shape.jarvis.unwrap().partial().optional() });

export const MEMORY_KINDS = ["preference", "goal", "rule", "observation"] as const;

export const MemoryInput = z.object({
  kind: z.enum(MEMORY_KINDS),
  content: z.string().trim().min(3, "Write at least a few words").max(500),
  evidenceTradeIds: z.array(z.number().int()).max(20).default([]),
  source: z.enum(["user", "jarvis"]).default("user"),
});
export type MemoryInput = z.input<typeof MemoryInput>;

export interface Memory {
  id: number;
  kind: (typeof MEMORY_KINDS)[number];
  content: string;
  source: "user" | "jarvis";
  evidenceTradeIds: number[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: number;
  conversationId: number;
  role: "user" | "assistant";
  content: string;
  provider: string | null;
  model: string | null;
  createdAt: string;
}

export interface ActivityEvent {
  id: number;
  type: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

/** Every activity type Kestrel can record, shown verbatim in Settings. */
export const ACTIVITY_TYPES: Record<string, string> = {
  "trade.created": "You added a trade (trade id, symbol)",
  "trade.updated": "You edited a trade (trade id, which fields changed)",
  "trade.deleted": "You deleted or restored a trade (trade id)",
  "import.committed": "You imported a CSV (row count)",
  "jarvis.chat": "You sent Jarvis a message (length only, never the text)",
  "tradbot.message": "You typed a message to TradBot-I (length only, never the text)",
  "settings.changed": "You changed a setting (setting name)",
};
