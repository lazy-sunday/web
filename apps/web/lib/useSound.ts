'use client';

// Persistent sound on/off toggle (localStorage, default OFF) + a `play`
// callback that no-ops when muted. The AudioContext itself is only ever
// created inside playSound(), which only ever runs from a user gesture
// (button click, keypress) — so we never risk an autoplay violation.

import { useCallback, useEffect, useState } from 'react';
import { loadSoundEnabled, playSound, saveSoundEnabled, type SoundName } from './sound';

export interface SoundControls {
  enabled: boolean;
  toggle: () => void;
  play: (name: SoundName) => void;
}

export function useSound(): SoundControls {
  const [enabled, setEnabled] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setEnabled(loadSoundEnabled());
    setHydrated(true);
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      saveSoundEnabled(next);
      return next;
    });
  }, []);

  const play = useCallback(
    (name: SoundName) => {
      if (!hydrated) return;
      playSound(name, enabled);
    },
    [enabled, hydrated],
  );

  return { enabled, toggle, play };
}
