---
name: Jarvis
description: A private, local trading journal that turns a trader's own record into clear, honest figures.
colors:
  canvas: "#e6e9ee"
  surface: "#f3f5f8"
  raised: "#eaedf2"
  sunken: "#dde1e8"
  glass: "rgb(255 255 255 / 0.6)"
  line: "rgb(22 28 45 / 0.08)"
  line-strong: "rgb(22 28 45 / 0.16)"
  ink: "#10131a"
  ink-soft: "#3c4350"
  muted: "#5c6475"
  accent: "#3d5bd1"
  accent-ink: "#ffffff"
  profit: "#2f7d5f"
  profit-soft: "#d3e8de"
  profit-strong: "#b1d6c4"
  loss: "#b2445b"
  loss-soft: "#f0d5db"
  loss-strong: "#e4b3bf"
  warn: "#8a6100"
  info: "#3d5bd1"
  nav-bg: "rgb(255 255 255 / 0.5)"
  nav-bg-end: "rgb(255 255 255 / 0.32)"
  scale-low: "#c04f66"
  scale-mid: "#c9963a"
  scale-high: "#3f8f72"
typography:
  page-title:
    fontFamily: "Bricolage Grotesque, Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "21px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  page-heading:
    fontFamily: "Bricolage Grotesque, Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: "-0.03em"
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
  control: "10px"
  lg: "8px"
  panel: "18px"
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
    backgroundColor: "{colors.glass}"
    rounded: "{rounded.panel}"
    padding: "16px"
  sidebar:
    backgroundColor: "{colors.nav-bg}"
    textColor: "{colors.ink}"
    width: "196px"
  topbar:
    backgroundColor: "{colors.glass}"
    height: "62px"
---

# Design System: Jarvis

The tokens above are the pearl (light) theme, the default. The source of truth is `src/app/tokens.css`; this file describes it. When the two disagree, the CSS wins: update this file, never the other way round.

## Overview

Jarvis is a financial instrument that a trader opens every day, so it is calm, dense and exact. Since 2026-11-12 it shares the website's world, the **glass studio**: a soft pearl room (obsidian at night) lit from the top left, frosted-glass cards and bars floating in it, and controls that look softly pressed out of the surface. One steel-blue accent marks what can be acted on. Green and red are reserved for money, and both are softened so the screen never feels saturated.

Every number comes from the user's own record. Nothing on screen is decoration pretending to be data.

## Colors

### Primary
- **Steel blue** (`#3d5bd1`, `#8ea6ff` at night): primary buttons, the active tab, the score radar, the today marker, focus rings. One accent, used sparingly. At night it carries dark ink (`accent-ink`), never white.

### Neutral
- **Canvas** (`#e6e9ee`) with the `--room` light over it, **glass** (white at 60%) for cards and the top bar, **surface** (`#f3f5f8`) for solid controls, menus and dialogs, **raised** and **sunken** for wells and empty calendar days.
- **Ink** (`#10131a`) for text, **ink-soft** for secondary text, **muted** (`#5c6475`) for labels and axes.
- **Obsidian** (dark): canvas `#0b0d12`, glass white at 3.5%, ink `#eef1f7`.

### Named Rules
- **Money colours are semantic.** `profit` and `loss` (and their soft and strong fills) mean a result went up or down. Never use them for decoration, branding or status that isn't money.
- **No colour without a token.** Every colour comes from `tokens.css` through a Tailwind theme name (`bg-glass`, `text-loss`, and so on).
- **Text on the accent is `text-accent-ink`**, never `text-white`, so it stays readable in both themes.
- The theme is the Theme setting (System, Dark, Light); the sun/moon button in the top bar flips it and saves the same setting.

## Typography

Geist at 400, 500 and 600 for everything people read and every figure (tabular, `.num`). Bricolage Grotesque 500 only for the page title in the top bar and page headings (`h1`), tightly tracked, the same display face as the website.

### Hierarchy
- Page title 21px/500 Bricolage in the top bar; page heading 30px/500 Bricolage.
- KPI values 22px/600 (19px in narrow cards).
- Card titles 14px/600.
- Body 15px/400; table text 12.5 to 13.5px; labels 12.5px/500 in muted ink; axis ticks 10.5px.

## Layout

- Sidebar 196px (56px collapsed), top bar 62px, content inset 22px, cards 21px apart.
- The dashboard is a fixed composition: a status row, five KPI cards, three analytics cards, then trades and the month calendar.
- Components size from their own width (container queries) where the sidebar can squeeze them, not from the window.
- Everything works from 320px to 1920px; `e2e/responsive.spec.ts` fails if anything leaves the screen or its card.

## Elevation & Depth

Three materials, each with one job:
- **Liquid glass** for things that float: cards (`bg-glass` with a bright top rim in `--card-shadow`) and the sidebar and top bar (`.glass-bar`, frosted with a backdrop blur). The blur sits on a pseudo-element so a bar never traps fixed popovers.
- **Soft (neumorphic) controls** for things you press: `.neu` raises secondary buttons, the round top-bar buttons and the active nav link; `.neu-in` sinks inputs and segmented controls into the surface. Pressing a `.neu` control sinks it.
- **Solid surface** for things that must stay readable over content: menus, dialogs (over a blurred scrim), tooltips.

Primary buttons carry a soft glow of their own accent underneath. No other glows.

## Shapes

Controls 10px, cards 18px, pills and round buttons fully round, calendar cells 5px.

## Components

### Buttons
Primary: steel-blue fill, accent-ink text, a soft accent shadow, 34 to 36px tall. Secondary: a soft raised `.neu` key on the surface colour. Ghost for low-emphasis actions. Every button has a visible focus ring.

### Cards / Containers
`Card` and the dashboard's `panel` (glass, 18px radius, hairline border, rim highlight). Headers are 44px with a divider under the title. KPI cards are 112px tall.

### Inputs
`inputClass`: a sunken `.neu-in` well on `raised`, no visible border; invalid fields get a loss outline.

### Navigation
A pane of frosted glass on the left with grouped links; the active link is a raised white pill. A "NEW" chip and "Soon" for unbuilt modules (never a dead link). The top bar is frosted glass and holds the page title, page controls, the AI Coach button, the theme switch and the bell. The logo is a graphite tile with a steel-blue dot.

### Charts
Thin marks, recessive dashed grid, currency axes, a hover tooltip on every chart, keyboard scrubbing, and a click that opens the day or trade behind a mark. Chart colours read the tokens at draw time, so they follow the theme.

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
- Don't add a second accent colour, a third font family, or a raw hex value outside `tokens.css`.
- Don't put `backdrop-filter` directly on an element that contains fixed popovers; use `.glass-bar`.
- Don't make menus or dialogs glass: they sit over content and must stay solid.
- Don't use `transition: all`, em dashes in UI copy, or tracked all-caps labels outside the dashboard's existing tab and score labels.
- Don't change the dashboard layout without being asked.

History: on 2026-11-10 this file replaced the earlier "Rim" system lock (dark, square, monospace figures). On 2026-11-12 the navy-and-violet look was replaced by the glass studio to match the website. Older versions are in git history.
