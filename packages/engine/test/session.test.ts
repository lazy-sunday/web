import { describe, expect, it } from 'vitest';
import { applyRoundScores, createSession, standings } from '../src/session.js';

const noOpts = { matchTo100: false, greatEscape: false };

describe('cumulative scoring across rounds (§7)', () => {
  it('adds round scores per player', () => {
    let s = createSession(['a', 'b', 'c'], noOpts);
    s = applyRoundScores(s, { a: 0, b: 12, c: 30 }).session;
    s = applyRoundScores(s, { a: 50, b: 4, c: 6 }).session;
    expect(s.scores).toEqual({ a: 50, b: 16, c: 36 });
    expect(s.roundsPlayed).toBe(2);
    expect(s.matchOver).toBe(false);
    expect(standings(s).map((x) => x.player)).toEqual(['b', 'c', 'a']);
  });
});

describe('Match to 100 (§8)', () => {
  it('ends the match the moment any cumulative score reaches 100; lowest total wins', () => {
    let s = createSession(['a', 'b'], { matchTo100: true, greatEscape: false });
    s = applyRoundScores(s, { a: 50, b: 10 }).session;
    expect(s.matchOver).toBe(false);
    const r = applyRoundScores(s, { a: 51, b: 20 });
    expect(r.session.matchOver).toBe(true);
    expect(r.session.winners).toEqual(['b']);
    expect(r.events).toContainEqual({
      type: 'matchOver', winners: ['b'], scores: { a: 101, b: 30 },
    });
  });

  it('landing exactly on 100 (without Great Escape) ends the match', () => {
    let s = createSession(['a', 'b'], { matchTo100: true, greatEscape: false });
    const r = applyRoundScores(s, { a: 100, b: 0 });
    expect(r.session.matchOver).toBe(true);
    expect(r.session.winners).toEqual(['b']);
  });

  it('ties for lowest share the win', () => {
    let s = createSession(['a', 'b', 'c'], { matchTo100: true, greatEscape: false });
    const r = applyRoundScores(s, { a: 105, b: 30, c: 30 });
    expect(r.session.winners).toEqual(['b', 'c']);
  });

  it('without the toggle, nothing ends at 100+', () => {
    let s = createSession(['a', 'b'], noOpts);
    s = applyRoundScores(s, { a: 150, b: 0 }).session;
    expect(s.matchOver).toBe(false);
  });
});

describe('The Great Escape (§8)', () => {
  it('landing on EXACTLY 100 resets that score to 50', () => {
    let s = createSession(['a', 'b'], { matchTo100: false, greatEscape: true });
    s = applyRoundScores(s, { a: 60, b: 10 }).session;
    const r = applyRoundScores(s, { a: 40, b: 10 }); // a lands exactly on 100
    expect(r.session.scores).toEqual({ a: 50, b: 20 });
    expect(r.events).toContainEqual({ type: 'greatEscape', player: 'a' });
  });

  it('101 is NOT an escape', () => {
    let s = createSession(['a'], { matchTo100: false, greatEscape: true });
    const r = applyRoundScores(s, { a: 101 });
    expect(r.session.scores).toEqual({ a: 101 });
    expect(r.events).toHaveLength(0);
  });

  it('is off by default when the toggle is off', () => {
    let s = createSession(['a'], noOpts);
    expect(applyRoundScores(s, { a: 100 }).session.scores).toEqual({ a: 100 });
  });

  it('with Match to 100: the escape saves the player from ending the match at exactly 100', () => {
    let s = createSession(['a', 'b'], { matchTo100: true, greatEscape: true });
    const r = applyRoundScores(s, { a: 100, b: 40 });
    expect(r.session.scores).toEqual({ a: 50, b: 40 });
    expect(r.session.matchOver).toBe(false);
    // but crossing past 100 still ends it, and an escaped player can even win
    const r2 = applyRoundScores(r.session, { a: 0, b: 62 });
    expect(r2.session.matchOver).toBe(true);
    expect(r2.session.winners).toEqual(['a']);
  });
});
