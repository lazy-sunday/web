import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appendEvent, eventsAfter, type SequencedEvent } from './eventLog';

describe('sequenced capped event log', () => {
  it('still exposes the newest event after the retained window rolls over', () => {
    let events: SequencedEvent<number>[] = [];
    for (let sequence = 1; sequence <= 200; sequence += 1) {
      events = appendEvent(events, sequence, sequence, 200);
    }

    const cursor = events.at(-1)!.sequence;
    events = appendEvent(events, 201, 201, 200);

    assert.equal(events.length, 200);
    assert.equal(events[0]?.sequence, 2);
    assert.deepEqual(eventsAfter(events, cursor), [{ sequence: 201, event: 201 }]);
  });

  it('returns each sequence exactly once as a consumer advances its cursor', () => {
    const events: SequencedEvent<string>[] = [
      { sequence: 40, event: 'public status' },
      { sequence: 41, event: 'private peek' },
    ];

    const first = eventsAfter(events, 40);
    assert.deepEqual(first, [{ sequence: 41, event: 'private peek' }]);

    const cursor = first.at(-1)!.sequence;
    assert.deepEqual(eventsAfter(events, cursor), []);
  });

  it('lets a lagging consumer process every event still retained by the cap', () => {
    const events: SequencedEvent<number>[] = [
      { sequence: 198, event: 198 },
      { sequence: 199, event: 199 },
      { sequence: 200, event: 200 },
    ];

    assert.deepEqual(eventsAfter(events, 150), events);
  });
});
