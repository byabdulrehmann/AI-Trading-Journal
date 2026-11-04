import { AccountInput } from "@/lib/domain/types";
import { body, dynamic, json } from "@/lib/server/http";
import { createAccount, listAccounts } from "@/lib/server/repo/journal";
import { recordActivity } from "@/lib/server/repo/activity";

export async function GET() {
  await dynamic();
  return json({ accounts: listAccounts() });
}

export async function POST(req: Request) {
  await dynamic();
  const data = await body(req, AccountInput);
  if (data instanceof Response) return data;
  const account = createAccount(data);
  recordActivity("settings.changed", { setting: "accounts.create" });
  return json({ account }, 201);
}
