import "server-only";
import { execFileSync } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Outside the project, so zipping or syncing the folder doesn't carry the key along with the database. */
function keyFolder(): string {
  if (process.env.JARVIS_KEY_DIR) return process.env.JARVIS_KEY_DIR;
  return process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Jarvis") : path.join(process.cwd(), ".secrets");
}

/** Key from JARVIS_ENCRYPTION_KEY (base64 or hex of 32 bytes), else a key file outside the database. */
export function masterKey(): Buffer {
  const env = process.env.JARVIS_ENCRYPTION_KEY;
  if (env) {
    const key = Buffer.from(env, /^[0-9a-f]{64}$/i.test(env) ? "hex" : "base64");
    if (key.length !== 32) throw new Error("JARVIS_ENCRYPTION_KEY must be 32 bytes, as base64 or hex.");
    return key;
  }
  const file = path.join(keyFolder(), "master.key");
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600, flag: "wx" });
    restrictToCurrentUser(file);
  }
  const key = Buffer.from(readFileSync(file, "utf8").trim(), "base64");
  if (key.length !== 32) throw new Error("The key in master.key is not 32 bytes.");
  return key;
}

/** Best effort: mode 0o600 means nothing on Windows, and the key still works if icacls can't run. */
function restrictToCurrentUser(file: string) {
  if (process.platform !== "win32") return;
  try {
    // By SID: a bare user name can resolve to a computer with the same name, and lock the user out.
    const sid = execFileSync("whoami", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8" }).match(/S-1-[\d-]+/)?.[0];
    if (sid) execFileSync("icacls", [file, "/inheritance:r", "/grant:r", `*${sid}:F`], { stdio: "ignore" });
  } catch {
    // The folder is still gitignored and under the user's profile.
  }
}

/** AES-256-GCM with a fresh IV per message: "iv.tag.ciphertext" in base64. */
export function encrypt(plain: string, key = masterKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

/** Throws if the text was altered or the key is different. */
export function decrypt(stored: string, key = masterKey()): string {
  const [iv, tag, data] = stored.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
