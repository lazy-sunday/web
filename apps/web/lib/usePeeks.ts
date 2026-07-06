'use client';

// Peek memory. ANY peek event addressed to me (setup peek now; Check the
// List / Knock It Out / Snoop arrive wired the same way in M4) shows the
// card face overlaid on that slot for a few seconds, only ever to me, then
// hides it again. This hook is the ONLY place that timer lives — it never
// writes an always-visible label of what was peeked; once the timeout
// fires the entry is gone and the slot goes back to face-down.
//
// Source of truth: `game.events` (filtered per-player by the server — see
// protocol.ts). A `peek` event only ever reaches the socket it's addressed
// to, so we don't need to re-check `to` here, but we do anyway as
// belt-and-braces against future event plumbing changes.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Card, EngineEvent, PlayerId } from '@lazy-sunday/engine';

export interface ActivePeek {
  card: Card;
  /** ms remaining is derived by the caller from `expiresAt`; we just hold the deadline. */
  expiresAt: number;
}

/** Setup peek (§3.3) gets the long 10s display; granted peeks (§5) get 4s. */
const SETUP_PEEK_MS = 10_000;
const GRANTED_PEEK_MS = 4_000;

function keyFor(owner: PlayerId, slot: number): string {
  return `${owner}:${slot}`;
}

export function usePeeks(events: EngineEvent[], myId: PlayerId | null, phase: string | null) {
  const [peeks, setPeeks] = useState<Map<string, ActivePeek>>(new Map());
  const seenCount = useRef(0);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!myId) return;
    // Only process events we haven't already handled (events array is append-only + capped).
    const newEvents = events.slice(seenCount.current);
    seenCount.current = events.length;
    if (newEvents.length === 0) return;

    for (const ev of newEvents) {
      if (ev.type !== 'peek') continue;
      if (ev.to !== myId) continue;
      const isSetup = phase === 'setupPeek';
      const ttl = isSetup ? SETUP_PEEK_MS : GRANTED_PEEK_MS;
      const deadline = Date.now() + ttl;
      setPeeks((prev) => {
        const next = new Map(prev);
        for (const reveal of ev.reveals) {
          const key = keyFor(reveal.owner, reveal.slot);
          next.set(key, { card: reveal.card, expiresAt: deadline });
        }
        return next;
      });
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
  }, [events, myId, phase]);

  useEffect(() => {
    return () => {
      for (const t of timers.current.values()) clearTimeout(t);
      timers.current.clear();
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
