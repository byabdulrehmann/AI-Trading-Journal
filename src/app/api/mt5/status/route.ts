import { json } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { listConnections } from "@/lib/server/repo/mt5";
import { startMt5Scheduler } from "@/lib/server/mt5/scheduler";
import { syncing } from "@/lib/server/mt5/sync";

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  startMt5Scheduler(); // Idempotent: covers the time before anything else has started it.
  return json({ connections: listConnections(user.id, syncing) });
}
