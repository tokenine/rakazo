# Bug: CLI JSON-RPC body transport 404s against the real API (2026-10-12, qa-006-run1)
Observed during candidate 2ba86804 journey QA against the local stack: POST /rpc with a JSON-RPC
2.0 body ({method:"threads.listSessions"}) returns 404, while the server's oRPC handler only
matches path-style URLs (POST /rpc/threads/listSessions → validation error, i.e. routed).
Evidence: curl against http://127.0.0.1:3100 — path style returns 400 input-validation (routed);
body style returns 404. The CLI client (apps/cli/src/client.ts orpcInvoke) posts the body style
to baseUrl verbatim; its fake-fetch tests never assert the URL, so this never failed in CI.
Existing commands (attach/approve/deny/steer) could never have reached the live server.
Fix: build the request URL as baseUrl + "/" + method.split(".").map(encodeURIComponent).join("/")
in both client.ts and chat.ts; add URL-asserting tests.

## Resolution
Fixed by building the request URL from the dotted method (rpcUrl in apps/cli/src/rpc.ts, used by
client.ts and chat.ts). Red-green: rpc-url.test.ts asserts the encoded path per method call.
