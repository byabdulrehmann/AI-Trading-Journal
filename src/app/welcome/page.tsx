import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Serif } from "next/font/google";
import Link from "next/link";
import { engineNet, HAND_NET, trade } from "./figures";
import { Hand } from "./hand";
import { WelcomeMotion } from "./WelcomeMotion";
import "./welcome.css";

const serif = IBM_Plex_Serif({ variable: "--jw-serif", subsets: ["latin"], weight: ["300"], style: ["normal"] });
const mono = IBM_Plex_Mono({ variable: "--jw-mono", subsets: ["latin"], weight: ["400"] });

export const metadata: Metadata = {
  title: "Jarvis: a private trading journal",
  description: "A private trading journal for forex and gold day traders. It runs on your own computer. MT5 access is read-only and it can't place trades.",
};

const INDEX = [
  { href: "#book", label: "The book" },
  { href: "#ways-in", label: "Three ways in" },
  { href: "#arithmetic", label: "The arithmetic" },
  { href: "#shows", label: "What it shows" },
  { href: "#coach", label: "The coach" },
  { href: "#limits", label: "Plainly" },
  { href: "#open", label: "Open Jarvis" },
];

// Plainly made up, wins and losses mixed, no totals: this is paper for the hero's sheet, not a result.
const SHEET_ROWS = [
  ["Mon", "XAUUSD", "Sell", "0.20", "2318.40", "2322.90", "−92.00"],
  ["Mon", "EURUSD", "Buy", "0.50", "1.0912", "1.0921", "41.50"],
  ["Mon", "GBPUSD", "Sell", "0.30", "1.2750", "1.2763", "−41.10"],
  ["Tue", "XAUUSD", "Buy", "0.10", "2301.10", "2299.60", "−15.70"],
  ["Tue", "USDJPY", "Buy", "0.40", "151.20", "151.42", "57.20"],
  ["Tue", "EURUSD", "Sell", "0.20", "1.0950", "1.0958", "−17.40"],
  ["Wed", "XAUUSD", "Sell", "0.10", "2333.00", "2329.50", "34.30"],
  ["Wed", "GBPUSD", "Buy", "0.30", "1.2701", "1.2694", "−23.10"],
  ["Wed", "AUDUSD", "Buy", "0.50", "0.6610", "0.6604", "−32.50"],
  ["Thu", "EURUSD", "Buy", "0.30", "1.0875", "1.0889", "39.90"],
  ["Thu", "XAUUSD", "Buy", "0.20", "2340.20", "2337.20", "−61.40"],
  ["Thu", "USDCAD", "Sell", "0.20", "1.3640", "1.3631", "12.20"],
  ["Fri", "XAUUSD", "Sell", "0.10", "2351.70", "2353.90", "−22.70"],
  ["Fri", "EURUSD", "Sell", "0.40", "1.0932", "1.0926", "21.80"],
  ["Fri", "GBPUSD", "Buy", "0.20", "1.2688", "1.2679", "−19.40"],
  ["Mon", "XAUUSD", "Buy", "0.10", "2344.00", "2346.10", "20.30"],
  ["Mon", "USDJPY", "Sell", "0.30", "151.80", "151.93", "−26.50"],
  ["Tue", "EURUSD", "Buy", "0.20", "1.0901", "1.0907", "10.60"],
  ["Tue", "XAUUSD", "Sell", "0.20", "2329.90", "2331.40", "−31.40"],
  ["Wed", "AUDUSD", "Sell", "0.40", "0.6588", "0.6581", "26.60"],
];

const CALENDAR = ["", "", "+18", "−40", "", "", "", "+6", "", "−12", "+31", "−92", "", "", "", "+9", "−15", "", "+22", "", "", "−27", "+12", "", "−8", "+4", "", ""];
const HOUR_BARS = [-18, 26, 12, -34, -52, 20, 8, -14];

function Tick({ className }: { className?: string }) {
  return (
    <svg className={`jw-tick ${className ?? ""}`} viewBox="0 0 48 40" aria-hidden="true">
      <path d="M5 22C9 25 13 30 17 35 23 22 32 11 44 4" pathLength={1} />
    </svg>
  );
}

function Pencil() {
  return (
    <svg className="jw-pencil__art" viewBox="0 0 900 56" aria-hidden="true">
      <polygon points="842,4 898,28 842,52" fill="#c9b08f" />
      <polygon points="876,19 898,28 876,37" fill="#2a1d18" />
      <rect x="0" y="4" width="842" height="16" fill="#ff7b5c" />
      <rect x="0" y="20" width="842" height="16" fill="#e4502f" />
      <rect x="0" y="36" width="842" height="16" fill="#a93317" />
      <rect x="0" y="4" width="14" height="48" fill="#1c1411" />
    </svg>
  );
}

export default function WelcomePage() {
  const net = engineNet();
  return (
    <div className={`jw ${serif.variable} ${mono.variable}`}>
      <a className="jw-skip" href="#book">
        Skip to the content
      </a>

      <nav className="jw-index" aria-label="On this page">
        <ol>
          {INDEX.map((item) => (
            <li key={item.href}>
              <a href={item.href}>
                <Tick />
                {item.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <main>
        <section className="jw-hero" aria-labelledby="jw-title">
          <div className="jw-hero__stage">
            <div className="jw-far" data-plane="far" />
            <header className="jw-hero__copy" data-plane="copy">
              <p className="jw-mark">
                <Tick />
                Jarvis
              </p>
              <h1 id="jw-title">Keep your own&nbsp;book.</h1>
              <p className="jw-hero__sub">A private journal for forex and gold day traders, running on your own computer, with an AI coach inside.</p>
              <Link className="jw-cta" href="/login" prefetch={false}>
                Open Jarvis
              </Link>
            </header>
            <div className="jw-under" data-plane="under" />
            <div className="jw-sheet jw-ruled" data-plane="sheet" aria-hidden="true">
              <table className="jw-sheet__rows" data-plane="rows">
                <thead>
                  <tr>
                    {["Day", "Pair", "Side", "Lots", "Entry", "Exit", "Net"].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SHEET_ROWS.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="jw-pencil" data-plane="pencil" aria-hidden="true">
              <div className="jw-pencil__shadow" />
              <Pencil />
            </div>
            <div className="jw-rule" data-plane="rule" aria-hidden="true" />
            <div className="jw-air" data-plane="air" aria-hidden="true" />
            <p className="jw-hero__note" data-plane="note">
              Illustration. Made-up trades.
            </p>
          </div>
        </section>

        <div className="jw-ground jw-ruled">
          <section id="book" className="jw-sting" aria-label="The book">
            <p className="jw-sting__big">
              <span data-line>You remember the trades you were right about.</span> <span data-line>The book remembers all of them.</span>
            </p>
            <p className="jw-body" data-line>
              Pair, size, entry, exit, costs, stop, and what you were thinking at the time. Written down once, and there when you want to look honestly.
            </p>
          </section>

          <section id="ways-in" className="jw-ways" aria-labelledby="jw-ways-title">
            <h2 id="jw-ways-title">Three ways in.</h2>
            <ul>
              <li data-wipe>
                <h3>By hand</h3>
                <p>Type the trade in when you close it. Stop, target, grade and how you felt sit in the same entry.</p>
                <div className="jw-way-art jw-way-art--fields" aria-hidden="true">
                  <span>XAUUSD</span>
                  <span>Sell</span>
                  <span>0.20</span>
                  <i />
                </div>
              </li>
              <li data-wipe>
                <h3>From a file</h3>
                <p>Import a CSV or Excel export. Match the columns, read the preview, then commit. A bad import comes back out in one go.</p>
                <pre className="jw-way-art" aria-hidden="true">{`time,symbol,type,lots
09:41,EURUSD,buy,0.50
10:02,XAUUSD,sell,0.20`}</pre>
              </li>
              <li data-wipe>
                <h3>From MT5</h3>
                <p>Sync with your investor password. That access is read-only: Jarvis can see the account and cannot trade on it.</p>
                <div className="jw-way-art jw-way-art--mt5" aria-hidden="true">
                  <span>MT5</span>
                  <b />
                  <span>Jarvis</span>
                  <em>read-only</em>
                </div>
              </li>
            </ul>
          </section>

          <section className="jw-silence" aria-label="A pause">
            <p>Don&rsquo;t take the figures on trust.</p>
          </section>
        </div>

        <section id="arithmetic" className="jw-sum jw-ruled" aria-labelledby="jw-sum-title" data-sum>
          <div className="jw-sum__stage">
            <h2 id="jw-sum-title">One trade, worked by hand.</h2>
            <figure className="jw-sum__fig">
              <dl className="jw-ticket">
                <div className="jw-ticket__head">
                  <dt>Entered in Jarvis</dt>
                  <dd>{trade.symbol}, sell</dd>
                </div>
                <div>
                  <dt>Lots</dt>
                  <dd>0.20</dd>
                </div>
                <div>
                  <dt>Ounces per lot</dt>
                  <dd>100</dd>
                </div>
                <div>
                  <dt>Entry</dt>
                  <dd>2318.40</dd>
                </div>
                <div>
                  <dt>Exit</dt>
                  <dd>2322.90</dd>
                </div>
                <div>
                  <dt>Commission</dt>
                  <dd>1.40</dd>
                </div>
                <div>
                  <dt>Swap</dt>
                  <dd>0.60</dd>
                </div>
                <div className="jw-ticket__net">
                  <dt>Net, from the engine</dt>
                  <dd data-source>{net}</dd>
                </div>
              </dl>

              <ol className="jw-working">
                <li>
                  <span className="jw-working__note">Price moved against the sell</span>
                  <span className="jw-vh">2322.90 minus 2318.40 equals 4.50</span>
                  <Hand text={"2322.90 − 2318.40 = 4.50"} />
                </li>
                <li>
                  <span className="jw-working__note">Times lots, times ounces per lot</span>
                  <span className="jw-vh">4.50 times 0.20 times 100 equals 90.00</span>
                  <Hand text={"4.50 × 0.20 × 100 = 90.00"} />
                </li>
                <li>
                  <span className="jw-working__note">A loss, then commission and swap</span>
                  <span className="jw-vh">minus 90.00, minus 1.40, minus 0.60</span>
                  <Hand text={"−90.00 − 1.40 − 0.60"} />
                </li>
                <li className="jw-working__total">
                  <span className="jw-vh">equals {HAND_NET}</span>
                  <Hand text="= " />
                  <span className="jw-working__target" data-target>
                    <Hand text={HAND_NET} exact />
                    <span className="jw-working__print" data-print aria-hidden="true">
                      {net}
                    </span>
                  </span>
                  <Tick className="jw-tick--big" />
                </li>
              </ol>
              <figcaption>Illustration. A made-up gold trade, and a losing one.</figcaption>
            </figure>
            <p className="jw-sum__verdict" data-verdict>
              <strong>Same figure.</strong> The calculation engine is tested against trades worked out by hand like this: gross, net, risk and R.
            </p>
          </div>
        </section>

        <section id="shows" className="jw-shows jw-ruled" aria-labelledby="jw-shows-title" data-pan>
          <div className="jw-shows__stage">
            <h2 id="jw-shows-title">Then it starts to show you things.</h2>
            <div className="jw-track" data-track>
              <figure className="jw-plate jw-plate--cal">
                <div className="jw-cal" aria-hidden="true">
                  {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                    <b key={i}>{d}</b>
                  ))}
                  {CALENDAR.map((v, i) => (
                    <span key={i} className={v ? (v.startsWith("+") ? "up" : "down") : ""}>
                      {v}
                    </span>
                  ))}
                </div>
                <figcaption>
                  <h3>Calendar</h3>
                  <p>A month at a glance. Open a day and its trades are there.</p>
                  <small>Illustration. Made-up numbers.</small>
                </figcaption>
              </figure>

              <figure className="jw-plate jw-plate--stats">
                <svg className="jw-bars" viewBox="0 0 400 180" aria-hidden="true">
                  <line x1="0" x2="400" y1="90" y2="90" />
                  {HOUR_BARS.map((v, i) => (
                    <rect key={i} x={10 + i * 49} width="36" y={v > 0 ? 90 - v : 90} height={Math.abs(v)} className={v > 0 ? "up" : "down"} />
                  ))}
                </svg>
                <p className="jw-formula" aria-hidden="true">
                  <span>Profit factor</span> = gross profit &divide; gross loss
                  <br />= 412.00 &divide; 530.00 = 0.78
                </p>
                <figcaption>
                  <h3>Analytics</h3>
                  <p>Each figure comes with the formula behind it, so you can see how it was reached.</p>
                  <small>Illustration. Made-up numbers.</small>
                </figcaption>
              </figure>

              <figure className="jw-plate jw-plate--notes">
                <div className="jw-note" aria-hidden="true">
                  <p>
                    <span>Before</span> Rushed. Felt I&rsquo;d missed the first move.
                  </p>
                  <p>
                    <span>After</span> Annoyed. Moved the stop, and knew it.
                  </p>
                  <p>
                    <span>Followed plan</span> No
                  </p>
                  <p>
                    <span>Grade</span> D
                  </p>
                </div>
                <figcaption>
                  <h3>Psychology notes</h3>
                  <p>What you felt going in and coming out, kept beside the trade it belongs to.</p>
                  <small>Illustration. A made-up note.</small>
                </figcaption>
              </figure>
            </div>
          </div>
        </section>

        <div className="jw-ground jw-ruled">
          <section id="coach" className="jw-coach" aria-labelledby="jw-coach-title">
            <div>
              <h2 id="jw-coach-title">The coach reads your book, not the market.</h2>
              <p className="jw-body">
                It works from what you recorded and has no live prices or news. It won&rsquo;t tell you to buy, sell or how much. It marks what is on record and what is only a possibility, and you can correct it.
              </p>
            </div>
            <figure className="jw-talk" data-wipe>
              <p className="jw-talk__you">Why do my Fridays keep going wrong?</p>
              <p className="jw-talk__it">
                <span>Recorded:</span> 6 of your 9 Friday trades closed at a loss, and you marked &ldquo;followed plan: no&rdquo; on 5 of them [#41, #44].
              </p>
              <p className="jw-talk__it">
                <span>Possible pattern:</span> this could mean Friday is when the plan slips. Does that match how it felt?
              </p>
              <figcaption>Illustration. A made-up exchange.</figcaption>
            </figure>
          </section>
        </div>

        <section id="limits" className="jw-limits" aria-labelledby="jw-limits-title">
          <div className="jw-limits__paper">
            <h2 id="jw-limits-title">Plainly.</h2>
            <dl>
              <div>
                <dt>Where it runs</dt>
                <dd>On your own computer. Your journal is a database file on your disk, and Jarvis only answers on that machine.</dd>
              </div>
              <div>
                <dt>MT5</dt>
                <dd>Read-only, through your investor password. Jarvis can read your trades. It can&rsquo;t place, change or close one.</dd>
              </div>
              <div>
                <dt>The coach</dt>
                <dd>Connect a cloud model with your own API key and your questions, plus the parts of your record needed to answer them, go to that provider. Leave the key out and the coach stays in a limited demo mode that sends nothing.</dd>
              </div>
              <div>
                <dt>Advice</dt>
                <dd>There isn&rsquo;t any. This is a journal, not financial advice. Trading carries risk, and it can lose you money.</dd>
              </div>
            </dl>
          </div>
        </section>

        <section id="open" className="jw-close jw-ruled" aria-labelledby="jw-close-title" data-close>
          <div className="jw-close__line">
            <h2 id="jw-close-title">The next line is yours.</h2>
            <Link className="jw-cta" href="/login" prefetch={false}>
              Open Jarvis
            </Link>
          </div>
          <div className="jw-double" aria-hidden="true">
            <i data-double />
            <i data-double />
          </div>
        </section>
      </main>
      <WelcomeMotion />
    </div>
  );
}
