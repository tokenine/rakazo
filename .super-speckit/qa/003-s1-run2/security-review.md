# S1 Static Security Review (OCR-equivalent lane) — 003 Agent Marketplace

- **Candidate reviewed:** `3178940e` (pre-fix); fix `771be989` re-checked for the token finding
- **Lane:** independent `security-reviewer`, read-only, static
- **Standing:** static evidence only. This lane is a substitute for the unconfigured
  `gates.ocr_review` adapter; per kit policy it can **never** satisfy a runtime matrix row.
- **Verdict:** ❌ **3 high, 4 medium, 2 low confirmed.** Blocks S1 release.

## Config note

`super-speckit.yml` sets `gates.ocr_review: ""` while `merge.require_ocr_triage_complete: true`.
No OCR adapter is installed, so the configured gate cannot be satisfied. Rather than treat the gate
as met, an independent security-reviewer lane was run and its findings triaged here. This is a
recorded substitute, not a silent pass — see "Gate honesty" below.

## Triage

| ID | Severity | Finding | Triage |
|---|---|---|---|
| AGENT-BUNDLE-001 | high | Bundle-controlled MCP `slug` collision silently reuses an existing credentialed server and grants the attacker-authored bot the bundle's declared tool names | **fix** — blocks |
| AGENT-BUNDLE-002 | high | Portable stdio `command`/`args` → `cross-spawn` is host code execution; only the executable is allowlisted, args unrestricted | **fix** — blocks |
| AGENT-BUNDLE-003 | high | Export "fail-closed" secret scan is an unconditional no-op (`containsSecret(text, [])`) | **fix** — blocks · filed as BUG-003-S1-02 |
| AGENT-BUNDLE-004 | medium | MCP endpoint query credentials exported verbatim; no MCP field is scanned | **fix** — blocks release |
| AGENT-BUNDLE-005 | medium | Localhost/SSRF via bundle-supplied `endpoint` | **fix** — blocks release |
| AGENT-BUNDLE-006 | medium | `importPreviewCache` entries retained indefinitely after failed commit → unbounded memory growth | **fix** |
| AGENT-BUNDLE-007 | medium | Unbounded `skills`/`mcpServers` array counts amplify into unbounded DB writes per import | **fix** |
| AGENT-BUNDLE-008 | low | Same-hash cross-actor preview-cache clobber | **accepted-risk for S1**, re-evaluate in S2 |
| AGENT-BUNDLE-009 | low | Schema-backed finding whose exact Prisma runtime failure needs a runtime test | **needs-review** — must not be closed without a runtime test |

### Not found (checked, clean)

- **Prototype pollution / object injection:** no surviving finding. Strict root and nested Zod objects
  reject unknown keys, and parsed values are passed as Prisma *values*, never as dynamic query keys.
- **Cross-space authorization:** no surviving finding. All writes derive space/user from `context.actor`;
  `createBot`, skills, MCP lookup/create/assignment and audit rows are actor-scoped, and runtime MCP
  tool lookups re-check bot/space/user.
- **Privilege escalation via bundle fields:** `source` is forced to `user`; ownership and
  `isDeploymentOwner` cannot originate in the bundle; model-credential lookup is actor-scoped.
- **Path / file / SQL injection:** no surviving finding. `avatarKey`/`expertKey` are stored metadata —
  no imported field reaches filesystem path construction, and ORM queries are parameterized.
- **Token replay / confusion:** successful commit is one-use and actor-checked with enforced expiry.
- **BUG-003-S1-01** (already fixed in `771be989`): reviewer confirmed the fix correctly rejects
  non-64-char / non-lowercase-hex HMAC segments and checks equal byte lengths before `timingSafeEqual`.

## Impact on the matrix

- **V1 is invalidated.** Its "export REFUSED listing fields" clause depends entirely on the scan that
  is a no-op (BUG-003-S1-02). V1 cannot be marked verified while a security-reviewer confirms the
  refusal path is unreachable.
- V2 stands (23/23 independent probes, plus the token reproducer) — but AGENT-BUNDLE-001/002 show V2's
  *"installed MCP forced allowAllTools=false"* control is necessary but not sufficient.

## Gate honesty

`require_ocr_triage_complete: true` is **not** satisfied by this document, because no OCR adapter
exists. The config contradiction (`ocr_review: ""` + required) should be resolved by the project
owner — either configure an adapter or set the requirement false. Until then S1 cannot reach
`ready_for_merge` on configuration grounds, independent of the code findings above.

## Recommendation

Do **not** merge S1. The bundle format is the trust boundary for third-party-authored content, and
three high-severity capability/secret-handling defects survive. Recommend: fix AGENT-BUNDLE-001/002/003
as blocking bugs in their own worktrees, then re-verify. AGENT-BUNDLE-002 in particular means any
bundle a user imports can propose a stdio process the server will spawn — that should be treated as
the top priority, ahead of S2.
