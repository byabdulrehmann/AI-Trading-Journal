import { z } from "zod";
import { body, fail } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { buildContext } from "@/lib/server/ai/context";
import { systemPrompt } from "@/lib/server/ai/prompt";
import { findModels, getProvider, PROVIDERS, resolveActive, validateChoice } from "@/lib/server/ai/registry";
import { ProviderError } from "@/lib/server/ai/types";
import { demoProvider } from "@/lib/server/ai/providers/demo";
import { addMessage, conversationExists, createConversation, listMessages } from "@/lib/server/repo/jarvis";
import { getSettings, updateSettings } from "@/lib/server/repo/settings";
import { recordActivity } from "@/lib/server/repo/activity";

const Body = z.object({
  conversationId: z.number().int().positive().nullable().default(null),
  message: z.string().trim().min(1, "Type a message").max(4000, "Keep messages under 4,000 characters"),
  focusTradeId: z.number().int().positive().nullable().default(null),
});

const HISTORY_LIMIT = 20;
const OVERALL_TIMEOUT_MS = 120_000;

type Send = (event: string, data: unknown) => void;

/**
 * Streams a Jarvis reply as server-sent events:
 *   meta  → provider, model, conversation id, what was shared
 *   delta → text chunk
 *   done  → saved message id
 *   error → user-facing message (+ whether demo mode was used instead)
 * Closing the request (Stop button / navigation) aborts the provider call.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, Body);
  if (data instanceof Response) return data;
  const settings = getSettings(user.id);
  if (!settings.jarvis.enabled) return fail("The AI Coach is turned off in Settings.", 403);
  if (data.conversationId && !conversationExists(user.id, data.conversationId)) return fail("Conversation not found.", 404);

  const conversationId = data.conversationId ?? createConversation(user.id, data.message);
  addMessage(conversationId, "user", data.message);
  recordActivity(user.id, "jarvis.chat", { length: data.message.length });

  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(OVERALL_TIMEOUT_MS)]);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send: Send = (event, payload) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // Client went away; nothing to deliver.
        }
      };
      try {
        const command = await handleModelCommand(user.id, data.message);
        if (command) {
          send("meta", { conversationId, provider: "kestrel", model: null, disclosure: ["Nothing. This was handled inside Jarvis."] });
          send("delta", { text: command });
          const saved = addMessage(conversationId, "assistant", command, "kestrel", null);
          send("done", { messageId: saved.id, switched: true });
          return;
        }
        await reply(user.id, conversationId, data.focusTradeId, signal, req.signal, send);
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}

async function reply(userId: number, conversationId: number, focusTradeId: number | null, signal: AbortSignal, clientSignal: AbortSignal, send: Send) {
  const settings = getSettings(userId);
  const context = buildContext(userId, settings, focusTradeId);
  const active = resolveActive(settings);
  const history = listMessages(conversationId, HISTORY_LIMIT)
    .filter((m) => m.provider !== "kestrel")
    .map((m) => ({ role: m.role, content: m.content }));
  // The API expects the conversation to start with a user turn.
  while (history.length && history[0].role !== "user") history.shift();

  const run = async (provider = active.provider, model = active.model) => {
    send("meta", {
      conversationId,
      provider: provider.id,
      providerLabel: provider.label,
      model,
      external: provider.status().external,
      disclosure: provider.status().external ? context.disclosure : ["Nothing leaves this computer in demo mode."],
      notice: active.fallbackReason ?? null,
    });
    let text = "";
    try {
      for await (const chunk of provider.stream({ model, system: systemPrompt(context), messages: history, context, signal })) {
        text += chunk;
        send("delta", { text: chunk });
      }
    } finally {
      // Keep whatever arrived, including a reply the user stopped part-way.
      if (text.trim()) {
        const saved = addMessage(conversationId, "assistant", signal.aborted ? `${text}\n\n_(stopped)_` : text, provider.id, model);
        send("done", { messageId: saved.id });
      }
    }
  };

  try {
    await run();
    if (signal.aborted) throw new Error("aborted"); // a provider may just end its stream when aborted
  } catch (err) {
    if (clientSignal.aborted) return; // the user pressed Stop or left
    const timedOut = signal.aborted;
    const e = timedOut
      ? new ProviderError("The AI Coach took too long to reply, so Jarvis stopped waiting. Please try again.", "timeout", true)
      : err instanceof ProviderError
        ? err
        : new ProviderError("Something went wrong generating a reply.", "unavailable");
    // A refusal or bad request won't improve in demo mode; outages and auth problems can.
    // After a timeout the signal is spent, so a demo reply couldn't run either.
    const offerDemo = !timedOut && active.provider.id !== "demo" && ["auth", "unavailable", "rate_limited", "timeout", "not_configured"].includes(e.kind);
    send("error", { message: e.message, kind: e.kind, fallback: offerDemo ? "demo" : null });
    if (offerDemo) {
      try {
        await run(demoProvider, demoProvider.defaultModel);
      } catch {}
    }
  }
}

const SWITCH_RE =
  /^(?:\/(?:model|provider)\s+(.+)|(?:please\s+)?(?:switch|change|use)\s+(?:the\s+)?(?:ai\s+)?(?:model\s+|provider\s+)?(?:to\s+)?(.+?))[.!]?$/i;
// Plain English switches only when the sentence names nothing but a model, so "use demo trades" stays a question.
const MODEL_NAME =
  /^(?:the\s+)?(demo(?:\s+mode)?|anthropic|claude|(?:claude[\s-]*)?(?:opus|sonnet|haiku|fable)(?:[\s-]*\d[\d.-]*)?|claude-[a-z0-9.-]+)(?:\s+(?:model|provider))?$/i;

/** Handles "/model sonnet", "switch to demo", "/models". Returns null if not a command. */
async function handleModelCommand(userId: number, message: string): Promise<string | null> {
  const msg = message.trim();
  if (/^\/models?$/i.test(msg) || /^(which|what) models?\b.*\b(available|can i use|are there)/i.test(msg)) {
    const lines: string[] = [];
    for (const p of PROVIDERS) {
      const s = p.status();
      if (!s.configured) {
        lines.push(`- **${p.label}** — not configured. ${s.reason}`);
        continue;
      }
      try {
        const models = await p.listModels();
        lines.push(`- **${p.label}**: ${models.map((m) => `\`${m.id}\``).join(", ")}`);
      } catch (err) {
        lines.push(`- **${p.label}** — ${err instanceof ProviderError ? err.message : "couldn't list models"}`);
      }
    }
    return `Available models:\n\n${lines.join("\n")}\n\nSay "switch to <model>" or use \`/model <id>\`.`;
  }
  const m = SWITCH_RE.exec(msg);
  const phrase = (m?.[1] ?? (m?.[2] ? MODEL_NAME.exec(m[2].trim())?.[1] : undefined) ?? "").trim();
  if (!phrase) return null;

  const apply = async (provider: string, model: string | null) => {
    const result = await validateChoice(provider, model);
    if (!result.ok) {
      const alt = result.candidates?.length ? `\n\nModels I can see: ${result.candidates.map((c) => `\`${c.id}\``).join(", ")}` : "";
      return `I couldn't switch: ${result.message}${alt}\n\nI'll keep using ${resolveActive(getSettings(userId)).provider.label}.`;
    }
    updateSettings(userId, { jarvis: { provider: result.provider, model: result.model } });
    recordActivity(userId, "settings.changed", { settings: ["jarvis.provider", "jarvis.model"] });
    const external = getProvider(result.provider!)?.status().external;
    return `${result.message}${external ? " Replies now go to an external provider; see Settings → Privacy for what is shared." : " Nothing leaves this computer in this mode."}`;
  };

  if (/\bdemo\b/i.test(phrase)) return apply("demo", null);
  if (/^(anthropic|claude)$/i.test(phrase)) return apply("anthropic", null);
  const exact = PROVIDERS.find((p) => p.id === phrase.toLowerCase());
  if (exact) return apply(exact.id, null);

  const anthropic = getProvider("anthropic")!;
  if (!anthropic.status().configured)
    return `I can't switch to "${phrase}": ${anthropic.label} isn't configured. ${anthropic.status().reason} Demo mode stays on until then.`;
  const matches = await findModels(phrase);
  const exactId = matches.find((x) => x.model.id === phrase);
  if (exactId) return apply(exactId.provider, exactId.model.id);
  if (matches.length === 1) return apply(matches[0].provider, matches[0].model.id);
  if (matches.length > 1)
    return `Several models match "${phrase}": ${matches.map((x) => `\`${x.model.id}\``).join(", ")}. Which one? (e.g. \`/model ${matches[0].model.id}\`)`;
  return `I couldn't find a model matching "${phrase}" in the list your provider returned. Try \`/models\` to see what's available.`;
}
