import { currentUser, signupOpen, userCount } from "@/lib/server/auth";
import { json } from "@/lib/server/http";

/** Tells the sign-in pages whether to offer first-time setup and whether new accounts are allowed. Public, and reveals only that. */
export async function GET() {
  const user = await currentUser();
  const hasUsers = userCount() > 0;
  return json({ user, hasUsers, signupOpen: !hasUsers || signupOpen() });
}
