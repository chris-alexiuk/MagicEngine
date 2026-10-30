import { describe, expect, it } from 'vitest';
import { chars, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';
import { moveObject } from '../src/zones.js';

const CARDS = [
  makeCard({ name: 'Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{0}', power: '5', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Ogre Three', type_line: 'Creature — Ogre', mana_cost: '{2}{R}', cmc: 3, power: '3', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Vampire Lite', type_line: 'Creature — Vampire', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Warrior Lite', type_line: 'Creature — Human Warrior', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Elf Lite', type_line: 'Creature — Elf', mana_cost: '{1}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Salve', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'You gain 3 life.' }),
  makeCard({ name: 'Bolt', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Bolt deals 3 damage to any target.' }),
  makeCard({ name: 'Altar Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Sacrifice a creature: You gain 1 life.' }),
  makeCard({ name: 'Land Altar Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Sacrifice a land: You gain 1 life.' }),
  makeCard({ name: 'Peel Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Return target creature you control and target creature you don't control to their owners' hands." }),
  makeCard({ name: 'Reverence Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Creatures with power 2 or less can't attack you." }),
  makeCard({ name: 'Statecraft Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Prevent all combat damage that would be dealt to and dealt by creatures you control.' }),
  makeCard({ name: 'Resolve Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Counter target spell if its controller is poisoned.' }),
  makeCard({ name: 'Rushblade Lite', type_line: 'Creature — Azra Warrior', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Warriors your team controls have haste.' }),
  makeCard({ name: 'Golden Ratio Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw a card for each different power among creatures you control.' }),
  makeCard({ name: 'Interpret Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Scry 3, then reveal the top card of your library. Draw cards equal to that card's mana value." }),
  makeCard({ name: 'Judge Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Choose target attacking or blocking creature. Scry 3, then reveal the top card of your library. Judge Lite deals damage equal to that card's mana value to that creature." }),
  makeCard({ name: 'Imagecrafter Lite', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{T}: Choose a creature type other than Wall. Target creature becomes that type until end of turn.' }),
  makeCard({ name: 'Cultivator Lite', type_line: 'Creature — Insect Druid', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'When this creature enters, you may discard any number of land cards. Put that many +1/+1 counters on this creature and draw that many cards.' }),
  makeCard({ name: 'Kingpin Lite', type_line: 'Legendary Creature — Human Villain', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Whenever you sacrifice Kingpin Lite or another creature, create two Treasure tokens. This ability triggers only once each turn.' }),
  makeCard({ name: 'Long Feng Lite', type_line: 'Legendary Creature — Human Advisor', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever another creature you control or a land you control is put into a graveyard from the battlefield, put a +1/+1 counter on target creature you control.' }),
  makeCard({ name: 'Web Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: "Enchant creature\nAt the beginning of the end step, if enchanted creature's power is 4 or greater, destroy this Aura." }),
  makeCard({ name: 'Energy Field Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Prevent all damage that would be dealt to you by sources you don't control." }),
  makeCard({ name: 'Naga Lite', type_line: 'Creature — Snake', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: 'During your turn, prevent all damage that would be dealt to this creature.' }),
  makeCard({ name: 'Gargoyle Lite', type_line: 'Artifact Creature — Gargoyle', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "This creature has flying as long as it's modified." }),
  makeCard({ name: 'Instability Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever a land enters, tap all lands its controller controls.' }),
  makeCard({ name: 'Fanatic Lite', type_line: 'Creature — Human Cleric', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'When this creature enters, each player discards a card. If you discarded a card this way, draw a card.' }),
  makeCard({ name: 'Sonar Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Sonar Lite deals 4 damage to target attacking, blocking, or tapped creature. You gain 3 life if you control a Bat.' }),
  makeCard({ name: 'Fangs Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: "Enchant creature\nEnchanted creature gets +2/+2 as long as it's a Vampire. Otherwise, it gets -2/-2." }),
  makeCard({
    name: 'Wolf Lite // Howl Lite',
    layout: 'transform',
    type_line: 'Creature — Human Werewolf // Creature — Werewolf',
    oracle_text: '',
    mana_cost: '{0}',
    card_faces: [
      { object: 'card_face', name: 'Wolf Lite', type_line: 'Creature — Human Werewolf', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' },
      { object: 'card_face', name: 'Howl Lite', type_line: 'Creature — Werewolf', mana_cost: '', power: '4', toughness: '4', oracle_text: '' },
    ],
  } as never),
  makeCard({ name: 'Waxing Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Transform up to one target Werewolf you control. Creatures you control gain trample until end of turn.' }),
  makeCard({ name: 'Roots Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Mill three cards, then return a land card or Elf card from your graveyard to your hand. If you can't, draw a card." }),
  makeCard({ name: 'Journey Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Target player shuffles up to three target cards from their graveyard into their library.' }),
  makeCard({ name: 'Quandrix Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Choose two —\n• Return target creature or planeswalker to its owner's hand.\n• Counter target artifact or enchantment spell.\n• Put two +1/+1 counters on target creature.\n• Target player shuffles up to three target cards from their graveyard into their library." }),
  makeCard({ name: 'Invocation Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Tap any number of untapped creatures you control. Create a 4/4 white Angel creature token with flying for each creature tapped this way.' }),
  makeCard({ name: 'Skull Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Look at target player's hand. You may choose a nonland card from it. That player discards that card." }),
  makeCard({ name: 'Skinripper Lite', type_line: 'Creature — Human Assassin', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'At the beginning of your end step, if you sacrificed one or more permanents this turn, this creature deals that much damage to any target.' }),
  makeCard({ name: 'Necromancer Lite', type_line: 'Creature — Human Warlock', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'When this creature enters, you may exile two cards from your graveyard. When you do, return target creature card from your graveyard to the battlefield.' }),
  makeCard({ name: 'Conscript Lite', type_line: 'Creature — Human Mercenary', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'When this creature dies, if it was enchanted, create a Junk token.' }),
  makeCard({ name: 'Mantle Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature\nEnchanted creature gets +1/+1.' }),
  makeCard({ name: 'Wizard Lite', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Guide Lite', type_line: 'Creature — Goblin Scout', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "Haste\nWhenever this creature attacks, defending player reveals the top card of their library. If it's a land card, that player puts it into their hand." }),
  makeCard({ name: 'Pelt Lite', type_line: 'Creature — Elf Warrior', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "Whenever another creature you control enters or dies, if that creature's power is greater than this creature's, put a +1/+1 counter on this creature." }),
  makeCard({ name: 'Hollow Lite', type_line: 'Artifact Creature — Golem', mana_cost: '{5}', cmc: 5, power: '4', toughness: '4', oracle_text: "This spell costs {2} less to cast for each card you've cycled or discarded this turn." }),
  makeCard({ name: 'Loot Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw two cards, then discard two cards.' }),
  makeCard({ name: 'Ranks Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'For each opponent, you create a 2/1 black Villain creature token with menace.' }),
  makeCard({ name: 'Abomination Lite', type_line: 'Legendary Creature — Human Beast Warrior', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: "Abomination Lite has trample as long as you've cast three or more spells this turn." }),
  makeCard({ name: 'Steelshaper Lite', type_line: 'Creature — Human Soldier', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Equip costs you pay cost {1} less.' }),
  makeCard({ name: 'Heavy Sword', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equipped creature gets +1/+1.\nEquip {3}' }),
  makeCard({ name: 'Turtle-Duck Lite', type_line: 'Creature — Turtle Bird', mana_cost: '{0}', power: '0', toughness: '4', oracle_text: '{0}: Until end of turn, this creature has base power 4 and gains trample.' }),
  makeCard({ name: 'Go Blank Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Target player discards two cards. Then exile that player's graveyard." }),
  makeCard({ name: 'Break Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target enchantment. If a permanent you controlled or a token was destroyed this way, draw a card.' }),
  makeCard({ name: 'Vessel Lite', type_line: 'Creature — Human Cleric', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: "When this creature dies, if it wasn't a Demon, return it to the battlefield under its owner's control with two +1/+1 counters on it. It's a Demon in addition to its other types." }),
  makeCard({ name: 'Cryoshatter Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature\nWhen enchanted creature becomes tapped or is dealt damage, destroy it.' }),
  makeCard({ name: 'Retro Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: "Enchant creature\nEnchanted creature is a Turtle with base power and toughness 0/1. It can't attack and loses all abilities." }),
  makeCard({ name: 'Insight Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Reveal the top six cards of your library. Put up to three enchantment cards from among them into your hand and the rest of the revealed cards into your graveyard.' }),
  makeCard({ name: 'Titan Hunter Lite', type_line: 'Creature — Human Warrior', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: "At the beginning of each player's end step, if no creatures died this turn, this creature deals 4 damage to that player." }),
  makeCard({ name: 'Narcomoeba Lite', type_line: 'Creature — Illusion', mana_cost: '{1}{U}', cmc: 2, power: '1', toughness: '1', oracle_text: 'Flying\nWhen this card is put into your graveyard from your library, you may put it onto the battlefield.' }),
  makeCard({ name: 'Mill Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Mill three cards.' }),
  makeCard({ name: 'Captain Lite', type_line: 'Creature — Human Detective', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'When this creature leaves the battlefield, put its +1/+1 counters on target creature you control.' }),
  makeCard({ name: 'Darkest Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'All creatures are black.' }),
  makeCard({ name: 'Earth Surge Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Each land gets +2/+2 as long as it's a creature." }),
  makeCard({ name: 'Animate Land Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target land becomes a 3/3 Elemental creature until end of turn. It\'s still a land.' }),
  makeCard({ name: 'Grasp Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: "Enchant creature\nEnchanted creature can't block creatures you control." }),
  makeCard({ name: 'Garrison Lite', type_line: 'Creature — Human Soldier', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever this creature attacks, you may tap any number of untapped Humans you control. Draw a card for each Human tapped this way.' }),
  makeCard({ name: 'Epochrasite Lite', type_line: 'Artifact Creature — Construct', mana_cost: '{2}', cmc: 2, power: '1', toughness: '1', oracle_text: 'When this creature dies, exile it with three time counters on it and it gains suspend.' }),
  makeCard({ name: 'Conscription Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Put target creature card from an opponent's graveyard onto the battlefield tapped under your control, then exile that player's graveyard." }),
  makeCard({ name: 'Cremator Lite', type_line: 'Creature — Goblin Shaman', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "When this creature enters, discard a card at random. If you discard a creature card this way, this creature deals damage equal to that card's power to target player or planeswalker." }),
  makeCard({ name: 'Pact Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: '' }),
  makeCard({ name: 'Ping Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Ping Lite deals 1 damage to any target.' }),
  makeCard({ name: 'Track Down Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Scry 3, then reveal the top card of your library. If it's a creature or land card, draw a card." }),
  makeCard({ name: 'Zurgo Lite', type_line: 'Legendary Creature — Orc Warrior', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "Zurgo Lite can't block creatures with power 2 or greater." }),
  makeCard({ name: 'Tuskodon Lite', type_line: 'Creature — Dinosaur', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'If this creature would deal combat damage to a player, it deals double that damage to that player instead.' }),
  makeCard({ name: 'Claws Lite', type_line: 'Sorcery', mana_cost: '{X}{R}', oracle_text: 'Claws Lite deals X damage to any target. Claws Lite deals X plus 2 damage instead if you control a creature with power 4 or greater.' }),
  makeCard({ name: 'Treasure Hunt Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Reveal cards from the top of your library until you reveal a nonland card, then put all cards revealed this way into your hand.' }),
  makeCard({ name: 'Keepers Lite', type_line: 'Creature — Elf Soldier', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'When this creature enters, mill four cards, then put all Elf cards from among them into your hand.' }),
  makeCard({ name: 'Naturalist Lite', type_line: 'Creature — Human Scout', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "When this creature enters, mill three cards. Put a land card from among the milled cards into your hand. If you can't, create a Treasure token." }),
  makeCard({ name: 'Take Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Remove all +1/+1 counters from target creature you control. Draw that many cards.' }),
  makeCard({ name: 'Siege Dragon Lite', type_line: 'Creature — Dragon', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: 'Flying\nWhenever this creature attacks, if defending player controls no Walls, it deals 2 damage to each creature without flying that player controls.' }),
  makeCard({ name: 'Wall Lite', type_line: 'Creature — Wall', mana_cost: '{0}', power: '0', toughness: '4', oracle_text: 'Defender' }),
  makeCard({ name: 'Bird Lite', type_line: 'Creature — Bird', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Flying' }),
  makeCard({ name: 'Hindervines Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Prevent all combat damage that would be dealt this turn by creatures with no +1/+1 counters on them.' }),
  makeCard({ name: 'Heartless Act Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Choose one —\n• Destroy target creature with no counters on it.\n• Remove up to three counters from target creature.' }),
  makeCard({ name: 'Festival Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle. Then if there are three or more basic land types among lands you control, scry 1.' }),
  makeCard({ name: 'Purity Lite', type_line: 'Creature — Elemental Incarnation', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: 'If noncombat damage would be dealt to you, prevent that damage. You gain life equal to the damage prevented this way.' }),
  makeCard({ name: 'Form Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Creatures without flying can't attack you." }),
  makeCard({ name: 'Mindshrieker Lite', type_line: 'Creature — Spirit Bird', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "{0}: Target player mills a card. This creature gets +X/+X until end of turn, where X is the milled card's mana value." }),
  makeCard({ name: 'Hundred Lite', type_line: 'Creature — Giant', mana_cost: '{0}', power: '3', toughness: '5', oracle_text: '{0}: Monstrosity 3.\nAs long as this creature is monstrous, it has reach and can block an additional ninety-nine creatures each combat.' }),
  makeCard({ name: 'Splinter Lite', type_line: 'Legendary Creature — Mutant Ninja Rat', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'When Splinter Lite leaves the battlefield, you and another target player each draw a card.' }),
  makeCard({ name: 'Cache Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'You gain 2 life. Then if you have more life than an opponent, draw a card.' }),
  makeCard({ name: 'Mangler Lite', type_line: 'Artifact — Vehicle', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: 'During turns other than yours, this Vehicle is an artifact creature.\nCrew 2' }),
  makeCard({ name: 'Shadowborn Lite', type_line: 'Creature — Demon', mana_cost: '{0}', power: '5', toughness: '6', oracle_text: 'At the beginning of your upkeep, if there are fewer than six creature cards in your graveyard, sacrifice a creature.' }),
  makeCard({ name: 'Encore Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Discard a card, then draw a card. When you discard a nonland card this way, Encore Lite deals damage equal to that card's mana value to target creature or planeswalker." }),
  makeCard({ name: 'Grasp River Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: "Enchant creature\nWhen this Aura enters, tap enchanted creature and remove all counters from it.\nEnchanted creature loses all abilities and doesn't untap during its controller's untap step." }),
  makeCard({ name: 'Ruin Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Destroy target artifact and all other artifacts with the same name as that artifact.' }),
  makeCard({ name: 'Matrix Lite', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equipped creature gets +X/+X, where X is its mana value.\nEquip {0}' }),
  makeCard({ name: 'Paragon Lite', type_line: 'Creature — Astartes Knight', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Flash\nWhen this creature enters, destroy target attacking creature. If that creature is a Demon, exile it instead.' }),
  makeCard({ name: 'Demon Lite', type_line: 'Creature — Demon', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: '' }),
  makeCard({ name: 'Genius Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Choose any target. Draw three cards, then discard a card. Genius Lite deals damage equal to the discarded card's mana value to that permanent or player." }),
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

describe('staples (slice 264)', () => {
  it("Peel from Reality, Reverence, Statecraft, Corrupted Resolve, Rushblade Commander", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [mine, theirs] = [give(g, 'alice', 'Cub', 'battlefield'), give(g, 'bob', 'Ogre', 'battlefield')];
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Peel Lite', 'hand'), targets: [[{ kind: 'object', object: theirs }], [{ kind: 'object', object: mine }]] })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Peel Lite', 'hand'), targets: [[{ kind: 'object', object: mine }], [{ kind: 'object', object: theirs }]] }));
    expect([g.objects[mine]!.zone, g.objects[theirs]!.zone]).toEqual(['hand', 'hand']);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(h, 'bob', 'Reverence Lite', 'battlefield');
    const [small, big] = [give(h, 'alice', 'Cub', 'battlefield', { sick: false }), give(h, 'alice', 'Ogre', 'battlefield', { sick: false })];
    const q = toAttack(toStep(h, 'beginning_of_combat'));
    expect(illegal(q, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: small, target: { kind: 'player', player: 'bob' } }] } })).toBeTruthy();
    h = act(q, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: big, target: { kind: 'player', player: 'bob' } }] } });
    expect(h.combat?.attackers[big]).toBeTruthy();

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    clearBattlefield(k, 'bob');
    give(k, 'alice', 'Statecraft Lite', 'battlefield');
    const ogre = give(k, 'alice', 'Ogre', 'battlefield', { sick: false });
    const life = k.players.bob!.life;
    k = finishCombat(attackWith(k, [ogre]));
    expect(k.players.bob!.life).toBe(life);
    let k2 = toStep(start({ extra: CARDS }), 'main1', 'bob');
    clearBattlefield(k2, 'alice');
    give(k2, 'alice', 'Statecraft Lite', 'battlefield');
    const raider = give(k2, 'bob', 'Ogre', 'battlefield', { sick: false });
    const wall = give(k2, 'alice', 'Cub', 'battlefield');
    k2 = toAttack(toStep(k2, 'beginning_of_combat'));
    k2 = act(k2, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: raider, target: { kind: 'player', player: 'alice' } }] } });
    k2 = toAttack(k2);
    k2 = act(k2, { type: 'choose', player: 'alice', answer: { kind: 'declare_blockers', blocks: [{ blocker: wall, attacker: raider }] } } as never);
    k2 = finishCombat(k2);
    expect([k2.objects[wall]!.zone, k2.objects[wall]!.damage]).toEqual(['battlefield', 0]);

    for (const poisoned of [false, true]) {
      let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
      if (poisoned) m.players.alice!.poison = 1;
      const salve = give(m, 'alice', 'Salve', 'hand');
      const before = m.players.alice!.life;
      m = act(m, { type: 'cast', player: 'alice', object: salve });
      m = act(m, { type: 'pass', player: 'alice' });
      m = settle(act(m, { type: 'cast', player: 'bob', object: give(m, 'bob', 'Resolve Lite', 'hand'), targets: [[{ kind: 'object', object: salve }]] }));
      expect(m.players.alice!.life - before).toBe(poisoned ? 0 : 3);
    }

    let n = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(n, 'alice', 'Rushblade Lite', 'battlefield');
    const [warrior, cub] = [give(n, 'alice', 'Warrior Lite', 'battlefield'), give(n, 'alice', 'Cub', 'battlefield')];
    expect([chars(n, n.objects[warrior]!).keywords.some((x) => x.id === 'haste'), chars(n, n.objects[cub]!).keywords.some((x) => x.id === 'haste')]).toEqual([true, false]);
    n = attackWith(n, [warrior]);
    expect(n.combat?.attackers[warrior]).toBeTruthy();
  });

  it('Golden Ratio, Interpret the Signs, Judge Unworthy, Imagecrafter', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    clearBattlefield(g, 'alice');
    for (const name of ['Cub', 'Cub', 'Ogre', 'Ogre Three']) give(g, 'alice', name, 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Golden Ratio Lite', 'hand') }));
    expect(g.zones.hand.alice!.length - hand).toBe(3);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const top = give(h, 'alice', 'Ogre Three', 'library');
    h.zones.library.alice!.splice(h.zones.library.alice!.indexOf(top), 1);
    h.zones.library.alice!.unshift(top);
    const h0 = h.zones.hand.alice!.length;
    h = act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Interpret Lite', 'hand') });
    h = drive(h, (x) => (x.pending?.kind === 'scry' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'scry', top: (x.pending as { objects: string[] }).objects, bottom: [] } }) : null));
    expect(h.zones.hand.alice!.length - h0).toBe(3);
    expect(h.zones.hand.alice).toContain(top);

    let j = toStep(start({ extra: CARDS }), 'main1', 'alice');
    clearBattlefield(j, 'bob');
    const atk = give(j, 'alice', 'Ogre', 'battlefield', { sick: false });
    const card = give(j, 'bob', 'Ogre Three', 'library');
    j.zones.library.bob!.splice(j.zones.library.bob!.indexOf(card), 1);
    j.zones.library.bob!.unshift(card);
    j = attackWith(j, [atk]);
    // Bob responds in the declare attackers step, once Alice passes.
    j = act(j, { type: 'pass', player: 'alice' });
    expect([j.step, j.priority]).toEqual(['declare_attackers', 'bob']);
    j = act(j, { type: 'cast', player: 'bob', object: give(j, 'bob', 'Judge Lite', 'hand'), targets: [[{ kind: 'object', object: atk }]] });
    j = drive(j, (x) => (x.pending?.kind === 'scry' ? act(x, { type: 'choose', player: 'bob', answer: { kind: 'scry', top: (x.pending as { objects: string[] }).objects, bottom: [] } }) : null));
    expect(j.objects[atk]!.zone).toBe('graveyard');

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const crafter = give(k, 'alice', 'Imagecrafter Lite', 'battlefield', { sick: false });
    const bear = give(k, 'bob', 'Cub', 'battlefield');
    k = act(k, { type: 'activate', player: 'alice', object: crafter, ability: 0, targets: [[{ kind: 'object', object: bear }]] });
    k = settle(k);
    expect(k.pending?.kind).toBe('choose_option');
    expect((k.pending as { options: string[] }).options).not.toContain('Wall');
    k = settle(act(k, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: 'Elf' } }));
    expect(chars(k, k.objects[bear]!).subtypes).toEqual(['Elf']);
  });

  it('Nantuko Cultivator, Kingpin, Long Feng, Arachnus Web', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (const id of [...g.zones.hand.alice!]) moveObject(g, id, 'graveyard', []);
    const lands = [give(g, 'alice', 'Forest', 'hand'), give(g, 'alice', 'Forest', 'hand'), give(g, 'alice', 'Forest', 'hand')];
    give(g, 'alice', 'Salve', 'hand');
    const cultivator = give(g, 'alice', 'Cultivator Lite', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: cultivator });
    g = drive(g, (x) => (x.pending?.kind === 'choose_objects' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: lands.slice(0, 2) } }) : x.pending?.kind === 'may' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }) : null));
    expect([g.objects[cultivator]!.counters['+1/+1'], g.zones.hand.alice!.length, g.objects[lands[2]!]!.zone]).toEqual([2, 4, 'hand']);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const kingpin = give(h, 'alice', 'Kingpin Lite', 'battlefield');
    const altar = give(h, 'alice', 'Altar Lite', 'battlefield');
    const treasures = () => h.zones.battlefield.filter((id) => h.objects[id]!.token && h.objects[id]!.controller === 'alice').length;
    for (const victim of [give(h, 'alice', 'Cub', 'battlefield'), give(h, 'alice', 'Cub', 'battlefield')]) {
      h = settle(act(h, { type: 'activate', player: 'alice', object: altar, ability: 0, costs: { sacrifice: [victim] } }));
    }
    expect(treasures()).toBe(2);
    h = drive(toStep(h, 'main1', 'bob'), () => null);
    h = drive(toStep(h, 'main1', 'alice'), () => null);
    h = settle(act(h, { type: 'activate', player: 'alice', object: altar, ability: 0, costs: { sacrifice: [kingpin] } }));
    expect(treasures()).toBe(4);

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const feng = give(k, 'alice', 'Long Feng Lite', 'battlefield');
    const landAltar = give(k, 'alice', 'Land Altar Lite', 'battlefield');
    const forest = give(k, 'alice', 'Forest', 'battlefield');
    k = act(k, { type: 'activate', player: 'alice', object: landAltar, ability: 0, costs: { sacrifice: [forest] } });
    k = drive(k, (x) => (x.pending?.kind === 'trigger_targets' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: feng }]] } }) : null));
    expect(k.objects[feng]!.counters['+1/+1']).toBe(1);

    for (const [name, gone] of [['Ogre', true], ['Cub', false]] as const) {
      let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const host = give(m, 'bob', name, 'battlefield');
      const web = give(m, 'alice', 'Web Lite', 'hand');
      m = settle(act(m, { type: 'cast', player: 'alice', object: web, targets: [[{ kind: 'object', object: host }]] }));
      expect(m.objects[web]!.zone).toBe('battlefield');
      m = drive(settle(toStep(m, 'end', 'alice')), () => null);
      expect(m.objects[web]!.zone).toBe(gone ? 'graveyard' : 'battlefield');
    }
  });

  it('Energy Field, Guardian Naga, Obstinate Gargoyle, Tectonic Instability, Fanatic of the Harrowing', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Energy Field Lite', 'battlefield');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] }));
    expect(g.players.alice!.life).toBe(life);
    g = drive(toStep(g, 'main1', 'alice'), () => null);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] }));
    expect(life - g.players.alice!.life).toBe(3);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const naga = give(h, 'alice', 'Naga Lite', 'battlefield');
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: naga }]] }));
    expect([h.objects[naga]!.zone, h.objects[naga]!.damage]).toEqual(['battlefield', 0]);
    h = drive(toStep(h, 'main1', 'bob'), () => null);
    h = settle(act(h, { type: 'cast', player: 'bob', object: give(h, 'bob', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: naga }]] }));
    expect(h.objects[naga]!.zone).toBe('graveyard');

    const k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const gargoyle = give(k, 'alice', 'Gargoyle Lite', 'battlefield');
    expect(chars(k, k.objects[gargoyle]!).keywords.some((x) => x.id === 'flying')).toBe(false);
    k.objects[gargoyle]!.counters['+1/+1'] = 1;
    expect(chars(k, k.objects[gargoyle]!).keywords.some((x) => x.id === 'flying')).toBe(true);

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(m, 'bob', 'Instability Lite', 'battlefield');
    for (const who of ['alice', 'alice', 'bob', 'bob']) give(m, who, 'Forest', 'battlefield');
    const mine = m.zones.battlefield.filter((id) => m.objects[id]!.controller === 'alice' && chars(m, m.objects[id]!).types.includes('Land'));
    const theirs = m.zones.battlefield.filter((id) => m.objects[id]!.controller === 'bob' && chars(m, m.objects[id]!).types.includes('Land'));
    m = settle(act(m, { type: 'play_land', player: 'alice', object: give(m, 'alice', 'Forest', 'hand') }));
    expect(mine.length).toBeGreaterThan(0);
    expect([mine.every((id) => m.objects[id]!.tapped), theirs.some((id) => m.objects[id]!.tapped)]).toEqual([true, false]);

    for (const holding of [false, true]) {
      let n = toStep(start({ extra: CARDS }), 'main1', 'alice');
      for (const id of [...n.zones.hand.alice!]) moveObject(n, id, 'graveyard', []);
      if (holding) give(n, 'alice', 'Salve', 'hand');
      n = act(n, { type: 'cast', player: 'alice', object: give(n, 'alice', 'Fanatic Lite', 'hand') });
      n = drive(n, (x) => (x.pending?.kind === 'discard' ? act(x, { type: 'choose', player: x.pending.player, answer: { kind: 'discard', objects: x.zones.hand[x.pending.player]!.slice(0, 1) } }) : null));
      expect(n.zones.hand.alice!.length).toBe(holding ? 1 : 0);
    }
  });

  it('Sonar Strike, Gift of Fangs, Waxing Moon, Roots of Wisdom', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [tapped, untapped] = [give(g, 'bob', 'Ogre', 'battlefield'), give(g, 'bob', 'Ogre', 'battlefield')];
    g.objects[tapped]!.tapped = true;
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Sonar Lite', 'hand'), targets: [[{ kind: 'object', object: untapped }]] })).toBeTruthy();
    const g2 = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Sonar Lite', 'hand'), targets: [[{ kind: 'object', object: tapped }]] }));
    expect(g2.objects[tapped]!.zone).toBe('graveyard');

    for (const name of ['Vampire Lite', 'Ogre']) {
      let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const host = give(h, 'alice', name, 'battlefield');
      h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Fangs Lite', 'hand'), targets: [[{ kind: 'object', object: host }]] }));
      const c = chars(h, h.objects[host]!);
      expect([c.power, c.toughness]).toEqual(name === 'Ogre' ? [3, 1] : [4, 4]);
    }

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const wolf = give(k, 'alice', 'Wolf Lite // Howl Lite', 'battlefield');
    const cub = give(k, 'alice', 'Cub', 'battlefield');
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Waxing Lite', 'hand'), targets: [[{ kind: 'object', object: wolf }]] }));
    expect([chars(k, k.objects[wolf]!).power, chars(k, k.objects[cub]!).keywords.some((x) => x.id === 'trample')]).toEqual([4, true]);
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Waxing Lite', 'hand'), targets: [[]] }));
    expect(chars(k, k.objects[wolf]!).power).toBe(4);

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const h0 = m.zones.hand.alice!.length;
    m = act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Roots Lite', 'hand') });
    m = drive(m, (x) => (x.pending?.kind === 'choose_objects' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: (x.pending as { candidates: string[] }).candidates.slice(0, 1) } }) : null));
    expect(m.zones.hand.alice!.length - h0).toBe(1);
    let n = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (const id of [...n.zones.library.alice!, ...n.zones.graveyard.alice!]) moveObject(n, id, 'exile', []);
    for (let i = 0; i < 5; i++) give(n, 'alice', 'Salve', 'library');
    const n0 = n.zones.hand.alice!.length;
    n = drive(act(n, { type: 'cast', player: 'alice', object: give(n, 'alice', 'Roots Lite', 'hand') }), () => null);
    n = settle(n);
    expect([n.zones.hand.alice!.length - n0, n.zones.library.alice!.length]).toEqual([1, 1]);
  });

  it("Memory's Journey, Quandrix Command, Devout Invocation, Cracked Skull", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const theirs = [give(g, 'bob', 'Cub', 'graveyard'), give(g, 'bob', 'Ogre', 'graveyard')];
    const mine = give(g, 'alice', 'Cub', 'graveyard');
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Journey Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }], [{ kind: 'object', object: mine }]] })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Journey Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }], theirs.map((object) => ({ kind: 'object' as const, object }))] }));
    expect([...theirs.map((id) => g.objects[id]!.zone), g.objects[mine]!.zone]).toEqual(['library', 'library', 'graveyard']);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(h, 'alice', 'Cub', 'battlefield');
    const dead = give(h, 'bob', 'Ogre', 'graveyard');
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Quandrix Lite', 'hand'), modes: [2, 3], targets: [[{ kind: 'object', object: bear }], [{ kind: 'player', player: 'bob' }], [{ kind: 'object', object: dead }]] }));
    expect([h.objects[bear]!.counters['+1/+1'], h.objects[dead]!.zone]).toEqual([2, 'library']);

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    clearBattlefield(k, 'alice');
    const crew = [give(k, 'alice', 'Cub', 'battlefield'), give(k, 'alice', 'Cub', 'battlefield'), give(k, 'alice', 'Cub', 'battlefield')];
    k = act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Invocation Lite', 'hand') });
    k = drive(k, (x) => (x.pending?.kind === 'choose_objects' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: crew.slice(0, 2) } }) : null));
    const angels = k.zones.battlefield.filter((id) => k.objects[id]!.token && chars(k, k.objects[id]!).subtypes.includes('Angel'));
    expect([angels.length, crew.map((id) => k.objects[id]!.tapped)]).toEqual([2, [true, true, false]]);

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (const id of [...m.zones.hand.bob!]) moveObject(m, id, 'graveyard', []);
    const [land, salve] = [give(m, 'bob', 'Forest', 'hand'), give(m, 'bob', 'Salve', 'hand')];
    m = act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Skull Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] });
    m = settle(m);
    expect(m.pending?.kind).toBe('choose_objects');
    expect([(m.pending as { candidates: string[] }).candidates, [...((m.pending as { seen?: string[] }).seen ?? [])].sort()]).toEqual([[salve], [land, salve].sort()]);
    m = settle(act(m, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [salve] } }));
    expect([m.objects[salve]!.zone, m.objects[land]!.zone]).toEqual(['graveyard', 'hand']);
  });

  it('Sawblade Skinripper, Young Necromancer, Gunner Conscript', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Skinripper Lite', 'battlefield');
    const altar = give(g, 'alice', 'Altar Lite', 'battlefield');
    for (const victim of [give(g, 'alice', 'Cub', 'battlefield'), give(g, 'alice', 'Cub', 'battlefield')]) {
      g = settle(act(g, { type: 'activate', player: 'alice', object: altar, ability: 0, costs: { sacrifice: [victim] } }));
    }
    const life = g.players.bob!.life;
    g = drive(toStep(g, 'end', 'alice'), (x) => (x.pending?.kind === 'trigger_targets' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } }) : null));
    g = settle(g);
    expect(life - g.players.bob!.life).toBe(2);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (const id of [...h.zones.graveyard.alice!]) moveObject(h, id, 'exile', []);
    const fuel = [give(h, 'alice', 'Salve', 'graveyard'), give(h, 'alice', 'Bolt', 'graveyard')];
    const ogre = give(h, 'alice', 'Ogre', 'graveyard');
    h = act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Necromancer Lite', 'hand') });
    h = drive(h, (x) =>
      x.pending?.kind === 'may'
        ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } })
        : x.pending?.kind === 'choose_objects'
          ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: fuel } })
          : x.pending?.kind === 'trigger_targets'
            ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: ogre }]] } })
            : null,
    );
    expect([...fuel.map((id) => h.objects[id]!.zone), h.objects[ogre]!.zone]).toEqual(['exile', 'exile', 'battlefield']);
    let h2 = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (const id of [...h2.zones.graveyard.alice!]) moveObject(h2, id, 'exile', []);
    const lone = give(h2, 'alice', 'Ogre', 'graveyard');
    h2 = act(h2, { type: 'cast', player: 'alice', object: give(h2, 'alice', 'Necromancer Lite', 'hand') });
    h2 = drive(h2, (x) => (x.pending?.kind === 'may' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }) : null));
    expect([h2.pending?.kind, h2.objects[lone]!.zone]).toEqual([undefined, 'graveyard']);

    for (const enchanted of [false, true]) {
      let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const conscript = give(k, 'alice', 'Conscript Lite', 'battlefield');
      if (enchanted) k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Mantle Lite', 'hand'), targets: [[{ kind: 'object', object: conscript }]] }));
      k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: conscript }]] }));
      k = settle(k);
      const junk = k.zones.battlefield.filter((id) => k.objects[id]!.token && chars(k, k.objects[id]!).subtypes.includes('Junk'));
      expect(junk.length).toBe(enchanted ? 1 : 0);
    }
    expect(legalActions).toBeTruthy();
  });
});

describe('staples (slice 265)', () => {
  it('Goblin Guide, Pelt Collector, Hollow One, Endless Ranks of HYDRA, The Howling Abomination, Auriok Steelshaper', () => {
    for (const land of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      clearBattlefield(g, 'bob');
      const guide = give(g, 'alice', 'Guide Lite', 'battlefield');
      const top = give(g, 'bob', land ? 'Forest' : 'Salve', 'library');
      g.zones.library.bob!.splice(g.zones.library.bob!.indexOf(top), 1);
      g.zones.library.bob!.unshift(top);
      g = drive(attackWith(g, [guide]), () => null);
      expect(g.objects[top]!.zone).toBe(land ? 'hand' : 'library');
    }

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const pelt = give(h, 'alice', 'Pelt Lite', 'battlefield');
    const big = give(h, 'alice', 'Ogre', 'hand');
    h = settle(act(h, { type: 'cast', player: 'alice', object: big }));
    expect(h.objects[pelt]!.counters['+1/+1']).toBe(1);
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Cub', 'hand') }));
    expect(h.objects[pelt]!.counters['+1/+1']).toBe(1);
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: big }]] }));
    expect([h.objects[big]!.zone, h.objects[pelt]!.counters['+1/+1']]).toEqual(['graveyard', 2]);

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const hollow = give(k, 'alice', 'Hollow Lite', 'hand');
    k = act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Loot Lite', 'hand') });
    k = drive(k, (x) => (x.pending?.kind === 'discard' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: x.zones.hand.alice!.filter((id) => id !== hollow).slice(0, 2) } }) : null));
    k.players.alice!.pool.C = 1;
    k = settle(act(k, { type: 'cast', player: 'alice', object: hollow }));
    expect(k.objects[hollow]!.zone).toBe('battlefield');

    let m = toStep(start({ players: 3, extra: CARDS }), 'main1', 'alice');
    m = settle(act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Ranks Lite', 'hand') }));
    const villains = m.zones.battlefield.filter((id) => m.objects[id]!.token && chars(m, m.objects[id]!).subtypes.includes('Villain'));
    expect([villains.length, chars(m, m.objects[villains[0]!]!).keywords.map((x) => x.id)]).toEqual([2, ['menace']]);

    let n = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const abom = give(n, 'alice', 'Abomination Lite', 'battlefield');
    const trample = () => chars(n, n.objects[abom]!).keywords.some((x) => x.id === 'trample');
    for (let i = 0; i < 2; i++) n = settle(act(n, { type: 'cast', player: 'alice', object: give(n, 'alice', 'Salve', 'hand') }));
    expect(trample()).toBe(false);
    n = settle(act(n, { type: 'cast', player: 'alice', object: give(n, 'alice', 'Salve', 'hand') }));
    expect(trample()).toBe(true);

    let p = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(p, 'alice', 'Steelshaper Lite', 'battlefield');
    const sword = give(p, 'alice', 'Heavy Sword', 'battlefield');
    const bear = give(p, 'alice', 'Cub', 'battlefield');
    p.players.alice!.pool.C = 2;
    p = settle(act(p, { type: 'activate', player: 'alice', object: sword, ability: 0, targets: [[{ kind: 'object', object: bear }]] }));
    expect(p.objects[sword]!.attachedTo?.id).toBe(bear);
  });

  it('Turtle-Duck, Go Blank, Break the Spell, Infernal Vessel, Cryoshatter, Retro-Mutation', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const duck = give(g, 'alice', 'Turtle-Duck Lite', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: duck, ability: 0 }));
    const dc = chars(g, g.objects[duck]!);
    expect([dc.power, dc.toughness, dc.keywords.some((x) => x.id === 'trample')]).toEqual([4, 4, true]);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const old = give(h, 'bob', 'Cub', 'graveyard');
    h = act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Go Blank Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] });
    h = drive(h, (x) => (x.pending?.kind === 'discard' ? act(x, { type: 'choose', player: 'bob', answer: { kind: 'discard', objects: x.zones.hand.bob!.slice(0, 2) } }) : null));
    expect([h.zones.graveyard.bob!.length, h.objects[old]!.zone]).toEqual([0, 'exile']);

    for (const mine of [true, false]) {
      let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const ench = give(k, mine ? 'alice' : 'bob', 'Darkest Lite', 'battlefield');
      const hand = k.zones.hand.alice!.length;
      k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Break Lite', 'hand'), targets: [[{ kind: 'object', object: ench }]] }));
      expect(k.zones.hand.alice!.length - hand).toBe(mine ? 1 : 0);
    }

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const vessel = give(m, 'alice', 'Vessel Lite', 'battlefield');
    m = settle(act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: vessel }]] }));
    const vc = chars(m, m.objects[vessel]!);
    expect([m.objects[vessel]!.zone, m.objects[vessel]!.counters['+1/+1'], vc.subtypes.includes('Demon')]).toEqual(['battlefield', 2, true]);
    m = settle(act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: vessel }]] }));
    expect(m.objects[vessel]!.zone).toBe('graveyard');

    let n = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const victim = give(n, 'bob', 'Ogre', 'battlefield');
    n = settle(act(n, { type: 'cast', player: 'alice', object: give(n, 'alice', 'Cryoshatter Lite', 'hand'), targets: [[{ kind: 'object', object: victim }]] }));
    expect(n.objects[victim]!.zone).toBe('battlefield');
    n = drive(settle(act(n, { type: 'cast', player: 'alice', object: give(n, 'alice', 'Ping Lite', 'hand'), targets: [[{ kind: 'object', object: victim }]] })), () => null);
    expect(n.objects[victim]!.zone).toBe('graveyard');

    let q = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const turtle = give(q, 'bob', 'Guide Lite', 'battlefield');
    q = settle(act(q, { type: 'cast', player: 'alice', object: give(q, 'alice', 'Retro Lite', 'hand'), targets: [[{ kind: 'object', object: turtle }]] }));
    const tc = chars(q, q.objects[turtle]!);
    expect([tc.power, tc.toughness, tc.subtypes, tc.keywords.length]).toEqual([0, 1, ['Turtle'], 0]);
  });

  it("Kruphix's Insight, Titan Hunter, Narcomoeba, Selfless Police Captain, Darkest Hour, Earth Surge", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const tops = ['Darkest Lite', 'Pact Lite', 'Cub', 'Darkest Lite', 'Forest', 'Pact Lite'].map((name) => give(g, 'alice', name, 'library'));
    for (const id of [...tops].reverse()) {
      g.zones.library.alice!.splice(g.zones.library.alice!.indexOf(id), 1);
      g.zones.library.alice!.unshift(id);
    }
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Insight Lite', 'hand') });
    g = drive(g, (x) => (x.pending?.kind === 'choose_objects' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [tops[0]!, tops[1]!, tops[3]!] } }) : null));
    expect(tops.map((id) => g.objects[id]!.zone)).toEqual(['hand', 'hand', 'graveyard', 'hand', 'graveyard', 'graveyard']);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(h, 'alice', 'Titan Hunter Lite', 'battlefield');
    const life = h.players.alice!.life;
    h = drive(settle(toStep(h, 'end', 'alice')), () => null);
    expect(life - h.players.alice!.life).toBe(4);
    let h2 = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(h2, 'alice', 'Titan Hunter Lite', 'battlefield');
    const cub = give(h2, 'bob', 'Cub', 'battlefield');
    h2 = settle(act(h2, { type: 'cast', player: 'alice', object: give(h2, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: cub }]] }));
    const life2 = h2.players.alice!.life;
    h2 = drive(settle(toStep(h2, 'end', 'alice')), () => null);
    expect(h2.players.alice!.life).toBe(life2);

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const moeba = give(k, 'alice', 'Narcomoeba Lite', 'library');
    k.zones.library.alice!.splice(k.zones.library.alice!.indexOf(moeba), 1);
    k.zones.library.alice!.unshift(moeba);
    k = act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Mill Lite', 'hand') });
    k = drive(k, (x) => (x.pending?.kind === 'may' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }) : null));
    expect(k.objects[moeba]!.zone).toBe('battlefield');
    let k2 = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const discarded = give(k2, 'alice', 'Narcomoeba Lite', 'hand');
    k2 = act(k2, { type: 'cast', player: 'alice', object: give(k2, 'alice', 'Loot Lite', 'hand') });
    k2 = drive(k2, (x) => (x.pending?.kind === 'discard' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: [discarded, x.zones.hand.alice!.find((id) => id !== discarded)!] } }) : null));
    expect([k2.objects[discarded]!.zone, k2.pending?.kind]).toEqual(['graveyard', undefined]);

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const captain = give(m, 'alice', 'Captain Lite', 'battlefield');
    const heir = give(m, 'alice', 'Cub', 'battlefield');
    m.objects[captain]!.counters['+1/+1'] = 2;
    m = act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: captain }]] });
    m = drive(m, (x) => (x.pending?.kind === 'trigger_targets' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: heir }]] } }) : null));
    expect(m.objects[heir]!.counters['+1/+1']).toBe(2);

    const n = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(n, 'alice', 'Darkest Lite', 'battlefield');
    const ogre = give(n, 'bob', 'Ogre', 'battlefield');
    expect(chars(n, n.objects[ogre]!).colors).toEqual(['B']);

    let q = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(q, 'alice', 'Earth Surge Lite', 'battlefield');
    const land = give(q, 'alice', 'Forest', 'battlefield');
    expect(chars(q, q.objects[land]!).types.includes('Creature')).toBe(false);
    q = settle(act(q, { type: 'cast', player: 'alice', object: give(q, 'alice', 'Animate Land Lite', 'hand'), targets: [[{ kind: 'object', object: land }]] }));
    const lc = chars(q, q.objects[land]!);
    expect([lc.power, lc.toughness]).toEqual([5, 5]);
  });

  it("Spectral Grasp, Minas Tirith Garrison, Epochrasite, Nurgle's Conscription, Cragganwick Cremator", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    clearBattlefield(g, 'bob');
    const atk = give(g, 'alice', 'Cub', 'battlefield', { sick: false });
    const blocker = give(g, 'bob', 'Ogre', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Grasp Lite', 'hand'), targets: [[{ kind: 'object', object: blocker }]] }));
    g = toAttack(attackWith(g, [atk]));
    expect(g.pending?.kind).toBe('declare_blockers');
    expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker, attacker: atk }] } } as never)).toBeTruthy();

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    clearBattlefield(h, 'bob');
    const garrison = give(h, 'alice', 'Garrison Lite', 'battlefield', { sick: false });
    const humans = [give(h, 'alice', 'Wizard Lite', 'battlefield'), give(h, 'alice', 'Warrior Lite', 'battlefield'), give(h, 'alice', 'Cub', 'battlefield')];
    const lib = h.zones.library.alice!.length;
    h = attackWith(h, [garrison]);
    h = drive(h, (x) => (x.pending?.kind === 'choose_objects' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: (x.pending as { candidates: string[] }).candidates } }) : null));
    expect([lib - h.zones.library.alice!.length, humans.map((id) => h.objects[id]!.tapped)]).toEqual([2, [true, true, false]]);

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const epoch = give(k, 'alice', 'Epochrasite Lite', 'battlefield');
    k = drive(settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: epoch }]] })), () => null);
    expect([k.objects[epoch]!.zone, k.objects[epoch]!.counters.time, k.objects[epoch]!.suspended]).toEqual(['exile', 3, true]);

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const theirs = [give(m, 'bob', 'Ogre', 'graveyard'), give(m, 'bob', 'Cub', 'graveyard')];
    const mine = give(m, 'alice', 'Cub', 'graveyard');
    m = settle(act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Conscription Lite', 'hand'), targets: [[{ kind: 'object', object: theirs[0]! }]] }));
    expect([m.objects[theirs[0]!]!.zone, m.objects[theirs[0]!]!.controller, m.objects[theirs[1]!]!.zone, m.objects[mine]!.zone]).toEqual(['battlefield', 'alice', 'exile', 'graveyard']);

    let n = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (const id of [...n.zones.hand.alice!]) moveObject(n, id, 'graveyard', []);
    give(n, 'alice', 'Ogre', 'hand');
    const life = n.players.bob!.life;
    n = act(n, { type: 'cast', player: 'alice', object: give(n, 'alice', 'Cremator Lite', 'hand') });
    n = drive(n, (x) => (x.pending?.kind === 'trigger_targets' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } }) : null));
    expect(life - n.players.bob!.life).toBe(5);
  });
});

describe('staples (slice 265, part 2)', () => {
  it("Track Down, Zurgo Bellstriker, Charging Tuskodon, Crater's Claws, Treasure Hunt", () => {
    for (const name of ['Ogre', 'Salve']) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const top = give(g, 'alice', name, 'library');
      g.zones.library.alice!.splice(g.zones.library.alice!.indexOf(top), 1);
      g.zones.library.alice!.unshift(top);
      const hand = g.zones.hand.alice!.length;
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Track Down Lite', 'hand') });
      g = drive(g, (x) => (x.pending?.kind === 'scry' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'scry', top: [top], bottom: (x.pending as { objects: string[] }).objects.filter((id) => id !== top) } }) : null));
      expect(g.zones.hand.alice!.length - hand).toBe(name === 'Ogre' ? 1 : 0);
    }

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    clearBattlefield(h, 'bob');
    const zurgo = give(h, 'bob', 'Zurgo Lite', 'battlefield');
    const [big, small] = [give(h, 'alice', 'Ogre', 'battlefield', { sick: false }), give(h, 'alice', 'Cub', 'battlefield', { sick: false })];
    h = toAttack(attackWith(h, [big, small]));
    expect(illegal(h, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: zurgo, attacker: big }] } } as never)).toBeTruthy();
    h = act(h, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: zurgo, attacker: small }] } } as never);
    expect(h.combat?.blockers?.[zurgo] ?? Object.keys(h.combat ?? {}).length).toBeTruthy();

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    clearBattlefield(k, 'bob');
    const tusk = give(k, 'alice', 'Tuskodon Lite', 'battlefield', { sick: false });
    const life = k.players.bob!.life;
    k = finishCombat(attackWith(k, [tusk]));
    expect(life - k.players.bob!.life).toBe(6);
    k = drive(toStep(k, 'main2', 'alice'), () => null);
    const life2 = k.players.bob!.life;
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(life2 - k.players.bob!.life).toBe(3);

    for (const ferocious of [false, true]) {
      let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
      clearBattlefield(m, 'alice');
      if (ferocious) give(m, 'alice', 'Ogre', 'battlefield');
      m.players.alice!.pool.R = 1;
      m.players.alice!.pool.C = 2;
      const life3 = m.players.bob!.life;
      m = settle(act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Claws Lite', 'hand'), x: 2, targets: [[{ kind: 'player', player: 'bob' }]] }));
      expect(life3 - m.players.bob!.life).toBe(ferocious ? 4 : 2);
    }

    let n = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const stack = ['Forest', 'Forest', 'Salve', 'Cub'].map((name) => give(n, 'alice', name, 'library'));
    for (const id of [...stack].reverse()) {
      n.zones.library.alice!.splice(n.zones.library.alice!.indexOf(id), 1);
      n.zones.library.alice!.unshift(id);
    }
    n = settle(act(n, { type: 'cast', player: 'alice', object: give(n, 'alice', 'Treasure Hunt Lite', 'hand') }));
    expect(stack.map((id) => n.objects[id]!.zone)).toEqual(['hand', 'hand', 'hand', 'library']);
  });

  it('Cantankerous Keepers, Patient Naturalist, Give // Take, Siege Dragon, Hindervines, Heartless Act, Path to the Festival', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const milled = ['Elf Lite', 'Salve', 'Elf Lite', 'Forest'].map((name) => give(g, 'alice', name, 'library'));
    for (const id of [...milled].reverse()) {
      g.zones.library.alice!.splice(g.zones.library.alice!.indexOf(id), 1);
      g.zones.library.alice!.unshift(id);
    }
    g = drive(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Keepers Lite', 'hand') }), () => null);
    expect(milled.map((id) => g.objects[id]!.zone)).toEqual(['hand', 'graveyard', 'hand', 'graveyard']);

    for (const lands of [true, false]) {
      let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const tops = (lands ? ['Salve', 'Forest', 'Salve'] : ['Salve', 'Salve', 'Salve']).map((name) => give(h, 'alice', name, 'library'));
      for (const id of [...tops].reverse()) {
        h.zones.library.alice!.splice(h.zones.library.alice!.indexOf(id), 1);
        h.zones.library.alice!.unshift(id);
      }
      h = drive(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Naturalist Lite', 'hand') }), () => null);
      const treasures = h.zones.battlefield.filter((id) => h.objects[id]!.token).length;
      expect([lands ? h.objects[tops[1]!]!.zone : 'hand', treasures]).toEqual(['hand', lands ? 0 : 1]);
    }

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const fat = give(k, 'alice', 'Cub', 'battlefield');
    k.objects[fat]!.counters['+1/+1'] = 3;
    const hand = k.zones.hand.alice!.length;
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Take Lite', 'hand'), targets: [[{ kind: 'object', object: fat }]] }));
    expect([k.zones.hand.alice!.length - hand, k.objects[fat]!.counters['+1/+1'] ?? 0]).toEqual([3, 0]);

    for (const wall of [false, true]) {
      let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
      clearBattlefield(m, 'bob');
      const dragon = give(m, 'alice', 'Siege Dragon Lite', 'battlefield', { sick: false });
      const [ground, flyer] = [give(m, 'bob', 'Cub', 'battlefield'), give(m, 'bob', 'Bird Lite', 'battlefield')];
      if (wall) give(m, 'bob', 'Wall Lite', 'battlefield');
      m = toAttack(attackWith(m, [dragon]));
      expect([m.objects[ground]!.zone, m.objects[flyer]!.zone]).toEqual([wall ? 'battlefield' : 'graveyard', 'battlefield']);
    }

    let n = toStep(start({ extra: CARDS }), 'main1', 'alice');
    clearBattlefield(n, 'bob');
    const [plain, grown] = [give(n, 'alice', 'Ogre', 'battlefield', { sick: false }), give(n, 'alice', 'Ogre', 'battlefield', { sick: false })];
    n.objects[grown]!.counters['+1/+1'] = 1;
    n = settle(act(n, { type: 'cast', player: 'alice', object: give(n, 'alice', 'Hindervines Lite', 'hand') }));
    const life = n.players.bob!.life;
    n = finishCombat(attackWith(n, [plain, grown]));
    expect(life - n.players.bob!.life).toBe(6);

    let q = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [bare, marked] = [give(q, 'bob', 'Ogre', 'battlefield'), give(q, 'bob', 'Ogre', 'battlefield')];
    q.objects[marked]!.counters['+1/+1'] = 1;
    expect(illegal(q, { type: 'cast', player: 'alice', object: give(q, 'alice', 'Heartless Act Lite', 'hand'), modes: [0], targets: [[{ kind: 'object', object: marked }]] })).toBeTruthy();
    q = settle(act(q, { type: 'cast', player: 'alice', object: give(q, 'alice', 'Heartless Act Lite', 'hand'), modes: [0], targets: [[{ kind: 'object', object: bare }]] }));
    expect(q.objects[bare]!.zone).toBe('graveyard');

    let r = toStep(start({ extra: CARDS }), 'main1', 'alice');
    clearBattlefield(r, 'alice');
    r = drive(act(r, { type: 'cast', player: 'alice', object: give(r, 'alice', 'Festival Lite', 'hand') }), (x) => (x.pending?.kind === 'search' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: (x.pending as { candidates: string[] }).candidates.slice(0, 1) } }) : null));
    expect([r.pending?.kind, r.zones.battlefield.filter((id) => r.objects[id]!.controller === 'alice').length]).toEqual([undefined, 1]);
  });
});

describe('staples (slice 266)', () => {
  it('Purity, Form of the Dragon, Mindshrieker, Hundred-Handed One, Splinter, Survival Cache', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Purity Lite', 'battlefield');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] }));
    expect(g.players.alice!.life - life).toBe(3);

    let h = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(h, 'alice', 'Form Lite', 'battlefield');
    const [walker, flyer] = [give(h, 'bob', 'Ogre', 'battlefield', { sick: false }), give(h, 'bob', 'Bird Lite', 'battlefield', { sick: false })];
    const q = toAttack(toStep(h, 'beginning_of_combat'));
    expect(illegal(q, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: walker, target: { kind: 'player', player: 'alice' } }] } })).toBeTruthy();
    h = act(q, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: flyer, target: { kind: 'player', player: 'alice' } }] } });
    expect(h.combat?.attackers[flyer]).toBeTruthy();

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const shrieker = give(k, 'alice', 'Mindshrieker Lite', 'battlefield');
    const top = give(k, 'bob', 'Ogre Three', 'library');
    k.zones.library.bob!.splice(k.zones.library.bob!.indexOf(top), 1);
    k.zones.library.bob!.unshift(top);
    k = settle(act(k, { type: 'activate', player: 'alice', object: shrieker, ability: 0, targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect([k.objects[top]!.zone, chars(k, k.objects[shrieker]!).power]).toEqual(['graveyard', 4]);

    let m = toStep(start({ extra: CARDS }), 'main1', 'bob');
    clearBattlefield(m, 'alice');
    const giant = give(m, 'alice', 'Hundred Lite', 'battlefield');
    m.objects[giant]!.monstrous = true;
    const raiders = [give(m, 'bob', 'Bird Lite', 'battlefield', { sick: false }), give(m, 'bob', 'Cub', 'battlefield', { sick: false }), give(m, 'bob', 'Cub', 'battlefield', { sick: false })];
    m = toAttack(toStep(m, 'beginning_of_combat'));
    m = act(m, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: raiders.map((attacker) => ({ attacker, target: { kind: 'player' as const, player: 'alice' } })) } });
    m = toAttack(m);
    m = act(m, { type: 'choose', player: 'alice', answer: { kind: 'declare_blockers', blocks: raiders.map((attacker) => ({ blocker: giant, attacker })) } } as never);
    m = finishCombat(m);
    expect(raiders.map((id) => m.objects[id]!.zone)).toEqual(['graveyard', 'graveyard', 'graveyard']);

    let n = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const splinter = give(n, 'alice', 'Splinter Lite', 'battlefield');
    const [ha, hb] = [n.zones.hand.alice!.length, n.zones.hand.bob!.length];
    n = act(n, { type: 'cast', player: 'alice', object: give(n, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: splinter }]] });
    n = drive(n, (x) => (x.pending?.kind === 'trigger_targets' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } }) : null));
    expect([n.zones.hand.alice!.length - ha, n.zones.hand.bob!.length - hb]).toEqual([1, 1]);

    for (const ahead of [true, false]) {
      let p = toStep(start({ extra: CARDS }), 'main1', 'alice');
      p.players.bob!.life = ahead ? 20 : 30;
      const hand = p.zones.hand.alice!.length;
      p = settle(act(p, { type: 'cast', player: 'alice', object: give(p, 'alice', 'Cache Lite', 'hand') }));
      expect(p.zones.hand.alice!.length - hand).toBe(ahead ? 1 : 0);
    }
  });

  it("Midnight Mangler, Shadowborn Demon, Fiery Encore, Enchanted River's Grasp", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mangler = give(g, 'alice', 'Mangler Lite', 'battlefield');
    expect(chars(g, g.objects[mangler]!).types.includes('Creature')).toBe(false);
    g = drive(toStep(g, 'main1', 'bob'), () => null);
    const mc = chars(g, g.objects[mangler]!);
    expect([mc.types.includes('Creature'), mc.power]).toEqual([true, 4]);

    let h = toStep(start({ extra: CARDS }), 'end', 'bob');
    give(h, 'alice', 'Shadowborn Lite', 'battlefield');
    const victim = give(h, 'alice', 'Cub', 'battlefield');
    h = drive(toStep(h, 'upkeep', 'alice'), (x) => (x.pending?.kind === 'sacrifice' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'sacrifice', objects: [victim] } }) : null));
    h = settle(h);
    expect(h.objects[victim]!.zone).toBe('graveyard');

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (const id of [...k.zones.hand.alice!]) moveObject(k, id, 'graveyard', []);
    const fuel = give(k, 'alice', 'Ogre Three', 'hand');
    const prey = give(k, 'bob', 'Ogre Three', 'battlefield');
    k = act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Encore Lite', 'hand') });
    k = drive(k, (x) => (x.pending?.kind === 'trigger_targets' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: prey }]] } }) : null));
    expect([k.objects[fuel]!.zone, k.objects[prey]!.zone, k.zones.hand.alice!.length]).toEqual(['graveyard', 'graveyard', 1]);
    let k2 = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (const id of [...k2.zones.hand.alice!]) moveObject(k2, id, 'graveyard', []);
    k2 = drive(act(k2, { type: 'cast', player: 'alice', object: give(k2, 'alice', 'Encore Lite', 'hand') }), () => null);
    expect(k2.zones.hand.alice!.length).toBe(1);

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const host = give(m, 'bob', 'Guide Lite', 'battlefield');
    m.objects[host]!.counters['+1/+1'] = 2;
    m = settle(act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Grasp River Lite', 'hand'), targets: [[{ kind: 'object', object: host }]] }));
    m = settle(m);
    expect([m.objects[host]!.tapped, m.objects[host]!.counters['+1/+1'] ?? 0, chars(m, m.objects[host]!).keywords.length]).toEqual([true, 0, 0]);
  });
});

describe('staples (slice 266, part 2)', () => {
  it('Echoing Ruin, Hedron Matrix, Grey Knight Paragon, Blast of Genius', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const swords = [give(g, 'bob', 'Heavy Sword', 'battlefield'), give(g, 'bob', 'Heavy Sword', 'battlefield'), give(g, 'alice', 'Heavy Sword', 'battlefield')];
    const other = give(g, 'bob', 'Matrix Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ruin Lite', 'hand'), targets: [[{ kind: 'object', object: swords[0]! }]] }));
    expect([...swords.map((id) => g.objects[id]!.zone), g.objects[other]!.zone]).toEqual(['graveyard', 'graveyard', 'graveyard', 'battlefield']);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const matrix = give(h, 'alice', 'Matrix Lite', 'battlefield');
    const ogre = give(h, 'alice', 'Ogre Three', 'battlefield');
    h = settle(act(h, { type: 'activate', player: 'alice', object: matrix, ability: 0, targets: [[{ kind: 'object', object: ogre }]] }));
    expect(chars(h, h.objects[ogre]!).power).toBe(6);

    for (const name of ['Demon Lite', 'Ogre']) {
      let k = toStep(start({ extra: CARDS }), 'main1', 'bob');
      clearBattlefield(k, 'alice');
      const atk = give(k, 'bob', name, 'battlefield', { sick: false });
      k = toAttack(toStep(k, 'beginning_of_combat'));
      k = act(k, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: atk, target: { kind: 'player', player: 'alice' } }] } });
      k = act(k, { type: 'pass', player: 'bob' });
      k = act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Paragon Lite', 'hand') });
      k = drive(k, (x) => (x.pending?.kind === 'trigger_targets' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: atk }]] } }) : null));
      expect(k.objects[atk]!.zone).toBe(name === 'Demon Lite' ? 'exile' : 'graveyard');
    }

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const keep = give(m, 'alice', 'Ogre Three', 'hand');
    const life = m.players.bob!.life;
    m = act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Genius Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] });
    m = drive(m, (x) => (x.pending?.kind === 'discard' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: [keep] } }) : null));
    expect(life - m.players.bob!.life).toBe(3);
  });
});
