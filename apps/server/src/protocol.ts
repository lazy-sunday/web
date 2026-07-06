// Client <-> server wire protocol (JSON over WebSocket).
//
// PRIVACY INVARIANT (CLAUDE.md): nothing in here may ever carry a raw RoundState.
// The only game-state shapes on the wire are RoundView (from engine viewFor) and
// EngineEvent (filtered per player with eventVisibleTo). Face-down card identities
// never appear except where the engine itself grants them (peek/drawnCard events
// addressed to one player, and public face-up moments).

import type { Command, EngineEvent, PlayerId, SessionEvent } from '@lazy-sunday/engine';
import type { RoundView } from '@lazy-sunday/engine';

// ---------------------------------------------------------------------------
// Shared lobby/room shapes
// ---------------------------------------------------------------------------

export type RoomStatus = 'lobby' | 'playing' | 'between-rounds';

export interface LobbyPlayer {
  id: PlayerId;
  name: string;
  color: string;
  seat: number;
  connected: boolean;
  isHost: boolean;
}

export interface RoomToggles {
  matchTo100: boolean;
  greatEscape: boolean;
  /** Turn timeout in seconds (default 45). */
  turnTimeoutSeconds: number;
}

export interface LobbyState {
  code: string;
  status: RoomStatus;
  players: LobbyPlayer[];
  toggles: RoomToggles;
  /** 1-based; 0 while still in the lobby. */
  roundNumber: number;
  /** Cumulative standings, lowest first. Empty until a session exists. */
  standings: { player: PlayerId; score: number }[];
  matchOver: boolean;
  winners: PlayerId[];
}

// ---------------------------------------------------------------------------
// Client -> server
// ---------------------------------------------------------------------------

/** Engine commands a client may send. The server stamps the sender's playerId —
 *  a client-supplied `player` field is ignored/never trusted. `forceSkipTurn`
 *  is server-driven only and not part of the client vocabulary. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type ClientCommand = DistributiveOmit<Exclude<Command, { type: 'forceSkipTurn' }>, 'player'>;

export type ToggleKey = keyof RoomToggles;

export type ClientMessage =
  | { type: 'join'; roomCode: string; name: string; color: string; token?: string }
  | { type: 'setToggle'; toggle: 'matchTo100' | 'greatEscape'; value: boolean }
  | { type: 'setToggle'; toggle: 'turnTimeoutSeconds'; value: number }
  | { type: 'startGame' }
  | { type: 'command'; command: ClientCommand }
  | { type: 'nextRound' }
  | { type: 'reaction'; emoji: string }
  | { type: 'ping' };

// ---------------------------------------------------------------------------
// Server -> client
// ---------------------------------------------------------------------------

export type ServerErrorCode =
  | 'badMessage'
  | 'notJoined'
  | 'roomNotFound'
  | 'roomFull'
  | 'gameInProgress'
  | 'nameTaken'
  | 'notHost'
  | 'badPlayerCount'
  | 'wrongStatus'
  | 'rateLimited'
  | 'badToggle'
  // engine ErrorCodes pass through verbatim as well
  | string;

export type ServerMessage =
  | { type: 'joined'; playerId: PlayerId; token: string; roomCode: string }
  | { type: 'lobby'; lobby: LobbyState }
  /** The recipient's own redacted RoundView — each player gets a different one. */
  | { type: 'view'; view: RoundView; roundNumber: number }
  /** How long the current turn/peek/action/gift has before it auto-skips.
   *  `remainingMs` is a duration (not an absolute time) so client clock skew is
   *  irrelevant; null means nothing is currently timed. `players` are who the
   *  clock is running against right now. */
  | { type: 'turnTimer'; remainingMs: number | null; players: PlayerId[] }
  /** An engine event this player is allowed to see (eventVisibleTo-filtered). */
  | { type: 'event'; event: EngineEvent }
  | { type: 'sessionEvent'; event: SessionEvent }
  | { type: 'reaction'; player: PlayerId; emoji: string }
  | { type: 'error'; code: ServerErrorCode; message: string }
  | { type: 'pong' };

// ---------------------------------------------------------------------------
// Parsing helper (server side, but dependency-free so the client may reuse it)
// ---------------------------------------------------------------------------

const CLIENT_TYPES = new Set([
  'join',
  'setToggle',
  'startGame',
  'command',
  'nextRound',
  'reaction',
  'ping',
]);

/** Cheap structural gate. Deeper validation (slots, targets…) is the engine's job. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'string' && !(raw instanceof Buffer)) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return null;
  }
  if (typeof msg !== 'object' || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (typeof m['type'] !== 'string' || !CLIENT_TYPES.has(m['type'])) return null;
  switch (m['type']) {
    case 'join':
      if (typeof m['roomCode'] !== 'string' || typeof m['name'] !== 'string' || typeof m['color'] !== 'string') return null;
      if (m['token'] !== undefined && typeof m['token'] !== 'string') return null;
      return m as unknown as ClientMessage;
    case 'setToggle':
      if (typeof m['toggle'] !== 'string') return null;
      return m as unknown as ClientMessage;
    case 'command': {
      const c = m['command'];
      if (typeof c !== 'object' || c === null) return null;
      const type = (c as Record<string, unknown>)['type'];
      if (typeof type !== 'string' || type === 'forceSkipTurn') return null;
      return m as unknown as ClientMessage;
    }
    case 'reaction':
      if (typeof m['emoji'] !== 'string' || (m['emoji'] as string).length > 16) return null;
      return m as unknown as ClientMessage;
    default:
      return m as unknown as ClientMessage;
  }
}
