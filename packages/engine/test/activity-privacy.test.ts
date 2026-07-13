import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src/round.js';
import { eventVisibleTo } from '../src/view.js';
import type { Card } from '../src/cards.js';
import type { EngineEvent } from '../src/types.js';
import { drawAndPlayAction, evt, makeRound, ok, play, player } from './helpers.js';

// Issue #30 privacy guard. The center-table announcement and the activity log
// (apps/web) re-describe events the player already receives, and MUST be able
// to name an action's public target (actor, victim, slot position) WITHOUT ever
// naming a face-down card. This suite proves the engine's action events keep
// that promise: every event broadcast to the whole table (i.e. not the private
// `peek`/`drawnCard`) is free of the face-down identity the action touched.
//
// Rules basis:
//  - §5 Check the List / Snoop / Knock It Out (keep): peeks go ONLY to the
//    peeker; "No one sees it" for the blind moves.
//  - §5 "Let's Trade" / Switcheroo / "Not My Job" / Landlord's Notice: blind —
//    positions move, identities do not become public.
//  - §9.5 Knock It Out discard: the discarded card goes FACE-UP on DONE, so
//    that one identity is legitimately public (asserted separately, allowed).

/** Every event the server broadcasts table-wide (everything except the two
 *  privately-routed types). These are exactly what the client log may render. */
function publicEvents(events: EngineEvent[]): EngineEvent[] {
  return events.filter((e) => e.type !== 'peek' && e.type !== 'drawnCard');
}

/** Assert no table-wide event exposes the given face-down card's name or id. */
function assertNoLeak(events: EngineEvent[], secrets: Card[]): void {
  for (const event of publicEvents(events)) {
    // Sanity: a public event must be visible to a bystander (id 'z' is never a
    // participant in these scenarios).
    expect(eventVisibleTo(event, 'z')).toBe(true);
    const json = JSON.stringify(event);
    for (const secret of secrets) {
      expect(json, `${event.type} leaked card name "${secret.name}"`).not.toContain(secret.name);
      expect(json, `${event.type} leaked card id "${secret.id}"`).not.toContain(secret.id);
    }
  }
}

describe('issue #30 — action events never leak a face-down identity to the table', () => {
  it('Check the List: the peeked own card is private to the actor only', () => {
    const s = makeRound({
      players: [
        { id: 'a', list: ['Nap', 'Fold the Laundry'] },
        { id: 'b', list: ['Water the Plants'] },
      ],
      deck: ['Check the List', 'Nap'],
    });
    const acting = drawAndPlayAction(s, 'a').state;
    const secret = player(acting, 'a').list[1]!; // Fold the Laundry, the peeked slot
    const r = ok(applyCommand(acting, { type: 'actionInput', player: 'a', input: { action: 'Check the List', slot: 1 } }));

    const peek = evt(r.events, 'peek');
    expect(peek.to).toBe('a'); // only the actor learns the face
    expect(eventVisibleTo(peek, 'b')).toBe(false);
    // The public checkedTheList carries the slot position but no card.
    expect(evt(r.events, 'checkedTheList')).not.toHaveProperty('card');
    assertNoLeak(r.events, [secret]);
  });

  it('Snoop: the peeked opponent card is private to the actor; position is public', () => {
    const s = makeRound({
      players: [
        { id: 'a', list: ['Nap'] },
        { id: 'b', list: ['Water the Plants', 'Vacuum the Living Room'] },
      ],
      deck: ['Snoop', 'Nap'],
    });
    const acting = drawAndPlayAction(s, 'a').state;
    const secret = player(acting, 'b').list[1]!; // Vacuum the Living Room
    const r = ok(applyCommand(acting, { type: 'actionInput', player: 'a', input: { action: 'Snoop', targetId: 'b', slot: 1 } }));

    const peek = evt(r.events, 'peek');
    expect(peek.to).toBe('a');
    expect(eventVisibleTo(peek, 'b')).toBe(false); // even the card's owner isn't told which
    const snooped = evt(r.events, 'snooped');
    expect(snooped.targetId).toBe('b');
    expect(snooped.slot).toBe(1); // public slot position
    expect(snooped).not.toHaveProperty('card');
    assertNoLeak(r.events, [secret]);
  });

  it('Knock It Out (keep): the peeked card stays private; nothing is discarded', () => {
    const s = makeRound({
      players: [
        { id: 'a', list: ['Take Out the Trash', 'Nap'] },
        { id: 'b', list: ['Water the Plants'] },
      ],
      deck: ['Knock It Out', 'Nap'],
    });
    const acting = drawAndPlayAction(s, 'a').state;
    const secret = player(acting, 'a').list[0]!; // Take Out the Trash
    const peeked = ok(applyCommand(acting, { type: 'actionInput', player: 'a', input: { action: 'Knock It Out', slot: 0 } }));
    const r = ok(applyCommand(peeked.state, { type: 'knockItOutDecision', player: 'a', discard: false }));
    const all = [...peeked.events, ...r.events];

    expect(evt(peeked.events, 'peek').to).toBe('a');
    expect(evt(all, 'knockItOutKept')).not.toHaveProperty('card');
    assertNoLeak(all, [secret]);
  });

  it('Knock It Out (discard): §9.5 the discarded card is legitimately public (face-up on DONE)', () => {
    const s = makeRound({
      players: [
        { id: 'a', list: ['Take Out the Trash', 'Nap'] },
        { id: 'b', list: ['Water the Plants'] },
      ],
      deck: ['Knock It Out', 'Nap'],
    });
    const acting = drawAndPlayAction(s, 'a').state;
    const peeked = ok(applyCommand(acting, { type: 'actionInput', player: 'a', input: { action: 'Knock It Out', slot: 0 } }));
    const r = ok(applyCommand(peeked.state, { type: 'knockItOutDecision', player: 'a', discard: true }));
    const knocked = evt(r.events, 'knockedOut');
    // Allowed: it now sits face-up on DONE, so naming it is not a leak.
    expect(knocked.card.name).toBe('Take Out the Trash');
    expect(eventVisibleTo(knocked, 'z')).toBe(true);
  });

  it("Let's Trade: a blind swap names positions and players, never the cards", () => {
    const s = makeRound({
      players: [
        { id: 'a', list: ['Fold the Laundry', 'Nap'] },
        { id: 'b', list: ['Water the Plants', 'Vacuum the Living Room'] },
      ],
      deck: ["Let's Trade", 'Nap'],
    });
    const acting = drawAndPlayAction(s, 'a').state;
    const mine = player(acting, 'a').list[0]!; // Fold the Laundry (given away, blind)
    const theirs = player(acting, 'b').list[1]!; // Vacuum the Living Room (taken, blind)
    const r = ok(applyCommand(acting, {
      type: 'actionInput', player: 'a', input: { action: "Let's Trade", mySlot: 0, opponentId: 'b', opponentSlot: 1 },
    }));
    assertNoLeak(r.events, [mine, theirs]);
  });

  it('Switcheroo: both swapped cards stay face-down for everyone, actor included', () => {
    const s = makeRound({
      players: [
        { id: 'a', list: ['Nap'] },
        { id: 'b', list: ['Fold the Laundry', 'Take Out the Trash'] },
        { id: 'c', list: ['Water the Plants', 'Vacuum the Living Room'] },
      ],
      deck: ['Switcheroo', 'Take Out the Trash'],
    });
    const acting = drawAndPlayAction(s, 'a').state;
    const bCard = player(acting, 'b').list[0]!; // Fold the Laundry
    const cCard = player(acting, 'c').list[1]!; // Vacuum the Living Room
    const r = ok(applyCommand(acting, {
      type: 'actionInput', player: 'a', input: { action: 'Switcheroo', a: 'b', aSlot: 0, b: 'c', bSlot: 1 },
    }));
    // The actor 'a' is a "bystander" to the cards here — must not learn them either.
    for (const event of publicEvents(r.events)) {
      const json = JSON.stringify(event);
      expect(json).not.toContain(bCard.id);
      expect(json).not.toContain(cCard.id);
    }
    assertNoLeak(r.events, [bCard, cCard]);
  });

  it('Not My Job: the moved card is unseen; only from/to players + slots are public', () => {
    const s = makeRound({
      players: [
        { id: 'a', list: ['Nap'] },
        { id: 'b', list: ['Vacuum the Living Room', 'Take Out the Trash'] },
        { id: 'c', list: ['Water the Plants'] },
      ],
      deck: ['Not My Job', 'Fold the Laundry'],
    });
    const acting = drawAndPlayAction(s, 'a').state;
    const moved = player(acting, 'b').list[0]!; // Vacuum the Living Room
    const r = ok(applyCommand(acting, {
      type: 'actionInput', player: 'a', input: { action: 'Not My Job', fromId: 'b', fromSlot: 0, toId: 'c' },
    }));
    const njobbed = evt(r.events, 'notMyJobbed');
    expect(njobbed.fromId).toBe('b');
    expect(njobbed.toId).toBe('c');
    expect(njobbed).not.toHaveProperty('card');
    assertNoLeak(r.events, [moved]);
  });

  it("Landlord's Notice: the placed deck card is unseen by everyone (§5)", () => {
    const s = makeRound({
      players: [
        { id: 'a', list: ['Nap'] },
        { id: 'b', list: ['Water the Plants'] },
      ],
      deck: ["Landlord's Notice", 'Vacuum the Living Room'],
    });
    const acting = drawAndPlayAction(s, 'a').state;
    const placed = acting.deck[acting.deck.length - 1]!; // Vacuum the Living Room, next deck card
    const r = ok(applyCommand(acting, {
      type: 'actionInput', player: 'a', input: { action: "Landlord's Notice", targetId: 'b' },
    }));
    expect(player(r.state, 'b').list[1]!.id).toBe(placed.id); // it really moved
    const notice = evt(r.events, 'landlordsNoticed');
    expect(notice.targetId).toBe('b');
    expect(notice).not.toHaveProperty('card');
    assertNoLeak(r.events, [placed]);
  });

  it("I'm Busy: carries only the target; no card is involved", () => {
    const s = makeRound({
      players: [
        { id: 'a', list: ['Nap'] },
        { id: 'b', list: ['Water the Plants'] },
        { id: 'c', list: ['Fold the Laundry'] },
      ],
      deck: ["I'm Busy", 'Nap'],
    });
    const acting = drawAndPlayAction(s, 'a').state;
    const r = ok(applyCommand(acting, { type: 'actionInput', player: 'a', input: { action: "I'm Busy", targetId: 'b' } }));
    const busied = evt(r.events, 'imBusied');
    expect(busied.targetId).toBe('b');
    expect(busied).not.toHaveProperty('card');
    expect(eventVisibleTo(busied, 'z')).toBe(true);
  });

  it('actionStarted announces actor + action with no card (drives the announcement)', () => {
    const s = makeRound({
      players: [
        { id: 'a', list: ['Nap'] },
        { id: 'b', list: ['Water the Plants'] },
      ],
      deck: ['Snoop', 'Nap'],
    });
    const started = play(s,
      { type: 'draw', player: 'a' },
      { type: 'discardDrawn', player: 'a', withAction: true },
    ).events;
    const ev = evt(started, 'actionStarted');
    expect(ev.player).toBe('a');
    expect(ev.action).toBe('Snoop');
    expect(ev).not.toHaveProperty('card');
    expect(eventVisibleTo(ev, 'z')).toBe(true);
  });
});
