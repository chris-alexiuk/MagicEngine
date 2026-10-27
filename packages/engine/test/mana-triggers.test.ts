import { describe, expect, it } from 'vitest';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Growth', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional {G}.' }),
  makeCard({ name: 'Sprawl', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant Forest\nAs this Aura enters, choose a color.\nWhenever enchanted Forest is tapped for mana, its controller adds an additional one mana of the chosen color.' }),
  makeCard({ name: 'Ghast', type_line: 'Creature — Spirit', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever you tap a Swamp for mana, add an additional {B}.' }),
  makeCard({ name: 'Wake', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever you tap a land for mana, add one mana of any type that land produced.' }),
  makeCard({ name: 'Bloom', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever a Forest is tapped for mana, its controller adds an additional {G}.' }),
  makeCard({ name: 'Swamp', type_line: 'Basic Land — Swamp', mana_cost: '', oracle_text: '({T}: Add {B}.)' }),
  makeCard({ name: 'Island', type_line: 'Basic Land — Island', mana_cost: '', oracle_text: '({T}: Add {U}.)' }),
];

describe('triggered mana abilities (CR 605.1b, 106.12a)', () => {
  it('Wild Growth and Utopia Sprawl: the enchanted land', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    const aura = give(g, 'alice', 'Growth', 'battlefield');
    g.objects[aura]!.attachedTo = { id: forest, zcc: g.objects[forest]!.zcc };
    g = act(g, { type: 'activate_mana', player: 'alice', object: forest, ability: 0 });
    expect(g.players.alice!.pool.G).toBe(2);
    const other = give(g, 'alice', 'Forest', 'battlefield');
    const sprawl = give(g, 'alice', 'Sprawl', 'battlefield');
    g.objects[sprawl]!.attachedTo = { id: other, zcc: g.objects[other]!.zcc };
    g.objects[sprawl]!.chosen = { color: 'U' };
    g = act(g, { type: 'activate_mana', player: 'alice', object: other, ability: 0 });
    expect(g.players.alice!.pool).toMatchObject({ G: 3, U: 1 });
  });

  it('Crypt Ghast and Mirari\'s Wake: lands you tap', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Ghast', 'battlefield');
    const swamp = give(g, 'alice', 'Swamp', 'battlefield');
    const island = give(g, 'alice', 'Island', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: swamp, ability: 0 });
    expect(g.players.alice!.pool.B).toBe(2);
    give(g, 'alice', 'Wake', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: island, ability: 0 });
    expect(g.players.alice!.pool.U).toBe(2);
    // Not an opponent's land.
    const theirs = give(g, 'bob', 'Swamp', 'battlefield');
    g = toStep(g, 'main1', 'bob');
    g = act(g, { type: 'activate_mana', player: 'bob', object: theirs, ability: 0 });
    expect(g.players.bob!.pool.B).toBe(1);
  });

  it('"Whenever a Forest is tapped for mana, its controller adds …" — anyone\'s', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Bloom', 'battlefield');
    const forest = give(g, 'bob', 'Forest', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'bob', object: forest, ability: 0 });
    expect(g.players.bob!.pool.G).toBe(2);
    expect(g.players.alice!.pool.G).toBe(0);
  });
});
