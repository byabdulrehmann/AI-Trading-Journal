import { dialog, expect, field, fillBasics, open, test } from "./helpers";

test("the price ladder: dragging and arrow keys change the fields", async ({ page }) => {
  await open(page, "/journal");
  await page.getByRole("button", { name: "Add trade" }).first().click();
  const form = dialog(page);
  await fillBasics(form, { symbol: "EURUSD", entry: "1.0850", stop: "1.0800", target: "1.0950", quantity: "1", multiplier: "100000" });

  const ladder = page.getByTestId("price-ladder");
  const stop = ladder.locator('[data-marker="stop"]');
  const target = ladder.locator('[data-marker="target"]');
  // Reward 0.0100 over risk 0.0050.
  await expect(ladder.getByTestId("ladder-rr")).toHaveText("1:2");
  await expect(stop).toHaveAttribute("aria-valuenow", "1.08");

  // Arrow keys step by the entry's last typed digit.
  await stop.focus();
  await page.keyboard.press("ArrowUp");
  await expect(field(form, "Stop")).toHaveValue("1.0801");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(field(form, "Stop")).toHaveValue("1.0799");
  await page.keyboard.press("Shift+ArrowUp");
  await expect(field(form, "Stop")).toHaveValue("1.0809");
  await page.keyboard.press("PageDown");
  await expect(field(form, "Stop")).toHaveValue("1.0799");
  await page.keyboard.press("ArrowUp");
  await expect(field(form, "Stop")).toHaveValue("1.0800");

  await target.focus();
  await page.keyboard.press("ArrowUp");
  await expect(field(form, "Target")).toHaveValue("1.0951");
  await page.keyboard.press("ArrowDown");
  await expect(field(form, "Target")).toHaveValue("1.0950");

  // Dragging up moves the stop toward entry, so the same reward now pays more for less risk.
  await stop.scrollIntoViewIfNeeded();
  const box = (await stop.locator("rect").first().boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 20, { steps: 4 });
  await page.mouse.move(x, y - 40, { steps: 4 });
  await page.mouse.up();

  const moved = Number(await field(form, "Stop").inputValue());
  expect(moved).toBeGreaterThan(1.08);
  expect(moved).toBeLessThan(1.085);
  await expect(field(form, "Stop")).toHaveValue(/^1\.08\d{2}$/);
  await expect(stop).toHaveAttribute("aria-valuenow", String(moved));
  const planned = Math.round(((1.095 - 1.085) / (1.085 - moved)) * 100) / 100;
  await expect(ladder.getByTestId("ladder-rr")).toHaveText(`1:${planned}`);

  // An exit typed into the form appears as a marker that moves too, and the ladder's net follows.
  await field(form, "Exit").fill("1.0900");
  await expect(ladder.getByTestId("ladder-net")).toHaveText("+$500.00");
  const exit = ladder.locator('[data-marker="exit"]');
  await exit.focus();
  await page.keyboard.press("ArrowUp");
  await expect(field(form, "Exit")).toHaveValue("1.0901");
  await expect(ladder.getByTestId("ladder-net")).toHaveText("+$510.00");

  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog(page)).toHaveCount(0);
});
