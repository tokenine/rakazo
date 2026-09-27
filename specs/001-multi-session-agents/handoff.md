# Handoff — Super-SpecKit brownfield setup + Feature 001 (multi-session agents)

Written: 2026-09-28 · Purpose: resume this work on a different machine/server from a fresh clone.
Read top-to-bottom. Ops runbook for the live deployment lives separately in `docs/HANDOFF.md` — that one is about the server product; this one is about the development work in flight.

---

## 1. What exists (state of the work)

Two branches carry everything; both are **pushed to origin**:

| Branch | Has | Commits |
| --- | --- | --- |
| `speckit-setup` | Super-SpecKit kit install (`.super-speckit/`, `super-speckit.yml`, skill symlinks in `.agents/skills/`), project atlas (`project-atlas/`), constitution (`.specify/memory/constitution.md`), all three feature specs (`specs/00…3/`) | `71202998` (planning artifacts relocated into `specs/001-…/`), based on origin/main `d7a4e523` |
| `ss/feature/001-multi-session-agents` | Everything on `speckit-setup` **plus** the WIP schema/migration commit below | `a020b565`, same tree as `speckit-setup` + WIP |

Feature state (from the kit, not memory): `001-multi-session-agents` is **planned**. An
interrupted maker run left ONE unverified commit on the feature branch: `a020b565` contains
the slice-1 Prisma schema change (`Thread.botId` unique dropped, `name`/`isPrimary` added,
partial unique one-primary-per-bot) and its migration folder. It has **no TDD log, no
generated Prisma client, and no tests run** — treat it as a starting point: review it, run
`pnpm --filter @rakazo/db generate`, then continue with failing tests first. All other slice-1
work (repos, thread-target, RPCs, legacy pinning, tests) is NOT started.

Also decided (recorded in specs): feature 002 inspiration hub = no points system, preset catalog from us; feature 003 marketplace = hybrid catalog seam (bundled default + operator URLs + future hosted registry), MCP items both remote references and curated bundled locals, third-party registry pull is reference-only until curated. Feature 002 has one open research task (do `AgentSkill`/`TaughtSkill` serialize into a portable format?).

## 2. Clone and set up (fresh machine)

```bash
# 1. Clone (after the branches are pushed — see §3 prerequisite)
git clone git@github.com:tokenine/rakazo.git && cd rakazo
git checkout speckit-setup
git checkout -b ss/feature/001-multi-session-agents origin/ss/feature/001-multi-session-agents
#   (or recreate it: git branch ss/feature/001-multi-session-agents speckit-setup)

# 2. Toolchain: Node 22+, pnpm 9.15+ (corepack enable), Python 3 for the kit scripts
pnpm install

# 3. Git identity (no global config assumed): set repo-local name/email matching
#    the identity already used in this repo's commit history — check `git log --format='%an <%ae>'`.

# 4. Sanity: kit state must pass before ANY stage
python3 .super-speckit/scripts/super_speckit.py validate --repo .
python3 .super-speckit/scripts/super_speckit.py status --repo . --feature 001-multi-session-agents --strict
#    Expect: state pass, feature state "planned", worktrees count as configured.
```

The feature work can be done directly in the main checkout on the feature branch, or in a
worktree via `python3 .super-speckit/scripts/super_speckit.py worktree --repo . --path <dir> --branch ss/feature/001-multi-session-agents`. Either is fine; one maker lane at a time.

## 3. Prerequisite before leaving this machine

Done: both branches are pushed
(`git push -u origin speckit-setup ss/feature/001-multi-session-agents`). Clone fresh and check
out `ss/feature/001-multi-session-agents` to continue slice 1.

## 4. The job: continue feature 001, slice 1 (backend)

Everything needed is in the repo — read these in order before touching code:

1. `specs/001-multi-session-agents/spec.md` — requirements R1–R6, non-goals, assumptions.
2. `specs/001-multi-session-agents/change-story.md` — reviewed and approved; contains the full
   blast radius with file:line call sites, the decision table (primary-session invariant), and
   the runtime path. This is the source of truth for "what must not break".
3. `specs/001-multi-session-agents/plan.md` — slice breakdown; slice 1 is next.
4. `specs/001-multi-session-agents/verification-matrix.md` — V1–V8; the checker lane executes these.

Core technical facts (verified, in change-story §6): the busy guard is `(threadId, botId)`-scoped
(packages/db/src/events.ts), run leases are run-scoped, and the only genuine serialization is the
per-bot `ComputerExecutionLease`. The change is: relax `Thread.botId @unique`
(packages/db/prisma/schema.prisma:473), add `name`/`isPrimary` + partial unique "one primary per
bot", pin every legacy botId→thread lookup to the primary session, add threads RPCs
`listSessions`/`createSession`/`renameSession`/`deleteSession`, and make
`resolveThreadTarget` (apps/api/src/thread-target.ts) accept optional `threadId`.

### Mandatory TDD contract (maintainer requirement)

Strict red-green-refactor, with evidence:

- For every behavior in plan slice 1: write the failing test, run it, confirm it fails for the
  expected reason, then implement minimally, then green. Refactor after.
- Keep `specs/001-multi-session-agents/tdd-log.md`: `RED <test> — <reason>` / `GREEN <test>` per
  cycle; `NO-SEAM <file> — <reason>` for the few mechanical fixes (e.g. testkit screenshot CLI).
- Commit in small increments (at least: schema+repos cycle, then targeting/RPC/pinning cycle).
- Never claim a matrix row verified — the checker lane owns that.

### Slice 1 definition of done

- Migration folder `packages/db/prisma/migrations/20260928…_multi_session_threads/migration.sql`
  (additive, lossless: index, columns, partial unique, backfill) + `pnpm --filter @rakazo/db generate`.
- Repo functions (packages/db/src/repos.ts): list/create/rename/delete sessions; last-thread guard;
  primary promotion; bot DTO `threadId` stays = primary.
- `resolveThreadTarget` explicit threadId (actor-scoped, else error) → primary → earliest.
- Legacy pinning: messaging-inbound, packages/db/src/messaging.ts, executor routines,
  messaging-delivery peer DM (order by isPrimary desc, createdAt asc); clearThread scoped by
  threadId (keep groupId variant); testkit mobile-screenshots findUniqueByBotId fixed.
- Targeted vitest for all touched files + pre-existing events/repos/messaging suites green;
  `pnpm check` green; `pnpm lint` green. Never pipe commands through grep/tail so exit codes hide.
- Committed candidate SHA recorded via
  `python3 .super-speckit/scripts/super_speckit.py transition --repo . …` (or the feature JSON) → state `implemented`.

### After slice 1 (later slices, same branch)

- S2 web UI session switcher — **design-first gate**: static prototype decision recorded under
  `.super-speckit/design/` before any tsx changes (config `design.required_when_paths` covers tsx).
- S3 mobile session list (native-first rules).
- S4 checker lane: new QA worktree from the candidate SHA, run verification-matrix V1–V8, plus
  `pnpm --filter @rakazo/desktop test:e2e` is CI-only (opens real windows — never run it as
  routine local verification). OCR/static review lane, then `super-speckit.release`.
- Slices 2–4 then repeat the same state checks before/after each stage.

## 5. Gotchas that already cost time here

- `pnpm check` (typecheck), `pnpm lint` (biome), `pnpm test` (vitest ~4.5k tests) — run them
  directly; `| grep`/`| tail` masks failures.
- After ANY Prisma schema change: `pnpm --filter @rakazo/db generate`; migrations are plain SQL
  folders applied by the api container on boot.
- Biome: `npx biome check --write <files>` after hand-edits.
- The kit's `status`/`validate` must be run from the main checkout root (the script path is
  `.super-speckit/scripts/super_speckit.py`; worktrees don't contain `.super-speckit/`).
- Constitution locked decisions live in `project-atlas/decisions/index.md` — ADR-0001…0007 must
  not be re-litigated in feature work.
- Public repo: no secrets/personal data in commits or artifacts; describe test results in words,
  never paste tool output containing host identities.

## 6. Resume checklist

1. §3 push done → §2 clone + install + kit validate pass.
2. Confirm feature state shows `planned` and no candidate SHA.
3. Start slice 1 with the TDD contract above.
4. On completion: record candidate SHA, proceed to S2 design-first.
5. If anything is genuinely blocked: record it in plan.md "Blockers" and write a new handoff
   before stopping — a pause is never silently dropped.
