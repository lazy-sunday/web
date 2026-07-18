import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Card, EngineEvent, RoundView } from '@lazy-sunday/engine';
import {
  GRANTED_PEEK_MS,
  SETUP_PEEK_MS,
  deadlineForPeek,
  invalidatePeeksForEvent,
  peekTtlMs,
  reducePeek,
  visualSlotForReveal,
  type ActivePeek,
} from './usePeeks';
import { appendEvent, eventsAfter, type SequencedEvent } from './eventLog';

type PeekEvent = Extract<EngineEvent, { type: 'peek' }>;

function card(id: string, name: Card['name'], effort: number, kind: Card['kind']): Card {
  return { id, name, effort, kind };
}

const empty = new Map<string, ActivePeek>();

function peekView(players: Array<{ id: string; listSlots: boolean[] }>): Pick<RoundView, 'players'> {
  return {
    players: players.map((player) => ({
      id: player.id,
      listSize: player.listSlots.filter(Boolean).length,
      listSlots: player.listSlots,
      skipNextTurn: false,
      setupPeeked: true,
    })),
  };
}

describe('peekTtlMs', () => {
  it('gives the §3.3 setup peek the long 10s reveal', () => {
    assert.equal(peekTtlMs('setup'), SETUP_PEEK_MS);
    assert.equal(SETUP_PEEK_MS, 10_000);
  });

  it('gives §5 granted peeks the shorter 4s reveal', () => {
    assert.equal(peekTtlMs('action'), GRANTED_PEEK_MS);
    assert.equal(GRANTED_PEEK_MS, 4_000);
  });
});

describe('reducePeek — issue #28 setup-peek race', () => {
  // Regression for #28: the LAST player to confirm their setup peek receives
  // the `peek` event together with a fresh view whose phase has already
  // advanced to `turn` (the engine flips it in the same applyCommand batch).
  // The reveal duration must come from the event's OWN reason, so a setup peek
  // still shows both faces for the full 10s. The old code derived the duration
  // from the live view phase, so this exact scenario shortened the reveal to 4s
  // (or dropped it when the setup panel unmounted) — this test fails on that path.
  it('shows both setup faces for the full 10s even when the phase is already `turn`', () => {
    const now = 1_000_000;
    const ev: PeekEvent = {
      type: 'peek',
      to: 'p_last',
      reason: 'setup', // engine tags the origin; phase is irrelevant here
      reveals: [
        { owner: 'p_last', slot: 0, card: card('c1', 'Nap', 0, 'chore') },
        { owner: 'p_last', slot: 4, card: card('c2', 'Vacuum the Living Room', 6, 'chore') },
      ],
    };

    const peeks = reducePeek(empty, ev, now);

    // Both selected faces are present…
    assert.equal(peeks.size, 2);
    assert.equal(peeks.get('p_last:0')?.card.name, 'Nap');
    assert.equal(peeks.get('p_last:4')?.card.name, 'Vacuum the Living Room');
    // …and each is timed for the full 10s setup reveal, not the 4s granted TTL.
    assert.equal(peeks.get('p_last:0')?.expiresAt, now + SETUP_PEEK_MS);
    assert.equal(peeks.get('p_last:4')?.expiresAt, now + SETUP_PEEK_MS);
  });

  it('uses the first tap deadline for a later setup card', () => {
    const firstAt = 1_000;
    const first: PeekEvent = {
      type: 'peek',
      to: 'p',
      reason: 'setup',
      reveals: [{ owner: 'p', slot: 0, card: card('first', 'Nap', 0, 'chore') }],
    };
    const second: PeekEvent = {
      type: 'peek',
      to: 'p',
      reason: 'setup',
      reveals: [{ owner: 'p', slot: 3, card: card('second', 'Fold the Laundry', 5, 'chore') }],
    };

    const afterFirst = reducePeek(empty, first, firstAt);
    const sharedDeadline = deadlineForPeek(afterFirst, second, firstAt + 3_000);
    const afterSecond = reducePeek(afterFirst, second, firstAt + 3_000);

    assert.equal(sharedDeadline, firstAt + SETUP_PEEK_MS);
    assert.equal(afterSecond.get('p:0')?.expiresAt, firstAt + SETUP_PEEK_MS);
    assert.equal(afterSecond.get('p:3')?.expiresAt, firstAt + SETUP_PEEK_MS);
    assert.equal(afterSecond.get('p:0')?.reason, 'setup');
    assert.equal(afterSecond.get('p:3')?.reason, 'setup');
  });

  it('processes a setup peek exactly once across re-renders', () => {
    const event: PeekEvent = {
      type: 'peek',
      to: 'p',
      reason: 'setup',
      reveals: [{ owner: 'p', slot: 1, card: card('c', 'Feed the Cat', 2, 'chore') }],
    };
    const log: SequencedEvent<PeekEvent>[] = [{ sequence: 7, event }];

    const firstBatch = eventsAfter(log, 0);
    const first = reducePeek(empty, firstBatch[0]!.event, 500);
    const cursor = firstBatch.at(-1)!.sequence;

    const rerenderBatch = eventsAfter(log, cursor);
    assert.equal(rerenderBatch.length, 0);
    assert.equal(first.get('p:1')?.expiresAt, 500 + SETUP_PEEK_MS);
    assert.equal(first.size, 1);
  });

  it('processes a setup peek that arrives after the 200-event window rolls over', () => {
    let log: SequencedEvent<EngineEvent>[] = [];
    for (let sequence = 1; sequence <= 200; sequence += 1) {
      log = appendEvent(log, { type: 'setupPeeked', player: 'someone' }, sequence, 200);
    }
    const cursor = log.at(-1)!.sequence;
    const peek: PeekEvent = {
      type: 'peek',
      to: 'p',
      reason: 'setup',
      reveals: [{ owner: 'p', slot: 2, card: card('late', 'Water the Plants', 3, 'chore') }],
    };
    log = appendEvent(log, peek, 201, 200);

    const newEvents = eventsAfter(log, cursor);
    assert.equal(newEvents.length, 1);
    const rolloverEvent = newEvents[0]!.event;
    assert.equal(rolloverEvent.type, 'peek');
    if (rolloverEvent.type !== 'peek') throw new Error('expected a private peek');
    const active = reducePeek(empty, rolloverEvent, 2_000);
    assert.equal(active.get('p:2')?.expiresAt, 2_000 + SETUP_PEEK_MS);
  });

  it('a §5 granted peek gets the 4s reveal', () => {
    const now = 42;
    const peeks = reducePeek(
      empty,
      {
        type: 'peek',
        to: 'p',
        reason: 'action',
        reveals: [{ owner: 'q', slot: 2, card: card('c', 'Snoop', 11, 'action') }],
      },
      now,
    );
    assert.equal(peeks.get('q:2')?.expiresAt, now + GRANTED_PEEK_MS);
  });

  it('gives an action peek a fresh 4s deadline even while setup cards are open', () => {
    const setup: PeekEvent = {
      type: 'peek',
      to: 'p',
      reason: 'setup',
      reveals: [{ owner: 'p', slot: 0, card: card('setup', 'Nap', 0, 'chore') }],
    };
    const action: PeekEvent = {
      type: 'peek',
      to: 'p',
      reason: 'action',
      reveals: [{ owner: 'q', slot: 1, card: card('action', 'Snoop', 11, 'action') }],
    };
    const afterSetup = reducePeek(empty, setup, 100);
    const afterAction = reducePeek(afterSetup, action, 2_000);

    assert.equal(afterAction.get('q:1')?.expiresAt, 2_000 + GRANTED_PEEK_MS);
    assert.equal(afterAction.get('p:0')?.expiresAt, 100 + SETUP_PEEK_MS);
  });
});

describe('stable visual peek slots — issue #45', () => {
  const gapped = peekView([{ id: 'p', listSlots: [true, false, true, true, true, true] }]);
  const revealedCard = card('peeked', 'Nap', 0, 'chore');

  it('stores a current peek by its explicit visual slot', () => {
    const event: PeekEvent = {
      type: 'peek',
      to: 'p',
      reason: 'action',
      reveals: [{ owner: 'p', slot: 3, visualSlot: 4, card: revealedCard }],
    };

    const active = reducePeek(empty, event, 1_000, undefined, gapped);

    assert.equal(active.get('p:4')?.card.id, revealedCard.id);
    assert.equal(active.has('p:3'), false);
  });

  it('resolves a compact-only legacy peek through the public occupancy map', () => {
    const reveal: PeekEvent['reveals'][number] = { owner: 'p', slot: 3, card: revealedCard };
    const event: PeekEvent = { type: 'peek', to: 'p', reason: 'action', reveals: [reveal] };

    assert.equal(visualSlotForReveal(reveal, gapped), 4);
    assert.equal(reducePeek(empty, event, 1_000, undefined, gapped).get('p:4')?.card.id, revealedCard.id);
  });

  it('does not transfer a Knock It Out reveal to visual slot 6 after slot 5 is discarded', () => {
    const event: PeekEvent = {
      type: 'peek',
      to: 'p',
      reason: 'action',
      reveals: [{ owner: 'p', slot: 3, visualSlot: 4, card: revealedCard }],
    };
    const active = reducePeek(empty, event, 1_000, undefined, gapped);
    const afterDiscard = peekView([{ id: 'p', listSlots: [true, false, true, true, false, true] }]);
    const knockedOut: EngineEvent = { type: 'knockedOut', player: 'p', card: revealedCard };

    assert.equal(active.has('p:5'), false);
    assert.equal(invalidatePeeksForEvent(active, knockedOut, afterDiscard).size, 0);
  });

  it('clears an old face when a draw or DONE card replaces the same visual slot', () => {
    const active = new Map<string, ActivePeek>([
      ['p:4', { card: revealedCard, reason: 'setup', expiresAt: 11_000 }],
    ]);
    const replacement = card('replacement', 'Feed the Cat', 2, 'chore');
    const kept: EngineEvent = {
      type: 'kept',
      player: 'p',
      slot: 3,
      visualSlot: 4,
      discarded: revealedCard,
    };
    const tookFromDone: EngineEvent = {
      type: 'tookFromDone',
      player: 'p',
      slot: 3,
      visualSlot: 4,
      taken: replacement,
      discarded: revealedCard,
    };

    assert.equal(invalidatePeeksForEvent(active, kept, gapped).has('p:4'), false);
    assert.equal(invalidatePeeksForEvent(active, tookFromDone, gapped).has('p:4'), false);
  });

  it('clears both sides of blind trades and Switcheroo', () => {
    const view = peekView([
      { id: 'p', listSlots: [true, false, true, true, true] },
      { id: 'q', listSlots: [true, true, false, true] },
    ]);
    const active = new Map<string, ActivePeek>([
      ['p:4', { card: revealedCard, reason: 'setup', expiresAt: 11_000 }],
      ['q:3', { card: card('other', 'Feed the Cat', 2, 'chore'), reason: 'action', expiresAt: 5_000 }],
    ]);
    const traded: EngineEvent = {
      type: 'traded',
      player: 'p',
      mySlot: 3,
      myVisualSlot: 4,
      opponentId: 'q',
      opponentSlot: 2,
      opponentVisualSlot: 3,
    };
    const switcherood: EngineEvent = {
      type: 'switcherood',
      player: 'actor',
      a: 'p',
      aSlot: 3,
      aVisualSlot: 4,
      b: 'q',
      bSlot: 2,
      bVisualSlot: 3,
    };

    assert.equal(invalidatePeeksForEvent(active, traded, view).size, 0);
    assert.equal(invalidatePeeksForEvent(active, switcherood, view).size, 0);
  });

  it('clears moved and newly filled visual positions', () => {
    const view = peekView([
      { id: 'p', listSlots: [true, false, true, true, true] },
      { id: 'q', listSlots: [true, true, true, true, true] },
    ]);
    const active = new Map<string, ActivePeek>([
      ['p:4', { card: revealedCard, reason: 'setup', expiresAt: 11_000 }],
      ['q:1', { card: card('vacated', 'Feed the Cat', 2, 'chore'), reason: 'action', expiresAt: 5_000 }],
    ]);
    const moved: EngineEvent = {
      type: 'notMyJobbed',
      player: 'actor',
      fromId: 'p',
      fromSlot: 3,
      fromVisualSlot: 4,
      toId: 'q',
      toSlot: 4,
      toVisualSlot: 4,
    };
    const gifted: EngineEvent = {
      type: 'giftGiven',
      from: 'p',
      to: 'q',
      toSlot: 1,
      toVisualSlot: 1,
    };

    const afterMove = invalidatePeeksForEvent(active, moved, view);
    assert.equal(afterMove.has('p:4'), false);
    assert.equal(invalidatePeeksForEvent(afterMove, gifted, view).has('q:1'), false);
  });
});
