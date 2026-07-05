// In-memory room registry. No database — rooms live and die with the process.

import { randomBytes, randomInt } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { PlayerId, RoundState, SessionState } from '@lazy-sunday/engine';
import type { LobbyState, RoomStatus, RoomToggles } from './protocol.js';

/** Unambiguous room-code alphabet: no 0/O, no 1/I. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

export const MAX_PLAYERS = 7;
export const MIN_PLAYERS = 2;
export const DEFAULT_TURN_TIMEOUT_SECONDS = 45;
/** Empty rooms are garbage-collected after 30 minutes. */
const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000;
/** Host reassignment becomes possible after the host has been gone this long. */
export const HOST_AWAY_MS = 5 * 60 * 1000;

export interface RoomPlayer {
  id: PlayerId;
  /** Secret reconnection token; only ever sent to this player's own socket. */
  token: string;
  name: string;
  color: string;
  seat: number;
  connected: boolean;
  isHost: boolean;
  /** Since when this player has been disconnected (ms epoch), or null. */
  disconnectedAt: number | null;
  socket: WebSocket | null;
  /** Timestamps of recent slap commands, for rate limiting. */
  slapTimes: number[];
}

export interface Room {
  code: string;
  status: RoomStatus;
  players: RoomPlayer[];
  toggles: RoomToggles;
  session: SessionState | null;
  /** Authoritative RoundState. NEVER serialized to a client — views only. */
  round: RoundState | null;
  /** 1-based round counter; 0 in the lobby. */
  roundNumber: number;
  /** Per-blocking-player turn timers. */
  timers: Map<PlayerId, NodeJS.Timeout>;
  createdAt: number;
  /** When the room last had zero connected sockets (for GC), or null. */
  emptySince: number | null;
}

const rooms = new Map<string, Room>();

export function createRoom(): Room {
  let code: string;
  do {
    code = generateCode();
  } while (rooms.has(code));
  const room: Room = {
    code,
    status: 'lobby',
    players: [],
    toggles: {
      matchTo100: false,
      greatEscape: false,
      turnTimeoutSeconds: DEFAULT_TURN_TIMEOUT_SECONDS,
    },
    session: null,
    round: null,
    roundNumber: 0,
    timers: new Map(),
    createdAt: Date.now(),
    emptySince: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
}

export function roomCount(): number {
  return rooms.size;
}

function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]!;
  }
  return code;
}

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export function newPlayerId(): PlayerId {
  return `p_${randomBytes(9).toString('base64url')}`;
}

/** Fresh 32-bit seed for each round's deal. */
export function newSeed(): number {
  return randomBytes(4).readUInt32LE(0);
}

/** Round k (1-based) starts at seat (k-1) mod nPlayers. */
export function startingSeatForRound(roundNumber: number, nPlayers: number): number {
  return (roundNumber - 1) % nPlayers;
}

export function lobbyStateOf(room: Room): LobbyState {
  return {
    code: room.code,
    status: room.status,
    players: room.players
      .slice()
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        seat: p.seat,
        connected: p.connected,
        isHost: p.isHost,
      })),
    toggles: { ...room.toggles },
    roundNumber: room.roundNumber,
    standings: room.session
      ? room.session.players
          .map((player) => ({ player, score: room.session!.scores[player] ?? 0 }))
          .sort((a, b) => a.score - b.score)
      : [],
    matchOver: room.session?.matchOver ?? false,
    winners: room.session?.winners.slice() ?? [],
  };
}

export function markConnectivity(room: Room): void {
  const anyConnected = room.players.some((p) => p.connected);
  if (anyConnected) {
    room.emptySince = null;
  } else if (room.emptySince === null) {
    room.emptySince = Date.now();
  }
}

/** If the host has been gone > 5 min and someone else is connected, pass the badge. */
export function maybeReassignHost(room: Room): boolean {
  const host = room.players.find((p) => p.isHost);
  if (!host || host.connected) return false;
  if (host.disconnectedAt === null || Date.now() - host.disconnectedAt < HOST_AWAY_MS) return false;
  const successor = room.players
    .filter((p) => p.connected)
    .sort((a, b) => a.seat - b.seat)[0];
  if (!successor) return false;
  host.isHost = false;
  successor.isHost = true;
  return true;
}

/** GC sweep: drop rooms with no connected players for 30 min. Returns reaped codes. */
export function sweepRooms(now = Date.now()): string[] {
  const reaped: string[] = [];
  for (const [code, room] of rooms) {
    if (room.emptySince !== null && now - room.emptySince >= EMPTY_ROOM_TTL_MS) {
      for (const t of room.timers.values()) clearTimeout(t);
      room.timers.clear();
      rooms.delete(code);
      reaped.push(code);
    }
  }
  return reaped;
}

export function startSweeper(intervalMs = 60_000): NodeJS.Timeout {
  const t = setInterval(() => sweepRooms(), intervalMs);
  t.unref();
  return t;
}
