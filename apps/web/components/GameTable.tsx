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
import { buildActivityLog, latestSpotlightEntry, type ActivityVisual } from '../lib/activity';
import { ActionAnnouncement, ActivityLog, useActivitySpotlight } from './TableActivity';
import { usePeeks } from '../lib/usePeeks';
import { useCountdown } from '../lib/useCountdown';
import { useSound } from '../lib/useSound';
import { useGameSounds } from '../lib/useGameSounds';
import { renderSlotsFor } from '../lib/slots';
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

  // Event objects retain their identity while useGameSocket's capped array
  // slides forward. Assign each one a local monotonic id so unrelated events
  // and array truncation never restart an old seven-second spotlight.
  const activityEventIds = useRef(new WeakMap<object, number>());
  const nextActivityEventId = useRef(1);
  const activityEventIdOf = useCallback((event: Game['events'][number]) => {
    const known = activityEventIds.current.get(event);
    if (known !== undefined) return known;
    const id = nextActivityEventId.current;
    nextActivityEventId.current += 1;
    activityEventIds.current.set(event, id);
    return id;
  }, []);

  // Shared table activity (issue #30): one privacy-safe entry per public move,
  // with actions grouped from "started" to their outcome. Drives the durable
  // collapsible log, the center-table spotlight, and public slot highlights.
  const activityEntries = useMemo(
    () => buildActivityLog(events, nameOf, activityEventIdOf),
    [events, nameOf, activityEventIdOf],
  );
  const latestActivity = useMemo(() => latestSpotlightEntry(activityEntries), [activityEntries]);
  const spotlight = useActivitySpotlight(latestActivity);

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
        <PlayerPresenceBar lobby={lobby} meId={me.playerId} />
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
        turnTimer={game.turnTimer}
        myId={myId}
      />
      <HouseRuleBadges toggles={lobby.toggles} />
      <PlayerPresenceBar lobby={lobby} meId={myId} />
      <ActivityLog entries={activityEntries} />

      {view.phase === 'setupPeek' ? (
        <SetupPeekPanel game={game} peeks={peeks} inFlight={inFlight} sendGuarded={sendGuarded} />
      ) : (
        <div className="table-stage">
          <div className="opponent-rows">
            {opponents.map((p) => (
              <OpponentRow
                key={p.id}
                playerId={p.id}
                name={nameOf(p.id)}
                color={colorOf(p.id)}
                listSize={p.listSize}
                slots={renderSlotsFor(p)}
                isCurrent={view.currentPlayer === p.id}
                isCaller={view.caller === p.id}
                peeks={peeks}
                canSelectSlapTarget={canSelectOpponentSlapTarget}
                selectedSlapTarget={selectedSlapTarget}
                activityVisual={spotlight?.visual}
                onSelectSlapTarget={onSelectSlapTarget}
              />
            ))}
          </div>

          <ActionAnnouncement entry={spotlight} />

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
            slots={renderSlotsFor(myPlayerView)}
            isMyTurn={isMyTurn}
            isCaller={view.caller === myId}
            peeks={peeks}
            inFlight={inFlight}
            pickMode={pickMode}
            onPickSlot={onPickSlot}
            canSelectSlapTarget={canSelectSlapTarget}
            selectedSlapTarget={selectedSlapTarget}
            activityVisual={spotlight?.visual}
            onSelectSlapTarget={onSelectSlapTarget}
          />

          <SlapLayer
            game={game}
            nameOf={nameOf}
            selectedTarget={selectedSlapTarget}
            onClearTarget={clearSlapTarget}
          />
        </div>
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
// In-game presence: mirrors lobby connectivity while the table is visible.

function PlayerPresenceBar({ lobby, meId }: { lobby: NonNullable<Game['lobby']>; meId: PlayerId }) {
  return (
    <div className="table-presence" aria-label="Player connection status">
      {lobby.players.map((p) => (
        <span key={p.id} className="table-presence-player" data-connected={p.connected}>
          <span
            className="conn-dot"
            data-connected={p.connected}
            role="img"
            aria-label={p.connected ? `${p.name} is connected` : `${p.name} is disconnected`}
          />
          <span className="table-presence-name">
            {p.name}
            {p.id === meId ? ' (you)' : ''}
          </span>
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Banner: phase + turn info + caller + activity line for onlookers.

function TableBanner({
  view,
  roundNumber,
  nameOf,
  turnTimer,
  myId,
}: {
  view: NonNullable<Game['view']>;
  roundNumber: number;
  nameOf: (id: PlayerId | null) => string;
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
  const slots = renderSlotsFor(myView);
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
        {slots.map((slot) => {
          if (!slot.occupied || slot.cardSlot === null) {
            return <span key={slot.visualSlot} className="slot-gap" aria-label={`Empty slot ${slot.visualSlot + 1}`} />;
          }
          const peeked = me ? peeks.peekAt(me.playerId, slot.cardSlot) : null;
          const isSelected = selected.includes(slot.cardSlot);
          return (
            <button
              key={slot.visualSlot}
              type="button"
              className="slot-btn"
              data-selected={isSelected}
              disabled={alreadyPeeked || inFlight}
              aria-label={
                peeked
                  ? `Your card, slot ${slot.visualSlot + 1}, revealed: ${peeked.name}`
                  : `Your card, slot ${slot.visualSlot + 1}, face down${isSelected ? ', selected for peek' : ''}`
              }
              onClick={() => toggleSlot(slot.cardSlot!)}
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
  slots,
  isCurrent,
  isCaller,
  peeks,
  canSelectSlapTarget,
  selectedSlapTarget,
  activityVisual,
  onSelectSlapTarget,
}: {
  playerId: PlayerId;
  name: string;
  color: string;
  listSize: number;
  slots: ReturnType<typeof renderSlotsFor>;
  isCurrent: boolean;
  isCaller: boolean;
  peeks: ReturnType<typeof usePeeks>;
  canSelectSlapTarget: boolean;
  selectedSlapTarget: SlapTarget | null;
  activityVisual: ActivityVisual | undefined;
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
        {slots.map((slot) => {
          if (!slot.occupied || slot.cardSlot === null) {
            return <span key={slot.visualSlot} className="opp-slot slot-gap" aria-label={`Empty slot ${slot.visualSlot + 1}`} />;
          }
          const peeked = peeks.peekAt(playerId, slot.cardSlot);
          const selected = selectedSlapTarget?.owner === playerId && selectedSlapTarget.slot === slot.cardSlot;
          const activityRole = activityRoleForSlot(activityVisual, playerId, slot.cardSlot);
          return (
            <button
              key={slot.visualSlot}
              type="button"
              className="opp-slot"
              data-slap-pickable={canSelectSlapTarget}
              data-slap-selected={selected}
              data-activity-role={activityRole}
              disabled={!canSelectSlapTarget}
              aria-label={
                peeked
                  ? `${name}'s card, slot ${slot.visualSlot + 1}, revealed to you: ${peeked.name}${canSelectSlapTarget ? ' — select for Done it!' : ''}`
                  : `${name}'s card, slot ${slot.visualSlot + 1}, face down${canSelectSlapTarget ? ' — select for Done it!' : ''}`
              }
              aria-pressed={canSelectSlapTarget ? selected : undefined}
              onClick={() => onSelectSlapTarget(playerId, slot.cardSlot!)}
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
  slots,
  isMyTurn,
  isCaller,
  peeks,
  inFlight,
  pickMode,
  onPickSlot,
  canSelectSlapTarget,
  selectedSlapTarget,
  activityVisual,
  onSelectSlapTarget,
}: {
  game: Game;
  myListSize: number;
  slots: ReturnType<typeof renderSlotsFor>;
  isMyTurn: boolean;
  isCaller: boolean;
  peeks: ReturnType<typeof usePeeks>;
  inFlight: boolean;
  pickMode: 'keep' | 'takeFromDone' | null;
  onPickSlot: (slot: number) => void;
  canSelectSlapTarget: boolean;
  selectedSlapTarget: SlapTarget | null;
  activityVisual: ActivityVisual | undefined;
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
        {slots.map((slot) => {
          if (!slot.occupied || slot.cardSlot === null) {
            return <span key={slot.visualSlot} className="slot-gap slot-gap-lg" aria-label={`Empty slot ${slot.visualSlot + 1}`} />;
          }
          const peeked = me ? peeks.peekAt(me.playerId, slot.cardSlot) : null;
          const selected = selectedSlapTarget?.owner === me.playerId && selectedSlapTarget.slot === slot.cardSlot;
          const slapPickable = !pickable && canSelectSlapTarget;
          const activityRole = activityRoleForSlot(activityVisual, me.playerId, slot.cardSlot);
          return (
            <button
              key={slot.visualSlot}
              type="button"
              className="slot-btn slot-btn-lg"
              data-pickable={pickable}
              data-slap-pickable={slapPickable}
              data-slap-selected={selected}
              data-just-placed={justPlacedSlot === slot.cardSlot}
              data-activity-role={activityRole}
              disabled={pickable ? inFlight : !slapPickable}
              aria-pressed={slapPickable ? selected : undefined}
              aria-label={
                peeked
                  ? `Your card, slot ${slot.visualSlot + 1}, revealed: ${peeked.name}${pickable ? ' — tap to place card here' : slapPickable ? ' — select for Done it!' : ''}`
                  : `Your card, slot ${slot.visualSlot + 1}, face down${pickable ? ' — tap to place card here' : slapPickable ? ' — select for Done it!' : ''}`
              }
              onClick={() => {
                if (pickable) {
                  onPickSlot(slot.cardSlot!);
                } else if (slapPickable) {
                  onSelectSlapTarget(me.playerId, slot.cardSlot!);
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

function activityRoleForSlot(
  visual: ActivityVisual | undefined,
  player: PlayerId,
  slot: number,
): ActivityVisual['slots'][number]['role'] | undefined {
  return visual?.slots.find((candidate) => candidate.player === player && candidate.slot === slot)?.role;
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

// Activity feedback for the whole table (issue #30) — the center-table
// announcement and the collapsible log — now lives in ./TableActivity.tsx,
// sourced from the privacy-safe event describer in ../lib/activity.ts.
