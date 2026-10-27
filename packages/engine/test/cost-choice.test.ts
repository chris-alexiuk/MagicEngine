import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import type { Action, GameState } from '../src/index.js';
import { act, actWithEvents, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Shards', type_line: 'Sorcery', mana_cost: '{B}', oracle_text: 'As an additional cost to cast this spell, sacrifice a creature or discard a card.\nDestroy target creature.' }),
  makeCard({ name: 'Eaten', type_line: 'Sorcery', mana_cost: '{B}', oracle_text: 'As an additional cost to cast this spell, sacrifice a creature or pay {3}{B}.\nExile target creature.' }),
  makeCard({ name: 'Mangle', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'As an additional cost to cast this spell, sacrifice a creature, discard a card, or pay 4 life.\nYou draw a card.' }),
  makeCard({ name: 'Exhale', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'As an additional cost to cast this spell, behold a Dragon or pay {1}.\nYou gain 3 life.' }),
  makeCard({ name: 'Buccaneer', type_line: 'Creature — Human Pirate', mana_cost: '{R}', power: '2', toughness: '2', oracle_text: 'As an additional cost to cast this spell, reveal a Pirate card from your hand or pay {1}.' }),
  makeCard({ name: 'Drake', type_line: 'Creature — Dragon', mana_cost: '{5}', power: '5', toughness: '5', oracle_text: 'Flying' }),
  makeCard({ name: 'Corsair', type_line: 'Creature — Human Pirate', mana_cost: '{3}', power: '3', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', power: '2', toughness: '2', oracle_text: '' }),
];

const casts = (g: GameState, object: string) => legalActions(g, 'alice').filter((a): a is Extract<Action, { type: 'cast' }> => a.type === 'cast' && a.object === object);

describe('a choice of additional costs (CR 118.8)', () => {
  it('Bone Shards: sacrifice a creature or discard a card — exactly one', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.players.alice!.pool.B = 1;
    const shards = give(g, 'alice', 'Shards', 'hand');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const mine = give(g, 'alice', 'Bear', 'battlefield');
    const card = give(g, 'alice', 'Corsair', 'hand');
    expect(casts(g, shards).map((a) => a.extras)).toEqual([['choice1'], ['choice2']]);
    const target = [[{ kind: 'object' as const, object: bear }]];
    expect(illegal(g, { type: 'cast', player: 'alice', object: shards, targets: target })).toMatch(/additional costs/);
    expect(illegal(g, { type: 'cast', player: 'alice', object: shards, targets: target, extras: ['choice1', 'choice2'], costs: { sacrifice: [mine], discard: [card] } })).toMatch(/additional costs/);
    g = act(g, { type: 'cast', player: 'alice', object: shards, targets: target, extras: ['choice2'], costs: { discard: [card] } });
    expect(g.objects[card]!.zone).toBe('graveyard');
    expect(g.objects[mine]!.zone).toBe('battlefield');
    for (let i = 0; i < 5 && g.stack.length; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.objects[bear]!.zone).toBe('graveyard');
  });

  it('Eaten Alive: the mana option adds to the total cost', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const eaten = give(g, 'alice', 'Eaten', 'hand');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g.players.alice!.pool.B = 2;
    expect(casts(g, eaten)).toEqual([]);
    g.players.alice!.pool.C = 3;
    expect(casts(g, eaten).map((a) => a.extras)).toEqual([['choice2']]);
    g = act(g, { type: 'cast', player: 'alice', object: eaten, targets: [[{ kind: 'object', object: bear }]], extras: ['choice2'] });
    expect(g.players.alice!.pool).toMatchObject({ B: 0, C: 0 });
  });

  it('Dusk Mangler: three options, life among them', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mangle = give(g, 'alice', 'Mangle', 'hand');
    // No creature to sacrifice: discarding or paying life.
    expect(casts(g, mangle).map((a) => a.extras)).not.toContainEqual(['choice1']);
    expect(casts(g, mangle).map((a) => a.extras)).toContainEqual(['choice3']);
    g = act(g, { type: 'cast', player: 'alice', object: mangle, extras: ['choice3'] });
    expect(g.players.alice!.life).toBe(16);
  });

  it('behold (CR 701.4a): a Dragon card in hand is revealed, or a Dragon you control is chosen', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const exhale = give(g, 'alice', 'Exhale', 'hand');
    expect(casts(g, exhale)).toEqual([]);
    const drake = give(g, 'alice', 'Drake', 'hand');
    const [cast] = casts(g, exhale);
    expect(cast).toMatchObject({ extras: ['choice1'], costs: { reveal: [drake] } });
    const r = actWithEvents(g, cast!);
    expect(r.events).toContainEqual({ type: 'revealed', player: 'alice', objects: [drake] });
    g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const again = give(g, 'alice', 'Exhale', 'hand');
    const flier = give(g, 'alice', 'Drake', 'battlefield');
    expect(casts(g, again)[0]).toMatchObject({ extras: ['choice1'], costs: { reveal: [flier] } });
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    expect(illegal(g, { type: 'cast', player: 'alice', object: again, extras: ['choice1'], costs: { reveal: [bear] } })).toMatch(/behold/);
  });

  it('"reveal a Pirate card from your hand or pay {1}" — not itself', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.players.alice!.pool.R = 1;
    const buc = give(g, 'alice', 'Buccaneer', 'hand');
    expect(casts(g, buc)).toEqual([]);
    const corsair = give(g, 'alice', 'Corsair', 'hand');
    expect(casts(g, buc)[0]).toMatchObject({ extras: ['choice1'], costs: { reveal: [corsair] } });
  });
});
