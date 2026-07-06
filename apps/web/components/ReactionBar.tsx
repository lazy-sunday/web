'use client';

// Emoji reactions (v1 non-goal is chat — "use emoji reactions instead").
// A small always-reachable bar of 6 emoji; tapping one sends
// {type:'reaction', emoji} over the wire (client-side rate-limited to
// 1/sec in useGameSocket). Incoming reactions float up briefly near the
// sending player's seat via <FloatingReactions>.

import { useEffect, useState } from 'react';
import type { PlayerId } from '@lazy-sunday/engine';
import type { ReactionEvent } from '../lib/useGameSocket';

const REACTIONS = ['😂', '😱', '😅', '👀', '🔥', '🙌'] as const;

export function ReactionBar({ onSend }: { onSend: (emoji: string) => void }) {
  return (
    <div className="reaction-bar" role="group" aria-label="Send a reaction">
      {REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="reaction-btn"
          aria-label={`React with ${emoji}`}
          onClick={() => onSend(emoji)}
        >
          <span aria-hidden>{emoji}</span>
        </button>
      ))}
    </div>
  );
}

const FLOAT_MS = 2200;

/** Floating reaction toasts, one per incoming reaction, near the top of the
 *  table with the sender's name so it reads even without a fixed seat
 *  position (seats reflow depending on who "you" are). Auto-expire. */
export function FloatingReactions({
  reactions,
  nameOf,
}: {
  reactions: ReactionEvent[];
  nameOf: (id: PlayerId | null) => string;
}) {
  const [visible, setVisible] = useState<ReactionEvent[]>([]);

  useEffect(() => {
    const last = reactions[reactions.length - 1];
    if (!last) return;
    setVisible((prev) => [...prev, last]);
    const t = setTimeout(() => {
      setVisible((prev) => prev.filter((r) => r.id !== last.id));
    }, FLOAT_MS);
    return () => clearTimeout(t);
  }, [reactions]);

  if (visible.length === 0) return null;

  return (
    <div className="floating-reactions" aria-live="polite">
      {visible.map((r) => (
        <span key={r.id} className="floating-reaction">
          <span className="floating-reaction-emoji" aria-hidden>
            {r.emoji}
          </span>
          <span className="floating-reaction-name">{nameOf(r.player)}</span>
        </span>
      ))}
    </div>
  );
}
