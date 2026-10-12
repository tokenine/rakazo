# QA environment: qa-006-run9
- Checker checkout: /Users/poom-work/rakazo-qa-006-r9 (standalone clone of candidate 0a0e69d907c9725a03e1bc8fceaf57336ac3cd27), built its own dist via corepack pnpm.
- Server: local dev stack — api 127.0.0.1:3100 (tsx), worker restarted 2026-10-12, postgres compose container 5433, web 5173 (200).
- Test data: fresh principal qa-cli-agent@example.com via email-OTP emulator (/api/dev/emails), space 12cf63db…, bot "QA Fixture Bot" cmv5bjo5p000l8k7j7uubrrs9 with spawnKey qa-006-run3; model credential = offline model fixture (testkit startModelEmulator) at 127.0.0.1:57116/v1; computer sandbox image rakazo/computer:local built locally.
- Isolation: unique bot spawnKey + fresh user; fixture emulator is loopback-only.
