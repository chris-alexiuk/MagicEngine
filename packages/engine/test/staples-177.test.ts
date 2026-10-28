import { describe, expect, it } from 'vitest';
import { chars, hasKeyword, hasRule, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Gift of the Viper', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Put a +1/+1 counter, a reach counter, and a deathtouch counter on target creature. Untap it.' }),
  makeCard({ name: "Urza's Ruinous Blast", type_line: 'Legendary Sorcery', mana_cost: '{0}', oracle_text: "Exile all nonland permanents that aren't legendary." }),
  makeCard({ name: 'Winds of Rath', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Destroy all creatures that aren't enchanted. They can't be regenerated." }),
  makeCard({ name: 'Soulherder', type_line: 'Creature — Spirit', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Whenever a creature is exiled from the battlefield, put a +1/+1 counter on this creature.' }),
  makeCard({ name: 'Fathom Mage', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Whenever a +1/+1 counter is put on this creature, you may draw a card.' }),
  makeCard({ name: 'Massacre Girl, Known Killer', type_line: 'Legendary Creature — Human Assassin', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: 'Whenever a creature an opponent controls dies, if its toughness was less than 1, draw a card.' }),
  makeCard({ name: 'Blood Money', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Destroy all creatures. For each nontoken creature destroyed this way, you create a tapped Treasure token.' }),
  makeCard({ name: 'Tetsuko Umezawa, Fugitive', type_line: 'Legendary Creature — Human Rogue', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: "Creatures you control with power or toughness 1 or less can't be blocked." }),
  makeCard({ name: "Multani, Yavimaya's Avatar", type_line: 'Legendary Creature — Elemental Avatar', mana_cost: '{0}', power: '0', toughness: '0', oracle_text: 'Multani gets +1/+1 for each land you control and each land card in your graveyard.' }),
  makeCard({ name: 'Gleaming Splendor', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: '{0}: Two target players each draw a card.' }),
  makeCard({ name: 'Song of the Dryads', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant permanent\nEnchanted permanent is a colorless Forest land.' }),
  makeCard({ name: 'Leyline of the Guildpact', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Each nonland permanent you control is all colors.' }),
  makeCard({ name: 'Phyrexian Obliterator', type_line: 'Creature — Phyrexian Horror', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: "Trample\nWhenever a source deals damage to this creature, that source's controller sacrifices that many permanents of their choice." }),
  makeCard({ name: 'Kazuul, Tyrant of the Cliffs', type_line: 'Legendary Creature — Ogre Warrior', mana_cost: '{0}', power: '5', toughness: '4', oracle_text: "Whenever a creature an opponent controls attacks, if you're the defending player, create a 3/3 red Ogre creature token unless that creature's controller pays {3}." }),
  makeCard({ name: 'Ingenious Artillerist', type_line: 'Creature — Human Artificer', mana_cost: '{0}', power: '3', toughness: '1', oracle_text: 'Whenever one or more artifacts you control enter, this creature deals that much damage to each opponent.' }),
  makeCard({ name: 'Runaway Steam-Kin', type_line: 'Creature — Elemental', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Whenever you cast a red spell, if this creature has fewer than three +1/+1 counters on it, put a +1/+1 counter on this creature.' }),
  makeCard({ name: 'Platinum Angel', type_line: 'Artifact Creature — Angel', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: "Flying\nYou can't lose the game and your opponents can't win the game." }),
  makeCard({ name: 'Pump', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Target creature gets +2/+0 until end of turn.' }),
  makeCard({ name: 'Weaken', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Target creature gets -1/-0 until end of turn.' }),
  makeCard({ name: 'Shrink', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Target creature gets -3/-3 until end of turn.' }),
  makeCard({ name: 'Bolt', type_line: 'Instant', mana_cost: '{0}', colors: ['R'], oracle_text: 'Bolt deals 3 damage to any target.' }),
  makeCard({ name: 'Exiler', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Exile target creature.' }),
  makeCard({ name: 'Grow', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Put two +1/+1 counters on target creature.' }),
  makeCard({ name: 'Two Relics', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Create two Treasure tokens.' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', colors: ['G'], power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Elder', type_line: 'Legendary Creature — Human', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Charm', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature' }),
  makeCard({ name: 'Elf', type_line: 'Creature — Elf', mana_cost: '{G}', colors: ['G'], power: '1', toughness: '1', oracle_text: 'Flying' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const obj = (id: string) => ({ kind: 'object' as const, object: id });
const named = (g: GameState, name: string) => g.zones.battlefield.filter((id) => g.cards[g.objects[id]!.card]?.name === name);
const cast = (g: GameState, player: string, name: string, targets?: unknown[][]) => settle(act(g, { type: 'cast', player, object: give(g, player, name, 'hand'), ...(targets ? { targets } : {}) } as never));

describe('staples (slice 177)', () => {
  it('Gift of the Viper: three kinds of counters at once', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = cast(g, 'alice', 'Gift of the Viper', [[obj(bear)]]);
    expect(g.objects[bear]!.counters).toMatchObject({ '+1/+1': 1, reach: 1, deathtouch: 1 });
    expect(hasKeyword(g, g.objects[bear]!, 'deathtouch')).toBe(true);
  });

  it("Urza's Ruinous Blast and Winds of Rath: legendary and enchanted ones survive", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const elder = give(g, 'alice', 'Elder', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = cast(g, 'alice', "Urza's Ruinous Blast");
    expect(g.objects[elder]!.zone).toBe('battlefield');
    expect(g.objects[bear]!.zone).toBe('exile');
    const a = give(g, 'bob', 'Bear', 'battlefield');
    const b = give(g, 'bob', 'Bear', 'battlefield');
    const charm = give(g, 'bob', 'Charm', 'battlefield');
    g.objects[charm]!.attachedTo = { id: a, zcc: g.objects[a]!.zcc };
    g = cast(g, 'alice', 'Winds of Rath');
    expect(g.objects[a]!.zone).toBe('battlefield');
    expect(g.objects[b]!.zone).toBe('graveyard');
  });

  it('Soulherder grows when a creature is exiled from the battlefield; Fathom Mage draws for each counter', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const herder = give(g, 'alice', 'Soulherder', 'battlefield');
    g = cast(g, 'alice', 'Exiler', [[obj(give(g, 'bob', 'Bear', 'battlefield'))]]);
    expect(g.objects[herder]!.counters['+1/+1']).toBe(1);
    const mage = give(g, 'alice', 'Fathom Mage', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Grow', 'hand'), targets: [[obj(mage)]] });
    for (let i = 0; i < 20 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
      else if (g.pending) break;
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    // Two counters: two cards.
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
  });

  it('Massacre Girl, Known Killer: a card when an opposing creature with toughness below 1 dies', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Massacre Girl, Known Killer', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = cast(g, 'alice', 'Bolt', [[obj(give(g, 'bob', 'Bear', 'battlefield'))]]);
    expect(g.zones.hand.alice!.length).toBe(hand);
    g = cast(g, 'alice', 'Shrink', [[obj(give(g, 'bob', 'Bear', 'battlefield'))]]);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('Blood Money: a tapped Treasure for each nontoken creature destroyed', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Bear', 'battlefield');
    give(g, 'bob', 'Bear', 'battlefield');
    g = cast(g, 'alice', 'Blood Money');
    const treasures = named(g, 'Treasure');
    expect(treasures.length).toBe(2);
    expect(treasures.every((id) => g.objects[id]!.tapped && g.objects[id]!.controller === 'alice')).toBe(true);
  });

  it("Tetsuko Umezawa: power or toughness 1 or less, by its power now (a pumped creature can be blocked)", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Tetsuko Umezawa, Fugitive', 'battlefield');
    const elf = give(g, 'alice', 'Elf', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    expect(hasRule(g, g.objects[elf]!, 'cant_be_blocked')).toBe(true);
    expect(hasRule(g, g.objects[bear]!, 'cant_be_blocked')).toBe(false);
    g = cast(g, 'alice', 'Pump', [[obj(elf)]]);
    expect(hasRule(g, g.objects[elf]!, 'cant_be_blocked')).toBe(true); // toughness is still 1
    // A 2/2 made 1/2 until end of turn (layer 7c) can't be blocked now.
    g = cast(g, 'alice', 'Weaken', [[obj(bear)]]);
    expect(hasRule(g, g.objects[bear]!, 'cant_be_blocked')).toBe(true);
  });

  it('Multani: each land you control and each land card in your graveyard', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const multani = give(g, 'alice', "Multani, Yavimaya's Avatar", 'battlefield');
    for (let i = 0; i < 3; i++) give(g, 'alice', 'Forest', 'battlefield');
    for (let i = 0; i < 2; i++) give(g, 'alice', 'Forest', 'graveyard');
    expect(chars(g, g.objects[multani]!).power).toBe(5);
  });

  it('Gleaming Splendor: two target players each draw', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const splendor = give(g, 'alice', 'Gleaming Splendor', 'battlefield');
    const [a, b] = [g.zones.hand.alice!.length, g.zones.hand.bob!.length];
    g = settle(act(g, { type: 'activate', player: 'alice', object: splendor, ability: 0, targets: [[{ kind: 'player', player: 'alice' }, { kind: 'player', player: 'bob' }]] }));
    expect([g.zones.hand.alice!.length, g.zones.hand.bob!.length]).toEqual([a + 1, b + 1]);
  });

  it('Song of the Dryads: a colorless Forest land with only a Forest\'s mana ability', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const elf = give(g, 'bob', 'Elf', 'battlefield');
    g = cast(g, 'alice', 'Song of the Dryads', [[obj(elf)]]);
    const c = chars(g, g.objects[elf]!);
    expect(c.types).toEqual(['Land']);
    expect(c.subtypes).toEqual(['Forest']);
    expect(c.colors).toEqual([]);
    expect(hasKeyword(g, g.objects[elf]!, 'flying')).toBe(false);
    g = act(g, { type: 'pass', player: 'alice' });
    expect(legalActions(g, 'bob').some((x) => x.type === 'activate_mana' && x.object === elf)).toBe(true);
  });

  it('Leyline of the Guildpact: nonland permanents you control are all colors', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Leyline of the Guildpact', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    expect(chars(g, g.objects[bear]!).colors.sort()).toEqual(['B', 'G', 'R', 'U', 'W']);
  });

  it("Phyrexian Obliterator: the source's controller sacrifices that many permanents", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const obl = give(g, 'alice', 'Phyrexian Obliterator', 'battlefield');
    const mine = [give(g, 'bob', 'Bear', 'battlefield'), give(g, 'bob', 'Bear', 'battlefield'), give(g, 'bob', 'Bear', 'battlefield'), give(g, 'bob', 'Bear', 'battlefield')];
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bolt', 'hand'), targets: [[obj(obl)]] });
    for (let i = 0; i < 20 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'sacrifice') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'sacrifice', objects: mine.slice(0, 3) } } as never);
      else if (g.pending) break;
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(mine.filter((id) => g.objects[id]!.zone === 'graveyard').length).toBe(3);
  });

  it("Kazuul: an Ogre when a creature attacks you, unless its controller pays {3}", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Kazuul, Tyrant of the Cliffs', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g.objects[bear]!.sick = false;
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: bear, target: { kind: 'player', player: 'alice' } }] } });
    for (let i = 0; i < 10 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.pending).toMatchObject({ kind: 'pay', player: 'bob', cost: '{3}' });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'pay', pay: false } });
    g = settle(g);
    expect(named(g, 'Ogre Token').length).toBe(1);
  });

  it('Ingenious Artillerist: damage equal to how many artifacts entered', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Ingenious Artillerist', 'battlefield');
    g = cast(g, 'alice', 'Two Relics');
    expect(g.players.bob!.life).toBe(18);
  });

  it('Runaway Steam-Kin: counters only up to three', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const kin = give(g, 'alice', 'Runaway Steam-Kin', 'battlefield');
    for (let i = 0; i < 4; i++) g = cast(g, 'alice', 'Bolt', [[{ kind: 'player', player: 'bob' }]]);
    expect(g.objects[kin]!.counters['+1/+1']).toBe(3);
  });

  it("Platinum Angel: you don't lose at 0 life", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Platinum Angel', 'battlefield');
    g.players.alice!.life = 2;
    g = cast(g, 'alice', 'Bolt', [[{ kind: 'player', player: 'alice' }]]);
    expect(g.players.alice!.lost).toBeFalsy();
  });
});
