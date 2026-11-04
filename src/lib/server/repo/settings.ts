import "server-only";
import { db } from "../db";
import { Settings } from "@/lib/domain/types";

const key = (userId: number) => `app:${userId}`;

export function getSettings(userId: number): Settings {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key(userId)) as { value: string } | undefined;
  const parsed = Settings.safeParse(row ? JSON.parse(row.value) : {});
  return parsed.success ? parsed.data : Settings.parse({});
}

/** Shallow-merges top-level keys and the nested `jarvis` object. */
export type SettingsPatch = Partial<Omit<Settings, "jarvis">> & { jarvis?: Partial<Settings["jarvis"]> };

export function updateSettings(userId: number, patch: SettingsPatch): Settings {
  const current = getSettings(userId);
  const next = Settings.parse({
    ...current,
    ...patch,
    jarvis: { ...current.jarvis, ...(patch.jarvis ?? {}) },
  });
  db()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key(userId), JSON.stringify(next));
  return next;
}
