'use client';

// Reveal phase (§7): face-up lists from view.result, totals + round scores
// table, caller highlighted, "Deal round N+1" for the host.
//
// M5 ceremony: opponents' face-down lists flip face-up staggered 30-50ms
// apart, per-player totals count up (useCountUp), THEN the caller's outcome
// lands with emphasis. Running totals appear ONLY here, never during play
// (enforced structurally: RoundView.result is null outside phase 'reveal').
// prefers-reduced-motion -> skip straight to the final state, no flip stagger,
// no counting. The 'reveal' sound plays once when the ceremony starts.

import { useEffect, useRef, useState } from 'react';
import type { CardName, PlayerId } from '@lazy-sunday/engine';
import type { useGameSocket } from '../lib/useGameSocket';
import type { SoundControls } from '../lib/useSound';
import { usePrefersReducedMotion } from '../lib/useReducedMotion';
import { useCountUp } from '../lib/useCountUp';
import { CardFace } from './Card';
import { HouseRuleBadges } from './HouseRuleBadges';

type Game = ReturnType<typeof useGameSocket>;

const FLIP_STAGGER_MS = 40; // within the 30-50ms band
const COUNT_MS = 900;

export function RevealScreen({
  game,
  nameOf,
  colorOf,
  sound,
}: {
  game: Game;
  nameOf: (id: PlayerId | null) => string;
  colorOf: (id: PlayerId) => string;
  sound: SoundControls;
}) {
  const { view, lobby, me, roundNumber, latestSessionEvent } = game;
  const reduced = usePrefersReducedMotion();
  const playedRef = useRef<unknown>(null);

  if (!view?.result || !lobby || !me) return null;
  const { result } = view;

  const iAmHost = lobby.players.find((p) => p.id === me.playerId)?.isHost ?? false;
  const betweenRounds = lobby.status === 'between-rounds';

  const order = Object.keys(result.totals).sort((a, b) => result.totals[a]! - result.totals[b]!);

  // Play the reveal cue exactly once per reveal (keyed by the result object
  // reference — a fresh reveal always brings a fresh result from the server).
  useEffect(() => {
    if (playedRef.current === result) return;
    playedRef.current = result;
    sound.play('reveal');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // Great Escape / match-over ceremony banners come from session events, not
  // the round result — they're orthogonal (a Great Escape can fire on a round
  // the caller lost, etc).
  const greatEscapePlayer =
    latestSessionEvent?.type === 'greatEscape' ? latestSessionEvent.player : null;

  return (
    <div className="reveal-screen">
      <div className="phase-banner">
        <strong>Round {roundNumber} — reveal</strong>
        <span>Lists are face-up. Totals counted.</span>
      </div>

      <HouseRuleBadges toggles={lobby.toggles} />

      {greatEscapePlayer && (
        <div className="great-escape-banner" role="status">
          <span className="great-escape-title">THE GREAT ESCAPE!</span>
          <span>{nameOf(greatEscapePlayer)} landed on exactly 100 &mdash; back down to 50.</span>
        </div>
      )}

      <div className="reveal-lists">
        {order.map((pid, i) => (
          <RevealListRow
            key={pid}
            pid={pid}
            index={i}
            isCaller={pid === result.caller}
            isMe={pid === me.playerId}
            name={nameOf(pid)}
            color={colorOf(pid)}
            total={result.totals[pid]!}
            cards={result.lists[pid]!}
            reduced={reduced}
          />
        ))}
      </div>

      <p className="reveal-outcome" data-emphasis={result.callerWon ? 'win' : 'lose'}>
        {result.callerWon
          ? `${nameOf(result.caller)} lounges on the couch — scores 0!`
          : `${nameOf(result.caller)} is stuck doing everything — scores 50.`}
      </p>

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

      <SessionScoreboard lobby={lobby} nameOf={nameOf} roundNumber={roundNumber} />

      {lobby.matchOver ? (
        <MatchOverBanner lobby={lobby} nameOf={nameOf} />
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

// ---------------------------------------------------------------------------
// One player's row: face-down -> face-up flip (staggered), then a count-up
// total. The caller's row gets an extra beat of emphasis once every row has
// finished, driven by CSS data-attributes rather than a second timer.

function RevealListRow({
  pid,
  index,
  isCaller,
  isMe,
  name,
  color,
  total,
  cards,
  reduced,
}: {
  pid: PlayerId;
  index: number;
  isCaller: boolean;
  isMe: boolean;
  name: string;
  color: string;
  total: number;
  cards: { name: string; effort: number }[];
  reduced: boolean;
}) {
  const [flipped, setFlipped] = useState(reduced);
  const delayMs = index * FLIP_STAGGER_MS;

  useEffect(() => {
    if (reduced) {
      setFlipped(true);
      return;
    }
    const t = setTimeout(() => setFlipped(true), 120 + delayMs);
    return () => clearTimeout(t);
  }, [reduced, delayMs]);

  // The count-up only starts once this row's cards have flipped, so the
  // ticking total lands just after the faces do.
  const countTarget = flipped ? total : 0;
  const displayed = useCountUp(countTarget, COUNT_MS, reduced || !flipped);

  return (
    <div className="reveal-list-row" data-caller={isCaller}>
      <div className="reveal-list-meta">
        <span className="avatar-dot" style={{ background: color }} aria-hidden />
        <span className="reveal-name">
          {name}
          {isMe ? ' (you)' : ''}
        </span>
        {isCaller && <span className="caller-badge">NOT ME!</span>}
        <span className="reveal-total" aria-label={`${name}: ${total} effort`}>
          {flipped ? displayed : ''} effort
        </span>
      </div>
      <div className="reveal-cards" role="group" aria-label={`${name}'s revealed chore list`}>
        {cards.map((card, i) => (
          <span
            key={i}
            className="reveal-flip-slot"
            data-flipped={flipped}
            style={reduced ? undefined : { transitionDelay: `${delayMs + i * 25}ms` }}
          >
            <CardFace name={card.name as CardName} className="card-img-sm" alt={`${name}: ${card.name}, effort ${card.effort}`} />
          </span>
        ))}
        {cards.length === 0 && <span className="empty-seats">empty list</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cumulative scoreboard (lowest wins) — highlights the current leader.

function SessionScoreboard({
  lobby,
  nameOf,
  roundNumber,
}: {
  lobby: NonNullable<Game['lobby']>;
  nameOf: (id: PlayerId | null) => string;
  roundNumber: number;
}) {
  if (lobby.standings.length === 0) return null;
  const lowest = Math.min(...lobby.standings.map((s) => s.score));

  return (
    <div className="scoreboard">
      <h3>Standings after round {roundNumber}</h3>
      <ol className="standings">
        {lobby.standings.map((s) => (
          <li key={s.player} data-leader={s.score === lowest}>
            <span>{nameOf(s.player)}</span>
            <strong>{s.score}</strong>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Match-over screen: named winner(s) + final standings (Match to 100, §8).

function MatchOverBanner({
  lobby,
  nameOf,
}: {
  lobby: NonNullable<Game['lobby']>;
  nameOf: (id: PlayerId | null) => string;
}) {
  const winners = lobby.winners;
  return (
    <div className="match-over-screen" role="status">
      <h2 className="match-over-title">Match over</h2>
      <p className="match-over-line">
        {winners.map((w) => nameOf(w)).join(' & ')} take{winners.length === 1 ? 's' : ''} the couch.
      </p>
      <ol className="standings final-standings">
        {lobby.standings.map((s) => (
          <li key={s.player} data-winner={winners.includes(s.player)}>
            <span>{nameOf(s.player)}</span>
            <strong>{s.score}</strong>
          </li>
        ))}
      </ol>
    </div>
  );
}

