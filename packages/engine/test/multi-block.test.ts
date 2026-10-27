import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Grizzly', type_line: 'Creature — Bear', oracle_text: '', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2' }),
  makeCard({ name: 'Double Wall', type_line: 'Creature — Wall', oracle_text: 'This creature can block an additional creature each combat.', mana_cost: '{2}', cmc: 2, power: '2', toughness: '5' }),
  makeCard({ name: 'Hydra Wall', type_line: 'Creature — Wall', oracle_text: 'This creature can block any number of creatures.', mana_cost: '{2}', cmc: 2, power: '0', toughness: '9' }),
];

function toBlocks(g: GameState, attackers: string[]): GameState {
  g = toStep(g, 'beginning_of_combat');
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: attackers.map((attacker) => ({ attacker, target: { kind: 'player' as const, player: 'bob' } })) } });
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return g;
}

describe('CR 509.1a: blocking more than one attacker', () => {
  it('“can block an additional creature each combat” — and its controller divides its damage (CR 510.1d)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const a = give(g, 'alice', 'Grizzly', 'battlefield');
    const b = give(g, 'alice', 'Grizzly', 'battlefield');
    const c = give(g, 'alice', 'Grizzly', 'battlefield');
    const wall = give(g, 'bob', 'Double Wall', 'battlefield');
    g = toBlocks(g, [a, b, c]);
    expect(() => act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [a, b, c].map((attacker) => ({ blocker: wall, attacker })) } })).toThrow(/that many/);
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: wall, attacker: a }, { blocker: wall, attacker: b }] } });
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    expect(g.pending).toMatchObject({ kind: 'assign_combat_damage', player: 'bob', choices: [{ attacker: wall, power: 2, blockers: [a, b] }] });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'assign_combat_damage', assignments: { [wall]: [{ to: { kind: 'permanent', object: b }, amount: 2 }] } } });
    expect(g.objects[b]!.zone).toBe('graveyard');
    expect(g.objects[a]!.zone).toBe('battlefield');
    expect(g.objects[wall]!.damage).toBe(4);
    expect(g.players.bob!.life).toBe(18);
  });

  it('“can block any number of creatures”', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const ids = [1, 2, 3, 4].map(() => give(g, 'alice', 'Grizzly', 'battlefield'));
    const wall = give(g, 'bob', 'Hydra Wall', 'battlefield');
    g = toBlocks(g, ids);
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: ids.map((attacker) => ({ blocker: wall, attacker })) } });
    g = toStep(g, 'main2');
    expect(g.players.bob!.life).toBe(20);
    expect(g.objects[wall]!.zone).toBe('battlefield');
  });
});
