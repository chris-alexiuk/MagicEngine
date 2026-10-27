import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Brainstorm', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Draw three cards, then put two cards from your hand on top of your library in any order.' }),
  makeCard({ name: 'Orchard', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add one mana of any color that a land an opponent controls could produce.' }),
  makeCard({ name: 'Tomb', type_line: 'Legendary Land', mana_cost: '', oracle_text: 'Each land is a Swamp in addition to its other land types.' }),
  makeCard({ name: 'Isle', type_line: 'Land — Island', mana_cost: '', oracle_text: '({T}: Add {U}.)' }),
  makeCard({ name: 'Opportunist', type_line: 'Creature — Human Rogue', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: 'Whenever one or more other creatures die, draw a card. This ability triggers only once each turn.' }),
  makeCard({ name: 'Grizzly Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Cultivate', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.' }),
  makeCard({ name: 'Wipe', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Destroy all creatures with power 2.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 30 && (g.stack.length || g.pending); i++) {
    if (g.pending) throw new Error(`pending ${g.pending.kind}`);
    g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
}

describe('staples (slice 93–94)', () => {
  it('Brainstorm: draw three, then two from hand on top in the chosen order', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Brainstorm', 'hand') });
    g = act(act(g, { type: 'pass', player: 'alice' }), { type: 'pass', player: 'bob' });
    expect(g.pending).toMatchObject({ kind: 'choose_objects', min: 2, max: 2, ordered: true });
    const [a, b] = g.zones.hand.alice!;
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [a!, b!] } });
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
    const lib = g.zones.library.alice!;
    const top = lib[lib.length - 1] === a || lib[0] === a ? a : null;
    expect(top).toBe(a);
  });

  it('Exotic Orchard: only colors an opponent\'s lands could produce', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const orchard = give(g, 'alice', 'Orchard', 'battlefield');
    give(g, 'bob', 'Isle', 'battlefield');
    const choices = legalActions(g, 'alice').filter((a) => a.type === 'activate_mana' && a.object === orchard).map((a) => (a as { choice?: unknown }).choice);
    expect(choices).toEqual(['U']);
  });

  it('Urborg: each land is a Swamp too, with the Swamp mana ability', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Tomb', 'battlefield');
    const isle = give(g, 'alice', 'Isle', 'battlefield');
    const r = act(g, { type: 'activate_mana', player: 'alice', object: isle, ability: 1 });
    expect(r.players.alice!.pool.B).toBe(1);
  });

  it('"Whenever one or more other creatures die": once for creatures dying together', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Opportunist', 'battlefield');
    give(g, 'bob', 'Grizzly Cub', 'battlefield');
    give(g, 'bob', 'Grizzly Cub', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Wipe', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('Cultivate: one onto the battlefield tapped, the other into your hand', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const hand = g.zones.hand.alice!.length;
    const field = g.zones.battlefield.length;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Cultivate', 'hand') });
    g = act(act(g, { type: 'pass', player: 'alice' }), { type: 'pass', player: 'bob' });
    expect(g.pending).toMatchObject({ kind: 'search', count: 2 });
    const p = g.pending as { candidates: string[] };
    const [a, b] = p.candidates;
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [a!, b!] } });
    expect(g.pending).toMatchObject({ kind: 'choose_objects', candidates: [a, b] });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [b!] } });
    expect(g.zones.battlefield.length).toBe(field + 1);
    expect(g.objects[b!]!.tapped).toBe(true);
    expect(g.zones.hand.alice).toContain(a);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });
});
