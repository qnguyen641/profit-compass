# Profit Compass

AI-powered project profitability analysis demo for Q's Advertising — the SAP Business One + Time & Attendance scenario from the demo blueprint (Orchard Road Christmas 2026 running example).

## Architecture

```
frontend/index.html      Single-file UI ("drafting sheet" design). All data loaded
                         from the backend at boot (api/bootstrap.js), all AI chat
                         via POST api/chat.
backend/app/
  db.py                  SQLite schema + seeding from data/seed.json
                         (transaction-level synthetic SAP B1 + T&A records)
  engine.py              Profitability engine — every aggregate computed live:
                         profit, margin, category variance, pro-rata forecast,
                         margin bridge, diagnosis verdict, labour analysis
  chat.py                AI chat: Claude tool-use over the DB (8 read-only tools),
                         deterministic local fallback when no API key
  main.py                FastAPI app + static frontend
```

The AI answers management questions from the database via tools — no hard-coded
answer strings (blueprint §06 design note). Without `ANTHROPIC_API_KEY` the chat
degrades to a deterministic local analyst computed from the same engine.

## Run locally

```bash
cd backend
pip install -r requirements.txt
ANTHROPIC_API_KEY=sk-ant-... uvicorn app.main:app --port 8000
# open http://localhost:8000
```

## Deploy (Docker)

```bash
cp .env.example .env    # put the real ANTHROPIC_API_KEY in .env
docker compose up -d --build
# app on port ${PC_PORT:-8090}
```

## API

- `GET /api/health` — status + which AI engine is active
- `GET /api/bootstrap` — full dataset with live-computed aggregates
- `GET /api/projects` · `GET /api/projects/{id}/profitability` · `GET /api/projects/{id}/transactions`
- `GET /api/alerts`
- `POST /api/chat` — `{question, project_id?, history?}` → `{text, chips, open_project, engine}`

All data is synthetic. The demo simulates SAP B1 and a Time & Attendance feed;
no live integration exists (blueprint §10).
