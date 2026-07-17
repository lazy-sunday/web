import { describe, expect, it } from 'vitest';
import { buildDeck, CARD_SPECS, MAX_DECK_COUNT, MIN_DECK_COUNT } from '../src/cards.js';
import { SETUP_PEEK_MS } from '../src/index.js';
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
    for (const p of s.players) {
      expect(p.list).toHaveLength(6);
      expect(p.setupPeekSlots).toEqual([]);
    }
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

  it('exports the setup peek duration for timer coordination', () => {
    expect(SETUP_PEEK_MS).toBe(10_000);
  });

  it('reveals and records one chosen card per command without ending the window', () => {
    const s = fresh();
    const first = ok(applyCommand(s, { type: 'setupPeek', player: 'a', slot: 0 }));
    const firstPeek = evt(first.events, 'peek');
    expect(firstPeek).toMatchObject({ to: 'a', reason: 'setup' });
    expect(firstPeek.reveals.map((x) => x.slot)).toEqual([0]);
    expect(firstPeek.reveals[0]!.card).toEqual(s.players[0]!.list[0]);
    expect(first.state.players[0]!.setupPeekSlots).toEqual([0]);
    expect(first.state.players[0]!.setupPeeked).toBe(false);
    expect(first.state.phase).toBe('setupPeek');
    expect(evts(first.events, 'setupPeeked')).toHaveLength(0);
    expect(s.players[0]!.setupPeekSlots).toEqual([]);

    const second = ok(applyCommand(first.state, { type: 'setupPeek', player: 'a', slot: 3 }));
    expect(evt(second.events, 'peek').reveals.map((x) => x.slot)).toEqual([3]);
    expect(second.state.players[0]!.setupPeekSlots).toEqual([0, 3]);
    expect(second.state.players[0]!.setupPeeked).toBe(false);
    expect(second.state.phase).toBe('setupPeek');
  });

  it('rejects an invalid slot, a duplicate selection, and a third selection', () => {
    expect(err(applyCommand(fresh(), { type: 'setupPeek', player: 'a', slot: 6 })).code)
      .toBe('invalidSlot');

    const first = ok(applyCommand(fresh(), { type: 'setupPeek', player: 'a', slot: 2 }));
    expect(err(applyCommand(first.state, { type: 'setupPeek', player: 'a', slot: 2 })).code)
      .toBe('invalidSlot');

    const second = ok(applyCommand(first.state, { type: 'setupPeek', player: 'a', slot: 4 }));
    expect(err(applyCommand(second.state, { type: 'setupPeek', player: 'a', slot: 1 })).code)
      .toBe('alreadyPeeked');
  });

  it('starts the first turn only after every setup window has ended', () => {
    const a1 = ok(applyCommand(fresh(), { type: 'setupPeek', player: 'a', slot: 0 }));
    const a2 = ok(applyCommand(a1.state, { type: 'setupPeek', player: 'a', slot: 1 }));
    const aDone = ok(applyCommand(a2.state, { type: 'forceSkipTurn', player: 'a' }));
    expect(aDone.state.phase).toBe('setupPeek');
    expect(evt(aDone.events, 'setupPeeked').player).toBe('a');

    const b1 = ok(applyCommand(aDone.state, { type: 'setupPeek', player: 'b', slot: 4 }));
    const b2 = ok(applyCommand(b1.state, { type: 'setupPeek', player: 'b', slot: 5 }));
    expect(b2.state.phase).toBe('setupPeek');
    expect(evts(b2.events, 'turnStarted')).toHaveLength(0);
    expect(evt(b2.events, 'peek')).toMatchObject({ to: 'b', reason: 'setup' });

    const bDone = ok(applyCommand(b2.state, { type: 'forceSkipTurn', player: 'b' }));
    expect(bDone.state.phase).toBe('turn');
    expect(evt(bDone.events, 'setupPeeked').player).toBe('b');
    expect(evt(bDone.events, 'turnStarted').player).toBe('b'); // startingPlayer: 1
  });

  it('no turn actions are allowed during setup peek', () => {
    expect(err(applyCommand(fresh(), { type: 'draw', player: 'b' })).code).toBe('wrongPhase');
    expect(err(applyCommand(fresh(), { type: 'callNotMe', player: 'b' })).code).toBe('wrongPhase');
  });

  it('a timed-out setup peek is forfeited via forceSkipTurn', () => {
    const r1 = ok(applyCommand(fresh(), { type: 'forceSkipTurn', player: 'a' }));
    expect(evts(r1.events, 'peek')).toHaveLength(0);
    // the forfeit is permanent
    expect(err(applyCommand(r1.state, { type: 'setupPeek', player: 'a', slot: 0 })).code)
      .toBe('alreadyPeeked');

    const b1 = ok(applyCommand(r1.state, { type: 'setupPeek', player: 'b', slot: 0 }));
    const bDone = ok(applyCommand(b1.state, { type: 'forceSkipTurn', player: 'b' }));
    expect(bDone.state.phase).toBe('turn');
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

  it('exposes selected setup slots only to the player who selected them', () => {
    const s = createRound({ players: ['a', 'b'], startingPlayer: 0, seed: 9 });
    const aSelected = ok(applyCommand(s, { type: 'setupPeek', player: 'a', slot: 2 })).state;
    const bothSelected = ok(applyCommand(aSelected, { type: 'setupPeek', player: 'b', slot: 4 })).state;

    expect(viewFor(bothSelected, 'a').mySetupPeekSlots).toEqual([2]);
    expect(viewFor(bothSelected, 'b').mySetupPeekSlots).toEqual([4]);
    expect(viewFor(bothSelected, 'unknown').mySetupPeekSlots).toEqual([]);
    expect(viewFor(bothSelected, 'a').players.every((p) => !('setupPeekSlots' in p))).toBe(true);
  });

  it('shows the drawn card only to the player who drew it', () => {
    const s = createRound({ players: ['a', 'b'], startingPlayer: 0, seed: 9 });
    const a1 = ok(applyCommand(s, { type: 'setupPeek', player: 'a', slot: 0 })).state;
    const a2 = ok(applyCommand(a1, { type: 'setupPeek', player: 'a', slot: 1 })).state;
    const aDone = ok(applyCommand(a2, { type: 'forceSkipTurn', player: 'a' })).state;
    const b1 = ok(applyCommand(aDone, { type: 'setupPeek', player: 'b', slot: 0 })).state;
    const b2 = ok(applyCommand(b1, { type: 'setupPeek', player: 'b', slot: 1 })).state;
    const ready = ok(applyCommand(b2, { type: 'forceSkipTurn', player: 'b' })).state;
    const drawn = ok(applyCommand(ready, { type: 'draw', player: 'a' })).state;
    expect(viewFor(drawn, 'a').myDrawnCard).toEqual(drawn.drawnCard);
    expect(viewFor(drawn, 'b').myDrawnCard).toBeNull();
    expect(JSON.stringify(viewFor(drawn, 'b'))).not.toContain(drawn.drawnCard!.id);
  });
});
