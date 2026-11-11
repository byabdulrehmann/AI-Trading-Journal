"use client";

import Link from "next/link";
import { useState } from "react";
import { api, fieldErrors } from "@/lib/client/api";
import { Button, Field, Notice, inputClass } from "@/components/ui";
import { AuthFrame, RecoveryCode, authLink } from "@/components/AuthFrame";

// eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload so shared state loads for this session
const openJournal = () => window.location.assign("/");

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);

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
      const res = await api<{ recoveryCode: string }>("/api/auth/reset", { method: "POST", json: { email, code, password } });
      setFresh(res.recoveryCode);
    } catch (err) {
      const fields = fieldErrors(err);
      setErrors(fields);
      if (!Object.keys(fields).length) setFormError(err instanceof Error ? err.message : "Couldn't reset the password.");
    } finally {
      setBusy(false);
    }
  }

  if (fresh) {
    return (
      <AuthFrame title="Password changed" intro="You're signed in, and every other device has been signed out. Your old recovery code no longer works.">
        <RecoveryCode code={fresh} onDone={openJournal} />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title="Reset your password"
      intro="Jarvis runs on this computer and can't send email. Use the recovery code you saved when you created your account, or the newest one from Settings."
      footer={<p>Remembered it? <Link href="/login" className={authLink}>Sign in</Link></p>}
    >
      <form onSubmit={submit} noValidate className="space-y-3.5">
        <Field label="Email" error={errors.email}>
          {(p) => <input {...p} type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus required />}
        </Field>
        <Field label="Recovery code" error={errors.code} hint="Four groups of five letters and numbers.">
          {(p) => <input {...p} className={`${inputClass} font-mono uppercase`} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" spellCheck={false} placeholder="ABCDE-FGHJK-LMNPQ-RSTUV" required />}
        </Field>
        <Field label="New password" error={errors.password} hint="At least 10 characters.">
          {(p) => <input {...p} type="password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />}
        </Field>
        <Field label="Repeat new password" error={errors.confirm}>
          {(p) => <input {...p} type="password" className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />}
        </Field>
        {formError && <Notice tone="loss">{formError}</Notice>}
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>
          {busy ? "One moment" : "Set new password"}
        </Button>
      </form>
      <p className="mt-4 text-[13px] text-muted">No recovery code? Without it this account can&apos;t be reopened from here, and nobody can read your password back. You can <Link href="/signup" className={authLink}>create a new account</Link> instead.</p>
    </AuthFrame>
  );
}
