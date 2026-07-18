// Bridges WebSocket connections to the engine.
//
// Serial processing: ws delivers message callbacks one at a time on the single
// JS thread, and every handler below is fully synchronous — no awaits between
// reading a message and committing the resulting state. That serialization IS
// the slap arbitration (§9.6: "first tap registered by the server wins"): the
// first slap mutates the DONE top, and later slaps for the same match fail the
// engine's expectedTopId staleness check and come back as slapTooLate.
//
// PRIVACY: clients only ever receive RoundView (viewFor) and per-player-filtered
// EngineEvents. RoundState never touches JSON.stringify here.

import type { WebSocket } from 'ws';
import {
  applyCommand,
  applyRoundScores,
  createRound,
  createSession,
  isValidDeckCount,
  SETUP_PEEK_MS,
  eventVisibleTo,
  viewFor,
  type Command,
  type EngineEvent,
  type PlayerId,
  type RoundState,
} from '@lazy-sunday/engine';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  createRoom,
  getRoom,
  lobbyStateOf,
  markConnectivity,
  maybeReassignHost,
  newPlayerId,
  newSeed,
  newToken,
  startingSeatForRound,
  type Room,
  type RoomPlayer,
} from './rooms.js';
import {
  TABLE_ACTIVITY_SPOTLIGHT_MS,
  hasTableActivitySpotlight,
  parseClientMessage,
  type ClientMessage,
  type ServerMessage,
} from './protocol.js';
import { normalizeClientCommand } from './slotProtocol.js';

// Slap rate limit: max 3 slap commands per 2 seconds per client.
const SLAP_WINDOW_MS = 2_000;
const SLAP_MAX_IN_WINDOW = 3;

interface Conn {
  socket: WebSocket;
  room: Room | null;
  player: RoomPlayer | null;
}

export function handleConnection(socket: WebSocket): void {
  const conn: Conn = { socket, room: null, player: null };

  socket.on('message', (raw: Buffer) => {
    const msg = parseClientMessage(raw.toString());
    if (!msg) {
      send(socket, { type: 'error', code: 'badMessage', message: 'unparseable message' });
      return;
    }
    try {
      handleMessage(conn, msg);
    } catch (err) {
      // Never let one bad message take the process down.
      console.error('[gameRoom] handler error:', err);
      send(socket, { type: 'error', code: 'internal', message: 'internal server error' });
    }
  });

  socket.on('close', () => {
    const { room, player } = conn;
    if (!room || !player || player.socket !== socket) return;
    player.socket = null;
    player.connected = false;
    player.disconnectedAt = Date.now();
    markConnectivity(room);
    if (maybeReassignHost(room)) {
      // Host badge moved after a long host absence.
    }
    cancelRoundRestartVote(room, 'rosterChanged');
    broadcastLobby(room);
    // Timers keep running: a disconnected player's turn auto-skips on timeout.
  });
}

// ---------------------------------------------------------------------------
// Message dispatch
// ---------------------------------------------------------------------------

function handleMessage(conn: Conn, msg: ClientMessage): void {
  if (msg.type === 'ping') {
    send(conn.socket, { type: 'pong' });
    return;
  }
  if (msg.type === 'join') {
    handleJoin(conn, msg);
    return;
  }
  const { room, player } = conn;
  if (!room || !player) {
    send(conn.socket, { type: 'error', code: 'notJoined', message: 'join a room first' });
    return;
  }

  switch (msg.type) {
    case 'setToggle':
      handleSetToggle(room, player, msg);
      return;
    case 'startGame':
      handleStartGame(room, player);
      return;
    case 'command':
      handleCommand(room, player, msg.command);
      return;
    case 'nextRound':
      handleNextRound(room, player);
      return;
    case 'proposeRoundRestart':
      handleProposeRoundRestart(room, player);
      return;
    case 'voteRoundRestart':
      handleVoteRoundRestart(room, player, msg);
      return;
    case 'reaction':
      broadcast(room, { type: 'reaction', player: player.id, emoji: msg.emoji });
      return;
  }
}

// ---------------------------------------------------------------------------
// Join / reconnection
// ---------------------------------------------------------------------------

function handleJoin(conn: Conn, msg: Extract<ClientMessage, { type: 'join' }>): void {
  const room = getRoom(msg.roomCode);
  if (!room) {
    send(conn.socket, { type: 'error', code: 'roomNotFound', message: `no room ${msg.roomCode}` });
    return;
  }

  // Reconnection: the same token reattaches this socket to its seat.
  if (msg.token) {
    const existing = room.players.find((p) => p.token === msg.token);
    if (existing) {
      if (existing.socket && existing.socket !== conn.socket) {
        try {
          existing.socket.close(4000, 'replaced by a newer connection');
        } catch {
          /* already dead */
        }
      }
      existing.socket = conn.socket;
      existing.connected = true;
      existing.disconnectedAt = null;
      conn.room = room;
      conn.player = existing;
      markConnectivity(room);
      send(conn.socket, { type: 'joined', playerId: existing.id, token: existing.token, roomCode: room.code });
      cancelRoundRestartVote(room, 'rosterChanged');
      broadcastLobby(room);
      // Their hidden knowledge is only what past events already told them — the
      // client keeps its own peek memory. We resend just the current redacted view.
      if (room.round) {
        send(conn.socket, { type: 'view', view: viewFor(room.round, existing.id), roundNumber: room.roundNumber });
        // Give the rejoiner the TRUE remaining time, not a fresh full countdown.
        send(conn.socket, timerMessageFor(room, existing.id));
      }
      return;
    }
    // Stale/foreign token: fall through to a fresh join (lobby only).
  }

  if (room.status !== 'lobby') {
    send(conn.socket, { type: 'error', code: 'gameInProgress', message: 'this game already started' });
    return;
  }
  if (room.players.length >= MAX_PLAYERS) {
    send(conn.socket, { type: 'error', code: 'roomFull', message: `rooms hold up to ${MAX_PLAYERS} players` });
    return;
  }
  const name = msg.name.trim().slice(0, 24);
  if (name.length === 0) {
    send(conn.socket, { type: 'error', code: 'badMessage', message: 'pick a display name' });
    return;
  }
  if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    send(conn.socket, { type: 'error', code: 'nameTaken', message: `someone here is already called ${name}` });
    return;
  }

  const player: RoomPlayer = {
    id: newPlayerId(),
    token: newToken(),
    name,
    color: msg.color.slice(0, 24),
    seat: room.players.length,
    connected: true,
    isHost: room.players.length === 0,
    disconnectedAt: null,
    socket: conn.socket,
    slapTimes: [],
  };
  room.players.push(player);
  conn.room = room;
  conn.player = player;
  markConnectivity(room);
  send(conn.socket, { type: 'joined', playerId: player.id, token: player.token, roomCode: room.code });
  broadcastLobby(room);
}

// ---------------------------------------------------------------------------
// Lobby controls (host)
// ---------------------------------------------------------------------------

function handleSetToggle(room: Room, player: RoomPlayer, msg: Extract<ClientMessage, { type: 'setToggle' }>): void {
  if (!player.isHost) {
    sendTo(player, { type: 'error', code: 'notHost', message: 'only the host can change settings' });
    return;
  }
  if (msg.toggle === 'matchTo100' || msg.toggle === 'greatEscape' || msg.toggle === 'instantNotMe') {
    if (room.status !== 'lobby') {
      sendTo(player, { type: 'error', code: 'wrongStatus', message: 'rule toggles lock once the game starts' });
      return;
    }
    if (typeof msg.value !== 'boolean') {
      sendTo(player, { type: 'error', code: 'badToggle', message: 'expected a boolean' });
      return;
    }
    room.toggles[msg.toggle] = msg.value;
  } else if (msg.toggle === 'deckCount') {
    if (room.status !== 'lobby') {
      sendTo(player, { type: 'error', code: 'wrongStatus', message: 'deck count locks once the game starts' });
      return;
    }
    if (!isValidDeckCount(msg.value)) {
      sendTo(player, { type: 'error', code: 'badToggle', message: 'deck count must be an integer from 1 to 3' });
      return;
    }
    room.toggles.deckCount = msg.value;
  } else if (msg.toggle === 'turnTimeoutSeconds') {
    if (typeof msg.value !== 'number' || !Number.isFinite(msg.value)) {
      sendTo(player, { type: 'error', code: 'badToggle', message: 'expected a number of seconds' });
      return;
    }
    room.toggles.turnTimeoutSeconds = Math.min(300, Math.max(10, Math.round(msg.value)));
    // Never rewrite independent setup deadlines. A changed setting takes effect
    // when normal play begins; during normal play it still applies immediately.
    if (room.round?.phase !== 'setupPeek') resetTimers(room);
  } else {
    sendTo(player, { type: 'error', code: 'badToggle', message: 'unknown toggle' });
    return;
  }
  broadcastLobby(room);
}

function handleStartGame(room: Room, player: RoomPlayer): void {
  if (!player.isHost) {
    sendTo(player, { type: 'error', code: 'notHost', message: 'only the host can start the game' });
    return;
  }
  if (room.status !== 'lobby') {
    sendTo(player, { type: 'error', code: 'wrongStatus', message: 'the game already started' });
    return;
  }
  const n = room.players.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) {
    sendTo(player, {
      type: 'error',
      code: 'badPlayerCount',
      message: `LAZY SUNDAY is for ${MIN_PLAYERS}-${MAX_PLAYERS} players (currently ${n})`,
    });
    return;
  }
  const seatOrder = seatOrderedIds(room);
  room.session = createSession(seatOrder, {
    matchTo100: room.toggles.matchTo100,
    greatEscape: room.toggles.greatEscape,
  });
  startRound(room, 1);
}

function handleNextRound(room: Room, player: RoomPlayer): void {
  if (!player.isHost) {
    sendTo(player, { type: 'error', code: 'notHost', message: 'only the host can deal the next round' });
    return;
  }
  if (room.status !== 'between-rounds' || !room.session) {
    sendTo(player, { type: 'error', code: 'wrongStatus', message: 'no finished round to move on from' });
    return;
  }
  if (room.session.matchOver) {
    sendTo(player, { type: 'error', code: 'wrongStatus', message: 'the match is over' });
    return;
  }
  startRound(room, room.roundNumber + 1);
}

function handleProposeRoundRestart(room: Room, player: RoomPlayer): void {
  if (room.status !== 'playing' || !room.round) {
    sendTo(player, { type: 'error', code: 'wrongStatus', message: 'there is no active round to restart' });
    return;
  }
  if (room.roundRestartVote) {
    sendTo(player, { type: 'error', code: 'voteActive', message: 'a round restart vote is already open' });
    return;
  }
  if (!player.connected || player.socket === null) {
    sendTo(player, { type: 'error', code: 'notEligible', message: 'only connected players can start a vote' });
    return;
  }

  const eligibleVoters = room.players
    .filter((candidate) => candidate.connected)
    .sort((a, b) => a.seat - b.seat)
    .map((candidate) => candidate.id);
  const voteId = room.nextRoundRestartVoteId++;
  room.roundRestartVote = {
    status: 'active',
    voteId,
    proposer: player.id,
    eligibleVoters,
    yesVotes: [player.id],
  };
  broadcast(room, { type: 'roundRestartVote', update: room.roundRestartVote });
  if (eligibleVoters.length === 1) passRoundRestartVote(room, voteId);
}

function handleVoteRoundRestart(
  room: Room,
  player: RoomPlayer,
  msg: Extract<ClientMessage, { type: 'voteRoundRestart' }>,
): void {
  if (room.status !== 'playing' || !room.round) {
    sendTo(player, { type: 'error', code: 'wrongStatus', message: 'there is no active round to restart' });
    return;
  }
  const vote = room.roundRestartVote;
  if (!vote || vote.voteId !== msg.voteId) {
    sendTo(player, { type: 'error', code: 'staleVote', message: 'that restart vote is no longer open' });
    return;
  }
  if (!player.connected || !vote.eligibleVoters.includes(player.id)) {
    sendTo(player, { type: 'error', code: 'notEligible', message: 'you are not eligible to vote on this proposal' });
    return;
  }
  if (vote.yesVotes.includes(player.id)) {
    sendTo(player, { type: 'error', code: 'duplicateVote', message: 'your vote is already recorded' });
    return;
  }
  if (!msg.approve) {
    room.roundRestartVote = null;
    broadcast(room, {
      type: 'roundRestartVote',
      update: { status: 'rejected', voteId: vote.voteId, rejectedBy: player.id },
    });
    return;
  }

  const updated = { ...vote, yesVotes: [...vote.yesVotes, player.id] };
  room.roundRestartVote = updated;
  broadcast(room, { type: 'roundRestartVote', update: updated });
  if (updated.yesVotes.length === updated.eligibleVoters.length) {
    passRoundRestartVote(room, updated.voteId);
  }
}

function passRoundRestartVote(room: Room, voteId: number): void {
  room.roundRestartVote = null;
  clearTimers(room);
  broadcast(room, { type: 'roundRestartVote', update: { status: 'passed', voteId } });
  // A restart is a fresh deal of the same round. Session scores, Great Escape,
  // match state, round number, and starting seat all stay unchanged.
  startRound(room, room.roundNumber);
}

function cancelRoundRestartVote(room: Room, reason: 'rosterChanged' | 'roundEnded'): void {
  const vote = room.roundRestartVote;
  if (!vote) return;
  room.roundRestartVote = null;
  broadcast(room, {
    type: 'roundRestartVote',
    update: { status: 'cancelled', voteId: vote.voteId, reason },
  });
}

function startRound(room: Room, roundNumber: number): void {
  const seatOrder = seatOrderedIds(room);
  room.roundNumber = roundNumber;
  room.round = createRound({
    players: seatOrder,
    // Round k starts at seat (k-1) mod nPlayers — the deal rotates.
    startingPlayer: startingSeatForRound(roundNumber, seatOrder.length),
    seed: newSeed(),
    deckCount: room.toggles.deckCount,
    instantNotMe: room.toggles.instantNotMe,
  });
  room.status = 'playing';
  broadcastLobby(room);
  broadcastViews(room);
  resetTimers(room);
}

function seatOrderedIds(room: Room): PlayerId[] {
  return room.players
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((p) => p.id);
}

// ---------------------------------------------------------------------------
// Engine commands
// ---------------------------------------------------------------------------

function handleCommand(
  room: Room,
  player: RoomPlayer,
  clientCmd: Extract<ClientMessage, { type: 'command' }>['command'],
): void {
  if (room.status !== 'playing' || !room.round) {
    sendTo(player, { type: 'error', code: 'wrongStatus', message: 'the round is not in play' });
    return;
  }

  // Rate-limit slaps (spam protection; arbitration itself is arrival order).
  if (clientCmd.type === 'slap') {
    const now = Date.now();
    player.slapTimes = player.slapTimes.filter((t) => now - t < SLAP_WINDOW_MS);
    if (player.slapTimes.length >= SLAP_MAX_IN_WINDOW) {
      sendTo(player, { type: 'error', code: 'rateLimited', message: 'slow down — too many slaps' });
      return;
    }
    player.slapTimes.push(now);
  }

  // Stamp the SENDER's playerId. A client-supplied `player` field is discarded —
  // the socket's identity is the only identity the server trusts.
  const cmd = normalizeClientCommand(room.round, player.id, clientCmd);
  if ((cmd as { type: string }).type === 'forceSkipTurn') {
    sendTo(player, { type: 'error', code: 'badMessage', message: 'nice try' });
    return;
  }

  const applied = applyToRoom(room, cmd, player);

  // A rejected command from the current normal-play blocker restarts the turn
  // timer — they are demonstrably at the keyboard. During setup, rejected taps
  // leave every player's independent inactivity/peek deadline untouched.
  if (!applied && room.round && blockingPlayers(room.round).includes(player.id)) {
    if (room.round.phase !== 'setupPeek') resetTimers(room);
  }
}

/** Apply an engine command; on success commit state, route events, broadcast views.
 *  Fully synchronous — never interleave async work in here. */
function applyToRoom(room: Room, cmd: Command, feedbackTo: RoomPlayer | null): boolean {
  if (!room.round) return false;
  const wasSetupPeek = room.round.phase === 'setupPeek';
  const setupPlayerBefore = wasSetupPeek
    ? room.round.players.find((player) => player.id === cmd.player)
    : undefined;
  const setupSlotCountBefore = setupPlayerBefore?.setupPeekSlots.length ?? null;
  const result = applyCommand(room.round, cmd);
  if (!result.ok) {
    if (feedbackTo) sendTo(feedbackTo, { type: 'error', code: result.code, message: result.message });
    return false;
  }
  room.round = result.state;

  // Route engine events: each player receives only what eventVisibleTo allows.
  for (const event of result.events) {
    for (const p of room.players) {
      if (p.connected && eventVisibleTo(event, p.id)) {
        sendTo(p, { type: 'event', event });
      }
    }
  }

  const revealed = result.events.some((e: EngineEvent) => e.type === 'roundRevealed');
  if (revealed && room.round.result && room.session) {
    cancelRoundRestartVote(room, 'roundEnded');
    // Score the round into the session, then let the host deal the next one.
    const { session, events: sessionEvents } = applyRoundScores(room.session, room.round.result.scores);
    room.session = session;
    room.status = 'between-rounds';
    for (const ev of sessionEvents) broadcast(room, { type: 'sessionEvent', event: ev });
  }

  broadcastViews(room);
  if (revealed) broadcastLobby(room); // standings changed

  if (wasSetupPeek && cmd.type === 'setupPeek') {
    // The first successful card tap starts this player's fixed reveal window.
    // A second tap shares that deadline, and no setup tap touches anyone else's.
    if (setupSlotCountBefore === 0) restartPlayerTimer(room, cmd.player, SETUP_PEEK_MS);
  } else if (wasSetupPeek && cmd.type === 'forceSkipTurn') {
    removePlayerTimer(room, cmd.player);
    if (room.round.phase === 'setupPeek') {
      broadcastTimerState(room);
    } else {
      // The last setup window ended: only now start the first normal turn timer.
      resetTimers(room);
    }
  } else {
    resetTimers(room, hasTableActivitySpotlight(result.events) ? TABLE_ACTIVITY_SPOTLIGHT_MS : 0);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Turn timeouts
// ---------------------------------------------------------------------------

/** Who is the round currently waiting on? (May be several during setupPeek.) */
export function blockingPlayers(state: RoundState): PlayerId[] {
  if (state.phase === 'setupPeek') {
    return state.players.filter((p) => !p.setupPeeked).map((p) => p.id);
  }
  if (state.pendingGift) return [state.pendingGift.from];
  if (state.pendingAction) return [state.pendingAction.actor];
  if (state.phase === 'turn' || state.phase === 'drawn') {
    return [state.players[state.turn]!.id];
  }
  return []; // reveal
}

function clearTimers(room: Room): void {
  for (const t of room.timers.values()) clearTimeout(t);
  room.timers.clear();
  room.turnDeadlines.clear();
  if (room.timerStartDelay) clearTimeout(room.timerStartDelay);
  room.timerStartDelay = null;
}

function resetTimers(room: Room, startDelayMs = 0): void {
  clearTimers(room);
  if (room.status !== 'playing' || !room.round) {
    broadcastTimerState(room);
    return;
  }
  const blocking = blockingPlayers(room.round);
  if (blocking.length === 0) {
    broadcastTimerState(room);
    return;
  }

  if (startDelayMs > 0) {
    const expectedRound = room.round;
    broadcastTimerState(room);
    const delay = setTimeout(() => {
      if (room.timerStartDelay !== delay) return;
      room.timerStartDelay = null;
      if (room.status !== 'playing' || room.round !== expectedRound) return;
      const currentBlocking = blockingPlayers(room.round);
      if (!samePlayers(currentBlocking, blocking)) return;
      startTimers(room, currentBlocking);
    }, startDelayMs);
    delay.unref();
    room.timerStartDelay = delay;
    return;
  }

  startTimers(room, blocking);
}

function startTimers(room: Room, blocking: readonly PlayerId[]): void {
  const timeoutMs = room.toggles.turnTimeoutSeconds * 1000;
  const now = Date.now();
  const deadline = now + timeoutMs;
  for (const pid of blocking) {
    const t = setTimeout(() => onTurnTimeout(room, pid), timeoutMs);
    t.unref();
    room.timers.set(pid, t);
    room.turnDeadlines.set(pid, deadline);
  }
  broadcastTimerState(room, now);
}

function samePlayers(a: readonly PlayerId[], b: readonly PlayerId[]): boolean {
  return a.length === b.length && a.every((player, index) => player === b[index]);
}

function onTurnTimeout(room: Room, pid: PlayerId): void {
  removePlayerTimer(room, pid);
  if (room.status !== 'playing' || !room.round) return;
  if (!blockingPlayers(room.round).includes(pid)) return; // stale timer
  // Engine resolves whatever they were blocking on: forfeits the setup peek,
  // discards a held drawn card, cancels a pending action, gives the lowest-slot
  // gift card, or skips the turn outright.
  applyToRoom(room, { type: 'forceSkipTurn', player: pid }, null);
}

function restartPlayerTimer(room: Room, pid: PlayerId, timeoutMs: number): void {
  removePlayerTimer(room, pid);
  const now = Date.now();
  const timer = setTimeout(() => onTurnTimeout(room, pid), timeoutMs);
  timer.unref();
  room.timers.set(pid, timer);
  room.turnDeadlines.set(pid, now + timeoutMs);
  broadcastTimerState(room, now);
}

function removePlayerTimer(room: Room, pid: PlayerId): void {
  const timer = room.timers.get(pid);
  if (timer) clearTimeout(timer);
  room.timers.delete(pid);
  room.turnDeadlines.delete(pid);
}

/** Build the timer payload this recipient should see. Setup-peek countdowns are
 *  private per-player; normal gameplay's one active deadline is public. */
export function timerMessageFor(
  room: Room,
  recipient: PlayerId,
  now = Date.now(),
): Extract<ServerMessage, { type: 'turnTimer' }> {
  const round = room.status === 'playing' ? room.round : null;
  const players = round ? blockingPlayers(round) : [];
  const timedPlayer = round?.phase === 'setupPeek' ? recipient : players[0];
  const deadline = timedPlayer ? room.turnDeadlines.get(timedPlayer) : undefined;
  return {
    type: 'turnTimer',
    remainingMs: deadline === undefined ? null : Math.max(0, deadline - now),
    players,
  };
}

function broadcastTimerState(room: Room, now = Date.now()): void {
  for (const player of room.players) {
    if (player.connected) sendTo(player, timerMessageFor(room, player.id, now));
  }
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

function sendTo(player: RoomPlayer, msg: ServerMessage): void {
  if (player.socket) send(player.socket, msg);
}

function broadcast(room: Room, msg: ServerMessage): void {
  for (const p of room.players) {
    if (p.connected) sendTo(p, msg);
  }
}

export function broadcastLobby(room: Room): void {
  broadcast(room, { type: 'lobby', lobby: lobbyStateOf(room) });
}

/** Every player gets their OWN viewFor — never someone else's, never RoundState. */
function broadcastViews(room: Room): void {
  if (!room.round) return;
  for (const p of room.players) {
    if (p.connected) {
      sendTo(p, { type: 'view', view: viewFor(room.round, p.id), roundNumber: room.roundNumber });
    }
  }
}

export { createRoom };
