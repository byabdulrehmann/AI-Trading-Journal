/**
 * Drawn illustrations of Jarvis's reports for the analytics act. They carry no numbers on purpose: the shapes come
 * from a fixed seeded walk, not from anyone's trades, and the page says so. Every mark is SVG on site tokens, drawn
 * in by CSS when its panel arrives (see .ch-* in site.css).
 */

// Mulberry32: a tiny seeded generator, so the drawings are identical on every load.
function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 600;
const H = 300;
const PAD = 24;

/** Daily results with a slight edge: a few more good days than bad. */
const DAYS = (() => {
  const r = seeded(7);
  return Array.from({ length: 44 }, () => (r() - 0.43) * (r() < 0.12 ? 2.6 : 1));
})();

function equityPath() {
  let y = 0;
  const pts = DAYS.map((d) => (y += d));
  const min = Math.min(0, ...pts);
  const max = Math.max(...pts);
  const sx = (W - PAD * 2) / (pts.length - 1);
  const sy = (H - PAD * 2) / (max - min);
  const xy = pts.map((v, i) => [PAD + i * sx, H - PAD - (v - min) * sy] as const);
  return { d: xy.map(([x, yy], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${yy.toFixed(1)}`).join(" "), end: xy[xy.length - 1], zero: H - PAD + min * sy };
}

function Equity() {
  const { d, end, zero } = equityPath();
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Illustration: an equity curve rising unevenly over two months">
      <line className="ch-rule" x1={PAD} x2={W - PAD} y1={zero} y2={zero} />
      <path className="ch-line" d={d} pathLength={1} />
      <circle className="ch-dot" cx={end[0]} cy={end[1]} r={5} />
    </svg>
  );
}

function Daily() {
  const max = Math.max(...DAYS.map(Math.abs));
  const bw = (W - PAD * 2) / DAYS.length;
  const mid = H / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Illustration: daily results as bars above and below zero">
      <line className="ch-rule" x1={PAD} x2={W - PAD} y1={mid} y2={mid} />
      {DAYS.map((v, i) => {
        const h = (Math.abs(v) / max) * (mid - PAD);
        return <rect key={i} className={v >= 0 ? "ch-bar" : "ch-bar ch-neg"} style={{ transitionDelay: `${i * 14}ms`, transformOrigin: `0 ${mid}px` }} x={PAD + i * bw + 1.5} y={v >= 0 ? mid - h : mid} width={bw - 3} height={Math.max(h, 1)} />;
      })}
    </svg>
  );
}

/** Distance below the running peak, day by day. */
const DD = (() => {
  let y = 0;
  let peak = 0;
  return DAYS.map((d) => {
    y += d;
    peak = Math.max(peak, y);
    return y - peak;
  });
})();

function Drawdown() {
  const dd = DD;
  const min = Math.min(...dd);
  const sx = (W - PAD * 2) / (dd.length - 1);
  const pts = dd.map((v, i) => `${(PAD + i * sx).toFixed(1)} ${(PAD + (v / min) * (H - PAD * 2)).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Illustration: drawdown from the running peak, deepest in the middle stretch">
      <defs>
        <pattern id="ch-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line className="ch-hatch" x1="0" y1="0" x2="0" y2="6" />
        </pattern>
      </defs>
      <line className="ch-rule" x1={PAD} x2={W - PAD} y1={PAD} y2={PAD} />
      <path className="ch-area" d={`M${PAD} ${PAD} L${pts.join(" L")} L${W - PAD} ${PAD} Z`} fill="url(#ch-hatch)" />
      <path className="ch-line ch-line-neg" d={`M${pts.join(" L")}`} pathLength={1} />
    </svg>
  );
}

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri"];
function Heatmap() {
  const r = seeded(21);
  const hours = 12;
  const cw = (W - PAD * 2 - 44) / hours;
  const ch = (H - PAD * 2) / WEEK.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Illustration: results by weekday and hour, strongest in the morning sessions">
      {WEEK.map((d, row) => (
        <g key={d}>
          <text className="ch-text" x={PAD} y={PAD + row * ch + ch / 2 + 4}>{d}</text>
          {Array.from({ length: hours }, (_, col) => {
            // Mornings lean good, late hours lean bad, with noise.
            const v = (hours / 2 - col) / hours + (r() - 0.5) * 0.9;
            return <rect key={col} className={v >= 0 ? "ch-cell" : "ch-cell ch-neg"} style={{ opacity: 0.18 + Math.min(1, Math.abs(v)) * 0.75, transitionDelay: `${(row + col) * 22}ms` }} x={PAD + 44 + col * cw + 2} y={PAD + row * ch + 2} width={cw - 4} height={ch - 4} rx={2} />;
          })}
        </g>
      ))}
    </svg>
  );
}

function Distribution() {
  // R-multiples: a pile of small losses near −1R and a long right tail.
  const counts = [2, 5, 14, 9, 4, 6, 7, 5, 3, 2, 1];
  const max = Math.max(...counts);
  const bw = (W - PAD * 2) / counts.length;
  const base = H - PAD - 18;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Illustration: R-multiples clustered near minus one with a longer tail of winners">
      {counts.map((c, i) => {
        const h = (c / max) * (base - PAD);
        return <rect key={i} className={i < 4 ? "ch-bar ch-neg" : "ch-bar"} style={{ transitionDelay: `${i * 40}ms`, transformOrigin: `0 ${base}px` }} x={PAD + i * bw + 3} y={base - h} width={bw - 6} height={h} />;
      })}
      <line className="ch-rule" x1={PAD} x2={W - PAD} y1={base} y2={base} />
      <text className="ch-text" x={PAD} y={H - PAD + 4}>−2R</text>
      <text className="ch-text" x={PAD + bw * 3.5} y={H - PAD + 4} textAnchor="middle">0</text>
      <text className="ch-text" x={W - PAD} y={H - PAD + 4} textAnchor="end">+5R</text>
    </svg>
  );
}

const PLAYS = ["Opening range", "London breakout", "Pullback", "News fade"];
function Strategies() {
  const lens = [0.82, 0.55, 0.3, -0.38];
  const zero = PAD + 150;
  const span = W - zero - PAD;
  const rh = (H - PAD * 2) / PLAYS.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Illustration: four strategies compared, one of them losing">
      <line className="ch-rule" x1={zero} x2={zero} y1={PAD} y2={H - PAD} />
      {PLAYS.map((p, i) => {
        const w = Math.abs(lens[i]) * span * 0.9;
        const y = PAD + i * rh + rh * 0.28;
        return (
          <g key={p}>
            <text className="ch-text" x={PAD} y={y + rh * 0.26}>{p}</text>
            <rect className={lens[i] >= 0 ? "ch-hbar" : "ch-hbar ch-neg"} style={{ transitionDelay: `${i * 80}ms`, transformOrigin: `${zero}px 0` }} x={lens[i] >= 0 ? zero : zero - w} y={y} width={w} height={rh * 0.44} />
          </g>
        );
      })}
    </svg>
  );
}

export const CHARTS = [
  { key: "equity", title: "The equity curve", note: "Built from closed trades only. Floating P&L is never mixed in.", Chart: Equity },
  { key: "daily", title: "Daily P&L", note: "Each bar opens that day's journal.", Chart: Daily },
  { key: "drawdown", title: "Drawdown", note: "How far you are from your best point, and for how long.", Chart: Drawdown },
  { key: "time", title: "When you trade best", note: "Weekday and hour, in your own time zone.", Chart: Heatmap },
  { key: "r", title: "R-multiples", note: "Risk planned against risk taken, trade by trade.", Chart: Distribution },
  { key: "plays", title: "Strategy performance", note: "Your playbooks side by side.", Chart: Strategies },
] as const;
