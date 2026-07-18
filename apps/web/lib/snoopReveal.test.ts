import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Card, RoundView } from '@lazy-sunday/engine';
import type { GameEvent } from './useGameSocket';
import { findSnoopReveal, SNOOP_REVEAL_MS, type PendingSnoopReveal } from './snoopReveal';

const card: Card = { id: 'secret', name: 'Nap', effort: 0, kind: 'chore' };
const pending: PendingSnoopReveal = {
  actor: 'a',
  owner: 'b',
  visualSlot: 4,
  afterSequence: 10,
  requestId: 7,
};

function peekEvent(
  sequence: number,
  overrides: Partial<Extract<GameEvent['event'], { type: 'peek' }>> = {},
): GameEvent {
  return {
    sequence,
    event: {
      type: 'peek',
      to: 'a',
      reason: 'action',
      reveals: [{ owner: 'b', slot: 1, visualSlot: 4, card }],
      ...overrides,
    },
  };
}

describe('Snoop result reveal', () => {
  it('uses a five-second display window', () => {
    assert.equal(SNOOP_REVEAL_MS, 5_000);
  });

  it('matches only the private peek produced after the submitted command', () => {
    assert.equal(findSnoopReveal([peekEvent(10)], pending, null), null);
    assert.deepEqual(findSnoopReveal([peekEvent(11)], pending, null), {
      owner: 'b',
      visualSlot: 4,
      card,
    });
  });

  it('ignores peeks for another recipient, owner, slot, or reason', () => {
    const events: GameEvent[] = [
      peekEvent(11, { to: 'c' }),
      peekEvent(12, { reason: 'setup' }),
      peekEvent(13, { reveals: [{ owner: 'c', slot: 1, visualSlot: 4, card }] }),
      peekEvent(14, { reveals: [{ owner: 'b', slot: 1, visualSlot: 5, card }] }),
    ];
    assert.equal(findSnoopReveal(events, pending, null), null);
  });

  it('maps a compact-only peek event to its stable visual slot', () => {
    const view = {
      players: [
        {
          id: 'b',
          listSize: 2,
          listSlots: [false, false, true, false, true],
          setupPeeked: true,
          skipNextTurn: false,
        },
      ],
    } as Pick<RoundView, 'players'>;
    const legacyEvent = peekEvent(11, {
      reveals: [{ owner: 'b', slot: 1, card }],
    });

    assert.deepEqual(findSnoopReveal([legacyEvent], pending, view), {
      owner: 'b',
      visualSlot: 4,
      card,
    });
  });
});
