# Verification matrix — 004 Code mode

Route: milestone. Slices: S1 repo-to-PR core (normal Pi, web) · S2 isolation + workspace
safety (Q9/G2/R7) · S3 secrets (Q10) · S4 continuity + OMP (R8/R2) ·
S5 environments + surfaces + closure (R5/R6/R9/R11).
Design decisions: `.super-speckit/design/004-code-mode/decision.json` (Q9+Q10, 2026-10-01) ·
Grill: `.super-speckit/grills/004-code-mode/spec-grill.md`

| # | Requirement (spec ref) | Verification | Evidence expected | Slice |
| --- | --- | --- | --- | --- |
| V1 | R2/R3 engine conformance per engine | Offline deterministic adapter tests through each engine's interface: session events, approvals, steering, stop, resume, inspect changes; unsupported ops surfaced (no silent switch). OMP path gated on the Q1/G10 experiment outcome | vitest assertion output per engine | S1 (pi) / S4 (omp) |
| V2 | R1 repository-to-PR E2E per engine | Fixture repo: recorded acceptance criteria met, diff inspectable, verification record (command + exit + artifact), PR openable via workspace credential | e2e run log + PR + evidence artifact | S1 (pi) / S4 (omp) |
| V3 | R4 concurrency, zero collisions | Two tasks, one bot, in the Q9 environment; assert zero collisions across enumerated classes: listening ports, process names, service/db names, volumes/dirs (fixture matrix per plan T10). Team-box run requires the host-side docker action + doctor pass | test output + doctor log; local-docker evidence until host action lands | S2 |
| V4 | R7 takeover round trip (G1 scope) | Manual edit during takeover survives resume; in-flight shell, write_file, schedule_create, add_mcp_server each settled (signal → bounded wait → recorded exit) or blocked; pre-resume recheck vs baseline; neither side's work lost | vitest per handler + settle logs | S2 |
| V5 | R7 checkpoint restore (G2) | Selected revision restored from the versioned store; later manual edits preserved; external actions not implied rolled back (T13 policy) | vitest on revision archive + restore log | S2 |
| V6 | R8 continuity + crash | Disconnect: run continues within limits, reconnect shows pending approvals, no duplicate run. Crash: reconciled outcome = dirty-set + last recorded action, reported before retry; stopped never implies success | vitest + fault-injection test | S4 |
| V7 | R6 previews | Preview private by default (no unauthenticated access); grant → accessible; revoke → denied; sharing distinct from deploy | integration test + Playwright | S5 |
| V8 | R10 secret exclusion sweep (G5) | Granted secret values absent from prompts, transcripts, command results, checkpoints, handoff summaries, QA evidence — asserted by literal AND transform sweep (base64/hex/URL-encoded forms) over all artifact surfaces | sweep test output (green only with a planted secret) | S3 |
| V9 | R10 scoping + injection boundary (Q10) | Only granted names resolve; no wildcards; injection occurs at container create only; grep gate: zero secret values in host tree, repo tree, workspace volumes; carve-out annotation present in docs/bot-secrets.md | vitest + grep gate + doc check | S3 |
| V10 | Q10 constraint: tamper-evident audit | Every grant/inject/revoke/expire event in the JSONL chain; `audit verify` recomputes sha256 chain and detects any tampered entry; chain head matches run record | audit verify output + tamper-detection test | S3 |
| V11 | Q10 constraint: revocation + fallback honesty | TTL expiry enforced at next start; revoke without --force applies next start (documented), with --force stops container now; rotation marks grants stale; under process-level fallback driver secrets are disabled with explicit disclosure | vitest + disclosure UI/evidence | S3 |
| V12 | Q9 preflight | `code-mode doctor` on a box without docker → fail with ranked remediation; with docker → pass (endpoint, scratch container + mounts, image pull) | doctor output both cases | S2 |
| V13 | R4 session entity + lease (Q3) | Two runs cannot own one workspace: second attach refused while lease held; session durable across restarts bound to (workspace, engine) | vitest DB + API test | S1 |
| V14 | R4 lossless migration | Additive migration for session + lease tables; existing data untouched; re-run idempotent; independent review recorded (protected path) | test-integration + review note | S1 |
| V15 | R2/R8 engine continuation rules | Mid-session engine change impossible; explicit continuation to a new session MAY change engine only when labelled + handoff summary carried; original run stopped first, history preserved; engine-internal state never translated | vitest per rule | S1/S4 |
| V16 | R1 web slice E2E | Web: create session (engine picker, remembered default) → acceptance gate → run → diff + verification views; UI design-first decision recorded before implementation | Playwright spec + design decision.json | S1 |
| V17 | R5 reproducible setup | Setup definition re-runs to reproduce environment; replace reports needs-restart truthfully (service from definition not live after replace, reported vs definition) | integration test with fixture services | S5 |
| V18 | R6 reconnectable terminals (G7) | Terminal survives reconnect with scrollback (replay); resize propagates; input round-trips — requires adapter-kit pty extension | vitest adapter tests + web e2e | S5 |
| V19 | R9 budgets + idle | Idle-suspend after configured no-activity period (container stops, volume retained); budgets bound unattended work; defaults presented to user before hardcoding | vitest + recorded user sign-off on defaults | S5 |
| V20 | R11 CLI attach | CLI attaches to the server-owned session; same pending approvals visible | CLI e2e | S5 |
| V21 | R11 mobile enumeration (Q8) | Fixed workflow list recorded before mobile work; mobile shows the enumerated set or recorded degradation | task artifact + mobile test/manual evidence | S5 |

## Accepted v1 boundaries (disclosed, not bugs)

| Boundary | Source | Reversal path |
|---|---|---|
| Docker isolation = workload isolation on a trusted host, not hostile-code containment | Q9 decision + design brief D-Q9 threat model | Separate-computer runtime or hardened sandbox in a future feature |
| Secrets disabled under the process-level fallback driver | Q10 constraint 5 + design brief D-Q10 §6 | Land the host-side docker action (ranked options in D-Q9) |
| `docs/bot-secrets.md` blanket refusal stands everywhere except 004 task containers | Q10 carve-out (annotation task T20) | Widen carve-out only by a new recorded user decision |
| AD/chart-class UI parity work, debugger UI, extension compatibility | Purpose-map non-goals | New feature with its own purpose gate |
