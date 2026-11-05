# Design: Jarvis

The locked system. Every Hallmark run reads this first and screens share it. Change it on purpose; the file is the rule. `/welcome` has its own look and is exempt.

## System
- Genre: modern-minimal
- Shape: app screen
- Theme: Rim, night colourway: an instrument at night
- Axes: dark/grotesk-sans/warm · posture: committed
- Faces: Geist 400 and 500 for words; Geist Mono for every measurement. Switzer, Rim's face, isn't self-hostable under this app's CSP without vendoring, so Geist stands in.

## Tokens
`src/app/tokens.css` is the source of truth, in the project's names, exposed as Tailwind colours: canvas, surface, raised, sunken, line, line-strong, ink, ink-soft, muted, accent, accent-ink, accent-soft, focus, info, profit, loss, warn, each soft variant. No literal colour or font anywhere else. No hex in components; SVG uses `var(--token)`.

## Rules
- Nothing round. Depth by lightness only: no shadow, glass, blur or gradient. Hairlines divide; a card is a rule above a heading, not a box. Never a box in a box.
- Medium (500) is the heaviest weight. Heads are sentence case, one colour.
- Mono is for measurements only: money, prices, sizes, R, durations, dates, counts. Never for a head, a label or a paragraph. Labels and table heads are the body face, a step smaller, sentence case, never tracked capitals.
- Orange marks the primary action and the current selection, nothing else. Sky blue is the second state or a window. Green and red mean profit and loss and nothing else (waived from Rim, on the record).
- A time shown to the second or minute carries its zone once on the screen, "local time" or the broker's.
- One filled primary per screen or dialog. Secondaries are outlined. Controls 32 to 36px with a 44px hit target on touch.
- Tables before cards: sentence-case heads that never wrap, horizontal rules only, tabular mono numbers right aligned. On a phone, rows restack or the naming and acting columns stay in view.
- Figures: a figure and its label, in tabular mono. No icon tile, no trend arrow nobody measured, no invented number. Unknown stays a dash with its reason.
- Copy: no em dashes in copy, no middle-dot joined strings, no arrows glued to link text, no status dots for decoration, no eyebrows.
- Never `transition: all`; animate `transform` and `opacity` only, with `--dur-micro` or `--dur-short` on `--ease-out`. Motion is state, nothing orchestrated. Reduced motion is honoured in base.css.
- `:focus-visible` on everything interactive. Every data region has loading, empty, error and full. State lives in the URL.

## Signature
The Tape: an equity line over time with every closed trade as a tick beneath it. Scrub to read a trade, click to open it, drag across a stretch to filter the screen to it. Keyboard reachable, with a table alternative.

## Interaction
Ctrl-K palette in the shell. Journal rows navigate with `j` and `k`, open with Enter; `/` focuses search; `n` logs a trade (never while typing in a field). Analytics rows, bars and heatmap cells open the matching closed trades. The trade form draws a live price ladder from entry, stop, target and exit.

## Exports
`npm run lint` and `npx tsc --noEmit` and `npm test` must stay clean. Sweep with `node <hallmark>/scripts/sloplint.mjs src --genre modern-minimal --scope app`.
