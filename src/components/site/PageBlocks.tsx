import Link from "next/link";
import { Arrow } from "./parts";
import { CTA_HREF, CTA_LABEL } from "./SiteNav";

/** The opening of an inner page: one heading, one sentence, set large on the ground. */
export function PageHead({ title, lede, children }: { title: string; lede: string; children?: React.ReactNode }) {
  return (
    <header className="relative overflow-hidden pt-[clamp(150px,22vh,220px)] pb-[clamp(64px,10vh,112px)]">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_70%_at_85%_0%,rgb(255_106_74/0.06),transparent_70%)]" />
      <div className="s-wrap relative">
        <h1 className="s-display s-h1 max-w-[16ch]" data-reveal="words">{title}</h1>
        <p className="s-lede mt-6 max-w-[52ch]">{lede}</p>
        {children}
      </div>
    </header>
  );
}

/** The close of an inner page: the one action, and sign-in for the owner. */
export function CtaBand({ title = "See your own trading clearly." }: { title?: string }) {
  return (
    <section className="s-section border-t border-[var(--s-line)]" aria-labelledby="cta-band">
      <div className="s-wrap flex flex-col items-start gap-8 lg:flex-row lg:items-end lg:justify-between">
        <h2 id="cta-band" className="s-display s-h2 max-w-[16ch]" data-reveal="words">{title}</h2>
        <div className="flex flex-wrap gap-3">
          <Link href={CTA_HREF} className="s-btn s-btn-primary">{CTA_LABEL}<Arrow /></Link>
          <Link href="/login" className="s-btn s-btn-ghost">Sign in</Link>
        </div>
      </div>
    </section>
  );
}
