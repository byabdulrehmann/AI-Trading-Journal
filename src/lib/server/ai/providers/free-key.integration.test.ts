import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

/** A fake Groq/Gemini behind fetch, a throwaway database and key. Never touches data/ or the network. */
process.env.KESTREL_DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), "jarvis-freekey-")), "test.db");
process.env.JARVIS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const { withGivenKey } = await import("../key");
const { geminiProvider, groqProvider, withoutThinking } = await import("./free-key");
const { ProviderError } = await import("../types");

let status = 200;
const seen: { url: string; auth: string | null; body: unknown }[] = [];
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  seen.push({ url, auth: new Headers(init?.headers).get("authorization"), body: init?.body ? JSON.parse(String(init.body)) : null });
  if (status !== 200) return new Response("the request echoed back", { status });
  if (url.endsWith("/models")) return Response.json({ data: [{ id: "models/gemini-3.8-flash" }, { id: "models/gemini-embedding-2" }, { id: "whisper-large-v3" }, { id: "llama-3.3-70b-versatile" }] });
  // Split mid-line, as a network does.
  const sse = 'data: {"choices":[{"delta":{"content":"Recorded: "}}]}\n\ndata: {"choices":[{"delta":{"content":"a quiet"}}]}\n\ndata: {"choices":[{"delta":{}}]}\n\ndata: {"choices":[{"delta":{"content":" week."}}]}\n\ndata: [DONE]\n\n';
  const bytes = new TextEncoder().encode(sse);
  return new Response(new ReadableStream({ start: (c) => (c.enqueue(bytes.slice(0, 50)), c.enqueue(bytes.slice(50)), c.close()) }));
}) as typeof fetch;

const ask = (p: typeof groqProvider) =>
  withGivenKey("gsk_test-key", async () => {
    let text = "";
    for await (const piece of p.stream({ model: "llama-3.3-70b-versatile", system: "rules", messages: [{ role: "user", content: "hi" }], context: {} as never, signal: AbortSignal.timeout(5000) })) text += piece;
    return text;
  });

describe("free-key providers (OpenAI-compatible)", () => {
  test("a reply streams in, with the key as a bearer token and the instructions as the system message", async () => {
    status = 200;
    assert.equal(await ask(groqProvider), "Recorded: a quiet week.");
    const last = seen.at(-1)!;
    assert.equal(last.url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(last.auth, "Bearer gsk_test-key");
    assert.deepEqual((last.body as { messages: unknown[] }).messages, [{ role: "system", content: "rules" }, { role: "user", content: "hi" }]);
  });

  test("model lists keep chat models only, without Gemini's models/ prefix", async () => {
    status = 200;
    const gemini = await withGivenKey("AIza-test-key-1", () => geminiProvider.listModels());
    assert.deepEqual(gemini.map((m) => m.id), ["gemini-3.8-flash"]);
    const groq = await withGivenKey("gsk_test-key-1", () => groqProvider.listModels());
    assert.ok(groq.some((m) => m.id === "llama-3.3-70b-versatile") && !groq.some((m) => m.id.includes("whisper")));
  });

  test("a refused key, a free limit, and no key at all each say so plainly, without echoing the reply body", async () => {
    status = 401;
    await assert.rejects(ask(groqProvider), (e) => e instanceof ProviderError && e.kind === "auth" && !e.message.includes("echoed"));
    status = 429;
    await assert.rejects(ask(groqProvider), (e) => e instanceof ProviderError && e.kind === "rate_limited" && /free limit/.test(e.message));
    assert.equal(groqProvider.status().configured, false, "outside a request there's no key");
  });

  test("a reasoning model's <think> block is dropped, even with its tags split across chunks", () => {
    const run = (pieces: string[]) => {
      const visible = withoutThinking();
      return pieces.map((p) => visible(p)).join("") + visible("", true);
    };
    assert.equal(run(["<thi", "nk>weighing it up</th", "ink>\n\nRecorded: a quiet week."]), "\n\nRecorded: a quiet week.");
    assert.equal(run(["No thinking here, and 3 < 4 stays."]), "No thinking here, and 3 < 4 stays.");
    assert.equal(run(["Ends with <"]), "Ends with <", "a held-back tail comes out at the end");
    assert.equal(run(["<think>never closed"]), "", "an unfinished thought never shows");
  });
});
