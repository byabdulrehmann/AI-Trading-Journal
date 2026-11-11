import type { Metadata } from "next";
import { CtaBand, PageHead } from "@/components/site/PageBlocks";

export const metadata: Metadata = {
  title: "About",
  description: "Why Jarvis exists, the principles it is built on, and what it will never do.",
  alternates: { canonical: "/about" },
};

const PRINCIPLES = [
  ["Your record, not your memory", "Traders remember the trades they were right about. A journal that does the arithmetic remembers all of them."],
  ["Honest figures", "Every number is worked out from your own closed trades. Unknown stays unknown: a missing cost or stop is shown as missing, never guessed."],
  ["Read-only by design", "Jarvis connects to MT5 with the investor password. It can look at your account. It can never trade on it."],
  ["Private by default", "It runs on your computer, and your trading data stays there."],
];

const NEVER = [
  "Place, change or close a trade.",
  "Tell you what to buy or sell.",
  "Promise or imply returns.",
  "Show sample data as if it were real.",
];

export default function AboutPage() {
  return (
    <>
      <PageHead title="Built for traders who want the truth about their trading." lede="Jarvis is a trading journal and performance platform for forex and gold traders: day traders, intraday traders and traders working toward or holding funded accounts." />
      <section className="s-section pt-0" aria-labelledby="principles">
        <div className="s-wrap">
          <h2 id="principles" className="s-display s-h2 max-w-[14ch]" data-reveal="words">What it is built on.</h2>
          <dl className="s-rise mt-14 grid gap-x-16 gap-y-12 md:grid-cols-2">
            {PRINCIPLES.map(([k, v]) => (
              <div key={k} className="border-t border-[var(--s-line)] pt-6">
                <dt className="s-display s-h3">{k}</dt>
                <dd className="s-body mt-3 text-[16.5px]">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
      <section className="s-section border-t border-[var(--s-line)]" aria-labelledby="never">
        <div className="s-wrap grid gap-10 lg:grid-cols-2">
          <h2 id="never" className="s-display s-h2 max-w-[14ch]" data-reveal="words">What Jarvis will never do.</h2>
          <ul className="s-rise flex flex-col">
            {NEVER.map((n) => (
              <li key={n} className="flex items-start gap-4 border-t border-[var(--s-line)] py-5 text-[18px] text-[var(--s-ink)]">
                <svg className="mt-1.5 shrink-0 text-[var(--s-loss)]" width="16" height="16" viewBox="0 0 14 14" aria-hidden><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                {n}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="s-section border-t border-[var(--s-line)]" aria-labelledby="risk">
        <div className="s-wrap max-w-[860px]">
          <h2 id="risk" className="s-display s-h3">A note on risk</h2>
          <p className="s-body mt-4 text-[16px]">Trading foreign exchange, metals and other leveraged products carries a high risk of loss and is not suitable for everyone. Jarvis helps you review what you did; it does not give investment advice, and nothing on this site is a recommendation.</p>
        </div>
      </section>
      <CtaBand />
    </>
  );
}
