import { AccountInput } from "@/lib/domain/types";
import { body, json } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { createAccount, listAccounts } from "@/lib/server/repo/journal";
import { recordActivity } from "@/lib/server/repo/activity";

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return json({ accounts: listAccounts(user.id) });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, AccountInput);
  if (data instanceof Response) return data;
  const account = createAccount(user.id, data);
  recordActivity(user.id, "settings.changed", { setting: "accounts.create" });
  return json({ account }, 201);
}
