import "server-only";
import { ProviderError, type JarvisProvider } from "../types";

/** Ids from WebLLM's prebuilt model list (@mlc-ai/web-llm). The first is the default. */
export const BROWSER_MODELS = [
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", displayName: "Qwen 2.5 1.5B (about 1 GB download, fastest)" },
  { id: "Qwen2.5-3B-Instruct-q4f16_1-MLC", displayName: "Qwen 2.5 3B (about 2 GB, better answers, slower)" },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", displayName: "Llama 3.2 3B (about 2 GB, better answers, slower)" },
];

/**
 * The model runs in the user's browser (WebGPU), so the server never generates: the chat route hands the
 * browser the instructions and history, and the browser sends the finished reply back to be saved.
 */
export const browserProvider: JarvisProvider = {
  id: "browser",
  label: "In your browser (free, private)",
  defaultModel: BROWSER_MODELS[0].id,
  status: () => ({ configured: true, external: false }),
  async listModels() {
    return BROWSER_MODELS;
  },
  async *stream() {
    throw new ProviderError("This model runs in your browser, not on the server.", "bad_request");
  },
};
