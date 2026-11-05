/** Single-stroke digits drawn for this page, in a 60x100 cell (the advance of IBM Plex Mono), so the pencil and the print line up. */
const GLYPHS: Record<string, string[]> = {
  "0": ["M34 20C20 20 12 38 12 54 12 72 20 82 30 82 42 82 48 64 48 46 48 30 44 20 33 21"],
  "1": ["M19 33 33 19 30 83"],
  "2": ["M13 34C15 24 24 18 33 19 44 20 48 30 44 40 38 54 24 68 11 81 24 78 38 78 50 80"],
  "3": ["M14 28C22 18 42 16 44 30 45 42 32 46 24 48 38 46 50 52 48 66 46 80 24 86 11 74"],
  "4": ["M36 18C28 34 20 46 11 58 24 57 38 56 52 55", "M40 30 37 84"],
  "5": ["M45 20 20 21 16 46C26 40 42 42 47 54 50 70 36 84 22 82 17 81 13 78 11 74"],
  "6": ["M40 18C26 28 14 46 14 62 14 76 24 83 33 82 44 80 48 68 44 58 38 48 24 50 16 60"],
  "7": ["M12 22C24 20 36 20 50 20 38 40 30 60 25 84"],
  "8": ["M44 30C42 20 24 14 18 26 12 38 26 44 34 50 46 58 48 72 38 80 28 86 12 80 14 64 16 52 34 44 40 38 44 34 45 32 44 30"],
  "9": ["M46 34C44 22 26 16 18 28 12 40 20 52 32 50 40 48 45 42 46 34 47 52 44 70 36 84"],
  ".": ["M29 79 30 81"],
  "−": ["M12 50 48 49"],
  "=": ["M12 41 48 40", "M12 60 48 59"],
  "×": ["M16 36 44 66", "M44 36 16 66"],
};

/** Stroked left to right as scroll advances. The default is fully drawn, so no script means a finished sum. */
export function Hand({ text, exact, className }: { text: string; exact?: boolean; className?: string }) {
  // Hands close up around points and spaces. `exact` keeps every character on the print's grid, for the figure the print lands on.
  const advance = (ch: string) => (exact ? 60 : ch === "." ? 30 : ch === " " ? 26 : 56);
  const chars = [...text];
  let x = 0;
  const width = chars.reduce((w, ch) => w + advance(ch), 0);
  return (
    <svg className={`jw-hand ${className ?? ""}`} viewBox={`0 0 ${width} 100`} style={{ width: `${width / 100}em` }} aria-hidden="true">
      {chars.map((ch, i) => {
        // Deterministic wobble: each digit sits a little differently, the way a hand writes.
        const seed = (ch.charCodeAt(0) * 7 + i * 13) % 9;
        const at = x - (ch === "." && !exact ? 15 : 0);
        x += advance(ch);
        return (
          <g key={i} transform={`translate(${at + (seed - 4) * 0.5} ${(seed - 4) * 0.7}) rotate(${(seed - 4) * 0.6} 30 50)`}>
            {(GLYPHS[ch] ?? []).map((d) => (
              <path key={d} d={d} pathLength={1} data-stroke="" />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
