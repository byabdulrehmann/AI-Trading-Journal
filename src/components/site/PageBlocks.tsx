import Link from "next/link";
import { Arrow } from "./parts";
import { WordReveals } from "./reveals";
import { CTA_HREF, CTA_LABEL } from "./SiteNav";

/** The opening of an inner page: one heading, one sentence, set large on the ground. */
export function PageHead({ title, lede, children }: { title: string; lede: string; children?: React.ReactNode }) {
  return (
    <header className="relative pt-[clamp(150px,24vh,240px)] pb-[clamp(72px,11vh,128px)]">
      <div className="s-wrap relative">
        <h1 className="s-display s-h1 max-w-[15ch]" data-reveal="words">{title}</h1>
        <p className="s-lede mt-8 max-w-[48ch]">{lede}</p>
        {children}
      </div>
      {/* Rendered inside the page, not the layout, so headings are split only after the page has hydrated. */}
      <WordReveals />
    </header>
  );
}

/** The close of an inner page: the one action, and sign-in for the owner. */
export function CtaBand({ title = "See your own trading clearly." }: { title?: string }) {
  return (
    <section data-tone="dark" className="s-section" aria-labelledby="cta-band">
      <div className="s-wrap flex flex-col items-start gap-10 lg:flex-row lg:items-end lg:justify-between">
        <h2 id="cta-band" className="s-display s-h2 max-w-[14ch]" data-reveal="words">{title}</h2>
        <div className="flex flex-wrap gap-3">
          <Link href={CTA_HREF} className="s-btn s-btn-primary">{CTA_LABEL}<Arrow /></Link>
          <Link href="/login" className="s-btn s-btn-ghost">Sign in</Link>
        </div>
      </div>
    </section>
  );
}
