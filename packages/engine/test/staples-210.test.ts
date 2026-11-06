import { describe, expect, it } from 'vitest';
import { chars } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}

const CARDS = [
  makeCard({ name: 'Opal Lite', type_line: 'Enchantment', mana_cost: '{2}{W}{W}', cmc: 4, oracle_text: 'Each other non-Aura enchantment is a creature in addition to its other types and has base power and base toughness each equal to its mana value.' }),
  makeCard({ name: 'March Lite', type_line: 'Enchantment', mana_cost: '{3}{U}', cmc: 4, oracle_text: 'Each noncreature artifact is an artifact creature with power and toughness each equal to its mana value.' }),
  makeCard({ name: 'Starfield Lite', type_line: 'Enchantment', mana_cost: '{3}{W}', cmc: 4, oracle_text: 'As long as you control five or more enchantments, each other non-Aura enchantment you control is a creature in addition to its other types and has base power and base toughness each equal to its mana value.' }),
  makeCard({ name: 'Glyph', type_line: 'Enchantment', mana_cost: '{1}{W}{W}', cmc: 3, oracle_text: '' }),
  makeCard({ name: 'Ring Lite', type_line: 'Artifact', mana_cost: '{2}', cmc: 2, oracle_text: '' }),
  makeCard({ name: 'Bauble Lite', type_line: 'Artifact', mana_cost: '{0}', cmc: 0, oracle_text: '' }),
  makeCard({ name: 'Altisaur Lite', type_line: 'Creature — Dinosaur', mana_cost: '{0}', power: '3', toughness: '4', oracle_text: 'If a source would deal damage to another Dinosaur you control, prevent all but 1 of that damage.' }),
  makeCard({ name: 'Raptor', type_line: 'Creature — Dinosaur', mana_cost: '{0}', power: '2', toughness: '5', oracle_text: '' }),
  makeCard({ name: 'Shock Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'This spell deals 3 damage to any target.' }),
  makeCard({ name: 'Major Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Copy target creature spell you control, except it isn't legendary if the spell is legendary." }),
  makeCard({ name: 'Hero Lite', type_line: 'Legendary Creature — Human', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
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
  it('Temple Altisaur: all but 1 damage to each other Dinosaur you control is prevented', () => {
    let g = main();
    const alt = give(g, 'alice', 'Altisaur Lite', 'battlefield');
    const raptor = give(g, 'alice', 'Raptor', 'battlefield');
    for (const t of [raptor, alt]) g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Shock Lite', 'hand'), targets: [[{ kind: 'object', object: t }]] } as never));
    expect([g.objects[raptor]!.damage, g.objects[alt]!.damage]).toEqual([1, 3]);
  });

  it('Double Major: the copy of a legendary creature spell isn\'t legendary', () => {
    let g = main();
    const hero = give(g, 'alice', 'Hero Lite', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: hero } as never);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Major Lite', 'hand'), targets: [[{ kind: 'object', object: hero }]] } as never));
    g = settle(g);
    const heroes = g.zones.battlefield.filter((id) => chars(g, g.objects[id]!).name === 'Hero Lite');
    expect(heroes.length).toBe(2);
    expect(heroes.map((id) => chars(g, g.objects[id]!).supertypes.includes('Legendary')).sort()).toEqual([false, true]);
  });
});
