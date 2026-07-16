# Web Client

The web client is a Next.js app in `apps/web`. It renders the game, stores local socket identity, remembers temporary peek events, and sends protocol messages to the server.

The client does not own game truth. It renders the `RoundView` and filtered events it receives.

## Routes

- `app/page.tsx`: landing page with room creation and join-by-code.
- `app/r/[code]/page.tsx`: uppercases the room code and renders `RoomClient`.
- `app/rules/page.tsx`: statically renders `lazy-sunday-rules-v1.md` through the small markdown renderer in `lib/markdown.ts`.

## Socket Hook

`lib/useGameSocket.ts` is the single WebSocket hook. It owns:

- Connection status.
- Stored identity in `localStorage`.
- Automatic rejoin with room code and token.
- Lobby state.
- Current `RoundView`.
- Engine event log.
- Session event log.
- Reaction log.
- Turn timer deadline.
- Last server error.
- `send`, `sendCommand`, and `sendReaction` helpers.

The hook caps event arrays to avoid unbounded browser memory growth.

## Room Client

`components/RoomClient.tsx` switches between three states:

- Join form when the browser is not seated.
- Lobby view when seated but not in an active round.
- Game table when seated and the room is playing or between rounds with a view.

The lobby handles host-only toggles, share-link copying, start game, next round, standings, match-over messaging, and connection indicators.

## Game Table

`components/GameTable.tsx` is the main play surface. It renders:

- Phase banner, current player, caller, recent activity, and timer.
- Setup peek panel.
- Opponent rows with list sizes and face-down cards.
- Center deck and DONE piles.
- The player's own row.
- Drawn-card controls.
- Slap layer.
- Guided action modal.
- Reveal screen.
- Reactions and sound controls.

The table sends high-level engine commands through `game.sendCommand`. It uses a small `inFlight` guard to avoid duplicate clicks until the next view update arrives.

## Action Modal

`components/ActionModal.tsx` drives pending actions from `view.pendingAction`.

For normal action inputs, it walks the UI metadata in `lib/actionMeta.ts` and sends one final `actionInput`. For Knock It Out, it handles the engine's two-step flow: first pick a slot to peek, then choose discard or keep when `pendingAction.step` becomes `knockItOutDecision`.

Important: `actionMeta.ts` is UI metadata only. The engine still validates every action target.

## Peek Memory

`lib/usePeeks.ts` builds temporary local memory from private `peek` events delivered to the current player. During setup, tapping a card sends its slot immediately. The first valid tap starts one 10-second window, and a second card selected during that window shares the original deadline. There is no confirmation step.

- Setup peeks display until the first tap's 10-second deadline.
- Granted peeks display for 4 seconds.
- Once the timer expires, the card face disappears from the UI.

Finishing a personal peek window does not move that player to the table. The setup panel remains in a waiting state until the server ends setup for the whole room.

This matches the game design: memory is the player's responsibility. The server does not resend old hidden knowledge on reconnect.

## Cards and Assets

Card SVGs live in `apps/web/public/cards`. The engine maps card names to SVG filenames in `packages/engine/src/cards.ts`.

`components/Card.tsx` renders card faces and card backs. Face-down cards should use the card-back asset unless a current allowed view or active peek event grants the face.

## Sound and Motion

Sound helpers live in:

- `lib/sound.ts`
- `lib/useSound.ts`
- `lib/useGameSounds.ts`

Motion sensitivity helpers live in `lib/useReducedMotion.ts`. Timer and count helpers live in `lib/useCountdown.ts` and `lib/useCountUp.ts`.

## Configuration

`lib/config.ts` reads:

- `NEXT_PUBLIC_WS_URL`, defaulting to `ws://localhost:8787`.

The HTTP URL is derived by replacing the `ws` scheme with `http`, so room creation and WebSocket traffic point at the same server origin.

## Client Safety Rules

- Do not store permanent card knowledge beyond what the UI intentionally remembers from events.
- Do not add client-only rule paths that can disagree with the engine.
- Do not render hidden card identities from raw protocol data unless the event/view context explicitly grants them.
- Keep action metadata aligned with engine targeting rules, but treat it as a UX helper only.

See [End-to-end data flow](./data-flow.md) for how the client participates in room, command, event, and reveal lifecycles.
