# Architecture receipt — 005-code-workspace-shell

Resolved options (grill "Resolver", 2026-10-11; dependencies: api → adapters/adapter-kit/contracts;
web → contracts; no new packages):

1. Dedicated route /app/code/:sessionId; session id is the aggregate root (reversible: alias later).
2. View-only enforced in the provider before the pty handle (kind-0 drop), sticky on any view-only
   reconnect; write access regained only by a NEW session, which the API gates on the lease.
3. Non-process providers (desktop/daytona/e2b/fake) declare no SandboxCapabilities.viewOnlyTerminal;
   router fails closed with {url:null, reason} when leaseless (checker-endorsed option b).
4. omp bootstrap via server-chosen launch command on the PtySpawner seam ({args?,env?} additive);
   clients cannot supply commands; env stays the scrubbed allowlist.
5. Files/preview/git reuse listFiles/readFile + read-only git argv behind the shared
   codingSessionComputer gate (space-scoped session + repos.getBot + running computer).

Boundary rule honored: contracts carry payloads; adapters own enforcement; web renders state.
Forbidden dependency check: no web→adapters imports; no provider env vars.
