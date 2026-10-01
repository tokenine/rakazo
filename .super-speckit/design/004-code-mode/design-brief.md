# Design brief — 004-code-mode (design stage: Q9 isolation + Q10 secrets)

- Date: 2026-10-01 · Stage: design (post-grill, pre-plan) · Owner: Tech Lead
- Decisions recorded here unblock `specs/004-code-mode/plan.md` (human approval gate comes
  after plan + tasks, before any implementation).
- Decision provenance: both decisions were made by the **user (Poom5741)** and relayed by
  Chief; recorded in `decision.json` (same directory). Mechanism details below are owned by
  Tech Lead within the user-set constraints, per Chief's delegation.

## D-Q9 — Isolation execution environment

**Decision (user, 2026-10-01 ~03:00Z): docker on the existing team box.** No separate
machine; the cost/quota objection is moot. "Cheap, fast, lighter isolation."

### Verified box constraints (live runs, 2026-10-01)

- Zero container tooling inside the team container: no docker/podman/runc/crun/bwrap/
  slirp4netns/fuse-overlayfs/rootlesskit/newuidmap. No sudo; apt blocked; no systemd;
  no /dev/fuse.
- The container's seccomp profile (Seccomp=2, NoNewPrivs=1) blocks `CLONE_NEWUSER`:
  `unshare --user --map-root-user id` → EPERM despite friendly sysctls
  (unprivileged_userns_clone=1, max_user_namespaces=56880). This kills rootless
  docker/podman/bwrap/rootlesskit AND the setuid-newuidmap path from inside.
  `/etc/subuid`+`/etc/subgid` exist but are unusable under NoNewPrivs.
- No docker socket mounted (`/var/run/docker.sock` absent).

**Consequence: the decided mechanism requires exactly ONE host-side user action first.**
Ranked (relay sent to Chief 2026-10-01):

1. Mount a **restricted** docker socket into the team container (docker-socket-proxy, or the
   host's rootless-docker socket). Recommended. A raw socket mount equals host root — advised
   against for a product that executes agent code.
2. Relaunch the container with seccomp allowing `CLONE_NEWUSER` and NoNewPrivs off → the
   rootless stack becomes installable from inside.
3. Neither → in-product process-level isolation is the only fallback; it is **not a security
   boundary** (see threat model) and it **disables the Q10 secrets mechanism** (see D-Q10).

### Runtime architecture

- **Reuse the existing sandbox-provider seam.** The repo already ships a docker sandbox
  provider among eight real providers (`docker-sandbox.ts`, cited at :118 in the grill) plus a
  fake-sandbox test double. New work is the *task-scoped lifecycle and policy around it*, not a
  new container stack.
- **One container per coding task** (R4): separate filesystem, PID/network namespace, and port
  space per task. Collision policy for V3's fixture matrix: container names, volume names, and
  compose project names prefixed with the task/run id; service ports bound to dynamically
  allocated host ports (no fixed ranges); in-container dev service/db names namespaced per task.
- **Doctor preflight (`code-mode doctor`)**: verifies (a) docker endpoint reachable,
  (b) a scratch container can run with the needed mounts, (c) required image pull works.
  Fail-fast output states the verdict and the exact remediation (ranked host actions above).
  All docker-gated development and QA run only after doctor passes; CI/local docker is
  acceptable for development, the team box must pass before release evidence.
- **Lifecycle**: container created at session start from the setup definition (R5/Q7);
  idle-suspend stops the container and retains its volume (R9); resume recreates and reattaches
  (checkpoint/restore via the versioned workspace store, G2/R7).

### Threat model (explicit, per Q9 "lighter isolation")

Docker here provides **workload isolation between concurrent tasks on a trusted host**:
filesystem/process/port separation, accident containment, resource bounding. It is **not
hostile-code containment**: containers share the host kernel; without a user-namespace
remap (unavailable under this box's seccomp) in-container root has real host-kernel
privileges, and a container escape lands on the shared box. If containment against hostile
code is later required, that is the separate-computer option or a hardened runtime — out of
scope for this recorded decision. This characterization is disclosed to the user, not buried.

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
2. **Injection boundary = container bootstrap** (constraint 5, combining with Q9). Values
   enter the task container only at container create, as env vars or a mounted file. Values
   are never written to the host tree, the repo tree, or workspace volumes by the injection
   mechanism itself.
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
   enforcement is honest about container reality: a running container keeps its env until it
   stops, so revocation takes effect at the next container start, with a `--force` option
   that stops the container immediately. Rotating a secret in settings marks dependent grants
   stale; the next start re-resolves.
6. **Fallback interaction (Q9 option 3).** Under the process-level fallback driver there is
   no container bootstrap boundary to inject at — so **secrets features are disabled**, with
   an explicit disclosure, never silently degraded. This keeps the Q10 boundary promise under
   every runtime the design admits.

## Alternatives considered

- **Separate computer per task** — cleanest containment, rejected by the user on cost (Q9).
- **Rootless containers inside the team box** — dead on evidence: seccomp blocks
  `CLONE_NEWUSER`; nothing installable from inside (see D-Q9 constraints).
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
