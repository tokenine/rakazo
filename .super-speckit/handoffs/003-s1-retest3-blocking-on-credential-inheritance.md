# Durable handoff — 003-s1-retest3-blocking-on-credential-inheritance

- **Feature / phase / candidate SHA:** 003-agent-marketplace · S1 retest · `16c261cffdab84d31f553dcdf42f3ade27832eea`
- **Lane role:** `checker`
- **Status:** `blocked` (on a confirmed high-severity product defect, not on a human decision)
- **Transfer:** `same-environment`

## Last verified fact and evidence

At `16c261cf`, against a **real migrated Postgres** (first live-DB evidence this feature has ever
had), a bundle that declares an MCP server matching an existing server's `slug` **and** exact
`endpoint` is imported successfully and has its own `declaredTools` attached to the operator's
credentialed server:

```
      bot      |             slug             | server_has_credential | allowAllTools |                    allowedTools
---------------+------------------------------+-----------------------+---------------+----------------------------------------------------
 QA3A Imported | github-3756239-1790651381845 | t                     | f             | ["delete_repository", "read_organization_secrets"]
```

Import returned **200**. Evidence: `.super-speckit/qa/003-s1-retest3/` and
`.super-speckit/bugs/003-S1-mcp-slug-capability-confusion.md`.

Everything else at this tip is green: 442/442 api, 59/59 contracts, `tsc` clean, 4/4 real-DB import
probes, and the security lane verified five of nine prior findings fixed.

## Work completed

1. **Recovered a stale state index.** The index said `qa_failed` @ `771be989` with three open highs;
   git carried a seven-commit fix stack plus an eighth fix uncommitted in `ss/bug/003-s1-04`.
2. **Completed `AGENT-BUNDLE-008`** → `16c261cf`. The draft regression test read `.status` off the
   `RPCHandler.handle()` result instead of `.response`, so it failed regardless of the fix;
   corrected, then measured red at `6783f681` (1 failed / 47 passed) → green 48/48.
3. **Provisioned a live database** and closed run2's "no live database" gap. The four new probes
   were measured red at `3cbeeaca` (4/4 fail, diagnostic) → green 4/4 at the tip. This is the
   evidence that closes `AGENT-BUNDLE-009`, which a mock double had hidden.
4. **Re-ran the static security lane** at the tip: 1 high, 3 medium, 1 low.
5. **Filed `BUG-003-S1-05`** with runtime proof and dispatched the fix to `ss/bug/003-s1-05`.

## Next smallest safe action

Complete the `ss/bug/003-s1-05` fix, then run an **independent** retest in a fresh
`ss/qa/003-s1-retest4` worktree that replays `qa-retest3-credinherit.test.ts` unchanged plus the
full gate set. S2 must not start: the catalog installs the very bundles under discussion.

Then, in order: the three open mediums (`AGENT-BUNDLE-004` pathname credentials, `005` localhost
SSRF, `006` unbounded cache), then re-run the security lane and the matrix.

## Autonomous decision made / evidence / reversible alternatives

- **Chose Option B for the credential-inheritance fix** — reuse an existing server only when it has
  no credential (`secretId IS NULL`), refuse otherwise — over Option A (refuse all reuse) and
  Option C (clamp tools to the operator's grants, which does not work: the imported bot has no
  prior grant to clamp to). Evidence: the bug artifact's fix-direction section. Reversible: it is
  a single guard in one handler; switching to A is a one-line change.
- **Did not merge despite `merge.autonomous_when_ready: true`.** That setting authorizes merging a
  *verified* candidate. A runtime-confirmed capability escalation is not verified. Autonomy does
  not extend to shipping a known-critical security defect.
- **Did not convert the mock-based probes into passes.** They are structurally incapable of
  detecting the 009 class of defect, which is why they all passed while real imports returned 500.

## Blocker and resume condition

- `BUG-003-S1-05` — resume when the `ss/bug/003-s1-05` commit exists and an independent checker has
  replayed the credential-inheritance reproducer in a clean worktree against real Postgres.
- **`gates.ocr_review: ""` vs `merge.require_ocr_triage_complete: true`** is a configuration
  contradiction: the configured merge gate can never be satisfied. This blocks merge on
  configuration grounds alone, independent of any code finding. **Needs the project owner** —
  either configure an OCR adapter or set the requirement to false. Autonomy does not grant
  authority to change the project's own merge policy.
