import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/round.js';
import { doneTop, err, evt, evts, makeRound, ok, play, player } from './helpers.js';

describe('taking a turn (§4)', () => {
  it('A: draw and keep — drawn card replaces the slot, replaced card goes face-up on DONE', () => {
    const s = makeRound({
      players: [
        { id: 'a', list: ['Nap', 'Vacuum the Living Room', 'Feed the Cat'] },
        { id: 'b', list: ['Water the Plants'] },
      ],
      deck: ['Fold the Laundry'],
    });
    const r = play(s,
      { type: 'draw', player: 'a' },
      { type: 'keepDrawn', player: 'a', slot: 1 },
    );
    expect(player(r.state, 'a').list.map((c) => c.name)).toEqual(['Nap', 'Fold the Laundry', 'Feed the Cat']);
    expect(doneTop(r.state).name).toBe('Vacuum the Living Room');
    const kept = evt(r.events, 'kept');
    expect(kept.discarded!.name).toBe('Vacuum the Living Room');
    // drawn card identity went only to the drawing player
    expect(evt(r.events, 'drawnCard').to).toBe('a');
    // turn advanced
    expect(r.state.turn).toBe(1);
    expect(r.state.phase).toBe('turn');
  });

  it('A: draw and keep treats the command slot as the visual table slot after gaps', () => {
    const s = makeRound({
      players: [
        { id: 'a', list: ['Nap', 'Vacuum the Living Room', 'Feed the Cat'] },
        { id: 'b', list: ['Water the Plants'] },
      ],
      deck: ['Fold the Laundry'],
    });
    const drawn = ok(applyCommand(s, { type: 'draw', player: 'a' })).state;
    player(drawn, 'a').slotPositions = [1, 3, 5];

    const r = ok(applyCommand(drawn, { type: 'keepDrawn', player: 'a', slot: 5 }));

    const kept = evt(r.events, 'kept');
    expect(kept.slot).toBe(2);
    expect(kept.visualSlot).toBe(5);
    expect(player(r.state, 'a').list.map((c) => c.name)).toEqual(['Nap', 'Vacuum the Living Room', 'Fold the Laundry']);
    expect(player(r.state, 'a').slotPositions).toEqual([1, 3, 5]);
  });

  it('A: draw and keep on visual slot 5 stays in visual slot 5 after the second card was discarded', () => {
    const s = makeRound({
      players: [
        { id: 'a', list: ['Nap', 'Vacuum the Living Room', 'Feed the Cat', 'Water the Plants', 'Take Out the Trash'] },
        { id: 'b', list: ['Fold the Laundry'] },
      ],
      deck: ['Snoop'],
    });
    const drawn = ok(applyCommand(s, { type: 'draw', player: 'a' })).state;
    player(drawn, 'a').slotPositions = [0, 2, 3, 4, 5];

    const r = ok(applyCommand(drawn, { type: 'keepDrawn', player: 'a', slot: 4 }));

    const kept = evt(r.events, 'kept');
    expect(kept.slot).toBe(3);
    expect(kept.visualSlot).toBe(4);
    expect(player(r.state, 'a').list.map((c) => c.name)).toEqual([
      'Nap',
      'Vacuum the Living Room',
      'Feed the Cat',
      'Snoop',
      'Take Out the Trash',
    ]);
    expect(player(r.state, 'a').slotPositions).toEqual([0, 2, 3, 4, 5]);
  });

  it('A: draw and discard a chore — straight to DONE, no action possible', () => {
    const s = makeRound({
      players: [{ id: 'a', list: ['Nap'] }, { id: 'b', list: ['Nap'] }],
      deck: ['Vacuum the Living Room'],
    });
    const drawn = ok(applyCommand(s, { type: 'draw', player: 'a' }));
    expect(err(applyCommand(drawn.state, { type: 'discardDrawn', player: 'a', withAction: true })).code)
      .toBe('notAnAction');
    const r = ok(applyCommand(drawn.state, { type: 'discardDrawn', player: 'a', withAction: false }));
    expect(doneTop(r.state).name).toBe('Vacuum the Living Room');
    expect(r.state.turn).toBe(1);
  });

  it('A: discarding a drawn ACTION card with withAction=false does NOT trigger it', () => {
    const s = makeRound({
      players: [{ id: 'a', list: ['Nap'] }, { id: 'b', list: ['Nap'] }],
      deck: ['Snoop'],
    });
    const r = play(s,
      { type: 'draw', player: 'a' },
      { type: 'discardDrawn', player: 'a', withAction: false },
    );
    expect(r.state.pendingAction).toBeNull();
    expect(evts(r.events, 'actionStarted')).toHaveLength(0);
    expect(r.state.turn).toBe(1);
  });

  it('keeping a drawn card and thereby discarding an ACTION card does NOT trigger it (§4: actions trigger only on cards drawn from the deck)', () => {
    const s = makeRound({
      players: [{ id: 'a', list: ['Snoop', 'Nap'] }, { id: 'b', list: ['Nap'] }],
      deck: ['Feed the Cat'],
    });
    const r = play(s,
      { type: 'draw', player: 'a' },
      { type: 'keepDrawn', player: 'a', slot: 0 },
    );
    expect(doneTop(r.state).name).toBe('Snoop');
    expect(r.state.pendingAction).toBeNull();
    expect(evts(r.events, 'actionStarted')).toHaveLength(0);
  });

  it('B: take the top DONE card — must swap, replaced card goes on DONE, never triggers an action', () => {
    const s = makeRound({
      players: [{ id: 'a', list: ['Vacuum the Living Room', 'Nap'] }, { id: 'b', list: ['Nap'] }],
      done: ['Snoop', 'Feed the Cat'], // top is Snoop, an action card
    });
    const r = ok(applyCommand(s, { type: 'takeFromDone', player: 'a', slot: 0 }));
    expect(player(r.state, 'a').list.map((c) => c.name)).toEqual(['Snoop', 'Nap']);
    expect(doneTop(r.state).name).toBe('Vacuum the Living Room');
    expect(r.state.pendingAction).toBeNull(); // §4B: taking never triggers an action
    expect(r.state.turn).toBe(1);
    // the taken card's identity was already public; the event says what moved
    const took = evt(r.events, 'tookFromDone');
    expect(took.taken.name).toBe('Snoop');
    expect(took.discarded.name).toBe('Vacuum the Living Room');
  });

  it('rejects acting out of turn or out of phase', () => {
    const s = makeRound({
      players: [{ id: 'a', list: ['Nap'] }, { id: 'b', list: ['Nap'] }],
      deck: ['Feed the Cat', 'Water the Plants'],
    });
    expect(err(applyCommand(s, { type: 'draw', player: 'b' })).code).toBe('notYourTurn');
    expect(err(applyCommand(s, { type: 'keepDrawn', player: 'a', slot: 0 })).code).toBe('wrongPhase');
    const drawn = ok(applyCommand(s, { type: 'draw', player: 'a' })).state;
    expect(err(applyCommand(drawn, { type: 'draw', player: 'a' })).code).toBe('wrongPhase');
    expect(err(applyCommand(drawn, { type: 'takeFromDone', player: 'a', slot: 0 })).code).toBe('wrongPhase');
  });

  it('turn order wraps around the table', () => {
    const s = makeRound({
      players: [
        { id: 'a', list: ['Nap'] },
        { id: 'b', list: ['Nap'] },
        { id: 'c', list: ['Feed the Cat'] },
      ],
      deck: ['Feed the Cat', 'Water the Plants', 'Fold the Laundry'],
      turn: 2,
    });
    const r = play(s,
      { type: 'draw', player: 'c' },
      { type: 'discardDrawn', player: 'c', withAction: false },
    );
    expect(r.state.turn).toBe(0);
  });
});

describe('empty-list players (§9.2)', () => {
  const empty = () =>
    makeRound({
      players: [{ id: 'a', list: [] }, { id: 'b', list: ['Nap', 'Nap'] }],
      deck: ['Feed the Cat', 'Water the Plants'],
      done: ['Fold the Laundry'],
    });

  it('may draw-and-keep, which only adds a card back (no discard)', () => {
    const r = play(empty(),
      { type: 'draw', player: 'a' },
      { type: 'keepDrawn', player: 'a', slot: 0 },
    );
    expect(player(r.state, 'a').list.map((c) => c.name)).toEqual(['Feed the Cat']);
    expect(doneTop(r.state).name).toBe('Fold the Laundry'); // unchanged
    expect(evt(r.events, 'kept').discarded).toBeNull();
  });

  it('may draw-and-discard', () => {
    const r = play(empty(),
      { type: 'draw', player: 'a' },
      { type: 'discardDrawn', player: 'a', withAction: false },
    );
    expect(player(r.state, 'a').list).toHaveLength(0);
    expect(doneTop(r.state).name).toBe('Feed the Cat');
  });

  it('may NOT take from the DONE pile (there is nothing to swap out)', () => {
    expect(err(applyCommand(empty(), { type: 'takeFromDone', player: 'a', slot: 0 })).code)
      .toBe('emptyList');
  });

  it('may call "NOT ME!" and counts 0 at reveal', () => {
    const s = makeRound({
      players: [{ id: 'a', list: [] }, { id: 'b', list: ['Nap', 'Feed the Cat'] }],
      deck: ['Water the Plants'],
    });
    const called = ok(applyCommand(s, { type: 'callNotMe', player: 'a' }));
    const r = play(called.state,
      { type: 'draw', player: 'b' },
      { type: 'discardDrawn', player: 'b', withAction: false },
    );
    expect(r.state.phase).toBe('reveal');
    expect(r.state.result!.totals['a']).toBe(0);
    expect(r.state.result!.totals['b']).toBe(2);
    expect(r.state.result!.callerWon).toBe(true);
    expect(r.state.result!.scores).toEqual({ a: 0, b: 2 });
  });
});

describe('deck exhaustion (§9.1)', () => {
  it('reshuffles the DONE pile except its top card into a new deck on draw', () => {
    const s = makeRound({
      players: [{ id: 'a', list: ['Nap'] }, { id: 'b', list: ['Nap'] }],
      deck: [],
      done: ['Feed the Cat', 'Water the Plants', 'Fold the Laundry', 'Snoop'],
    });
    const r = ok(applyCommand(s, { type: 'draw', player: 'a' }));
    expect(evt(r.events, 'deckReshuffled').deckSize).toBe(3);
    expect(r.state.done).toHaveLength(1);
    expect(doneTop(r.state).name).toBe('Feed the Cat'); // top card stays
    // drawn card came from the reshuffled pile
    expect(r.state.deck).toHaveLength(2);
    expect(['Water the Plants', 'Fold the Laundry', 'Snoop']).toContain(r.state.drawnCard!.name);
  });

  it('when deck is empty and DONE has only its top card, drawing is impossible', () => {
    const s = makeRound({
      players: [{ id: 'a', list: ['Nap'] }, { id: 'b', list: ['Nap'] }],
      deck: [],
      done: ['Feed the Cat'],
    });
    expect(err(applyCommand(s, { type: 'draw', player: 'a' })).code).toBe('deckEmpty');
  });

  it('conserves all 54 physical cards across a reshuffle', () => {
    const s = makeRound({
      players: [{ id: 'a', list: ['Nap'] }, { id: 'b', list: ['Nap'] }],
      deck: [],
      done: ['Feed the Cat', 'Water the Plants', 'Fold the Laundry'],
    });
    const before = new Set([
      ...s.deck.map((c) => c.id), ...s.done.map((c) => c.id),
      ...s.players.flatMap((p) => p.list.map((c) => c.id)),
    ]);
    const r = ok(applyCommand(s, { type: 'draw', player: 'a' }));
    const after = new Set([
      ...r.state.deck.map((c) => c.id), ...r.state.done.map((c) => c.id),
      r.state.drawnCard!.id,
      ...r.state.players.flatMap((p) => p.list.map((c) => c.id)),
    ]);
    expect(after).toEqual(before);
  });
});

describe('forceSkipTurn (server timeout hook)', () => {
  const base = () =>
    makeRound({
      players: [{ id: 'a', list: ['Nap'] }, { id: 'b', list: ['Nap'] }],
      deck: ['Feed the Cat', 'Snoop'],
    });

  it('in turn phase: the turn is simply lost', () => {
    const r = ok(applyCommand(base(), { type: 'forceSkipTurn', player: 'a' }));
    expect(r.state.turn).toBe(1);
    expect(evt(r.events, 'turnSkipped').player).toBe('a');
  });

  it('in drawn phase: auto-discards the drawn card without action', () => {
    const drawn = ok(applyCommand(base(), { type: 'draw', player: 'a' })).state;
    const r = ok(applyCommand(drawn, { type: 'forceSkipTurn', player: 'a' }));
    expect(doneTop(r.state).name).toBe('Feed the Cat');
    expect(r.state.pendingAction).toBeNull();
    expect(r.state.turn).toBe(1);
  });

  it('in action phase: cancels the pending action', () => {
    const s = makeRound({
      players: [{ id: 'a', list: ['Nap'] }, { id: 'b', list: ['Nap'] }],
      deck: ['Snoop'],
    });
    const acting = play(s,
      { type: 'draw', player: 'a' },
      { type: 'discardDrawn', player: 'a', withAction: true },
    ).state;
    const r = ok(applyCommand(acting, { type: 'forceSkipTurn', player: 'a' }));
    expect(r.state.pendingAction).toBeNull();
    expect(r.state.turn).toBe(1);
    expect(evt(r.events, 'actionCancelled').action).toBe('Snoop');
  });

  it('cannot skip a player who is not blocking anything', () => {
    expect(err(applyCommand(base(), { type: 'forceSkipTurn', player: 'b' })).code).toBe('notYourTurn');
  });
});
