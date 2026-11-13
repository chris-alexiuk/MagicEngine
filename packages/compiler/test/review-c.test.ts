/** The November 2026 code review of slices 277–291, compiler side: a pool compiles the same whatever was compiled before it. */
import { describe, expect, it } from 'vitest';
import { compileCards } from '../src/compile.js';
import type { ScryfallCard } from '../src/scryfall.js';

const card = (name: string, type_line: string, oracle_text: string): ScryfallCard =>
  ({ object: 'card', id: `${name}-id`, oracle_id: `${name}-oracle`, name, layout: 'normal', mana_cost: '{1}{R}', cmc: 2, type_line, oracle_text, colors: ['R'], color_identity: ['R'], legalities: { commander: 'legal' }, set: 'tst', rarity: 'common', games: ['paper'] }) as unknown as ScryfallCard;

describe('review C: creature types from the pool (slice 282)', () => {
  it('compiling a pool gives the same result whatever was compiled before it in the process', () => {
    // A pool with no Quorblat creature in it: "Quorblats" isn't a creature type there.
    const pool = [card('Chief Lite', 'Creature — Human', 'Other Quorblats you control get +1/+1.')];
    const alone = compileCards(pool).db.cards[0]!;
    expect(alone.automation).toBe('manual');
    // Another pool has one; its types stay registered in module state (words.ts SUBTYPE_SET / SUBTYPE_PLURALS).
    compileCards([card('Quorblat Scout', 'Creature — Quorblat', '')]);
    const after = compileCards(pool).db.cards[0]!;
    expect(after.faces[0]!.abilities).toEqual(alone.faces[0]!.abilities);
    expect(after.automation).toBe(alone.automation);
  });
});
