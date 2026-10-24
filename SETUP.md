# Local setup (phase 1)

Requirements: Python 3.9+, Node 18+.

## Backend (FastAPI, port 8000)

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8000
```

The first request downloads FUELHH and WINDFOR data from Elexon (about 2 s) and caches the raw
responses in `backend/.cache/` (TTL 24 h). Optional settings are listed in `backend/.env.example`.

Tests (offline, deterministic): `.venv/bin/python -m pytest -q`
Live Elexon smoke tests: `RUN_LIVE_TESTS=1 .venv/bin/python -m pytest -q tests/test_live_elexon.py`

## Frontend (React + Vite, port 5173)

```bash
cd frontend
npm install
npm run dev        # proxies /api to http://127.0.0.1:8000
npm run build      # type-check + production build
npm run lint
```

Open http://localhost:5173.
