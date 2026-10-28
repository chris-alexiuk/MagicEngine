import { describe, expect, it } from 'vitest';
import { hasKeyword, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Stunner', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Tap target creature. Put two stun counters on it.' }),
  makeCard({ name: 'Wings', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Put a flying counter on target creature.' }),
  makeCard({ name: 'Scavenging Ooze', type_line: 'Creature — Ooze', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '{G}: Exile target card from a graveyard. If it was a creature card, put a +1/+1 counter on this creature and you gain 1 life.' }),
  makeCard({ name: "Uro, Titan of Nature's Wrath", type_line: 'Legendary Creature — Elder Giant', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: 'When Uro enters, sacrifice it unless it escaped.\nEscape—{0}, Exile five other cards from your graveyard.' }),
  makeCard({ name: 'Unstoppable Slasher', type_line: 'Creature — Zombie Assassin', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: "When this creature dies, if it had no counters on it, return it to the battlefield tapped under its owner's control with two stun counters on it." }),
  makeCard({ name: 'Desynchronization', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Return each nonland permanent that's not historic to its owner's hand." }),
  makeCard({ name: 'Guide of Souls', type_line: 'Creature — Human Cleric', mana_cost: '{0}', power: '1', toughness: '2', oracle_text: 'Whenever another creature you control enters, you gain 1 life and get {E}.' }),
  makeCard({ name: 'Ugin, the Spirit Dragon', type_line: 'Legendary Planeswalker — Ugin', mana_cost: '{0}', loyalty: '7', oracle_text: "−X: Exile each permanent with mana value X or less that's one or more colors." }),
  makeCard({ name: 'Day of Black Sun', type_line: 'Sorcery', mana_cost: '{X}', oracle_text: 'Until end of turn, each creature with mana value X or less loses all abilities and gets -X/-X.' }),
  makeCard({ name: 'Teferi, Time Raveler', type_line: 'Legendary Planeswalker — Teferi', mana_cost: '{0}', loyalty: '4', oracle_text: 'Each opponent can cast spells only any time they could cast a sorcery.' }),
  makeCard({ name: 'Think Back', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Draw a card.\nFlashback {0}' }),
  makeCard({ name: 'Murder', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target creature.' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{4}{R}', cmc: 5, colors: ['R'], power: '5', toughness: '5', oracle_text: '' }),
  makeCard({ name: 'Relic', type_line: 'Artifact', mana_cost: '{1}', cmc: 1, oracle_text: '' }),
  makeCard({ name: 'Charm', type_line: 'Enchantment', mana_cost: '{W}', cmc: 1, colors: ['W'], oracle_text: '' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const obj = (id: string) => ({ kind: 'object' as const, object: id });

describe('staples (slice 173)', () => {
  it('stun counters: instead of untapping, a stun counter is removed (CR 122.1d)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Stunner', 'hand'), targets: [[obj(bear)]] }));
    expect(g.objects[bear]!.tapped).toBe(true);
    g = toStep(g, 'main1', 'bob');
    expect(g.objects[bear]!.tapped).toBe(true);
    expect(g.objects[bear]!.counters.stun).toBe(1);
    g = toStep(toStep(g, 'main1', 'alice'), 'main1', 'bob');
    expect(g.objects[bear]!.tapped).toBe(true);
    expect(g.objects[bear]!.counters.stun ?? 0).toBe(0);
    g = toStep(toStep(g, 'main1', 'alice'), 'main1', 'bob');
    expect(g.objects[bear]!.tapped).toBe(false);
  });

  it('a flying counter gives flying (CR 122.1b)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Wings', 'hand'), targets: [[obj(bear)]] }));
    expect(hasKeyword(g, g.objects[bear]!, 'flying')).toBe(true);
  });

  it('Scavenging Ooze: a creature card exiled grows it; another card doesn\'t', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ooze = give(g, 'alice', 'Scavenging Ooze', 'battlefield');
    const dead = give(g, 'bob', 'Bear', 'graveyard');
    const spell = give(g, 'bob', 'Murder', 'graveyard');
    const life = g.players.alice!.life;
    g.players.alice!.pool.G = 2;
    g = settle(act(g, { type: 'activate', player: 'alice', object: ooze, ability: 0, targets: [[obj(dead)]] }));
    g = settle(act(g, { type: 'activate', player: 'alice', object: ooze, ability: 0, targets: [[obj(spell)]] }));
    expect(g.objects[dead]!.zone).toBe('exile');
    expect(g.objects[spell]!.zone).toBe('exile');
    expect(g.objects[ooze]!.counters['+1/+1']).toBe(1);
    expect(g.players.alice!.life).toBe(life + 1);
  });

  it('Uro: sacrificed unless it escaped', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const uro = give(g, 'alice', "Uro, Titan of Nature's Wrath", 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: uro }));
    expect(g.objects[uro]!.zone).toBe('graveyard');
    for (let i = 0; i < 5; i++) give(g, 'alice', 'Relic', 'graveyard');
    const offer = legalActions(g, 'alice').find((a) => a.type === 'cast' && a.object === uro);
    expect(offer).toMatchObject({ alt: 'escape' });
    g = settle(act(g, offer!));
    expect(g.objects[uro]!.zone).toBe('battlefield');
  });

  it('Unstoppable Slasher: returns with stun counters if it had no counters', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const slasher = give(g, 'alice', 'Unstoppable Slasher', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder', 'hand'), targets: [[obj(slasher)]] }));
    expect(g.objects[slasher]!.zone).toBe('battlefield');
    expect(g.objects[slasher]!.tapped).toBe(true);
    expect(g.objects[slasher]!.counters.stun).toBe(2);
    // With counters on it this time, it stays dead.
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder', 'hand'), targets: [[obj(slasher)]] }));
    expect(g.objects[slasher]!.zone).toBe('graveyard');
  });

  it("Desynchronization: nonland permanents that aren't historic return", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const relic = give(g, 'bob', 'Relic', 'battlefield');
    const uro = give(g, 'alice', "Uro, Titan of Nature's Wrath", 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Desynchronization', 'hand') }));
    expect(g.objects[bear]!.zone).toBe('hand');
    expect(g.objects[relic]!.zone).toBe('battlefield');
    expect(g.objects[uro]!.zone).toBe('battlefield');
  });

  it('Guide of Souls: a life and an energy counter', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Guide of Souls', 'battlefield');
    const life = g.players.alice!.life;
    g.players.alice!.pool.R = 1;
    g.players.alice!.pool.C = 4;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ogre', 'hand') }));
    expect(g.players.alice!.life).toBe(life + 1);
    expect(g.players.alice!.counters?.energy).toBe(1);
  });

  it('Ugin −X: exiles colored permanents with mana value X or less', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ugin = give(g, 'alice', 'Ugin, the Spirit Dragon', 'battlefield');
    g.objects[ugin]!.counters.loyalty = 7;
    const [bear, ogre, relic, charm] = ['Bear', 'Ogre', 'Relic', 'Charm'].map((n) => give(g, 'bob', n, 'battlefield'));
    g = settle(act(g, { type: 'activate', player: 'alice', object: ugin, ability: 0, x: 3 }));
    expect(g.objects[ugin]!.counters.loyalty).toBe(4);
    expect(g.objects[bear!]!.zone).toBe('exile');
    expect(g.objects[charm!]!.zone).toBe('exile');
    expect(g.objects[ogre!]!.zone).toBe('battlefield');
    expect(g.objects[relic!]!.zone).toBe('battlefield');
    expect(() => act(g, { type: 'activate', player: 'alice', object: ugin, ability: 0, x: 9 })).toThrow();
  });

  it('Day of Black Sun: "mana value X or less" is the X paid', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Day of Black Sun', 'hand'), x: 2 }));
    expect(g.objects[bear]!.zone).toBe('graveyard');
    expect(g.objects[ogre]!.zone).toBe('battlefield');
  });

  it("Teferi, Time Raveler: an opponent's flashback isn't offered at instant speed", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const teferi = give(g, 'alice', 'Teferi, Time Raveler', 'battlefield');
    g.objects[teferi]!.counters.loyalty = 4;
    const fb = give(g, 'bob', 'Think Back', 'graveyard');
    g = act(g, { type: 'pass', player: 'alice' });
    expect(g.priority).toBe('bob');
    expect(legalActions(g, 'bob').some((a) => a.type === 'cast' && a.object === fb)).toBe(false);
  });
});
