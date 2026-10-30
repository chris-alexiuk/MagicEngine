import { describe, expect, it } from 'vitest';
import { chars } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';
import { moveObject } from '../src/zones.js';

const CARDS = [
  makeCard({ name: 'Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{0}', power: '5', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Ogre Three', type_line: 'Creature — Ogre', mana_cost: '{2}{R}', cmc: 3, power: '3', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Bolt', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Bolt deals 3 damage to any target.' }),
  makeCard({ name: 'Cinder Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "As an additional cost to cast this spell, you may blight 1. (You may put a -1/-1 counter on a creature you control.)\nCinder Lite deals 2 damage to target creature. It deals 4 damage to that creature instead if this spell's additional cost was paid." }),
  makeCard({ name: 'Cycler Lite', type_line: 'Creature — Bird', mana_cost: '{1}', power: '1', toughness: '1', oracle_text: 'Cycling {2}' }),
  makeCard({ name: 'Swampcycler Lite', type_line: 'Creature — Zombie', mana_cost: '{1}', power: '1', toughness: '1', oracle_text: 'Swampcycling {2}' }),
  makeCard({ name: 'Zenith Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Zenith Lite deals X damage to any target and you gain X life, where X is the number of cards with a cycling ability in your graveyard.' }),
  makeCard({ name: 'Vampire Lite', type_line: 'Creature — Vampire', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Swipe Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Target creature you control gets +2/+2 until end of turn if its power is 2. Then it fights target creature you don't control." }),
  makeCard({ name: 'Heavy Sword', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equipped creature gets +1/+1.\nEquip {3}' }),
  makeCard({ name: 'Awaken Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Gain control of target creature until end of turn. Untap that creature. It gains haste until end of turn. If it's equipped, you may destroy all Equipment attached to that creature." }),
  makeCard({ name: 'Nullmage Lite', type_line: 'Creature — Insect Druid', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: "{T}: Return two target cards from an opponent's graveyard to their hand. Destroy target artifact or enchantment." }),
  makeCard({ name: 'Voucher Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{0}, {T}, Sacrifice this artifact: Shuffle any number of cards from your hand into your library, then draw that many cards.' }),
  makeCard({ name: 'Ruse Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target opponent skips all combat phases of their next turn.' }),
  makeCard({ name: 'Gargoyle Lite', type_line: 'Creature — Gargoyle', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: "Flying\nWhen this creature dies, return it to the battlefield under its owner's control at the beginning of the next end step and you skip your next draw step." }),
  makeCard({ name: 'Punishing Lite', type_line: 'Instant', mana_cost: '{R}', oracle_text: 'Punishing Lite deals 2 damage to any target.\nWhenever an opponent gains life, you may pay {R}. If you do, return this card from your graveyard to your hand.' }),
  makeCard({ name: 'Kavu Lite', type_line: 'Creature — Kavu', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Trample\nWhenever an opponent gains life, put that many +1/+1 counters on this creature.' }),
  makeCard({ name: 'Red Rock', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {R}.' }),
  makeCard({ name: 'Salve', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'You gain 3 life.' }),
  makeCard({ name: 'Courier Lite', type_line: 'Artifact Creature — Thopter', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Flying\nWhen this creature enters, reveal the top two cards of your library. Put one of them into your hand and the other into your graveyard. If you put an artifact card into your hand this way, you gain 3 life.' }),
  makeCard({ name: 'Torch Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Bargain (You may sacrifice an artifact, enchantment, or token as you cast this spell.)\nTorch Lite deals 2 damage to target creature or planeswalker. If this spell was bargained, instead it deals 3 damage to that permanent and you scry 1.\nIf a permanent dealt damage by Torch Lite would die this turn, exile it instead.' }),
  makeCard({ name: 'Fog Wall Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Prevent all damage that would be dealt to creatures.' }),
  makeCard({ name: 'Stay Away Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Return target creature card with mana value 3 or less from your graveyard to the battlefield. It gains "If this creature would die, exile it instead."' }),
  makeCard({ name: 'Marauder Lite', type_line: 'Artifact Creature — Phyrexian Construct', mana_cost: '{X}', power: '0', toughness: '0', oracle_text: "This creature enters with X +1/+1 counters on it.\nThis creature can't block.\nThis creature can't attack unless you pay {1} for each +1/+1 counter on it." }),
  makeCard({ name: 'Rays Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: "Enchant creature\nEnchanted creature can't attack or block unless its controller pays {3}." }),
  makeCard({ name: 'Repetition Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Return target exiled card with flashback you own to your hand.' }),
  makeCard({ name: 'Flashbacker Lite', type_line: 'Sorcery', mana_cost: '{1}', oracle_text: 'Draw a card.\nFlashback {3}' }),
  makeCard({ name: 'Tombfire Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target player exiles all cards with flashback from their graveyard.' }),
  makeCard({ name: 'Pyrrhic Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "As an additional cost to cast this spell, you may blight 2. (You may put two -1/-1 counters on a creature you control.)\nChoose one. If this spell's additional cost was paid, choose both instead.\n• Destroy target artifact or enchantment.\n• Destroy target creature with mana value 3 or greater." }),
  makeCard({ name: 'Kinseekers Lite', type_line: 'Creature — Shapeshifter', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: 'Changeling\nWhen this creature enters, if you control three or more creatures that share a creature type, put a +1/+1 counter on this creature, then scry 1.' }),
  makeCard({ name: 'Barbs Lite', type_line: 'Creature — Lizard Bard', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Menace\nWhenever one or more opponents are dealt noncombat damage, creatures you control get +1/+0 until end of turn.' }),
  makeCard({ name: 'Rain Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Rain Lite deals 1 damage to each opponent.' }),
  makeCard({ name: 'Adaptive Lite', type_line: 'Creature — Phyrexian Warrior', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'This creature enters with an oil counter on it.\nThis creature gets +1/+1 for each oil counter on it.\nWhenever another creature you control enters, if that creature has greater power or toughness than this creature, put an oil counter on this creature.' }),
  makeCard({ name: 'Sosuke Lite', type_line: 'Legendary Creature — Snake Warrior', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: 'Other Snake creatures you control get +1/+0.\nWhenever a Warrior you control deals combat damage to a creature, destroy that creature at end of combat.' }),
  makeCard({ name: 'Wall Lite', type_line: 'Creature — Wall', mana_cost: '{0}', power: '0', toughness: '8', oracle_text: '' }),
  makeCard({ name: 'Spirit Lite', type_line: 'Creature — Spirit', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Greed Lite', type_line: 'Sorcery — Arcane', mana_cost: '{0}', oracle_text: 'As an additional cost to cast this spell, you may sacrifice any number of Spirits.\nTarget player loses 2 life plus 2 life for each Spirit sacrificed this way. You gain that much life.' }),
  makeCard({ name: 'Ian Lite', type_line: 'Legendary Creature — Human Warrior', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: "Whenever Ian Lite attacks, if it's modified, you may have it deal damage equal to its power to you and any target." }),
  makeCard({ name: 'Hunt Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target opponent exiles a creature or planeswalker they control with the greatest mana value among creatures and planeswalkers they control.' }),
  makeCard({ name: 'Betrayal Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target opponent exiles a creature they control and their graveyard.' }),
  makeCard({ name: 'Snitch Lite', type_line: 'Creature — Vampire Rogue', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever you surveil for the first time each turn, this creature deals 1 damage to each opponent and you gain 1 life.' }),
  makeCard({ name: 'Surveil Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Surveil 1.' }),
  makeCard({ name: 'Wheel Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "At the beginning of each opponent's upkeep, this artifact deals X damage to that player, where X is 3 minus the number of cards in their hand." }),
  makeCard({ name: 'Honor Guard Lite', type_line: 'Creature — Vampire Knight', mana_cost: '{0}', power: '4', toughness: '5', oracle_text: "At the beginning of each player's end step, this creature deals 4 damage to that player unless they control a commander." }),
  makeCard({ name: 'Grace Lite', type_line: 'Creature — Human Knight', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'First strike\nThis creature gets +1/+0 as long as any player controls a black permanent.' }),
  makeCard({ name: 'Black Cub', type_line: 'Creature — Bear', mana_cost: '{B}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Enslave Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature\nYou control enchanted creature.\nAt the beginning of your upkeep, enchanted creature deals 1 damage to its owner.' }),
  makeCard({ name: 'Faultless Lite', type_line: 'Creature — Spirit', mana_cost: '{0}', power: '0', toughness: '4', oracle_text: 'Defender\nWhenever this creature is dealt combat damage, you gain that much life and attacking player loses that much life.' }),
  makeCard({ name: 'Embrace Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Untap target creature you don't control and gain control of it. It gains haste until end of turn. At the beginning of the next end step, sacrifice it. If you do, you gain life equal to its toughness." }),
  makeCard({ name: 'Combust Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Combust Lite deals 5 damage to target creature. The damage can't be prevented." }),
  makeCard({ name: 'Rage Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Kicker {1}\nRage Lite deals 3 damage to any target. If this spell was kicked, instead it deals 10 damage to that permanent or player and the damage can't be prevented." }),
  makeCard({ name: 'Refuse Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Refuse Lite deals damage to target spell's controller equal to that spell's mana value." }),
  makeCard({ name: 'Skull Rend Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Skull Rend Lite deals 2 damage to each opponent. Those players each discard two cards at random.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const toAttack = (g: GameState) => {
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return g;
};
const drive = (g: GameState, answer: (g: GameState) => GameState | null, limit = 12): GameState => {
  for (let i = 0; i < limit; i++) {
    if (g.pending) {
      const next = answer(g);
      if (!next) break;
      g = next;
    } else if (g.stack.length && g.priority) g = settle(act(g, { type: 'pass', player: g.priority }));
    else break;
  }
  return g;
};
const attackWith = (g: GameState, attackers: string[], to = 'bob', who = 'alice'): GameState => {
  g = toAttack(toStep(g, 'beginning_of_combat'));
  return act(g, { type: 'choose', player: who, answer: { kind: 'declare_attackers', attacks: attackers.map((attacker) => ({ attacker, target: { kind: 'player' as const, player: to } })) } });
};
/** Through combat damage: no blocks, every priority passed. */
const finishCombat = (g: GameState): GameState => {
  for (let i = 0; i < 60 && g.step !== 'end' && g.step !== 'main2'; i++) {
    if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks: [] } } as never);
    else if (g.pending?.kind === 'assign_combat_damage') {
      const p = g.pending as { player: string; choices: { attacker: string; suggested: unknown[] }[] };
      g = act(g, { type: 'choose', player: p.player, answer: { kind: 'assign_combat_damage', assignments: Object.fromEntries(p.choices.map((c) => [c.attacker, c.suggested])) } } as never);
    }
    else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
    else break;
  }
  return g;
};
const clearBattlefield = (g: GameState, who: string) => {
  for (const id of g.zones.battlefield.filter((id) => g.objects[id]!.controller === who)) moveObject(g, id, 'graveyard', []);
};

describe('staples (slice 267)', () => {
  it("Cinder Strike: the optional additional cost, paid", () => {
    for (const paid of [false, true]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const [cub, ogre] = [give(g, 'alice', 'Cub', 'battlefield'), give(g, 'bob', 'Ogre', 'battlefield')];
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Cinder Lite', 'hand'), targets: [[{ kind: 'object', object: ogre }]], ...(paid ? { extras: ['alt'], costs: { blighted: [cub] } } : {}) } as never));
      expect(g.objects[ogre]!.zone).toBe(paid ? 'graveyard' : 'battlefield');
    }
  });
});

describe('staples (slice 267, part 2)', () => {
  it('Zenith Flare, Savage Swipe, Awaken the Sleeper', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (const n of ['Cycler Lite', 'Swampcycler Lite', 'Cub']) give(g, 'alice', n, 'graveyard');
    const [a, b] = [g.players.alice!.life, g.players.bob!.life];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Zenith Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect([g.players.alice!.life - a, b - g.players.bob!.life]).toEqual([2, 2]);

    for (const [mine, dies] of [['Vampire Lite', true], ['Cub', false]] as const) {
      let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const [x, ogre] = [give(h, 'alice', mine, 'battlefield'), give(h, 'bob', 'Ogre', 'battlefield')];
      h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Swipe Lite', 'hand'), targets: [[{ kind: 'object', object: x }], [{ kind: 'object', object: ogre }]] }));
      expect(h.objects[ogre]!.zone).toBe(dies ? 'graveyard' : 'battlefield');
    }

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [ogre, sword] = [give(k, 'bob', 'Ogre', 'battlefield'), give(k, 'bob', 'Heavy Sword', 'battlefield')];
    k.objects[sword]!.attachedTo = { id: ogre, zcc: k.objects[ogre]!.zcc };
    k.objects[ogre]!.tapped = true;
    k = act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Awaken Lite', 'hand'), targets: [[{ kind: 'object', object: ogre }]] });
    k = drive(k, (x) => (x.pending?.kind === 'may' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }) : null));
    expect([k.objects[ogre]!.controller, k.objects[ogre]!.tapped, k.objects[sword]!.zone]).toEqual(['alice', false, 'graveyard']);
  });

  it('Nullmage Advocate, Credit Voucher, Empty City Ruse, Ivory Gargoyle', () => {
    let g = toStep(start({ players: 3, extra: CARDS }), 'main1', 'alice');
    const mage = give(g, 'alice', 'Nullmage Lite', 'battlefield');
    const [b1, b2, c1] = [give(g, 'bob', 'Cub', 'graveyard'), give(g, 'bob', 'Ogre', 'graveyard'), give(g, 'carol', 'Cub', 'graveyard')];
    const sword = give(g, 'carol', 'Heavy Sword', 'battlefield');
    expect(illegal(g, { type: 'activate', player: 'alice', object: mage, ability: 0, targets: [[{ kind: 'object', object: b1 }, { kind: 'object', object: c1 }], [{ kind: 'object', object: sword }]] })).toBeTruthy();
    g = settle(act(g, { type: 'activate', player: 'alice', object: mage, ability: 0, targets: [[{ kind: 'object', object: b1 }, { kind: 'object', object: b2 }], [{ kind: 'object', object: sword }]] }));
    expect([g.objects[b1]!.zone, g.objects[b2]!.zone, g.zones.hand.bob!.includes(b1), g.objects[sword]!.zone]).toEqual(['hand', 'hand', true, 'graveyard']);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const voucher = give(h, 'alice', 'Voucher Lite', 'battlefield');
    const hand = [...h.zones.hand.alice!];
    const library = h.zones.library.alice!.length;
    h = act(h, { type: 'activate', player: 'alice', object: voucher, ability: 0, costs: { sacrifice: [voucher] } } as never);
    h = drive(h, (x) => (x.pending?.kind === 'choose_objects' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: hand.slice(0, 3) } }) : null));
    expect([h.zones.hand.alice!.length, h.zones.library.alice!.length]).toEqual([hand.length, library]);

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Ruse Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    give(k, 'bob', 'Ogre', 'battlefield');
    const steps: string[] = [];
    k = toStep(k, 'main1', 'bob');
    for (let i = 0; i < 40 && !(k.active === 'alice' && k.step === 'main1'); i++) {
      steps.push(k.step);
      if (k.pending) break;
      k = act(k, { type: 'pass', player: k.priority! });
    }
    expect(steps.includes('beginning_of_combat') || steps.includes('declare_attackers')).toBe(false);
    k = toStep(k, 'beginning_of_combat', 'bob');
    expect(k.step).toBe('beginning_of_combat');

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const gar = give(m, 'alice', 'Gargoyle Lite', 'battlefield');
    m = settle(act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: gar }]] }));
    m = toStep(m, 'main1', 'bob');
    expect(m.zones.battlefield.some((id) => m.objects[id]!.card === 'Gargoyle Lite')).toBe(true);
    const before = m.zones.hand.alice!.length;
    m = toStep(m, 'main1', 'alice');
    expect(m.zones.hand.alice!.length).toBe(before);
  });

  it('Punishing Fire, Kavu Predator', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const fire = give(g, 'alice', 'Punishing Lite', 'graveyard');
    const kavu = give(g, 'alice', 'Kavu Lite', 'battlefield');
    give(g, 'alice', 'Red Rock', 'battlefield');
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Salve', 'hand') });
    g = drive(g, (x) => (x.pending?.kind === 'pay' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true } }) : null));
    expect([g.objects[fire]!.zone, g.objects[kavu]!.counters['+1/+1']]).toEqual(['hand', 3]);
  });
});

describe('staples (slice 267, part 3)', () => {
  it("Chrome Courier, Torch the Tower, Can't Stay Away", () => {
    for (const art of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const top = [give(g, 'alice', art ? 'Heavy Sword' : 'Cub', 'library'), give(g, 'alice', 'Cub', 'library')];
      g.zones.library.alice = [...top, ...g.zones.library.alice!.filter((id) => !top.includes(id))];
      const life = g.players.alice!.life;
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Courier Lite', 'hand') });
      g = drive(g, (x) => (x.pending?.kind === 'choose_objects' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [top[0]!] } }) : null));
      expect([g.objects[top[0]!]!.zone, g.objects[top[1]!]!.zone, g.players.alice!.life - life]).toEqual(['hand', 'graveyard', art ? 3 : 0]);
    }

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [cub, vamp] = [give(h, 'bob', 'Cub', 'battlefield'), give(h, 'bob', 'Vampire Lite', 'battlefield')];
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Torch Lite', 'hand'), targets: [[{ kind: 'object', object: cub }]] }));
    expect(h.objects[cub]!.zone).toBe('exile');
    // Prevented, it wasn't dealt damage: no replacement for its death later this turn.
    give(h, 'bob', 'Fog Wall Lite', 'battlefield');
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Torch Lite', 'hand'), targets: [[{ kind: 'object', object: vamp }]] }));
    h.zones.battlefield = h.zones.battlefield.filter((id) => h.objects[id]!.card !== 'Fog Wall Lite');
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: vamp }]] }));
    expect(h.objects[vamp]!.zone).toBe('graveyard');

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const dead = give(k, 'alice', 'Vampire Lite', 'graveyard');
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Stay Away Lite', 'hand'), targets: [[{ kind: 'object', object: dead }]] }));
    expect(k.objects[dead]!.zone).toBe('battlefield');
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: dead }]] }));
    expect(k.objects[dead]!.zone).toBe('exile');
  });

  it('Phyrexian Marauder, Oppressive Rays', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const m = give(g, 'alice', 'Marauder Lite', 'battlefield');
    g.objects[m]!.counters['+1/+1'] = 2;
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    const rays = give(g, 'bob', 'Rays Lite', 'battlefield');
    g.objects[rays]!.attachedTo = { id: ogre, zcc: g.objects[ogre]!.zcc };
    const q = toAttack(toStep(g, 'beginning_of_combat'));
    // Two counters: {2}; the Ogre under Rays: {3}. Alice has no mana.
    for (const attacker of [m, ogre]) expect(illegal(q, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker, target: { kind: 'player', player: 'bob' } }] } })).toBeTruthy();
    for (let i = 0; i < 5; i++) give(q, 'alice', 'Red Rock', 'battlefield');
    const r = act(q, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: ogre, target: { kind: 'player', player: 'bob' } }, { attacker: m, target: { kind: 'player', player: 'bob' } }] } });
    expect(Object.keys(r.combat?.attackers ?? {}).length).toBe(2);
  });

  it('Runic Repetition, Tombfire, Pyrrhic Strike', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [fb, plain] = [give(g, 'alice', 'Flashbacker Lite', 'exile'), give(g, 'alice', 'Cub', 'exile')];
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Repetition Lite', 'hand'), targets: [[{ kind: 'object', object: plain }]] })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Repetition Lite', 'hand'), targets: [[{ kind: 'object', object: fb }]] }));
    expect(g.objects[fb]!.zone).toBe('hand');

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [x, y] = [give(h, 'bob', 'Flashbacker Lite', 'graveyard'), give(h, 'bob', 'Cub', 'graveyard')];
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Tombfire Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect([h.objects[x]!.zone, h.objects[y]!.zone]).toEqual(['exile', 'graveyard']);

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [mine, sword, three] = [give(k, 'alice', 'Ogre', 'battlefield'), give(k, 'bob', 'Heavy Sword', 'battlefield'), give(k, 'bob', 'Ogre Three', 'battlefield')];
    const strike = give(k, 'alice', 'Pyrrhic Lite', 'hand');
    // Paid: both, not one.
    expect(illegal(k, { type: 'cast', player: 'alice', object: strike, modes: [0], targets: [[{ kind: 'object', object: sword }]], extras: ['alt'], costs: { blighted: [mine] } } as never)).toBeTruthy();
    k = settle(act(k, { type: 'cast', player: 'alice', object: strike, modes: [0, 1], targets: [[{ kind: 'object', object: sword }], [{ kind: 'object', object: three }]], extras: ['alt'], costs: { blighted: [mine] } } as never));
    expect([k.objects[sword]!.zone, k.objects[three]!.zone, k.objects[mine]!.counters['-1/-1']]).toEqual(['graveyard', 'graveyard', 2]);
    // Unpaid: one.
    const sword2 = give(k, 'bob', 'Heavy Sword', 'battlefield');
    const ogre3 = give(k, 'bob', 'Ogre Three', 'battlefield');
    expect(illegal(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Pyrrhic Lite', 'hand'), modes: [0, 1], targets: [[{ kind: 'object', object: sword2 }], [{ kind: 'object', object: ogre3 }]] })).toBeTruthy();
  });
});

describe('staples (slice 267, part 4)', () => {
  it('Littjara Kinseekers, Master of Barbs, Evolving Adaptive, Sosuke', () => {
    for (const [n, grows] of [[2, true], [1, false]] as const) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      for (let i = 0; i < n; i++) give(g, 'alice', 'Spirit Lite', 'battlefield');
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Kinseekers Lite', 'hand') });
      g = drive(g, (x) => (x.pending?.kind === 'scry' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'scry', top: (x.pending as { objects: string[] }).objects, bottom: [] } }) : null));
      const k = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Kinseekers Lite')!;
      expect(g.objects[k]!.counters['+1/+1'] ?? 0).toBe(grows ? 1 : 0);
    }

    let h = toStep(start({ players: 3, extra: CARDS }), 'main1', 'alice');
    const barbs = give(h, 'alice', 'Barbs Lite', 'battlefield');
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Rain Lite', 'hand') }));
    expect(chars(h, h.objects[barbs]!).power).toBe(3);

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ad = give(k, 'alice', 'Adaptive Lite', 'battlefield');
    k.objects[ad]!.counters.oil = 1;
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Cub', 'hand') }));
    expect(k.objects[ad]!.counters.oil).toBe(1);
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Ogre', 'hand') }));
    expect(k.objects[ad]!.counters.oil).toBe(2);

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const sosuke = give(m, 'alice', 'Sosuke Lite', 'battlefield');
    const wall = give(m, 'bob', 'Wall Lite', 'battlefield');
    m = attackWith(m, [sosuke]);
    m = toAttack(m);
    m = act(m, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: wall, attacker: sosuke }] } } as never);
    m = finishCombat(m);
    expect(m.objects[wall]!.zone).toBe('graveyard');
  });

  it('Devouring Greed, Ian the Reckless, End of the Hunt, Strategic Betrayal', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const spirits = [give(g, 'alice', 'Spirit Lite', 'battlefield'), give(g, 'alice', 'Spirit Lite', 'battlefield')];
    const [a, b] = [g.players.alice!.life, g.players.bob!.life];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Greed Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]], costs: { sacrifice: spirits } } as never));
    expect([b - g.players.bob!.life, g.players.alice!.life - a, spirits.map((id) => g.objects[id]!.zone)]).toEqual([6, 6, ['graveyard', 'graveyard']]);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ian = give(h, 'alice', 'Ian Lite', 'battlefield');
    h.objects[ian]!.counters['+1/+1'] = 1;
    const ogre = give(h, 'bob', 'Ogre', 'battlefield');
    const life = h.players.alice!.life;
    h = attackWith(h, [ian]);
    h = drive(h, (x) => (x.pending?.kind === 'trigger_targets' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: ogre }]] } }) : x.pending?.kind === 'may' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }) : null));
    expect([life - h.players.alice!.life, h.objects[ogre]!.zone]).toEqual([3, 'graveyard']);

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [big, small] = [give(k, 'bob', 'Ogre Three', 'battlefield'), give(k, 'bob', 'Cub', 'battlefield')];
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Hunt Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect([k.objects[big]!.zone, k.objects[small]!.zone]).toEqual(['exile', 'battlefield']);

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [only, gy] = [give(m, 'bob', 'Cub', 'battlefield'), give(m, 'bob', 'Ogre', 'graveyard')];
    m = settle(act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Betrayal Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect([m.objects[only]!.zone, m.objects[gy]!.zone]).toEqual(['exile', 'exile']);
  });
});

describe('staples (slice 267, part 5)', () => {
  it('Whispering Snitch, Wheel of Torture, Crimson Honor Guard, Knight of Grace, Enslave', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Snitch Lite', 'battlefield');
    const life = g.players.bob!.life;
    for (let i = 0; i < 2; i++) {
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Surveil Lite', 'hand') });
      g = drive(g, (x) => (x.pending?.kind === 'surveil' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'surveil', top: (x.pending as { objects: string[] }).objects, graveyard: [] } }) : null));
    }
    expect(life - g.players.bob!.life).toBe(1);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(h, 'alice', 'Wheel Lite', 'battlefield');
    h.zones.hand.bob = h.zones.hand.bob!.slice(0, 1);
    const bl = h.players.bob!.life;
    h = toStep(h, 'draw', 'bob');
    expect(bl - h.players.bob!.life).toBe(2);

    let k = toStep(start({ format: 'commander', extra: CARDS, commanders: { alice: ['Cub'] } }), 'main1', 'alice');
    give(k, 'alice', 'Honor Guard Lite', 'battlefield');
    const leader = give(k, 'bob', 'Cub', 'battlefield');
    k.objects[leader]!.commander = true;
    const [al, bobl] = [k.players.alice!.life, k.players.bob!.life];
    k = toStep(k, 'main1', 'bob');
    k = toStep(k, 'main1', 'alice');
    expect([al - k.players.alice!.life, bobl - k.players.bob!.life]).toEqual([4, 0]);

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const grace = give(m, 'alice', 'Grace Lite', 'battlefield');
    expect(chars(m, m.objects[grace]!).power).toBe(2);
    give(m, 'bob', 'Black Cub', 'battlefield');
    expect(chars(m, m.objects[grace]!).power).toBe(3);

    let n = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const stolen = give(n, 'bob', 'Cub', 'battlefield');
    const aura = give(n, 'alice', 'Enslave Lite', 'battlefield');
    n.objects[aura]!.attachedTo = { id: stolen, zcc: n.objects[stolen]!.zcc };
    const before = n.players.bob!.life;
    n = toStep(n, 'draw', 'alice');
    expect([n.objects[stolen]!.controller, before - n.players.bob!.life]).toEqual(['alice', 1]);
  });

  it("Souls of the Faultless, Spinal Embrace, Combust, Urza's Rage, Refuse, Skull Rend", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    const souls = give(g, 'bob', 'Faultless Lite', 'battlefield');
    const [a, b] = [g.players.alice!.life, g.players.bob!.life];
    g = attackWith(g, [ogre]);
    g = toAttack(g);
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: souls, attacker: ogre }] } } as never);
    g = finishCombat(g);
    expect([a - g.players.alice!.life, g.players.bob!.life - b]).toEqual([5, 5]);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const theirs = give(h, 'bob', 'Vampire Lite', 'battlefield');
    h.objects[theirs]!.tapped = true;
    const life = h.players.alice!.life;
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Embrace Lite', 'hand'), targets: [[{ kind: 'object', object: theirs }]] }));
    expect([h.objects[theirs]!.controller, h.objects[theirs]!.tapped]).toEqual(['alice', false]);
    h = toStep(h, 'main1', 'bob');
    expect([h.objects[theirs]!.zone, h.players.alice!.life - life]).toEqual(['graveyard', 2]);

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(k, 'bob', 'Fog Wall Lite', 'battlefield');
    const [o1, o2, o3] = [give(k, 'bob', 'Ogre', 'battlefield'), give(k, 'bob', 'Ogre', 'battlefield'), give(k, 'bob', 'Ogre', 'battlefield')];
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Combust Lite', 'hand'), targets: [[{ kind: 'object', object: o1 }]] }));
    give(k, 'alice', 'Red Rock', 'battlefield');
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Rage Lite', 'hand'), targets: [[{ kind: 'object', object: o2 }]], kicked: true, autoTap: true } as never));
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Rage Lite', 'hand'), targets: [[{ kind: 'object', object: o3 }]] }));
    expect([o1, o2, o3].map((id) => k.objects[id]!.zone)).toEqual(['graveyard', 'graveyard', 'battlefield']);

    let m = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const three = give(m, 'bob', 'Ogre Three', 'hand');
    for (let i = 0; i < 3; i++) give(m, 'bob', 'Red Rock', 'battlefield');
    m = act(m, { type: 'cast', player: 'bob', object: three, autoTap: true } as never);
    const bl = m.players.bob!.life;
    m = act(m, { type: 'pass', player: 'bob' });
    m = settle(act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Refuse Lite', 'hand'), targets: [[{ kind: 'object', object: three }]] }));
    expect(bl - m.players.bob!.life).toBe(3);

    let n = toStep(start({ players: 3, extra: CARDS }), 'main1', 'alice');
    const [hb, hc] = [n.zones.hand.bob!.length, n.zones.hand.carol!.length];
    n = settle(act(n, { type: 'cast', player: 'alice', object: give(n, 'alice', 'Skull Rend Lite', 'hand') }));
    expect([hb - n.zones.hand.bob!.length, hc - n.zones.hand.carol!.length, n.players.bob!.life, n.players.carol!.life]).toEqual([2, 2, 18, 18]);
  });
});
