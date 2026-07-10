# AGENTS.md

These instructions are for Codex and other coding agents working in this repository.

## Source of Truth

[lazy-sunday-rules-v1.md](./lazy-sunday-rules-v1.md) is the immutable game spec. Section 9 is the edge-case spec for the rule engine. Do not invent, simplify, or reinterpret a rule. When a rule is subtle, quote the relevant rule text in a nearby code comment.

## Development Workflow

For every feature, bugfix, documentation task, or agentic coding task:

1. Create or confirm a GitHub issue before implementation begins.
2. Confirm the scope and Definition of Done.
3. Create a new branch from `main`.
4. Make meaningful, unit-sized commits on that branch.
5. Open a pull request back to `main` when the branch is ready.

If there are existing uncommitted changes, inspect them before editing. Treat user changes as intentional and do not revert them unless explicitly asked.

## Architecture Boundaries

- `packages/engine` owns all game rules and state transitions. It is pure TypeScript with no sockets, DOM, timers, or I/O.
- `apps/server` owns rooms, lobby state, WebSocket connections, reconnection tokens, host controls, timers, slap rate limiting, and per-player event routing.
- `apps/web` owns presentation, local socket state, local peek timers, sound, reactions, and user interaction.

The server should bridge protocol messages to engine commands. The client should never become a second rules engine.

## Privacy and Visibility Rules

Never serialize raw `RoundState`.

The only game-state shape that may go to a client is that player's own `RoundView` from `packages/engine/src/view.ts`, plus engine events filtered with `eventVisibleTo`.

Face-down card identities and stable card ids stay server-side except in these allowed contexts:

- `drawnCard` events sent only to the drawing player.
- `peek` events sent only to the addressed player.
- Public face-up moments such as DONE top, discards, slap outcomes, Knock It Out self-discards, and round reveal.

Client-side remembered peeks are temporary UI memory, not server truth.

## Verification Expectations

Choose checks based on the changed surface:

- Engine behavior: `npm test`.
- Engine package type changes: `npm run typecheck -w @lazy-sunday/engine`.
- Server protocol or room changes: `npm run typecheck -w @lazy-sunday/server` and consider `npm run playtest`.
- Web UI or hook changes: `npm run typecheck -w @lazy-sunday/web` and, for production-readiness, `npm run build -w @lazy-sunday/web`.
- Documentation-only changes: run a link/file sanity check and `npm test` when dependencies are available.

Report any command you could not run.

## Documentation Map

- [README.md](./README.md) is the documentation entry point.
- [CONTRIBUTING.md](./CONTRIBUTING.md) defines the human workflow.
- [docs/architecture.md](./docs/architecture.md) explains system boundaries.
- [docs/data-flow.md](./docs/data-flow.md) traces room, command, event, and reveal flows.
- [docs/rules-engine.md](./docs/rules-engine.md), [docs/realtime-server.md](./docs/realtime-server.md), and [docs/web-client.md](./docs/web-client.md) cover the main implementation surfaces.
