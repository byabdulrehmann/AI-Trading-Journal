import { expect, open, test } from "./helpers";

test("Accounts & MT5 shows no connection, and the form stops at client-side validation", async ({ page }) => {
  // A backstop: nothing in this test may reach the route that starts the MT5 service.
  const connects: string[] = [];
  await page.route("**/api/mt5/**", async (route) => {
    if (route.request().method() === "GET") return route.continue();
    connects.push(route.request().url());
    await route.abort();
  });

  await open(page, "/");
  await page.locator("aside").getByRole("link", { name: "Accounts & MT5" }).click();
  await expect(page).toHaveURL(/\/accounts$/);

  await expect(page.getByRole("heading", { name: "No MT5 account connected" })).toBeVisible();
  await expect(page.getByText("Connect one below to bring in its trades, balance and open positions automatically.")).toBeVisible();

  // Nothing claims or implies a live link.
  for (const claim of ["Connected", "Syncing", "Stale", "Disconnected", "Sync now", "Open positions", "Balance", "Equity"]) {
    await expect(page.locator("main").getByText(claim, { exact: true })).toHaveCount(0);
  }
  const status = await (await page.request.get("/api/mt5/status")).json();
  expect(status.connections).toEqual([]);

  // The default account is listed as filled in by hand.
  await expect(page.getByText("Filled in by hand or by file import.")).toBeVisible();
  await expect(page.getByRole("listitem").getByText("Main account")).toBeVisible();
  await expect(page.getByText("Read-only. Jarvis can't place, change or close trades.")).toBeVisible();

  const login = page.getByLabel("Account number");
  const server = page.getByLabel("Server");
  const password = page.getByLabel("Investor password");
  const connect = page.getByRole("button", { name: "Connect", exact: true });
  const invalid = (l: typeof login) => l.evaluate((el: HTMLInputElement) => !el.validity.valid);

  await connect.click();
  expect(await invalid(login)).toBe(true);
  expect(await invalid(server)).toBe(true);
  expect(await invalid(password)).toBe(true);
  await expect(login).toBeFocused();

  // Not real values, and never all three, so the form can't submit.
  await login.fill("1");
  await connect.click();
  expect(await invalid(login)).toBe(false);
  await expect(server).toBeFocused();
  await server.fill("x");
  await connect.click();
  await expect(password).toBeFocused();

  await expect(page.getByText("Starting the terminal and logging in.")).toHaveCount(0);
  await expect(connect).toBeEnabled();
  expect(connects).toEqual([]);
});
