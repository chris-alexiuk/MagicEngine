import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Combat Trick', type_line: 'Instant', oracle_text: 'Cast this spell only during combat.\nYou gain 2 life.', mana_cost: '{0}' }),
  makeCard({ name: 'Tapped Kill', type_line: 'Instant', oracle_text: 'This spell costs {2} less to cast if it targets a tapped creature.\nDestroy target creature.', mana_cost: '{2}{B}', cmc: 3 }),
  makeCard({ name: 'Entwined Trick', type_line: 'Instant', oracle_text: 'Cast this spell only during combat on your turn.\nChoose one —\n• You gain 2 life.\n• You gain 3 life.\nEntwine {0}', mana_cost: '{0}' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', oracle_text: '', mana_cost: '{0}', power: '2', toughness: '2' }),
];

describe('CR 601.3: casting restrictions; cost changes that look at targets', () => {
  it('“Cast this spell only during combat.”', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const t = give(g, 'alice', 'Combat Trick', 'hand');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === t)).toBe(false);
    expect(() => act(g, { type: 'cast', player: 'alice', object: t })).toThrow(/can't be cast now/);
    g = toStep(g, 'beginning_of_combat');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === t)).toBe(true);
  });

  it('the restriction holds whatever cost it is cast for (entwine)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const t = give(g, 'alice', 'Entwined Trick', 'hand');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === t)).toBe(false);
    g = toStep(g, 'beginning_of_combat');
    const offers = legalActions(g, 'alice').filter((a) => a.type === 'cast' && a.object === t);
    expect(offers.some((a) => a.type === 'cast' && a.extras?.includes('entwine'))).toBe(true);
  });

  it('“costs {2} less to cast if it targets a tapped creature”', () => {
    const g = toStep(start({ extra: CARDS }), 'main1');
    const k = give(g, 'alice', 'Tapped Kill', 'hand');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g.players.alice!.pool = { W: 0, U: 0, B: 1, R: 0, G: 0, C: 0 };
    expect(() => act(g, { type: 'cast', player: 'alice', object: k, targets: [[{ kind: 'object', object: bear }]] })).toThrow(/mana/);
    g.objects[bear]!.tapped = true;
    expect(() => act(g, { type: 'cast', player: 'alice', object: k, targets: [[{ kind: 'object', object: bear }]] })).not.toThrow();
  });
});
