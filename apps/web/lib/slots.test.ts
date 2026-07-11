import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderSlotsFor } from './slots';

describe('renderSlotsFor', () => {
  it('preserves explicit visual gaps from current player views', () => {
    assert.deepEqual(renderSlotsFor({ listSize: 2, listSlots: [true, false, true] }), [
      { visualSlot: 0, cardSlot: 0, occupied: true },
      { visualSlot: 1, cardSlot: null, occupied: false },
      { visualSlot: 2, cardSlot: 1, occupied: true },
    ]);
  });

  it('reconstructs a compact list from legacy views without listSlots', () => {
    assert.deepEqual(renderSlotsFor({ listSize: 3 }), [
      { visualSlot: 0, cardSlot: 0, occupied: true },
      { visualSlot: 1, cardSlot: 1, occupied: true },
      { visualSlot: 2, cardSlot: 2, occupied: true },
    ]);
  });

  it('returns no slots when the player view is unavailable', () => {
    assert.deepEqual(renderSlotsFor(null), []);
    assert.deepEqual(renderSlotsFor(undefined), []);
  });
});
