import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Scorn Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'As an additional cost to cast this spell, you may reveal a Dragon card from your hand.\nCounter target spell unless its controller pays {1}. If you revealed a Dragon card or controlled a Dragon as you cast this spell, counter that spell instead.' }),
  makeCard({ name: 'Exhale Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'As an additional cost to cast this spell, you may behold a Dragon.\nTarget player loses 1 life. If a Dragon was beheld, that player loses 3 life instead.' }),
  makeCard({ name: 'Whelp', type_line: 'Creature — Dragon', mana_cost: '{4}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Insight Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw two cards.' }),
  makeCard({ name: 'Forest', type_line: 'Basic Land — Forest', mana_cost: '', oracle_text: '({T}: Add {G}.)' }),
  makeCard({ name: 'Battlemage Lite', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Kicker {U} and/or {R}\nWhen this creature enters, if it was kicked with its {U} kicker, draw a card.\nWhen this creature enters, if it was kicked with its {R} kicker, this creature deals 2 damage to target player.' }),
  makeCard({ name: 'Mindsinger Lite', type_line: 'Creature — Merfolk Wizard', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Kicker {U} and/or {R}\nThis creature enters with two +1/+1 counters on it for each time it was kicked.' }),
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
  it('Battlemages: "Kicker {U} and/or {R}" — each kicker its own payment and its own condition (CR 702.33c)', () => {
    for (const [kicked, drew, dmg] of [[[0], 1, 0], [[1], 0, 2], [true, 1, 2]] as const) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      g.players.alice!.pool.U = 1;
      g.players.alice!.pool.R = 1;
      const hand = g.zones.hand.alice!.length;
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Battlemage Lite', 'hand'), kicked } as never);
      for (let i = 0; i < 30 && (g.stack.length || g.pending); i++) {
        if (g.pending) g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } } as never);
        else g = act(g, { type: 'pass', player: g.priority! });
      }
      expect([g.zones.hand.alice!.length - hand, 20 - g.players.bob!.life]).toEqual([drew, dmg]);
    }
  });
  it('"for each time it was kicked" counts each of two kicker costs paid', () => {
    for (const [kicked, n] of [[[1], 2], [true, 4]] as const) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      g.players.alice!.pool.U = 1;
      g.players.alice!.pool.R = 1;
      const m = give(g, 'alice', 'Mindsinger Lite', 'hand');
      g = act(g, { type: 'cast', player: 'alice', object: m, kicked } as never);
      for (let i = 0; i < 10 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
      expect(g.objects[m]!.counters['+1/+1']).toBe(n);
    }
  });
});
