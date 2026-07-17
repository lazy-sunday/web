'use client';

// Peek memory. ANY peek event addressed to me (setup peek §3.3; Check the
// List / Knock It Out / Snoop §5) shows the card face overlaid on that slot
// for a few seconds, only ever to me, then hides it again. This hook is the
// ONLY place that timer lives — it never writes an always-visible label of
// what was peeked; once the timeout fires the entry is gone and the slot goes
// back to face-down.
//
// Source of truth: `game.events` (filtered per-player by the server — see
// protocol.ts). A `peek` event only ever reaches the socket it's addressed
// to, so we don't need to re-check `to` here, but we do anyway as
// belt-and-braces against future event plumbing changes.
//
// Each event carries its own `reason`, so setup reveals and shorter in-game
// reveals never depend on the current view phase. Setup now arrives as one
// private event per tapped card; both events share the deadline created by the
// first tap. The stable event sequence below also prevents the capped socket
// log from dropping every peek after its retained window fills.

import { useEffect, useMemo, useRef, useState } from 'react';
import { SETUP_PEEK_MS, type Card, type EngineEvent, type PeekReason, type PlayerId } from '@lazy-sunday/engine';
import { eventsAfter } from './eventLog';
import type { GameEvent } from './useGameSocket';

export interface ActivePeek {
  card: Card;
  reason: PeekReason;
  /** ms remaining is derived by the caller from `expiresAt`; we just hold the deadline. */
  expiresAt: number;
}

type PeekEvent = Extract<EngineEvent, { type: 'peek' }>;

/** Setup peek (§3.3) gets the engine's shared 10s display; granted peeks (§5) get 4s. */
export { SETUP_PEEK_MS };
export const GRANTED_PEEK_MS = 4_000;

/** How long a peek's faces stay visible, decided by the peek's origin — NOT by
 *  the live view phase (issue #28). */
export function peekTtlMs(reason: PeekReason): number {
  return reason === 'setup' ? SETUP_PEEK_MS : GRANTED_PEEK_MS;
}

function keyFor(owner: PlayerId, slot: number): string {
  return `${owner}:${slot}`;
}

/** A setup peek is sent as one event per tapped card. Every card in that
 *  once-only setup window must use the first event's deadline, rather than
 *  granting another 10 seconds for the second tap. Action peeks remain
 *  independent and always receive a fresh four-second deadline. */
export function deadlineForPeek(
  prev: ReadonlyMap<string, ActivePeek>,
  ev: PeekEvent,
  now: number,
): number {
  if (ev.reason === 'action') return now + GRANTED_PEEK_MS;
  for (const active of prev.values()) {
    if (active.reason === 'setup' && active.expiresAt > now) return active.expiresAt;
  }
  return now + SETUP_PEEK_MS;
}

/** Pure reducer: fold one peek event into the active-peek map, stamping each
 *  revealed slot with an absolute expiry (`now + ttl`). Deadline-based so it is
 *  independent of any timer — the hook only needs to schedule the eventual
 *  removal. Exported for deterministic testing of the #28 race. */
export function reducePeek(
  prev: ReadonlyMap<string, ActivePeek>,
  ev: PeekEvent,
  now: number,
  expiresAt = deadlineForPeek(prev, ev, now),
): Map<string, ActivePeek> {
  const next = new Map(prev);
  for (const reveal of ev.reveals) {
    next.set(keyFor(reveal.owner, reveal.slot), { card: reveal.card, reason: ev.reason, expiresAt });
  }
  return next;
}

export function usePeeks(events: GameEvent[], myId: PlayerId | null) {
  const [peeks, setPeeks] = useState<Map<string, ActivePeek>>(new Map());
  const lastSeenSequence = useRef(0);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Ephemeral only: this groups the two setup events received by this mounted
  // client. It is cleared at expiry and is deliberately not restored after a
  // reconnect. Hidden card knowledge remains in memory only.
  const setupDeadline = useRef<number | null>(null);

  useEffect(() => {
    if (!myId) return;
    // Sequence IDs stay monotonic when the capped log drops its oldest entry,
    // unlike an array-length cursor. This keeps late-round setup peeks visible
    // and processes each private event exactly once (issue #28).
    const newEvents = eventsAfter(events, lastSeenSequence.current);
    if (newEvents.length === 0) return;
    lastSeenSequence.current = newEvents.at(-1)!.sequence;

    for (const { event: ev } of newEvents) {
      if (ev.type !== 'peek') continue;
      if (ev.to !== myId) continue;
      const now = Date.now();
      const deadline =
        ev.reason === 'setup'
          ? setupDeadline.current && setupDeadline.current > now
            ? setupDeadline.current
            : now + SETUP_PEEK_MS
          : now + GRANTED_PEEK_MS;
      if (ev.reason === 'setup') setupDeadline.current = deadline;
      setPeeks((prev) => reducePeek(prev, ev, now, deadline));
      for (const reveal of ev.reveals) {
        const key = keyFor(reveal.owner, reveal.slot);
        const existing = timers.current.get(key);
        if (existing) clearTimeout(existing);
        const t = setTimeout(() => {
          setPeeks((prev) => {
            const active = prev.get(key);
            // A later peek of the same slot owns a different deadline/timer;
            // an older callback must never delete that newer reveal.
            if (!active || active.expiresAt !== deadline) return prev;
            const next = new Map(prev);
            next.delete(key);
            return next;
          });
          if (ev.reason === 'setup' && setupDeadline.current === deadline) {
            setupDeadline.current = null;
          }
          if (timers.current.get(key) === t) timers.current.delete(key);
        }, Math.max(0, deadline - Date.now()));
        timers.current.set(key, t);
      }
    }
  }, [events, myId]);

  useEffect(() => {
    const active = timers.current;
    return () => {
      for (const t of active.values()) clearTimeout(t);
      active.clear();
    };
  }, []);

  return useMemo(
    () => ({
      /** Returns the revealed card for this slot if the peek is still active, else null. */
      peekAt: (owner: PlayerId, slot: number): Card | null => {
        const active = peeks.get(keyFor(owner, slot));
        return active && active.expiresAt > Date.now() ? active.card : null;
      },
      hasAny: peeks.size > 0,
    }),
    [peeks],
  );
}
