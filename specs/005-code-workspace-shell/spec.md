# Spec — 005-code-workspace-shell

Code workspace shell amendment. Requirements R12/R13 are authored in
specs/004-code-mode/spec.md ("Amendment 2026-10-11 — workspace shell", committed feac3b7a) and
are normative here by reference; this feature is the slice-7 delivery vehicle created because the
004 record was a truthful terminal block (S8 provider gap) and candidate identities are immutable.

- Problem: code mode was a hidden popover toggle plus header pills; an "omp session" never ran omp.
- Requirements: R12 seamless switch + workspace shell with terminal/files/preview/git panels
  outside the computer screen; R13 omp runs inside the terminal automatically.
- Non-goals: chat-UI clone for omp; mid-session engine change; file editing/diff depth; panels
  must degrade truthfully when unsupported.
