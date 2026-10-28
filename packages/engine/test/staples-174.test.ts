import { describe, expect, it } from 'vitest';
import { chars, hasProtectionFrom, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Mother of Runes', type_line: 'Creature — Human Cleric', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{T}: Target creature you control gains protection from the color of your choice until end of turn.' }),
  makeCard({ name: 'Giver of Runes', type_line: 'Creature — Kor Cleric', mana_cost: '{0}', power: '1', toughness: '2', oracle_text: '{T}: Another target creature you control gains protection from colorless or from the color of your choice until end of turn.' }),
  makeCard({ name: 'Brave the Elements', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Choose a color. White creatures you control gain protection from the chosen color until end of turn.' }),
  makeCard({ name: 'Ward Sliver', type_line: 'Creature — Sliver', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'As this creature enters, choose a color.\nAll Slivers have protection from the chosen color.' }),
  makeCard({ name: 'White Ward', type_line: 'Enchantment — Aura', mana_cost: '{0}', colors: ['W'], oracle_text: "Enchant creature\nEnchanted creature has protection from white. This effect doesn't remove this Aura." }),
  makeCard({ name: 'White Shackles', type_line: 'Enchantment — Aura', mana_cost: '{0}', colors: ['W'], oracle_text: "Enchant creature\nEnchanted creature can't attack or block." }),
  makeCard({ name: "Commander's Plate", type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: "Equipped creature gets +3/+3 and has protection from each color that's not in your commander's color identity.\nEquip {0}" }),
  makeCard({ name: 'Cliffside Rescuer', type_line: 'Creature — Kor Soldier', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: 'Vigilance\n{T}, Sacrifice this creature: Target permanent you control gains protection from each of your opponents until end of turn.' }),
  makeCard({ name: 'Pippin, Guard of the Citadel', type_line: 'Legendary Creature — Halfling Soldier', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Vigilance, ward {1}\n{T}: Another target creature you control gains protection from the card type of your choice until end of turn.' }),
  makeCard({ name: 'Wishmonger', type_line: 'Creature — Djinn Monk', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: "{0}: Target creature gains protection from the color of its controller's choice until end of turn. Any player may activate this ability." }),
  makeCard({ name: 'Earnest Fellowship', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Each creature has protection from each of its colors.' }),
  makeCard({ name: 'True-Name Nemesis', type_line: 'Creature — Merfolk Rogue', mana_cost: '{0}', power: '3', toughness: '1', oracle_text: 'As this creature enters, choose a player.\nThis creature has protection from the chosen player.' }),
  makeCard({ name: 'Black Vise', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "As this artifact enters, choose an opponent.\nAt the beginning of the chosen player's upkeep, this artifact deals X damage to that player, where X is the number of cards in their hand minus 4." }),
  makeCard({ name: 'Stuffy Doll', type_line: 'Artifact Creature — Construct', mana_cost: '{0}', power: '0', toughness: '1', oracle_text: 'Indestructible\nAs this creature enters, choose a player.\nWhenever this creature is dealt damage, it deals that much damage to the chosen player.\n{T}: This creature deals 1 damage to itself.' }),
  makeCard({ name: 'Sewer Nemesis', type_line: 'Creature — Horror', mana_cost: '{0}', oracle_text: "As this creature enters, choose a player.\nSewer Nemesis's power and toughness are each equal to the number of cards in the chosen player's graveyard.\nWhenever the chosen player casts a spell, that player mills a card." }),
  makeCard({ name: 'Sawhorn Nemesis', type_line: 'Creature — Phyrexian Minotaur', mana_cost: '{0}', power: '5', toughness: '4', oracle_text: 'As this creature enters, choose a player.\nIf a source would deal damage to the chosen player or a permanent they control, it deals double that damage to that player or permanent instead.' }),
  makeCard({ name: 'Bolt', type_line: 'Instant', mana_cost: '{R}', colors: ['R'], oracle_text: 'Bolt deals 3 damage to any target.' }),
  makeCard({ name: 'Doom', type_line: 'Instant', mana_cost: '{B}', colors: ['B'], oracle_text: 'Destroy target creature.' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', colors: ['G'], power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Knight', type_line: 'Creature — Human Knight', mana_cost: '{W}', colors: ['W'], power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Goblin', type_line: 'Creature — Goblin', mana_cost: '{R}', colors: ['R'], power: '2', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Golem', type_line: 'Artifact Creature — Golem', mana_cost: '{3}', power: '3', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Green Leader', type_line: 'Legendary Creature — Elf', mana_cost: '{G}', colors: ['G'], color_identity: ['G'], power: '1', toughness: '1', oracle_text: '' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const obj = (id: string) => ({ kind: 'object' as const, object: id });
const choose = (g: GameState, player: string, choice: string) => act(g, { type: 'choose', player, answer: { kind: 'choose_option', choice } });

describe('staples (slice 174): protection', () => {
  it('Mother of Runes: protection from the color of your choice stops targeting, damage and Auras of that color', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mom = give(g, 'alice', 'Mother of Runes', 'battlefield');
    g.objects[mom]!.sick = false;
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const shackles = give(g, 'bob', 'White Shackles', 'battlefield');
    g.objects[shackles]!.attachedTo = { id: bear, zcc: g.objects[bear]!.zcc };
    g = act(g, { type: 'activate', player: 'alice', object: mom, ability: 0, targets: [[obj(bear)]] });
    g = settle(g);
    expect(g.pending).toMatchObject({ kind: 'choose_option', player: 'alice' });
    g = settle(choose(g, 'alice', 'W'));
    // CR 702.16c: the white Aura falls off.
    expect(g.objects[shackles]!.zone).toBe('graveyard');
    const bolt = give(g, 'bob', 'Bolt', 'battlefield');
    expect(hasProtectionFrom(g, g.objects[bear]!, g.objects[bolt]!)).toBe(false);
    const knight = give(g, 'bob', 'Knight', 'battlefield');
    expect(hasProtectionFrom(g, g.objects[bear]!, g.objects[knight]!)).toBe(true);
  });

  it('Giver of Runes: protection from colorless', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const giver = give(g, 'alice', 'Giver of Runes', 'battlefield');
    g.objects[giver]!.sick = false;
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const golem = give(g, 'bob', 'Golem', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: giver, ability: 0, targets: [[obj(bear)]] }));
    expect((g.pending as { options: string[] }).options).toContain('colorless');
    g = settle(choose(g, 'alice', 'colorless'));
    expect(hasProtectionFrom(g, g.objects[bear]!, g.objects[golem]!)).toBe(true);
    // "Another target creature": not itself.
    expect(() => act(g, { type: 'activate', player: 'alice', object: giver, ability: 0, targets: [[obj(giver)]] })).toThrow();
  });

  it('Brave the Elements: the chosen color, for white creatures you control', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const knight = give(g, 'alice', 'Knight', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Brave the Elements', 'hand') }));
    g = settle(choose(g, 'alice', 'B'));
    g.players.bob!.pool.B = 1;
    const doom = give(g, 'bob', 'Doom', 'hand');
    g = act(g, { type: 'pass', player: 'alice' });
    expect(() => act(g, { type: 'cast', player: 'bob', object: doom, targets: [[obj(knight)]] })).toThrow();
    g = settle(act(g, { type: 'cast', player: 'bob', object: doom, targets: [[obj(bear)]] }));
    expect(g.objects[bear]!.zone).toBe('graveyard');
  });

  it('Ward Sliver: Slivers have protection from the color chosen as it entered', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ward = give(g, 'alice', 'Ward Sliver', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: ward }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', choice: 'R' } }));
    const goblin = give(g, 'bob', 'Goblin', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    expect(hasProtectionFrom(g, g.objects[ward]!, g.objects[goblin]!)).toBe(true);
    expect(hasProtectionFrom(g, g.objects[ward]!, g.objects[bear]!)).toBe(false);
  });

  it("White Ward: doesn't remove itself, but removes another white Aura (CR 702.16d)", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const shackles = give(g, 'bob', 'White Shackles', 'battlefield');
    g.objects[shackles]!.attachedTo = { id: bear, zcc: g.objects[bear]!.zcc };
    const ward = give(g, 'alice', 'White Ward', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: ward, targets: [[obj(bear)]] }));
    expect(g.objects[ward]!.zone).toBe('battlefield');
    expect(g.objects[ward]!.attachedTo?.id).toBe(bear);
    expect(g.objects[shackles]!.zone).toBe('graveyard');
  });

  it("Commander's Plate: each color outside your commander's identity; none without a commander", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const plate = give(g, 'alice', "Commander's Plate", 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: plate, ability: 0, targets: [[obj(bear)]] }));
    const goblin = give(g, 'bob', 'Goblin', 'battlefield');
    const elf = give(g, 'bob', 'Bear', 'battlefield');
    expect(g.objects[plate]!.attachedTo?.id).toBe(bear);
    expect(hasProtectionFrom(g, g.objects[bear]!, g.objects[goblin]!)).toBe(false);
    const leader = give(g, 'alice', 'Green Leader', 'battlefield');
    g.objects[leader]!.commander = true;
    expect(hasProtectionFrom(g, g.objects[bear]!, g.objects[goblin]!)).toBe(true);
    expect(hasProtectionFrom(g, g.objects[bear]!, g.objects[elf]!)).toBe(false);
  });

  it('Cliffside Rescuer: protection from each of your opponents', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const rescuer = give(g, 'alice', 'Cliffside Rescuer', 'battlefield');
    g.objects[rescuer]!.sick = false;
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const myGolem = give(g, 'alice', 'Golem', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: rescuer, ability: 0, targets: [[obj(bear)]] }));
    const theirs = give(g, 'carol', 'Golem', 'battlefield');
    expect(hasProtectionFrom(g, g.objects[bear]!, g.objects[theirs]!)).toBe(true);
    expect(hasProtectionFrom(g, g.objects[bear]!, g.objects[myGolem]!)).toBe(false);
  });

  it('Pippin: protection from the card type of your choice', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const pippin = give(g, 'alice', 'Pippin, Guard of the Citadel', 'battlefield');
    g.objects[pippin]!.sick = false;
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: pippin, ability: 0, targets: [[obj(bear)]] }));
    expect(g.pending).toMatchObject({ kind: 'choose_option' });
    g = settle(choose(g, 'alice', 'instants'));
    const bolt = give(g, 'bob', 'Bolt', 'hand');
    const golem = give(g, 'bob', 'Golem', 'battlefield');
    expect(hasProtectionFrom(g, g.objects[bear]!, g.objects[bolt]!)).toBe(true);
    expect(hasProtectionFrom(g, g.objects[bear]!, g.objects[golem]!)).toBe(false);
  });

  it("Wishmonger: the target's controller chooses the color; any player may activate it", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Wishmonger', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = act(g, { type: 'pass', player: 'alice' });
    const offer = legalActions(g, 'bob').find((a) => a.type === 'activate');
    expect(offer).toBeTruthy();
    g = settle(act(g, { type: 'activate', player: 'bob', object: (offer as { object: string }).object, ability: 0, targets: [[obj(bear)]] }));
    expect(g.pending).toMatchObject({ kind: 'choose_option', player: 'bob' });
    g = settle(choose(g, 'bob', 'R'));
    expect(hasProtectionFrom(g, g.objects[bear]!, g.objects[give(g, 'alice', 'Goblin', 'battlefield')]!)).toBe(true);
  });

  it('Earnest Fellowship: each creature has protection from each of its colors', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Earnest Fellowship', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const other = give(g, 'bob', 'Bear', 'battlefield');
    const goblin = give(g, 'bob', 'Goblin', 'battlefield');
    expect(hasProtectionFrom(g, g.objects[bear]!, g.objects[other]!)).toBe(true);
    expect(hasProtectionFrom(g, g.objects[bear]!, g.objects[goblin]!)).toBe(false);
  });
});

describe('staples (slice 174): the chosen player', () => {
  const enter = (g: GameState, player: string, name: string, chosen: string) => {
    const id = give(g, player, name, 'hand');
    g = settle(act(g, { type: 'cast', player, object: id }));
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'player' });
    return { g: settle(act(g, { type: 'choose', player, answer: { kind: 'as_enters', choice: chosen } })), id };
  };

  it('True-Name Nemesis: protection from the chosen player', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    let tnn: string;
    ({ g, id: tnn } = enter(g, 'alice', 'True-Name Nemesis', 'bob'));
    const bobs = give(g, 'bob', 'Goblin', 'battlefield');
    const carols = give(g, 'carol', 'Goblin', 'battlefield');
    expect(hasProtectionFrom(g, g.objects[tnn]!, g.objects[bobs]!)).toBe(true);
    expect(hasProtectionFrom(g, g.objects[tnn]!, g.objects[carols]!)).toBe(false);
  });

  it('Black Vise: an opponent is chosen; damage for each card in their hand over four, in their upkeep', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const id = give(g, 'alice', 'Black Vise', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: id }));
    expect((g.pending as { options: string[] }).options).toEqual(['bob']);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', choice: 'bob' } }));
    for (let i = 0; i < 3; i++) give(g, 'bob', 'Bear', 'hand');
    const hand = g.zones.hand.bob!.length;
    const life = g.players.bob!.life;
    g = toStep(g, 'draw', 'bob');
    expect(g.players.bob!.life).toBe(life - Math.max(0, hand - 4));
  });

  it('Stuffy Doll: damage dealt to it is dealt to the chosen player', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    let doll: string;
    ({ g, id: doll } = enter(g, 'alice', 'Stuffy Doll', 'bob'));
    g.objects[doll]!.sick = false;
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'activate', player: 'alice', object: doll, ability: 0 }));
    expect(g.players.bob!.life).toBe(life - 1);
    expect(g.objects[doll]!.zone).toBe('battlefield');
  });

  it("Sewer Nemesis: the size of the chosen player's graveyard; they mill when they cast a spell", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (let i = 0; i < 2; i++) give(g, 'bob', 'Bear', 'graveyard');
    let nemesis: string;
    ({ g, id: nemesis } = enter(g, 'alice', 'Sewer Nemesis', 'bob'));
    expect(g.objects[nemesis]!.zone).toBe('battlefield');
    expect(chars(g, g.objects[nemesis]!).power).toBe(2);
    g = act(g, { type: 'pass', player: 'alice' });
    g.players.bob!.pool.R = 1;
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] }));
    // Bolt and the milled card.
    expect(g.zones.graveyard.bob!.length).toBe(4);
  });

  it('Sawhorn Nemesis: double damage to the chosen player and their permanents only', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    ({ g } = enter(g, 'alice', 'Sawhorn Nemesis', 'bob'));
    g.players.alice!.pool.R = 2;
    const bob = g.players.bob!.life;
    const carol = g.players.carol!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'carol' }]] }));
    expect(g.players.bob!.life).toBe(bob - 6);
    expect(g.players.carol!.life).toBe(carol - 3);
  });
});
