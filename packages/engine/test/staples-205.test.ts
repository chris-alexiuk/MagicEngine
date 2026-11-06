import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Brute', type_line: 'Creature — Ogre', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Grove', type_line: 'Enchantment', mana_cost: '{G}', oracle_text: '' }),
  makeCard({ name: 'Peak Lite', type_line: 'Land — Mountain', mana_cost: '', oracle_text: '({T}: Add {R}.)' }),
  makeCard({ name: 'Crasher Lite', type_line: 'Creature — Elemental', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: "Trample\nThis creature can't attack unless there is a Mountain on the battlefield." }),
  makeCard({ name: 'Mutant Lite', type_line: 'Creature — Goblin Mutant', mana_cost: '{0}', power: '5', toughness: '3', oracle_text: "Trample\nThis creature can't attack if defending player controls an untapped creature with power 3 or greater.\nThis creature can't block creatures with power 3 or greater." }),
  makeCard({ name: 'Brawlers Lite', type_line: 'Creature — Human Warrior', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: "This creature can't attack if defending player controls an untapped land.\nThis creature can't block if you control an untapped land." }),
  makeCard({ name: 'Callous Lite', type_line: 'Creature — Giant', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: 'If a source would deal 3 or less damage to this creature, prevent that damage.' }),
  makeCard({ name: 'Shock Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'This spell deals 3 damage to any target.' }),
  makeCard({ name: 'Blast Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'This spell deals 4 damage to any target.' }),
  makeCard({ name: 'Prosper Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Double your life total. Draw cards equal to the number of cards in your hand. You have no maximum hand size until your next turn.' }),
  makeCard({ name: 'Leecher Lite', type_line: 'Creature — Elemental', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{0}, {T}: Remove a -1/-1 counter from target creature. If you do, you gain 2 life.' }),
  makeCard({ name: 'Yeti Lite', type_line: 'Creature — Yeti', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: 'As long as you control a green or blue permanent, you may cast this spell as though it had flash.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const main = () => toStep(start({ extra: CARDS }), 'main1', 'alice');
const toAttackers = (g: GameState): GameState => {
  g = toStep(g, 'beginning_of_combat', 'alice');
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return g;
};
const attack = (id: string) => ({ type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: id, target: { kind: 'player', player: 'bob' } }] } }) as never;
const cast = (g: GameState, who: string, name: string, extra: Record<string, unknown> = {}) => settle(act(g, { type: 'cast', player: who, object: give(g, who, name, 'hand'), ...extra } as never));
const target = (id: string) => ({ targets: [[{ kind: 'object', object: id }]] });

describe('slice 279 staples', () => {
  it('Glacial Crasher: attacks only while a Mountain is on the battlefield — anyone’s', () => {
    let g = main();
    const crasher = give(g, 'alice', 'Crasher Lite', 'battlefield');
    illegal(toAttackers(g), attack(crasher));
    give(g, 'bob', 'Peak Lite', 'battlefield');
    act(toAttackers(g), attack(crasher));
  });

  it('Goblin Mutant and Branded Brawlers: no attack while the defender has an untapped creature with power 3+ / land', () => {
    let g = main();
    const mutant = give(g, 'alice', 'Mutant Lite', 'battlefield');
    const brute = give(g, 'bob', 'Brute', 'battlefield');
    illegal(toAttackers(g), attack(mutant));
    g.objects[brute]!.tapped = true;
    act(toAttackers(g), attack(mutant));

    let h = main();
    const brawlers = give(h, 'alice', 'Brawlers Lite', 'battlefield');
    const land = give(h, 'bob', 'Peak Lite', 'battlefield');
    illegal(toAttackers(h), attack(brawlers));
    h.objects[land]!.tapped = true;
    act(toAttackers(h), attack(brawlers));
  });

  it('Branded Brawlers: can’t block while you control an untapped land', () => {
    for (const untapped of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
      const brawlers = give(g, 'alice', 'Brawlers Lite', 'battlefield');
      const land = give(g, 'alice', 'Peak Lite', 'battlefield');
      g.objects[land]!.tapped = !untapped;
      const cub = give(g, 'bob', 'Cub', 'battlefield');
      g = toStep(g, 'beginning_of_combat', 'bob');
      while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
      g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: cub, target: { kind: 'player', player: 'alice' } }] } });
      for (let i = 0; i < 40 && g.priority && g.step === 'declare_attackers' && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority });
      const asked = (g.pending as { kind?: string } | undefined)?.kind === 'declare_blockers';
      const block = { type: 'choose', player: 'alice', answer: { kind: 'declare_blockers', blocks: [{ blocker: brawlers, attacker: cub }] } } as never;
      // With an untapped land it has no legal block, so either the engine doesn't ask or it refuses the block.
      if (untapped) expect(!asked || Boolean(illegal(g, block))).toBe(true);
      else expect(asked && act(g, block)).toBeTruthy();
    }
  });

  it('Callous Giant: prevents damage of 3 or less from a source, not 4', () => {
    let g = main();
    const giant = give(g, 'alice', 'Callous Lite', 'battlefield');
    g = cast(g, 'alice', 'Shock Lite', target(giant));
    expect(g.objects[giant]!.damage ?? 0).toBe(0);
    g = cast(g, 'alice', 'Blast Lite', target(giant));
    expect(g.objects[giant]!.zone).toBe('graveyard');
  });

  it('Live Long and Prosper: double life, draw a hand’s worth, no maximum hand size until your next turn', () => {
    let g = main();
    const before = g.zones.hand.alice!.length;
    g = cast(g, 'alice', 'Prosper Lite');
    expect([g.players.alice!.life, g.zones.hand.alice!.length]).toEqual([40, before * 2]);
    g = toStep(g, 'upkeep', 'bob');
    expect(g.zones.hand.alice!.length).toBe(before * 2);
  });

  it('Woeleecher: gains life only if a -1/-1 counter was removed', () => {
    let g = main();
    const leecher = give(g, 'alice', 'Leecher Lite', 'battlefield');
    const brute = give(g, 'bob', 'Brute', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: leecher, ability: 0, ...target(brute) } as never));
    expect(g.players.alice!.life).toBe(20);
    g.objects[leecher]!.tapped = false;
    g.objects[brute]!.counters['-1/-1'] = 2;
    g = settle(act(g, { type: 'activate', player: 'alice', object: leecher, ability: 0, ...target(brute) } as never));
    expect([g.players.alice!.life, g.objects[brute]!.counters['-1/-1']]).toEqual([22, 1]);
  });

  it('Hungering Yeti: flash only while you control a green or blue permanent', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Cub', 'hand') } as never);
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.priority).toBe('alice');
    illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Yeti Lite', 'hand') } as never);
    give(g, 'alice', 'Grove', 'battlefield');
    g = cast(g, 'alice', 'Yeti Lite');
    expect(g.zones.battlefield.some((id) => g.objects[id]!.card === 'Yeti Lite' || (g.objects[id] as { name?: string }).name === 'Yeti Lite')).toBe(true);
  });
});
