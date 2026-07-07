# Testing and Verification

The project has three layers of verification: engine unit tests, scripted server/client playtests, and manual browser playtesting.

## Main Commands

From the repository root:

```sh
npm test
```

Runs the engine Vitest suite through the root workspace script.

```sh
npm run playtest
```

Runs `apps/server/scripts/playtest-e2e.ts`, which can spawn a server and drive a real three-player game through the public protocol.

Package-level commands:

```sh
npm run typecheck -w @lazy-sunday/engine
npm run typecheck -w @lazy-sunday/server
npm run typecheck -w @lazy-sunday/web
npm run build -w @lazy-sunday/web
```

## Engine Unit Tests

Engine tests live in `packages/engine/test`.

Current areas:

- `deck-setup.test.ts`: deck composition and setup.
- `turns.test.ts`: ordinary turn flow.
- `actions.test.ts`: action card behavior.
- `slaps.test.ts`: "Done it!" quick discard rules.
- `visibility.test.ts`: redaction and event visibility.
- `session.test.ts`: cumulative scoring options.
- `notme-scoring.test.ts`: caller scoring branches.
- `helpers.ts`: shared test helpers.

Run these for any engine, rule, type, or visibility change.

## Scripted Server Checks

`apps/server/scripts/verify-client.ts` creates a room, joins three fake players, starts a game, performs setup peeks and turns, tests reconnect, exercises slap rate limits, and audits every message for hidden card leaks.

Typical use:

```sh
PORT=8790 npm run dev -w @lazy-sunday/server
npx tsx apps/server/scripts/verify-client.ts
```

`apps/server/scripts/playtest-e2e.ts` is a broader automated playtest. By default it spawns its own server on `PORT` or `8791`. Set `SERVER_URL` to use an already-running server.

```sh
npx tsx apps/server/scripts/playtest-e2e.ts
```

## Manual Playtest

Use [playtest-checklist.md](./playtest-checklist.md) for a three-player manual test. It covers setup peek, ordinary turns, targeting constraints, Knock It Out, slap arbitration, gift flow, "I'm Busy" final-turn behavior, caller lock, deck exhaustion, empty lists, scoring, and reconnect behavior.

## Documentation Verification

For documentation-only changes:

- Check that every root README link points to an existing file.
- Check that every new docs link points to an existing file or anchor.
- Run `npm test` when dependencies are available, because docs in this project describe important invariants and should not drift from the engine.

## Recommended Checks by Change Type

- Engine rules: `npm test` and `npm run typecheck -w @lazy-sunday/engine`.
- Protocol/server: `npm test`, `npm run typecheck -w @lazy-sunday/server`, and one scripted server check.
- Web client: `npm run typecheck -w @lazy-sunday/web`; use `npm run build -w @lazy-sunday/web` before release.
- Full-stack behavior: server and web dev servers plus the manual checklist.
- Agent/workflow docs: link sanity check and a quick read against `AGENTS.md`, `CLAUDE.md`, and `CONTRIBUTING.md`.

Always report skipped checks in the PR.
