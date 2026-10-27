import { describe, expect, it } from 'vitest';
import { hasType, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Purphoros', type_line: 'Legendary Enchantment Creature — God', mana_cost: '{3}{R}', cmc: 4, power: '6', toughness: '5', oracle_text: "Indestructible\nAs long as your devotion to red is less than five, Purphoros isn't a creature." }),
  makeCard({ name: 'Red Guy', type_line: 'Creature — Human', mana_cost: '{R}{R}', cmc: 2, power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Stomper', type_line: 'Creature — Plant', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: "This creature can't attack or block unless you control seven or more lands." }),
  makeCard({ name: 'Beanstalk', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'When this enchantment enters and whenever you cast a spell with mana value 5 or greater, draw a card.' }),
  makeCard({ name: 'Big Spell', type_line: 'Sorcery', mana_cost: '{5}', cmc: 5, oracle_text: 'You gain 1 life.' }),
  makeCard({ name: 'Suture Priest', type_line: 'Creature — Cleric', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Whenever a creature an opponent controls enters, you may have that player lose 1 life.' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Mahadi', type_line: 'Creature — Cat', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: 'At the beginning of your end step, create a Treasure token for each creature that died this turn.' }),
  makeCard({ name: 'Wrath', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Destroy all creatures.' }),
  makeCard({ name: 'Confidant', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: 'At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.' }),
  makeCard({ name: 'Stormtamer', type_line: 'Creature — Siren', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{U}, Sacrifice this creature: Counter target spell or ability that targets you or a creature you control.' }),
  makeCard({ name: 'Shock', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Shock deals 2 damage to any target.' }),
  makeCard({ name: 'Homeward Path', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {C}.\n{T}: Each player gains control of all creatures they own.' }),
  makeCard({ name: 'Steal', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Gain control of target creature.' }),
  makeCard({ name: 'Monument', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "At the beginning of your upkeep, sacrifice a creature. If you can't, sacrifice this artifact." }),
  makeCard({ name: 'Amulet', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Whenever a permanent you control enters tapped, untap it.' }),
  makeCard({ name: 'Tapland', type_line: 'Land', mana_cost: '', oracle_text: 'This land enters tapped.\n{T}: Add {G}.' }),
  makeCard({ name: 'Nova', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Destroy all artifacts and enchantments.' }),
  makeCard({ name: 'Lantern', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "{T}, Sacrifice this artifact: Exile each opponent's graveyard." }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 30 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}

describe('staples (slice 149)', () => {
  it("the Theros Gods: not creatures below their devotion", () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const god = give(g, 'alice', 'Purphoros', 'battlefield');
    expect(hasType(g, g.objects[god]!, 'Creature')).toBe(false);
    give(g, 'alice', 'Red Guy', 'battlefield');
    expect(hasType(g, g.objects[god]!, 'Creature')).toBe(false); // devotion 3
    give(g, 'alice', 'Red Guy', 'battlefield');
    expect(hasType(g, g.objects[god]!, 'Creature')).toBe(true); // devotion 5
  });

  it("can't attack unless you control seven lands", () => {
    const toAttacks = (g: GameState) => {
      g = toStep(g, 'beginning_of_combat');
      while (!g.pending && g.priority && g.step !== 'end') g = act(g, { type: 'pass', player: g.priority });
      return g;
    };
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Stomper', 'battlefield');
    g = toAttacks(g);
    expect(g.pending?.kind).not.toBe('declare_attackers');
    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const stomper = give(h, 'alice', 'Stomper', 'battlefield');
    for (let i = 0; i < 7; i++) give(h, 'alice', 'Tapland', 'battlefield');
    h = toAttacks(h);
    expect(h.pending?.kind).toBe('declare_attackers');
    h = act(h, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: stomper, target: { kind: 'player', player: 'bob' } }] } });
    expect(h.combat?.attackers[stomper]).toBeTruthy();
  });

  it('Up the Beanstalk: when it enters and whenever a big spell is cast', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Beanstalk', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
    g.players.alice!.pool.C = 5;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Big Spell', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
  });

  it('Suture Priest: "you may have that player lose 1 life"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Suture Priest', 'battlefield');
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bear', 'hand') }));
    expect(g.pending?.kind).toBe('may');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    expect(g.players.bob!.life).toBe(life - 1);
  });

  it('Mahadi counts the creatures that died this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Bear', 'battlefield');
    give(g, 'bob', 'Bear', 'battlefield');
    give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Wrath', 'hand') }));
    give(g, 'alice', 'Mahadi', 'battlefield');
    g = toStep(g, 'end', 'alice');
    g = settle(g);
    const treasures = g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice');
    expect(treasures).toHaveLength(3);
  });

  it('Dark Confidant: reveal the top card, put it in hand, lose life equal to its mana value', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Confidant', 'battlefield');
    const top = give(g, 'alice', 'Big Spell', 'library');
    g.zones.library.alice = [top, ...g.zones.library.alice!.filter((id) => id !== top)];
    const life = g.players.alice!.life;
    g = settle(toStep(g, 'upkeep', 'alice'));
    expect(g.objects[top]!.zone).toBe('hand');
    expect(g.players.alice!.life).toBe(life - 5);
  });

  it('Siren Stormtamer counters only what targets you or your creatures', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const siren = give(g, 'alice', 'Stormtamer', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const theirBear = give(g, 'bob', 'Bear', 'battlefield');
    const shock = give(g, 'bob', 'Shock', 'hand');
    g = act(g, { type: 'cast', player: 'bob', object: shock, targets: [[{ kind: 'object', object: theirBear }]] });
    g = act(g, { type: 'pass', player: 'bob' });
    g.players.alice!.pool.U = 1;
    expect(illegal(g, { type: 'activate', player: 'alice', object: siren, ability: 0, targets: [[{ kind: 'object', object: shock }]] })).toBeTruthy();
    g = settle(g);
    const shock2 = give(g, 'bob', 'Shock', 'hand');
    g = act(g, { type: 'cast', player: 'bob', object: shock2, targets: [[{ kind: 'object', object: bear }]] });
    g = act(g, { type: 'pass', player: 'bob' });
    g = act(g, { type: 'activate', player: 'alice', object: siren, ability: 0, targets: [[{ kind: 'object', object: shock2 }]] });
    g = settle(g);
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.objects[shock2]!.zone).toBe('graveyard');
  });

  it('Homeward Path: each player gets back the creatures they own', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Steal', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[bear]!.controller).toBe('bob');
    const path = give(g, 'alice', 'Homeward Path', 'battlefield');
    g = act(g, { type: 'pass', player: 'bob' });
    g = settle(act(g, { type: 'activate', player: 'alice', object: path, ability: 0 }));
    expect(g.objects[bear]!.controller).toBe('alice');
  });

  it("Eldrazi Monument: if you can't sacrifice a creature, sacrifice it", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const monument = give(g, 'alice', 'Monument', 'battlefield');
    g = settle(toStep(g, 'upkeep', 'alice'));
    expect(g.objects[monument]!.zone).toBe('graveyard');
  });

  it('Amulet of Vigor untaps a permanent that enters tapped', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Amulet', 'battlefield');
    const land = give(g, 'alice', 'Tapland', 'hand');
    g = settle(act(g, { type: 'play_land', player: 'alice', object: land }));
    expect(g.objects[land]!.tapped).toBe(false);
  });

  it("Cleansing Nova's artifacts and enchantments; Soul-Guide Lantern", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const a = give(g, 'bob', 'Amulet', 'battlefield');
    const e = give(g, 'bob', 'Beanstalk', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Nova', 'hand') }));
    expect(g.objects[a]!.zone).toBe('graveyard');
    expect(g.objects[e]!.zone).toBe('graveyard');
    expect(g.objects[bear]!.zone).toBe('battlefield');
    const mine = give(g, 'alice', 'Bear', 'graveyard');
    const lantern = give(g, 'alice', 'Lantern', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: lantern, ability: 0 }));
    expect(g.objects[a]!.zone).toBe('exile');
    expect(g.objects[mine]!.zone).toBe('graveyard');
    expect(legalActions(g, 'alice').length).toBeGreaterThan(0);
  });
});
