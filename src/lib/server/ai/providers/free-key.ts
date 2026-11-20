import "server-only";
import { currentAiKey } from "../key";
import { ProviderError, type JarvisProvider, type ModelInfo, type StreamRequest } from "../types";

/**
 * Providers with a free tier, through their OpenAI-compatible chat API, on the account's own key (../key.ts).
 * Plain fetch: their SDKs would add a dependency for two calls.
 */

interface Spec {
  id: "gemini" | "groq";
  label: string;
  base: string;
  defaultModel: string;
  /** Chat models only: their lists also hold embedding, speech and image models. */
  chat: (id: string) => boolean;
}

/**
 * Drops the <think>…</think> reasoning that models such as Qwen 3 stream before their answer. Tags can be split across
 * chunks, so a possible start of one is held back until the next chunk shows what it is.
 */
export function withoutThinking() {
  const OPEN = "<think>";
  const CLOSE = "</think>";
  let buf = "";
  let inside = false;
  /** end: the stream is over, so nothing is held back. */
  return (piece: string, end = false): string => {
    buf += piece;
    let out = "";
    for (;;) {
      const tag = inside ? CLOSE : OPEN;
      const at = buf.indexOf(tag);
      if (at >= 0) {
        if (!inside) out += buf.slice(0, at);
        buf = buf.slice(at + tag.length);
        inside = !inside;
        continue;
      }
      // Keep any tail that could be the start of the tag.
      let keep = end ? 0 : Math.min(tag.length - 1, buf.length);
      while (keep > 0 && !tag.startsWith(buf.slice(-keep))) keep--;
      if (!inside) out += buf.slice(0, buf.length - keep);
      buf = buf.slice(buf.length - keep);
      return out;
    }
  };
}

const modelCache = new Map<string, { at: number; models: ModelInfo[] }>();

function make({ id, label, base, defaultModel, chat }: Spec): JarvisProvider {
  const noKey = `No ${label} key for this account. Add your own free key in Settings → Free AI keys.`;
  const keyOrThrow = () => {
    const key = currentAiKey(id);
    if (!key) throw new ProviderError(noKey, "not_configured");
    return key;
  };
  const call = async (path: string, key: string, init: RequestInit & { signal?: AbortSignal }) => {
    let res: Response;
    try {
      res = await fetch(base + path, { ...init, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" } });
    } catch {
      if (init.signal?.aborted) throw new ProviderError("Request cancelled.", "timeout");
      throw new ProviderError(`Couldn't reach ${label}. Check the network connection.`, "unavailable", true);
    }
    if (res.ok) return res;
    // The body may echo the request; only its status reaches the user.
    await res.body?.cancel();
    if (res.status === 401 || res.status === 403) throw new ProviderError(`${label} didn't accept the key. Check it in Settings → Free AI keys.`, "auth");
    if (res.status === 429) throw new ProviderError(`You've reached ${label}'s free limit for now. Try again later, or switch model under Model.`, "rate_limited", true);
    if (res.status === 400 || res.status === 404) throw new ProviderError(`${label} couldn't use that request or model (${res.status}).`, "bad_request");
    throw new ProviderError(`${label} returned an error (${res.status}).`, "unavailable", true);
  };

  return {
    id,
    label: `${label} (your free key)`,
    defaultModel,
    status: () => (currentAiKey(id) ? { configured: true, external: true } : { configured: false, external: true, reason: noKey }),

    async listModels(signal) {
      const key = keyOrThrow();
      const cached = modelCache.get(id + key);
      if (cached && Date.now() - cached.at < 10 * 60_000) return cached.models;
      const res = await call("/models", key, { signal: signal ?? AbortSignal.timeout(15_000) });
      const { data } = (await res.json()) as { data: { id: string }[] };
      const models = data
        .map((m) => m.id.replace(/^models\//, ""))
        .filter(chat)
        .sort()
        .map((m) => ({ id: m, displayName: m }));
      modelCache.set(id + key, { at: Date.now(), models });
      return models;
    },

    async *stream(req: StreamRequest) {
      const res = await call("/chat/completions", keyOrThrow(), {
        method: "POST",
        signal: req.signal,
        body: JSON.stringify({
          model: req.model,
          stream: true,
          // Room for a reasoning model's hidden thinking as well as the answer.
          max_tokens: 4096,
          messages: [{ role: "system", content: req.system }, ...req.messages],
        }),
      });
      const decoder = new TextDecoder();
      const visible = withoutThinking();
      let buf = "";
      let done = false;
      for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
        buf += decoder.decode(bytes, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") {
            done = true;
            break;
          }
          const text = visible((JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content ?? "");
          if (text) yield text;
        }
        if (done) break;
      }
      const tail = visible("", true);
      if (tail) yield tail;
    },
  };
}

// Model ids checked against each provider's docs on 2026-11-20.
export const geminiProvider = make({
  id: "gemini",
  label: "Google Gemini",
  base: "https://generativelanguage.googleapis.com/v1beta/openai",
  defaultModel: "gemini-3.8-flash",
  chat: (m) => /^gemini-/.test(m) && !/embed|image|tts|audio|live|vision/.test(m),
});

export const groqProvider = make({
  id: "groq",
  label: "Groq",
  base: "https://api.groq.com/openai/v1",
  defaultModel: "llama-3.3-70b-versatile",
  chat: (m) => !/whisper|tts|guard|orpheus|playai|distil/.test(m),
});
