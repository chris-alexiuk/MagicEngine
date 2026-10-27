import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Winds', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Discard all the cards in your hand, then draw that many cards.' }),
  makeCard({ name: 'Flux', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each player discards any number of cards, then draws that many cards.' }),
  makeCard({ name: 'Bite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Each opponent gets two poison counters.' }),
  makeCard({ name: 'Corrupt', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Corrupt deals damage to any target equal to the number of Swamps you control. You gain life equal to the damage dealt this way.' }),
  makeCard({ name: 'Gaze', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Gaze deals damage to target player equal to the number of cards in that player's hand." }),
  makeCard({ name: 'Blitz', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Blitz deals 4 damage to target creature or planeswalker. If that creature or planeswalker would die this turn, exile it instead.' }),
  makeCard({ name: 'Doran', type_line: 'Creature — Treefolk Shaman', mana_cost: '{0}', power: '0', toughness: '5', oracle_text: 'Each creature assigns combat damage equal to its toughness rather than its power.' }),
  makeCard({ name: 'Cryoclasm', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Destroy target Plains or Island. Cryoclasm deals 3 damage to that land\'s controller.' }),
  makeCard({ name: 'Marsh', type_line: 'Basic Land — Swamp', mana_cost: '', oracle_text: '({T}: Add {B}.)' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 30 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}

describe('staples (slice 150)', () => {
  it('Tolarian Winds: discard your hand, draw that many', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const winds = give(g, 'alice', 'Winds', 'hand');
    const before = g.zones.hand.alice!.filter((id) => id !== winds);
    g = settle(act(g, { type: 'cast', player: 'alice', object: winds }));
    expect(g.zones.hand.alice!.length).toBe(before.length);
    expect(before.every((id) => g.objects[id]!.zone === 'graveyard')).toBe(true);
  });

  it('Flux: each player chooses how many to discard', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const flux = give(g, 'alice', 'Flux', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: flux }));
    expect(g.pending).toMatchObject({ kind: 'choose_objects', player: 'alice' });
    const two = g.zones.hand.alice!.slice(0, 2);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: two } });
    expect(g.pending).toMatchObject({ kind: 'choose_objects', player: 'bob' });
    const bobHand = g.zones.hand.bob!.length;
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'choose_objects', objects: [] } }));
    expect(two.every((id) => g.objects[id]!.zone === 'graveyard')).toBe(true);
    expect(g.zones.hand.bob!.length).toBe(bobHand);
  });

  it('poison counters as an effect', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bite', 'hand') }));
    expect(g.players.bob!.poison).toBe(2);
    expect(g.players.alice!.poison).toBe(0);
  });

  it('"the damage dealt this way"; damage equal to the cards in that player\'s hand', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Marsh', 'battlefield');
    give(g, 'alice', 'Marsh', 'battlefield');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Corrupt', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.players.alice!.life).toBe(life + 2);
    const bobLife = g.players.bob!.life;
    const n = g.zones.hand.bob!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Gaze', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.players.bob!.life).toBe(bobLife - n);
  });

  it('"If that creature or planeswalker would die this turn, exile it instead"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Blitz', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[bear]!.zone).toBe('exile');
  });

  it('Doran: creatures assign combat damage equal to their toughness', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const doran = give(g, 'alice', 'Doran', 'battlefield');
    g = toStep(g, 'beginning_of_combat');
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    const life = g.players.bob!.life;
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: doran, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 20 && g.step !== 'end_of_combat' && g.step !== 'main2'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } } as never);
      else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
      else break;
    }
    expect(g.players.bob!.life).toBe(life - 5);
  });

  it("Cryoclasm: damage to that land's controller", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const island = give(g, 'bob', 'Island', 'battlefield');
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Cryoclasm', 'hand'), targets: [[{ kind: 'object', object: island }]] }));
    expect(g.objects[island]!.zone).toBe('graveyard');
    expect(g.players.bob!.life).toBe(life - 3);
  });
});
