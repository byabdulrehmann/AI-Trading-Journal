import { requireUser } from "@/lib/server/auth";
import { body, fail, json } from "@/lib/server/http";
import { ChallengeInput, challengeAlerts, createChallenge, listChallenges } from "@/lib/server/progress";

export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const q = new URL(req.url).searchParams;
  const includeSample = q.get("includeSample") === "1";
  if (q.get("alerts") === "1") return json({ alerts: challengeAlerts(user.id, includeSample) });
  return json({ challenges: listChallenges(user.id, includeSample) });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, ChallengeInput);
  if (data instanceof Response) return data;
  const r = createChallenge(user.id, data);
  return r.ok ? json({ challenge: r.challenge }, 201) : fail(r.reason, 422);
}
