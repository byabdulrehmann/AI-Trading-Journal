import "server-only";
import { connection } from "next/server";
import type { z } from "zod";
import { onlySent } from "@/lib/domain/partial";

export const json = (data: unknown, status = 200) => Response.json(data, { status });

export const fail = (message: string, status = 400, issues?: { path: string; message: string }[]) =>
  Response.json({ error: message, issues }, { status });

/** Validates a JSON body; returns the parsed value or a 400 Response. */
export async function body<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S> | Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    return fail(
      "Some fields need attention.",
      422,
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  return parsed.data;
}

/** Like `body`, for partial updates: the result holds only the fields the request sent. */
export async function patchBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S> | Response> {
  const raw: unknown = await req.clone().json().catch(() => null);
  const data = await body(req, schema);
  return data instanceof Response ? data : onlySent(data, raw);
}

/**
 * Every data route reads SQLite synchronously, which Next can't detect, so
 * opt out of prerendering explicitly before touching the database.
 */
export async function dynamic() {
  await connection();
}

export function idParam(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
