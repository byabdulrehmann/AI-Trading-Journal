import { MemoryInput } from "@/lib/domain/types";
import { body, json } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { createMemory, listMemories, resetMemories } from "@/lib/server/repo/jarvis";

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return json({ memories: listMemories(user.id) });
}

export async function POST(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, MemoryInput);
  if (data instanceof Response) return data;
  return json({ memory: createMemory(user.id, data) }, 201);
}

/** Reset: deletes every memory. */
export async function DELETE() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return json({ removed: resetMemories(user.id) });
}
