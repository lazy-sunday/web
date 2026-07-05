// Cumulative scoring across rounds (§7) with the §8 optional rules.

import type { PlayerId, SessionEvent, SessionOptions, SessionState } from './types.js';

export function createSession(players: PlayerId[], options: SessionOptions): SessionState {
  const scores: Record<PlayerId, number> = {};
  for (const p of players) scores[p] = 0;
  return { players: players.slice(), options, scores, roundsPlayed: 0, matchOver: false, winners: [] };
}

export function applyRoundScores(
  prev: SessionState,
  roundScores: Record<PlayerId, number>,
): { session: SessionState; events: SessionEvent[] } {
  if (prev.matchOver) throw new Error('the match is over');
  const session = structuredClone(prev);
  const events: SessionEvent[] = [];

  for (const p of session.players) {
    session.scores[p] = (session.scores[p] ?? 0) + (roundScores[p] ?? 0);
  }

  // §8 The Great Escape: land on EXACTLY 100 and your score resets to 50.
  // Applied before the Match-to-100 check — exactly 100 is the escape, not the end.
  if (session.options.greatEscape) {
    for (const p of session.players) {
      if (session.scores[p] === 100) {
        session.scores[p] = 50;
        events.push({ type: 'greatEscape', player: p });
      }
    }
  }

  // §8 Match to 100: rounds until any cumulative score crosses 100; at that moment
  // the player with the LOWEST total wins the match.
  if (session.options.matchTo100) {
    const crossed = session.players.some((p) => session.scores[p]! >= 100);
    if (crossed) {
      const lowest = Math.min(...session.players.map((p) => session.scores[p]!));
      session.matchOver = true;
      session.winners = session.players.filter((p) => session.scores[p] === lowest);
      events.push({ type: 'matchOver', winners: session.winners.slice(), scores: { ...session.scores } });
    }
  }

  session.roundsPlayed += 1;
  return { session, events };
}

/** Session standings, lowest cumulative first (§7: lowest across rounds wins). */
export function standings(session: SessionState): { player: PlayerId; score: number }[] {
  return session.players
    .map((player) => ({ player, score: session.scores[player]! }))
    .sort((a, b) => a.score - b.score);
}
