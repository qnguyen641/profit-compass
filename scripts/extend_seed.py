#!/usr/bin/env python3
"""Extend seed.json so every project with actuals has the same evidential depth:
a full transaction ledger and Time & Attendance data (PRJ-004 was aggregate-only).

Every amount reconciles exactly to the category totals already in CATEGORY_DATA,
so live-computed aggregates do not move by a single dollar.
"""
import json
from pathlib import Path

SEED = Path(__file__).resolve().parent.parent / "backend" / "data" / "seed.json"
seed = json.loads(SEED.read_text())

# ---- PRJ-004 · Mall Activation Q2 2026 — itemised ledger --------------------
# Sums per category equal CATEGORY_DATA['PRJ-004'].actual exactly:
# material 112,000 · labour 82,000 · subcontractor 38,000 · logistics 22,000 · other 14,000
PRJ004_TXNS = [
    # material — 112,000
    {"id": "PO-4102", "project_id": "PRJ-004", "date": "2026-03-18", "category": "material",
     "vendor": "Heng Long Timber Supplies", "description": "Timber & board — activation structures",
     "amount": 38500, "phase": "procurement", "tag_status": "tagged"},
    {"id": "PO-4110", "project_id": "PRJ-004", "date": "2026-04-06", "category": "material",
     "vendor": "BrightLite Displays", "description": "LED modules & screens",
     "amount": 29800, "phase": "fabrication", "tag_status": "tagged"},
    {"id": "PO-4118", "project_id": "PRJ-004", "date": "2026-04-14", "category": "material",
     "vendor": "Nova Fabric Co.", "description": "Fabric graphics & branding",
     "amount": 21400, "phase": "fabrication", "tag_status": "tagged"},
    {"id": "PO-4125", "project_id": "PRJ-004", "date": "2026-03-25", "category": "material",
     "vendor": "SinCo Hardware", "description": "Fixings & hardware",
     "amount": 12300, "phase": "procurement", "tag_status": "tagged"},
    {"id": "PO-4131", "project_id": "PRJ-004", "date": "2026-04-20", "category": "material",
     "vendor": "Prism Paint & Coatings", "description": "Finishing paint",
     "amount": 10000, "phase": "fabrication", "tag_status": "tagged"},
    # labour — 82,000
    {"id": "TS4-D-01", "project_id": "PRJ-004", "date": "2026-03-06", "category": "labour",
     "vendor": "Design Studio (internal)", "description": "Design studio hours",
     "amount": 14200, "phase": "design", "tag_status": "tagged"},
    {"id": "TS4-P-01", "project_id": "PRJ-004", "date": "2026-03-27", "category": "labour",
     "vendor": "Site Survey Team (internal)", "description": "Procurement / site-survey labour",
     "amount": 9800, "phase": "procurement", "tag_status": "tagged"},
    {"id": "TS4-F-01", "project_id": "PRJ-004", "date": "2026-04-24", "category": "labour",
     "vendor": "Fabrication Crew (internal)", "description": "Fabrication crew payroll",
     "amount": 31500, "phase": "fabrication", "tag_status": "tagged"},
    {"id": "TS4-F-02", "project_id": "PRJ-004", "date": "2026-05-08", "category": "labour",
     "vendor": "Fabrication Crew (internal)", "description": "Fabrication crew payroll",
     "amount": 26500, "phase": "fabrication", "tag_status": "tagged"},
    # subcontractor — 38,000
    {"id": "SC4-201", "project_id": "PRJ-004", "date": "2026-04-10", "category": "subcontractor",
     "vendor": "Stellar Rigging & Structures", "description": "Scaffolding & access subcontract",
     "amount": 23500, "quoted_amount": 24800, "phase": "fabrication", "tag_status": "tagged"},
    {"id": "SC4-210", "project_id": "PRJ-004", "date": "2026-05-02", "category": "subcontractor",
     "vendor": "Apex Audio-Visual Pte Ltd", "description": "AV subcontract — deposit on firm quote",
     "amount": 14500, "phase": "fabrication", "tag_status": "tagged"},
    # logistics — 22,000
    {"id": "LOG4-501", "project_id": "PRJ-004", "date": "2026-03-30", "category": "logistics",
     "vendor": "SwiftHaul Logistics", "description": "Storage & warehousing",
     "amount": 9200, "phase": "procurement", "tag_status": "tagged"},
    {"id": "LOG4-510", "project_id": "PRJ-004", "date": "2026-05-06", "category": "logistics",
     "vendor": "SwiftHaul Logistics", "description": "Delivery to site — single venue, no inter-site haulage",
     "amount": 12800, "phase": "fabrication", "tag_status": "tagged"},
    # other — 14,000
    {"id": "OTH4-801", "project_id": "PRJ-004", "date": "2026-03-04", "category": "other",
     "vendor": "InsureAll Brokers", "description": "Project insurance",
     "amount": 8300, "phase": "design", "tag_status": "tagged"},
    {"id": "OTH4-810", "project_id": "PRJ-004", "date": "2026-03-21", "category": "other",
     "vendor": "Site Safety & Permits Co.", "description": "Permits & safety compliance",
     "amount": 5700, "phase": "procurement", "tag_status": "tagged"},
]

# ---- PRJ-004 Time & Attendance — fabrication-phase crew of 5 ----------------
# crew sums: normal 2,600 · ot 140; cost = 2,740 h x S$27 = S$73,980
PRJ004_LABOUR = {
    "summary": {"craftsmen": 5, "normal_hours": 2600, "overtime_hours": 140,
                "total_hours": 2740, "hourly_rate": 27, "labour_cost": 73980},
    "ot_by_phase": {"design": 6, "procurement": 24, "fabrication": 110},
    "crew": [
        {"id": "CR-02", "name": "Rahman Bin Yusof", "role": "Lead Fabricator", "phase": "fabrication", "normal": 560, "ot": 38},
        {"id": "CR-03", "name": "Lim Chee Keong", "role": "Fabricator", "phase": "fabrication", "normal": 540, "ot": 32},
        {"id": "CR-04", "name": "Muthu Kumar", "role": "Fabricator", "phase": "fabrication", "normal": 530, "ot": 28},
        {"id": "CR-08", "name": "Goh Boon Hock", "role": "Carpenter", "phase": "fabrication", "normal": 500, "ot": 24},
        {"id": "CR-09", "name": "Zulkifli Hassan", "role": "Painter / Finisher", "phase": "fabrication", "normal": 470, "ot": 18},
    ],
}

# ---- Explicit payroll ↔ T&A reconciliation (SAP B1 labour category is the ---
# full payroll; the T&A feed covers the hourly craftsmen subset of it) --------
LABOUR_RECONCILIATION = {
    "PRJ-001": {"payroll_total_b1": 265000, "ta_craftsmen_cost": 135800,
                "note": "T&A covers the 10 hourly craftsmen (4,850 h × S$28). The remaining S$129,200 of the B1 labour category is salaried/internal-team payroll posted as TS-* lines (design studio, site survey, event-day and dismantling crews)."},
    "PRJ-002": {"payroll_total_b1": 277000, "ta_craftsmen_cost": 139860,
                "note": "T&A covers the 11 hourly craftsmen (5,180 h × S$27); the rest of the labour category is salaried/internal-team payroll lines."},
    "PRJ-003": {"payroll_total_b1": 214000, "ta_craftsmen_cost": 101790,
                "note": "T&A covers the 8 hourly craftsmen (3,770 h × S$27); the rest of the labour category is salaried/internal-team payroll lines."},
    "PRJ-004": {"payroll_total_b1": 82000, "ta_craftsmen_cost": 73980,
                "note": "T&A covers the 5 hourly craftsmen (2,740 h × S$27); the rest is design-studio and survey payroll."},
}

new_ids = {t["id"] for t in PRJ004_TXNS}
seed["TRANSACTIONS"] = [t for t in seed["TRANSACTIONS"] if t["id"] not in new_ids]
added = PRJ004_TXNS
seed["TRANSACTIONS"].extend(added)

# ---- Remove AI auto-attribution: the three untagged rows become ordinary ----
# tagged ledger lines with a proper project code. Amounts unchanged, so every
# total stays identical — only the "AI matched this" mechanism is retired.
RETAG = {
    "AP-8834": {"vendor": "GlowTech Lighting Pte Ltd",
                "description": "LED strip replenishment — expedited",
                "keep_driver": True},
    "LOG-710": {"vendor": "SwiftHaul Logistics",
                "description": "Freight charge — final-phase deliveries",
                "keep_driver": False},
    "OTH-915": {"vendor": "SinCo Hardware",
                "description": "Site sundries & consumables",
                "keep_driver": False},
}
for t in seed["TRANSACTIONS"]:
    r = RETAG.get(t["id"])
    if not r:
        continue
    t["project_id"] = t.pop("resolved_project_id", t.get("project_id")) or "PRJ-001"
    t["tag_status"] = "tagged"
    t["vendor"] = r["vendor"]
    t["description"] = r["description"]
    for k in ("confidence", "inherit_via"):
        t.pop(k, None)
    if not r["keep_driver"]:
        t.pop("driver", None)
    elif t.get("driver"):
        t["driver"].pop("cause", None) if t["driver"].get("cause") in ("no_reference", "site_match_only") else None

# ---- Quote cost-base BUILD-UP: who gets paid, for what, per category --------
# Each line = mean of the two reference jobs' actuals for that vendor+work,
# scaled so the category sums exactly to the reference-based base budget;
# labour & subcontractor then carry an explicit, reasoned contingency line.
REFS = seed["QUOTE_REQUEST"]["reference_project_ids"]          # PRJ-002, PRJ-003


def _norm(desc):
    return desc.split("—")[0].split("(")[0].strip().rstrip(" &")


def build_lines(cat):
    groups = {}
    for t in seed["TRANSACTIONS"]:
        if t.get("project_id") in REFS and t["category"] == cat:
            key = (t["vendor"], _norm(t["description"]))
            g = groups.setdefault(key, {"vendor": t["vendor"], "description": _norm(t["description"]),
                                        "refs": {}, })
            g["refs"][t["project_id"]] = g["refs"].get(t["project_id"], 0) + t["amount"]
    lines = []
    for g in groups.values():
        g["mean"] = sum(g["refs"].values()) / len(REFS)   # a line seen on one ref weighs half
        lines.append(g)
    base = seed["QUOTE_REQUEST"]["base_budget_by_category_no_contingency"][cat]
    scale = base / sum(g["mean"] for g in lines)
    out = []
    for g in sorted(lines, key=lambda x: -x["mean"]):
        out.append({"vendor": g["vendor"], "description": g["description"],
                    "amount": int(round(g["mean"] * scale / 100) * 100),
                    "basis": {"ref_actuals": g["refs"],
                              "method": "mean of reference actuals × scale to base budget"}})
    out[0]["amount"] += base - sum(l["amount"] for l in out)   # absorb rounding drift
    suggested = seed["QUOTE_REQUEST"]["suggested_budget_by_category"][cat]
    if suggested != base:
        reason = {
            "labour": "Installation overtime ran +18% (PRJ-002) and +22% (PRJ-003) over budget — contingency priced in up front instead of being absorbed as overrun.",
            "subcontractor": "Subcontracts closed +19% (PRJ-002) and +8% (PRJ-003) over — buffer held until a firm quote replaces the estimate.",
        }.get(cat, "Contingency from reference overrun pattern.")
        out.append({"vendor": "— contingency —", "description": "Reference-pattern contingency",
                    "amount": suggested - base, "contingency": True, "reason": reason,
                    "basis": {"method": "suggested − base", "ref_actuals": {}}})
    assert sum(l["amount"] for l in out) == suggested, (cat, sum(l["amount"] for l in out), suggested)
    return out


seed["QUOTE_REQUEST"]["build_up"] = {c: build_lines(c) for c in seed["CATS"]}

# ---- OPEN COMMITMENTS: itemise "committed, not yet billed" -----------------
# Money contractually held but not yet in actuals: open POs (ordered, not
# received/invoiced), bookings for later phases, and crew rosters approved in
# T&A but not yet worked. Each line allocates to its OWN category in the
# forecast — no pro-rata spreading. Sums reconcile exactly to the totals the
# model already used (PRJ-001: S$85,000 · PRJ-004: S$2,940).
seed["OPEN_COMMITMENTS"] = [
    {"id": "OPO-2501", "project_id": "PRJ-001", "vendor": "GlowTech Lighting Pte Ltd",
     "description": "Event-week LED spares & standby stock — ordered, not received",
     "category": "material", "amount": 16800, "kind": "open_po", "due_date": "2026-07-08", "doc_ref": "PO-2501"},
    {"id": "OPO-2503", "project_id": "PRJ-001", "vendor": "Nova Fabric Co.",
     "description": "Backdrop refresh panels for event week — in production",
     "category": "material", "amount": 11500, "kind": "open_po", "due_date": "2026-07-10", "doc_ref": "PO-2503"},
    {"id": "CMT-2506", "project_id": "PRJ-001", "vendor": "Event-Day Crew (internal)",
     "description": "Approved standby roster for event week — hours not yet worked",
     "category": "labour", "amount": 10200, "kind": "crew_roster", "due_date": "2026-07-12", "doc_ref": "T&A roster W28"},
    {"id": "CMT-2507", "project_id": "PRJ-001", "vendor": "Dismantling Crew (internal)",
     "description": "Remaining dismantling shifts on the approved schedule",
     "category": "labour", "amount": 13500, "kind": "crew_roster", "due_date": "2026-07-25", "doc_ref": "T&A roster W29–30"},
    {"id": "OPO-2510", "project_id": "PRJ-001", "vendor": "Apex Audio-Visual Pte Ltd",
     "description": "Event-phase AV rental balance — invoiced after the event",
     "category": "subcontractor", "amount": 17000, "kind": "open_po", "due_date": "2026-07-14", "doc_ref": "SC-412 balance"},
    {"id": "OPO-2515", "project_id": "PRJ-001", "vendor": "SwiftHaul Logistics",
     "description": "Dismantling haulage & crane booking",
     "category": "logistics", "amount": 9400, "kind": "booking", "due_date": "2026-07-22", "doc_ref": "BK-7741"},
    {"id": "OPO-2520", "project_id": "PRJ-001", "vendor": "CleanSweep Site Services",
     "description": "Post-event site restoration — PO signed",
     "category": "other", "amount": 6600, "kind": "open_po", "due_date": "2026-07-28", "doc_ref": "PO-2520"},
    {"id": "OPO-4201", "project_id": "PRJ-004", "vendor": "BrightLite Displays",
     "description": "Screen commissioning spares — on order",
     "category": "material", "amount": 2940, "kind": "open_po", "due_date": "2026-06-05", "doc_ref": "PO-4201"},
]
assert sum(c["amount"] for c in seed["OPEN_COMMITMENTS"] if c["project_id"] == "PRJ-001") == seed["OPEN_PO_TOTAL"]
assert sum(c["amount"] for c in seed["OPEN_COMMITMENTS"] if c["project_id"] == "PRJ-004") == 2940

for a in seed["RISK_ALERTS"]:
    if a["id"] == "RA-3":
        a["evidenceNote"] = ("S$85,000 across 7 itemised commitments: two material POs for event week, "
                             "the approved event and dismantling crew rosters, the AV rental balance, a "
                             "haulage booking and site restoration. Each lands in its own category in the "
                             "forecast column — none of it is invoiced yet.")
seed["LABOUR_BY_PROJECT"]["PRJ-004"] = PRJ004_LABOUR
seed["LABOUR_RECONCILIATION"] = LABOUR_RECONCILIATION

# verify reconciliation before writing
cats = seed["CATS"]
for pid, cd in seed["CATEGORY_DATA"].items():
    sums = {c: 0 for c in cats}
    for t in seed["TRANSACTIONS"]:
        if (t.get("project_id") or t.get("resolved_project_id")) == pid:
            sums[t["category"]] += t["amount"]
    for c in cats:
        assert sums[c] == cd["actual"][c], (pid, c, sums[c], cd["actual"][c])
for pid, lab in seed["LABOUR_BY_PROJECT"].items():
    s = lab["summary"]
    assert sum(c["normal"] for c in lab["crew"]) == s["normal_hours"], pid
    assert sum(c["ot"] for c in lab["crew"]) == s["overtime_hours"], pid
    assert s["normal_hours"] + s["overtime_hours"] == s["total_hours"], pid
    assert s["total_hours"] * s["hourly_rate"] == s["labour_cost"], pid

SEED.write_text(json.dumps(seed, indent=1))
print(f"seed extended: +{len(added)} PRJ-004 transactions, PRJ-004 T&A, reconciliation block. All checks passed.")
