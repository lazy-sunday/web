# Architecture Overview

LAZY SUNDAY is organized as an npm workspace with three runtime surfaces:

- `packages/engine`: pure rule engine and visibility model.
- `apps/server`: authoritative realtime Node server.
- `apps/web`: Next.js browser client.

The most important architectural rule is separation of authority. The engine decides what happened. The server decides who is connected and who may see which engine output. The client decides how to present the allowed information.

## System Diagram

```mermaid
flowchart LR
  Browser["Next.js web client"] -->|HTTP POST /rooms| Server["Node HTTP + WebSocket server"]
  Browser -->|JSON WebSocket messages| Server
  Server -->|Command| Engine["Pure engine reducer"]
  Engine -->|RoundState + EngineEvent[]| Server
  Server -->|RoundView per player| Browser
  Server -->|Filtered EngineEvent| Browser
```

## Package Responsibilities

### `packages/engine`

The engine defines cards, round state, commands, events, redacted views, and cumulative session scoring.

Key files:

- `src/cards.ts`: deck specification, card names, effort values, and asset names.
- `src/types.ts`: state, command, event, error, and session types.
- `src/round.ts`: pure reducer via `createRound` and `applyCommand`.
- `src/view.ts`: per-player redaction via `viewFor` and event filtering via `eventVisibleTo`.
- `src/session.ts`: cumulative scoring, Match to 100, Great Escape, and standings.
- `src/rng.ts`: deterministic PRNG and shuffle helpers.

The engine has no WebSocket, DOM, database, or timer dependency. This makes rules testable and keeps the server/client from becoming hidden sources of game truth.

### `apps/server`

The server is the authoritative multiplayer adapter. It stores in-memory rooms and owns all network identity.

Key files:

- `src/main.ts`: HTTP server, `POST /rooms`, `GET /health`, WebSocket upgrade.
- `src/protocol.ts`: JSON protocol types and shallow client-message parser.
- `src/rooms.ts`: in-memory room registry, room codes, tokens, host reassignment, room GC.
- `src/gameRoom.ts`: WebSocket connection lifecycle, command stamping, event routing, timers, scoring handoff.

The server never trusts a client-supplied player id. It stamps commands with the player attached to the socket.

### `apps/web`

The web app renders the game and sends protocol messages. It does not own rules.

Key files:

- `app/page.tsx`: landing page, room creation, join-by-code.
- `app/r/[code]/page.tsx`: room route.
- `components/RoomClient.tsx`: join form, lobby, and table state switch.
- `components/GameTable.tsx`: main play surface.
- `components/ActionModal.tsx`: guided action input wizard.
- `lib/useGameSocket.ts`: WebSocket state, reconnection identity, event logs, reactions, and timers.
- `lib/usePeeks.ts`: temporary local display of private peek events.
- `lib/actionMeta.ts`: UI-only action flow metadata.

## Runtime Model

Rooms are in memory. There is no database and no cross-process room sharing. A process restart drops active rooms, though the client has reconnection tokens for socket reconnects while the process is alive.

The server has one Node event loop and applies each socket message synchronously. That matters for "Done it!" slap arbitration: the first message handler that commits a matching slap changes the DONE top before later slap messages are processed.

## Privacy Boundary

Raw `RoundState` contains the full deck, all face-down cards, RNG state, pending gifts, and private action details. It must never leave the server.

The only safe state for a client is:

- That player's own `RoundView` from `viewFor`.
- Public engine events.
- Private engine events only when `eventVisibleTo` says they are visible to that player.

See [End-to-end data flow](./data-flow.md) for the exact command and event lifecycle.

## Related Docs

- [Rules engine](./rules-engine.md)
- [Realtime server](./realtime-server.md)
- [Web client](./web-client.md)
- [Testing and verification](./testing.md)
