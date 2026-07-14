import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlayerId } from '@lazy-sunday/engine';
import { orderOpponentSeats } from './tableSeats';

const id = (value: string) => value as PlayerId;

test('orders opponents by their stable room seats and excludes the current player', () => {
  const players = [{ id: id('c') }, { id: id('me') }, { id: id('a') }, { id: id('b') }];
  const lobby = [
    { id: id('me'), seat: 0, connected: true },
    { id: id('a'), seat: 1, connected: true },
    { id: id('b'), seat: 2, connected: false },
    { id: id('c'), seat: 3, connected: true },
  ];

  assert.deepEqual(
    orderOpponentSeats(players, lobby, id('me')).map(({ player, seat }) => [player.id, seat]),
    [
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ],
  );
});

test('carries presence into each seat and treats missing lobby metadata as disconnected', () => {
  const seats = orderOpponentSeats(
    [{ id: id('missing') }, { id: id('offline') }],
    [{ id: id('offline'), seat: 1, connected: false }],
    id('me'),
  );

  assert.deepEqual(
    seats.map(({ player, connected }) => [player.id, connected]),
    [
      ['offline', false],
      ['missing', false],
    ],
  );
});
