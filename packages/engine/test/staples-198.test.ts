import { describe, expect, it } from 'vitest';
import { chars } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{0}', power: '5', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Goblin Cub', type_line: 'Creature — Goblin', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Bird Lite', type_line: 'Creature — Bird', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Flying' }),
  makeCard({ name: 'Bolt', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Bolt deals 3 damage to any target.' }),
  makeCard({ name: 'Plains', type_line: 'Basic Land — Plains', mana_cost: '', oracle_text: '({T}: Add {W}.)' }),
  makeCard({ name: 'Wastes Lite', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {C}.' }),
  makeCard({ name: 'Clip Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Each opponent sacrifices a creature of their choice with flying.' }),
  makeCard({ name: 'Miner Lite', type_line: 'Creature — Dwarf', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "Sacrifice this creature: Target player can't play lands this turn." }),
  makeCard({ name: 'Pilferers Lite', type_line: 'Creature — Goblin', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'When this creature enters, return target creature card from your graveyard to your hand. If that card is a Goblin card, this creature gains haste until end of turn.' }),
  makeCard({ name: 'Berserker Lite', type_line: 'Creature — Human Berserker', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'When this creature dies, if its power was 3 or greater, create a 2/2 black Zombie Berserker creature token.' }),
  makeCard({ name: 'Pump Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Target creature gets +1/+0 until end of turn.' }),
  makeCard({ name: 'Sands Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Destroy target land. If that land was nonbasic, Sands Lite deals 2 damage to the land's controller." }),
  makeCard({ name: 'Pet Lite', type_line: 'Creature — Illusion', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: "At the beginning of your upkeep, if you have a card in hand, return this creature to its owner's hand." }),
  makeCard({ name: 'Atlas Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "At the beginning of your end step, if you didn't play a land this turn, you may draw a card." }),
  makeCard({ name: 'Liability Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Whenever a nontoken permanent is put into a player's graveyard from the battlefield, that player loses 1 life." }),
  makeCard({ name: 'Aethermage Lite', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Whenever a permanent is returned to your hand, you may pay {1}. If you do, draw a card.' }),
  makeCard({ name: 'Bounce Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Return target creature to its owner's hand." }),
  makeCard({ name: 'Silence Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Counter all other spells. Draw a card for each spell countered this way.' }),
  makeCard({ name: 'Fracture Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target artifact or enchantment. If that permanent was blue or black, draw a card.' }),
  makeCard({ name: 'Blue Relic', type_line: 'Artifact', mana_cost: '{U}', oracle_text: '' }),
  makeCard({ name: 'Grey Relic', type_line: 'Artifact', mana_cost: '{1}', oracle_text: '' }),
  makeCard({ name: 'Advantage Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "At the beginning of each opponent's end step, if that player didn't cast a creature spell this turn, create a 2/2 green Lizard creature token." }),
  makeCard({ name: 'Branchwalker Lite', type_line: 'Creature — Merfolk Scout', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: 'When this creature enters, it explores.' }),
  makeCard({ name: 'Walker Lite', type_line: 'Creature — Elemental', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: 'Whenever a creature you control explores, put a +1/+1 counter on this creature and you gain 3 life.' }),
  makeCard({ name: 'Chasm Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Creatures without flying can't block this turn." }),
  makeCard({ name: 'Veto Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "White creatures and blue creatures can't block." }),
  makeCard({ name: 'White Cub', type_line: 'Creature — Bear', mana_cost: '{W}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Keeper Lite', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '1', toughness: '2', oracle_text: '{T}: Choose target opponent who has more life than you do as you activate this ability. This creature deals 2 damage to that player.' }),
  makeCard({ name: 'Rix Lite', type_line: 'Creature — Human Shaman', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '{0}: Target player who lost life this turn loses 1 life.' }),
  makeCard({ name: 'Presence Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Whenever a spell you've cast is countered, draw a card." }),
  makeCard({ name: 'Cancel Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Counter target spell.' }),
  makeCard({ name: 'Titan Lite', type_line: 'Creature — Kavu', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: 'Kicker {0}\nIf this creature was kicked, it enters with three +1/+1 counters on it and with trample.' }),
  makeCard({ name: 'Blessing Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Target artifact or creature you control gains protection from artifacts or from the color of your choice until end of turn.' }),
  makeCard({ name: 'Flames Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Flames Lite deals 4 damage to target player or planeswalker. The damage can't be prevented. If that player or that planeswalker's controller would gain life this turn, that player gains no life instead." }),
  makeCard({ name: 'Heal Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'You gain 3 life.' }),
  makeCard({ name: 'Fangs Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature\nWhenever enchanted creature deals damage to a creature, destroy the other creature.' }),
  makeCard({ name: 'Fight Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Target creature you control fights target creature you don't control." }),
  makeCard({ name: 'Hellfire Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Destroy all nonblack creatures. Hellfire Lite deals X plus 3 damage to you, where X is the number of creatures that died this way.' }),
  makeCard({ name: 'Mulcher Lite', type_line: 'Creature — Insect', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Devour 1\nWhen this creature enters, draw a card for each creature it devoured.' }),
  makeCard({ name: 'Relic Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Metalcraft — This artifact is a 5/5 Golem artifact creature as long as you control three or more artifacts.' }),
  makeCard({ name: 'Grey Relic 2', type_line: 'Artifact', mana_cost: '{1}', oracle_text: '' }),
  makeCard({ name: 'Alarum Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Untap target nonattacking creature. It gets +1/+3 until end of turn.' }),
  makeCard({ name: 'Mentor Lite', type_line: 'Creature — Minotaur Soldier', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "Whenever you attack a player, target creature that's attacking that player gains first strike until end of turn." }),
  makeCard({ name: 'Disintegrate Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Disintegrate Lite deals 1 damage to any target. If it's a creature, it can't be regenerated this turn, and if it would die this turn, exile it instead." }),
  makeCard({ name: 'Disposal Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'As an additional cost to cast this spell, discard a card and sacrifice a creature.\nTarget creature gets -13/-13 until end of turn.' }),
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
  g = toAttack(toStep(g, 'beginning_of_combat'));
  return act(g, { type: 'choose', player: who, answer: { kind: 'declare_attackers', attacks: attackers.map((attacker) => ({ attacker, target: { kind: 'player' as const, player: to } })) } });
};

describe('staples (slice 272)', () => {
  it('Clip Wings: each opponent sacrifices a creature with flying', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [bird, cub] = [give(g, 'bob', 'Bird Lite', 'battlefield'), give(g, 'bob', 'Cub', 'battlefield')];
    g = cast(g, 'alice', 'Clip Lite');
    expect([g.objects[bird]!.zone, g.objects[cub]!.zone]).toEqual(['graveyard', 'battlefield']);
  });

  it("Pardic Miner: target player can't play lands this turn", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const m = give(g, 'alice', 'Miner Lite', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: m, ability: 0, targets: [[{ kind: 'player', player: 'alice' }]] } as never));
    const land = give(g, 'alice', 'Plains', 'hand');
    expect(() => act(g, { type: 'play_land', player: 'alice', object: land } as never)).toThrow();
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    g = act(g, { type: 'play_land', player: 'alice', object: land } as never);
    expect(g.objects[land]!.zone).toBe('battlefield');
  });

  it('Warren Pilferers: haste only if the card returned is a Goblin', () => {
    for (const goblin of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const card = give(g, 'alice', goblin ? 'Goblin Cub' : 'Cub', 'graveyard');
      const p = give(g, 'alice', 'Pilferers Lite', 'hand');
      g = settle(act(g, { type: 'cast', player: 'alice', object: p }));
      if (g.pending?.kind === 'trigger_targets') g = choose(g, { kind: 'trigger_targets', targets: [[{ kind: 'object', object: card }]] });
      expect([g.objects[card]!.zone, chars(g, g.objects[p]!).keywords.some((k) => k.id === 'haste')]).toEqual(['hand', goblin]);
    }
  });

  it('Deathknell Berserker: a token only if its power was 3 or greater as it died', () => {
    for (const pumped of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const b = give(g, 'alice', 'Berserker Lite', 'battlefield');
      if (pumped) g = cast(g, 'alice', 'Pump Lite', { targets: [[{ kind: 'object', object: b }]] });
      g = cast(g, 'alice', 'Bolt', { targets: [[{ kind: 'object', object: b }]] });
      const tokens = g.zones.battlefield.filter((id) => g.objects[id]!.token).length;
      expect([g.objects[b]!.zone, tokens]).toEqual(['graveyard', pumped ? 1 : 0]);
    }
  });

  it("Choking Sands: damage to the land's controller only if it was nonbasic", () => {
    for (const land of ['Wastes Lite', 'Plains']) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const l = give(g, 'bob', land, 'battlefield');
      const life = g.players.bob!.life;
      g = cast(g, 'alice', 'Sands Lite', { targets: [[{ kind: 'object', object: l }]] });
      expect([g.objects[l]!.zone, life - g.players.bob!.life]).toEqual(['graveyard', land === 'Plains' ? 0 : 2]);
    }
  });

  it('Imaginary Pet returns to hand at upkeep if you have a card in hand', () => {
    for (const empty of [false, true]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const pet = give(g, 'alice', 'Pet Lite', 'battlefield');
      g = toStep(g, 'main1', 'bob');
      if (empty) g.zones.hand.alice = [];
      g = settle(toStep(g, 'upkeep', 'alice'));
      expect(g.objects[pet]!.zone).toBe(empty ? 'battlefield' : 'hand');
    }
  });

  it("Mercadian Atlas: draw only if you didn't play a land this turn", () => {
    for (const played of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      give(g, 'alice', 'Atlas Lite', 'battlefield');
      if (played) g = act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Plains', 'hand') } as never);
      g = settle(toStep(g, 'end', 'alice'));
      expect(g.pending?.kind === 'may').toBe(!played);
    }
  });

  it("Liability: the permanent's owner loses 1 life", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Liability Lite', 'battlefield');
    const cub = give(g, 'bob', 'Cub', 'battlefield');
    const life = g.players.bob!.life;
    g = cast(g, 'alice', 'Bolt', { targets: [[{ kind: 'object', object: cub }]] });
    expect(life - g.players.bob!.life).toBe(1);
  });

  it('Azorius Aethermage: a permanent returned to your hand', () => {
    for (const mine of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      give(g, 'alice', 'Aethermage Lite', 'battlefield');
      const cub = give(g, mine ? 'alice' : 'bob', 'Cub', 'battlefield');
      g = cast(g, 'alice', 'Bounce Lite', { targets: [[{ kind: 'object', object: cub }]] });
      expect([g.objects[cub]!.zone, g.pending?.kind ?? null]).toEqual(['hand', mine ? 'pay' : null]);
    }
  });

  it('Swift Silence: counter all other spells, draw a card for each', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bolt = give(g, 'alice', 'Bolt', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: bolt, targets: [[{ kind: 'player', player: 'bob' }]] } as never);
    g = act(g, { type: 'pass', player: 'alice' });
    const hand = g.zones.hand.bob!.length;
    const life = g.players.bob!.life;
    g = cast(g, 'bob', 'Silence Lite');
    expect([g.objects[bolt]!.zone, g.zones.hand.bob!.length - hand, g.players.bob!.life]).toEqual(['graveyard', 1, life]);
  });

  it('Filigree Fracture: draw only if the permanent was blue or black', () => {
    for (const relic of ['Blue Relic', 'Grey Relic']) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const r = give(g, 'bob', relic, 'battlefield');
      const hand = g.zones.hand.alice!.length;
      g = cast(g, 'alice', 'Fracture Lite', { targets: [[{ kind: 'object', object: r }]] });
      expect([g.objects[r]!.zone, g.zones.hand.alice!.length - hand]).toEqual(['graveyard', relic === 'Blue Relic' ? 1 : 0]);
    }
  });

  it("Predatory Advantage: a Lizard at an opponent's end step if they cast no creature spell", () => {
    for (const castOne of [false, true]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      give(g, 'alice', 'Advantage Lite', 'battlefield');
      g = toStep(g, 'main1', 'bob');
      if (castOne) g = cast(g, 'bob', 'Cub');
      g = settle(toStep(g, 'end', 'bob'));
      const lizards = g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice').length;
      expect(lizards).toBe(castOne ? 0 : 1);
    }
  });

  it('Wildgrowth Walker: grows and gains life whenever a creature you control explores', () => {
    for (const land of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const w = give(g, 'alice', 'Walker Lite', 'battlefield');
      const top = give(g, 'alice', land ? 'Plains' : 'Cub', 'library');
      g.zones.library.alice = [top, ...g.zones.library.alice!.filter((id) => id !== top)];
      const life = g.players.alice!.life;
      g = cast(g, 'alice', 'Branchwalker Lite');
      if (g.pending?.kind === 'may') g = choose(g, { kind: 'may', yes: false });
      g = settle(g);
      expect([g.objects[top]!.zone, g.objects[w]!.counters?.['+1/+1'] ?? 0, g.players.alice!.life - life]).toEqual([land ? 'hand' : 'library', 1, 3]);
    }
  });

  it("Magmatic Chasm: creatures that enter later can't block either (CR 611.2c)", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    g = cast(g, 'alice', 'Chasm Lite');
    const late = give(g, 'bob', 'Cub', 'battlefield');
    const flyer = give(g, 'bob', 'Bird Lite', 'battlefield');
    expect([chars(g, g.objects[late]!).rules.has('cant_block'), chars(g, g.objects[flyer]!).rules.has('cant_block')]).toEqual([true, false]);
    g = toStep(g, 'main2', 'alice');
    g = toStep(g, 'main1', 'bob');
    expect(chars(g, g.objects[late]!).rules.has('cant_block')).toBe(false);
    void ogre;
  });

  it("Magistrate's Veto: white creatures and blue creatures can't block", () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Veto Lite', 'battlefield');
    const [w, c] = [give(g, 'bob', 'White Cub', 'battlefield'), give(g, 'bob', 'Cub', 'battlefield')];
    expect([chars(g, g.objects[w]!).rules.has('cant_block'), chars(g, g.objects[c]!).rules.has('cant_block')]).toEqual([true, false]);
  });

  it('Keeper of the Flame: an opponent with more life as it is activated (only then)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const k = give(g, 'alice', 'Keeper Lite', 'battlefield');
    const target = [[{ kind: 'player', player: 'bob' }]];
    expect(illegal(g, { type: 'activate', player: 'alice', object: k, ability: 0, targets: target } as never)).toBeTruthy();
    g.players.alice!.life = 10;
    g = act(g, { type: 'activate', player: 'alice', object: k, ability: 0, targets: target } as never);
    g.players.alice!.life = 60;
    const life = g.players.bob!.life;
    g = settle(g);
    expect(life - g.players.bob!.life).toBe(2);
  });

  it('Rix Maadi Guildmage: only a player who lost life this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const r = give(g, 'alice', 'Rix Lite', 'battlefield');
    const target = [[{ kind: 'player', player: 'bob' }]];
    expect(illegal(g, { type: 'activate', player: 'alice', object: r, ability: 0, targets: target } as never)).toBeTruthy();
    g = cast(g, 'alice', 'Bolt', { targets: target });
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'activate', player: 'alice', object: r, ability: 0, targets: target } as never));
    expect(life - g.players.bob!.life).toBe(1);
  });

  it("Multani's Presence: draw when a spell you've cast is countered", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Presence Lite', 'battlefield');
    const bolt = give(g, 'alice', 'Bolt', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: bolt, targets: [[{ kind: 'player', player: 'bob' }]] } as never);
    g = act(g, { type: 'pass', player: 'alice' });
    const hand = g.zones.hand.alice!.length;
    g = cast(g, 'bob', 'Cancel Lite', { targets: [[{ kind: 'object', object: bolt }]] });
    expect([g.objects[bolt]!.zone, g.zones.hand.alice!.length - hand]).toEqual(['graveyard', 1]);
  });

  it('Kavu Titan: kicked, it enters with three counters and has trample', () => {
    for (const kicked of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const t = give(g, 'alice', 'Titan Lite', 'hand');
      g = settle(act(g, { type: 'cast', player: 'alice', object: t, kicked } as never));
      const c = chars(g, g.objects[t]!);
      expect([g.objects[t]!.counters['+1/+1'] ?? 0, c.keywords.some((k) => k.id === 'trample')]).toEqual(kicked ? [3, true] : [0, false]);
    }
  });

  it("Apostle's Blessing: protection from artifacts, or from a color", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    g = cast(g, 'alice', 'Blessing Lite', { targets: [[{ kind: 'object', object: cub }]] });
    expect((g.pending as { options?: string[] } | null)?.options).toContain('artifacts');
    g = choose(g, { kind: 'choose_option', choice: 'artifacts' });
    expect(chars(g, g.objects[cub]!).keywords.find((k) => k.id === 'protection')?.text).toBe('artifacts');
  });

  it('Flames of the Blood Hand: that player gains no life this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = cast(g, 'alice', 'Flames Lite', { targets: [[{ kind: 'player', player: 'bob' }]] });
    const life = g.players.bob!.life;
    g = act(toStep(g, 'end', 'alice'), { type: 'pass', player: 'alice' });
    g = cast(g, 'bob', 'Heal Lite');
    expect(g.players.bob!.life).toBe(life);
  });

  it('Venomous Fangs: destroy the other creature', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [cub, ogre] = [give(g, 'alice', 'Cub', 'battlefield'), give(g, 'bob', 'Ogre', 'battlefield')];
    g = cast(g, 'alice', 'Fangs Lite', { targets: [[{ kind: 'object', object: cub }]] });
    g = cast(g, 'alice', 'Fight Lite', { targets: [[{ kind: 'object', object: cub }], [{ kind: 'object', object: ogre }]] });
    expect([g.objects[cub]!.zone, g.objects[ogre]!.zone]).toEqual(['graveyard', 'graveyard']);
  });

  it('Hellfire: X plus 3 damage to you, X the creatures that died this way', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Cub', 'battlefield');
    give(g, 'bob', 'Ogre', 'battlefield');
    const life = g.players.alice!.life;
    g = cast(g, 'alice', 'Hellfire Lite');
    expect(life - g.players.alice!.life).toBe(5);
  });

  it('Skullmulcher: draw a card for each creature it devoured', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [a, b] = [give(g, 'alice', 'Cub', 'battlefield'), give(g, 'alice', 'Goblin Cub', 'battlefield')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mulcher Lite', 'hand') }));
    const hand = g.zones.hand.alice!.length;
    g = choose(g, { kind: 'as_enters', sacrifice: [a, b] });
    expect(g.zones.hand.alice!.length - hand).toBe(2);
  });

  it('Rusted Relic: a 5/5 Golem artifact creature with metalcraft', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const r = give(g, 'alice', 'Relic Lite', 'battlefield');
    give(g, 'alice', 'Grey Relic', 'battlefield');
    expect(chars(g, g.objects[r]!).types).not.toContain('Creature');
    give(g, 'alice', 'Grey Relic 2', 'battlefield');
    const c = chars(g, g.objects[r]!);
    expect([c.types.includes('Creature'), c.subtypes, c.power, c.toughness]).toEqual([true, ['Golem'], 5, 5]);
  });

  it('Alarum: only a nonattacking creature', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    g = attackWith(g, [ogre]);
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Alarum Lite', 'hand'), targets: [[{ kind: 'object', object: ogre }]] } as never)).toBeTruthy();
  });

  it("Ordruun Mentor: target creature that's attacking that player", () => {
    let g = toStep(start({ extra: CARDS, players: 3 } as never), 'main1', 'alice');
    give(g, 'alice', 'Mentor Lite', 'battlefield');
    const [a, b, c] = [give(g, 'alice', 'Ogre', 'battlefield'), give(g, 'alice', 'Cub', 'battlefield'), give(g, 'alice', 'Goblin Cub', 'battlefield')];
    const other = g.order.find((p) => p !== 'alice' && p !== 'bob')!;
    g = toAttack(toStep(g, 'beginning_of_combat'));
    const to = (player: string) => ({ kind: 'player' as const, player });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: a, target: to('bob') }, { attacker: c, target: to('bob') }, { attacker: b, target: to(other) }] } });
    const prompt = (g.pending as { prompts?: { candidates: { object: string }[] }[] } | null)?.prompts?.[0];
    expect(prompt?.candidates.map((x) => x.object).sort()).toEqual([a, c].sort());
  });

  it("Disintegrate: the creature can't be regenerated and is exiled if it would die", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cub = give(g, 'bob', 'Cub', 'battlefield');
    g = cast(g, 'alice', 'Disintegrate Lite', { targets: [[{ kind: 'object', object: cub }]] });
    expect(g.objects[cub]!.zone).toBe('exile');
  });

  it('Ruthless Disposal: discard a card and sacrifice a creature', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [mine, card, ogre] = [give(g, 'alice', 'Cub', 'battlefield'), give(g, 'alice', 'Plains', 'hand'), give(g, 'bob', 'Ogre', 'battlefield')];
    const d = give(g, 'alice', 'Disposal Lite', 'hand');
    const target = [[{ kind: 'object', object: ogre }]];
    expect(illegal(g, { type: 'cast', player: 'alice', object: d, targets: target, costs: { sacrifice: [mine] } } as never)).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: d, targets: target, costs: { sacrifice: [mine], discard: [card] } } as never));
    expect([g.objects[mine]!.zone, g.objects[card]!.zone, g.objects[ogre]!.zone]).toEqual(['graveyard', 'graveyard', 'graveyard']);
  });
});
