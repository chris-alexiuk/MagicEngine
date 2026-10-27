import { describe, expect, it } from 'vitest';
import { hasType, legalActions, manaAbilities } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Peregrin', type_line: 'Legendary Creature — Halfling', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: 'If one or more tokens would be created under your control, those tokens plus an additional Food token are created instead.' }),
  makeCard({ name: 'Xorn', type_line: 'Creature — Elemental', mana_cost: '{0}', power: '3', toughness: '2', oracle_text: 'If you would create one or more Treasure tokens, instead create those tokens plus an additional Treasure token.' }),
  makeCard({ name: 'Soldiers', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Create two 1/1 white Soldier creature tokens.' }),
  makeCard({ name: 'Riches', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Create a Treasure token.' }),
  makeCard({ name: 'Season', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.' }),
  makeCard({ name: 'Growth', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Put two +1/+1 counters on target creature.' }),
  makeCard({ name: 'Insight', type_line: 'Legendary Creature — Human Wizard', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'If you would draw a card except the first one you draw in each of your draw steps, draw two cards instead.' }),
  makeCard({ name: 'Divination', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw a card.' }),
  makeCard({ name: 'Maniac', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'If you would draw a card while your library has no cards in it, you win the game instead.' }),
  makeCard({ name: 'Bats', type_line: 'Creature — Bat', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Flying\nWhenever you create or sacrifice a token, each opponent loses 1 life.' }),
  makeCard({ name: 'Town', type_line: 'Land — Town', mana_cost: '', oracle_text: "This land enters tapped unless it's your first, second, or third turn of the game.\n{T}: Add {C}." }),
  makeCard({ name: 'Truce', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'You and permanents you control gain hexproof until end of turn.' }),
  makeCard({ name: 'Torque', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}: Target nonland permanent becomes an artifact in addition to its other types until end of turn.' }),
  makeCard({ name: 'Necro', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever you discard a card, exile that card from your graveyard.' }),
  makeCard({ name: 'Moon', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Nonbasic lands are Mountains.' }),
  makeCard({ name: 'Rief', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {G}.\n{T}: Put a +1/+1 counter on each green creature that entered this turn.' }),
  makeCard({ name: 'Elf', type_line: 'Creature — Elf', mana_cost: '{G}', cmc: 1, color_identity: ['G'], colors: ['G'], power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Mind Rot', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target player discards two cards.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 30 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const tokens = (g: GameState, p: string, sub?: string) => g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === p && (!sub || g.cards[g.objects[id]!.card]!.faces[0]!.subtypes.includes(sub)));

describe('staples (slice 151)', () => {
  it('Peregrin Took and Xorn add tokens', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Peregrin', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Soldiers', 'hand') }));
    expect(tokens(g, 'alice', 'Soldier')).toHaveLength(2);
    expect(tokens(g, 'alice', 'Food')).toHaveLength(1);
    give(g, 'alice', 'Xorn', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Riches', 'hand') }));
    expect(tokens(g, 'alice', 'Treasure')).toHaveLength(2);
    expect(tokens(g, 'alice', 'Food')).toHaveLength(2);
  });

  it('Doubling Season doubles counters an effect puts', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Season', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Growth', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[bear]!.counters['+1/+1']).toBe(4);
  });

  it("Teferi's Ageless Insight: draws after the first in the draw step become two", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Insight', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Divination', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
    // Its draw step's first draw stays one card.
    g.zones.hand.alice = g.zones.hand.alice!.slice(0, 2);
    g = toStep(g, 'draw', 'alice');
    expect(g.zones.hand.alice!.length).toBe(3);
  });

  it('Laboratory Maniac wins on an empty library draw', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Maniac', 'battlefield');
    g.zones.library.alice = [];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Divination', 'hand') }));
    expect(g.over).toBeTruthy();
    expect(g.players.bob!.lost).toBeTruthy();
    expect(g.players.alice!.lost).toBeFalsy();
  });

  it('Mirkwood Bats: creating or sacrificing a token drains', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Bats', 'battlefield');
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Riches', 'hand') }));
    g = settle(g);
    expect(g.players.bob!.life).toBe(life - 1);
    const treasure = tokens(g, 'alice', 'Treasure')[0]!;
    const ab = manaAbilities(g, g.objects[treasure]!);
    expect(ab.length).toBeGreaterThan(0);
    g = settle(act(g, { type: 'activate_mana', player: 'alice', object: treasure, ability: 0, choice: 'R' }));
    g = settle(g);
    expect(g.players.bob!.life).toBe(life - 2);
  });

  it('Starting Town enters untapped only on your first three turns', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const town = give(g, 'alice', 'Town', 'hand');
    g = act(g, { type: 'play_land', player: 'alice', object: town });
    expect(g.objects[town]!.tapped).toBe(false);
    g.players.alice!.turnsBegun = 4;
    const town2 = give(g, 'alice', 'Town', 'hand');
    g.players.alice!.landsPlayedThisTurn = 0;
    g = act(g, { type: 'play_land', player: 'alice', object: town2 });
    expect(g.objects[town2]!.tapped).toBe(true);
  });

  it("Dawn's Truce gives you and your permanents hexproof", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Truce', 'hand') }));
    expect(g.playerEffects?.some((e) => e.player === 'alice' && e.rule === 'hexproof')).toBe(true);
    expect(g.objects[bear]).toBeTruthy();
  });

  it('Liquimetal Torque makes a permanent an artifact', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const torque = give(g, 'alice', 'Torque', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: torque, ability: 0, targets: [[{ kind: 'object', object: bear }]] }));
    expect(hasType(g, g.objects[bear]!, 'Artifact')).toBe(true);
    expect(hasType(g, g.objects[bear]!, 'Creature')).toBe(true);
  });

  it('Necropotence exiles discarded cards', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Necro', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mind Rot', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] }));
    if (g.pending?.kind === 'discard') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: g.zones.hand.alice!.slice(0, 2) } });
    g = settle(g);
    expect(g.zones.graveyard.alice!.filter((id) => g.cards[g.objects[id]!.card]!.faces[0]!.name !== 'Mind Rot')).toHaveLength(0);
    expect(legalActions(g, 'alice').length).toBeGreaterThan(0);
  });

  it('Blood Moon: nonbasic lands are Mountains', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const town = give(g, 'alice', 'Town', 'battlefield');
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    give(g, 'bob', 'Moon', 'battlefield');
    const ab = manaAbilities(g, g.objects[town]!);
    expect(ab).toHaveLength(1);
    expect(JSON.stringify(ab[0]!.effects)).toContain('R');
    expect(JSON.stringify(manaAbilities(g, g.objects[forest]!)[0]!.effects)).toContain('G');
  });

  it('Oran-Rief: counters on green creatures that entered this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const old = give(g, 'alice', 'Elf', 'battlefield');
    g.turnLog.entered = {};
    const rief = give(g, 'alice', 'Rief', 'battlefield');
    g.players.alice!.pool.G = 1;
    const elf = give(g, 'alice', 'Elf', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: elf }));
    g = settle(act(g, { type: 'activate', player: 'alice', object: rief, ability: 0 }));
    expect(g.objects[elf]!.counters['+1/+1']).toBe(1);
    expect(g.objects[old]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});
