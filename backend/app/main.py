"""Profit Compass — AI project profitability demo (Q's Advertising / SAP B1 scenario).

FastAPI app: serves the frontend, a transaction-level REST API computed live
from SQLite, and the AI chat endpoint (Claude tool-use with local fallback).
"""
import json
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import db, engine, chat

FRONTEND_DIR = Path(os.environ.get("PC_FRONTEND_DIR", Path(__file__).resolve().parent.parent.parent / "frontend"))

app = FastAPI(title="Profit Compass API", version="1.0.0")


@app.on_event("startup")
def startup():
    db.init_db(force=True)


@app.get("/api/health")
def health():
    con = db.connect()
    try:
        n = con.execute("SELECT COUNT(*) AS n FROM cost_transactions").fetchone()["n"]
        return {"status": "ok", "transactions": n,
                "ai": "claude" if os.environ.get("ANTHROPIC_API_KEY") else "local-fallback"}
    finally:
        con.close()


@app.get("/api/bootstrap")
def bootstrap():
    con = db.connect()
    try:
        return engine.bootstrap(con)
    finally:
        con.close()


@app.get("/api/bootstrap.js")
def bootstrap_js():
    con = db.connect()
    try:
        payload = json.dumps(engine.bootstrap(con))
        return Response(content=f"window.__DATA__ = {payload};",
                        media_type="application/javascript")
    finally:
        con.close()


@app.get("/api/projects")
def list_projects():
    con = db.connect()
    try:
        out = []
        for p in engine.projects(con):
            snap = engine.snapshot(con, p["id"])
            out.append({**p, "snapshot": snap})
        return out
    finally:
        con.close()


@app.get("/api/projects/{pid}/profitability")
def project_profitability(pid: str):
    con = db.connect()
    try:
        p = engine.project(con, pid)
        if not p:
            raise HTTPException(404, "unknown project")
        snap = engine.snapshot(con, pid)
        if not snap:
            return {"project": p, "note": "quoting — no actuals yet"}
        return {
            "project": p,
            "snapshot": snap,
            "category_variance": engine.category_variance(con, pid),
            "bridge": engine.bridge(con, pid),
            "open_commitment_sgd": engine.open_commitment(con, pid),
            "diagnosis": engine.diagnosis(con, pid),
            "labour": engine.labour(con, pid),
            "alerts": engine.alerts(con, pid),
            "incidents": engine.incidents(con, pid),
        }
    finally:
        con.close()


@app.get("/api/projects/{pid}/transactions")
def project_transactions(pid: str, category: str | None = None, flagged_only: bool = False):
    con = db.connect()
    try:
        return engine.transactions(con, pid, category, flagged_only, limit=500)
    finally:
        con.close()


@app.get("/api/alerts")
def alerts():
    con = db.connect()
    try:
        return engine.alerts(con)
    finally:
        con.close()


class ChatRequest(BaseModel):
    question: str
    project_id: str | None = None
    history: list[dict] = []


@app.post("/api/chat")
def api_chat(req: ChatRequest):
    q = req.question.strip()
    if not q:
        raise HTTPException(400, "empty question")
    return chat.answer(q[:2000], req.project_id, req.history)


# Frontend (mounted last so /api/* wins)
@app.get("/")
def index():
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
