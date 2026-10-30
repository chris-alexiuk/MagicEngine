import { describe, expect, it } from 'vitest';
import { chars } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{G}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Green Ogre', type_line: 'Creature — Ogre', mana_cost: '{G}', power: '3', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Red Goblin', type_line: 'Creature — Goblin', mana_cost: '{R}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Gruul Ogre', type_line: 'Creature — Ogre', mana_cost: '{R}{G}', power: '3', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Golem Lite', type_line: 'Artifact Creature — Golem', mana_cost: '{3}', cmc: 3, power: '3', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'White Knight', type_line: 'Creature — Human Knight', mana_cost: '{W}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Human Lite', type_line: 'Creature — Human', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Elf Lite', type_line: 'Creature — Elf Warrior', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Shapeshifter Lite', type_line: 'Creature — Shapeshifter', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Changeling' }),
  makeCard({ name: 'Infect Lite', type_line: 'Creature — Phyrexian', mana_cost: '{0}', power: '1', toughness: '4', oracle_text: 'Infect' }),
  makeCard({ name: 'Ench Creature', type_line: 'Enchantment Creature — Nymph', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Bolt Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Bolt Lite deals 3 damage to any target.' }),
  makeCard({ name: 'Murder Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target creature.' }),
  makeCard({ name: 'Siren Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Radiance — Target creature and each other creature that shares a color with it get +1/+1 until end of turn.' }),
  makeCard({ name: 'Shield Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Prevent all damage that would be dealt to target creature this turn unless any player pays {1}.' }),
  makeCard({ name: 'Pyromancy Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: '{0}, Discard a card at random: This enchantment deals damage to any target equal to the mana value of the discarded card.' }),
  makeCard({ name: 'Betrayal Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'As an additional cost to cast this spell, sacrifice any number of creatures.\nTarget creature gets +2/+2 until end of turn for each creature sacrificed this way.' }),
  makeCard({ name: 'Soulblast Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'As an additional cost to cast this spell, sacrifice all creatures you control.\nSoulblast Lite deals damage to any target equal to the total power of the sacrificed creatures.' }),
  makeCard({ name: 'Plague Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "As an additional cost to cast this spell, sacrifice a creature.\nDestroy all creatures that share a creature type with the sacrificed creature. They can't be regenerated." }),
  makeCard({ name: 'Mangler Lite', type_line: 'Creature — Fish', mana_cost: '{0}', power: '0', toughness: '3', oracle_text: "{0}: This creature's base power becomes equal to target creature's power. (This effect lasts indefinitely.)" }),
  makeCard({ name: 'Tombstones Lite', type_line: 'Creature — Wall', mana_cost: '{0}', power: '0', toughness: '1', oracle_text: "Defender\nAt the beginning of your upkeep, this creature's base toughness becomes equal to 1 plus the number of creature cards in your graveyard. (This effect lasts indefinitely.)" }),
  makeCard({ name: 'Ghoul Lite', type_line: 'Creature — Zombie', mana_cost: '{0}', power: '4', toughness: '2', oracle_text: "This creature can't block Humans." }),
  makeCard({ name: 'Thief Lite', type_line: 'Creature — Human Rogue', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "This creature can't be blocked by enchanted creatures or enchantment creatures." }),
  makeCard({ name: 'Aura Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature' }),
  makeCard({ name: 'Ace Lite', type_line: 'Creature — Human Pilot', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "This creature gets +2/+0 as long as it isn't attacking or blocking." }),
  makeCard({ name: 'Impure Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Impure Lite deals 3 damage to target creature. If that creature has infect, Impure Lite deals 3 damage to that creature's controller." }),
  makeCard({ name: 'Swimmer Lite', type_line: 'Creature — Horror', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'This creature gets +3/+0 as long as there are ten or more cards in a single graveyard.' }),
  makeCard({ name: 'Charmer Lite', type_line: 'Creature — Minion', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "Whenever this creature deals combat damage to a creature, that creature's controller loses 2 life unless they pay {2}." }),
  makeCard({ name: 'Troll Lite', type_line: 'Creature — Troll', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: 'At the beginning of your upkeep, exile a creature card from your graveyard. If you do, put a +1/+1 counter on this creature. Otherwise, sacrifice it.' }),
  makeCard({ name: 'Dervish Lite', type_line: 'Creature — Human Monk', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'At the beginning of each end step, if this creature dealt damage to an opponent this turn, put a +1/+1 counter on it.' }),
  makeCard({ name: 'Cry Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Exile all white creatures. For each creature exiled this way, its controller draws a card.' }),
  makeCard({ name: 'Bifurcate Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Search your library for a permanent card with the same name as target nontoken creature, put that card onto the battlefield, then shuffle.' }),
  makeCard({ name: 'Leave Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Radiance — Destroy target enchantment and each other enchantment that shares a color with it.' }),
  makeCard({ name: 'White Ench', type_line: 'Enchantment', mana_cost: '{W}', oracle_text: '' }),
  makeCard({ name: 'Other White Ench', type_line: 'Enchantment', mana_cost: '{W}', oracle_text: '' }),
  makeCard({ name: 'Green Ench', type_line: 'Enchantment', mana_cost: '{G}', oracle_text: '' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const cast = (g: GameState, who: string, name: string, extra: Record<string, unknown> = {}) => settle(act(g, { type: 'cast', player: who, object: give(g, who, name, 'hand'), ...extra } as never));
const target = (id: string) => ({ targets: [[{ kind: 'object', object: id }]] });
const choose = (g: GameState, answer: Record<string, unknown>) => settle(act(g, { type: 'choose', player: (g.pending as { player: string }).player, answer } as never));
const activate = (g: GameState, who: string, object: string, extra: Record<string, unknown> = {}, ability = 0) => settle(act(g, { type: 'activate', player: who, object, ability, ...extra } as never));
const main = () => toStep(start({ extra: CARDS }), 'main1', 'alice');
const pt = (g: GameState, id: string) => [chars(g, g.objects[id]!).power, chars(g, g.objects[id]!).toughness];
const attackWith = (g: GameState, attackers: string[], to = 'bob', who = 'alice'): GameState => {
  g = toStep(g, 'beginning_of_combat', who);
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return act(g, { type: 'choose', player: who, answer: { kind: 'declare_attackers', attacks: attackers.map((attacker) => ({ attacker, target: { kind: 'player' as const, player: to } })) } });
};
const toBlocks = (g: GameState) => {
  while (g.pending?.kind !== 'declare_blockers' && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return g;
};
const name = (g: GameState, id: string) => g.cards[g.objects[id]!.card]!.name;

describe('staples (slice 276)', () => {
  it('radiance: the target and each other creature sharing a color with it (a colorless target only itself)', () => {
    let g = main();
    const ogre = give(g, 'alice', 'Green Ogre', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const gruul = give(g, 'bob', 'Gruul Ogre', 'battlefield');
    const goblin = give(g, 'bob', 'Red Goblin', 'battlefield');
    const golem = give(g, 'alice', 'Golem Lite', 'battlefield');
    g = cast(g, 'alice', 'Siren Lite', target(ogre));
    expect([pt(g, ogre)[0], pt(g, bear)[0], pt(g, gruul)[0], pt(g, goblin)[0], pt(g, golem)[0]]).toEqual([4, 3, 4, 1, 3]);
    g = cast(g, 'alice', 'Siren Lite', target(golem));
    expect([pt(g, golem)[0], pt(g, ogre)[0]]).toEqual([4, 4]);
  });

  it('radiance: "Destroy target enchantment and each other enchantment that shares a color with it."', () => {
    let g = main();
    const [w1, w2, gr] = [give(g, 'bob', 'White Ench', 'battlefield'), give(g, 'alice', 'Other White Ench', 'battlefield'), give(g, 'bob', 'Green Ench', 'battlefield')];
    g = cast(g, 'alice', 'Leave Lite', target(w1));
    expect([g.objects[w1]!.zone, g.objects[w2]!.zone, g.objects[gr]!.zone]).toEqual(['graveyard', 'graveyard', 'battlefield']);
  });

  it('"unless any player pays {1}": each player in turn may pay; once one does, it isn\'t done', () => {
    let g = main();
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    g = cast(g, 'alice', 'Shield Lite', target(cub));
    expect(g.pending).toMatchObject({ kind: 'pay', player: 'alice' });
    g = choose(g, { kind: 'pay', pay: false });
    expect(g.pending).toMatchObject({ kind: 'pay', player: 'bob' });
    g.players.bob!.pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 };
    g = choose(g, { kind: 'pay', pay: true });
    g = cast(g, 'alice', 'Bolt Lite', target(cub));
    expect(g.objects[cub]!.zone).toBe('graveyard');
    let k = main();
    const cub2 = give(k, 'alice', 'Cub', 'battlefield');
    k = cast(k, 'alice', 'Shield Lite', target(cub2));
    k = choose(choose(k, { kind: 'pay', pay: false }), { kind: 'pay', pay: false });
    k = cast(k, 'alice', 'Bolt Lite', target(cub2));
    expect(k.objects[cub2]!.zone).toBe('battlefield');
  });

  it('Pyromancy: "Discard a card at random" — the card is picked at random, whatever was chosen', () => {
    let g = main();
    const pyro = give(g, 'alice', 'Pyromancy Lite', 'battlefield');
    for (const id of [...g.zones.hand.alice!]) {
      g.zones.hand.alice = g.zones.hand.alice!.filter((x) => x !== id);
      g.zones.exile.push(id);
      g.objects[id]!.zone = 'exile';
    }
    const golem = give(g, 'alice', 'Golem Lite', 'hand');
    const life = g.players.bob!.life;
    g = activate(g, 'alice', pyro, { targets: [[{ kind: 'player', player: 'bob' }]], costs: { discard: [] } });
    expect([g.objects[golem]!.zone, life - g.players.bob!.life]).toEqual(['graveyard', 3]);
    // With an empty hand it can't be paid.
    expect(illegal(g, { type: 'activate', player: 'alice', object: pyro, ability: 0, targets: [[{ kind: 'player', player: 'bob' }]] } as never)).toBeTruthy();
  });

  it('Vicious Betrayal: "sacrifice any number of creatures" as it\'s cast, +2/+2 for each', () => {
    let g = main();
    const [a, b] = [give(g, 'alice', 'Cub', 'battlefield'), give(g, 'alice', 'Bear', 'battlefield')];
    const ogre = give(g, 'alice', 'Green Ogre', 'battlefield');
    g = cast(g, 'alice', 'Betrayal Lite', { ...target(ogre), costs: { sacrifice: [a, b] } });
    expect([g.objects[a]!.zone, g.objects[b]!.zone, pt(g, ogre)]).toEqual(['graveyard', 'graveyard', [7, 7]]);
  });

  it('Soulblast: "sacrifice all creatures you control", damage equal to their total power', () => {
    let g = main();
    const [a, b] = [give(g, 'alice', 'Cub', 'battlefield'), give(g, 'alice', 'Green Ogre', 'battlefield')];
    const theirs = give(g, 'bob', 'Bear', 'battlefield');
    const life = g.players.bob!.life;
    g = cast(g, 'alice', 'Soulblast Lite', { targets: [[{ kind: 'player', player: 'bob' }]] });
    expect([g.objects[a]!.zone, g.objects[b]!.zone, g.objects[theirs]!.zone, life - g.players.bob!.life]).toEqual(['graveyard', 'graveyard', 'battlefield', 4]);
  });

  it('Endemic Plague: creatures sharing a creature type with the sacrificed one (a changeling shares them all)', () => {
    let g = main();
    const elf = give(g, 'alice', 'Elf Lite', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const human = give(g, 'bob', 'Human Lite', 'battlefield');
    const shifter = give(g, 'bob', 'Shapeshifter Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    g = cast(g, 'alice', 'Plague Lite', { costs: { sacrifice: [cub] } });
    expect([g.objects[bear]!.zone, g.objects[human]!.zone, g.objects[shifter]!.zone, g.objects[elf]!.zone]).toEqual(['graveyard', 'battlefield', 'graveyard', 'battlefield']);
  });

  it("Riptide Mangler and Wall of Tombstones: base power or toughness set for good", () => {
    let g = main();
    const m = give(g, 'alice', 'Mangler Lite', 'battlefield');
    const ogre = give(g, 'bob', 'Green Ogre', 'battlefield');
    g = activate(g, 'alice', m, target(ogre));
    g = toStep(g, 'main1', 'bob');
    expect(pt(g, m)).toEqual([3, 3]);
    const wall = give(g, 'alice', 'Tombstones Lite', 'battlefield');
    give(g, 'alice', 'Cub', 'graveyard');
    give(g, 'alice', 'Bear', 'graveyard');
    g = settle(toStep(g, 'draw', 'alice'));
    g = toStep(g, 'main1', 'bob');
    expect(pt(g, wall)).toEqual([0, 3]);
  });

  it('"can\'t block Humans"; "can\'t be blocked by enchanted creatures or enchantment creatures"', () => {
    let g = main();
    const human = give(g, 'alice', 'Human Lite', 'battlefield');
    const thief = give(g, 'alice', 'Thief Lite', 'battlefield');
    const ghoul = give(g, 'bob', 'Ghoul Lite', 'battlefield');
    const nymph = give(g, 'bob', 'Ench Creature', 'battlefield');
    const cub = give(g, 'bob', 'Cub', 'battlefield');
    g = toBlocks(attackWith(g, [human, thief]));
    expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: ghoul, attacker: human }] } } as never)).toBeTruthy();
    expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: nymph, attacker: thief }] } } as never)).toBeTruthy();
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: cub, attacker: thief }] } } as never);
    expect(g.combat!.attackers[thief]!.blocked).toBe(true);
  });

  it('Intrepid Ace: +2/+0 only while it isn\'t attacking or blocking', () => {
    let g = main();
    const ace = give(g, 'alice', 'Ace Lite', 'battlefield');
    expect(pt(g, ace)).toEqual([3, 1]);
    g = attackWith(g, [ace]);
    expect(pt(g, ace)).toEqual([1, 1]);
  });

  it('Burn the Impure: the controller is dealt 3 too only if the creature has infect', () => {
    let g = main();
    const inf = give(g, 'bob', 'Infect Lite', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const life = g.players.bob!.life;
    g = cast(g, 'alice', 'Impure Lite', target(bear));
    expect(g.players.bob!.life).toBe(life);
    g = cast(g, 'alice', 'Impure Lite', target(inf));
    expect([g.players.bob!.life, g.objects[inf]!.damage]).toEqual([life - 3, 3]);
  });

  it('Swimmer in Nightmares: +3/+0 while any one graveyard has ten or more cards', () => {
    const g = main();
    const s = give(g, 'alice', 'Swimmer Lite', 'battlefield');
    for (let i = 0; i < 9; i++) give(g, 'bob', 'Cub', 'graveyard');
    expect(pt(g, s)[0]).toBe(1);
    give(g, 'bob', 'Cub', 'graveyard');
    expect(pt(g, s)[0]).toBe(4);
  });

  it("Death Charmer: \"that creature's controller loses 2 life unless they pay {2}\" — they choose", () => {
    let g = main();
    const charmer = give(g, 'alice', 'Charmer Lite', 'battlefield');
    const wall = give(g, 'bob', 'Green Ogre', 'battlefield');
    g = toBlocks(attackWith(g, [charmer]));
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: wall, attacker: charmer }] } } as never);
    for (let i = 0; i < 20 && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.pending).toMatchObject({ kind: 'pay', player: 'bob' });
    const life = g.players.bob!.life;
    g = choose(g, { kind: 'pay', pay: false });
    expect(g.players.bob!.life).toBe(life - 2);
  });

  it('Charnel Troll: exile a creature card or be sacrificed', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const troll = give(g, 'alice', 'Troll Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'graveyard');
    g = settle(toStep(g, 'upkeep', 'alice'));
    expect([g.objects[cub]!.zone, g.objects[troll]!.counters['+1/+1']]).toEqual(['exile', 1]);
    g = toStep(g, 'main1', 'bob');
    // Nothing left to exile (cards discarded to hand size are moved away).
    for (const id of g.zones.graveyard.alice!.splice(0)) {
      g.zones.exile.push(id);
      g.objects[id]!.zone = 'exile';
    }
    g = settle(toStep(g, 'upkeep', 'alice'));
    expect(g.objects[troll]!.zone).toBe('graveyard');
  });

  it('Whirling Dervish: a counter at the end step only if it dealt damage to an opponent this turn', () => {
    let g = main();
    const d = give(g, 'alice', 'Dervish Lite', 'battlefield');
    g = settle(toStep(g, 'end', 'alice'));
    expect(g.objects[d]!.counters['+1/+1']).toBeUndefined();
    g = toStep(g, 'main1', 'alice');
    g = attackWith(g, [d]);
    g = toBlocks(g);
    if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } } as never);
    g = settle(toStep(g, 'end', 'alice'));
    expect(g.objects[d]!.counters['+1/+1']).toBe(1);
  });

  it("Martyr's Cry: each player draws for each of their white creatures exiled", () => {
    let g = main();
    give(g, 'bob', 'White Knight', 'battlefield');
    give(g, 'bob', 'White Knight', 'battlefield');
    give(g, 'alice', 'White Knight', 'battlefield');
    const [ha, hb] = [g.zones.hand.alice!.length, g.zones.hand.bob!.length];
    g = cast(g, 'alice', 'Cry Lite');
    expect([g.zones.hand.alice!.length - ha, g.zones.hand.bob!.length - hb]).toEqual([1, 2]);
  });

  it('Bifurcate: a permanent card with the same name as target nontoken creature, onto the battlefield', () => {
    let g = main();
    const theirs = give(g, 'bob', 'Green Ogre', 'battlefield');
    const mine = give(g, 'alice', 'Green Ogre', 'library');
    g = cast(g, 'alice', 'Bifurcate Lite', target(theirs));
    if (g.pending?.kind === 'search') g = choose(g, { kind: 'search', objects: [mine] });
    expect([g.objects[mine]!.zone, name(g, mine)]).toEqual(['battlefield', 'Green Ogre']);
  });
});

const MORE = [
  makeCard({ name: 'Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{G}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Black Ogre', type_line: 'Creature — Ogre', mana_cost: '{B}', power: '3', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Red Ping', type_line: 'Instant', mana_cost: '{R}', oracle_text: 'Red Ping deals 1 damage to any target.' }),
  makeCard({ name: 'Green Ping', type_line: 'Instant', mana_cost: '{G}', oracle_text: 'Green Ping deals 1 damage to any target.' }),
  makeCard({ name: 'Luminesce Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Prevent all damage that black sources and red sources would deal this turn.' }),
  makeCard({ name: 'Infusion Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: "Enchant creature\nEnchanted creature gets +2/+2 as long as it's an enchantment. Otherwise, it gets -2/-2." }),
  makeCard({ name: 'Nymph Lite', type_line: 'Enchantment Creature — Nymph', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Rite Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Destroy target creature. If that creature had a +1/+1 counter on it, create a 1/1 green Snake creature token.' }),
  makeCard({ name: 'Nomads Lite', type_line: 'Creature — Human Nomad', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Prevent all damage that would be dealt to this creature by black creatures.' }),
  makeCard({ name: 'Bite Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target creature you control deals damage equal to its power to target creature you don\'t control.' }),
  makeCard({ name: 'Mistform Lite', type_line: 'Creature — Illusion Wall', mana_cost: '{0}', power: '1', toughness: '4', oracle_text: "This creature has defender as long as it's a Wall.\n{0}: This creature becomes the creature type of your choice until end of turn." }),
  makeCard({ name: 'Syphon Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Unless target player pays {3}, that player loses 5 life and you gain 5 life.' }),
  makeCard({ name: 'Perish Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target opponent reveals their hand. You choose a card from it. That player shuffles that card into their library.' }),
];
const main2 = () => toStep(start({ extra: MORE }), 'main1', 'alice');
const kw = (g: GameState, id: string) => chars(g, g.objects[id]!).keywords.map((k) => k.id).sort();

describe('staples (slice 276, more)', () => {
  it('Luminesce: damage from black sources and red sources is prevented; from others it isn\'t', () => {
    let g = main2();
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    g = cast(g, 'alice', 'Luminesce Lite');
    g.players.bob!.pool = { W: 0, U: 0, B: 0, R: 1, G: 1, C: 0 };
    g = act(g, { type: 'pass', player: 'alice' });
    g = cast(g, 'bob', 'Red Ping', target(cub));
    expect(g.objects[cub]!.damage).toBe(0);
    g = until2(g, 'bob');
    g = cast(g, 'bob', 'Green Ping', target(cub));
    expect(g.objects[cub]!.zone).toBe('graveyard');
  });

  it('Nyx Infusion: +2/+2 on an enchantment creature, -2/-2 otherwise', () => {
    let g = main2();
    const nymph = give(g, 'alice', 'Nymph Lite', 'battlefield');
    const ogre = give(g, 'alice', 'Black Ogre', 'battlefield');
    const a = give(g, 'alice', 'Infusion Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: a, ...target(nymph) } as never));
    const b = give(g, 'alice', 'Infusion Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: b, ...target(ogre) } as never));
    expect([pt(g, nymph), pt(g, ogre)]).toEqual([[4, 4], [1, 1]]);
  });

  it('Rite of the Serpent: a Snake only if the creature had a +1/+1 counter on it', () => {
    let g = main2();
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const ogre = give(g, 'bob', 'Black Ogre', 'battlefield');
    g.objects[ogre]!.counters['+1/+1'] = 1;
    const before = g.zones.battlefield.length;
    g = cast(g, 'alice', 'Rite Lite', target(bear));
    expect(g.zones.battlefield.length).toBe(before - 1);
    g = cast(g, 'alice', 'Rite Lite', target(ogre));
    expect(g.zones.battlefield.filter((id) => name(g, id) === 'Snake Token').length).toBe(1);
  });

  it('Desert Nomads: "Prevent all damage that would be dealt to this creature by black creatures."', () => {
    let g = main2();
    const nomads = give(g, 'alice', 'Nomads Lite', 'battlefield');
    const ogre = give(g, 'alice', 'Black Ogre', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g.objects[nomads]!.controller = 'bob';
    g.objects[nomads]!.owner = 'bob';
    g = cast(g, 'alice', 'Bite Lite', { targets: [[{ kind: 'object', object: ogre }], [{ kind: 'object', object: nomads }]] });
    expect(g.objects[nomads]!.damage).toBe(0);
    expect(bear).toBeTruthy();
  });

  it('Mistform Wall: defender only while it\'s a Wall', () => {
    let g = main2();
    const w = give(g, 'alice', 'Mistform Lite', 'battlefield');
    expect(kw(g, w)).toEqual(['defender']);
    g = settle(act(g, { type: 'activate', player: 'alice', object: w, ability: 0 } as never));
    g = choose(g, { kind: 'choose_option', choice: 'Bird' });
    expect(kw(g, w)).toEqual([]);
  });

  it('Rhystic Syphon: "Unless target player pays {3}, that player loses 5 life and you gain 5 life."', () => {
    let g = main2();
    const [a, b] = [g.players.alice!.life, g.players.bob!.life];
    g = cast(g, 'alice', 'Syphon Lite', { targets: [[{ kind: 'player', player: 'bob' }]] });
    expect(g.pending).toMatchObject({ kind: 'pay', player: 'bob' });
    g = choose(g, { kind: 'pay', pay: false });
    expect([g.players.alice!.life - a, b - g.players.bob!.life]).toEqual([5, 5]);
  });

  it('Perish the Thought: the chosen card is shuffled into its owner\'s library', () => {
    let g = main2();
    const card = g.zones.hand.bob![0]!;
    const lib = g.zones.library.bob!.length;
    g = cast(g, 'alice', 'Perish Lite', { targets: [[{ kind: 'player', player: 'bob' }]] });
    g = choose(g, { kind: 'choose_objects', objects: [card] });
    expect([g.objects[card]!.zone, g.zones.library.bob!.length - lib]).toEqual(['library', 1]);
  });
});

function until2(g: GameState, who: string): GameState {
  while (g.priority && g.priority !== who && !g.pending) g = act(g, { type: 'pass', player: g.priority });
  return g;
}
