# Spec grill — 004-code-mode (r1)

- Date: 2026-10-01
- Feature: 004-code-mode (branch tl/004-purpose-gate-r1, spec at specs/004-code-mode/spec.md)
- Method: three scouts fanned in one batch as subagents per standing user directive —
  Builder (smallest coherent shape), Examiner (adversarial, path:line, severity-tagged),
  Investigator (6–8 questions, proven/inferred/unknown). Owner (Tech Lead) resolved.
- Citation audit: Examiner re-verified every spec citation at the gate branch — **no wrong
  citations found**; findings below are omissions, framing, and contradictions.

## Resolver table

| # | Question | Resolution | Classification | Evidence | Verification consequence |
|---|---|---|---|---|---|
| G1 | Is the takeover gap really shell-only? | **No — spec amended.** Gap covers every unguarded state-changing handler: shell, write_file, schedule_create, add_mcp_server. | proven | executor.ts:2424-2436 (write_file marks workspace dirty, no guard), :2761, :2865 vs guarded :2334/:2345/:2604/:2632/:2682 | V4 asserts write_file (not just shell) is settled/blocked during takeover |
| G2 | Does "restore honors a selected revision" have anything to restore from? | **No archive exists.** Versioned workspace store is in-scope build work; A1 clarified (no new *database* engine ≠ no versioned file store). | proven gap | home.ts:57-82 (`.previous` deleted after commit), :86-93 (`_revision` unused), computer-workspace.ts:96-100 (stamp-only for docker/cloudflare) | plan must include the versioned store; V5 tests selected-revision restore for real |
| G3 | What execution environment isolates concurrent tasks? | **OPEN — decision Q9 before plan**: separate computers vs in-computer namespacing (docker); cost/quota tradeoff. | unknown | docs/computer-runtime.md:34 ("Team bots share the OS user, workspace…") | V3 fixture matrix blocked on the decision |
| G4 | R2 "fixed per session" vs R8 "continuation into a new session" — can continuation switch engines? | **Resolved:** continuation MAY switch engine only as explicit, labelled new session carrying the handoff summary; mid-session switch impossible; never silent/automatic. Spec R2/R8 amended. | resolved by owner | R2/R8 amended text | V1/V6 conformance distinguishes labelled cross-engine continuation from silent switch |
| G5 | Are secrets really excluded from checkpoints/handoffs, and does R10 conflict with documented boundaries? | **Conflict is real.** Transcript redaction exists but is literal-only and covers none of checkpoints; `docs/bot-secrets.md` explicitly refuses env/file/shell injection. V8 strengthened (literal + base64/hex/URL transform sweep over all artifact surfaces); boundary revision recorded as decision Q10 before plan. | proven conflict | docs/bot-secrets.md boundary section; executor.ts:5016 (plaintext env into CommandRequest), :2601 (literal redaction of command results only); home.ts checkpoints = raw snapshots | V8 must sweep encoded forms over checkpoints + handoffs; green V8 impossible until Q10 decided |
| G6 | Does the CLI in R11 exist? | **No.** CLI is a new package; sequenced after web (A4). Spec R11 amended. | proven absence | apps/ = api, cf-bridge, desktop, mobile, web, worker, www — no CLI | CLI matrix rows marked later-slice; v1 acceptance runs on web |
| G7 | Can R6 terminals be built on current interfaces? | **No — adapter-kit extension required** (pty session identity, resize/replay events, attach). Recorded as plan work. | proven | types.ts:65-76 (pty = bare flag; ProcessEvent = stdout/stderr/exit), interfaces.ts:102-106 (fire-once AsyncIterable) | plan owns adapter-kit changes; terminal verification covers reconnect + resize |
| G8 | Citation nits | "nine sandboxes" → eight real providers + fake-sandbox test double; OMP expanded at first use; uncited Problem claims now cited. Spec fixed. | proven | research doc citation note; docker-sandbox.ts:118; fake-sandbox.ts:42 | none (accuracy) |
| G9 | Unmeasurable phrasings (R1 "agree", R4 collisions, R5 "needs restart", R7 "settle", R8 "reconcile", R9 "idle") | **Resolved observably:** R1 = recorded acceptance artifact gated before first edit; R4 = enumerated collision classes (ports, process names, service/db names, volumes); R5 = service liveness vs setup definition after replace; R7 = signal→bounded wait→recorded exit; R8 = workspace dirty-set + last recorded action; R9 = configured no-activity period. Spec amended. | resolved by owner | amended R1/R4/R5/R7/R8/R9 text | each V row now asserts a named observable |
| G10 | OMP integration seam (Q1) | **OPEN — inferred:** RPC sidecar (`omp --mode rpc`, JSONL stdio) inside the workspace sandbox; in-process SDK impossible (SDK needs Bun ≥1.3.14, server is Node ^22/24/26). Settle by experiment before engine adapter work. | inferred (strong) | omp.sh/docs/sdk, omp.sh/docs/rpc; package.json:8-9 engines; OMP absent from code | V1 per-engine conformance gated on the experiment |
| G11 | OMP built-in tool approvals (Q2) | **OPEN — unknown:** RPC documents host-owned tools + extension-UI confirm; no builtin permission gate found. Settle via OMP docs or the G10 experiment. | unknown | omp.sh/docs/rpc (~:130, :591-624, :631-684) | V1 half-blocked for OMP until settled; risk of unapproved bash/edit = silent R10 breach |
| G12 | Session entity / budgets / setup format / mobile scope (Q3/Q6/Q7/Q8) | **OPEN for plan:** no engine field, dispatch, or workspace-lease ownership exists (schema decision needed; two runs must never own one workspace); budget defaults + suspend contract = product defaults; setup format = evaluate devcontainer.json vs custom; mobile enumeration deferred to step-4 slice plan. | inferred / unknown | executor.ts:1102-1163, :4721-4739 (run continuity exists; engine concept absent); types.ts:74-75 (only per-command timeout); no setup/preview concept in packages/*/src | plan blocked on Q3/Q6 decisions; V5/V6 shapes depend on them |

## Slice guidance (Builder, adopted as route input)

Slice 1 = one repo, normal Pi, repo-to-PR, web only: configure repo → session bound to
(workspace, engine=normal-pi) → acceptance artifact gated before first edit → implement →
diff + verification record → PR via existing workspace credential. OMP listed "unsupported in
this slice" (exercises no-silent-switch). Seeds: slice 2 = isolation (R4/V3, Q9) + versioned
checkpoint restore (R7/V5, G2). Route implication: **milestone**.

## Scout raw findings

Builder: underspecified-for-build list (R1 agree/evidence shape, R2 remember-scope, R4
integration primitive + port policy, R5 format + restart oracle, R6 preview auth + pty
transport, R7 settle/recheck/restore policy, R8 reconciliation + handoff contract, R9 budget
units + idle, R10 scoping model); shared mechanisms (session+adapter seam; revisioned workspace
store with dirty-set query; operation guard/settle classifier; single egress redaction filter +
one injection point; authenticated streaming transport); untestable-as-written list (resolved
into G9).

Examiner: 11 findings — HIGH G1 (takeover gap under-scoped), HIGH G2 (no archive to restore),
HIGH G3 (R4 vs computer-runtime.md:34), MED G4 (R2/R8 continuation hole), MED G5 (checkpoint
leak + literal-only redaction), MED G6 (CLI absent), MED G7 (pty seam), LOW G8 ×2 (nine→eight,
OMP unexpanded), LOW G10-adjacent (unmeasurable phrasings → G9), LOW (uncited Problem claims →
G8). All resolved or opened above.

Investigator: 8 pre-plan questions — Q1 transport (inferred), Q2 builtin approvals (unknown),
Q3 session entity (inferred), Q4 settle semantics (gap proven, policy unknown), Q5 checkpoint
contents (gap proven, contents unknown), Q6 budgets/suspend (inferred gap), Q7 secrets boundary
(proven conflict → G5/Q10), Q8 setup format (unknown) + mobile scope (inferred → Q8). absorbed
into the table and spec open-questions Q1–Q10.

## Addendum — T24 OMP RPC experiment (2026-10-02, settles Q1/G10 + Q2/G11)

Live probe of the installed `omp` 18.4.2 in `--mode rpc` under a scrubbed env in an isolated
temp workspace; full frame logs + driver at `.super-speckit/qa/004-s4/experiment/omp-rpc/`.

**G10/Q1 transport — CONFIRMED (was: inferred strong).** First stdout frame is
`ready` {protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: 1048576,
maxReassembledFrameBytes present}. One JSON object per line on stdin; responses correlate by
`id`; a model turn acks with `response{command:"prompt",success:true}` and completes at
`agent_end` with `isTerminal != false`. `get_state`, `get_available_models`,
`get_messages_page` (snapshot paging), and `get_session_stats` behaved exactly as documented.
stdout is protocol-only; stderr stayed empty in all runs. Continuity vocabulary for T22 exists
(`switch_session`, `handoff`, paged history). Node-side subprocess embedding is viable as
inferred; the SDK/Bun constraint is bypassed exactly as planned.

**Q2/G11 builtin approvals — SETTLED (was: unknown). Refines the docs reading:**
- Non-yolo modes DO surface builtin tool approvals in RPC — as `extension_ui_request`
  `{method: "select", title: "Allow tool: bash\nCommand: <cmd>", options: ["Approve","Deny"]}`,
  answered with `extension_ui_response {id, value: "Approve" | "Deny"}`. The host implements
  the approval UI. Ignoring the request deadlocks the turn (verified: first write-mode run hung
  until timeout with the select pending).
- Approve → tool executes (`tool_execution_end`, isError false, captured stdout).
  Deny → `tool_execution_end` isError true, "Tool call denied by user: bash"; the run
  continues. Yolo (this deployment's default) → zero approval frames; exec-tier tools run
  immediately; only fire-and-forget `setWidget` frames appeared.
- **Integrity finding for V2(omp):** in the denied run the assistant's final TEXT still claimed
  the command output ("omp-rpc-probe-ok") even though the tool call had failed. Verification
  records and egress sweeps must source `tool_execution_end` results / `get_messages_page`
  toolResults — never assistant prose.
- Provider safety checks were not exercised (none triggered on trivial calls); per docs they
  fail closed headless. Fire-and-forget UI requests (setWidget/notify) need no reply; unknown
  request methods should be cancelled, not ignored.

**Adapter consequences (T25 brief):** spawn per session with `--mode rpc --no-session` (or
named session under the task data tree); declare `HOME` explicitly in the sandbox task config
(omp reads its config/auth from `$HOME/.omp`; probe ran on scrubbed env with only
PATH/HOME/TERM/LANG); unattended runs use yolo + `tools.approval` deny-map
(computer/browser/eval deny) per the documented unattended guidance; interactive coding
sessions use a non-yolo overlay and route Allow-tool selects to the product approval gate
(the T22 pending-approvals UI). Host-side egress filter (V8) must cover tool results and paged
history; the omp-internal session store is outside host control.
