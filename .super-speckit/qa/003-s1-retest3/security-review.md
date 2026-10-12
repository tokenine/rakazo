# S1 Static Security Review (OCR-equivalent lane) — re-run at `16c261cf`

- **Candidate reviewed:** `16c261cf` (tip of the S1 fix stack; supersedes the run2 review of `3178940e`)
- **Lane:** independent `security-reviewer`, read-only, static
- **Standing:** static evidence only. This lane substitutes for the unconfigured
  `gates.ocr_review` adapter and per kit policy **can never** satisfy a runtime matrix row.
- **Verdict:** ❌ **1 high, 3 medium, 1 low confirmed.** Blocks S1 release.

Down from run2's 3 high / 4 medium / 2 low, but **not** to zero — and the surviving high is the
same ID the previous lane filed, for a reason the previous lane's framing had missed.

## Triage of the nine prior findings

| ID | Prior | Now | Basis |
|---|---|---|---|
| AGENT-BUNDLE-001 | high | ❌ **not fixed** | see below — this is `BUG-003-S1-05` |
| AGENT-BUNDLE-002 | high | ✅ fixed | stdio / `command` / non-empty `args` refused at `router.ts:5202-5210`, before the first write at `:5238`; bundle input can no longer reach `connectStdio` |
| AGENT-BUNDLE-003 | high | ✅ fixed | export loads and decrypts space `AgentSecret`s (`:230-246`), fails closed on decryption failure, combines known-secret matching with credential-pattern detection (`:5379-5393`), refuses with named fields (`:5414-5418`) |
| AGENT-BUNDLE-004 | medium | ❌ **not fixed** | query/userinfo credentials are refused, but a credential in the **pathname** (`https://host/token/SECRET`) is neither, and export copies `endpoint` verbatim (`:5468-5482`) |
| AGENT-BUNDLE-005 | medium | ❌ **not fixed** | bundle endpoints are validated only as `z.string().url()`; a localhost endpoint persists and later opts into local HTTP, bypassing `createSafeRemoteFetch` and the DNS-pinning checks in `remote-mcp.ts:116-180` |
| AGENT-BUNDLE-006 | medium | ⚠️ **partial** | prune + TTL now bound an entry's lifetime, but `importPreviewCache` is still an unbounded map — many distinct near-2 MiB previews inside the 12-minute TTL are retained concurrently |
| AGENT-BUNDLE-007 | medium | ✅ fixed | caps of 100 skills / 25 MCP servers in the schema, re-applied at import |
| AGENT-BUNDLE-008 | low | ✅ fixed | key is actor-scoped at both write and read; the actor comparison remains as defence in depth |
| AGENT-BUNDLE-009 | low | ✅ fixed | audit row writes only schema-backed columns, matching `schema.prisma:844-859`; refusals run before the first write |

## The surviving high: AGENT-BUNDLE-001

The `6b5509b3` guard compares `transport` and `endpoint` and refuses a mismatch. That closes
**endpoint redirection**. It does not close **credential inheritance**: a bundle that names the
existing server's slug *and* its exact endpoint passes the equality check, so import reuses the
existing row — including its non-portable `secretId` — and then grants it the bundle's
`declaredTools`. At runtime `McpConnector.connectSession` (`mcp-connector.ts:337-350`) loads that
secret and authenticates with it.

The guard's `select` is `{ slug, transport, endpoint }`. It never reads `secretId`. The code has
one notion of "same server" and two meanings for it: *the same public service*, and *the same
credentialed object this actor owns*. Reuse is correct for the first and an escalation for the
second.

The lane flagged this as static. **The checker confirmed it at runtime** against a real Postgres —
import returned 200 and persisted `allowedTools = ["delete_repository","read_organization_secrets"]`
onto a server with a credential. Evidence: `.super-speckit/qa/003-s1-retest3/qa-retest3-credinherit.test.ts`
and `.super-speckit/bugs/003-S1-mcp-slug-capability-confusion.md`.

`allowAllTools=false` is present throughout and does not mitigate: the bundle is free to declare
`delete_repository`. The existing control bounds tools to the bundle's own declaration rather than
to what the operator granted, so it does not constrain the escalation at all.

## New finding this run

| ID | Severity | Finding |
|---|---|---|
| AGENT-BUNDLE-010 | low | Export loads every `AgentSecret` in the space without the owner check the `agentSecrets` APIs use (`loadExportSecretValues` `:230-246` vs `requireSpaceOwner` in `apps/api/src/agent-secrets.ts:17-27`), and returns a distinguishable refusal when a candidate string contains a stored secret. `AgentSecret` values may be as short as one character, so a non-owner member can test dictionary candidates and learn whether a space secret equals one. Recorded as needs-review: impact is a full-candidate membership oracle, not disclosure. |

## Prior clean claims — re-verified at this tip

Prototype pollution (strict schemas, values never used as query keys), cross-space authorization
(all writes derive from `context.actor`; runtime MCP lookups re-scope by bot/space/user), bundle
privilege fields (`source` forced to `user`, ownership and `isDeploymentOwner` cannot originate in
the bundle), path/file/SQL injection (imported `avatarKey`/`expertKey` are stored metadata; ORM
queries parameterized), and token replay (one-use, actor-checked, expiry-enforced, length-guarded
`timingSafeEqual`) all still hold.

## Gate honesty

`merge.require_ocr_triage_complete: true` is **not** satisfied by this document: no OCR adapter is
configured. The contradiction (`gates.ocr_review: ""` against a required gate) blocks merge on
configuration grounds alone, independent of every code finding above. This is a recorded substitute,
not a silent pass.
