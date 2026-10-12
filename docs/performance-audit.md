# Resource optimization audit

Date: 2026-10-12. Scope: web, Electron, mobile, API, worker, persistence,
agent runtime, artifacts, computers, integrations, voice, and development tooling.

This is a source audit and experiment plan, not a measured performance result.
No production data, provider calls, database migrations, or Electron launches were
used. Application behavior was not changed. Existing unrelated working-tree edits
were left alone. Research sources and tool guidance accompany this document in
[performance-methods.md](research/performance-methods.md).

The [second-pass findings](performance-deep-dive.md) supersede the initial priority
order below. They add concrete checkpoint/provisioning and lifecycle evidence,
correct assumptions about memoization and mobile focus handling, and include
reproducible offline work-count probes.

## Decision

Optimize work that grows with data or concurrency before polishing small constant
costs. First establish reproducible workloads; then prioritize bounded memory
retrieval, idle refresh traffic, large artifact copies, peer-history pagination,
and long transcript rendering. Sandbox lifecycle and model context can dominate
overall cost, so measure them alongside the application rather than assuming
React or Electron is the largest expense.

Expected benefits below are hypotheses. Rankings reflect code evidence and
potential scaling exposure, not demonstrated user impact.

## What already works well

- `apps/worker/src/index.ts` shares a modest database pool between Prisma and
  Graphile components and makes worker concurrency configurable.
- `packages/db/src/events.ts` uses realtime notifications with a 30-second catch-up
  when fanout is configured; its polling-only fallback uses 400 ms.
- `packages/adapters/src/executor.ts` batches streamed text at 250 ms and flushes
  before ordering-sensitive transitions. It checks run ownership on incoming
  runtime events at most once per second in that loop.
- `apps/web/src/App.tsx` and `pages/Shell.tsx` defer several routes and overlays.
  Transcript, message, composer, and markdown components already use memoization.
- `apps/mobile/app/thread.tsx` uses an inverted `FlatList`, memoized bubbles,
  foreground/focus checks, and scroll-anchor handling.
- Thread messages use sequence cursors; the schema already indexes thread sequence,
  run status/lease fields, and several reconciliation access paths.
- Memory context is capped at 32 KiB, history has compaction/windowing, and computer
  creation has CPU/memory controls. These are useful protections, although a cap
  applied after retrieval does not bound retrieval itself.
- `pnpm perf:desktop` and `perf:compare` already measure packaged renderer launch,
  typing, idle resources, streaming, bundle size, and retained-window reopening.

## Priority experiments

| Priority | Evidence and concern | Proposed change after profiling | Proof required |
| --- | --- | --- | --- |
| 1 | `packages/memory/src/index.ts`: search reads all scoped document contents, lowercases them, and filters in Node. `packages/adapters/src/memory-context.ts`: both scopes are read in full and sorted before the byte cap. | Add bounded context retrieval through the memory boundary; page newest metadata and fetch only required contents. Push search filtering into Postgres while preserving substring, path, tenant, and case semantics. Evaluate trigram indexing only if query plans justify it. | Synthetic 10/100/1,000/10,000 documents; rows/bytes fetched, heap peak, DB time, context equality, Unicode handling, and tenant isolation. |
| 1 | `apps/web/src/pages/Shell.tsx`: visible bot list refresh every 3 seconds, even when unchanged. Worker rescans Telegram user bots every 15 seconds. | Count actual queries first. Use durable invalidations plus a slower safety refresh for bot lists; keep reconnect catch-up. For Telegram reconciliation, prevent overlapping scans and ensure timer shutdown; consider change-driven refresh with fallback. | Visible/hidden, offline/reconnect, multiple clients, membership/status changes, zero configured integrations; idle queries/minute and correctness. |
| 1 | `packages/adapters/src/artifacts.ts`: `get` reads the full file into a `Uint8Array`. API retrieval can convert bytes to base64 in `apps/api/src/artifacts.ts`. | Introduce optional streaming artifact reads at the shared boundary and an authorized binary delivery path where suitable. Retain small inline payloads where clients require them. Do not bypass path protections or authorization. | Concurrent large downloads: RSS, external/array-buffer memory, bytes copied, time to first byte, disconnect cancellation, cross-tenant denial, all clients. |
| 2 | `apps/api/src/thread-message-pages.ts`: peer filtering queries runs per raw page; peer/receipt-only pages can trigger an unbounded number of serial page scans per request. Around lookup uses a count to detect older rows. | Benchmark peer-dense history. Evaluate SQL-side visibility or a persisted classification with safe backfill. Use an existence query for older rows if supported. If limiting scan work, provide a continuation cursor; never silently omit visible history. | 0/50/95/100% filtered rows; SQL calls, rows examined, p95, asks/text/receipts preserved, around targets, empty pages, mobile receipt behavior. |
| 2 | `Shell.tsx` transcript maps all loaded visible messages; every progress event creates a new snapshot/message array via `lib/thread-events.ts` and `takeLiveMessage`. Memoized rows help but list-wide work still grows with loaded history. | Profile 100/1,000/10,000 loaded messages. Isolate live-message updates and expensive derived grouping first. Add windowing only if layout/DOM dominates; preserve variable heights, selection, find, quotes, accessibility, and scroll position. | React commit duration, browser layout/paint, node count, heap, typing latency during streaming; deterministic behavior checks. |
| 2 | Desktop retains a hidden main window for up to 15 minutes (`src/window-options.ts`, `src/main.ts`). Local Compose continues after app quit by design. | Compare reopen latency against retained memory and hidden CPU. Consider an evidence-based shorter TTL or memory-pressure release. Measure the local backend separately from Electron. | Reopen median/tail, hidden memory/CPU over the full TTL, ongoing calls/tasks, server reconnect. Existing disable-retention benchmark is the comparison lever. |
| 2 | Durable progress writes remain at roughly four flushes/second per continuously emitting run, plus tool/activity events and lease queries. | Measure rows, WAL bytes, transaction time, and replay traffic per run. Tune batching only if it materially reduces cost. Add safe retention/checkpointing only after defining reconnect and replay requirements. | Concurrent runs, slow subscribers, interruption/resume, secret-redaction boundaries, ordering, terminal flush, durable recovery. |
| 2 | Sandboxes include real desktops and browsers; their resource use is separate from Node and can exceed the UI. Resource limits exist in `infra/sandboxes/supervisor/src/computer-spec.ts`; idle coding reconciliation also exists. | Measure active, idle, suspended, and resumed computers. Improve idle eligibility/lifecycle only where measurements expose waste; tune display geometry/frame transport for bandwidth if useful. | CPU-seconds, memory, disk, network per computer-hour; resume latency and state durability, busy lease protection, active browser/terminal sessions. |
| 3 | Agent context includes history, durable memory, scratchpad, discovered tools, images, and optional recall; history compaction already exists. | Attribute input/output tokens and model/tool latency per successful task. Bound tool discovery and context by relevance where supported; stable reusable prefixes may help compatible providers. Smaller models and compression require quality evaluations. | Deterministic scripted cost-shape checks plus separately opt-in model quality evals; task success, retries, tool accuracy, tokens, compaction cost. |

## Remaining surfaces

| Surface | Investigation | Useful optimization if evidence supports it |
| --- | --- | --- |
| Mobile | Release-build JS/native traces; `FlatList` row commits, long markdown, inverted-list scrolling, foreground/background transitions, network wakeups. | Stable props/render callbacks, tune render windows using real variable-height rows, reduce refreshes, cancel work when unfocused. A different list library is not the first step. |
| Web startup | Production entry chunks and import graph, script parse/evaluate, CSS/fonts, auth/bootstrap waterfall, cold vs warm cache. | Defer genuinely unused editors/terminals/plots/providers; narrow package exports if broad imports retain code. Preserve necessary loading feedback and avoid request waterfalls. |
| API | Route latency split into queue, authorization, DB, serialization, external adapters; event-loop delay and connection-pool waiting. | Select required fields, batch demonstrated duplicate lookups, bound payloads, tune pools/concurrency together. More connections can increase contention. |
| Database | `pg_stat_statements`, slow-query plans on disposable realistic fixtures, lock waits, temp spills, WAL and relation size. | Add indexes for demonstrated access paths; audit overlapping unique/index definitions against actual migrations before removing any. Indexes have write/storage costs. |
| Worker | Queue age, running jobs, pool waits, retries, reconciliation batch duration; existing reconciler prevents overlap and elects a leader. | Backpressure and bounded batches; prevent auxiliary scans from starving foreground runs; make retries bounded/jittered where appropriate. Do not remove reliability scans blindly. |
| Integrations | Directory/tool discovery, cache lifetime, listener cleanup, unchanged-account scans, outbound retries. | Deduplicate simultaneous discovery and refresh only stale/changed metadata. Credential/tenant boundaries must remain part of cache identity. Optional providers must stay optional. |
| Voice | Capture/VAD CPU, resampling and audio copies, encode/network/decode delay, timers, playback/call teardown. | Stop capture/timers at lifecycle boundaries, reuse buffers where traces show allocation pressure, use bounded streaming queues. Preserve permission and call behavior. |
| Memory/history storage | Growth of full-content revisions, events, artifacts, session files, checkpoints and backups. | Explicit retention/archive policies with recovery/export guarantees; avoid unchanged-content revisions if semantics permit. Never turn cleanup into unannounced data loss. |
| CLI / bridge / updater | Startup import cost, stream buffering, retry loops, connection cleanup, transfer compression and update size. | Profile realistic commands/transfers before bundling or rewriting; stream bounded data and reuse safe transports. |
| Marketing site | Astro production output, image dimensions/formats, fonts, cache policy and JS shipped per route. | Resize/compress heavy assets and remove unnecessary hydration based on Lighthouse/network evidence. |
| Build / test | Turbo cache hit rate, task graph, cold/warm build time, TypeScript/check/test peak memory and worker count. | Correct cache inputs/outputs; avoid duplicate generation; tune test concurrency to memory. Do not trade deterministic tests for speed. |
| Logging | Bytes/events per task, serialization CPU and export buffers; avoid transcript-sized logging. | Sample repetitive diagnostic events and bound exporter queues, preserving security/audit and failure signals. Never include secrets in profiling labels. |

## Measurement protocol

1. Use disposable synthetic accounts/data and scripted runtime/fake computers.
   Separate fixture generation from timed work. Record revision, build mode,
   data shape, concurrency, versions, and whether caches were primed. Keep raw
   machine-identifying reports local; publish sanitized summaries only.
2. Create scenarios: idle visible/hidden/background; cold/warm startup; typing
   during streaming; long history; peer-dense pagination; large artifacts; large
   memory; 1/4/16/64 concurrent runs; computer boot/idle/suspend/resume; voice
   start/stop. Ramp load and stop at saturation rather than assuming 64 is safe.
3. Measure both user outcomes and resources: usable/first-byte/tail latency,
   task success, CPU-seconds per task, RSS/heap/external memory, bytes transferred,
   queries and rows per request, DB pool wait, WAL/storage growth, token counts,
   and sandbox-hours. Include idle cost per minute and steady-state behavior.
4. Run a baseline and one change on identical fixtures. Alternate before/after
   run order; use repeated independent runs and longer steady-state samples.
   Report median and spread. A p95 from two launches is not reliable tail evidence;
   use enough samples and report sample count. Separate profiling runs from
   timing runs because profilers themselves add overhead.
5. Inspect the trace to identify the bottleneck, write a falsifiable hypothesis,
   implement the smallest change, and rerun. Reject changes that reduce memory
   by increasing unacceptable latency, retries, or failures.
6. Verify functional boundaries: authorization, cancellation, cursor replay,
   ordering, retries, visibility, scroll anchors, and all applicable clients.
   Run deterministic offline checks and relevant integration fixtures.
7. Establish budgets from stable baselines, not invented numbers. Enforce bundle
   bytes, query counts and bounded growth first; gate noisy runtime metrics only
   on controlled hardware with an explicit tolerance.

## Tools and implementation order

Use the existing desktop harness and comparison reports on CI or a dedicated
machine. It launches real Electron windows; do not run it as routine verification
on the maintainer's Mac. See [existing benchmark definitions](performance.md).

Use Node CPU profiles and event-loop/GC measurements for API/worker, Chrome
Performance and heap/allocation tools for web/Electron renderer, React Profiler
for commit attribution, PostgreSQL query statistics/plans for SQL, React Native
release/native tools for mobile, and container statistics for computers. Keep
tools optional and profiling disabled by default. Heap snapshots can contain
credentials and conversations and can pause or exhaust a process; use synthetic
fixtures on a disposable instance.

Deliver this in separate reviewable changes:

1. Add fixture-driven baseline scenarios for memory, peer pagination, idle
   refreshes, and artifact concurrency; connect results to existing reports.
2. Bound memory context retrieval and optimize search without changing contracts'
   visible semantics; record before/after query and allocation evidence.
3. Reduce unchanged idle refresh work while proving reconnect/status correctness.
4. Add artifact streaming and optimize peer-history query work independently.
5. Optimize transcripts, hidden-window retention, and sandbox lifecycle according
   to traces. These are separate tradeoffs and should not share one benchmark verdict.
6. Add deterministic regression budgets, then continue into model/voice/provider
   experiments with separately authorized external usage where required.

Do not start with a framework rewrite, blanket memoization, more pool connections,
global caches, weaker authorization, or reduced recovery guarantees. Each proposal
must explain which measured work disappears and what behavior remains correct.
