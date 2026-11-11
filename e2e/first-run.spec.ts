import { expect, guarded as test, OWNER_EMAIL as email, PASSWORD } from "./helpers";

test("first-time setup creates an account, then sign out, wrong password and sign in", async ({ page, guard }) => {
  guard.allow(/status of 401/, /status of 422/);

  await page.goto("/");
  // An empty installation has nobody to sign in as, so sign-in sends you on to create the first account.
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();

  await page.getByLabel("Name (optional)").fill("Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Repeat password").fill("something else entirely");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("These passwords don't match.")).toBeVisible();
  await expect(page).toHaveURL(/\/signup$/);

  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByLabel("Repeat password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Use at least 10 characters")).toBeVisible();

  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Repeat password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  // The recovery code shows once, before the journal opens.
  await expect(page.getByLabel("Recovery code")).toHaveText(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
  await page.getByRole("button", { name: "I've saved it, continue" }).click();
  await expect(page).toHaveURL(/localhost:3107\/$/);
  await expect(page.locator("aside").getByText("Owner", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start your journal" })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create an account" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Forgot your password?" })).toBeVisible();

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
