"""AI chat — answers management questions from the database, never from canned strings.

Primary path: Anthropic Claude with tool use. The model is given read-only tools
over the profitability engine and must ground every figure in a tool result
(blueprint §06 design note: "no hard-coded answer strings").

Fallback path (no ANTHROPIC_API_KEY, or API failure): a deterministic local
analyst that computes answers with the same engine functions.
"""
import json
import os
import re

from . import db, engine

MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-5")
MAX_TOOL_TURNS = 8

SYSTEM_PROMPT = """You are Synthesis, the AI analyst inside Profit Compass — a project-profitability workspace for Q's Advertising, a Singapore company that fabricates and installs large-scale festive installations, mall activations and signage (timber frames, LED modules, fabric backdrops, site rigs).

Your data comes from SAP Business One (cost transactions, POs, A/P invoices, budgets) and a Time & Attendance system (craftsmen clock-in/clock-out, hourly rates), already loaded into the workspace database. You answer through the provided tools ONLY.

Rules:
- Every figure you state must come from a tool result in this conversation. If the tools cannot answer the question, say so plainly instead of guessing — the whole product rests on not inventing numbers.
- Currency is SGD; write amounts like S$1,500,000 or S$1.50M. Percentages to one decimal.
- Be concise: 2–5 sentences for most answers. Lead with the number, then the "why". Name specific transactions (PO-2381), vendors and incidents when they explain a variance.
- Core formulas: profit = revenue − actual cost; margin% = profit ÷ revenue × 100; forecast = actuals + committed-but-unbilled POs allocated pro-rata to category budget share; labour cost = hours worked × hourly rate.
- Evidence goes all the way down: category → transaction (PO / A/P invoice / payroll line) → incident documents, and for labour down to daily clock-in/clock-out records (get_timesheets). When asked to prove or verify a number, walk that chain. The SAP B1 labour category is full payroll; the T&A feed covers the hourly-craftsmen subset — get_labour returns the reconciliation between the two.
- Delivered (closed) projects carry the same full ledger, T&A and incident history as live ones. Report them neutrally: budgeted margin vs final margin, what went wrong AND what went right, and the lesson the next quote should inherit.
- You may use <b>…</b> for emphasis and <br/> for line breaks (answers render as HTML). No other tags, no markdown.
- You describe and recommend; you never execute changes in SAP B1. A human approves and acts.
- The user is looking at project {context_project} right now; unqualified questions ("this project", "how are we doing") refer to it. Questions about "best/worst ever", comparisons or the portfolio reach across all projects.
"""

TOOLS = [
    {"name": "get_portfolio_overview",
     "description": "All projects with computed profitability snapshots (revenue, actual cost, profit, margin, budget margin, forecast final margin), ranked by margin, plus open alert counts.",
     "input_schema": {"type": "object", "properties": {}}},
    {"name": "get_project_profitability",
     "description": "One project's full computed profitability: snapshot, per-category budget/actual/forecast variance with driver notes, margin bridge, open commitment, analyst diagnosis verdict, and the retrospective lesson if the job is delivered.",
     "input_schema": {"type": "object", "properties": {
         "project_id": {"type": "string", "description": "e.g. PRJ-001"}},
         "required": ["project_id"]}},
    {"name": "list_transactions",
     "description": "Itemised cost transactions (PO / A/P invoice / timesheet rows) for a project, optionally filtered by category or to flagged rows only (over quote, has a cost driver, or awaiting attribution).",
     "input_schema": {"type": "object", "properties": {
         "project_id": {"type": "string"},
         "category": {"type": "string", "enum": ["material", "labour", "subcontractor", "logistics", "other"]},
         "flagged_only": {"type": "boolean"}},
         "required": ["project_id"]}},
    {"name": "get_labour",
     "description": "Time & Attendance detail for a project: craftsmen count, normal/overtime hours, hourly rate, labour cost, overtime by lifecycle phase, the per-craftsman crew table, the count of underlying daily clock records, and the reconciliation between the SAP B1 payroll category and the T&A craftsmen subset.",
     "input_schema": {"type": "object", "properties": {
         "project_id": {"type": "string"}}, "required": ["project_id"]}},
    {"name": "get_timesheets",
     "description": "Raw daily Time & Attendance clock records (employee, date, clock-in, clock-out, normal hours, overtime hours, hourly rate) for a project — the lowest-level labour evidence. Filter by employee or date range; returns totals plus up to `limit` rows.",
     "input_schema": {"type": "object", "properties": {
         "project_id": {"type": "string"},
         "employee_id": {"type": "string", "description": "e.g. CR-05"},
         "date_from": {"type": "string", "description": "YYYY-MM-DD"},
         "date_to": {"type": "string", "description": "YYYY-MM-DD"},
         "limit": {"type": "integer"}},
         "required": ["project_id"]}},
    {"name": "get_risk_alerts",
     "description": "Open profitability risk alerts (severity, what happened, why it matters, expected impact, recommended action), for one project or the whole portfolio.",
     "input_schema": {"type": "object", "properties": {
         "project_id": {"type": "string", "description": "omit for all projects"}}}},
    {"name": "get_incidents",
     "description": "SAP B1 incidents that explain overtime and overspend on a project (late deliveries, scope changes, rework, site restrictions), each with document references and overtime hours by phase.",
     "input_schema": {"type": "object", "properties": {
         "project_id": {"type": "string"}}, "required": ["project_id"]}},
    {"name": "get_quote_context",
     "description": "The open quotation request (PRJ-005, Gardens by the Bay CNY 2027) with AI-suggested budget by category, plus overrun patterns from the reference projects it was priced from.",
     "input_schema": {"type": "object", "properties": {}}},
]


def _run_tool(con, name, args):
    if name == "get_portfolio_overview":
        return {"ranked_by_margin": engine.rank_by_margin(con),
                "projects": engine.projects(con),
                "open_alerts": engine.alerts(con)}
    if name == "get_project_profitability":
        pid = args["project_id"]
        if not engine.project(con, pid):
            return {"error": f"unknown project_id {pid}"}
        snap = engine.snapshot(con, pid)
        out = {"project": engine.project(con, pid), "snapshot": snap}
        if snap:
            out.update({
                "category_variance": engine.category_variance(con, pid),
                "bridge": engine.bridge(con, pid),
                "open_commitment_sgd": engine.open_commitment(con, pid),
                "diagnosis": engine.diagnosis(con, pid),
                "lesson": (db.meta(con, "PROJECT_LESSON") or {}).get(pid),
            })
        else:
            out["note"] = "Project is still quoting — no actuals yet. Use get_quote_context."
        return out
    if name == "list_transactions":
        return {"transactions": engine.transactions(
            con, args["project_id"], args.get("category"), args.get("flagged_only", False))}
    if name == "get_labour":
        lab = engine.labour(con, args["project_id"])
        return lab or {"error": "no time & attendance data for this project"}
    if name == "get_timesheets":
        return engine.timesheets(
            con, args["project_id"], args.get("employee_id"),
            args.get("date_from"), args.get("date_to"),
            min(int(args.get("limit") or 60), 200))
    if name == "get_risk_alerts":
        return {"alerts": engine.alerts(con, args.get("project_id"))}
    if name == "get_incidents":
        return {"incidents": engine.incidents(con, args["project_id"])}
    if name == "get_quote_context":
        return engine.quote_context(con)
    return {"error": f"unknown tool {name}"}


def _derive_chips(con, answer_text, context_pid):
    """Deterministic drill-down chips: if the answer names tracked categories,
    offer to open them; if it names exactly one other project, offer to open it."""
    chips = []
    low = answer_text.lower()
    cats = db.meta(con, "CATS")
    named_cats = [c for c in cats if c in low]
    for c in named_cats[:3]:
        chips.append({"label": f"Open {c.capitalize()} detail", "cat": c})
    open_project = None
    for p in engine.projects(con):
        if p["id"] != context_pid and (p["id"].lower() in low or p["name"].lower() in low):
            if open_project is None:
                open_project = p["id"]
            else:
                open_project = None
                break
    return chips, open_project


def ask_claude(question, context_pid, history):
    import anthropic
    client = anthropic.Anthropic()
    con = db.connect()
    try:
        messages = []
        for turn in (history or [])[-10:]:
            role = "assistant" if turn.get("role") == "ai" else "user"
            text = re.sub(r"<[^>]+>", "", str(turn.get("text", "")))[:2000]
            if text.strip():
                messages.append({"role": role, "content": text})
        messages.append({"role": "user", "content": question})

        system = SYSTEM_PROMPT.replace("{context_project}", context_pid or "the portfolio")
        for _ in range(MAX_TOOL_TURNS):
            resp = client.messages.create(
                model=MODEL, max_tokens=1200, system=system,
                tools=TOOLS, messages=messages,
            )
            if resp.stop_reason != "tool_use":
                text = "".join(b.text for b in resp.content if b.type == "text").strip()
                chips, open_project = _derive_chips(con, text, context_pid)
                return {"text": text, "chips": chips, "open_project": open_project,
                        "engine": "claude"}
            messages.append({"role": "assistant", "content": resp.content})
            results = []
            for block in resp.content:
                if block.type == "tool_use":
                    out = _run_tool(con, block.name, block.input or {})
                    results.append({"type": "tool_result", "tool_use_id": block.id,
                                    "content": json.dumps(out, default=str)[:24000]})
            messages.append({"role": "user", "content": results})
        return {"text": "I couldn't finish grounding that answer in the data — try a narrower question.",
                "chips": [], "open_project": None, "engine": "claude"}
    finally:
        con.close()


# ------------------------------------------------------------ local fallback

def ask_local(question, context_pid):
    """Deterministic analyst: same engine, keyword routing (port of the mock's
    typed-question router). Used when no API key is configured or the API fails."""
    con = db.connect()
    try:
        t = question.lower()
        pid = context_pid if context_pid and engine.snapshot(con, context_pid) else "PRJ-001"
        fmt, p = engine.fmt_sgd, engine.pct

        def project_answer(pid2, extra=""):
            s = engine.snapshot(con, pid2)
            d = engine.diagnosis(con, pid2)
            name = engine.project(con, pid2)["name"]
            return {"text": f"<b>{name}</b> — revenue {fmt(s['revenue'])}, cost {fmt(s['actual_cost'])}, "
                            f"profit {fmt(s['profit'])}, margin {p(s['margin_pct'])} against a "
                            f"{p(s['budget_margin_pct'])} plan. {d['verdict']}{extra}",
                    "chips": [], "open_project": pid2 if pid2 != context_pid else None,
                    "engine": "local"}

        ranked = engine.rank_by_margin(con)
        done = [r for r in ranked if r["final"]]

        if re.search(r"\b(best|highest|most profitable|top)\b", t) and re.search(r"margin|profit|project|job", t):
            return project_answer(done[0]["project_id"])
        if re.search(r"\b(worst|lowest|least profitable)\b", t):
            return project_answer(done[-1]["project_id"])
        if re.search(r"compare|versus| vs |all project|every project|portfolio|rank", t):
            lines = [f"<b>{p(r['margin_pct'])}</b> — {r['name']} "
                     f"({'final' if r['final'] else 'in progress'}, "
                     f"{'+' if r['vs_plan'] > 0 else ''}{r['vs_plan']} vs plan)" for r in ranked]
            return {"text": "Ranked by margin:<br/>" + "<br/>".join(lines),
                    "chips": [], "open_project": None, "engine": "local"}
        if re.search(r"\brisk|at risk|worried|attention\b", t):
            alerts = engine.alerts(con)
            high = [a for a in alerts if a["severity"] == "high"]
            worst_pid = (high or alerts)[0]["project_id"] if alerts else None
            if worst_pid:
                s = engine.snapshot(con, worst_pid)
                name = engine.project(con, worst_pid)["name"]
                drop = round(s["budget_margin_pct"] - (s.get("forecast_final_margin_pct") or s["margin_pct"]), 1)
                return {"text": f"<b>{name}</b> ({worst_pid}) — {len([a for a in alerts if a['project_id']==worst_pid])} "
                                f"open alerts including {'a high-severity one' if high else 'medium-severity ones'}, and its "
                                f"forecast margin has slipped {drop} points below plan "
                                f"({p(s['budget_margin_pct'])} → {p(s.get('forecast_final_margin_pct') or s['margin_pct'])}).",
                        "chips": [], "open_project": worst_pid if worst_pid != context_pid else None,
                        "engine": "local"}
        if re.search(r"overtime|\bot\b|hours|crew|craftsm|who worked", t):
            lab = engine.labour(con, pid) or engine.labour(con, "PRJ-001")
            top = sorted(lab["crew"], key=lambda c: -c["ot_hours"])[:2]
            inst = lab["ot_by_phase"].get("installation", 0)
            return {"text": f"{lab['overtime_hours']:.0f} overtime hours across {lab['craftsmen']} craftsmen, "
                            f"{inst:.0f} of them in Installation. Highest overtime: {top[0]['name']} at "
                            f"{top[0]['ot_hours']:.0f} h and {top[1]['name']} at {top[1]['ot_hours']:.0f} h.",
                    "chips": [{"label": "Open crew detail", "cat": "labour"}],
                    "open_project": None, "engine": "local"}
        for c in db.meta(con, "CATS"):
            if c in t:
                v = next(x for x in engine.category_variance(con, pid) if x["category"] == c)
                note = f" {v['driver_note']}" if v.get("driver_note") else ""
                sign = "+" if v["delta_pct"] > 0 else ""
                word = "lost" if v["delta_amount"] > 0 else "gained"
                return {"text": f"On {engine.project(con, pid)['name']}: {c} is {sign}{v['delta_pct']}% against plan "
                                f"({fmt(v['actual'])} actual vs {fmt(v['budget'])} budget) — "
                                f"{fmt(abs(v['delta_amount']))} {word} on margin.{note}",
                        "chips": [{"label": f"Open {c.capitalize()} detail", "cat": c}],
                        "open_project": None, "engine": "local"}
        for proj in engine.projects(con):
            words = proj["name"].lower().split()
            if words[0] in t and words[-1] in t and engine.snapshot(con, proj["id"]):
                return project_answer(proj["id"])
        if re.search(r"forecast|final (profit|cost|margin)", t):
            s = engine.snapshot(con, pid)
            if not s["final"] and s.get("forecast_final_margin_pct") is not None:
                return {"text": f"{engine.project(con, pid)['name']}: forecast final cost "
                                f"{fmt(s.get('forecast_final_cost'))}, forecast final margin "
                                f"{p(s['forecast_final_margin_pct'])} against a {p(s['budget_margin_pct'])} plan, "
                                f"with {fmt(engine.open_commitment(con, pid))} committed but not yet billed.",
                        "chips": [], "open_project": None, "engine": "local"}
        if re.search(r"profit|margin|how much|how did|doing", t):
            return project_answer(pid)
        return {"text": "I can't ground that one in the data I have, so I won't guess. Try: which project "
                        "made the best margin, how a project is doing, a single category, or overtime and crew hours.",
                "chips": [], "open_project": None, "engine": "local"}
    finally:
        con.close()


def answer(question, context_pid, history):
    if os.environ.get("ANTHROPIC_API_KEY"):
        try:
            return ask_claude(question, context_pid, history)
        except Exception as e:  # noqa: BLE001 — demo must degrade, not 500
            out = ask_local(question, context_pid)
            out["engine"] = f"local (claude failed: {type(e).__name__})"
            return out
    return ask_local(question, context_pid)
