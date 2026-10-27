import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({
    name: 'Protection Spell',
    type_line: 'Instant',
    mana_cost: '{0}',
    oracle_text: "Until your next turn, your life total can't change and you gain protection from everything. All permanents you control phase out.\nExile Protection Spell.",
  }),
  makeCard({ name: 'Zap', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Zap deals 3 damage to any target.' }),
  makeCard({ name: 'Drain', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each opponent loses 2 life.' }),
  makeCard({ name: 'Rhythm', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Creature spells you control can't be countered." }),
  makeCard({ name: 'Negate It', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Counter target spell.' }),
  makeCard({ name: 'Provisioner', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Create a Food token or a Treasure token.' }),
  makeCard({ name: 'Channel Land', type_line: 'Legendary Land', mana_cost: '', oracle_text: 'Channel — {2}, Discard this card: Draw a card. This ability costs {1} less to activate for each legendary creature you control.' }),
  makeCard({ name: 'Legend', type_line: 'Legendary Creature — Human', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Grizzly Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
];

function passBoth(g: GameState): GameState {
  g = act(g, { type: 'pass', player: g.priority! });
  return act(g, { type: 'pass', player: g.priority! });
}

describe('CR 702.16j / 119.8: protection from everything and a life total that can\'t change', () => {
  it("Teferi's Protection until your next turn", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cub = give(g, 'alice', 'Grizzly Cub', 'battlefield');
    g = passBoth(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Protection Spell', 'hand') }));
    expect(g.objects[cub]!.phasedOut).toBeTruthy();
    g = toStep(g, 'main1', 'bob');
    const zap = give(g, 'bob', 'Zap', 'hand');
    expect(illegal(g, { type: 'cast', player: 'bob', object: zap, targets: [[{ kind: 'player', player: 'alice' }]] })).toMatch(/legal target/);
    g = passBoth(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Drain', 'hand') }));
    expect(g.players.alice!.life).toBe(20);
    g = toStep(g, 'main1', 'alice');
    g = passBoth(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Drain', 'hand') }));
    expect(g.players.bob!.life).toBe(18);
    g = toStep(g, 'main1', 'bob');
    g = passBoth(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Drain', 'hand') }));
    expect(g.players.alice!.life).toBe(18);
  });

  it('"Creature spells you control can\'t be countered."', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Rhythm', 'battlefield');
    const cub = give(g, 'alice', 'Grizzly Cub', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: cub });
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Negate It', 'hand'), targets: [[{ kind: 'object', object: cub }]] });
    for (let i = 0; i < 6 && g.stack.length; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.objects[cub]!.zone).toBe('battlefield');
  });

  it('"Create a Food token or a Treasure token."', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = passBoth(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Provisioner', 'hand') }));
    expect(g.pending).toMatchObject({ kind: 'choose_option', options: ['Food', 'Treasure'] });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: 'Treasure' } });
    expect(g.zones.battlefield.some((id) => g.cards[g.objects[id]!.card]?.name === 'Treasure' || g.objects[id]!.card === 'Treasure')).toBe(true);
  });

  it('"This ability costs {1} less to activate for each legendary creature you control." (channel)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const land = give(g, 'alice', 'Channel Land', 'hand');
    expect(illegal(g, { type: 'activate', player: 'alice', object: land, ability: 0 })).toMatch(/mana/);
    g.objects[give(g, 'alice', 'Legend', 'battlefield')]!.sick = false;
    give(g, 'alice', 'Legend', 'battlefield');
    g = act(g, { type: 'activate', player: 'alice', object: land, ability: 0 });
    expect(g.stack.length).toBe(1);
  });
});
