import { dynamic, json } from "@/lib/server/http";
import { deleteAllConversations, listConversations } from "@/lib/server/repo/jarvis";

export async function GET() {
  await dynamic();
  return json({ conversations: listConversations() });
}

export async function DELETE() {
  await dynamic();
  return json({ removed: deleteAllConversations() });
}
