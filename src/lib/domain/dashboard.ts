import { z } from "zod";

/** The dashboard's layout as data. Pure, so every edit is one tested function and the page only draws the result. */
export const WIDGET_IDS = ["tape", "score", "dailyPnl", "result", "quality", "risk", "activity", "days", "calendar", "drawdown", "distribution", "recent", "worth", "strategy", "symbol", "mistakes", "tags", "weekday", "hour"] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];

export const WIDGET_INFO: Record<WidgetId, { label: string; span: number }> = {
  tape: { label: "Equity tape", span: 4 },
  score: { label: "Score", span: 2 },
  dailyPnl: { label: "Daily P&L", span: 2 },
  result: { label: "Result", span: 1 },
  quality: { label: "Quality", span: 1 },
  risk: { label: "Risk", span: 1 },
  activity: { label: "Activity", span: 1 },
  days: { label: "Your days", span: 1 },
  calendar: { label: "Calendar", span: 2 },
  drawdown: { label: "Drawdown", span: 2 },
  distribution: { label: "Win and loss distribution", span: 2 },
  recent: { label: "Recent trades", span: 3 },
  worth: { label: "Worth a look", span: 1 },
  strategy: { label: "Strategies", span: 2 },
  symbol: { label: "Instruments", span: 2 },
  mistakes: { label: "Mistakes", span: 2 },
  tags: { label: "Tags", span: 2 },
  weekday: { label: "Day of week", span: 2 },
  hour: { label: "Time of day", span: 2 },
};

const Widget = z.object({ id: z.enum(WIDGET_IDS), span: z.number().int().min(1).max(4) });
const View = z.object({ id: z.string().min(1).max(40), name: z.string().trim().min(1).max(30), widgets: z.array(Widget).max(WIDGET_IDS.length) });
export const DashboardLayout = z.object({ active: z.string().max(40), views: z.array(View).min(1).max(10) });

export type WidgetRef = z.infer<typeof Widget>;
export type DashboardView = z.infer<typeof View>;
export type DashboardLayout = z.infer<typeof DashboardLayout>;

const ref = (id: WidgetId): WidgetRef => ({ id, span: WIDGET_INFO[id].span });
const DEFAULT_WIDGETS: WidgetId[] = ["tape", "score", "dailyPnl", "result", "quality", "risk", "activity", "calendar", "strategy", "recent", "worth"];
export const defaultWidgets = (): WidgetRef[] => DEFAULT_WIDGETS.map(ref);

export function resolveLayout(saved: DashboardLayout | null | undefined): DashboardLayout {
  if (!saved) return { active: "overview", views: [{ id: "overview", name: "Overview", widgets: defaultWidgets() }] };
  return saved.views.some((v) => v.id === saved.active) ? saved : { ...saved, active: saved.views[0].id };
}

export const activeView = (layout: DashboardLayout): DashboardView => layout.views.find((v) => v.id === layout.active) ?? layout.views[0];

export const missingWidgets = (widgets: WidgetRef[]): WidgetId[] => WIDGET_IDS.filter((id) => !widgets.some((w) => w.id === id));

export const addWidget = (widgets: WidgetRef[], id: WidgetId): WidgetRef[] => (widgets.some((w) => w.id === id) ? widgets : [...widgets, ref(id)]);

export const removeWidget = (widgets: WidgetRef[], id: WidgetId): WidgetRef[] => widgets.filter((w) => w.id !== id);

export const resizeWidget = (widgets: WidgetRef[], id: WidgetId, span: number): WidgetRef[] => widgets.map((w) => (w.id === id ? { ...w, span } : w));

/** Puts a widget at another's place. Dropping on itself, or naming one that isn't there, changes nothing. */
export function moveWidget(widgets: WidgetRef[], id: WidgetId, toIndex: number): WidgetRef[] {
  const from = widgets.findIndex((w) => w.id === id);
  if (from === -1 || toIndex < 0 || toIndex >= widgets.length || from === toIndex) return widgets;
  const next = [...widgets];
  const [moved] = next.splice(from, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export const setWidgets = (layout: DashboardLayout, widgets: WidgetRef[]): DashboardLayout => ({
  ...layout,
  views: layout.views.map((v) => (v.id === layout.active ? { ...v, widgets } : v)),
});

export const MAX_VIEWS = 10;

/** A copy of the current view under a new name, which becomes the active one. Null at the limit, or for a blank or taken name. */
export function saveAsView(layout: DashboardLayout, name: string, id: string): DashboardLayout | null {
  const clean = name.trim();
  if (!clean || layout.views.length >= MAX_VIEWS || layout.views.some((v) => v.name.toLowerCase() === clean.toLowerCase())) return null;
  return { active: id, views: [...layout.views, { id, name: clean, widgets: activeView(layout).widgets }] };
}

export function renameView(layout: DashboardLayout, name: string): DashboardLayout | null {
  const clean = name.trim();
  if (!clean || layout.views.some((v) => v.id !== layout.active && v.name.toLowerCase() === clean.toLowerCase())) return null;
  return { ...layout, views: layout.views.map((v) => (v.id === layout.active ? { ...v, name: clean } : v)) };
}

/** The last view stays, so the dashboard always has one. */
export function deleteView(layout: DashboardLayout): DashboardLayout {
  if (layout.views.length < 2) return layout;
  const views = layout.views.filter((v) => v.id !== layout.active);
  return { active: views[0].id, views };
}
