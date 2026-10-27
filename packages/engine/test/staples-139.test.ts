import { describe, expect, it } from 'vitest';
import { legalActions, power, toughness } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Guide', type_line: 'Creature — Ape Spirit', mana_cost: '{2}{R}', power: '2', toughness: '2', oracle_text: 'Exile this card from your hand: Add {R}.' }),
  makeCard({ name: 'Ritual', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Add {B}{B}{B}.\nThreshold — Add {B}{B}{B}{B}{B} instead if there are seven or more cards in your graveyard.' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', power: '2', toughness: '2', oracle_text: '' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 30 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}

describe('staples (slice 139)', () => {
  it('Simian Spirit Guide: a mana ability from the hand', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const guide = give(g, 'alice', 'Guide', 'hand');
    expect(legalActions(g, 'alice')).toContainEqual({ type: 'activate_mana', player: 'alice', object: guide, ability: 0 });
    g = act(g, { type: 'activate_mana', player: 'alice', object: guide, ability: 0 });
    expect(g.players.alice!.pool.R).toBe(1);
    expect(g.objects[guide]!.zone).toBe('exile');
    const onField = give(g, 'alice', 'Guide', 'battlefield');
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate_mana' && a.object === onField)).toBe(false);
  });

  it('Cabal Ritual: threshold', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ritual', 'hand') }));
    expect(g.players.alice!.pool.B).toBe(3);
    for (let i = 0; i < 7; i++) give(g, 'alice', 'Bear', 'graveyard');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ritual', 'hand') }));
    expect(g.players.alice!.pool.B).toBe(8);
  });
});

describe('Minas Tirith', () => {
  it('"Activate only if you attacked with two or more creatures this turn"', () => {
    const MORE = [makeCard({ name: 'Tirith', type_line: 'Legendary Land', mana_cost: '', oracle_text: '{T}: Draw a card. Activate only if you attacked with two or more creatures this turn.' })];
    let g = toStep(start({ extra: [...CARDS, ...MORE] }), 'main1', 'alice');
    const land = give(g, 'alice', 'Tirith', 'battlefield');
    const a = give(g, 'alice', 'Bear', 'battlefield', { sick: false });
    const b = give(g, 'alice', 'Bear', 'battlefield', { sick: false });
    const can = () => legalActions(g, 'alice').some((x) => x.type === 'activate' && x.object === land);
    expect(can()).toBe(false);
    for (let i = 0; i < 10 && g.pending?.kind !== 'declare_attackers'; i++) g = act(g, { type: 'pass', player: g.priority! });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [a, b].map((attacker) => ({ attacker, target: { kind: 'player' as const, player: 'bob' } })) } });
    g = toStep(g, 'main2', 'alice');
    expect(can()).toBe(true);
  });
});

describe('Chord of Calling', () => {
  it('"a creature card with mana value X or less"', () => {
    const MORE = [
      makeCard({ name: 'Chord', type_line: 'Instant', mana_cost: '{X}', oracle_text: 'Search your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle.' }),
      makeCard({ name: 'Big', type_line: 'Creature — Giant', mana_cost: '{5}', cmc: 5, power: '5', toughness: '5', oracle_text: '' }),
      makeCard({ name: 'Small', type_line: 'Creature — Elf', mana_cost: '{1}', cmc: 1, power: '1', toughness: '1', oracle_text: '' }),
    ];
    let g = toStep(start({ extra: [...CARDS, ...MORE], decks: { alice: [...Array(30).fill('Forest'), 'Big', 'Small', 'Chord'], bob: Array(40).fill('Forest') } }), 'main1', 'alice');
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Chord', 'hand'), x: 2 }));
    expect(g.pending).toMatchObject({ kind: 'search' });
    const names = (g.pending as { candidates: string[] }).candidates.map((id) => g.objects[id]!.card);
    expect(names).toContain('Small');
    expect(names).not.toContain('Big');
  });
});

describe('doubling (CR 701.10)', () => {
  it('power and toughness, and +1/+1 counters', () => {
    const MORE = [
      makeCard({ name: 'Growth', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Double the power and toughness of each creature you control until end of turn.' }),
      makeCard({ name: 'Curve', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Put a +1/+1 counter on target creature, then double the number of +1/+1 counters on it.' }),
    ];
    let g = toStep(start({ extra: [...CARDS, ...MORE] }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Curve', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[bear]!.counters['+1/+1']).toBe(2);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Growth', 'hand') }));
    expect([power(g, g.objects[bear]!), toughness(g, g.objects[bear]!)]).toEqual([8, 8]);
  });
});

describe('Living Death', () => {
  it('graveyard creatures and battlefield creatures trade places', () => {
    const MORE = [makeCard({ name: 'Death', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each player exiles all creature cards from their graveyard, then sacrifices all creatures they control, then puts all cards they exiled this way onto the battlefield.' })];
    let g = toStep(start({ extra: [...CARDS, ...MORE] }), 'main1', 'alice');
    const dead = give(g, 'bob', 'Bear', 'graveyard');
    const alive = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Death', 'hand') }));
    expect(g.objects[dead]!.zone).toBe('battlefield');
    expect(g.objects[dead]!.controller).toBe('bob');
    expect(g.objects[alive]!.zone).toBe('graveyard');
  });
});

describe('Bolt Bend', () => {
  it('"Change the target of target spell or ability with a single target" — to a different one (CR 115.7a)', () => {
    const MORE = [
      makeCard({ name: 'Bend', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Change the target of target spell or ability with a single target.' }),
      makeCard({ name: 'Shock', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Shock deals 2 damage to any target.' }),
    ];
    let g = toStep(start({ extra: [...CARDS, ...MORE] }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const shock = give(g, 'alice', 'Shock', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: shock, targets: [[{ kind: 'object', object: bear }]] });
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bend', 'hand'), targets: [[{ kind: 'object', object: shock }]] });
    for (let i = 0; i < 4 && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.pending).toMatchObject({ kind: 'copy_targets', mustChange: true });
    const cands = (g.pending as { prompts: { candidates: { kind: string; object?: string }[] }[] }).prompts[0]!.candidates;
    expect(cands.some((t) => t.kind === 'object' && t.object === bear)).toBe(false);
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'copy_targets', targets: [[{ kind: 'player', player: 'alice' }]] } }));
    expect(g.players.alice!.life).toBe(18);
    expect(g.objects[bear]!.damage ?? 0).toBe(0);
  });
});
