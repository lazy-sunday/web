import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { afterEach, describe, it } from 'node:test';
import type { WebSocket } from 'ws';
import { applyCommand, CARD_SPECS, createRound } from '@lazy-sunday/engine';
import { handleConnection, timerMessageFor } from './gameRoom';
import { createRoom, type Room } from './rooms';

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

type Message = Record<string, any>;

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = this.OPEN;
  sent: Message[] = [];

  send(raw: string): void {
    this.sent.push(JSON.parse(raw) as Message);
  }

  message(message: Message): void {
    this.emit('message', Buffer.from(JSON.stringify(message)));
  }

  close(): void {
    if (this.readyState !== this.OPEN) return;
    this.readyState = 3;
    this.emit('close');
  }
}

interface TestPlayer {
  socket: FakeSocket;
  id: string;
  token: string;
}

interface TestRoom {
  room: Room;
  alice: TestPlayer;
  bob: TestPlayer;
  carol: TestPlayer;
  all: TestPlayer[];
}

const testRooms: Room[] = [];

afterEach(() => {
  for (const room of testRooms.splice(0)) {
    for (const timer of room.timers.values()) clearTimeout(timer);
    room.timers.clear();
    if (room.timerStartDelay) clearTimeout(room.timerStartDelay);
    room.timerStartDelay = null;
    room.roundRestartVote = null;
  }
});

function latest(player: TestPlayer, type: string): Message | undefined {
  for (let index = player.socket.sent.length - 1; index >= 0; index--) {
    const message = player.socket.sent[index]!;
    if (message.type === type) return message;
  }
  return undefined;
}

function latestError(player: TestPlayer): Message | undefined {
  return latest(player, 'error');
}

function currentVote(room: Room): NonNullable<Room['roundRestartVote']> {
  const vote = room.roundRestartVote;
  assert.ok(vote);
  return vote;
}

function connectPlayer(room: Room, name: string): TestPlayer {
  const socket = new FakeSocket();
  handleConnection(socket as unknown as WebSocket);
  socket.message({ type: 'join', roomCode: room.code, name, color: '#8FA2DC' });
  const joined = socket.sent.find((message) => message.type === 'joined');
  assert.ok(joined);
  return { socket, id: joined.playerId as string, token: joined.token as string };
}

function createPlayingRoom(options: { instantNotMe?: boolean } = {}): TestRoom {
  const room = createRoom();
  testRooms.push(room);
  const alice = connectPlayer(room, 'Alice');
  const bob = connectPlayer(room, 'Bob');
  const carol = connectPlayer(room, 'Carol');
  if (options.instantNotMe) {
    alice.socket.message({ type: 'setToggle', toggle: 'instantNotMe', value: true });
  }
  alice.socket.message({ type: 'startGame' });
  assert.equal(room.status, 'playing');
  return { room, alice, bob, carol, all: [alice, bob, carol] };
}

describe('command error correlation', () => {
  it('returns the request id with a rejected engine command', () => {
    const ctx = createPlayingRoom();
    ctx.alice.socket.message({
      type: 'command',
      requestId: 17,
      command: { type: 'setupPeek', slot: 99 },
    });

    assert.deepEqual(latestError(ctx.alice), {
      type: 'error',
      code: 'invalidSlot',
      message: 'pick a card from your own list',
      requestId: 17,
    });
  });
});

function propose(player: TestPlayer): number {
  player.socket.message({ type: 'proposeRoundRestart' });
  const update = latest(player, 'roundRestartVote')?.update;
  assert.equal(update?.status, 'active');
  return update.voteId as number;
}

describe('unanimous round restart vote', () => {
  it('redeals the same round for everyone without touching scores or match state', () => {
    const ctx = createPlayingRoom();
    const { room, alice, bob, carol } = ctx;
    const oldRound = room.round;
    const oldTimers = [...room.timers.values()];
    const oldScores = { ...room.session!.scores };
    const oldMatchOver = room.session!.matchOver;

    const voteId = propose(alice);
    bob.socket.message({ type: 'voteRoundRestart', voteId, approve: true });
    carol.socket.message({ type: 'voteRoundRestart', voteId, approve: true });

    assert.equal(room.roundRestartVote, null);
    assert.notEqual(room.round, oldRound);
    assert.equal(room.roundNumber, 1);
    assert.equal(room.status, 'playing');
    assert.equal(room.round?.phase, 'setupPeek');
    assert.deepEqual(room.session!.scores, oldScores);
    assert.equal(room.session!.matchOver, oldMatchOver);
    assert.equal(ctx.all.some((player) => player.socket.sent.some((message) => message.type === 'sessionEvent')), false);
    assert.equal(oldTimers.length, 3);
    assert.equal(room.timers.size, 3);
    assert.equal([...room.timers.values()].some((timer) => oldTimers.includes(timer)), false);

    for (const player of ctx.all) {
      assert.equal(latest(player, 'roundRestartVote')?.update.status, 'passed');
      assert.equal(latest(player, 'view')?.roundNumber, 1);
      assert.equal(latest(player, 'view')?.view.phase, 'setupPeek');
    }
  });

  it('broadcasts only public vote progress', () => {
    const ctx = createPlayingRoom();
    const voteId = propose(ctx.alice);
    ctx.bob.socket.message({ type: 'voteRoundRestart', voteId, approve: true });

    for (const player of ctx.all) {
      const messages = player.socket.sent.filter((message) => message.type === 'roundRestartVote');
      assert.ok(messages.length >= 2);
      const serialized = JSON.stringify(messages);
      assert.equal(serialized.includes('rngState'), false);
      assert.equal(serialized.includes('deck'), false);
      assert.equal(serialized.includes('list'), false);
      for (const card of CARD_SPECS) assert.equal(serialized.includes(card.name), false);
    }
  });

  it('rejects one no vote and refuses duplicate, overlapping, and stale commands', () => {
    const ctx = createPlayingRoom();
    const { room, alice, bob } = ctx;
    const oldRound = room.round;
    const oldTimers = [...room.timers.values()];
    const voteId = propose(alice);

    alice.socket.message({ type: 'proposeRoundRestart' });
    assert.equal(latestError(alice)?.code, 'voteActive');
    alice.socket.message({ type: 'voteRoundRestart', voteId, approve: true });
    assert.equal(latestError(alice)?.code, 'duplicateVote');

    bob.socket.message({ type: 'voteRoundRestart', voteId, approve: false });
    assert.equal(room.roundRestartVote, null);
    assert.equal(room.round, oldRound);
    assert.deepEqual([...room.timers.values()], oldTimers);
    assert.equal(latest(alice, 'roundRestartVote')?.update.status, 'rejected');

    bob.socket.message({ type: 'voteRoundRestart', voteId, approve: true });
    assert.equal(latestError(bob)?.code, 'staleVote');
  });

  it('cancels on disconnect or reconnect and rejects voters outside the snapshot', () => {
    const ctx = createPlayingRoom();
    const { room, alice, carol } = ctx;
    const oldRound = room.round;
    const firstVoteId = propose(alice);

    carol.socket.close();
    assert.equal(room.roundRestartVote, null);
    assert.equal(room.round, oldRound);
    assert.equal(latest(alice, 'roundRestartVote')?.update.status, 'cancelled');
    assert.equal(latest(alice, 'roundRestartVote')?.update.reason, 'rosterChanged');

    const secondVoteId = propose(alice);
    const activeVote = currentVote(room);
    assert.deepEqual(activeVote.eligibleVoters, [ctx.alice.id, ctx.bob.id]);
    carol.socket.message({ type: 'voteRoundRestart', voteId: secondVoteId, approve: true });
    assert.equal(room.roundRestartVote, activeVote);
    carol.socket.message({ type: 'voteRoundRestart', voteId: firstVoteId, approve: true });
    assert.equal(room.roundRestartVote, activeVote);

    const replacement = new FakeSocket();
    handleConnection(replacement as unknown as WebSocket);
    replacement.message({
      type: 'join',
      roomCode: room.code,
      name: 'Carol',
      color: '#8FA2DC',
      token: carol.token,
    });
    assert.equal(room.roundRestartVote, null);
    assert.equal(latest(alice, 'roundRestartVote')?.update.status, 'cancelled');
    assert.equal(latest(alice, 'roundRestartVote')?.update.reason, 'rosterChanged');
  });

  it('cancels an open vote when the round finishes normally', () => {
    const ctx = createPlayingRoom({ instantNotMe: true });
    for (const player of ctx.all) {
      const result = applyCommand(ctx.room.round!, { type: 'forceSkipTurn', player: player.id });
      assert.equal(result.ok, true);
      if (result.ok) ctx.room.round = result.state;
    }
    assert.equal(ctx.room.round?.phase, 'turn');
    propose(ctx.alice);

    ctx.alice.socket.message({ type: 'command', command: { type: 'callNotMe' } });

    assert.equal(ctx.room.status, 'between-rounds');
    assert.equal(ctx.room.roundRestartVote, null);
    assert.equal(latest(ctx.alice, 'roundRestartVote')?.update.status, 'cancelled');
    assert.equal(latest(ctx.alice, 'roundRestartVote')?.update.reason, 'roundEnded');
    assert.ok(ctx.alice.socket.sent.some((message) => message.type === 'event' && message.event.type === 'roundRevealed'));
  });
});
