// Deterministic PRNG (mulberry32). The round stores rngState so reshuffles and
// penalty draws are replayable in tests and across server restarts.

export function nextRandom(state: number): { value: number; state: number } {
  let t = (state + 0x6d2b79f5) | 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return { value: ((r ^ (r >>> 14)) >>> 0) / 4294967296, state: t };
}

/** Fisher–Yates shuffle; returns the shuffled copy and the advanced rng state. */
export function shuffle<T>(items: readonly T[], rngState: number): { items: T[]; state: number } {
  const out = items.slice();
  let state = rngState;
  for (let i = out.length - 1; i > 0; i--) {
    const r = nextRandom(state);
    state = r.state;
    const j = Math.floor(r.value * (i + 1));
    const a = out[i]!;
    out[i] = out[j]!;
    out[j] = a;
  }
  return { items: out, state };
}
