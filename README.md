# Serverless Algo Trading — a refined, purposeful design

> A surgical approach to algorithmic trading: small surface area, precise intent, and beautiful simplicity.

[![Deploy (Vercel)](https://img.shields.io/badge/deploy-vercel-black?logo=vercel)](https://vercel.com)
[![License: MIT](https://img.shields.io/badge/license-MIT-brightgreen.svg)](./LICENSE)
[![Node >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![Alpaca](https://img.shields.io/badge/broker-Alpaca-ff69b4.svg)](https://alpaca.markets/)
[![Serverless](https://img.shields.io/badge/architecture-serverless-blue.svg)](https://vercel.com/docs)

---

This repository contains a **serverless algorithmic trading platform** designed to run as compact serverless functions on Vercel. It executes small, auditable quantitative strategies against tradable instruments, logs every decision to Google Sheets, and exposes a concise API for execution, reporting and backtests.

---

# Why this exists

Because trading systems should do three things well: *decide*, *execute*, *protect*.
This project concentrates those three responsibilities into a tiny, auditable surface that runs with minimal operational overhead and fast iteration.

---

# What it is (at a glance)

* Strategy modules: **Momentum**, **Mean-Reversion (RSI)**, **Regime Detection (200-day MA)** — each as a composable signal producer.
* Risk controls: position sizing by equity/volatility, stop-loss / take-profit automation, daily loss limits, concurrent position caps.
* Broker integration: **Alpaca** trading API (paper & live modes supported).
* Persistent logging: structured trade & performance logs written to **Google Sheets** via a service account.
* Serverless-first: deploy on Vercel; functions are compact, fast and cost-effective.

---

# Preview (sample screenshots)

> Add the following images under `docs/screenshots/` or `assets/` before committing to show them on GitHub.

![Dashboard preview](docs/screenshots/dashboard.png)
*Dashboard — status, open positions, and quick-run controls.*

![Trade log preview](docs/screenshots/trade-log.png)
*Trade log written to Google Sheets — each row is a structured event.*

---

# Quick start

```bash
# clone
git clone https://github.com/bhargav-patel-97/serverless-algo-trading.git
cd serverless-algo-trading
npm install
```

Create a `.env.local` (or configure in Vercel Dashboard) with the variables below.

```env
# Alpaca
ALPACA_API_KEY=your_key_here
ALPACA_SECRET_KEY=your_secret_here
ALPACA_PAPER=true

# Google Sheets service account (values taken from your service account JSON)
GOOGLE_CLIENT_EMAIL=service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SPREADSHEET_ID=your_spreadsheet_id

# Optional operation flags
TRADE_ENABLED=true
LOGGING_ENABLED=true
```

Run locally (recommended: `vercel dev` if you use Vercel CLI, otherwise use a local server shim):

```bash
# with Vercel CLI
vercel dev

# or run the API handlers directly (project specific scripts may exist)
npm run dev
```

Deploy to production:

```bash
vercel --prod
```

---

# API reference

A compact table summarizing the public endpoints in `/api`.

| Endpoint         | Method | Auth          | Description                                                           | Body (example)                                             | Response (example)                          |
| ---------------- | -----: | ------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------- |
| `/api/trade`     | `POST` | API key / env | Run enabled strategies, evaluate risk, place orders, and log results. | `{ "mode":"paper" }`                                       | `{ "status":"success","tradesExecuted":2 }` |
| `/api/portfolio` |  `GET` | API key / env | Snapshot of current positions & unrealized P&L.                       | —                                                          | `{ "positions":[], "equity":10000 }`        |
| `/api/logs`      |  `GET` | API key / env | Recent logs and structured trade history (paginated).                 | `?limit=50`                                                | `{ "logs":[ ... ] }`                        |
| `/api/backtest`  | `POST` | API key / env | Run a historical backtest against provided date-range & symbol set.   | `{ "symbol":"SPY","from":"2020-01-01","to":"2024-12-31" }` | `{ "summary":{...}, "trades":[...] }`       |
| `/api/health`    |  `GET` | none          | Lightweight healthcheck for uptime monitoring.                        | —                                                          | `{ "status":"ok","time":"..." }`            |

### Example — run a trade (curl)

```bash
curl -X POST https://your-deployment.vercel.app/api/trade \
  -H "Content-Type: application/json" \
  -d '{"mode":"paper"}'
```

> When scheduling cron runs during market hours, call `/api/trade` on the cadence your strategy requires (e.g., 1m / 5m / hourly). Prefer paper mode until fully validated.

---

# Architecture (concise)

1. **API (serverless)** — single function entrypoints under `/api/*`.
2. **Strategy library** — pure modules that produce signals (long/short/flat) for target symbols.
3. **Executor / risk manager** — centralized logic to turn signals into sized orders with stops and limits.
4. **Integrations** — Alpaca for orders & market data; Google Sheets for persistent logs.
5. **UI** — minimal static dashboard for status and manual runs.

This architecture keeps cognitive load low and ownership of each concern explicit.

---

# Configuration & customization

* **Enable / disable strategies** by toggling the strategy list in the executor module.
* **Risk parameters** live near the top of the executor (position sizing rules, max drawdown, daily loss limits).
* **Exchangeable broker**: Alpaca is pluggable — implement the same `placeOrder` / `getPositions` primitives to swap brokers.

---

# Logging & persistence

Trade events and performance snapshots are written to a Google Sheet. Use a service account, share the spreadsheet with the service account email, and set `GOOGLE_SPREADSHEET_ID`.

Consider adding alerting (Slack/Telegram) or a lightweight DB (KV / Postgres) if you require query-able histories beyond what Sheets comfortably supports.

---

# Safety checklist (read before enabling LIVE trades)

* [ ] Keep `ALPACA_PAPER=true` while testing.
* [ ] Confirm the Google service account has Editor access to the spreadsheet.
* [ ] Verify position sizing and daily loss limits are conservative for your account.
* [ ] Add monitoring for failed orders, rate-limits and API rejections.
* [ ] Run thorough backtests and paper-forward tests.

---

# Development notes

* Strategy logic is intentionally pure and deterministic for a given market snapshot — design tests around snapshots rather than live streams.
* Iteration flow: backtest → paper-run → review sheet logs → tweak risk → repeat.
* The repo includes `vercel.json` to configure function behavior; read it before deploying.

---

# Roadmap

* **Observability** — add dashboards, alerting, and runbook automation.
* **Strategy plugins** — decouple strategy bundles with versioning and feature flags.
* **Persisted state** — optional DB for richer analytics and historical queries.
* **Advanced simulation** — slippage, latency and Monte Carlo-aware backtests.

---

# Contributing

Contributions should be small, documented and testable.

If you add a strategy:

1. Add a pure function that consumes OHLC/indicator snapshots and returns a signal object.
2. Add deterministic unit tests under `/test` demonstrating behavior on sample snapshots.
3. Update README with strategy rationale and new risk parameters.

---

# License & contact

MIT — see `LICENSE`.

If you want to collaborate, open an issue or PR. For quick questions, raise an issue with the `question` tag.

---

# A final note (design brief)

This project is intentionally humble in scope: a clear decision surface, strong defaults, and elegant transparency. It aims to do one thing well—trade disciplined strategies while remaining auditable and lightweight.

---

*Ready to commit: place this file at the repository root as `README.md`. Add screenshot images under `docs/screenshots/` or `assets/` to enable the preview images above.*
