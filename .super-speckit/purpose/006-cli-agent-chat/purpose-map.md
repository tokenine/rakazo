# Purpose Map — 006-cli-agent-chat

## Intended outcome
A coding agent on a separate machine chats with a Rakazo bot from the shell: sends a message, reads the bot's reply back as machine-readable JSON

## People affected
AI coding agents (primary, Pi/OMP/ZCode); developers operating Rakazo from a terminal (secondary); humans keep reviewing conversations in the existing web UI

## Success signal
npm i -g @rakazo/cli, login once, then chat returns the bot's reply with structured JSON and bounded timeouts, without touching the web UI

## Non-goals
Direct computer-control commands; new server endpoints (unless one small amendment proves necessary); long-lived scoped API keys; agent SKILL.md; interactive REPL

## Human purpose gate
This map is a draft. A human confirms that this is the intended purpose, or corrects it. Technical implementation choices are deliberately outside this gate.
