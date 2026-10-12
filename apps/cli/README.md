# Rakazo CLI

Chat with your Rakazo bots from any terminal or coding agent.

```bash
npm i -g rakazo
rakazo login --server https://your-rakazo.example.com
rakazo chat <bot-id> "run the login tests and tell me what failed" --json
```

- `login` opens your browser for a one-click approval and stores a scoped, revocable token.
- `chat` sends a message to a bot and prints its reply as JSON (`--json`) or plain text — built
  for coding agents on machines away from the Rakazo server.
- Also: `attach`, `steer`, `approve`, `deny`, `status`, `logout`.

All commands: `--json` envelope `{ok, data|error}` on stdout, stable exit codes (0 ok, 3 auth,
6 timeout), `--timeout` bounded waits. Tokens live in `~/.config/rakazo/credentials.json` (0600)
and are never printed. Revoke any CLI token in your account settings.
