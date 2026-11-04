import { json } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { removeSampleData } from "@/lib/server/repo/journal";
import { loadSampleData } from "@/lib/server/sample";

export async function POST() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return json({ added: loadSampleData(user.id) });
}

export async function DELETE() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return json({ removed: removeSampleData(user.id) });
}
