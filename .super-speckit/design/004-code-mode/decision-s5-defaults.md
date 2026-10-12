# S5 Gate Decisions: Environments, Budgets, Mobile v1 (Q6/Q7/Q8)

**Decided by:** Poom5741 (in-session, 2026-10-03, "all your recommended")
**Relayed by:** orchestrator — the orchestrator is the relay, not the approver

---

## Q7 — Setup / Environment Definition Format

**Decision:** `devcontainer.json` non-container subset.

Accepted keys (stored as-is in the repo, mapped onto the Q9 process runtime):
- `postCreateCommand` — command to run after environment is created
- `forwardPorts` — port mappings to expose
- `features-lite` — subset: `{ name, url, dest }` only; full `features` object parsed but only these three fields used
- `customizations` —tool-specific customizations block

**Container-only keys** (NOT used by Rakazo Code; disclosed at parse time):
`image`, `dockerFile`, `containerEnv`, `remoteEnv`, `runArgs`, `mounts`, `workspaceFolder`, `settings` (full), `extensions` (full), `portsAttributes`, `shutdownAction`, `onOpenCommand`, `initializeCommand`, `waitFor`, `host.systemDeps`, `vson`

**Parser seam:** `packages/coding-definitions/src/environment/parsers/devcontainer.ts` — the parser is behind an interface (`IEnvironmentParser`) so a custom format can slot in later by swapping the implementation. Container-only keys that appear are included in a `disclosedContainerKeys: string[]` field on the parsed result; callers can surface this as a warning.

**Reversal:** swap the parser behind the `IEnvironmentParser` seam (no changes to calling code).

---

## Q6 — Budgets / Idle Defaults

All per-session configurable; these are the factory defaults.

| Parameter | Default | Notes |
|---|---|---|
| `idleThreshold` | 30 minutes | No active run AND no user interaction → suspend |
| `budget` | 120 per-task active-run minutes | Engine-neutral wall-clock; NOT tokens (token accounting differs per engine) |
| `deadline` | 24 h from task start | Absolute wall-clock deadline |
| `suspendContract` | stop task + processes, retain workspace | On idle-triggered suspend: stop the task and all its processes; retain the workspace on disk; report which dev services went down; on resume, produce a truthful `needs-restart` report naming the dead services and citing the definition. Same observable as R5's replace report. |

**Per-session overrides:** all three parameters are writable per-session via session options. Idle detection reuses existing `packages/adapters/src/computer-idle.ts` patterns.

**Enforcement:** `budget` is enforced as a blocker — when `activeRunMinutes >= budget` and the run is unattended, block further work and surface the budget-exhausted state. The "smallest continuing action" is to request budget increase from the user. `deadline` is checked at run start and resume; expired deadline refuses to resume, surfaces the deadline-exceeded state.

---

## Q8 — Mobile Workflow v1 Enumeration

**Decision:** Fixed list below. Recorded degradation = not bugs.

### Included in Mobile v1
1. **Conversation** — view coding thread, send a prompt
2. **Steering** — inject a steer/prompt into an active run
3. **Approvals** — approve or deny a pending request
4. **Run status** — current status including crash-reconciled outcome + budget/idle state
5. **Push notifications** — approval-needed / finished / blocker events

### NOT in Mobile v1 (recorded degradation, not bugs)
- Diff review UI
- Preview viewing
- Terminal access
- Session creation
- Engine picker

These surfaces return an explicit degradation note: "This action is not available on mobile v1."

---

*Recorded 2026-10-03 by orchestrator relay for Poom5741 approval — see .super-speckit/design/004-code-mode/decision-s5-defaults.md*
