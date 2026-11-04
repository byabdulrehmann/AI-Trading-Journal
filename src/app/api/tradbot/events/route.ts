import { dynamic } from "@/lib/server/http";
import { tradbot } from "@/lib/server/tradbot/bridge";

/**
 * Server-sent events relaying TradBot-I's dashboard feed to the browser:
 *   snapshot → {status, events}; event → one TradBot event; status → link/session state; reset.
 */
export async function GET(req: Request) {
  await dynamic();
  const bridge = tradbot();
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };
      send("snapshot", bridge.snapshot());
      const unsubscribe = bridge.subscribe((msg) => {
        if (msg.kind === "event") send("event", msg.event);
        else if (msg.kind === "status") send("status", msg.status);
        else send("reset", {});
      });
      // Keeps proxies and the browser from timing the stream out.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 15000);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {}
      };
      req.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
