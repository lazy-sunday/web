'use client';

// Ticks a local deadline (epoch ms) down to whole seconds remaining. Returns
// null when there is no active deadline. Drives the visible turn timer so
// players know how long before a turn auto-skips (server default 45s).

import { useEffect, useState } from 'react';

export function useCountdown(deadline: number | null): number | null {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(() =>
    deadline === null ? null : Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
  );

  useEffect(() => {
    if (deadline === null) {
      setSecondsLeft(null);
      return;
    }
    const compute = () => Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    setSecondsLeft(compute());
    const id = setInterval(() => setSecondsLeft(compute()), 250);
    return () => clearInterval(id);
  }, [deadline]);

  return secondsLeft;
}
