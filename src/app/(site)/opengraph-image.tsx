import { ImageResponse } from "next/og";

export const alt = "Jarvis, trading intelligence from your own record";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Drawn from shapes only: no fonts or images to fetch, so it renders with the network off.
const CANDLES = [[0.62, 0.3, 1], [0.55, 0.34, 0], [0.58, 0.38, 1], [0.5, 0.42, 1], [0.44, 0.36, 0], [0.4, 0.4, 1], [0.33, 0.48, 1], [0.37, 0.5, 0], [0.29, 0.52, 1], [0.22, 0.56, 1]];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: "#e6e9ee", color: "#10131a", fontFamily: "sans-serif" }}>
        <div style={{ position: "absolute", inset: 0, display: "flex", background: "radial-gradient(ellipse 70% 60% at 85% 20%, rgba(140,130,255,0.28), transparent 65%)" }} />
        {CANDLES.map(([top, h, up], i) => (
          <div key={i} style={{ position: "absolute", right: 80 + i * 46, top: `${top * 100}%`, width: 26, height: `${h * 50}%`, borderRadius: 5, display: "flex", background: up ? "#b9c9ea" : "#e6aebb", opacity: 0.85 - i * 0.06 }} />
        ))}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 72, gap: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: "#151821", display: "flex" }} />
            <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>Jarvis</div>
          </div>
          <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: -3, lineHeight: 1, maxWidth: 760 }}>Your trades. Your intelligence. Your edge.</div>
          <div style={{ fontSize: 28, color: "#434a58" }}>A private trading journal with read-only MT5 sync.</div>
        </div>
      </div>
    ),
    size,
  );
}
