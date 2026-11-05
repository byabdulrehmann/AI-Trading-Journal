"use client";

import { useEffect, useState } from "react";
import { api, fieldErrors } from "@/lib/client/api";
import { Button, Field, Notice, Spinner, inputClass } from "@/components/ui";
import { Logo } from "@/components/Shell";

export default function LoginPage() {
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ user: unknown; hasUsers: boolean }>("/api/auth/me").then(
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload so shared state loads for this session
      (me) => (me.user ? window.location.assign("/") : setHasUsers(me.hasUsers)),
      () => setFormError("Jarvis couldn't reach its database. Check that the server is running, then reload."),
    );
  }, []);

  const setup = hasUsers === false;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    if (setup && password !== confirm) {
      setErrors({ confirm: "These passwords don't match." });
      return;
    }
    setBusy(true);
    try {
      await api(setup ? "/api/auth/signup" : "/api/auth/login", { method: "POST", json: setup ? { email, password, name } : { email, password } });
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload so shared state loads for this session
      window.location.assign("/");
    } catch (err) {
      const fields = fieldErrors(err);
      setErrors(fields);
      if (!Object.keys(fields).length) setFormError(err instanceof Error ? err.message : "Couldn't sign in.");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-gutter py-10">
      <div className="w-full max-w-sm">
        <Logo />
        {hasUsers === null && !formError ? (
          <div className="mt-8"><Spinner label="Checking this installation" /></div>
        ) : (
          <>
            <h1 className="mt-6 border-t border-line pt-6 text-[22px] leading-tight font-medium">{setup ? "Create your account" : "Sign in"}</h1>
            <p className="mt-1.5 text-[14px] text-muted">
              {setup ? "This is the first account on this computer. Any trades already in the journal will belong to it." : "Your journal is stored on this computer and opens with your password."}
            </p>
            <form onSubmit={submit} noValidate className="mt-6 space-y-3.5">
              {setup && (
                <Field label="Name (optional)" error={errors.name}>
                  {(p) => <input {...p} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}
                </Field>
              )}
              <Field label="Email" error={errors.email}>
                {(p) => <input {...p} type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus required />}
              </Field>
              <Field label="Password" error={errors.password} hint={setup ? "At least 10 characters. It can't be recovered, so keep it safe." : undefined}>
                {(p) => <input {...p} type="password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={setup ? "new-password" : "current-password"} required />}
              </Field>
              {setup && (
                <Field label="Repeat password" error={errors.confirm}>
                  {(p) => <input {...p} type="password" className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />}
                </Field>
              )}
              {formError && <Notice tone="loss">{formError}</Notice>}
              <Button type="submit" variant="primary" className="w-full" disabled={busy || hasUsers === null}>
                {busy ? "One moment" : setup ? "Create account" : "Sign in"}
              </Button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
