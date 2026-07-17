// Table activity model (issue #30): turns the filtered engine event stream into
// a privacy-safe, shared record of what happened at the table — one line per
// public action/move, with actions folded from "started" to their public
// outcome so the whole table sees consistent start + resolution copy.
//
// This is PURE presentation logic. It never invents state; it only re-describes
// events the player is already entitled to receive (server routes them via
// `eventVisibleTo`). It NEVER prints a face-down card identity: the only card
// names it can emit come from events the rules already make public — DONE-pile
// discards, slap outcomes, and the Knock It Out self-discard (§5, §9.5). Peek /
// Snoop faces live only in `usePeeks`, never here.
//
// Slot numbers shown here are visual table positions (0-based internally,
// shown 1-based). Engine commands still use compact list slots, but the table
// keeps visual gaps after discards, so public activity copy must name the
// original visual position.

import type { ActionName, EngineEvent, PlayerId } from '@lazy-sunday/engine';
import { isTableActivitySpotlightEventType } from '@lazy-sunday/server/protocol';

export type ActivitySlotRole = 'focus' | 'swap' | 'target';

export interface ActivitySlotVisual {
  player: PlayerId;
  /** Visual table slot, not compact command slot. */
  slot: number;
  role: ActivitySlotRole;
}

export interface ActivityVisual {
  /** `swap` shows two exchanging cards; `move` shows a card travelling; `focus`
   *  shows one affected card. The real table slots are highlighted as well. */
  kind: 'focus' | 'move' | 'swap';
  slots: ActivitySlotVisual[];
}

export interface ActivityEntry {
  /** Stable id for the event where this entry began. */
  id: number;
  /** Id of the most recent event folded into this entry. Advances when an
   *  action's outcome updates its start line, so the announcement re-announces. */
  seq: number;
  actor: PlayerId | null;
  /** One public, privacy-safe sentence describing the move. */
  text: string;
  /** 'pending' = announced but not yet resolved (mid-action); 'resolved' = done. */
  status: 'pending' | 'resolved';
  /** True for the eight playable actions (§5). */
  isAction: boolean;
  /** Shared UI/server classification: this entry pauses the turn clock while
   *  it occupies the center-table spotlight. */
  spotlight: boolean;
  action?: ActionName;
  /** Optional privacy-safe visual treatment for affected public card slots. */
  visual?: ActivityVisual;
}

type NameOf = (id: PlayerId | null) => string;
type EventIdOf = (event: EngineEvent, index: number) => number;

/** 1-based, human-facing slot label from the engine's 0-based public position. */
function slotLabel(slot: number): string {
  return `slot ${slot + 1}`;
}

function publicSlot(slot: number, visualSlot: number | undefined): number {
  return visualSlot ?? slot;
}

/**
 * Fold the filtered event stream into ordered activity entries.
 *
 * Action lifecycle is grouped: `actionStarted` opens a pending entry, and the
 * matching outcome event (or `actionCancelled`, which also fires on a server
 * timeout mid-action — see round.ts forceSkip) updates THAT SAME entry to its
 * resolved public outcome. One entry per action means no duplicate "played X"
 * lines and no premature replacement of the start line before it resolves.
 *
 * If an outcome arrives with no start we saw (e.g. we connected mid-action —
 * the server does not replay past events), the outcome is still shown as its
 * own resolved entry so the table stays consistent.
 */
export function buildActivityLog(
  events: readonly EngineEvent[],
  nameOf: NameOf,
  eventIdOf: EventIdOf = (_event, index) => index,
): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  // The action currently awaiting its outcome, if any.
  let active: ActivityEntry | null = null;
  // Knock It Out peeks a slot before the keep/discard decision; remember it so
  // the "kept" line can still name the public slot position.
  let activeKnockVisualSlot: number | null = null;

  const resolveWith = (
    seq: number,
    actor: PlayerId,
    action: ActionName,
    text: string,
    visual?: ActivityVisual,
  ): void => {
    if (active) {
      active.seq = seq;
      active.actor = actor;
      active.action = action;
      active.text = text;
      active.status = 'resolved';
      active.visual = visual;
    } else {
      // A client can connect after actionStarted but before the public outcome.
      // Keep the orphan outcome eligible for the center spotlight.
      entries.push({ id: seq, seq, actor, action, text, status: 'resolved', isAction: true, spotlight: true, visual });
    }
    active = null;
    activeKnockVisualSlot = null;
  };

  events.forEach((event, i) => {
    const seq = eventIdOf(event, i);
    switch (event.type) {
      case 'actionStarted': {
        // A new action supersedes any still-pending one. In normal play an
        // action always resolves before the next begins; this only guards a
        // malformed/rapid stream so a stale "…" never lingers forever.
        if (active) active.status = 'resolved';
        const entry: ActivityEntry = {
          id: seq,
          seq,
          actor: event.player,
          status: 'pending',
          isAction: true,
          spotlight: true,
          action: event.action,
          text: `${nameOf(event.player)} is playing ${event.action}…`,
        };
        entries.push(entry);
        active = entry;
        activeKnockVisualSlot = null;
        return;
      }

      // -- action outcomes (§5). Positions are public; identities never appear. --
      case 'checkedTheList':
        resolveWith(
          seq,
          event.player,
          'Check the List',
          `${nameOf(event.player)} checked their own card (${slotLabel(publicSlot(event.slot, event.visualSlot))}).`,
          { kind: 'focus', slots: [{ player: event.player, slot: publicSlot(event.slot, event.visualSlot), role: 'focus' }] },
        );
        return;
      case 'knockItOutPeeked': {
        // Peeked, decision still pending — keep the entry pending (unresolved).
        activeKnockVisualSlot = publicSlot(event.slot, event.visualSlot);
        if (active) {
          active.seq = seq;
          active.text = `${nameOf(event.player)} is deciding on their card (${slotLabel(activeKnockVisualSlot)})…`;
          active.visual = { kind: 'focus', slots: [{ player: event.player, slot: activeKnockVisualSlot, role: 'focus' }] };
        } else {
          const entry: ActivityEntry = {
            id: seq,
            seq,
            actor: event.player,
            action: 'Knock It Out',
            status: 'pending',
            isAction: true,
            spotlight: true,
            text: `${nameOf(event.player)} is deciding on their card (${slotLabel(activeKnockVisualSlot)})…`,
            visual: { kind: 'focus', slots: [{ player: event.player, slot: activeKnockVisualSlot, role: 'focus' }] },
          };
          entries.push(entry);
          active = entry;
        }
        return;
      }
      case 'knockedOut':
        // §9.5: the self-discard is face-up on DONE, so its name is public.
        resolveWith(seq, event.player, 'Knock It Out', `${nameOf(event.player)} knocked out their ${event.card.name}.`);
        return;
      case 'knockItOutKept': {
        const where = activeKnockVisualSlot !== null ? ` (${slotLabel(activeKnockVisualSlot)})` : '';
        const visual = activeKnockVisualSlot === null
          ? undefined
          : { kind: 'focus' as const, slots: [{ player: event.player, slot: activeKnockVisualSlot, role: 'focus' as const }] };
        resolveWith(seq, event.player, 'Knock It Out', `${nameOf(event.player)} peeked and kept their card${where}.`, visual);
        return;
      }
      case 'traded':
        // Blind swap: positions only, no cards named (§5 "No peeking").
        resolveWith(
          seq,
          event.player,
          "Let's Trade",
          `${nameOf(event.player)} blind-swapped their card (${slotLabel(publicSlot(event.mySlot, event.myVisualSlot))}) with ${nameOf(event.opponentId)}'s (${slotLabel(publicSlot(event.opponentSlot, event.opponentVisualSlot))}).`,
          {
            kind: 'swap',
            slots: [
              { player: event.player, slot: publicSlot(event.mySlot, event.myVisualSlot), role: 'swap' },
              { player: event.opponentId, slot: publicSlot(event.opponentSlot, event.opponentVisualSlot), role: 'swap' },
            ],
          },
        );
        return;
      case 'switcherood':
        resolveWith(
          seq,
          event.player,
          'Switcheroo',
          `${nameOf(event.player)} switched ${nameOf(event.a)}'s card (${slotLabel(publicSlot(event.aSlot, event.aVisualSlot))}) with ${nameOf(event.b)}'s (${slotLabel(publicSlot(event.bSlot, event.bVisualSlot))}).`,
          {
            kind: 'swap',
            slots: [
              { player: event.a, slot: publicSlot(event.aSlot, event.aVisualSlot), role: 'swap' },
              { player: event.b, slot: publicSlot(event.bSlot, event.bVisualSlot), role: 'swap' },
            ],
          },
        );
        return;
      case 'snooped':
        // Actor + target + public slot are visible; the face went only to the
        // actor via a private `peek` event (never through this log).
        resolveWith(
          seq,
          event.player,
          'Snoop',
          `${nameOf(event.player)} snooped ${nameOf(event.targetId)}'s card (${slotLabel(publicSlot(event.slot, event.visualSlot))}).`,
          { kind: 'focus', slots: [{ player: event.targetId, slot: publicSlot(event.slot, event.visualSlot), role: 'focus' }] },
        );
        return;
      case 'notMyJobbed':
        resolveWith(
          seq,
          event.player,
          'Not My Job',
          `${nameOf(event.player)} moved a card from ${nameOf(event.fromId)} (${slotLabel(publicSlot(event.fromSlot, event.fromVisualSlot))}) to ${nameOf(event.toId)} (${slotLabel(publicSlot(event.toSlot, event.toVisualSlot))}).`,
          {
            kind: 'move',
            slots: [{ player: event.toId, slot: publicSlot(event.toSlot, event.toVisualSlot), role: 'target' }],
          },
        );
        return;
      case 'landlordsNoticed':
        // §5 "No one sees it": we name the recipient + public slot, never the card.
        resolveWith(
          seq,
          event.player,
          "Landlord's Notice",
          `${nameOf(event.player)} slid a face-down card onto ${nameOf(event.targetId)}'s list (${slotLabel(publicSlot(event.slot, event.visualSlot))}).`,
          { kind: 'move', slots: [{ player: event.targetId, slot: publicSlot(event.slot, event.visualSlot), role: 'target' }] },
        );
        return;
      case 'imBusied':
        resolveWith(seq, event.player, "I'm Busy", `${nameOf(event.player)} played "I'm Busy" — ${nameOf(event.targetId)}'s next turn is skipped.`);
        return;
      case 'actionCancelled':
        // Also the server-timeout path for an unresolved action (round.ts).
        resolveWith(seq, event.player, event.action, `${nameOf(event.player)} didn't play ${event.action}.`);
        return;

      // -- everything else: standalone log lines (no spotlight) --
      default: {
        const line = describeStandalone(event, nameOf);
        if (line) {
          entries.push({
            id: seq,
            seq,
            actor: line.actor,
            text: line.text,
            status: 'resolved',
            isAction: false,
            spotlight: isTableActivitySpotlightEventType(event.type),
            visual: line.visual,
          });
        }
      }
    }
  });

  return entries;
}

/** The latest action or card placement worth showing at the center table. */
export function latestSpotlightEntry(entries: readonly ActivityEntry[]): ActivityEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]!.spotlight) return entries[i]!;
  }
  return null;
}

/** Stable lifecycle key: unrelated events must not restart the spotlight. */
export function activityEntryKey(entry: ActivityEntry | null): string | null {
  return entry ? `${entry.id}:${entry.seq}` : null;
}

/** Non-action public events that still belong in the log. Card names appear
 *  only where the rules already make them public (discards, slaps). Returns
 *  null for events we don't log (turn/setup churn) and for private events
 *  (`peek`/`drawnCard`) the current player receives about their own cards. */
function describeStandalone(
  event: EngineEvent,
  nameOf: NameOf,
): { actor: PlayerId | null; text: string; visual?: ActivityVisual } | null {
  switch (event.type) {
    case 'drew':
      return { actor: event.player, text: `${nameOf(event.player)} drew a card.` };
    case 'kept':
      return {
        actor: event.player,
        text: `${nameOf(event.player)} kept the drawn card (${slotLabel(publicSlot(event.slot, event.visualSlot))}).`,
        visual: { kind: 'focus', slots: [{ player: event.player, slot: publicSlot(event.slot, event.visualSlot), role: 'target' }] },
      };
    case 'discarded':
      // The discarded card is face-up on DONE — its name is public (§4A).
      return { actor: event.player, text: `${nameOf(event.player)} discarded ${event.card.name} to DONE.` };
    case 'tookFromDone':
      // The taken card was the public DONE top; its name is already known (§4B).
      return {
        actor: event.player,
        text: `${nameOf(event.player)} took ${event.taken.name} from DONE (${slotLabel(publicSlot(event.slot, event.visualSlot))}).`,
        visual: { kind: 'move', slots: [{ player: event.player, slot: publicSlot(event.slot, event.visualSlot), role: 'target' }] },
      };
    case 'notMeCalled':
      return { actor: event.caller, text: `${nameOf(event.caller)} called "NOT ME!"` };
    case 'slapCorrect':
      // Slapped card is exposed face-up, so its name is public (§6).
      return {
        actor: event.player,
        text: event.giftPending
          ? `${nameOf(event.player)} slammed "Done it!" on ${nameOf(event.owner)}'s ${event.card.name}.`
          : `${nameOf(event.player)} slammed "Done it!" on their ${event.card.name}.`,
      };
    case 'slapWrong':
      return {
        actor: event.player,
        text: event.penaltyDrawn
          ? `${nameOf(event.player)} slapped wrong (${event.card.name}) and drew a penalty.`
          : `${nameOf(event.player)} slapped wrong (${event.card.name}).`,
      };
    case 'slapTooLate':
      return { actor: event.player, text: `${nameOf(event.player)} was a split second too late.` };
    case 'giftGiven':
      // §9.7: the gift is face-down; only the fact + recipient are public.
      return {
        actor: event.from,
        text: `${nameOf(event.from)} handed ${nameOf(event.to)} a card, face-down (${slotLabel(publicSlot(event.toSlot, event.toVisualSlot))}).`,
        visual: { kind: 'move', slots: [{ player: event.to, slot: publicSlot(event.toSlot, event.toVisualSlot), role: 'target' }] },
      };
    case 'turnSkipped':
      return { actor: event.player, text: `${nameOf(event.player)}'s turn was skipped.` };
    case 'deckReshuffled':
      return { actor: null, text: `The DONE pile was reshuffled into the deck.` };
    // Not logged: turnStarted / setupPeeked churn, the reveal (its own screen),
    // and the private peek/drawnCard events (face-down knowledge, never public).
    default:
      return null;
  }
}
