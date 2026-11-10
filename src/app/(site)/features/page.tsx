import type { Metadata } from "next";
import { CtaBand, PageHead } from "@/components/site/PageBlocks";
import { Shot, Status, type ScreenKey } from "@/components/site/parts";

export const metadata: Metadata = {
  title: "Features",
  description: "Everything in Jarvis today, and what is still in development: MT5 sync, imports, the trading journal, analytics, patterns, playbooks, prop challenges, backtesting, trade replay and the AI Coach.",
  alternates: { canonical: "/features" },
};

type Kind = "built" | "soon" | "needs-ai";
const GROUPS: { title: string; lede: string; shot?: ScreenKey; items: [string, string, Kind][] }[] = [
  {
    title: "Getting trades in",
    lede: "Three ways in, one record out.",
    items: [
      ["MT5 account sync", "Read-only, with the investor password. History, open positions, balance, equity and floating P&L.", "built"],
      ["CSV and Excel import", "Broker files with format detection, a preview first, and duplicate checks.", "built"],
      ["Manual entry", "Entry, stop, target, exit and costs, with a live price ladder as you type.", "built"],
      ["Several accounts", "Live, funded and practice accounts side by side, one currency at a time.", "built"],
    ],
  },
  {
    title: "The trading journal",
    lede: "Every trade, with its reasons.",
    shot: "drawer",
    items: [
      ["Trades list", "Filter by account, instrument, strategy, side, session, outcome, tag, R and hold time.", "built"],
      ["Trade detail", "Fills, costs, R, the chart around the trade, notes, screenshots and attachments.", "built"],
      ["Tags, mistakes, emotions and grades", "Mark what happened, and whether you followed the plan.", "built"],
      ["Daily journal and notebook", "A pre-market plan, an end-of-day recap, and notes linked to trades and days.", "built"],
      ["Share pictures", "A picture of a trade, drawn in your browser, with amounts hidden by default.", "built"],
    ],
  },
  {
    title: "Analytics",
    lede: "Honest figures, from closed trades only.",
    shot: "dashboard",
    items: [
      ["Dashboard", "Net P&L, win rates, profit factor, average win and loss, daily and cumulative P&L, open positions and the month.", "built"],
      ["Jarvis Performance Score", "Six axes with published formulas, shown only once there are enough trades.", "built"],
      ["Reports", "By period, instrument, strategy, session, weekday, hour, risk, R-multiple and drawdown.", "built"],
      ["Patterns", "Plain rules over your record, such as fast re-entry after a loss or losers held longer than winners.", "built"],
      ["Reviews", "Weekly and monthly reviews built from the figures.", "built"],
    ],
  },
  {
    title: "Discipline and progress",
    lede: "Rules you set, checked against what you did.",
    shot: "playbooks",
    items: [
      ["Playbooks", "Write each strategy's rules, tick them per trade, and compare strategies.", "built"],
      ["Prop challenges", "Daily and maximum loss, profit target and consistency rules, with warnings near a limit.", "built"],
      ["Goals, routine and streaks", "Targets for a week or month, and a checklist for the day.", "built"],
      ["Auto-tag rules", "Tag trades automatically, for example everything opened within minutes of high-impact news.", "built"],
      ["Economic calendar", "Import events from a CSV you download, and see them beside your trades.", "built"],
    ],
  },
  {
    title: "Practice and intelligence",
    lede: "Rehearse, replay, and ask about your own record.",
    shot: "market",
    items: [
      ["Backtesting", "Trade a past session on your broker's real bars, one bar at a time.", "built"],
      ["Trade Replay", "Replay a trade or a whole day with your fills on the chart.", "built"],
      ["Market context", "An instrument bias with the factors behind it, and your economic calendar.", "built"],
      ["AI Coach", "Chat about your own trades with an AI model you connect. Not a signal service.", "needs-ai"],
    ],
  },
  {
    title: "Coming to Jarvis",
    lede: "Named in the app, not built yet.",
    items: [
      ["Mentor Mode", "Planned.", "soon"],
      ["University", "Planned.", "soon"],
      ["Resource Center", "Planned.", "soon"],
    ],
  },
];

export default function FeaturesPage() {
  return (
    <>
      <PageHead title="Everything in Jarvis, marked plainly." lede="Each feature says whether it is in Jarvis today or still in development. Nothing here is a promise about results." />
      {GROUPS.map((g, gi) => (
        <section key={g.title} className={`s-section ${gi === 0 ? "pt-0" : "border-t border-[var(--s-line)]"}`} aria-labelledby={`g${gi}`}>
          <div className="s-wrap grid gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
            <div>
              <h2 id={`g${gi}`} className="s-display s-h3">{g.title}</h2>
              <p className="s-body mt-3">{g.lede}</p>
            </div>
            <div className="flex flex-col gap-10">
              <ul className="s-rise flex flex-col">
                {g.items.map(([name, body, kind]) => (
                  <li key={name} className="grid gap-2 border-t border-[var(--s-line)] py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6">
                    <div>
                      <h3 className="text-[17.5px] font-semibold text-[var(--s-ink)]">{name}</h3>
                      <p className="s-body mt-1 text-[15px]">{body}</p>
                    </div>
                    <div className="sm:pt-1"><Status kind={kind} /></div>
                  </li>
                ))}
              </ul>
              {g.shot && <Shot name={g.shot} className="s-rise" />}
            </div>
          </div>
        </section>
      ))}
      <CtaBand />
    </>
  );
}
