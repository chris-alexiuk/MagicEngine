import { describe, expect, it } from 'vitest';
import { compileCards } from '../src/compile.js';
import { isSubtype, registerPoolSubtypes } from '../src/grammar/words.js';
import type { ScryfallCard } from '../src/scryfall.js';

// Creature types newer than the Comprehensive Rules file are taken from the pool's own type lines (CR 205.3).
const card = (name: string, type_line: string, oracle_text: string): ScryfallCard =>
  ({ object: 'card', id: `${name}-id`, oracle_id: `${name}-oracle`, name, layout: 'normal', mana_cost: '{1}{R}', cmc: 2, type_line, oracle_text, colors: ['R'], color_identity: ['R'], legalities: { commander: 'legal' }, set: 'tst', rarity: 'common', games: ['paper'] }) as unknown as ScryfallCard;

describe('creature types from the pool', () => {
  it('reads a token of a creature type that only appears on cards in the pool', () => {
    const { db } = compileCards([
      card('Investigator Lite', 'Creature — Zorblax Warrior', 'When this creature enters, create a 2/1 red Zorblax Warrior creature token with haste.'),
      card('Chief Lite', 'Creature — Zorblax', 'Other Zorblaxes you control get +1/+1.'),
    ]);
    const auto = Object.fromEntries(db.cards.map((c) => [c.name, c.automation]));
    expect(auto).toEqual({ 'Investigator Lite': 'full', 'Chief Lite': 'full' });
    expect(JSON.stringify(db.cards.find((c) => c.name === 'Chief Lite')!.faces[0]!.abilities)).toContain('"subtypes":["Zorblax"]');
  });

  it("doesn't take card types from a double-faced card's combined type line as creature types", () => {
    registerPoolSubtypes(['Legendary Creature — Human Cleric // Legendary Planeswalker — Liliana', 'Creature — Human Soldier // Creature — Angel']);
    expect(['Creature', 'Legendary', 'Planeswalker'].map(isSubtype)).toEqual([false, false, false]);
  });
});
