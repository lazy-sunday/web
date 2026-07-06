'use client';

// The real card table (Milestone 3). Replaces TablePlaceholder.
//
// Layout: opponents' rows stacked above (small), my row pinned at the bottom
// (large), deck + DONE pile centered between them. Everything face-down
// renders from the card-back SVG; the only faces ever shown are the DONE
// top (always public) and whatever `usePeeks`/`myDrawnCard` grants me.

import { useEffect, useMemo, useState } from 'react';
import type { CardName, PlayerId } from '@lazy-sunday/engine';
import type { useGameSocket } from '../lib/useGameSocket';
import { usePeeks } from '../lib/usePeeks';
import { CardBack, CardFace } from './Card';
import { RevealScreen } from './RevealScreen';

type Game = ReturnType<typeof useGameSocket>;

export function GameTable({ game }: { game: Game }) {
  const { view, lobby, me, roundNumber, events } = game;
  const peeks = usePeeks(events, me?.playerId ?? null, view?.phase ?? null);

  const nameOf = useMemo(() => {
    const map = new Map(lobby?.players.map((p) => [p.id, p.name]) ?? []);
    return (id: PlayerId | null) => (id ? map.get(id) ?? id : '—');
  }, [lobby]);

  const colorOf = useMemo(() => {
    const map = new Map(lobby?.players.map((p) => [p.id, p.color]) ?? []);
    return (id: PlayerId) => map.get(id) ?? '#ccc';
  }, [lobby]);

  // Latest "X did something" line for non-current players, built from public events.
  const activityLine = useActivityLine(events, nameOf);

  const [inFlight, setInFlight] = useState(false);
  useEffect(() => {
    setInFlight(false);
  }, [view?.phase, view?.currentPlayer, view?.pendingAction, view?.myDrawnCard]);

  if (!view || !me || !lobby) return null;

  if (view.phase === 'reveal') {
    return <RevealScreen game={game} nameOf={nameOf} colorOf={colorOf} />;
  }

  const myId = me.playerId;
  const isMyTurn = view.currentPlayer === myId;
  const myPlayerView = view.players.find((p) => p.id === myId);
  const opponents = view.players.filter((p) => p.id !== myId);

  // "Pick a slot" mode is shared between the pile that started it (DONE pile)
  // and MyRow (which renders the pickable slots), so it lives up here.
  const [pickMode, setPickMode] = useState<'keep' | 'takeFromDone' | null>(null);
  useEffect(() => {
    if (!view.myDrawnCard) setPickMode((m) => (m === 'keep' ? null : m));
    if (view.phase !== 'turn') setPickMode((m) => (m === 'takeFromDone' ? null : m));
  }, [view.myDrawnCard, view.phase]);

  function sendGuarded(fn: () => void) {
    if (inFlight) return;
    setInFlight(true);
    fn();
  }

  function onPickSlot(slot: number) {
    if (pickMode === 'keep') {
      setPickMode(null);
      sendGuarded(() => game.sendCommand({ type: 'keepDrawn', slot }));
    } else if (pickMode === 'takeFromDone') {
      setPickMode(null);
      sendGuarded(() => game.sendCommand({ type: 'takeFromDone', slot }));
    }
  }

  return (
    <div className="table-felt">
      <TableBanner view={view} roundNumber={roundNumber} nameOf={nameOf} activityLine={activityLine} />

      {view.phase === 'setupPeek' ? (
        <SetupPeekPanel game={game} peeks={peeks} inFlight={inFlight} sendGuarded={sendGuarded} />
      ) : (
        <>
          <div className="opponent-rows">
            {opponents.map((p) => (
              <OpponentRow
                key={p.id}
                playerId={p.id}
                name={nameOf(p.id)}
                color={colorOf(p.id)}
                listSize={p.listSize}
                isCurrent={view.currentPlayer === p.id}
                isCaller={view.caller === p.id}
                peeks={peeks}
              />
            ))}
          </div>

          <CenterPiles
            game={game}
            inFlight={inFlight}
            sendGuarded={sendGuarded}
            isMyTurn={isMyTurn}
            pickMode={pickMode}
            onStartTakeFromDone={() => setPickMode('takeFromDone')}
          />

          <MyRow
            game={game}
            myListSize={myPlayerView?.listSize ?? 0}
            isMyTurn={isMyTurn}
            isCaller={view.caller === myId}
            peeks={peeks}
            inFlight={inFlight}
            sendGuarded={sendGuarded}
            pickMode={pickMode}
            onPickSlot={onPickSlot}
            onStartKeepPick={() => setPickMode('keep')}
            onCancelPick={() => setPickMode(null)}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Banner: phase + turn info + caller + activity line for onlookers.

function TableBanner({
  view,
  roundNumber,
  nameOf,
  activityLine,
}: {
  view: NonNullable<Game['view']>;
  roundNumber: number;
  nameOf: (id: PlayerId | null) => string;
  activityLine: string | null;
}) {
  return (
    <div className="phase-banner">
      <strong>Round {roundNumber}</strong>
      <span>
        {view.phase === 'setupPeek'
          ? 'Peek at 2 of your cards'
          : view.currentPlayer
            ? `${nameOf(view.currentPlayer)}'s turn`
            : ''}
      </span>
      {view.caller && <span>&quot;NOT ME!&quot; called by {nameOf(view.caller)}</span>}
      {activityLine && <span className="activity-line">{activityLine}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup peek: tap 2 of your own slots, send setupPeek, then the peeked hook
// shows both faces for 10s.

function SetupPeekPanel({
  game,
  peeks,
  inFlight,
  sendGuarded,
}: {
  game: Game;
  peeks: ReturnType<typeof usePeeks>;
  inFlight: boolean;
  sendGuarded: (fn: () => void) => void;
}) {
  const { view, me } = game;
  const [selected, setSelected] = useState<number[]>([]);
  if (!view || !me) return null;

  const myView = view.players.find((p) => p.id === me.playerId);
  const alreadyPeeked = myView?.setupPeeked ?? false;
  const listSize = myView?.listSize ?? 6;
  const othersWaiting = view.players.filter((p) => p.id !== me.playerId && !p.setupPeeked);

  function toggleSlot(i: number) {
    if (alreadyPeeked || inFlight) return;
    setSelected((prev) => {
      if (prev.includes(i)) return prev.filter((s) => s !== i);
      if (prev.length >= 2) return prev;
      return [...prev, i];
    });
  }

  function confirmPeek() {
    if (selected.length !== 2) return;
    const slots: [number, number] = [selected[0]!, selected[1]!];
    sendGuarded(() => game.sendCommand({ type: 'setupPeek', slots }));
  }

  return (
    <div className="setup-peek-panel">
      <h2 className="setup-peek-title">Peek at 2 of your cards</h2>
      <p className="setup-peek-sub">
        {alreadyPeeked
          ? 'You peeked. Memory is the game now — waiting for everyone else…'
          : 'Tap two of your own cards below. You get one look, then they flip back for the whole round.'}
      </p>

      <div className="my-list-row" role="group" aria-label="Your chore list">
        {Array.from({ length: listSize }).map((_, i) => {
          const peeked = me ? peeks.peekAt(me.playerId, i) : null;
          const isSelected = selected.includes(i);
          return (
            <button
              key={i}
              type="button"
              className="slot-btn"
              data-selected={isSelected}
              disabled={alreadyPeeked || inFlight}
              aria-label={
                peeked
                  ? `Your card, slot ${i + 1}, revealed: ${peeked.name}`
                  : `Your card, slot ${i + 1}, face down${isSelected ? ', selected for peek' : ''}`
              }
              onClick={() => toggleSlot(i)}
            >
              {peeked ? <CardFace name={peeked.name as CardName} /> : <CardBack />}
            </button>
          );
        })}
      </div>

      {!alreadyPeeked && (
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={selected.length !== 2 || inFlight}
          onClick={confirmPeek}
        >
          {inFlight ? 'Peeking…' : selected.length === 2 ? 'Confirm peek' : `Pick ${2 - selected.length} more card${2 - selected.length === 1 ? '' : 's'}`}
        </button>
      )}

      {alreadyPeeked && othersWaiting.length > 0 && (
        <p className="waiting-line">Waiting on {othersWaiting.length} player{othersWaiting.length === 1 ? '' : 's'}…</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Opponent row: name, avatar dot, card count, turn indicator, face-down cards
// (scrollable). Any peek addressed to me about one of THEIR slots (Snoop,
// arriving M4) would show through the same peeks map — already wired.

function OpponentRow({
  playerId,
  name,
  color,
  listSize,
  isCurrent,
  isCaller,
  peeks,
}: {
  playerId: PlayerId;
  name: string;
  color: string;
  listSize: number;
  isCurrent: boolean;
  isCaller: boolean;
  peeks: ReturnType<typeof usePeeks>;
}) {
  return (
    <div className="opponent-row" data-current={isCurrent}>
      <div className="opponent-meta">
        <span className="avatar-dot" style={{ background: color }} aria-hidden />
        <span className="opponent-name">{name}</span>
        {isCaller && <span className="caller-badge">NOT ME!</span>}
        {isCurrent && <span className="turn-indicator" aria-label={`${name}'s turn`} />}
        <span className="card-count">{listSize}</span>
      </div>
      <div className="opponent-cards" role="group" aria-label={`${name}'s chore list`}>
        {Array.from({ length: listSize }).map((_, i) => {
          const peeked = peeks.peekAt(playerId, i);
          return (
            <div key={i} className="opp-slot" aria-label={peeked ? `${name}'s card, slot ${i + 1}, revealed to you: ${peeked.name}` : `${name}'s card, slot ${i + 1}, face down`}>
              {peeked ? <CardFace name={peeked.name as CardName} className="card-img-sm" /> : <CardBack className="card-img-sm" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Center piles: deck (tap to draw) + DONE pile (tap to take top card).

function CenterPiles({
  game,
  inFlight,
  sendGuarded,
  isMyTurn,
  pickMode,
  onStartTakeFromDone,
}: {
  game: Game;
  inFlight: boolean;
  sendGuarded: (fn: () => void) => void;
  isMyTurn: boolean;
  pickMode: 'keep' | 'takeFromDone' | null;
  onStartTakeFromDone: () => void;
}) {
  const { view } = game;
  if (!view) return null;
  const canAct = isMyTurn && view.phase === 'turn' && pickMode === null;

  return (
    <div className="center-piles">
      <button
        type="button"
        className="pile-btn deck-pile"
        disabled={!canAct || inFlight || view.deckCount === 0}
        aria-label={`Deck, ${view.deckCount} cards left. ${canAct ? 'Tap to draw.' : ''}`}
        onClick={() => sendGuarded(() => game.sendCommand({ type: 'draw' }))}
      >
        <CardBack className="card-img-lg" />
        <span className="pile-count">{view.deckCount}</span>
      </button>

      <button
        type="button"
        className="pile-btn done-pile"
        disabled={!canAct || inFlight || !view.doneTop || view.players.find((p) => p.id === game.me?.playerId)?.listSize === 0}
        aria-label={
          view.doneTop
            ? `DONE pile, top card ${view.doneTop.name}, ${view.doneCount} cards. ${canAct ? 'Tap to take it into your list.' : ''}`
            : 'DONE pile is empty'
        }
        onClick={() => {
          if (!canAct) return;
          onStartTakeFromDone();
        }}
      >
        {view.doneTop ? (
          <CardFace name={view.doneTop.name as CardName} className="card-img-lg" />
        ) : (
          <CardBack className="card-img-lg" />
        )}
        <span className="pile-count">{view.doneCount}</span>
      </button>

      {canAct && !view.myDrawnCard && (
        <button
          type="button"
          className="btn btn-night not-me-btn"
          disabled={inFlight}
          onClick={() => sendGuarded(() => game.sendCommand({ type: 'callNotMe' }))}
        >
          NOT ME!
        </button>
      )}

      {pickMode === 'takeFromDone' && <p className="waiting-line">Tap a slot in your row below to swap it in.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// My row: bottom, larger cards, horizontally scrollable at 375px. Handles the
// drawn-card hand area (keep/discard) and the keep-target slot picker.

function MyRow({
  game,
  myListSize,
  isMyTurn,
  isCaller,
  peeks,
  inFlight,
  sendGuarded,
  pickMode,
  onPickSlot,
  onStartKeepPick,
  onCancelPick,
}: {
  game: Game;
  myListSize: number;
  isMyTurn: boolean;
  isCaller: boolean;
  peeks: ReturnType<typeof usePeeks>;
  inFlight: boolean;
  sendGuarded: (fn: () => void) => void;
  pickMode: 'keep' | 'takeFromDone' | null;
  onPickSlot: (slot: number) => void;
  onStartKeepPick: () => void;
  onCancelPick: () => void;
}) {
  const { view, me } = game;
  const drawn = view?.myDrawnCard ?? null;

  if (!view || !me) return null;

  const pickable = pickMode !== null;

  return (
    <div className="my-row">
      <div className="my-row-header">
        <span className="my-row-label">Your chore list {isCaller && <span className="caller-badge">NOT ME!</span>}</span>
        {isMyTurn && view.phase === 'turn' && !drawn && pickMode === null && (
          <span className="turn-hint">Your turn — draw, take DONE, or call NOT ME!</span>
        )}
      </div>

      <div className="my-list-row" role="group" aria-label="Your chore list">
        {Array.from({ length: myListSize }).map((_, i) => {
          const peeked = me ? peeks.peekAt(me.playerId, i) : null;
          return (
            <button
              key={i}
              type="button"
              className="slot-btn slot-btn-lg"
              data-pickable={pickable}
              disabled={!pickable || inFlight}
              aria-label={
                peeked
                  ? `Your card, slot ${i + 1}, revealed: ${peeked.name}`
                  : `Your card, slot ${i + 1}, face down${pickable ? ' — tap to place card here' : ''}`
              }
              onClick={() => onPickSlot(i)}
            >
              {peeked ? <CardFace name={peeked.name as CardName} /> : <CardBack />}
            </button>
          );
        })}
        {myListSize === 0 && <p className="empty-seats">Your list is empty — nice.</p>}
      </div>

      {drawn && (
        <DrawnCardPanel
          drawn={drawn}
          myListSize={myListSize}
          inFlight={inFlight}
          pickingKeepSlot={pickMode === 'keep'}
          onKeep={() => {
            if (myListSize === 0) {
              sendGuarded(() => game.sendCommand({ type: 'keepDrawn', slot: 0 }));
            } else {
              onStartKeepPick();
            }
          }}
          onDiscard={() => sendGuarded(() => game.sendCommand({ type: 'discardDrawn', withAction: false }))}
          onCancelPick={onCancelPick}
        />
      )}
    </div>
  );
}

function DrawnCardPanel({
  drawn,
  myListSize,
  inFlight,
  pickingKeepSlot,
  onKeep,
  onDiscard,
  onCancelPick,
}: {
  drawn: { name: string; effort: number; kind: string };
  myListSize: number;
  inFlight: boolean;
  pickingKeepSlot: boolean;
  onKeep: () => void;
  onDiscard: () => void;
  onCancelPick: () => void;
}) {
  return (
    <div className="drawn-card-panel" role="region" aria-label="Drawn card">
      <div className="drawn-card-face">
        <CardFace name={drawn.name as CardName} className="card-img-lg drawn-anim" />
      </div>
      <div className="drawn-card-actions">
        {pickingKeepSlot ? (
          <>
            <p className="drawn-hint">Tap one of your slots above to place it there.</p>
            <button type="button" className="btn btn-ghost btn-block" onClick={onCancelPick}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-primary" disabled={inFlight} onClick={onKeep}>
              {myListSize === 0 ? 'Keep (add to list)' : 'Keep…'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={inFlight} onClick={onDiscard}>
              Discard
            </button>
            {/* TODO(M4): if drawn.kind === 'action', offer "Discard & play action"
                which sends discardDrawn withAction:true and opens the guided
                action UI (pick opponent -> pick slot, per action). For M3 we
                only ever send withAction:false. */}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity line for onlookers, from public events. Best-effort last-5s log.

function useActivityLine(events: Game['events'], nameOf: (id: PlayerId | null) => string): string | null {
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    const last = events[events.length - 1];
    if (!last) return;
    const text = describeEvent(last, nameOf);
    if (text) setLine(text);
  }, [events, nameOf]);
  return line;
}

function describeEvent(event: Game['events'][number], nameOf: (id: PlayerId | null) => string): string | null {
  switch (event.type) {
    case 'drew':
      return `${nameOf(event.player)} drew a card…`;
    case 'kept':
      return `${nameOf(event.player)} kept it.`;
    case 'discarded':
      return `${nameOf(event.player)} discarded to DONE.`;
    case 'tookFromDone':
      return `${nameOf(event.player)} took the DONE card.`;
    case 'notMeCalled':
      return `${nameOf(event.caller)} called "NOT ME!"`;
    case 'slapCorrect':
      return `${nameOf(event.player)} slammed "Done it!"`;
    case 'slapWrong':
      return `${nameOf(event.player)} slapped wrong and drew a penalty.`;
    case 'turnSkipped':
      return `${nameOf(event.player)}'s turn was skipped ("I'm Busy").`;
    case 'actionStarted':
      return `${nameOf(event.player)} is playing ${event.action}…`;
    default:
      return null;
  }
}
