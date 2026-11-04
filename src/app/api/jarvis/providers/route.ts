import { z } from "zod";
import { body, json } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { PROVIDERS, resolveActive, validateChoice } from "@/lib/server/ai/registry";
import { ProviderError, type ModelInfo } from "@/lib/server/ai/types";
import { getSettings, updateSettings } from "@/lib/server/repo/settings";
import { recordActivity } from "@/lib/server/repo/activity";

/** Lists providers, their real configuration state, and discovered models. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const settings = getSettings(user.id);
  const active = resolveActive(settings);
  const providers = await Promise.all(
    PROVIDERS.map(async (p) => {
      const status = p.status();
      let models: ModelInfo[] = [];
      let modelError: string | null = null;
      if (status.configured) {
        try {
          models = await p.listModels(AbortSignal.timeout(15_000));
        } catch (err) {
          modelError = err instanceof ProviderError ? err.message : "Couldn't list models.";
        }
      }
      return { id: p.id, label: p.label, defaultModel: p.defaultModel, ...status, models, modelError };
    }),
  );
  return json({
    active: { provider: active.provider.id, label: active.provider.label, model: active.model, fallbackReason: active.fallbackReason ?? null },
    saved: { provider: settings.jarvis.provider, model: settings.jarvis.model },
    providers,
  });
}

/** Switches provider/model after checking the provider reports that model. */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, z.object({ provider: z.string().min(1), model: z.string().min(1).nullable().default(null) }));
  if (data instanceof Response) return data;
  const result = await validateChoice(data.provider, data.model);
  if (!result.ok) return json(result, 422);
  updateSettings(user.id, { jarvis: { provider: result.provider, model: result.model } });
  recordActivity(user.id, "settings.changed", { settings: ["jarvis.provider", "jarvis.model"] });
  return json(result);
}
