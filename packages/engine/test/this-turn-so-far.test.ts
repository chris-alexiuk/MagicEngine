import { describe, expect, it } from 'vitest';
import { chars, type Action, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

/**
 * CR 608.2h: an effect asks what it needs as it is carried out — so "this turn" includes what the spell or ability
 * itself has just done. "You gain 2 life. Each creature gets -X/-X until end of turn, where X is the amount of life you
 * gained this turn" counts those 2. (These four cards were graded fully automatic and counted the turn as it stood
 * before they resolved. The same for what died or left the battlefield is in happened.test.ts.)
 */
const CARDS = [
  makeCard({ name: 'Essence Pulse', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'You gain 2 life. Each creature gets -X/-X until end of turn, where X is the amount of life you gained this turn.' }),
  makeCard({ name: 'Fortifying Draught', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'You gain 2 life. Target creature gets +X/+X until end of turn, where X is the amount of life you gained this turn.' }),
  makeCard({ name: "Nightmare's Thirst", type_line: 'Instant', mana_cost: '{0}', oracle_text: 'You gain 1 life. Target creature gets -X/-X until end of turn, where X is the amount of life you gained this turn.' }),
  makeCard({ name: 'Blossoming Bogbeast', type_line: 'Creature — Beast', mana_cost: '{4}{G}', cmc: 5, power: '3', toughness: '3', oracle_text: 'Whenever this creature attacks, you gain 2 life. Then creatures you control gain trample and get +X/+X until end of turn, where X is the amount of life you gained this turn.' }),
  makeCard({ name: 'Tonic', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'You gain 3 life.' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{2}{R}', cmc: 3, power: '4', toughness: '4', oracle_text: '' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const main = (): GameState => toStep(start({ extra: CARDS }), 'main1', 'alice');
const at = (object: string) => [[{ kind: 'object' as const, object }]];
const cast = (g: GameState, name: string, more: Partial<Extract<Action, { type: 'cast' }>> = {}) => settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), ...more }));
const size = (g: GameState, id: string) => (g.objects[id]!.zone === 'battlefield' ? [chars(g, g.objects[id]!).power, chars(g, g.objects[id]!).toughness] : g.objects[id]!.zone);

describe('"the amount of life you gained this turn", asked by the spell that has just gained some', () => {
  it('every card here reads in full', () => {
    expect(CARDS.filter((c) => c.automation !== 'full').map((c) => c.name)).toEqual([]);
  });

  it('Essence Pulse: each creature gets -2/-2 for the 2 life it gained', () => {
    let g = main();
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    g = cast(g, 'Essence Pulse');
    expect([size(g, bear), size(g, ogre)]).toEqual(['graveyard', [2, 2]]);
  });

  it('Fortifying Draught and Nightmare\'s Thirst: with the life gained earlier in the turn', () => {
    let g = main();
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = cast(g, 'Fortifying Draught', { targets: at(bear) });
    expect(size(g, bear)).toEqual([4, 4]);
    let h = main();
    const ogre = give(h, 'bob', 'Ogre', 'battlefield');
    h = cast(h, 'Tonic');
    h = cast(h, "Nightmare's Thirst", { targets: at(ogre) });
    // 3 earlier and 1 now: -4/-4.
    expect(size(h, ogre)).toBe('graveyard');
    // Bob's life gain isn't hers.
    let k = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const other = give(k, 'alice', 'Ogre', 'battlefield');
    k = settle(act(k, { type: 'cast', player: 'bob', object: give(k, 'bob', 'Tonic', 'hand') }));
    k = act(k, { type: 'pass', player: 'bob' });
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', "Nightmare's Thirst", 'hand'), targets: at(other) }));
    expect(size(k, other)).toEqual([3, 3]);
  });

  it('Blossoming Bogbeast: "you gain 2 life. Then creatures you control … get +X/+X"', () => {
    let g = main();
    const beast = give(g, 'alice', 'Blossoming Bogbeast', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = toStep(g, 'beginning_of_combat', 'alice');
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: beast, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 10 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect([size(g, beast), size(g, bear)]).toEqual([[5, 5], [4, 4]]);
  });
});
