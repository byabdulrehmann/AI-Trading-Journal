import { expect, open, test } from "./helpers";

test("with the in-browser model, the server sends the instructions instead of a reply, and saves the reply the browser writes", async ({ page, guard }) => {
  guard.allow(/status of 4\d\d/);
  await page.goto("/jarvis");
  expect((await page.request.post("/api/jarvis/providers", { data: { provider: "browser", model: null } })).ok()).toBe(true);
  try {
    const res = await page.request.post("/api/jarvis/chat", { data: { message: "How did my week go?" } });
    const events = Object.fromEntries(
      (await res.text()).split("\n\n").filter(Boolean).map((f) => [/^event: (.+)$/m.exec(f)![1], JSON.parse(/^data: (.+)$/m.exec(f)![1])]),
    );
    expect(events.meta).toMatchObject({ provider: "browser", model: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", external: false });
    expect(events.delta).toBeUndefined();
    expect(events.prompt.system).toContain("<trader_record>");
    expect(events.prompt.messages.at(-1)).toEqual({ role: "user", content: "How did my week go?" });

    const id = events.meta.conversationId;
    const save = (data: object) => page.request.post(`/api/jarvis/conversations/${id}`, { data });
    expect((await save({ content: "Recorded: a quiet week.", model: "not-a-model" })).ok()).toBe(false);
    expect((await save({ content: "Recorded: a quiet week.", model: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC" })).ok()).toBe(true);
    expect((await page.request.post("/api/jarvis/conversations/999999", { data: { content: "x", model: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC" } })).status()).toBe(404);
    const { messages } = await (await page.request.get(`/api/jarvis/conversations/${id}`)).json();
    expect(messages.map((m: { role: string; content: string; provider: string | null }) => [m.role, m.content, m.provider])).toEqual([
      ["user", "How did my week go?", null],
      ["assistant", "Recorded: a quiet week.", "browser"],
    ]);
  } finally {
    await page.request.post("/api/jarvis/providers", { data: { provider: "demo", model: null } });
  }
});

test("free AI keys: each provider has its own form, a malformed key is refused before the provider is asked, and keys never come back", async ({ page, guard }) => {
  guard.allow(/status of 4\d\d/);
  await open(page, "/settings#free-ai-keys");
  const section = page.getByTestId("free-ai-keys");
  await expect(section.getByText("Google Gemini: no key")).toBeVisible();
  await expect(section.getByText("Groq: no key")).toBeVisible();
  await expect(section.getByText(/Google may use what Jarvis sends/)).toBeVisible();
  await section.getByLabel("Your Groq key").fill("not a key!");
  await section.getByRole("button", { name: "Save key" }).nth(1).click();
  await expect(section.getByRole("alert")).toHaveText("That doesn't look like an API key.");
  expect((await page.request.put("/api/jarvis/key", { data: { provider: "anthropic", key: "gsk_" + "a".repeat(30) } })).status()).toBe(422);
  expect((await page.request.delete("/api/jarvis/key?provider=nope")).status()).toBe(400);
  expect(await (await page.request.get("/api/jarvis/key")).json()).toMatchObject({ free: { gemini: false, groq: false } });
  // Without a key the provider can't be chosen, and says where to add one.
  const res = await (await page.request.post("/api/jarvis/providers", { data: { provider: "groq", model: null } })).json();
  expect(res.message ?? res.error).toMatch(/Free AI keys/);
});
