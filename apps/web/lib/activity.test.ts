import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Card, EngineEvent } from '@lazy-sunday/engine';
import {
  activityEntryKey,
  buildActivityLog,
  isTableHandoffBlocked,
  latestSpotlightEntry,
} from './activity';

const nameOf = (id: string | null) => id ? ({ a: 'Alice', b: 'Bob', c: 'Carol' }[id] ?? id) : '—';
const nap: Card = { id: 'nap', name: 'Nap', effort: 0, kind: 'chore' };

describe('table activity spotlight', () => {
  it('uses the approved short center copy for every spotlight message', () => {
    const cases: { label: string; events: EngineEvent[]; expected: string }[] = [
      {
        label: 'action starts',
        events: [{ type: 'actionStarted', player: 'a', action: 'Snoop' }],
        expected: 'Alice: Snoop...',
      },
      {
        label: 'action cancelled',
        events: [{ type: 'actionCancelled', player: 'a', action: 'Snoop' }],
        expected: 'Alice skipped Snoop.',
      },
      {
        label: 'Check the List',
        events: [{ type: 'checkedTheList', player: 'a', slot: 0, visualSlot: 2 }],
        expected: 'Alice checked slot 3.',
      },
      {
        label: 'Knock It Out choosing',
        events: [{ type: 'knockItOutPeeked', player: 'a', slot: 0, visualSlot: 1 }],
        expected: 'Alice is choosing slot 2...',
      },
      {
        label: 'Knock It Out discarded',
        events: [{ type: 'knockedOut', player: 'a', card: nap }],
        expected: 'Alice discarded Nap.',
      },
      {
        label: 'Knock It Out kept',
        events: [
          { type: 'actionStarted', player: 'a', action: 'Knock It Out' },
          { type: 'knockItOutPeeked', player: 'a', slot: 0, visualSlot: 4 },
          { type: 'knockItOutKept', player: 'a' },
        ],
        expected: 'Alice kept slot 5.',
      },
      {
        label: "Let's Trade",
        events: [{
          type: 'traded',
          player: 'a',
          mySlot: 0,
          myVisualSlot: 2,
          opponentId: 'b',
          opponentSlot: 0,
          opponentVisualSlot: 0,
        }],
        expected: "Alice swapped slot 3 with Bob's slot 1.",
      },
      {
        label: 'Switcheroo',
        events: [{
          type: 'switcherood',
          player: 'a',
          a: 'b',
          aSlot: 0,
          aVisualSlot: 1,
          b: 'c',
          bSlot: 0,
          bVisualSlot: 3,
        }],
        expected: "Alice swapped Bob's slot 2 with Carol's slot 4.",
      },
      {
        label: 'Snoop',
        events: [{ type: 'snooped', player: 'a', targetId: 'b', slot: 0, visualSlot: 3 }],
        expected: "Alice snooped on Bob's slot 4.",
      },
      {
        label: 'Not My Job',
        events: [{
          type: 'notMyJobbed',
          player: 'a',
          fromId: 'b',
          fromSlot: 0,
          fromVisualSlot: 2,
          toId: 'c',
          toSlot: 0,
          toVisualSlot: 5,
        }],
        expected: "Alice moved Bob's slot 3 to Carol's slot 6.",
      },
      {
        label: "Landlord's Notice",
        events: [{ type: 'landlordsNoticed', player: 'a', targetId: 'b', slot: 0, visualSlot: 4 }],
        expected: 'Alice gave Bob a card at slot 5.',
      },
      {
        label: "I'm Busy",
        events: [{ type: 'imBusied', player: 'a', targetId: 'b' }],
        expected: "Alice skipped Bob's next turn.",
      },
      {
        label: 'kept drawn card',
        events: [{ type: 'kept', player: 'a', slot: 0, visualSlot: 2, discarded: nap }],
        expected: 'Alice kept the card at slot 3.',
      },
      {
        label: 'took from DONE',
        events: [{ type: 'tookFromDone', player: 'a', slot: 0, visualSlot: 1, taken: nap, discarded: nap }],
        expected: 'Alice took Nap from DONE at slot 2.',
      },
      {
        label: 'gift given',
        events: [{ type: 'giftGiven', from: 'a', to: 'b', toSlot: 0, toVisualSlot: 3 }],
        expected: 'Alice gave Bob a card at slot 4.',
      },
    ];

    for (const testCase of cases) {
      const entry = latestSpotlightEntry(buildActivityLog(testCase.events, nameOf));
      assert.equal(entry?.centerText, testCase.expected, testCase.label);
    }
  });

  it('uses short fallback copy when legacy events have no visual slots', () => {
    const cases: { label: string; events: EngineEvent[]; expected: string }[] = [
      {
        label: 'Check the List',
        events: [{ type: 'checkedTheList', player: 'a', slot: 0 }],
        expected: 'Alice checked a card.',
      },
      {
        label: 'Knock It Out choosing',
        events: [{ type: 'knockItOutPeeked', player: 'a', slot: 0 }],
        expected: 'Alice is choosing...',
      },
      {
        label: 'Knock It Out kept',
        events: [
          { type: 'knockItOutPeeked', player: 'a', slot: 0 },
          { type: 'knockItOutKept', player: 'a' },
        ],
        expected: 'Alice kept the card.',
      },
      {
        label: "Let's Trade",
        events: [{ type: 'traded', player: 'a', mySlot: 0, opponentId: 'b', opponentSlot: 0 }],
        expected: 'Alice swapped with Bob.',
      },
      {
        label: 'Switcheroo',
        events: [{ type: 'switcherood', player: 'a', a: 'b', aSlot: 0, b: 'c', bSlot: 0 }],
        expected: 'Alice swapped Bob and Carol.',
      },
      {
        label: 'Snoop',
        events: [{ type: 'snooped', player: 'a', targetId: 'b', slot: 0 }],
        expected: 'Alice snooped on Bob.',
      },
      {
        label: 'Not My Job',
        events: [{ type: 'notMyJobbed', player: 'a', fromId: 'b', fromSlot: 0, toId: 'c', toSlot: 0 }],
        expected: "Alice moved Bob's card to Carol.",
      },
      {
        label: "Landlord's Notice",
        events: [{ type: 'landlordsNoticed', player: 'a', targetId: 'b', slot: 0 }],
        expected: 'Alice gave Bob a card.',
      },
      {
        label: 'kept drawn card',
        events: [{ type: 'kept', player: 'a', slot: 0, discarded: nap }],
        expected: 'Alice kept the card.',
      },
      {
        label: 'took from DONE',
        events: [{ type: 'tookFromDone', player: 'a', slot: 0, taken: nap, discarded: nap }],
        expected: 'Alice took Nap from DONE.',
      },
      {
        label: 'gift given',
        events: [{ type: 'giftGiven', from: 'a', to: 'b', toSlot: 0 }],
        expected: 'Alice gave Bob a card.',
      },
    ];

    for (const testCase of cases) {
      const entry = latestSpotlightEntry(buildActivityLog(testCase.events, nameOf));
      assert.equal(entry?.centerText, testCase.expected, testCase.label);
    }
  });

  it('folds a blind trade into one action and highlights both public slots', () => {
    const events: EngineEvent[] = [
      { type: 'actionStarted', player: 'a', action: "Let's Trade" },
      { type: 'traded', player: 'a', mySlot: 1, opponentId: 'b', opponentSlot: 0 },
    ];

    const entries = buildActivityLog(events, nameOf);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.status, 'resolved');
    assert.equal(entries[0]?.text, "Alice blind-swapped their card with Bob's.");
    assert.deepEqual(entries[0]?.visual, {
      kind: 'swap',
      slots: [
        { player: 'a', slot: 1, space: 'compact', role: 'swap' },
        { player: 'b', slot: 0, space: 'compact', role: 'swap' },
      ],
    });
  });

  it('spotlights a kept card and its destination slot', () => {
    const kept: EngineEvent = {
      type: 'kept',
      player: 'b',
      slot: 2,
      discarded: { id: 'public-1', name: 'Nap', effort: 0, kind: 'chore' },
    };

    const entry = latestSpotlightEntry(buildActivityLog([kept], nameOf));
    assert.equal(entry?.text, 'Bob kept the drawn card.');
    assert.deepEqual(entry?.visual, {
      kind: 'focus',
      slots: [{ player: 'b', slot: 2, space: 'compact', role: 'target' }],
    });
  });

  it('uses original visual slots when compact slots have shifted after gaps', () => {
    const kept: EngineEvent = {
      type: 'kept',
      player: 'b',
      slot: 2,
      visualSlot: 5,
      discarded: { id: 'public-1', name: 'Nap', effort: 0, kind: 'chore' },
    };

    const entry = latestSpotlightEntry(buildActivityLog([kept], nameOf));
    assert.equal(entry?.text, 'Bob kept the drawn card (slot 6).');
    assert.deepEqual(entry?.visual, {
      kind: 'focus',
      slots: [{ player: 'b', slot: 5, space: 'visual', role: 'target' }],
    });
  });

  it('keeps legacy Landlord events in compact slot space', () => {
    const events: EngineEvent[] = [
      { type: 'actionStarted', player: 'a', action: "Landlord's Notice" },
      { type: 'landlordsNoticed', player: 'a', targetId: 'b', slot: 5 },
    ];

    const entry = latestSpotlightEntry(buildActivityLog(events, nameOf));
    assert.equal(entry?.text, "Alice slid a face-down card onto Bob's list.");
    assert.deepEqual(entry?.visual, {
      kind: 'move',
      slots: [{ player: 'b', slot: 5, space: 'compact', role: 'target' }],
    });
  });

  it('keeps an outcome eligible for the center spotlight when its start was missed', () => {
    const outcome: EngineEvent = { type: 'snooped', player: 'a', targetId: 'b', slot: 1 };
    const entry = latestSpotlightEntry(buildActivityLog([outcome], nameOf));

    assert.equal(entry?.isAction, true);
    assert.equal(entry?.action, 'Snoop');
    assert.equal(entry?.text, "Alice snooped Bob's card.");
  });

  it('does not expose private peek or drawn-card identities in activity text', () => {
    const secret = { id: 'secret-card', name: 'Vacuum the Living Room' as const, effort: 6, kind: 'chore' as const };
    const events: EngineEvent[] = [
      { type: 'peek', to: 'a', reason: 'action', reveals: [{ owner: 'b', slot: 0, card: secret }] },
      { type: 'drawnCard', to: 'a', card: secret },
    ];

    assert.deepEqual(buildActivityLog(events, nameOf), []);
  });

  it('keeps the spotlight key stable when unrelated events arrive', () => {
    const ids = new WeakMap<object, number>();
    let nextId = 1;
    const idOf = (event: EngineEvent) => {
      const known = ids.get(event);
      if (known !== undefined) return known;
      const id = nextId;
      nextId += 1;
      ids.set(event, id);
      return id;
    };
    const started: EngineEvent = { type: 'actionStarted', player: 'a', action: 'Snoop' };
    const outcome: EngineEvent = { type: 'snooped', player: 'a', targetId: 'b', slot: 0 };
    const unrelated: EngineEvent = { type: 'drew', player: 'b' };

    const before = latestSpotlightEntry(buildActivityLog([started, outcome], nameOf, idOf));
    const after = latestSpotlightEntry(buildActivityLog([started, outcome, unrelated], nameOf, idOf));

    assert.equal(activityEntryKey(before), activityEntryKey(after));
  });

  it('blocks only the incoming player until the previous move leaves the spotlight', () => {
    const previousMove = latestSpotlightEntry(buildActivityLog([
      {
        type: 'kept',
        player: 'a',
        slot: 0,
        discarded: { id: 'public-1', name: 'Nap', effort: 0, kind: 'chore' },
      },
    ], nameOf));

    assert.equal(isTableHandoffBlocked(previousMove, 'b', 'b'), true);
    assert.equal(isTableHandoffBlocked(previousMove, 'b', 'a'), false);
    assert.equal(isTableHandoffBlocked(previousMove, 'a', 'a'), false);
    assert.equal(isTableHandoffBlocked(null, 'b', 'b'), false);
  });
});
