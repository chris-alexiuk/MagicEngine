import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Relentless Lite', type_line: 'Creature — Human', oracle_text: 'Whenever this creature attacks for the first time each turn, untap it. After this phase, there is an additional combat phase.', mana_cost: '{0}', power: '3', toughness: '3' }),
  makeCard({ name: 'Seize Lite', type_line: 'Sorcery', oracle_text: 'After this main phase, there is an additional combat phase followed by an additional main phase.', mana_cost: '{0}' }),
];

function attackWith(g: GameState, id: string): GameState {
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  expect(g.pending?.kind).toBe('declare_attackers');
  g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: id, target: { kind: 'player', player: 'bob' } }] } });
  return g;
}
const passTo = (g: GameState, step: string) => {
  for (let i = 0; i < 100 && !(g.step === step && g.priority); i++) {
    if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks: [] } });
    else if (g.pending) break;
    else g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
};

describe('CR 500.8: additional combat phases', () => {
  it('“attacks for the first time each turn … After this phase, there is an additional combat phase.”', () => {
    let g = toStep(start({ extra: CARDS }), 'beginning_of_combat');
    const r = give(g, 'alice', 'Relentless Lite', 'battlefield');
    g = attackWith(g, r);
    g = passTo(g, 'end_of_combat');
    expect(g.players.bob!.life).toBe(17);
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    // Another combat, and it can attack again (it untapped); no third.
    expect(g.step).toBe('beginning_of_combat');
    g = attackWith(g, r);
    g = passTo(g, 'main2');
    expect(g.players.bob!.life).toBe(14);
    g = passTo(g, 'end');
    expect(g.step).toBe('end');
  });

  it('“After this main phase, there is an additional combat phase followed by an additional main phase.”', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Seize Lite', 'hand') });
    g = act(act(g, { type: 'pass', player: 'alice' }), { type: 'pass', player: 'bob' });
    const steps: string[] = [];
    for (let i = 0; i < 40 && g.step !== 'end'; i++) {
      if (g.priority && steps[steps.length - 1] !== g.step) steps.push(g.step);
      if (g.pending?.kind === 'declare_attackers') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [] } });
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(steps).toEqual(['main1', 'beginning_of_combat', 'declare_attackers', 'end_of_combat', 'main2', 'beginning_of_combat', 'declare_attackers', 'end_of_combat', 'main2']);
  });
});
