// A throwaway Jarvis on port 3108 for looking at screens: its own database under data/demo, never data/kestrel.db.
// Builds the current code into its own folder first. Delete data/demo to start clean.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const env = { ...process.env, KESTREL_DIST_DIR: ".next-demo", KESTREL_DB_PATH: path.resolve("data/demo/kestrel.db"), JARVIS_OPEN_SIGNUP: "1", TRADBOT_URL: "http://127.0.0.1:9", ANTHROPIC_API_KEY: "" };
// The build points next-env.d.ts at its own folder, so put it back.
const nextEnv = readFileSync("next-env.d.ts", "utf8");
try {
  execSync("npx next build", { env, stdio: "inherit" });
} finally {
  writeFileSync("next-env.d.ts", nextEnv);
}
execSync("npx next start -H 127.0.0.1 -p 3108", { env, stdio: "inherit" });
