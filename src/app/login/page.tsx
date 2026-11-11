"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, fieldErrors } from "@/lib/client/api";
import { Button, Field, Notice, Spinner, inputClass } from "@/components/ui";
import { AuthFrame, authLink } from "@/components/AuthFrame";

export default function LoginPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ user: unknown; hasUsers: boolean }>("/api/auth/me").then(
      (me) => {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload so shared state loads for this session
        if (me.user) window.location.assign("/");
        // A fresh installation has nobody to sign in as yet.
        else if (!me.hasUsers) router.replace("/signup");
        else setReady(true);
      },
      () => setFormError("Jarvis couldn't reach its database. Check that the server is running, then reload."),
    );
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    setBusy(true);
    try {
      await api("/api/auth/login", { method: "POST", json: { email, password } });
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
    <AuthFrame
      title="Sign in"
      intro="Your journal is stored on this computer and opens with your password."
      footer={
        ready && (
          <>
            <p>New here? <Link href="/signup" className={authLink}>Create an account</Link></p>
            <p><Link href="/forgot-password" className={authLink}>Forgot your password?</Link></p>
          </>
        )
      }
    >
      {!ready && !formError ? (
        <Spinner label="Checking this installation" />
      ) : (
        <form onSubmit={submit} noValidate className="space-y-3.5">
          <Field label="Email" error={errors.email}>
            {(p) => <input {...p} type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus required />}
          </Field>
          <Field label="Password" error={errors.password}>
            {(p) => <input {...p} type="password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />}
          </Field>
          {formError && <Notice tone="loss">{formError}</Notice>}
          <Button type="submit" variant="primary" className="w-full" disabled={busy || !ready}>
            {busy ? "One moment" : "Sign in"}
          </Button>
        </form>
      )}
    </AuthFrame>
  );
}
