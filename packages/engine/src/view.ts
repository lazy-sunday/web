// Per-player redaction. THIS is the only shape that may ever be serialized to a
// client. Face-down identities (and even their stable ids) stay server-side so a
// modified client can't out-remember a human — memory is the game.

import type { ActionName, Card } from './cards.js';
import { actionUnavailableReason, type ActionUnavailableReason } from './actionAvailability.js';
import type { PendingGift, Phase, PlayerId, RoundResult, RoundState } from './types.js';

export interface PlayerView {
  id: PlayerId;
  /** Number of face-down cards in their chore list. Identities are never included. */
  listSize: number;
  /** Public occupancy only: true means a card exists at that visual table slot. */
  listSlots: boolean[];
  skipNextTurn: boolean;
  setupPeeked: boolean;
}

export interface RoundView {
  phase: Phase;
  /** Whose turn it is (null during setupPeek/reveal). */
  currentPlayer: PlayerId | null;
  caller: PlayerId | null;
  finalTurnQueue: PlayerId[];
  deckCount: number;
  doneCount: number;
  /** The DONE pile's top card — always visible; it's the slap target. Its id is
   *  what clients echo back as `expectedTopId` when slapping. */
  doneTop: Card | null;
  players: PlayerView[];
  /** Setup slots selected by this view's recipient. Never includes another player's selections. */
  mySetupPeekSlots: number[];
  /** The drawn card, present ONLY in the current player's own view during 'drawn'. */
  myDrawnCard: Card | null;
  /** Why the drawn action cannot be played right now. Present only in the
   * drawing player's view; null means the action is available. */
  myDrawnActionUnavailableReason: ActionUnavailableReason | null;
  pendingAction: {
    actor: PlayerId;
    action: ActionName;
    step: 'input' | 'knockItOutDecision';
    /** Which slot was peeked (public — everyone saw which card was picked up). */
    knockSlot?: number;
  } | null;
  pendingGift: Pick<PendingGift, 'from' | 'to'> | null;
  /** Set at reveal: full face-up lists, totals, and round scores are then public. */
  result: RoundResult | null;
}

export function viewFor(state: RoundState, playerId: PlayerId): RoundView {
  const inPlay = state.phase === 'turn' || state.phase === 'drawn' || state.phase === 'action';
  const pa = state.pendingAction;
  const recipient = state.players.find((p) => p.id === playerId);
  const recipientDrewCard =
    state.phase === 'drawn' && state.players[state.turn]!.id === playerId
      ? state.drawnCard
      : null;
  return {
    phase: state.phase,
    currentPlayer: inPlay ? state.players[state.turn]!.id : null,
    caller: state.caller,
    finalTurnQueue: state.finalTurnQueue.slice(),
    deckCount: state.deck.length,
    doneCount: state.done.length,
    doneTop: state.done.length > 0 ? { ...state.done[state.done.length - 1]! } : null,
    players: state.players.map((p) => ({
      id: p.id,
      listSize: p.list.length,
      listSlots: listSlotsOf(p.slotPositions),
      skipNextTurn: p.skipNextTurn,
      setupPeeked: p.setupPeeked,
    })),
    mySetupPeekSlots: recipient?.setupPeekSlots.slice() ?? [],
    myDrawnCard: recipientDrewCard ? { ...recipientDrewCard } : null,
    myDrawnActionUnavailableReason:
      recipientDrewCard?.kind === 'action'
        ? actionUnavailableReason(state, playerId, recipientDrewCard.name as ActionName)
        : null,
    pendingAction: pa
      ? {
          actor: pa.actor,
          action: pa.card.name as ActionName,
          step: pa.step,
          ...(pa.knockSlot !== undefined ? { knockSlot: pa.knockSlot } : {}),
        }
      : null,
    pendingGift: state.pendingGift
      ? { from: state.pendingGift.from, to: state.pendingGift.to }
      : null,
    result: state.result ? structuredClone(state.result) : null,
  };
}

function listSlotsOf(slotPositions: number[]): boolean[] {
  if (slotPositions.length === 0) return [];
  const maxSlot = Math.max(...slotPositions);
  const slots = Array.from({ length: maxSlot + 1 }, () => false);
  for (const slot of slotPositions) slots[slot] = true;
  return slots;
}

/** Events routed to ONE player only — their `to` field is a socket address, not a
 *  domain value. Everything else is public. Kept as an explicit allowlist so a
 *  public event that happens to carry a `to` field (e.g. `giftGiven.to` = the gift
 *  recipient) is not mistaken for a private message and hidden from bystanders. */
const PRIVATE_EVENT_TYPES = new Set<string>(['peek', 'drawnCard']);

/** True if this event may be sent to this player. */
export function eventVisibleTo(event: { type: string; to?: PlayerId }, playerId: PlayerId): boolean {
  if (!PRIVATE_EVENT_TYPES.has(event.type)) return true;
  return event.to === playerId;
}
