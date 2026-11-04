const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Zod 4 fills in `.default()` values even under `.partial()`, which would overwrite
 * stored fields on a partial update, so keep only what the request actually sent.
 */
export function onlySent<T>(parsed: T, raw: unknown): T {
  if (!isPlainObject(parsed) || !isPlainObject(raw)) return parsed;
  return Object.fromEntries(
    Object.entries(parsed)
      .filter(([k]) => Object.hasOwn(raw, k))
      .map(([k, v]) => [k, onlySent(v, raw[k])]),
  ) as T;
}
