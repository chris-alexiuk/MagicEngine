import { describe, expect, it } from 'vitest';
import { chars } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{0}', power: '5', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Plains', type_line: 'Basic Land — Plains', mana_cost: '', oracle_text: '({T}: Add {W}.)' }),
  makeCard({ name: 'Hydra Lite', type_line: 'Creature — Hydra', mana_cost: '{0}', power: '0', toughness: '0', oracle_text: '{T}, Remove all +1/+1 counters from this creature: It deals damage to any target equal to the number of +1/+1 counters removed this way.' }),
  makeCard({ name: 'Amulet Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{0}, {T}, Remove all charge counters from this artifact: It deals that much damage to target creature.' }),
  makeCard({ name: 'Kassandra Lite', type_line: 'Legendary Creature — Human Warrior', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever a creature you control with a legendary Equipment attached to it deals combat damage to a player, draw a card.' }),
  makeCard({ name: 'Spear Lite', type_line: 'Legendary Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equip {0}' }),
  makeCard({ name: 'Plain Spear', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equip {0}' }),
  makeCard({ name: 'Burn Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Burn Lite deals 5 damage to target black or green creature or planeswalker. If that permanent would die this turn, exile it instead.' }),
  makeCard({ name: 'Green Ogre', type_line: 'Creature — Ogre', mana_cost: '{G}', power: '3', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Timber Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Kicker {0}\nPrevent all combat damage target creature would deal this turn. If this spell was kicked, prevent all combat damage another target creature would deal this turn.' }),
  makeCard({ name: 'Possession Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature\nEnchanted creature is a Demon Spirit.' }),
  makeCard({ name: 'Rage Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: "Enchant creature\nEnchanted creature gets +3/+0 as long as it's attacking. Otherwise, it gets -2/-1." }),
  makeCard({ name: 'Mentor Lite', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "{T}: Return this creature and target creature you control to their owner's hand." }),
  makeCard({ name: 'Monger Lite', type_line: 'Creature — Human', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{0}: Target player discards a card. Any player may activate this ability but only as a sorcery.' }),
  makeCard({ name: 'Harpist Lite', type_line: 'Creature — Human Bard', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{T}: Destroy target Aura attached to a creature.' }),
  makeCard({ name: 'Land Aura', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant land' }),
  makeCard({ name: 'Eye Spy Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Look at the top card of target player's library. You may put that card into their graveyard." }),
  makeCard({ name: 'Shard Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{3}, {T} or {R}, {T}: This artifact deals 1 damage to any target.' }),
  makeCard({ name: 'Cavalier Lite', type_line: 'Creature — Human Knight', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'This creature has first strike as long as another Knight entered the battlefield under your control this turn.' }),
  makeCard({ name: 'Knight Lite', type_line: 'Creature — Human Knight', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Hunter Lite', type_line: 'Creature — Human Warrior', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'As long as a creature has a -1/-1 counter on it, this creature has vigilance and deathtouch.' }),
  makeCard({ name: 'Quake Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Return all creatures on the battlefield and all creature cards in graveyards to their owners' hands." }),
  makeCard({ name: 'Toil Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'You gain 1 life for each tapped artifact, creature, and land you control.' }),
  makeCard({ name: 'Witch Lite', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{0}: Search your library for a card named Cub or Ogre, put it onto the battlefield tapped, then shuffle.' }),
  makeCard({ name: 'Terrain Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: "Enchant land\nEnchanted land is a 5/6 green Treefolk creature that's still a land." }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const cast = (g: GameState, who: string, name: string, extra: Record<string, unknown> = {}) => settle(act(g, { type: 'cast', player: who, object: give(g, who, name, 'hand'), ...extra } as never));
const toAttack = (g: GameState) => {
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return g;
};
const attackWith = (g: GameState, attackers: string[], to = 'bob', who = 'alice'): GameState => {
  g = toAttack(toStep(g, 'beginning_of_combat', who));
  return act(g, { type: 'choose', player: who, answer: { kind: 'declare_attackers', attacks: attackers.map((attacker) => ({ attacker, target: { kind: 'player' as const, player: to } })) } });
};

describe('staples (slice 274)', () => {
  it('Molten Hydra: remove all its +1/+1 counters, that much damage', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const h = give(g, 'alice', 'Hydra Lite', 'battlefield');
    g.objects[h]!.counters['+1/+1'] = 3;
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'activate', player: 'alice', object: h, ability: 0, targets: [[{ kind: 'player', player: 'bob' }]] } as never));
    expect([life - g.players.bob!.life, g.objects[h]!.zone]).toEqual([3, 'graveyard']);
  });

  it('Relic Amulet: "that much damage" is the counters removed', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const a = give(g, 'alice', 'Amulet Lite', 'battlefield');
    g.objects[a]!.counters.charge = 2;
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: a, ability: 0, targets: [[{ kind: 'object', object: ogre }]] } as never));
    expect([g.objects[ogre]!.damage, g.objects[a]!.counters.charge ?? 0]).toEqual([2, 0]);
  });

  it('Kassandra: only a creature with a legendary Equipment attached', () => {
    for (const legendary of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      give(g, 'alice', 'Kassandra Lite', 'battlefield');
      const cub = give(g, 'alice', 'Cub', 'battlefield');
      const spear = give(g, 'alice', legendary ? 'Spear Lite' : 'Plain Spear', 'battlefield');
      g = settle(act(g, { type: 'activate', player: 'alice', object: spear, ability: 0, targets: [[{ kind: 'object', object: cub }]] } as never));
      const hand = g.zones.hand.alice!.length;
      g = settle(attackWith(g, [cub]));
      g = settle(toStep(g, 'end_of_combat', 'alice'));
      expect(g.zones.hand.alice!.length - hand).toBe(legendary ? 1 : 0);
    }
  });

  it('Essence Burn: a black or green creature, exiled if it would die', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [green, plain] = [give(g, 'bob', 'Green Ogre', 'battlefield'), give(g, 'bob', 'Ogre', 'battlefield')];
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Burn Lite', 'hand'), targets: [[{ kind: 'object', object: plain }]] } as never)).toBeTruthy();
    g = cast(g, 'alice', 'Burn Lite', { targets: [[{ kind: 'object', object: green }]] });
    expect(g.objects[green]!.zone).toBe('exile');
  });

  it('Falling Timber: the second target only when kicked', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    g = cast(g, 'alice', 'Timber Lite', { targets: [[{ kind: 'object', object: ogre }]] });
    expect(g.stack.length).toBe(0);
    const cub = give(g, 'bob', 'Cub', 'battlefield');
    g = cast(g, 'alice', 'Timber Lite', { kicked: true, targets: [[{ kind: 'object', object: ogre }], [{ kind: 'object', object: cub }]] });
    expect(g.stack.length).toBe(0);
  });

  it('Oni Possession: a Demon Spirit', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    g = cast(g, 'alice', 'Possession Lite', { targets: [[{ kind: 'object', object: cub }]] });
    expect(chars(g, g.objects[cub]!).subtypes).toEqual(['Demon', 'Spirit']);
  });

  it("Tahngarth's Rage: +3/+0 attacking, otherwise -2/-1", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    g = cast(g, 'alice', 'Rage Lite', { targets: [[{ kind: 'object', object: ogre }]] });
    expect([chars(g, g.objects[ogre]!).power, chars(g, g.objects[ogre]!).toughness]).toEqual([3, 2]);
    g = attackWith(g, [ogre]);
    expect([chars(g, g.objects[ogre]!).power, chars(g, g.objects[ogre]!).toughness]).toEqual([8, 3]);
  });

  it('Wizard Mentor: it and another creature you control back to hand', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [m, cub] = [give(g, 'alice', 'Mentor Lite', 'battlefield'), give(g, 'alice', 'Cub', 'battlefield')];
    g = settle(act(g, { type: 'activate', player: 'alice', object: m, ability: 0, targets: [[{ kind: 'object', object: cub }]] } as never));
    expect([g.objects[m]!.zone, g.objects[cub]!.zone]).toEqual(['hand', 'hand']);
  });

  it('Scandalmonger: any player may activate it, only as a sorcery', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const m = give(g, 'alice', 'Monger Lite', 'battlefield');
    g = toStep(g, 'main1', 'bob');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'activate', player: 'bob', object: m, ability: 0, targets: [[{ kind: 'player', player: 'alice' }]] } as never));
    if (g.pending?.kind === 'discard') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: g.zones.hand.alice!.slice(0, 1) } } as never));
    expect(hand - g.zones.hand.alice!.length).toBe(1);
    g = toStep(g, 'end', 'bob');
    expect(illegal(g, { type: 'activate', player: 'bob', object: m, ability: 0, targets: [[{ kind: 'player', player: 'alice' }]] } as never)).toBeTruthy();
  });

  it('Devout Harpist: an Aura attached to a creature', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [h, cub, land] = [give(g, 'alice', 'Harpist Lite', 'battlefield'), give(g, 'bob', 'Cub', 'battlefield'), give(g, 'bob', 'Plains', 'battlefield')];
    const pos = give(g, 'bob', 'Possession Lite', 'hand');
    g = toStep(g, 'main1', 'bob');
    g = settle(act(g, { type: 'cast', player: 'bob', object: pos, targets: [[{ kind: 'object', object: cub }]] } as never));
    const terr = give(g, 'bob', 'Land Aura', 'hand');
    g = settle(act(g, { type: 'cast', player: 'bob', object: terr, targets: [[{ kind: 'object', object: land }]] } as never));
    g = toStep(g, 'main1', 'alice');
    expect(illegal(g, { type: 'activate', player: 'alice', object: h, ability: 0, targets: [[{ kind: 'object', object: terr }]] } as never)).toBeTruthy();
    g = settle(act(g, { type: 'activate', player: 'alice', object: h, ability: 0, targets: [[{ kind: 'object', object: pos }]] } as never));
    expect(g.objects[pos]!.zone).toBe('graveyard');
  });

  it('Living Terrain: a 5/6 green Treefolk creature that is still a land', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const land = give(g, 'alice', 'Plains', 'battlefield');
    g = cast(g, 'alice', 'Terrain Lite', { targets: [[{ kind: 'object', object: land }]] });
    const c = chars(g, g.objects[land]!);
    expect([c.types.includes('Land'), c.types.includes('Creature'), c.power, c.toughness, c.colors]).toEqual([true, true, 5, 6, ['G']]);
  });

  it("Eye Spy: their top card stays or goes to their graveyard", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const top = g.zones.library.bob![0]!;
    g = cast(g, 'alice', 'Eye Spy Lite', { targets: [[{ kind: 'player', player: 'bob' }]] });
    expect(g.pending?.player).toBe('alice');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [] } } as never));
    expect(g.objects[top]!.zone).toBe('graveyard');
  });

  it('Granite Shard: either cost', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const s = give(g, 'alice', 'Shard Lite', 'battlefield');
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 };
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'activate', player: 'alice', object: s, ability: 1, targets: [[{ kind: 'player', player: 'bob' }]] } as never));
    expect(life - g.players.bob!.life).toBe(1);
  });

  it('Swordsworn Cavalier: first strike once another Knight entered this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const c = give(g, 'alice', 'Cavalier Lite', 'battlefield');
    expect(chars(g, g.objects[c]!).keywords.some((k) => k.id === 'first_strike')).toBe(false);
    g = cast(g, 'alice', 'Knight Lite');
    expect(chars(g, g.objects[c]!).keywords.some((k) => k.id === 'first_strike')).toBe(true);
  });

  it('Tenacious Hunter: while any creature has a -1/-1 counter', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const h = give(g, 'alice', 'Hunter Lite', 'battlefield');
    const cub = give(g, 'bob', 'Cub', 'battlefield');
    expect(chars(g, g.objects[h]!).keywords.some((k) => k.id === 'deathtouch')).toBe(false);
    g.objects[cub]!.counters['-1/-1'] = 1;
    expect(chars(g, g.objects[h]!).keywords.some((k) => k.id === 'deathtouch')).toBe(true);
  });

  it('Soulquake: creatures and creature cards in graveyards to hand', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [a, b] = [give(g, 'bob', 'Ogre', 'battlefield'), give(g, 'alice', 'Cub', 'graveyard')];
    g = cast(g, 'alice', 'Quake Lite');
    expect([g.objects[a]!.zone, g.objects[b]!.zone]).toEqual(['hand', 'hand']);
  });

  it('Toil to Renown: each tapped artifact, creature, or land once', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [l, c] = [give(g, 'alice', 'Plains', 'battlefield'), give(g, 'alice', 'Cub', 'battlefield')];
    give(g, 'alice', 'Ogre', 'battlefield');
    g.objects[l]!.tapped = true;
    g.objects[c]!.tapped = true;
    const life = g.players.alice!.life;
    g = cast(g, 'alice', 'Toil Lite');
    expect(g.players.alice!.life - life).toBe(2);
  });

  it('Bogbrew Witch: a card with either name', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const w = give(g, 'alice', 'Witch Lite', 'battlefield');
    const ogre = give(g, 'alice', 'Ogre', 'library');
    g = settle(act(g, { type: 'activate', player: 'alice', object: w, ability: 0 } as never));
    if (g.pending?.kind === 'search') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [ogre] } } as never));
    expect(g.objects[ogre]!.zone).toBe('battlefield');
  });
});
