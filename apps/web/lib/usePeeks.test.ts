import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Card, EngineEvent } from '@lazy-sunday/engine';
import {
  GRANTED_PEEK_MS,
  SETUP_PEEK_MS,
  peekTtlMs,
  reducePeek,
  type ActivePeek,
} from './usePeeks';

type PeekEvent = Extract<EngineEvent, { type: 'peek' }>;

function card(id: string, name: Card['name'], effort: number, kind: Card['kind']): Card {
  return { id, name, effort, kind };
}

const empty = new Map<string, ActivePeek>();

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

  it('re-processing the same setup peek keeps it at 10s (a re-render never shortens it)', () => {
    const first = reducePeek(
      empty,
      {
        type: 'peek',
        to: 'p',
        reason: 'setup',
        reveals: [{ owner: 'p', slot: 1, card: card('c', 'Feed the Cat', 2, 'chore') }],
      },
      500,
    );
    // A later re-application (e.g. an accidental duplicate render) still uses the
    // setup TTL — the duration is a property of the peek, not of when it is seen.
    const again = reducePeek(first, {
      type: 'peek',
      to: 'p',
      reason: 'setup',
      reveals: [{ owner: 'p', slot: 1, card: card('c', 'Feed the Cat', 2, 'chore') }],
    }, 800);
    assert.equal(again.get('p:1')?.expiresAt, 800 + SETUP_PEEK_MS);
    assert.equal(again.size, 1);
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
});
