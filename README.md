<div align="center">

# 📊 Dhan Drishti

### Your private, self‑hosted investment portfolio & wealth tracker

*Consolidate every broker into one normalized ledger — then see holdings, performance and net worth that always trace back to a real transaction.*

![Tests](https://img.shields.io/badge/tests-233%20passing-2e7d32)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![Stack](https://img.shields.io/badge/React%20·%20Fastify%20·%20SQLite-informational-555)
![Self-hosted](https://img.shields.io/badge/self--hosted-privacy--first-6d28d9)
![Money](https://img.shields.io/badge/money-never%20a%20float-b45309)

</div>

---

Dhan Drishti turns a pile of broker exports into one clear picture of your wealth. Every figure on
the dashboard is **derived from your own transaction ledger** — nothing is placeholder, silently
faked or sent to a server you don't control.

```
broker CSV / Excel / CAS PDF ─▶ adapter ─▶ canonical ledger ─▶ derived holdings ─▶ analytics ─▶ dashboard
```

## ✨ Highlights

- 🔌 **Every broker, one ledger** — Zerodha, Dhan, Vested & Interactive Brokers (US), Binance
  (crypto), Excel (`.xlsx`) holdings, and a mutual‑fund **CAS PDF** (CAMS / KFintech — one
  password‑protected file covers every AMC), plus a generic column‑mapping importer for anything
  else. Imports are idempotent, deduped and **atomic** (all‑or‑nothing).
- 🧮 **Holdings you can trust** — average‑cost positions, invested value and realised P&L derived
  from the ledger, a **diversification / concentration score**, and a per‑security detail page.
  Missing prices show `—`, never a fake `0`.
- 📈 **Honest performance** — realised P&L by financial year, **XIRR**, a **time‑weighted return**
  valued at each trade from real historical prices, and a **benchmark overlay** that mirrors your
  exact cashflows into Nifty 50 / Sensex — a chart, not just a stat.
- 💰 **Full net worth** — holdings + cash + **manual assets** (FDs, PPF / EPF / NPS, physical gold,
  real estate, savings), a **net‑worth‑over‑time** chart, and allocation by asset class, sector,
  **region** and currency. Foreign gains split into **asset vs. currency**.
- 🎯 **Plan, income & tax** — set **target weights** and see the drift in percent and rupees
  ("trim ₹X"), a trailing **dividend yield** with an estimated payout calendar, and a **FIFO
  capital‑gains** report (short‑ vs long‑term) you can export as CSV for your ITR.
- ⚙️ **Fresh & installable** — prices refresh nightly in the background and on login; the UI is an
  installable **PWA** with an offline shell.
- 🔒 **Private by design** — runs on your machine; only public ticker symbols ever leave it.

## 🖥️ The app

| Page | What it shows |
|---|---|
| **Dashboard** | Net‑worth headline + composition (holdings / cash / manual assets), net‑worth‑over‑time chart, allocation, top holdings, recent activity |
| **Holdings** | Every position with avg cost, current value, unrealised & realised P&L; class/sector filters — click a symbol for its detail page |
| **Security detail** | Price chart, position summary, contribution to return, and the full transaction history for one security |
| **Transactions** | The full ledger, with an in‑app **Add transaction** form (deposits, trades, dividends…) |
| **Analytics** | Realised P&L by FY, XIRR, TWR, benchmark comparison + overlay chart, diversification score, FX‑impact decomposition |
| **Rebalance** | Target weights per asset class / sector, with the drift shown in both percent and rupees |
| **Dividends** | Income by financial year and security, trailing yield, and an estimated forward calendar |
| **Capital gains** | FIFO short‑ & long‑term gains by financial year, with a CSV export for your tax return |
| **Other assets** | Manual, non‑market assets (FDs, PPF, gold, real estate…) that fold straight into net worth |
| **Portfolios · Imports · Settings** | Grouping & accounts, the import wizard, data export & account controls |

## 🧱 Tech stack

| Layer | Choice |
|---|---|
| Frontend | React + TypeScript + Vite (route‑level code‑split), Tailwind CSS v4, TanStack Query, Recharts |
| Design | Flexoki design tokens (light & dark) · Inter / Merriweather / JetBrains Mono |
| Backend | Node + Fastify · argon2id auth · session cookies |
| Data | SQLite via Drizzle ORM + libsql (WAL; dialect‑swappable to Postgres) |
| Money | `decimal.js` — exact decimals end to end, **never floats** |
| Core | A pure, deterministic, unit‑tested calculation engine (no I/O) |

## 🚀 Run it (one command)

Builds the web app, starts the single‑service server (API + UI on one port), and opens your
browser once it's ready. Your data persists in `./data` across runs.

```bash
./start.sh          # macOS / Linux
```

On Windows, double‑click **`start.bat`** (or run it from a terminal). Both need **Node.js + pnpm**.

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
symbols and currency codes are ever sent to price providers, and only when you refresh.

## 🧪 Development

```bash
pnpm install
pnpm -r test        # 233 tests: core engine (71) + server (162)
pnpm -r typecheck
pnpm --filter @dhan-drishti/server dev     # API on http://127.0.0.1:4000
pnpm --filter @dhan-drishti/web dev        # UI on http://localhost:5173 (proxies /api → server)
```

## 📁 Project layout

```
packages/core   canonical domain model + pure calculation engine (no I/O)   [unit-tested]
apps/web        React + Vite + Tailwind v4 + TanStack Query                  [the UI]
apps/server     Fastify + Drizzle/libsql REST API + argon2 auth              [the API]
docs/           schema · calculations · importers · API reference + OpenAPI
```

## 🧭 Principles

> **No fake data or dead metrics** — every figure traces to a real imported or derived value; the
> few things that must be estimated (a dividend calendar, a benchmark mirror) say so plainly, and
> nothing here is tax or investment advice. **Money is never a float.** Broker logic is isolated
> behind a single `BrokerAdapter` interface. Writes are atomic, reads are cached, and your portfolio
> stays on your machine.

<div align="center"><sub>Dhan Drishti — runs on your machine. No accounts sold, no data shared.</sub></div>
