import { describe, expect, it } from 'vitest';
import { hasKeyword, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Shalai', type_line: 'Legendary Creature — Angel', mana_cost: '{0}', power: '3', toughness: '4', oracle_text: 'Flying\nYou, planeswalkers you control, and other creatures you control have hexproof.' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Shock', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Shock deals 2 damage to any target.' }),
  makeCard({ name: 'Teferi', type_line: 'Legendary Planeswalker — Teferi', mana_cost: '{0}', loyalty: '4', oracle_text: "Each opponent can cast spells only any time they could cast a sorcery.\n+1: Until your next turn, you may cast sorcery spells as though they had flash.\n−3: Return up to one target artifact, creature, or enchantment to its owner's hand. Draw a card." }),
  makeCard({ name: 'Opt', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Draw a card.' }),
  makeCard({ name: 'Divination', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw two cards.' }),
  makeCard({ name: 'Bauble', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "{T}, Sacrifice this artifact: Look at the top card of target player's library. Draw a card at the beginning of the next turn's upkeep." }),
  makeCard({ name: 'Conqueror', type_line: 'Creature — Vampire Soldier', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "Whenever an artifact or creature an opponent controls enters untapped, they may tap that permanent. If they don't, you create a 1/1 white Vampire creature token with lifelink." }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}

describe('staples (slice 158)', () => {
  it('Shalai: you and your other creatures have hexproof, not Shalai', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const shalai = give(g, 'alice', 'Shalai', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    expect(hasKeyword(g, g.objects[bear]!, 'hexproof')).toBe(true);
    expect(hasKeyword(g, g.objects[shalai]!, 'hexproof')).toBe(false);
    const shock = give(g, 'bob', 'Shock', 'hand');
    expect(illegal(g, { type: 'cast', player: 'bob', object: shock, targets: [[{ kind: 'player', player: 'alice' }]] })).toBeTruthy();
    expect(illegal(g, { type: 'cast', player: 'bob', object: shock, targets: [[{ kind: 'object', object: bear }]] })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'bob', object: shock, targets: [[{ kind: 'object', object: shalai }]] }));
    expect(g.objects[shalai]!.damage).toBe(2);
  });

  it('Teferi, Time Raveler: opponents at sorcery speed; sorceries with flash for you', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const teferi = give(g, 'alice', 'Teferi', 'battlefield');
    g.objects[teferi]!.counters.loyalty = 4;
    const opt = give(g, 'bob', 'Opt', 'hand');
    // Bob can't respond during Alice's turn.
    const div = give(g, 'alice', 'Divination', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: div });
    expect(g.priority).toBe('alice');
    g = act(g, { type: 'pass', player: 'alice' });
    expect(illegal(g, { type: 'cast', player: 'bob', object: opt })).toBeTruthy();
    g = settle(g);
    // +1: Alice may cast a sorcery during Bob's turn.
    g = settle(act(g, { type: 'activate', player: 'alice', object: teferi, ability: 0 }));
    const div2 = give(g, 'alice', 'Divination', 'hand');
    g = toStep(g, 'upkeep', 'bob');
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.priority).toBe('alice');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === div2)).toBe(true);
    // Bob still casts at sorcery speed in his own main phase.
    g = toStep(g, 'main1', 'bob');
    expect(legalActions(g, 'bob').some((a) => a.type === 'cast' && a.object === opt)).toBe(true);
  });

  it("Mishra's Bauble: look, then a delayed draw", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bauble = give(g, 'alice', 'Bauble', 'battlefield');
    g = act(g, { type: 'activate', player: 'alice', object: bauble, ability: 0, targets: [[{ kind: 'player', player: 'bob' }]] });
    g = settle(g);
    expect(g.pending?.kind).toBe('choose_objects');
    expect((g.pending as { seen?: string[] }).seen).toEqual([g.zones.library.bob![0]]);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [] } }));
    const hand = g.zones.hand.alice!.length;
    g = toStep(g, 'draw', 'bob');
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('Charismatic Conqueror: tap it, or a Vampire for you', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Conqueror', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'hand');
    g = settle(act(g, { type: 'cast', player: 'bob', object: bear }));
    expect(g.pending?.kind).toBe('may');
    expect(g.pending?.player).toBe('bob');
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'may', yes: true } }));
    expect(g.objects[bear]!.tapped).toBe(true);
    const bear2 = give(g, 'bob', 'Bear', 'hand');
    g = settle(act(g, { type: 'cast', player: 'bob', object: bear2 }));
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'may', yes: false } }));
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice')).toHaveLength(1);
  });
});
