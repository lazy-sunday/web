// Action metadata for the guided M4 action modals. Pure data + small helpers —
// no engine logic lives here, this only drives which picks the UI asks for in
// which order. The engine (packages/engine/src/round.ts) is the real authority;
// §9.4 targeting rules are mirrored here ONLY so illegal taps can be disabled
// client-side as a UX nicety.

import type { ActionName, ActionUnavailableReason, PlayerId } from '@lazy-sunday/engine';

export function unavailableActionMessage(reason: ActionUnavailableReason): string {
  switch (reason) {
    case 'needsTwoOtherPlayers':
      return 'Bring more friends for more fun. This action needs at least 3 players.';
    case 'callerLockLeavesTooFewTargets':
      return '"NOT ME!" locked a list, so there are not two available players for this action.';
    case 'notEnoughTargetCards':
      return 'There are not enough cards among the available players for this action.';
  }
}

/** One step in a guided action flow. Each step asks the player to tap either
 *  a player (opponent row / avatar) or a slot (their own row or an opponent's
 *  row, depending on `owner`). */
export type ActionStep =
  | { kind: 'pickPlayer'; key: string; prompt: string; owner: 'anyone' | 'othersOnly' }
  | { kind: 'pickSlot'; key: string; prompt: string; owner: 'self' | 'lastPickedPlayer' };

export interface ActionFlow {
  action: ActionName;
  title: string;
  /** Short reminder of the rule text, shown at the top of the modal. */
  ruleText: string;
  steps: ActionStep[];
}

export const ACTION_FLOWS: Record<ActionName, ActionFlow> = {
  'Check the List': {
    action: 'Check the List',
    title: 'Check the List',
    ruleText: 'Peek at ONE of your own cards.',
    steps: [{ kind: 'pickSlot', key: 'slot', prompt: 'Tap one of your own cards to peek at it.', owner: 'self' }],
  },
  'Knock It Out': {
    action: 'Knock It Out',
    title: 'Knock It Out',
    ruleText: 'Peek at ONE of your own cards; you may immediately discard it (any value).',
    steps: [{ kind: 'pickSlot', key: 'slot', prompt: 'Tap one of your own cards to peek at it.', owner: 'self' }],
  },
  "Let's Trade": {
    action: "Let's Trade",
    title: '"Let\'s Trade"',
    ruleText: 'Blind-swap any ONE of your cards with any ONE opponent card. No peeking.',
    steps: [
      { kind: 'pickSlot', key: 'mySlot', prompt: 'Tap one of your own cards to offer.', owner: 'self' },
      { kind: 'pickPlayer', key: 'opponentId', prompt: 'Tap an opponent to trade with.', owner: 'othersOnly' },
      { kind: 'pickSlot', key: 'opponentSlot', prompt: "Tap one of their cards to take, blind.", owner: 'lastPickedPlayer' },
    ],
  },
  Switcheroo: {
    action: 'Switcheroo',
    title: 'Switcheroo',
    ruleText: 'Blind-swap any TWO cards between TWO OTHER players. You are never involved.',
    steps: [
      { kind: 'pickPlayer', key: 'a', prompt: 'Tap the first player.', owner: 'othersOnly' },
      { kind: 'pickSlot', key: 'aSlot', prompt: 'Tap one of their cards.', owner: 'lastPickedPlayer' },
      { kind: 'pickPlayer', key: 'b', prompt: 'Tap the second player (not the first).', owner: 'othersOnly' },
      { kind: 'pickSlot', key: 'bSlot', prompt: 'Tap one of their cards.', owner: 'lastPickedPlayer' },
    ],
  },
  Snoop: {
    action: 'Snoop',
    title: 'Snoop',
    ruleText: 'Peek at any ONE opponent card.',
    steps: [
      { kind: 'pickPlayer', key: 'targetId', prompt: 'Tap an opponent to snoop on.', owner: 'othersOnly' },
      { kind: 'pickSlot', key: 'slot', prompt: 'Tap one of their cards to peek at it.', owner: 'lastPickedPlayer' },
    ],
  },
  'Not My Job': {
    action: 'Not My Job',
    title: '"Not My Job"',
    ruleText: "Move ONE card, unseen, from one opponent's list to another opponent's list. Never involves you.",
    steps: [
      { kind: 'pickPlayer', key: 'fromId', prompt: 'Tap the opponent to take a card FROM.', owner: 'othersOnly' },
      { kind: 'pickSlot', key: 'fromSlot', prompt: 'Tap one of their cards to move, unseen.', owner: 'lastPickedPlayer' },
      { kind: 'pickPlayer', key: 'toId', prompt: 'Tap the opponent to give the card TO (not the same player).', owner: 'othersOnly' },
    ],
  },
  "Landlord's Notice": {
    action: "Landlord's Notice",
    title: "Landlord's Notice",
    ruleText: "Take the top deck card and slide it face-down onto any ONE opponent's list.",
    steps: [{ kind: 'pickPlayer', key: 'targetId', prompt: "Tap an opponent's list to serve the notice on.", owner: 'othersOnly' }],
  },
  "I'm Busy": {
    action: "I'm Busy",
    title: '"I\'m Busy"',
    ruleText: "Choose a player: their next turn is skipped.",
    steps: [{ kind: 'pickPlayer', key: 'targetId', prompt: 'Tap a player to skip their next turn.', owner: 'anyone' }],
  },
};

/** Picks collected so far, keyed by step `key`. Values are either a PlayerId
 *  (pickPlayer step) or a slot number (pickSlot step). */
export type ActionPicks = Record<string, PlayerId | number>;

/** Builds the final ActionInput from completed picks. Assumes picks are complete
 *  and valid for `action` — the caller only invokes this on the last step. */
export function buildActionInput(action: ActionName, picks: ActionPicks) {
  switch (action) {
    case 'Check the List':
      return { action, slot: picks['slot'] as number };
    case 'Knock It Out':
      return { action, slot: picks['slot'] as number };
    case "Let's Trade":
      return {
        action,
        mySlot: picks['mySlot'] as number,
        opponentId: picks['opponentId'] as PlayerId,
        opponentSlot: picks['opponentSlot'] as number,
      };
    case 'Switcheroo':
      return {
        action,
        a: picks['a'] as PlayerId,
        aSlot: picks['aSlot'] as number,
        b: picks['b'] as PlayerId,
        bSlot: picks['bSlot'] as number,
      };
    case 'Snoop':
      return { action, targetId: picks['targetId'] as PlayerId, slot: picks['slot'] as number };
    case 'Not My Job':
      return {
        action,
        fromId: picks['fromId'] as PlayerId,
        fromSlot: picks['fromSlot'] as number,
        toId: picks['toId'] as PlayerId,
      };
    case "Landlord's Notice":
      return { action, targetId: picks['targetId'] as PlayerId };
    case "I'm Busy":
      return { action, targetId: picks['targetId'] as PlayerId };
  }
}

/** §9.4: which player ids are illegal for a pickPlayer step, given picks so far. */
export function illegalPlayerIds(
  flow: ActionFlow,
  step: Extract<ActionStep, { kind: 'pickPlayer' }>,
  myId: PlayerId,
  picks: ActionPicks,
): Set<PlayerId> {
  const illegal = new Set<PlayerId>();
  if (step.owner === 'othersOnly') illegal.add(myId);
  // Switcheroo's second pick and Not My Job's "to" pick must differ from the first.
  if (flow.action === 'Switcheroo' && step.key === 'b' && typeof picks['a'] === 'string') {
    illegal.add(picks['a'] as PlayerId);
  }
  if (flow.action === 'Not My Job' && step.key === 'toId' && typeof picks['fromId'] === 'string') {
    illegal.add(picks['fromId'] as PlayerId);
  }
  return illegal;
}

/** Which player's slots a pickSlot step targets: 'self' -> myId, otherwise the
 *  player id captured by the nearest PRECEDING pickPlayer step in this flow. */
export function slotOwnerFor(
  flow: ActionFlow,
  stepIndex: number,
  myId: PlayerId,
  picks: ActionPicks,
): PlayerId {
  const step = flow.steps[stepIndex];
  if (!step || step.kind !== 'pickSlot') throw new Error('slotOwnerFor called on a non-pickSlot step');
  if (step.owner === 'self') return myId;
  for (let i = stepIndex - 1; i >= 0; i--) {
    const prior = flow.steps[i]!;
    if (prior.kind === 'pickPlayer') return picks[prior.key] as PlayerId;
  }
  throw new Error(`no preceding pickPlayer step for ${flow.action}.${step.key}`);
}
