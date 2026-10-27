import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Prison', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you." }),
  makeCard({ name: 'Grizzly Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
];

function toAttackers(g: GameState): GameState {
  for (let i = 0; i < 20 && g.pending?.kind !== 'declare_attackers'; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}

describe('CR 508.1g–h: costs to attack', () => {
  it('Ghostly Prison: {2} for each creature attacking you; refused if it can\'t be paid', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'bob', 'Prison', 'battlefield');
    const a = give(g, 'alice', 'Grizzly Cub', 'battlefield', { sick: false });
    const b = give(g, 'alice', 'Grizzly Cub', 'battlefield', { sick: false });
    for (let i = 0; i < 3; i++) give(g, 'alice', 'Forest', 'battlefield');
    g = toAttackers(g);
    const both = { type: 'choose' as const, player: 'alice', answer: { kind: 'declare_attackers' as const, attacks: [a, b].map((attacker) => ({ attacker, target: { kind: 'player' as const, player: 'bob' } })) } };
    expect(illegal(g, both)).toMatch(/costs \{2\}\{2\}/);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: a, target: { kind: 'player', player: 'bob' } }] } });
    const tapped = g.zones.battlefield.filter((id) => g.objects[id]!.owner === 'alice' && g.cards[g.objects[id]!.card]!.name === 'Forest' && g.objects[id]!.tapped);
    expect(tapped.length).toBe(2);
    expect(g.combat?.attackers[a]).toBeDefined();
  });
});
