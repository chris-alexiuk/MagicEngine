import { describe, expect, it } from 'vitest';
import type { GameEvent, GameState } from '../src/index.js';
import { act, actWithEvents, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Sentinel', type_line: 'Artifact Creature — Human Soldier', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is this creature's power." }),
  makeCard({ name: 'Ping', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'You gain 1 life.' }),
  makeCard({ name: 'Denial', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Counter target spell. Its controller may draw up to two cards at the beginning of the next turn's upkeep.\nYou draw a card at the beginning of the next turn's upkeep." }),
  makeCard({ name: 'Idol', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}: Draw a card. Activate only if you created a token this turn.' }),
  makeCard({ name: 'Consuls', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Creatures your opponents control enter tapped.' }),
  makeCard({ name: 'Grizzly Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Dryad', type_line: 'Enchantment Creature — Dryad', mana_cost: '{0}', power: '2', toughness: '4', oracle_text: 'Lands you control are every basic land type in addition to their other types.' }),
  makeCard({ name: 'Loran', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}: You and target opponent each draw a card.' }),
  makeCard({ name: 'Seek Kin', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Look at the top three cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in a random order. If you didn't put a card into your hand this way, draw a card." }),
  makeCard({ name: 'Muse', type_line: 'Creature — Spirit', mana_cost: '{0}', power: '2', toughness: '4', oracle_text: "Untap all permanents you control during each other player's untap step." }),
  makeCard({ name: 'Windfall', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way.' }),
  makeCard({ name: 'Warp', type_line: 'Instant', mana_cost: '{0}', oracle_text: "The owner of target permanent shuffles it into their library, then reveals the top card of their library. If it's a permanent card, they put it onto the battlefield." }),
  makeCard({ name: 'Make Clue', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Create a Clue token.' }),
];

function passBoth(g: GameState): GameState {
  const first = g.priority!;
  g = act(g, { type: 'pass', player: first });
  return act(g, { type: 'pass', player: g.priority! });
}

describe('staples (slices 100–103)', () => {
  it('Esper Sentinel: only the first noncreature spell; "unless that player pays {X}" (X = its power)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Sentinel', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Ping', 'hand') });
    // The trigger goes on the stack above Ping; bob is asked to pay {1} as it resolves.
    for (let i = 0; i < 6 && g.pending?.kind !== 'pay'; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.pending).toMatchObject({ kind: 'pay', player: 'bob', cost: '{1}' });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'pay', pay: false } });
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
    while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
    const triggers = g.stack.length;
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Ping', 'hand') });
    expect(g.stack.length).toBe(triggers + 1);
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.pending).toBeNull();
  });

  it('Arcane Denial: its controller may draw up to two at the next upkeep; you draw one', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ping', 'hand') });
    g = act(g, { type: 'pass', player: 'alice' });
    const ping = g.stack[0]!.kind === 'spell' ? g.stack[0]!.object : '';
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Denial', 'hand'), targets: [[{ kind: 'object', object: ping }]] });
    g = passBoth(g);
    expect(g.stack.length).toBe(0);
    const aliceHand = g.zones.hand.alice!.length;
    const bobHand = g.zones.hand.bob!.length;
    g = toStep(g, 'upkeep', 'bob');
    for (let i = 0; i < 20 && !(g.step === 'draw'); i++) {
      if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'may', yes: true } });
      else if (g.pending?.kind === 'choose_option') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'choose_option', choice: '2' } });
      else if (g.pending) throw new Error(g.pending.kind);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.zones.hand.alice!.length).toBe(aliceHand + 2);
    expect(g.zones.hand.bob!.length).toBeGreaterThanOrEqual(bobHand + 1);
  });

  it('Idol of Oblivion: "Activate only if you created a token this turn."', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const idol = give(g, 'alice', 'Idol', 'battlefield');
    expect(illegal(g, { type: 'activate', player: 'alice', object: idol, ability: 0 })).toBeTruthy();
    g = passBoth(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Make Clue', 'hand') }));
    g = act(g, { type: 'activate', player: 'alice', object: idol, ability: 0 });
    expect(g.stack.length).toBe(1);
  });

  it('"Creatures your opponents control enter tapped."', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Consuls', 'battlefield');
    const cub = give(g, 'bob', 'Grizzly Cub', 'hand');
    g = passBoth(act(g, { type: 'cast', player: 'bob', object: cub }));
    expect(g.objects[cub]!.tapped).toBe(true);
    g = toStep(g, 'main1', 'alice');
    const mine = give(g, 'alice', 'Grizzly Cub', 'hand');
    g = passBoth(act(g, { type: 'cast', player: 'alice', object: mine }));
    expect(g.objects[mine]!.tapped).toBe(false);
  });

  it('Dryad: lands you control have every basic land type (and their mana abilities)', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Dryad', 'battlefield');
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    const colors = [0, 1, 2, 3, 4].map((ability) => {
      const r = act(g, { type: 'activate_mana', player: 'alice', object: forest, ability });
      return (['W', 'U', 'B', 'R', 'G'] as const).find((c) => r.players.alice!.pool[c] === 1);
    });
    expect([...colors].sort()).toEqual(['B', 'G', 'R', 'U', 'W']);
  });

  it('Loran: "You and target opponent each draw a card."', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const loran = give(g, 'alice', 'Loran', 'battlefield');
    const a = g.zones.hand.alice!.length;
    const b = g.zones.hand.bob!.length;
    g = passBoth(act(g, { type: 'activate', player: 'alice', object: loran, ability: 0, targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.zones.hand.alice!.length).toBe(a + 1);
    expect(g.zones.hand.bob!.length).toBe(b + 1);
  });

  it('"If you didn\'t put a card into your hand this way, draw a card."', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Seek Kin', 'hand') });
    g = passBoth(g);
    // A deck of Forests: no creature card among them, so nothing is chosen — and a card is drawn instead.
    if (g.pending?.kind === 'choose_objects') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [] } });
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it("Seedborn Muse: untap during each other player's untap step", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Muse', 'battlefield');
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    g.objects[forest]!.tapped = true;
    g = toStep(g, 'upkeep', 'bob');
    expect(g.objects[forest]!.tapped).toBe(false);
  });

  it('Windfall: everyone draws as many as the most anyone discarded', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (let i = 0; i < 3; i++) give(g, 'bob', 'Ping', 'hand');
    const bob = g.zones.hand.bob!.length;
    g = passBoth(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Windfall', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(bob);
    expect(g.zones.hand.bob!.length).toBe(bob);
  });

  it('Chaos Warp: shuffled in, then the top card onto the battlefield if it\'s a permanent card', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cub = give(g, 'bob', 'Grizzly Cub', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Warp', 'hand'), targets: [[{ kind: 'object', object: cub }]] });
    g = act(g, { type: 'pass', player: 'alice' });
    const r = actWithEvents(g, { type: 'pass', player: 'bob' });
    g = r.state;
    const revealed = r.events.find((e): e is Extract<GameEvent, { type: 'revealed' }> => e.type === 'revealed')!.objects[0]!;
    const types = g.cards[g.objects[revealed]!.card]!.faces[0]!.types;
    const permanent = types.some((t) => ['Artifact', 'Creature', 'Enchantment', 'Land', 'Planeswalker', 'Battle'].includes(t));
    expect(g.objects[revealed]!.zone).toBe(permanent ? 'battlefield' : 'library');
    if (permanent) expect(g.objects[revealed]!.controller).toBe('bob');
  });
});
