import { describe, expect, it } from 'vitest';
import { hasKeyword, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Ghalta', type_line: 'Creature — Dinosaur', mana_cost: '{8}', power: '12', toughness: '12', oracle_text: 'This spell costs {X} less to cast, where X is the total power of creatures you control.' }),
  makeCard({ name: 'Anarcho', type_line: 'Creature — Goblin', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "Each spell you cast that's red or green costs {1} less to cast." }),
  makeCard({ name: 'Goreclaw', type_line: 'Creature — Bear', mana_cost: '{0}', power: '4', toughness: '3', oracle_text: 'Creature spells you cast with power 4 or greater cost {2} less to cast.' }),
  makeCard({ name: 'Pact', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever a creature you control dies, each other player sacrifices a creature of their choice.' }),
  makeCard({ name: 'Devil', type_line: 'Creature — Devil', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Whenever a player sacrifices a permanent, this creature deals 1 damage to any target.' }),
  makeCard({ name: 'Zone', type_line: 'Land', mana_cost: '', oracle_text: '{T}, Sacrifice this land: You may cast spells this turn as though they had flash.' }),
  makeCard({ name: 'Clock', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "Untap all artifacts you control during each other player's untap step." }),
  makeCard({ name: 'Sword', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equipped creature gets +2/+2 and has protection from black and from green.\nEquip {2}' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Brute', type_line: 'Creature — Ogre', mana_cost: '{4}', power: '5', toughness: '5', oracle_text: '' }),
  makeCard({ name: 'Bolt', type_line: 'Instant', mana_cost: '{1}{R}', oracle_text: 'Bolt deals 3 damage to any target.' }),
  makeCard({ name: 'Doom', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target creature.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 30 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const castable = (g: GameState, id: string) => legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === id);

describe('staples (slice 137)', () => {
  it('Ghalta: {X} less, where X is the total power of creatures you control', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ghalta = give(g, 'alice', 'Ghalta', 'hand');
    g.players.alice!.pool.G = 3;
    expect(castable(g, ghalta)).toBe(false);
    give(g, 'alice', 'Brute', 'battlefield');
    expect(castable(g, ghalta)).toBe(true);
  });

  it('Goblin Anarchomancer and Goreclaw', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Anarcho', 'battlefield');
    const bolt = give(g, 'alice', 'Bolt', 'hand');
    g.players.alice!.pool.R = 1;
    expect(castable(g, bolt)).toBe(true);
    g.players.alice!.pool.R = 0;
    give(g, 'alice', 'Goreclaw', 'battlefield');
    const brute = give(g, 'alice', 'Brute', 'hand');
    g.players.alice!.pool.C = 2;
    expect(castable(g, brute)).toBe(true);
    const bear = give(g, 'alice', 'Bear', 'hand');
    g.players.alice!.pool.C = 1;
    expect(castable(g, bear)).toBe(false);
  });

  it('Grave Pact and Mayhem Devil', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Pact', 'battlefield');
    give(g, 'bob', 'Devil', 'battlefield');
    const mine = give(g, 'alice', 'Bear', 'battlefield');
    const theirs = give(g, 'bob', 'Bear', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Doom', 'hand'), targets: [[{ kind: 'object', object: mine }]] });
    for (let i = 0; i < 40 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'sacrifice') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'sacrifice', objects: [theirs] } });
      else if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'alice' }]] } });
      else if (!g.pending) g = act(g, { type: 'pass', player: g.priority! });
      else break;
    }
    expect(g.objects[theirs]!.zone).toBe('graveyard');
    expect(g.players.alice!.life).toBe(19);
  });

  it('Emergence Zone: sorcery-speed spells at instant speed this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const zone = give(g, 'alice', 'Zone', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: zone, ability: 0 }));
    const bear = give(g, 'alice', 'Bear', 'hand');
    g.players.alice!.pool.G = 2;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Doom', 'hand'), targets: [[{ kind: 'object', object: give(g, 'bob', 'Bear', 'battlefield') }]] });
    expect(castable(g, bear)).toBe(true);
  });

  it('Unwinding Clock and protection from two colors', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Clock', 'battlefield');
    const sword = give(g, 'alice', 'Sword', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g.objects[sword]!.attachedTo = { id: bear, zcc: g.objects[bear]!.zcc };
    expect(hasKeyword(g, g.objects[bear]!, 'protection')).toBe(true);
    g.objects[sword]!.tapped = true;
    g = toStep(g, 'main1', 'bob');
    expect(g.objects[sword]!.tapped).toBe(false);
  });
});

describe('"four target cards from a single graveyard" (default targets)', () => {
  it('only offered when one graveyard has enough', () => {
    const MORE = [makeCard({ name: 'Cauldron', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}: Exile four target cards from a single graveyard.' })];
    const g = toStep(start({ extra: [...CARDS, ...MORE] }), 'main1', 'alice');
    const cauldron = give(g, 'alice', 'Cauldron', 'battlefield');
    for (let i = 0; i < 2; i++) give(g, 'alice', 'Bear', 'graveyard');
    for (let i = 0; i < 3; i++) give(g, 'bob', 'Bear', 'graveyard');
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === cauldron)).toBe(false);
    give(g, 'bob', 'Bear', 'graveyard');
    const a = legalActions(g, 'alice').find((x) => x.type === 'activate' && x.object === cauldron) as { targets: { object: string }[][] };
    expect(a.targets[0]!.map((t) => g.objects[t.object]!.owner)).toEqual(['bob', 'bob', 'bob', 'bob']);
  });
});
