import { describe, expect, it } from 'vitest';
import { eventVisibleTo } from '../src/view.js';

describe('eventVisibleTo — private routing vs public events', () => {
  it('routes peek/drawnCard only to the addressed player', () => {
    const peek = { type: 'peek', to: 'a' };
    expect(eventVisibleTo(peek, 'a')).toBe(true);
    expect(eventVisibleTo(peek, 'b')).toBe(false);
    const drawn = { type: 'drawnCard', to: 'b' };
    expect(eventVisibleTo(drawn, 'b')).toBe(true);
    expect(eventVisibleTo(drawn, 'a')).toBe(false);
  });

  it('a public event with a domain `to` field (giftGiven) reaches everyone (§6 activity line)', () => {
    // giftGiven.to is the gift RECIPIENT, not a socket address — bystanders and the
    // giver must still see "X gave Y a card". Regression guard against the field
    // name colliding with the private-routing convention.
    const gift = { type: 'giftGiven', from: 'a', to: 'b', toSlot: 0 };
    expect(eventVisibleTo(gift, 'a')).toBe(true); // giver
    expect(eventVisibleTo(gift, 'b')).toBe(true); // receiver
    expect(eventVisibleTo(gift, 'c')).toBe(true); // bystander
  });

  it('ordinary public events are visible to all', () => {
    for (const type of ['turnStarted', 'discarded', 'slapCorrect', 'roundRevealed']) {
      expect(eventVisibleTo({ type }, 'anyone')).toBe(true);
    }
  });
});
