import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Season Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Choose up to five {P} worth of modes. You may choose the same mode more than once.\n{P} — You gain 1 life.\n{P}{P} — Draw a card.\n{P}{P}{P} — Target player loses 3 life.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const main = () => toStep(start({ extra: CARDS }), 'main1', 'alice');
const cast = (g: GameState, modes: number[], targets: unknown[][] = []) => ({ type: 'cast', player: 'alice', object: give(g, 'alice', 'Season Lite', 'hand'), modes, targets }) as never;

describe('slice 284: pawprint modes (CR 700.2i)', () => {
  it('modes add up to no more than five {P}; the same mode may be chosen again, each time with its own targets', () => {
    let g = main();
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, cast(g, [0, 0, 1])));
    expect([g.players.alice!.life, g.zones.hand.alice!.length]).toEqual([22, hand + 1]);
    expect(illegal(g, cast(g, [2, 2], [[{ kind: 'player', player: 'bob' }], [{ kind: 'player', player: 'bob' }]]))).toMatch(/5 \{P\}/);
    expect(illegal(g, cast(g, [0, 0, 0, 0, 0, 0]))).toBeTruthy();
    g = settle(act(g, cast(g, [1, 2], [[{ kind: 'player', player: 'bob' }]])));
    expect(g.players.bob!.life).toBe(17);
    g = settle(act(g, cast(g, [0, 0, 0, 0, 0])));
    expect(g.players.alice!.life).toBe(27);
  });
});
