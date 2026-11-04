import { connection } from "next/server";
import { endSession } from "@/lib/server/auth";
import { json } from "@/lib/server/http";

export async function POST() {
  await connection();
  await endSession();
  return json({ ok: true });
}
