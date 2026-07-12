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
// Issue #28: how long a peek shows is decided by the EVENT's own `reason`,
// never by the client's current view phase. When the LAST player confirms
// their setup peek, the engine advances the phase to `turn` in the SAME
// applyCommand batch that emits the peek, so the fresh view (phase `turn`)
// and the `peek` event arrive together. React coalesces those into one
// passive-effect flush, so reading the live phase here would misread the
// once-only 10s setup reveal as a 4s granted peek — intermittently shortening
// (and, with the setup panel unmounting the instant the phase flips, visibly
// dropping) the reveal. Reading `reason` off the event removes the race.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Card, EngineEvent, PeekReason, PlayerId } from '@lazy-sunday/engine';

export interface ActivePeek {
  card: Card;
  /** ms remaining is derived by the caller from `expiresAt`; we just hold the deadline. */
  expiresAt: number;
}

type PeekEvent = Extract<EngineEvent, { type: 'peek' }>;

/** Setup peek (§3.3) gets the long 10s display; granted peeks (§5) get 4s. */
export const SETUP_PEEK_MS = 10_000;
export const GRANTED_PEEK_MS = 4_000;

/** How long a peek's faces stay visible, decided by the peek's origin — NOT by
 *  the live view phase (issue #28). */
export function peekTtlMs(reason: PeekReason): number {
  return reason === 'setup' ? SETUP_PEEK_MS : GRANTED_PEEK_MS;
}

function keyFor(owner: PlayerId, slot: number): string {
  return `${owner}:${slot}`;
}

/** Pure reducer: fold one peek event into the active-peek map, stamping each
 *  revealed slot with an absolute expiry (`now + ttl`). Deadline-based so it is
 *  independent of any timer — the hook only needs to schedule the eventual
 *  removal. Exported for deterministic testing of the #28 race. */
export function reducePeek(
  prev: ReadonlyMap<string, ActivePeek>,
  ev: PeekEvent,
  now: number,
): Map<string, ActivePeek> {
  const ttl = peekTtlMs(ev.reason);
  const next = new Map(prev);
  for (const reveal of ev.reveals) {
    next.set(keyFor(reveal.owner, reveal.slot), { card: reveal.card, expiresAt: now + ttl });
  }
  return next;
}

export function usePeeks(events: EngineEvent[], myId: PlayerId | null) {
  const [peeks, setPeeks] = useState<Map<string, ActivePeek>>(new Map());
  const seenCount = useRef(0);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!myId) return;
    // The events array is append-only but capped (see useGameSocket), so if it
    // was trimmed since we last looked, restart from the front rather than
    // slicing past the end and silently dropping events.
    if (seenCount.current > events.length) seenCount.current = 0;
    // Only process events we haven't already handled — this is what keeps each
    // private peek processed EXACTLY once, even when the view immediately
    // advances to `turn` and re-renders us (issue #28).
    const newEvents = events.slice(seenCount.current);
    seenCount.current = events.length;
    if (newEvents.length === 0) return;

    for (const ev of newEvents) {
      if (ev.type !== 'peek') continue;
      if (ev.to !== myId) continue;
      const ttl = peekTtlMs(ev.reason);
      const now = Date.now();
      setPeeks((prev) => reducePeek(prev, ev, now));
      for (const reveal of ev.reveals) {
        const key = keyFor(reveal.owner, reveal.slot);
        const existing = timers.current.get(key);
        if (existing) clearTimeout(existing);
        const t = setTimeout(() => {
          setPeeks((prev) => {
            const next = new Map(prev);
            next.delete(key);
            return next;
          });
          timers.current.delete(key);
        }, ttl);
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
      peekAt: (owner: PlayerId, slot: number): Card | null => peeks.get(keyFor(owner, slot))?.card ?? null,
      hasAny: peeks.size > 0,
    }),
    [peeks],
  );
}
