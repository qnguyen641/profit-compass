"""Profitability engine — every aggregate is computed live from the database.

Mirrors the analysis model in the demo blueprint (§05):
  profit  = revenue − actual cost
  margin% = profit / revenue × 100
  forecast = actuals + committed-but-unbilled POs allocated pro-rata to budget share
  bridge   = budgeted tracked cost → forecast tracked cost, one step per category
"""
import json
import math
from . import db


def jsround(x):
    """JS Math.round semantics (half toward +∞) so figures match the frontend."""
    return math.floor(x + 0.5)


def _cats(con):
    return db.meta(con, "CATS")


def fmt_sgd(n):
    if n is None:
        return "—"
    sign = "−" if n < 0 else ""
    return f"{sign}S${abs(round(n)):,}"


def pct(n, d=1):
    return "—" if n is None else f"{round(n, d):.{d}f}%"


# ---------------------------------------------------------------- core reads

def project(con, pid):
    r = con.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
    return dict(r) if r else None


def projects(con):
    return [dict(r) for r in con.execute("SELECT * FROM projects").fetchall()]


def category_actuals(con, pid):
    """Actual spend per category, summed live from cost transactions.
    Falls back to the stored ledger totals when a project has no itemised
    rows (PRJ-004 in the demo dataset)."""
    cats = _cats(con)
    rows = con.execute(
        """SELECT category, SUM(amount) AS total FROM cost_transactions
           WHERE project_id=? OR resolved_project_id=? GROUP BY category""",
        (pid, pid),
    ).fetchall()
    summed = {r["category"]: r["total"] for r in rows}
    if summed:
        return {c: round(summed.get(c, 0)) for c in cats}
    fb = con.execute(
        "SELECT category, actual_fallback FROM category_budgets WHERE project_id=?",
        (pid,),
    ).fetchall()
    return {r["category"]: r["actual_fallback"] for r in fb}


def category_budgets(con, pid):
    rows = con.execute(
        "SELECT category, budget FROM category_budgets WHERE project_id=?", (pid,)
    ).fetchall()
    return {r["category"]: r["budget"] for r in rows}


def snapshot(con, pid):
    """ProfitabilitySnapshot with profit and margin computed live."""
    r = con.execute("SELECT * FROM snapshots WHERE project_id=?", (pid,)).fetchone()
    if not r:
        return None
    s = dict(r)
    s["profit"] = round(s["revenue"] - s["actual_cost"])
    s["margin_pct"] = round(s["profit"] / s["revenue"] * 100, 1)
    s["final"] = bool(s.pop("is_final"))
    if s["final"]:
        for k in ("forecast_final_cost", "forecast_final_profit", "forecast_final_margin_pct"):
            s.pop(k, None)
    return s


def budget_total_cost(con, pid):
    s = snapshot(con, pid)
    return round(s["revenue"] * (1 - s["budget_margin_pct"] / 100))


def open_commitment(con, pid):
    """Committed-but-unbilled money still to land (open POs)."""
    if pid == "PRJ-001":
        return db.meta(con, "OPEN_PO_TOTAL")
    s = snapshot(con, pid)
    if s["final"] or s.get("forecast_final_margin_pct") is None:
        return 0
    return max(0, round(s["revenue"] * (1 - s["forecast_final_margin_pct"] / 100)) - s["actual_cost"])


def forecast_by_category(con, pid):
    cats = _cats(con)
    commit = open_commitment(con, pid)
    budget = category_budgets(con, pid)
    actual = category_actuals(con, pid)
    budget_sum = sum(budget[c] for c in cats)
    return {c: actual[c] + jsround(commit * (budget[c] / budget_sum)) for c in cats}


def bridge(con, pid):
    """Margin bridge: budgeted tracked cost → forecast tracked cost."""
    cats = _cats(con)
    budget = category_budgets(con, pid)
    actual = category_actuals(con, pid)
    fc = forecast_by_category(con, pid)
    commit = open_commitment(con, pid)
    steps = sorted(
        [{"key": c, "label": c.capitalize(), "cat": c,
          "impact": -(actual[c] - budget[c])} for c in cats],
        key=lambda s: s["impact"],
    )
    if commit > 0:
        steps.append({"key": "open_po", "label": "Committed, not yet billed",
                      "cat": None, "impact": -commit})
    return {"from": sum(budget[c] for c in cats),
            "to": sum(fc[c] for c in cats),
            "commit": commit, "steps": steps}


def diagnosis(con, pid):
    """The analyst's verdict, computed from the bridge."""
    s = snapshot(con, pid)
    p = project(con, pid)
    b = bridge(con, pid)
    leaks = sorted([x for x in b["steps"] if x["impact"] < 0], key=lambda x: x["impact"])
    gains = sorted([x for x in b["steps"] if x["impact"] > 0], key=lambda x: -x["impact"])
    worst = next((x for x in leaks if x["cat"]), leaks[0] if leaks else None)
    burn_pct = round(s["actual_cost"] / budget_total_cost(con, pid) * 100)
    done_pct = p["completion_pct"] or 0
    final_pct = s["margin_pct"] if s["final"] else s.get("forecast_final_margin_pct")
    margin_drop = round(s["budget_margin_pct"] - final_pct, 1) if final_pct is not None else None

    if s["final"]:
        verdict = (
            f"Closed at {pct(s['margin_pct'])} against a {pct(s['budget_margin_pct'])} plan — "
            f"{margin_drop} points given away. {worst['label']} was the largest single leak "
            f"at {fmt_sgd(worst['impact'])}."
            if worst else
            f"Closed at {pct(s['margin_pct'])}, on or ahead of its {pct(s['budget_margin_pct'])} plan."
        )
    elif not worst:
        verdict = (f"Every tracked category is at or under budget. Forecast margin "
                   f"{pct(final_pct)} against a {pct(s['budget_margin_pct'])} plan.")
    else:
        commit_txt = (f", and a further {fmt_sgd(b['commit'])} is committed but not yet billed"
                      if b["commit"] > 0 else "")
        verdict = (f"{worst['label']} is the largest leak at {fmt_sgd(worst['impact'])}"
                   f"{commit_txt}. Budget is {burn_pct}% spent against {done_pct:.0f}% delivered.")
    return {"pid": pid, "verdict": verdict, "worst": worst,
            "burn_pct": burn_pct, "done_pct": done_pct,
            "margin_drop": margin_drop, "final_pct": final_pct, "is_final": s["final"]}


def category_variance(con, pid):
    cats = _cats(con)
    budget = category_budgets(con, pid)
    actual = category_actuals(con, pid)
    fc = forecast_by_category(con, pid)
    notes = (db.meta(con, "DRIVER_NOTES") or {}).get(pid, {})
    out = []
    for c in cats:
        delta = actual[c] - budget[c]
        out.append({
            "category": c, "budget": budget[c], "actual": actual[c],
            "forecast": fc[c], "delta_amount": delta,
            "delta_pct": round(delta / budget[c] * 100, 1),
            "driver_note": notes.get(c),
        })
    return out


def rank_by_margin(con):
    out = []
    for p in projects(con):
        s = snapshot(con, p["id"])
        if not s:
            continue
        out.append({
            "project_id": p["id"], "name": p["name"], "final": s["final"],
            "margin_pct": s["margin_pct"],
            "vs_plan": round(s["margin_pct"] - s["budget_margin_pct"], 1),
            "forecast_final_margin_pct": s.get("forecast_final_margin_pct"),
            "budget_margin_pct": s["budget_margin_pct"],
        })
    return sorted(out, key=lambda r: -r["margin_pct"])


def labour(con, pid):
    s = con.execute("SELECT * FROM labour_summary WHERE project_id=?", (pid,)).fetchone()
    if not s:
        return None
    crew = [dict(r) for r in con.execute(
        "SELECT emp_id, name, role, phase, normal_hours, ot_hours FROM crew "
        "WHERE project_id=? ORDER BY normal_hours DESC", (pid,)).fetchall()]
    out = dict(s)
    out["ot_by_phase"] = json.loads(out["ot_by_phase"])
    out["crew"] = crew
    ts = con.execute(
        "SELECT COUNT(*) n, MIN(date) first, MAX(date) last FROM timesheet_entries "
        "WHERE project_id=?", (pid,)).fetchone()
    out["timesheet_records"] = {"count": ts["n"], "first_date": ts["first"], "last_date": ts["last"]}
    recon = (db.meta(con, "LABOUR_RECONCILIATION") or {}).get(pid)
    if recon:
        out["payroll_reconciliation"] = recon
    return out


def timesheets(con, pid, emp_id=None, date_from=None, date_to=None, limit=60):
    """Daily clock-in/clock-out records — the raw Time & Attendance evidence."""
    q = "SELECT * FROM timesheet_entries WHERE project_id=?"
    args = [pid]
    if emp_id:
        q += " AND emp_id=?"
        args.append(emp_id)
    if date_from:
        q += " AND date>=?"
        args.append(date_from)
    if date_to:
        q += " AND date<=?"
        args.append(date_to)
    total = con.execute(f"SELECT COUNT(*) n FROM ({q})", args).fetchone()["n"]
    rows = [dict(r) for r in con.execute(q + " ORDER BY date, emp_id LIMIT ?",
                                         args + [limit]).fetchall()]
    agg = con.execute(
        f"SELECT SUM(hours) normal, SUM(ot_hours) ot FROM ({q})", args).fetchone()
    return {"total_records": total,
            "sum_normal_hours": agg["normal"], "sum_ot_hours": agg["ot"],
            "entries": rows}


def alerts(con, pid=None):
    q = "SELECT * FROM risk_alerts WHERE status='open'"
    args = ()
    if pid:
        q += " AND project_id=?"
        args = (pid,)
    out = []
    for r in con.execute(q, args).fetchall():
        a = dict(r)
        a["evidence_ids"] = json.loads(a.pop("evidence_ids") or "[]")
        out.append(a)
    return out


def transactions(con, pid=None, category=None, flagged_only=False, limit=60):
    q = "SELECT * FROM cost_transactions WHERE 1=1"
    args = []
    if pid:
        q += " AND (project_id=? OR resolved_project_id=?)"
        args += [pid, pid]
    if category:
        q += " AND category=?"
        args.append(category)
    q += " ORDER BY date"
    rows = [dict(r) for r in con.execute(q, args).fetchall()]
    if flagged_only:
        rows = [r for r in rows if r["driver_cause"] or r["tag_status"] != "tagged"
                or (r["quoted_amount"] and r["amount"] > r["quoted_amount"])]
    for r in rows:
        if r.get("driver_docs"):
            r["driver_docs"] = json.loads(r["driver_docs"])
    return rows[:limit]


def incidents(con, pid):
    out = []
    for r in con.execute("SELECT * FROM incidents WHERE project_id=?", (pid,)).fetchall():
        i = dict(r)
        for k in ("docs", "ot_by_phase", "txn_ids"):
            i[k] = json.loads(i[k] or "null")
        out.append(i)
    return out


def quote_context(con):
    rf = {r["project_id"]: dict(r) for r in con.execute("SELECT * FROM reference_facts").fetchall()}
    return {"quote_request": db.meta(con, "QUOTE_REQUEST"), "reference_facts": rf}


# ------------------------------------------------------- frontend bootstrap

def bootstrap(con):
    """Rebuild the exact data shapes the frontend expects, from the DB —
    aggregates computed live, never re-read from the seed."""
    cats = _cats(con)
    projs = projects(con)
    snaps = {}
    category_data = {}
    for p in projs:
        s = snapshot(con, p["id"])
        if s:
            snaps[p["id"]] = {k: v for k, v in s.items() if v is not None or k in ("profit",)}
            category_data[p["id"]] = {
                "budget": category_budgets(con, p["id"]),
                "actual": category_actuals(con, p["id"]),
            }
    txns = []
    for t in transactions(con, limit=10_000):
        o = {
            "id": t["id"], "project_id": t["project_id"],
            "date": t["date"], "category": t["category"], "vendor": t["vendor"],
            "description": t["description"], "amount": t["amount"],
            "phase": t["phase"], "tag_status": t["tag_status"],
        }
        for src, dst in (("quoted_amount", "quoted_amount"), ("confidence", "confidence"),
                         ("resolved_project_id", "resolved_project_id"), ("inherit_via", "inherit_via")):
            if t.get(src) is not None:
                o[dst] = t[src]
        if t["driver_cause"] or t["driver_note"]:
            d = {"cause": t["driver_cause"], "note": t["driver_note"]}
            if t["driver_incident"]:
                d["incident"] = t["driver_incident"]
            if t.get("driver_docs"):
                d["docs"] = t["driver_docs"]
            o["driver"] = d
        txns.append(o)

    incs = []
    for r in con.execute("SELECT * FROM incidents").fetchall():
        i = dict(r)
        incs.append({
            "id": i["id"], "project_id": i["project_id"], "date": i["date"],
            "kind": i["kind"], "title": i["title"], "doc": i["doc"], "ref": i["ref"],
            "docs": json.loads(i["docs"] or "[]"), "ot_hours": i["ot_hours"],
            "ot_by_phase": json.loads(i["ot_by_phase"] or "{}"),
            "txnIds": json.loads(i["txn_ids"] or "[]"), "detail": i["detail"],
        })

    labour_by_project = {}
    for p in projs:
        lab = labour(con, p["id"])
        if lab:
            labour_by_project[p["id"]] = {
                "summary": {k: lab[k] for k in ("craftsmen", "normal_hours", "overtime_hours",
                                                 "total_hours", "hourly_rate", "labour_cost")},
                "ot_by_phase": lab["ot_by_phase"],
                "crew": [{"id": c["emp_id"], "name": c["name"], "role": c["role"],
                          "phase": c["phase"], "normal": c["normal_hours"], "ot": c["ot_hours"]}
                         for c in lab["crew"]],
            }

    risk_alerts = []
    for r in con.execute("SELECT * FROM risk_alerts").fetchall():
        a = dict(r)
        o = {"id": a["id"], "project_id": a["project_id"], "severity": a["severity"],
             "status": a["status"], "category": a["category"],
             "what_happened": a["what_happened"], "why_it_matters": a["why_it_matters"],
             "recommended_action": a["recommended_action"], "detection": a["detection"],
             "evidenceIds": json.loads(a["evidence_ids"] or "[]"),
             "evidenceNote": a["evidence_note"]}
        if a["expected_impact_sgd"] is not None:
            o["expected_impact_sgd"] = a["expected_impact_sgd"]
        if a["impact_note"]:
            o["impact_note"] = a["impact_note"]
        if a["crew_evidence"]:
            o["crewEvidence"] = True
        risk_alerts.append(o)

    qc = quote_context(con)
    ref_facts = {pid: {"subcontractor_overrun_pct": rf["subcontractor_overrun_pct"],
                       "labour_ot_overrun_pct": rf["labour_ot_overrun_pct"], "note": rf["note"]}
                 for pid, rf in qc["reference_facts"].items()}

    return {
        "PROJECTS": projs,
        "SNAPSHOTS": snaps,
        "CATEGORY_DATA": category_data,
        "TRANSACTIONS": txns,
        "INCIDENTS": incs,
        "LABOUR_BY_PROJECT": labour_by_project,
        "RISK_ALERTS": risk_alerts,
        "REFERENCE_FACTS": ref_facts,
        "QUOTE_REQUEST": db.meta(con, "QUOTE_REQUEST"),
        "DRIVER_NOTES": db.meta(con, "DRIVER_NOTES"),
        "PROJECT_LESSON": db.meta(con, "PROJECT_LESSON"),
        "CAUSE_LABEL": db.meta(con, "CAUSE_LABEL"),
        "LIFECYCLE_STAGES": db.meta(con, "LIFECYCLE_STAGES"),
        "OPEN_PO_TOTAL": db.meta(con, "OPEN_PO_TOTAL"),
        "CATS": cats,
        # PRJ-001 shortcut aliases used by the original views
        "BUDGET_BY_CATEGORY": category_data["PRJ-001"]["budget"],
        "ACTUAL_BY_CATEGORY": category_data["PRJ-001"]["actual"],
    }
