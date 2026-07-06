'use client';

// Small badges surfacing which §8 optional rules are active this session.
// Purely informational — no controls here (those live in the lobby toggles).

import type { RoomToggles } from '@lazy-sunday/server/protocol';

export function HouseRuleBadges({ toggles }: { toggles: RoomToggles }) {
  if (!toggles.matchTo100 && !toggles.greatEscape && !toggles.instantNotMe) return null;
  return (
    <div className="house-rule-badges" role="list" aria-label="Active house rules">
      {toggles.matchTo100 && (
        <span className="house-rule-badge" role="listitem">
          Match to 100
        </span>
      )}
      {toggles.greatEscape && (
        <span className="house-rule-badge" role="listitem">
          The Great Escape
        </span>
      )}
      {toggles.instantNotMe && (
        <span className="house-rule-badge" role="listitem">
          Instant NOT ME!
        </span>
      )}
    </div>
  );
}
