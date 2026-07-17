import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/round.js';
import { viewFor } from '../src/view.js';
import { doneTop, drawAndPlayAction, err, evt, makeRound, ok, play, player } from './helpers.js';

// Default DONE top in these fixtures is Feed the Cat.
const base = () =>
  makeRound({
    players: [
      { id: 'a', list: ['Feed the Cat', 'Nap', 'Snoop'] },
      { id: 'b', list: ['Feed the Cat', 'Vacuum the Living Room'] },
      { id: 'c', list: ['Water the Plants'] },
    ],
    deck: ['Take Out the Trash', 'Fold the Laundry'],
    done: ['Feed the Cat'],
  });

describe('"Done it!" quick discard (§6)', () => {
  it('own card, correct: it stays discarded and the list shrinks by one', () => {
    const r = ok(applyCommand(base(), { type: 'slap', player: 'a', owner: 'a', slot: 0 }));
    expect(player(r.state, 'a').list.map((c) => c.name)).toEqual(['Nap', 'Snoop']);
    expect(player(r.state, 'a').slotPositions).toEqual([1, 2]);
    expect(viewFor(r.state, 'a').players.find((p) => p.id === 'a')!.listSlots).toEqual([false, true, true]);
    expect(doneTop(r.state).name).toBe('Feed the Cat');
    expect(r.state.done).toHaveLength(2);
    const e = evt(r.events, 'slapCorrect');
    expect(e.giftPending).toBe(false);
    expect(r.state.pendingGift).toBeNull();
  });

  it('own middle-slot correct slap leaves only that visual slot empty', () => {
    const s = makeRound({
      players: [
        { id: 'a', list: ['Nap', 'Feed the Cat', 'Snoop'] },
        { id: 'b', list: ['Water the Plants'] },
      ],
      done: ['Feed the Cat'],
    });
    const r = ok(applyCommand(s, { type: 'slap', player: 'a', owner: 'a', slot: 1 }));
    expect(player(r.state, 'a').list.map((c) => c.name)).toEqual(['Nap', 'Snoop']);
    expect(player(r.state, 'a').slotPositions).toEqual([0, 2]);
    expect(viewFor(r.state, 'a').players.find((p) => p.id === 'a')!.listSlots).toEqual([true, false, true]);
  });

  it('works out of turn — any player may slap at any moment', () => {
    // it is a's turn; c slaps their own matching card... c has no match, use b.
    const r = ok(applyCommand(base(), { type: 'slap', player: 'b', owner: 'b', slot: 0 }));
    expect(player(r.state, 'b').list.map((c) => c.name)).toEqual(['Vacuum the Living Room']);
    expect(r.state.turn).toBe(0); // the turn does not move
  });

  it('works while the current player is holding a drawn card', () => {
    const drawn = ok(applyCommand(base(), { type: 'draw', player: 'a' })).state;
    const r = ok(applyCommand(drawn, { type: 'slap', player: 'b', owner: 'b', slot: 0 }));
    expect(evt(r.events, 'slapCorrect').player).toBe('b');
    expect(r.state.phase).toBe('drawn'); // a still deliberating
  });

  it("opponent's card, correct: their card stays discarded, slapper owes a face-down gift (§6, §9.7)", () => {
    const s = base();
    const slapped = ok(applyCommand(s, { type: 'slap', player: 'a', owner: 'b', slot: 0 }));
    expect(evt(slapped.events, 'slapCorrect').giftPending).toBe(true);
    expect(player(slapped.state, 'b').list).toHaveLength(1); // gap open
    expect(viewFor(slapped.state, 'a').players.find((p) => p.id === 'b')!.listSlots).toEqual([false, true]);
    expect(slapped.state.pendingGift).toEqual({ from: 'a', to: 'b', insertIndex: 0 });

    // everything else is paused until the gift is given
    expect(err(applyCommand(slapped.state, { type: 'draw', player: 'a' })).code).toBe('giftPending');
    expect(err(applyCommand(slapped.state, { type: 'slap', player: 'c', owner: 'a', slot: 0 })).code)
      .toBe('slapLocked');

    // giver chooses which card; it fills the gap; receiver may not look (no peek event)
    const gifted = ok(applyCommand(slapped.state, { type: 'giveCard', player: 'a', slot: 2 }));
    const given = evt(gifted.events, 'giftGiven');
    expect(given).toEqual({ type: 'giftGiven', from: 'a', to: 'b', toSlot: 0, toVisualSlot: 0 });
    expect(player(gifted.state, 'a').list.map((c) => c.name)).toEqual(['Feed the Cat', 'Nap']);
    expect(player(gifted.state, 'b').list.map((c) => c.name)).toEqual(['Snoop', 'Vacuum the Living Room']);
    expect(viewFor(gifted.state, 'a').players.find((p) => p.id === 'b')!.listSlots).toEqual([true, true]);
    expect(gifted.events.every((e) => e.type !== 'peek')).toBe(true);
  });

  it("opponent's middle-slot gift fills the same visual gap", () => {
    const s = makeRound({
      players: [
        { id: 'a', list: ['Feed the Cat', 'Nap', 'Snoop'] },
        { id: 'b', list: ['Nap', 'Feed the Cat', 'Vacuum the Living Room'] },
      ],
      done: ['Feed the Cat'],
    });
    const slapped = ok(applyCommand(s, { type: 'slap', player: 'a', owner: 'b', slot: 1 }));
    expect(slapped.state.pendingGift).toEqual({ from: 'a', to: 'b', insertIndex: 1 });
    expect(viewFor(slapped.state, 'a').players.find((p) => p.id === 'b')!.listSlots).toEqual([true, false, true]);

    const gifted = ok(applyCommand(slapped.state, { type: 'giveCard', player: 'a', slot: 2 }));
    expect(player(gifted.state, 'b').list.map((c) => c.name)).toEqual(['Nap', 'Snoop', 'Vacuum the Living Room']);
    expect(player(gifted.state, 'b').slotPositions).toEqual([0, 1, 2]);
    expect(viewFor(gifted.state, 'a').players.find((p) => p.id === 'b')!.listSlots).toEqual([true, true, true]);
  });

  it('wrong: the card returns face-down (identity was seen) and the slapper draws a penalty card, unseen', () => {
    const s = base();
    const r = ok(applyCommand(s, { type: 'slap', player: 'c', owner: 'c', slot: 0 }));
    const e = evt(r.events, 'slapWrong');
    expect(e.card.name).toBe('Water the Plants'); // slammed face-up: public
    expect(e.penaltyDrawn).toBe(true);
    expect(player(r.state, 'c').list).toHaveLength(2); // original + penalty
    expect(player(r.state, 'c').list[0]!.name).toBe('Water the Plants'); // returned in place
    expect(player(r.state, 'c').list[1]!.name).toBe('Take Out the Trash'); // from deck top
    expect(viewFor(r.state, 'a').players.find((p) => p.id === 'c')!.listSlots).toEqual([true, true]);
    expect(doneTop(r.state).name).toBe('Feed the Cat'); // pile unchanged
    // the penalty card is unseen — no peek event
    expect(r.events.every((ev) => ev.type !== 'peek' && ev.type !== 'drawnCard')).toBe(true);
  });

  it('wrong slap penalty draw reshuffles the DONE pile if the deck is out (§9.1)', () => {
    const s = makeRound({
      players: [{ id: 'a', list: ['Nap'] }, { id: 'b', list: ['Water the Plants'] }],
      deck: [],
      done: ['Feed the Cat', 'Fold the Laundry', 'Take Out the Trash'],
    });
    const r = ok(applyCommand(s, { type: 'slap', player: 'b', owner: 'b', slot: 0 }));
    expect(evt(r.events, 'deckReshuffled')).toBeDefined();
    expect(player(r.state, 'b').list).toHaveLength(2);
  });

  it('later slaps for the same match are returned without penalty (§9.6)', () => {
    const s = base();
    const topId = doneTop(s).id;
    const first = ok(applyCommand(s, { type: 'slap', player: 'a', owner: 'a', slot: 0, expectedTopId: topId }));
    // b's slap arrives second, still referencing the old top
    const second = ok(applyCommand(first.state, { type: 'slap', player: 'b', owner: 'b', slot: 0, expectedTopId: topId }));
    expect(evt(second.events, 'slapTooLate').player).toBe('b');
    expect(player(second.state, 'b').list).toHaveLength(2); // untouched, no penalty
    // but b may re-slap the NEW top (which is again Feed the Cat) — chain slap
    const newTop = doneTop(second.state).id;
    const third = ok(applyCommand(second.state, { type: 'slap', player: 'b', owner: 'b', slot: 0, expectedTopId: newTop }));
    expect(evt(third.events, 'slapCorrect').player).toBe('b');
  });

  it('slaps are locked during action resolution (§6)', () => {
    const s = makeRound({
      players: [{ id: 'a', list: ['Feed the Cat'] }, { id: 'b', list: ['Snoop'] }],
      deck: ['Snoop'],
      done: ['Feed the Cat'],
    });
    const acting = drawAndPlayAction(s, 'a').state; // a discarded Snoop → new DONE top
    expect(err(applyCommand(acting, { type: 'slap', player: 'b', owner: 'b', slot: 0 })).code)
      .toBe('slapLocked');
    // after resolution, slapping b's own Snoop onto the Snoop on top is fine
    const resolved = ok(applyCommand(acting, { type: 'cancelAction', player: 'a' }));
    expect(evt(ok(applyCommand(resolved.state, { type: 'slap', player: 'b', owner: 'b', slot: 0 })).events,
      'slapCorrect').player).toBe('b');
  });

  it('an action card discarded by slapping does NOT trigger its action (§6)', () => {
    const s = makeRound({
      players: [{ id: 'a', list: ['Snoop', 'Nap'] }, { id: 'b', list: ['Nap'] }],
      done: ['Snoop'],
    });
    const r = ok(applyCommand(s, { type: 'slap', player: 'a', owner: 'a', slot: 0 }));
    expect(evt(r.events, 'slapCorrect').card.name).toBe('Snoop');
    expect(r.state.pendingAction).toBeNull();
    expect(r.state.phase).toBe('turn');
  });

  it('a slapper with an empty list cannot slap opponent cards (cannot pay the gift)', () => {
    const s = makeRound({
      players: [{ id: 'a', list: [] }, { id: 'b', list: ['Feed the Cat'] }],
      done: ['Feed the Cat'],
    });
    expect(err(applyCommand(s, { type: 'slap', player: 'a', owner: 'b', slot: 0 })).code)
      .toBe('cannotGift');
  });

  it('same NAME is the match — Nap matches Nap', () => {
    // only 2 Naps exist in the whole deck — one on DONE, one in b's list
    const s = makeRound({
      players: [{ id: 'a', list: ['Feed the Cat'] }, { id: 'b', list: ['Nap'] }],
      done: ['Nap'],
    });
    const r = ok(applyCommand(s, { type: 'slap', player: 'b', owner: 'b', slot: 0 }));
    expect(evt(r.events, 'slapCorrect').card.effort).toBe(0);
  });
});
