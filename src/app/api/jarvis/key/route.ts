import { z } from "zod";
import { rateLimited, requireOwner, requireUser } from "@/lib/server/auth";
import { FREE_KEY_PROVIDERS, hasFreeKey, hasOwnKey, keyFor, saveFreeKey, saveOwnKey, setSharingOwnerKey, sharingOwnerKey, withGivenKey } from "@/lib/server/ai/key";
import { getProvider } from "@/lib/server/ai/registry";
import { ProviderError } from "@/lib/server/ai/types";
import { audit } from "@/lib/server/repo/audit";
import { body, fail, json } from "@/lib/server/http";

/** Which key this account uses. Never the key itself: it doesn't leave the server. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const using = keyFor(user.id);
  return json({
    ownKey: hasOwnKey(user.id),
    using: using ? (using.own ? "own" : "owner") : "none",
    ownerSharing: sharingOwnerKey(),
    ownerHasKey: !!process.env.ANTHROPIC_API_KEY,
    free: Object.fromEntries(FREE_KEY_PROVIDERS.map((p) => [p, hasFreeKey(user.id, p)])),
  });
}

const Provider = z.enum(["anthropic", ...FREE_KEY_PROVIDERS]).default("anthropic");
const NAMES = { anthropic: "Anthropic", gemini: "Google Gemini", groq: "Groq" } as const;
const Save = z
  .object({ provider: Provider, key: z.string().trim().min(20, "That doesn't look like an API key.").max(300).regex(/^[\w-]+$/, "That doesn't look like an API key.") })
  .refine((d) => d.provider !== "anthropic" || d.key.startsWith("sk-ant-"), { message: "That doesn't look like an Anthropic key.", path: ["key"] });

/** Saves this account's own key for a provider, after the provider accepts it. */
export async function PUT(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const data = await body(req, Save);
  if (data instanceof Response) return data;
  if (rateLimited(`ai-key:${user.id}`, 10)) return fail("Too many attempts. Try again in 15 minutes.", 429);
  const name = NAMES[data.provider];
  try {
    await withGivenKey(data.key, () => getProvider(data.provider)!.listModels(AbortSignal.timeout(15_000)));
  } catch (err) {
    return fail(err instanceof ProviderError && err.kind === "auth" ? `${name} didn't accept that key.` : `Couldn't check the key with ${name}. Try again in a moment.`, 422);
  }
  if (data.provider === "anthropic") saveOwnKey(user.id, data.key);
  else saveFreeKey(user.id, data.provider, data.key);
  audit(user.id, "ai_key.saved", "user", user.id, { provider: data.provider });
  return json({ ok: true });
}

/** Removes this account's own key for a provider (?provider=, Anthropic by default); Anthropic goes back to the owner's, if shared. */
export async function DELETE(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const provider = Provider.safeParse(new URL(req.url).searchParams.get("provider") ?? undefined);
  if (!provider.success) return fail("Unknown provider.", 400);
  if (provider.data === "anthropic") saveOwnKey(user.id, null);
  else saveFreeKey(user.id, provider.data, null);
  audit(user.id, "ai_key.removed", "user", user.id, { provider: provider.data });
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
