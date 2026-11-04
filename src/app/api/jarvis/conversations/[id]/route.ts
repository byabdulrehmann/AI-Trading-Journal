import { fail, idParam, json } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { conversationExists, deleteConversation, listMessages } from "@/lib/server/repo/jarvis";

export async function GET(_req: Request, ctx: RouteContext<"/api/jarvis/conversations/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  if (!id || !conversationExists(user.id, id)) return fail("Conversation not found.", 404);
  return json({ messages: listMessages(id) });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/jarvis/conversations/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  if (!id || !deleteConversation(user.id, id)) return fail("Conversation not found.", 404);
  return json({ ok: true });
}
