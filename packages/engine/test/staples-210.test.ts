import { describe, expect, it } from 'vitest';
import { chars } from '../src/index.js';
import { give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Opal Lite', type_line: 'Enchantment', mana_cost: '{2}{W}{W}', cmc: 4, oracle_text: 'Each other non-Aura enchantment is a creature in addition to its other types and has base power and base toughness each equal to its mana value.' }),
  makeCard({ name: 'March Lite', type_line: 'Enchantment', mana_cost: '{3}{U}', cmc: 4, oracle_text: 'Each noncreature artifact is an artifact creature with power and toughness each equal to its mana value.' }),
  makeCard({ name: 'Starfield Lite', type_line: 'Enchantment', mana_cost: '{3}{W}', cmc: 4, oracle_text: 'As long as you control five or more enchantments, each other non-Aura enchantment you control is a creature in addition to its other types and has base power and base toughness each equal to its mana value.' }),
  makeCard({ name: 'Glyph', type_line: 'Enchantment', mana_cost: '{1}{W}{W}', cmc: 3, oracle_text: '' }),
  makeCard({ name: 'Ring Lite', type_line: 'Artifact', mana_cost: '{2}', cmc: 2, oracle_text: '' }),
  makeCard({ name: 'Bauble Lite', type_line: 'Artifact', mana_cost: '{0}', cmc: 0, oracle_text: '' }),
];
const main = () => toStep(start({ extra: CARDS }), 'main1', 'alice');

describe('slice 286: animated by mana value (layers 4 and 7b)', () => {
  it('Opalescence: other non-Aura enchantments are creatures with P/T equal to their own mana value', () => {
    const g = main();
    const opal = give(g, 'alice', 'Opal Lite', 'battlefield');
    const glyph = give(g, 'bob', 'Glyph', 'battlefield');
    const c = chars(g, g.objects[glyph]!);
    expect([c.types.includes('Creature'), c.power, c.toughness]).toEqual([true, 3, 3]);
    expect(chars(g, g.objects[opal]!).types.includes('Creature')).toBe(false);
  });

  it('March of the Machines: each noncreature artifact, sized by its mana value', () => {
    const g = main();
    give(g, 'alice', 'March Lite', 'battlefield');
    const ring = give(g, 'alice', 'Ring Lite', 'battlefield');
    const c = chars(g, g.objects[ring]!);
    expect([c.types.includes('Creature'), c.types.includes('Artifact'), c.power, c.toughness]).toEqual([true, true, 2, 2]);
    const bauble = give(g, 'alice', 'Bauble Lite', 'battlefield');
    expect(chars(g, g.objects[bauble]!).toughness).toBe(0);
  });

  it('Starfield of Nyx: only while you control five or more enchantments', () => {
    const g = main();
    give(g, 'alice', 'Starfield Lite', 'battlefield');
    const glyphs = [1, 2, 3].map(() => give(g, 'alice', 'Glyph', 'battlefield'));
    expect(chars(g, g.objects[glyphs[0]!]!).types.includes('Creature')).toBe(false);
    glyphs.push(give(g, 'alice', 'Glyph', 'battlefield'));
    const c = chars(g, g.objects[glyphs[0]!]!);
    expect([c.types.includes('Creature'), c.power]).toEqual([true, 3]);
  });
});
