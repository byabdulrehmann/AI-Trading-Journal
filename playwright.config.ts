import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// This file loads again in each worker, and the env var keeps it to one fresh folder per run. Attachments land beside the database, so they stay in it too.
process.env.E2E_DATA_DIR ??= mkdtempSync(path.join(tmpdir(), "jarvis-e2e-"));
// The build points next-env.d.ts at its own folder, so teardown puts this back.
process.env.E2E_NEXT_ENV ??= readFileSync("next-env.d.ts", "utf8");

const PORT = 3107;

export default defineConfig({
  testDir: "./e2e",
  globalTeardown: "./e2e/teardown.ts",
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  // actionTimeout: a stuck click names its own line instead of using up the test's whole timeout.
  use: { baseURL: `http://localhost:${PORT}`, channel: "chrome", screenshot: "only-on-failure", trace: "retain-on-failure", actionTimeout: 20_000 },
  projects: [
    // Needs an empty database, so it runs before anything signs up.
    { name: "first-run", testMatch: /first-run\.spec\.ts/ },
    { name: "app", testIgnore: /first-run\.spec\.ts/, dependencies: ["first-run"] },
  ],
  webServer: {
    // A production build in its own folder: `next dev` allows one server per project, and another server may be reading .next.
    command: `npm run build && npx next start -H 127.0.0.1 -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      KESTREL_DIST_DIR: ".next-e2e",
      KESTREL_DB_PATH: path.join(process.env.E2E_DATA_DIR, "kestrel.db"),
      TRADBOT_URL: "http://127.0.0.1:9", // Nothing listens there, so no test can reach a real TradBot.
      ANTHROPIC_API_KEY: "",
    },
  },
});
