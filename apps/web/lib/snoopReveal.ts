import type { Card, PlayerId, RoundView } from '@lazy-sunday/engine';
import { renderSlotsFor } from './slots';
import type { GameEvent } from './useGameSocket';

export const SNOOP_REVEAL_MS = 5_000;

export interface PendingSnoopReveal {
  actor: PlayerId;
  owner: PlayerId;
  visualSlot: number;
  afterSequence: number;
  requestId: number;
}

export interface MatchedSnoopReveal {
  owner: PlayerId;
  visualSlot: number;
  card: Card;
}

type PeekView = Pick<RoundView, 'players'>;

function revealVisualSlot(
  owner: PlayerId,
  compactSlot: number,
  explicitVisualSlot: number | undefined,
  view: PeekView | null,
): number {
  if (Number.isInteger(explicitVisualSlot)) return explicitVisualSlot!;
  const player = view?.players.find((candidate) => candidate.id === owner);
  return renderSlotsFor(player).find((candidate) => candidate.cardSlot === compactSlot)?.visualSlot ?? compactSlot;
}

/** Find the private peek produced by one submitted Snoop command. The sequence,
 * recipient, owner, and stable visual slot all have to match so an older peek
 * can never appear in the result panel. */
export function findSnoopReveal(
  events: readonly GameEvent[],
  pending: PendingSnoopReveal,
  view: PeekView | null,
): MatchedSnoopReveal | null {
  for (const { sequence, event } of events) {
    if (
      sequence <= pending.afterSequence ||
      event.type !== 'peek' ||
      event.reason !== 'action' ||
      event.to !== pending.actor
    ) {
      continue;
    }

    const reveal = event.reveals.find(
      (candidate) =>
        candidate.owner === pending.owner &&
        revealVisualSlot(candidate.owner, candidate.slot, candidate.visualSlot, view) === pending.visualSlot,
    );
    if (reveal) {
      return {
        owner: reveal.owner,
        visualSlot: pending.visualSlot,
        card: reveal.card,
      };
    }
  }
  return null;
}
