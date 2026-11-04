import { dynamic, json } from "@/lib/server/http";
import { tradbot } from "@/lib/server/tradbot/bridge";

/** Checks whether TradBot-I's dashboard is reachable and reports pairing/link state. */
export async function GET() {
  await dynamic();
  const bridge = tradbot();
  await bridge.probe();
  return json(bridge.status());
}
