import { z } from "zod";
import { body, fail, idParam, json } from "@/lib/server/http";
import { BROWSER_MODELS } from "@/lib/server/ai/providers/browser";
import { requireUser } from "@/lib/server/auth";
import { addMessage, conversationExists, deleteConversation, listMessages } from "@/lib/server/repo/jarvis";

const Reply = z.object({
  content: z.string().trim().min(1).max(20_000),
  model: z.enum(BROWSER_MODELS.map((m) => m.id) as [string, ...string[]]),
});

export async function GET(_req: Request, ctx: RouteContext<"/api/jarvis/conversations/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  if (!id || !conversationExists(user.id, id)) return fail("Conversation not found.", 404);
  return json({ messages: listMessages(id) });
}

/** Saves a reply the in-browser model wrote (see the chat route). */
export async function POST(req: Request, ctx: RouteContext<"/api/jarvis/conversations/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  if (!id || !conversationExists(user.id, id)) return fail("Conversation not found.", 404);
  const data = await body(req, Reply);
  if (data instanceof Response) return data;
  return json({ message: addMessage(id, "assistant", data.content, "browser", data.model) });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/jarvis/conversations/[id]">) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = idParam((await ctx.params).id);
  if (!id || !deleteConversation(user.id, id)) return fail("Conversation not found.", 404);
  return json({ ok: true });
}
