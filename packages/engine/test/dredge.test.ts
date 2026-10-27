import { describe, expect, it } from 'vitest';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Dredger', type_line: 'Creature — Zombie', oracle_text: 'Dredge 2 (If you would draw a card, you may mill 2 cards instead. If you do, return this card from your graveyard to your hand.)', mana_cost: '{B}', power: '1', toughness: '1' }),
  makeCard({ name: 'Study', type_line: 'Sorcery', oracle_text: 'Draw two cards.', mana_cost: '{0}' }),
];

describe('CR 702.52: dredge', () => {
  it('in the draw step: mill N and return it instead of drawing', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const d = give(g, 'alice', 'Dredger', 'graveyard');
    g = toStep(g, 'upkeep', 'bob');
    // Bob's turn: Alice isn't drawing. Then Alice's draw step asks her.
    for (let i = 0; i < 200 && !(g.pending?.kind === 'dredge'); i++) {
      if (g.pending?.kind === 'declare_attackers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_attackers', attacks: [] } });
      else if (g.pending?.kind === 'discard_to_hand_size') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'discard_to_hand_size', objects: g.zones.hand[g.pending.player]!.slice(0, g.pending.count) } });
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.pending).toMatchObject({ kind: 'dredge', player: 'alice', candidates: [d] });
    const top = g.zones.library.alice!.slice(0, 2);
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'dredge', object: d } });
    expect(g.objects[d]!.zone).toBe('hand');
    expect(top.map((id) => g.objects[id]!.zone)).toEqual(['graveyard', 'graveyard']);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
    expect(g.priority).toBe('alice');
  });

  it('a draw effect asks before each draw; choosing none draws', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    give(g, 'alice', 'Dredger', 'graveyard');
    const s = give(g, 'alice', 'Study', 'hand');
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'cast', player: 'alice', object: s });
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.pending?.kind).toBe('choose_objects');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [] } });
    expect(g.pending?.kind).toBe('choose_objects');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [] } });
    expect(g.pending).toBeNull();
    expect(g.zones.hand.alice!.length).toBe(hand - 1 + 2);
  });
});
