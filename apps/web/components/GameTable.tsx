'use client';

// The real card table (Milestone 3). Replaces TablePlaceholder.
//
// Layout: opponents' rows stacked above (small), my row pinned at the bottom
// (large), deck + DONE pile centered between them. Everything face-down
// renders from the card-back SVG; the only faces ever shown are the DONE
// top (always public) and whatever `usePeeks`/`myDrawnCard` grants me.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CardName, PlayerId } from '@lazy-sunday/engine';
import type { useGameSocket } from '../lib/useGameSocket';
import { usePeeks } from '../lib/usePeeks';
import { useCountdown } from '../lib/useCountdown';
import { useSound } from '../lib/useSound';
import { useGameSounds } from '../lib/useGameSounds';
import { ActionModal } from './ActionModal';
import { CardBack, CardFace } from './Card';
import { FloatingReactions, ReactionBar } from './ReactionBar';
import { RevealScreen } from './RevealScreen';
import { SlapLayer, type SlapTarget } from './SlapLayer';
import { SoundToggle } from './SoundToggle';
import { HouseRuleBadges } from './HouseRuleBadges';

type Game = ReturnType<typeof useGameSocket>;

export function GameTable({ game }: { game: Game }) {
  const { view, lobby, me, roundNumber, events } = game;
  const peeks = usePeeks(events, me?.playerId ?? null, view?.phase ?? null);
  const sound = useSound();
  useGameSounds(events, me?.playerId ?? null, sound);

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

  // "Pick a slot" mode is shared between the pile that started it (DONE pile)
  // and MyRow (which renders the pickable slots), so it lives up here. Hooks
  // must all run before any early return (Rules of Hooks), so this is
  // declared alongside `inFlight` rather than after the phase/null guards.
  const [pickMode, setPickMode] = useState<'keep' | 'takeFromDone' | null>(null);
  const [selectedSlapTarget, setSelectedSlapTarget] = useState<SlapTarget | null>(null);
  const clearSlapTarget = useCallback(() => setSelectedSlapTarget(null), []);
  useEffect(() => {
    if (!view?.myDrawnCard) setPickMode((m) => (m === 'keep' ? null : m));
    if (view?.phase !== 'turn' || view.currentPlayer !== me?.playerId) {
      setPickMode((m) => (m === 'takeFromDone' ? null : m));
    }
  }, [view?.myDrawnCard, view?.phase, view?.currentPlayer, me?.playerId]);
  useEffect(() => {
    if (pickMode !== null) clearSlapTarget();
  }, [pickMode, clearSlapTarget]);

  if (!view || !me || !lobby) return null;

  if (view.phase === 'reveal') {
    return (
      <div className="table-felt">
        <RevealScreen game={game} nameOf={nameOf} colorOf={colorOf} sound={sound} />
        <FloatingReactions reactions={game.reactions} nameOf={nameOf} />
        <div className="table-footer-controls">
          <SoundToggle sound={sound} className="table-sound-toggle" />
          <ReactionBar onSend={game.sendReaction} />
        </div>
      </div>
    );
  }

  const myId = me.playerId;
  const isMyTurn = view.currentPlayer === myId;
  const myPlayerView = view.players.find((p) => p.id === myId);
  const opponents = view.players.filter((p) => p.id !== myId);
  const myListSize = myPlayerView?.listSize ?? 0;
  const canSelectSlapTarget = view.doneTop !== null && view.phase !== 'action' && view.pendingGift === null && pickMode === null;
  const canSelectOpponentSlapTarget = canSelectSlapTarget && myListSize > 0;

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

  function onSelectSlapTarget(owner: PlayerId, slot: number) {
    if (!canSelectSlapTarget) return;
    if (owner !== myId && !canSelectOpponentSlapTarget) return;
    setSelectedSlapTarget({ owner, slot });
  }

  return (
    <div className="table-felt">
      <TableBanner
        view={view}
        roundNumber={roundNumber}
        nameOf={nameOf}
        activityLine={activityLine}
        turnTimer={game.turnTimer}
        myId={myId}
      />
      <HouseRuleBadges toggles={lobby.toggles} />

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
                canSelectSlapTarget={canSelectOpponentSlapTarget}
                selectedSlapTarget={selectedSlapTarget}
                onSelectSlapTarget={onSelectSlapTarget}
              />
            ))}
          </div>

          <CenterPiles
            game={game}
            myListSize={myPlayerView?.listSize ?? 0}
            inFlight={inFlight}
            sendGuarded={sendGuarded}
            isMyTurn={isMyTurn}
            pickMode={pickMode}
            onStartKeepPick={() => setPickMode('keep')}
            onStartTakeFromDone={() => setPickMode('takeFromDone')}
            onCancelPick={() => setPickMode(null)}
          />

          <MyRow
            game={game}
            myListSize={myListSize}
            isMyTurn={isMyTurn}
            isCaller={view.caller === myId}
            peeks={peeks}
            inFlight={inFlight}
            pickMode={pickMode}
            onPickSlot={onPickSlot}
            canSelectSlapTarget={canSelectSlapTarget}
            selectedSlapTarget={selectedSlapTarget}
            onSelectSlapTarget={onSelectSlapTarget}
          />

          <SlapLayer
            game={game}
            nameOf={nameOf}
            selectedTarget={selectedSlapTarget}
            onClearTarget={clearSlapTarget}
          />
        </>
      )}

      <ActionModal game={game} peeks={peeks} nameOf={nameOf} colorOf={colorOf} />

      <FloatingReactions reactions={game.reactions} nameOf={nameOf} />
      <div className="table-footer-controls">
        <SoundToggle sound={sound} className="table-sound-toggle" />
        <ReactionBar onSend={game.sendReaction} />
      </div>
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
  turnTimer,
  myId,
}: {
  view: NonNullable<Game['view']>;
  roundNumber: number;
  nameOf: (id: PlayerId | null) => string;
  activityLine: string | null;
  turnTimer: Game['turnTimer'];
  myId: PlayerId;
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
      <TurnCountdown turnTimer={turnTimer} myId={myId} />
      {view.caller && <span>&quot;NOT ME!&quot; called by {nameOf(view.caller)}</span>}
      {activityLine && <span className="activity-line">{activityLine}</span>}
    </div>
  );
}

/** The visible turn clock. Shows whoever the auto-skip timer is running
 *  against right now; emphasizes and warns when the clock is on YOU. */
function TurnCountdown({ turnTimer, myId }: { turnTimer: Game['turnTimer']; myId: PlayerId }) {
  const seconds = useCountdown(turnTimer.deadline);
  if (seconds === null || turnTimer.players.length === 0) return null;
  const onMe = turnTimer.players.includes(myId);
  const warn = seconds <= 10;
  return (
    <span
      className="turn-timer"
      data-on-me={onMe}
      data-warn={warn}
      role="timer"
      aria-label={`${onMe ? 'Your turn' : 'This turn'} auto-skips in ${seconds} second${seconds === 1 ? '' : 's'}`}
    >
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden focusable="false">
        <circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 13V8.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M9.5 2.5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="turn-timer-secs">{seconds}s</span>
    </span>
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
  canSelectSlapTarget,
  selectedSlapTarget,
  onSelectSlapTarget,
}: {
  playerId: PlayerId;
  name: string;
  color: string;
  listSize: number;
  isCurrent: boolean;
  isCaller: boolean;
  peeks: ReturnType<typeof usePeeks>;
  canSelectSlapTarget: boolean;
  selectedSlapTarget: SlapTarget | null;
  onSelectSlapTarget: (owner: PlayerId, slot: number) => void;
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
          const selected = selectedSlapTarget?.owner === playerId && selectedSlapTarget.slot === i;
          return (
            <button
              key={i}
              type="button"
              className="opp-slot"
              data-slap-pickable={canSelectSlapTarget}
              data-slap-selected={selected}
              disabled={!canSelectSlapTarget}
              aria-label={
                peeked
                  ? `${name}'s card, slot ${i + 1}, revealed to you: ${peeked.name}${canSelectSlapTarget ? ' — select for Done it!' : ''}`
                  : `${name}'s card, slot ${i + 1}, face down${canSelectSlapTarget ? ' — select for Done it!' : ''}`
              }
              aria-pressed={canSelectSlapTarget ? selected : undefined}
              onClick={() => onSelectSlapTarget(playerId, i)}
            >
              {peeked ? <CardFace name={peeked.name as CardName} className="card-img-sm" /> : <CardBack className="card-img-sm" />}
            </button>
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
  myListSize,
  inFlight,
  sendGuarded,
  isMyTurn,
  pickMode,
  onStartKeepPick,
  onStartTakeFromDone,
  onCancelPick,
}: {
  game: Game;
  myListSize: number;
  inFlight: boolean;
  sendGuarded: (fn: () => void) => void;
  isMyTurn: boolean;
  pickMode: 'keep' | 'takeFromDone' | null;
  onStartKeepPick: () => void;
  onStartTakeFromDone: () => void;
  onCancelPick: () => void;
}) {
  const { view } = game;
  const justChanged = useJustChanged(view?.doneTop?.id ?? null);
  if (!view) return null;
  const drawn = view.myDrawnCard ?? null;
  const canChoosePile = isMyTurn && view.phase === 'turn' && pickMode === null && !drawn;

  return (
    <div className="center-piles">
      <div className="pile-stage" data-has-decision={!!drawn || pickMode === 'takeFromDone'}>
        <button
          type="button"
          className="pile-btn deck-pile"
          disabled={!canChoosePile || inFlight || view.deckCount === 0}
          aria-label={`Deck, ${view.deckCount} cards left. ${canChoosePile ? 'Tap to draw.' : 'Unavailable right now.'}`}
          onClick={() => sendGuarded(() => game.sendCommand({ type: 'draw' }))}
        >
          <CardBack className="card-img-lg" />
          <span className="pile-count">{view.deckCount}</span>
        </button>

        {drawn && (
          <TableCardDecision
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
            onPlayAction={() => sendGuarded(() => game.sendCommand({ type: 'discardDrawn', withAction: true }))}
            onCancelPick={onCancelPick}
          />
        )}

        <button
          type="button"
          className="pile-btn done-pile"
          data-active-pick={pickMode === 'takeFromDone'}
          data-just-changed={justChanged}
          disabled={!canChoosePile || inFlight || !view.doneTop || myListSize === 0}
          aria-label={
            view.doneTop
              ? `DONE pile, top card ${view.doneTop.name}, ${view.doneCount} cards. ${canChoosePile ? 'Tap to take it into your list.' : 'Unavailable right now.'}`
              : 'DONE pile is empty'
          }
          onClick={() => {
            if (!canChoosePile) return;
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
      </div>

      {canChoosePile && (
        <button
          type="button"
          className="btn btn-night not-me-btn"
          disabled={inFlight}
          onClick={() => sendGuarded(() => game.sendCommand({ type: 'callNotMe' }))}
        >
          NOT ME!
        </button>
      )}

      {pickMode === 'takeFromDone' && (
        <div className="table-card-decision table-card-decision-compact" role="region" aria-label="Take DONE card">
          <p className="decision-hint">Choose one of your slots below to swap in the DONE card.</p>
          <button type="button" className="btn btn-ghost btn-block" onClick={onCancelPick}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// My row: bottom, larger cards, horizontally scrollable at 375px. It owns the
// target slots for keep/take-from-DONE while the decision UI stays table-side.

function MyRow({
  game,
  myListSize,
  isMyTurn,
  isCaller,
  peeks,
  inFlight,
  pickMode,
  onPickSlot,
  canSelectSlapTarget,
  selectedSlapTarget,
  onSelectSlapTarget,
}: {
  game: Game;
  myListSize: number;
  isMyTurn: boolean;
  isCaller: boolean;
  peeks: ReturnType<typeof usePeeks>;
  inFlight: boolean;
  pickMode: 'keep' | 'takeFromDone' | null;
  onPickSlot: (slot: number) => void;
  canSelectSlapTarget: boolean;
  selectedSlapTarget: SlapTarget | null;
  onSelectSlapTarget: (owner: PlayerId, slot: number) => void;
}) {
  const { view, me, events } = game;
  const justPlacedSlot = useJustPlacedSlot(events, me?.playerId ?? null);

  if (!view || !me) return null;

  const pickable = pickMode !== null;

  return (
    <div className="my-row">
      <div className="my-row-header">
        <span className="my-row-label">Your chore list {isCaller && <span className="caller-badge">NOT ME!</span>}</span>
        {isMyTurn && view.phase === 'turn' && !view.myDrawnCard && pickMode === null && (
          <span className="turn-hint">Your turn — draw, take DONE, or call NOT ME!</span>
        )}
      </div>

      <div className="my-list-row" role="group" aria-label="Your chore list">
        {Array.from({ length: myListSize }).map((_, i) => {
          const peeked = me ? peeks.peekAt(me.playerId, i) : null;
          const selected = selectedSlapTarget?.owner === me.playerId && selectedSlapTarget.slot === i;
          const slapPickable = !pickable && canSelectSlapTarget;
          return (
            <button
              key={i}
              type="button"
              className="slot-btn slot-btn-lg"
              data-pickable={pickable}
              data-slap-pickable={slapPickable}
              data-slap-selected={selected}
              data-just-placed={justPlacedSlot === i}
              disabled={pickable ? inFlight : !slapPickable}
              aria-pressed={slapPickable ? selected : undefined}
              aria-label={
                peeked
                  ? `Your card, slot ${i + 1}, revealed: ${peeked.name}${pickable ? ' — tap to place card here' : slapPickable ? ' — select for Done it!' : ''}`
                  : `Your card, slot ${i + 1}, face down${pickable ? ' — tap to place card here' : slapPickable ? ' — select for Done it!' : ''}`
              }
              onClick={() => {
                if (pickable) {
                  onPickSlot(i);
                } else if (slapPickable) {
                  onSelectSlapTarget(me.playerId, i);
                }
              }}
            >
              {peeked ? <CardFace name={peeked.name as CardName} /> : <CardBack />}
            </button>
          );
        })}
        {myListSize === 0 && <p className="empty-seats">Your list is empty — nice.</p>}
      </div>
    </div>
  );
}

function TableCardDecision({
  drawn,
  myListSize,
  inFlight,
  pickingKeepSlot,
  onKeep,
  onDiscard,
  onPlayAction,
  onCancelPick,
}: {
  drawn: { name: string; effort: number; kind: string };
  myListSize: number;
  inFlight: boolean;
  pickingKeepSlot: boolean;
  onKeep: () => void;
  onDiscard: () => void;
  onPlayAction: () => void;
  onCancelPick: () => void;
}) {
  const isAction = drawn.kind === 'action';
  return (
    <div className="table-card-decision" role="region" aria-label="Drawn card">
      <div className="decision-card-face">
        <CardFace name={drawn.name as CardName} className="card-img-lg drawn-anim" />
      </div>
      <div className="decision-actions">
        {pickingKeepSlot ? (
          <>
            <p className="decision-hint">Choose one of your slots below to place this card.</p>
            <button type="button" className="btn btn-ghost btn-block" onClick={onCancelPick}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-primary" disabled={inFlight} onClick={onKeep}>
              {myListSize === 0 ? 'Keep (add to list)' : 'Keep…'}
            </button>
            {isAction ? (
              <>
                <button type="button" className="btn btn-night" disabled={inFlight} onClick={onPlayAction}>
                  Play {drawn.name}
                </button>
                <button type="button" className="btn btn-ghost" disabled={inFlight} onClick={onDiscard}>
                  Just discard
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-ghost" disabled={inFlight} onClick={onDiscard}>
                Discard
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Animation triggers (M5 item 6): small "did this just change" flags derived
// from view/event diffs, exposed as short-lived data-attributes so CSS
// keyframes (transform/opacity only) can play without any layout shift.

/** True for a brief window right after `value` changes identity — drives the
 *  DONE pile's "discard-drop" flash on every top-card change (discard, take-
 *  from-done, slap resolution). */
function useJustChanged(value: string | null): boolean {
  const [flag, setFlag] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      if (value !== null) {
        setFlag(true);
        const t = setTimeout(() => setFlag(false), 220);
        return () => clearTimeout(t);
      }
    }
    return undefined;
  }, [value]);
  return flag;
}

/** The slot index I most recently placed a card into via keep/take-from-DONE,
 *  held for one brief animation window then cleared. Landlord's Notice can
 *  also place a card into my list unseen — we don't animate that one slot
 *  specially since the identity is never public, but the list-size change
 *  itself is still visible via the row re-rendering. */
function useJustPlacedSlot(events: Game['events'], myId: PlayerId | null): number | null {
  const [slot, setSlot] = useState<number | null>(null);
  const seenCount = useRef(0);
  useEffect(() => {
    if (seenCount.current > events.length) seenCount.current = 0;
    const newEvents = events.slice(seenCount.current);
    seenCount.current = events.length;
    if (newEvents.length === 0 || !myId) return;
    for (const ev of newEvents) {
      if ((ev.type === 'kept' || ev.type === 'tookFromDone') && ev.player === myId) {
        setSlot(ev.slot);
        const t = setTimeout(() => setSlot(null), 240);
        return () => clearTimeout(t);
      }
    }
    return undefined;
  }, [events, myId]);
  return slot;
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

// Every OTHER player sees "X is playing Snoop…" (name + action) — never a
// target's face-down card face. Outcome lines below name positions/players
// (all public per the engine's event shapes) but never a hidden identity;
// the only card names that appear are ones the rules already make public
// (DONE-pile discards, slap outcomes, Knock It Out self-discards).
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
      return event.giftPending
        ? `${nameOf(event.player)} slammed "Done it!" on ${nameOf(event.owner)}'s card.`
        : `${nameOf(event.player)} slammed "Done it!"`;
    case 'slapWrong':
      return `${nameOf(event.player)} slapped wrong and drew a penalty.`;
    case 'slapTooLate':
      return `${nameOf(event.player)} was a split second too late.`;
    case 'turnSkipped':
      return `${nameOf(event.player)}'s turn was skipped ("I'm Busy").`;
    case 'actionStarted':
      return `${nameOf(event.player)} is playing ${event.action}…`;
    case 'actionCancelled':
      return `${nameOf(event.player)} decided not to play ${event.action}.`;
    case 'checkedTheList':
      return `${nameOf(event.player)} checked one of their own cards.`;
    case 'knockItOutPeeked':
      return `${nameOf(event.player)} is deciding whether to knock a card out…`;
    case 'knockedOut':
      return `${nameOf(event.player)} knocked out their "${event.card.name}".`;
    case 'knockItOutKept':
      return `${nameOf(event.player)} kept the card after peeking.`;
    case 'traded':
      return `${nameOf(event.player)} traded cards with ${nameOf(event.opponentId)}, blind.`;
    case 'switcherood':
      return `${nameOf(event.player)} switched a card between ${nameOf(event.a)} and ${nameOf(event.b)}.`;
    case 'snooped':
      return `${nameOf(event.player)} snooped on one of ${nameOf(event.targetId)}'s cards.`;
    case 'notMyJobbed':
      return `${nameOf(event.player)} moved a card from ${nameOf(event.fromId)} to ${nameOf(event.toId)} — "Not my job!"`;
    case 'landlordsNoticed':
      return `${nameOf(event.player)} served a Landlord's Notice on ${nameOf(event.targetId)}.`;
    case 'imBusied':
      return `${nameOf(event.player)} declared ${nameOf(event.targetId)} "I'm Busy" — their next turn is skipped.`;
    case 'giftGiven':
      return `${nameOf(event.from)} handed ${nameOf(event.to)} a card, face-down.`;
    default:
      return null;
  }
}
