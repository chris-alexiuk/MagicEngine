import { describe, expect, it } from 'vitest';
import { hasType, legalActions, power } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Lizard Blade', type_line: 'Artifact Creature — Equipment Lizard', mana_cost: '{1}{R}', power: '1', toughness: '1', oracle_text: 'Double strike\nEquipped creature has double strike.\nReconfigure {2}' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
];

describe('CR 702.151: reconfigure', () => {
  it('attaches as a sorcery, stops being a creature while attached, and unattaches', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const blade = give(g, 'alice', 'Lizard Blade', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 };
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === blade && a.ability === 0)).toBe(true);
    // The unattach ability needs it to be attached.
    expect(() => act(g, { type: 'activate', player: 'alice', object: blade, ability: 1 })).toThrow();
    g = act(g, { type: 'activate', player: 'alice', object: blade, ability: 0, targets: [[{ kind: 'object', object: bear }]] });
    while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.objects[blade]!.attachedTo?.id).toBe(bear);
    expect(hasType(g, g.objects[blade]!, 'Creature')).toBe(false);
    expect(hasType(g, g.objects[blade]!, 'Artifact')).toBe(true);
    expect(power(g, g.objects[bear]!)).toBe(2);
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 };
    g = act(g, { type: 'activate', player: 'alice', object: blade, ability: 1 });
    while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.objects[blade]!.attachedTo).toBeUndefined();
    expect(hasType(g, g.objects[blade]!, 'Creature')).toBe(true);
  });
});
