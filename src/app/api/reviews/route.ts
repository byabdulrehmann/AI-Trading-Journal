import { requireUser } from "@/lib/server/auth";
import { body, fail, json } from "@/lib/server/http";
import { ReviewQuery, getReview, writeReview } from "@/lib/server/reviews";

export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const q = new URL(req.url).searchParams;
  const parsed = ReviewQuery.safeParse({ period: q.get("period"), date: q.get("date") });
  if (!parsed.success) return fail("Pick a week or month.", 422);
  return json(getReview(user.id, parsed.data.period, parsed.data.date, q.get("includeSample") === "1"));
}

/** Has the connected AI model write the review, and saves it. */
export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, ReviewQuery);
  if (data instanceof Response) return data;
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(90_000)]);
  const r = await writeReview(user.id, data.period, data.date, new URL(req.url).searchParams.get("includeSample") === "1", signal);
  return r.ok ? json({ saved: r.saved }) : fail(r.reason, r.status);
}
