'use client';

// The one WebSocket hook. Connects to the game server, auto-rejoins with the
// localStorage token for this room code, and exposes { lobby, view, events, send }.
//
// The client never receives more than its own RoundView + filtered events; any
// "hidden knowledge" (peeked cards) lives only in what past events told us, so
// we keep the event log around for the table UI (M3) to build its peek memory.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EngineEvent, PlayerId, RoundView, SessionEvent } from '@lazy-sunday/engine';
import type {
  ClientMessage,
  LobbyState,
  RoundRestartVoteUpdate,
  ServerMessage,
  VisualClientCommand,
} from '@lazy-sunday/server/protocol';
import { WS_URL } from './config';
import { appendEvent, type SequencedEvent } from './eventLog';
import { encodeClientCommand } from './slotProtocol';

export interface StoredIdentity {
  playerId: PlayerId;
  token: string;
  name: string;
  color: string;
}

/** A player's emoji reaction, timestamped client-side so the UI can float
 *  and expire it near their seat without needing a server-side TTL. */
export interface ReactionEvent {
  id: number;
  player: PlayerId;
  emoji: string;
  at: number;
}

/** The current turn clock. `deadline` is a LOCAL epoch-ms (we convert the
 *  server's remaining-duration into our own clock on receipt, so server/client
 *  clock skew never distorts the countdown). null = nothing is timed. */
export interface TurnTimer {
  deadline: number | null;
  players: PlayerId[];
}

export type GameEvent = SequencedEvent<EngineEvent>;

export interface GameSocket {
  /** Raw socket status. */
  status: 'connecting' | 'open' | 'closed';
  /** Set once this client has a seat in the room. */
  me: StoredIdentity | null;
  lobby: LobbyState | null;
  view: RoundView | null;
  roundNumber: number;
  /** Filtered engine events with client-local sequence IDs, newest last (capped). */
  events: GameEvent[];
  /** Session-level events (Great Escape, match over), newest last (capped). */
  sessionEvents: SessionEvent[];
  /** The most recent session event, if any — convenient for ceremony banners. */
  latestSessionEvent: SessionEvent | null;
  /** Incoming emoji reactions, newest last (capped, client-timestamped). */
  reactions: ReactionEvent[];
  /** Current turn/peek/action auto-skip clock (local deadline + who it's for). */
  turnTimer: TurnTimer;
  /** Current restart proposal or the latest short-lived result. */
  roundRestartVote: RoundRestartVoteUpdate | null;
  lastError: { code: string; message: string } | null;
  /** Join fresh with a chosen name + color (also persists identity for rejoin). */
  join: (name: string, color: string) => void;
  /** Send a raw protocol message. */
  send: (msg: ClientMessage) => void;
  /** Send an engine command (server stamps our player id). */
  sendCommand: (command: VisualClientCommand) => void;
  /** Send an emoji reaction (server broadcasts it back as `reaction`). */
  sendReaction: (emoji: string) => void;
  clearError: () => void;
}

const MAX_EVENTS = 200;
const MAX_SESSION_EVENTS = 20;
const MAX_REACTIONS = 30;
let reactionIdSeq = 0;

function storageKey(roomCode: string): string {
  return `lazy-sunday:${roomCode.toUpperCase()}`;
}

export function loadIdentity(roomCode: string): StoredIdentity | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(roomCode));
    return raw ? (JSON.parse(raw) as StoredIdentity) : null;
  } catch {
    return null;
  }
}

function saveIdentity(roomCode: string, id: StoredIdentity): void {
  try {
    window.localStorage.setItem(storageKey(roomCode), JSON.stringify(id));
  } catch {
    /* private mode etc. — reconnection just won't survive a refresh */
  }
}

export function useGameSocket(roomCode: string): GameSocket {
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const [me, setMe] = useState<StoredIdentity | null>(null);
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [view, setView] = useState<RoundView | null>(null);
  const [roundNumber, setRoundNumber] = useState(0);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [sessionEvents, setSessionEvents] = useState<SessionEvent[]>([]);
  const [reactions, setReactions] = useState<ReactionEvent[]>([]);
  const [turnTimer, setTurnTimer] = useState<TurnTimer>({ deadline: null, players: [] });
  const [roundRestartVote, setRoundRestartVote] = useState<RoundRestartVoteUpdate | null>(null);
  const [lastError, setLastError] = useState<{ code: string; message: string } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pendingProfile = useRef<{ name: string; color: string } | null>(null);
  const closedByUs = useRef(false);
  const eventSequence = useRef(0);

  const rawSend = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    closedByUs.current = false;
    let retryDelay = 500;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    function connect(): void {
      setStatus('connecting');
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('open');
        retryDelay = 500;
        // Auto-rejoin: same room code + stored token reattaches our seat.
        const stored = loadIdentity(roomCode);
        if (stored) {
          setMe(stored);
          ws.send(
            JSON.stringify({
              type: 'join',
              roomCode,
              name: stored.name,
              color: stored.color,
              token: stored.token,
            } satisfies ClientMessage),
          );
        } else if (pendingProfile.current) {
          const p = pendingProfile.current;
          ws.send(JSON.stringify({ type: 'join', roomCode, name: p.name, color: p.color } satisfies ClientMessage));
        }
      };

      ws.onmessage = (e: MessageEvent<string>) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(e.data) as ServerMessage;
        } catch {
          return;
        }
        switch (msg.type) {
          case 'joined': {
            const profile = pendingProfile.current ?? loadIdentity(roomCode);
            const identity: StoredIdentity = {
              playerId: msg.playerId,
              token: msg.token,
              name: profile?.name ?? '',
              color: profile?.color ?? '',
            };
            pendingProfile.current = null;
            saveIdentity(roomCode, identity);
            setMe(identity);
            setLastError(null);
            // The server cancels an open vote on any reconnect. Clear a vote
            // this socket may have retained while it was offline.
            setRoundRestartVote(null);
            break;
          }
          case 'lobby':
            setLobby(msg.lobby);
            break;
          case 'view':
            setView(msg.view);
            setRoundNumber(msg.roundNumber);
            break;
          case 'turnTimer':
            // Convert the server's remaining-duration into our own local clock.
            setTurnTimer({
              deadline: msg.remainingMs === null ? null : Date.now() + msg.remainingMs,
              players: msg.players,
            });
            break;
          case 'event': {
            eventSequence.current += 1;
            const sequence = eventSequence.current;
            setEvents((prev) => appendEvent(prev, msg.event, sequence, MAX_EVENTS));
            break;
          }
          case 'error':
            setLastError({ code: String(msg.code), message: msg.message });
            break;
          case 'sessionEvent':
            setSessionEvents((prev) => {
              const next = [...prev, msg.event];
              return next.length > MAX_SESSION_EVENTS ? next.slice(next.length - MAX_SESSION_EVENTS) : next;
            });
            break;
          case 'roundRestartVote':
            setRoundRestartVote(msg.update);
            if (msg.update.status === 'passed') {
              // Peek memory and table activity belong to the discarded deal.
              setEvents([]);
              setTurnTimer({ deadline: null, players: [] });
            }
            break;
          case 'reaction':
            setReactions((prev) => {
              reactionIdSeq += 1;
              const next = [...prev, { id: reactionIdSeq, player: msg.player, emoji: msg.emoji, at: Date.now() }];
              return next.length > MAX_REACTIONS ? next.slice(next.length - MAX_REACTIONS) : next;
            });
            break;
          case 'pong':
            break;
        }
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        setStatus('closed');
        if (!closedByUs.current) {
          retryTimer = setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 8_000);
        }
      };
    }

    connect();
    return () => {
      closedByUs.current = true;
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [roomCode]);

  const join = useCallback(
    (name: string, color: string) => {
      pendingProfile.current = { name, color };
      rawSend({ type: 'join', roomCode, name, color });
    },
    [rawSend, roomCode],
  );

  const sendCommand = useCallback(
    (command: VisualClientCommand) => rawSend({
      type: 'command',
      command: encodeClientCommand(command, view, me?.playerId ?? null),
    }),
    [rawSend, view, me?.playerId],
  );

  // Client-side politeness limit: 1 reaction/sec. The server doesn't need to
  // police this (reactions are cheap and non-authoritative), but spamming
  // emoji at your friends deserves at least a token speed bump.
  const lastReactionAt = useRef(0);
  const sendReaction = useCallback(
    (emoji: string) => {
      const now = Date.now();
      if (now - lastReactionAt.current < 1000) return;
      lastReactionAt.current = now;
      rawSend({ type: 'reaction', emoji });
    },
    [rawSend],
  );

  const clearError = useCallback(() => setLastError(null), []);

  useEffect(() => {
    if (!roundRestartVote || roundRestartVote.status === 'active') return;
    const timer = setTimeout(() => setRoundRestartVote(null), 5_000);
    return () => clearTimeout(timer);
  }, [roundRestartVote]);

  const latestSessionEvent = sessionEvents.length > 0 ? sessionEvents[sessionEvents.length - 1]! : null;

  return {
    status,
    me,
    lobby,
    view,
    roundNumber,
    events,
    sessionEvents,
    latestSessionEvent,
    reactions,
    turnTimer,
    roundRestartVote,
    lastError,
    join,
    send: rawSend,
    sendCommand,
    sendReaction,
    clearError,
  };
}
