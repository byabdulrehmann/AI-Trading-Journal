import { requireUser } from "@/lib/server/auth";
import { json } from "@/lib/server/http";
import { listFacets } from "@/lib/server/repo/journal";

/** Choices for filter menus and autocomplete: symbols, strategies and tags in use. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  return json(listFacets(user.id));
}
