import type { ActionName, Card } from './cards.js';

export type PlayerId = string;

// ---------------------------------------------------------------------------
// Round state
// ---------------------------------------------------------------------------

export type Phase =
  /** Each player secretly peeks at any 2 of their own cards — once (Rules §3.3). */
  | 'setupPeek'
  /** Current player must draw, take from DONE, or call "NOT ME!" (Rules §4). */
  | 'turn'
  /** Current player is privately looking at the drawn card: keep or discard (§4A). */
  | 'drawn'
  /** An action card's effect is being resolved; slaps are locked (§6). */
  | 'action'
  /** Lists are face-up, totals counted, round scored (§7). */
  | 'reveal';

export interface PlayerRoundState {
  id: PlayerId;
  /** The face-down chore list, in slot order. Identities never leave the server. */
  list: Card[];
  /** Set by "I'm Busy" (§5): "their next turn is skipped". Saturating, not stacking:
   *  a second "I'm Busy" before that turn re-skips the same, already-skipped next turn. */
  skipNextTurn: boolean;
  setupPeeked: boolean;
}

export interface PendingAction {
  actor: PlayerId;
  /** The action card that was drawn-and-discarded to trigger this. */
  card: Card;
  /** 'input' = waiting for target choice; 'knockItOutDecision' = peeked, may discard (§5). */
  step: 'input' | 'knockItOutDecision';
  /** Knock It Out only: the slot that was peeked and may now be discarded. */
  knockSlot?: number;
}

/** After correctly slapping an OPPONENT's card, the slapper must give one own card
 *  face-down to fill the gap (§6). Everything else pauses until this resolves. */
export interface PendingGift {
  from: PlayerId;
  to: PlayerId;
  /** The gap left by the discarded card; the gift is inserted here. */
  insertIndex: number;
}

export interface RoundResult {
  caller: PlayerId;
  /** True: caller had lowest total, ties to caller (§7). */
  callerWon: boolean;
  /** Face-up effort totals at reveal. */
  totals: Record<PlayerId, number>;
  /** Round scores: caller 0 or 50; everyone else their own total (§7). */
  scores: Record<PlayerId, number>;
  /** Full face-up lists for the reveal screen. */
  lists: Record<PlayerId, Card[]>;
}

export interface RoundState {
  /** Seat order. */
  players: PlayerRoundState[];
  /** Top of deck = last element. */
  deck: Card[];
  /** DONE pile, face-up; top = last element. Only the top card is public. */
  done: Card[];
  phase: Phase;
  /** Index into `players` of the player whose turn it is (turn/drawn/action phases). */
  turn: number;
  /** Card privately held by the current player during 'drawn' phase. */
  drawnCard: Card | null;
  pendingAction: PendingAction | null;
  pendingGift: PendingGift | null;
  /** Set once someone calls "NOT ME!" (§7). Their list is then locked. */
  caller: PlayerId | null;
  /** Remaining final turns after "NOT ME!", in order (current player excluded). */
  finalTurnQueue: PlayerId[];
  result: RoundResult | null;
  /** Mulberry32 state for reshuffles and penalty draws — keeps the round replayable. */
  rngState: number;
}

// ---------------------------------------------------------------------------
// Commands (player + server-driven inputs)
// ---------------------------------------------------------------------------

export type ActionInput =
  | { action: 'Check the List'; slot: number }
  | { action: 'Knock It Out'; slot: number }
  | { action: "Let's Trade"; mySlot: number; opponentId: PlayerId; opponentSlot: number }
  | { action: 'Switcheroo'; a: PlayerId; aSlot: number; b: PlayerId; bSlot: number }
  | { action: 'Snoop'; targetId: PlayerId; slot: number }
  | { action: 'Not My Job'; fromId: PlayerId; fromSlot: number; toId: PlayerId }
  | { action: "Landlord's Notice"; targetId: PlayerId }
  | { action: "I'm Busy"; targetId: PlayerId };

export type Command =
  | { type: 'setupPeek'; player: PlayerId; slots: [number, number] }
  | { type: 'draw'; player: PlayerId }
  | { type: 'keepDrawn'; player: PlayerId; slot: number }
  | { type: 'discardDrawn'; player: PlayerId; withAction: boolean }
  | { type: 'actionInput'; player: PlayerId; input: ActionInput }
  | { type: 'knockItOutDecision'; player: PlayerId; discard: boolean }
  /** Skip performing the pending action (performing is always optional, §5). */
  | { type: 'cancelAction'; player: PlayerId }
  | { type: 'takeFromDone'; player: PlayerId; slot: number }
  | { type: 'callNotMe'; player: PlayerId }
  /** "Done it!" quick discard (§6). `expectedTopId` is the DONE-top the client saw;
   *  a mismatch means someone beat them to it → returned without penalty (§9.6). */
  | { type: 'slap'; player: PlayerId; owner: PlayerId; slot: number; expectedTopId?: string }
  | { type: 'giveCard'; player: PlayerId; slot: number }
  /** Server-driven timeout: resolves whatever `player` is blocking on and moves on. */
  | { type: 'forceSkipTurn'; player: PlayerId };

// ---------------------------------------------------------------------------
// Events — the server broadcasts public events and routes `to`-tagged events
// to that player's socket ONLY.
// ---------------------------------------------------------------------------

export interface PeekReveal {
  owner: PlayerId;
  slot: number;
  card: Card;
}

export type EngineEvent =
  // -- private (have `to`) --
  | { type: 'peek'; to: PlayerId; reveals: PeekReveal[] }
  | { type: 'drawnCard'; to: PlayerId; card: Card }
  // -- public --
  | { type: 'setupPeeked'; player: PlayerId }
  | { type: 'turnStarted'; player: PlayerId; finalTurn: boolean }
  | { type: 'drew'; player: PlayerId }
  /** Kept the drawn card at `slot`; the replaced card is face-up on DONE.
   *  `discarded` is null when an empty-list player keeps (§9.2: "draw-and-keep
   *  only adds a card back" — there is nothing to replace). */
  | { type: 'kept'; player: PlayerId; slot: number; discarded: Card | null }
  | { type: 'discarded'; player: PlayerId; card: Card; withAction: boolean }
  /** Took DONE top (identity was public) into `slot`; replaced card now on DONE. */
  | { type: 'tookFromDone'; player: PlayerId; slot: number; taken: Card; discarded: Card }
  | { type: 'actionStarted'; player: PlayerId; action: ActionName }
  | { type: 'actionCancelled'; player: PlayerId; action: ActionName }
  // action outcomes — positions are public, face-down identities are not
  | { type: 'checkedTheList'; player: PlayerId; slot: number }
  | { type: 'knockItOutPeeked'; player: PlayerId; slot: number }
  | { type: 'knockedOut'; player: PlayerId; card: Card }
  | { type: 'knockItOutKept'; player: PlayerId }
  | { type: 'traded'; player: PlayerId; mySlot: number; opponentId: PlayerId; opponentSlot: number }
  | { type: 'switcherood'; player: PlayerId; a: PlayerId; aSlot: number; b: PlayerId; bSlot: number }
  | { type: 'snooped'; player: PlayerId; targetId: PlayerId; slot: number }
  | { type: 'notMyJobbed'; player: PlayerId; fromId: PlayerId; fromSlot: number; toId: PlayerId; toSlot: number }
  | { type: 'landlordsNoticed'; player: PlayerId; targetId: PlayerId; slot: number }
  | { type: 'imBusied'; player: PlayerId; targetId: PlayerId }
  | { type: 'turnSkipped'; player: PlayerId; wasFinalTurn: boolean }
  // slaps — correct/wrong slaps expose the card face-up on the table, so identity is public
  | { type: 'slapCorrect'; player: PlayerId; owner: PlayerId; slot: number; card: Card; giftPending: boolean }
  | { type: 'slapWrong'; player: PlayerId; owner: PlayerId; slot: number; card: Card; penaltyDrawn: boolean }
  | { type: 'slapTooLate'; player: PlayerId }
  | { type: 'giftGiven'; from: PlayerId; to: PlayerId; toSlot: number }
  | { type: 'notMeCalled'; caller: PlayerId }
  | { type: 'deckReshuffled'; deckSize: number }
  | { type: 'roundRevealed'; result: RoundResult };

// ---------------------------------------------------------------------------
// Command results
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'notYourTurn'
  | 'wrongPhase'
  | 'alreadyPeeked'
  | 'invalidSlot'
  | 'invalidTarget'
  | 'notAnAction'
  | 'wrongAction'
  | 'deckEmpty'
  | 'emptyList'
  | 'cannotGift'
  | 'callerLocked'
  | 'slapLocked'
  | 'giftPending'
  | 'alreadyCalled'
  | 'unknownPlayer'
  | 'notPerformable';

export type CommandResult =
  | { ok: true; state: RoundState; events: EngineEvent[] }
  | { ok: false; code: ErrorCode; message: string };

// ---------------------------------------------------------------------------
// Session (cumulative scoring across rounds, §7–8)
// ---------------------------------------------------------------------------

export interface SessionOptions {
  /** §8: play until a cumulative score reaches 100+; lowest total wins the match. */
  matchTo100: boolean;
  /** §8: land on EXACTLY 100 → reset to 50. */
  greatEscape: boolean;
}

export interface SessionState {
  players: PlayerId[];
  options: SessionOptions;
  scores: Record<PlayerId, number>;
  roundsPlayed: number;
  matchOver: boolean;
  /** Lowest cumulative at match end (may tie). */
  winners: PlayerId[];
}

export type SessionEvent =
  | { type: 'greatEscape'; player: PlayerId }
  | { type: 'matchOver'; winners: PlayerId[]; scores: Record<PlayerId, number> };
