'use client';

// Shared table feedback for played actions (issue #30):
//
//  - ActionAnnouncement: a privacy-safe spotlight near the center table. On
//    `actionStarted` it shows "X is playing Y…"; when the public outcome lands
//    it updates the SAME line, stays visible for ten seconds, then fades. It is the only
//    aria-live region here (polite + atomic) so screen readers hear a single,
//    restrained start/outcome update — not every draw and discard.
//
//  - ActivityLog: a collapsible, durable list of recent public moves built from
//    the same entries. Not a live region (reading it is opt-in), so it never
//    competes with the announcement for the screen reader.
//
// Both are pure views over `buildActivityLog` output; neither holds game truth.
// The log is session-local: the server intentionally does not replay past
// events on reconnect (privacy; persistent replay is out of scope), so a fresh
// connection starts with an empty log while the authoritative table view is
// restored as usual.

import { useEffect, useRef, useState } from 'react';
import { activityEntryKey, type ActivityEntry, type ActivityVisual } from '../lib/activity';

export const ACTIVITY_SPOTLIGHT_MS = 10_000;
const LOG_VISIBLE_MAX = 40;

/**
 * Keep the latest meaningful table event visible for exactly ten seconds.
 * The lifecycle key changes only for a genuinely new event or start→outcome
 * update, so unrelated socket traffic cannot revive an old announcement.
 */
export function useActivitySpotlight(entry: ActivityEntry | null): ActivityEntry | null {
  const [shown, setShown] = useState<ActivityEntry | null>(null);
  const latest = useRef(entry);
  latest.current = entry;
  const lifecycleKey = activityEntryKey(entry);

  useEffect(() => {
    const next = latest.current;
    if (!next || lifecycleKey === null) {
      setShown(null);
      return undefined;
    }
    setShown(next);
    const timer = setTimeout(() => setShown(null), ACTIVITY_SPOTLIGHT_MS);
    return () => clearTimeout(timer);
  }, [lifecycleKey]);

  return shown;
}

/** Center-table spotlight for the latest action or public card placement. */
export function ActionAnnouncement({ entry }: { entry: ActivityEntry | null }) {
  if (!entry) return null;

  const lifecycleKey = activityEntryKey(entry) ?? 'activity';

  return (
    <div
      key={lifecycleKey}
      className="action-announce"
      data-status={entry.status}
      data-visual={entry.visual?.kind ?? 'text'}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="action-announce-dot" aria-hidden />
      <ActivityMotion visual={entry.visual} />
      <span className="action-announce-text">{entry.text}</span>
    </div>
  );
}

/** Small symbolic cue; the matching real slots receive a visible ring too. */
function ActivityMotion({ visual }: { visual: ActivityVisual | undefined }) {
  if (!visual) return null;
  if (visual.kind === 'focus') {
    return (
      <span className="activity-motion" data-kind="focus" aria-hidden>
        <span className="activity-mini-card" data-target="true" />
      </span>
    );
  }
  const twoCards = visual.kind === 'swap';
  return (
    <span className="activity-motion" data-kind={visual.kind} aria-hidden>
      <span className="activity-mini-card" />
      <svg className="activity-motion-arrow" viewBox="0 0 28 18" focusable="false">
        {twoCards ? (
          <>
            <path d="M3 6h18m0 0-4-4m4 4-4 4" />
            <path d="M25 12H7m0 0 4-4m-4 4 4 4" />
          </>
        ) : (
          <path d="M3 9h20m0 0-5-5m5 5-5 5" />
        )}
      </svg>
      <span className="activity-mini-card" data-target="true" />
    </span>
  );
}

/** Collapsible recent-activity log (newest first). */
export function ActivityLog({ entries }: { entries: ActivityEntry[] }) {
  const [open, setOpen] = useState(false);
  // Newest first, capped — the log is "recent activity", not a full replay.
  const recent = entries.slice(-LOG_VISIBLE_MAX).reverse();

  return (
    <div className="activity-log" data-open={open}>
      <button
        type="button"
        className="activity-log-toggle"
        aria-expanded={open}
        aria-controls="activity-log-list"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="activity-log-chevron" aria-hidden data-open={open}>
          ▸
        </span>
        <span>Recent activity</span>
        {recent.length > 0 && <span className="activity-log-count">{recent.length}</span>}
      </button>

      {open && (
        <div className="activity-log-body">
          <ol id="activity-log-list" className="activity-log-list" aria-label="Recent public actions">
            {recent.length === 0 ? (
              <li className="activity-log-empty">Nothing yet — the table is quiet.</li>
            ) : (
              recent.map((e) => (
                <li key={e.id} className="activity-log-item" data-status={e.status}>
                  {e.text}
                </li>
              ))
            )}
          </ol>
          <p className="activity-log-note">Since you connected — history isn&apos;t restored on reconnect.</p>
        </div>
      )}
    </div>
  );
}
