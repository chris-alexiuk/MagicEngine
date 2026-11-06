import { describe, expect, it } from 'vitest';
import { chars } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Ox', type_line: 'Creature — Ox', mana_cost: '{0}', power: '1', toughness: '4', oracle_text: '' }),
  makeCard({ name: 'Snow Ox', type_line: 'Snow Creature — Ox', mana_cost: '{0}', power: '1', toughness: '4', oracle_text: '' }),
  makeCard({ name: 'Red Relic', type_line: 'Artifact', mana_cost: '{R}', oracle_text: '' }),
  makeCard({ name: 'Furrier Lite', type_line: 'Creature — Goblin', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Prevent all damage that this creature would deal to snow creatures.' }),
  makeCard({ name: 'Cyclops Lite', type_line: 'Creature — Cyclops', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: 'This creature gets -2/-0 as long as two or more creatures are blocking it.' }),
  makeCard({ name: 'Zealots Lite', type_line: 'Creature — Human Soldier', mana_cost: '{W}', power: '2', toughness: '2', oracle_text: 'At the beginning of your upkeep, if all nonland permanents you control are white, you gain 1 life.' }),
  makeCard({ name: 'Armodon Lite', type_line: 'Creature — Elephant', mana_cost: '{0}', power: '4', toughness: '5', oracle_text: 'When you control a creature with toughness 2 or less, sacrifice this creature.' }),
  makeCard({ name: 'Djinn Lite', type_line: 'Creature — Djinn', mana_cost: '{2}{U}{U}', power: '5', toughness: '6', oracle_text: 'Flying\nThis creature gets -2/-2 as long as blue is the most common color among all permanents or is tied for most common.' }),
  makeCard({ name: 'Grove', type_line: 'Enchantment', mana_cost: '{G}', oracle_text: '' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const main = () => toStep(start({ extra: CARDS }), 'main1', 'alice');

describe('slice 281 staples', () => {
  it('Goblin Furrier: deals no damage to snow creatures, full damage to others', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const furrier = give(g, 'alice', 'Furrier Lite', 'battlefield');
    const [snow, plain] = [give(g, 'bob', 'Snow Ox', 'battlefield'), give(g, 'bob', 'Ox', 'battlefield')];
    g = toStep(g, 'beginning_of_combat', 'bob');
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [snow, plain].map((attacker) => ({ attacker, target: { kind: 'player' as const, player: 'alice' } })) } });
    for (let i = 0; i < 40 && g.priority && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_blockers', blocks: [{ blocker: furrier, attacker: snow }] } });
    for (let i = 0; i < 40 && g.step !== 'end_of_combat' && g.priority && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority });
    expect(g.objects[snow]!.damage ?? 0).toBe(0);

    let h = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const f2 = give(h, 'alice', 'Furrier Lite', 'battlefield');
    const ox = give(h, 'bob', 'Ox', 'battlefield');
    h = toStep(h, 'beginning_of_combat', 'bob');
    while (!h.pending && h.priority) h = act(h, { type: 'pass', player: h.priority });
    h = act(h, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: ox, target: { kind: 'player' as const, player: 'alice' } }] } });
    for (let i = 0; i < 40 && h.priority && !h.pending; i++) h = act(h, { type: 'pass', player: h.priority });
    h = act(h, { type: 'choose', player: 'alice', answer: { kind: 'declare_blockers', blocks: [{ blocker: f2, attacker: ox }] } });
    for (let i = 0; i < 40 && h.step !== 'end_of_combat' && h.priority && !h.pending; i++) h = act(h, { type: 'pass', player: h.priority });
    expect(h.objects[ox]!.damage ?? 0).toBe(2);
  });

  it('Rampaging Cyclops: -2/-0 while two or more creatures block it', () => {
    let g = main();
    const cyc = give(g, 'alice', 'Cyclops Lite', 'battlefield');
    const blockers = [give(g, 'bob', 'Ox', 'battlefield'), give(g, 'bob', 'Ox', 'battlefield')];
    g = toStep(g, 'beginning_of_combat', 'alice');
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: cyc, target: { kind: 'player' as const, player: 'bob' } }] } });
    expect(chars(g, g.objects[cyc]!).power).toBe(4);
    for (let i = 0; i < 40 && g.priority && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: blockers.map((blocker) => ({ blocker, attacker: cyc })) } });
    expect(chars(g, g.objects[cyc]!).power).toBe(2);
  });

  it('Zealots en-Dal: life only while every nonland permanent you control is white', () => {
    for (const red of [false, true]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
      give(g, 'alice', 'Zealots Lite', 'battlefield');
      if (red) give(g, 'alice', 'Red Relic', 'battlefield');
      g = settle(toStep(g, 'upkeep', 'alice'));
      for (let i = 0; i < 10 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
      expect(g.players.alice!.life).toBe(red ? 20 : 21);
    }
  });

  it('Endangered Armodon: sacrificed once you control a creature with toughness 2 or less (CR 603.8)', () => {
    let g = main();
    const armodon = give(g, 'alice', 'Armodon Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ox', 'hand') } as never));
    expect(g.objects[armodon]!.zone).toBe('battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Cub', 'hand') } as never));
    g = settle(g);
    expect(g.objects[armodon]!.zone).toBe('graveyard');
  });
  it('Zanam Djinn: -2/-2 while blue is the most common color among all permanents, ties included', () => {
    const g = main();
    const djinn = give(g, 'alice', 'Djinn Lite', 'battlefield');
    const pt = () => [chars(g, g.objects[djinn]!).power, chars(g, g.objects[djinn]!).toughness];
    expect(pt()).toEqual([3, 4]);
    give(g, 'bob', 'Grove', 'battlefield');
    expect(pt()).toEqual([3, 4]);
    give(g, 'bob', 'Grove', 'battlefield');
    expect(pt()).toEqual([5, 6]);
  });
});
