import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Hammer Lite', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Whenever equipped creature attacks, tap target creature defending player controls and put a stun counter on it. Then this Equipment deals damage to each opponent equal to the number of tapped creatures that opponent controls.\nEquip {0}' }),
];

describe('slice 288 staples', () => {
  it("Mjölnir: damage to each opponent equal to the tapped creatures that opponent controls", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cub = give(g, 'alice', 'Cub', 'battlefield', { sick: false });
    const hammer = give(g, 'alice', 'Hammer Lite', 'battlefield');
    g = act(g, { type: 'activate', player: 'alice', object: hammer, ability: 0, targets: [[{ kind: 'object', object: cub }]] } as never);
    for (let i = 0; i < 10 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.objects[hammer]!.attachedTo?.id).toBe(cub);
    const [a, b] = [give(g, 'bob', 'Cub', 'battlefield'), give(g, 'bob', 'Cub', 'battlefield')];
    g.objects[a]!.tapped = true;
    g = toStep(g, 'beginning_of_combat', 'alice');
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: cub, target: { kind: 'player', player: 'bob' } }] } });
    if (g.pending) g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: b }]] } } as never);
    for (let i = 0; i < 10 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect([g.objects[b]!.tapped, g.objects[b]!.counters.stun, g.players.bob!.life]).toEqual([true, 1, 18]);
  });
});
