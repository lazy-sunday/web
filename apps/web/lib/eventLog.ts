/** A client-local envelope for an engine event. The sequence is monotonic for
 *  the lifetime of useGameSocket, so consumers can advance independently even
 *  while the retained event window drops older entries. */
export interface SequencedEvent<T> {
  sequence: number;
  event: T;
}

/** Append one event while retaining only the newest `limit` entries. */
export function appendEvent<T>(
  events: readonly SequencedEvent<T>[],
  event: T,
  sequence: number,
  limit: number,
): SequencedEvent<T>[] {
  const next = [...events, { sequence, event }];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** Return only entries newer than a consumer's stable sequence cursor.
 *
 * Array indexes cannot serve as cursors for a capped log: once the log is full,
 * every append also removes its first entry and the length stops changing.
 */
export function eventsAfter<T>(
  events: readonly SequencedEvent<T>[],
  lastSeenSequence: number,
): readonly SequencedEvent<T>[] {
  return events.filter(({ sequence }) => sequence > lastSeenSequence);
}
