import type { PlayerId } from '@lazy-sunday/engine';

interface TablePlayer {
  id: PlayerId;
}

interface LobbySeat {
  id: PlayerId;
  seat: number;
  connected: boolean;
}

export interface OpponentSeat<T extends TablePlayer> {
  player: T;
  /** Zero-based, stable room seat assigned by the server. */
  seat: number;
  connected: boolean;
}

/** Keep opponent tiles in the server-assigned seat order, independent of the
 * per-player round view order. Missing lobby metadata sorts last and is treated
 * as disconnected so stale views never imply that somebody is online. */
export function orderOpponentSeats<T extends TablePlayer>(
  players: readonly T[],
  lobbySeats: readonly LobbySeat[],
  myId: PlayerId,
): OpponentSeat<T>[] {
  const lobbyById = new Map(lobbySeats.map((player) => [player.id, player] as const));

  return players
    .filter((player) => player.id !== myId)
    .map((player) => {
      const lobby = lobbyById.get(player.id);
      return {
        player,
        seat: lobby?.seat ?? Number.MAX_SAFE_INTEGER,
        connected: lobby?.connected ?? false,
      };
    })
    .sort((a, b) => a.seat - b.seat);
}
