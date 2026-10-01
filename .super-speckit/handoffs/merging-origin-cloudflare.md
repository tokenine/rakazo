# Durable handoff — merging-origin-cloudflare

- **Purpose:** Operational guidance for merging `origin/cloudflare` into `integration/001-multi-session-agents`
- **Status:** `ready` — operational facts documented

## What to expect

When merging `origin/cloudflare` into `integration/001-multi-session-agents`, expect exactly one conflict in `docs/HANDOFF.md`, line documenting the sign-up allowlist. This is due to history being squashed from 37 commits to 2 to remove personal email addresses from the public repository. All other files will auto-merge cleanly.

## Sync and merge commands

1. Ensure local integration branch is up-to-date:
   ```
   git checkout integration/001-multi-session-agents
   git pull origin integration/001-multi-session-agents
   ```

2. Merge from cloudflare branch:
   ```
   git merge origin/cloudflare
   ```

3. When conflict occurs in `docs/HANDOFF.md`, resolve it:
   ```
   git checkout --ours docs/HANDOFF.md
   git add docs/HANDOFF.md
   git merge --continue
   ```

## Verify after merging

1. Check no email-shaped strings in branch:
   ```
   git grep -E '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' docs/HANDOFF.md
   ```
   Should return no matches.

2. Confirm the redacted allowlist line is preserved.

## Do not

Do NOT accept the incoming version of `docs/HANDOFF.md` - this would reintroduce personal email addresses into the public repository.

## Note

Personal email addresses must never be reintroduced into this branch. The operator of the `cloudflare` branch must redact them on their own branch separately.