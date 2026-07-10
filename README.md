# LAZY SUNDAY Webapp

LAZY SUNDAY is a realtime multiplayer web implementation of the LAZY SUNDAY card game. The app is a TypeScript npm workspace with a pure game engine, an authoritative WebSocket server, and a Next.js client.

The game rules live in [lazy-sunday-rules-v1.md](./lazy-sunday-rules-v1.md). Treat that file as the product and engine source of truth. Code and documentation should explain how the app implements those rules, not reinterpret them.

## Quick Start

Install dependencies from the repository root:

```sh
npm install
```

Run the authoritative game server:

```sh
npm run dev:server
```

Run the web client in a second terminal:

```sh
npm run dev:web
```

By default the server listens on `http://localhost:8787` and `ws://localhost:8787`. The web app reads `NEXT_PUBLIC_WS_URL` and falls back to `ws://localhost:8787`.

Run the engine test suite:

```sh
npm test
```

## Documentation

Start here when onboarding to the app:

- [Contribution guidelines](./CONTRIBUTING.md)
- [Agent instructions for Codex and coding agents](./AGENTS.md)
- [Claude agent instructions](./CLAUDE.md)
- [Architecture overview](./docs/architecture.md)
- [Rules engine](./docs/rules-engine.md)
- [Realtime server](./docs/realtime-server.md)
- [Web client](./docs/web-client.md)
- [End-to-end data flow](./docs/data-flow.md)
- [Testing and verification](./docs/testing.md)
- [Deployment and configuration](./docs/deployment.md)
- [Manual playtest checklist](./docs/playtest-checklist.md)

## Workspace Layout

```text
.
├── apps/
│   ├── server/          # Node HTTP + WebSocket authoritative server
│   └── web/             # Next.js app router client
├── packages/
│   └── engine/          # Pure TypeScript game rules engine
├── docs/                # Architecture, workflow, testing, and deployment docs
├── lazy-sunday-rules-v1.md
├── CLAUDE.md
└── AGENTS.md
```

The engine owns all game truth. The server owns rooms, sockets, timers, reconnection, and event routing. The web client renders only its own redacted view plus events the server is allowed to send to that player.

## Core Invariants

- Never send raw `RoundState` to a client.
- Face-down card identities stay server-side except for explicit `peek` and `drawnCard` grants to one player.
- Redacted views must come from `packages/engine/src/view.ts`.
- Actions trigger only when an action card is drawn from the deck and discarded with action.
- Slap arbitration is server arrival order, enforced by synchronous command application.
- When changing rules behavior, update or add engine tests and quote the rules spec where the edge case is subtle.

## Main Scripts

- `npm test` - run the engine Vitest suite.
- `npm run dev:server` - start the WebSocket server with watch mode.
- `npm run dev:web` - start the Next.js web client.
- `npm run playtest` - run the automated WebSocket playtest script.

Package-level scripts also exist for typechecking and production builds. See [Testing and verification](./docs/testing.md) for the recommended checks.
