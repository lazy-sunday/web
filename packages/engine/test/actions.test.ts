import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/round.js';
import type { RoundState } from '../src/types.js';
import { viewFor } from '../src/view.js';
import { doneTop, drawAndPlayAction, err, evt, evts, makeRound, ok, play, player } from './helpers.js';

/** Round where 'a' is about to draw the given action card. */
function aboutToDraw(action: Parameters<typeof makeRound>[0]['deck'] extends (infer T)[] | undefined ? T : never, extra?: Partial<Parameters<typeof makeRound>[0]>): RoundState {
  return makeRound({
    players: [
      { id: 'a', list: ['Nap', 'Feed the Cat', 'Water the Plants'] },
      { id: 'b', list: ['Fold the Laundry', 'Take Out the Trash'] },
      { id: 'c', list: ['Vacuum the Living Room', 'Feed the Cat'] },
    ],
    deck: [action, 'Water the Plants'],
    ...extra,
  });
}

describe('Check the List (§5)', () => {
  it('peeks at ONE of your own cards, privately, then the turn ends', () => {
    const acting = drawAndPlayAction(aboutToDraw('Check the List'), 'a').state;
    player(acting, 'a').slotPositions = [0, 1, 3];
    const r = ok(applyCommand(acting, {
      type: 'actionInput', player: 'a', input: { action: 'Check the List', slot: 3 },
    }));
    const peek = evt(r.events, 'peek');
    expect(peek.to).toBe('a');
    expect(peek.reason).toBe('action'); // §5 granted peek — the short reveal
    expect(peek.reveals).toEqual([{
      owner: 'a',
      slot: 2,
      visualSlot: 3,
      card: player(r.state, 'a').list[2],
    }]);
    expect(peek.reveals[0]!.card.name).toBe('Water the Plants');
    expect(r.state.pendingAction).toBeNull();
    expect(r.state.turn).toBe(1);
  });

  it('cannot peek an opponent card with it', () => {
    const acting = drawAndPlayAction(aboutToDraw('Check the List'), 'a').state;
    expect(err(applyCommand(acting, {
      type: 'actionInput', player: 'a', input: { action: 'Snoop', targetId: 'b', slot: 0 },
    })).code).toBe('wrongAction');
  });
});

describe('Knock It Out (§5, §9.5)', () => {
  it('peek then discard: the peeked card goes face-up on DONE, list shrinks', () => {
    const acting = drawAndPlayAction(aboutToDraw('Knock It Out'), 'a').state;
    const peeked = ok(applyCommand(acting, {
      type: 'actionInput', player: 'a', input: { action: 'Knock It Out', slot: 1 },
    }));
    const reveal = evt(peeked.events, 'peek').reveals[0]!;
    expect(reveal.card.name).toBe('Feed the Cat');
    expect(reveal.visualSlot).toBe(1);
    expect(peeked.state.phase).toBe('action'); // still resolving
    const r = ok(applyCommand(peeked.state, { type: 'knockItOutDecision', player: 'a', discard: true }));
    expect(player(r.state, 'a').list.map((c) => c.name)).toEqual(['Nap', 'Water the Plants']);
    expect(doneTop(r.state).name).toBe('Feed the Cat');
    expect(r.state.turn).toBe(1);
  });

  it('peek then keep: nothing moves', () => {
    const acting = drawAndPlayAction(aboutToDraw('Knock It Out'), 'a').state;
    const peeked = ok(applyCommand(acting, {
      type: 'actionInput', player: 'a', input: { action: 'Knock It Out', slot: 1 },
    })).state;
    const r = ok(applyCommand(peeked, { type: 'knockItOutDecision', player: 'a', discard: false }));
    expect(player(r.state, 'a').list).toHaveLength(3);
    expect(doneTop(r.state).name).toBe('Knock It Out');
    expect(r.state.turn).toBe(1);
  });

  it('identifies the stable visual slot when an earlier card has left a gap', () => {
    const acting = drawAndPlayAction(aboutToDraw('Knock It Out'), 'a').state;
    player(acting, 'a').slotPositions = [0, 2, 3];

    const peeked = ok(applyCommand(acting, {
      type: 'actionInput', player: 'a', input: { action: 'Knock It Out', slot: 2 },
    }));
    const reveal = evt(peeked.events, 'peek').reveals[0]!;

    expect(reveal.slot).toBe(1);
    expect(reveal.visualSlot).toBe(2);
    expect(evt(peeked.events, 'knockItOutPeeked').visualSlot).toBe(2);
  });

  it('any value may be knocked out, and the self-discard triggers no further action (§9.5)', () => {
    const s = makeRound({
      players: [
        { id: 'a', list: ['Snoop', 'Nap'] }, // an ACTION card sits in the list
        { id: 'b', list: ['Nap'] },
      ],
      deck: ['Knock It Out'],
    });
    const acting = drawAndPlayAction(s, 'a').state;
    const peeked = ok(applyCommand(acting, {
      type: 'actionInput', player: 'a', input: { action: 'Knock It Out', slot: 0 },
    })).state;
    const r = ok(applyCommand(peeked, { type: 'knockItOutDecision', player: 'a', discard: true }));
    expect(doneTop(r.state).name).toBe('Snoop');
    expect(r.state.pendingAction).toBeNull(); // no chained action
    expect(evts(r.events, 'actionStarted')).toHaveLength(0);
    expect(r.state.turn).toBe(1);
  });

  it('the knocked-out card becomes a quick-discard target (§9.5)', () => {
    // b holds a Feed the Cat; a knocks out their own Feed the Cat → b can slap.
    const s = makeRound({
      players: [
        { id: 'a', list: ['Feed the Cat', 'Nap'] },
        { id: 'b', list: ['Feed the Cat', 'Nap'] },
      ],
      deck: ['Knock It Out'],
    });
    const done = play(s,
      { type: 'draw', player: 'a' },
      { type: 'discardDrawn', player: 'a', withAction: true },
      { type: 'actionInput', player: 'a', input: { action: 'Knock It Out', slot: 0 } },
      { type: 'knockItOutDecision', player: 'a', discard: true },
    ).state;
    const r = ok(applyCommand(done, { type: 'slap', player: 'b', owner: 'b', slot: 0 }));
    expect(evt(r.events, 'slapCorrect').card.name).toBe('Feed the Cat');
  });
});

describe("Let's Trade (§5)", () => {
  it('blind-swaps one of your cards with one opponent card, no peeking', () => {
    const acting = drawAndPlayAction(aboutToDraw("Let's Trade"), 'a').state;
    const aCard = player(acting, 'a').list[0]!;
    const bCard = player(acting, 'b').list[1]!;
    const r = ok(applyCommand(acting, {
      type: 'actionInput', player: 'a',
      input: { action: "Let's Trade", mySlot: 0, opponentId: 'b', opponentSlot: 1 },
    }));
    expect(player(r.state, 'a').list[0]!.id).toBe(bCard.id);
    expect(player(r.state, 'b').list[1]!.id).toBe(aCard.id);
    expect(evts(r.events, 'peek')).toHaveLength(0); // no peeking
    expect(r.state.turn).toBe(1);
  });

  it('cannot trade with yourself', () => {
    const acting = drawAndPlayAction(aboutToDraw("Let's Trade"), 'a').state;
    expect(err(applyCommand(acting, {
      type: 'actionInput', player: 'a',
      input: { action: "Let's Trade", mySlot: 0, opponentId: 'a', opponentSlot: 1 },
    })).code).toBe('invalidTarget');
  });
});

describe('Switcheroo (§5, §9.4)', () => {
  it('blind-swaps two cards between two OTHER players', () => {
    const acting = drawAndPlayAction(aboutToDraw('Switcheroo'), 'a').state;
    const bCard = player(acting, 'b').list[0]!;
    const cCard = player(acting, 'c').list[1]!;
    const r = ok(applyCommand(acting, {
      type: 'actionInput', player: 'a',
      input: { action: 'Switcheroo', a: 'b', aSlot: 0, b: 'c', bSlot: 1 },
    }));
    expect(player(r.state, 'b').list[0]!.id).toBe(cCard.id);
    expect(player(r.state, 'c').list[1]!.id).toBe(bCard.id);
    expect(evts(r.events, 'peek')).toHaveLength(0); // nobody peeks
  });

  it('must target two players other than the user (§9.4)', () => {
    const acting = drawAndPlayAction(aboutToDraw('Switcheroo'), 'a').state;
    const before = structuredClone(acting);
    for (const input of [
      { action: 'Switcheroo', a: 'a', aSlot: 0, b: 'b', bSlot: 0 },
      { action: 'Switcheroo', a: 'b', aSlot: 0, b: 'a', bSlot: 0 },
      { action: 'Switcheroo', a: 'b', aSlot: 0, b: 'b', bSlot: 1 },
    ] as const) {
      expect(err(applyCommand(acting, { type: 'actionInput', player: 'a', input })).code)
        .toBe('invalidTarget');
    }
    expect(acting).toEqual(before);
  });
});

describe('Snoop (§5)', () => {
  it('peeks at ONE opponent card, privately', () => {
    const acting = drawAndPlayAction(aboutToDraw('Snoop'), 'a').state;
    player(acting, 'c').slotPositions = [1, 2];
    const r = ok(applyCommand(acting, {
      type: 'actionInput', player: 'a', input: { action: 'Snoop', targetId: 'c', slot: 1 },
    }));
    const peek = evt(r.events, 'peek');
    expect(peek.to).toBe('a');
    expect(peek.reason).toBe('action'); // §5 Snoop is a short granted peek
    expect(peek.reveals[0]).toEqual({
      owner: 'c',
      slot: 0,
      visualSlot: 1,
      card: player(r.state, 'c').list[0],
    });
    expect(peek.reveals[0]!.card.name).toBe('Vacuum the Living Room');
  });

  it('cannot snoop your own card', () => {
    const acting = drawAndPlayAction(aboutToDraw('Snoop'), 'a').state;
    expect(err(applyCommand(acting, {
      type: 'actionInput', player: 'a', input: { action: 'Snoop', targetId: 'a', slot: 0 },
    })).code).toBe('invalidTarget');
  });
});

describe("Not My Job (§5, §9.4)", () => {
  it('moves one card, unseen, from one opponent to another; list sizes change', () => {
    const acting = drawAndPlayAction(aboutToDraw("Not My Job"), 'a').state;
    const moved = player(acting, 'b').list[0]!;
    const r = ok(applyCommand(acting, {
      type: 'actionInput', player: 'a',
      input: { action: "Not My Job", fromId: 'b', fromSlot: 0, toId: 'c' },
    }));
    expect(player(r.state, 'b').list).toHaveLength(1);
    expect(player(r.state, 'c').list).toHaveLength(3);
    expect(player(r.state, 'c').list[2]!.id).toBe(moved.id);
    expect(evts(r.events, 'peek')).toHaveLength(0); // unseen
  });

  it('never involves the user (§9.4)', () => {
    const acting = drawAndPlayAction(aboutToDraw("Not My Job"), 'a').state;
    const before = structuredClone(acting);
    for (const input of [
      { action: "Not My Job", fromId: 'a', fromSlot: 0, toId: 'b' },
      { action: "Not My Job", fromId: 'b', fromSlot: 0, toId: 'a' },
      { action: "Not My Job", fromId: 'b', fromSlot: 0, toId: 'b' },
    ] as const) {
      expect(err(applyCommand(acting, { type: 'actionInput', player: 'a', input })).code)
        .toBe('invalidTarget');
    }
    expect(acting).toEqual(before);
  });
});

describe('actions that need two other players', () => {
  for (const action of ['Switcheroo', 'Not My Job'] as const) {
    it(`does not play ${action} with two players, but still allows a plain discard`, () => {
      const s = makeRound({
        players: [
          { id: 'a', list: ['Nap'] },
          { id: 'b', list: ['Feed the Cat'] },
        ],
        deck: [action, 'Water the Plants'],
      });
      const drawn = ok(applyCommand(s, { type: 'draw', player: 'a' })).state;
      const before = structuredClone(drawn);
      const rejected = err(applyCommand(drawn, {
        type: 'discardDrawn', player: 'a', withAction: true,
      }));

      expect(rejected.code).toBe('notPerformable');
      expect(drawn).toEqual(before);
      expect(viewFor(drawn, 'a').myDrawnActionUnavailableReason).toBe('needsTwoOtherPlayers');
      expect(viewFor(drawn, 'b').myDrawnActionUnavailableReason).toBeNull();

      const discarded = ok(applyCommand(drawn, {
        type: 'discardDrawn', player: 'a', withAction: false,
      }));
      expect(doneTop(discarded.state).name).toBe(action);
      expect(discarded.state.pendingAction).toBeNull();
      expect(discarded.state.players[discarded.state.turn]!.id).toBe('b');
    });
  }

  it('accounts for the caller lock before opening a three-player target picker', () => {
    const s = makeRound({
      players: [
        { id: 'a', list: ['Nap'] },
        { id: 'b', list: ['Feed the Cat'] },
        { id: 'c', list: ['Water the Plants'] },
      ],
      deck: ['Switcheroo', 'Fold the Laundry'],
      turn: 1,
      caller: 'a',
      finalTurnQueue: ['b', 'c'],
    });
    const drawn = ok(applyCommand(s, { type: 'draw', player: 'b' })).state;
    expect(viewFor(drawn, 'b').myDrawnActionUnavailableReason)
      .toBe('callerLockLeavesTooFewTargets');
    expect(err(applyCommand(drawn, {
      type: 'discardDrawn', player: 'b', withAction: true,
    })).code).toBe('notPerformable');
  });
});

describe("Landlord's Notice (§5, §9.4)", () => {
  it('places the top deck card face-down on any player, unseen by everyone', () => {
    const acting = drawAndPlayAction(aboutToDraw("Landlord's Notice"), 'a').state;
    const expected = acting.deck[acting.deck.length - 1]!; // next deck card
    const r = ok(applyCommand(acting, {
      type: 'actionInput', player: 'a', input: { action: "Landlord's Notice", targetId: 'b' },
    }));
    expect(player(r.state, 'b').list).toHaveLength(3);
    expect(player(r.state, 'b').list[2]!.id).toBe(expected.id);
    expect(evts(r.events, 'peek')).toHaveLength(0); // §5: "No one sees it."
    const notice = evt(r.events, 'landlordsNoticed');
    expect(notice.targetId).toBe('b');
    expect(JSON.stringify(notice)).not.toContain(expected.name);
  });

  it('rejects targeting the user themselves without mutating state (§9.4)', () => {
    const acting = drawAndPlayAction(aboutToDraw("Landlord's Notice"), 'a').state;
    const before = structuredClone(acting);
    const r = err(applyCommand(acting, {
      type: 'actionInput', player: 'a', input: { action: "Landlord's Notice", targetId: 'a' },
    }));
    expect(r.code).toBe('invalidTarget');
    expect(acting).toEqual(before);
  });

  it('reshuffles immediately when serving the last deck card (§9.1)', () => {
    const acting = drawAndPlayAction(aboutToDraw("Landlord's Notice"), 'a').state;
    const served = acting.deck[acting.deck.length - 1]!;
    expect(acting.deck).toHaveLength(1);

    const r = ok(applyCommand(acting, {
      type: 'actionInput', player: 'a', input: { action: "Landlord's Notice", targetId: 'b' },
    }));
    expect(evt(r.events, 'deckReshuffled').deckSize).toBe(1);
    expect(player(r.state, 'b').list[2]!.id).toBe(served.id);
    expect(r.state.deck.some((card) => card.id === served.id)).toBe(false);
    expect(doneTop(r.state).name).toBe("Landlord's Notice"); // top card stays out of the reshuffle
  });
});

describe("I'm Busy (§5)", () => {
  it("skips the target's next turn", () => {
    const acting = drawAndPlayAction(aboutToDraw("I'm Busy"), 'a').state;
    const r = ok(applyCommand(acting, {
      type: 'actionInput', player: 'a', input: { action: "I'm Busy", targetId: 'b' },
    }));
    // a's turn ends; b is skipped; play lands on c
    expect(evt(r.events, 'turnSkipped').player).toBe('b');
    expect(r.state.players[r.state.turn]!.id).toBe('c');
    expect(player(r.state, 'b').skipNextTurn).toBe(false); // consumed
  });

  it('is saturating: a second "I\'m Busy" before the skipped turn does not bank a second skip', () => {
    // c plays I'm Busy on a, then b plays I'm Busy on a. a misses one turn, then plays normally.
    const s = makeRound({
      players: [
        { id: 'a', list: ['Nap'] },
        { id: 'b', list: ['Nap'] },
        { id: 'c', list: ['Feed the Cat'] },
      ],
      deck: ["I'm Busy", "I'm Busy", 'Feed the Cat', 'Water the Plants'],
      turn: 1,
    });
    const afterB = play(s,
      { type: 'draw', player: 'b' },
      { type: 'discardDrawn', player: 'b', withAction: true },
      { type: 'actionInput', player: 'b', input: { action: "I'm Busy", targetId: 'a' } },
    ).state;
    expect(afterB.players[afterB.turn]!.id).toBe('c');
    const afterC = play(afterB,
      { type: 'draw', player: 'c' },
      { type: 'discardDrawn', player: 'c', withAction: true },
      { type: 'actionInput', player: 'c', input: { action: "I'm Busy", targetId: 'a' } },
    ).state;
    // a was skipped exactly once; play wrapped past a to b
    expect(afterC.players[afterC.turn]!.id).toBe('b');
    expect(player(afterC, 'a').skipNextTurn).toBe(false);
    // b and c take plain turns; a IS up after c (no second banked skip)
    const afterPlainB = play(afterC,
      { type: 'draw', player: 'b' },
      { type: 'discardDrawn', player: 'b', withAction: false },
    ).state;
    expect(afterPlainB.players[afterPlainB.turn]!.id).toBe('c');
    const next = play(afterPlainB,
      { type: 'draw', player: 'c' },
      { type: 'discardDrawn', player: 'c', withAction: false },
    ).state;
    expect(next.players[next.turn]!.id).toBe('a');
  });
});

describe('action framework', () => {
  it('performing is optional — cancelAction lets the discard stand with no effect (§5)', () => {
    const acting = drawAndPlayAction(aboutToDraw('Snoop'), 'a').state;
    const r = ok(applyCommand(acting, { type: 'cancelAction', player: 'a' }));
    expect(doneTop(r.state).name).toBe('Snoop');
    expect(r.state.pendingAction).toBeNull();
    expect(r.state.turn).toBe(1);
    expect(evts(r.events, 'peek')).toHaveLength(0);
  });

  it('only the actor may feed inputs, and only for the pending action', () => {
    const acting = drawAndPlayAction(aboutToDraw('Snoop'), 'a').state;
    expect(err(applyCommand(acting, {
      type: 'actionInput', player: 'b', input: { action: 'Snoop', targetId: 'a', slot: 0 },
    })).code).toBe('wrongPhase');
    expect(err(applyCommand(acting, {
      type: 'actionInput', player: 'a', input: { action: 'Check the List', slot: 0 },
    })).code).toBe('wrongAction');
  });

  it('turn actions are blocked while an action is resolving', () => {
    const acting = drawAndPlayAction(aboutToDraw('Snoop'), 'a').state;
    expect(err(applyCommand(acting, { type: 'draw', player: 'b' })).code).toBe('wrongPhase');
  });
});
