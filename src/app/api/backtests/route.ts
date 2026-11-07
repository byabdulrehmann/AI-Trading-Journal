import { requireUser } from "@/lib/server/auth";
import { SessionInput, createSession, listSessions } from "@/lib/server/backtests";
import { body, fail, json } from "@/lib/server/http";

export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const includeSample = new URL(req.url).searchParams.get("includeSample") === "1";
  const all = listSessions(user.id, true);
  return json({ sessions: includeSample ? all : all.filter((s) => !s.isSample), sampleHidden: !includeSample && all.some((s) => s.isSample) });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, SessionInput);
  if (data instanceof Response) return data;
  const r = await createSession(user.id, data);
  return r.ok ? json({ session: r.session }, 201) : fail(r.reason, 422);
}
