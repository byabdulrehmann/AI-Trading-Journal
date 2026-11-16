// Turns an encrypted Jarvis backup (*.db.sealed) back into a database file, without the app:
//   node scripts/decrypt-backup.mjs <backup.db.sealed> [output.db]
// It asks for the backup password. Same format as src/lib/server/backup-seal.ts; keep the two in step.
import { createDecipheriv, createPrivateKey, privateDecrypt, constants } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

const MAGIC = "JARVIS-BACKUP-1\n";

export function unseal(sealed, password) {
  if (sealed.subarray(0, MAGIC.length).toString("latin1") !== MAGIC) throw new Error("This isn't an encrypted Jarvis backup.");
  const end = sealed.indexOf(0x0a, MAGIC.length);
  const header = JSON.parse(sealed.subarray(MAGIC.length, end).toString("latin1"));
  let privateKey;
  try {
    privateKey = createPrivateKey({ key: header.privateKey, passphrase: password });
  } catch {
    return null;
  }
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(header.key, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64"));
  decipher.setAuthTag(Buffer.from(header.tag, "base64"));
  return Buffer.concat([decipher.update(sealed.subarray(end + 1)), decipher.final()]);
}

// Run as a command; imported (by the tests), it only lends unseal().
if (process.argv[1]?.endsWith("decrypt-backup.mjs")) {
  const [input, output = input?.replace(/\.sealed$/, "")] = process.argv.slice(2);
  if (!input || input === output) {
    console.error("Usage: node scripts/decrypt-backup.mjs <backup.db.sealed> [output.db]");
    process.exit(1);
  }
  if (existsSync(output)) {
    console.error(`${output} already exists. Name another output file.`);
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const password = await rl.question("Backup password (shown as you type): ");
  rl.close();
  const plain = unseal(readFileSync(input), password);
  if (!plain) {
    console.error("That password doesn't open this backup.");
    process.exit(1);
  }
  writeFileSync(output, plain, { flag: "wx" });
  console.log(`Wrote ${output}.`);
}
