# Purpose Map — 007-cli-auth-handshake

## Intended outcome
rakazo login grants a scoped revocable CLI token via a browser Allow/Deny approval — no pasting secrets

## People affected
CLI users and their coding agents (primary); account owners who can see and revoke agent tokens in settings

## Success signal
login completes browser-approval-only on ai7, the issued token chats successfully, and revoking it in settings stops it immediately

## Non-goals
token expiry by default; device-code polling; better-auth plugin adoption; mobile/desktop login changes

## Human purpose gate
This map is a draft. A human confirms that this is the intended purpose, or corrects it. Technical implementation choices are deliberately outside this gate.
