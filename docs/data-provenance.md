# Data provenance — where "why it cost more" comes from

Every driver note and incident in the demo is **authored synthetic data** in
`backend/data/seed.json`, written to mirror the shape of real SAP Business One
documents. This file maps each element to its real-world source, so the demo
can be defended honestly: what a production build would read automatically,
what needs operational discipline, and what must be built.

## Tier 1 — facts that exist in SAP B1 today (join, don't author)

| Demo element | Real source in SAP B1 |
|---|---|
| Late delivery (INC-001/101/202) | PO promised date (`OPOR.DocDueDate`) vs Goods Receipt PO posting date (`OPDN.DocDate`) — natively linked as base/target documents. Delay in days is arithmetic. |
| Over quote (PO-2381 +34%) | Purchase Quotation (`OPQT`) → PO → A/P Invoice (`OPCH`) chain. Quote price vs invoiced price is a join, provided the PO was raised from a quotation. |
| Committed on estimate, not a firm quote (SC-410) | A PO **without** a base Purchase Quotation reference — detectable by the *absence* of the link. |
| Rework / replacement (INC-003/103) | Goods Return (`ORDN`) + matching A/P Credit Memo (`ORPC`), plus the replacement PO from the same vendor. All real documents. |
| Client scope change (INC-002/102/201) | Sales Order revision history (`ADOC` archive): SO amended after fabrication start, new PO raised against the amendment, contract value unchanged — all comparable across document versions. |
| Open commitments (RA-3, S$85K) | Open POs: ordered minus received/invoiced quantities. Standard B1 query. |
| Site restriction (INC-004/203) | Service Calls (`OSCL`) — exists **only if** the company logs site conditions there. |
| Budget vs actual per category | Project budget + cost transactions with project/cost-centre codes. |

## Tier 2 — exists if the customer's operations are disciplined

- **Quote references on POs** — the +34% story needs buyers to raise POs from
  quotations. If they don't, the system can still say "no quote on file"
  (which is itself the estimate-not-quote finding).
- **Project codes on every document** — the demo assumes clean tagging (the
  AI-attribution feature for untagged rows was deliberately removed).
- **T&A job allocation** — hours must be clocked against a project for
  labour cost = hours × rate to allocate. Blueprint §10 already marks the
  T&A system as assumed, not confirmed.

## Tier 3 — must be built (not in any ERP)

- **OT ↔ incident linkage** ("260 of these OT hours absorbed the late LED
  delivery"): the ERP knows the delay and T&A knows the hours, but nothing
  connects them. Production options: (a) rule-based candidate matching
  (phase + date window + crew) with **human confirmation**, or (b) a
  supervisor tags the incident when approving timesheets. The demo's
  "unexplained overtime" rows model the honest fallback: hours that match
  no incident are reported as unexplained, never absorbed.
- **The narrative sentence itself** ("Quoted S$34,900 and ordered 10 weeks
  later without re-confirming…"): in production this is what the LLM layer
  writes — generated from the Tier-1 joined facts at read time, citing the
  documents it read. In the demo the sentences are pre-authored; the chat
  answers are already generated live from the database by the same pattern.

## The honest one-liner for the demo room

> The documents, dates and amounts behind every red row are standard SAP B1
> records — production reads them instead of authoring them. The AI writes
> the explanation sentences from those records. The one genuinely new data
> link is overtime-to-incident, which ships as suggestion + human confirm;
> anything unmatched is reported as unexplained, exactly as this demo does.
