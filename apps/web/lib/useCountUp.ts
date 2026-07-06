'use client';

// Simple integer count-up: animates from 0 to `target` in ~duration ms using
// requestAnimationFrame. Used only at reveal for the running effort total —
// per spec, running totals must never appear during play, only at reveal.

import { useEffect, useRef, useState } from 'react';

export function useCountUp(target: number, durationMs: number, reduced: boolean): number {
  const [value, setValue] = useState(reduced ? target : 0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduced) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const from = 0;
    function tick(now: number) {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs, reduced]);

  return value;
}
