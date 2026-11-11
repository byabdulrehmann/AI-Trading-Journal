import { expect, guarded as test, PASSWORD, uniqueEmail } from "./helpers";

const CODE = /^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/;
const NEW_PASSWORD = "a brand new passphrase";

test("a forgotten password is reset with the recovery code, which then stops working", async ({ page, browser, guard }) => {
  guard.allow(/status of 401/);
  const email = uniqueEmail("forgetful");
  const signup = await page.request.post("/api/auth/signup", { data: { email, password: PASSWORD, name: "Forgetful" } });
  expect(signup.status()).toBe(201);
  const { recoveryCode } = (await signup.json()) as { recoveryCode: string };
  expect(recoveryCode).toMatch(CODE);

  // A second device signed in before the reset.
  const other = await browser.newContext({ baseURL: "http://localhost:3107" });
  expect((await other.request.post("/api/auth/login", { data: { email, password: PASSWORD } })).status()).toBe(200);

  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);

  // Scoped to the reset form: during the client-side move from sign-in, both forms are briefly on the page.
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Set new password" }) });
  const fill = async (code: string) => {
    await form.getByLabel("Email").fill(email);
    await form.getByLabel("Recovery code").fill(code);
    await form.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await form.getByLabel("Repeat new password").fill(NEW_PASSWORD);
    await form.getByRole("button", { name: "Set new password" }).click();
  };
  await fill("AAAAA-BBBBB-CCCCC-DDDDD");
  await expect(page.getByText("That email and recovery code don't match.")).toBeVisible();

  // Lower case and no dashes still match: the code is compared on its letters and numbers.
  await fill(recoveryCode.toLowerCase().replaceAll("-", ""));
  await expect(page.getByRole("heading", { name: "Password changed" })).toBeVisible();
  const fresh = (await page.getByLabel("Recovery code").textContent())!.trim();
  expect(fresh).toMatch(CODE);
  expect(fresh).not.toBe(recoveryCode);
  await page.getByRole("button", { name: "I've saved it, continue" }).click();
  await expect(page).toHaveURL(/localhost:3107\/$/);

  // Every other device is signed out; the old password and the used code no longer work.
  expect(((await (await other.request.get("/api/auth/me")).json()) as { user: unknown }).user).toBeNull();
  await other.close();
  expect((await page.request.post("/api/auth/login", { data: { email, password: PASSWORD } })).status()).toBe(401);
  expect((await page.request.post("/api/auth/reset", { data: { email, code: recoveryCode, password: "yet another passphrase" } })).status()).toBe(401);
  expect((await page.request.post("/api/auth/login", { data: { email, password: NEW_PASSWORD } })).status()).toBe(200);

  // Settings makes a new code, but only with the current password, and the previous one stops working.
  await page.goto("/settings#recovery");
  const section = page.locator("#recovery");
  await section.getByLabel("Current password").fill("not my password");
  await section.getByRole("button", { name: "Make a new code" }).click();
  await expect(section.getByRole("alert")).toHaveText("That isn't your current password.");
  await section.getByLabel("Current password").fill(NEW_PASSWORD);
  await section.getByRole("button", { name: "Make a new code" }).click();
  const third = (await section.getByLabel("Recovery code").textContent())!.trim();
  expect(third).toMatch(CODE);
  expect((await page.request.post("/api/auth/reset", { data: { email, code: fresh, password: "yet another passphrase" } })).status()).toBe(401);
});

test("with an owner already here, the sign-up page stays open for someone else", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expect(page.getByText("Your own private journal")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
});
