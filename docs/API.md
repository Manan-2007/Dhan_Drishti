# Dhan Drishti — REST API

The web app is one client of this API; it is fully headless-ready. The machine-readable
contract is **OpenAPI 3.1** at `GET /api/openapi.json` (load it into Swagger UI, Redoc, Postman,
or an SDK generator). `GET /api` returns a discovery index of every endpoint.

- **Base URL:** the server origin (default `http://localhost:4000`).
- **Auth:** a session cookie **`dd_session`**, issued by `POST /api/auth/register` or
  `/api/auth/login`. Send the cookie on every `/api/*` call except the auth and meta routes.
- **Content type:** `application/json` for request bodies and responses.
- **Money & quantities:** exact **decimal strings** (never floats), e.g. `"1234.56"`.
  `null` means *unknown* (e.g. no price yet) — never silently `0`.
- **Isolation:** every resource is scoped to the authenticated user; accessing another user's
  resource returns **404** (never reveals existence).

## Error envelope
All errors share one shape; validation errors add `issues`:
```json
{ "error": "not_found", "message": "Portfolio not found" }
```
Common codes: `unauthorized` (401), `not_found` (404), `validation_error` (400, with `issues`),
`portfolio_name_taken` (409), `split_ratio_required` (400), `invalid_password` (401).

## Quickstart (curl)
```bash
BASE=http://localhost:4000
# 1. Register (stores the session cookie in cookies.txt)
curl -c cookies.txt -X POST $BASE/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"username":"alice","password":"supersecret1","baseCurrency":"INR"}'
# 2. Create a portfolio
curl -b cookies.txt -X POST $BASE/api/portfolios \
  -H 'content-type: application/json' -d '{"name":"Long term"}'
# 3. Read derived holdings (base-currency summary, allocation, FX impact)
curl -b cookies.txt "$BASE/api/holdings"
# 4. Browse the full contract
curl "$BASE/api/openapi.json" | less
```

## Endpoints

### Meta (no auth)
| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness probe |
| GET | `/api` | API index + endpoint discovery |
| GET | `/api/openapi.json` | OpenAPI 3.1 contract |

### Auth
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create a user, start a session |
| POST | `/api/auth/login` | Authenticate, start a session |
| POST | `/api/auth/logout` | End the session |
| GET | `/api/auth/me` | Current user |

### Portfolios & accounts
| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/portfolios` | List / create |
| GET/PUT/DELETE | `/api/portfolios/{id}` | Get / update / delete |
| GET/POST | `/api/accounts` | List / create (a broker account in a portfolio) |
| GET/PUT/DELETE | `/api/accounts/{id}` | Get / update / delete |

### Securities (shared master)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/securities?query=&limit=` | Search by symbol / name / ISIN |
| POST | `/api/securities` | Find-or-create (ISIN → symbol+exchange → symbol) |
| GET/PUT | `/api/securities/{id}` | Get / edit metadata |
| POST | `/api/securities/classify` | Bulk-classify from a reference CSV |

### Transactions (canonical ledger)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/transactions?portfolioId=&type=&from=&to=&limit=&offset=` | List / filter |
| POST | `/api/transactions` | Add (foreign trades auto-capture FX-at-cost) |
| GET/PUT/DELETE | `/api/transactions/{id}` | Get / update / delete |

> For a **split**, put the ratio (new shares per old share) in `price` — e.g. `5` for a 1:5
> split, `0.1` for a 10:1 consolidation. A **bonus** uses `quantity` = shares credited.

### Holdings, performance, dividends
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/holdings?portfolioId=` | Derived holdings, allocation, base-currency summary, `fxImpact` |
| GET | `/api/performance/summary?portfolioId=` | Realised P&L (FY/month/segment), dividends, XIRR |
| GET | `/api/performance/benchmarks` | Available benchmarks |
| GET | `/api/performance/benchmark?benchmark=nifty50&portfolioId=` | Portfolio vs index on identical cashflows |
| GET | `/api/performance/twr?portfolioId=` | Time-weighted return (price-based; single-currency holdings) |
| GET | `/api/dividends?portfolioId=` | Dividend & interest income by FY / security |

### Market data & FX
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/market-data/refresh` | Refresh quotes for held securities (only public tickers sent) |
| GET | `/api/market-data/status` | Last price refresh time |
| GET | `/api/exchange-rates` | Latest rate per pair |
| POST | `/api/exchange-rates/refresh` | Refresh rates for held foreign currencies |
| POST | `/api/exchange-rates/backfill` | Backfill FX-at-cost on foreign trades |
| PUT | `/api/exchange-rates` | Set a manual rate |

### Imports
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/imports/brokers` | Supported broker adapters |
| POST | `/api/imports/check` | Preview (valid/invalid/duplicate counts) |
| POST | `/api/imports/commit` | Commit (idempotent dedup) |
| GET | `/api/imports` · `/api/imports/{id}` | List / get import batches |

### Goals & account
| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/goals` | List (with progress) / create |
| GET/PUT/DELETE | `/api/goals/{id}` | Get / update / delete |
| GET | `/api/account/export` | Export all of the caller's data as JSON |
| POST | `/api/account/delete` | Permanently delete the account (password-confirmed) |

## Security
- **Auth:** argon2id password hashing; httpOnly `SameSite=Lax` session cookie; per-user isolation.
- **CSRF:** mutating requests that carry a browser `Origin`/`Referer` must be same-origin
  (loopback hosts are treated as one origin, so the dev proxy works). Headless clients with no
  `Origin` are allowed — they can't be driven cross-site by a victim's browser.
- **Rate limiting:** `POST /api/auth/login|register` are limited per IP (429 on excess).
- **Headers:** every response carries `Content-Security-Policy`, `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (and HSTS when `SECURE_COOKIES`).
- **Body limit:** 25 MB (large broker-CSV imports).

## Privacy
Portfolio and transaction data never leaves the machine. Only **public identifiers** — ticker
symbols (price providers) and currency codes (FX provider) — are sent to third parties, and only
when you refresh.
