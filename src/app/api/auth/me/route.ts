import { currentUser, userCount } from "@/lib/server/auth";
import { json } from "@/lib/server/http";

/** Tells the sign-in page whether to offer first-time setup. Public, and reveals only that. */
export async function GET() {
  const user = await currentUser();
  return json({ user, hasUsers: userCount() > 0 });
}
