import { describe, expect, it } from 'vitest';
import { legalActions, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const TW = '(As an additional cost to cast this spell, you may tap any number of creatures you control with total power 3 or more.)';
const CARDS = [
  makeCard({ name: 'Team Plan', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: `Teamwork 3 ${TW}\nChoose one. If this spell was cast using teamwork, choose both instead.\n• You gain 3 life.\n• Draw a card.` }),
  makeCard({ name: 'Team Strike', type_line: 'Instant', mana_cost: '{0}', oracle_text: `Teamwork 3 ${TW}\nTeam Strike deals 2 damage to target creature. If this spell was cast using teamwork, it deals 4 damage to that creature instead.` }),
  makeCard({ name: 'Team Draw', type_line: 'Instant', mana_cost: '{0}', oracle_text: `Teamwork 3 ${TW}\nDraw two cards. Then discard a card unless this spell was cast using teamwork.` }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Ox', type_line: 'Creature — Ox', mana_cost: '{0}', power: '1', toughness: '4', oracle_text: '' }),
];
const settle = (g: GameState) => {
  for (let i = 0; i < 20 && (g.stack.length || g.pending); i++) {
    if (g.pending?.kind === 'choose_objects') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'choose_objects', objects: g.pending.candidates.slice(0, g.pending.min) } });
    else if (g.pending?.kind === 'discard') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'discard', objects: g.zones.hand[g.pending.player]!.slice(0, g.pending.count) } });
    else if (g.pending) throw new Error(`unexpected ${g.pending.kind}`);
    else g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
};

describe('CR 702.194: teamwork', () => {
  it('tapping creatures with total power N; "if this spell was cast using teamwork, choose both instead"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const plan = give(g, 'alice', 'Team Plan', 'hand');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const ox = give(g, 'alice', 'Ox', 'battlefield');
    // Without teamwork, one mode only.
    expect(() => act(g, { type: 'cast', player: 'alice', object: plan, modes: [0, 1] })).toThrow();
    // Not enough power.
    expect(() => act(g, { type: 'cast', player: 'alice', object: plan, modes: [0, 1], extras: ['teamwork'], costs: { crew: [bear] } })).toThrow(/power 3/);
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === plan && a.extras?.includes('teamwork'))).toBe(true);
    const life = g.players.alice!.life;
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: plan, modes: [0, 1], extras: ['teamwork'], costs: { crew: [bear, ox] } }));
    expect(g.objects[bear]!.tapped && g.objects[ox]!.tapped).toBe(true);
    expect(g.players.alice!.life).toBe(life + 3);
    expect(g.zones.hand.alice!.length).toBe(hand); // cast one card, drew one
  });

  it('"it deals 4 damage to that creature instead"; "unless this spell was cast using teamwork"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const strike = give(g, 'alice', 'Team Strike', 'hand');
    const draw = give(g, 'alice', 'Team Draw', 'hand');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const ox = give(g, 'alice', 'Ox', 'battlefield');
    const target = give(g, 'bob', 'Ox', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: strike, targets: [[{ kind: 'object', object: target }]], extras: ['teamwork'], costs: { crew: [bear, ox] } }));
    expect(g.objects[target]!.zone).toBe('graveyard');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: draw }));
    // Drew two, discarded one (and Team Draw left the hand).
    expect(g.zones.hand.alice!.length).toBe(hand - 1 + 2 - 1);
  });
});
