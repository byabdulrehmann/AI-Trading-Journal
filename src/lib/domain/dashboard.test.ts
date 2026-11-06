import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DashboardLayout, WIDGET_IDS, WIDGET_INFO, activeView, addWidget, defaultWidgets, deleteView, missingWidgets, moveWidget, removeWidget, renameView, resizeWidget, resolveLayout, saveAsView, setWidgets, type WidgetId, type WidgetRef } from "./dashboard";
import { Settings } from "./types";

const w = (...ids: WidgetId[]): WidgetRef[] => ids.map((id) => ({ id, span: 1 }));
const ids = (list: WidgetRef[]) => list.map((x) => x.id);

describe("widgets in a view", () => {
  test("move: to a new place, and nothing for itself, an unknown widget or out of range", () => {
    const list = w("tape", "score", "risk");
    assert.deepEqual(ids(moveWidget(list, "risk", 0)), ["risk", "tape", "score"]);
    assert.deepEqual(ids(moveWidget(list, "tape", 2)), ["score", "risk", "tape"]);
    assert.equal(moveWidget(list, "tape", 0), list);
    assert.equal(moveWidget(list, "hour", 0), list);
    assert.equal(moveWidget(list, "tape", 3), list);
    assert.equal(moveWidget(list, "tape", -1), list);
  });

  test("add takes the widget's own size, and never twice", () => {
    const added = addWidget(w("risk"), "calendar");
    assert.deepEqual(added.at(-1), { id: "calendar", span: WIDGET_INFO.calendar.span });
    assert.equal(addWidget(added, "calendar").length, 2);
  });

  test("remove and resize touch only that widget", () => {
    assert.deepEqual(ids(removeWidget(w("risk", "tape"), "risk")), ["tape"]);
    assert.deepEqual(resizeWidget(w("risk", "tape"), "tape", 3), [{ id: "risk", span: 1 }, { id: "tape", span: 3 }]);
  });

  test("what can still be added", () => {
    assert.equal(missingWidgets([]).length, WIDGET_IDS.length);
    assert.ok(!missingWidgets(w("tape")).includes("tape"));
  });

  test("every widget has a label and the default layout is valid", () => {
    for (const id of WIDGET_IDS) assert.ok(WIDGET_INFO[id].label);
    assert.equal(new Set(ids(defaultWidgets())).size, defaultWidgets().length);
    assert.ok(DashboardLayout.safeParse(resolveLayout(null)).success);
  });
});

describe("views", () => {
  const one = resolveLayout(null);

  test("nothing saved means the standard view, and a stale active id falls back", () => {
    assert.equal(activeView(one).name, "Overview");
    assert.equal(activeView(resolveLayout({ ...one, active: "gone" })).id, one.views[0].id);
  });

  test("save as copies the widgets and switches to the copy, leaving the first alone", () => {
    const edited = setWidgets(one, w("risk"));
    const two = saveAsView(edited, "  Risk ", "b")!;
    assert.equal(two.active, "b");
    assert.equal(activeView(two).name, "Risk");
    assert.deepEqual(ids(activeView(two).widgets), ["risk"]);
    const back = setWidgets(two, w("tape"));
    assert.deepEqual(ids(back.views[0].widgets), ["risk"]);
  });

  test("a blank or taken name is refused, whatever its case, and so is an eleventh view", () => {
    assert.equal(saveAsView(one, "   ", "b"), null);
    assert.equal(saveAsView(one, "overview", "b"), null);
    let many = one;
    for (let i = 0; i < 9; i++) many = saveAsView(many, `v${i}`, `id${i}`)!;
    assert.equal(many.views.length, 10);
    assert.equal(saveAsView(many, "one more", "x"), null);
  });

  test("rename refuses another view's name but allows its own", () => {
    const two = saveAsView(one, "Risk", "b")!;
    assert.equal(renameView(two, "OVERVIEW"), null);
    assert.equal(activeView(renameView(two, "RISK")!).name, "RISK");
  });

  test("delete moves to another view, and the last one stays", () => {
    const two = saveAsView(one, "Risk", "b")!;
    const left = deleteView(two);
    assert.equal(left.views.length, 1);
    assert.equal(left.active, one.views[0].id);
    assert.equal(deleteView(left), left);
  });
});

describe("in settings", () => {
  test("starts empty, and a saved layout survives parsing", () => {
    assert.equal(Settings.parse({}).dashboard, null);
    const saved = saveAsView(resolveLayout(null), "Risk", "b");
    assert.deepEqual(Settings.parse({ dashboard: saved }).dashboard, saved);
  });

  test("an unknown widget or size is refused", () => {
    const view = (widgets: unknown) => ({ dashboard: { active: "a", views: [{ id: "a", name: "A", widgets }] } });
    assert.equal(Settings.safeParse(view([{ id: "nope", span: 1 }])).success, false);
    assert.equal(Settings.safeParse(view([{ id: "tape", span: 9 }])).success, false);
  });
});
