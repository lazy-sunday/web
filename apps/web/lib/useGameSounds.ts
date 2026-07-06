'use client';

// Wires the engine event stream to sound cues (M5 item 5). Only ever reacts
// to OUR OWN client's relevant moments — 'yourTurn' never fires for another
// player's turn, and 'draw'/'discard'/'slap' only fire for events whose
// `player` is us. 'reveal' is triggered separately by RevealScreen itself
// (once per reveal, not per event) since the reveal phase has no single
// discrete event to key off of.

import { useEffect, useRef } from 'react';
import type { EngineEvent, PlayerId } from '@lazy-sunday/engine';
import type { SoundControls } from './useSound';

export function useGameSounds(events: EngineEvent[], myId: PlayerId | null, sound: SoundControls): void {
  const seenCount = useRef(0);

  useEffect(() => {
    // A fresh room/round can shrink the events array (capped log) — guard
    // against a negative slice by resetting when that happens.
    if (seenCount.current > events.length) seenCount.current = 0;
    const newEvents = events.slice(seenCount.current);
    seenCount.current = events.length;
    if (newEvents.length === 0 || !myId) return;

    for (const ev of newEvents) {
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
