# LAZY SUNDAY — multiplayer webapp

**`lazy-sunday-rules-v1.md` (repo root) is the immutable spec.** Section 9 ("Edge Cases") is the rule-engine spec. Never invent, simplify, or reinterpret a rule — when in doubt, re-read the rules file and quote it in a comment next to the code that implements it.

## Layout

- `packages/engine` — pure, framework-free TypeScript rules engine + vitest suite. No I/O, no timers, injectable RNG. All game truth lives here.
- `apps/server` — Node + `ws` authoritative server: rooms, lobby, reconnection, slap arbitration (first event received wins), turn timeouts.
- `apps/web` — Next.js frontend. Card SVGs live in `apps/web/public/cards/` (14 faces, `15-card-back.svg`, `16-rules-card.svg`) — use as-is, never redraw.

## Invariants

- Face-down card identities are NEVER sent to any client except in the exact moment a rule grants that player a peek (setup peek of 2, Check the List, Knock It Out, Snoop). Peeks go only to the peeking player's socket. Redacted views come from `engine/src/view.ts` — never serialize raw `RoundState` to a client.
- Actions trigger ONLY on draw-then-discard. Never from the DONE pile, never on slapped cards, never on Knock It Out's self-discard.
- Visual system is locked (see `webapp-build-prompt.md` in the parent folder): chores = warm daylight `#F5A62B/#FFC95C/#47250F/#FFE9C2`, actions = night `#232E52/#8FA2DC/#101830/#FFE9B8`, table felt `#FFF6E8`, chrome `#EDEFE9`. Bookman-style display serif, Lato-class UI sans, geometric numerals, no italics. Effort values always show the underline mark.

## Commands

- `npm test` — engine test suite (vitest). Engine changes are not done until this is green.
- `npm run dev:server` / `npm run dev:web`
