"use client";

import type { MLCEngine } from "@mlc-ai/web-llm";

/**
 * The AI Coach's free model, run in this browser with WebGPU through WebLLM. The weights download once from
 * Hugging Face and the browser keeps them; nothing the trader writes leaves the device.
 * Main thread, not a Web Worker: the worker build hung after loading (2026-11-20), and the GPU work is async anyway.
 */

type Message = { role: "system" | "user" | "assistant"; content: string };

let loaded: { model: string; engine: Promise<MLCEngine> } | null = null;
// Loading outlives a stopped message, so progress goes to whichever message is waiting now.
let report: (text: string) => void = () => {};

/** Why this browser can't run the model, or null when it can. */
export async function unsupported(): Promise<string | null> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
  if (!gpu) return "This browser can't run the AI Coach's model: it needs WebGPU (a recent Chrome or Edge on a computer).";
  const adapter = await gpu.requestAdapter().catch(() => null);
  if (!adapter) return "This browser has WebGPU but no usable graphics chip for the AI Coach's model.";
  if (!adapter.features.has("shader-f16")) return "This computer's graphics chip doesn't support the half-precision maths the AI Coach's model needs.";
  return null;
}

function engineFor(model: string, onProgress: (text: string) => void): Promise<MLCEngine> {
  report = onProgress;
  if (loaded?.model === model) return loaded.engine;
  const previous = loaded;
  const engine = (async () => {
    if (previous) await (await previous.engine.catch(() => null))?.unload();
    // Ask the browser not to clear the 1 GB download when the disk gets full; it may say no, which is fine.
    await navigator.storage?.persist?.().catch(() => false);
    const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
    return CreateMLCEngine(model, { initProgressCallback: (p) => report(p.text) }, { context_window_size: 8192 });
  })();
  loaded = { model, engine };
  engine.catch(() => {
    if (loaded?.engine === engine) loaded = null; // let the next message try again
  });
  return engine;
}

/** Streams a reply. Aborting stops generation; the text so far stays with the caller. */
export async function* generate(model: string, messages: Message[], signal: AbortSignal, onProgress: (text: string) => void): AsyncGenerator<string> {
  const engine = await engineFor(model, onProgress);
  if (signal.aborted) return;
  // The first answer after loading reads the whole record, which takes minutes on a weak graphics chip.
  onProgress("Reading your record. The first answer can take a few minutes on a slower computer…");
  const stop = () => engine.interruptGenerate();
  signal.addEventListener("abort", stop);
  try {
    const chunks = await engine.chat.completions.create({ messages, stream: true, temperature: 0.4, max_tokens: 600 });
    for await (const chunk of chunks) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) yield text;
    }
  } catch (err) {
    // A weak graphics chip can be reset by the system mid-answer; WebLLM then unloads the model ("disposed").
    if (!/disposed|device.*lost/i.test(String(err))) throw err;
    loaded = null;
    throw new Error("Your graphics chip stopped the AI Coach's model partway, which can happen on slower computers. Send your message again, or switch to demo mode under Model.");
  } finally {
    signal.removeEventListener("abort", stop);
  }
}
