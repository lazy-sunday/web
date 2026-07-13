'use client';

// Wires the engine event stream to sound cues (M5 item 5). Only ever reacts
// to OUR OWN client's relevant moments — 'yourTurn' never fires for another
// player's turn, and 'draw'/'discard'/'slap' only fire for events whose
// `player` is us. 'reveal' is triggered separately by RevealScreen itself
// (once per reveal, not per event) since the reveal phase has no single
// discrete event to key off of.

import { useEffect, useRef } from 'react';
import type { PlayerId } from '@lazy-sunday/engine';
import { eventsAfter } from './eventLog';
import type { GameEvent } from './useGameSocket';
import type { SoundControls } from './useSound';

export function useGameSounds(events: GameEvent[], myId: PlayerId | null, sound: SoundControls): void {
  const lastSeenSequence = useRef(0);

  useEffect(() => {
    const newEvents = eventsAfter(events, lastSeenSequence.current);
    if (newEvents.length === 0) return;
    lastSeenSequence.current = newEvents.at(-1)!.sequence;
    if (!myId) return;

    for (const { event: ev } of newEvents) {
      switch (ev.type) {
        case 'drew':
          if (ev.player === myId) sound.play('draw');
          break;
        case 'discarded':
        case 'tookFromDone':
        case 'kept':
          if (ev.player === myId) sound.play('discard');
          break;
        case 'slapCorrect':
        case 'slapWrong':
          if (ev.player === myId) sound.play('slap');
          break;
        case 'turnStarted':
          if (ev.player === myId) sound.play('yourTurn');
          break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, myId]);
}
