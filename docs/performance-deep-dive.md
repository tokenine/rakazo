# Second-pass resource audit

Date: 2026-10-12. Companion to [the broader audit](performance-audit.md).

The stronger optimization opportunities are unnecessary computer allocation,
whole-workspace checkpoint amplification, unbounded output/queues, and work that
outlives its visible screen. These deserve investigation ahead of a framework
change or general-purpose transcript virtualization. Code paths below were
inspected, and two work-count probes were executed. Runtime CPU, latency, battery,
physical disk allocation, and production workload frequency remain unmeasured.

## Revised implementation order

| Order | Change | Why this order | Complexity |
| --- | --- | --- | --- |
| 1 | Bound process output and event/snapshot queues | Limits growth during high output or partial outages and improves resource predictability | Medium; recovery semantics matter |
| 2 | Stop visual polling/subscriptions when their owner is inactive; stabilize memo props | Removes identifiable repeated work with relatively small changes | Low–medium; calls/notifications need separate ownership |
| 3 | Fix checkpoint latest-manifest lookup and stream file hashing | Removes history-dependent metadata scans and whole-file allocations before redesigning storage | Medium; retain corruption/crash recovery |
| 4 | Provision computers only when an action requires them | Can eliminate a whole resource class from ordinary conversation | High; touches capabilities, attachments, leases, cancellation |
| 5 | Bound memory retrieval, discovery/session caches, and redundant navigation reads | Improves data- and identity-dependent growth across long-running instances | Medium; preserve tenant/auth/revocation boundaries |
| 6 | Make revision storage incremental and align transfer exclusions | Addresses whole-workspace copying and durable disk growth | High; migration and restore semantics |

This is a risk/effort ordering, not a claimed savings ranking. Collect baseline
profiles while making the first boundedness and lifecycle changes; use those
profiles to choose between later architectural work.

## 1. Plain conversation allocates a computer

`packages/adapters/src/executor.ts:1587–1592` requires a bot computer and calls
`provisionComputer` before invoking the model, then schedules computer sleep.
The introduction trigger only gets its empty tool list later, at line 1770.
Thus even a no-tool introduction takes the computer provisioning path. Existing
provider reconnects can be cheaper than a cold boot, so count these separately.
The default idle interval in `computer-idle.ts` is ten minutes; Docker's
`infra/sandboxes/computer/start.sh` starts the graphical desktop services.

Provision on first computer-dependent use through a single shared promise per
execution context. Resolve capability metadata from configuration without booting;
attachments may still require early materialization. Preserve current computer
lifecycle claims, screen isolation, takeover fences, restoration, and secret
boundaries. The `none` provider fails provisioning today; deferred allocation
could make no-computer conversation useful, but that requires explicit contract
and capability behavior, not merely skipping the call.

Test zero provider provisions for no-tool/connector-only replies, exactly one for
concurrent first-use actions, cancellation during boot, shared-computer conflicts,
and reconnect after suspension. Measure computer-seconds per successful task,
first-answer latency and boot counts as well as Node memory.

## 2. Checkpoints copy far more than changed data

The local optimization comment at `computer-workspace.ts:102` says it only bumps
the revision stamp. Actual `home.ts:150` calls `archiveRevision`:

- `scanTree` reads and hashes every included file; `fileMeta` reads whole files.
- `latestManifest` at line 386 reads/parses every previous full manifest to select
  the newest. With a roughly fixed file count, each checkpoint's metadata work
  grows with revision count; cumulative repeated scans grow quadratically.
- If any file changes, line 356 copies the entire included tree into a new archive.
  Identical consecutive revisions are deduplicated, which protects unchanged
  checkpoints from new copies but does not avoid the scan itself.

First use the existing latest-revision stamp to read one manifest, with a recovery
scan for absent/stale/corrupt stamps. Then stream hashing/copying. Evaluate immutable
content-addressed files or safe copy-on-write snapshots later. Plain hardlinks from
mutable live files would let edits corrupt historical revisions.

Remote transfer has another amplification: E2B/Daytona export walkers apply browser
profile filtering, whereas revision filtering excludes `node_modules`. Dependency
files can therefore be transferred and staged before being excluded from the
archive. Direct local revisions apply the home exclusion policy and can include
browser caches. Define working-home versus revision contents clearly before
unifying policies, and apply appropriate exclusions before directory descent.

## 3. Buffering must be bounded where bytes enter

`pi-runtime.ts:1836` uses an unbounded array event queue with synchronous `push`
and `Array.shift` consumption. Provider callbacks produce events independently
of the executor's awaited database writes. The existing 250 ms flush cadence
reduces write frequency but does not bound upstream backlog during a slow DB.
Track queued bytes/events/high-water marks; coalesce adjacent text only when
ordering permits, and preserve tool/terminal events. A faster deque alone would
leave the memory-growth problem intact.

Main-text throttling also does not cover all agent progress. Subagent updates at
`pi-runtime.ts:1185–1195` can emit one 800-character snapshot every 80 ms per helper.
Four continuously emitting helpers imply approximately 50 progress snapshots/sec
as a ceiling estimate, not observed throughput; the executor appends these
individually. Coalescing superseded progress per helper is a more focused experiment
than merely increasing the main-text interval. Never coalesce transitions or final
results across ordering-sensitive events.

`process-sandbox.ts:731–735` and `desktop-sandbox.ts:732–736` append stdout/stderr
into strings before returning them. The executor collects output again and only
later clips tool-visible text. A presentation cap therefore does not bound capture.
Use byte-limited capture at the producer, continuing to drain the pipe after the
retained limit is reached; truncation should be explicit. Test huge output, Unicode
chunk boundaries, both streams, timeout and cancellation. Keep finite-duration
timeouts: byte bounds and duration bounds protect different dimensions.

`packages/core/src/thread-subscription.ts:39,81–87` retains every event while the
lightweight head succeeds but the initial full snapshot is missing and refreshes
keep failing. A successful snapshot drains/deduplicates by cursor; the partial
outage path has no bound. Bound retention and recover using a committed snapshot
plus durable replay. Dropping events while retaining an advanced received cursor
would lose state. Mobile's SSE parser in `apps/mobile/lib/api.ts:907–909` also
accumulates until a frame delimiter without a frame-byte cap.

These are source-confirmed growth paths, not evidence that typical workloads
currently exhaust memory. [Node's backpressure guidance](https://nodejs.org/learn/modules/backpressuring-in-streams)
supports controlling producer/consumer imbalance; application queues need their
own byte limits and recovery policy.

## 4. Screen lifetime is not operation lifetime

Mobile computer refresh starts on mount (`app/computer.tsx:77–88`) and schedules
status reads every two seconds (`lib/computer-refresh.ts:63–66`). Its running
computer heartbeat also follows mount/state, not foreground/focus. Mobile thread
fallback refresh is visibility-aware, but the stream effect at `thread.tsx:939`
remains active while a screen is mounted. Hidden navigation-stack screens can
therefore continue network parsing and event projection. Background OS suspension
may reduce actual execution; it is not an explicit lifecycle guarantee.

Use screen focus plus AppState for visual subscriptions, refresh controllers and
attended computer heartbeats. Calls, durable tasks and notification transport need
their own owners; hiding a screen must not stop those operations. Resume from a
durable cursor and refresh state on return. Test a stack containing multiple threads
and a computer, navigation away, app backgrounding and reconnect.

Desktop `client-browser/pane.ts:16,66–71` retains a global `WebContentsView`;
`hidePane` detaches it without closing its web contents. Hiding may intentionally
preserve the page for the agent. Specify that lifetime explicitly, with idle
release/host-close cleanup that accounts for active automation. Do not assume the
main window's 15-minute TTL frees this separately retained guest. Electron's
[resource ownership documentation](https://www.electronjs.org/docs/latest/api/base-window#resource-management)
requires explicit handling of child web contents; verify the actual BrowserWindow
host behavior on the installed version. Measure renderer count after hide/reopen,
server change, host destruction and automation release.

## 5. Memo wrappers do not establish useful memo boundaries

The initial audit understated this issue. `Shell.tsx:3736–3748` passes fresh inline
callbacks to the memoized Transcript; at line 5245 it passes each MessageView a new
`onSpeak` function. Default memo compares props by identity, so those changes defeat
the bailout even for unchanged messages. Mobile rows similarly receive a newly
allocated `actionProps` object at `thread.tsx:1515`. `FlatList` still bounds mounted
rows, so the mobile cost is narrower than rendering the full transcript.

Stabilize shared callbacks and pass the message as data rather than binding a new
function at every row. Make derived maps/projections depend on their actual inputs.
Profile commits after that before adding virtualization. Web composer draft is
local to Composer; do not claim every web keystroke rerenders Shell. React's
[memo documentation](https://react.dev/reference/react/memo) explains why always-new
function/object props break default memoization.

The code workspace also resolves session ownership by listing every bot and then
awaiting `codingSessions.list` sequentially (`CodeWorkspace.tsx:64–70`). An authorized
session lookup could return its owning bot directly. Its terminal URL callback is
allocated inline and participates in the child's connection effect, creating a
reconnect risk on parent renders. Verify request/reconnect counts before changing it.

Voice also has a capture-side budget gap. `apps/web/src/lib/dictation.ts:347–357`
holds recorder chunks until silence/user stop, then converts Blob to ArrayBuffer,
binary string, base64 and JSON. The server's eight-MiB limit is applied afterward.
Enforce capture byte/duration limits before upload, then evaluate binary transport.
Use fake recorder continuous-speech/hold fixtures; retain existing VAD/audio cleanup
and accessibility for long dictation. Record rejected work as well as memory.

## 6. Shared backend work multiplies by clients and identities

Visible web polling is roughly 20 navigation requests/minute/client when refreshes
finish within the three-second interval. Each calls `spaceNavigationDto`
(`apps/api/src/router.ts:6768`), assembling current and inactive spaces, bots,
groups, sections, conversations and content indicators. It is broader than a
bot-status read. Repository calls are not one-to-one SQL counts; measure actual SQL
and bytes before reporting database load. Separate slowly changing structure from
live status, or issue scoped invalidations with durable reconnect catch-up.

Every `followThreadEvents` generator owns its cursor and queries the event table
(`packages/db/src/events.ts:1360–1387`). Multiple readers of one busy thread can
repeat identical reads. Also every event increments one thread row transactionally
(`events.ts:1263–1286`), serializing same-thread writers. Notifications use one
global channel (`realtime.ts:4`), then filter locally. PostgreSQL delivers channel
notifications to all its listening sessions, so adding API replicas can amplify
notifications even for unrelated threads. [PostgreSQL 16 NOTIFY](https://www.postgresql.org/docs/16/sql-notify.html)
documents the transport behavior.

Measure 1/4/16 readers and 1/4/16 writers on one thread versus different threads:
DB reads, lock waits, transaction retries, bytes, delivery latency, pool wait. If
this dominates, evaluate per-process shared reads with bounded replay and independent
subscriber cursors; keep authorization per subscriber. Avoid an unbounded global
event cache or introducing another service before showing the need.

MCP sessions (`mcp-connector.ts:73,303`) lack idle/capacity eviction and can retain
stdio processes until connector shutdown. Discovery repeats `listTools`; installed
MCP discovery opens fresh connections. Coalesce metadata reads and bound caches by
identity plus credential/configuration revision, retaining live authorization for
execution. In-memory job dispatch also needs a concurrency audit if used outside
tests: its due timers do not inherit Graphile's configured worker cap.

Per-container CPU/memory ceilings do not cap aggregate active computers/screens.
Add admission/backpressure only after measuring host headroom, with reservations
released on cancellation. A per-run subagent limit similarly differs from an
instance-wide provider/concurrency budget.

Worker shutdown needs explicit lifecycle ownership too. The Telegram interval at
`apps/worker/src/index.ts:157` is not retained/cleared and has no single-flight guard.
Worker executor composition omits the API's shutdown signal; shutdown drains the
job host without first aborting active executor work. Reuse the API pattern
(`apps/api/src/app.ts:423,466,960`) and general reconciler's timer ownership. A
child-process fixture should send SIGTERM during idle, slow reconciliation,
computer boot and a quiet model stream, then verify no new ticks and a recoverable
interruption. Test actual exit, not merely the resolution of `stop()`.

## Reproduced work counts

Run `pnpm exec tsx docs/research/resource-work-probe.mjs`. The script imports the
existing home/context code, uses fake memory and a temporary workspace, checks
outputs with assertions, and deletes its files. It makes no database/provider calls.

| Probe | Observed result |
| --- | --- |
| 100 documents per scope, 1 KiB each | 200 documents / 204,800 content bytes returned; 32,768-byte context output |
| 1,000 documents per scope, 1 KiB each | 2,000 documents / 2,048,000 content bytes returned; same 32,768-byte output |
| Eight 128 KiB files; initial revision plus six one-byte edits | Seven revisions / 7,340,032 logical archived content bytes for a 1,048,576-byte workspace |
| Consecutive unchanged revision | Same revision returned; no new archived revision |

These are deterministic counts from one invocation, not timing, RSS, SQL transfer,
or physical allocated-block measurements. File compression/reflinks can change
physical disk cost. The memory probe demonstrates the context consumer accepting
full snapshots before its cap; the source audit establishes that the local store
queries full scoped contents. It does not measure a real database's query plans.

## Acceptance criteria for the next development pass

Every long-lived resource should have an owner, capacity/byte budget, release
condition, and recovery behavior. Every proposed optimization should name the work
removed and its frequency. Compare resources per successful task plus user latency;
include idle cost and growth over repeated lifecycle transitions. Keep budgets
derived from representative workloads rather than imposing arbitrary constants.

Create offline fixtures for slow DB/event consumers, snapshot failure with live SSE,
large command output, thousands of revisions, hidden screen stacks, repeated MCP
identity changes, and simultaneous first computer use. Add runtime profiles for
those fixtures separately from timing runs. Preserve auth/secret/sandbox boundaries,
append-only recovery, calls, accessibility and scroll anchoring. No application
behavior was modified in this research pass.

## Third-pass candidates

Date: 2026-10-12. Ideas not yet covered by either audit, offered with the same
evidence/change/proof discipline. None are implemented. Items 2–4 are pure
subtraction or enforcement and can sequence early; item 1 intentionally adds
resource motion to buy latency and belongs after provision-on-demand proves
boot frequency and cost.

### 1. Intent-driven resource motion

| Evidence | Proposed change | Proof required |
| --- | --- | --- |
| The UI knows intent before the backend acts: opening the Code toggle, focusing the computer panel, attaching a file to a coding session. Computer boots remain on the action's critical path. | A `warmComputer(botId)` no-op-if-provisioned contract the web surface calls on intent signals, hiding boot latency behind user think-time. Cheaper than any warm pool; same lease/idle rules. | First-answer latency for computer actions with/without the signal; boot counts; zero provisions for sessions that never act. |
| Idle interval is a constant (`computer-idle.ts`, default 10 min) regardless of per-bot usage pattern. | Adaptive per-bot idle threshold from an exponentially weighted wake/sleep history (one column): suspend nocturnal bots fast, keep daily drivers alive. | Computer-hours per useful interaction; resume-latency p95 for wrongly-suspended bots. |

### 2. Event write path

| Evidence | Proposed change | Proof required |
| --- | --- | --- |
| Every event transactionally increments its thread row (`events.ts:1263–1286`), serializing same-thread writers; a busy thread with concurrent runs queues on one row lock at ~4 durable writes/sec/run plus tool events. | Batch the sequence increment with the existing 250 ms flush (one increment per flush, not per event); ordering stays centralized. | Lock-wait time and transaction retries at 1/4/16 writers on one thread vs different threads; cursor/replay ordering preserved. |
| Durable progress events (~4/sec per emitting run) are retained forever; no event retention policy exists in either audit. | Classify event durability at write time: replay-critical (transitions, tool results, receipts) vs cosmetic progress superseded by later snapshots; TTL-bound or table-separate the cosmetics with the replay contract defining pruning behavior explicitly. | Reconnect replay over pruned ranges, receipt/tool accuracy, table growth per run-hour; no silent history loss. |

### 3. Wire-level cost

| Evidence | Proposed change | Proof required |
| --- | --- | --- |
| SSE frames are uncompressed JSON text repeated per connected client; transcript streaming content is highly compressible. | Enable HTTP compression for `text/event-stream` (or HTTP/2 multiplexing where the proxy allows). Zero application logic. | Bytes for a 10-minute session with one active run, gzip on/off; mobile SSE parser (`apps/mobile/lib/api.ts:907`) tolerates compressed chunking; reconnect under compression. |
| Reconnect cost under flaky networks scales with whatever the client refetches before resuming the cursor. | Verify what thread reconnect actually refetches; if it is a full snapshot, make it cursor-anchored delta (O(missed events) not O(history)). Drop the idea if already delta-based. | Bytes per reconnect with K missed events; correctness after gap-filling; flaky-network fixture. |

### 4. Self-enforcing budgets

| Evidence | Proposed change | Proof required |
| --- | --- | --- |
| Both audits keep finding leak classes one at a time (hidden `WebContentsView`, MCP stdio processes, unfollowed cursors); nothing checks the "every resource has an owner and release condition" criterion. | A shared dev-mode resource ledger module (package-level) that owners register with on acquire/release; scripted-runtime tests assert the ledger drains after simulated session teardown. Catches the leak class, not instances. | Ledger-empty assertions across PTY spawner, sandbox provider, event followers, MCP sessions, computer leases; no behavior change in production mode. |
| Regression budgets exist as prose; nothing in CI counts work. | Scripted-runtime scenarios (N sessions, M events, simulated T minutes) recording counters (events written, bytes captured, queries issued, ledger entries) into the existing perf reports with CI-asserted upper bounds — deterministic counts, not wall-clock. | Budget gates fail on a deliberately wasteful change and pass on current HEAD across repeated runs. |

### Confirmed defects (no profiling needed)

Carried from the 2026-10-12 session; behavior-preserving strict-TDD fixes are
specified and paused pending maintainer go:

1. `packages/adapters/src/process-pty-wiring.test.ts:58` passes a relative task
   root, materializing directories in the repo working directory every run
   (135 removed from the maintainer machine this session). A red regression
   guard already exists in the working tree.
2. `recordScrollbackLine` (`process-sandbox.ts:296`) evicts with
   `Array.shift`, O(buffer) per terminal output line past capacity; head-cursor
   ring is O(1) with identical observable scrollback.
3. The idle sweep (`job-reconciler.ts:373`) calls `checkIdle` per active
   session, each performing `findUnique` + `findFirst` (`coding-session-service.ts:672`)
   — 2N+1 queries per sweep; one joined `findMany` collapses it.

Also noted this session and absent from both audits: local-disk retention for
`data/code-mode-tasks` task trees (`process-sandbox.ts:226`; the maintainer's
`data/` is 384 MB) — suspend-aware workspace GC with surfaced deletion, and
API-side pool sizing under N concurrently held SSE follow cursors.
