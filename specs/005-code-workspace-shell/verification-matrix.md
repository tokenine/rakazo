# Verification matrix — 005-code-workspace-shell (slice 7 of 004-code-mode)

Full program matrix: specs/004-code-mode/verification-matrix.md (frozen at the 004 S8-block candidate). Rows here cover the R12/R13 amendment only; V18b extends V18.

| V22 | REQ-R12 seamless switch + shell | One visible Chat→Code action; creating/opening a session navigates to the workspace view; panels discoverable without the popover-toggle path | web e2e + journey-UX | S7 |
| V18b | REQ-R12 terminal without lease | Terminal streams view-only without the control lease; input requires the lease; reconnect/replay still per V18 | vitest + web e2e | S7 |
| V23 | REQ-R13 omp real spawn | Active omp session's PTY bootstraps bash and launches omp automatically; spawnOmp production stub replaced; no manual launch needed | vitest (fake omp) + e2e | S7 |
| V24 | REQ-R12 files + preview panels | Workspace file listing/read RPC authorized to session viewers; file tree renders; read-only preview opens a file | vitest + web e2e | S7 |
| V25 | REQ-R12 git graph panel | Workspace git history/branches computed server-side; graph panel renders for a git repo; empty state for non-repo | vitest + web e2e | S7 |
