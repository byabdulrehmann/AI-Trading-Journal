// A throwaway Jarvis on port 3108 for looking at screens: its own database under data/demo, never data/kestrel.db.
// Builds the current code into its own folder first. Delete data/demo to start clean.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const env = { ...process.env, KESTREL_DIST_DIR: ".next-demo", KESTREL_DB_PATH: path.resolve("data/demo/kestrel.db"), JARVIS_OPEN_SIGNUP: "1", TRADBOT_URL: "http://127.0.0.1:9", ANTHROPIC_API_KEY: "" };
// The build points these at its own folder, so put them back.
const touched = ["next-env.d.ts", "tsconfig.json"].map((f) => [f, readFileSync(f, "utf8")]);
try {
  execSync("npx next build", { env, stdio: "inherit" });
} finally {
  for (const [f, text] of touched) writeFileSync(f, text);
}
execSync("npx next start -H 127.0.0.1 -p 3108", { env, stdio: "inherit" });
