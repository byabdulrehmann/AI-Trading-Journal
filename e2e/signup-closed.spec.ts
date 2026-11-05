import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { expect, guarded as test, PASSWORD, uniqueEmail } from "./helpers";

test("without JARVIS_OPEN_SIGNUP, signup closes after the first user", async ({ page, request }) => {
  // The main server has signup open, so this reads the same build from a second server, with the default setting and its own database.
  const url = "http://localhost:3108";
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3108"], {
    env: { ...process.env, KESTREL_DIST_DIR: ".next-e2e", KESTREL_DB_PATH: path.join(mkdtempSync(path.join(process.env.E2E_DATA_DIR!, "closed-")), "kestrel.db"), JARVIS_OPEN_SIGNUP: "" },
    stdio: "ignore",
  });
  try {
    await expect(async () => expect((await fetch(`${url}/login`)).status).toBe(200)).toPass({ timeout: 30_000 });

    const first = await request.post(`${url}/api/auth/signup`, { data: { email: uniqueEmail(), password: PASSWORD, name: "" } });
    expect(first.status()).toBe(201);

    const email = uniqueEmail();
    const second = await request.post(`${url}/api/auth/signup`, { data: { email, password: PASSWORD, name: "" } });
    expect(second.status()).toBe(403);
    // It was refused, not just reported as refused.
    expect((await request.post(`${url}/api/auth/login`, { data: { email, password: PASSWORD } })).status()).toBe(401);

    await page.goto(`${url}/login`);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Repeat password")).toHaveCount(0);
  } finally {
    server.kill();
  }
});
