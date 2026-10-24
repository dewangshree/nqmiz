# Wind Forecast Analytics

A web app for a UK electricity utility's day-ahead procurement team. It shows **which national wind generation forecast was available when each day-ahead purchase decision was made** and **how accurate those forecasts turned out to be**, for purchase decisions made in **January 2026**.

| | |
|---|---|
| **Live app** | https://wind-forecast-analytics-psi.vercel.app |
| **API** | https://wind-forecast-api-s6ra.onrender.com (health: [/api/health](https://wind-forecast-api-s6ra.onrender.com/api/health), docs: [/docs](https://wind-forecast-api-s6ra.onrender.com/docs)) |
| **Source** | https://github.com/dewangshree/wind-forecast-analytics |

> The API runs on Render's free plan, which sleeps after ~15 minutes idle. The first request after that can take 30–60 s.

---

## What it answers

1. **Which forecast could the buyer actually use?** For every delivery interval, the app selects the latest WINDFOR forecast published *before* the day-ahead decision cutoff. Later forecasts are shown for context, but they are never used in the evaluation, so there is no look-ahead bias.
2. **How wrong were those forecasts?** It compares them with actual metered wind generation (FUELHH) using MAE, RMSE and bias, broken down by day, hour of day and lead time.

Scope is limited to the two Elexon datasets. With no demand or price data, forecast error measures wind uncertainty; it is **not** the volume or cost of power still to be procured.

## Methodology

| Topic | Decision |
|---|---|
| Data | Actuals: [FUELHH](https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream), `fuelType = WIND`. Forecasts: [WINDFOR](https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream). Values are average MW per interval. |
| Period | Decisions made 1–31 Jan 2026, so delivery days are **2 Jan – 1 Feb 2026** (UK settlement days, 00:00–24:00 Europe/London). |
| Decision cutoff | **09:50 UK time on the day before delivery**, the N2EX GB day-ahead auction gate closure ([Nord Pool](https://support.nordpoolgroup.com/support/solutions/articles/8000088463-about-the-day-ahead-gb-auction)). EPEX SPOT's 09:20 closure can be selected instead. |
| Selection | Latest publication with `publishTime` **strictly before** the cutoff that has a point for the interval. |
| Resolution | WINDFOR publishes **hourly** points; FUELHH is half-hourly. By default only half-hours starting on the hour are scored. An optional 30-minute mode linearly interpolates the :30 slots within the selected publication and labels them as interpolated. |
| Metrics | Error = forecast − actual. MAE = mean\|e\|, RMSE = √mean(e²), bias = mean(e) (positive = overforecast). nMAE = MAE ÷ mean actual, shown only when mean actual ≥ 100 MW. Every metric uses the same matched pairs. Missing values are never treated as zero. |

Result for the full period with the default settings: 744/744 hourly intervals matched, MAE 1,996 MW, RMSE 2,499 MW, bias +1,728 MW. An independent script recomputing these from the raw Elexon responses gives identical values.

Full details and known limitations are in the app's **Data & methodology** page.

## Features

- **Overview:** headline numbers, daily actual vs forecast chart, daily bias, and plain-language observations generated from the results.
- **Forecast vs actual:** half-hourly chart with an error panel and tooltips (actual, forecast, error, publish time, cutoff), a day-by-day inspector and a sortable table view.
- **Accuracy & error:** daily MAE/RMSE and bias, error distribution, error by hour of day and by lead time, a hindsight comparison with later forecasts, and the largest misses.
- **Publication history:** every forecast for a delivery day or hour, each marked *Available at cutoff* or *After cutoff*, with the forecast used for the decision highlighted.
- **Data & methodology:** sources, cutoff reasoning, metric definitions, data-quality counts, data freshness and limitations.

Shared filters (date range, cutoff, interval alignment) live in the URL, so views can be shared. The app has dark and light themes and works at phone width.

## Architecture

```
Elexon API ──► elexon_client (timeouts, retries, chunking)
            ──► repository (raw-response cache: memory + disk, stale fallback)
            ──► normalize (validation, UTC timestamps, de-duplication)
            ──► selection (cutoff, latest eligible publication)
            ──► matching (calendar-driven intervals, explicit missing statuses)
            ──► metrics (MAE, RMSE, bias, quantiles)
            ──► routes + Pydantic schemas (FastAPI)  ──►  React + Recharts UI
```

Source data is fetched once and cached; matched results are memoised per (cutoff, alignment), so filter changes never trigger new Elexon requests.

### API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness and whether data is loaded |
| GET | `/api/meta` | Period, cutoff policies, data quality, source freshness |
| GET | `/api/overview` | KPIs, coverage, daily summary, insights |
| GET | `/api/forecast-vs-actual` | Interval-level actual, selected forecast and error |
| GET | `/api/accuracy` | Daily, hourly, lead-time and distribution breakdowns |
| GET | `/api/forecast-publications?date=YYYY-MM-DD` | All publications for a delivery day, with eligible and selected flags |
| POST | `/api/refresh` | Re-download source data from Elexon |

Analysis endpoints accept `start`, `end` (delivery dates), `cutoff` (`n2ex` or `epex`) and `alignment` (`native` or `interpolated`). Invalid input returns HTTP 400 with a JSON `{error, detail}` body. Interactive docs are at `/docs`.

## Project structure

```
backend/
  app/            config, elexon_client, repository, normalize, selection,
                  matching, metrics, analysis, schemas, routes, main
  tests/          pytest suite (offline fixtures) + opt-in live Elexon tests
  Dockerfile
frontend/
  src/api/        typed API client and response types
  src/hooks/      data fetching (abortable), URL-backed filters, metadata context
  src/components/ layout, UI primitives, charts, sortable/paginated table
  src/pages/      Overview, ForecastVsActual, Accuracy, Publications, Methodology
  Dockerfile, nginx.conf.template, vercel.json
docker-compose.yml   local production-like stack
render.yaml          Render blueprint for the API
```

## Tech stack

- **Backend:** Python, FastAPI, Pydantic v2, httpx, Uvicorn, pytest
- **Frontend:** React 19, TypeScript, Vite, React Router, Recharts (design tokens in plain CSS, no UI framework)
- **Infrastructure:** Docker, nginx, Docker Compose, Vercel (frontend), Render (API)

## Run locally

Requirements: Python 3.9+ and Node 18+.

```bash
# Backend: http://localhost:8000
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload --port 8000

# Frontend: http://localhost:5173 (proxies /api to :8000)
cd frontend
npm install
npm run dev
```

The first API request downloads about 2 MB from Elexon (around 2 s) and caches it in `backend/.cache/` for 24 hours.

## Run with Docker

```bash
docker compose up --build
```

- UI: http://localhost:8080. nginx serves the built app and proxies `/api` to the backend container.
- API: http://localhost:8000/api/health

**What has been verified:**
- **Backend image:** `backend/Dockerfile` is what Render builds and runs in production, and the deployed API passes its health check.
- **Frontend image, build stage only:** `npm ci` + `npm run build` from a clean checkout succeeds and produces a bundle that calls same-origin `/api`.
- **Not yet verified locally:** the nginx serving stage and the full `docker compose` stack. The local Docker VM could not start because the development machine ran out of disk space.

## Tests and checks

```bash
cd backend && .venv/bin/python -m pytest -q                       # offline, deterministic
RUN_LIVE_TESTS=1 .venv/bin/python -m pytest -q tests/test_live_elexon.py   # hits the real Elexon API
cd frontend && npm run build && npm run lint                      # type-check + production build + lint
```

The tests cover cutoff and time-zone boundaries (including clock-change days), selection of the latest pre-cutoff forecast, exclusion of later forecasts, duplicates, missing values, metric formulas, empty data, malformed API responses, retry behaviour, input validation, error responses, CORS and the stale-cache fallback.

## Configuration

Backend environment variables (all optional; see `backend/.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated allowed origins |
| `CORS_ORIGIN_REGEX` | none | Extra allowed origins, e.g. `^https://.*\.vercel\.app$` |
| `FRONTEND_URL` | `http://localhost:5173/` | Shown at `GET /` |
| `CACHE_DIR` / `CACHE_TTL_HOURS` | `.cache` / `24` | Elexon response cache |
| `ELEXON_TIMEOUT_SECONDS` / `ELEXON_MAX_RETRIES` | `20` / `3` | HTTP client behaviour |
| `PORT` | `8000` | Port used by the Docker image |

Frontend: `VITE_API_BASE_URL`, the API origin baked in at build time. Leave it empty locally (the Vite dev server and nginx proxy `/api`); on Vercel it is set to the Render URL.

## Deployment

- **Frontend → Vercel.** Project root `frontend/`; `vercel.json` rewrites client-side routes to `index.html`. Environment variable: `VITE_API_BASE_URL`.
- **API → Render.** Docker runtime, free plan, defined in `render.yaml`. Health check `/api/health`. Environment variables: `CORS_ORIGINS` (the Vercel URL) and `FRONTEND_URL`.

## Known limitations

- WINDFOR covers wind farms visible to the system operator; FUELHH reports metered transmission-level output that reflects curtailment. Part of the persistent positive bias may come from that difference rather than from forecast skill.
- The cutoff comes from exchange documentation; a real desk may submit bids earlier. That's why it is configurable.
- A forecast is assumed usable from its `publishTime`; dissemination delays are not modelled.
- FUELHH values are the currently published values and may include revisions made after January 2026.

## AI-use disclosure

This project was built with substantial help from an AI coding assistant, **Claude Code (Anthropic)**. Working from my requirements and instructions, it inspected and tested the Elexon APIs, researched the GB day-ahead gate-closure times, and wrote most of the backend, frontend, tests, Docker and deployment configuration, and this README. The forecast-selection results were checked with automated tests and an independent recomputation from the raw Elexon data. Methodology choices (period boundaries, cutoff, hourly-vs-half-hourly handling) are documented above and in the app so they can be reviewed.
