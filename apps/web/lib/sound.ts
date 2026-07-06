'use client';

// Tasteful sound effects, synthesized with the Web Audio API — NO audio asset
// files, no external URLs, nothing to download, CSP stays clean. A single
// shared AudioContext is created lazily on the first user gesture (never
// autoplay before that) and reused for every subsequent cue.
//
// Persisted mute state lives in localStorage, defaulting to OFF so nobody is
// surprised by sound the first time they open a room link.

const STORAGE_KEY = 'lazy-sunday:sound-enabled';

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function loadSoundEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveSoundEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    /* private mode etc. — the toggle just won't survive a refresh */
  }
}

type ToneOpts = {
  freq: number;
  durationMs: number;
  type?: OscillatorType;
  gain?: number;
  delayMs?: number;
  glideTo?: number;
};

/** One short synthesized tone: an oscillator through a gain envelope
 *  (quick attack, exponential-ish decay) so nothing pops or clicks. */
function tone(context: AudioContext, { freq, durationMs, type = 'sine', gain = 0.18, delayMs = 0, glideTo }: ToneOpts): void {
  const start = context.currentTime + delayMs / 1000;
  const dur = durationMs / 1000;
  const osc = context.createOscillator();
  const amp = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + dur);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.02, dur * 0.25));
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(amp);
  amp.connect(context.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** Short filtered-noise burst — used for the slap/discard "thwack". */
function noiseBurst(context: AudioContext, { durationMs, gain = 0.22, delayMs = 0, filterFreq = 1200 }: { durationMs: number; gain?: number; delayMs?: number; filterFreq?: number }): void {
  const start = context.currentTime + delayMs / 1000;
  const dur = durationMs / 1000;
  const frameCount = Math.max(1, Math.floor(context.sampleRate * dur));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i++) data[i] = Math.random() * 2 - 1;
  const src = context.createBufferSource();
  src.buffer = buffer;
  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = filterFreq;
  const amp = context.createGain();
  amp.gain.setValueAtTime(gain, start);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(filter);
  filter.connect(amp);
  amp.connect(context.destination);
  src.start(start);
  src.stop(start + dur + 0.02);
}

export type SoundName = 'draw' | 'discard' | 'slap' | 'yourTurn' | 'reveal';

/** Plays a cue if `enabled`. Silently no-ops without a user-gesture-unlocked
 *  AudioContext (e.g. SSR, or the very first paint) — never throws. */
export function playSound(name: SoundName, enabled: boolean): void {
  if (!enabled) return;
  const context = getContext();
  if (!context) return;
  try {
    switch (name) {
      case 'draw':
        // a light upward flick — pulling a card off the deck
        tone(context, { freq: 520, glideTo: 680, durationMs: 110, type: 'triangle', gain: 0.12 });
        break;
      case 'discard':
        // soft card-on-pile tap
        noiseBurst(context, { durationMs: 70, gain: 0.16, filterFreq: 900 });
        tone(context, { freq: 220, durationMs: 90, type: 'sine', gain: 0.1 });
        break;
      case 'slap':
        // slam + flash: a sharp noise thwack plus a low thud
        noiseBurst(context, { durationMs: 90, gain: 0.28, filterFreq: 1600 });
        tone(context, { freq: 150, durationMs: 140, type: 'sine', gain: 0.22, delayMs: 5 });
        break;
      case 'yourTurn':
        // a friendly two-note chime
        tone(context, { freq: 660, durationMs: 140, type: 'sine', gain: 0.14 });
        tone(context, { freq: 880, durationMs: 220, type: 'sine', gain: 0.14, delayMs: 120 });
        break;
      case 'reveal':
        // a small ascending flourish for the reveal ceremony
        tone(context, { freq: 440, durationMs: 120, type: 'triangle', gain: 0.13 });
        tone(context, { freq: 554, durationMs: 120, type: 'triangle', gain: 0.13, delayMs: 90 });
        tone(context, { freq: 660, durationMs: 220, type: 'triangle', gain: 0.15, delayMs: 180 });
        break;
    }
  } catch {
    /* never let a sound glitch break gameplay */
  }
}
