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
  makeCard({ name: 'Dross Lite', type_line: 'Creature — Phyrexian Vampire', mana_cost: '{4}{B}{B}{B}', cmc: 7, power: '5', toughness: '5', oracle_text: 'Flying, lifelink\nYou may reveal this card from your opening hand. If you do, at the beginning of the first upkeep, each opponent loses 3 life, then you gain life equal to the life lost this way.' }),
  makeCard({ name: 'Searing Blood Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Searing Blood Lite deals 2 damage to target creature. When that creature dies this turn, Searing Blood Lite deals 3 damage to the creature's controller." }),
  makeCard({ name: 'Envoy Lite', type_line: 'Creature — Dog Soldier', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "When this creature enters, draw a card if you control a creature with a counter on it. If you don't draw a card this way, put a +1/+1 counter on this creature." }),
  makeCard({ name: 'Stone Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{3}, {T}: Draw three cards. This ability costs {1} more to activate for each card in your hand.' }),
  makeCard({ name: 'Vengevine Lite', type_line: 'Creature — Elemental', mana_cost: '{2}{G}{G}', cmc: 4, power: '4', toughness: '3', oracle_text: "Haste\nWhenever you cast a spell, if it's the second creature spell you cast this turn, you may return this card from your graveyard to the battlefield." }),
  makeCard({ name: 'Sponge Lite', type_line: 'Creature — Sponge', mana_cost: '{0}', power: '0', toughness: '0', oracle_text: 'This creature enters with a number of +1/+1 counters on it equal to the greatest number of cards an opponent has drawn this turn.' }),
  makeCard({ name: 'Akim Lite', type_line: 'Legendary Creature — Bird Dinosaur', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Flying\nWhenever you create one or more tokens for the first time each turn, create a 1/1 white Bird creature token with flying.' }),
  makeCard({ name: 'Token Maker', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Create a 1/1 green Saproling creature token.' }),
  makeCard({ name: 'Second Rite Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'If target player has exactly 10 life, Second Rite Lite deals 10 damage to that player.' }),
  makeCard({ name: 'Immobility Lite', type_line: 'Enchantment Creature — Nightmare', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: 'When this creature enters, tap up to one target creature. If an opponent controls that creature, put a stun counter on it.' }),
  makeCard({ name: 'Patrol Lite', type_line: 'Creature — Human Warrior', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Whenever this creature deals damage to one or more creatures, investigate.' }),
  makeCard({ name: 'Cactuar Lite', type_line: 'Creature — Plant', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: "Trample\nAt the beginning of your end step, if this creature didn't enter the battlefield this turn, return it to its owner's hand." }),
  makeCard({ name: 'Exhaustion Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Creatures and lands target opponent controls don't untap during their next untap step." }),
  makeCard({ name: 'Moonsilver Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: "Enchant creature\nEnchanted creature can't attack, block, or transform." }),
  makeCard({ name: 'Flip Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Transform target creature.' }),
  makeCard({ name: 'Skullcage Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "At the beginning of each opponent's upkeep, this artifact deals 2 damage to that player unless they have exactly three or exactly four cards in hand." }),
  makeCard({ name: 'Prayer Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever one or more creatures attack you, you gain 1 life for each attacking creature.' }),
  makeCard({ name: 'Clockwork Lite', type_line: 'Artifact Creature — Hydra', mana_cost: '{0}', power: '0', toughness: '0', oracle_text: 'This creature enters with four +1/+1 counters on it.\nWhenever this creature attacks or blocks, remove a +1/+1 counter from it. If you do, it deals 1 damage to any target.' }),
  makeCard({ name: 'Sheriff Lite', type_line: 'Creature — Human Knight', mana_cost: '{0}', power: '0', toughness: '0', oracle_text: 'This creature enters with a +1/+1 counter on it plus an additional +1/+1 counter on it for each other creature you control.' }),
  makeCard({ name: 'Revelation Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Scry 5, then reveal the top card of your library. If it's a creature card, you draw cards equal to its power and you gain life equal to its toughness." }),
  makeCard({ name: 'Not Forgotten Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Put target card from a graveyard on your choice of the top or bottom of its owner's library. Create a 1/1 white Spirit creature token with flying." }),
  makeCard({ name: 'Navigator Lite', type_line: 'Creature — Merfolk Wizard', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'As long as you attacked with three or more Merfolk this turn, Merfolk you control get +1/+0.' }),
  makeCard({ name: 'Merfolk Lite', type_line: 'Creature — Merfolk', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Meditation Lite', type_line: 'Instant', mana_cost: '{1}', oracle_text: 'During turns other than yours, this spell costs {3} more to cast.\nDraw a card.' }),
  makeCard({ name: 'Faith Healer Lite', type_line: 'Creature — Human Cleric', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "Sacrifice an enchantment: You gain life equal to the sacrificed enchantment's mana value." }),
  makeCard({ name: 'Big Enchantment', type_line: 'Enchantment', mana_cost: '{3}{W}', cmc: 4, oracle_text: '' }),
  makeCard({ name: 'Reprieve Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "When target creature dies this turn, return that card to the battlefield under its owner's control." }),
  makeCard({ name: 'Cryptborn Lite', type_line: 'Creature — Horror', mana_cost: '{0}', power: '0', toughness: '0', oracle_text: 'Trample\nThis creature enters with X +1/+1 counters on it, where X is the total life lost by your opponents this turn.' }),
  makeCard({ name: 'Charger Lite', type_line: 'Creature — Giant Warrior', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: "At the beginning of your end step, if this creature doesn't have a +1/+1 counter on it, return it to its owner's hand." }),
  makeCard({ name: 'Glyph Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant artifact\nEnchanted artifact is a Golem creature with base power and toughness 5/4 in addition to its other types.' }),
  makeCard({ name: 'Salvo Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Salvo Lite deals X damage to target creature, where X is 2 plus the number of other spells you've cast this turn." }),
  makeCard({ name: 'Bonds Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: "Enchant creature\nEnchanted creature gets +2/+2 as long as it's a Human. Otherwise, it can't attack or block." }),
  makeCard({ name: 'Rats Lite', type_line: 'Creature — Rat', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'When this creature enters, target opponent puts a card from their hand on top of their library.' }),
  makeCard({ name: 'Tithe Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: "Enchant nonland permanent\nAt the beginning of the upkeep of enchanted permanent's controller, that player sacrifices it unless they pay {X}, where X is its mana value." }),
  makeCard({ name: 'Strategist Lite', type_line: 'Creature — Human Rogue', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever one or more creatures attack you, those creatures get -1/-0 until end of turn.' }),
  makeCard({ name: 'Raider Lite', type_line: 'Creature — Orc Pirate', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "At the beginning of your end step, if you attacked this turn, reveal the top card of your library and put that card into your hand. You lose life equal to the card's mana value." }),
  makeCard({ name: 'Human Cub', type_line: 'Creature — Human', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Wolf Card', layout: 'transform', type_line: 'Creature — Human Werewolf // Creature — Werewolf', oracle_text: '', mana_cost: '{0}', card_faces: [{ object: 'card_face', name: 'Wolf Card', type_line: 'Creature — Human Werewolf', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }, { object: 'card_face', name: 'Wolf Back', type_line: 'Creature — Werewolf', mana_cost: '', power: '4', toughness: '4', oracle_text: '' }] } as never),
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

describe('staples (slice 268)', () => {
  it('Chancellor of the Dross: revealed from the opening hand', () => {
    let g = start({ extra: CARDS, mulligan: true });
    const dross = give(g, 'alice', 'Dross Lite', 'hand');
    while (g.pending?.kind === 'mulligan') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'mulligan', keep: true } });
    expect(g.pending?.kind).toBe('opening_battlefield');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'opening_battlefield', objects: [dross] } });
    while (g.pending?.kind === 'opening_battlefield') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'opening_battlefield', objects: [] } });
    expect(g.objects[dross]!.zone).toBe('hand');
    g = toStep(g, 'draw', 'alice');
    g = toStep(g, 'main1', 'alice');
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([23, 17]);
    // Only the first upkeep.
    g = toStep(g, 'main1', 'bob');
    expect(g.players.bob!.life).toBe(17);
  });

  it('Searing Blood, Trade Route Envoy, Loreseeker’s Stone, Vengevine, Thought Sponge, Akim', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cub = give(g, 'bob', 'Cub', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Searing Blood Lite', 'hand'), targets: [[{ kind: 'object', object: cub }]] }));
    expect([g.objects[cub]!.zone, g.players.bob!.life]).toEqual(['graveyard', 17]);

    for (const counter of [true, false]) {
      let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
      if (counter) h.objects[give(h, 'alice', 'Cub', 'battlefield')]!.counters['+1/+1'] = 1;
      const hand = h.zones.hand.alice!.length;
      h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Envoy Lite', 'hand') }));
      const envoy = h.zones.battlefield.find((id) => h.objects[id]!.card === 'Envoy Lite')!;
      expect([h.zones.hand.alice!.length - hand, h.objects[envoy]!.counters['+1/+1'] ?? 0]).toEqual(counter ? [1, 0] : [0, 1]);
    }

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const stone = give(k, 'alice', 'Stone Lite', 'battlefield');
    for (let i = 0; i < 4; i++) give(k, 'alice', 'Red Rock', 'battlefield');
    // Seven cards in hand: {10}. Four lands can't pay it.
    expect(illegal(k, { type: 'activate', player: 'alice', object: stone, ability: 0, autoTap: true } as never)).toBeTruthy();
    k.zones.hand.alice = [];
    k = settle(act(k, { type: 'activate', player: 'alice', object: stone, ability: 0, autoTap: true } as never));
    expect(k.zones.hand.alice!.length).toBe(3);

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const vine = give(m, 'alice', 'Vengevine Lite', 'graveyard');
    m = settle(act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Cub', 'hand') }));
    expect(m.objects[vine]!.zone).toBe('graveyard');
    m = act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Ogre', 'hand') });
    m = drive(m, (x) => (x.pending?.kind === 'may' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }) : null));
    expect(m.objects[vine]!.zone).toBe('battlefield');

    let n = toStep(start({ extra: CARDS }), 'main1', 'bob');
    n = toStep(n, 'main1', 'alice');
    n.turnLog.drawn = { bob: 2, carol: 0 } as never;
    n = settle(act(n, { type: 'cast', player: 'alice', object: give(n, 'alice', 'Sponge Lite', 'hand') }));
    const sponge = n.zones.battlefield.find((id) => n.objects[id]!.card === 'Sponge Lite')!;
    expect(n.objects[sponge]!.counters['+1/+1']).toBe(2);

    let p = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(p, 'alice', 'Akim Lite', 'battlefield');
    for (let i = 0; i < 2; i++) p = settle(act(p, { type: 'cast', player: 'alice', object: give(p, 'alice', 'Token Maker', 'hand') }));
    expect(p.zones.battlefield.filter((id) => p.objects[id]!.token).length).toBe(3);
  });

  it("Hidetsugu's Second Rite, Fear of Immobility, Briarbridge Patrol, Cactuar, Exhaustion, Bound by Moonsilver", () => {
    for (const life of [10, 11]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      g.players.bob!.life = life;
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Second Rite Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
      expect(g.players.bob!.life).toBe(life === 10 ? 0 : 11);
    }

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(h, 'bob', 'Ogre', 'battlefield');
    h = act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Immobility Lite', 'hand') });
    h = drive(h, (x) => (x.pending?.kind === 'trigger_targets' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: ogre }]] } }) : null));
    expect([h.objects[ogre]!.tapped, h.objects[ogre]!.counters.stun]).toEqual([true, 1]);

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const patrol = give(k, 'alice', 'Patrol Lite', 'battlefield');
    const wall = give(k, 'bob', 'Wall Lite', 'battlefield');
    k = attackWith(k, [patrol]);
    k = toAttack(k);
    k = act(k, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: wall, attacker: patrol }] } } as never);
    k = finishCombat(k);
    expect(k.zones.battlefield.filter((id) => k.objects[id]!.token && chars(k, k.objects[id]!).subtypes.includes('Clue')).length).toBe(1);

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const old = give(m, 'alice', 'Cactuar Lite', 'battlefield');
    m = settle(act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Cactuar Lite', 'hand') }));
    const fresh = m.zones.battlefield.find((id) => id !== old && m.objects[id]!.card === 'Cactuar Lite')!;
    m = toStep(m, 'main1', 'bob');
    expect([m.objects[old]!.zone, m.objects[fresh]!.zone]).toEqual(['hand', 'battlefield']);

    let n = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [bobCub, bobLand] = [give(n, 'bob', 'Cub', 'battlefield'), give(n, 'bob', 'Red Rock', 'battlefield')];
    n.objects[bobCub]!.tapped = true;
    n.objects[bobLand]!.tapped = true;
    n = settle(act(n, { type: 'cast', player: 'alice', object: give(n, 'alice', 'Exhaustion Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    n = toStep(n, 'main1', 'bob');
    expect([n.objects[bobCub]!.tapped, n.objects[bobLand]!.tapped]).toEqual([true, true]);
    n = toStep(n, 'main1', 'alice');
    n = toStep(n, 'main1', 'bob');
    expect([n.objects[bobCub]!.tapped, n.objects[bobLand]!.tapped]).toEqual([false, false]);

    let q = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const wolf = give(q, 'alice', 'Wolf Card', 'battlefield');
    const aura = give(q, 'alice', 'Moonsilver Lite', 'battlefield');
    q.objects[aura]!.attachedTo = { id: wolf, zcc: q.objects[wolf]!.zcc };
    q = settle(act(q, { type: 'cast', player: 'alice', object: give(q, 'alice', 'Flip Lite', 'hand'), targets: [[{ kind: 'object', object: wolf }]] }));
    expect(q.objects[wolf]!.face ?? 0).toBe(0);
  });

  it('Skullcage, Orim’s Prayer, Clockwork Hydra, Sheriff of Safe Passage, Nissa’s Revelation, Not Forgotten', () => {
    for (const cards of [3, 5]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      give(g, 'alice', 'Skullcage Lite', 'battlefield');
      g.zones.hand.bob = g.zones.hand.bob!.slice(0, cards - 1);
      const life = g.players.bob!.life;
      g = toStep(g, 'main1', 'bob');
      // Bob draws for the turn after his upkeep: the hand size at upkeep is cards - 1… so set cards - 1 → upkeep count.
      expect(life - g.players.bob!.life).toBe(cards - 1 === 3 || cards - 1 === 4 ? 0 : 2);
    }

    let h = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(h, 'alice', 'Prayer Lite', 'battlefield');
    const attackers = [give(h, 'bob', 'Cub', 'battlefield'), give(h, 'bob', 'Cub', 'battlefield')];
    const life = h.players.alice!.life;
    h = attackWith(h, attackers, 'alice', 'bob');
    h = drive(h, () => null);
    expect(h.players.alice!.life - life).toBe(2);

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Clockwork Lite', 'hand') }));
    const hydra = k.zones.battlefield.find((id) => k.objects[id]!.card === 'Clockwork Lite')!;
    k.objects[hydra]!.sick = false;
    const bl = k.players.bob!.life;
    k = attackWith(k, [hydra]);
    k = drive(k, (x) => (x.pending?.kind === 'trigger_targets' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } }) : null));
    expect([k.objects[hydra]!.counters['+1/+1'], bl - k.players.bob!.life]).toEqual([3, 1]);

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(m, 'alice', 'Cub', 'battlefield');
    give(m, 'alice', 'Cub', 'battlefield');
    m = settle(act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Sheriff Lite', 'hand') }));
    const sheriff = m.zones.battlefield.find((id) => m.objects[id]!.card === 'Sheriff Lite')!;
    expect(m.objects[sheriff]!.counters['+1/+1']).toBe(3);

    let n = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const top = give(n, 'alice', 'Ogre', 'library');
    n.zones.library.alice = [top, ...n.zones.library.alice!.filter((id) => id !== top)];
    const [hand, al] = [n.zones.hand.alice!.length, n.players.alice!.life];
    n = act(n, { type: 'cast', player: 'alice', object: give(n, 'alice', 'Revelation Lite', 'hand') });
    n = drive(n, (x) => (x.pending?.kind === 'scry' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'scry', top: [top, ...(x.pending as { objects: string[] }).objects.filter((id) => id !== top)], bottom: [] } }) : null));
    expect([n.zones.hand.alice!.length - hand, n.players.alice!.life - al]).toEqual([5, 3]);

    let p = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const dead = give(p, 'bob', 'Ogre', 'graveyard');
    p = act(p, { type: 'cast', player: 'alice', object: give(p, 'alice', 'Not Forgotten Lite', 'hand'), targets: [[{ kind: 'object', object: dead }]] });
    p = drive(p, (x) => (x.pending?.kind === 'choose_option' ? act(x, { type: 'choose', player: (x.pending as { player: string }).player, answer: { kind: 'choose_option', choice: 'bottom' } }) : null));
    expect([p.zones.library.bob!.at(-1), p.zones.battlefield.some((id) => p.objects[id]!.token && p.objects[id]!.controller === 'alice')]).toEqual([dead, true]);
  });
});

describe('staples (slice 268, part 2)', () => {
  it("Deepway Navigator, Hurkyl's Final Meditation, Faith Healer, Graceful Reprieve, Cryptborn Horror, Shatterskull Charger", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const nav = give(g, 'alice', 'Navigator Lite', 'battlefield');
    const folk = [give(g, 'alice', 'Merfolk Lite', 'battlefield'), give(g, 'alice', 'Merfolk Lite', 'battlefield'), give(g, 'alice', 'Merfolk Lite', 'battlefield')];
    expect(chars(g, g.objects[nav]!).power).toBe(2);
    g = attackWith(g, folk);
    expect(chars(g, g.objects[nav]!).power).toBe(3);

    let h = toStep(start({ extra: CARDS }), 'main1', 'bob');
    for (let i = 0; i < 3; i++) give(h, 'alice', 'Red Rock', 'battlefield');
    const med = give(h, 'alice', 'Meditation Lite', 'hand');
    h = act(h, { type: 'pass', player: 'bob' });
    // {1} + {3} on bob's turn: three lands aren't enough.
    expect(h.priority).toBe('alice');
    expect(illegal(h, { type: 'cast', player: 'alice', object: med, autoTap: true } as never)).toBeTruthy();
    give(h, 'alice', 'Red Rock', 'battlefield');
    h = settle(act(h, { type: 'cast', player: 'alice', object: med, autoTap: true } as never));
    expect(h.objects[med]!.zone).toBe('graveyard');

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const healer = give(k, 'alice', 'Faith Healer Lite', 'battlefield');
    const ench = give(k, 'alice', 'Big Enchantment', 'battlefield');
    const life = k.players.alice!.life;
    k = settle(act(k, { type: 'activate', player: 'alice', object: healer, ability: 0, costs: { sacrifice: [ench] } } as never));
    expect(k.players.alice!.life - life).toBe(4);

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(m, 'alice', 'Ogre', 'battlefield');
    m = settle(act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Reprieve Lite', 'hand'), targets: [[{ kind: 'object', object: ogre }]] }));
    m = settle(act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: ogre }]] }));
    expect(m.objects[ogre]!.zone).toBe('battlefield');

    let n = toStep(start({ extra: CARDS }), 'main1', 'alice');
    n = settle(act(n, { type: 'cast', player: 'alice', object: give(n, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    n = settle(act(n, { type: 'cast', player: 'alice', object: give(n, 'alice', 'Cryptborn Lite', 'hand') }));
    const horror = n.zones.battlefield.find((id) => n.objects[id]!.card === 'Cryptborn Lite')!;
    expect(n.objects[horror]!.counters['+1/+1']).toBe(3);

    let p = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [plain, grown] = [give(p, 'alice', 'Charger Lite', 'battlefield'), give(p, 'alice', 'Charger Lite', 'battlefield')];
    p.objects[grown]!.counters['+1/+1'] = 1;
    p = toStep(p, 'main1', 'bob');
    expect([p.objects[plain]!.zone, p.objects[grown]!.zone]).toEqual(['hand', 'battlefield']);
  });

  it('Zoetic Glyph, Thunder Salvo, Bonds of Faith, Chittering Rats, Soul Tithe, Sabotage Strategist, Ruin Raider', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const sword = give(g, 'alice', 'Heavy Sword', 'battlefield');
    const glyph = give(g, 'alice', 'Glyph Lite', 'battlefield');
    g.objects[glyph]!.attachedTo = { id: sword, zcc: g.objects[sword]!.zcc };
    const c = chars(g, g.objects[sword]!);
    expect([c.types.includes('Creature'), c.types.includes('Artifact'), c.subtypes.includes('Golem'), c.power, c.toughness]).toEqual([true, true, true, 5, 4]);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const big = give(h, 'bob', 'Wall Lite', 'battlefield');
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Salve', 'hand') }));
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Salvo Lite', 'hand'), targets: [[{ kind: 'object', object: big }]] }));
    expect(h.objects[big]!.damage).toBe(3);

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [human, bear] = [give(k, 'alice', 'Human Cub', 'battlefield'), give(k, 'alice', 'Cub', 'battlefield')];
    const [b1, b2] = [give(k, 'alice', 'Bonds Lite', 'battlefield'), give(k, 'alice', 'Bonds Lite', 'battlefield')];
    k.objects[b1]!.attachedTo = { id: human, zcc: k.objects[human]!.zcc };
    k.objects[b2]!.attachedTo = { id: bear, zcc: k.objects[bear]!.zcc };
    expect(chars(k, k.objects[human]!).power).toBe(3);
    const q = toAttack(toStep(k, 'beginning_of_combat'));
    expect(illegal(q, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: bear, target: { kind: 'player', player: 'bob' } }] } })).toBeTruthy();

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const card = m.zones.hand.bob![0]!;
    m = act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Rats Lite', 'hand') });
    m = drive(m, (x) => (x.pending?.kind === 'trigger_targets' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } }) : x.pending?.kind === 'choose_objects' ? act(x, { type: 'choose', player: (x.pending as { player: string }).player, answer: { kind: 'choose_objects', objects: [card] } }) : null));
    expect(m.zones.library.bob![0]).toBe(card);

    let n = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const three = give(n, 'bob', 'Ogre Three', 'battlefield');
    const tithe = give(n, 'alice', 'Tithe Lite', 'battlefield');
    n.objects[tithe]!.attachedTo = { id: three, zcc: n.objects[three]!.zcc };
    n = toStep(n, 'upkeep', 'bob');
    n = drive(n, (x) => (x.pending?.kind === 'pay' ? act(x, { type: 'choose', player: 'bob', answer: { kind: 'pay', pay: false } }) : null));
    expect(n.objects[three]!.zone).toBe('graveyard');

    let p = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(p, 'alice', 'Strategist Lite', 'battlefield');
    const atk = give(p, 'bob', 'Ogre', 'battlefield');
    p = attackWith(p, [atk], 'alice', 'bob');
    p = drive(p, () => null);
    expect(chars(p, p.objects[atk]!).power).toBe(4);

    let r = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const raider = give(r, 'alice', 'Raider Lite', 'battlefield');
    const top = give(r, 'alice', 'Ogre Three', 'library');
    r.zones.library.alice = [top, ...r.zones.library.alice!.filter((id) => id !== top)];
    r = attackWith(r, [raider]);
    r = finishCombat(r);
    const life = r.players.alice!.life;
    r = toStep(r, 'main1', 'bob');
    expect([r.objects[top]!.zone, life - r.players.alice!.life]).toEqual(['hand', 3]);
  });
});
