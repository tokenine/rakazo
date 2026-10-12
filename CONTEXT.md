# Rakazo

Product language for the agent workspace. Code-mode terms describe the agreed product direction, not a claim that every capability is implemented.

## Language

**Code mode**:
The Rakazo experience for building, running, inspecting, and delivering software with an agent in a project environment.
_Avoid_: ZCode clone, terminal wrapper

**Project environment**:
A project's working environment containing its files, dependencies, and development services, isolated from other projects. Its files can persist while its compute is suspended; persistence does not imply that running processes survive.
_Avoid_: Bot memory, shared project folder

**Coding task**:
A bounded software change with an agreed outcome and evidence showing whether that outcome was achieved.
_Avoid_: Shell command, model response

**Coding session**:
The continuing interaction with the coding agent, including instructions, questions, and execution history, accessible through the app or CLI. Its coding engine is chosen at creation and remains fixed; changing engines requires a new session.
_Avoid_: Terminal session

**Coding engine**:
The agent implementation selected for a coding session: normal Pi or OMP. This choice is distinct from the language model or model provider.
_Avoid_: Model, mode

**Session handoff**:
An explicit continuation of work in a new coding session using the existing workspace and an optional summary, while preserving the original session's history. Active execution in the original session stops before workspace control transfers.
_Avoid_: Engine switch, session migration

**Project checkpoint**:
A saved project-file state available for restoration with protection for subsequent manual edits. It does not reverse database changes, deployments, or other external actions.
_Avoid_: Universal undo, computer snapshot

**Project setup definition**:
A reviewable description of the dependencies, setup steps, development services, and verification commands needed to reproduce a project's working environment.
_Avoid_: Session history, handoff summary
