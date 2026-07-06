'use client';

// Reveal phase (§7): face-up lists from view.result, totals + round scores
// table, caller highlighted, "Deal round N+1" for the host.

import type { CardName, PlayerId } from '@lazy-sunday/engine';
import type { useGameSocket } from '../lib/useGameSocket';
import { CardFace } from './Card';

type Game = ReturnType<typeof useGameSocket>;

export function RevealScreen({
  game,
  nameOf,
  colorOf,
}: {
  game: Game;
  nameOf: (id: PlayerId | null) => string;
  colorOf: (id: PlayerId) => string;
}) {
  const { view, lobby, me, roundNumber } = game;
  if (!view?.result || !lobby || !me) return null;
  const { result } = view;

  const iAmHost = lobby.players.find((p) => p.id === me.playerId)?.isHost ?? false;
  const betweenRounds = lobby.status === 'between-rounds';

  const order = Object.keys(result.totals).sort((a, b) => result.totals[a]! - result.totals[b]!);

  return (
    <div className="reveal-screen">
      <div className="phase-banner">
        <strong>Round {roundNumber} — reveal</strong>
        <span>Lists are face-up. Totals counted.</span>
      </div>

      <div className="reveal-lists">
        {order.map((pid) => (
          <div key={pid} className="reveal-list-row" data-caller={pid === result.caller}>
            <div className="reveal-list-meta">
              <span className="avatar-dot" style={{ background: colorOf(pid) }} aria-hidden />
              <span className="reveal-name">
                {nameOf(pid)}
                {pid === me.playerId ? ' (you)' : ''}
              </span>
              {pid === result.caller && <span className="caller-badge">NOT ME!</span>}
              <span className="reveal-total">{result.totals[pid]} effort</span>
            </div>
            <div className="reveal-cards" role="group" aria-label={`${nameOf(pid)}'s revealed chore list`}>
              {result.lists[pid]!.map((card, i) => (
                <CardFace key={i} name={card.name as CardName} className="card-img-sm" alt={`${nameOf(pid)}: ${card.name}, effort ${card.effort}`} />
              ))}
              {result.lists[pid]!.length === 0 && <span className="empty-seats">empty list</span>}
            </div>
          </div>
        ))}
      </div>

      <table className="reveal-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Total</th>
            <th>Round score</th>
          </tr>
        </thead>
        <tbody>
          {order.map((pid) => (
            <tr key={pid} data-caller={pid === result.caller}>
              <td>
                {nameOf(pid)}
                {pid === result.caller ? ' (caller)' : ''}
              </td>
              <td>{result.totals[pid]}</td>
              <td>
                <strong>{result.scores[pid]}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="reveal-outcome">
        {result.callerWon
          ? `${nameOf(result.caller)} had the lowest total — scores 0!`
          : `Someone beat ${nameOf(result.caller)} to the lowest total — the caller scores 50.`}
      </p>

      {lobby.standings.length > 0 && (
        <>
          <h3>Standings after round {roundNumber}</h3>
          <ol className="standings">
            {lobby.standings.map((s) => (
              <li key={s.player}>
                <span>{nameOf(s.player)}</span>
                <strong>{s.score}</strong>
              </li>
            ))}
          </ol>
        </>
      )}

      {lobby.matchOver ? (
        <p className="match-over-line">
          Match over — {lobby.winners.map((w) => nameOf(w)).join(' & ')} take{lobby.winners.length === 1 ? 's' : ''} the
          couch.
        </p>
      ) : betweenRounds && iAmHost ? (
        <button type="button" className="btn btn-primary btn-block" onClick={() => game.send({ type: 'nextRound' })}>
          Deal round {roundNumber + 1}
        </button>
      ) : betweenRounds ? (
        <p className="empty-seats">Waiting for the host to deal the next round…</p>
      ) : null}
    </div>
  );
}
