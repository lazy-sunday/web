import type { PlayerView } from '@lazy-sunday/engine';

export interface RenderSlot {
  visualSlot: number;
  cardSlot: number | null;
  occupied: boolean;
}

export function renderSlotsFor(player: PlayerView | undefined): RenderSlot[] {
  if (!player) return [];
  return player.listSlots.map((occupied, visualSlot) => ({
    visualSlot,
    cardSlot: occupied ? compactSlotFor(player.listSlots, visualSlot) : null,
    occupied,
  }));
}

export function compactSlotFor(listSlots: readonly boolean[], visualSlot: number): number | null {
  if (!listSlots[visualSlot]) return null;
  let cardSlot = 0;
  for (let i = 0; i < visualSlot; i += 1) {
    if (listSlots[i]) cardSlot += 1;
  }
  return cardSlot;
}
