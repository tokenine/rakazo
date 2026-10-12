# Decision records (index)

Durable architecture decisions live here as links. Locked decisions must not be
re-litigated in feature work (source: `docs/HANDOFF.md` §2 — treat that section as the
authoritative statement; this file is the index).

| ID | Decision | Status | Where |
| --- | --- | --- | --- |
| ADR-0001 | Computer sandbox is no-root by design (uid 1000, CapDrop ALL, no-new-privileges); anything agents need is baked into the image | **LOCKED** | docs/HANDOFF.md §2.1; infra/sandboxes/computer/Dockerfile; supervisor computer-spec.ts |
| ADR-0002 | Client browser pane is a main-process WebContentsView, never a `<webview>` tag (webview CDP targets aren't Playwright Pages) | **LOCKED** | docs/HANDOFF.md §2.2; apps/desktop/src/client-browser/pane.ts |
| ADR-0003 | `client_js` kernel: playwright-core over the app's own random CDP port; `tab` pre-bound; timeouts are graceful, never throw from a timer | **LOCKED** | docs/HANDOFF.md §2.3; apps/desktop/src/client-browser/index.ts |
| ADR-0004 | Per-user Telegram = one keyed adapter per bot row (thread-id shadowing), worker reconciliation every 15s | **LOCKED** | docs/HANDOFF.md §2.4; packages/adapters/src/telegram-keyed-adapter.ts |
| ADR-0005 | Browser fallback rule: client browser first for logged-in tasks; VM browser fallback without stopping to ask (exception: Built-in toggle ON + desktop online) | user-approved standing order | docs/HANDOFF.md §2.5 |
| ADR-0006 | Screen embeds seal noVNC capability against request origin; new client origins need `RAKAZO_EXTRA_ORIGINS` | LOCKED pattern | docs/HANDOFF.md §3; apps/api/src/request-origin.test.ts |
| ADR-0007 | Provider neutrality: no hosted vendor required; vendor SDKs only in adapters/composition roots; deterministic offline conformance tests | LOCKED (AGENTS.md) | packages/adapter-kit, packages/adapters conformance tests |

Routine implementation choices do not get ADRs; record them in the feature's change-story
or plan instead.
