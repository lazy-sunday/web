import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRound } from '@lazy-sunday/engine';
import { normalizeClientCommand } from './slotProtocol';

function roundWithGaps() {
  const state = createRound({ players: ['a', 'b', 'c'], startingPlayer: 0, seed: 1 });
  for (const player of state.players) {
    player.list.splice(1, 1);
    player.slotPositions = [0, 2, 3, 4, 5];
  }
  return state;
}

describe('slot command compatibility normalization', () => {
  it('translates compact slots from an older client into visual engine slots', () => {
    const state = roundWithGaps();
    for (const type of ['setupPeek', 'keepDrawn', 'takeFromDone', 'giveCard'] as const) {
      assert.deepEqual(
        normalizeClientCommand(state, 'a', { type, slot: 4 }),
        { type, player: 'a', slot: 5 },
      );
    }
    assert.deepEqual(
      normalizeClientCommand(state, 'a', { type: 'slap', owner: 'b', slot: 4 }),
      { type: 'slap', player: 'a', owner: 'b', slot: 5 },
    );
    assert.deepEqual(
      normalizeClientCommand(state, 'a', {
        type: 'actionInput',
        input: { action: 'Snoop', targetId: 'b', slot: 4 },
      }),
      {
        type: 'actionInput',
        player: 'a',
        input: { action: 'Snoop', targetId: 'b', slot: 5 },
      },
    );
    assert.deepEqual(
      normalizeClientCommand(state, 'a', {
        type: 'actionInput',
        input: { action: 'Not My Job', fromId: 'b', fromSlot: 4, toId: 'c' },
      }),
      {
        type: 'actionInput',
        player: 'a',
        input: { action: 'Not My Job', fromId: 'b', fromSlot: 5, toId: 'c' },
      },
    );
  });

  it('prefers explicit visual slots from a current client', () => {
    const state = roundWithGaps();
    assert.deepEqual(
      normalizeClientCommand(state, 'a', { type: 'keepDrawn', slot: 3, visualSlot: 4 }),
      { type: 'keepDrawn', player: 'a', slot: 4 },
    );
    assert.deepEqual(
      normalizeClientCommand(state, 'a', {
        type: 'actionInput',
        input: {
          action: 'Switcheroo',
          a: 'b',
          aSlot: 3,
          aVisualSlot: 4,
          b: 'c',
          bSlot: 4,
          bVisualSlot: 5,
        },
      }),
      {
        type: 'actionInput',
        player: 'a',
        input: { action: 'Switcheroo', a: 'b', aSlot: 4, b: 'c', bSlot: 5 },
      },
    );
  });
});
