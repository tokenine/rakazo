# Verification matrix — 002 Inspiration hub

Route: normal · Grill: .super-speckit/grills/002-inspiration-hub/spec-grill.md · Design decision: .super-speckit/design/002-inspiration-hub/decision.json (decided)

| # | Requirement (spec ref) | Verification | Evidence expected | Slice |
| --- | --- | --- | --- | --- |
| V1 | R1/R2 hub renders per user state | E2E: empty deployment (hasContent=false) → guided first actions; active deployment → recent threads/activity | Playwright spec | S1 |
| V2 | R3 Make similar | E2E: click case [Make similar] → experts.create → bot + primary thread created → client navigates to /app/:botId/:threadId | Playwright spec + RPC assertion | S1 |
| V3 | R4 visual/token + copy | grep gate: no hardcoded hex in hub/Welcome files; checker screenshot review; PR copy inventory section | lint/grep + screenshots + PR text | S1 |
| V4 | R1 mobile | Recorded degradation note (mobile keeps Home with existing activity mode; no hub/gallery in v1; reason documented) | QA note in report | S1 |
| V5 | A3 versioned catalog | Unit: INSPIRATION_CATALOG + CATALOG_VERSION exported; every case.expertKey resolves via findExpert; visual asset path exists | vitest | S1 |
| V6 | R4 copy justification | PR description contains a "Visible words" inventory section (process row — verified at PR time) | PR text | PR |
