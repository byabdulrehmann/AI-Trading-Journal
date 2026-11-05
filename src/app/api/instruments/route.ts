import { requireUser } from "@/lib/server/auth";
import { fail, idParam, json } from "@/lib/server/http";
import { listInstruments } from "@/lib/server/repo/journal";

/** Instrument specs known for one account: what the broker reported, or what the user last entered. */
export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const accountId = idParam(new URL(req.url).searchParams.get("accountId") ?? "");
  return accountId ? json({ instruments: listInstruments(user.id, accountId) }) : fail("Choose an account.", 400);
}
