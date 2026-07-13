import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EngineEvent } from '@lazy-sunday/engine';
import { activityEntryKey, buildActivityLog, latestSpotlightEntry } from './activity';

const nameOf = (id: string | null) => id ? ({ a: 'Alice', b: 'Bob', c: 'Carol' }[id] ?? id) : '—';

describe('table activity spotlight', () => {
  it('folds a blind trade into one action and highlights both public slots', () => {
    const events: EngineEvent[] = [
      { type: 'actionStarted', player: 'a', action: "Let's Trade" },
      { type: 'traded', player: 'a', mySlot: 1, opponentId: 'b', opponentSlot: 0 },
    ];

    const entries = buildActivityLog(events, nameOf);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.status, 'resolved');
    assert.equal(entries[0]?.text, "Alice blind-swapped their card (slot 2) with Bob's (slot 1).");
    assert.deepEqual(entries[0]?.visual, {
      kind: 'swap',
      slots: [
        { player: 'a', slot: 1, role: 'swap' },
        { player: 'b', slot: 0, role: 'swap' },
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
    assert.equal(entry?.text, 'Bob kept the drawn card (slot 3).');
    assert.deepEqual(entry?.visual, {
      kind: 'focus',
      slots: [{ player: 'b', slot: 2, role: 'target' }],
    });
  });

  it('keeps an outcome eligible for the center spotlight when its start was missed', () => {
    const outcome: EngineEvent = { type: 'snooped', player: 'a', targetId: 'b', slot: 1 };
    const entry = latestSpotlightEntry(buildActivityLog([outcome], nameOf));

    assert.equal(entry?.isAction, true);
    assert.equal(entry?.action, 'Snoop');
    assert.equal(entry?.text, "Alice snooped Bob's card (slot 2).");
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
});
