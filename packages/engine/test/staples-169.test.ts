import { describe, expect, it } from 'vitest';
import { chars, hasKeyword } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Fabled Passage', type_line: 'Land', oracle_text: '{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Then if you control four or more lands, untap that land.' }),
  makeCard({ name: 'Dispatch', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Tap target creature.\nMetalcraft — If you control three or more artifacts, exile that creature.' }),
  makeCard({ name: 'Hesitation', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'When a player casts a spell, sacrifice this enchantment and counter that spell.' }),
  makeCard({ name: 'Grave Peril', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'When a nonblack creature enters, sacrifice this enchantment. If you do, destroy that creature.' }),
  makeCard({ name: 'Shadowheart', type_line: 'Legendary Creature — Human Elf Cleric', mana_cost: '{0}', power: '1', toughness: '4', oracle_text: "{1}{B}, {T}, Sacrifice another creature: Draw X cards, where X is that creature's power." }),
  makeCard({ name: 'Renegade Doppelganger', type_line: 'Creature — Shapeshifter', mana_cost: '{0}', power: '0', toughness: '1', oracle_text: 'Whenever another creature you control enters, you may have this creature become a copy of that creature until end of turn.' }),
  makeCard({ name: 'Savage Order', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Search your library for a Dinosaur creature card, put it onto the battlefield, then shuffle. It gains indestructible until your next turn.' }),
  makeCard({ name: 'Hellhole Rats', type_line: 'Creature — Rat', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "Haste\nWhen this creature enters, target player discards a card. This creature deals damage to that player equal to that card's mana value." }),
  makeCard({ name: 'Rush of Blood', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Target creature gets +X/+0 until end of turn, where X is its power.' }),
  makeCard({ name: 'Fierce Invocation', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Manifest the top card of your library, then put two +1/+1 counters on it.' }),
  makeCard({ name: 'Momentous Fall', type_line: 'Instant', mana_cost: '{0}', oracle_text: "As an additional cost to cast this spell, sacrifice a creature.\nYou draw cards equal to the sacrificed creature's power, then you gain life equal to its toughness." }),
  makeCard({ name: 'Relic', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '' }),
  makeCard({ name: 'Big Relic', type_line: 'Artifact', mana_cost: '{3}', cmc: 3, oracle_text: '' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: '' }),
  makeCard({ name: 'Dino', type_line: 'Creature — Dinosaur', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: '' }),
  makeCard({ name: 'Divination', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw two cards.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const lands = (g: GameState, p: string) => g.zones.battlefield.filter((id) => g.objects[id]!.controller === p && chars(g, g.objects[id]!).types.includes('Land'));

describe('staples (slice 169: what "that creature" and "it" refer to)', () => {
  it('Fabled Passage: the land found is untapped with four lands', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    while (lands(g, 'alice').length < 3) give(g, 'alice', 'Forest', 'battlefield');
    const passage = give(g, 'alice', 'Fabled Passage', 'battlefield');
    g = act(g, { type: 'activate', player: 'alice', object: passage, ability: 0 });
    g = settle(g);
    expect(g.pending?.kind).toBe('search');
    const found = (g.pending as { candidates: string[] }).candidates[0]!;
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [found] } } as never));
    expect(g.objects[passage]!.zone).toBe('graveyard');
    expect(g.objects[found]!.zone).toBe('battlefield');
    // Four lands: it's untapped (it entered tapped).
    expect(g.objects[found]!.tapped).toBe(false);
  });

  it('Dispatch: exiles the target with metalcraft, not itself', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (let i = 0; i < 3; i++) give(g, 'alice', 'Relic', 'battlefield');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    const dispatch = give(g, 'alice', 'Dispatch', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: dispatch, targets: [[{ kind: 'object', object: ogre }]] }));
    expect(g.objects[ogre]!.zone).toBe('exile');
    expect(g.objects[dispatch]!.zone).toBe('graveyard');
  });

  it('Hesitation: counters the spell cast, sacrificing itself', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const hes = give(g, 'alice', 'Hesitation', 'battlefield');
    const div = give(g, 'bob', 'Divination', 'hand');
    g = settle(act(g, { type: 'cast', player: 'bob', object: div }));
    expect(g.objects[hes]!.zone).toBe('graveyard');
    expect(g.objects[div]!.zone).toBe('graveyard');
    expect(g.zones.hand.bob).not.toContain(div);
  });

  it('Grave Peril: destroys the creature that entered', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const peril = give(g, 'alice', 'Grave Peril', 'battlefield');
    g.players.bob!.pool.G = 1;
    g.players.bob!.pool.C = 1;
    const bear = give(g, 'bob', 'Bear', 'hand');
    g = settle(act(g, { type: 'cast', player: 'bob', object: bear }));
    expect(g.objects[peril]!.zone).toBe('graveyard');
    expect(g.objects[bear]!.zone).toBe('graveyard');
  });

  it("Shadowheart: X is the sacrificed creature's power", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const heart = give(g, 'alice', 'Shadowheart', 'battlefield');
    g.objects[heart]!.sick = false;
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g.players.alice!.pool.B = 1;
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'activate', player: 'alice', object: heart, ability: 0, costs: { sacrifice: [ogre] } }));
    expect(g.zones.hand.alice!.length).toBe(hand + 5);
  });

  it('Renegade Doppelganger: a copy of the creature that entered', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const dop = give(g, 'alice', 'Renegade Doppelganger', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ogre', 'hand') }));
    if (g.pending?.kind === 'may') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    expect(chars(g, g.objects[dop]!).name).toBe('Ogre');
  });

  it('Savage Order: the Dinosaur found gains indestructible', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const dino = give(g, 'alice', 'Dino', 'library');
    const order = give(g, 'alice', 'Savage Order', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: order }));
    if (g.pending?.kind === 'search') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [dino] } } as never));
    expect(g.objects[dino]!.zone).toBe('battlefield');
    expect(hasKeyword(g, g.objects[dino]!, 'indestructible')).toBe(true);
  });

  it("Hellhole Rats: damage equal to the discarded card's mana value", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.zones.hand.bob!.length = 0;
    const relic = give(g, 'bob', 'Big Relic', 'hand');
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Hellhole Rats', 'hand') }));
    if (g.pending?.kind === 'trigger_targets') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } }));
    expect(g.objects[relic]!.zone).toBe('graveyard');
    expect(g.players.bob!.life).toBe(life - 3);
  });

  it("Rush of Blood: X is the target's power", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Rush of Blood', 'hand'), targets: [[{ kind: 'object', object: ogre }]] }));
    expect(chars(g, g.objects[ogre]!).power).toBe(10);
  });

  it('Fierce Invocation: the counters go on the manifested card', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const top = g.zones.library.alice![0]!;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Fierce Invocation', 'hand') }));
    expect(g.objects[top]!.zone).toBe('battlefield');
    expect(g.objects[top]!.counters['+1/+1']).toBe(2);
  });

  it("Momentous Fall: the sacrificed creature's power and toughness", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    const [hand, life] = [g.zones.hand.alice!.length, g.players.alice!.life];
    const fall = give(g, 'alice', 'Momentous Fall', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: fall, costs: { sacrifice: [ogre] } }));
    expect(g.zones.hand.alice!.length).toBe(hand + 5);
    expect(g.players.alice!.life).toBe(life + 5);
  });
});
