import { describe, expect, it } from 'vitest';
import { chars } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Trouble in Pairs', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'If an opponent would begin an extra turn, that player skips that turn instead.\nWhenever an opponent attacks you with two or more creatures, draws their second card each turn, or casts their second spell each turn, you draw a card.' }),
  makeCard({ name: 'Time Walk', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Take an extra turn after this one.' }),
  makeCard({ name: 'Spelunking', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'When this enchantment enters, draw a card, then you may put a land card from your hand onto the battlefield. If you put a Cave onto the battlefield this way, you gain 4 life.\nLands you control enter untapped.' }),
  makeCard({ name: 'Tapland', type_line: 'Land', mana_cost: '', oracle_text: 'This land enters tapped.\n{T}: Add {G}.' }),
  makeCard({ name: 'Cave Land', type_line: 'Land — Cave', mana_cost: '', oracle_text: '{T}: Add {C}.' }),
  makeCard({ name: 'Kutzil, Malamet Exemplar', type_line: 'Legendary Creature — Cat Warrior', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: "Whenever one or more creatures you control each with power greater than its base power deals combat damage to a player, draw a card." }),
  makeCard({ name: 'Loot', type_line: 'Legendary Creature — Beast Noble', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{T}: Look at the top six cards of your library. You may reveal a creature card with mana value less than or equal to the number of lands you control from among them and put it onto the battlefield. Put the rest on the bottom in a random order.' }),
  makeCard({ name: 'Vicious Offering', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Kicker—Sacrifice a creature.\nTarget creature gets -2/-2 until end of turn. If this spell was kicked, that creature gets -5/-5 until end of turn instead.' }),
  makeCard({ name: 'Banner of Kinship', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'As this artifact enters, choose a creature type. This artifact enters with a fellowship counter on it for each creature you control of the chosen type.\nCreatures you control of the chosen type get +1/+1 for each fellowship counter on this artifact.' }),
  makeCard({ name: 'Forgotten Ancient', type_line: 'Creature — Elemental', mana_cost: '{0}', power: '0', toughness: '3', oracle_text: 'At the beginning of your upkeep, you may move any number of +1/+1 counters from this creature onto other creatures.' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Big Beast', type_line: 'Creature — Beast', mana_cost: '{4}', cmc: 4, power: '4', toughness: '4', oracle_text: '' }),
  makeCard({ name: 'Huge Beast', type_line: 'Creature — Beast', mana_cost: '{6}', cmc: 6, power: '6', toughness: '6', oracle_text: '' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: '' }),
  makeCard({ name: 'Small Heal', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'You gain 1 life.' }),
  makeCard({ name: 'Pump', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Target creature gets +1/+0 until end of turn.' }),
];

const toAttack = (g: GameState) => {
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return g;
};
function finishCombat(g: GameState, defender: string): GameState {
  for (let i = 0; i < 40 && g.step !== 'end_of_combat' && g.step !== 'main2'; i++) {
    if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: defender, answer: { kind: 'declare_blockers', blocks: [] } } as never);
    else if (g.pending) break;
    else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
    else break;
  }
  return g;
}
function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const obj = (id: string) => ({ kind: 'object' as const, object: id });

describe('staples (slice 171)', () => {
  it("Trouble in Pairs: an opponent's extra turn is skipped; their second spell draws you a card", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Trouble in Pairs', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Time Walk', 'hand') }));
    expect(g.extraTurns).toEqual(['bob']);
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Small Heal', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
    g = toStep(g, 'main1', 'alice');
    expect(g.active).toBe('alice');
    expect(g.extraTurns ?? []).toEqual([]);
  });

  it('Spelunking: a land that would enter tapped enters untapped; a Cave gains 4 life', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cave = give(g, 'alice', 'Cave Land', 'hand');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Spelunking', 'hand') }));
    if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    if (g.pending?.kind === 'choose_objects') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [cave] } });
    g = settle(g);
    expect(g.objects[cave]!.zone).toBe('battlefield');
    expect(g.players.alice!.life).toBe(life + 4);
    const tap = give(g, 'alice', 'Tapland', 'hand');
    g = act(g, { type: 'play_land', player: 'alice', object: tap } as never);
    expect(g.objects[tap]!.zone).toBe('battlefield');
    expect(g.objects[tap]!.tapped).toBe(false);
  });

  it('Kutzil: draws when a creature with power above its base power deals combat damage to a player', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Kutzil, Malamet Exemplar', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g.objects[bear]!.sick = false;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Pump', 'hand'), targets: [[obj(bear)]] }));
    const hand = g.zones.hand.alice!.length;
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: bear, target: { kind: 'player', player: 'bob' } }] } });
    g = settle(finishCombat(g, 'bob'));
    expect(g.players.bob!.life).toBe(17);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('Loot: a creature card with mana value up to the number of lands you control', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const loot = give(g, 'alice', 'Loot', 'battlefield');
    g.objects[loot]!.sick = false;
    for (let i = 0; i < 4; i++) give(g, 'alice', 'Forest', 'battlefield');
    const huge = give(g, 'alice', 'Huge Beast', 'library');
    const big = give(g, 'alice', 'Big Beast', 'library');
    // Top six: Big Beast, Huge Beast, then the rest.
    const lib = g.zones.library.alice!;
    lib.splice(lib.indexOf(big), 1);
    lib.splice(lib.indexOf(huge), 1);
    lib.unshift(big, huge);
    g = settle(act(g, { type: 'activate', player: 'alice', object: loot, ability: 0 }));
    expect(g.pending).toMatchObject({ kind: 'choose_objects' });
    expect((g.pending as { candidates: string[] }).candidates).toEqual([big]);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [big] } }));
    expect(g.objects[big]!.zone).toBe('battlefield');
    expect(g.objects[huge]!.zone).toBe('library');
  });

  it('Vicious Offering: a kicker that isn\'t mana (sacrifice a creature) kicks it', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const fodder = give(g, 'alice', 'Bear', 'battlefield');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Vicious Offering', 'hand'), extras: ['kicker'], costs: { sacrifice: [fodder] }, targets: [[obj(ogre)]] }));
    expect(g.objects[fodder]!.zone).toBe('graveyard');
    expect(g.objects[ogre]!.zone).toBe('graveyard');
  });

  it('Banner of Kinship: a fellowship counter for each creature of the chosen type, then +1/+1 each', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bears = [0, 1, 2].map(() => give(g, 'alice', 'Bear', 'battlefield'));
    give(g, 'alice', 'Ogre', 'battlefield');
    const banner = give(g, 'alice', 'Banner of Kinship', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: banner }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', choice: 'Bear' } }));
    expect(g.objects[banner]!.counters.fellowship).toBe(3);
    expect(chars(g, g.objects[bears[0]!]!).power).toBe(5);
  });

  it('Forgotten Ancient: moves +1/+1 counters one at a time onto other creatures', () => {
    let g = toStep(start({ extra: CARDS }), 'end', 'bob');
    const ancient = give(g, 'alice', 'Forgotten Ancient', 'battlefield');
    g.objects[ancient]!.counters['+1/+1'] = 3;
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    g = toStep(g, 'upkeep', 'alice');
    for (let i = 0; i < 10 && g.pending?.kind !== 'choose_objects'; i++) {
      if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [bear] } });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [ogre] } });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [] } }));
    expect(g.objects[ancient]!.counters['+1/+1']).toBe(1);
    expect(g.objects[bear]!.counters['+1/+1']).toBe(1);
    expect(g.objects[ogre]!.counters['+1/+1']).toBe(1);
  });
});
