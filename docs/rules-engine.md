# Rules Engine

The rules engine is in `packages/engine`. It is the authority for game rules, legal commands, state transitions, event generation, visibility helpers, and session scoring.

The engine implements [lazy-sunday-rules-v1.md](../lazy-sunday-rules-v1.md). Section 9 is treated as the edge-case spec.

## Public API

The engine exports from `src/index.ts`. The core entry points are:

- `createRound(config)`: creates a new shuffled round. `config.deckCount` may select 1–3 complete standard decks; omitted means 1.
- `applyCommand(state, command)`: applies one player or server command and returns either a new state plus events or a typed error.
- `viewFor(state, playerId)`: builds a redacted `RoundView` for one player.
- `eventVisibleTo(event, playerId)`: says whether one player may receive an event.
- `createSession(players, options)`: creates cumulative match scoring state.
- `applyRoundScores(session, roundScores)`: applies revealed round scores to the session.
- `standings(session)`: returns lowest-score-first standings.

## State Model

`RoundState` tracks:

- Player order and each player's face-down list.
- Deck and DONE pile, with the top card represented by the last array element.
- Current phase: `setupPeek`, `turn`, `drawn`, `action`, or `reveal`.
- Current turn index.
- A private drawn card during `drawn`.
- Pending action or pending gift obligations.
- Caller and final-turn queue after "NOT ME!".
- Revealed result.
- RNG state for deterministic reshuffles and testability.
- `instantNotMe`, the optional house-rule toggle.

Multi-deck rounds are an explicit house-rule variant. Each selected deck is a complete copy of the standard 54-card composition; per-player list size and all gameplay rules remain unchanged. The immutable rules file continues to describe the default one-deck game.

The engine clones input state inside `applyCommand`, mutates the clone, and returns it. Callers should always replace their stored state with the returned state on success.

## Commands

Commands are typed in `src/types.ts`. They include:

- Setup: `setupPeek`.
- Ordinary turn actions: `draw`, `keepDrawn`, `discardDrawn`, `takeFromDone`.
- Action resolution: `actionInput`, `knockItOutDecision`, `cancelAction`.
- Round-ending call: `callNotMe`.
- Quick discard: `slap`, followed by `giveCard` when an opponent slap creates a gift obligation.
- Server timeout command: `forceSkipTurn`.

Clients are not allowed to send `forceSkipTurn`; the server owns it.

## Events

Events are also typed in `src/types.ts`. Some are private:

- `peek`: sent only to the addressed player.
- `drawnCard`: sent only to the drawing player.

Most events are public because they represent visible table actions, public card movement, or reveal. Public events may contain card identities only when the rules make that identity visible, such as discarded cards, slap outcomes, Knock It Out self-discards, or final reveal.

## Visibility

`src/view.ts` is the visibility boundary. It exposes:

- `RoundView`, which contains phase, current player, caller, deck and DONE counts, DONE top, list sizes, pending public action metadata, pending gift participants, and reveal results.
- `viewFor`, which omits face-down card identities and stable ids.
- `eventVisibleTo`, which routes private events by explicit allowlist.

Do not add another serialization path for round state.

## Important Rule Flows

### Setup Peek

Each player may reveal up to two different cards from their own list during one setup window. Each valid slot command emits a private one-card `peek` event and records that slot so duplicate or third selections are rejected. The server ends the window with `forceSkipTurn`; the engine then emits the public `setupPeeked` event. The round enters `turn` only after every player's window has ended or been forfeited.

### Draw and DONE Pile

On turn, a player can draw from the deck, take the DONE top, or call "NOT ME!". A drawn card is private until kept or discarded. Taking from DONE always swaps with an existing card and never triggers an action.

When an ordinary draw, Landlord's Notice, or a wrong-slap penalty consumes the
last deck card, the engine immediately shuffles the DONE pile except its current
top into a new deck and emits `deckReshuffled`. If the DONE pile contains only
its top at that moment, the deck remains empty until resolving the drawn card or
another discard creates a recyclable card; the engine then reshuffles without
requiring another draw attempt. The reshuffle never exposes face-down card
identities.

### Actions

Actions trigger only when an action card is drawn from the deck and discarded with action. Replaced cards, DONE-pile cards, slaps, and Knock It Out self-discards do not chain-trigger actions.

The engine validates all targets. UI metadata in `apps/web/lib/actionMeta.ts` only disables impossible taps for user experience.

### "Done It!" Slaps

Slaps are allowed during `turn` and `drawn`, but not during `action`. Correct own-card slaps shrink the slapper's list. Correct opponent-card slaps expose the opponent's card, then create `pendingGift` until the slapper gives one own card face-down. Wrong slaps leave the owner card in place and draw an unseen penalty card for the slapper when possible.

`expectedTopId` lets the engine distinguish a late slap against an old DONE top from a wrong slap against the current top.

### "NOT ME!"

The caller may call only at the start of their turn. Official rules queue one final turn for every other player in seat order. During final turns, the caller's list is locked against specific actions and opponent slaps. The optional `instantNotMe` toggle reveals immediately instead.

At reveal, lists become public, totals are counted, and scores are produced. Ties go to the caller.

### Session Scoring

`src/session.ts` applies round scores to cumulative session state. `greatEscape` resets exactly 100 to 50 before `matchTo100` checks whether anyone crossed 100.

## Tests

Tests live in `packages/engine/test`. They cover deck setup, visibility, actions, turns, slaps, session scoring, and "NOT ME!" scoring. Engine behavior changes should include tests that prove the rule and privacy behavior.

See [Testing and verification](./testing.md).
