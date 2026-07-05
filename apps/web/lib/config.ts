// Server endpoints. NEXT_PUBLIC_WS_URL points at the game server's WebSocket;
// the HTTP API (room creation) lives on the same origin with ws->http scheme.

export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:8787';

export const HTTP_URL = WS_URL.replace(/^ws/, 'http');

/** 8 preset avatar colors — warm, distinct, on-brand with the deck palette. */
export const AVATAR_COLORS = [
  '#F5A62B', // marmalade
  '#E2725B', // terracotta
  '#D9636C', // rose
  '#8C6BB1', // plum
  '#232E52', // midnight
  '#8FA2DC', // periwinkle
  '#47B5A0', // teal
  '#6BA368', // fern
] as const;
