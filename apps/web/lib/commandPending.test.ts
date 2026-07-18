import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { commandErrorMatches } from './commandPending';

describe('pending command error correlation', () => {
  it('matches only the error for the request currently in flight', () => {
    assert.equal(commandErrorMatches(7, { code: 'invalidSlot', message: 'no card', requestId: 7 }), true);
    assert.equal(commandErrorMatches(7, { code: 'invalidSlot', message: 'old error', requestId: 6 }), false);
    assert.equal(commandErrorMatches(7, { code: 'roomFull', message: 'unrelated' }), false);
    assert.equal(commandErrorMatches(null, { code: 'invalidSlot', message: 'no card', requestId: 7 }), false);
  });
});
