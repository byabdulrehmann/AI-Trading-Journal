import { dynamic, json } from "@/lib/server/http";
import { buildContext } from "@/lib/server/ai/context";
import { resolveActive } from "@/lib/server/ai/registry";
import { getSettings } from "@/lib/server/repo/settings";

/** Preview of exactly what the next Jarvis request would include. */
export async function GET() {
  await dynamic();
  const settings = getSettings();
  const ctx = buildContext(settings);
  const active = resolveActive(settings);
  return json({
    provider: active.provider.label,
    external: active.provider.status().external,
    disclosure: ctx.disclosure,
    sample: { recentTrades: ctx.recentTrades.slice(0, 3), memories: ctx.memories, patterns: ctx.patterns.map((p) => p.title) },
  });
}
