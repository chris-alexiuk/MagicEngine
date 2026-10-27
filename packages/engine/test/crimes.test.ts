import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{0}', cmc: 0, ...extra });

const CARDS = [
  card('Outlaw', 'Creature — Rogue', 'Whenever you commit a crime, you gain 1 life.', { power: '1', toughness: '1' }),
  card('Zap', 'Instant', 'This spell deals 1 damage to any target.'),
  card('Spender', 'Creature — Human', 'Whenever you expend 4, you gain 4 life.', { power: '1', toughness: '1' }),
  card('Four Drop', 'Sorcery', 'You gain 0 life.', { mana_cost: '{3}', cmc: 3 }),
  card('Grower', 'Creature — Human', 'Increment', { power: '1', toughness: '2' }),
  card('Ghoul', 'Creature — Zombie', 'Whenever a creature dealt damage by this creature this turn dies, put a +1/+1 counter on this creature.', { power: '3', toughness: '3' }),
  card('Bear', 'Creature — Bear', '', { power: '2', toughness: '2' }),
  card('Shock Ghoul', 'Sorcery', 'Target creature you control deals damage equal to its power to target creature you don\'t control.'),
];
const settle = (g: GameState) => {
  while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
  return g;
};
const cast = (g: GameState, name: string, extra: Record<string, unknown> = {}) => settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), autoTap: true, ...extra } as never));

describe('crimes, expend, increment, "dealt damage by ~ this turn"', () => {
  it('CR 700.13: targeting an opponent is a crime; targeting yourself isn’t', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    give(g, 'alice', 'Outlaw', 'battlefield');
    g = cast(g, 'Zap', { targets: [[{ kind: 'player', player: 'alice' }]] });
    expect(g.players.alice!.life).toBe(19);
    g = cast(g, 'Zap', { targets: [[{ kind: 'player', player: 'bob' }]] });
    expect(g.players.alice!.life).toBe(20);
    expect(g.turnLog.crimes).toEqual(['alice']);
  });

  it('CR 700.14: expend 4 — once the mana spent on spells this turn reaches 4', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    give(g, 'alice', 'Spender', 'battlefield');
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 6 };
    g = cast(g, 'Four Drop');
    expect(g.players.alice!.life).toBe(20);
    g = cast(g, 'Four Drop');
    expect(g.players.alice!.life).toBe(24);
  });

  it('CR 702.191a: increment', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const grower = give(g, 'alice', 'Grower', 'battlefield');
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 6 };
    g = cast(g, 'Zap', { targets: [[{ kind: 'player', player: 'bob' }]] });
    expect(g.objects[grower]!.counters['+1/+1'] ?? 0).toBe(0);
    g = cast(g, 'Four Drop');
    expect(g.objects[grower]!.counters['+1/+1']).toBe(1);
  });

  it('“Whenever a creature dealt damage by this creature this turn dies”', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const ghoul = give(g, 'alice', 'Ghoul', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = cast(g, 'Shock Ghoul', { targets: [[{ kind: 'object', object: ghoul }], [{ kind: 'object', object: bear }]] });
    expect(g.objects[bear]!.zone).toBe('graveyard');
    expect(g.objects[ghoul]!.counters['+1/+1']).toBe(1);
  });
});

describe('CR 701.27e: "When this creature transforms into ~"', () => {
  it('triggers from the face it transformed into', () => {
    const dfc = makeCard({
      name: 'Werebeast // Beast Form',
      type_line: 'Creature — Human // Creature — Beast',
      layout: 'transform',
      card_faces: [
        { name: 'Werebeast', type_line: 'Creature — Human', oracle_text: '{0}: Transform this creature.', mana_cost: '{0}', power: '1', toughness: '1' },
        { name: 'Beast Form', type_line: 'Creature — Beast', oracle_text: 'When this creature transforms into Beast Form, you gain 3 life.', mana_cost: '', power: '3', toughness: '3' },
      ],
    } as never);
    let g = toStep(start({ extra: [dfc] }), 'main1');
    const w = give(g, 'alice', 'Werebeast // Beast Form', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: w, ability: 0 }));
    expect(g.objects[w]!.face).toBe(1);
    expect(g.players.alice!.life).toBe(23);
  });
});
