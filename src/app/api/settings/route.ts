import { SettingsUpdate } from "@/lib/domain/types";
import { dynamic, json, patchBody } from "@/lib/server/http";
import { getSettings, updateSettings } from "@/lib/server/repo/settings";
import { recordActivity } from "@/lib/server/repo/activity";

export async function GET() {
  await dynamic();
  return json({ settings: getSettings() });
}

export async function PATCH(req: Request) {
  await dynamic();
  const data = await patchBody(req, SettingsUpdate);
  if (data instanceof Response) return data;
  // Provider/model changes go through /api/jarvis/providers so they're validated.
  if (data.jarvis) {
    delete data.jarvis.provider;
    delete data.jarvis.model;
  }
  const settings = updateSettings(data);
  const keys = [...Object.keys(data).filter((k) => k !== "jarvis"), ...Object.keys(data.jarvis ?? {}).map((k) => `jarvis.${k}`)];
  // Log after the update so turning tracking on is itself recorded, and turning it off is not.
  recordActivity("settings.changed", { settings: keys });
  return json({ settings });
}
