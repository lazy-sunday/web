# Realtime Server

The realtime server is in `apps/server`. It is a Node HTTP server plus a WebSocket server using `ws`.

The server owns network identity, room lifecycle, host controls, timers, reconnection, slap rate limiting, and per-player event routing. The engine owns rule legality and state transitions.

## Entrypoint

`src/main.ts` starts the process.

Endpoints:

- `POST /rooms`: creates an in-memory room and returns `{ "code": "ABC234" }`. An optional JSON body `{ "deckCount": 1 | 2 | 3 }` selects the room's deck count; omitted means 1.
- `GET /health`: returns `{ "ok": true, "rooms": number }`.
- WebSocket upgrade on the same HTTP server for all realtime messages.

The port is read from `PORT` and defaults to `8787`.

## Room Registry

`src/rooms.ts` stores rooms in a module-level `Map`.

A room contains:

- A six-character unambiguous room code.
- Lobby status: `lobby`, `playing`, or `between-rounds`.
- Players, seats, display names, colors, host flag, sockets, and reconnection tokens.
- Host-controlled toggles.
- Optional `SessionState` and current authoritative `RoundState`.
- Timers and the current turn deadline.
- Empty-room timestamps for garbage collection.

Rooms are process-local. Multiple server replicas would split rooms unless a shared store is introduced.

## Protocol

`src/protocol.ts` defines the JSON messages.

Client messages include:

- `join`
- `setToggle`
- `startGame`
- `command`
- `nextRound`
- `reaction`
- `ping`

Server messages include:

- `joined`
- `lobby`
- `view`
- `turnTimer`
- `event`
- `sessionEvent`
- `reaction`
- `error`
- `pong`

`parseClientMessage` is intentionally a shallow structural gate. Deep rule validation stays in the engine.

## Join and Reconnection

When a player joins a lobby, the server creates:

- A stable player id for this room.
- A secret reconnection token.
- A seat number.
- A host flag for the first player.

The token is sent only to that player's socket. If the client later reconnects with the same token, the server reattaches the new socket to the same seat and sends the current redacted view and remaining timer duration.

If the host disconnects for more than five minutes, `maybeReassignHost` can move the host flag to the first connected player in seat order.

## Starting and Advancing Rounds

Only the host can start the game or deal the next round.

The host can change `toggles.deckCount` while the room is in `lobby`. The value is broadcast in every `lobby` message, locks when the first round starts, and is passed to every subsequent `createRound` call in the match.

Starting creates a session with the current seat order and lobby toggles. Each round:

- Increments `roundNumber`.
- Creates a new engine `RoundState`.
- Rotates the starting seat with `startingSeatForRound`.
- Broadcasts lobby state and per-player views.
- Resets timers.

When the engine emits `roundRevealed`, the server applies round scores to the session, switches to `between-rounds`, broadcasts session events, updates lobby standings, and waits for the host to start the next round.

## Command Handling

`gameRoom.ts` handles commands with a strict identity rule: the server discards any client-supplied `player` field and stamps the command with the socket's player id.

Flow:

1. Receive `ClientMessage`.
2. Reject if the player is not joined or the room is not in the right status.
3. Rate-limit `slap` commands before forwarding.
4. Stamp the trusted player id.
5. Call `applyCommand(room.round, command)`.
6. Commit returned state on success.
7. Route events with `eventVisibleTo`.
8. Broadcast a fresh `viewFor` to each connected player.
9. Reset timers.

All of this is synchronous. That is important for slap arbitration because messages are handled one at a time on the Node event loop.

## Timers

The server tracks who the round is currently blocked on:

- Every unpeeked player during setup.
- The current player during `turn` or `drawn`.
- The pending action actor.
- The pending gift giver.

When a timer fires, the server sends engine command `forceSkipTurn`. The engine decides the proper timeout behavior: forfeit setup peek, discard drawn card, cancel action, give lowest-slot gift, or skip the turn.

Clients receive `turnTimer` with a remaining duration, not an absolute server timestamp. The browser converts it into a local deadline.

## Reactions

Emoji reactions are non-authoritative. The client politely limits outgoing reactions to one per second. The server simply broadcasts them to connected players.

## Safety Notes

- Never send `room.round` directly.
- Never trust a player id from a client command.
- Keep command application synchronous unless slap arbitration is redesigned.
- Keep private event routing based on `eventVisibleTo`.

See [End-to-end data flow](./data-flow.md) for message examples and [Testing and verification](./testing.md) for scripted checks.
