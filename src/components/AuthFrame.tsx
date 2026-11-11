"use client";

import { IBM_Plex_Serif } from "next/font/google";
import Link from "next/link";
import { useState } from "react";
import { Button, Notice } from "@/components/ui";
import { Logo } from "@/components/Shell";

const serif = IBM_Plex_Serif({ subsets: ["latin"], weight: ["300"] });

/** The narrow column every sign-in screen shares: sign in, sign up, forgot password. In the website's palette. */
export function AuthFrame({ title, intro, children, footer }: { title: string; intro: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="auth-book flex min-h-dvh items-center justify-center bg-canvas px-gutter py-10">
      <div className="w-full max-w-sm">
        <Link href="/welcome" aria-label="Jarvis website" className="inline-flex no-underline">
          <Logo />
        </Link>
        <h1 className={`${serif.className} mt-6 border-t border-line pt-6 text-[34px] leading-[1.08] font-light tracking-[-0.02em]`}>{title}</h1>
        <p className="mt-1.5 text-[14px] text-muted">{intro}</p>
        <div className="mt-6">{children}</div>
        {footer && <div className="mt-6 space-y-2 border-t border-line pt-5 text-[13.5px] text-muted">{footer}</div>}
      </div>
    </main>
  );
}

export const authLink = "font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink";

/**
 * Shown once, right after sign-up, a reset, or a new code from Settings. Jarvis keeps only a hash, so this is the
 * only time the code can be read.
 */
export function RecoveryCode({ code, onDone, doneLabel = "I've saved it, continue" }: { code: string; onDone: () => void; doneLabel?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="space-y-4" data-testid="recovery-code">
      <p className="text-[14px] text-ink-soft">
        This is your <strong className="text-ink">recovery code</strong>. If you forget your password, it is the only way back into this account. Write it down or keep it in a password manager. It won&apos;t be shown again.
      </p>
      <output className="block rounded-control border border-line-strong bg-surface px-3 py-3 text-center font-mono text-[17px] tracking-[0.06em] text-ink select-all" aria-label="Recovery code">
        {code}
      </output>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void copy()}>{copied ? "Copied" : "Copy code"}</Button>
        <Button variant="primary" className="flex-1" onClick={onDone}>{doneLabel}</Button>
      </div>
      <Notice tone="info">Each code works once. Using it to reset your password gives you a new one.</Notice>
    </div>
  );
}
