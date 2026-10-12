# Purpose Map — 001-multi-session-agents

## Intended outcome
A user can run parallel, separately-contexted sessions (threads) with the same bot — each session keeps its own message history, compaction state, run serialization, and unread flag, and every session is resumable later on any surface (web, desktop, mobile).

## People affected
Users juggling several tasks with one agent across web/desktop/mobile; existing messaging (Telegram) users who must keep landing on their bot's thread without behavior change.

## Success signal
Two sessions on one bot hold fully separate histories and accept runs independently (the bot's shared computer lease remaining the only serialization); a user can list, switch, rename, delete sessions; existing deployments migrate additively with their thread becoming the bot's primary session and no data loss; Telegram inbound still lands on the primary session.

## Non-goals
Simultaneous parallel runs on one bot's computer (execution lease stays per-bot); per-session model/persona overrides (bot config stays bot-level in v1); changes to group chats or external conversations (their uniqueness rules stay untouched).

## Human purpose gate
This map is a draft. A human confirms that this is the intended purpose, or corrects it. Technical implementation choices are deliberately outside this gate.
