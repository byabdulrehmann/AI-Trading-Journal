import { z } from "zod";
import { rateLimited, requireOwner, requireUser } from "@/lib/server/auth";
import { hasOwnKey, keyFor, saveOwnKey, setSharingOwnerKey, sharingOwnerKey, withGivenKey } from "@/lib/server/ai/key";
import { getProvider } from "@/lib/server/ai/registry";
import { ProviderError } from "@/lib/server/ai/types";
import { audit } from "@/lib/server/repo/audit";
import { body, fail, json } from "@/lib/server/http";

/** Which key this account uses. Never the key itself: it doesn't leave the server. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const using = keyFor(user.id);
  return json({ ownKey: hasOwnKey(user.id), using: using ? (using.own ? "own" : "owner") : "none", ownerSharing: sharingOwnerKey(), ownerHasKey: !!process.env.ANTHROPIC_API_KEY });
}

const Save = z.object({ key: z.string().trim().min(20, "That doesn't look like an Anthropic key.").max(300).regex(/^sk-ant-[\w-]+$/, "That doesn't look like an Anthropic key.") });

/** Saves this account's own key, after Anthropic accepts it. */
export async function PUT(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, Save);
  if (data instanceof Response) return data;
  if (rateLimited(`ai-key:${user.id}`, 10)) return fail("Too many attempts. Try again in 15 minutes.", 429);
  try {
    await withGivenKey(data.key, () => getProvider("anthropic")!.listModels(AbortSignal.timeout(15_000)));
  } catch (err) {
    return fail(err instanceof ProviderError && err.kind === "auth" ? "Anthropic didn't accept that key." : "Couldn't check the key with Anthropic. Try again in a moment.", 422);
  }
  saveOwnKey(user.id, data.key);
  audit(user.id, "ai_key.saved", "user", user.id);
  return json({ ok: true });
}

/** Removes this account's own key; it goes back to the owner's, if shared. */
export async function DELETE() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  saveOwnKey(user.id, null);
  audit(user.id, "ai_key.removed", "user", user.id);
  return json({ ok: true });
}

/** Owner only: whether accounts without a key of their own may use the owner's. */
export async function PATCH(req: Request) {
  const user = await requireOwner();
  if (user instanceof Response) return user;
  const data = await body(req, z.object({ share: z.boolean() }));
  if (data instanceof Response) return data;
  setSharingOwnerKey(data.share);
  audit(user.id, data.share ? "ai_key.shared" : "ai_key.unshared");
  return json({ ownerSharing: data.share });
}
