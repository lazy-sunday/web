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
// Slot numbers shown here are the engine's public list positions (0-based
// internally, shown 1-based). Which slot was touched is public per issue #30
// ("Peek actions may identify actor, target player, and public slot position");
// the card sitting there is not, and is never included.

import type { ActionName, EngineEvent, PlayerId } from '@lazy-sunday/engine';

export interface ActivityEntry {
  /** Stable id within one recompute: the event index where this entry began.
   *  Lets React key rows and lets the announcement detect a genuinely new item. */
  id: number;
  /** Index of the most recent event folded into this entry. Advances when an
   *  action's outcome updates its start line, so the announcement re-announces. */
  seq: number;
  actor: PlayerId | null;
  /** One public, privacy-safe sentence describing the move. */
  text: string;
  /** 'pending' = announced but not yet resolved (mid-action); 'resolved' = done. */
  status: 'pending' | 'resolved';
  /** True for the eight playable actions (§5). Only these drive the center
   *  announcement; slaps/draws/etc. live in the log but never take the spotlight. */
  isAction: boolean;
  action?: ActionName;
}

type NameOf = (id: PlayerId | null) => string;

/** 1-based, human-facing slot label from the engine's 0-based public position. */
function slotLabel(slot: number): string {
  return `slot ${slot + 1}`;
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
export function buildActivityLog(events: readonly EngineEvent[], nameOf: NameOf): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  // The action currently awaiting its outcome, if any.
  let active: ActivityEntry | null = null;
  // Knock It Out peeks a slot before the keep/discard decision; remember it so
  // the "kept" line can still name the public slot position.
  let activeKnockSlot: number | null = null;

  const resolveWith = (i: number, text: string): void => {
    if (active) {
      active.seq = i;
      active.text = text;
      active.status = 'resolved';
    } else {
      entries.push({ id: i, seq: i, actor: null, text, status: 'resolved', isAction: false });
    }
    active = null;
    activeKnockSlot = null;
  };

  events.forEach((event, i) => {
    switch (event.type) {
      case 'actionStarted': {
        // A new action supersedes any still-pending one. In normal play an
        // action always resolves before the next begins; this only guards a
        // malformed/rapid stream so a stale "…" never lingers forever.
        if (active) active.status = 'resolved';
        const entry: ActivityEntry = {
          id: i,
          seq: i,
          actor: event.player,
          status: 'pending',
          isAction: true,
          action: event.action,
          text: `${nameOf(event.player)} is playing ${event.action}…`,
        };
        entries.push(entry);
        active = entry;
        activeKnockSlot = null;
        return;
      }

      // -- action outcomes (§5). Positions are public; identities never appear. --
      case 'checkedTheList':
        resolveWith(i, `${nameOf(event.player)} checked their own card (${slotLabel(event.slot)}).`);
        return;
      case 'knockItOutPeeked': {
        // Peeked, decision still pending — keep the entry pending (unresolved).
        activeKnockSlot = event.slot;
        if (active) {
          active.seq = i;
          active.text = `${nameOf(event.player)} is deciding on their card (${slotLabel(event.slot)})…`;
        }
        return;
      }
      case 'knockedOut':
        // §9.5: the self-discard is face-up on DONE, so its name is public.
        resolveWith(i, `${nameOf(event.player)} knocked out their ${event.card.name}.`);
        return;
      case 'knockItOutKept': {
        const where = activeKnockSlot !== null ? ` (${slotLabel(activeKnockSlot)})` : '';
        resolveWith(i, `${nameOf(event.player)} peeked and kept their card${where}.`);
        return;
      }
      case 'traded':
        // Blind swap: positions only, no cards named (§5 "No peeking").
        resolveWith(
          i,
          `${nameOf(event.player)} blind-swapped their card (${slotLabel(event.mySlot)}) with ${nameOf(event.opponentId)}'s (${slotLabel(event.opponentSlot)}).`,
        );
        return;
      case 'switcherood':
        resolveWith(
          i,
          `${nameOf(event.player)} switched ${nameOf(event.a)}'s card (${slotLabel(event.aSlot)}) with ${nameOf(event.b)}'s (${slotLabel(event.bSlot)}).`,
        );
        return;
      case 'snooped':
        // Actor + target + public slot are visible; the face went only to the
        // actor via a private `peek` event (never through this log).
        resolveWith(i, `${nameOf(event.player)} snooped ${nameOf(event.targetId)}'s card (${slotLabel(event.slot)}).`);
        return;
      case 'notMyJobbed':
        resolveWith(
          i,
          `${nameOf(event.player)} moved a card from ${nameOf(event.fromId)} (${slotLabel(event.fromSlot)}) to ${nameOf(event.toId)} (${slotLabel(event.toSlot)}).`,
        );
        return;
      case 'landlordsNoticed':
        // §5 "No one sees it": we name the recipient + public slot, never the card.
        resolveWith(i, `${nameOf(event.player)} slid a face-down card onto ${nameOf(event.targetId)}'s list (${slotLabel(event.slot)}).`);
        return;
      case 'imBusied':
        resolveWith(i, `${nameOf(event.player)} played "I'm Busy" — ${nameOf(event.targetId)}'s next turn is skipped.`);
        return;
      case 'actionCancelled':
        // Also the server-timeout path for an unresolved action (round.ts).
        resolveWith(i, `${nameOf(event.player)} didn't play ${event.action}.`);
        return;

      // -- everything else: standalone log lines (no spotlight) --
      default: {
        const line = describeStandalone(event, nameOf);
        if (line) {
          entries.push({ id: i, seq: i, actor: line.actor, text: line.text, status: 'resolved', isAction: false });
        }
      }
    }
  });

  return entries;
}

/** The latest action entry — the one the center announcement spotlights. */
export function latestActionEntry(entries: readonly ActivityEntry[]): ActivityEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]!.isAction) return entries[i]!;
  }
  return null;
}

/** Non-action public events that still belong in the log. Card names appear
 *  only where the rules already make them public (discards, slaps). Returns
 *  null for events we don't log (turn/setup churn) and for private events
 *  (`peek`/`drawnCard`) the current player receives about their own cards. */
function describeStandalone(
  event: EngineEvent,
  nameOf: NameOf,
): { actor: PlayerId | null; text: string } | null {
  switch (event.type) {
    case 'drew':
      return { actor: event.player, text: `${nameOf(event.player)} drew a card.` };
    case 'kept':
      return { actor: event.player, text: `${nameOf(event.player)} kept the drawn card.` };
    case 'discarded':
      // The discarded card is face-up on DONE — its name is public (§4A).
      return { actor: event.player, text: `${nameOf(event.player)} discarded ${event.card.name} to DONE.` };
    case 'tookFromDone':
      // The taken card was the public DONE top; its name is already known (§4B).
      return { actor: event.player, text: `${nameOf(event.player)} took ${event.taken.name} from DONE.` };
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
      return { actor: event.from, text: `${nameOf(event.from)} handed ${nameOf(event.to)} a card, face-down.` };
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
