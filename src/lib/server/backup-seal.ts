import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { createCipheriv, createDecipheriv, createPrivateKey, generateKeyPairSync, privateDecrypt, publicEncrypt, randomBytes, constants } from "node:crypto";

/**
 * Backups locked with the owner's backup password, in a way that still lets Jarvis make them unattended:
 * an RSA key pair whose private half is encrypted with the password. Each backup gets a fresh AES-256-GCM key,
 * locked with the public half, so writing a backup needs no password and reading one always does.
 * The password-locked private key travels inside every backup, so a backup opens on any computer with the password.
 * scripts/decrypt-backup.mjs reads the same format without the app; keep the two in step.
 */

export const SEAL_MAGIC = "JARVIS-BACKUP-1\n";

export interface BackupKeys {
  publicKey: string;
  /** PKCS#8 PEM, encrypted with the backup password. */
  privateKey: string;
}

const OAEP = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" } as const;

export function makeBackupKeys(password: string): BackupKeys {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }) as string,
    privateKey: privateKey.export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: password }) as string,
  };
}

/** The same keys under a new password, or null when the current password is wrong. */
export function changeBackupPassword(keys: BackupKeys, current: string, next: string): BackupKeys | null {
  const key = unlock(keys.privateKey, current);
  return key ? { ...keys, privateKey: key.export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: next }) as string } : null;
}

/** Where the keys live: the settings table, installation-wide. */
export const BACKUP_KEYS = "install:backup-key";

export function readBackupKeys(conn: DatabaseSync): BackupKeys | null {
  const row = conn.prepare("SELECT value FROM settings WHERE key = ?").get(BACKUP_KEYS) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as BackupKeys) : null;
}

/** Replaces a plain backup file with its sealed copy (name + ".sealed"), when a backup password is set. Returns the file kept. */
export function sealFile(conn: DatabaseSync, file: string): string {
  const keys = readBackupKeys(conn);
  if (!keys) return file;
  writeFileSync(`${file}.sealed`, seal(readFileSync(file), keys));
  unlinkSync(file);
  return `${file}.sealed`;
}

/**
 * A sealed backup with its locked private key swapped for `keys`' (same key pair, new password), so the current
 * password opens it. The encrypted contents are untouched.
 */
export function rewrap(sealed: Buffer, keys: BackupKeys): Buffer {
  const end = sealed.indexOf(0x0a, SEAL_MAGIC.length);
  const header = { ...JSON.parse(sealed.subarray(SEAL_MAGIC.length, end).toString("latin1")), privateKey: keys.privateKey };
  return Buffer.concat([Buffer.from(SEAL_MAGIC + JSON.stringify(header) + "\n", "latin1"), sealed.subarray(end + 1)]);
}

export const isSealed = (bytes: Buffer) => bytes.subarray(0, SEAL_MAGIC.length).toString("latin1") === SEAL_MAGIC;

export function seal(plain: Buffer, keys: BackupKeys): Buffer {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const header = {
    key: publicEncrypt({ key: keys.publicKey, ...OAEP }, key).toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    privateKey: keys.privateKey,
  };
  return Buffer.concat([Buffer.from(SEAL_MAGIC + JSON.stringify(header) + "\n", "latin1"), body]);
}

/** The original database file, or null when the password is wrong. Throws if the file isn't a sealed backup or was altered. */
export function unseal(sealed: Buffer, password: string): Buffer | null {
  if (!isSealed(sealed)) throw new Error("This isn't an encrypted Jarvis backup.");
  const end = sealed.indexOf(0x0a, SEAL_MAGIC.length);
  const header = JSON.parse(sealed.subarray(SEAL_MAGIC.length, end).toString("latin1")) as { key: string; iv: string; tag: string; privateKey: string };
  const privateKey = unlock(header.privateKey, password);
  if (!privateKey) return null;
  const key = privateDecrypt({ key: privateKey, ...OAEP }, Buffer.from(header.key, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64"));
  decipher.setAuthTag(Buffer.from(header.tag, "base64"));
  return Buffer.concat([decipher.update(sealed.subarray(end + 1)), decipher.final()]);
}

function unlock(pem: string, password: string) {
  try {
    return createPrivateKey({ key: pem, passphrase: password });
  } catch {
    return null; // wrong password
  }
}
