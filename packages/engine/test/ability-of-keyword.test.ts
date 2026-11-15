import { describe, expect, it } from 'vitest';
import { abilityOfKeyword } from '../src/characteristics.js';

/**
 * "Equip abilities", "a cycling ability", "ninjutsu abilities": which activated abilities a keyword names — one reading
 * for a cost reduction (Fighter Class, Fluctuator, Silver-Fur Master) and for "Whenever you activate …".
 */
describe('the abilities of a keyword', () => {
  it('an ability whose text starts with the keyword', () => {
    expect(abilityOfKeyword('Equip {2}', 'equip')).toBe(true);
    expect(abilityOfKeyword('Equip—Pay 2 life.', 'equip')).toBe(true);
    expect(abilityOfKeyword('Exhaust — {3}: Draw a card.', 'exhaust')).toBe(true);
    expect(abilityOfKeyword('{T}: Add {G}.', 'equip')).toBe(false);
    expect(abilityOfKeyword('Equipped creature gets +1/+1.', 'equip')).toBe(false);
    expect(abilityOfKeyword(undefined, 'equip')).toBe(false);
  });

  it('CR 702.29f: typecycling abilities are cycling abilities; CR 702.49d: commander ninjutsu is ninjutsu', () => {
    expect(abilityOfKeyword('Cycling {2}', 'cycling')).toBe(true);
    expect(abilityOfKeyword('Swampcycling {2}', 'cycling')).toBe(true);
    expect(abilityOfKeyword('Basic landcycling {1}{G}', 'cycling')).toBe(true);
    expect(abilityOfKeyword('Ninjutsu {1}{U}', 'ninjutsu')).toBe(true);
    expect(abilityOfKeyword('Commander ninjutsu {U}{B}', 'ninjutsu')).toBe(true);
    expect(abilityOfKeyword('Ninjutsu {1}{U}', 'cycling')).toBe(false);
  });
});
