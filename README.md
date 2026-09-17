<div align="center">

# 📊 Dhan Drishti

### Your private, self‑hosted investment portfolio & wealth tracker

*Consolidate every broker into one normalized ledger — then see holdings, performance and net worth that always trace back to a real transaction.*

![Tests](https://img.shields.io/badge/tests-120%20passing-2e7d32)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![Stack](https://img.shields.io/badge/React%20·%20Fastify%20·%20SQLite-informational-555)
![Self-hosted](https://img.shields.io/badge/self--hosted-privacy--first-6d28d9)
![Money](https://img.shields.io/badge/money-never%20a%20float-b45309)

</div>

---

Dhan Drishti turns a pile of broker CSVs into one clear picture of your wealth. Every figure on
the dashboard is **derived from your own transaction ledger** — nothing is placeholder, estimated
or sent to a server you don't control.

```
broker CSV ─▶ adapter ─▶ canonical transaction ledger ─▶ derived holdings ─▶ analytics ─▶ dashboard
```

## ✨ Highlights

- 🔌 **Every broker, one ledger** — Zerodha, Dhan, Vested & Interactive Brokers (US), Binance
  (crypto), plus a generic column‑mapping importer for anything else. Idempotent, deduped imports.
- 🧮 **Holdings you can trust** — average‑cost positions, invested value and realised P&L derived
  from the ledger. Missing prices show `—`, never a fake `0`.
- 📈 **Honest performance** — realised P&L by financial year, **XIRR**, and a **time‑weighted
  return** valued at each trade from real historical prices.
- 🥇 **Benchmark & FX** — mirror your exact cashflows into Nifty 50 / Sensex, split foreign gains
  into **asset vs. currency**, and aggregate everything in your base currency.
- 💰 **Net worth with cash** — record deposits & withdrawals for true net worth (holdings + retained
  cash and dividends) and a cash‑inclusive TWR.
- 🎯 **Goals & dividends** — target/date goals funded by portfolios, and a dividend/interest income
  view by financial year and security.
- 🔒 **Private by design** — runs on your machine; only public ticker symbols ever leave it.

## 🖥️ The app

| Page | What it shows |
|---|---|
| **Dashboard** | Net‑worth headline + holdings/cash bar, allocation donut, top‑holdings chart, recent activity |
| **Holdings** | Every position with avg cost, current value, unrealised & realised P&L; class/sector filters |
| **Transactions** | The full ledger, with an in‑app **Add transaction** form (deposits, trades, dividends…) |
| **Analytics** | Realised P&L by FY, XIRR, TWR, benchmark comparison, FX‑impact decomposition |
| **Dividends** | Income by financial year and security, with the payout ledger |
| **Goals · Portfolios · Imports · Settings** | Targets, grouping, the import wizard, export & account controls |

## 🧱 Tech stack

| Layer | Choice |
|---|---|
| Frontend | React + TypeScript + Vite, Tailwind CSS v4, TanStack Query, Recharts |
| Design | Flexoki design tokens (light & dark) · Inter / Merriweather / JetBrains Mono |
| Backend | Node + Fastify · argon2id auth · session cookies |
| Data | SQLite via Drizzle ORM + libsql (dialect‑swappable to Postgres) |
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
pnpm -r test        # 120 tests: core engine (36) + server (84)
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

> **No fake data or dead metrics** — every figure traces to a real imported or derived value.
> **Money is never a float.** No investment advice — just your data. Broker logic is isolated behind
> a single `BrokerAdapter` interface. Your portfolio stays on your machine.

<div align="center"><sub>Dhan Drishti — runs on your machine. No accounts sold, no data shared.</sub></div>
