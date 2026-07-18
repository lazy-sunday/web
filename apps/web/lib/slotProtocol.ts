import type { PlayerId, RoundView } from '@lazy-sunday/engine';
import type { ClientCommand, VisualClientCommand, WireActionInput } from '@lazy-sunday/server/protocol';
import { compactSlotFor } from './slots';

function listSlotsFor(view: RoundView, playerId: PlayerId): boolean[] {
  const player = view.players.find((candidate) => candidate.id === playerId);
  if (!player) return [];
  return player.listSlots ?? Array.from({ length: player.listSize }, () => true);
}

function wireSlot(view: RoundView, playerId: PlayerId, visualSlot: number) {
  return {
    slot: compactSlotFor(listSlotsFor(view, playerId), visualSlot) ?? visualSlot,
    visualSlot,
  };
}

function encodeActionInput(
  view: RoundView,
  playerId: PlayerId,
  input: Extract<VisualClientCommand, { type: 'actionInput' }>['input'],
): WireActionInput {
  switch (input.action) {
    case 'Check the List':
    case 'Knock It Out':
      return { action: input.action, ...wireSlot(view, playerId, input.slot) };
    case "Let's Trade":
      return {
        action: input.action,
        mySlot: wireSlot(view, playerId, input.mySlot).slot,
        myVisualSlot: input.mySlot,
        opponentId: input.opponentId,
        opponentSlot: wireSlot(view, input.opponentId, input.opponentSlot).slot,
        opponentVisualSlot: input.opponentSlot,
      };
    case 'Switcheroo':
      return {
        action: input.action,
        a: input.a,
        aSlot: wireSlot(view, input.a, input.aSlot).slot,
        aVisualSlot: input.aSlot,
        b: input.b,
        bSlot: wireSlot(view, input.b, input.bSlot).slot,
        bVisualSlot: input.bSlot,
      };
    case 'Snoop':
      return {
        action: input.action,
        targetId: input.targetId,
        ...wireSlot(view, input.targetId, input.slot),
      };
    case 'Not My Job':
      return {
        action: input.action,
        fromId: input.fromId,
        fromSlot: wireSlot(view, input.fromId, input.fromSlot).slot,
        fromVisualSlot: input.fromSlot,
        toId: input.toId,
      };
    case "Landlord's Notice":
    case "I'm Busy":
      return input;
  }
}

/** Keeps legacy compact slots in the original fields while adding explicit
 * visual slots for current servers. */
export function encodeClientCommand(
  command: VisualClientCommand,
  view: RoundView | null,
  playerId: PlayerId | null,
): ClientCommand {
  if (!view || !playerId) return command as ClientCommand;
  switch (command.type) {
    case 'setupPeek':
    case 'keepDrawn':
    case 'takeFromDone':
    case 'giveCard':
      return { type: command.type, ...wireSlot(view, playerId, command.slot) };
    case 'slap':
      return {
        type: command.type,
        owner: command.owner,
        ...wireSlot(view, command.owner, command.slot),
        ...(command.expectedTopId !== undefined ? { expectedTopId: command.expectedTopId } : {}),
      };
    case 'actionInput':
      return { type: command.type, input: encodeActionInput(view, playerId, command.input) };
    default:
      return command;
  }
}
