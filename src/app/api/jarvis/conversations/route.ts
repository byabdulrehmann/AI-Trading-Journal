import { json } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { deleteAllConversations, listConversations } from "@/lib/server/repo/jarvis";

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return json({ conversations: listConversations(user.id) });
}

export async function DELETE() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return json({ removed: deleteAllConversations(user.id) });
}
