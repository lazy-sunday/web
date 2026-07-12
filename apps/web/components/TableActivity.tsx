'use client';

// Shared table feedback for played actions (issue #30):
//
//  - ActionAnnouncement: a privacy-safe spotlight near the center table. On
//    `actionStarted` it shows "X is playing Y…"; when the public outcome lands
//    it updates the SAME line, then lingers briefly and fades. It is the only
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
import type { ActivityEntry } from '../lib/activity';

const ANNOUNCE_LINGER_MS = 4500;
const LOG_VISIBLE_MAX = 40;

/** Center-table spotlight for the latest action, start → outcome. */
export function ActionAnnouncement({ entry }: { entry: ActivityEntry | null }) {
  const [shown, setShown] = useState<ActivityEntry | null>(null);
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const entryId = entry?.id ?? null;
  const entrySeq = entry?.seq ?? null;
  const entryStatus = entry?.status ?? null;

  useEffect(() => {
    if (!entry) return;
    setShown(entry);
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    // A resolved outcome lingers, then fades. A pending action stays up (no
    // timer) until its outcome arrives and re-runs this effect. A brand-new
    // action (new id) cancels any prior linger — newest action wins, so rapid
    // successive plays never queue up or leave a stale spotlight.
    if (entry.status === 'resolved') {
      hideTimer.current = setTimeout(() => setVisible(false), ANNOUNCE_LINGER_MS);
    }
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    // Depends on identity (id), progress (seq) and resolution (status) so both
    // a new action and an in-place start→outcome update re-trigger.
  }, [entry, entryId, entrySeq, entryStatus]);

  if (!shown || !visible) return null;

  return (
    <div
      className="action-announce"
      data-status={shown.status}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="action-announce-dot" aria-hidden />
      <span className="action-announce-text">{shown.text}</span>
    </div>
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
