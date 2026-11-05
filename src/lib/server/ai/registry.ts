import "server-only";
import type { Settings } from "@/lib/domain/types";
import { anthropicProvider } from "./providers/anthropic";
import { demoProvider } from "./providers/demo";
import { ProviderError, type JarvisProvider, type ModelInfo } from "./types";

/** Add a provider by implementing JarvisProvider and listing it here. */
export const PROVIDERS: JarvisProvider[] = [demoProvider, anthropicProvider];

export function getProvider(id: string): JarvisProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export interface ActiveModel {
  provider: JarvisProvider;
  model: string;
  /** Set when the saved choice couldn't be used and demo mode stepped in. */
  fallbackReason?: string;
}

export function resolveActive(settings: Settings): ActiveModel {
  const wanted = getProvider(settings.jarvis.provider);
  if (!wanted) return { provider: demoProvider, model: demoProvider.defaultModel, fallbackReason: `Unknown provider "${settings.jarvis.provider}".` };
  const status = wanted.status();
  if (!status.configured)
    return { provider: demoProvider, model: demoProvider.defaultModel, fallbackReason: `${wanted.label} isn't configured: ${status.reason}` };
  // "kestrel-demo" is the demo model's old id, possibly still saved in settings.
  return { provider: wanted, model: (settings.jarvis.model !== "kestrel-demo" && settings.jarvis.model) || wanted.defaultModel };
}

export interface SwitchResult {
  ok: boolean;
  provider?: string;
  model?: string;
  message: string;
  candidates?: ModelInfo[];
}

/**
 * Validates a provider/model choice against what the provider actually
 * reports, so Jarvis never claims access to a model it can't reach.
 */
export async function validateChoice(providerId: string, modelId: string | null): Promise<SwitchResult> {
  const provider = getProvider(providerId);
  if (!provider) return { ok: false, message: `There's no provider called "${providerId}". Available: ${PROVIDERS.map((p) => p.id).join(", ")}.` };
  const status = provider.status();
  if (!status.configured)
    return { ok: false, message: `${provider.label} isn't configured. ${status.reason} Demo mode stays available meanwhile.` };
  let models: ModelInfo[];
  try {
    models = await provider.listModels();
  } catch (err) {
    const msg = err instanceof ProviderError ? err.message : "Couldn't list models.";
    return { ok: false, message: `${msg} Your previous model is unchanged.` };
  }
  const model = modelId ?? provider.defaultModel;
  if (!models.some((m) => m.id === model))
    return { ok: false, message: `"${model}" isn't in ${provider.label}'s model list for this key.`, candidates: models };
  return { ok: true, provider: provider.id, model, message: `Switched to ${provider.label} · ${model}.` };
}

/** Finds models matching a loose user phrase like "sonnet" or "opus 5.5". */
export async function findModels(phrase: string): Promise<{ provider: string; model: ModelInfo }[]> {
  const needle = phrase.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const out: { provider: string; model: ModelInfo }[] = [];
  for (const p of PROVIDERS) {
    if (!p.status().configured) continue;
    let models: ModelInfo[] = [];
    try {
      models = await p.listModels();
    } catch {
      continue;
    }
    for (const m of models) {
      const hay = (m.id + m.displayName).toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (needle && hay.includes(needle)) out.push({ provider: p.id, model: m });
    }
  }
  return out;
}
