'use client';

// Persistent mute/unmute control. Small, always reachable, never surprises
// anyone: sound defaults OFF until a player explicitly opts in.

import type { SoundControls } from '../lib/useSound';

export function SoundToggle({ sound, className }: { sound: SoundControls; className?: string }) {
  return (
    <button
      type="button"
      className={`sound-toggle ${className ?? ''}`}
      aria-label={sound.enabled ? 'Mute sound effects' : 'Unmute sound effects'}
      aria-pressed={sound.enabled}
      onClick={sound.toggle}
    >
      {sound.enabled ? <SoundOnIcon /> : <SoundOffIcon />}
    </button>
  );
}

function SoundOnIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden focusable="false">
      <path
        d="M4 9v6h4l5 5V4L8 9H4z"
        fill="currentColor"
      />
      <path
        d="M16.5 8.5a5 5 0 0 1 0 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M19 6a9 9 0 0 1 0 12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
        opacity="0.7"
      />
    </svg>
  );
}

function SoundOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden focusable="false">
      <path d="M4 9v6h4l5 5V4L8 9H4z" fill="currentColor" />
      <path
        d="M16 9l5 6M21 9l-5 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
