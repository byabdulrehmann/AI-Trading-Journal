import { test as base, expect, type Locator, type Page } from "@playwright/test";

export { expect };

let userCounter = 0;
export const PASSWORD = "correct horse battery";
export const uniqueEmail = (who = "user") => `${who}-${Date.now()}-${++userCounter}@example.test`;
/** The account first-run.spec.ts creates through the setup screen. */
export const OWNER_EMAIL = "owner@example.test";

/** Another user through the signup API. Signups are capped at a few per 15 minutes, so only tests about a second user make one. */
export async function signUp(page: Page, name = "Tester") {
  const email = uniqueEmail();
  const res = await page.request.post("/api/auth/signup", { data: { email, password: PASSWORD, name } });
  expect(res.status()).toBe(201);
  return { email, password: PASSWORD, name };
}

type Guard = {
  /** Console errors matching these are expected, such as the status of a deliberate failure. */
  allow: (...patterns: RegExp[]) => void;
  /** Holds another page to the same rule. */
  watch: (page: Page) => void;
};

/** Every test fails on a page error or a console error it didn't declare. */
export const guarded = base.extend<{ guard: Guard }>({
  guard: [
    async ({ page }, provide) => {
      const allowed: RegExp[] = [];
      const problems: string[] = [];
      const watch = (p: Page) => {
        p.on("console", (m) => {
          if (m.type() === "error" && !allowed.some((re) => re.test(m.text()))) problems.push(`console: ${m.text()} at ${m.location().url}`);
        });
        p.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
      };
      watch(page);
      await provide({ allow: (...patterns) => allowed.push(...patterns), watch });
      expect(problems, "console and page errors").toEqual([]);
    },
    { auto: true },
  ],
});

/** Every test starts signed in as the owner with an empty journal and one account, so tests never see each other's trades. */
export const test = guarded.extend<{ owner: void }>({
  owner: [
    async ({ page }, provide) => {
      expect((await page.request.post("/api/auth/login", { data: { email: OWNER_EMAIL, password: PASSWORD } })).status()).toBe(200);
      expect((await page.request.delete("/api/data", { data: { confirm: "DELETE" } })).status()).toBe(200);
      expect((await page.request.post("/api/accounts", { data: { name: "Main account", currency: "USD" } })).ok()).toBe(true);
      await provide();
    },
    { auto: true },
  ],
});

/** Goes to a page and waits until the shared account data has arrived, so the first click lands on a live screen. */
export async function open(page: Page, url: string) {
  const shared = page.waitForResponse((r) => r.url().endsWith("/api/settings"));
  await page.goto(url);
  await shared;
  await expect(page.locator("aside p[title]")).toBeAttached();
}

/** The dollar text the app shows, written out here so a change in its formatter fails a test. */
export const usd = (n: number, signed = true) => `${n < 0 ? "−" : signed && n > 0 ? "+" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const r = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}R`;

export const dialog = (page: Page) => page.locator("dialog[open]");
export const rows = (page: Page) => page.locator('tbody tr[id^="trade-row-"]');
export const row = (page: Page, text: string) => rows(page).filter({ hasText: text });
export const range = (page: Page) => page.getByText(/^[\d,]+ to [\d,]+ of [\d,]+$/);
export const idOf = async (l: Locator) => Number((await l.getAttribute("id"))!.replace("trade-row-", ""));

/** The value beside a label in a ledger or fact list. */
export const figure = (scope: Page | Locator, label: string) =>
  scope.locator("dt").filter({ hasText: new RegExp(`^${label.replace(/[&()?]/g, "\\$&")}(?![:\\w])`) }).first().locator("xpath=following-sibling::dd[1]");

export const field = (scope: Locator, label: string) => scope.getByLabel(label, { exact: true });

export interface TradeFields {
  symbol: string;
  side?: "long" | "short";
  opened?: string;
  closed?: string;
  entry?: string;
  exit?: string;
  quantity?: string;
  multiplier?: string;
  stop?: string;
  target?: string;
  commission?: string;
}

export async function fillBasics(form: Locator, t: TradeFields) {
  await field(form, "Instrument").fill(t.symbol);
  if (t.side === "short") await form.getByRole("radio", { name: "Short" }).click();
  if (t.opened) await field(form, "Entry date and time").fill(t.opened);
  if (t.closed) await field(form, "Exit date and time").fill(t.closed);
  const values: [string, string | undefined][] = [["Entry", t.entry], ["Exit", t.exit], ["Quantity", t.quantity], ["Stop", t.stop], ["Target", t.target], ["Contract multiplier", t.multiplier], ["Commission", t.commission]];
  for (const [label, v] of values) if (v !== undefined) await field(form, label).fill(v);
}

/** Logs a trade through the form and waits for the confirmation. */
export async function logTrade(page: Page, t: TradeFields) {
  await page.getByRole("button", { name: "Log trade" }).first().click();
  const form = dialog(page);
  await fillBasics(form, t);
  await form.getByRole("button", { name: "Save trade" }).click();
  await expect(page.getByText(`Logged ${t.symbol}.`)).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
}

export const csvFile = (name: string, text: string) => ({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
export const CSV_HEAD = "symbol,side,open time,close time,entry,exit,qty,stop,target,commission";

/** Brings trades in through the Import dialog, the way a user fills a journal in bulk. */
export async function importCsv(page: Page, lines: string[], name = "trades.csv") {
  await open(page, "/journal?import=1");
  const box = dialog(page);
  await box.getByLabel("File (drop it here or browse)").setInputFiles(csvFile(name, [CSV_HEAD, ...lines].join("\n")));
  await box.getByRole("button", { name: `Import ${lines.length} trades` }).click();
  await expect(figure(box, "Imported")).toHaveText(String(lines.length));
  await box.getByRole("button", { name: "Done" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/import=1/);
}

/** The sample journal, loaded with the button a new user sees. */
export async function loadSample(page: Page) {
  await open(page, "/");
  await page.getByRole("button", { name: "Load sample journal" }).click();
  await expect(page).toHaveURL(/includeSample=1/);
  await expect(page.getByRole("slider", { name: /Closed trades in order/ })).toBeVisible();
}
