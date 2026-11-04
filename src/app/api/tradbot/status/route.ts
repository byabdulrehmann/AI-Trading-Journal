import { json } from "@/lib/server/http";
import { requireOwner } from "@/lib/server/auth";
import { tradbot } from "@/lib/server/tradbot/bridge";

/** Checks whether TradBot-I's dashboard is reachable and reports pairing/link state. */
export async function GET() {
  const user = await requireOwner();
  if (user instanceof Response) return user;
  const bridge = tradbot();
  await bridge.probe();
  return json(bridge.status());
}
