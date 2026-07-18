import type { Command, PlayerId, PlayerRoundState, RoundState } from '@lazy-sunday/engine';
import type { ClientCommand, WireActionInput } from './protocol.js';

function playerById(state: RoundState, id: PlayerId): PlayerRoundState | undefined {
  return state.players.find((player) => player.id === id);
}

function visualSlotFor(
  player: PlayerRoundState | undefined,
  compactSlot: number,
  explicitVisualSlot: number | undefined,
): number {
  if (Number.isInteger(explicitVisualSlot)) return explicitVisualSlot!;
  if (!Number.isInteger(compactSlot)) return compactSlot;
  return player?.slotPositions[compactSlot] ?? compactSlot;
}

function normalizeActionInput(state: RoundState, playerId: PlayerId, input: WireActionInput) {
  const me = playerById(state, playerId);
  switch (input.action) {
    case 'Check the List':
    case 'Knock It Out':
      return { action: input.action, slot: visualSlotFor(me, input.slot, input.visualSlot) };
    case "Let's Trade":
      return {
        action: input.action,
        mySlot: visualSlotFor(me, input.mySlot, input.myVisualSlot),
        opponentId: input.opponentId,
        opponentSlot: visualSlotFor(
          playerById(state, input.opponentId),
          input.opponentSlot,
          input.opponentVisualSlot,
        ),
      };
    case 'Switcheroo':
      return {
        action: input.action,
        a: input.a,
        aSlot: visualSlotFor(playerById(state, input.a), input.aSlot, input.aVisualSlot),
        b: input.b,
        bSlot: visualSlotFor(playerById(state, input.b), input.bSlot, input.bVisualSlot),
      };
    case 'Snoop':
      return {
        action: input.action,
        targetId: input.targetId,
        slot: visualSlotFor(playerById(state, input.targetId), input.slot, input.visualSlot),
      };
    case 'Not My Job':
      return {
        action: input.action,
        fromId: input.fromId,
        fromSlot: visualSlotFor(playerById(state, input.fromId), input.fromSlot, input.fromVisualSlot),
        toId: input.toId,
      };
    case "Landlord's Notice":
    case "I'm Busy":
      return input;
  }
}

/** Converts the backwards-compatible wire shape into the engine's visual-slot
 * command shape. Old clients provide compact fields only; current clients also
 * provide explicit visual fields, which take precedence. */
export function normalizeClientCommand(
  state: RoundState,
  playerId: PlayerId,
  clientCommand: ClientCommand,
): Command {
  const me = playerById(state, playerId);
  switch (clientCommand.type) {
    case 'setupPeek':
    case 'keepDrawn':
    case 'takeFromDone':
    case 'giveCard':
      return {
        type: clientCommand.type,
        player: playerId,
        slot: visualSlotFor(me, clientCommand.slot, clientCommand.visualSlot),
      } as Command;
    case 'slap':
      return {
        type: clientCommand.type,
        player: playerId,
        owner: clientCommand.owner,
        slot: visualSlotFor(
          playerById(state, clientCommand.owner),
          clientCommand.slot,
          clientCommand.visualSlot,
        ),
        ...(clientCommand.expectedTopId !== undefined
          ? { expectedTopId: clientCommand.expectedTopId }
          : {}),
      };
    case 'actionInput':
      return {
        type: clientCommand.type,
        player: playerId,
        input: normalizeActionInput(state, playerId, clientCommand.input),
      } as Command;
    default:
      return { ...clientCommand, player: playerId } as Command;
  }
}
