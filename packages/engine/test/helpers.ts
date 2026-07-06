import { expect } from 'vitest';
import { buildDeck, type Card, type CardName } from '../src/cards.js';
import type {
  Command,
  CommandResult,
  EngineEvent,
  PlayerId,
  RoundState,
} from '../src/types.js';
import { applyCommand } from '../src/round.js';

/** Draws physical cards by name from one shared 54-card pool, so every card in a
 *  handcrafted state is a distinct physical card (unique id), like a real deal. */
export class Pool {
  private cards: Card[] = buildDeck();

  take(name: CardName): Card {
    const i = this.cards.findIndex((c) => c.name === name);
    if (i === -1) throw new Error(`pool exhausted for ${name}`);
    return this.cards.splice(i, 1)[0]!;
  }

  takeAll(names: CardName[]): Card[] {
    return names.map((n) => this.take(n));
  }

  /** Whatever's left, for filling the deck. */
  rest(): Card[] {
    const r = this.cards;
    this.cards = [];
    return r;
  }
}

export interface MakeRoundOpts {
  /** Seat order. Lists are card names; slot 0 first. */
  players: { id: PlayerId; list: CardName[]; skip?: boolean }[];
  /** Deck given TOP-FIRST (index 0 = next card drawn). Default: empty. */
  deck?: CardName[];
  /** DONE pile given TOP-FIRST (index 0 = slap target). Default: one Feed the Cat. */
  done?: CardName[];
  turn?: number;
  caller?: PlayerId;
  finalTurnQueue?: PlayerId[];
  phase?: RoundState['phase'];
  instantNotMe?: boolean;
}

export function makeRound(opts: MakeRoundOpts, pool = new Pool()): RoundState {
  const players = opts.players.map((p) => ({
    id: p.id,
    list: pool.takeAll(p.list),
    skipNextTurn: p.skip ?? false,
    setupPeeked: true,
  }));
  const done = pool.takeAll(opts.done ?? ['Feed the Cat']).reverse(); // engine: top = last
  const deck = pool.takeAll(opts.deck ?? []).reverse();
  return {
    players,
    deck,
    done,
    phase: opts.phase ?? 'turn',
    turn: opts.turn ?? 0,
    drawnCard: null,
    pendingAction: null,
    pendingGift: null,
    caller: opts.caller ?? null,
    finalTurnQueue: opts.finalTurnQueue ?? [],
    result: null,
    rngState: 12345,
    instantNotMe: opts.instantNotMe ?? false,
  };
}

export function ok(result: CommandResult): { state: RoundState; events: EngineEvent[] } {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${result.message}`);
  return result;
}

export function err(result: CommandResult): { code: string; message: string } {
  if (result.ok) throw new Error('expected an error, command succeeded');
  return result;
}

/** Applies a sequence of commands, asserting each succeeds. Returns final state
 *  and ALL events in order. */
export function play(
  state: RoundState,
  ...commands: Command[]
): { state: RoundState; events: EngineEvent[] } {
  let s = state;
  const events: EngineEvent[] = [];
  for (const cmd of commands) {
    const r = applyCommand(s, cmd);
    if (!r.ok) throw new Error(`command ${JSON.stringify(cmd)} failed: ${r.code} — ${r.message}`);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

export function names(cards: Card[]): CardName[] {
  return cards.map((c) => c.name);
}

export function doneTop(state: RoundState): Card {
  const top = state.done[state.done.length - 1];
  expect(top).toBeDefined();
  return top!;
}

export function player(state: RoundState, id: PlayerId) {
  const p = state.players.find((pl) => pl.id === id);
  if (!p) throw new Error(`no player ${id}`);
  return p;
}

export function evts<T extends EngineEvent['type']>(events: EngineEvent[], type: T) {
  return events.filter((e) => e.type === type) as Extract<EngineEvent, { type: T }>[];
}

export function evt<T extends EngineEvent['type']>(events: EngineEvent[], type: T) {
  const found = evts(events, type);
  expect(found.length, `expected exactly one ${type} event`).toBe(1);
  return found[0]!;
}

/** A "draw then discard the drawn action card with its action" opener. */
export function drawAndPlayAction(state: RoundState, playerId: PlayerId) {
  return play(
    state,
    { type: 'draw', player: playerId },
    { type: 'discardDrawn', player: playerId, withAction: true },
  );
}
