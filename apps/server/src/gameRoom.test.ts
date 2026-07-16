import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRound } from '@lazy-sunday/engine';
import { timerMessageFor } from './gameRoom';
import { createRoom } from './rooms';

describe('turn timer messages', () => {
  it('shows each setup player only their own authoritative remaining time', () => {
    const room = createRoom();
    room.status = 'playing';
    room.round = createRound({ players: ['a', 'b'], startingPlayer: 0, seed: 1 });
    room.turnDeadlines.set('a', 1_100);
    room.turnDeadlines.set('b', 2_100);

    assert.deepEqual(timerMessageFor(room, 'a', 100), {
      type: 'turnTimer',
      remainingMs: 1_000,
      players: ['a', 'b'],
    });
    assert.deepEqual(timerMessageFor(room, 'b', 100), {
      type: 'turnTimer',
      remainingMs: 2_000,
      players: ['a', 'b'],
    });
  });

  it('shows the active normal-play countdown to every player', () => {
    const room = createRoom();
    room.status = 'playing';
    room.round = createRound({ players: ['a', 'b'], startingPlayer: 0, seed: 2 });
    room.round.phase = 'turn';
    room.turnDeadlines.set('a', 1_100);

    assert.deepEqual(timerMessageFor(room, 'b', 100), {
      type: 'turnTimer',
      remainingMs: 1_000,
      players: ['a'],
    });
  });

  it('reports a paused clock when the recipient has no setup deadline', () => {
    const room = createRoom();
    room.status = 'playing';
    room.round = createRound({ players: ['a', 'b'], startingPlayer: 0, seed: 3 });
    room.turnDeadlines.set('b', 2_100);

    assert.deepEqual(timerMessageFor(room, 'a', 100), {
      type: 'turnTimer',
      remainingMs: null,
      players: ['a', 'b'],
    });
  });
});
