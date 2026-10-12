# Engineering review notes: 006-cli-agent-chat
Independent read-only review of git diff 6a6b3946..7ccd358b -- apps/cli (all feature commits).

## Round 1 (candidate 35774cf9 lineage)
Verdict FAIL. Blocking: `--timeout <non-numeric>` silently disabled the deadline (NaN) and hung
forever (index.ts:118, chat.ts:83-87). Non-blocking: test used a CliError code outside the union;
credentials dir built by string slicing (Windows-unsafe); server origin ending in /rpc/ became
/rpc/rpc; AUTH_FAILED/UNREACHABLE codes declared but never produced; single transient poll failure
aborted chat; emit redact option never wired; stale role literal "agent"; dead zod/@orpc/client deps.

## Round 2 (candidate 7ccd358b)
Verdict PASS, no blocking findings. All nine fixes verified individually; 26/26 tests, tsc clean.
Reviewer independently validated the wire contract against server code (app.ts:604-614 path mount,
rpc.ts:356-362 send shape, domain.ts:953-963 snapshot, events.ts:62 roles) and confirmed dev-only
dependency safety for the published bin. Remaining non-blocking notes: classifyError and the
--timeout rejection path are unpinned by unit tests (covered by the live QA journey); persistent
failure to deadline surfaces the last classified error rather than TIMEOUT (documented choice).
