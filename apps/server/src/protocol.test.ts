import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EngineEvent } from '@lazy-sunday/engine';
import {
  TABLE_ACTIVITY_SPOTLIGHT_MS,
  hasTableActivitySpotlight,
  isTableActivitySpotlightEventType,
  parseClientMessage,
} from './protocol';

describe('table activity timer pause', () => {
  it('uses the shared seven-second spotlight duration', () => {
    assert.equal(TABLE_ACTIVITY_SPOTLIGHT_MS, 7_000);
  });

  it('pauses for actions and visible card placements', () => {
    const events: EngineEvent[] = [
      { type: 'actionStarted', player: 'a', action: 'Snoop' },
      { type: 'kept', player: 'a', slot: 0, discarded: null },
      { type: 'giftGiven', from: 'a', to: 'b', toSlot: 1 },
    ];

    for (const event of events) {
      assert.equal(hasTableActivitySpotlight([event]), true, event.type);
    }
  });

  it('classifies every center-spotlight event type', () => {
    const types: EngineEvent['type'][] = [
      'kept',
      'tookFromDone',
      'actionStarted',
      'actionCancelled',
      'checkedTheList',
      'knockItOutPeeked',
      'knockedOut',
      'knockItOutKept',
      'traded',
      'switcherood',
      'snooped',
      'notMyJobbed',
      'landlordsNoticed',
      'imBusied',
      'giftGiven',
    ];

    for (const type of types) assert.equal(isTableActivitySpotlightEventType(type), true, type);
  });

  it('does not pause for private or log-only events', () => {
    const events: EngineEvent[] = [
      { type: 'drew', player: 'a' },
      { type: 'turnStarted', player: 'b', finalTurn: false },
      { type: 'drawnCard', to: 'a', card: { id: 'secret', name: 'Nap', effort: 0, kind: 'chore' } },
    ];

    for (const event of events) {
      assert.equal(hasTableActivitySpotlight([event]), false, event.type);
    }
  });
});

describe('round restart vote protocol', () => {
  it('accepts proposal and well-formed vote messages', () => {
    assert.deepEqual(
      parseClientMessage(JSON.stringify({ type: 'proposeRoundRestart' })),
      { type: 'proposeRoundRestart' },
    );
    assert.deepEqual(
      parseClientMessage(JSON.stringify({ type: 'voteRoundRestart', voteId: 3, approve: true })),
      { type: 'voteRoundRestart', voteId: 3, approve: true },
    );
  });

  it('rejects malformed and stale-looking vote ids at the wire boundary', () => {
    const invalid = [
      { type: 'voteRoundRestart', voteId: 0, approve: true },
      { type: 'voteRoundRestart', voteId: 1.5, approve: true },
      { type: 'voteRoundRestart', voteId: 1, approve: 'yes' },
    ];
    for (const message of invalid) {
      assert.equal(parseClientMessage(JSON.stringify(message)), null);
    }
  });
});
