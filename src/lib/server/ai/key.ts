import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { db, getSetting, putSetting } from "../db";
import { decrypt, encrypt } from "../mt5/crypto";

/**
 * Which Anthropic key a request uses. Each account can keep its own key, encrypted with the same key that guards MT5
 * passwords and never sent back to the browser. Without one, the owner's key (ANTHROPIC_API_KEY) serves the owner,
 * and serves everyone else only while the owner shares it.
 */

const SHARE_KEY = "install:share-ai-key";
const store = new AsyncLocalStorage<string | null>();

/** True unless the owner stopped sharing their key with accounts that have none of their own. */
export const sharingOwnerKey = () => getSetting(SHARE_KEY) !== "off";
export function setSharingOwnerKey(share: boolean) {
  putSetting(SHARE_KEY, share ? "on" : "off");
}

export const hasOwnKey = (userId: number) => !!(db().prepare("SELECT anthropic_key_cipher FROM users WHERE id = ?").get(userId) as { anthropic_key_cipher: string | null } | undefined)?.anthropic_key_cipher;
export function saveOwnKey(userId: number, key: string | null) {
  db().prepare("UPDATE users SET anthropic_key_cipher = ? WHERE id = ?").run(key ? encrypt(key) : null, userId);
}

/** The key for this user and whether it's their own. Null when they have none and can't use the owner's. */
export function keyFor(userId: number): { key: string; own: boolean } | null {
  const row = db().prepare("SELECT is_owner, anthropic_key_cipher FROM users WHERE id = ?").get(userId) as { is_owner: number; anthropic_key_cipher: string | null } | undefined;
  if (!row) return null;
  if (row.anthropic_key_cipher) {
    try {
      return { key: decrypt(row.anthropic_key_cipher), own: true };
    } catch {
      return null; // The master key changed: the user has to enter theirs again.
    }
  }
  const shared = process.env.ANTHROPIC_API_KEY;
  return shared && (row.is_owner === 1 || sharingOwnerKey()) ? { key: shared, own: false } : null;
}

/** Runs `fn` with this user's key as the one the Anthropic provider sees, through everything `fn` awaits or streams. */
export const withAiKey = <T>(userId: number, fn: () => T): T => store.run(keyFor(userId)?.key ?? null, fn);
/** Runs `fn` with a given key, to check a key before it's saved. */
export const withGivenKey = <T>(key: string, fn: () => T): T => store.run(key, fn);
/** The key for the request being served; null outside withAiKey or when the user has none. */
export const currentAiKey = () => store.getStore() ?? null;
