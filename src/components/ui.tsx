"use client";

import { forwardRef, useEffect, useId, useRef, useState } from "react";
import type { MetricDefinition } from "@/lib/domain/metrics";

export function cx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-accent text-accent-ink hover:bg-accent/90",
        variant === "secondary" && "border border-line bg-surface text-ink hover:bg-raised",
        variant === "ghost" && "text-ink-soft hover:bg-raised hover:text-ink",
        variant === "danger" && "border border-loss/50 text-loss hover:bg-loss-soft",
        className,
      )}
      {...props}
    />
  );
});

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cx("rounded-panel border border-line bg-surface px-card pb-card shadow-card", className)} {...rest}>
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0 whitespace-nowrap">{action}</div>}
    </div>
  );
}

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "accent" | "profit" | "loss" | "info" | "warn"; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-control px-1.5 py-px text-[12px] font-medium whitespace-nowrap",
        tone === "neutral" && "text-ink-soft ring-1 ring-line-strong",
        tone === "accent" && "bg-accent-soft text-accent",
        tone === "profit" && "bg-profit-soft text-profit",
        tone === "loss" && "bg-loss-soft text-loss",
        tone === "info" && "bg-info-soft text-info",
        tone === "warn" && "bg-warn-soft text-warn",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[26px] leading-[1.1] font-medium text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[14px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex max-w-full min-w-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** One line of a ledger: label, value, and its formula one click away. Goes inside a <dl>. */
export function Metric({ def, value, tone, note }: { def: MetricDefinition; value: React.ReactNode; tone?: string; note?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="border-b border-line py-2 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="flex min-w-0 items-center gap-1.5 text-[13.5px] text-ink-soft">
          {def.label}
          <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="px-1 text-[12px] text-muted hover:bg-raised hover:text-ink" title="How this is calculated">
            ƒ<span className="sr-only"> formula for {def.label}</span>
          </button>
        </dt>
        <dd className={cx("num text-right text-[14px] whitespace-nowrap", tone ?? "text-ink")}>{value}</dd>
      </div>
      {note && <p className="mt-0.5 text-[12px] text-muted">{note}</p>}
      {open && (
        <div id={id} className="mt-1.5 text-[12.5px] text-ink-soft">
          <code className="num block text-[12px] text-ink-soft">{def.formula}</code>
          <p className="mt-0.5">{def.meaning}</p>
        </div>
      )}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-panel border border-line bg-surface px-card py-8 shadow-card">
      <h3 className="text-[20px] font-medium text-ink">{title}</h3>
      <div className="mt-1 max-w-xl text-[14px] text-ink-soft">{body}</div>
      {action && <div className="mt-4 flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

/** Shown wherever simulated data appears. Not dismissible on purpose. */
export function DemoBanner({ children }: { children: React.ReactNode }) {
  return (
    <div role="note" className="mb-5 flex items-start gap-3 border-l-2 border-info bg-info-soft px-4 py-3 text-[13.5px] text-ink">
      <Badge tone="info">Simulated</Badge>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Field({
  label,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: (props: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className={cx("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={id} className="text-[13px] text-ink-soft">
        {label}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": error || hint ? msgId : undefined })}
      {(error || hint) && (
        <p id={msgId} className={cx("text-[12.5px]", error ? "text-loss" : "text-muted")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  "h-9 w-full min-w-0 rounded-control border border-line-strong bg-surface px-2.5 text-[14px] text-ink placeholder:text-muted aria-[invalid=true]:outline aria-[invalid=true]:outline-loss disabled:cursor-not-allowed disabled:opacity-55";

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: React.ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-[14px] font-medium text-ink">
          {label}
        </label>
        {description && <div className="mt-0.5 text-[13px] text-muted">{description}</div>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative mt-0.5 h-5 w-10 shrink-0 rounded-full border transition-colors disabled:opacity-55",
          checked ? "border-accent bg-accent" : "border-line-strong bg-sunken",
        )}
      >
        <span aria-hidden className={cx("absolute top-[2px] left-[2px] h-3.5 w-3.5 rounded-full transition-transform", checked ? "translate-x-[20px] bg-accent-ink" : "bg-muted")} />
      </button>
    </div>
  );
}

/** Native <dialog> for focus trapping and Esc handling. `drawer` docks it to the right edge; `persistent` ignores backdrop clicks, for forms. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
  drawer,
  persistent,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
  drawer?: boolean;
  persistent?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // showModal focuses the first control, which is the close button; a form names a better start.
      d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => !persistent && e.target === ref.current && onClose()}
      className={cx(
        "overflow-hidden border-line bg-surface p-0 text-ink shadow-xl",
        drawer ? "animate-slide my-0 mr-0 ml-auto h-dvh max-h-dvh w-full max-w-2xl border-l" : cx("animate-rise m-auto max-h-[94dvh] w-[calc(100%-16px)] rounded-panel border", wide ? "max-w-4xl" : "max-w-lg"),
      )}
    >
      {open && (
        <div className={cx("flex flex-col", drawer ? "h-dvh" : "max-h-[94dvh]")}>
          <div className="flex items-center justify-between gap-3 border-b border-line px-card py-3">
            <h2 className="min-w-0 truncate text-[15.5px] font-medium">{title}</h2>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close dialog">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M2 2l10 10M12 2L2 12" /></svg>
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-card py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-[13px] text-muted">
      <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
      {label}
    </span>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-control border border-line-strong bg-sunken p-0.5 [scrollbar-width:none]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-[5px] px-2.5 py-1 text-[13px] whitespace-nowrap transition-colors",
            value === o.value ? "bg-surface font-medium text-ink shadow-card ring-1 ring-line" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Something the user should know, with the reason in plain words and what to do about it. */
export function Notice({ tone = "warn", children, action }: { tone?: "warn" | "info" | "loss"; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div
      role="note"
      className={cx(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-control border-l-2 px-3.5 py-2.5 text-[13.5px] text-ink",
        tone === "warn" && "border-warn bg-warn-soft",
        tone === "info" && "border-info bg-info-soft",
        tone === "loss" && "border-loss bg-loss-soft",
      )}
    >
      <div className="min-w-0 flex-1 basis-60">{children}</div>
      {action}
    </div>
  );
}

/** A chart's numbers as a table, one click away. */
export function DataTable({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="mt-2 text-[13px]">
      <summary className="cursor-pointer text-muted hover:text-ink">{summary}</summary>
      <div className="mt-2 max-h-72 overflow-auto">{children}</div>
    </details>
  );
}
