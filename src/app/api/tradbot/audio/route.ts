import { dynamic, fail, json } from "@/lib/server/http";
import { tradbot } from "@/lib/server/tradbot/bridge";

const MAX_CHUNK_BYTES = 64 * 1024; // ~2 s of 16 kHz mono PCM16

/**
 * Receives browser microphone audio as raw 16 kHz mono little-endian PCM16
 * (application/octet-stream) and forwards it to TradBot-I's phone-audio socket.
 */
export async function POST(req: Request) {
  await dynamic();
  const buf = await req.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > MAX_CHUNK_BYTES || buf.byteLength % 2 !== 0)
    return fail("Audio chunks must be non-empty PCM16 up to 64 KB.", 400);
  const res = await tradbot().sendAudio(buf);
  return res.ok ? new Response(null, { status: 204 }) : fail(res.error, res.status);
}

/** Stops forwarding immediately so TradBot-I returns to the PC microphone. */
export async function DELETE() {
  await dynamic();
  tradbot().closeAudio();
  return json({ ok: true });
}
