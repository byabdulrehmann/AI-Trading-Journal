---
name: Jarvis
description: A private, local trading journal that turns a trader's own record into clear, honest figures.
colors:
  canvas: "#f4f5f8"
  surface: "#ffffff"
  raised: "#f7f8fb"
  sunken: "#eef0f4"
  line: "#e6e8ee"
  line-strong: "#cfd3dc"
  ink: "#1d1f2e"
  ink-soft: "#3d4154"
  muted: "#6e7387"
  accent: "#5b4fe8"
  accent-ink: "#ffffff"
  profit: "#13906a"
  profit-soft: "#dbf2e9"
  profit-strong: "#b7e4d1"
  loss: "#d23c55"
  loss-soft: "#f9d3d6"
  loss-strong: "#f2b0b6"
  warn: "#9a6a00"
  info: "#3d63c9"
  nav-bg: "#1b1d3d"
  nav-bg-end: "#231f49"
  scale-low: "#e2475b"
  scale-mid: "#f2b630"
  scale-high: "#2fb07d"
typography:
  page-title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.2
  kpi-value:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.015em"
  card-title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
rounded:
  xs: "3px"
  sm: "4px"
  control: "6px"
  lg: "8px"
  panel: "10px"
  pill: "999px"
spacing:
  3xs: "2px"
  2xs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  card-gap: "21px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    height: "34px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "36px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "16px"
  sidebar:
    backgroundColor: "{colors.nav-bg}"
    textColor: "#ffffffe6"
    width: "196px"
  topbar:
    backgroundColor: "{colors.surface}"
    height: "62px"
---

# Design System: Jarvis

The tokens above are the light theme, which is the default. The source of truth is `src/app/tokens.css`; this file describes it. When the two disagree, the CSS wins: update this file, never the other way round. The dashboard layout is specified in `docs/dashboard-visual-spec.md`.

## Overview

Jarvis is a financial instrument that a trader opens every day, so it is calm, dense and exact. The visual language is a light grey canvas holding white, softly rounded cards; a deep navy sidebar anchors the app, and one violet accent marks what can be acted on. Green and red are reserved for money: profit and loss are read before anything else on the screen.

Every number comes from the user's own record. Nothing on screen is decoration pretending to be data.

## Colors

### Primary
- **Violet accent** (`#5b4fe8`): primary buttons, the active tab, the score radar, the today marker, focus rings. One accent, used sparingly.

### Neutral
- **Canvas** (`#f4f5f8`) behind everything, **surface** (`#ffffff`) for cards, **sunken** (`#eef0f4`) for wells, pills and empty calendar days.
- **Ink** (`#1d1f2e`) for text, **ink-soft** for secondary text, **muted** (`#6e7387`) for labels and axes.
- **Navy** (`#1b1d3d` to `#231f49`) only for the sidebar, in both themes.

### Named Rules
- **Money colours are semantic.** `profit` and `loss` (and their soft and strong fills) mean a result went up or down. Never use them for decoration, branding or status that isn't money.
- **No colour without a token.** Every colour comes from `tokens.css` through a Tailwind theme name (`bg-surface`, `text-loss`, and so on).
- A dark theme exists (navy surfaces, the same roles) and is chosen in Settings; build every surface from tokens so it follows.

## Typography

One family, Geist, at 400, 500 and 600. Numbers use tabular figures (`.num`).

### Hierarchy
- Page title 20px/600 in the top bar.
- KPI values 22px/600 (19px in narrow cards).
- Card titles 14px/600.
- Body 15px/400; table text 12.5 to 13.5px; labels 12.5px/500 in muted ink; axis ticks 10.5px.

## Layout

- Sidebar 196px (56px collapsed), top bar 62px, content inset 22px, cards 21px apart.
- The dashboard is a fixed composition: a status row, five KPI cards, three analytics cards, then trades and the month calendar. See `docs/dashboard-visual-spec.md`.
- Components size from their own width (container queries) where the sidebar can squeeze them, not from the window.
- Everything works from 320px to 1920px; `e2e/responsive.spec.ts` fails if anything leaves the screen or its card.

## Elevation & Depth

Flat. Cards carry a 1px `line` border and a barely visible shadow (`--card-shadow`); menus and dialogs use a stronger shadow. No glows, no glass, no gradients except the navy sidebar and the score's red-amber-green scale.

## Shapes

Controls 6px, cards 10px, pills fully round, calendar cells 5px. Nothing sharp-cornered, nothing bubbly.

## Components

### Buttons
Primary: violet fill, white text, 34 to 36px tall. Secondary: white with a 1px line border. Ghost for low-emphasis actions. Every button has a visible focus ring.

### Cards / Containers
`Card` (white, 10px radius, line border). Headers are 44px with a divider under the title. KPI cards are 112px tall.

### Navigation
Navy sidebar with grouped links, an active pill, a "NEW" chip and "Soon" for unbuilt modules (never a dead link). The top bar holds the page title, page controls and the bell.

### Charts
Thin marks, recessive dashed grid, currency axes, a hover tooltip on every chart, keyboard scrubbing, and a click that opens the day or trade behind a mark.

### Interaction
Ctrl-K palette in the shell. Journal rows move with `j` and `k` and open with Enter; `/` focuses search; `n` logs a trade (never while typing in a field). Filters, ranges and the open trade live in the URL; per-browser preferences (sidebar, calendar month, columns) live in local storage through `useStored`.

## Do's and Don'ts

### Do:
- Reuse `src/components/ui.tsx`, `Dropdown.tsx` and the dashboard's `Board.tsx` pieces before writing new ones.
- Show real figures or an honest empty state; label sample data as sample. Unknown stays a dash with its reason.
- Give every data region a loading, empty, error and full state.
- Label a time shown to the minute with its zone once on the screen ("local time" or the broker's).
- Put `:focus-visible` on everything interactive, and a 44px hit target on touch.
- Animate only `transform` and `opacity`, with `--dur-micro` or `--dur-short` on `--ease-out`, and honour `prefers-reduced-motion` (handled in `base.css`).
- Keep `npm run lint`, `npx tsc --noEmit`, `npm test` and the Playwright suite green.

### Don't:
- Don't invent metrics, testimonials or prices.
- Don't use profit or loss colours for anything but money.
- Don't add a second accent colour, a second font family, or a raw hex value outside `tokens.css`.
- Don't use `transition: all`, em dashes in UI copy, or tracked all-caps labels outside the dashboard's existing tab and score labels.
- Don't change the dashboard layout without being asked.

History: this file replaced the earlier "Rim" system lock (dark, square, monospace figures) on 2026-11-10, after the redesign to the current look. The old version is in git history.
