# Performance investigation methods

Research date: 2026-10-12. This note describes experiments to run, not measured speedups.
Source inspection confirms a Node/Hono API, React/Vite web renderer shared by Electron,
Expo/React Native mobile app, Prisma/node-postgres storage, shared packages, and an existing
desktop benchmark. No runtime profile or device measurement was collected for this note.

## Start with the existing harness

[Desktop benchmark definitions](../performance.md) already cover packaged startup, typing,
settings, idle CPU/memory, and scripted streaming against disposable data and fake providers.
Reuse `pnpm perf:desktop` and `pnpm perf:compare`; avoid creating a competing benchmark.
These commands launch Electron and can steal focus: run them on a dedicated benchmark machine
or suitable CI, rather than as routine checks on a maintainer's Mac.

The existing fixture uses 100 messages and streaming events every 50 ms. Add separate cases
for long histories, bursty tool output, repeated navigation, slow consumers, cancellation,
background/foreground transitions, and several subscribers. Keep workload, cache state,
versions, hardware class and concurrency fixed between baseline and candidate. Repeat runs;
report sample count, median and spread before making a claim. Small launch samples cannot
support a credible p99 claim. Record bytes, CPU time, peak and settled memory alongside latency.

Prioritize by measured total resource cost and user impact: frequency × cost per operation,
then engineering effort and correctness risk. Optimize one cause at a time and rerun the same
workload. A faster startup bought with permanently retained memory is a tradeoff to quantify.

## Tools by surface

| Surface | First measurement | Tool and interpretation |
| --- | --- | --- |
| API / worker | Request/run latency, event-loop delay, CPU, queue age and allocation growth | Node CPU profile or Linux perf flame graph identifies synchronous CPU hotspots; `perf_hooks` supplies event-loop utilization and delay. High utilization alone does not identify the slow function. [Node flame graphs](https://nodejs.org/learn/diagnostics/flame-graphs), [performance APIs](https://nodejs.org/api/perf_hooks.html) |
| Web / shared Electron renderer | Typing and streaming commits, scripting/layout/paint, startup transfer and parse cost | Chrome Performance trace separates rendering stages; React Profiler identifies costly commits and compares actual with base render duration. Profile individual thread/composer boundaries before adding memoization. Profiling adds overhead; confirm improvements with the ordinary production build. [Chrome Performance](https://developer.chrome.com/docs/devtools/performance), [React Profiler](https://react.dev/reference/react/Profiler) |
| Electron main process | Startup dependency loading, blocking IPC, background CPU and memory per process | Electron recommends profiling before changing code, avoiding main-process blocking and unnecessary startup work. Compare retained hidden windows with recreation using the existing harness: measure reopen latency and idle memory together. [Electron performance](https://www.electronjs.org/docs/latest/tutorial/performance) |
| Expo / React Native | JS and UI frame stalls, long thread scrolling, memory after navigating away | Use React Native DevTools for JS/React profiles and Android Studio/Xcode for native work; judge performance in release builds on representative physical devices. JS and UI threads can have different bottlenecks. [Expo tools](https://docs.expo.dev/debugging/tools/), [React Native performance](https://reactnative.dev/docs/performance) |
| PostgreSQL | Total query time, calls per workflow, rows/bytes returned, pool wait | Aggregate query fingerprints with `pg_stat_statements`, then inspect the largest contributors using `EXPLAIN (ANALYZE, BUFFERS)` on disposable data. Compare actual/estimated rows and buffer activity before adding an index. `ANALYZE` executes the query, including writes. [Query statistics](https://www.postgresql.org/docs/current/pgstatstatements.html), [EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html) |

Use documentation for the installed runtime/database version when implementing instrumentation;
the linked current manuals can describe APIs absent from older supported versions. CPU profiles,
heap captures and SQL traces may contain sensitive content: collect only synthetic workloads and
keep raw captures local unless reviewed and sanitized.

## Experiments specific to shared streaming and storage

These are hypotheses, not established defects:

The companion code audit found existing text throttling, memoized message rendering and a
mobile `FlatList`. Treat batching, memoization and virtualization as tuning questions rather
than assuming these mechanisms are missing. Profile large histories and bursty output to find
the remaining cost. In particular, test memory retrieval before its context cap, peer-history
pagination scans, whole-file artifact reads followed by base64 encoding, and visible bot polling.
Those observations identify experiments; they do not establish their share of runtime resource use.

- Count provider events, database writes, serialized bytes, subscription deliveries and React
  commits for one fixed run. If transient progress dominates, test bounded coalescing at the
  shared orchestration boundary. Preserve terminal state, tool results, ordering and reconnect
  replay. Compare first visible output and completion latency as well as throughput.
- Slow a subscriber deliberately and inspect buffered bytes and retained memory. Node's stream
  guidance explains why respecting backpressure prevents producers from overwhelming consumers.
  Application event queues need their own bounds and overflow/recovery policy; Node stream
  backpressure does not automatically bound custom pub/sub or WebSocket queues.
  [Node backpressure](https://nodejs.org/learn/modules/backpressuring-in-streams)
- Repeat subscribe/unsubscribe, abort and reconnect cycles. Memory should settle rather than
  grow with each cycle. Count live listeners, timers, sockets and pending work; verify cancellation
  releases upstream resources and preserves durable state.
- Measure query count and returned columns for thread open and replay. Test pagination and
  bounded projections only where profiles show history size or payload materialization matters.
  Match indexes to the measured query predicates/order; include write overhead in the comparison.
- Inspect pool acquisition wait separately from SQL execution. The API currently defaults its
  pool maximum to four. Raising that limit is an experiment, not a universal optimization:
  budget connections across API, worker and replicas, and ensure every borrowed client is released.
  [node-postgres pooling](https://node-postgres.com/features/pooling)

## Acceptance evidence

Each candidate should record the triggering workload, baseline, hypothesis, exact change,
before/after distribution and correctness checks. Preserve deterministic offline provider tests.
For streaming changes cover replay, slow consumers, cancellation and terminal-event delivery;
for database changes cover pagination ordering and concurrent updates. Confirm shared behavior
on web/Electron and mobile where applicable. Set regression budgets only after repeatable
baselines establish normal variance; use deterministic asset-size checks earlier.
