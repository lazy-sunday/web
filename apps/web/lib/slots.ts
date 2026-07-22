import type { PlayerView } from '@lazy-sunday/engine';

export interface RenderSlot {
  visualSlot: number;
  cardSlot: number | null;
  occupied: boolean;
}

/** Activity copy and card controls refer to visual slots as one-based S1, S2,
 * and so on. Keep the visible badge format in one place. */
export function slotLabelFor(visualSlot: number): string {
  return `S${visualSlot + 1}`;
}

type SlotPlayerView = Pick<PlayerView, 'listSize'> & Partial<Pick<PlayerView, 'listSlots'>>;

export function renderSlotsFor(player: SlotPlayerView | null | undefined): RenderSlot[] {
  if (!player) return [];
  // During a rolling deployment, an updated web client can briefly receive a
  // PlayerView from an older server that only exposes listSize. Legacy views
  // had compact, gap-free lists, so recreating that shape preserves their UI.
  const listSlots = player.listSlots ?? Array.from({ length: player.listSize }, () => true);
  return listSlots.map((occupied, visualSlot) => ({
    visualSlot,
    cardSlot: occupied ? compactSlotFor(listSlots, visualSlot) : null,
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
