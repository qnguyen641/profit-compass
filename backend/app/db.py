"""SQLite database: schema + seeding from data/seed.json.

The database holds transaction-level records (blueprint §04: "the AI needs
transaction-level detail, not just aggregated project totals"). Aggregates
(profit, margin, category actuals, forecasts) are computed live in engine.py.
"""
import json
import os
import sqlite3
from pathlib import Path

DATA_DIR = Path(os.environ.get("PC_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
DB_PATH = Path(os.environ.get("PC_DB_PATH", DATA_DIR / "app.db"))
SEED_PATH = DATA_DIR / "seed.json"

SCHEMA = """
CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, customer TEXT, type TEXT,
  status TEXT, completion_pct REAL, contract_value REAL, lifecycle_stage TEXT
);
CREATE TABLE snapshots (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  revenue REAL, actual_cost REAL, budget_margin_pct REAL,
  is_final INTEGER DEFAULT 0,
  forecast_final_cost REAL, forecast_final_profit REAL, forecast_final_margin_pct REAL
);
CREATE TABLE category_budgets (
  project_id TEXT REFERENCES projects(id), category TEXT,
  budget REAL, actual_fallback REAL,
  PRIMARY KEY (project_id, category)
);
CREATE TABLE cost_transactions (
  id TEXT PRIMARY KEY, project_id TEXT, resolved_project_id TEXT,
  date TEXT, category TEXT, vendor TEXT, description TEXT,
  amount REAL, quoted_amount REAL, phase TEXT, tag_status TEXT,
  confidence REAL, inherit_via TEXT,
  driver_cause TEXT, driver_note TEXT, driver_incident TEXT, driver_docs TEXT
);
CREATE TABLE incidents (
  id TEXT PRIMARY KEY, project_id TEXT, date TEXT, kind TEXT, title TEXT,
  doc TEXT, ref TEXT, docs TEXT, ot_hours REAL, ot_by_phase TEXT,
  txn_ids TEXT, detail TEXT
);
CREATE TABLE labour_summary (
  project_id TEXT PRIMARY KEY, craftsmen INTEGER, normal_hours REAL,
  overtime_hours REAL, total_hours REAL, hourly_rate REAL, labour_cost REAL,
  ot_by_phase TEXT
);
CREATE TABLE crew (
  project_id TEXT, emp_id TEXT, name TEXT, role TEXT, phase TEXT,
  normal_hours REAL, ot_hours REAL,
  PRIMARY KEY (project_id, emp_id)
);
CREATE TABLE risk_alerts (
  id TEXT PRIMARY KEY, project_id TEXT, severity TEXT, status TEXT,
  category TEXT, what_happened TEXT, why_it_matters TEXT,
  expected_impact_sgd REAL, impact_note TEXT, recommended_action TEXT,
  detection TEXT, evidence_ids TEXT, evidence_note TEXT, crew_evidence INTEGER
);
CREATE TABLE reference_facts (
  project_id TEXT PRIMARY KEY, subcontractor_overrun_pct REAL,
  labour_ot_overrun_pct REAL, note TEXT
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX idx_txn_project ON cost_transactions(project_id);
CREATE INDEX idx_txn_resolved ON cost_transactions(resolved_project_id);
CREATE INDEX idx_txn_category ON cost_transactions(category);
"""


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    return con


def init_db(force: bool = True) -> None:
    """(Re)build the database from seed.json. Demo data is deterministic, so we
    rebuild on every boot — the DB is a cache of the seed, never the master."""
    if DB_PATH.exists():
        if not force:
            return
        DB_PATH.unlink()
    seed = json.loads(SEED_PATH.read_text())
    con = sqlite3.connect(DB_PATH)
    con.executescript(SCHEMA)

    for p in seed["PROJECTS"]:
        con.execute(
            "INSERT INTO projects VALUES (?,?,?,?,?,?,?,?)",
            (p["id"], p["name"], p["customer"], p["type"], p["status"],
             p["completion_pct"], p["contract_value"], p["lifecycle_stage"]),
        )

    for pid, s in seed["SNAPSHOTS"].items():
        con.execute(
            "INSERT INTO snapshots VALUES (?,?,?,?,?,?,?,?)",
            (pid, s["revenue"], s["actual_cost"], s["budget_margin_pct"],
             1 if s.get("final") else 0,
             s.get("forecast_final_cost"), s.get("forecast_final_profit"),
             s.get("forecast_final_margin_pct")),
        )

    for pid, cd in seed["CATEGORY_DATA"].items():
        for cat in seed["CATS"]:
            con.execute(
                "INSERT INTO category_budgets VALUES (?,?,?,?)",
                (pid, cat, cd["budget"][cat], cd["actual"][cat]),
            )

    for t in seed["TRANSACTIONS"]:
        d = t.get("driver") or {}
        con.execute(
            "INSERT INTO cost_transactions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (t["id"], t.get("project_id"), t.get("resolved_project_id"),
             t.get("date"), t["category"], t.get("vendor"), t.get("description"),
             t["amount"], t.get("quoted_amount"), t.get("phase"), t.get("tag_status"),
             t.get("confidence"), t.get("inherit_via"),
             d.get("cause"), d.get("note"), d.get("incident"),
             json.dumps(d.get("docs")) if d.get("docs") else None),
        )

    for i in seed["INCIDENTS"]:
        con.execute(
            "INSERT INTO incidents VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (i["id"], i["project_id"], i.get("date"), i["kind"], i["title"],
             i.get("doc"), i.get("ref"), json.dumps(i.get("docs") or []),
             i.get("ot_hours"), json.dumps(i.get("ot_by_phase") or {}),
             json.dumps(i.get("txnIds") or []), i.get("detail")),
        )

    for pid, lab in seed["LABOUR_BY_PROJECT"].items():
        s = lab["summary"]
        con.execute(
            "INSERT INTO labour_summary VALUES (?,?,?,?,?,?,?,?)",
            (pid, s["craftsmen"], s["normal_hours"], s["overtime_hours"],
             s["total_hours"], s["hourly_rate"], s["labour_cost"],
             json.dumps(lab.get("ot_by_phase") or {})),
        )
        for c in lab["crew"]:
            con.execute(
                "INSERT INTO crew VALUES (?,?,?,?,?,?,?)",
                (pid, c["id"], c["name"], c["role"], c["phase"], c["normal"], c["ot"]),
            )

    for a in seed["RISK_ALERTS"]:
        con.execute(
            "INSERT INTO risk_alerts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (a["id"], a["project_id"], a["severity"], a["status"], a.get("category"),
             a["what_happened"], a["why_it_matters"], a.get("expected_impact_sgd"),
             a.get("impact_note"), a["recommended_action"], a.get("detection"),
             json.dumps(a.get("evidenceIds") or []), a.get("evidenceNote"),
             1 if a.get("crewEvidence") else 0),
        )

    for pid, rf in seed["REFERENCE_FACTS"].items():
        con.execute(
            "INSERT INTO reference_facts VALUES (?,?,?,?)",
            (pid, rf["subcontractor_overrun_pct"], rf["labour_ot_overrun_pct"], rf["note"]),
        )

    for key in ("OPEN_PO_TOTAL", "CATS", "LIFECYCLE_STAGES", "DRIVER_NOTES",
                "PROJECT_LESSON", "CAUSE_LABEL", "QUOTE_REQUEST"):
        con.execute("INSERT INTO meta VALUES (?,?)", (key, json.dumps(seed[key])))

    con.commit()
    con.close()


def meta(con: sqlite3.Connection, key: str):
    row = con.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return json.loads(row["value"]) if row else None
