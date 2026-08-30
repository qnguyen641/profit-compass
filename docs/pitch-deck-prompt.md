# Prompt — Profit Compass pitch deck

Paste everything below the line into a new chat to generate the deck.

---

Create a pitch deck (PowerPoint, 16:9, ~13 slides) introducing **Profit Compass** — a WORKING application, not a concept. Audience: management at Q's Advertising (a Singapore company that fabricates and installs large-scale festive installations, mall activations and signage) plus internal stakeholders. The deck introduces what the application is, what it proves, and what it would take to productionise. It runs live at http://5.223.71.214:8018.

## What the application is (all of this is built and demoable)

Profit Compass is an AI project-profitability workspace on top of SAP Business One + a Time & Attendance feed. Full-stack demo: FastAPI + SQLite holding transaction-level synthetic data (94 cost transactions, ~1,800 daily clock-in/clock-out records, incidents with B1 document references, itemised open commitments), every aggregate computed live, and an AI analyst (Claude with 9 read-only database tools) that answers management questions grounded in that data — no hard-coded answers, with a deterministic fallback engine.

## Narrative arc (one message per slide)

1. **Title** — "Profit Compass · AI-Powered Project Profitability on SAP Business One". Subtitle: built and running — a live application, not a mockup.
2. **The problem** — margin moves before the report catches it. Cost lands from many disconnected sources across a project's lifecycle (materials, hourly craftsmen, subcontractors, logistics); by the time SAP reports are reconciled, margin has shifted. The management question: *"Are we actually making money on this project, what is driving it — and are we pricing the next one right?"*
3. **The portfolio in the demo** — 5 projects, ALL at full transaction depth: Orchard Road Christmas 2026 (hero, in progress 71%, S$1.50M, margin 29.3% → forecast 23.8%, HIGH RISK), Orchard Road Christmas 2025 (closed, plan 30% → 24.0%), Gardens by the Bay Festive 2025 (closed, plan 31% → 26.0%), Mall Activation Q2 2026 (in progress 45%, 31.5%, healthy, front-loaded), Gardens by the Bay CNY 2027 (being quoted).
4. **Two data sources, one evidence chain** — SAP B1 (POs, A/P invoices, subcontracts, budgets, incidents-as-documents) + Time & Attendance (hours × rate = labour cost). Every row on screen carries a Source badge, and labour reconciles exactly: daily clock records → per-craftsman totals → crew summary → payroll category, with the payroll↔T&A split stated per project.
5. **The core principle** — *numbers are computed, language is generated.* Aggregates say WHAT the margin is; transactions let the AI explain WHY. The AI holds 9 read-only tools over the database (profitability, variance, transactions, labour, timesheets, risks, incidents, vendor history, quote context); it never invents a figure, and when data can't answer, it says so.
6. **WOW 1 — ask, don't query.** "How profitable is Orchard Road Christmas?" → instant grounded answer: revenue S$1.50M, cost S$1.06M, profit S$440K, margin 29.3%, forecast 23.8% — with the three leaks ranked and drill chips offered.
7. **WOW 2 — why, all the way down.** Margin −6.2pts → Material +20% (−S$60K) → PO-2381 timber quoted S$34,900, paid S$46,800 (+34%) → the B1 documents (PO, A/P invoice, revised price list) → the vendor's track record across all jobs: 1 of 5 Heng Long orders carries a quote reference; the rest read **NO QUOTE ON FILE — repricing undetectable**. Honesty is a feature: the app reports its own blind spots.
8. **Instruments that reconcile** — the margin bridge (planned tracked cost → forecast, every step a category variance, tie-out lines to the whole-project totals on the KPI strip), burn-vs-progress with both denominators named, and a diagnosis that tells a front-loaded fabrication job ("99% of forecast committed at 45% delivered — by design") apart from a genuinely slipping one.
9. **Risk & commitments** — three threshold alerts (what happened / why it matters / expected impact / recommended action), and "Committed, not yet billed" is itemised and inspectable: S$85K = 2 material POs + approved event & dismantling crew rosters + AV balance + haulage booking + site restoration, each landing in its own forecast category.
10. **WOW 3 — the Quotation Assistant.** Generate a quote for Gardens by the Bay CNY 2027 from delivered-job evidence: cost estimate S$898,000 (contingencies visible as striped bar segments with their reasons — OT ran +18/22% on both references), "Where the money goes" build-up to payee level, pricing as a margin ladder anchored to history (30% = what both refs planned and missed · 28% recommended · 26% best delivered · 24% worst), and Approve performs a REAL write: a revisioned draft quotation into the B1 pipeline.
11. **Boundaries** — the AI identifies and recommends; humans act. The single write is the human-triggered draft quote; everything else is read-only against B1. Deliberately out of scope for now (stated, not hidden): AI auto-attribution of untagged costs, net-new quote briefs, pace-of-spend forecasting.
12. **The learning loop** — post-mortem of a delivered job feeds the next quote (Orchard Road 2025's overruns are literally the contingency lines in the CNY 2027 draft). Value line: days of manual reconciliation and guesswork pricing → seconds of grounded, explainable answers.
13. **Status & the 90-second live script** — 10/10 blueprint success criteria met. Script: Portfolio (one card flagged HIGH RISK) → open Orchard Road → KPI strip + diagnosis → ask "why is margin down?" → drill to PO-2381 → vendor track record → back to Portfolio → open the CNY 2027 quote → Generate → evidence appears → pick 28% on the ladder → Create draft quotation in B1. Close with the production path: B1 Service Layer integration, preventive quote-validity controls at PO time, OT↔incident linking as suggest-plus-confirm.

## Real numbers (use these; do not invent)

Hero: revenue 1,500,000 · actual 1,060,000 · profit 440,000 · margin 29.3% · plan 30.0% · forecast 23.8% · plan cost 1,050,000 · tracked plan 900,000 + 150,000 overheads · open commitments 85,000 (7 items) · material 360K vs 300K (+20%) · subcontractor 210K vs 180K (+17%) · labour 265K vs 250K (+6%, 650 OT hours, 420 in installation, 10 craftsmen × S$28/h = 135,800 T&A subset) · PO-2381 +34% vs quote. Quote: cost base 898,000 · at 28% → S$1,247,222 · labour contingency 41,000 · subcontractor contingency 24,000.

## Design language (match the product and the source decks)

Numbered section labels ("01 · BUSINESS PROBLEM") top-left, page number bottom-right. Slide titles are claims, not topics ("Margin moves before the report catches it"). Monospace uppercase micro-labels for data captions; SGD figures formatted S$1.50M / S$440K. Drafting-sheet palette: ink navy on warm paper white, critical red and amber used only where the data is red/amber, green sparingly. Chains drawn with arrows (Insight → Category → Vendor → Transaction). AI answers styled as quoted chat bubbles. One footer "value line" sentence per section. Leave a clearly-marked placeholder frame on slides 6–10 for live screenshots from the running app (name which screen each needs). No stock imagery, no hype adjectives — every claim carries a number.

Deck language: English. Before building, ask me only if a required fact is missing — otherwise build the full deck.
