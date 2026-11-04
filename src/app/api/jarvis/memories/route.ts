import { MemoryInput } from "@/lib/domain/types";
import { body, dynamic, json } from "@/lib/server/http";
import { createMemory, listMemories, resetMemories } from "@/lib/server/repo/jarvis";

export async function GET() {
  await dynamic();
  return json({ memories: listMemories() });
}

export async function POST(req: Request) {
  await dynamic();
  const data = await body(req, MemoryInput);
  if (data instanceof Response) return data;
  return json({ memory: createMemory(data) }, 201);
}

/** Reset: deletes every memory. */
export async function DELETE() {
  await dynamic();
  return json({ removed: resetMemories() });
}
