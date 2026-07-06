'use client';

// Guided action modal (Milestone 4). Drives itself off `view.pendingAction`:
// while pendingAction.actor === me and step === 'input', walk the action's
// step list (packages/engine/src/round.ts is the authority; ACTION_FLOWS in
// lib/actionMeta.ts just mirrors §9.4 targeting for client-side UX). Each
// pick advances a local step pointer; the final pick fires `actionInput`.
// Knock It Out is two-step: after the peek, pendingAction.step flips to
// 'knockItOutDecision' and we swap to a Discard/Keep prompt.
//
// Cancelling at any point before the final pick sends `cancelAction` —
// performing an action is always optional (§5).

import { useEffect, useState } from 'react';
import type { CardName, PlayerId } from '@lazy-sunday/engine';
import type { useGameSocket } from '../lib/useGameSocket';
import type { usePeeks } from '../lib/usePeeks';
import {
  ACTION_FLOWS,
  buildActionInput,
  illegalPlayerIds,
  slotOwnerFor,
  type ActionPicks,
} from '../lib/actionMeta';
import { CardBack, CardFace } from './Card';

type Game = ReturnType<typeof useGameSocket>;

export function ActionModal({
  game,
  peeks,
  nameOf,
  colorOf,
}: {
  game: Game;
  peeks: ReturnType<typeof usePeeks>;
  nameOf: (id: PlayerId | null) => string;
  colorOf: (id: PlayerId) => string;
}) {
  const { view, me } = game;
  const [stepIndex, setStepIndex] = useState(0);
  const [picks, setPicks] = useState<ActionPicks>({});
  const [sending, setSending] = useState(false);

  const pa = view?.pendingAction;
  const isMine = !!pa && !!me && pa.actor === me.playerId;

  // Reset local wizard state whenever a fresh action starts (or clears).
  useEffect(() => {
    setStepIndex(0);
    setPicks({});
    setSending(false);
  }, [pa?.actor, pa?.action]);

  function cancel() {
    if (sending) return;
    setSending(true);
    game.sendCommand({ type: 'cancelAction' });
  }

  // Escape always cancels the action (§5: performing is always optional),
  // except mid-flight while a command is already in transit. Declared
  // before any early return so hook call order stays stable across renders.
  useEffect(() => {
    if (!isMine) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') cancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMine, sending]);

  if (!view || !me || !pa || !isMine) return null;

  const flow = ACTION_FLOWS[pa.action];
  const myId = me.playerId;
  const otherPlayers = view.players.filter((p) => p.id !== myId);

  function send(fn: () => void) {
    if (sending) return;
    setSending(true);
    fn();
  }

  // -------------------------------------------------------------------
  // Knock It Out decision step: peeked, now discard-or-keep.
  if (pa.step === 'knockItOutDecision') {
    const slot = pa.knockSlot ?? 0;
    const peeked = peeks.peekAt(myId, slot);
    return (
      <ModalScrim label="Knock It Out — discard or keep">
        <div className="action-modal night">
          <h2 className="action-modal-title">Knock It Out</h2>
          <p className="action-modal-rule">You peeked. Discard it to DONE (any value), or keep it in your list.</p>
          <div className="action-modal-peek">
            {peeked ? (
              <CardFace name={peeked.name as CardName} className="card-img-lg" />
            ) : (
              <CardBack className="card-img-lg" />
            )}
          </div>
          <div className="action-modal-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={sending}
              onClick={() => send(() => game.sendCommand({ type: 'knockItOutDecision', discard: true }))}
            >
              Discard it
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-night-ghost"
              disabled={sending}
              onClick={() => send(() => game.sendCommand({ type: 'knockItOutDecision', discard: false }))}
            >
              Keep it
            </button>
          </div>
        </div>
      </ModalScrim>
    );
  }

  // -------------------------------------------------------------------
  // Normal guided input steps.
  const step = flow.steps[stepIndex];
  if (!step) return null;

  function commitPick(key: string, value: PlayerId | number) {
    const nextPicks = { ...picks, [key]: value };
    setPicks(nextPicks);
    const isLast = stepIndex === flow.steps.length - 1;
    if (isLast) {
      const input = buildActionInput(pa!.action, nextPicks);
      send(() => game.sendCommand({ type: 'actionInput', input: input as never }));
    } else {
      setStepIndex((i) => i + 1);
    }
  }

  return (
    <ModalScrim label={`${flow.title} — guided action`}>
      <div className="action-modal night">
        <div className="action-modal-header">
          <h2 className="action-modal-title">{flow.title}</h2>
          <span className="action-modal-step">
            Step {stepIndex + 1} of {flow.steps.length}
          </span>
        </div>
        <p className="action-modal-rule">{flow.ruleText}</p>
        <p className="action-modal-prompt">{step.prompt}</p>

        {step.kind === 'pickPlayer' ? (
          <PlayerPicker
            candidates={step.owner === 'anyone' ? view.players : otherPlayers}
            illegal={illegalPlayerIds(flow, step, myId, picks)}
            nameOf={nameOf}
            colorOf={colorOf}
            myId={myId}
            disabled={sending}
            onPick={(id) => commitPick(step.key, id)}
          />
        ) : (
          <SlotPicker
            owner={slotOwnerFor(flow, stepIndex, myId, picks)}
            listSize={
              (step.owner === 'self' ? view.players.find((p) => p.id === myId) : view.players.find((p) => p.id === slotOwnerFor(flow, stepIndex, myId, picks)))
                ?.listSize ?? 0
            }
            ownerName={step.owner === 'self' ? 'your' : `${nameOf(slotOwnerFor(flow, stepIndex, myId, picks))}'s`}
            peeks={peeks}
            disabled={sending}
            onPick={(slot) => commitPick(step.key, slot)}
          />
        )}

        <div className="action-modal-footer">
          {stepIndex > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-night-ghost"
              disabled={sending}
              onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            >
              Back
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-night-ghost action-modal-cancel" disabled={sending} onClick={cancel}>
            Cancel action
          </button>
        </div>
      </div>
    </ModalScrim>
  );
}

// ---------------------------------------------------------------------------

function ModalScrim({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label={label}>
      <div className="modal-pop">{children}</div>
    </div>
  );
}

function PlayerPicker({
  candidates,
  illegal,
  nameOf,
  colorOf,
  myId,
  disabled,
  onPick,
}: {
  candidates: { id: PlayerId; listSize: number }[];
  illegal: Set<PlayerId>;
  nameOf: (id: PlayerId | null) => string;
  colorOf: (id: PlayerId) => string;
  myId: PlayerId;
  disabled: boolean;
  onPick: (id: PlayerId) => void;
}) {
  return (
    <div className="player-picker" role="group" aria-label="Choose a player">
      {candidates.map((p) => {
        const isIllegal = illegal.has(p.id);
        return (
          <button
            key={p.id}
            type="button"
            className="player-pick-btn"
            disabled={disabled || isIllegal}
            aria-label={`${nameOf(p.id)}${p.id === myId ? ' (you)' : ''}, ${p.listSize} cards${isIllegal ? ', unavailable' : ''}`}
            onClick={() => onPick(p.id)}
          >
            <span className="avatar-dot" style={{ background: colorOf(p.id) }} aria-hidden />
            <span className="player-pick-name">
              {nameOf(p.id)}
              {p.id === myId ? ' (you)' : ''}
            </span>
            <span className="card-count">{p.listSize}</span>
          </button>
        );
      })}
    </div>
  );
}

function SlotPicker({
  owner,
  listSize,
  ownerName,
  peeks,
  disabled,
  onPick,
}: {
  owner: PlayerId;
  listSize: number;
  ownerName: string;
  peeks: ReturnType<typeof usePeeks>;
  disabled: boolean;
  onPick: (slot: number) => void;
}) {
  return (
    <div className="my-list-row slot-picker-row" role="group" aria-label={`Pick one of ${ownerName} cards`}>
      {Array.from({ length: listSize }).map((_, i) => {
        const peeked = peeks.peekAt(owner, i);
        return (
          <button
            key={i}
            type="button"
            className="slot-btn"
            data-pickable
            disabled={disabled}
            aria-label={peeked ? `Card revealed to you: ${peeked.name}` : `${ownerName} card, slot ${i + 1}, face down`}
            onClick={() => onPick(i)}
          >
            {peeked ? <CardFace name={peeked.name as CardName} /> : <CardBack />}
          </button>
        );
      })}
      {listSize === 0 && <p className="empty-seats">No cards there.</p>}
    </div>
  );
}
