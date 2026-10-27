import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Phaser', type_line: 'Creature — Spirit', oracle_text: 'Phasing', mana_cost: '{0}', power: '2', toughness: '2' }),
  makeCard({ name: 'Blink Out', type_line: 'Instant', oracle_text: 'Target creature phases out.', mana_cost: '{0}' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', oracle_text: '', mana_cost: '{0}', power: '2', toughness: '2' }),
  makeCard({ name: 'Bear Aura', type_line: 'Enchantment — Aura', oracle_text: 'Enchant creature\nEnchanted creature gets +1/+1.', mana_cost: '{0}' }),
];
const settle = (g: GameState) => {
  while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
  return g;
};

describe('CR 702.26: phasing', () => {
  it('a phased-out permanent is treated as though it doesn’t exist, and phases in (with its Aura) at its controller’s untap step', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const aura = give(g, 'alice', 'Bear Aura', 'battlefield');
    g.objects[aura]!.attachedTo = { id: bear, zcc: g.objects[bear]!.zcc };
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Blink Out', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.zones.battlefield.includes(bear)).toBe(false);
    expect(g.zones.battlefield.includes(aura)).toBe(false);
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.objects[aura]!.phasedOut).toBe('indirectly');
    g = toStep(g, 'upkeep', 'bob');
    expect(g.zones.battlefield.includes(bear)).toBe(false);
    g = toStep(g, 'upkeep', 'alice');
    expect(g.zones.battlefield.includes(bear)).toBe(true);
    expect(g.zones.battlefield.includes(aura)).toBe(true);
    expect(g.objects[aura]!.attachedTo?.id).toBe(bear);
  });

  it('the Phasing keyword: out on one untap step, in on the next', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const p = give(g, 'alice', 'Phaser', 'battlefield');
    g = toStep(g, 'upkeep', 'bob');
    g = toStep(g, 'upkeep', 'alice');
    expect(g.objects[p]!.phasedOut).toBe('directly');
    g = toStep(g, 'upkeep', 'bob');
    g = toStep(g, 'upkeep', 'alice');
    expect(g.objects[p]!.phasedOut).toBeUndefined();
    expect(g.zones.battlefield.includes(p)).toBe(true);
  });
});
