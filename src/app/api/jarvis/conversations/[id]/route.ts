import { dynamic, fail, idParam, json } from "@/lib/server/http";
import { conversationExists, deleteConversation, listMessages } from "@/lib/server/repo/jarvis";

export async function GET(_req: Request, ctx: RouteContext<"/api/jarvis/conversations/[id]">) {
  await dynamic();
  const id = idParam((await ctx.params).id);
  if (!id || !conversationExists(id)) return fail("Conversation not found.", 404);
  return json({ messages: listMessages(id) });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/jarvis/conversations/[id]">) {
  await dynamic();
  const id = idParam((await ctx.params).id);
  if (!id || !deleteConversation(id)) return fail("Conversation not found.", 404);
  return json({ ok: true });
}
