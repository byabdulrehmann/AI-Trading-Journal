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
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm",
        variant === "primary" && "bg-accent text-accent-ink hover:brightness-110",
        variant === "secondary" && "border border-line-strong bg-raised text-ink hover:border-muted",
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
    <section className={cx("rounded-xl border border-line bg-surface", className)} {...rest}>
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0 whitespace-nowrap">{action}</div>}
    </div>
  );
}

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "accent" | "profit" | "loss" | "info"; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium whitespace-nowrap",
        tone === "neutral" && "bg-raised text-ink-soft ring-1 ring-line",
        tone === "accent" && "bg-accent-soft text-accent",
        tone === "profit" && "bg-profit-soft text-profit",
        tone === "loss" && "bg-loss-soft text-loss",
        tone === "info" && "bg-info-soft text-info",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[14px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** A number with its formula one click away. */
export function Stat({
  def,
  value,
  tone,
  note,
}: {
  def: MetricDefinition;
  value: React.ReactNode;
  tone?: string;
  note?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="min-w-0 rounded-lg border border-line bg-raised/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted">{def.label}</span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="rounded px-1 text-[12px] text-muted hover:text-ink"
          title="How this is calculated"
        >
          {open ? "Hide" : "ƒ"}
          <span className="sr-only"> formula for {def.label}</span>
        </button>
      </div>
      <div className={cx("num mt-1 text-[22px] font-medium", tone ?? "text-ink")}>{value}</div>
      {note && <div className="mt-0.5 text-[12px] text-muted">{note}</div>}
      {open && (
        <div id={id} className="mt-3 border-t border-line pt-2 text-[12.5px] text-ink-soft">
          <code className="num block text-[12px] text-accent">{def.formula}</code>
          <p className="mt-1">{def.meaning}</p>
        </div>
      )}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong px-6 py-12 text-center">
      <div aria-hidden className="mb-3 h-8 w-8 rounded-full border border-line-strong" />
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      <div className="mt-1 max-w-md text-[14px] text-muted">{body}</div>
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Shown wherever simulated data appears. Not dismissible on purpose. */
export function DemoBanner({ children }: { children: React.ReactNode }) {
  return (
    <div role="note" className="mb-5 flex items-start gap-3 rounded-lg border border-info/40 bg-info-soft px-4 py-3 text-[13.5px] text-ink">
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
    <div className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink-soft">
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
  "h-10 w-full min-w-0 rounded-md border border-line-strong bg-sunken px-3 text-[14px] text-ink placeholder:text-muted/70 aria-[invalid=true]:border-loss";

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
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-50",
          checked ? "border-accent bg-accent" : "border-line-strong bg-sunken",
        )}
      >
        <span aria-hidden className={cx("absolute top-[2px] left-[2px] h-[18px] w-[18px] rounded-full transition-transform", checked ? "translate-x-[20px] bg-accent-ink" : "bg-muted")} />
      </button>
    </div>
  );
}

/** Native <dialog> for focus trapping and Esc handling. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        "m-auto max-h-[92vh] w-[calc(100%-24px)] overflow-hidden rounded-xl border border-line-strong bg-surface p-0 text-ink backdrop:bg-black/60",
        wide ? "max-w-3xl" : "max-w-lg",
      )}
    >
      {open && (
        <div className="flex max-h-[92vh] flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="text-[16px] font-semibold">{title}</h2>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close dialog">
              ✕
            </Button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
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
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line-strong bg-sunken p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded px-3 py-1 text-[13px] transition-colors",
            value === o.value ? "bg-raised text-ink shadow-sm ring-1 ring-line-strong" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
