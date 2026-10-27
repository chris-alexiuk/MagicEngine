import { describe, expect, it } from 'vitest';
import { legalActions, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Herd Grounds', type_line: 'Land', oracle_text: '{T}: Add {G}{G}. Spend this mana only to cast creature spells.' }),
  makeCard({ name: 'Gear Grounds', type_line: 'Land', oracle_text: '{T}: Add {C}{C}. Spend this mana only to cast artifact spells or activate abilities of artifacts.' }),
  makeCard({ name: 'Grizzly', type_line: 'Creature — Bear', oracle_text: '', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2' }),
  makeCard({ name: 'Growth', type_line: 'Sorcery', oracle_text: 'You gain 3 life.', mana_cost: '{1}{G}', cmc: 2 }),
  makeCard({ name: 'Trinket', type_line: 'Artifact', oracle_text: '{2}: You gain 1 life.', mana_cost: '{2}', cmc: 2 }),
  makeCard({ name: 'Red Ritual', type_line: 'Instant', oracle_text: 'Add {R}{R}{R}. Spend this mana only to cast instant or sorcery spells.', mana_cost: '{0}', cmc: 0 }),
  makeCard({ name: 'Fireball Lite', type_line: 'Sorcery', oracle_text: 'You gain 3 life.', mana_cost: '{2}{R}', cmc: 3 }),
  makeCard({ name: 'Fire Bear', type_line: 'Creature — Bear', oracle_text: '', mana_cost: '{2}{R}', cmc: 3, power: '3', toughness: '3' }),
  makeCard({ name: 'Prism Lite', type_line: 'Creature — Golem', oracle_text: 'When this creature enters, add one mana of any color.', mana_cost: '{0}', cmc: 0, power: '1', toughness: '1' }),
  makeCard({ name: 'Combo Land', type_line: 'Land', oracle_text: '{T}: Add two mana in any combination of {R} and/or {G}.' }),
];

function setup(): GameState {
  const g = toStep(start({ extra: CARDS }), 'main1');
  g.zones.hand.alice = [];
  return g;
}
const settle = (g: GameState) => {
  while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
  return g;
};

describe('CR 106.6: mana that can be spent only on certain things', () => {
  it('“Spend this mana only to cast creature spells”', () => {
    let g = setup();
    give(g, 'alice', 'Herd Grounds', 'battlefield');
    const bear = give(g, 'alice', 'Grizzly', 'hand');
    const growth = give(g, 'alice', 'Growth', 'hand');
    const offers = legalActions(g, 'alice').filter((a) => a.type === 'cast').map((a) => (a as { object: string }).object);
    expect(offers).toContain(bear);
    expect(offers).not.toContain(growth);
    expect(() => act(g, { type: 'cast', player: 'alice', object: growth, autoTap: true })).toThrow(/mana/);
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear, autoTap: true }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
  });

  it('restricted mana in the pool is kept apart, and empties as the step ends (CR 500.5)', () => {
    let g = setup();
    const land = give(g, 'alice', 'Herd Grounds', 'battlefield');
    const growth = give(g, 'alice', 'Growth', 'hand');
    g = act(g, { type: 'activate_mana', player: 'alice', object: land, ability: 0 } as never);
    expect(g.players.alice!.restricted).toEqual([
      { color: 'G', amount: 1, spend: { spells: { types: ['Creature'] } } },
      { color: 'G', amount: 1, spend: { spells: { types: ['Creature'] } } },
    ]);
    expect(g.players.alice!.pool.G).toBe(0);
    expect(() => act(g, { type: 'cast', player: 'alice', object: growth })).toThrow(/mana/);
    g = toStep(g, 'beginning_of_combat');
    expect(g.players.alice!.restricted).toBeUndefined();
  });

  it('“… or activate abilities of artifacts”', () => {
    let g = setup();
    give(g, 'alice', 'Gear Grounds', 'battlefield');
    const t = give(g, 'alice', 'Trinket', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: t, autoTap: true }));
    expect(g.objects[t]!.zone).toBe('battlefield');
    g = toStep(g, 'upkeep', 'bob');
    g = toStep(g, 'main1', 'alice');
    g = settle(act(g, { type: 'activate', player: 'alice', object: t, ability: 0, autoTap: true } as never));
    expect(g.players.alice!.life).toBe(21);
  });

  it('a spell that adds restricted mana; choosing mana as an ability resolves', () => {
    let g = setup();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Red Ritual', 'hand') }));
    expect(g.players.alice!.restricted?.length).toBe(3);
    const bear = give(g, 'alice', 'Fire Bear', 'hand');
    expect(() => act(g, { type: 'cast', player: 'alice', object: bear })).toThrow(/mana/);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Fireball Lite', 'hand') }));
    expect(g.players.alice!.life).toBe(23);
    expect(g.players.alice!.restricted).toEqual([]);
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Prism Lite', 'hand') });
    g = act(act(g, { type: 'pass', player: 'alice' }), { type: 'pass', player: 'bob' });
    g = act(act(g, { type: 'pass', player: 'alice' }), { type: 'pass', player: 'bob' });
    expect(g.pending).toMatchObject({ kind: 'choose_option', options: ['W', 'U', 'B', 'R', 'G'] });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: 'B' } });
    expect(g.players.alice!.pool.B).toBe(1);
  });

  it('“two mana in any combination of {R} and/or {G}”', () => {
    let g = setup();
    const land = give(g, 'alice', 'Combo Land', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: land, ability: 0, choice: 1 });
    expect([g.players.alice!.pool.R, g.players.alice!.pool.G]).toEqual([1, 1]);
  });
});
