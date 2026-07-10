# Contributing

This project follows an issue-first workflow for every feature, bugfix, documentation change, and agentic coding task.

## Required Workflow

1. Create a GitHub issue before implementation begins.
2. Define the task scope and Definition of Done in the issue.
3. Get approval for the scope when the work was requested with an approval gate.
4. Create a new branch from `main`.
5. Make meaningful, unit-sized commits on that branch.
6. Run the appropriate verification checks.
7. Open a pull request back to `main`.

Use branch names that say what changed, for example `docs/issue-1-app-documentation` or `fix/visibility-redaction`.

## Local Setup

Install dependencies:

```sh
npm install
```

Run the server:

```sh
npm run dev:server
```

Run the web client:

```sh
npm run dev:web
```

Run tests:

```sh
npm test
```

The web client defaults to `ws://localhost:8787`. To point it at another server, set `NEXT_PUBLIC_WS_URL`.

## Pull Request Expectations

Every PR should include:

- A link to the issue it closes or advances.
- A short summary of the behavior or documentation changed.
- The verification commands run and their result.
- Screenshots or short clips for visible UI changes.
- Any known limitations or follow-up issues.

Keep commits focused. A good commit should be reviewable on its own and should not mix unrelated behavior, formatting, and documentation churn.

## Rule and Privacy Invariants

The rules source of truth is [lazy-sunday-rules-v1.md](./lazy-sunday-rules-v1.md). Section 9 is especially important because it doubles as the edge-case spec for the engine.

Do not:

- Serialize raw `RoundState` to clients.
- Add a protocol field that exposes face-down card identity or stable face-down card ids.
- Recreate game rules in the server or client when the engine should own them.
- Let client-supplied player ids override the socket identity.
- Treat UI-side action metadata as authoritative.

Do:

- Use `viewFor` and `eventVisibleTo` from the engine for visibility boundaries.
- Route private `peek` and `drawnCard` events only to their addressed player.
- Add or update engine tests for rule behavior.
- Keep rule comments close to tricky implementation code.

## Documentation Changes

Documentation should be precise enough for a new contributor to move safely through the codebase. When code behavior changes, update the relevant doc in `docs/` and keep links from [README.md](./README.md) valid.

For agent-facing expectations, update both [AGENTS.md](./AGENTS.md) and [CLAUDE.md](./CLAUDE.md) when the guidance applies to all coding agents.
