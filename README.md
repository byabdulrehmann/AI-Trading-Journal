# Jarvis

A local-first trading journal with a reflective AI companion, **Trading Jarvis**.
Log or import trades, see analytics with their formulas, spot behavioural patterns
backed by evidence, and talk them through with Jarvis.

Jarvis is an educational journaling tool. It never places trades and does not
give financial, investment or psychological advice.

## Run it locally

Requirements: **Node.js 24.22.1+ or 26.12.1+** (uses the built-in `node:sqlite`) and npm.

```bash
npm install
cp .env.example .env.local   # optional: add ANTHROPIC_API_KEY for Jarvis
npm run dev                  # http://localhost:3000
```

Production build: `npm run build && npm start`.

Tests: `npm test` covers profit, CSV import, partial updates and currency totals
(`src/lib/domain/domain.test.ts`, Node's built-in runner, no extra dependencies).

First run: the Overview offers three starts — log a trade, import a CSV, or load
the sample journal (65 trades, clearly badged "Sample", removable in Settings).

## Stack and structure

Next.js 16 (App Router) · React 19 · Tailwind CSS v4 · TypeScript · Zod · SQLite (`node:sqlite`) · `@anthropic-ai/sdk`.
The repository was empty, so this stack keeps everything in one process with no
external database to install, while leaving room for auth and hosting later.

```
src/
  app/                 pages (client components) and api/ route handlers
  components/          UI: shell, primitives, charts, journal, jarvis
  lib/domain/          pure logic: types + validation, P&L/R math, metrics, patterns, CSV
  lib/server/db.ts     SQLite connection + versioned migrations
  lib/server/repo/     persistence (journal, settings, jarvis, activity)
  lib/server/market/   MarketDataProvider interface + demo adapter
  lib/server/ai/       JarvisProvider interface, registry, context builder, prompt, providers
  lib/client/          fetch helpers, formatting, app state
docs/FEATURE_MATRIX.md feature checklist vs. the reference product
```

## Data storage

- One SQLite file: `data/kestrel.db` (override with `KESTREL_DB_PATH`). Ignored by git.
- Schema is created by append-only migrations in `src/lib/server/db.ts`; applied
  versions are recorded in `schema_migrations`.
- Tables: `accounts`, `trades` (soft-delete for undo, permanently removed after 30 days, `source` = manual/csv/sample,
  `import_batch` for undoing imports), `settings` (one JSON row), `jarvis_memories`,
  `jarvis_conversations`, `jarvis_messages`, `activity_log`.
- P&L, R multiple and planned R are derived on read, never stored:
  P&L = (exit − entry) × direction × size × multiplier − fees; R = P&L ÷ (|entry − stop| × size × multiplier).
- Settings → Your data: export everything as JSON, remove sample data, or delete all data
  (requires typing `DELETE`).

Jarvis has local accounts: the first one created owns the existing data, and anyone who can
reach this computer can sign up for their own private journal at `/signup`. Jarvis can't send
email, so each account gets a one-time recovery code at sign-up (a new one from Settings →
Recovery code) and `/forgot-password` resets the password with it. `npm run dev` and `npm start`
listen on `127.0.0.1` only, and `src/proxy.ts` answers only on a loopback host and refuses
changes sent by other sites. It isn't built for a network: there's no HTTPS, and loosening
these checks would expose your journal, your MT5 connection and TradBot-I. Anyone who can
read your Windows profile can read your data; the investor password's key is kept in
`%LOCALAPPDATA%\Jarvis`, apart from the database, so a copied project folder doesn't carry it.

CSV import: choose a number format and a date format if the file needs them. Rows
that could be read two ways (`1,085`, `03/10/2026`) stay out of the import until you
do. For files that give size in lots or contracts, map a contract size column or enter
a contract size per symbol; check the Net P&L in the preview before importing. Rows the
account already holds (same symbol, side, open time, entry and size) are skipped, so
overlapping exports are safe; identical rows within one file are kept as partial fills.
A swap column counts credits as positive, so fees can go negative.

Accounts in different currencies are never added together: Overview, Analytics,
Patterns and Jarvis's totals cover one currency at a time, with a picker when you have more
than one. If `npm run dev` keeps reloading the page after code changes, restart it.

## Trading Jarvis

### Providers and models

| Provider | Status | Needs |
|---|---|---|
| Demo mode | Always available, offline | Nothing. Replies are fixed templates filled from your own computed records. |
| Anthropic (Claude) | Wired; streaming, cancellation, 60 s per-attempt timeout, 2 retries, 120 s overall cap | `ANTHROPIC_API_KEY` in `.env.local`, then restart |

- Models are **discovered** from the provider's Models API (cached 10 min); Jarvis
  only offers models the key can actually see. Default: `claude-opus-5-5`
  (override with `KESTREL_ANTHROPIC_MODEL`). Server-side refusal fallbacks are
  enabled for models that support them.
- Switch in **Jarvis → Model**, or in chat: `/models`, `/model <id>`,
  "switch to sonnet", "switch to demo". A switch is validated against the
  discovered list; if the provider isn't configured or the model isn't available,
  Jarvis says why and keeps the current model. If an external provider fails
  mid-chat, a demo-mode reply is shown instead, labelled as such.
- The active provider and model are always shown in the chat header.
- To add a provider, implement `JarvisProvider` (`src/lib/server/ai/types.ts`) and
  register it in `src/lib/server/ai/registry.ts`. The UI needs no changes.
- Keys are read only on the server and never sent to the browser or logged.
  Chat content and journal notes are not logged.

### What Jarvis sends to an external provider

Controlled by Settings → Privacy → *Sharing with external AI providers*:

- **Metrics only** — totals, win rate, R statistics, detected pattern summaries.
- **Trades without notes** (default) — plus up to 25 recent trades: symbol, side,
  times, P&L, R, planned R, setup, feelings, plan flag, grade, sample flag.
- **Trades with notes** — plus your plan notes and written notes.

Always included: active memories (if memory is on), coaching style, display name,
and the last 20 messages of the conversation. Never sent: API keys, account
balances, the activity log. Settings shows a live preview of the exact list, and
each chat's "What's shared?" shows what the last request included. Demo mode sends nothing.

### What Jarvis records

- **Conversations** are stored locally; delete one or all from the Jarvis page.
- **Memories** exist only when you save them ("Remember something from this" or
  Jarvis → Memory). You can correct, pause, resume, delete, reset all, or export them.
  Pausing memory stops them being sent.
- **Activity log** is **off by default**. When you opt in, it records only:
  trade created/updated/deleted (ids and changed field names), CSV imports (row
  count), Jarvis messages (length only, never text), and setting changes (names).
  No page views, clicks, keystrokes or timing. It stays local and isn't sent to
  Jarvis. View, pause or delete it in Settings → Privacy.

### Boundaries (enforced in the system prompt and UI copy)

Jarvis uses only your records, labels lines as **Recorded / Possible pattern /
Suggestion**, cites trades as `[#id]` (clickable), says when data is missing,
never gives buy/sell instructions or urges trading, never claims to see markets,
and phrases behavioural readings tentatively. Patterns can be dismissed, and
behavioural insights can be switched off entirely.

## TradBot-I integration (your own Jarvis)

Jarvis can drive your existing **TradBot-I** Jarvis, the PyQt6 + Gemini Live desktop
assistant, as the same assistant with the same personality, tools, memory, MT5
trading monitor and voice. TradBot-I's code is used unchanged: Jarvis connects
to the remote dashboard TradBot-I already runs (`dashboard/server.py`, port 8000),
as one more paired client alongside the phone dashboard.

Open it from **Jarvis → TradBot-I live**, or the **TradBot-I live** switch in the Jarvis side panel.
The built-in journal coach stays separate and keeps working when TradBot-I is stopped.

### Run both

```bash
# 1) TradBot-I, in its own folder (first run: python setup.py)
cd TradBot-I-main
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
python main.py

# 2) Jarvis, in another terminal
cd kestrel
npm run dev
```

Then pair once per TradBot-I launch:

1. In the TradBot-I window press **Remote Control**. It shows a QR code and a 6-character key (single use, 10 minutes).
2. In Jarvis → Jarvis → TradBot-I live, type the key and press **Pair**.

TradBot-I keeps pairings in memory, so after it restarts Jarvis shows
"no longer recognises this pairing" and asks for a new key.

> **TradBot-I patch needed for Auto-Start / `pythonw.exe`.** TradBot-I's Auto-Start on
> Boot registers a `JARVIS_AI` startup entry that runs `pythonw.exe` (no console). Unpatched,
> `sys.stdout` is `None` there and uvicorn's log setup raises
> `AttributeError: 'NoneType' object has no attribute 'isatty'`. The dashboard task dies
> silently, nothing listens on port 8000, and both Jarvis and TradBot-I's phone Remote
> Control can't connect. Fix (applied to the local copy on 2026-11-03; original backed up
> as `dashboard-server.py.backup-2026-11-03` next to the TradBot-I folder): add
> `log_config=None` to the two `uvicorn.Config(...)` calls in `dashboard/server.py`.
> Without the patch, start TradBot-I with `python.exe main.py` instead. Run only one copy
> at a time. (On Windows each run shows two `pythonw.exe` processes, the venv
> launcher and its interpreter; that's one copy.)

### How it's wired

| Browser (Jarvis UI) | Jarvis server (`src/lib/server/tradbot/bridge.ts`) | TradBot-I dashboard |
|---|---|---|
| `POST /api/tradbot/pair {pin}` | `POST /login` → bearer token, stored server-side in SQLite (`settings.tradbot_session`) | issues token |
| `POST /api/tradbot/command {text}` | `POST /api/command` | queued into the live Gemini session (`_process_dashboard_commands`) |
| `GET /api/tradbot/events` (SSE) | one WebSocket to `/ws` | `log` (user/jarvis transcripts), `status`, `sys` events |
| `POST /api/tradbot/audio` (PCM16 chunks) | WebSocket to `/ws/phone-audio` | fed into the live session (`_relay_phone_audio`) |
| `GET /api/tradbot/status` | probes `GET /login` | — |

The bearer token never reaches the browser, logs or the JSON export. Set
`TRADBOT_URL` if TradBot-I's dashboard isn't on `http://127.0.0.1:8000`.

### Voice

- **Input:** the mic button captures your browser microphone, converts it to
  16 kHz mono PCM16 exactly as TradBot-I's own phone dashboard does, and streams it
  into TradBot-I's live session. While it streams, TradBot-I mutes its PC mic. It also
  ignores incoming audio while it is speaking, which is its existing echo guard.
  Browsers allow microphone access on `http://localhost`. Jarvis doesn't accept
  connections from other devices (see Data storage).
- **Output:** TradBot-I speaks through the **speakers of the computer running it**, in
  the voice selected in its HUD (Charon, Puck, Kore, Fenrir or Aoede, saved in its own
  config). Its dashboard API doesn't stream reply audio, so Jarvis shows the reply text
  and doesn't fake a voice in the browser. If you use Jarvis on another device, you'll
  read replies there but hear them at the TradBot-I computer.
- Voice choice, audio devices, push-to-talk, wake settings and trading settings are
  changed in TradBot-I's ⚙ drawer. Jarvis doesn't touch its config file, which also
  holds its Gemini key.

### What TradBot-I supports through Jarvis

| Capability | Through Jarvis | Notes |
|---|---|---|
| Typed conversation with TradBot-I's persona and tools | Yes | Replies arrive as text when its turn completes (not token-streamed) |
| Voice input | Yes | Browser mic → its live session |
| Voice output in its own voice | Yes, on the TradBot-I computer | Not streamed to the browser |
| Proactive messages, check-ins, alerts it speaks | Shown as they're logged | Same feed as its phone dashboard |
| Model switching | No | TradBot-I uses one fixed model (`LIVE_MODEL = gemini-3.1-flash-live-preview`); its `core/llm_client.py` isn't wired into the app |
| Voice switching | In TradBot-I's HUD | 5 Gemini voices; not exposed by its dashboard API |
| Confirming shutdown/restart/Wi-Fi | In TradBot-I's window only | Its confirmation gate is UI-issued by design |
| MT5 monthly history, file upload | Not surfaced yet | Its dashboard has `/api/trading/monthly` and `/api/upload`; Jarvis doesn't call them yet |

### Requirements and privacy

TradBot-I needs Python 3.11–3.13, its dependencies (`python setup.py`), a Gemini key
from its first-run setup, plus a microphone and speakers. MT5 features need its own
MT5 setup. Anything you type or say to it is sent to Google Gemini by TradBot-I,
as its README describes. Jarvis shares nothing else with it: not your Jarvis
journal, memories or settings. With activity recording on, Jarvis logs only the
length of messages you type to TradBot-I.

## Market context (demo only)

`/market` uses `demoMarketProvider`, a deterministic **simulated** series. Every
screen showing it carries a "Simulated" banner and the provider's disclosure. To
use real data, implement `MarketDataProvider` (`src/lib/server/market/types.ts`)
with a licensed feed, report `dataKind` honestly (`delayed` / `live`), and return it
from `marketProvider()`.

## Accessibility and responsiveness

Skip link, visible focus rings, native `<dialog>` (focus trap, Esc), labelled
controls, `aria-live` for chat and toasts, sortable table headers with `aria-sort`,
reduced-motion support, dark/light/system themes. Layouts were checked at
375 px (phone) and desktop widths with no horizontal page scroll.

## Known limitations

- No broker sync (MT5, TradeLocker, Tradovate, cTrader need credentials/OAuth apps); use CSV import.
- No live market data, news feed, X feed or daily reports (need licensed data).
- No auth, billing, community, or copy trading (see `docs/FEATURE_MATRIX.md`).
- Single local user; no multi-device sync.
- Demo-mode Jarvis can't filter by date and only answers a few question types.
- Only the Anthropic provider is wired; its live path was not exercised in review
  because no API key was configured.
- TradBot-I: pairing and typed conversation verified live against a running
  `python main.py` session with Gemini. Voice input through the browser mic couldn't be
  tested in the review browser (microphone blocked); its server-side path was verified
  with synthetic PCM against TradBot-I's real dashboard code. TradBot-I doesn't
  broadcast typed dashboard messages, so Jarvis shows your typed messages from its
  own copy; they don't appear on TradBot-I's phone dashboard.
- No automated test suite yet; domain math was verified through the API during review.
- In `next dev`, React logs a warning about the inline theme script in `<head>`;
  it's the pattern Next.js documents for avoiding a theme flash.
