import { describe, expect, it } from 'vitest';
import type { GameEvent, GameState } from '../src/index.js';
import { act, actWithEvents, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Gamble', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Roll a d20.\n1—10 | You gain 1 life.\n11—19 | You gain 2 life.\n20 | You gain 10 life.' }),
  makeCard({ name: 'Hoard', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}: Roll a d4 and create a number of Treasure tokens equal to the result.' }),
  makeCard({ name: 'Dice Fan', type_line: 'Creature — Dwarf', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Whenever you roll one or more dice, you gain 1 life.' }),
];

function resolveAll(g: GameState, events: GameEvent[]): GameState {
  while (g.stack.length) {
    const r = actWithEvents(g, { type: 'pass', player: g.priority! });
    events.push(...r.events);
    g = r.state;
  }
  return g;
}

describe('CR 706: rolling dice', () => {
  it('a results table (CR 706.3a): the row the result falls in', () => {
    for (let seed = 1; seed <= 6; seed++) {
      let g = toStep(start({ extra: CARDS, seed }), 'main1', 'alice');
      const s = give(g, 'alice', 'Gamble', 'hand');
      g = act(g, { type: 'cast', player: 'alice', object: s });
      const events: GameEvent[] = [];
      g = resolveAll(g, events);
      const roll = events.find((e): e is Extract<GameEvent, { type: 'die_rolled' }> => e.type === 'die_rolled')!;
      expect(roll.sides).toBe(20);
      expect(roll.result).toBeGreaterThanOrEqual(1);
      expect(roll.result).toBeLessThanOrEqual(20);
      expect(g.players.alice!.life - 20).toBe(roll.result === 20 ? 10 : roll.result >= 11 ? 2 : 1);
    }
  });

  it('"create a number of Treasure tokens equal to the result"; "Whenever you roll one or more dice"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const h = give(g, 'alice', 'Hoard', 'battlefield');
    give(g, 'alice', 'Dice Fan', 'battlefield');
    const before = g.zones.battlefield.length;
    const r = actWithEvents(g, { type: 'activate', player: 'alice', object: h, ability: 0 });
    const events: GameEvent[] = [...r.events];
    g = resolveAll(r.state, events);
    const roll = events.find((e): e is Extract<GameEvent, { type: 'die_rolled' }> => e.type === 'die_rolled')!;
    expect(g.zones.battlefield.length - before).toBe(roll.result);
    expect(g.players.alice!.life).toBe(21);
  });
});
