import type { Metadata } from "next";
import { CtaBand, PageHead } from "@/components/site/PageBlocks";
import { Shot } from "@/components/site/parts";

export const metadata: Metadata = {
  title: "Platform",
  description: "How Jarvis fits a trader's day: MT5 sync with the read-only investor password, a journal and analytics that run on your own computer, and what it is built with.",
  alternates: { canonical: "/platform" },
};

const DAY = [
  ["Before the session", "Write the day's plan in the daily journal: bias, levels, what would make you stop.", "day"],
  ["During the session", "Trade in MT5 as usual. Jarvis syncs the account on the interval you set; manual trades can be logged in seconds.", "journal"],
  ["After the session", "Every closed trade lands on its day with fills, costs and R. Add notes, screenshots, tags and whether you followed the plan.", "drawer"],
  ["At the weekend", "Reports, patterns and the calendar show what worked. Practice on past bars, then plan the next week.", "reportsOverview"],
] as const;

const STACK = [
  ["Application", "A Next.js and React app that runs on your computer and opens in your browser."],
  ["Database", "SQLite, stored in a file on your machine, with automatic daily backups that keep the last seven."],
  ["MT5 bridge", "A local Python service using MetaQuotes' official MetaTrader5 package, signed in with the investor password only."],
  ["Credentials", "The investor password is encrypted with AES-256-GCM, with its key kept outside the database, and never sent to the browser."],
  ["Calculations", "Every figure is worked out from your closed trades, with documented conventions for costs, partial exits and missing stops."],
  ["AI, optional", "The AI Coach uses a model provider you connect yourself, and sends only what your privacy settings allow."],
];

export default function PlatformPage() {
  return (
    <>
      <PageHead title="One record of your trading, on your own computer." lede="Jarvis brings your MT5 history, imports and manual trades into one journal, works out honest figures from it, and helps you review and plan. It never places a trade." />

      <section className="s-section pt-0" aria-labelledby="day">
        <div className="s-wrap">
          <h2 id="day" className="s-display s-h2 max-w-[18ch]" data-reveal="words">How it fits a trading day.</h2>
          <ol className="mt-14 flex flex-col gap-20">
            {DAY.map(([title, body, shot], i) => (
              <li key={title} className={`s-rise grid items-center gap-10 lg:grid-cols-2 ${i % 2 ? "lg:[&>*:first-child]:order-2" : ""}`}>
                <div>
                  <h3 className="s-display s-h3">{title}</h3>
                  <p className="s-body mt-4 text-[16.5px]">{body}</p>
                </div>
                <Shot name={shot} />
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="mt5" data-tone="dark" className="s-section scroll-mt-20" aria-labelledby="mt5-h">
        <div className="s-wrap grid gap-12 lg:grid-cols-2">
          <div>
            <h2 id="mt5-h" className="s-display s-h2" data-reveal="words">MT5, read-only.</h2>
            <p className="s-lede mt-6">MetaTrader 5 gives every account two passwords. The trading password can place orders. The investor password can only look. Jarvis asks for the investor password and nothing else.</p>
          </div>
          <ol className="s-rise flex flex-col gap-6">
            {[
              ["Open Accounts and MT5 in Jarvis", "Enter your account number, your broker's server and the investor password."],
              ["Jarvis signs in, read-only", "Its own MT5 terminal signs in on your computer. It refuses to read if it finds itself on any other account."],
              ["History and positions sync", "Closed deals become trades; open positions, balance, equity and floating P&L are kept current on your interval."],
              ["Disconnect any time", "Disconnecting deletes the stored password. Your journal stays."],
            ].map(([t, b], i) => (
              <li key={t} className="grid grid-cols-[auto_1fr] gap-5 border-t border-[var(--s-line)] pt-6">
                <span className="s-data text-[13px] text-[var(--s-muted)]">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className="text-[18px] font-semibold text-[var(--s-ink)]">{t}</h3>
                  <p className="s-body mt-1.5 text-[15.5px]">{b}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="private" className="s-section scroll-mt-20 border-t border-[var(--s-line)]" aria-labelledby="private-h">
        <div className="s-wrap grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <h2 id="private-h" className="s-display s-h2" data-reveal="words">Private and local.</h2>
          <div className="s-rise grid gap-8 sm:grid-cols-2">
            {[
              ["Your data stays with you", "Trades, notes, screenshots and settings live in a database file on your computer. There is no Jarvis server holding them."],
              ["It only answers on your machine", "Jarvis listens on your own computer and refuses requests from other sites or other machines."],
              ["Yours to take", "Export everything as JSON or your trades as CSV, and keep daily backups."],
              ["Sample data is always labelled", "Built-in sample trades help you explore, and every screen says when it is showing them."],
            ].map(([t, b]) => (
              <div key={t}>
                <h3 className="text-[18px] font-semibold text-[var(--s-ink)]">{t}</h3>
                <p className="s-body mt-2 text-[15.5px]">{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="technology" data-tone="mist" className="s-section scroll-mt-20" aria-labelledby="tech-h">
        <div className="s-wrap">
          <h2 id="tech-h" className="s-display s-h2 max-w-[16ch]" data-reveal="words">What it is built with.</h2>
          <dl className="s-rise mt-14 grid gap-px overflow-hidden rounded-[var(--s-radius-lg)] border border-[var(--s-line)] bg-[var(--s-line)] md:grid-cols-2 lg:grid-cols-3">
            {STACK.map(([k, v]) => (
              <div key={k} className="bg-[var(--s-canvas)] p-7">
                <dt className="text-[17px] font-semibold text-[var(--s-ink)]">{k}</dt>
                <dd className="s-body mt-2 text-[15px]">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
