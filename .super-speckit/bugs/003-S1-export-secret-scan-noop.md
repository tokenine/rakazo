# BUG-003-S1-02 — Export "fail-closed" secret scan is an unconditional no-op

- Status: `confirmed`
- Found in: `003-agent-marketplace / candidate 3178940e / QA run 003-s1-run2, security lane (V4 static review)`
- Affected requirement: `R1/R2` — matrix row **V1** ("agent with containsSecret hit → export REFUSED listing fields")
- Severity: `high`
- Reproduction: `2/2 deterministic` (code path proof + runtime proof)

## Expected / actual

**Expected:** `agents.export` refuses to serialize a bot whose instructions/description/skill text
embed a credential, and names the offending fields. The code comment states the intent explicitly:
`// containsSecret scan over free-text fields (fail-closed).` The task list names the same obligation
(T2: "containsSecret scan over free-text → REFUSE with flagged-field list"). The spec's V1 row depends
on it: sharing a bundle must not leak a credential.

**Actual:** The refusal branch is **unreachable**. Export always returns the bundle, verbatim,
including any embedded secret.

## Root cause

`apps/api/src/router.ts`, `agents.export`:

```ts
const scan = (text: string) => containsSecret(text, []);
```

`containsSecret(value, secrets)` in `packages/core/src/events.ts:337` is a **known-secret substring
detector**, not a credential-pattern detector:

```ts
export function containsSecret(value: unknown, secrets: string[]): boolean {
  const active = secrets.filter((secret) => secret.length > 0);
  if (active.length === 0) return false;   // <-- always taken when called with []
  ...
}
```

Passing a literal empty array satisfies that guard immediately, so `scan()` returns `false` for every
input, for all five scanned fields (`bot.instructions`, `bot.description`, and each skill's
`description`/`content`). `flaggedFields` therefore stays empty and the `throw` at
`router.ts:5284` is never reached.

The inline comment is self-contradicting and should be read as evidence the author suspected this:
`// secrets list is empty → only detects credential substrings in the existing bot secrets.` With an
empty list it detects nothing at all.

## Minimal reproduction (runtime proof)

```js
const key = "<a Stripe-style secret key, e.g. one beginning sk_live_>";
containsSecret(key, [])        // -> false   (what export does)
containsSecret(key, [key])    // -> true    (what a working scan needs)
```

Replicated verbatim from the guard at `events.ts:337` and run on the candidate. An agent whose
instructions embed that key exports successfully; the promised "Export refused: embedded secret
detected in: …" message is never produced.

Practical consequence: a user who writes a credential into an agent's instructions or a skill and
then shares the exported bundle — the exact scenario V1 exists to prevent — leaks the credential.

## Evidence

- Static lane: `AGENT-BUNDLE-003` (security-reviewer, candidate `3178940e`), locations
  `router.ts:5258-5287`, `router.ts:5295-5328`, `events.ts:337-341`.
- Runtime proof: guard logic executed on the candidate worktree `ss/qa/003-s1-run2` (output above).
- Sanitization completed: yes (fake `sk_live_` test string, no real credential).

## Fix and regression obligation

- Bug-fix worktree/commit: pending
- Regression test: `apps/api/src/agent-bundle.test.ts` V1 group — a bot whose `instructions` (and one
  whose skill `content`) contains a known secret value must make `agents.export` reject with a
  `BAD_REQUEST` naming the flagged field, and a bot with no secret must still export successfully.
  The test must inject the secret through a real secret so the detector has something to match;
  asserting only "export succeeds" would pass on today's broken code and would be a tautology.
- Independent retest run: pending

## Suggested fix (smallest correct that preserves the existing detector)

Load the actor/space/bot secret values and pass them to the detector, and fail closed if they cannot
be retrieved:

```ts
const secretValues = await loadSecretValuesForExport(context.actor, bot.id); // decrypt/store-backed
const scan = (text: string) => containsSecret(text, secretValues);
```

A vetted credential-*pattern* detector (e.g. `sk_live_`, `ghp_`, AWS `AKIA…`, PEM blocks) should be
applied in addition, because a pasted credential that is not yet in the store cannot be caught by a
known-secret list. Whatever the combination, retrieval failure must throw rather than default to an
empty list — an empty list must never again mean "scan passed".
