import { describe, expect, it } from 'vitest';
import { buildDeck, CARD_SPECS, MAX_DECK_COUNT, MIN_DECK_COUNT } from '../src/cards.js';
import { createRound, applyCommand } from '../src/round.js';
import { viewFor } from '../src/view.js';
import { err, evt, evts, ok } from './helpers.js';

describe('deck composition (§2)', () => {
  it('has exactly 54 cards', () => {
    expect(buildDeck()).toHaveLength(54);
  });

  it('has the exact copy counts and effort values from §2', () => {
    const deck = buildDeck();
    const expected: [string, number, number][] = [
      ['Nap', 0, 2],
      ['Feed the Cat', 2, 4],
      ['Water the Plants', 3, 4],
      ['Take Out the Trash', 4, 4],
      ['Fold the Laundry', 5, 4],
      ['Vacuum the Living Room', 6, 4],
      ["I'm Busy", 1, 4],
      ['Check the List', 7, 4],
      ['Knock It Out', 8, 4],
      ["Let's Trade", 9, 4],
      ['Switcheroo', 10, 4],
      ['Snoop', 11, 4],
      ["Not My Job", 12, 4],
      ["Landlord's Notice", 13, 4],
    ];
    for (const [name, effort, copies] of expected) {
      const matching = deck.filter((c) => c.name === name);
      expect(matching, name).toHaveLength(copies);
      for (const c of matching) expect(c.effort, name).toBe(effort);
    }
  });

  it('gives every physical card a unique id', () => {
    const ids = buildDeck().map((c) => c.id);
    expect(new Set(ids).size).toBe(54);
  });

  it('scales every card copy across multiple decks and keeps ids unique', () => {
    const deck = buildDeck(2);
    expect(deck).toHaveLength(108);
    expect(new Set(deck.map((c) => c.id)).size).toBe(108);
    expect(deck.filter((c) => c.name === 'Nap')).toHaveLength(4);
    expect(deck.filter((c) => c.name === 'Check the List')).toHaveLength(8);
  });

  it('rejects deck counts outside the supported house-rule range', () => {
    expect(() => buildDeck(MIN_DECK_COUNT - 1)).toThrow();
    expect(() => buildDeck(MAX_DECK_COUNT + 1)).toThrow();
    expect(() => buildDeck(1.5)).toThrow();
  });

  it('marks chores and actions correctly', () => {
    for (const spec of CARD_SPECS) {
      const isAction = [
        "I'm Busy", 'Check the List', 'Knock It Out', "Let's Trade",
        'Switcheroo', 'Snoop', "Not My Job", "Landlord's Notice",
      ].includes(spec.name);
      expect(spec.kind).toBe(isAction ? 'action' : 'chore');
    }
  });
});

describe('createRound / dealing (§3)', () => {
  it('deals 6 face-down cards each and flips one to start DONE', () => {
    const s = createRound({ players: ['a', 'b', 'c'], startingPlayer: 0, seed: 7 });
    for (const p of s.players) expect(p.list).toHaveLength(6);
    expect(s.done).toHaveLength(1);
    expect(s.deck).toHaveLength(54 - 18 - 1);
    expect(s.phase).toBe('setupPeek');
  });

  it('deals from the configured number of complete decks', () => {
    const s = createRound({ players: ['a', 'b', 'c'], startingPlayer: 0, seed: 7, deckCount: 2 });
    expect(s.deck).toHaveLength(108 - 18 - 1);
    expect(new Set([
      ...s.deck.map((c) => c.id),
      ...s.done.map((c) => c.id),
      ...s.players.flatMap((p) => p.list.map((c) => c.id)),
    ]).size).toBe(108);
  });

  it('supports 2 and 7 players, rejects 1 and 8', () => {
    expect(() => createRound({ players: ['a', 'b'], startingPlayer: 0, seed: 1 })).not.toThrow();
    const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(() => createRound({ players: seven, startingPlayer: 6, seed: 1 })).not.toThrow();
    expect(() => createRound({ players: ['a'], startingPlayer: 0, seed: 1 })).toThrow();
    expect(() => createRound({ players: [...seven, 'h'], startingPlayer: 0, seed: 1 })).toThrow();
  });

  it('is deterministic for a given seed', () => {
    const s1 = createRound({ players: ['a', 'b'], startingPlayer: 0, seed: 42 });
    const s2 = createRound({ players: ['a', 'b'], startingPlayer: 0, seed: 42 });
    expect(s1).toEqual(s2);
    const s3 = createRound({ players: ['a', 'b'], startingPlayer: 0, seed: 43 });
    expect(s3.players[0]!.list.map((c) => c.id)).not.toEqual(s1.players[0]!.list.map((c) => c.id));
  });
});

describe('setup peek (§3.3)', () => {
  const fresh = () => createRound({ players: ['a', 'b'], startingPlayer: 1, seed: 5 });

  it('reveals exactly the two chosen cards, privately, once', () => {
    const s = fresh();
    const r = ok(applyCommand(s, { type: 'setupPeek', player: 'a', slots: [0, 3] }));
    const peek = evt(r.events, 'peek');
    expect(peek.to).toBe('a');
    // §3.3 setup peek carries its own reason so the client can time the long
    // 10s reveal from the event, not from a view phase that may already have
    // advanced to `turn` for the last player to confirm (issue #28).
    expect(peek.reason).toBe('setup');
    expect(peek.reveals.map((x) => x.slot)).toEqual([0, 3]);
    expect(peek.reveals[0]!.card).toEqual(s.players[0]!.list[0]);
    // once, and never again
    expect(err(applyCommand(r.state, { type: 'setupPeek', player: 'a', slots: [1, 2] })).code)
      .toBe('alreadyPeeked');
  });

  it('rejects peeking the same slot twice', () => {
    expect(err(applyCommand(fresh(), { type: 'setupPeek', player: 'a', slots: [2, 2] })).code)
      .toBe('invalidSlot');
  });

  it('starts the first turn (with the configured starting player) once all have peeked', () => {
    const r1 = ok(applyCommand(fresh(), { type: 'setupPeek', player: 'a', slots: [0, 1] }));
    expect(r1.state.phase).toBe('setupPeek');
    const r2 = ok(applyCommand(r1.state, { type: 'setupPeek', player: 'b', slots: [4, 5] }));
    expect(r2.state.phase).toBe('turn');
    expect(evt(r2.events, 'turnStarted').player).toBe('b'); // startingPlayer: 1
  });

  it('the LAST player to confirm still gets a setup-reason peek in the same batch that advances to `turn` (issue #28)', () => {
    const r1 = ok(applyCommand(fresh(), { type: 'setupPeek', player: 'a', slots: [0, 1] }));
    const r2 = ok(applyCommand(r1.state, { type: 'setupPeek', player: 'b', slots: [4, 5] }));
    // This single command emits the peek AND flips the phase to `turn`. The peek
    // must still be tagged `setup` so the client times the full 10s reveal — the
    // phase is not a reliable signal here.
    expect(r2.state.phase).toBe('turn');
    const peek = evt(r2.events, 'peek');
    expect(peek.to).toBe('b');
    expect(peek.reason).toBe('setup');
  });

  it('no turn actions are allowed during setup peek', () => {
    expect(err(applyCommand(fresh(), { type: 'draw', player: 'b' })).code).toBe('wrongPhase');
    expect(err(applyCommand(fresh(), { type: 'callNotMe', player: 'b' })).code).toBe('wrongPhase');
  });

  it('a timed-out setup peek is forfeited via forceSkipTurn', () => {
    const r1 = ok(applyCommand(fresh(), { type: 'forceSkipTurn', player: 'a' }));
    expect(evts(r1.events, 'peek')).toHaveLength(0);
    const r2 = ok(applyCommand(r1.state, { type: 'setupPeek', player: 'b', slots: [0, 1] }));
    expect(r2.state.phase).toBe('turn');
    // the forfeit is permanent
    expect(err(applyCommand(r2.state, { type: 'setupPeek', player: 'a', slots: [0, 1] })).code)
      .toBe('wrongPhase');
  });
});

describe('view redaction', () => {
  it('never exposes face-down identities, only counts + public info', () => {
    const s = createRound({ players: ['a', 'b', 'c'], startingPlayer: 0, seed: 9 });
    const view = viewFor(s, 'a');
    const json = JSON.stringify(view);
    // The only card identity in a pre-reveal view is the DONE top (and a drawn card).
    for (const p of s.players) {
      for (const card of p.list) {
        expect(json).not.toContain(card.id);
      }
    }
    expect(view.doneTop!.id).toBe(s.done[0]!.id);
    expect(view.players.map((p) => p.listSize)).toEqual([6, 6, 6]);
    expect(view.players.map((p) => p.listSlots)).toEqual([
      [true, true, true, true, true, true],
      [true, true, true, true, true, true],
      [true, true, true, true, true, true],
    ]);
    expect(view.myDrawnCard).toBeNull();
  });

  it('shows the drawn card only to the player who drew it', () => {
    const s = createRound({ players: ['a', 'b'], startingPlayer: 0, seed: 9 });
    const ready = ok(applyCommand(
      ok(applyCommand(s, { type: 'setupPeek', player: 'a', slots: [0, 1] })).state,
      { type: 'setupPeek', player: 'b', slots: [0, 1] },
    )).state;
    const drawn = ok(applyCommand(ready, { type: 'draw', player: 'a' })).state;
    expect(viewFor(drawn, 'a').myDrawnCard).toEqual(drawn.drawnCard);
    expect(viewFor(drawn, 'b').myDrawnCard).toBeNull();
    expect(JSON.stringify(viewFor(drawn, 'b'))).not.toContain(drawn.drawnCard!.id);
  });
});
