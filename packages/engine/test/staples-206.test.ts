import { describe, expect, it } from 'vitest';
import { chars } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Dwellers Lite', type_line: 'Creature — Zombie', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "Whenever this creature attacks and isn't blocked, it gets +2/+0 until end of combat." }),
  makeCard({ name: 'Infantry Lite', type_line: 'Creature — Human Soldier', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "Whenever this creature attacks alone, this creature can't be blocked this combat." }),
  makeCard({ name: 'Fetter Lite', type_line: 'Creature — Spirit', mana_cost: '{0}', power: '3', toughness: '4', oracle_text: 'Flying\nAt the beginning of your upkeep, sacrifice this creature unless you pay {1} for each other creature you control.' }),
  makeCard({ name: 'Statue Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{0}: This artifact becomes a 3/6 Golem artifact creature until end of combat. Activate only during combat.' }),
  makeCard({ name: 'Sphere Lite', type_line: 'Creature — Shade', mana_cost: '{0}', power: '0', toughness: '1', oracle_text: 'At the beginning of your upkeep, put a +1/+1 counter on this creature, then sacrifice this creature unless you pay {1} for each +1/+1 counter on it.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const choose = (g: GameState, answer: Record<string, unknown>) => settle(act(g, { type: 'choose', player: (g.pending as { player: string }).player, answer } as never));
const main = () => toStep(start({ extra: CARDS }), 'main1', 'alice');
const attackWith = (g: GameState, attackers: string[]): GameState => {
  g = toStep(g, 'beginning_of_combat', 'alice');
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: attackers.map((attacker) => ({ attacker, target: { kind: 'player' as const, player: 'bob' } })) } });
};
const toBlocks = (g: GameState): GameState => {
  for (let i = 0; i < 40 && g.priority && g.step === 'declare_attackers' && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority });
  return g;
};

describe('slice 280 staples', () => {
  it('Murk Dwellers: +2/+0 until end of combat, gone by the second main phase (CR 511.3)', () => {
    let g = main();
    const dwellers = give(g, 'alice', 'Dwellers Lite', 'battlefield');
    g = toBlocks(attackWith(g, [dwellers]));
    if (g.pending) g = choose(g, { kind: 'declare_blockers', blocks: [] });
    g = settle(g);
    expect(chars(g, g.objects[dwellers]!).power).toBe(4);
    expect(g.players.bob!.life).toBe(20);
    for (let i = 0; i < 40 && g.step !== 'main2'; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    expect([g.step, g.players.bob!.life, chars(g, g.objects[dwellers]!).power]).toEqual(['main2', 16, 2]);
  });

  it("Yuan Shao's Infantry: unblockable only when it attacks alone", () => {
    for (const alone of [true, false]) {
      let g = main();
      const inf = give(g, 'alice', 'Infantry Lite', 'battlefield');
      const others = alone ? [] : [give(g, 'alice', 'Cub', 'battlefield')];
      const blocker = give(g, 'bob', 'Cub', 'battlefield');
      g = settle(toBlocks(attackWith(g, [inf, ...others])));
      for (let i = 0; i < 40 && g.priority && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority });
      const block = { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker, attacker: inf }] } } as never;
      if (alone) illegal(g, block);
      else act(g, block);
    }
  });

  it('Fettergeist: pay {1} for each other creature you control, or sacrifice it', () => {
    for (const others of [0, 2]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
      const spirit = give(g, 'alice', 'Fetter Lite', 'battlefield');
      for (let i = 0; i < others; i++) give(g, 'alice', 'Cub', 'battlefield');
      g = settle(toStep(g, 'upkeep', 'alice'));
      for (let i = 0; i < 4 && g.pending; i++) g = choose(g, { kind: 'pay', pay: others === 0 });
      expect(g.objects[spirit]!.zone).toBe(others === 0 ? 'battlefield' : 'graveyard');
    }
  });
  it('Jade Statue: a creature only until end of combat, and only activated during combat', () => {
    let g = main();
    const statue = give(g, 'alice', 'Statue Lite', 'battlefield');
    illegal(g, { type: 'activate', player: 'alice', object: statue, ability: 0 } as never);
    g = toStep(g, 'beginning_of_combat', 'alice');
    g = settle(act(g, { type: 'activate', player: 'alice', object: statue, ability: 0 } as never));
    expect([chars(g, g.objects[statue]!).types.includes('Creature'), chars(g, g.objects[statue]!).toughness]).toEqual([true, 6]);
    for (let i = 0; i < 40 && g.step !== 'main2'; i++) g = g.pending ? choose(g, { kind: 'declare_attackers', attacks: [] }) : settle(act(g, { type: 'pass', player: g.priority! }));
    expect(chars(g, g.objects[statue]!).types.includes('Creature')).toBe(false);
  });

  it('Phantasmal Sphere: the counter goes on first; paying spares only the sacrifice', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const sphere = give(g, 'alice', 'Sphere Lite', 'battlefield');
    g = settle(toStep(g, 'upkeep', 'alice'));
    for (let i = 0; i < 4 && g.pending; i++) g = choose(g, { kind: 'pay', pay: false });
    expect([g.objects[sphere]!.zone]).toEqual(['graveyard']);
  });
});
