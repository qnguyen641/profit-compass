# Requirements assessment — vs. the Demo Blueprint deck

Status of the build against every requirement in
`AI_Project_Profitability_Demo_Blueprint.pptx`. Updated at commit `520ccd9`+.

## Slide 19 — the 10 success criteria

| # | Criterion | Status | Evidence in the build |
|---|---|---|---|
| 1 | Understand project profitability | **Met** | Profit, margin, forecast computed live from the DB for all 4 projects with actuals; plan → actual → forecast chain on the KPI strip |
| 2 | Combine multiple cost sources | **Met** | SAP B1 documents + T&A clock records; per-row Source column; explicit payroll↔T&A reconciliation per project |
| 3 | Analyze transaction-level costs | **Met** | 94 itemised transactions, category → vendor → transaction drill-down, sortable ledger |
| 4 | Include hourly craftsmen labour | **Met** | 4 crews, hours × rate = cost, reconciled down to ~1,800 daily clock-in/clock-out records |
| 5 | Compare budget vs actual | **Met** | Variance table (plan/actual/forecast/Δ per category), margin bridge with tie-out to whole-project totals |
| 6 | Identify cost drivers | **Met** | Every red row carries a named cause; driver drawer shows the arithmetic + SAP B1 documents + OT caused |
| 7 | Detect profitability risks | **Met** | 3 threshold alerts (matching deck §05) with detection rule, evidence rows and recommended action |
| 8 | Forecast final project margin | **Met** | Actuals + itemised open commitments (POs, bookings, crew rosters) allocated per category; inspectable drawer |
| 9 | Answer management questions naturally | **Met** | Claude tool-use over 9 read-only DB tools; no hard-coded answer strings; local deterministic fallback |
| 10 | Explain the reasoning behind conclusions | **Met** | Evidence chain margin → category → transaction → B1 document → clock record; every explanatory number visible on-page |

## Slide 13 — the 4 required screens

Portfolio selector ✓ · Profitability dashboard (KPI strip + category chart +
budget/actual/forecast) ✓ · AI chat & insights panel (Q&A, summaries,
drill-down chips, risk feed) ✓ · Transaction drill-down (category → vendor →
transaction) ✓ — plus a Quotation Assistant beyond the spec (evidence-based
quote generation, anchored pricing, real draft-quotation write).

## Slide 14 — the 7 evaluation questions

All answered from data by the AI (tested live): most profitable · at risk ·
why margin decreased · which category drives variance · overtime spend ·
forecast final profit · how to improve margin. The deck's design note ("no
hard-coded answer strings") is honoured: answers are grounded via tool calls.

## Slides 5–6, 11–12, 15–16 — analysis logic

Formulas as specified (profit, margin %, budget→actual→forecast). Forecast
inputs: actuals ✓, completion ✓, open POs ✓ (itemised), remaining labour ✓
(approved rosters), known future costs ✓. Risk cards match the deck's three.
Insight → Recommendation → Action layers respected: the AI recommends only;
the single write (a *draft* quotation) is human-triggered, approval stays in
B1. The 11-step demo flow runs end-to-end.

## Slides 17–18 — data & integration assumptions

Synthetic checklist covered for project, cost transaction, labour (employee /
date / clock-in / clock-out / hours / OT / rate) and other-cost entities.
Integration posture per §10: B1 fully simulated, T&A pluggable, no confirmed
integration claimed (`docs/data-provenance.md` maps every element to its real
B1 source).

## Known gaps (stated, not hidden)

- **Procurement granularity**: PO lines carry amounts and quoted amounts, not
  quantity × unit cost (slide 17 lists both).
- **Forecast pace model**: forecast = actuals + committed costs; the deck also
  mentions a historical pace-of-spend component — not modelled (the
  front-loaded/linear distinction in the diagnosis partially covers it).
- **Driver narratives** in the drawer are authored synthetic text; in
  production the LLM writes them from the joined facts (chat already works
  this way live).
- **Deliberately out of scope** by product decisions during review:
  AI auto-attribution of untagged rows (removed pending defensible logic),
  net-new quote creation (hidden), cross-portfolio notification bell
  (hidden — issues live on their projects).

**Verdict: 10/10 success criteria met; the deck's demo narrative runs
end-to-end with live AI, with the gaps above documented and defensible.**
