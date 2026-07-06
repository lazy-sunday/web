'use client';

// "Done it!" slap arbitration UI (Milestone 4, rules §6/§9.6/§9.7).
//
// The DONE IT! button is always visible and (when not locked) always
// tappable, on anyone's turn. Tapping opens a picker: choose whose card —
// yours or an opponent's — then which slot. The slap command fires the
// instant a slot is chosen (optimistic: we show a "slapping…" flash right
// away) and reconciles against slapCorrect / slapWrong / slapTooLate.
//
// §9.7 gift flow: correctly slapping an OPPONENT's card sets
// view.pendingGift = {from: me, to: them}. We then prompt for one of MY
// remaining cards to hand over face-down. While ANY gift is pending the
// whole table is locked (engine returns giftPending) — reflected here by
// disabling the slam button for onlookers too.
//
// Locks: slaps are rejected by the engine during phase 'action' (§6) and
// during a pending gift. We disable the button proactively so no one taps
// into a doomed request, but always trust the server's error/event back.

import { useEffect, useRef, useState } from 'react';
import type { CardName, PlayerId } from '@lazy-sunday/engine';
import type { useGameSocket } from '../lib/useGameSocket';
import { CardBack, CardFace } from './Card';

type Game = ReturnType<typeof useGameSocket>;

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
  colorOf,
}: {
  game: Game;
  nameOf: (id: PlayerId | null) => string;
  colorOf: (id: PlayerId) => string;
}) {
  const { view, me, events, lastError, clearError } = game;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedOwner, setPickedOwner] = useState<PlayerId | null>(null);
  const [optimistic, setOptimistic] = useState<OptimisticSlap | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const seenCount = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const myId = me?.playerId ?? null;

  // "slow down" toast: the server rate-limits slap spam per client. Other
  // slap-shaped errors (slapLocked, cannotGift, invalidSlot…) surface here
  // too, in case our client-side lock check missed an edge case — the
  // server is always the real authority.
  useEffect(() => {
    if (!lastError) return;
    if (lastError.code === 'rateLimited') {
      showToast('Slow down — too many slaps.');
      clearError();
    } else if (lastError.code === 'slapLocked' || lastError.code === 'cannotGift' || lastError.code === 'callerLocked') {
      showToast(lastError.message);
      clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastError]);

  // Reconcile optimistic state against the real event stream.
  useEffect(() => {
    const newEvents = events.slice(seenCount.current);
    seenCount.current = events.length;
    if (newEvents.length === 0 || !myId) return;
    for (const ev of newEvents) {
      if (ev.type === 'slapCorrect' && ev.player === myId) {
        setOptimistic({ owner: ev.owner, slot: ev.slot, outcome: 'correct' });
        scheduleClear();
      } else if (ev.type === 'slapWrong' && ev.player === myId) {
        setOptimistic({ owner: ev.owner, slot: ev.slot, outcome: 'wrong' });
        showToast(ev.penaltyDrawn ? 'Wrong! Penalty card drawn.' : 'Wrong! (deck was empty — no penalty)');
        scheduleClear();
      } else if (ev.type === 'slapTooLate' && ev.player === myId) {
        setOptimistic((prev) => (prev ? { ...prev, outcome: 'tooLate' } : prev));
        showToast('Too late — someone beat you to it.');
        scheduleClear(800);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, myId]);

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

  // Escape always closes the slap picker (it never sent anything yet, so
  // there's nothing to roll back).
  useEffect(() => {
    if (!pickerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setPickerOpen(false);
        setPickedOwner(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickerOpen]);

  if (!view || !me) return null;

  const myGift = view.pendingGift && view.pendingGift.from === myId ? view.pendingGift : null;
  const someoneElsesGift = view.pendingGift && view.pendingGift.from !== myId ? view.pendingGift : null;

  const locked = view.phase === 'action' || view.pendingGift !== null;
  const canSlap = !locked && view.doneTop !== null;

  function fireSlap(owner: PlayerId, slot: number) {
    setPickerOpen(false);
    setPickedOwner(null);
    setOptimistic({ owner, slot, outcome: 'pending' });
    game.sendCommand({ type: 'slap', owner, slot, expectedTopId: view!.doneTop?.id });
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

      <button
        type="button"
        className="slam-btn"
        data-locked={locked}
        disabled={!canSlap}
        aria-label={
          locked
            ? 'Done it! — locked while an action or gift resolves'
            : 'Done it! Slap the DONE pile if you think a card matches.'
        }
        onClick={() => setPickerOpen(true)}
      >
        <SlamIcon />
        <span>DONE IT!</span>
      </button>
      {locked && <p className="slam-lock-hint">Locked — {view.phase === 'action' ? 'an action is resolving' : 'a gift is pending'}</p>}

      {pickerOpen && (
        <SlapPicker
          game={game}
          myId={myId!}
          nameOf={nameOf}
          colorOf={colorOf}
          pickedOwner={pickedOwner}
          onPickOwner={setPickedOwner}
          onPickSlot={(slot) => fireSlap(pickedOwner!, slot)}
          onClose={() => {
            setPickerOpen(false);
            setPickedOwner(null);
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function SlamIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden focusable="false">
      <path
        d="M12 2 L15 9 L22 10 L17 15 L18.5 22 L12 18.5 L5.5 22 L7 15 L2 10 L9 9 Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SlapPicker({
  game,
  myId,
  nameOf,
  colorOf,
  pickedOwner,
  onPickOwner,
  onPickSlot,
  onClose,
}: {
  game: Game;
  myId: PlayerId;
  nameOf: (id: PlayerId | null) => string;
  colorOf: (id: PlayerId) => string;
  pickedOwner: PlayerId | null;
  onPickOwner: (id: PlayerId) => void;
  onPickSlot: (slot: number) => void;
  onClose: () => void;
}) {
  const { view } = game;
  if (!view) return null;
  const doneTop = view.doneTop;

  const owner = pickedOwner ? view.players.find((p) => p.id === pickedOwner) : null;
  // §6: slapping an OPPONENT's card obligates you to immediately give them
  // one of your own — with an empty list you can't meet that obligation, so
  // only your own cards are slappable (the engine enforces this as `cannotGift`).
  const myListSize = view.players.find((p) => p.id === myId)?.listSize ?? 0;

  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label="Done it! — pick a card">
      <div className="modal-pop">
        <div className="slap-picker">
          <h2 className="action-modal-title">Done it!</h2>
          {doneTop ? (
            <div className="slap-target">
              <CardFace name={doneTop.name as CardName} className="card-img-lg" />
              <p className="slap-target-label">Matches this?</p>
            </div>
          ) : (
            <p>The DONE pile is empty.</p>
          )}

          {!owner ? (
            <>
              <p className="action-modal-prompt">Whose card is it?</p>
              <div className="player-picker" role="group" aria-label="Choose whose card to slap">
                {view.players.map((p) => {
                  const isSelf = p.id === myId;
                  const disabled = p.listSize === 0 || (!isSelf && myListSize === 0);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className="player-pick-btn"
                      disabled={disabled}
                      aria-label={`${nameOf(p.id)}${isSelf ? ' (your own list)' : ''}, ${p.listSize} cards${
                        disabled && !isSelf ? ' — you have no card to give in return' : ''
                      }`}
                      onClick={() => onPickOwner(p.id)}
                    >
                      <span className="avatar-dot" style={{ background: colorOf(p.id) }} aria-hidden />
                      <span className="player-pick-name">{isSelf ? 'My own card' : nameOf(p.id)}</span>
                      <span className="card-count">{p.listSize}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <p className="action-modal-prompt">
                Tap the card in {owner.id === myId ? 'your' : `${nameOf(owner.id)}'s`} list.
              </p>
              <div className="my-list-row slot-picker-row" role="group" aria-label="Pick the card to slap">
                {Array.from({ length: owner.listSize }).map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    className="slot-btn"
                    data-pickable
                    aria-label={`Slap slot ${i + 1}`}
                    onClick={() => onPickSlot(i)}
                  >
                    <CardBack />
                  </button>
                ))}
              </div>
            </>
          )}

          <button type="button" className="btn btn-ghost btn-block" onClick={onClose}>
            Cancel
          </button>
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
  const listSize = myView?.listSize ?? 0;

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
            {Array.from({ length: listSize }).map((_, i) => (
              <button
                key={i}
                type="button"
                className="slot-btn"
                data-pickable
                disabled={sending}
                aria-label={`Give away card in slot ${i + 1}`}
                onClick={() => {
                  setSending(true);
                  game.sendCommand({ type: 'giveCard', slot: i });
                }}
              >
                <CardBack />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
