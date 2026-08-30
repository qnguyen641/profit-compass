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
