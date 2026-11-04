import "server-only";
import { db } from "../db";
import { Settings } from "@/lib/domain/types";

const KEY = "app";

export function getSettings(): Settings {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  const parsed = Settings.safeParse(row ? JSON.parse(row.value) : {});
  return parsed.success ? parsed.data : Settings.parse({});
}

/** Shallow-merges top-level keys and the nested `jarvis` object. */
export type SettingsPatch = Partial<Omit<Settings, "jarvis">> & { jarvis?: Partial<Settings["jarvis"]> };

export function updateSettings(patch: SettingsPatch): Settings {
  const current = getSettings();
  const next = Settings.parse({
    ...current,
    ...patch,
    jarvis: { ...current.jarvis, ...(patch.jarvis ?? {}) },
  });
  db()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(KEY, JSON.stringify(next));
  return next;
}
