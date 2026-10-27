import { describe, expect, it } from 'vitest';
import { legalActions, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Gift Spell', type_line: 'Sorcery', oracle_text: 'Gift a card\nYou gain 1 life. If the gift was promised, you gain 3 life.', mana_cost: '{0}', cmc: 0 }),
  makeCard({ name: 'Gift Rabbit', type_line: 'Creature — Rabbit', oracle_text: "Gift a Food\nWhen this creature enters, if the gift wasn't promised, you gain 5 life.", mana_cost: '{0}', cmc: 0, power: '1', toughness: '1' }),
];
const settle = (g: GameState) => {
  while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
  return g;
};

describe('CR 702.174: gift', () => {
  it('an instant or sorcery: the promised opponent gets the gift first', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const s = give(g, 'alice', 'Gift Spell', 'hand');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === s && (a as { extras?: string[] }).extras?.includes('gift'))).toBe(true);
    const bobHand = g.zones.hand.bob!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: s, extras: ['gift'] }));
    expect(g.zones.hand.bob!.length).toBe(bobHand + 1);
    expect(g.players.alice!.life).toBe(24);
  });

  it('a permanent: "When this permanent enters, if its gift cost was paid, …"; and without the gift', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Gift Rabbit', 'hand'), extras: ['gift'] }));
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'bob').length).toBe(1);
    expect(g.players.alice!.life).toBe(20);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Gift Rabbit', 'hand') }));
    expect(g.players.alice!.life).toBe(25);
  });
});
