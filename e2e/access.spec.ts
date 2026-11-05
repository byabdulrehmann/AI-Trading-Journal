import { expect, guarded as test } from "./helpers";

for (const path of ["/", "/journal", "/journal?import=1", "/calendar", "/analytics", "/patterns", "/market", "/jarvis", "/accounts", "/settings"]) {
  test(`signed out, ${path} redirects to /login`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: /Sign in|Create account/ })).toBeVisible();
  });
}

test("signed out, API calls return 401", async ({ request }) => {
  const calls = [
    request.get("/api/trades"),
    request.get("/api/trades/1"),
    request.post("/api/trades", { data: {} }),
    request.put("/api/trades/1", { data: {} }),
    request.post("/api/trades/delete", { data: { ids: [1], deleted: true } }),
    request.get("/api/analytics"),
    request.get("/api/accounts"),
    request.get("/api/settings"),
    request.get("/api/facets"),
    request.get("/api/imports"),
    request.get("/api/attachments/1"),
    request.get("/api/mt5/status"),
    request.post("/api/mt5/connect", { data: {} }),
    request.post("/api/data/sample"),
  ];
  for (const res of await Promise.all(calls)) expect(`${res.url()} ${res.status()}`).toBe(`${res.url()} 401`);

  const me = await request.get("/api/auth/me");
  expect(me.status()).toBe(200);
  expect((await me.json()).user).toBeNull();
});

test("a made-up session cookie opens nothing", async ({ page, context, baseURL, guard }) => {
  guard.allow(/status of 401/);
  await context.addCookies([{ name: "jarvis_session", value: "not-a-real-session", url: baseURL! }]);
  expect((await page.request.get("/api/trades")).status()).toBe(401);
  await page.goto("/journal");
  await expect(page).toHaveURL(/\/login$/);
});

test("/welcome loads without signing in", async ({ page }) => {
  const response = await page.goto("/welcome");
  expect(response!.status()).toBe(200);
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("aside")).toHaveCount(0);
});
