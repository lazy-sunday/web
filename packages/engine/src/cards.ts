// Deck definition — lazy-sunday-rules-v1.md Section 2 (54 cards).

export type ChoreName =
  | 'Nap'
  | 'Feed the Cat'
  | 'Water the Plants'
  | 'Take Out the Trash'
  | 'Fold the Laundry'
  | 'Vacuum the Living Room';

export type ActionName =
  | "I'm Busy"
  | 'Check the List'
  | 'Knock It Out'
  | "Let's Trade"
  | 'Switcheroo'
  | 'Snoop'
  | "Not My Job"
  | "Landlord's Notice";

export type CardName = ChoreName | ActionName;

export interface Card {
  /** Unique per physical card within a round. Never sent to clients for face-down cards. */
  id: string;
  name: CardName;
  effort: number;
  kind: 'chore' | 'action';
}

export const DEFAULT_DECK_COUNT = 1;
export const MIN_DECK_COUNT = 1;
export const MAX_DECK_COUNT = 3;

export function isValidDeckCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_DECK_COUNT && value <= MAX_DECK_COUNT;
}

interface CardSpec {
  name: CardName;
  effort: number;
  kind: 'chore' | 'action';
  copies: number;
}

export const CARD_SPECS: readonly CardSpec[] = [
  { name: 'Nap', effort: 0, kind: 'chore', copies: 2 },
  { name: 'Feed the Cat', effort: 2, kind: 'chore', copies: 4 },
  { name: 'Water the Plants', effort: 3, kind: 'chore', copies: 4 },
  { name: 'Take Out the Trash', effort: 4, kind: 'chore', copies: 4 },
  { name: 'Fold the Laundry', effort: 5, kind: 'chore', copies: 4 },
  { name: 'Vacuum the Living Room', effort: 6, kind: 'chore', copies: 4 },
  { name: "I'm Busy", effort: 1, kind: 'action', copies: 4 },
  { name: 'Check the List', effort: 7, kind: 'action', copies: 4 },
  { name: 'Knock It Out', effort: 8, kind: 'action', copies: 4 },
  { name: "Let's Trade", effort: 9, kind: 'action', copies: 4 },
  { name: 'Switcheroo', effort: 10, kind: 'action', copies: 4 },
  { name: 'Snoop', effort: 11, kind: 'action', copies: 4 },
  { name: "Not My Job", effort: 12, kind: 'action', copies: 4 },
  { name: "Landlord's Notice", effort: 13, kind: 'action', copies: 4 },
];

/** Builds one or more complete 54-card decks, unshuffled. */
export function buildDeck(deckCount = DEFAULT_DECK_COUNT): Card[] {
  if (!isValidDeckCount(deckCount)) {
    throw new Error(`deckCount must be an integer from ${MIN_DECK_COUNT} to ${MAX_DECK_COUNT}`);
  }
  const deck: Card[] = [];
  for (let deckIndex = 0; deckIndex < deckCount; deckIndex++) {
    for (const spec of CARD_SPECS) {
      for (let i = 0; i < spec.copies; i++) {
        const idPrefix = deckCount === 1 ? slug(spec.name) : `${slug(spec.name)}-d${deckIndex + 1}`;
        deck.push({
          id: `${idPrefix}-${i}`,
          name: spec.name,
          effort: spec.effort,
          kind: spec.kind,
        });
      }
    }
  }
  return deck;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** SVG asset file for each card face, matching apps/web/public/cards/. */
export const CARD_ASSET: Record<CardName, string> = {
  'Nap': '01-nap.svg',
  'Feed the Cat': '02-feed-the-cat.svg',
  'Water the Plants': '03-water-the-plants.svg',
  'Take Out the Trash': '04-take-out-the-trash.svg',
  'Fold the Laundry': '05-fold-the-laundry.svg',
  'Vacuum the Living Room': '06-vacuum-the-living-room.svg',
  "I'm Busy": '07-im-busy.svg',
  'Check the List': '08-check-the-list.svg',
  'Knock It Out': '09-knock-it-out.svg',
  "Let's Trade": '10-lets-trade.svg',
  'Switcheroo': '11-switcheroo.svg',
  'Snoop': '12-snoop.svg',
  "Not My Job": '13-not-my-job.svg',
  "Landlord's Notice": '14-landlords-notice.svg',
};

export const CARD_BACK_ASSET = '15-card-back.svg';
