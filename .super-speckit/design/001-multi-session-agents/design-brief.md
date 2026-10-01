# 001-multi-session-agents — Bot session switcher

## Problem
Inside the existing bot chat view (no new navigation area): a compact session switcher listing the bot's sessions ordered primary-first then last-activity, each row with unread badge and relative time; actions: new session, rename, delete (non-primary only; primary delete promotes earliest; last-session delete refused). Route becomes /{botId}/{threadId?} — threadId absent resolves primary. Styling uses @rakazo/ui-tokens semantic tokens via existing chat-ui components; no brand colors. Unread = per-session flag already on Thread; live updates ride existing thread event subscription plus new session.created/renamed/deleted events. e2e V6/V7: switch, rename, resume after reload, live list update without reload.

## Assumptions to review

- User, hierarchy, and state behavior need product confirmation.
- Reuse the repository design system when one is declared.
- This prototype is not production code.
