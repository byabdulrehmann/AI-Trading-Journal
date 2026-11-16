import { z } from "zod";
import { requireOwner, setSignupOpen, signupOpen } from "@/lib/server/auth";
import { body, json } from "@/lib/server/http";

/** Whether anyone who reaches this computer may create an account. Owner only. */
export async function GET() {
  const user = await requireOwner();
  if (user instanceof Response) return user;
  return json({ open: signupOpen() });
}

export async function PUT(req: Request) {
  const user = await requireOwner();
  if (user instanceof Response) return user;
  const data = await body(req, z.object({ open: z.boolean() }));
  if (data instanceof Response) return data;
  setSignupOpen(user.id, data.open);
  return json({ open: data.open });
}
