import { dynamic, json } from "@/lib/server/http";
import { removeSampleData } from "@/lib/server/repo/journal";
import { loadSampleData } from "@/lib/server/sample";

export async function POST() {
  await dynamic();
  return json({ added: loadSampleData() });
}

export async function DELETE() {
  await dynamic();
  return json({ removed: removeSampleData() });
}
