import { z } from "zod";
import { requireUser } from "@/lib/server/auth";
import { body, fail, json } from "@/lib/server/http";
import { reconciliationCandidates, resolveReconciliation } from "@/lib/server/repo/journal";

const Decision = z
  .object({ keepId: z.number().int().positive(), otherId: z.number().int().positive(), decision: z.enum(["kept_both", "merged"]) })
  .refine((d) => d.keepId !== d.otherId, { message: "Pick two different trades.", path: ["otherId"] });

/** Pairs that look like the same trade from two sources. Only ever suggestions. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return json({ pairs: reconciliationCandidates(user.id) });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, Decision);
  if (data instanceof Response) return data;
  return resolveReconciliation(user.id, data.keepId, data.otherId, data.decision) ? json({ ok: true }) : fail("Trade not found.", 404);
}
