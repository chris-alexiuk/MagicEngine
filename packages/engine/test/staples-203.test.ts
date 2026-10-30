import { describe, expect, it } from 'vitest';
import { chars } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{G}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Vampire Lite', type_line: 'Creature — Vampire', mana_cost: '{0}', power: '1', toughness: '5', oracle_text: '' }),
  makeCard({ name: 'White Knight', type_line: 'Creature — Human Knight', mana_cost: '{W}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Plains', type_line: 'Basic Land — Plains', mana_cost: '', oracle_text: '({T}: Add {W}.)' }),
  makeCard({ name: 'Extortion Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Look at target player's hand and choose up to two cards from it. That player discards those cards." }),
  makeCard({ name: 'Slayer Lite', type_line: 'Creature — Human Cleric', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{0}: This creature deals 1 damage to target creature.\nWhenever this creature deals damage to a Vampire, destroy that creature.' }),
  makeCard({ name: 'Golem Lite', type_line: 'Artifact Creature — Golem', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'This creature enters with three +1/+1 counters on it.\nAt the beginning of your upkeep, sacrifice this creature unless you remove a +1/+1 counter from it.' }),
  makeCard({ name: 'Wound Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target opponent sacrifices a green or white creature of their choice. If that player does, they lose 2 life.' }),
  makeCard({ name: 'Flay Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target player discards a card at random. Then that player discards another card at random unless they pay {1}.' }),
  makeCard({ name: 'Shambler Lite', type_line: 'Creature — Fungus', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever this creature deals damage to an opponent, you draw a card and that opponent discards a card.' }),
  makeCard({ name: 'Deadfall Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}, Sacrifice two lands and this artifact: Destroy target attacking creature.' }),
  makeCard({ name: 'Wurm Lite', type_line: 'Creature — Wurm', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: 'Defender, trample\nWhen this creature blocks, it loses defender.' }),
  makeCard({ name: 'Aurochs', type_line: 'Creature — Aurochs', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: 'Trample\nWhenever this creature attacks, it gets +1/+0 until end of turn for each other attacking Aurochs.' }),
  makeCard({ name: 'Wakecaster Lite', type_line: 'Creature — Faerie Wizard', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{0}: Choose a creature type. Each creature you control becomes that type until end of turn.' }),
  makeCard({ name: 'Flask Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Sacrifice this artifact: Choose a basic land type. Each land you control becomes that type until end of turn.' }),
  makeCard({ name: 'Slogger Lite', type_line: 'Creature — Beast', mana_cost: '{0}', power: '4', toughness: '5', oracle_text: '{0}, Exile the top ten cards of your library: This creature deals 2 damage to any target.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const cast = (g: GameState, who: string, name: string, extra: Record<string, unknown> = {}) => settle(act(g, { type: 'cast', player: who, object: give(g, who, name, 'hand'), ...extra } as never));
const target = (id: string) => ({ targets: [[{ kind: 'object', object: id }]] });
const bob = { targets: [[{ kind: 'player', player: 'bob' }]] };
const choose = (g: GameState, answer: Record<string, unknown>) => settle(act(g, { type: 'choose', player: (g.pending as { player: string }).player, answer } as never));
const activate = (g: GameState, who: string, object: string, extra: Record<string, unknown> = {}, ability = 0) => settle(act(g, { type: 'activate', player: who, object, ability, ...extra } as never));
const main = () => toStep(start({ extra: CARDS }), 'main1', 'alice');
const attackWith = (g: GameState, attackers: string[], to = 'bob', who = 'alice'): GameState => {
  g = toStep(g, 'beginning_of_combat', who);
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return act(g, { type: 'choose', player: who, answer: { kind: 'declare_attackers', attacks: attackers.map((attacker) => ({ attacker, target: { kind: 'player' as const, player: to } })) } });
};
const throughCombat = (g: GameState, blocks: { blocker: string; attacker: string }[] = []) => {
  for (let i = 0; i < 60 && g.step !== 'end_of_combat' && g.step !== 'main2'; i++) {
    if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks } } as never);
    else if (g.pending) break;
    else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
    else break;
  }
  return g;
};

describe('staples (slice 277)', () => {
  it('Extortion: "choose up to two cards from it" — none, one or two', () => {
    let g = main();
    const hand = [...g.zones.hand.bob!];
    g = cast(g, 'alice', 'Extortion Lite', bob);
    expect((g.pending as { min: number; max: number })).toMatchObject({ min: 0, max: 2 });
    g = choose(g, { kind: 'choose_objects', objects: hand.slice(0, 1) });
    expect(g.zones.hand.bob!.length).toBe(hand.length - 1);
  });

  it('Vampire Slayer: "Whenever this creature deals damage to a Vampire, destroy that creature."', () => {
    let g = main();
    const slayer = give(g, 'alice', 'Slayer Lite', 'battlefield');
    const vamp = give(g, 'bob', 'Vampire Lite', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = activate(g, 'alice', slayer, target(bear));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    g = activate(g, 'alice', slayer, target(vamp));
    expect(g.objects[vamp]!.zone).toBe('graveyard');
  });

  it('Junk Golem: "sacrifice this creature unless you remove a +1/+1 counter from it"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const golem = give(g, 'alice', 'Golem Lite', 'battlefield');
    g.objects[golem]!.counters['+1/+1'] = 1;
    g = settle(toStep(g, 'upkeep', 'alice'));
    g = choose(g, { kind: 'pay', pay: true });
    expect([g.objects[golem]!.zone, g.objects[golem]!.counters['+1/+1'] ?? 0]).toEqual(['battlefield', 0]);
    g = settle(toStep(toStep(g, 'main1', 'bob'), 'upkeep', 'alice'));
    expect(g.objects[golem]!.zone).toBe('graveyard');
  });

  it('Self-Inflicted Wound: they lose 2 life only if they sacrificed a creature', () => {
    let g = main();
    const life = g.players.bob!.life;
    g = cast(g, 'alice', 'Wound Lite', bob);
    expect(g.players.bob!.life).toBe(life);
    const knight = give(g, 'bob', 'White Knight', 'battlefield');
    g = cast(g, 'alice', 'Wound Lite', bob);
    expect([g.objects[knight]!.zone, g.players.bob!.life]).toEqual(['graveyard', life - 2]);
  });

  it('Flay: a card at random, then another unless they pay {1}', () => {
    let g = main();
    const hand = g.zones.hand.bob!.length;
    g = cast(g, 'alice', 'Flay Lite', bob);
    expect(g.pending).toMatchObject({ kind: 'pay', player: 'bob' });
    g = choose(g, { kind: 'pay', pay: false });
    expect(g.zones.hand.bob!.length).toBe(hand - 2);
  });

  it('Fungal Shambler: you draw and "that opponent" discards', () => {
    let g = main();
    const s = give(g, 'alice', 'Shambler Lite', 'battlefield');
    const [ha, hb] = [g.zones.hand.alice!.length, g.zones.hand.bob!.length];
    g = throughCombat(attackWith(g, [s]));
    if (g.pending?.kind === 'discard') g = choose(g, { kind: 'discard', objects: g.zones.hand.bob!.slice(0, 1) });
    expect([g.zones.hand.alice!.length - ha, hb - g.zones.hand.bob!.length]).toEqual([1, 1]);
  });

  it('Sandstone Deadfall: "Sacrifice two lands and this artifact" as the cost', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const fall = give(g, 'alice', 'Deadfall Lite', 'battlefield');
    const lands = [give(g, 'alice', 'Plains', 'battlefield'), give(g, 'alice', 'Plains', 'battlefield')];
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = attackWith(g, [bear], 'alice', 'bob');
    while (g.priority && g.priority !== 'alice') g = act(g, { type: 'pass', player: g.priority });
    g = activate(g, 'alice', fall, { ...target(bear), costs: { sacrifice: lands } });
    expect([g.objects[bear]!.zone, g.objects[fall]!.zone, g.objects[lands[0]!]!.zone]).toEqual(['graveyard', 'graveyard', 'graveyard']);
  });

  it('Elder Land Wurm: blocking, it loses defender for good', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const wurm = give(g, 'alice', 'Wurm Lite', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = throughCombat(attackWith(g, [bear], 'alice', 'bob'), [{ blocker: wurm, attacker: bear }]);
    g = toStep(g, 'main1', 'alice');
    expect(chars(g, g.objects[wurm]!).keywords.map((k) => k.id)).toEqual(['trample']);
  });

  it('Aurochs: "+1/+0 for each other attacking Aurochs" (its name is that creature type)', () => {
    let g = main();
    const [a, b] = [give(g, 'alice', 'Aurochs', 'battlefield'), give(g, 'alice', 'Aurochs', 'battlefield')];
    g = settle(attackWith(g, [a, b]));
    expect([chars(g, g.objects[a]!).power, chars(g, g.objects[b]!).power]).toEqual([3, 3]);
  });

  it('Mistform Wakecaster and Elsewhere Flask: "becomes that type until end of turn"', () => {
    let g = main();
    const w = give(g, 'alice', 'Wakecaster Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    g = activate(g, 'alice', w);
    g = choose(g, { kind: 'choose_option', choice: 'Elf' });
    expect([chars(g, g.objects[cub]!).subtypes, chars(g, g.objects[w]!).subtypes]).toEqual([['Elf'], ['Elf']]);
    const flask = give(g, 'alice', 'Flask Lite', 'battlefield');
    const plains = give(g, 'alice', 'Plains', 'battlefield');
    g = activate(g, 'alice', flask, { costs: {} });
    if (g.pending?.kind !== 'choose_option') g = settle(g);
    g = choose(g, { kind: 'choose_option', choice: 'Island' });
    expect(chars(g, g.objects[plains]!).subtypes).toEqual(['Island']);
  });

  it('Arc-Slogger: "Exile the top ten cards of your library" — only with ten there', () => {
    let g = main();
    const s = give(g, 'alice', 'Slogger Lite', 'battlefield');
    const lib = g.zones.library.alice!.length;
    const life = g.players.bob!.life;
    g = activate(g, 'alice', s, bob);
    expect([lib - g.zones.library.alice!.length, life - g.players.bob!.life, g.zones.exile.length]).toEqual([10, 2, 10]);
    const rest = g.zones.library.alice!.splice(9);
    g.zones.exile.push(...rest);
    for (const id of rest) g.objects[id]!.zone = 'exile';
    expect(illegal(g, { type: 'activate', player: 'alice', object: s, ability: 0, ...bob } as never)).toMatch(/enough cards/);
  });
});

const MORE = [
  makeCard({ name: 'Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{0}', power: '5', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Blue Bear', type_line: 'Creature — Bear', mana_cost: '{U}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Plains', type_line: 'Basic Land — Plains', mana_cost: '', oracle_text: '({T}: Add {W}.)' }),
  makeCard({ name: 'Runner Lite', type_line: 'Creature — Kavu', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'This creature has haste as long as no opponent controls a white or blue creature.' }),
  makeCard({ name: 'Handler Lite', type_line: 'Creature — Goblin', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "This creature can't block creatures with power greater than this creature's power." }),
  makeCard({ name: 'Steel Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Steel Lite deals 2 damage to each of one or two targets.' }),
  makeCard({ name: 'Wall Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Creatures with plainswalk can be blocked as though they didn't have plainswalk." }),
  makeCard({ name: 'Walker Lite', type_line: 'Creature — Spirit', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Plainswalk' }),
  makeCard({ name: 'Growth Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target player chooses three cards from their hand and puts them on top of their library in any order.' }),
  makeCard({ name: 'Dryad Lite', type_line: 'Creature — Dryad', mana_cost: '{0}', power: '1', toughness: '2', oracle_text: 'This creature can block creatures with shadow as though it had shadow.' }),
  makeCard({ name: 'Shade Lite', type_line: 'Creature — Shade', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Shadow' }),
];
const main2 = () => toStep(start({ extra: MORE }), 'main1', 'alice');
const toBlocks = (g: GameState) => {
  while (g.pending?.kind !== 'declare_blockers' && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return g;
};
const blocks = (g: GameState, blocker: string, attacker: string) => ({ type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker, attacker }] } }) as never;

describe('staples (slice 277, more)', () => {
  it('Kavu Runner: haste only while no opponent controls a white or blue creature', () => {
    const g = main2();
    const k = give(g, 'alice', 'Runner Lite', 'battlefield');
    expect(chars(g, g.objects[k]!).keywords.map((x) => x.id)).toEqual(['haste']);
    give(g, 'bob', 'Blue Bear', 'battlefield');
    expect(chars(g, g.objects[k]!).keywords).toEqual([]);
  });

  it("Spitfire Handler: can't block creatures with greater power", () => {
    let g = main2();
    const [cub, ogre] = [give(g, 'alice', 'Cub', 'battlefield'), give(g, 'alice', 'Ogre', 'battlefield')];
    const h = give(g, 'bob', 'Handler Lite', 'battlefield');
    g = toBlocks(attackWith(g, [cub, ogre]));
    expect(illegal(g, blocks(g, h, ogre))).toBeTruthy();
    g = act(g, blocks(g, h, cub));
    expect(g.combat!.attackers[cub]!.blocked).toBe(true);
  });

  it('Storm of Steel: "each of one or two targets"', () => {
    let g = main2();
    const s = give(g, 'alice', 'Steel Lite', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: s, targets: [[]] } as never)).toBeTruthy();
    const cub = give(g, 'bob', 'Cub', 'battlefield');
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: s, targets: [[{ kind: 'object', object: cub }, { kind: 'player', player: 'bob' }]] } as never));
    expect([g.objects[cub]!.zone, life - g.players.bob!.life]).toEqual(['graveyard', 2]);
  });

  it('Great Wall: plainswalkers can be blocked as though they didn\'t have plainswalk', () => {
    let g = main2();
    const w = give(g, 'alice', 'Walker Lite', 'battlefield');
    give(g, 'bob', 'Plains', 'battlefield');
    const cub = give(g, 'bob', 'Cub', 'battlefield');
    let k = toBlocks(attackWith(g, [w]));
    expect(illegal(k, blocks(k, cub, w))).toMatch(/plainswalk/);
    give(g, 'bob', 'Wall Lite', 'battlefield');
    k = toBlocks(attackWith(g, [w]));
    k = act(k, blocks(k, cub, w));
    expect(k.combat!.attackers[w]!.blocked).toBe(true);
  });

  it('Stunted Growth: that player picks three cards from their hand to put on top', () => {
    let g = main2();
    const hand = [...g.zones.hand.bob!];
    g = cast(g, 'alice', 'Growth Lite', bob);
    expect(g.pending).toMatchObject({ kind: 'choose_objects', player: 'bob' });
    g = choose(g, { kind: 'choose_objects', objects: hand.slice(0, 3) });
    expect([g.zones.hand.bob!.length, g.zones.library.bob!.slice(0, 3).sort()]).toEqual([hand.length - 3, hand.slice(0, 3).sort()]);
  });

  it('Heartwood Dryad: blocks a creature with shadow', () => {
    let g = main2();
    const shade = give(g, 'alice', 'Shade Lite', 'battlefield');
    const dryad = give(g, 'bob', 'Dryad Lite', 'battlefield');
    const cub = give(g, 'bob', 'Cub', 'battlefield');
    g = toBlocks(attackWith(g, [shade]));
    expect(illegal(g, blocks(g, cub, shade))).toMatch(/shadow/);
    g = act(g, blocks(g, dryad, shade));
    expect(g.combat!.attackers[shade]!.blocked).toBe(true);
  });
});
