import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { currentAiKey } from "../key";
import { ProviderError, type JarvisProvider, type ModelInfo, type StreamRequest } from "../types";

/**
 * Anthropic (Claude) provider. The key is the one for the user being served (see ../key.ts: their own, or the owner's
 * ANTHROPIC_API_KEY), read on the server only; it never reaches the browser or the logs.
 */
const DEFAULT_MODEL = process.env.KESTREL_ANTHROPIC_MODEL || "claude-opus-5-5";

// Models where server-side refusal fallbacks ("default" routing) are accepted.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);
// Models that accept output_config.effort. Others get the API default.
const EFFORT_MODEL = /^claude-(fable|mythos|opus|sonnet|haiku)-5|^claude-opus-4-[5-8]|^claude-sonnet-4-6/;

// One client and one model list per key: users with their own key may see different models.
const clients = new Map<string, Anthropic>();
const modelCache = new Map<string, { at: number; models: ModelInfo[] }>();
const NO_KEY = "No Anthropic key for this account. Add your own in Settings, or ask the owner to share theirs.";

function getClient(): { client: Anthropic; key: string } {
  const key = currentAiKey();
  if (!key) throw new ProviderError(NO_KEY, "not_configured");
  // 60 s per attempt, at most 2 retries (408/409/429/5xx and connection errors).
  if (!clients.has(key)) clients.set(key, new Anthropic({ apiKey: key, timeout: 60_000, maxRetries: 2 }));
  return { client: clients.get(key)!, key };
}

export function mapAnthropicError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new ProviderError("Request cancelled.", "timeout");
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
    return new ProviderError("Anthropic rejected the API key. Check the key in Settings, or ANTHROPIC_API_KEY for the owner's.", "auth");
  if (err instanceof Anthropic.NotFoundError)
    return new ProviderError("That model isn't available to this API key.", "bad_request");
  if (err instanceof Anthropic.RateLimitError)
    return new ProviderError("Anthropic is rate-limiting requests. Try again shortly.", "rate_limited", true);
  if (err instanceof Anthropic.BadRequestError)
    return new ProviderError(`Anthropic couldn't process the request: ${err.message}`, "bad_request");
  if (err instanceof Anthropic.APIConnectionTimeoutError)
    return new ProviderError("Anthropic took too long to respond.", "timeout", true);
  if (err instanceof Anthropic.APIConnectionError)
    return new ProviderError("Couldn't reach Anthropic. Check the network connection.", "unavailable", true);
  if (err instanceof Anthropic.APIError)
    return new ProviderError(`Anthropic returned an error (${err.status ?? "unknown"}).`, "unavailable", true);
  return new ProviderError("Unexpected error while contacting Anthropic.", "unavailable");
}

export const anthropicProvider: JarvisProvider = {
  id: "anthropic",
  label: "Anthropic (Claude)",
  defaultModel: DEFAULT_MODEL,

  status() {
    return currentAiKey() ? { configured: true, external: true } : { configured: false, external: true, reason: NO_KEY };
  },

  async listModels(signal) {
    try {
      const { client, key } = getClient();
      const cached = modelCache.get(key);
      if (cached && Date.now() - cached.at < 10 * 60_000) return cached.models;
      const models: ModelInfo[] = [];
      for await (const m of client.models.list({ limit: 100 }, { signal, timeout: 15_000 }))
        models.push({ id: m.id, displayName: m.display_name });
      modelCache.set(key, { at: Date.now(), models });
      return models;
    } catch (err) {
      throw mapAnthropicError(err);
    }
  },

  async *stream(req: StreamRequest) {
    try {
      const stream = getClient().client.beta.messages.stream(
        {
          model: req.model,
          max_tokens: 16000,
          system: req.system,
          messages: req.messages,
          ...(EFFORT_MODEL.test(req.model) ? { output_config: { effort: "medium" as const } } : {}),
          ...(FALLBACK_MODELS.has(req.model)
            ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
            : {}),
        },
        { signal: req.signal },
      );
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal")
        throw new ProviderError("The model declined to answer this request.", "refused");
      if (final.stop_reason === "max_tokens") yield "\n\n_(Reply cut short at the length limit.)_";
    } catch (err) {
      throw mapAnthropicError(err);
    }
  },
};
