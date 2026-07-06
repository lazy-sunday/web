import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/round.js';
import { doneTop, err, evt, evts, makeRound, ok, play, player } from './helpers.js';

describe('"NOT ME!" and final turns (§7)', () => {
  it('every other player gets exactly ONE final turn, in seat order, then the reveal', () => {
    const s = makeRound({
      players: [
        { id: 'a', list: ['Nap'] },
        { id: 'b', list: ['Feed the Cat'] },
        { id: 'c', list: ['Water the Plants'] },
      ],
      deck: ['Fold the Laundry', 'Take Out the Trash'],
      turn: 1, // b calls
    });
    const called = ok(applyCommand(s, { type: 'callNotMe', player: 'b' }));
    expect(evt(called.events, 'notMeCalled').caller).toBe('b');
    expect(called.state.players[called.state.turn]!.id).toBe('c'); // next in seat order

    const afterC = play(called.state,
      { type: 'draw', player: 'c' },
      { type: 'discardDrawn', player: 'c', withAction: false },
    );
    expect(afterC.state.players[afterC.state.turn]!.id).toBe('a');
    expect(afterC.state.phase).toBe('turn');

    const afterA = play(afterC.state,
      { type: 'draw', player: 'a' },
      { type: 'discardDrawn', player: 'a', withAction: false },
    );
    expect(afterA.state.phase).toBe('reveal');
    expect(afterA.state.result).not.toBeNull();
  });

  it('house-rule instantNotMe: "NOT ME!" reveals immediately, no final turns', () => {
    const s = makeRound({
      players: [
        { id: 'a', list: ['Nap'] },
        { id: 'b', list: ['Feed the Cat'] },
        { id: 'c', list: ['Vacuum the Living Room'] },
      ],
      deck: ['Fold the Laundry', 'Take Out the Trash'],
      turn: 1, // b calls
      instantNotMe: true,
    });
    const r = ok(applyCommand(s, { type: 'callNotMe', player: 'b' }));
    expect(evt(r.events, 'notMeCalled').caller).toBe('b');
    // straight to reveal — nobody took a final turn
    expect(r.state.phase).toBe('reveal');
    expect(r.state.finalTurnQueue).toHaveLength(0);
    expect(evts(r.events, 'turnStarted')).toHaveLength(0);
    // scoring is unchanged: b (2) beats a (0)? a=0 lowest, but b is caller → b loses
    expect(r.state.result!.totals).toEqual({ a: 0, b: 2, c: 6 });
    expect(r.state.result!.callerWon).toBe(false); // a's 0 strictly beats b's 2
    expect(r.state.result!.scores).toEqual({ a: 0, b: 50, c: 6 });
  });

  it('default (instantNotMe off) still grants final turns before reveal', () => {
    const s = makeRound({
      players: [{ id: 'a', list: ['Nap'] }, { id: 'b', list: ['Feed the Cat'] }],
      deck: ['Water the Plants'],
    });
    const r = ok(applyCommand(s, { type: 'callNotMe', player: 'a' }));
    expect(r.state.phase).toBe('turn'); // b's final turn is pending
    expect(r.state.finalTurnQueue.length + (r.state.players[r.state.turn]!.id === 'b' ? 1 : 0)).toBeGreaterThan(0);
  });

  it('must be called at the START of your turn, instead of taking one', () => {
    const s = makeRound({
      players: [{ id: 'a', list: ['Nap'] }, { id: 'b', list: ['Nap'] }],
      deck: ['Feed the Cat'],
    });
    const drawn = ok(applyCommand(s, { type: 'draw', player: 'a' })).state;
    expect(err(applyCommand(drawn, { type: 'callNotMe', player: 'a' })).code).toBe('wrongPhase');
  });

  it('only one caller per round — a final-turn player cannot also call', () => {
    const s = makeRound({
      players: [{ id: 'a', list: ['Nap'] }, { id: 'b', list: ['Nap'] }],
      deck: ['Feed the Cat'],
    });
    const called = ok(applyCommand(s, { type: 'callNotMe', player: 'a' })).state;
    expect(err(applyCommand(called, { type: 'callNotMe', player: 'b' })).code).toBe('alreadyCalled');
  });

  it("§9.3: a final turn skipped by \"I'm Busy\" is simply lost", () => {
    // a plays I'm Busy on c, then b calls NOT ME. c's one final turn is lost;
    // after a's final turn the round reveals without c ever playing.
    const s = makeRound({
      players: [
        { id: 'a', list: ['Nap'] },
        { id: 'b', list: ['Feed the Cat'] },
        { id: 'c', list: ['Water the Plants'] },
      ],
      deck: ["I'm Busy", 'Fold the Laundry', 'Take Out the Trash'],
    });
    const afterBusy = play(s,
      { type: 'draw', player: 'a' },
      { type: 'discardDrawn', player: 'a', withAction: true },
      { type: 'actionInput', player: 'a', input: { action: "I'm Busy", targetId: 'c' } },
    ).state;
    expect(afterBusy.players[afterBusy.turn]!.id).toBe('b');

    const called = ok(applyCommand(afterBusy, { type: 'callNotMe', player: 'b' }));
    // c was next in the final-turn queue but is skipped; play lands on a
    const skipped = evt(called.events, 'turnSkipped');
    expect(skipped).toMatchObject({ player: 'c', wasFinalTurn: true });
    expect(called.state.players[called.state.turn]!.id).toBe('a');

    const done = play(called.state,
      { type: 'draw', player: 'a' },
      { type: 'discardDrawn', player: 'a', withAction: false },
    );
    expect(done.state.phase).toBe('reveal');
  });

  it("caller lock: Trade/Switcheroo/Not My Job/Landlord's cannot touch the caller's list (§7)", () => {
    const s = makeRound({
      players: [
        { id: 'a', list: ['Nap'] },        // caller
        { id: 'b', list: ['Feed the Cat'] },
        { id: 'c', list: ['Water the Plants'] },
      ],
      deck: ["Let's Trade", 'Switcheroo', "Not My Job", "Landlord's Notice", 'Fold the Laundry'],
    });
    const called = ok(applyCommand(s, { type: 'callNotMe', player: 'a' })).state;

    // b's final turn: draws Let's Trade, tries to hit the caller
    const bActing = play(called,
      { type: 'draw', player: 'b' },
      { type: 'discardDrawn', player: 'b', withAction: true },
    ).state;
    expect(err(applyCommand(bActing, {
      type: 'actionInput', player: 'b',
      input: { action: "Let's Trade", mySlot: 0, opponentId: 'a', opponentSlot: 0 },
    })).code).toBe('callerLocked');
    // trading with a non-caller is still fine
    const bDone = ok(applyCommand(bActing, {
      type: 'actionInput', player: 'b',
      input: { action: "Let's Trade", mySlot: 0, opponentId: 'c', opponentSlot: 0 },
    }));

    // c's final turn: draws Switcheroo — both targets would need to exclude c and
    // the caller, leaving only b: no legal pair, so targeting a is callerLocked
    const cActing = play(bDone.state,
      { type: 'draw', player: 'c' },
      { type: 'discardDrawn', player: 'c', withAction: true },
    ).state;
    expect(err(applyCommand(cActing, {
      type: 'actionInput', player: 'c',
      input: { action: 'Switcheroo', a: 'a', aSlot: 0, b: 'b', bSlot: 0 },
    })).code).toBe('callerLocked');
    const revealed = ok(applyCommand(cActing, { type: 'cancelAction', player: 'c' }));
    expect(revealed.state.phase).toBe('reveal');
  });

  it("caller lock: 'Not My Job' and Landlord's Notice cannot touch the caller either", () => {
    const s = makeRound({
      players: [
        { id: 'a', list: ['Nap'] },        // will call
        { id: 'b', list: ['Feed the Cat'] },
        { id: 'c', list: ['Water the Plants'] },
        { id: 'd', list: ['Fold the Laundry'] },
      ],
      deck: ["Not My Job", "Landlord's Notice", 'Take Out the Trash', 'Vacuum the Living Room'],
    });
    const called = ok(applyCommand(s, { type: 'callNotMe', player: 'a' })).state;
    const bActing = play(called,
      { type: 'draw', player: 'b' },
      { type: 'discardDrawn', player: 'b', withAction: true },
    ).state;
    expect(err(applyCommand(bActing, {
      type: 'actionInput', player: 'b',
      input: { action: "Not My Job", fromId: 'a', fromSlot: 0, toId: 'c' },
    })).code).toBe('callerLocked');
    expect(err(applyCommand(bActing, {
      type: 'actionInput', player: 'b',
      input: { action: "Not My Job", fromId: 'c', fromSlot: 0, toId: 'a' },
    })).code).toBe('callerLocked');
    const bDone = ok(applyCommand(bActing, {
      type: 'actionInput', player: 'b',
      input: { action: "Not My Job", fromId: 'c', fromSlot: 0, toId: 'd' },
    }));
    const cActing = play(bDone.state,
      { type: 'draw', player: 'c' },
      { type: 'discardDrawn', player: 'c', withAction: true },
    ).state;
    expect(err(applyCommand(cActing, {
      type: 'actionInput', player: 'c',
      input: { action: "Landlord's Notice", targetId: 'a' },
    })).code).toBe('callerLocked');
  });

  it('caller lock: Snoop on the caller is still allowed (§7 lists only the four list-touching actions)', () => {
    const s = makeRound({
      players: [
        { id: 'a', list: ['Nap'] },
        { id: 'b', list: ['Feed the Cat'] },
        { id: 'c', list: ['Water the Plants'] },
      ],
      deck: ['Snoop', 'Fold the Laundry', 'Take Out the Trash'],
    });
    const called = ok(applyCommand(s, { type: 'callNotMe', player: 'a' })).state;
    const bActing = play(called,
      { type: 'draw', player: 'b' },
      { type: 'discardDrawn', player: 'b', withAction: true },
    ).state;
    const r = ok(applyCommand(bActing, {
      type: 'actionInput', player: 'b', input: { action: 'Snoop', targetId: 'a', slot: 0 },
    }));
    expect(evt(r.events, 'peek').reveals[0]!.owner).toBe('a');
  });

  it("caller lock: no one may quick-discard the caller's cards; the caller still may (§7)", () => {
    const s = makeRound({
      players: [
        { id: 'a', list: ['Feed the Cat', 'Feed the Cat'] }, // caller with two matches
        { id: 'b', list: ['Feed the Cat'] },
      ],
      deck: ['Water the Plants'],
      done: ['Feed the Cat'],
    });
    const called = ok(applyCommand(s, { type: 'callNotMe', player: 'a' })).state;
    expect(err(applyCommand(called, { type: 'slap', player: 'b', owner: 'a', slot: 0 })).code)
      .toBe('callerLocked');
    // the caller slapping their own card is fine
    const r = ok(applyCommand(called, { type: 'slap', player: 'a', owner: 'a', slot: 0 }));
    expect(evt(r.events, 'slapCorrect').player).toBe('a');
    // and b slapping b's own card is also fine
    const r2 = ok(applyCommand(r.state, { type: 'slap', player: 'b', owner: 'b', slot: 0 }));
    expect(evt(r2.events, 'slapCorrect').player).toBe('b');
  });
});

describe('scoring the round (§7)', () => {
  function playToReveal(lists: Record<'a' | 'b' | 'c', Parameters<typeof makeRound>[0]['players'][0]['list']>, caller: 'a' | 'b' | 'c') {
    const seats = ['a', 'b', 'c'] as const;
    const s = makeRound({
      players: seats.map((id) => ({ id, list: lists[id] })),
      deck: ['Fold the Laundry', 'Take Out the Trash', 'Vacuum the Living Room'],
      turn: seats.indexOf(caller),
    });
    let state = ok(applyCommand(s, { type: 'callNotMe', player: caller })).state;
    while (state.phase !== 'reveal') {
      const current = state.players[state.turn]!.id;
      state = play(state,
        { type: 'draw', player: current },
        { type: 'discardDrawn', player: current, withAction: false },
      ).state;
    }
    return state.result!;
  }

  it('caller strictly lowest: caller scores 0, everyone else their own total', () => {
    const result = playToReveal(
      { a: ['Nap', 'Feed the Cat'], b: ['Water the Plants'], c: ['Vacuum the Living Room'] },
      'a',
    ); // totals: a=2, b=3, c=6
    expect(result.callerWon).toBe(true);
    expect(result.totals).toEqual({ a: 2, b: 3, c: 6 });
    expect(result.scores).toEqual({ a: 0, b: 3, c: 6 });
  });

  it('tie goes to the caller', () => {
    const result = playToReveal(
      { a: ['Water the Plants'], b: ['Water the Plants'], c: ['Vacuum the Living Room'] },
      'a',
    ); // totals: a=3, b=3 — tie
    expect(result.callerWon).toBe(true);
    expect(result.scores).toEqual({ a: 0, b: 3, c: 6 });
  });

  it('anyone strictly beats the caller: caller scores 50, everyone else (including the lowest) their own total', () => {
    const result = playToReveal(
      { a: ['Water the Plants'], b: ['Feed the Cat'], c: ['Vacuum the Living Room'] },
      'a',
    ); // totals: a=3, b=2 beats caller
    expect(result.callerWon).toBe(false);
    expect(result.scores).toEqual({ a: 50, b: 2, c: 6 });
  });

  it('reveal publishes the full face-up lists', () => {
    const result = playToReveal(
      { a: ['Nap'], b: ['Feed the Cat'], c: ['Water the Plants'] },
      'a',
    );
    expect(result.lists['a']!.map((c) => c.name)).toEqual(['Nap']);
    expect(result.lists['b']!.map((c) => c.name)).toEqual(['Feed the Cat']);
  });
});

describe('2-player rounds', () => {
  it('works end to end: call, one final turn, reveal', () => {
    const s = makeRound({
      players: [{ id: 'a', list: ['Nap'] }, { id: 'b', list: ['Vacuum the Living Room'] }],
      deck: ['Feed the Cat'],
    });
    const called = ok(applyCommand(s, { type: 'callNotMe', player: 'a' }));
    const r = play(called.state,
      { type: 'draw', player: 'b' },
      { type: 'keepDrawn', player: 'b', slot: 0 },
    );
    expect(r.state.phase).toBe('reveal');
    expect(r.state.result!.scores).toEqual({ a: 0, b: 2 });
  });
});
