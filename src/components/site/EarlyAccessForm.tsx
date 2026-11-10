"use client";

import { useState } from "react";
import { cx } from "@/components/ui";
import { Arrow } from "./parts";
import { useSound } from "./sound";

type Errors = Partial<Record<"name" | "email" | "trades" | "message" | "form", string>>;

/**
 * The site's one working form. It saves a request in this Jarvis's own database for its owner to read; it doesn't
 * email anyone or create an account, and says so. Without JavaScript it still posts (never a GET with personal data
 * in the URL) and the server redirects back with the outcome.
 */
export function EarlyAccessForm({ initial }: { initial?: "sent" | "error" }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">(initial === "sent" ? "sent" : "idle");
  const [errors, setErrors] = useState<Errors>(initial === "error" ? { form: "That request couldn't be saved. Check the fields and try again." } : {});
  const { play } = useSound();

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setState("sending");
    setErrors({});
    try {
      const res = await fetch("/api/early-access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      if (res.ok) {
        setState("sent");
        play("reveal");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; details?: { path: string; message: string }[] };
      const next: Errors = {};
      for (const d of body.details ?? []) if (["name", "email", "trades", "message"].includes(d.path)) next[d.path as keyof Errors] = d.message;
      if (!Object.keys(next).length) next.form = body.error ?? "That request couldn't be saved. Please try again.";
      setErrors(next);
      setState("idle");
    } catch {
      setErrors({ form: "Jarvis didn't answer. Check that it is running, then try again." });
      setState("idle");
    }
  };

  if (state === "sent") {
    return (
      <div role="status" className="rounded-[var(--s-radius-lg)] border border-[var(--s-line-strong)] bg-[var(--s-surface)] p-8" data-testid="early-access-sent">
        <h3 className="s-display s-h3">Request saved.</h3>
        <p className="s-body mt-3">Your request is stored in this Jarvis, where its owner reads early-access requests. No email has been sent and no account has been created.</p>
      </div>
    );
  }

  const field = (name: "name" | "email" | "trades", label: string, opts: { type?: string; required?: boolean; autoComplete?: string; hint?: string }) => (
    <div className="s-field">
      <label htmlFor={`ea-${name}`}>
        {label}
        {!opts.required && <span className="font-normal text-[var(--s-muted)]"> (optional)</span>}
      </label>
      <input id={`ea-${name}`} name={name} type={opts.type ?? "text"} required={opts.required} autoComplete={opts.autoComplete} maxLength={name === "email" ? 200 : name === "name" ? 80 : 120} className="s-input" aria-invalid={errors[name] ? true : undefined} aria-describedby={errors[name] ? `ea-${name}-err` : opts.hint ? `ea-${name}-hint` : undefined} />
      {opts.hint && !errors[name] && <p id={`ea-${name}-hint`} className="text-[13px] text-[var(--s-muted)]">{opts.hint}</p>}
      {errors[name] && <p id={`ea-${name}-err`} className="s-error">{errors[name]}</p>}
    </div>
  );

  return (
    <form method="post" action="/api/early-access" onSubmit={submit} noValidate className="grid gap-6" aria-describedby="ea-form-note" data-testid="early-access-form">
      <div className="grid gap-6 sm:grid-cols-2">
        {field("name", "Name", { required: true, autoComplete: "name" })}
        {field("email", "Email", { type: "email", required: true, autoComplete: "email" })}
      </div>
      {field("trades", "What do you trade?", { hint: "For example: XAUUSD and EURUSD, intraday, on a funded account." })}
      <div className="s-field">
        <label htmlFor="ea-message">Anything else? <span className="font-normal text-[var(--s-muted)]">(optional)</span></label>
        <textarea id="ea-message" name="message" maxLength={1000} className="s-input" aria-invalid={errors.message ? true : undefined} />
        {errors.message && <p className="s-error">{errors.message}</p>}
      </div>
      {/* Hidden from people; a bot that fills every field fills this one too. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="ea-website">Website</label>
        <input id="ea-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      {errors.form && <p role="alert" className="s-error">{errors.form}</p>}
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" className={cx("s-btn s-btn-primary")} disabled={state === "sending"} aria-disabled={state === "sending"}>
          {state === "sending" ? "Saving…" : "Request early access"}
          {state !== "sending" && <Arrow />}
        </button>
        <p id="ea-form-note" className="text-[13px] text-[var(--s-muted)]">Saved in this Jarvis for its owner. Not emailed, and no account is created.</p>
      </div>
    </form>
  );
}
