# Plan — 005-code-workspace-shell

Approach and resolved design options: .super-speckit/grills/005-code-workspace-shell/spec-grill.md
(Resolver 1–5) and .super-speckit/design/004-code-mode/s7-shell-decision.json (UI option B).
Dependency direction: web → contracts ← api → adapter-kit/adapters; enforcement lives in the
provider; no new packages. Security invariants: view-only drop is provider-side and sticky;
write access only via a new lease-gated session; launch commands are server-chosen; env stays the
scrubbed allowlist. Verification: rows V22/V18b/V23/V24/V25 in
specs/005-code-workspace-shell/verification-matrix.md; red-green cycles A–F in
specs/004-code-mode/tdd-log.md.
