# Design brief — 004-code-mode (design stage: Q9 isolation + Q10 secrets)

- Date: 2026-10-01 · Stage: design (post-grill, pre-plan) · Owner: Tech Lead · Rev: r2
  (Q9 FINAL — option 3 process-level supersedes the same-day docker answer)
- Decisions recorded here unblock `specs/004-code-mode/plan.md` (human approval gate comes
  after plan + tasks, before any implementation).
- Decision provenance: both decisions were made by the **user (Poom5741)** and relayed by
  Chief; recorded in `decision.json` (same directory). Mechanism details below are owned by
  Tech Lead within the user-set constraints, per Chief's delegation.

## D-Q9 — Isolation execution environment (FINAL r2)

**Decision (user card tap 2026-10-01T02:49:19Z, relayed by Chief — user also said "decide
for me"; marked FINAL, superseding the earlier same-day docker-on-box answer): Option 3 —
process-level isolation with a trusted-code threat model.** No separate machine, no docker
requirement in v1.

### Threat model (verbatim from the relayed decision)

Trusted-user-code: process isolation guards against accidents and resource conflicts, NOT
malice. Nothing in this feature may claim container-grade containment. This characterization
rides the human approval gate — disclosed, not buried.

### Runtime architecture (v1: process-level driver)

- **New `process` sandbox provider behind the existing sandbox-provider seam** — the repo
  already ships eight real providers (incl. `docker-sandbox.ts`) plus a fake double; the seam
  is the point. Docker stays a documented future driver, not the v1 default.
- **One task context per coding task (R4)**: dedicated workspace tree per task run (pairs with
  the G2 versioned store replacing `.previous` deletion), dedicated data/cache dirs,
  spawn-time resource limits (cpu time, address space, nproc, file size; nice), and an env
  scrub at spawn: only declared task-config vars plus Q10-granted secrets pass through.
- **Collision policy (V3 fixture matrix)**: dynamic port binding with retry (no fixed ranges),
  id-prefixed workspace/data dir names, per-task process-group naming, namespaced service/db
  names; there is no shared global namespace left to collide on.
- **Doctor preflight (`code-mode doctor`)**: verifies (a) spawn limits enforceable,
  (b) per-task tree creation + isolation, (c) env scrub active. Fail-fast verdict +
  remediation. No docker dependency in v1; team-box evidence runs directly.
- **Lifecycle**: task context created at session start from the setup definition (R5/Q7);
  idle-suspend stops the task and retains its workspace (R9); resume recreates and reattaches
  via the versioned workspace store (G2/R7).

### Documented future upgrade paths (exact host-side preconditions — explicitly NOT chosen)

1. **Restricted docker socket (docker-socket-proxy).** Host-side precondition: run a
   docker-socket-proxy against the host docker socket and mount ONLY the proxy socket into
   this container (restricted API subset). Never mount the raw socket: raw
   `/var/run/docker.sock` equals host root — advised against for a code-execution product.
   Cost: one host config change. Risk: proxy misconfiguration widens the API surface;
   container escape lands on the shared host.
2. **Seccomp relaunch → rootless stack.** Host-side precondition: relaunch this container
   with a seccomp profile allowing `CLONE_NEWUSER` and NoNewPrivs off; then rootless
   docker/podman (rootlesskit + newuidmap; `/etc/subuid`+`/etc/subgid` already prepared)
   becomes installable from inside. Cost: container relaunch + stack install. Risk: NNP off
   weakens the box's own posture; still shares the host kernel (not hostile-code containment).

### Verified box constraints (live runs 2026-10-01 — why in-box docker was infeasible)

- Zero container tooling inside the team container: no docker/podman/runc/crun/bwrap/
  slirp4netns/fuse-overlayfs/rootlesskit/newuidmap. No sudo; apt blocked; no systemd;
  no /dev/fuse; no docker socket mounted.
- Seccomp (Seccomp=2, NoNewPrivs=1) blocks `CLONE_NEWUSER`: `unshare --user
  --map-root-user id` → EPERM despite friendly sysctls (unprivileged_userns_clone=1,
  max_user_namespaces=56880). Kills rootless docker/podman/bwrap/rootlesskit AND the
  setuid-newuidmap path from inside; `/etc/subuid`+`/etc/subgid` unusable under NoNewPrivs.

## D-Q10 — Secrets: scoped, audited injection (Option B — R10 wins)

**Decision (user, 2026-10-01 ~02:43Z):** the code-mode workspace MAY receive secrets via a
scoped, audited injection mechanism. `docs/bot-secrets.md`'s blanket refusal is superseded
**for this feature only**, as a documented carve-out — recorded explicitly; the doc is NOT
silently rewritten (annotation is a plan task, S3).

### Mechanism (Tech Lead-owned details, within the five user constraints)

1. **Least-privilege scoping.** Secrets are configured per project in Rakazo settings (R10),
   stored server-side encrypted at rest (reuse the existing credential-storage primitives the
   bot-secrets facility uses; exact schema decided in S3 tasks). A task declares the secret
   **names** it needs in its recorded task config — same gate family as R1's acceptance
   artifact, resolved before the first edit. Injection resolves **only** granted names; no
   wildcard grants in v1. Grants are scoped per (workspace, task run) with a TTL.
2. **Injection boundary = task-context bootstrap** (constraint 5, pairing with Q9-final).
   Values enter the task context only at process spawn, as env vars (or a file inside the
   task's own data dir). Values are never written to the host tree, the repo tree, or
   workspace storage by the injection mechanism itself.
3. **No secrets in logs/artifacts/git/QA evidence** (constraint 3). One egress redaction
   filter, deny-list keyed on the granted secret values of the running task (exact-match, not
   patterns), applied at every artifact surface: transcripts, command results, checkpoints,
   handoff summaries, and QA evidence. The filter must survive encoded forms — literal plus
   base64/hex/URL-encoded sweep (V8; grill G5 found today's redaction at `executor.ts:2601`
   is literal-only and covers none of the checkpoint surfaces).
4. **Audit trail, tamper-evident** (constraint 2). Append-only JSONL: one event per
   grant/inject/revoke/expire — {seq, ts, actor userId, botId, workspaceId, taskRunId,
   secretName, secretRef (never the value), mechanism env|file, ttl, grantRef}. Tamper
   evidence via hash chain: each entry carries sha256(prev_hash + canonical(entry)); the
   chain head is checkpointed into the task run record. `audit verify` recomputes the chain;
   wired into QA evidence collection.
5. **Expiration/revocation** (constraint 4). Grants carry a TTL (default: task-run lifetime
   + grace; hard cap configured). `revoke` deletes the grant and writes the audit event;
   enforcement is honest about process reality: a running task keeps its env until it
   stops, so revocation takes effect at the next task start, with a `--force` option that
   stops the task immediately. Rotating a secret in settings marks dependent grants
   stale; the next start re-resolves.
6. **Fail-closed rule (Q9-final interaction).** The process-level driver is the v1 runtime
   (not a fallback), so secrets are ENABLED under it: injection happens at spawn-env only
   (item 2). If spawn-env injection cannot be guaranteed on some future runtime, the secrets
   features fail CLOSED — disabled with an explicit disclosure, never silently degraded.
   State disclosure (Chief tightening, 2026-10-01): runtime surfaces — `code-mode doctor`
   and task start — explicitly print the CURRENT secrets state (ON or OFF) and WHY (driver
   kind + injection guarantee), in BOTH directions. No silent degradation either way: an
   unannounced OFF is as much a provenance problem as an unannounced ON.
   Confidentiality honesty: a task runs as the same OS user, so `/proc/<pid>/environ` is
   readable by same-UID processes — secret confidentiality is bounded by the trusted-code
   threat model (D-Q9). Scoping, the egress filter, the audit chain, and TTL/revoke limit
   blast radius and provide accountability; they do NOT provide containment against
   malicious code. Disclosed at the approval gate.

## Alternatives considered

- **Separate computer per task** — cleanest containment, rejected by the user on cost (Q9).
- **Rootless containers inside the team box** — infeasible from inside on evidence: seccomp
  blocks `CLONE_NEWUSER`; nothing installable without host action (see D-Q9). Retained as
  documented future upgrade path 2, not chosen for v1.
- **Docker driver via restricted socket** — documented future upgrade path 1 (host-side
  preconditions in D-Q9); superseded for v1 by the user's Q9-final pick.
- **proot / chroot-style emulation** — not a security boundary; rejected.
- **Pattern-based redaction only** (no deny-list of granted values) — rejected: misses
  encoded forms and new secret shapes; deny-list keyed on granted values is exact.
- **Persisting secrets in the workspace for convenience** — rejected outright; violates the
  user constraint (injection at bootstrap only, never persisted in the tree).

## What this design stage does NOT decide

Q1–Q8 remain open and are assigned in the plan (OMP transport experiment Q1/G10, OMP builtin
approvals Q2/G11, session entity shape Q3, settle policy Q4, checkpoint contents Q5, budget
defaults Q6, setup format Q7, mobile enumeration Q8). The web slice's **UI** design-first
(config `design.required_when_paths: **/*.tsx`) still requires its own prototype.html +
decision record before UI implementation; this brief covers architecture only.
