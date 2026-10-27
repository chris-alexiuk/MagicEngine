import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Cavern', type_line: 'Land', mana_cost: '', oracle_text: "As this land enters, choose a creature type.\n{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type, and that spell can't be countered." }),
  makeCard({ name: 'Elf', type_line: 'Creature — Elf', mana_cost: '{G}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Goblin', type_line: 'Creature — Goblin', mana_cost: '{R}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Nope', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Counter target spell.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 30 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}

describe('mana riders (CR 106.6)', () => {
  it('Cavern of Souls: only for the chosen type, and that spell can\'t be countered', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cavern = give(g, 'alice', 'Cavern', 'battlefield');
    g.objects[cavern]!.chosen = { creatureType: 'Elf' };
    g = act(g, { type: 'activate_mana', player: 'alice', object: cavern, ability: 1, choice: 'G' });
    const goblin = give(g, 'alice', 'Goblin', 'hand');
    g.players.alice!.restricted![0]!.color = 'R';
    expect(illegal(g, { type: 'cast', player: 'alice', object: goblin })).toMatch(/mana/i);
    g.players.alice!.restricted![0]!.color = 'G';
    const elf = give(g, 'alice', 'Elf', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: elf });
    g = act(g, { type: 'pass', player: 'alice' });
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Nope', 'hand'), targets: [[{ kind: 'object', object: elf }]] }));
    expect(g.objects[elf]!.zone).toBe('battlefield');
  });
});

describe('"When that mana is spent to cast …" (Path of Ancestry)', () => {
  const MORE = [
    makeCard({ name: 'Path', type_line: 'Land', mana_cost: '', oracle_text: "{T}: Add one mana of any color in your commander's color identity. When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1." }),
    makeCard({ name: 'Elf Lord', type_line: 'Legendary Creature — Elf Druid', mana_cost: '{G}', color_identity: ['G'], power: '1', toughness: '1', oracle_text: '' }),
    makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{G}', power: '1', toughness: '1', oracle_text: '' }),
  ];
  const deck = [...Array(95).fill('Forest'), 'Path', 'Elf', 'Ogre', 'Elf Lord'];
  it('triggers only for a creature spell sharing a type with your commander', () => {
    let g = toStep(start({ format: 'commander', extra: [...CARDS, ...MORE], decks: { alice: deck, bob: deck.map((c) => (c === 'Elf Lord' ? 'Forest' : c)) }, commanders: { alice: ['Elf Lord'] } }), 'main1', 'alice');
    const path = give(g, 'alice', 'Path', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: path, ability: 0, choice: 'G' });
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ogre', 'hand') });
    expect(g.stack).toHaveLength(1);
    g = settle(g);
    g.objects[path]!.tapped = false;
    g = act(g, { type: 'activate_mana', player: 'alice', object: path, ability: 0, choice: 'G' });
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Elf', 'hand') });
    expect(g.stack).toHaveLength(2);
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.pending).toMatchObject({ kind: 'scry' });
  });
});
