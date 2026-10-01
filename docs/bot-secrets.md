<!-- 004-code-mode carve-out (T20, Q10 Option B) — ANNOTATION AT TOP, doc not rewritten. -->
> **Scope note for 004-code-mode task runtimes ONLY:** the blanket refusal below —
> "injecting credentials into arbitrary AI-controlled shell commands, files or
> environment variables … is not exposed" — is **superseded for 004-code-mode task
> runtimes** by the audited project-secrets subsystem: declared secret NAMES are
> granted per (workspace, taskRun), values are injected at process spawn/bootstrap
> env only through a capability-gated, audited channel, hashed-chain audited
> (`audit verify`), TTL-bounded, revocable, and swept by a deny-list egress filter
> (literal + base64/hex/URL). See
> `.super-speckit/design/004-code-mode/decision.json` (Q10, Option B) and
> `specs/004-code-mode/verification-matrix.md` (V8–V11). The **blanket refusal stands
> everywhere else** — bots outside 004-code-mode task runtimes still have
> no shell/file/env credential injection.

# Reusable API credentials

Ask a bot to connect an API using a key or password. It calls `request_secret` with a reference name and an HTTPS service origin. The protected card shows that origin before you save. Web, Electron and mobile use the same backend; the value is cleared from the input when submission starts and is omitted from messages, events and model input.

For example, the bot can request:

```json
{
  "label": "API key",
  "purpose": "api_key",
  "credential": {
    "name": "example_api",
    "origin": "https://api.example.test",
    "auth": { "type": "bearer" }
  }
}
```

The value is encrypted in Postgres `bot_secrets` using the deployment's `ENCRYPTION_KEY` (AES-256-GCM with record-bound authentication). Only the run's user can submit a reusable credential. It belongs to that user, space and bot, survives later runs, and is deleted when its owner, space or bot is deleted. Names, destinations and authentication configuration are metadata; `list_secrets` returns those fields without values. No hosted credential service or prebuilt connector is required.

The bot uses `secret_request` to ask the backend to decrypt and inject the credential:

```json
{
  "name": "example_api",
  "url": "https://api.example.test/v1/items",
  "method": "GET"
}
```

Authentication supports Bearer tokens, a named header (`{"type":"header","name":"X-Api-Key"}`), and Basic authentication (`{"type":"basic","username":"api-user"}`). Basic uses the protected value as the password. Requests can send JSON, form-encoded or plain text bodies. The saved origin must match exactly, including port. Redirects and unsafe network destinations are rejected through the shared remote-request policy. Requests follow the existing action approval rules, have a 30-second deadline and a 1 MB response limit, and return at most 20,000 characters of redacted response content without response headers.

Calling `request_secret` again with the same name and configuration returns the saved reference. Add `"replace": true` to show another protected card and replace its value. `forget_secret` with `{"name":"example_api"}` removes the stored value and prevents future use; an already-started request may finish. Remove a credential before changing its origin or authentication configuration. Each user can save up to 100 credentials per bot, with values limited to 16,384 characters.

The model has no tool for reading these values, and the backend removes direct and common encoded echoes from API responses. The approved service still receives the credential: redaction cannot defend against a malicious service deliberately transforming it. Choose a service you trust and use appropriately scoped credentials.

This boundary supports authenticated HTTP requests. Injecting credentials into arbitrary AI-controlled shell commands, files or environment variables would let those commands read them, so those paths are not exposed. APIs needing request signing, OAuth refresh, multiple credentials or custom protocols should use a connector adapter. Existing `request_secret` calls with a `connectionId` retain their one-use connector-code flow; website sign-in uses `request_takeover`.
