"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, fieldErrors } from "@/lib/client/api";
import { Button, Field, Notice, inputClass } from "@/components/ui";
import { AuthFrame, RecoveryCode, authLink } from "@/components/AuthFrame";

// eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload so shared state loads for this session
const openJournal = () => window.location.assign("/");

export default function SignupPage() {
  const [first, setFirst] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    api<{ user: unknown; hasUsers: boolean }>("/api/auth/me").then(
      (me) => (me.user ? openJournal() : setFirst(!me.hasUsers)),
      () => setFormError("Jarvis couldn't reach its database. Check that the server is running, then reload."),
    );
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    if (password !== confirm) {
      setErrors({ confirm: "These passwords don't match." });
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ recoveryCode: string }>("/api/auth/signup", { method: "POST", json: { email, password, name } });
      setCode(res.recoveryCode);
    } catch (err) {
      const fields = fieldErrors(err);
      setErrors(fields);
      if (!Object.keys(fields).length) setFormError(err instanceof Error ? err.message : "Couldn't create the account.");
    } finally {
      setBusy(false);
    }
  }

  if (code) {
    return (
      <AuthFrame title="Save your recovery code" intro="Your account is ready. One last thing before your journal opens.">
        <RecoveryCode code={code} onDone={openJournal} />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title="Create your account"
      intro={first ? "This is the first account on this computer. Any trades already in the journal will belong to it." : "Your own private journal, stored on this computer. Nobody else who signs in here can see it."}
      footer={<p>Already have an account? <Link href="/login" className={authLink}>Sign in</Link></p>}
    >
      <form onSubmit={submit} noValidate className="space-y-3.5">
        <Field label="Name (optional)" error={errors.name}>
          {(p) => <input {...p} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}
        </Field>
        <Field label="Email" error={errors.email}>
          {(p) => <input {...p} type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus required />}
        </Field>
        <Field label="Password" error={errors.password} hint="At least 10 characters. You'll also get a recovery code in case you forget it.">
          {(p) => <input {...p} type="password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />}
        </Field>
        <Field label="Repeat password" error={errors.confirm}>
          {(p) => <input {...p} type="password" className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />}
        </Field>
        {formError && <Notice tone="loss">{formError}</Notice>}
        <Button type="submit" variant="primary" className="w-full" disabled={busy || first === null}>
          {busy ? "One moment" : "Create account"}
        </Button>
      </form>
    </AuthFrame>
  );
}
