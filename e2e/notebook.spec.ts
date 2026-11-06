import { readFileSync } from "node:fs";
import { dialog, expect, importCsv, loadSample, open, row, test } from "./helpers";

const body = (page: import("@playwright/test").Page) => page.getByLabel("Note body");
const status = (page: import("@playwright/test").Page) => page.getByTestId("note-status");

test("write a note: it saves itself, previews safely and stays after a reload", async ({ page }) => {
  await open(page, "/notebook");
  await expect(page.getByText("No notes yet.")).toBeVisible();
  await page.getByRole("button", { name: "New note" }).click();
  await expect(page).toHaveURL(/note=\d+/);

  await page.getByLabel("Title").fill("Morning thoughts");
  await body(page).fill("## Plan\n\n**Only** the open.\n\n- first\n- second\n\n- [x] done\n- [ ] not yet\n\n1. one\n2. two\n\n<img src=x onerror=alert(1)>");
  await expect(status(page)).toHaveText("Saved");

  await page.getByRole("radio", { name: "Preview" }).click();
  const preview = page.getByTestId("note-preview");
  await expect(preview.getByRole("heading", { name: "Plan" })).toBeVisible();
  await expect(preview.locator("strong")).toHaveText("Only");
  await expect(preview.getByRole("img", { name: "Done", exact: true })).toHaveCount(1);
  await expect(preview.getByRole("img", { name: "Not done", exact: true })).toHaveCount(1);
  await expect(preview.locator("ol li")).toHaveCount(2);
  // Text stays text: no element comes from what was typed.
  await expect(preview.locator("img")).toHaveCount(0);
  await expect(preview).toContainText("<img src=x onerror=alert(1)>");

  await page.reload();
  await expect(page.getByLabel("Title")).toHaveValue("Morning thoughts");
  await expect(body(page)).toHaveValue(/Only/);
  await expect(page.getByTestId("note-list")).toContainText("Morning thoughts");
});

test("leaving a note straight after typing doesn't lose it", async ({ page }) => {
  const first = (await (await page.request.post("/api/notes", { data: { title: "First" } })).json()).note;
  await page.request.post("/api/notes", { data: { title: "Second" } });
  await open(page, `/notebook?note=${first.id}`);
  await body(page).fill("typed just before leaving");
  await page.getByTestId("note-list").getByRole("link", { name: /Second/ }).click();
  await expect(page.getByLabel("Title")).toHaveValue("Second");
  await expect.poll(async () => (await (await page.request.get(`/api/notes/${first.id}`)).json()).note.body).toBe("typed just before leaving");
});

test("formatting buttons insert at the cursor", async ({ page }) => {
  const n = (await (await page.request.post("/api/notes", { data: { title: "Tools", body: "hello" } })).json()).note;
  await open(page, `/notebook?note=${n.id}`);
  await body(page).evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 5));
  await page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Bold" }).click();
  await expect(body(page)).toHaveValue("**hello**");
});

test("folders: create, file a note, rename, delete keeps the note", async ({ page, guard }) => {
  guard.allow(/status of 422/); // The duplicate name.
  const n = (await (await page.request.post("/api/notes", { data: { title: "To file" } })).json()).note;
  await open(page, `/notebook?note=${n.id}`);
  await page.getByLabel("New folder").fill("Reviews");
  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  const folders = page.getByTestId("folders");
  await expect(folders).toContainText("Reviews");

  await page.getByLabel("New folder").fill("Reviews");
  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  await expect(page.getByText("You already have a folder with that name.")).toBeVisible();
  await page.getByLabel("New folder").fill("");

  await page.getByLabel("Folder", { exact: true }).selectOption({ label: "Reviews" });
  await expect(status(page)).toHaveText("Saved");
  await folders.getByRole("link", { name: /Reviews/ }).click({ position: { x: 10, y: 10 } });
  await expect(page).toHaveURL(/folder=\d+/);
  await expect(page.getByTestId("note-list")).toContainText("To file");

  await folders.getByRole("button", { name: "Rename Reviews" }).click();
  const box = page.getByLabel("New name for Reviews");
  await box.fill("Weekly");
  await box.press("Enter");
  await expect(folders).toContainText("Weekly");

  page.once("dialog", (d) => d.accept());
  await folders.getByRole("button", { name: "Delete Weekly" }).click();
  await expect(folders).not.toContainText("Weekly");
  await expect(page.getByTestId("note-list")).toContainText("To file");
});

test("tags and search narrow the list", async ({ page }) => {
  await page.request.post("/api/notes", { data: { title: "Alpha", tags: ["plan"] } });
  await page.request.post("/api/notes", { data: { title: "Beta", body: "needle here" } });
  await open(page, "/notebook");
  const list = page.getByTestId("note-list").locator("li");
  await expect(list).toHaveCount(2);
  await page.getByTestId("note-tags").getByRole("link", { name: "plan" }).click();
  await expect(list).toHaveCount(1);
  await expect(list).toContainText("Alpha");
  await page.getByTestId("note-tags").getByRole("link", { name: "plan" }).click();
  await page.getByLabel("Search notes").fill("needle");
  await expect(list).toHaveCount(1);
  await expect(list).toContainText("Beta");
  await page.getByLabel("Search notes").fill("nothing like this");
  await expect(page.getByText("No notes match.")).toBeVisible();
});

test("templates: start from one, save your own, delete it", async ({ page }) => {
  await open(page, "/notebook");
  await page.getByLabel("New note from a template").selectOption({ label: "Loss recap" });
  await expect(page.getByLabel("Title")).toHaveValue("Loss recap");
  await expect(body(page)).toHaveValue(/What happened/);

  await body(page).fill("## My own layout");
  await page.getByLabel("Save as a template").fill("Mine");
  await page.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByText('Template "Mine" saved.')).toBeVisible();

  await page.getByLabel("New note from a template").selectOption({ label: "Mine" });
  await expect(page.getByLabel("Title")).toHaveValue("Mine");
  await expect(body(page)).toHaveValue("## My own layout");

  await page.getByRole("button", { name: "Delete template Mine" }).click();
  await expect(page.getByLabel("New note from a template").locator("option", { hasText: "Mine" })).toHaveCount(0);
});

test("delete with undo", async ({ page }) => {
  const n = (await (await page.request.post("/api/notes", { data: { title: "Oops" } })).json()).note;
  await open(page, `/notebook?note=${n.id}`);
  await page.getByRole("button", { name: "Delete note" }).click();
  await expect(page.getByText("Note deleted.")).toBeVisible();
  await expect(page.getByText("No notes yet.")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("note-list")).toContainText("Oops");
});

test("a missing note says so", async ({ page, guard }) => {
  guard.allow(/status of 404/);
  await open(page, "/notebook?note=999999");
  await expect(page.getByRole("heading", { name: "That note isn't here" })).toBeVisible();
});

test("links: from a note to a trade and a day, and back from both", async ({ page }) => {
  await importCsv(page, ["EURUSD,buy,2026-10-14 09:00,2026-10-14 10:00,1.1,1.11,1000,,,0"]);
  const t = (await (await page.request.get("/api/trades")).json()).trades[0];
  const n = (await (await page.request.post("/api/notes", { data: { title: "Linked up" } })).json()).note;
  await open(page, `/notebook?note=${n.id}`);

  const links = page.getByTestId("note-links");
  await links.getByLabel("Find a trade to link").fill("EURUSD");
  await links.getByTestId("trade-results").getByRole("button", { name: new RegExp(`EURUSD, #${t.id}`) }).click();
  await expect(links.getByRole("button", { name: `EURUSD, #${t.id}`, exact: true })).toBeVisible();
  await links.getByLabel("Link a day").fill("2026-10-14");
  await links.getByRole("button", { name: "Add" }).click();
  await expect(links.getByRole("link", { name: "2026-10-14" })).toBeVisible();

  // Back from the trade's panel.
  await open(page, "/journal");
  await row(page, "EURUSD").getByRole("button", { name: "EURUSD" }).click();
  const fromTrade = dialog(page).getByTestId("linked-notes");
  await expect(fromTrade).toContainText("Linked up");

  // Back from the day.
  await open(page, "/day?date=2026-10-14");
  await expect(page.getByTestId("linked-notes")).toContainText("Linked up");
  await page.getByTestId("linked-notes").getByRole("link", { name: /Linked up/ }).click();
  await expect(page).toHaveURL(new RegExp(`note=${n.id}`));

  await page.getByTestId("note-links").getByRole("button", { name: "Remove link to 2026-10-14" }).click();
  await expect(page.getByTestId("note-links").getByRole("link", { name: "2026-10-14" })).toHaveCount(0);
});

test("write a note from a trade: it starts linked", async ({ page }) => {
  await importCsv(page, ["GBPUSD,buy,2026-10-14 09:00,2026-10-14 10:00,1.3,1.31,1000,,,0"]);
  await open(page, "/journal");
  await row(page, "GBPUSD").getByRole("button", { name: "GBPUSD" }).click();
  await dialog(page).getByTestId("linked-notes").getByRole("button", { name: "Write a note" }).click();
  await expect(page).toHaveURL(/\/notebook\?note=\d+/);
  await expect(page.getByLabel("Title")).toHaveValue(/GBPUSD, trade #\d+/);
  await expect(page.getByTestId("note-links").getByRole("button", { name: /^GBPUSD, #\d+$/ })).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
});

test("a trade reference in a note opens the trade", async ({ page }) => {
  await importCsv(page, ["EURUSD,buy,2026-10-14 09:00,2026-10-14 10:00,1.1,1.11,1000,,,0"]);
  const t = (await (await page.request.get("/api/trades")).json()).trades[0];
  const n = (await (await page.request.post("/api/notes", { data: { title: "Ref", body: `See [#${t.id}] for this.` } })).json()).note;
  await open(page, `/notebook?note=${n.id}`);
  await page.getByRole("radio", { name: "Preview" }).click();
  await page.getByTestId("note-preview").getByRole("button", { name: `#${t.id}` }).click();
  await expect(dialog(page).getByRole("heading", { name: new RegExp(`trade #${t.id}`) })).toBeVisible();
});

test("download holds the note", async ({ page }) => {
  const n = (await (await page.request.post("/api/notes", { data: { title: "Keep this", body: "worth keeping" } })).json()).note;
  await open(page, `/notebook?note=${n.id}`);
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Keep this.md");
  expect(readFileSync(await file.path(), "utf8")).toBe("# Keep this\n\nworth keeping\n");
});

test("sample notes show with sample data, labelled, and leave with it", async ({ page }) => {
  await loadSample(page);
  await open(page, "/notebook?includeSample=1");
  await expect(page.getByTestId("folders")).toContainText("Sample notes");
  await expect(page.getByTestId("note-list").getByText("Sample", { exact: true }).first()).toBeVisible();
  expect((await (await page.request.get("/api/notes")).json()).notes).toEqual([]);
  await page.request.delete("/api/data/sample");
  expect((await (await page.request.get("/api/notes?includeSample=1")).json()).notes).toEqual([]);
});
