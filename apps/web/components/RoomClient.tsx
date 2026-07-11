'use client';

// /r/[code] — join form -> lobby -> real card table (Milestone 3).

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AVATAR_COLORS } from '../lib/config';
import { loadIdentity, useGameSocket } from '../lib/useGameSocket';
import { GameTable } from './GameTable';

export default function RoomClient({ code }: { code: string }) {
  const game = useGameSocket(code);
  const { lobby, view, me, status, lastError } = game;

  const seated = me !== null && lobby !== null && lobby.players.some((p) => p.id === me.playerId);
  const inGame = seated && lobby !== null && lobby.status !== 'lobby' && view !== null;

  return (
    <main className="shell">
      <header className="lobby-header">
        <div>
          <Link href="/" className="back-link">
            &larr; LAZY SUNDAY
          </Link>
          <div className="room-code">Room {code}</div>
        </div>
        <span className="conn-pill" data-status={status}>
          {status === 'open' ? 'connected' : status === 'connecting' ? 'connecting…' : 'reconnecting…'}
        </span>
      </header>

      {lastError && (
        <p className="form-error" role="alert">
          {lastError.message}{' '}
          <button type="button" className="btn btn-ghost" style={{ minHeight: 32, padding: '2px 10px' }} onClick={game.clearError}>
            dismiss
          </button>
        </p>
      )}

      {!seated && <JoinForm code={code} onJoin={game.join} disabled={status !== 'open'} />}
      {seated && !inGame && <LobbyView game={game} code={code} />}
      {seated && inGame && <GameTable game={game} />}
    </main>
  );
}

// ---------------------------------------------------------------------------

function JoinForm({
  code,
  onJoin,
  disabled,
}: {
  code: string;
  onJoin: (name: string, color: string) => void;
  disabled: boolean;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(AVATAR_COLORS[0]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Prefill from a previous visit to this room (auto-rejoin handles the token).
    const stored = loadIdentity(code);
    if (stored?.name) setName(stored.name);
    if (stored?.color) setColor(stored.color);
    setHydrated(true);
  }, [code]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length > 0) onJoin(name.trim(), color);
  }

  if (!hydrated) return null;

  return (
    <form className="card join-form" onSubmit={submit}>
      <h2>Who&apos;s on the couch?</h2>
      <div>
        <label htmlFor="display-name">Display name</label>
        <input
          id="display-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={24}
          autoComplete="nickname"
          required
        />
      </div>
      <div>
        <span style={{ fontWeight: 700, fontSize: 15 }}>Avatar color</span>
        <div className="color-grid" role="group" aria-label="Avatar color">
          {AVATAR_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="color-swatch"
              style={{ background: c }}
              aria-pressed={color === c}
              aria-label={`Color ${c}`}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </div>
      <button type="submit" className="btn btn-primary btn-block" disabled={disabled || name.trim().length === 0}>
        Join room {code}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------

function LobbyView({ game, code }: { game: ReturnType<typeof useGameSocket>; code: string }) {
  const { lobby, me } = game;
  const [copied, setCopied] = useState(false);
  if (!lobby || !me) return null;

  const iAmHost = lobby.players.find((p) => p.id === me.playerId)?.isHost ?? false;
  const canStart = lobby.players.length >= 2 && lobby.players.length <= 7;
  const betweenRounds = lobby.status === 'between-rounds';

  async function copyShareLink() {
    const url = `${window.location.origin}/r/${code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy this link:', url);
    }
  }

  return (
    <div className="card">
      <h2>The flat so far</h2>
      <ul className="player-list">
        {lobby.players.map((p) => (
          <li key={p.id} className="player-row">
            <span className="avatar-dot" style={{ background: p.color }} aria-hidden />
            <span className="player-name">
              {p.name}
              {p.id === me.playerId ? ' (you)' : ''}
            </span>
            {p.isHost && <span className="host-badge">HOST</span>}
            <span
              className="conn-dot"
              data-connected={p.connected}
              role="img"
              aria-label={p.connected ? `${p.name} is connected` : `${p.name} is disconnected`}
            />
          </li>
        ))}
      </ul>
      {lobby.players.length < 7 && (
        <p className="empty-seats">
          {7 - lobby.players.length} seat{7 - lobby.players.length === 1 ? '' : 's'} still free — share the link below.
        </p>
      )}

      <h3 style={{ marginTop: 20 }}>House rules</h3>
      <div className="toggle-list">
        <div className="toggle-row">
          <span className="toggle-label">
            Decks per room
            <span className="toggle-sub">Complete decks used in every round</span>
          </span>
          <select
            className="timeout-select"
            value={lobby.toggles.deckCount}
            disabled={!iAmHost || lobby.status !== 'lobby'}
            aria-label="Decks per room"
            onChange={(e) =>
              game.send({ type: 'setToggle', toggle: 'deckCount', value: Number(e.target.value) })
            }
          >
            {[1, 2, 3].map((count) => (
              <option key={count} value={count}>
                {count} {count === 1 ? 'deck' : 'decks'}
              </option>
            ))}
          </select>
        </div>
        <ToggleRow
          label="Match to 100"
          sub="First past 100 ends the match; lowest total wins"
          checked={lobby.toggles.matchTo100}
          disabled={!iAmHost || lobby.status !== 'lobby'}
          onChange={(v) => game.send({ type: 'setToggle', toggle: 'matchTo100', value: v })}
        />
        <ToggleRow
          label="The Great Escape"
          sub="Land on exactly 100 and drop back to 50"
          checked={lobby.toggles.greatEscape}
          disabled={!iAmHost || lobby.status !== 'lobby'}
          onChange={(v) => game.send({ type: 'setToggle', toggle: 'greatEscape', value: v })}
        />
        <ToggleRow
          label="Instant NOT ME!"
          sub="House rule: end the round on the call, skipping everyone's final turn"
          checked={lobby.toggles.instantNotMe}
          disabled={!iAmHost || lobby.status !== 'lobby'}
          onChange={(v) => game.send({ type: 'setToggle', toggle: 'instantNotMe', value: v })}
        />
        <div className="toggle-row">
          <span className="toggle-label">
            Turn timeout
            <span className="toggle-sub">Idle turns auto-skip after this long</span>
          </span>
          <select
            className="timeout-select"
            value={lobby.toggles.turnTimeoutSeconds}
            disabled={!iAmHost}
            aria-label="Turn timeout in seconds"
            onChange={(e) =>
              game.send({ type: 'setToggle', toggle: 'turnTimeoutSeconds', value: Number(e.target.value) })
            }
          >
            {[30, 45, 60, 90, 120].map((s) => (
              <option key={s} value={s}>
                {s}s
              </option>
            ))}
          </select>
        </div>
      </div>

      {lobby.standings.length > 0 && (
        <>
          <h3>Standings after round {lobby.roundNumber}</h3>
          <ol className="standings">
            {lobby.standings.map((s) => (
              <li key={s.player}>
                <span>{lobby.players.find((p) => p.id === s.player)?.name ?? s.player}</span>
                <strong>{s.score}</strong>
              </li>
            ))}
          </ol>
          {lobby.matchOver && (
            <p style={{ fontWeight: 700 }}>
              Match over — {lobby.winners.map((w) => lobby.players.find((p) => p.id === w)?.name ?? w).join(' & ')} take
              {lobby.winners.length === 1 ? 's' : ''} the couch.
            </p>
          )}
        </>
      )}

      <div className="lobby-footer">
        <button type="button" className="btn btn-ghost btn-block" onClick={copyShareLink}>
          {copied ? 'Link copied' : 'Copy share link'}
        </button>
        {iAmHost && lobby.status === 'lobby' && (
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={!canStart}
            onClick={() => game.send({ type: 'startGame' })}
          >
            {canStart ? 'Start game' : 'Need 2–7 players to start'}
          </button>
        )}
        {iAmHost && betweenRounds && !lobby.matchOver && (
          <button type="button" className="btn btn-primary btn-block" onClick={() => game.send({ type: 'nextRound' })}>
            Deal round {lobby.roundNumber + 1}
          </button>
        )}
        {!iAmHost && lobby.status === 'lobby' && (
          <p className="empty-seats">Waiting for the host to start the game…</p>
        )}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  sub,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  sub: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="toggle-row">
      <span className="toggle-label">
        {label}
        <span className="toggle-sub">{sub}</span>
      </span>
      <button
        type="button"
        className="switch"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}
