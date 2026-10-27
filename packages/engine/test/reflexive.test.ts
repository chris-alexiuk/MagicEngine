import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, actWithEvents, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Tri Land', type_line: 'Land', mana_cost: '', oracle_text: 'When this land enters, sacrifice it. When you do, you gain 3 life.' }),
  makeCard({ name: 'Edict Fiend', type_line: 'Creature — Demon', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'When this creature enters, you may sacrifice another creature. When you do, destroy target creature an opponent controls.' }),
  makeCard({ name: 'Grim Pact', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Sacrifice a creature. When you do, you gain 5 life.' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', power: '2', toughness: '2', oracle_text: '' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 30 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}

describe('reflexive triggered abilities (CR 603.12)', () => {
  it('"sacrifice it. When you do, …" — a trigger of its own after the sacrifice', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const land = give(g, 'alice', 'Tri Land', 'hand');
    g = act(g, { type: 'play_land', player: 'alice', object: land });
    expect(g.stack).toHaveLength(1);
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    // The land is gone and the reflexive ability waits on the stack.
    expect(g.objects[land]!.zone).toBe('graveyard');
    expect(g.stack).toHaveLength(1);
    expect(g.players.alice!.life).toBe(20);
    g = settle(g);
    expect(g.players.alice!.life).toBe(23);
  });

  it('"you may sacrifice another creature. When you do, destroy target creature" — targets chosen after', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const fodder = give(g, 'alice', 'Bear', 'battlefield');
    const theirs = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Edict Fiend', 'hand') }));
    expect(g.pending).toMatchObject({ kind: 'may' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    expect(g.objects[fodder]!.zone).toBe('graveyard');
    expect(g.stack).toHaveLength(1);
    expect(g.objects[theirs]!.zone).toBe('battlefield');
    // Only one creature an opponent controls: the reflexive trigger's target is forced.
    g = settle(g);
    expect(g.objects[theirs]!.zone).toBe('graveyard');
  });

  it("declining or being unable means it doesn't trigger", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Grim Pact', 'hand') }));
    expect(g.stack).toHaveLength(0);
    expect(g.players.alice!.life).toBe(20);
    give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Grim Pact', 'hand') }));
    expect(g.players.alice!.life).toBe(25);
  });
});

describe('what a reflexive ability remembers (CR 603.12, 608.2h)', () => {
  const MORE = [
    makeCard({ name: 'Tipper', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Sacrifice a creature. When you do, you gain life equal to the sacrificed creature's toughness." }),
    makeCard({ name: 'Plain Tipper', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Sacrifice a creature. You gain life equal to the sacrificed creature's toughness." }),
    makeCard({ name: 'Wall', type_line: 'Creature — Wall', mana_cost: '{0}', power: '0', toughness: '5', oracle_text: '' }),
  ];
  it('"the sacrificed creature" — sacrificed as it resolved, not as a cost', () => {
    let g = toStep(start({ extra: [...CARDS, ...MORE] }), 'main1', 'alice');
    give(g, 'alice', 'Wall', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Plain Tipper', 'hand') }));
    expect(g.players.alice!.life).toBe(25);
    give(g, 'alice', 'Wall', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Tipper', 'hand') }));
    expect(g.players.alice!.life).toBe(30);
  });
});

describe('a die roll, then "When you do"', () => {
  it('X is the result', () => {
    const ROLLER = makeCard({ name: 'Roller', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Roll a d20. When you do, put X +1/+1 counters on target creature, where X is the result.' });
    let g = toStep(start({ extra: [...CARDS, ROLLER] }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Roller', 'hand') });
    let result: number | undefined;
    for (let i = 0; i < 10 && g.stack.length; i++) {
      const r = actWithEvents(g, { type: 'pass', player: g.priority! });
      for (const e of r.events) if (e.type === 'die_rolled') result = e.result;
      g = r.state;
    }
    expect(result).toBeGreaterThan(0);
    expect(g.objects[bear]!.counters['+1/+1']).toBe(result);
  });
});
