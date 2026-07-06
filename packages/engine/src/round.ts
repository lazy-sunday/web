// The round reducer. Pure: applyCommand(state, cmd) returns a new state + events,
// or an error, and never mutates its input. lazy-sunday-rules-v1.md is the spec;
// section references (§) below quote it.

import { buildDeck, type Card } from './cards.js';
import { shuffle } from './rng.js';
import type {
  ActionInput,
  Command,
  CommandResult,
  EngineEvent,
  ErrorCode,
  PlayerId,
  RoundResult,
  RoundState,
} from './types.js';

export interface RoundConfig {
  players: PlayerId[];
  /** Seat index of the player who takes the first turn. */
  startingPlayer: number;
  seed: number;
  /** House-rule opt-in (default false): when true, "NOT ME!" reveals the round
   *  IMMEDIATELY with no final turns. The official rules (§7 — every other
   *  player takes exactly one final turn) are the default and are unchanged. */
  instantNotMe?: boolean;
}

const CARDS_PER_PLAYER = 6; // §3.1

export function createRound(config: RoundConfig): RoundState {
  const n = config.players.length;
  if (n < 2 || n > 7) throw new Error(`LAZY SUNDAY is for 2-7 players, got ${n}`);
  if (new Set(config.players).size !== n) throw new Error('duplicate player ids');
  if (config.startingPlayer < 0 || config.startingPlayer >= n) {
    throw new Error('startingPlayer out of range');
  }

  // §3.1: shuffle, deal 6 face-down to each player.
  const shuffled = shuffle(buildDeck(), config.seed);
  const deck = shuffled.items;
  const players = config.players.map((id) => ({
    id,
    list: deck.splice(0, CARDS_PER_PLAYER),
    skipNextTurn: false,
    setupPeeked: false,
  }));

  // §3.2: flip the top card face-up to start the DONE pile.
  // (Deck top = last element, so dealing took from the front and we flip from the back.)
  const first = deck.pop()!;

  return {
    players,
    deck,
    done: [first],
    phase: 'setupPeek',
    turn: config.startingPlayer,
    drawnCard: null,
    pendingAction: null,
    pendingGift: null,
    caller: null,
    finalTurnQueue: [],
    result: null,
    rngState: shuffled.state,
    instantNotMe: config.instantNotMe ?? false,
  };
}

// ---------------------------------------------------------------------------

export function applyCommand(prev: RoundState, cmd: Command): CommandResult {
  const state = structuredClone(prev);
  const events: EngineEvent[] = [];
  const fail = (code: ErrorCode, message: string): CommandResult => ({ ok: false, code, message });

  const player = state.players.find((p) => p.id === cmd.player);
  if (!player) return fail('unknownPlayer', `no such player: ${cmd.player}`);

  // A pending gift pauses everything else (§6: "you must immediately give…").
  if (state.pendingGift && cmd.type !== 'giveCard' && cmd.type !== 'forceSkipTurn') {
    if (cmd.type === 'slap') return fail('slapLocked', 'a slap is still being resolved');
    return fail('giftPending', 'waiting for the slapper to give a card');
  }

  switch (cmd.type) {
    case 'setupPeek': {
      if (state.phase !== 'setupPeek') return fail('wrongPhase', 'setup peek is over');
      if (player.setupPeeked) return fail('alreadyPeeked', 'you already peeked — once, and never again (§3.3)');
      const [a, b] = cmd.slots;
      if (a === b || !isSlot(player.list, a) || !isSlot(player.list, b)) {
        return fail('invalidSlot', 'pick two different cards from your own list');
      }
      player.setupPeeked = true;
      events.push({
        type: 'peek',
        to: player.id,
        reveals: [
          { owner: player.id, slot: a, card: player.list[a]! },
          { owner: player.id, slot: b, card: player.list[b]! },
        ],
      });
      events.push({ type: 'setupPeeked', player: player.id });
      if (state.players.every((p) => p.setupPeeked)) {
        state.phase = 'turn';
        events.push({ type: 'turnStarted', player: current(state).id, finalTurn: false });
      }
      return { ok: true, state, events };
    }

    case 'draw': {
      const err = requireTurn(state, player.id, 'turn');
      if (err) return fail(err.code, err.message);
      if (!drawFromDeck(state, events)) {
        return fail('deckEmpty', 'no cards left to draw — take from the DONE pile or call "NOT ME!"');
      }
      state.drawnCard = state.deck.pop()!;
      state.phase = 'drawn';
      events.push({ type: 'drew', player: player.id });
      events.push({ type: 'drawnCard', to: player.id, card: state.drawnCard });
      return { ok: true, state, events };
    }

    case 'keepDrawn': {
      const err = requireTurn(state, player.id, 'drawn');
      if (err) return fail(err.code, err.message);
      const drawn = state.drawnCard!;
      if (player.list.length === 0) {
        // §9.2: an empty-list player's draw-and-keep "only adds a card back" —
        // there is no replaced card to discard.
        if (cmd.slot !== 0) return fail('invalidSlot', 'your list is empty — the card goes to slot 0');
        player.list.push(drawn);
        state.drawnCard = null;
        events.push({ type: 'kept', player: player.id, slot: 0, discarded: null });
        endTurn(state, events);
        return { ok: true, state, events };
      }
      if (!isSlot(player.list, cmd.slot)) return fail('invalidSlot', 'no card in that slot');
      // §4A: place it face-down into your list, discard the replaced card face-up.
      const replaced = player.list[cmd.slot]!;
      player.list[cmd.slot] = drawn;
      state.done.push(replaced);
      state.drawnCard = null;
      // Replaced-card discards NEVER trigger actions (§4: "Actions trigger ONLY on
      // cards drawn from the deck" — i.e. the drawn card itself, discarded).
      events.push({ type: 'kept', player: player.id, slot: cmd.slot, discarded: replaced });
      endTurn(state, events);
      return { ok: true, state, events };
    }

    case 'discardDrawn': {
      const err = requireTurn(state, player.id, 'drawn');
      if (err) return fail(err.code, err.message);
      const drawn = state.drawnCard!;
      if (cmd.withAction && drawn.kind !== 'action') {
        return fail('notAnAction', `${drawn.name} is a chore — it has no action`);
      }
      state.done.push(drawn);
      state.drawnCard = null;
      events.push({ type: 'discarded', player: player.id, card: drawn, withAction: cmd.withAction });
      if (cmd.withAction) {
        // §5: an action triggers only when drawn from the deck and discarded.
        state.phase = 'action'; // slaps lock now (§6)
        state.pendingAction = { actor: player.id, card: drawn, step: 'input' };
        events.push({ type: 'actionStarted', player: player.id, action: drawn.name as never });
      } else {
        endTurn(state, events);
      }
      return { ok: true, state, events };
    }

    case 'actionInput':
      return handleActionInput(state, events, player.id, cmd.input, fail);

    case 'knockItOutDecision': {
      const pa = state.pendingAction;
      if (state.phase !== 'action' || !pa || pa.actor !== player.id) {
        return fail('wrongPhase', 'no action of yours to resolve');
      }
      if (pa.step !== 'knockItOutDecision') return fail('wrongAction', 'nothing peeked yet');
      const slot = pa.knockSlot!;
      if (cmd.discard) {
        // §5 Knock It Out: "you may immediately discard it to the DONE pile (any value)".
        // §9.5: counts as a normal discard (can set up quick-discard matches) but
        // triggers no further action.
        const [card] = player.list.splice(slot, 1);
        state.done.push(card!);
        events.push({ type: 'knockedOut', player: player.id, card: card! });
      } else {
        events.push({ type: 'knockItOutKept', player: player.id });
      }
      finishAction(state, events);
      return { ok: true, state, events };
    }

    case 'cancelAction': {
      const pa = state.pendingAction;
      if (state.phase !== 'action' || !pa || pa.actor !== player.id) {
        return fail('wrongPhase', 'no action of yours to cancel');
      }
      // §5: "Performing the action is always optional." The discard stands.
      // Knock It Out after the peek: cancelling = choosing not to discard.
      events.push({ type: 'actionCancelled', player: player.id, action: pa.card.name as never });
      finishAction(state, events);
      return { ok: true, state, events };
    }

    case 'takeFromDone': {
      const err = requireTurn(state, player.id, 'turn');
      if (err) return fail(err.code, err.message);
      if (player.list.length === 0) {
        // §4B requires swapping the replaced card out; with no cards there is no swap.
        return fail('emptyList', 'you have no card to swap — draw from the deck instead');
      }
      if (!isSlot(player.list, cmd.slot)) return fail('invalidSlot', 'no card in that slot');
      if (state.done.length === 0) return fail('wrongPhase', 'the DONE pile is empty');
      // §4B: must swap it in; taking never triggers an action.
      const taken = state.done.pop()!;
      const replaced = player.list[cmd.slot]!;
      player.list[cmd.slot] = taken;
      state.done.push(replaced);
      events.push({ type: 'tookFromDone', player: player.id, slot: cmd.slot, taken, discarded: replaced });
      endTurn(state, events);
      return { ok: true, state, events };
    }

    case 'callNotMe': {
      const err = requireTurn(state, player.id, 'turn');
      if (err) return fail(err.code, err.message);
      // §7: call at the START of your turn, instead of taking one.
      if (state.caller !== null) return fail('alreadyCalled', '"NOT ME!" was already called this round');
      state.caller = player.id;
      events.push({ type: 'notMeCalled', caller: player.id });
      if (state.instantNotMe) {
        // House-rule: no final turns — reveal now.
        reveal(state, events);
        return { ok: true, state, events };
      }
      // §7: every OTHER player then gets exactly ONE final turn, in seat order.
      const n = state.players.length;
      const queue: PlayerId[] = [];
      for (let i = 1; i < n; i++) queue.push(state.players[(state.turn + i) % n]!.id);
      state.finalTurnQueue = queue;
      state.phase = 'turn';
      advanceToNextFinalTurn(state, events);
      return { ok: true, state, events };
    }

    case 'slap':
      return handleSlap(state, events, player.id, cmd, fail);

    case 'giveCard': {
      const gift = state.pendingGift;
      if (!gift || gift.from !== player.id) return fail('wrongPhase', 'you owe no card');
      if (!isSlot(player.list, cmd.slot)) return fail('invalidSlot', 'no card in that slot');
      // §6 / §9.7: the giver chooses; passed face-down; receiver may not look.
      const [card] = player.list.splice(cmd.slot, 1);
      const receiver = state.players.find((p) => p.id === gift.to)!;
      const at = Math.min(gift.insertIndex, receiver.list.length);
      receiver.list.splice(at, 0, card!);
      state.pendingGift = null;
      events.push({ type: 'giftGiven', from: gift.from, to: gift.to, toSlot: at });
      return { ok: true, state, events };
    }

    case 'forceSkipTurn':
      return handleForceSkip(state, events, player.id, fail);
  }
}

// ---------------------------------------------------------------------------
// Actions (§5)
// ---------------------------------------------------------------------------

function handleActionInput(
  state: RoundState,
  events: EngineEvent[],
  playerId: PlayerId,
  input: ActionInput,
  fail: (code: ErrorCode, message: string) => CommandResult,
): CommandResult {
  const pa = state.pendingAction;
  if (state.phase !== 'action' || !pa || pa.actor !== playerId) {
    return fail('wrongPhase', 'no action of yours is pending');
  }
  if (pa.step !== 'input') return fail('wrongAction', 'resolve the Knock It Out peek first');
  if (input.action !== pa.card.name) {
    return fail('wrongAction', `pending action is ${pa.card.name}, not ${input.action}`);
  }
  const me = state.players.find((p) => p.id === playerId)!;
  const byId = (id: PlayerId) => state.players.find((p) => p.id === id);

  // §7 caller lock: during final turns, no "Let's Trade", Switcheroo, "Not My Job",
  // or Landlord's Notice may touch the caller's list. (Snoop and "I'm Busy" are
  // deliberately NOT in that list.)
  const callerLocked = (id: PlayerId) =>
    state.caller !== null && id === state.caller;

  switch (input.action) {
    case 'Check the List': {
      // §5: peek at ONE of your own cards.
      if (!isSlot(me.list, input.slot)) return fail('invalidSlot', 'no card in that slot');
      events.push({ type: 'peek', to: playerId, reveals: [{ owner: playerId, slot: input.slot, card: me.list[input.slot]! }] });
      events.push({ type: 'checkedTheList', player: playerId, slot: input.slot });
      finishAction(state, events);
      return { ok: true, state, events };
    }

    case 'Knock It Out': {
      // §5: peek at ONE of your own cards; you MAY then discard it (any value).
      if (!isSlot(me.list, input.slot)) return fail('invalidSlot', 'no card in that slot');
      events.push({ type: 'peek', to: playerId, reveals: [{ owner: playerId, slot: input.slot, card: me.list[input.slot]! }] });
      events.push({ type: 'knockItOutPeeked', player: playerId, slot: input.slot });
      pa.step = 'knockItOutDecision';
      pa.knockSlot = input.slot;
      return { ok: true, state, events }; // stays in 'action' until the decision
    }

    case "Let's Trade": {
      // §5: blind-swap any ONE of your cards with any ONE opponent card. No peeking.
      const opp = byId(input.opponentId);
      if (!opp || opp.id === playerId) return fail('invalidTarget', 'pick an opponent');
      if (callerLocked(opp.id)) return fail('callerLocked', "the caller's list is locked (§7)");
      if (!isSlot(me.list, input.mySlot) || !isSlot(opp.list, input.opponentSlot)) {
        return fail('invalidSlot', 'both trade slots must hold a card');
      }
      const mine = me.list[input.mySlot]!;
      me.list[input.mySlot] = opp.list[input.opponentSlot]!;
      opp.list[input.opponentSlot] = mine;
      events.push({ type: 'traded', player: playerId, mySlot: input.mySlot, opponentId: opp.id, opponentSlot: input.opponentSlot });
      finishAction(state, events);
      return { ok: true, state, events };
    }

    case 'Switcheroo': {
      // §5: blind-swap any TWO cards between TWO OTHER players. §9.4: both targets
      // must be players other than the user.
      const a = byId(input.a);
      const b = byId(input.b);
      if (!a || !b || a.id === b.id || a.id === playerId || b.id === playerId) {
        return fail('invalidTarget', 'Switcheroo targets two OTHER players (§9.4)');
      }
      if (callerLocked(a.id) || callerLocked(b.id)) return fail('callerLocked', "the caller's list is locked (§7)");
      if (!isSlot(a.list, input.aSlot) || !isSlot(b.list, input.bSlot)) {
        return fail('invalidSlot', 'both slots must hold a card');
      }
      const cardA = a.list[input.aSlot]!;
      a.list[input.aSlot] = b.list[input.bSlot]!;
      b.list[input.bSlot] = cardA;
      events.push({ type: 'switcherood', player: playerId, a: a.id, aSlot: input.aSlot, b: b.id, bSlot: input.bSlot });
      finishAction(state, events);
      return { ok: true, state, events };
    }

    case 'Snoop': {
      // §5: peek at any ONE opponent card. (Allowed on the caller: §7's lock names
      // only Trade/Switcheroo/Not My Job/Landlord's Notice and quick-discards.)
      const target = byId(input.targetId);
      if (!target || target.id === playerId) return fail('invalidTarget', 'Snoop targets an opponent');
      if (!isSlot(target.list, input.slot)) return fail('invalidSlot', 'no card in that slot');
      events.push({ type: 'peek', to: playerId, reveals: [{ owner: target.id, slot: input.slot, card: target.list[input.slot]! }] });
      events.push({ type: 'snooped', player: playerId, targetId: target.id, slot: input.slot });
      finishAction(state, events);
      return { ok: true, state, events };
    }

    case 'Not My Job': {
      // §5: move ONE card, unseen, from one opponent's list to another opponent's
      // list. §9.4: must target two players other than the user.
      const from = byId(input.fromId);
      const to = byId(input.toId);
      if (!from || !to || from.id === to.id || from.id === playerId || to.id === playerId) {
        return fail('invalidTarget', '"Not My Job" moves a card between two OTHER players (§9.4)');
      }
      if (callerLocked(from.id) || callerLocked(to.id)) return fail('callerLocked', "the caller's list is locked (§7)");
      if (!isSlot(from.list, input.fromSlot)) return fail('invalidSlot', 'no card in that slot');
      const [card] = from.list.splice(input.fromSlot, 1);
      to.list.push(card!);
      events.push({ type: 'notMyJobbed', player: playerId, fromId: from.id, fromSlot: input.fromSlot, toId: to.id, toSlot: to.list.length - 1 });
      finishAction(state, events);
      return { ok: true, state, events };
    }

    case "Landlord's Notice": {
      // §5: take the top deck card, place it face-down onto ANY player's list
      // (including your own). No one sees it. §9.4 allows self-target.
      const target = byId(input.targetId);
      if (!target) return fail('invalidTarget', 'no such player');
      if (target.id !== playerId && callerLocked(target.id)) {
        return fail('callerLocked', "the caller's list is locked (§7)");
      }
      if (!drawFromDeck(state, events)) {
        return fail('notPerformable', 'no card left to serve — cancel the action instead');
      }
      target.list.push(state.deck.pop()!);
      events.push({ type: 'landlordsNoticed', player: playerId, targetId: target.id, slot: target.list.length - 1 });
      finishAction(state, events);
      return { ok: true, state, events };
    }

    case "I'm Busy": {
      // §5: "Choose a player: their next turn is skipped." Any player is a legal
      // target — the text does not restrict it. Saturating (see PlayerRoundState).
      const target = byId(input.targetId);
      if (!target) return fail('invalidTarget', 'no such player');
      target.skipNextTurn = true;
      events.push({ type: 'imBusied', player: playerId, targetId: target.id });
      finishAction(state, events);
      return { ok: true, state, events };
    }
  }
}

// ---------------------------------------------------------------------------
// "Done it!" — quick discard (§6, §9.6, §9.7)
// ---------------------------------------------------------------------------

function handleSlap(
  state: RoundState,
  events: EngineEvent[],
  slapperId: PlayerId,
  cmd: Extract<Command, { type: 'slap' }>,
  fail: (code: ErrorCode, message: string) => CommandResult,
): CommandResult {
  // §6: you may not quick-discard during the resolution of an action.
  if (state.phase === 'action') return fail('slapLocked', 'finish the action first (§6)');
  if (state.phase !== 'turn' && state.phase !== 'drawn') {
    return fail('wrongPhase', 'the round is not in play');
  }
  const slapper = state.players.find((p) => p.id === slapperId)!;
  const owner = state.players.find((p) => p.id === cmd.owner);
  if (!owner) return fail('unknownPlayer', 'no such player');

  // §7: after "NOT ME!", no one may quick-discard the caller's cards
  // (the caller may still quick-discard their own).
  if (state.caller !== null && owner.id === state.caller && slapperId !== state.caller) {
    return fail('callerLocked', "the caller's cards can't be slapped after \"NOT ME!\" (§7)");
  }

  const top = state.done[state.done.length - 1];
  if (!top) return fail('wrongPhase', 'the DONE pile is empty');

  // §6/§9.6: fastest fingers first — the server processes slaps in arrival order.
  // If the top changed since this player slapped, they were beaten to the match:
  // "later slaps for the same match are returned without penalty."
  if (cmd.expectedTopId !== undefined && cmd.expectedTopId !== top.id) {
    events.push({ type: 'slapTooLate', player: slapperId });
    return { ok: true, state, events };
  }

  if (!isSlot(owner.list, cmd.slot)) return fail('invalidSlot', 'no card in that slot');

  const isOwn = owner.id === slapperId;
  if (!isOwn && slapper.list.length === 0) {
    // §6 requires the slapper to immediately give one of their own cards; with an
    // empty list that obligation can't be met, so the slap is not available.
    return fail('cannotGift', 'you have no card to give — you can only slap your own cards');
  }

  const card = owner.list[cmd.slot]!;
  if (card.name === top.name) {
    // Correct: the card stays discarded (face-up on DONE — identity now public).
    owner.list.splice(cmd.slot, 1);
    state.done.push(card);
    if (isOwn) {
      // §6: your own card, correct — your list shrinks by one.
      events.push({ type: 'slapCorrect', player: slapperId, owner: owner.id, slot: cmd.slot, card, giftPending: false });
    } else {
      // §6: an opponent's card, correct — you must immediately give them ONE of
      // your own cards (your choice, face-down) to fill the gap.
      state.pendingGift = { from: slapperId, to: owner.id, insertIndex: cmd.slot };
      events.push({ type: 'slapCorrect', player: slapperId, owner: owner.id, slot: cmd.slot, card, giftPending: true });
    }
  } else {
    // §6 wrong: the slapped card returns face-down to its owner's list (it hit the
    // pile face-up, so everyone saw it — the event carries its identity), and the
    // slapper draws one penalty card from the deck onto their own list, unseen
    // (a penalty draw is not one of the granted peeks).
    const penaltyAvailable = drawFromDeck(state, events);
    if (penaltyAvailable) slapper.list.push(state.deck.pop()!);
    events.push({ type: 'slapWrong', player: slapperId, owner: owner.id, slot: cmd.slot, card, penaltyDrawn: penaltyAvailable });
  }
  return { ok: true, state, events };
}

// ---------------------------------------------------------------------------
// Turn flow, final turns, reveal
// ---------------------------------------------------------------------------

function handleForceSkip(
  state: RoundState,
  events: EngineEvent[],
  playerId: PlayerId,
  fail: (code: ErrorCode, message: string) => CommandResult,
): CommandResult {
  const player = state.players.find((p) => p.id === playerId)!;

  // Timed-out gift: the obligation must still be met — give the lowest slot.
  if (state.pendingGift?.from === playerId) {
    const [card] = player.list.splice(0, 1);
    const receiver = state.players.find((p) => p.id === state.pendingGift!.to)!;
    const at = Math.min(state.pendingGift.insertIndex, receiver.list.length);
    receiver.list.splice(at, 0, card!);
    events.push({ type: 'giftGiven', from: playerId, to: receiver.id, toSlot: at });
    state.pendingGift = null;
    return { ok: true, state, events };
  }

  // While a gift is pending, only the gift-owing player may be force-skipped.
  if (state.pendingGift) return fail('giftPending', 'waiting for the slapper to give a card');

  if (state.phase === 'setupPeek') {
    if (player.setupPeeked) return fail('alreadyPeeked', 'nothing to skip');
    // Timed-out setup peek: forfeit it (the once-only peek is simply lost).
    player.setupPeeked = true;
    events.push({ type: 'setupPeeked', player: playerId });
    if (state.players.every((p) => p.setupPeeked)) {
      state.phase = 'turn';
      events.push({ type: 'turnStarted', player: current(state).id, finalTurn: false });
    }
    return { ok: true, state, events };
  }

  if (current(state).id !== playerId) return fail('notYourTurn', 'not their turn');

  if (state.phase === 'action') {
    events.push({ type: 'actionCancelled', player: playerId, action: state.pendingAction!.card.name as never });
    finishAction(state, events);
    return { ok: true, state, events };
  }
  if (state.phase === 'drawn') {
    const drawn = state.drawnCard!;
    state.done.push(drawn);
    state.drawnCard = null;
    events.push({ type: 'discarded', player: playerId, card: drawn, withAction: false });
    endTurn(state, events);
    return { ok: true, state, events };
  }
  if (state.phase === 'turn') {
    events.push({ type: 'turnSkipped', player: playerId, wasFinalTurn: state.caller !== null });
    if (state.caller !== null) {
      advanceToNextFinalTurn(state, events);
    } else {
      endTurn(state, events);
    }
    return { ok: true, state, events };
  }
  return fail('wrongPhase', 'nothing to skip');
}

function finishAction(state: RoundState, events: EngineEvent[]): void {
  state.pendingAction = null;
  state.phase = 'turn';
  endTurn(state, events);
}

function endTurn(state: RoundState, events: EngineEvent[]): void {
  if (state.caller !== null) {
    advanceToNextFinalTurn(state, events);
    return;
  }
  const n = state.players.length;
  let next = (state.turn + 1) % n;
  // §5 "I'm Busy": their next turn is skipped. Consume flags as we pass over
  // skipped players; bounded because each pass clears a flag.
  for (let guard = 0; guard <= n; guard++) {
    const p = state.players[next]!;
    if (!p.skipNextTurn) break;
    p.skipNextTurn = false;
    events.push({ type: 'turnSkipped', player: p.id, wasFinalTurn: false });
    next = (next + 1) % n;
  }
  state.turn = next;
  state.phase = 'turn';
  events.push({ type: 'turnStarted', player: state.players[next]!.id, finalTurn: false });
}

function advanceToNextFinalTurn(state: RoundState, events: EngineEvent[]): void {
  // §7: every other player gets exactly ONE final turn. §9.3: if a skipped
  // player's turn was their final turn, that turn is simply lost.
  while (state.finalTurnQueue.length > 0) {
    const nextId = state.finalTurnQueue.shift()!;
    const p = state.players.find((pl) => pl.id === nextId)!;
    if (p.skipNextTurn) {
      p.skipNextTurn = false;
      events.push({ type: 'turnSkipped', player: p.id, wasFinalTurn: true });
      continue;
    }
    state.turn = state.players.indexOf(p);
    state.phase = 'turn';
    events.push({ type: 'turnStarted', player: p.id, finalTurn: true });
    return;
  }
  reveal(state, events);
}

function reveal(state: RoundState, events: EngineEvent[]): void {
  // §7: all lists flip face-up and totals are counted.
  state.phase = 'reveal';
  const caller = state.caller!;
  const totals: Record<PlayerId, number> = {};
  const lists: Record<PlayerId, Card[]> = {};
  for (const p of state.players) {
    totals[p.id] = p.list.reduce((sum, c) => sum + c.effort, 0);
    lists[p.id] = p.list.slice();
  }
  const callerTotal = totals[caller]!;
  const otherTotals = state.players.filter((p) => p.id !== caller).map((p) => totals[p.id]!);
  // §7: caller lowest (ties go to the caller) → caller scores 0, others their own
  // totals. Anyone strictly beats the caller → caller scores 50, everyone else
  // (including the actual lowest) scores their own total.
  const callerWon = otherTotals.every((t) => t >= callerTotal);
  const scores: Record<PlayerId, number> = {};
  for (const p of state.players) {
    scores[p.id] = p.id === caller ? (callerWon ? 0 : 50) : totals[p.id]!;
  }
  const result: RoundResult = { caller, callerWon, totals, scores, lists };
  state.result = result;
  events.push({ type: 'roundRevealed', result });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function current(state: RoundState) {
  return state.players[state.turn]!;
}

function isSlot(list: Card[], slot: number): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < list.length;
}

function requireTurn(
  state: RoundState,
  playerId: PlayerId,
  phase: 'turn' | 'drawn',
): { code: ErrorCode; message: string } | null {
  if (state.phase !== phase) return { code: 'wrongPhase', message: `expected ${phase} phase` };
  if (current(state).id !== playerId) return { code: 'notYourTurn', message: 'not your turn' };
  return null;
}

/** Ensures at least one card is drawable, reshuffling per §9.1 if needed.
 *  Returns false when no card exists anywhere (deck empty, DONE has only its top). */
function drawFromDeck(state: RoundState, events: EngineEvent[]): boolean {
  if (state.deck.length > 0) return true;
  // §9.1: shuffle the DONE pile (except its top card) into a new deck.
  if (state.done.length <= 1) return false;
  const top = state.done.pop()!;
  const reshuffled = shuffle(state.done, state.rngState);
  state.deck = reshuffled.items;
  state.rngState = reshuffled.state;
  state.done = [top];
  events.push({ type: 'deckReshuffled', deckSize: state.deck.length });
  return true;
}
