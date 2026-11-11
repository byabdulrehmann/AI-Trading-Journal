import { expect, guarded, open, test, uniqueEmail } from "./helpers";

// The public website: presentation only. Signed out it shows pages and takes early-access requests, and nothing else.
const PAGES = ["/welcome", "/platform", "/features", "/about", "/contact"];

for (const path of PAGES) {
  guarded(`signed out, ${path} loads with no app inside it`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res!.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("aside")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
}

guarded("the main nav reaches every site page", async ({ page }) => {
  await page.goto("/about");
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const [name, path] of [["Features", "/features"], ["About", "/about"], ["Contact", "/contact"]]) {
    await nav.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  }
  await nav.getByRole("link", { name: "Jarvis home" }).click();
  await expect(page).toHaveURL(/\/welcome$/);
});

guarded("sound is off until the visitor turns it on, and the volume follows", async ({ page }) => {
  await page.goto("/about");
  const toggle = page.getByTestId("sound-control").first().getByRole("button");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("volume")).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const volume = page.getByTestId("volume").first();
  await volume.fill("0.2");
  await expect(volume).toHaveAttribute("aria-valuetext", "20%");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});

guarded("signed out, the site opens nothing private", async ({ page, request }) => {
  expect((await request.get("/api/early-access")).status()).toBe(401);
  expect((await request.delete("/api/early-access/1")).status()).toBe(401);
  for (const path of ["/", "/journal", "/settings"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
  await page.goto("/welcome");
  // Sample screens are pictures; no live account figure or trade list is fetched for a visitor.
  const calls: string[] = [];
  page.on("request", (r) => r.url().includes("/api/") && calls.push(r.url()));
  await page.reload();
  await page.waitForLoadState("networkidle");
  expect(calls.filter((u) => !u.endsWith("/api/auth/me"))).toEqual([]);
});

guarded("the early-access form saves a request and says what happens to it", async ({ page }) => {
  await page.goto("/contact");
  await page.getByLabel("Name", { exact: true }).fill("Site visitor");
  await page.getByLabel("Email", { exact: true }).fill(uniqueEmail("visitor"));
  await page.getByRole("button", { name: "Request early access" }).click();
  await expect(page.getByTestId("early-access-sent")).toContainText("No email has been sent");
});

guarded("the early-access API rejects bad input and the hidden trap field", async ({ request, guard }) => {
  guard.allow(/status of 422/);
  expect((await request.post("/api/early-access", { data: { name: "", email: "not-an-email" } })).status()).toBe(422);
  expect((await request.post("/api/early-access", { data: { name: "Bot", email: uniqueEmail("bot"), website: "http://spam.test" } })).status()).toBe(422);
  // Without JavaScript the form posts plainly and lands back on the page.
  const plain = await request.post("/api/early-access", { form: { name: "No script", email: uniqueEmail("plain") }, maxRedirects: 0 });
  expect(plain.status()).toBe(303);
  expect(plain.headers().location).toContain("/contact?sent=1");
});

test("the owner reads and deletes early-access requests in Settings", async ({ page }) => {
  const email = uniqueEmail("ask");
  expect((await page.request.post("/api/early-access", { data: { name: "Owner check", email } })).status()).toBe(201);
  await open(page, "/settings#early-access");
  const list = page.getByTestId("early-access-requests");
  await expect(list).toContainText(email);
  page.once("dialog", (d) => void d.accept());
  await list.getByRole("button", { name: "Delete the request from Owner check" }).click();
  await expect(page.getByText(email)).toHaveCount(0);
});

// Last on purpose: it uses up this run's early-access allowance.
guarded("early-access requests are rate limited", async ({ request }) => {
  let status = 0;
  for (let i = 0; i < 10 && status !== 429; i++) status = (await request.post("/api/early-access", { data: { name: "Flood", email: uniqueEmail("flood") } })).status();
  expect(status).toBe(429);
});

guarded("the cursor follower grows over links, never takes clicks, and stays off touch screens", async ({ page, browser }) => {
  await page.goto("/about");
  const cursor = page.getByTestId("site-cursor");
  await expect(cursor).toHaveCount(1);
  expect(await cursor.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
  const link = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Contact", exact: true });
  const box = (await link.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await expect(cursor).toHaveAttribute("data-state", "link");
  // A click lands on the link underneath, not on the follower.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page).toHaveURL(/\/contact$/);

  const touch = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const phone = await touch.newPage();
  await phone.goto(new URL("/about", page.url()).href);
  await expect(phone.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(phone.getByTestId("site-cursor")).toHaveCount(0);
  await touch.close();
});
