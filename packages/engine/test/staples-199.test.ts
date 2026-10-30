import { describe, expect, it } from 'vitest';
import { chars } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{0}', power: '5', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Ogre Brute', type_line: 'Creature — Ogre Warrior', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Bird Lite', type_line: 'Creature — Bird', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Flying' }),
  makeCard({ name: 'Bolt', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Bolt deals 3 damage to any target.' }),
  makeCard({ name: 'Rats Lite', type_line: 'Creature — Rat', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{X}: This creature deals X damage to each creature and each player. Spend only black mana on X.' }),
  makeCard({ name: 'Spirit Lite', type_line: 'Sorcery', mana_cost: '{X}', oracle_text: 'Spend only black mana on X.\nSpirit Lite deals X damage to any target and you gain X life.' }),
  makeCard({ name: 'Crown Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature\nSacrifice this Aura: Enchanted creature and other creatures that share a creature type with it get +1/+0 and gain first strike until end of turn.' }),
  makeCard({ name: 'Tobias Lite', type_line: 'Legendary Creature — Human Warrior', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'When Tobias Lite dies, for each nontoken creature you controlled that died this turn, create a 2/2 black Zombie creature token.' }),
  makeCard({ name: 'Goblin Lite', type_line: 'Creature — Goblin Berserker', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: "This creature can't attack unless an opponent has been dealt damage this turn." }),
  makeCard({ name: 'Antagonism Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "At the beginning of each player's end step, this enchantment deals 2 damage to that player unless one of their opponents was dealt damage this turn." }),
  makeCard({ name: 'Lesson Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Tap up to two target creatures. Up to two target players each draw a card.' }),
  makeCard({ name: 'Invoker Lite', type_line: 'Artifact Creature — Construct', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: '{0}: This creature and up to one other target creature each get +3/+3 until end of turn.' }),
  makeCard({ name: 'Sojourners Lite', type_line: 'Artifact Creature — Vedalken Wizard', mana_cost: '{0}', power: '4', toughness: '3', oracle_text: 'When you cycle this card and when this creature dies, you may tap or untap target permanent.\nCycling {0}' }),
  makeCard({ name: 'Fortress Lite', type_line: 'Artifact Creature — Wall', mana_cost: '{0}', power: '0', toughness: '4', oracle_text: "Defender\n{0}: This creature deals 1 damage to target creature without flying that's attacking you." }),
  makeCard({ name: 'Cavalry Lite', type_line: 'Creature — Human Knight', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Whenever this creature attacks or blocks while you control a Dinosaur, this creature gets +1/+1 until end of turn.' }),
  makeCard({ name: 'Dino', type_line: 'Creature — Dinosaur', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Wand Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "{T}: Target opponent exiles cards from the top of their library until they exile an instant or sorcery card. You may cast that card without paying its mana cost. Then put the exiled cards that weren't cast this way on the bottom of that library in a random order." }),
  makeCard({ name: 'Divination Lite', type_line: 'Sorcery', mana_cost: '{3}', oracle_text: 'Draw two cards.' }),
  makeCard({ name: 'Plains', type_line: 'Basic Land — Plains', mana_cost: '', oracle_text: '({T}: Add {W}.)' }),
  makeCard({ name: 'Bolas Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target opponent exiles cards from the top of their library until they exile a nonland card. Until end of turn, you may cast that card without paying its mana cost.' }),
  makeCard({ name: 'Swords Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each opponent exiles two cards from their hand.' }),
  makeCard({ name: 'Forget Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target player discards two cards, then draws as many cards as they discarded this way.' }),
  makeCard({ name: 'Blur Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Prevent all damage that creatures would deal to players this turn.' }),
  makeCard({ name: 'Hallar Lite', type_line: 'Legendary Creature — Elf Archer', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Whenever you cast a spell, if that spell was kicked, put a +1/+1 counter on Hallar Lite, then Hallar Lite deals damage equal to the number of +1/+1 counters on it to each opponent.' }),
  makeCard({ name: 'Kick Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Kicker {0}\nDraw a card.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const cast = (g: GameState, who: string, name: string, extra: Record<string, unknown> = {}) => settle(act(g, { type: 'cast', player: who, object: give(g, who, name, 'hand'), ...extra } as never));
const choose = (g: GameState, answer: Record<string, unknown>) => settle(act(g, { type: 'choose', player: (g.pending as { player: string }).player, answer } as never));
const toAttack = (g: GameState) => {
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return g;
};
const attackWith = (g: GameState, attackers: string[], to = 'bob', who = 'alice'): GameState => {
  g = toAttack(toStep(g, 'beginning_of_combat', who));
  return act(g, { type: 'choose', player: who, answer: { kind: 'declare_attackers', attacks: attackers.map((attacker) => ({ attacker, target: { kind: 'player' as const, player: to } })) } });
};

describe('staples (slice 273)', () => {
  it('Crypt Rats: only black mana on X', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const r = give(g, 'alice', 'Rats Lite', 'battlefield');
    g.players.alice!.pool = { W: 0, U: 0, B: 1, R: 0, G: 2, C: 0 };
    expect(illegal(g, { type: 'activate', player: 'alice', object: r, ability: 0, x: 2 } as never)).toBeTruthy();
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'activate', player: 'alice', object: r, ability: 0, x: 1 } as never));
    expect([life - g.players.bob!.life, g.players.alice!.pool.G]).toEqual([1, 2]);
  });

  it('Consume Spirit: a spell whose X is paid in black', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.players.alice!.pool = { W: 0, U: 0, B: 2, R: 0, G: 2, C: 0 };
    const s = give(g, 'alice', 'Spirit Lite', 'hand');
    const target = [[{ kind: 'player', player: 'bob' }]];
    expect(illegal(g, { type: 'cast', player: 'alice', object: s, x: 3, targets: target } as never)).toBeTruthy();
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: s, x: 2, targets: target } as never));
    expect([life - g.players.bob!.life, g.players.alice!.pool.B, g.players.alice!.pool.G]).toEqual([2, 0, 2]);
  });

  it('Crown of Fury: it and creatures sharing a type with it, once each', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [o1, o2, cub] = [give(g, 'alice', 'Ogre', 'battlefield'), give(g, 'bob', 'Ogre Brute', 'battlefield'), give(g, 'alice', 'Cub', 'battlefield')];
    const crown = give(g, 'alice', 'Crown Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: crown, targets: [[{ kind: 'object', object: o1 }]] } as never));
    g = settle(act(g, { type: 'activate', player: 'alice', object: crown, ability: 0 } as never));
    const p = (id: string) => chars(g, g.objects[id]!).power;
    expect([p(o1), p(o2), p(cub), chars(g, g.objects[o2]!).keywords.some((k) => k.id === 'first_strike')]).toEqual([6, 4, 1, true]);
  });

  it('Tobias: a Zombie for each nontoken creature you controlled that died this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [t, cub] = [give(g, 'alice', 'Tobias Lite', 'battlefield'), give(g, 'alice', 'Cub', 'battlefield')];
    give(g, 'bob', 'Ogre', 'battlefield');
    g = cast(g, 'alice', 'Bolt', { targets: [[{ kind: 'object', object: cub }]] });
    g = cast(g, 'alice', 'Bolt', { targets: [[{ kind: 'object', object: t }]] });
    const zombies = g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice').length;
    expect(zombies).toBe(2);
  });

  it("Bloodcrazed Goblin: can't attack unless an opponent was dealt damage this turn", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const gob = give(g, 'alice', 'Goblin Lite', 'battlefield');
    expect(chars(g, g.objects[gob]!).rules.has('cant_attack')).toBe(true);
    g = cast(g, 'alice', 'Bolt', { targets: [[{ kind: 'player', player: 'bob' }]] });
    expect(chars(g, g.objects[gob]!).rules.has('cant_attack')).toBe(false);
  });

  it("Antagonism: 2 damage at a player's end step unless one of their opponents was dealt damage", () => {
    for (const hit of [false, true]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      give(g, 'alice', 'Antagonism Lite', 'battlefield');
      if (hit) g = cast(g, 'alice', 'Bolt', { targets: [[{ kind: 'player', player: 'bob' }]] });
      const life = g.players.alice!.life;
      g = settle(toStep(g, 'end', 'alice'));
      expect(life - g.players.alice!.life).toBe(hit ? 0 : 2);
    }
  });

  it("Donatello's Science Lesson: up to two target players each draw", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [a, b] = [g.zones.hand.alice!.length, g.zones.hand.bob!.length];
    g = cast(g, 'alice', 'Lesson Lite', { targets: [[], [{ kind: 'player', player: 'alice' }, { kind: 'player', player: 'bob' }]] });
    expect([g.zones.hand.alice!.length - a, g.zones.hand.bob!.length - b]).toEqual([1, 1]);
  });

  it('Razorgrass Invoker: it and up to one other target creature', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [inv, cub] = [give(g, 'alice', 'Invoker Lite', 'battlefield'), give(g, 'alice', 'Cub', 'battlefield')];
    expect(illegal(g, { type: 'activate', player: 'alice', object: inv, ability: 0, targets: [[{ kind: 'object', object: inv }]] } as never)).toBeTruthy();
    g = settle(act(g, { type: 'activate', player: 'alice', object: inv, ability: 0, targets: [[{ kind: 'object', object: cub }]] } as never));
    expect([chars(g, g.objects[inv]!).power, chars(g, g.objects[cub]!).power]).toEqual([6, 4]);
  });

  it('Esper Sojourners: tap or untap a permanent when cycled', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    const s = give(g, 'alice', 'Sojourners Lite', 'hand');
    g = act(g, { type: 'activate', player: 'alice', object: s, ability: 0 } as never);
    g = settle(g);
    if (g.pending?.kind === 'trigger_targets') g = choose(g, { kind: 'trigger_targets', targets: [[{ kind: 'object', object: ogre }]] });
    for (let i = 0; i < 3 && g.pending?.kind === 'may'; i++) g = choose(g, { kind: 'may', yes: true });
    expect(g.objects[ogre]!.tapped).toBe(true);
  });

  it("Snow Fortress: only a creature without flying that's attacking you", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const f = give(g, 'alice', 'Fortress Lite', 'battlefield');
    const [ogre, bird] = [give(g, 'bob', 'Ogre', 'battlefield'), give(g, 'bob', 'Bird Lite', 'battlefield')];
    g = attackWith(g, [ogre, bird], 'alice', 'bob');
    g = act(g, { type: 'pass', player: 'bob' });
    expect(illegal(g, { type: 'activate', player: 'alice', object: f, ability: 0, targets: [[{ kind: 'object', object: bird }]] } as never)).toBeTruthy();
    g = settle(act(g, { type: 'activate', player: 'alice', object: f, ability: 0, targets: [[{ kind: 'object', object: ogre }]] } as never));
    expect(g.objects[ogre]!.damage).toBe(1);
  });

  it('Burning Sun Cavalry: +1/+1 attacking only while you control a Dinosaur', () => {
    for (const dino of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const c = give(g, 'alice', 'Cavalry Lite', 'battlefield');
      if (dino) give(g, 'alice', 'Dino', 'battlefield');
      g = settle(attackWith(g, [c]));
      expect(chars(g, g.objects[c]!).power).toBe(dino ? 4 : 3);
    }
  });

  it("Chaos Wand: their library, your free cast; the rest on the bottom", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const w = give(g, 'alice', 'Wand Lite', 'battlefield');
    const lib = g.zones.library.bob!;
    const [land, div] = [give(g, 'bob', 'Plains', 'library'), give(g, 'bob', 'Divination Lite', 'library')];
    g.zones.library.bob = [land, div, ...lib.filter((id) => id !== land && id !== div)];
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'activate', player: 'alice', object: w, ability: 0, targets: [[{ kind: 'player', player: 'bob' }]] } as never));
    expect(g.pending).toMatchObject({ kind: 'cast_free', player: 'alice', object: div });
    g = choose(g, { kind: 'cast_free', cast: true });
    g = settle(g);
    const bottom = g.zones.library.bob![g.zones.library.bob!.length - 1];
    expect([g.zones.hand.alice!.length - hand, g.objects[div]!.zone, bottom]).toEqual([2, 'graveyard', land]);
  });

  it('Nicol Bolas, God-Pharaoh: +2 — cast the exiled card free this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const div = give(g, 'bob', 'Divination Lite', 'library');
    g.zones.library.bob = [div, ...g.zones.library.bob!.filter((id) => id !== div)];
    g = cast(g, 'alice', 'Bolas Lite', { targets: [[{ kind: 'player', player: 'bob' }]] });
    expect(g.objects[div]!.zone).toBe('exile');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: div } as never));
    expect(g.zones.hand.alice!.length - hand).toBe(2);
  });

  it('Each opponent exiles two cards from their hand', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const n = g.zones.hand.bob!.length;
    g = cast(g, 'alice', 'Swords Lite');
    if (g.pending?.kind === 'choose_objects') g = choose(g, { kind: 'choose_objects', objects: g.zones.hand.bob!.slice(0, 2) });
    expect(n - g.zones.hand.bob!.length).toBe(2);
  });

  it('Forget: draws as many as discarded', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.zones.hand.bob = g.zones.hand.bob!.slice(0, 1);
    g = cast(g, 'alice', 'Forget Lite', { targets: [[{ kind: 'player', player: 'bob' }]] });
    expect(g.zones.hand.bob!.length).toBe(1);
    expect(g.zones.graveyard.bob!.length).toBe(1);
  });

  it('Chameleon Blur: creatures deal no damage to players this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    g = cast(g, 'alice', 'Blur Lite');
    const life = g.players.bob!.life;
    g = settle(attackWith(g, [ogre]));
    g = toStep(g, 'main2', 'alice');
    expect(g.players.bob!.life).toBe(life);
  });

  it("Hallar: its own +1/+1 counters, whenever you cast a kicked spell", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const h = give(g, 'alice', 'Hallar Lite', 'battlefield');
    g.objects[h]!.counters['+1/+1'] = 2;
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Kick Lite', 'hand'), kicked: true } as never));
    expect(life - g.players.bob!.life).toBe(3);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Kick Lite', 'hand') } as never));
    expect(life - g.players.bob!.life).toBe(3);
  });
});
