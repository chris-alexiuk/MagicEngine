import { describe, expect, it } from 'vitest';
import { chars, hasKeyword, hasRule, power } from '../src/index.js';
import { give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Pacifist Totem', type_line: 'Enchantment', mana_cost: '{1}', oracle_text: 'Creatures your opponents control have "This creature can\'t block."' }),
  makeCard({ name: 'Mage Rod', type_line: 'Artifact — Equipment', mana_cost: '{1}', oracle_text: 'Equipped creature gets +1/+0, has "Whenever you cast a noncreature spell, this creature deals 1 damage to each opponent," and is a Wizard in addition to its other types.\nEquip {2}' }),
  makeCard({ name: 'Warded Host', type_line: 'Enchantment', mana_cost: '{1}', oracle_text: 'Other creatures you control have "Ward—Pay 2 life."' }),
];

describe('granted abilities (CR 113.1a / 613.1f)', () => {
  it('a granted static ability about the creature itself applies to it', () => {
    const g = toStep(start({ extra: CARDS }), 'main1');
    give(g, 'alice', 'Pacifist Totem', 'battlefield');
    const theirs = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const mine = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    expect(hasRule(g, g.objects[theirs]!, 'cant_block')).toBe(true);
    expect(hasRule(g, g.objects[mine]!, 'cant_block')).toBe(false);
  });

  it('“gets +1/+0, has "…," and is a Wizard in addition to its other types”', () => {
    const g = toStep(start({ extra: CARDS }), 'main1');
    const rod = give(g, 'alice', 'Mage Rod', 'battlefield');
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g.objects[rod]!.attachedTo = { id: bears, zcc: g.objects[bears]!.zcc };
    expect(power(g, g.objects[bears]!)).toBe(3);
    expect(chars(g, g.objects[bears]!).subtypes).toEqual(expect.arrayContaining(['Bear', 'Wizard']));
    expect(chars(g, g.objects[bears]!).keywords.some((k) => k.id === 'ability')).toBe(true);
  });

  it('a quoted keyword is that keyword', () => {
    const g = toStep(start({ extra: CARDS }), 'main1');
    give(g, 'alice', 'Warded Host', 'battlefield');
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    expect(hasKeyword(g, g.objects[bears]!, 'ward')).toBe(true);
  });
});
