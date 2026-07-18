import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RoundView } from '@lazy-sunday/engine';
import { encodeClientCommand } from './slotProtocol';

const view: RoundView = {
  phase: 'drawn',
  currentPlayer: 'a',
  caller: null,
  finalTurnQueue: [],
  deckCount: 20,
  doneCount: 2,
  doneTop: null,
  players: [
    { id: 'a', listSize: 5, listSlots: [true, false, true, true, true, true], skipNextTurn: false, setupPeeked: true },
    { id: 'b', listSize: 5, listSlots: [true, true, false, true, true, true], skipNextTurn: false, setupPeeked: true },
    { id: 'c', listSize: 5, listSlots: [true, true, true, false, true, true], skipNextTurn: false, setupPeeked: true },
  ],
  mySetupPeekSlots: [],
  myDrawnCard: null,
  myDrawnActionUnavailableReason: null,
  pendingAction: null,
  pendingGift: null,
  result: null,
};

describe('slot command compatibility encoding', () => {
  it('sends a compact legacy slot and an explicit visual slot', () => {
    for (const type of ['setupPeek', 'keepDrawn', 'takeFromDone', 'giveCard'] as const) {
      assert.deepEqual(
        encodeClientCommand({ type, slot: 5 }, view, 'a'),
        { type, slot: 4, visualSlot: 5 },
      );
    }
    assert.deepEqual(
      encodeClientCommand({ type: 'slap', owner: 'b', slot: 5, expectedTopId: 'top' }, view, 'a'),
      { type: 'slap', owner: 'b', slot: 4, visualSlot: 5, expectedTopId: 'top' },
    );
  });

  it('encodes every action slot in both coordinate spaces', () => {
    for (const action of ['Check the List', 'Knock It Out'] as const) {
      assert.deepEqual(
        encodeClientCommand({ type: 'actionInput', input: { action, slot: 5 } }, view, 'a'),
        { type: 'actionInput', input: { action, slot: 4, visualSlot: 5 } },
      );
    }
    assert.deepEqual(
      encodeClientCommand({
        type: 'actionInput',
        input: { action: "Let's Trade", mySlot: 5, opponentId: 'b', opponentSlot: 5 },
      }, view, 'a'),
      {
        type: 'actionInput',
        input: {
          action: "Let's Trade",
          mySlot: 4,
          myVisualSlot: 5,
          opponentId: 'b',
          opponentSlot: 4,
          opponentVisualSlot: 5,
        },
      },
    );
    assert.deepEqual(
      encodeClientCommand({
        type: 'actionInput',
        input: { action: 'Switcheroo', a: 'b', aSlot: 5, b: 'c', bSlot: 5 },
      }, view, 'a'),
      {
        type: 'actionInput',
        input: {
          action: 'Switcheroo',
          a: 'b',
          aSlot: 4,
          aVisualSlot: 5,
          b: 'c',
          bSlot: 4,
          bVisualSlot: 5,
        },
      },
    );
    assert.deepEqual(
      encodeClientCommand({
        type: 'actionInput',
        input: { action: 'Snoop', targetId: 'b', slot: 5 },
      }, view, 'a'),
      {
        type: 'actionInput',
        input: { action: 'Snoop', targetId: 'b', slot: 4, visualSlot: 5 },
      },
    );
    assert.deepEqual(
      encodeClientCommand({
        type: 'actionInput',
        input: { action: 'Not My Job', fromId: 'b', fromSlot: 5, toId: 'c' },
      }, view, 'a'),
      {
        type: 'actionInput',
        input: {
          action: 'Not My Job',
          fromId: 'b',
          fromSlot: 4,
          fromVisualSlot: 5,
          toId: 'c',
        },
      },
    );
  });
});
