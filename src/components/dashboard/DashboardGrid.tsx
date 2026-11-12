"use client";

import { useState } from "react";
import { useApp } from "@/lib/client/app-state";
import {
  WIDGET_INFO,
  activeView,
  addWidget,
  defaultWidgets,
  deleteView,
  missingWidgets,
  moveWidget,
  removeWidget,
  renameView,
  resizeWidget,
  resolveLayout,
  saveAsView,
  setWidgets,
  type DashboardLayout,
  type WidgetId,
  type WidgetRef,
} from "@/lib/domain/dashboard";
import { Button, cx, inputClass } from "@/components/ui";
import { Widget, type WidgetContext } from "./Widgets";

// Literal class names, so Tailwind sees them. Narrow screens stack, and a wide widget takes what there is.
const SPAN: Record<number, string> = { 1: "", 2: "sm:col-span-2", 3: "sm:col-span-2 xl:col-span-3", 4: "sm:col-span-2 xl:col-span-4" };
const SIZES = [[1, "Quarter"], [2, "Half"], [3, "Three quarters"], [4, "Full width"]] as const;
const control = "h-8 border border-line-strong bg-transparent px-2 text-[13px] text-ink max-sm:h-11 max-sm:text-[16px]";

function ViewEditor({ layout, save }: { layout: DashboardLayout; save: (next: DashboardLayout) => void }) {
  const { toast } = useApp();
  const view = activeView(layout);
  const [name, setName] = useState("");
  const missing = missingWidgets(view.widgets).filter((id) => !FIXED_WIDGETS.includes(id));

  const saveAs = () => {
    const next = saveAsView(layout, name, crypto.randomUUID());
    if (!next) return toast({ message: "Pick a name that isn't taken. You can keep up to 10 views.", tone: "error" });
    save(next);
    setName("");
  };

  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-3 border-t border-line py-3 text-[13px]" data-testid="view-editor">
      <label className="flex flex-col gap-1 text-ink-soft">
        Add a widget
        <select
          aria-label="Add a widget"
          className={control}
          value=""
          disabled={missing.length === 0}
          onChange={(e) => e.target.value && save(setWidgets(layout, addWidget(view.widgets, e.target.value as WidgetId)))}
        >
          <option value="">{missing.length ? "Choose" : "All are showing"}</option>
          {missing.map((id) => <option key={id} value={id}>{WIDGET_INFO[id].label}</option>)}
        </select>
      </label>
      <form
        className="flex flex-col gap-1 text-ink-soft"
        onSubmit={(e) => {
          e.preventDefault();
          saveAs();
        }}
      >
        <label htmlFor="new-view">Save as a new view</label>
        <span className="flex gap-2">
          <input id="new-view" className={cx(inputClass, "h-8 w-40! max-sm:h-11")} value={name} maxLength={30} placeholder="Name" onChange={(e) => setName(e.target.value)} />
          <Button size="sm" type="submit" className="max-sm:h-11" disabled={!name.trim()}>Save view</Button>
        </span>
      </form>
      <label className="flex flex-col gap-1 text-ink-soft">
        Rename this view
        <input
          key={view.id + view.name}
          aria-label="Rename this view"
          className={cx(inputClass, "h-8 w-40! max-sm:h-11")}
          defaultValue={view.name}
          maxLength={30}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={(e) => {
            if (e.target.value.trim() === view.name) return;
            const next = renameView(layout, e.target.value);
            if (next) save(next);
            else {
              e.target.value = view.name;
              toast({ message: "Pick a name that isn't taken.", tone: "error" });
            }
          }}
        />
      </label>
      <span className="flex gap-2">
        <Button size="sm" className="max-sm:h-11" onClick={() => save(setWidgets(layout, defaultWidgets()))}>Reset layout</Button>
        <Button size="sm" variant="danger" className="max-sm:h-11" disabled={layout.views.length < 2} title={layout.views.length < 2 ? "The dashboard always keeps one view" : undefined} onClick={() => confirm(`Delete the view "${view.name}"?`) && save(deleteView(layout))}>Delete view</Button>
      </span>
    </div>
  );
}

function WidgetTools({ widget, index, count, onMove, onResize, onRemove, onDragStart }: { widget: WidgetRef; index: number; count: number; onMove: (to: number) => void; onResize: (span: number) => void; onRemove: () => void; onDragStart: () => void }) {
  const label = WIDGET_INFO[widget.id].label;
  return (
    <div role="group" aria-label={`Arrange ${label}`} className="mb-1 flex flex-wrap items-center gap-1 rounded-control bg-accent-soft px-2 py-1 text-[12.5px]">
      <span draggable onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", widget.id);
        onDragStart();
      }} className="mr-auto cursor-grab truncate font-medium text-ink select-none" title="Drag to move" data-testid={`drag-${widget.id}`}>
        {label}
      </span>
      <Button size="sm" variant="ghost" className="max-sm:h-11" aria-label={`Move ${label} earlier`} disabled={index === 0} onClick={() => onMove(index - 1)}>Earlier</Button>
      <Button size="sm" variant="ghost" className="max-sm:h-11" aria-label={`Move ${label} later`} disabled={index === count - 1} onClick={() => onMove(index + 1)}>Later</Button>
      <select aria-label={`Size of ${label}`} className={cx(control, "max-sm:hidden")} value={widget.span} onChange={(e) => onResize(Number(e.target.value))}>
        {SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <Button size="sm" variant="ghost" className="max-sm:h-11" aria-label={`Remove ${label}`} onClick={onRemove}>Remove</Button>
    </div>
  );
}

/** Widgets the fixed dashboard layout above already shows. Kept in saved layouts, so old settings still parse, but never drawn twice. */
export const FIXED_WIDGETS: WidgetId[] = ["tape", "score", "dailyPnl", "calendar", "recent"];

/** The extra widgets under the fixed layout. The gear in the dashboard's status row opens the editor. */
export function DashboardGrid({ ctx, editing }: { ctx: WidgetContext; editing: boolean }) {
  const { settings, saveSettings } = useApp();
  const [dragging, setDragging] = useState<WidgetId | null>(null);
  const layout = resolveLayout(settings?.dashboard);
  const view = activeView(layout);
  const save = (next: DashboardLayout) => void saveSettings({ dashboard: next });
  const shown = view.widgets.filter((w) => !FIXED_WIDGETS.includes(w.id));
  const change = (widgets: WidgetRef[]) => save(setWidgets(layout, [...view.widgets.filter((w) => FIXED_WIDGETS.includes(w.id)), ...widgets]));

  return (
    <div>
      {editing && (
        <div className="mb-3 rounded-panel border border-line bg-glass px-card pt-3 shadow-card" data-testid="widget-editor">
          <p className="text-[14px] font-semibold text-ink">Dashboard widgets</p>
          <p className="mb-2 text-[13px] text-muted">The cards above are fixed. Add, remove, reorder and resize the widgets below them, and save arrangements as views.</p>
          <label className="mb-2 flex items-center gap-2 text-[13px] text-muted">
            View
            <select aria-label="Dashboard view" className={control} value={layout.active} onChange={(e) => save({ ...layout, active: e.target.value })}>
              {layout.views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          <ViewEditor layout={layout} save={save} />
        </div>
      )}
      {shown.length === 0 && editing && <p className="py-4 text-[14px] text-ink-soft">No extra widgets in this view. Add one above.</p>}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-[21px] sm:grid-cols-2 xl:grid-cols-4">
        {shown.map((w, i) => (
          <div
            key={w.id}
            data-widget={w.id}
            className={cx("min-w-0", SPAN[w.span], dragging === w.id && "opacity-50")}
            onDragOver={editing ? (e) => e.preventDefault() : undefined}
            onDrop={
              editing
                ? (e) => {
                    e.preventDefault();
                    // moveWidget ignores anything that isn't a widget in this view, such as text dragged in from elsewhere.
                    change(moveWidget(shown, e.dataTransfer.getData("text/plain") as WidgetId, i));
                    setDragging(null);
                  }
                : undefined
            }
            onDragEnd={() => setDragging(null)}
          >
            {editing && (
              <WidgetTools
                widget={w}
                index={i}
                count={shown.length}
                onMove={(to) => change(moveWidget(shown, w.id, to))}
                onResize={(span) => change(resizeWidget(shown, w.id, span))}
                onRemove={() => change(removeWidget(shown, w.id))}
                onDragStart={() => setDragging(w.id)}
              />
            )}
            <Widget id={w.id} ctx={ctx} />
          </div>
        ))}
      </div>
    </div>
  );
}
