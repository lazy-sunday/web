'use client';

// "Done it!" slap arbitration UI (Milestone 4, rules §6/§9.6/§9.7).
//
// A slap now starts from the table: tap a face-down card in any player list,
// confirm it against the visible DONE top, then send the existing `slap`
// command. The server/engine still arbitrate correctness, timing, and locks.
//
// §9.7 gift flow: correctly slapping an OPPONENT's card sets
// view.pendingGift = {from: me, to: them}. We then prompt for one of MY
// remaining cards to hand over face-down. While ANY gift is pending the
// whole table is locked (engine returns giftPending) — reflected by clearing
// or disabling table card selection for onlookers too.
//
// Locks: slaps are rejected by the engine during phase 'action' (§6) and
// during a pending gift. We disable card-first selection proactively so no one
// taps into a doomed request, but always trust the server's error/event back.

import { useEffect, useRef, useState } from 'react';
import type { CardName, PlayerId } from '@lazy-sunday/engine';
import type { useGameSocket } from '../lib/useGameSocket';
import { renderSlotsFor } from '../lib/slots';
import { CardBack, CardFace } from './Card';

type Game = ReturnType<typeof useGameSocket>;

export interface SlapTarget {
  owner: PlayerId;
  slot: number;
}

interface OptimisticSlap {
  owner: PlayerId;
  slot: number;
  outcome: 'pending' | 'correct' | 'wrong' | 'tooLate';
}

// Sound for slapCorrect/slapWrong is triggered centrally by useGameSounds
// (keyed off the same event stream this component reconciles against), so
// this component stays focused on the optimistic UI + arbitration reconcile.
export function SlapLayer({
  game,
  nameOf,
  selectedTarget,
  onClearTarget,
}: {
  game: Game;
  nameOf: (id: PlayerId | null) => string;
  selectedTarget: SlapTarget | null;
  onClearTarget: () => void;
}) {
  const { view, me, events, lastError, clearError } = game;
  const [optimistic, setOptimistic] = useState<OptimisticSlap | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const seenCount = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slapSending = useRef(false);

  const myId = me?.playerId ?? null;

  // "slow down" toast: the server rate-limits slap spam per client. Other
  // slap-shaped errors (slapLocked, cannotGift, invalidSlot…) surface here
  // too, in case our client-side lock check missed an edge case — the
  // server is always the real authority.
  useEffect(() => {
    if (!lastError) return;
    if (lastError.code === 'rateLimited') {
      showToast('Slow down — too many slaps.');
      onClearTarget();
      clearError();
    } else if (
      lastError.code === 'slapLocked' ||
      lastError.code === 'cannotGift' ||
      lastError.code === 'callerLocked' ||
      lastError.code === 'invalidSlot' ||
      lastError.code === 'invalidTarget' ||
      lastError.code === 'giftPending'
    ) {
      showToast(lastError.message);
      onClearTarget();
      clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastError, onClearTarget]);

  // Reconcile optimistic state against the real event stream.
  useEffect(() => {
    const newEvents = events.slice(seenCount.current);
    seenCount.current = events.length;
    if (newEvents.length === 0 || !myId) return;
    for (const ev of newEvents) {
      if (ev.type === 'slapCorrect' && ev.player === myId) {
        onClearTarget();
        setOptimistic({ owner: ev.owner, slot: ev.slot, outcome: 'correct' });
        scheduleClear();
      } else if (ev.type === 'slapWrong' && ev.player === myId) {
        onClearTarget();
        setOptimistic({ owner: ev.owner, slot: ev.slot, outcome: 'wrong' });
        showToast(ev.penaltyDrawn ? 'Wrong! Penalty card drawn.' : 'Wrong! (deck was empty — no penalty)');
        scheduleClear();
      } else if (ev.type === 'slapTooLate' && ev.player === myId) {
        onClearTarget();
        setOptimistic((prev) => (prev ? { ...prev, outcome: 'tooLate' } : prev));
        showToast('Too late — someone beat you to it.');
        scheduleClear(800);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, myId, onClearTarget]);

  function scheduleClear(ms = 1400) {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setOptimistic(null), ms);
  }

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, []);

  // A changed DONE top invalidates the match the player was confirming.
  useEffect(() => {
    onClearTarget();
  }, [view?.doneTop?.id, onClearTarget]);

  const slapSelectionLocked = Boolean(view && (view.phase === 'action' || view.pendingGift !== null));

  // Entering an action or gift flow locks slaps. Playable phase changes such as
  // turn -> drawn intentionally leave an open confirmation alone.
  useEffect(() => {
    if (slapSelectionLocked) onClearTarget();
  }, [slapSelectionLocked, onClearTarget]);

  // A newly selected target starts a fresh confirmation/send attempt.
  useEffect(() => {
    if (selectedTarget) slapSending.current = false;
  }, [selectedTarget]);

  // Escape always closes the confirmation (it never sent anything yet, so
  // there's nothing to roll back).
  useEffect(() => {
    if (!selectedTarget) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClearTarget();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedTarget, onClearTarget]);

  if (!view || !me) return null;

  const myGift = view.pendingGift && view.pendingGift.from === myId ? view.pendingGift : null;
  const someoneElsesGift = view.pendingGift && view.pendingGift.from !== myId ? view.pendingGift : null;

  const locked = view.phase === 'action' || view.pendingGift !== null;
  const canSlap = !locked && view.doneTop !== null;
  const selectedOwner = selectedTarget ? view.players.find((p) => p.id === selectedTarget.owner) : null;
  const selectedIsValid = Boolean(
    selectedTarget && selectedOwner && selectedTarget.slot >= 0 && selectedTarget.slot < selectedOwner.listSize,
  );

  function fireSlap() {
    const expectedTopId = view?.doneTop?.id;
    if (
      !selectedTarget ||
      !selectedIsValid ||
      !canSlap ||
      expectedTopId === undefined ||
      slapSending.current
    ) {
      return;
    }
    slapSending.current = true;
    const { owner, slot } = selectedTarget;
    onClearTarget();
    setOptimistic({ owner, slot, outcome: 'pending' });
    game.sendCommand({ type: 'slap', owner, slot, expectedTopId });
  }

  return (
    <>
      {toast && (
        <div className="slap-toast" role="status">
          {toast}
        </div>
      )}

      {optimistic && (
        <div
          className="slap-flash"
          data-outcome={optimistic.outcome}
          role="status"
          aria-label={
            optimistic.outcome === 'pending'
              ? 'Slap sent…'
              : optimistic.outcome === 'correct'
                ? 'Slap correct!'
                : optimistic.outcome === 'wrong'
                  ? 'Slap wrong'
                  : 'Slap too late'
          }
        >
          {optimistic.outcome === 'pending' && 'Done it!'}
          {optimistic.outcome === 'correct' && 'Done it! ✓'}
          {optimistic.outcome === 'wrong' && 'Nope — penalty drawn'}
          {optimistic.outcome === 'tooLate' && 'Too late!'}
        </div>
      )}

      {someoneElsesGift && (
        <div className="gift-banner" role="status">
          {nameOf(someoneElsesGift.from)} is giving {nameOf(someoneElsesGift.to)} a card…
        </div>
      )}

      {myGift && <GiftPicker game={game} />}

      {selectedTarget && selectedIsValid && canSlap && (
        <SlapConfirm
          doneTop={view.doneTop!}
          target={selectedTarget}
          ownerName={selectedTarget.owner === myId ? 'your card' : `${nameOf(selectedTarget.owner)}'s card`}
          onConfirm={fireSlap}
          onCancel={onClearTarget}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function SlapConfirm({
  doneTop,
  target,
  ownerName,
  onConfirm,
  onCancel,
}: {
  doneTop: NonNullable<NonNullable<Game['view']>['doneTop']>;
  target: SlapTarget;
  ownerName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-labelledby="slap-confirm-title">
      <div className="modal-pop">
        <div className="slap-confirm">
          <h2 id="slap-confirm-title" className="action-modal-title">Done it?</h2>
          <div className="slap-confirm-targets" aria-hidden>
            <div className="slap-confirm-card">
              <CardBack className="card-img-lg" alt="" />
              <span>{ownerName}</span>
            </div>
            <span className="slap-confirm-arrow">→</span>
            <div className="slap-confirm-card">
              <CardFace name={doneTop.name as CardName} className="card-img-lg" alt="" />
              <span>DONE top</span>
            </div>
          </div>
          <p className="action-modal-prompt">
            {ownerName}, slot {target.slot + 1}, matches {doneTop.name}?
          </p>

          <div className="slap-confirm-actions">
            <button ref={confirmRef} type="button" className="btn btn-primary" onClick={onConfirm}>
              Done it!
            </button>
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §9.7: after correctly slapping an opponent's card, give one of MY cards
// face-down to fill the gap. The receiver never sees it either — we render
// only slot buttons, never a face.

function GiftPicker({ game }: { game: Game }) {
  const { view, me } = game;
  const [sending, setSending] = useState(false);
  if (!view || !me) return null;
  const myView = view.players.find((p) => p.id === me.playerId);
  const slots = renderSlotsFor(myView);

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="Give a card">
      <div className="modal-pop">
        <div className="action-modal night">
          <h2 className="action-modal-title">Give a card</h2>
          <p className="action-modal-rule">
            You slapped correctly — now hand over one of your own cards, face-down, to fill the gap. You&apos;ll
            remember what you gave; they never see it.
          </p>
          <div className="my-list-row slot-picker-row" role="group" aria-label="Pick a card to give away">
            {slots.map((slot) => {
              if (!slot.occupied || slot.cardSlot === null) {
                return <span key={slot.visualSlot} className="slot-gap" aria-label={`Empty slot ${slot.visualSlot + 1}`} />;
              }
              return (
                <button
                  key={slot.visualSlot}
                  type="button"
                  className="slot-btn"
                  data-pickable
                  disabled={sending}
                  aria-label={`Give away card in slot ${slot.visualSlot + 1}`}
                  onClick={() => {
                    setSending(true);
                    game.sendCommand({ type: 'giveCard', slot: slot.cardSlot! });
                  }}
                >
                  <CardBack />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
