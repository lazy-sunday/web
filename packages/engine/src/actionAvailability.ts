import type { ActionName } from './cards.js';
import type { PlayerId, RoundState } from './types.js';

export type ActionUnavailableReason =
  | 'needsTwoOtherPlayers'
  | 'callerLockLeavesTooFewTargets'
  | 'notEnoughTargetCards';

/**
 * Returns why an action cannot currently be performed, or null when it can.
 *
 * Section 9.4 requires Switcheroo and "Not My Job" to target two players
 * other than the actor. Section 7 also locks the caller's list during final
 * turns, so that player cannot count as an eligible target.
 */
export function actionUnavailableReason(
  state: RoundState,
  actorId: PlayerId,
  action: ActionName,
): ActionUnavailableReason | null {
  if (action !== 'Switcheroo' && action !== 'Not My Job') return null;

  const otherPlayers = state.players.filter((player) => player.id !== actorId);
  if (otherPlayers.length < 2) return 'needsTwoOtherPlayers';

  const availablePlayers = otherPlayers.filter((player) => player.id !== state.caller);
  if (availablePlayers.length < 2) return 'callerLockLeavesTooFewTargets';

  if (action === 'Switcheroo') {
    return availablePlayers.filter((player) => player.list.length > 0).length >= 2
      ? null
      : 'notEnoughTargetCards';
  }

  return availablePlayers.some((player) => player.list.length > 0)
    ? null
    : 'notEnoughTargetCards';
}

export function actionUnavailableError(
  action: ActionName,
  reason: ActionUnavailableReason,
): string {
  switch (reason) {
    case 'needsTwoOtherPlayers':
      return `${action} needs two other players`;
    case 'callerLockLeavesTooFewTargets':
      return `${action} has fewer than two available players because the caller's list is locked`;
    case 'notEnoughTargetCards':
      return `${action} does not have enough eligible cards to target`;
  }
}
