import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Scorn Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'As an additional cost to cast this spell, you may reveal a Dragon card from your hand.\nCounter target spell unless its controller pays {1}. If you revealed a Dragon card or controlled a Dragon as you cast this spell, counter that spell instead.' }),
  makeCard({ name: 'Exhale Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'As an additional cost to cast this spell, you may behold a Dragon.\nTarget player loses 1 life. If a Dragon was beheld, that player loses 3 life instead.' }),
  makeCard({ name: 'Whelp', type_line: 'Creature — Dragon', mana_cost: '{4}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Insight Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw two cards.' }),
  makeCard({ name: 'Forest', type_line: 'Basic Land — Forest', mana_cost: '', oracle_text: '({T}: Add {G}.)' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length; i++) {
    if (g.pending) g = act(g, { type: 'choose', player: (g.pending as { player: string }).player, answer: { kind: 'pay', pay: true } } as never);
    else g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
}
const countered = (setup: (g: GameState) => Record<string, unknown>): boolean => {
  let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
  give(g, 'bob', 'Forest', 'battlefield');
  const insight = give(g, 'bob', 'Insight Lite', 'hand');
  g = act(g, { type: 'cast', player: 'bob', object: insight } as never);
  g = act(g, { type: 'pass', player: 'bob' });
  const extra = setup(g);
  g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Scorn Lite', 'hand'), targets: [[{ kind: 'object', object: insight }]], ...extra } as never));
  return g.objects[insight]!.zone === 'graveyard' && g.zones.hand.bob!.length < 9;
};

describe("slice 290: Dragons of Tarkir's reveal and behold costs", () => {
  it("Silumgar's Scorn: a hard counter if you revealed a Dragon or controlled one as you cast it", () => {
    expect(countered(() => ({}))).toBe(false);
    expect(countered((g) => ({ extras: ['reveal'], costs: { reveal: [give(g, 'alice', 'Whelp', 'hand')] } }))).toBe(true);
    expect(countered((g) => (give(g, 'alice', 'Whelp', 'battlefield'), {}))).toBe(true);
  });

  it('Dispelling Exhale-style: "If a Dragon was beheld" — only when the behold cost was paid', () => {
    for (const behold of [false, true]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const whelp = give(g, 'alice', 'Whelp', 'battlefield');
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Exhale Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]], ...(behold ? { extras: ['behold'], costs: { reveal: [whelp] } } : {}) } as never));
      expect(g.players.bob!.life).toBe(behold ? 17 : 19);
    }
  });
});
