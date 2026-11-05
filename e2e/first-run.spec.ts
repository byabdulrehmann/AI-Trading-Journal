import { expect, guarded as test, OWNER_EMAIL as email, PASSWORD } from "./helpers";

test("first-time setup creates an account, then sign out, wrong password and sign in", async ({ page, guard }) => {
  guard.allow(/status of 401/, /status of 422/);

  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();

  await page.getByLabel("Name (optional)").fill("Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Repeat password").fill("something else entirely");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("These passwords don't match.")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByLabel("Repeat password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Use at least 10 characters")).toBeVisible();

  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Repeat password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/localhost:3107\/$/);
  await expect(page.locator("aside").getByText("Owner", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start your journal" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  // Setup only ever shows on an empty installation.
  await expect(page.getByLabel("Repeat password")).toHaveCount(0);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("not the right password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Wrong email or password.")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/journal");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/localhost:3107\/$/);
  await expect(page.locator("aside").getByText("Owner", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.locator("aside").getByText("Owner", { exact: true })).toBeVisible();
});
