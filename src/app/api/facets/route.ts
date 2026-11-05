import { requireUser } from "@/lib/server/auth";
import { json } from "@/lib/server/http";
import { hasSampleData, listFacets } from "@/lib/server/repo/journal";

/** Choices for filter menus and autocomplete: symbols, strategies and tags in use, and whether sample data exists. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return json({ ...listFacets(user.id), hasSample: hasSampleData(user.id) });
}
