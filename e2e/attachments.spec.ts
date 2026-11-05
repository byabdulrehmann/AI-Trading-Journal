import { dialog, expect, idOf, logTrade, open, row, test } from "./helpers";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==", "base64");

test("an attachment uploads, shows in the drawer and can be removed; a renamed non-image is refused", async ({ page, guard }) => {
  guard.allow(/status of 415/, /status of 404/);
  await open(page, "/journal");
  await logTrade(page, { symbol: "EURUSD", entry: "1.1", exit: "1.2", quantity: "1000" });
  const id = await idOf(row(page, "EURUSD"));

  const openForm = async () => {
    await page.getByRole("button", { name: `Edit trade #${id}` }).click();
    await expect(dialog(page).getByRole("heading", { name: `Edit trade #${id}` })).toBeVisible();
    return dialog(page);
  };
  const openDrawer = async () => {
    await row(page, "EURUSD").getByRole("button", { name: "EURUSD" }).click();
    await expect(dialog(page).getByRole("heading", { name: /EURUSD long/ })).toBeVisible();
    return dialog(page);
  };

  let form = await openForm();
  await form.getByRole("button", { name: /^Attachments/ }).click();
  await form.locator('input[type="file"]').setInputFiles({ name: "chart.png", mimeType: "image/png", buffer: PNG });
  await expect(form.getByText("not saved yet")).toBeVisible();
  await form.getByRole("button", { name: "Save trade" }).click();
  await expect(page.getByText("Trade updated.")).toBeVisible();

  let drawer = await openDrawer();
  const image = drawer.getByRole("img", { name: "chart: chart.png" });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  const src = (await image.getAttribute("src"))!;
  expect((await page.request.get(src)).headers()["content-type"]).toBe("image/png");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);

  form = await openForm();
  await expect(form.getByRole("link", { name: "chart.png" })).toBeVisible();
  await form.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(form.getByRole("link", { name: "chart.png" })).toHaveCount(0);
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog(page)).toHaveCount(0);

  drawer = await openDrawer();
  await expect(drawer.getByText("No files yet.")).toBeVisible();
  expect((await page.request.get(src)).status()).toBe(404);
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);

  // Text with an image's name and type: the bytes decide, and the trade itself still saves.
  form = await openForm();
  await form.getByRole("button", { name: /^Attachments/ }).click();
  await form.locator('input[type="file"]').setInputFiles({ name: "fake.png", mimeType: "image/png", buffer: Buffer.from("this is not an image at all") });
  await form.getByRole("button", { name: "Save trade" }).click();
  await expect(page.getByText("Trade updated.")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Not attached. fake.png: Only PNG, JPEG, WEBP and PDF files can be attached." })).toBeVisible();
  drawer = await openDrawer();
  await expect(drawer.getByText("No files yet.")).toBeVisible();
});
