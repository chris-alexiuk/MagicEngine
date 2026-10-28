import { describe, expect, it } from 'vitest';
import { chars } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Soul Shatter', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Each opponent sacrifices a creature or planeswalker with the greatest mana value among creatures and planeswalkers they control.' }),
  makeCard({ name: 'Ad Nauseam', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Reveal the top card of your library and put that card into your hand. You lose life equal to its mana value. You may repeat this process any number of times.' }),
  makeCard({ name: 'Scapeshift', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Sacrifice any number of lands. Search your library for up to that many land cards, put them onto the battlefield tapped, then shuffle.' }),
  makeCard({ name: 'City of Traitors', type_line: 'Land', oracle_text: 'When you play another land, sacrifice City of Traitors.\n{T}: Add {C}{C}.' }),
  makeCard({ name: 'Rosie Cotton of South Lane', type_line: 'Legendary Creature — Halfling Peasant', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "When Rosie Cotton enters, create a Food token. (It's an artifact with \"{2}, {T}, Sacrifice this token: You gain 3 life.\")\nWhenever you create a token, put a +1/+1 counter on target creature you control other than Rosie Cotton." }),
  makeCard({ name: 'Skyclave Apparition', type_line: 'Creature — Kor Spirit', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "When this creature enters, exile up to one target nonland, nontoken permanent you don't control with mana value 4 or less.\nWhen this creature leaves the battlefield, the exiled card's owner creates an X/X blue Illusion creature token, where X is the mana value of the exiled card." }),
  makeCard({ name: 'Tribute to Hunger', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Target opponent sacrifices a creature of their choice. You gain life equal to that creature's toughness." }),
  makeCard({ name: 'Metallurgic Summonings', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Whenever you cast an instant or sorcery spell, create an X/X colorless Construct artifact creature token, where X is that spell's mana value." }),
  makeCard({ name: 'Wurmcalling', type_line: 'Sorcery', mana_cost: '{X}{G}', cmc: 1, colors: ['G'], color_identity: ['G'], oracle_text: 'Create an X/X green Wurm creature token.' }),
  makeCard({ name: 'Murder', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target creature.' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Ox', type_line: 'Creature — Ox', mana_cost: '{3}', cmc: 3, power: '2', toughness: '4', oracle_text: '' }),
  makeCard({ name: 'Titan', type_line: 'Creature — Giant', mana_cost: '{5}', cmc: 5, power: '6', toughness: '6', oracle_text: '' }),
  makeCard({ name: 'Relic', type_line: 'Artifact', mana_cost: '{3}', cmc: 3, oracle_text: '' }),
  makeCard({ name: 'Ponder', type_line: 'Sorcery', mana_cost: '{1}{U}', cmc: 2, colors: ['U'], color_identity: ['U'], oracle_text: 'Draw a card.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const toTop = (g: GameState, p: string, id: string) => {
  const lib = g.zones.library[p]!;
  if (lib.includes(id)) lib.splice(lib.indexOf(id), 1);
  lib.unshift(id);
};
const tokensOf = (g: GameState, p: string) => g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === p);

describe('staples (slice 164)', () => {
  it('Soul Shatter: the greatest mana value among creatures and planeswalkers', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const titan = give(g, 'bob', 'Titan', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Soul Shatter', 'hand') }));
    if (g.pending?.kind === 'sacrifice') g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'sacrifice', objects: [titan] } } as never));
    expect(g.objects[titan]!.zone).toBe('graveyard');
    expect(g.objects[bear]!.zone).toBe('battlefield');
  });

  it('Ad Nauseam: a card and its mana value in life, as many times as you like', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const relic = give(g, 'alice', 'Relic', 'library');
    const ox = give(g, 'alice', 'Ox', 'library');
    toTop(g, 'alice', relic);
    toTop(g, 'alice', ox);
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ad Nauseam', 'hand') }));
    expect(g.objects[ox]!.zone).toBe('hand');
    expect(g.players.alice!.life).toBe(life - 3);
    expect(g.pending?.kind).toBe('may');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    expect(g.objects[relic]!.zone).toBe('hand');
    expect(g.players.alice!.life).toBe(life - 6);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: false } }));
    expect(g.stack).toHaveLength(0);
    expect(g.players.alice!.life).toBe(life - 6);
  });

  it('Scapeshift: as many lands back as were sacrificed', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lands = g.zones.battlefield.filter((id) => g.objects[id]!.controller === 'alice' && chars(g, g.objects[id]!).types.includes('Land'));
    const mine = lands.length ? lands : [give(g, 'alice', 'Forest', 'battlefield'), give(g, 'alice', 'Forest', 'battlefield')];
    const two = mine.slice(0, 2);
    const before = g.zones.library.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Scapeshift', 'hand') }));
    expect(g.pending?.kind).toBe('choose_objects');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: two } });
    for (const id of two) expect(g.objects[id]!.zone).toBe('graveyard');
    expect(g.pending?.kind).toBe('search');
    const found = (g.pending as { candidates: string[] }).candidates.slice(0, 3);
    // No more than the lands sacrificed.
    expect(() => act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: found } } as never)).toThrow();
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: found.slice(0, 2) } } as never));
    expect(g.zones.library.alice!.length).toBe(before - 2);
    for (const id of found.slice(0, 2)) expect(g.objects[id]!.tapped).toBe(true);
  });

  it('City of Traitors: sacrificed when you play another land', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const city = give(g, 'alice', 'City of Traitors', 'battlefield');
    g = settle(act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Forest', 'hand') }));
    expect(g.objects[city]!.zone).toBe('graveyard');
  });

  it('Rosie Cotton: a counter on another creature whenever you create a token', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const rosie = give(g, 'alice', 'Rosie Cotton of South Lane', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: rosie }));
    // The Food token's creation triggers her second ability: only the Bear can be the target.
    for (let i = 0; i < 4 && g.pending?.kind === 'trigger_targets'; i++) {
      const p = g.pending as { kind: 'trigger_targets'; legal?: string[][] };
      if (p.legal) expect(p.legal.flat()).not.toContain(rosie);
      g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: bear }]] } }));
    }
    expect(g.objects[bear]!.counters['+1/+1']).toBe(1);
    expect(g.objects[rosie]!.counters['+1/+1'] ?? 0).toBe(0);
  });

  it('Skyclave Apparition: an X/X Illusion for the exiled card’s owner', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const relic = give(g, 'bob', 'Relic', 'battlefield');
    const sky = give(g, 'alice', 'Skyclave Apparition', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: sky }));
    if (g.pending?.kind === 'trigger_targets') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: relic }]] } }));
    expect(g.objects[relic]!.zone).toBe('exile');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder', 'hand'), targets: [[{ kind: 'object', object: sky }]] }));
    expect(g.objects[sky]!.zone).toBe('graveyard');
    const [illusion] = tokensOf(g, 'bob');
    expect(illusion).toBeDefined();
    expect(chars(g, g.objects[illusion!]!).power).toBe(3);
    expect(chars(g, g.objects[illusion!]!).toughness).toBe(3);
    expect(chars(g, g.objects[illusion!]!).subtypes).toContain('Illusion');
    expect(tokensOf(g, 'alice')).toHaveLength(0);
  });

  it('Skyclave Apparition: nothing exiled, no token', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const sky = give(g, 'alice', 'Skyclave Apparition', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder', 'hand'), targets: [[{ kind: 'object', object: sky }]] }));
    expect(tokensOf(g, 'bob')).toHaveLength(0);
    expect(tokensOf(g, 'alice')).toHaveLength(0);
  });

  it('Tribute to Hunger: life equal to the sacrificed creature’s toughness', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ox = give(g, 'bob', 'Ox', 'battlefield');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Tribute to Hunger', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    if (g.pending?.kind === 'sacrifice') g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'sacrifice', objects: [ox] } } as never));
    expect(g.objects[ox]!.zone).toBe('graveyard');
    expect(g.players.alice!.life).toBe(life + 4);
  });

  it('Metallurgic Summonings: an X/X Construct the size of the spell’s mana value', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Metallurgic Summonings', 'battlefield');
    g.players.alice!.pool.U = 1;
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ponder', 'hand') }));
    const [construct] = tokensOf(g, 'alice');
    expect(construct).toBeDefined();
    const c = chars(g, g.objects[construct!]!);
    expect([c.power, c.toughness]).toEqual([2, 2]);
    expect(c.types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
  });

  it('Wurmcalling: X/X with the X paid', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.players.alice!.pool.G = 1;
    g.players.alice!.pool.C = 4;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Wurmcalling', 'hand'), x: 4 }));
    const [wurm] = tokensOf(g, 'alice');
    expect(chars(g, g.objects[wurm!]!).power).toBe(4);
    expect(chars(g, g.objects[wurm!]!).toughness).toBe(4);
  });
});
