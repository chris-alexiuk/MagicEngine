import { describe, expect, it } from 'vitest';
import { chars, legalActions } from '../src/index.js';
import type { Action } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Lion Sash', type_line: 'Artifact Creature — Equipment Cat', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{W}: Exile target card from a graveyard. If it was a permanent card, put a +1/+1 counter on this permanent.' }),
  makeCard({ name: 'Oversold Cemetery', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'At the beginning of your upkeep, if you have four or more creature cards in your graveyard, you may return target creature card from your graveyard to your hand.' }),
  makeCard({ name: 'Aurelia, the Law Above', type_line: 'Legendary Creature — Angel', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: 'Whenever a player attacks with three or more creatures, you draw a card.' }),
  makeCard({ name: 'Blast Zone', type_line: 'Land', mana_cost: '', oracle_text: '{3}, {T}, Sacrifice this land: Destroy each nonland permanent with mana value equal to the number of charge counters on this land.' }),
  makeCard({ name: 'Gingerbrute', type_line: 'Artifact Creature — Food Golem', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "{1}: This creature can't be blocked this turn except by creatures with haste." }),
  makeCard({ name: 'Sword of Truth and Justice', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Whenever equipped creature deals combat damage to a player, put a +1/+1 counter on a creature you control, then proliferate.\nEquip {0}' }),
  makeCard({ name: 'Giada, Font of Hope', type_line: 'Legendary Creature — Angel', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Each other Angel you control enters with an additional +1/+1 counter on it for each Angel you already control.' }),
  makeCard({ name: 'Arwen, Weaver of Hope', type_line: 'Legendary Creature — Elf Noble', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: "Each other creature you control enters with a number of additional +1/+1 counters on it equal to Arwen's toughness." }),
  makeCard({ name: 'Excalibur, Sword of Eden', type_line: 'Legendary Artifact — Equipment', mana_cost: '{10}', cmc: 10, oracle_text: 'This spell costs {X} less to cast, where X is the total mana value of historic permanents you control.' }),
  makeCard({ name: 'Shield Up', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Put a shield counter on a creature you control. It gains flying until end of turn.' }),
  makeCard({ name: 'Chalice of the Void', type_line: 'Artifact', mana_cost: '{X}{X}', oracle_text: 'This artifact enters with X charge counters on it.\nWhenever a player casts a spell with mana value equal to the number of charge counters on this artifact, counter that spell.' }),
  makeCard({ name: 'Aether Vial', type_line: 'Artifact', mana_cost: '{1}', oracle_text: '{T}: You may put a creature card with mana value equal to the number of charge counters on this artifact from your hand onto the battlefield.' }),
  makeCard({ name: 'Bolt', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Bolt deals 3 damage to any target.' }),
  makeCard({ name: 'Murder', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target creature.' }),
  makeCard({ name: 'Bauble', type_line: 'Artifact', mana_cost: '{1}', cmc: 1, oracle_text: '' }),
  makeCard({ name: 'Chandra, Torch of Defiance', type_line: 'Legendary Planeswalker — Chandra', mana_cost: '{0}', loyalty: '4', oracle_text: "+1: Exile the top card of your library. You may cast that card. If you don't, Chandra deals 2 damage to each opponent.\n−7: You get an emblem with \"Whenever you cast a spell, this emblem deals 5 damage to any target.\"" }),
  makeCard({ name: 'Divination', type_line: 'Sorcery', mana_cost: '{2}{U}', cmc: 3, oracle_text: 'Draw two cards.' }),
  makeCard({ name: 'Angel', type_line: 'Creature — Angel', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Relic', type_line: 'Artifact', mana_cost: '{2}', cmc: 2, oracle_text: '' }),
  makeCard({ name: 'Idol', type_line: 'Legendary Artifact', mana_cost: '{5}', cmc: 5, oracle_text: '' }),
  makeCard({ name: 'Quickling', type_line: 'Creature — Faerie', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Haste' }),
  makeCard({ name: 'Think', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw a card.' }),
  makeCard({ name: 'Commit', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Put target spell or nonland permanent into its owner's library second from the top." }),
  makeCard({ name: 'Oust', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Put target creature into its owner's library second from the top. Its controller gains 3 life." }),
  makeCard({ name: 'Venser, Shaper Savant', type_line: 'Legendary Creature — Human Wizard', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "Flash\nWhen Venser enters, return target spell or permanent to its owner's hand." }),
  makeCard({ name: 'Purelace', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Target spell or permanent becomes white. (Mana symbols on that permanent remain unchanged.)' }),
  makeCard({ name: 'Fertile Ground', type_line: 'Enchantment — Aura', mana_cost: '{1}{G}', oracle_text: 'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional one mana of any color.' }),
  makeCard({ name: 'Market Festival', type_line: 'Enchantment — Aura', mana_cost: '{3}{G}', oracle_text: 'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional two mana in any combination of colors.' }),
  makeCard({
    name: 'Wear // Tear', layout: 'split', type_line: 'Instant // Instant', oracle_text: '', mana_cost: '{1}{R} // {W}',
    card_faces: [
      { object: 'card_face', name: 'Wear', type_line: 'Instant', mana_cost: '{1}{R}', oracle_text: 'Destroy target artifact.\nFuse (You may cast one or both halves of this card from your hand.)' },
      { object: 'card_face', name: 'Tear', type_line: 'Instant', mana_cost: '{W}', oracle_text: 'Destroy target enchantment.\nFuse (You may cast one or both halves of this card from your hand.)' },
    ],
  } as never),
  makeCard({ name: 'Pacifism', type_line: 'Enchantment', mana_cost: '{1}{W}', oracle_text: '' }),
  makeCard({ name: 'Shark Typhoon', type_line: 'Enchantment', mana_cost: '{5}{U}', oracle_text: "Whenever you cast a noncreature spell, create an X/X blue Shark creature token with flying, where X is that spell's mana value.\nCycling {X}{1}{U} ({X}{1}{U}, Discard this card: Draw a card.)\nWhen you cycle this card, create an X/X blue Shark creature token with flying." }),
  makeCard({ name: 'Gift of Words', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Each opponent draws a card.' }),
  makeCard({ name: 'Tataru Taru', type_line: 'Legendary Creature — Dwarf Advisor', mana_cost: '{0}', power: '0', toughness: '3', oracle_text: "When Tataru Taru enters, you draw a card and target opponent may draw a card.\nScions' Secretary — Whenever an opponent draws a card, if it isn't that player's turn, create a tapped Treasure token. This ability triggers only once each turn." }),
  makeCard({ name: "Heliod's Intervention", type_line: 'Instant', mana_cost: '{X}{W}{W}', oracle_text: 'Choose one —\n• Destroy X target artifacts and/or enchantments.\n• Target player gains twice X life.' }),
  makeCard({ name: 'Koma, Cosmos Serpent', type_line: 'Legendary Creature — Serpent', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: "This spell can't be countered.\nAt the beginning of each upkeep, create a 3/3 blue Serpent creature token named Koma's Coil.\nSacrifice another Serpent: Choose one —\n• Tap target permanent. Its activated abilities can't be activated this turn.\n• Koma gains indestructible until end of turn." }),
  makeCard({ name: 'Pump Knight', type_line: 'Creature — Human Knight', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{0}: This creature gets +1/+1 until end of turn.' }),
  makeCard({ name: 'Augur Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "Each opponent's maximum hand size is reduced by seven." }),
  makeCard({ name: 'Toad Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Your maximum hand size is twenty.' }),
  makeCard({ name: 'Mirror Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'The "legend rule" doesn\'t apply to permanents you control.' }),
  makeCard({ name: 'Basics Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Nonbasic lands don't untap during their controllers' untap steps." }),
  makeCard({ name: 'Meek Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "Creatures with power 3 or greater don't untap during their controllers' untap steps." }),
  makeCard({ name: 'Tundra Lite', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {W} or {U}.' }),
  makeCard({ name: 'Icefall Regent', type_line: 'Creature — Dragon', mana_cost: '{0}', power: '4', toughness: '3', oracle_text: "Flying\nWhen this creature enters, tap target creature an opponent controls. That creature doesn't untap during its controller's untap step for as long as you control this creature.\nSpells your opponents cast that target this creature cost {2} more to cast." }),
  makeCard({ name: 'Sleep', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Tap all creatures target player controls. Those creatures don't untap during that player's next untap step." }),
  makeCard({ name: 'Saw in Half', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Destroy target creature. If that creature dies this way, its controller creates two tokens that are copies of that creature, except their power is half that creature's power and their toughness is half that creature's toughness. Round up each time." }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{0}', power: '5', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Coat of Arms', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Each creature gets +1/+1 for each other creature on the battlefield that shares at least one creature type with it. (For example, if two Goblin Warriors and a Goblin Shaman are on the battlefield, each gets +2/+2.)' }),
  makeCard({ name: 'Goblin Warrior', type_line: 'Creature — Goblin Warrior', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Goblin Shaman', type_line: 'Creature — Goblin Shaman', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Mirror Box', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'The "legend rule" doesn\'t apply to permanents you control.\nEach legendary creature you control gets +1/+1.\nEach nontoken creature you control gets +1/+1 for each other creature you control with the same name as that creature.' }),
  makeCard({ name: 'Clamavus', type_line: 'Creature — Human Tyranid Artificer', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Proclamator Hailer — Each creature you control gets +1/+1 for each +1/+1 counter on it.' }),
  makeCard({ name: 'Mockingbird', type_line: 'Creature — Bird Bard', mana_cost: '{X}{U}', power: '1', toughness: '1', oracle_text: "Flying\nYou may have this creature enter as a copy of any creature on the battlefield with mana value less than or equal to the amount of mana spent to cast this creature, except it's a Bird in addition to its other types and it has flying." }),
  makeCard({ name: 'Titan', type_line: 'Creature — Giant', mana_cost: '{5}', cmc: 5, power: '6', toughness: '6', oracle_text: '' }),
  makeCard({ name: 'Cursed Mirror', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}: Add {R}.\nAs this artifact enters, you may have it become a copy of any creature on the battlefield until end of turn, except it has haste.' }),
  makeCard({ name: 'Approach of the Second Sun', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "If this spell was cast from your hand and you've cast another spell named Approach of the Second Sun this game, you win the game. Otherwise, put Approach of the Second Sun into its owner's library seventh from the top and you gain 7 life." }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const obj = (id: string) => ({ kind: 'object' as const, object: id });
const toAttack = (g: GameState) => {
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return g;
};

describe('staples (slice 178)', () => {
  it('Lion Sash: a counter only for a permanent card', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const sash = give(g, 'alice', 'Lion Sash', 'battlefield');
    g.players.alice!.pool.W = 2;
    g = settle(act(g, { type: 'activate', player: 'alice', object: sash, ability: 0, targets: [[obj(give(g, 'bob', 'Think', 'graveyard'))]] }));
    expect(g.objects[sash]!.counters['+1/+1'] ?? 0).toBe(0);
    g = settle(act(g, { type: 'activate', player: 'alice', object: sash, ability: 0, targets: [[obj(give(g, 'bob', 'Relic', 'graveyard'))]] }));
    expect(g.objects[sash]!.counters['+1/+1']).toBe(1);
  });

  it('Oversold Cemetery: only with four or more creature cards in your graveyard', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Oversold Cemetery', 'battlefield');
    for (let i = 0; i < 3; i++) give(g, 'alice', 'Bear', 'graveyard');
    g = toStep(g, 'draw', 'alice');
    expect(g.zones.graveyard.alice!.length).toBe(3);
    give(g, 'alice', 'Bear', 'graveyard');
    g = toStep(toStep(g, 'main1', 'bob'), 'upkeep', 'alice');
    expect(g.pending?.kind).toBe('trigger_targets');
  });

  it('Aurelia: a card when any player attacks with three or more creatures', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Aurelia, the Law Above', 'battlefield');
    const bears = [0, 1, 2].map(() => give(g, 'bob', 'Bear', 'battlefield'));
    for (const b of bears) g.objects[b]!.sick = false;
    const hand = g.zones.hand.alice!.length;
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: bears.map((attacker) => ({ attacker, target: { kind: 'player' as const, player: 'alice' } })) } });
    g = settle(g);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('Blast Zone: destroys nonland permanents with mana value equal to its charge counters', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const zone = give(g, 'alice', 'Blast Zone', 'battlefield');
    g.objects[zone]!.counters.charge = 2;
    const relic = give(g, 'bob', 'Relic', 'battlefield');
    const idol = give(g, 'bob', 'Idol', 'battlefield');
    g.players.alice!.pool.C = 3;
    g = settle(act(g, { type: 'activate', player: 'alice', object: zone, ability: 0 }));
    expect(g.objects[relic]!.zone).toBe('graveyard');
    expect(g.objects[idol]!.zone).toBe('battlefield');
  });

  it('Gingerbrute: only creatures with haste can block it this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const brute = give(g, 'alice', 'Gingerbrute', 'battlefield');
    g.objects[brute]!.sick = false;
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const quick = give(g, 'bob', 'Quickling', 'battlefield');
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'activate', player: 'alice', object: brute, ability: 0 }));
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: brute, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 10 && g.pending?.kind !== 'declare_blockers'; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect(() => act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: bear, attacker: brute }] } } as never)).toThrow();
    expect(() => act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: quick, attacker: brute }] } } as never)).not.toThrow();
  });

  it('Sword of Truth and Justice: a +1/+1 counter on a creature you choose, then proliferate', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g.objects[bear]!.sick = false;
    const other = give(g, 'alice', 'Angel', 'battlefield');
    const sword = give(g, 'alice', 'Sword of Truth and Justice', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: sword, ability: 0, targets: [[obj(bear)]] }));
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: bear, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 30 && g.pending?.kind !== 'choose_objects'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } } as never);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.pending).toMatchObject({ kind: 'choose_objects', candidates: expect.arrayContaining([bear, other]) });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [other] } });
    expect(g.pending?.kind).toBe('proliferate');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'proliferate', objects: [other], players: [] } });
    g = settle(g);
    expect(g.objects[other]!.counters['+1/+1']).toBe(2);
  });

  it('Giada and Arwen: counters as other creatures enter', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Giada, Font of Hope', 'battlefield');
    give(g, 'alice', 'Angel', 'battlefield');
    const third = give(g, 'alice', 'Angel', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: third }));
    expect(g.objects[third]!.counters['+1/+1']).toBe(2);
    give(g, 'alice', 'Arwen, Weaver of Hope', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'hand');
    g.players.alice!.pool.G = 1;
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear }));
    expect(g.objects[bear]!.counters['+1/+1']).toBe(3);
  });

  it('Excalibur: costs less by the total mana value of historic permanents you control', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Idol', 'battlefield');
    give(g, 'alice', 'Relic', 'battlefield');
    const sword = give(g, 'alice', 'Excalibur, Sword of Eden', 'hand');
    g.players.alice!.pool.C = 3;
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === sword)).toBe(true);
  });
});

describe('staples (slice 178): shield counters and counted mana values', () => {
  it('a shield counter is removed instead of damage or destruction (CR 122.1c); "It" is the creature chosen', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Shield Up', 'hand') }));
    if (g.pending?.kind === 'choose_objects') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [bear] } }));
    expect(g.objects[bear]!.counters.shield).toBe(1);
    expect(chars(g, g.objects[bear]!).keywords.some((k) => k.id === 'flying')).toBe(true);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[obj(bear)]] }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.objects[bear]!.damage).toBe(0);
    expect(g.objects[bear]!.counters.shield ?? 0).toBe(0);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder', 'hand'), targets: [[obj(bear)]] }));
    expect(g.objects[bear]!.zone).toBe('graveyard');
  });

  it('Chalice of the Void counters spells with mana value equal to its charge counters', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const chalice = give(g, 'alice', 'Chalice of the Void', 'battlefield');
    g.objects[chalice]!.counters.charge = 1;
    g.players.bob!.pool.C = 3;
    const bauble = give(g, 'bob', 'Bauble', 'hand');
    g = settle(act(g, { type: 'cast', player: 'bob', object: bauble }));
    expect(g.objects[bauble]!.zone).toBe('graveyard');
    const relic = give(g, 'bob', 'Relic', 'hand');
    g = settle(act(g, { type: 'cast', player: 'bob', object: relic }));
    expect(g.objects[relic]!.zone).toBe('battlefield');
  });

  it('Aether Vial: a creature card with mana value equal to its charge counters', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const vial = give(g, 'alice', 'Aether Vial', 'battlefield');
    g.objects[vial]!.counters.charge = 2;
    const bear = give(g, 'alice', 'Bear', 'hand');
    give(g, 'alice', 'Angel', 'hand');
    g = act(g, { type: 'activate', player: 'alice', object: vial, ability: 0 });
    g = settle(g);
    if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    // Only the Bear has mana value 2: it's the one put onto the battlefield.
    if (g.pending?.kind === 'choose_objects') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [bear] } });
    g = settle(g);
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.zones.hand.alice!.some((id) => g.cards[g.objects[id]!.card]?.name === 'Angel')).toBe(true);
  });
});

describe('staples (slice 178): Chandra, Torch of Defiance', () => {
  const top = (g: GameState, name: string) => {
    const id = give(g, 'alice', name, 'library');
    const lib = g.zones.library.alice!;
    lib.splice(lib.indexOf(id), 1);
    lib.unshift(id);
    return id;
  };
  it('+1: cast the exiled card paying its cost, or 2 damage to each opponent', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const chandra = give(g, 'alice', 'Chandra, Torch of Defiance', 'battlefield');
    g.objects[chandra]!.counters.loyalty = 4;
    const div = top(g, 'Divination');
    g.players.alice!.pool.U = 1;
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'activate', player: 'alice', object: chandra, ability: 0 }));
    expect(g.pending).toMatchObject({ kind: 'cast_free', object: div });
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: true } }));
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
    expect(g.players.bob!.life).toBe(20);
    // A land can't be cast: 2 damage instead.
    g = toStep(toStep(g, 'main1', 'bob'), 'main1', 'alice');
    top(g, 'Forest');
    g = settle(act(g, { type: 'activate', player: 'alice', object: chandra, ability: 0 }));
    expect(g.players.bob!.life).toBe(18);
  });

  it('−7: an emblem that deals 5 damage whenever you cast a spell', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const chandra = give(g, 'alice', 'Chandra, Torch of Defiance', 'battlefield');
    g.objects[chandra]!.counters.loyalty = 7;
    g = settle(act(g, { type: 'activate', player: 'alice', object: chandra, ability: 1 }));
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Think', 'hand') });
    if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } });
    g = settle(g);
    expect(g.players.bob!.life).toBe(15);
  });
});

describe('staples (slice 179): Approach of the Second Sun', () => {
  it('first cast goes seventh from the top for 7 life; the second cast from hand wins', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const approach = give(g, 'alice', 'Approach of the Second Sun', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: approach }));
    expect(g.players.alice!.life).toBe(27);
    const lib = g.zones.library.alice!;
    // (The deck holds other copies; the engine keeps a card's id as it moves.)
    const moved = approach;
    expect(lib.indexOf(moved)).toBe(6);
    expect(g.winner ?? null).toBe(null);
    // Dig it back out and cast it again from hand.
    lib.splice(lib.indexOf(moved), 1);
    g.zones.hand.alice!.push(moved);
    g.objects[moved]!.zone = 'hand';
    g = settle(act(g, { type: 'cast', player: 'alice', object: moved }));
    expect(g.winner).toBe('alice');
  });
});

describe('staples (slice 179): target spell or permanent', () => {
  it('Commit puts a spell second from the top; a nonland permanent too', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Think', 'hand') });
    const think = g.stack[0]!.kind === 'spell' ? g.stack[0]!.object : '';
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Commit', 'hand'), targets: [[obj(think)]] }));
    expect(g.stack.length).toBe(0);
    expect(g.zones.library.alice![1]).toBe(think);
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Commit', 'hand'), targets: [[obj(bear)]] }));
    expect(g.zones.library.bob![1]).toBe(bear);
    // A land isn't a legal target.
    const forest = give(g, 'bob', 'Forest', 'battlefield');
    expect(() => act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Commit', 'hand'), targets: [[obj(forest)]] })).toThrow();
  });

  it('Venser returns a spell to its owner\'s hand', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Think', 'hand') });
    const think = g.stack[0]!.kind === 'spell' ? g.stack[0]!.object : '';
    g = act(g, { type: 'pass', player: 'bob' });
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Venser, Shaper Savant', 'hand') });
    g = settle(g);
    if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[obj(think)]] } });
    g = settle(g);
    expect(g.stack.length).toBe(0);
    expect(g.objects[think]!.zone).toBe('hand');
  });

  it('Purelace: a spell is white while on the stack; the permanent it becomes is a new object', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.players.alice!.pool.G = 1;
    g.players.alice!.pool.C = 1;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bear', 'hand') });
    const bear = g.stack[0]!.kind === 'spell' ? g.stack[0]!.object : '';
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Purelace', 'hand'), targets: [[obj(bear)]] });
    g = act(act(g, { type: 'pass', player: 'alice' }), { type: 'pass', player: 'bob' });
    expect(g.stack.length).toBe(1);
    expect(chars(g, g.objects[bear]!).colors).toEqual(['W']);
    g = settle(g);
    const onField = g.zones.battlefield.find((id) => g.cards[g.objects[id]!.card]?.name === 'Bear')!;
    expect(chars(g, g.objects[onField]!).colors).toEqual(['G']);
  });

  it('Oust: the creature\'s controller gains 3 life', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Oust', 'hand'), targets: [[obj(bear)]] }));
    expect(g.players.bob!.life).toBe(23);
    expect(g.zones.library.bob![1]).toBe(bear);
  });
});

describe('staples (slice 179): additional mana of any color', () => {
  const enchant = (g: GameState, aura: string, land: string) => {
    const a = give(g, 'alice', aura, 'battlefield');
    g.objects[a]!.attachedTo = { id: land, zcc: g.objects[land]!.zcc };
    return a;
  };
  it('Fertile Ground: the color named as the land is tapped', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    enchant(g, 'Fertile Ground', forest);
    const taps = legalActions(g, 'alice').filter((a): a is Extract<Action, { type: 'activate_mana' }> => a.type === 'activate_mana' && a.object === forest);
    expect(taps.map((a) => a.bonus?.[0]).sort()).toEqual(['B', 'G', 'R', 'U', 'W']);
    g = act(g, { type: 'activate_mana', player: 'alice', object: forest, ability: 0, bonus: ['U'] });
    expect(g.players.alice!.pool).toMatchObject({ G: 1, U: 1 });
  });

  it('Market Festival: two mana in any combination', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    enchant(g, 'Market Festival', forest);
    const taps = legalActions(g, 'alice').filter((a) => a.type === 'activate_mana' && a.object === forest);
    expect(taps.length).toBe(15);
    g = act(g, { type: 'activate_mana', player: 'alice', object: forest, ability: 0, bonus: [10] });
    expect(g.players.alice!.pool).toMatchObject({ G: 1, B: 1, R: 1 });
  });
});

describe('staples (slice 179): fuse', () => {
  it('Wear // Tear: both halves from the hand, paying both costs, left half then right', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const relic = give(g, 'bob', 'Relic', 'battlefield');
    const pacifism = give(g, 'bob', 'Pacifism', 'battlefield');
    const wt = give(g, 'alice', 'Wear // Tear', 'hand');
    Object.assign(g.players.alice!.pool, { R: 1, C: 1, W: 1 });
    const fused = legalActions(g, 'alice').find((a) => a.type === 'cast' && a.object === wt && (a as { extras?: string[] }).extras?.includes('fuse'));
    expect(fused).toMatchObject({ targets: [[obj(relic)], [obj(pacifism)]] });
    g = act(g, { type: 'cast', player: 'alice', object: wt, extras: ['fuse'], targets: [[obj(relic)], [obj(pacifism)]] });
    expect(g.players.alice!.pool).toMatchObject({ R: 0, C: 0, W: 0 });
    const top = g.objects[wt]!;
    expect(chars(g, top).colors.sort()).toEqual(['R', 'W']);
    g = settle(g);
    expect(g.objects[relic]!.zone).toBe('graveyard');
    expect(g.objects[pacifism]!.zone).toBe('graveyard');
    expect(g.objects[wt]!.zone).toBe('graveyard');
    expect(g.objects[wt]!.fused).toBeUndefined();
  });

  it('each half needs its own legal target; one half alone still works', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const relic = give(g, 'bob', 'Relic', 'battlefield');
    const wt = give(g, 'alice', 'Wear // Tear', 'hand');
    g.players.alice!.pool.R = 1;
    g.players.alice!.pool.C = 1;
    expect(() => act(structuredClone(g), { type: 'cast', player: 'alice', object: wt, extras: ['fuse'], targets: [[obj(relic)], [obj(relic)]] })).toThrow();
    g = settle(act(g, { type: 'cast', player: 'alice', object: wt, targets: [[obj(relic)]] }));
    expect(g.objects[relic]!.zone).toBe('graveyard');
  });
});

describe('staples (slice 179): Shark Typhoon', () => {
  it('cycled for X: an X/X Shark and a card', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const shark = give(g, 'alice', 'Shark Typhoon', 'hand');
    Object.assign(g.players.alice!.pool, { U: 1, C: 4 });
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'activate', player: 'alice', object: shark, ability: 0, x: 3 }));
    expect(g.objects[shark]!.zone).toBe('graveyard');
    expect(g.zones.hand.alice!.length).toBe(hand);
    const token = g.zones.battlefield.map((id) => g.objects[id]!).find((o) => o.token && g.cards[o.card]?.name === 'Shark Token')!;
    expect(token).toBeTruthy();
    expect(chars(g, token).power).toBe(3);
    expect(chars(g, token).keywords.some((k) => k.id === 'flying')).toBe(true);
  });
});

describe('staples (slice 179): Tataru Taru', () => {
  const treasures = (g: GameState) => g.zones.battlefield.filter((id) => g.cards[g.objects[id]!.card]?.name === 'Treasure').length;
  it('an opponent who draws off their turn makes a tapped Treasure, once each turn', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const hands = { alice: g.zones.hand.alice!.length, bob: g.zones.hand.bob!.length };
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Tataru Taru', 'hand') });
    g = settle(g);
    if (g.pending?.kind === 'trigger_targets') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } }));
    expect(g.pending).toMatchObject({ kind: 'may', player: 'bob' });
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'may', yes: true } }));
    expect(g.zones.hand.alice!.length).toBe(hands.alice + 1);
    expect(g.zones.hand.bob!.length).toBe(hands.bob + 1);
    // Bob drew on Alice's turn: one tapped Treasure — and only one this turn.
    g = settle(g);
    expect(treasures(g)).toBe(1);
    const t = g.zones.battlefield.find((id) => g.cards[g.objects[id]!.card]?.name === 'Treasure')!;
    expect(g.objects[t]!.tapped).toBe(true);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Gift of Words', 'hand') }));
    expect(treasures(g)).toBe(1);
    // Bob's own draw step doesn't count (or use up the turn's trigger): Carol's draw on Bob's turn does.
    g = toStep(g, 'main1', 'bob');
    expect(treasures(g)).toBe(1);
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Gift of Words', 'hand') }));
    expect(treasures(g)).toBe(2);
  });
});

describe('staples (slice 179): Heliod\'s Intervention, Koma', () => {
  it('Heliod\'s Intervention: twice X life', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    Object.assign(g.players.alice!.pool, { W: 2, C: 3 });
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', "Heliod's Intervention", 'hand'), x: 3, modes: [1], targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.players.bob!.life).toBe(26);
  });

  it('Koma: tap target permanent; its activated abilities can\'t be activated this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const koma = give(g, 'alice', 'Koma, Cosmos Serpent', 'battlefield');
    const coil = give(g, 'alice', 'Koma, Cosmos Serpent', 'battlefield');
    const knight = give(g, 'bob', 'Pump Knight', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: koma, ability: 0, modes: [0], targets: [[obj(knight)]], costs: { sacrifice: [coil] } }));
    expect(g.objects[knight]!.tapped).toBe(true);
    g = act(g, { type: 'pass', player: 'alice' });
    expect(legalActions(g, 'bob').some((a) => a.type === 'activate' && a.object === knight)).toBe(false);
    g = toStep(g, 'main1', 'bob');
    expect(legalActions(g, 'bob').some((a) => a.type === 'activate' && a.object === knight)).toBe(true);
  });
});

describe('staples (slice 179): maximum hand size', () => {
  it('reduced by seven for opponents; twenty for you', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Augur Lite', 'battlefield');
    g = toStep(g, 'end', 'bob');
    g = act(g, { type: 'pass', player: 'bob' });
    g = act(g, { type: 'pass', player: 'alice' });
    expect(g.pending).toMatchObject({ kind: 'discard_to_hand_size', player: 'bob', count: g.zones.hand.bob!.length });
  });
  it('a later "is twenty" replaces an earlier reduction (timestamp order)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Augur Lite', 'battlefield');
    give(g, 'bob', 'Toad Lite', 'battlefield');
    for (let i = 0; i < 5; i++) give(g, 'bob', 'Bear', 'hand');
    g = toStep(g, 'end', 'bob');
    g = act(g, { type: 'pass', player: 'bob' });
    g = act(g, { type: 'pass', player: 'alice' });
    expect(g.pending?.kind).not.toBe('discard_to_hand_size');
  });
});

describe('staples (slice 179): the legend rule and untap restrictions', () => {
  it('Mirror Box: the legend rule doesn\'t apply to your permanents', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Koma, Cosmos Serpent', 'battlefield');
    give(g, 'alice', 'Koma, Cosmos Serpent', 'battlefield');
    const before = structuredClone(g);
    g = act(g, { type: 'pass', player: 'alice' });
    expect(g.pending?.kind).toBe('legend_rule');
    g = before;
    give(g, 'alice', 'Mirror Lite', 'battlefield');
    g = act(g, { type: 'pass', player: 'alice' });
    expect(g.pending?.kind).not.toBe('legend_rule');
    expect(g.zones.battlefield.filter((id) => g.cards[g.objects[id]!.card]?.name === 'Koma, Cosmos Serpent').length).toBe(2);
  });

  it('Back to Basics: nonbasic lands stay tapped; Meekstone: power 3 or greater', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'bob', 'Basics Lite', 'battlefield');
    give(g, 'bob', 'Meek Lite', 'battlefield');
    const tundra = give(g, 'alice', 'Tundra Lite', 'battlefield');
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const koma = give(g, 'alice', 'Koma, Cosmos Serpent', 'battlefield');
    for (const id of [tundra, forest, bear, koma]) g.objects[id]!.tapped = true;
    g = toStep(g, 'upkeep', 'alice');
    expect(g.objects[tundra]!.tapped).toBe(true);
    expect(g.objects[forest]!.tapped).toBe(false);
    expect(g.objects[bear]!.tapped).toBe(false);
    expect(g.objects[koma]!.tapped).toBe(true);
  });
});

describe('staples (slice 180): staying tapped', () => {
  it('Icefall Regent: for as long as you control it', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Icefall Regent', 'hand') });
    g = settle(g);
    if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[obj(bear)]] } });
    g = settle(g);
    const regent = g.zones.battlefield.find((id) => g.cards[g.objects[id]!.card]?.name === 'Icefall Regent')!;
    expect(g.objects[bear]!.tapped).toBe(true);
    g = toStep(g, 'main1', 'bob');
    expect(g.objects[bear]!.tapped).toBe(true);
    // Once the Regent is gone, it untaps as usual.
    g = toStep(g, 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder', 'hand'), targets: [[obj(regent)]] }));
    expect(g.objects[regent]!.zone).toBe('graveyard');
    g = toStep(g, 'main1', 'bob');
    expect(g.objects[bear]!.tapped).toBe(false);
  });

  it('Sleep: those creatures skip their next untap step only', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Sleep', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.objects[bear]!.tapped).toBe(true);
    g = toStep(g, 'main1', 'bob');
    expect(g.objects[bear]!.tapped).toBe(true);
    g = toStep(toStep(g, 'main1', 'alice'), 'main1', 'bob');
    expect(g.objects[bear]!.tapped).toBe(false);
  });
});

describe('staples (slice 180): Saw in Half', () => {
  it('two half-size copies for its controller, from the power it last had', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    g.objects[ogre]!.counters['+1/+1'] = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Saw in Half', 'hand'), targets: [[obj(ogre)]] }));
    const tokens = g.zones.battlefield.map((id) => g.objects[id]!).filter((o) => o.token && o.controller === 'bob');
    expect(tokens.length).toBe(2);
    // 7/5 as it died: 4/3 each (rounded up), copies of an Ogre.
    expect(tokens.map((t) => [chars(g, t).power, chars(g, t).toughness])).toEqual([[4, 3], [4, 3]]);
    expect(chars(g, tokens[0]!).subtypes).toContain('Ogre');
  });

  it('no tokens if it doesn\'t die (a shield counter)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    g.objects[ogre]!.counters.shield = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Saw in Half', 'hand'), targets: [[obj(ogre)]] }));
    expect(g.objects[ogre]!.zone).toBe('battlefield');
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token).length).toBe(0);
  });
});

describe('staples (slice 180): Coat of Arms', () => {
  it('each creature counts the others that share a creature type with it', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Coat of Arms', 'battlefield');
    const w1 = give(g, 'alice', 'Goblin Warrior', 'battlefield');
    const w2 = give(g, 'bob', 'Goblin Warrior', 'battlefield');
    const sh = give(g, 'alice', 'Goblin Shaman', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    expect([w1, w2, sh].map((id) => chars(g, g.objects[id]!).power)).toEqual([3, 3, 3]);
    expect(chars(g, g.objects[bear]!).power).toBe(2);
    const bear2 = give(g, 'bob', 'Bear', 'battlefield');
    expect(chars(g, g.objects[bear]!).toughness).toBe(3);
    expect(chars(g, g.objects[bear2]!).power).toBe(3);
  });
});

describe('staples (slice 180): Mirror Box, Clamavus', () => {
  it('Clamavus: each creature counts the counters on itself (it had summed them all)', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Clamavus', 'battlefield');
    const a = give(g, 'alice', 'Bear', 'battlefield');
    const b = give(g, 'alice', 'Bear', 'battlefield');
    g.objects[a]!.counters['+1/+1'] = 2;
    expect(chars(g, g.objects[a]!).power).toBe(6);
    expect(chars(g, g.objects[b]!).power).toBe(2);
  });

  it('+1/+1 for each other creature you control with the same name', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Mirror Box', 'battlefield');
    const a = give(g, 'alice', 'Goblin Warrior', 'battlefield');
    const b = give(g, 'alice', 'Goblin Warrior', 'battlefield');
    give(g, 'bob', 'Goblin Warrior', 'battlefield');
    const k1 = give(g, 'alice', 'Koma, Cosmos Serpent', 'battlefield');
    give(g, 'alice', 'Koma, Cosmos Serpent', 'battlefield');
    expect(chars(g, g.objects[a]!).power).toBe(2);
    expect(chars(g, g.objects[b]!).toughness).toBe(2);
    // Legendary (+1/+1) and one other Koma (+1/+1); the legend rule doesn't apply.
    expect(chars(g, g.objects[k1]!).power).toBe(8);
    g = act(g, { type: 'pass', player: 'alice' });
    expect(g.pending?.kind).not.toBe('legend_rule');
  });
});

describe('staples (slice 180): Mockingbird', () => {
  it('copies only a creature with mana value up to the mana spent on it', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const titan = give(g, 'bob', 'Titan', 'battlefield');
    Object.assign(g.players.alice!.pool, { U: 1, C: 2 });
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mockingbird', 'hand'), x: 2 }));
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'copy' });
    const candidates = (g.pending as { candidates: string[] }).candidates;
    expect(candidates).toContain(bear);
    expect(candidates).not.toContain(titan);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', copy: bear } });
    const bird = g.zones.battlefield.map((id) => g.objects[id]!).find((o) => o.controller === 'alice' && o.copyOf)!;
    expect(chars(g, bird).subtypes).toEqual(expect.arrayContaining(['Bear', 'Bird']));
    expect(chars(g, bird).keywords.some((k) => k.id === 'flying')).toBe(true);
  });
});

describe('staples (slice 180): Cursed Mirror', () => {
  it('a copy with haste until end of turn, then the artifact again', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const titan = give(g, 'bob', 'Titan', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Cursed Mirror', 'hand') }));
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'copy' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', copy: titan } });
    const mirror = g.zones.battlefield.map((id) => g.objects[id]!).find((o) => o.controller === 'alice' && o.copyOf)!;
    expect(chars(g, mirror).power).toBe(6);
    expect(chars(g, mirror).keywords.some((k) => k.id === 'haste')).toBe(true);
    g = toStep(g, 'main1', 'bob');
    expect(chars(g, g.objects[mirror.id]!).types).toEqual(['Artifact']);
  });
});
