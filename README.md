<div align="center">

<img src="docs/assets/hero.svg" alt="Dhan Drishti — All your money. One honest view." width="100%" />

<br/>

**Consolidate every broker into one normalized ledger — then see holdings, performance and net worth that always trace back to a real transaction.**

<br/>

![Tests](https://img.shields.io/badge/tests-313%20passing-3ec98a?style=flat-square&labelColor=0b0b0d)
&nbsp;![Money](https://img.shields.io/badge/money-never%20a%20float-f0b23e?style=flat-square&labelColor=0b0b0d)
&nbsp;![TypeScript](https://img.shields.io/badge/TypeScript-strict-5fb7a6?style=flat-square&labelColor=0b0b0d)
&nbsp;![Stack](https://img.shields.io/badge/React%20·%20Fastify%20·%20SQLite-informational-8c8fe0?style=flat-square&labelColor=0b0b0d)
&nbsp;![Self-hosted](https://img.shields.io/badge/self--hosted-privacy--first-d97757?style=flat-square&labelColor=0b0b0d)

</div>

---

Dhan Drishti turns a pile of broker exports into one clear picture of your wealth. Every figure on
the dashboard is **derived from your own transaction ledger** — nothing is placeholder, silently
faked or sent to a server you don't control.

## 🔭 How it works

From a messy folder of exports to one honest dashboard — each arrow is a step you can trace back.

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#141417','primaryTextColor':'#f3efe6','primaryBorderColor':'#26262c','lineColor':'#f0b23e','secondaryColor':'#1d1d22','tertiaryColor':'#18181c','fontFamily':'IBM Plex Sans, Segoe UI, sans-serif'}}}%%
flowchart LR
  A["Broker exports<br/>CSV · Excel · CAS PDF"] --> B{"Broker adapter"}
  B --> C[("Canonical ledger<br/>every transaction")]
  C --> D["Derived holdings<br/>avg cost · gains"]
  D --> E["Analytics<br/>XIRR · TWR · tax · benchmark"]
  E --> F["Dashboard"]
  M["Manual assets<br/>FD · gold · property"] --> D
  P["Prices · FX · news<br/>public tickers only"] -. refresh .-> D
  P -. refresh .-> E
  classDef accent fill:#f0b23e,stroke:#f0b23e,color:#16120a;
  classDef ledger fill:#1d1d22,stroke:#f0b23e,color:#f3efe6;
  class F accent
  class C ledger
```

**The import pipeline is atomic** — a file is detected, normalized, validated and classified, shown
to you as a preview, then committed all-or-nothing (and reconciled against the broker's own P&amp;L).

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#141417','primaryTextColor':'#f3efe6','primaryBorderColor':'#26262c','lineColor':'#f0b23e','secondaryColor':'#1d1d22','tertiaryColor':'#18181c','fontFamily':'IBM Plex Sans, Segoe UI, sans-serif'}}}%%
flowchart LR
  U["Upload file"] --> D["Detect broker"]
  D --> N["Normalize rows"]
  N --> V["Validate"]
  V --> C{"Classify"}
  C -->|new| L["Add to ledger"]
  C -->|duplicate| S["Skip — idempotent"]
  C -->|invalid| R["Report, never guess"]
  L --> PV["Preview counts"]
  PV --> K["Commit — atomic"]
  K --> DB[("SQLite")]
  classDef accent fill:#f0b23e,stroke:#f0b23e,color:#16120a;
  class K accent
```

**One process, your machine.** The browser talks to a single Fastify service that owns the database
and a pure calculation engine; only public identifiers ever reach the outside world.

```mermaid
%%{init: {'theme':'base','themeVariables':{'primaryColor':'#141417','primaryTextColor':'#f3efe6','primaryBorderColor':'#26262c','lineColor':'#f0b23e','secondaryColor':'#1d1d22','tertiaryColor':'#18181c','fontFamily':'IBM Plex Sans, Segoe UI, sans-serif','clusterBkg':'#101014','clusterBorder':'#26262c'}}}%%
flowchart TB
  subgraph BROWSER["Your browser"]
    W["React SPA<br/>Vite · Tailwind · shadcn/ui"]
  end
  subgraph HOST["Your machine · one process"]
    S["Fastify API<br/>argon2 auth · sessions"]
    CORE["Core engine<br/>pure · decimal.js"]
    DBx[("SQLite<br/>Drizzle + libsql")]
  end
  EXT["Public providers<br/>Yahoo · AMFI · FX · news"]
  W <-->|"REST /api"| S
  S --> CORE
  S --> DBx
  S -. "public tickers only" .-> EXT
  classDef accent fill:#f0b23e,stroke:#f0b23e,color:#16120a;
  class CORE accent
```

## ✨ Highlights

- 🔌 **Every broker, one ledger** — Zerodha, Dhan, Vested & Interactive Brokers (US), Binance
  (crypto), Excel (`.xlsx`) holdings, and a mutual‑fund **CAS PDF** (CAMS / KFintech — one
  password‑protected file covers every AMC), plus a generic column‑mapping importer. **Drop a file
  and it works out the rest**, reconciled against the broker's own P&amp;L. Imports are idempotent,
  deduped and **atomic**.
- 🧮 **Holdings you can trust** — average‑cost positions, invested value and realised gains derived
  from the ledger, a **diversification / concentration score**, and a per‑security detail page with
  a **stock‑style price chart** drawn from real history. Missing prices show `—`, never a fake `0`.
- 📈 **Honest performance** — realised gains by financial year, **XIRR**, a **time‑weighted return**
  valued at each trade from real historical prices, and a **benchmark overlay** that mirrors your
  exact cashflows into Nifty 50 / Sensex — a chart, not just a stat.
- 💰 **Full net worth** — holdings + cash + **manual assets** (FDs & bonds that **track their rate
  and maturity**, PPF / EPF / NPS, gold with **weight & purity**, real estate with **area &
  purchase date**), a **net‑worth‑over‑time** chart, and allocation by asset class, sector, **region**
  and currency. Foreign gains split into **asset vs. currency**.
- 🎯 **Plan, income & tax** — set **target weights** and see the drift in percent and rupees, a
  trailing **dividend yield** with an estimated payout calendar, and a **FIFO capital‑gains** report
  (short‑ vs long‑term) you can export as CSV for your ITR.
- 📰 **Markets in context** — a **live index strip** (Nifty 50 · Bank Nifty · Sensex · **USD / INR**)
  and a **News page** that surfaces headlines for what you actually hold, freshness‑stamped.
- ⚙️ **Fresh & installable** — prices refresh nightly in the background and on login; the UI is an
  installable **PWA** with an offline shell.
- 🔒 **Private by design** — runs on your machine; only public ticker symbols and company names ever
  leave it.

## 🖥️ The app

Six destinations; everything else lives under one of them.

| Destination | What's inside |
|---|---|
| 🏠 **Home** | Net‑worth headline + composition, the live index strip, net‑worth‑over‑time chart, allocation, top holdings, recent activity |
| 📦 **Portfolio** | **Positions** (avg cost, value, gains, filters), **Allocation** (class · sector · region · currency), a per‑**Security** detail page, and **Other assets** (FDs, bonds, gold, property…) |
| 🧾 **Activity** | The full ledger as a day‑by‑day **timeline**, plus **Dividends** — income by FY, trailing yield, forward calendar |
| 📈 **Performance** | **Returns** (realised gains, XIRR, TWR, benchmark overlay, diversification, FX impact), **Rebalance** (drift in % and ₹), and **Tax** (FIFO capital gains, CSV export) |
| 📰 **News** | Live index strip and headlines for your holdings, as tiles, freshness‑stamped |
| 👥 **Accounts** | Drop‑anything **import wizard**, and **People & accounts** — family members, brokers, portfolios & groups |

> **Settings** (data export, account delete, FX rates) sits alongside the six.

## 🧱 Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 19 + TypeScript + Vite (route‑level code‑split), Tailwind CSS v4, **shadcn/ui**, TanStack Query, Recharts |
| Design | Dark‑only, solid colours, one marigold accent · **IBM Plex Sans** (tabular figures) + **Instrument Serif** display |
| Backend | Node + Fastify · argon2id auth · session cookies |
| Data | SQLite via Drizzle ORM + libsql (WAL; dialect‑swappable to Postgres) |
| Money | `decimal.js` — exact decimals end to end, **never floats** |
| Core | A pure, deterministic, unit‑tested calculation engine (no I/O) |

### 🎨 Palette

One ink surface, warm ivory text, a single marigold accent, and six fixed asset‑class colours used
identically on every chart. Green/red are reserved for gain/loss and always paired with a sign.

![Ink](https://img.shields.io/badge/ink-%230b0b0d-0b0b0d?style=flat-square&labelColor=0b0b0d)
&nbsp;![Ivory](https://img.shields.io/badge/ivory-%23f3efe6-f3efe6?style=flat-square&labelColor=0b0b0d)
&nbsp;![Marigold](https://img.shields.io/badge/marigold-%23f0b23e-f0b23e?style=flat-square&labelColor=0b0b0d)
&nbsp;![Gain](https://img.shields.io/badge/gain-%233ec98a-3ec98a?style=flat-square&labelColor=0b0b0d)
&nbsp;![Loss](https://img.shields.io/badge/loss-%23f2665e-f2665e?style=flat-square&labelColor=0b0b0d)

**Asset classes** &nbsp;
![Equity](https://img.shields.io/badge/Equity-f0b23e?style=flat-square&labelColor=141417)
&nbsp;![Debt](https://img.shields.io/badge/Debt%20&%20bonds-5fb7a6?style=flat-square&labelColor=141417)
&nbsp;![Gold](https://img.shields.io/badge/Gold%20&%20commodities-d97757?style=flat-square&labelColor=141417)
&nbsp;![MF](https://img.shields.io/badge/Mutual%20funds-8c8fe0?style=flat-square&labelColor=141417)
&nbsp;![Cash](https://img.shields.io/badge/Cash-d9d2c3?style=flat-square&labelColor=141417)
&nbsp;![Other](https://img.shields.io/badge/Other-7fa66b?style=flat-square&labelColor=141417)

## ✅ Requirements

Dhan Drishti runs anywhere Node runs — **macOS, Windows or Linux**. You only need two tools (or just
Docker). Everything else is self‑contained.

| Need | Spec |
|---|---|
| **Node.js** | **20 or newer** (22 LTS recommended) |
| **pnpm** | **10+** — comes with Node via `corepack enable` |
| **Disk** | ~1.5 GB (dependencies) + your data in `./data` |
| **Memory** | 4 GB RAM is plenty |
| **Browser** | Any modern one — Chrome, Edge, Safari, Firefox |
| **Ports** | **4000** for the app (and **5173** in dev) |
| **Git** | Optional — only to clone or update |

<table>
<tr><th>🍎 macOS</th><th>🪟 Windows</th></tr>
<tr valign="top"><td>

1. Install Node 20+ from [nodejs.org](https://nodejs.org) **or** `brew install node`
2. `corepack enable` (turns on pnpm)
3. In the project folder: `./start.sh`

</td><td>

1. Install Node 20+ from [nodejs.org](https://nodejs.org) (includes Corepack)
2. In a terminal: `corepack enable` (turns on pnpm)
3. Double‑click **`start.bat`** (or run it)

</td></tr>
</table>

> **Prefer not to install anything?** With **Docker Desktop**, skip Node and pnpm entirely — see
> *Self‑host* below.

## 🚀 Run it (one command)

Syncs dependencies, builds the web app, starts the single‑service server (API + UI on one port), and
opens your browser once it's ready. Your data persists in `./data` across runs.

```bash
./start.sh          # macOS / Linux
```

On Windows, double‑click **`start.bat`** (or run it from a terminal).

> **Optional — the News page.** Copy `apps/server/.env.example` → `apps/server/.env` and add your
> Azure OpenAI key. Without it the app runs fine; News just stays quiet. Only company names and
> headlines are ever sent — never what you hold or how much.

## 🐳 Self‑host (single container)

The server serves the built SPA and the API on one port and runs DB migrations on boot.

```bash
docker compose up -d          # builds the image, runs on http://localhost:4000
```

The SQLite database lives in the `dhan-drishti-data` volume (`/data` in the container) — **back it
up by copying that file**. Each user can export their own data as JSON from Settings, or delete
their account (password‑confirmed). Set `SECURE_COOKIES=true` when serving behind HTTPS.

## 🔌 API

The web app is one client of a fully headless‑ready REST API.

- **Discovery** — `GET /api` lists every endpoint.
- **Contract** — `GET /api/openapi.json` (OpenAPI 3.1) loads straight into Swagger UI / Postman.
- **Reference** — see [`docs/API.md`](docs/API.md).

## 🔒 Security & privacy

argon2id password hashing · httpOnly `SameSite=Lax` session cookies · per‑user data isolation ·
a same‑origin (CSRF) guard on mutating requests · rate‑limited auth · a Content‑Security‑Policy and
security headers (HSTS behind HTTPS). Portfolio data never leaves your machine — only public ticker
symbols and currency codes (to price providers) and company names + headlines (to the news provider)
are ever sent, and prices only when you refresh.

## 🧪 Development

```bash
pnpm install
pnpm -r test        # 313 tests: core engine (92) + server (217) + web (4)
pnpm -r typecheck
pnpm --filter @dhan-drishti/server dev     # API on http://127.0.0.1:4000
pnpm --filter @dhan-drishti/web dev        # UI on http://localhost:5173 (proxies /api → server)
```

## 📁 Project layout

```
packages/core   canonical domain model + pure calculation engine (no I/O)   [unit-tested]
apps/web        React + Vite + Tailwind v4 + shadcn/ui + TanStack Query      [the UI]
apps/server     Fastify + Drizzle/libsql REST API + argon2 auth              [the API]
docs/           schema · calculations · importers · API reference + OpenAPI
```

## 🧭 Principles

> **No fake data or dead metrics** — every figure traces to a real imported or derived value; the
> few things that must be estimated (a dividend calendar, a benchmark mirror) say so plainly, and
> nothing here is tax or investment advice. **Money is never a float.** Broker logic is isolated
> behind a single `BrokerAdapter` interface. Writes are atomic, reads are cached, and your portfolio
> stays on your machine.

<div align="center"><br/><sub>Dhan Drishti — runs on your machine. No accounts sold, no data shared.</sub></div>
