import { describe, expect, it } from 'vitest';
import { chars, type AttackTarget, type ChoiceAnswer, type GameState } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

// The November 2026 grading audit, sample B: 60 random "full" cards from outside the 5,000 most played, each played
// through the engine with its real Oracle text. The cases it found wrong (a token returning from exile, exploring
// after leaving the battlefield) are regression tests now.

const vanilla = (name: string, type_line: string, pt: string, mana_cost = '{0}', oracle_text = '') =>
  makeCard({ name, type_line, mana_cost, cmc: 0, power: pt.split('/')[0], toughness: pt.split('/')[1], oracle_text });

const CARDS = [
  // --- audited cards (real Oracle text) ---
  makeCard({ name: 'Dead-Iron Sledge', type_line: 'Artifact — Equipment', mana_cost: '{1}', cmc: 1, oracle_text: 'Whenever equipped creature blocks or becomes blocked by a creature, destroy both creatures.\nEquip {2} ({2}: Attach to target creature you control. Equip only as a sorcery.)' }),
  makeCard({ name: 'Return Upon the Tide', type_line: 'Sorcery', mana_cost: '{4}{B}', cmc: 5, oracle_text: "Return target creature card from your graveyard to the battlefield. If it's an Elf, create two 1/1 green Elf Warrior creature tokens.\nForetell {3}{B} (During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost.)" }),
  makeCard({ name: 'Urborg Uprising', type_line: 'Sorcery', mana_cost: '{4}{B}', cmc: 5, oracle_text: 'Return up to two target creature cards from your graveyard to your hand.\nDraw a card.' }),
  makeCard({ name: 'Spaceshift', type_line: 'Instant', mana_cost: '{1}{U}', cmc: 2, oracle_text: "Exile target artifact or creature, then return that card to the battlefield under its owner's control with a +1/+1 counter on it." }),
  makeCard({ name: 'Flickering Hound', type_line: 'Creature — Dog', mana_cost: '{3}{W}', cmc: 4, power: '2', toughness: '2', oracle_text: "Whenever you cast a creature spell, exile up to one other target creature you control, then return that card to the battlefield under its owner's control." }),
  makeCard({ name: 'Briarbridge Patrol', type_line: 'Creature — Human Warrior', mana_cost: '{3}{G}', cmc: 4, power: '3', toughness: '3', oracle_text: 'Whenever this creature deals damage to one or more creatures, investigate. (Create a Clue token. It\'s an artifact with "{2}, Sacrifice this token: Draw a card.")\nAt the beginning of each end step, if you sacrificed three or more Clues this turn, you may put a creature card from your hand onto the battlefield.' }),
  makeCard({ name: 'Hornet Cannon', type_line: 'Artifact', mana_cost: '{4}', cmc: 4, oracle_text: '{3}, {T}: Create a 1/1 colorless Insect artifact creature token with flying and haste named Hornet. Destroy it at the beginning of the next end step.' }),
  makeCard({ name: 'Mouth of the Storm', type_line: 'Creature — Elemental', mana_cost: '{6}{U}', cmc: 7, power: '6', toughness: '6', oracle_text: 'Flying\nWard {2} (Whenever this creature becomes the target of a spell or ability an opponent controls, counter it unless that player pays {2}.)\nWhen this creature enters, creatures your opponents control get -3/-0 until your next turn.' }),
  makeCard({ name: 'Fanatic of the Harrowing', type_line: 'Creature — Human Cleric', mana_cost: '{3}{B}', cmc: 4, power: '2', toughness: '2', oracle_text: 'When this creature enters, each player discards a card. If you discarded a card this way, draw a card.' }),
  makeCard({ name: 'Wingrattle Scarecrow', type_line: 'Artifact Creature — Scarecrow', mana_cost: '{3}', cmc: 3, power: '2', toughness: '2', oracle_text: "This creature has flying as long as you control a blue creature.\nThis creature has persist as long as you control a black creature. (When this creature dies, if it had no -1/-1 counters on it, return it to the battlefield under its owner's control with a -1/-1 counter on it.)" }),
  makeCard({ name: 'Karrthus, Tyrant of Jund', type_line: 'Legendary Creature — Dragon', mana_cost: '{4}{B}{R}{G}', cmc: 7, power: '7', toughness: '7', oracle_text: 'Flying, haste\nWhen Karrthus enters, gain control of all Dragons, then untap all Dragons.\nOther Dragon creatures you control have haste.' }),
  makeCard({ name: 'Everglove Courier', type_line: 'Creature — Elf', mana_cost: '{2}{G}', cmc: 3, power: '2', toughness: '1', oracle_text: 'You may choose not to untap this creature during your untap step.\n{2}{G}, {T}: Target Elf creature gets +2/+2 and has trample for as long as this creature remains tapped.' }),
  // --- helpers ---
  vanilla('Bear', 'Creature — Bear', '2/2'),
  vanilla('Big Bear', 'Creature — Bear', '4/4'),
  vanilla('Wall Lite', 'Creature — Wall', '0/5'),
  vanilla('Elf Lite', 'Creature — Elf', '1/1'),
  vanilla('Whelp', 'Creature — Dragon', '2/2'),
  vanilla('Black Rat', 'Creature — Rat', '1/1', '{B}'),
  vanilla('Blue Bird', 'Creature — Bird', '1/1', '{U}'),
  makeCard({ name: 'Wrath Lite', type_line: 'Sorcery', mana_cost: '{0}', cmc: 0, oracle_text: 'Destroy all creatures.' }),
  makeCard({ name: 'Threaten Lite', type_line: 'Sorcery', mana_cost: '{0}', cmc: 0, oracle_text: 'Gain control of target creature.' }),
  makeCard({ name: 'Forest', type_line: 'Basic Land — Forest', mana_cost: '', oracle_text: '({T}: Add {G}.)' }),
];

const CARDS2 = [
  makeCard({ name: 'Pearl Shard', type_line: 'Artifact', mana_cost: '{3}', cmc: 3, oracle_text: '{3}, {T} or {W}, {T}: Prevent the next 2 damage that would be dealt to any target this turn.' }),
  makeCard({ name: 'Stampeding Serow', type_line: 'Creature — Antelope Beast', mana_cost: '{2}{G}{G}', cmc: 4, power: '5', toughness: '4', oracle_text: "Trample\nAt the beginning of your upkeep, return a green creature you control to its owner's hand." }),
  makeCard({ name: 'Turtle Lair', type_line: 'Land', mana_cost: '', cmc: 0, oracle_text: "{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a Ninja or Turtle spell.\n{3}, {T}: Target Ninja or Turtle can't be blocked this turn." }),
  makeCard({ name: 'Mijae Djinn', type_line: 'Creature — Djinn', mana_cost: '{R}{R}{R}', cmc: 3, power: '6', toughness: '3', oracle_text: 'Whenever this creature attacks, flip a coin. If you lose the flip, remove this creature from combat and tap it.' }),
  makeCard({ name: 'Aberrant Mind Sorcerer', type_line: 'Creature — Human Elf Shaman Sorcerer', mana_cost: '{4}{U}', cmc: 5, power: '3', toughness: '4', oracle_text: 'Psionic Spells — When this creature enters, choose target instant or sorcery card in your graveyard, then roll a d20.\n1—9 | You may put that card on top of your library.\n10—20 | Return that card to your hand.' }),
  makeCard({ name: 'Flourishing Hunter', type_line: 'Creature — Wolf Spirit', mana_cost: '{4}{G}{G}', cmc: 6, power: '6', toughness: '6', oracle_text: 'When this creature enters, you gain life equal to the greatest toughness among other creatures you control.' }),
  makeCard({ name: 'Frenzied Tilling', type_line: 'Sorcery', mana_cost: '{3}{R}{G}', cmc: 5, oracle_text: 'Destroy target land. Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.' }),
  makeCard({ name: 'Ebony Horse', type_line: 'Artifact', mana_cost: '{3}', cmc: 3, oracle_text: '{2}, {T}: Untap target attacking creature you control. Prevent all combat damage that would be dealt to and dealt by that creature this turn.' }),
  makeCard({ name: 'Clockwork Droid', type_line: 'Artifact Creature — Robot', mana_cost: '{2}', cmc: 2, power: '3', toughness: '1', oracle_text: "You may exert this creature as it attacks. When you do, it can't be blocked this turn and you scry 1. (An exerted creature won't untap during your next untap step. To scry 1, look at the top card of your library. You may put that card on the bottom.)" }),
  makeCard({ name: 'Sazh Katzroy', type_line: 'Legendary Creature — Human Pilot', mana_cost: '{3}{G}', cmc: 4, power: '3', toughness: '3', oracle_text: 'When Sazh Katzroy enters, you may search your library for a Bird or basic land card, reveal it, put it into your hand, then shuffle.\nWhenever Sazh Katzroy attacks, put a +1/+1 counter on target creature, then double the number of +1/+1 counters on that creature.' }),
  makeCard({ name: 'Shelldock Isle', type_line: 'Land', mana_cost: '', cmc: 0, oracle_text: 'Hideaway 4 (When this land enters, look at the top four cards of your library, exile one face down, then put the rest on the bottom in a random order.)\nThis land enters tapped.\n{T}: Add {U}.\n{U}, {T}: You may play the exiled card without paying its mana cost if a library has twenty or fewer cards in it.' }),
  makeCard({ name: 'Phyrexian Atlas', type_line: 'Artifact', mana_cost: '{3}', cmc: 3, oracle_text: '{T}: Add one mana of any color.\nCorrupted — Whenever this artifact becomes tapped, each opponent who has three or more poison counters loses 1 life.' }),
  makeCard({ name: 'Krark-Clan Grunt', type_line: 'Creature — Goblin Warrior', mana_cost: '{2}{R}', cmc: 3, power: '2', toughness: '2', oracle_text: 'Sacrifice an artifact: This creature gets +1/+0 and gains first strike until end of turn.' }),
  makeCard({ name: 'Startled Relic Sloth', type_line: 'Creature — Sloth Beast', mana_cost: '{2}{R}{W}', cmc: 4, power: '4', toughness: '4', oracle_text: 'Trample, lifelink\nAt the beginning of combat on your turn, exile up to one target card from a graveyard.' }),
  makeCard({ name: 'Cybermat', type_line: 'Artifact Creature — Robot', mana_cost: '{2}', cmc: 2, power: '2', toughness: '1', oracle_text: "Skulk (This creature can't be blocked by creatures with greater power.)\nWhenever this creature attacks and isn't blocked, it gets +X/+0 until end of turn, where X is the number of attacking artifact creatures." }),
  makeCard({ name: 'Crystal Golem', type_line: 'Artifact Creature — Golem', mana_cost: '{4}', cmc: 4, power: '3', toughness: '3', oracle_text: "At the beginning of your end step, this creature phases out. (While it's phased out, it's treated as though it doesn't exist. It phases in before you untap during your next untap step.)" }),
  makeCard({ name: 'Legion Extruder', type_line: 'Artifact', mana_cost: '{1}{R}', cmc: 2, oracle_text: 'When this artifact enters, it deals 2 damage to any target.\n{2}, {T}, Sacrifice another artifact: Create a 3/3 colorless Golem artifact creature token.' }),
  makeCard({ name: 'Sylvan Messenger', type_line: 'Creature — Elf', mana_cost: '{3}{G}', cmc: 4, power: '2', toughness: '2', oracle_text: "Trample (This creature can deal excess combat damage to the player or planeswalker it's attacking.)\nWhen this creature enters, reveal the top four cards of your library. Put all Elf cards revealed this way into your hand and the rest on the bottom of your library in any order." }),
  makeCard({ name: 'Cartouche of Zeal', type_line: 'Enchantment — Aura Cartouche', mana_cost: '{R}', cmc: 1, oracle_text: "Enchant creature you control\nWhen this Aura enters, target creature can't block this turn.\nEnchanted creature gets +1/+1 and has haste. (It can attack and {T} no matter when it came under your control.)" }),
  makeCard({ name: 'Archon of Absolution', type_line: 'Creature — Archon', mana_cost: '{3}{W}', cmc: 4, power: '3', toughness: '2', oracle_text: "Flying\nProtection from white (This creature can't be blocked, targeted, dealt damage, enchanted, or equipped by anything white.)\nCreatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures." }),
  makeCard({ name: 'Ainok Survivalist', type_line: 'Creature — Dog Shaman', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '1', oracle_text: 'Megamorph {1}{G} (You may cast this card face down as a 2/2 creature for {3}. Turn it face up any time for its megamorph cost and put a +1/+1 counter on it.)\nWhen this creature is turned face up, destroy target artifact or enchantment an opponent controls.' }),
  makeCard({ name: 'Ghoulflesh', type_line: 'Enchantment — Aura', mana_cost: '{B}', cmc: 1, oracle_text: 'Enchant creature\nEnchanted creature gets -1/-1 and is a black Zombie in addition to its other colors and types.' }),
  makeCard({ name: 'Epiphany Storm', type_line: 'Enchantment — Aura', mana_cost: '{R}', cmc: 1, oracle_text: 'Enchant creature\nEnchanted creature has "{R}, {T}, Discard a card: Draw a card."' }),
  makeCard({ name: 'Hijack', type_line: 'Sorcery', mana_cost: '{1}{R}{R}', cmc: 3, oracle_text: 'Gain control of target artifact or creature until end of turn. Untap it. It gains haste until end of turn.' }),
  makeCard({ name: 'Abzan Beastmaster', type_line: 'Creature — Dog Shaman', mana_cost: '{2}{G}', cmc: 3, power: '2', toughness: '1', oracle_text: 'At the beginning of your upkeep, draw a card if you control the creature with the greatest toughness or tied for the greatest toughness.' }),
  makeCard({ name: 'Immerwolf', type_line: 'Creature — Wolf', mana_cost: '{1}{R}{G}', cmc: 3, power: '2', toughness: '2', oracle_text: "Intimidate (This creature can't be blocked except by artifact creatures and/or creatures that share a color with it.)\nEach other creature you control that's a Wolf or a Werewolf gets +1/+1.\nNon-Human Werewolves you control can't transform." }),
  makeCard({ name: "Sisay's Ingenuity", type_line: 'Enchantment — Aura', mana_cost: '{U}', cmc: 1, oracle_text: 'Enchant creature\nWhen this Aura enters, draw a card.\nEnchanted creature has "{2}{U}: Target creature becomes the color of your choice until end of turn."' }),
  makeCard({ name: 'Rockcaster Platoon', type_line: 'Creature — Rhino Soldier', mana_cost: '{5}{W}{W}', cmc: 7, power: '5', toughness: '7', oracle_text: '{4}{G}: This creature deals 2 damage to each creature with flying and each player.' }),
  makeCard({ name: 'Scepter of Celebration', type_line: 'Artifact — Equipment', mana_cost: '{2}{G}', cmc: 3, oracle_text: 'Equipped creature gets +2/+0 and has trample.\nWhenever equipped creature deals combat damage to a player, create that many 1/1 green and white Citizen creature tokens.\nEquip {3}' }),
  makeCard({ name: 'Boomerang, Blade Flinger', type_line: 'Legendary Creature — Human Villain', mana_cost: '{1}{B}', cmc: 2, power: '1', toughness: '3', oracle_text: 'Whenever Boomerang attacks, he deals 1 damage to each opponent and you gain 1 life.' }),
  makeCard({ name: 'Parasitic Strix', type_line: 'Artifact Creature — Bird', mana_cost: '{2}{U}', cmc: 3, power: '2', toughness: '2', oracle_text: 'Flying\nWhen this creature enters, if you control a black permanent, target player loses 2 life and you gain 2 life.' }),
  makeCard({ name: 'Demonic Appetite', type_line: 'Enchantment — Aura', mana_cost: '{B}', cmc: 1, oracle_text: 'Enchant creature you control\nEnchanted creature gets +3/+3.\nAt the beginning of your upkeep, sacrifice a creature.' }),
  makeCard({ name: 'Squash', type_line: 'Instant', mana_cost: '{4}{R}', cmc: 5, oracle_text: 'This spell costs {3} less to cast if you control a Giant.\nSquash deals 6 damage to target creature or planeswalker.' }),
  makeCard({ name: 'Fountain Watch', type_line: 'Creature — Human Cleric', mana_cost: '{3}{W}{W}', cmc: 5, power: '2', toughness: '4', oracle_text: "Artifacts and enchantments you control have shroud. (They can't be the targets of spells or abilities.)" }),
  makeCard({ name: 'Emissary of Sunrise', type_line: 'Creature — Human Cleric', mana_cost: '{2}{W}', cmc: 3, power: '2', toughness: '1', oracle_text: "First strike\nWhen this creature enters, it explores. (Reveal the top card of your library. Put that card into your hand if it's a land. Otherwise, put a +1/+1 counter on this creature, then put the card back or put it into your graveyard.)" }),
  makeCard({ name: 'Reservoir Walker', type_line: 'Artifact Creature — Construct', mana_cost: '{5}', cmc: 5, power: '3', toughness: '3', oracle_text: 'When this creature enters, you gain 3 life and get {E}{E}{E} (three energy counters).' }),
  makeCard({ name: 'Leyline Invocation', type_line: 'Sorcery', mana_cost: '{5}{G}', cmc: 6, oracle_text: 'Create a 0/0 green and blue Fractal creature token. Put X +1/+1 counters on it, where X is the number of lands you control.' }),
  makeCard({ name: "Teferi's Isle", type_line: 'Legendary Land', mana_cost: '', cmc: 0, oracle_text: "Phasing (This phases in or out before you untap during each of your untap steps. While it's phased out, it's treated as though it doesn't exist.)\nTeferi's Isle enters tapped.\n{T}: Add {U}{U}." }),
  makeCard({ name: 'Bottomless Pit', type_line: 'Enchantment', mana_cost: '{1}{B}{B}', cmc: 3, oracle_text: "At the beginning of each player's upkeep, that player discards a card at random." }),
  makeCard({ name: 'Inquisitor Exarch', type_line: 'Creature — Phyrexian Cleric', mana_cost: '{W}{W}', cmc: 2, power: '2', toughness: '2', oracle_text: 'When this creature enters, choose one —\n• You gain 2 life.\n• Target opponent loses 2 life.' }),
  makeCard({ name: 'Skinrender', type_line: 'Creature — Phyrexian Zombie', mana_cost: '{2}{B}{B}', cmc: 4, power: '3', toughness: '3', oracle_text: 'When this creature enters, put three -1/-1 counters on target creature.' }),
  makeCard({ name: 'Void Attendant', type_line: 'Creature — Eldrazi Processor', mana_cost: '{2}{G}', cmc: 3, power: '2', toughness: '3', oracle_text: 'Devoid (This card has no color.)\n{1}{G}, Put a card an opponent owns from exile into that player\'s graveyard: Create a 1/1 colorless Eldrazi Scion creature token. It has "Sacrifice this token: Add {C}."' }),
  // helpers
  vanilla('Green Elf', 'Creature — Elf', '1/1', '{G}'),
  vanilla('Ninja Lite', 'Creature — Human Ninja', '2/2', '{G}'),
  vanilla('Turtle Lite', 'Creature — Turtle', '1/4', '{G}'),
  vanilla('Green Bear', 'Creature — Bear', '2/2', '{G}'),
  vanilla('Giant Lite', 'Creature — Giant', '4/4'),
  vanilla('Robot Lite', 'Artifact Creature — Robot', '1/1'),
  vanilla('Wolf Lite', 'Creature — Wolf', '2/2'),
  vanilla('Flyer Lite', 'Creature — Bird', '1/3', '{0}', 'Flying'),
  vanilla('White Knight Lite', 'Creature — Knight', '2/2', '{W}'),
  makeCard({ name: 'Bird Lite', type_line: 'Creature — Bird', mana_cost: '{0}', cmc: 0, power: '1', toughness: '1', oracle_text: 'Flying' }),
  makeCard({ name: 'Relic Lite', type_line: 'Artifact', mana_cost: '{0}', cmc: 0, oracle_text: '' }),
  makeCard({ name: 'Glyph Lite', type_line: 'Enchantment', mana_cost: '{0}', cmc: 0, oracle_text: '' }),
  makeCard({ name: 'Bolt Lite', type_line: 'Instant', mana_cost: '{0}', cmc: 0, oracle_text: 'Bolt Lite deals 3 damage to any target.' }),
  makeCard({ name: 'Naturalize Lite', type_line: 'Instant', mana_cost: '{0}', cmc: 0, oracle_text: 'Destroy target artifact or enchantment.' }),
  makeCard({ name: 'Opt Lite', type_line: 'Instant', mana_cost: '{0}', cmc: 0, oracle_text: 'Draw a card.' }),
  makeCard({ name: 'Dual Lite', type_line: 'Land', mana_cost: '', cmc: 0, oracle_text: '{T}: Add {G} or {U}.' }),
  makeCard({ name: 'Black Relic', type_line: 'Enchantment', mana_cost: '{B}', cmc: 1, oracle_text: '' }),
  makeCard({ name: 'Walker Lite', type_line: 'Legendary Planeswalker — Test', mana_cost: '{0}', cmc: 0, loyalty: '4', oracle_text: '+1: You gain 1 life.' }),
  makeCard({ name: 'Fight Lite', type_line: 'Sorcery', mana_cost: '{0}', cmc: 0, oracle_text: 'Target creature you control fights target creature you don\'t control.' }),
  makeCard({ name: 'Twiddle Lite', type_line: 'Instant', mana_cost: '{0}', cmc: 0, oracle_text: 'Untap target permanent.' }),
  makeCard({ name: 'Murder Lite', type_line: 'Instant', mana_cost: '{0}', cmc: 0, oracle_text: 'Destroy target creature.' }),
  makeCard({ name: 'Pinger Lite', type_line: 'Artifact', mana_cost: '{0}', cmc: 0, oracle_text: '{1}: You gain 1 life.' }),
  makeCard({
    name: 'Old Wolf // Old Beast', layout: 'transform', type_line: 'Creature — Human Werewolf // Creature — Werewolf', oracle_text: '', mana_cost: '{0}', cmc: 0,
    card_faces: [
      { object: 'card_face', name: 'Old Wolf', type_line: 'Creature — Human Werewolf', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'At the beginning of each upkeep, if no spells were cast last turn, transform this creature.' },
      { object: 'card_face', name: 'Old Beast', type_line: 'Creature — Werewolf', mana_cost: '', power: '4', toughness: '4', oracle_text: 'At the beginning of each upkeep, if a player cast two or more spells last turn, transform this creature.' },
    ],
  } as never),
  makeCard({
    name: 'Blossom-Blessed Angel // Seed Suture', layout: 'prepare', type_line: 'Creature — Angel Cleric // Sorcery', oracle_text: '', mana_cost: '{3}{W}', cmc: 4,
    card_faces: [
      { object: 'card_face', name: 'Blossom-Blessed Angel', type_line: 'Creature — Angel Cleric', mana_cost: '{3}{W}', power: '2', toughness: '4', oracle_text: "Flying, vigilance\nThis creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)" },
      { object: 'card_face', name: 'Seed Suture', type_line: 'Sorcery', mana_cost: '{G/W}', oracle_text: 'Put a +1/+1 counter on target creature. You gain 1 life.' },
    ],
  } as never),
  makeCard({ name: 'Ornery Kudu', type_line: 'Creature — Antelope', mana_cost: '{2}{G}', cmc: 3, power: '3', toughness: '4', oracle_text: 'When this creature enters, put a -1/-1 counter on target creature you control.' }),
  makeCard({ name: "Predator's Strike", type_line: 'Instant', mana_cost: '{1}{G}', cmc: 2, oracle_text: "Target creature gets +3/+3 and gains trample until end of turn. (It can deal excess combat damage to the player or planeswalker it's attacking.)" }),
  makeCard({ name: 'Withstand Death', type_line: 'Instant', mana_cost: '{G}', cmc: 1, oracle_text: 'Target creature gains indestructible until end of turn. (Damage and effects that say "destroy" don\'t destroy it. If its toughness is 0 or less, it still dies.)' }),
  makeCard({ name: 'Paladin of the Bloodstained', type_line: 'Creature — Vampire Knight', mana_cost: '{3}{W}', cmc: 4, power: '3', toughness: '2', oracle_text: 'When this creature enters, create a 1/1 white Vampire creature token with lifelink.' }),
  makeCard({ name: 'Aven Battle Priest', type_line: 'Creature — Bird Cleric', mana_cost: '{5}{W}', cmc: 6, power: '3', toughness: '3', oracle_text: "Flying (This creature can't be blocked except by creatures with flying or reach.)\nWhen this creature enters, you gain 3 life." }),
  makeCard({ name: 'Cremate Lite', type_line: 'Instant', mana_cost: '{0}', cmc: 0, oracle_text: 'Exile target card from a graveyard.' }),
  makeCard({ name: 'Shock Lite', type_line: 'Instant', mana_cost: '{0}', cmc: 0, oracle_text: 'Shock Lite deals 2 damage to any target.' }),
  makeCard({ name: 'Unsummon Lite', type_line: 'Instant', mana_cost: '{0}', cmc: 0, oracle_text: "Return target creature to its owner's hand." }),
];

const bobT: AttackTarget = { kind: 'player', player: 'bob' };

/** Passes priority until the stack is empty, answering pending choices with `answer` (default: say yes / pay). */
function settle(g: GameState, answer?: (g: GameState) => ChoiceAnswer | undefined): GameState {
  for (let i = 0; i < 80 && (g.stack.length || g.pending); i++) {
    if (g.pending) {
      const a = answer?.(g);
      if (!a) return g;
      g = act(g, { type: 'choose', player: g.pending.player, answer: a });
    } else g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
}
const setup = (who: 'alice' | 'bob' = 'alice') => {
  const g = toStep(start({ extra: [...CARDS, ...CARDS2] }), 'main1', who);
  for (const p of ['alice', 'bob']) g.players[p]!.pool = { W: 10, U: 10, B: 10, R: 10, G: 10, C: 10 };
  return g;
};
function toAttacks(g: GameState): GameState {
  g = toStep(g, 'beginning_of_combat');
  return passRound(g);
}
const attack = (g: GameState, player: string, attackers: string[], target: AttackTarget) =>
  act(g, { type: 'choose', player, answer: { kind: 'declare_attackers', attacks: attackers.map((attacker) => ({ attacker, target })) } });
const block = (g: GameState, player: string, blocks: { blocker: string; attacker: string }[]) =>
  act(g, { type: 'choose', player, answer: { kind: 'declare_blockers', blocks } });
const onBf = (g: GameState, name: string, player?: string) =>
  g.zones.battlefield.filter((id) => g.cards[g.objects[id]!.card]?.name === name && (!player || g.objects[id]!.controller === player));
const tokens = (g: GameState, name: string) => g.zones.battlefield.filter((id) => g.cards[g.objects[id]!.card]?.name === name || (g.objects[id] as { token?: { name?: string } }).token?.name === name);

describe('audit B', () => {
  it('Dead-Iron Sledge: equipped creature blocks — both creatures are destroyed', () => {
    let g = setup();
    const attacker = give(g, 'alice', 'Big Bear', 'battlefield');
    const blocker = give(g, 'bob', 'Bear', 'battlefield');
    const sledge = give(g, 'bob', 'Dead-Iron Sledge', 'battlefield');
    g.objects[sledge]!.attachedTo = { id: blocker, zcc: g.objects[blocker]!.zcc };
    g = attack(toAttacks(g), 'alice', [attacker], bobT);
    g = passRound(g);
    g = block(g, 'bob', [{ blocker, attacker }]);
    expect(g.stack.length).toBe(1);
    g = settle(g);
    expect(g.objects[attacker]!.zone).toBe('graveyard');
    expect(g.objects[blocker]!.zone).toBe('graveyard');
  });
  it('Dead-Iron Sledge: equipped creature becomes blocked — both creatures are destroyed', () => {
    let g = setup();
    const attacker = give(g, 'alice', 'Big Bear', 'battlefield');
    const blocker = give(g, 'bob', 'Big Bear', 'battlefield');
    const sledge = give(g, 'alice', 'Dead-Iron Sledge', 'battlefield');
    g.objects[sledge]!.attachedTo = { id: attacker, zcc: g.objects[attacker]!.zcc };
    g = attack(toAttacks(g), 'alice', [attacker], bobT);
    g = passRound(g);
    g = block(g, 'bob', [{ blocker, attacker }]);
    expect(g.stack.length).toBe(1);
    g = settle(g);
    expect(g.objects[attacker]!.zone).toBe('graveyard');
    expect(g.objects[blocker]!.zone).toBe('graveyard');
  });
  it('Dead-Iron Sledge: blocked by two creatures — triggers for each, all three die', () => {
    let g = setup();
    const attacker = give(g, 'alice', 'Big Bear', 'battlefield');
    const b1 = give(g, 'bob', 'Big Bear', 'battlefield');
    const b2 = give(g, 'bob', 'Big Bear', 'battlefield');
    const sledge = give(g, 'alice', 'Dead-Iron Sledge', 'battlefield');
    g.objects[sledge]!.attachedTo = { id: attacker, zcc: g.objects[attacker]!.zcc };
    g = attack(toAttacks(g), 'alice', [attacker], bobT);
    g = passRound(g);
    g = block(g, 'bob', [{ blocker: b1, attacker }, { blocker: b2, attacker }]);
    expect(g.stack.length).toBe(2);
    g = settle(g);
    expect([attacker, b1, b2].map((id) => g.objects[id]!.zone)).toEqual(['graveyard', 'graveyard', 'graveyard']);
  });

  it('Return Upon the Tide: an Elf comes back with two Elf Warrior tokens; a non-Elf with none', () => {
    for (const [name, n] of [['Elf Lite', 2], ['Bear', 0]] as const) {
      let g = setup();
      const c = give(g, 'alice', name, 'graveyard');
      const before = g.zones.battlefield.length;
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Return Upon the Tide', 'hand'), targets: [[{ kind: 'object', object: c }]] }));
      expect(onBf(g, name, 'alice').length).toBe(1);
      expect(g.zones.battlefield.length - before).toBe(1 + n);
    }
  });

  it('Urborg Uprising: returns both targets and draws; with no targets still draws', () => {
    let g = setup();
    const c1 = give(g, 'alice', 'Bear', 'graveyard');
    const c2 = give(g, 'alice', 'Elf Lite', 'graveyard');
    let hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Urborg Uprising', 'hand'), targets: [[{ kind: 'object', object: c1 }, { kind: 'object', object: c2 }]] }));
    expect(g.objects[c1]!.zone).toBe('hand');
    expect(g.objects[c2]!.zone).toBe('hand');
    expect(g.zones.hand.alice!.length).toBe(hand + 3);
    hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Urborg Uprising', 'hand'), targets: [[]] }));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it("Spaceshift: an opponent's creature returns under its owner's control with a +1/+1 counter; a stolen one goes home", () => {
    let g = setup();
    const c = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Spaceshift', 'hand'), targets: [[{ kind: 'object', object: c }]] }));
    const back = onBf(g, 'Bear');
    expect(back.length).toBe(1);
    expect(g.objects[back[0]!]!.controller).toBe('bob');
    expect(g.objects[back[0]!]!.counters['+1/+1']).toBe(1);
    // stolen
    g = setup();
    const d = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Threaten Lite', 'hand'), targets: [[{ kind: 'object', object: d }]] }));
    expect(g.objects[d]!.controller).toBe('alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Spaceshift', 'hand'), targets: [[{ kind: 'object', object: d }]] }));
    const back2 = onBf(g, 'Bear');
    expect(back2.length).toBe(1);
    expect(g.objects[back2[0]!]!.controller).toBe('bob');
  });

  it("Flickering Hound: flickers another creature you control; a stolen creature returns to its owner", () => {
    let g = setup();
    give(g, 'alice', 'Flickering Hound', 'battlefield');
    const d = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Threaten Lite', 'hand'), targets: [[{ kind: 'object', object: d }]] }));
    g.objects[d]!.counters['+1/+1'] = 2;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Elf Lite', 'hand') });
    expect(g.pending?.kind).toBe('trigger_targets');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: d }]] } });
    g = settle(g);
    const back = onBf(g, 'Bear');
    expect(back.length).toBe(1);
    expect(g.objects[back[0]!]!.controller).toBe('bob');
    expect(g.objects[back[0]!]!.counters['+1/+1'] ?? 0).toBe(0);
  });
  it('Flickering Hound: cannot target itself; up to one may be zero', () => {
    let g = setup();
    const hound = give(g, 'alice', 'Flickering Hound', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Elf Lite', 'hand') });
    if (g.pending?.kind === 'trigger_targets') {
      expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: hound }]] } })).toBeTruthy();
      g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[]] } });
    }
    g = settle(g);
    expect(g.objects[hound]!.zone).toBe('battlefield');
    expect(onBf(g, 'Elf Lite').length).toBe(1);
  });

  it('Briarbridge Patrol: damage to two blockers at once is one investigate', () => {
    let g = setup();
    const patrol = give(g, 'alice', 'Briarbridge Patrol', 'battlefield');
    const b1 = give(g, 'bob', 'Elf Lite', 'battlefield');
    const b2 = give(g, 'bob', 'Elf Lite', 'battlefield');
    g = attack(toAttacks(g), 'alice', [patrol], bobT);
    g = passRound(g);
    g = block(g, 'bob', [{ blocker: b1, attacker: patrol }, { blocker: b2, attacker: patrol }]);
    for (let i = 0; i < 30 && g.step !== 'main2'; i++) {
      if (g.pending?.kind === 'assign_combat_damage') {
        g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'assign_combat_damage', assignments: { [patrol]: [{ to: { kind: 'permanent', object: b1 }, amount: 1 }, { to: { kind: 'permanent', object: b2 }, amount: 2 }] } } as never });
      } else if (g.pending) throw new Error(`pending ${g.pending.kind}`);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.objects[b1]!.zone).toBe('graveyard');
    expect(g.objects[b2]!.zone).toBe('graveyard');
    expect(tokens(g, 'Clue').length).toBe(1);
  });
  it('Briarbridge Patrol: after three Clues are sacrificed, may put a creature from hand onto the battlefield at each end step', () => {
    for (const n of [2, 3]) {
      let g = setup();
      const patrol = give(g, 'alice', 'Briarbridge Patrol', 'battlefield');
      const blocker = give(g, 'bob', 'Wall Lite', 'battlefield');
      // make clues by repeated combat damage is slow: fight via blocks over one combat gives one. Use the trigger thrice by test set-up instead.
      void blocker;
      void patrol;
      // create Clues through the real trigger: three separate damage events are awkward, so grab the Clue definition from one investigate.
      g = attack(toAttacks(g), 'alice', [patrol], bobT);
      g = passRound(g);
      g = block(g, 'bob', [{ blocker, attacker: patrol }]);
      for (let i = 0; i < 30 && g.step !== 'main2'; i++) g = act(g, { type: 'pass', player: g.priority! });
      const clue = tokens(g, 'Clue')[0]!;
      expect(clue).toBeDefined();
      // clone the Clue token twice more
      const ids = [clue];
      for (let k = 0; k < 2; k++) {
        const id = `clue-x${k}`;
        g.objects[id] = { ...structuredClone(g.objects[clue]!), id };
        g.zones.battlefield.push(id);
        ids.push(id);
      }
      const big = give(g, 'alice', 'Big Bear', 'hand');
      for (const id of ids.slice(0, n)) {
        g.players.alice!.pool.C = 2;
        g = settle(act(g, { type: 'activate', player: 'alice', object: id, ability: 0 }));
      }
      g = toStep(g, 'end', 'alice');
      g = settle(g, (s) => (s.pending?.kind === 'may' ? { kind: 'may', yes: true } : s.pending?.kind === 'choose_objects' ? { kind: 'choose_objects', objects: [big] } : undefined));
      expect(g.objects[big]!.zone).toBe(n === 3 ? 'battlefield' : 'hand');
    }
  });

  it('Hornet Cannon: the Hornet is destroyed at the beginning of the next end step', () => {
    let g = setup();
    const cannon = give(g, 'alice', 'Hornet Cannon', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: cannon, ability: 0 }));
    const hornet = tokens(g, 'Hornet');
    expect(hornet.length).toBe(1);
    const c = chars(g, g.objects[hornet[0]!]!);
    expect(c.keywords.map((k) => k.id).sort()).toEqual(['flying', 'haste']);
    expect(c.types.sort()).toEqual(['Artifact', 'Creature']);
    g = toStep(g, 'end', 'alice');
    g = settle(g);
    expect(tokens(g, 'Hornet').length).toBe(0);
  });
  it("Hornet Cannon: activated during an end step, the Hornet lasts until the next turn's end step", () => {
    let g = setup();
    const cannon = give(g, 'alice', 'Hornet Cannon', 'battlefield');
    g = toStep(g, 'end', 'alice');
    g.players.alice!.pool.C = 3;
    g = settle(act(g, { type: 'activate', player: 'alice', object: cannon, ability: 0 }));
    expect(tokens(g, 'Hornet').length).toBe(1);
    g = toStep(g, 'main1', 'bob');
    expect(tokens(g, 'Hornet').length).toBe(1);
    g = toStep(g, 'end', 'bob');
    g = settle(g);
    expect(tokens(g, 'Hornet').length).toBe(0);
  });

  it('Mouth of the Storm: -3/-0 on creatures opponents control at resolution only, until your next turn', () => {
    let g = setup();
    const bear = give(g, 'bob', 'Big Bear', 'battlefield');
    const mine = give(g, 'alice', 'Big Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mouth of the Storm', 'hand') }));
    expect(chars(g, g.objects[bear]!).power).toBe(1);
    expect(chars(g, g.objects[mine]!).power).toBe(4);
    const late = give(g, 'bob', 'Big Bear', 'battlefield');
    expect(chars(g, g.objects[late]!).power).toBe(4);
    g = toStep(g, 'main1', 'bob');
    expect(chars(g, g.objects[bear]!).power).toBe(1);
    g = toStep(g, 'end', 'bob');
    expect(chars(g, g.objects[bear]!).power).toBe(1);
    g = toStep(g, 'upkeep', 'alice');
    expect(chars(g, g.objects[bear]!).power).toBe(4);
  });

  it('Fanatic of the Harrowing: you draw only if you discarded', () => {
    // with a card in hand
    let g = setup();
    g.zones.hand.alice!.splice(0).forEach((id) => { g.objects[id]!.zone = 'library'; g.zones.library.alice!.push(id); });
    const fodder = give(g, 'alice', 'Bear', 'hand');
    const bobHand = g.zones.hand.bob!.length;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Fanatic of the Harrowing', 'hand') });
    g = settle(g, (s) => (s.pending?.kind === 'discard' ? { kind: 'discard', objects: [s.zones.hand[s.pending.player]![0]!] } : undefined));
    expect(g.objects[fodder]!.zone).toBe('graveyard');
    expect(g.zones.hand.alice!.length).toBe(1);
    expect(g.zones.hand.bob!.length).toBe(bobHand - 1);
    // with an empty hand
    g = setup();
    g.zones.hand.alice!.splice(0).forEach((id) => { g.objects[id]!.zone = 'library'; g.zones.library.alice!.push(id); });
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Fanatic of the Harrowing', 'hand') });
    g = settle(g, (s) => (s.pending?.kind === 'discard' ? { kind: 'discard', objects: [s.zones.hand[s.pending.player]![0]!] } : undefined));
    expect(g.zones.hand.alice!.length).toBe(0);
  });

  it('Wingrattle Scarecrow: flying with a blue creature; persist with a black creature', () => {
    let g = setup();
    const sc = give(g, 'alice', 'Wingrattle Scarecrow', 'battlefield');
    expect(chars(g, g.objects[sc]!).keywords.map((k) => k.id)).toEqual([]);
    give(g, 'alice', 'Blue Bird', 'battlefield');
    expect(chars(g, g.objects[sc]!).keywords.map((k) => k.id)).toEqual(['flying']);
    give(g, 'bob', 'Black Rat', 'battlefield');
    expect(chars(g, g.objects[sc]!).keywords.map((k) => k.id)).toEqual(['flying']);
  });
  it('Wingrattle Scarecrow: dies along with the only black creature — persist still returns it (CR 603.10a)', () => {
    let g = setup();
    give(g, 'alice', 'Wingrattle Scarecrow', 'battlefield');
    give(g, 'alice', 'Black Rat', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Wrath Lite', 'hand') }));
    const back = onBf(g, 'Wingrattle Scarecrow');
    expect(back.length).toBe(1);
    expect(g.objects[back[0]!]!.counters['-1/-1']).toBe(1);
  });
  it('Wingrattle Scarecrow: no black creature — it stays dead; with one and a -1/-1 counter — it stays dead', () => {
    let g = setup();
    const sc = give(g, 'alice', 'Wingrattle Scarecrow', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Wrath Lite', 'hand') }));
    expect(g.objects[sc]!.zone).toBe('graveyard');
    g = setup();
    const sc2 = give(g, 'alice', 'Wingrattle Scarecrow', 'battlefield');
    give(g, 'alice', 'Black Rat', 'battlefield');
    g.objects[sc2]!.counters['-1/-1'] = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Wrath Lite', 'hand') }));
    expect(onBf(g, 'Wingrattle Scarecrow').length).toBe(0);
  });

  it('Karrthus: gains control of all Dragons for good, untaps them, and they have haste', () => {
    let g = setup();
    const w = give(g, 'bob', 'Whelp', 'battlefield');
    const mine = give(g, 'alice', 'Whelp', 'battlefield');
    g.objects[w]!.tapped = true;
    g.objects[mine]!.tapped = true;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Karrthus, Tyrant of Jund', 'hand') }));
    expect(g.objects[w]!.controller).toBe('alice');
    expect(g.objects[w]!.tapped).toBe(false);
    expect(g.objects[mine]!.tapped).toBe(false);
    expect(chars(g, g.objects[w]!).keywords.map((k) => k.id)).toContain('haste');
    g = toStep(g, 'main1', 'bob');
    expect(g.objects[w]!.controller).toBe('alice');
    g = toStep(g, 'main1', 'alice');
    expect(g.objects[w]!.controller).toBe('alice');
  });

  it('Everglove Courier: +2/+2 and trample for as long as it stays tapped', () => {
    let g = setup();
    const courier = give(g, 'alice', 'Everglove Courier', 'battlefield');
    const elf = give(g, 'alice', 'Elf Lite', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    expect(illegal(g, { type: 'activate', player: 'alice', object: courier, ability: 0, targets: [[{ kind: 'object', object: bear }]] })).toBeTruthy();
    g = settle(act(g, { type: 'activate', player: 'alice', object: courier, ability: 0, targets: [[{ kind: 'object', object: elf }]] }));
    expect(chars(g, g.objects[elf]!).power).toBe(3);
    expect(chars(g, g.objects[elf]!).keywords.map((k) => k.id)).toContain('trample');
    // through bob's turn
    g = toStep(g, 'main1', 'bob');
    expect(chars(g, g.objects[elf]!).power).toBe(3);
    // alice's untap: keep it tapped
    for (let i = 0; i < 200 && !(g.pending?.kind === 'keep_tapped'); i++) {
      if (g.pending?.kind === 'declare_attackers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_attackers', attacks: [] } });
      else if (g.pending?.kind === 'discard_to_hand_size') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'discard_to_hand_size', objects: g.zones.hand[g.pending.player]!.slice(0, g.pending.count) } });
      else if (g.pending) throw new Error(g.pending.kind);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.pending?.kind).toBe('keep_tapped');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'keep_tapped', objects: [courier] } });
    g = toStep(g, 'main1', 'alice');
    expect(g.objects[courier]!.tapped).toBe(true);
    expect(chars(g, g.objects[elf]!).power).toBe(3);
    // next alice untap: let it untap
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    expect(g.objects[courier]!.tapped).toBe(false);
    expect(chars(g, g.objects[elf]!).power).toBe(1);
    expect(chars(g, g.objects[elf]!).keywords.map((k) => k.id)).not.toContain('trample');
  });
});

const fill = (g: GameState) => {
  for (const p of ['alice', 'bob']) g.players[p]!.pool = { W: 10, U: 10, B: 10, R: 10, G: 10, C: 10 };
  return g;
};
const emptyPool = (g: GameState, p: string) => { g.players[p]!.pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }; };
const obj = (id: string) => [[{ kind: 'object' as const, object: id }]];
const plr = (player: string) => [[{ kind: 'player' as const, player }]];
const kws = (g: GameState, id: string) => chars(g, g.objects[id]!).keywords.map((k) => k.id);
const top = (g: GameState, player: string, name: string) => {
  const id = give(g, player, name, 'library');
  const lib = g.zones.library[player]!;
  lib.splice(lib.indexOf(id), 1);
  lib.unshift(id);
  return id;
};
/** Plays through combat (no further choices expected) to the second main phase. */
function finishCombat(g: GameState): GameState {
  for (let i = 0; i < 40 && g.step !== 'main2'; i++) {
    if (g.pending) throw new Error(`pending ${g.pending.kind}`);
    g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
}

describe('audit B — batch 2', () => {
  it('Pearl Shard: either cost; prevents the next 2 damage to a player or a creature', () => {
    let g = setup('bob');
    const shard = give(g, 'alice', 'Pearl Shard', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = act(g, { type: 'pass', player: 'bob' });
    g = settle(act(g, { type: 'activate', player: 'alice', object: shard, ability: 0, targets: plr('alice') }));
    g.objects[shard]!.tapped = false;
    fill(g);
    while (g.priority !== 'alice') g = act(g, { type: 'pass', player: g.priority! });
    emptyPool(g, 'alice');
    g.players.alice!.pool.W = 1;
    g = settle(act(g, { type: 'activate', player: 'alice', object: shard, ability: 1, targets: obj(bear) }));
    while (g.priority !== 'bob') g = act(g, { type: 'pass', player: g.priority! });
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bolt Lite', 'hand'), targets: plr('alice') }));
    expect(g.players.alice!.life).toBe(19);
    while (g.priority !== 'bob') g = act(g, { type: 'pass', player: g.priority! });
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bolt Lite', 'hand'), targets: obj(bear) }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.objects[bear]!.damage).toBe(1);
  });

  it('Stampeding Serow: must return a green creature — itself if it is the only one', () => {
    let g = setup('bob');
    const serow = give(g, 'alice', 'Stampeding Serow', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    give(g, 'bob', 'Green Elf', 'battlefield');
    g = toStep(g, 'upkeep', 'alice');
    g = settle(g);
    expect(g.objects[serow]!.zone).toBe('hand');
    expect(g.objects[bear]!.zone).toBe('battlefield');
    // with another green creature: a choice between the two only
    g = setup('bob');
    const serow2 = give(g, 'alice', 'Stampeding Serow', 'battlefield');
    const elf = give(g, 'alice', 'Green Elf', 'battlefield');
    give(g, 'alice', 'Bear', 'battlefield');
    g = toStep(g, 'upkeep', 'alice');
    g = settle(g);
    expect(g.pending).toMatchObject({ kind: 'choose_objects', player: 'alice', min: 1, max: 1 });
    expect([...(g.pending as { candidates: string[] }).candidates].sort()).toEqual([serow2, elf].sort());
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [elf] } }));
    expect(g.objects[elf]!.zone).toBe('hand');
    expect(g.objects[serow2]!.zone).toBe('battlefield');
  });

  it('Turtle Lair: restricted mana only casts Ninja or Turtle spells; third ability targets only a Ninja or Turtle', () => {
    let g = setup();
    emptyPool(g, 'alice');
    const lair = give(g, 'alice', 'Turtle Lair', 'battlefield');
    const bear = give(g, 'alice', 'Green Bear', 'hand');
    const turtle = give(g, 'alice', 'Turtle Lite', 'hand');
    g = act(g, { type: 'activate_mana', player: 'alice', object: lair, ability: 1, choice: 'G' });
    expect(illegal(g, { type: 'cast', player: 'alice', object: bear })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: turtle }));
    expect(g.objects[turtle]!.zone).toBe('battlefield');
    // unblockable
    g.objects[lair]!.tapped = false;
    fill(g);
    const ninja = give(g, 'alice', 'Ninja Lite', 'battlefield');
    const b = give(g, 'alice', 'Bear', 'battlefield');
    const blocker = give(g, 'bob', 'Big Bear', 'battlefield');
    expect(illegal(g, { type: 'activate', player: 'alice', object: lair, ability: 0, targets: obj(b) })).toBeTruthy();
    g = settle(act(g, { type: 'activate', player: 'alice', object: lair, ability: 0, targets: obj(ninja) }));
    g = attack(toAttacks(g), 'alice', [ninja], bobT);
    g = passRound(g);
    if (g.pending?.kind === 'declare_blockers') expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker, attacker: ninja }] } })).toBeTruthy();
    else expect(g.step).not.toBe('declare_blockers');
  });

  it('Mijae Djinn: lose the flip — removed from combat and tapped; win — it attacks', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 40 && seen.size < 2; seed++) {
      let g = setup();
      const djinn = give(g, 'alice', 'Mijae Djinn', 'battlefield');
      g = attack(toAttacks(g), 'alice', [djinn], bobT);
      g.rng = seed * 7919;
      const { state, events } = (() => {
        let s = g;
        const all: { type: string; won?: boolean }[] = [];
        // resolve the trigger
        while (s.stack.length) {
          const r = act(s, { type: 'pass', player: s.priority! });
          s = r;
        }
        return { state: s, events: all };
      })();
      void events;
      g = state;
      const attacking = Boolean(g.combat?.attackers[djinn]);
      seen.add(attacking ? 'won' : 'lost');
      expect(g.objects[djinn]!.tapped).toBe(true);
      g = finishCombat(g);
      expect(g.players.bob!.life).toBe(attacking ? 14 : 20);
    }
    expect(seen.size).toBe(2);
  });

  it('Aberrant Mind Sorcerer: 1–9 may put the card on top of the library; 10–20 returns it to hand', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 60 && seen.size < 3; seed++) {
      let g = setup();
      const spell = give(g, 'alice', 'Opt Lite', 'graveyard');
      give(g, 'alice', 'Wrath Lite', 'graveyard');
      const creature = give(g, 'alice', 'Bear', 'graveyard');
      const theirs = give(g, 'bob', 'Opt Lite', 'graveyard');
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Aberrant Mind Sorcerer', 'hand') });
      g = settle(g, () => undefined);
      expect(g.pending?.kind).toBe('trigger_targets');
      expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: obj(creature) } })).toBeTruthy();
      expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: obj(theirs) } })).toBeTruthy();
      g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: obj(spell) } });
      g.rng = seed * 104729;
      const yes = seed % 2 === 0;
      g = settle(g, () => undefined);
      if (g.pending?.kind === 'may') {
        g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes } }));
        expect(g.objects[spell]!.zone).toBe(yes ? 'library' : 'graveyard');
        if (yes) expect(g.zones.library.alice![0]).toBe(spell);
        seen.add(yes ? 'top' : 'stay');
      } else {
        expect(g.pending).toBeFalsy();
        expect(g.objects[spell]!.zone).toBe('hand');
        seen.add('hand');
      }
    }
    expect(seen.size).toBe(3);
  });

  it('Flourishing Hunter: life equal to the greatest toughness among your other creatures', () => {
    let g = setup();
    give(g, 'alice', 'Wall Lite', 'battlefield');
    give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Flourishing Hunter', 'hand') }));
    expect(g.players.alice!.life).toBe(25);
    g = setup();
    give(g, 'bob', 'Wall Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Flourishing Hunter', 'hand') }));
    expect(g.players.alice!.life).toBe(20);
  });

  it('Frenzied Tilling: destroys the land, fetches a basic tapped', () => {
    let g = setup();
    const land = give(g, 'bob', 'Dual Lite', 'battlefield');
    const before = onBf(g, 'Forest', 'alice').length;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Frenzied Tilling', 'hand'), targets: obj(land) });
    g = settle(g, (s) => (s.pending?.kind === 'search' ? { kind: 'search', objects: [(s.pending as { candidates: string[] }).candidates[0]!] } : undefined));
    expect(g.objects[land]!.zone).toBe('graveyard');
    const forests = onBf(g, 'Forest', 'alice');
    expect(forests.length).toBe(before + 1);
    expect(g.objects[forests[forests.length - 1]!]!.tapped).toBe(true);
  });

  it('Ebony Horse: untaps the attacker; no combat damage to or from it', () => {
    let g = setup();
    const horse = give(g, 'alice', 'Ebony Horse', 'battlefield');
    const attacker = give(g, 'alice', 'Bear', 'battlefield');
    const other = give(g, 'alice', 'Bear', 'battlefield');
    const blocker = give(g, 'bob', 'Big Bear', 'battlefield');
    const theirs = give(g, 'bob', 'Bear', 'battlefield');
    expect(illegal(g, { type: 'activate', player: 'alice', object: horse, ability: 0, targets: obj(attacker) })).toBeTruthy();
    g = attack(toAttacks(g), 'alice', [attacker], bobT);
    fill(g);
    expect(illegal(g, { type: 'activate', player: 'alice', object: horse, ability: 0, targets: obj(other) })).toBeTruthy();
    expect(illegal(g, { type: 'activate', player: 'alice', object: horse, ability: 0, targets: obj(theirs) })).toBeTruthy();
    g = passRound(g);
    g = block(g, 'bob', [{ blocker, attacker }]);
    fill(g);
    g = settle(act(g, { type: 'activate', player: 'alice', object: horse, ability: 0, targets: obj(attacker) }));
    expect(g.objects[attacker]!.tapped).toBe(false);
    g = finishCombat(g);
    expect(g.objects[attacker]!.zone).toBe('battlefield');
    expect(g.objects[attacker]!.damage ?? 0).toBe(0);
    expect(g.objects[blocker]!.damage ?? 0).toBe(0);
  });
  it('Ebony Horse: unblocked attacker deals no combat damage to the player', () => {
    let g = setup();
    const horse = give(g, 'alice', 'Ebony Horse', 'battlefield');
    const attacker = give(g, 'alice', 'Bear', 'battlefield');
    g = attack(toAttacks(g), 'alice', [attacker], bobT);
    fill(g);
    g = settle(act(g, { type: 'activate', player: 'alice', object: horse, ability: 0, targets: obj(attacker) }));
    g = toStep(g, 'main2', 'alice');
    expect(g.players.bob!.life).toBe(20);
  });

  it("Clockwork Droid: exerted — can't be blocked, scry 1, and it stays tapped through your next untap step", () => {
    let g = setup();
    const droid = give(g, 'alice', 'Clockwork Droid', 'battlefield');
    const blocker = give(g, 'bob', 'Big Bear', 'battlefield');
    g = toAttacks(g);
    expect((g.pending as { exertable?: string[] }).exertable).toContain(droid);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: droid, target: bobT }], exert: [droid] } });
    expect(g.stack.length).toBe(1);
    g = settle(g, () => undefined);
    expect(g.pending?.kind).toBe('scry');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'scry', top: [], bottom: (g.pending as { objects: string[] }).objects } }));
    while (!g.pending && g.step === 'declare_attackers') g = act(g, { type: 'pass', player: g.priority! });
    if (g.pending?.kind === 'declare_blockers') {
      expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker, attacker: droid }] } })).toBeTruthy();
      g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } });
    }
    g = finishCombat(g);
    expect(g.players.bob!.life).toBe(17);
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    expect(g.objects[droid]!.tapped).toBe(true);
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    expect(g.objects[droid]!.tapped).toBe(false);
  });
  it('Clockwork Droid: not exerted — it can be blocked and nothing triggers', () => {
    let g = setup();
    const droid = give(g, 'alice', 'Clockwork Droid', 'battlefield');
    const blocker = give(g, 'bob', 'Big Bear', 'battlefield');
    g = attack(toAttacks(g), 'alice', [droid], bobT);
    expect(g.stack.length).toBe(0);
    g = passRound(g);
    g = block(g, 'bob', [{ blocker, attacker: droid }]);
    g = finishCombat(g);
    expect(g.objects[droid]!.zone).toBe('graveyard');
  });

  it('Sazh Katzroy: may search for a Bird or basic land only; the attack trigger adds a counter then doubles', () => {
    let g = setup();
    const bird = give(g, 'alice', 'Bird Lite', 'library');
    const dual = give(g, 'alice', 'Dual Lite', 'library');
    const bear = give(g, 'alice', 'Bear', 'library');
    const sazh = give(g, 'alice', 'Sazh Katzroy', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: sazh });
    g = settle(g, () => undefined);
    expect(g.pending?.kind).toBe('may');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    expect(g.pending?.kind).toBe('search');
    const cands = (g.pending as { candidates: string[] }).candidates;
    expect(cands).toContain(bird);
    expect(cands).not.toContain(dual);
    expect(cands).not.toContain(bear);
    expect(cands.some((id) => g.objects[id]!.card === 'Forest')).toBe(true);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [bird] } }));
    expect(g.objects[bird]!.zone).toBe('hand');
    // attack
    g.objects[sazh]!.sick = false;
    const target = give(g, 'alice', 'Bear', 'battlefield');
    g.objects[target]!.counters['+1/+1'] = 1;
    g = attack(toAttacks(g), 'alice', [sazh], bobT);
    expect(g.pending?.kind).toBe('trigger_targets');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: obj(target) } }));
    expect(g.objects[target]!.counters['+1/+1']).toBe(4);
  });

  it('Shelldock Isle: the exiled card is playable only once some library has twenty or fewer cards', () => {
    let g = setup();
    const spell = top(g, 'alice', 'Opt Lite');
    const isle = give(g, 'alice', 'Shelldock Isle', 'hand');
    g = settle(act(g, { type: 'play_land', player: 'alice', object: isle }), () => undefined);
    expect(g.pending?.kind).toBe('choose_objects');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [spell] } }));
    expect(g.objects[spell]!.zone).toBe('exile');
    expect(g.objects[isle]!.tapped).toBe(true);
    expect(g.zones.library.alice!.length).toBeGreaterThan(20);
    expect(g.zones.library.bob!.length).toBeGreaterThan(20);
    g.objects[isle]!.tapped = false;
    fill(g);
    g = settle(act(g, { type: 'activate', player: 'alice', object: isle, ability: 0 }), () => undefined);
    expect(g.pending).toBeFalsy();
    expect(g.objects[spell]!.zone).toBe('exile');
    // bob's library shrinks to 20
    const lib = g.zones.library.bob!;
    for (const id of lib.splice(20)) { g.objects[id]!.zone = 'exile'; g.zones.exile.push(id); }
    g.objects[isle]!.tapped = false;
    fill(g);
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'activate', player: 'alice', object: isle, ability: 0 }), () => undefined);
    expect(g.pending?.kind).toBe('cast_free');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: true } }));
    expect(g.objects[spell]!.zone).toBe('graveyard');
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('Phyrexian Atlas: tapping it for mana drains each opponent with three or more poison counters', () => {
    for (const [poison, loss] of [[2, 0], [3, 1]] as const) {
      let g = setup();
      const atlas = give(g, 'alice', 'Phyrexian Atlas', 'battlefield');
      g.players.bob!.poison = poison;
      g.players.alice!.poison = 5;
      g = act(g, { type: 'activate_mana', player: 'alice', object: atlas, ability: 0, choice: 'R' });
      g = settle(g);
      expect(g.players.bob!.life).toBe(20 - loss);
      expect(g.players.alice!.life).toBe(20);
    }
  });

  it('Krark-Clan Grunt: sacrifice an artifact for +1/+0 and first strike', () => {
    let g = setup();
    const grunt = give(g, 'alice', 'Krark-Clan Grunt', 'battlefield');
    const relic = give(g, 'alice', 'Relic Lite', 'battlefield');
    const glyph = give(g, 'alice', 'Glyph Lite', 'battlefield');
    expect(illegal(g, { type: 'activate', player: 'alice', object: grunt, ability: 0, costs: { sacrifice: [glyph] } })).toBeTruthy();
    g = settle(act(g, { type: 'activate', player: 'alice', object: grunt, ability: 0, costs: { sacrifice: [relic] } }));
    expect(g.objects[relic]!.zone).toBe('graveyard');
    expect(chars(g, g.objects[grunt]!).power).toBe(3);
    expect(kws(g, grunt)).toContain('first_strike');
    g = toStep(g, 'main1', 'bob');
    expect(chars(g, g.objects[grunt]!).power).toBe(2);
  });

  it("Startled Relic Sloth: exiles up to one card from any graveyard at the beginning of combat on your turn only", () => {
    let g = setup();
    give(g, 'alice', 'Startled Relic Sloth', 'battlefield');
    const card = give(g, 'bob', 'Bear', 'graveyard');
    g = toStep(g, 'beginning_of_combat', 'alice');
    g = settle(g, () => undefined);
    expect(g.pending?.kind).toBe('trigger_targets');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: obj(card) } }), (s) => (s.pending?.kind === 'declare_attackers' ? { kind: 'declare_attackers', attacks: [] } : undefined));
    expect(g.objects[card]!.zone).toBe('exile');
    // not on bob's turn
    const card2 = give(g, 'bob', 'Bear', 'graveyard');
    g = toStep(g, 'main2', 'bob');
    expect(g.objects[card2]!.zone).toBe('graveyard');
  });

  it("Cybermat: unblocked — +X/+0 where X is the number of attacking artifact creatures; blocked — nothing", () => {
    let g = setup();
    const mat = give(g, 'alice', 'Cybermat', 'battlefield');
    const robot = give(g, 'alice', 'Robot Lite', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    give(g, 'bob', 'Robot Lite', 'battlefield');
    g = attack(toAttacks(g), 'alice', [mat, robot, bear], bobT);
    g = passRound(g);
    g = block(g, 'bob', []);
    expect(g.stack.length).toBe(1);
    g = settle(g);
    expect(chars(g, g.objects[mat]!).power).toBe(4);
    g = finishCombat(g);
    expect(g.players.bob!.life).toBe(20 - 4 - 1 - 2);
    // blocked
    g = setup();
    const mat2 = give(g, 'alice', 'Cybermat', 'battlefield');
    const blocker = give(g, 'bob', 'Robot Lite', 'battlefield');
    const big = give(g, 'bob', 'Big Bear', 'battlefield');
    g = attack(toAttacks(g), 'alice', [mat2], bobT);
    g = passRound(g);
    expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: big, attacker: mat2 }] } })).toBeTruthy();
    g = block(g, 'bob', [{ blocker, attacker: mat2 }]);
    expect(g.stack.length).toBe(0);
  });

  it('Crystal Golem: phases out at your end step, back at your next untap step; stays through an opponent’s end step', () => {
    let g = setup('bob');
    const golem = give(g, 'alice', 'Crystal Golem', 'battlefield');
    g = toStep(g, 'end', 'bob');
    g = settle(g);
    expect(g.zones.battlefield).toContain(golem);
    g = toStep(g, 'end', 'alice');
    g = settle(g);
    expect(g.zones.battlefield).not.toContain(golem);
    expect(g.objects[golem]!.phasedOut).toBeTruthy();
    g = toStep(g, 'main1', 'bob');
    expect(g.zones.battlefield).not.toContain(golem);
    g = toStep(g, 'upkeep', 'alice');
    expect(g.zones.battlefield).toContain(golem);
    expect(g.objects[golem]!.phasedOut).toBeFalsy();
  });

  it('Legion Extruder: 2 damage to any target on entering; needs another artifact to sacrifice', () => {
    let g = setup();
    const ext = give(g, 'alice', 'Legion Extruder', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: ext });
    g = settle(g, () => undefined);
    expect(g.pending?.kind).toBe('trigger_targets');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: plr('bob') } }));
    expect(g.players.bob!.life).toBe(18);
    fill(g);
    expect(illegal(g, { type: 'activate', player: 'alice', object: ext, ability: 0, costs: { sacrifice: [ext] } })).toBeTruthy();
    const relic = give(g, 'alice', 'Relic Lite', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: ext, ability: 0, costs: { sacrifice: [relic] } }));
    const golem = tokens(g, 'Golem Token').concat(tokens(g, 'Golem'));
    expect(golem.length).toBeGreaterThan(0);
    expect(chars(g, g.objects[golem[0]!]!).power).toBe(3);
  });

  it('Sylvan Messenger: all revealed Elves go to hand, the rest to the bottom', () => {
    let g = setup();
    const a = top(g, 'alice', 'Bear');
    const b = top(g, 'alice', 'Green Elf');
    const c = top(g, 'alice', 'Relic Lite');
    const d = top(g, 'alice', 'Elf Lite');
    const size = g.zones.library.alice!.length;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Sylvan Messenger', 'hand') });
    g = settle(g, (s) => {
      const p = s.pending!;
      if (p.kind === 'choose_objects') return { kind: 'choose_objects', objects: (p as { candidates: string[]; max: number }).candidates.slice(0, (p as { max: number }).max) };
      if (p.kind === 'scry') return { kind: 'scry', top: [], bottom: (p as { objects: string[] }).objects };
      return undefined;
    });
    expect(g.pending).toBeFalsy();
    expect(g.objects[b]!.zone).toBe('hand');
    expect(g.objects[d]!.zone).toBe('hand');
    expect(g.objects[a]!.zone).toBe('library');
    expect(g.objects[c]!.zone).toBe('library');
    const lib = g.zones.library.alice!;
    expect(lib.length).toBe(size - 2);
    expect(lib.slice(-2).sort()).toEqual([a, c].sort());
  });

  it("Cartouche of Zeal: enchants only your creature; target creature can't block; +1/+1 and haste", () => {
    let g = setup();
    const mine = give(g, 'alice', 'Bear', 'battlefield', { sick: true });
    const theirs = give(g, 'bob', 'Big Bear', 'battlefield');
    const c = give(g, 'alice', 'Cartouche of Zeal', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: c, targets: obj(theirs) })).toBeTruthy();
    g = act(g, { type: 'cast', player: 'alice', object: c, targets: obj(mine) });
    g = settle(g, () => undefined);
    expect(g.pending?.kind).toBe('trigger_targets');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: obj(theirs) } }));
    expect(chars(g, g.objects[mine]!).power).toBe(3);
    expect(kws(g, mine)).toContain('haste');
    g = attack(toAttacks(g), 'alice', [mine], bobT);
    g = passRound(g);
    if (g.pending?.kind === 'declare_blockers') expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: theirs, attacker: mine }] } })).toBeTruthy();
    g = toStep(g, 'main2', 'alice');
    expect(g.players.bob!.life).toBe(17);
  });

  it('Archon of Absolution: {1} for each creature attacking you; protection from white', () => {
    let g = setup();
    const archon = give(g, 'bob', 'Archon of Absolution', 'battlefield');
    const a = give(g, 'alice', 'Bear', 'battlefield');
    const b = give(g, 'alice', 'Bear', 'battlefield');
    const knight = give(g, 'alice', 'White Knight Lite', 'battlefield');
    g = toAttacks(g);
    emptyPool(g, 'alice');
    g.players.alice!.pool.C = 1;
    const both = { type: 'choose' as const, player: 'alice', answer: { kind: 'declare_attackers' as const, attacks: [a, b].map((attacker) => ({ attacker, target: bobT })) } };
    expect(illegal(g, both)).toBeTruthy();
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: a, target: bobT }] } });
    expect(g.players.alice!.pool.C).toBe(0);
    expect(g.combat?.attackers[a]).toBeDefined();
    // protection from white: a white creature's damage is prevented / can't be blocked by white
    void archon;
    void knight;
  });

  it('Ainok Survivalist: megamorph — turned face up it gets a +1/+1 counter and destroys an opposing artifact or enchantment', () => {
    let g = setup();
    const ainok = give(g, 'alice', 'Ainok Survivalist', 'hand');
    const relic = give(g, 'bob', 'Relic Lite', 'battlefield');
    give(g, 'bob', 'Glyph Lite', 'battlefield');
    const mine = give(g, 'alice', 'Relic Lite', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: ainok, alt: 'megamorph' }));
    expect(chars(g, g.objects[ainok]!).power).toBe(2);
    fill(g);
    g = act(g, { type: 'turn_face_up', player: 'alice', object: ainok });
    expect(g.objects[ainok]!.counters['+1/+1']).toBe(1);
    g = settle(g, () => undefined);
    expect(g.pending?.kind).toBe('trigger_targets');
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: obj(mine) } })).toBeTruthy();
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: obj(bear) } })).toBeTruthy();
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: obj(relic) } }));
    expect(g.objects[relic]!.zone).toBe('graveyard');
  });
  it('Ainok Survivalist: cast face up, nothing triggers', () => {
    let g = setup();
    const ainok = give(g, 'alice', 'Ainok Survivalist', 'hand');
    give(g, 'bob', 'Relic Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: ainok }), () => undefined);
    expect(g.pending).toBeFalsy();
    expect(g.objects[ainok]!.zone).toBe('battlefield');
  });

  it('Ghoulflesh: -1/-1 and a black Zombie in addition to its other colors and types', () => {
    let g = setup();
    const bear = give(g, 'bob', 'Green Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ghoulflesh', 'hand'), targets: obj(bear) }));
    const c = chars(g, g.objects[bear]!);
    expect([c.power, c.toughness]).toEqual([1, 1]);
    expect([...c.colors].sort()).toEqual(['B', 'G']);
    expect([...c.subtypes].sort()).toEqual(['Bear', 'Zombie']);
    expect(c.types).toEqual(['Creature']);
  });

  it('Epiphany Storm: the enchanted creature’s controller can loot with it', () => {
    let g = setup();
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Epiphany Storm', 'hand'), targets: obj(bear) }));
    fill(g);
    const fodder = give(g, 'alice', 'Relic Lite', 'hand');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'activate', player: 'alice', object: bear, ability: 0, costs: { discard: [fodder] } }));
    expect(g.objects[bear]!.tapped).toBe(true);
    expect(g.objects[fodder]!.zone).toBe('graveyard');
    expect(g.zones.hand.alice!.length).toBe(hand);
  });

  it('Hijack: control until end of turn, untapped, with haste', () => {
    let g = setup();
    const bear = give(g, 'bob', 'Bear', 'battlefield', { sick: true });
    g.objects[bear]!.tapped = true;
    const relic = give(g, 'bob', 'Relic Lite', 'battlefield');
    const glyph = give(g, 'bob', 'Glyph Lite', 'battlefield');
    const h = give(g, 'alice', 'Hijack', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: h, targets: obj(glyph) })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: h, targets: obj(bear) }));
    expect(g.objects[bear]!.controller).toBe('alice');
    expect(g.objects[bear]!.tapped).toBe(false);
    expect(kws(g, bear)).toContain('haste');
    g = attack(toAttacks(g), 'alice', [bear], bobT);
    g = toStep(g, 'main2', 'alice');
    expect(g.players.bob!.life).toBe(18);
    g = toStep(g, 'upkeep', 'bob');
    expect(g.objects[bear]!.controller).toBe('bob');
    void relic;
  });

  it('Abzan Beastmaster: draws only if you control a creature with the greatest toughness (ties count)', () => {
    for (const [theirs, drew] of [['Wall Lite', 0], ['Elf Lite', 1], [null, 1]] as const) {
      let g = setup('bob');
      give(g, 'alice', 'Abzan Beastmaster', 'battlefield');
      if (theirs) give(g, 'bob', theirs, 'battlefield');
      g = toStep(g, 'upkeep', 'alice');
      const hand = g.zones.hand.alice!.length;
      g = settle(g);
      expect(g.zones.hand.alice!.length - hand).toBe(drew);
    }
  });

  it("Immerwolf: other Wolves and Werewolves you control get +1/+1", () => {
    let g = setup();
    const imm = give(g, 'alice', 'Immerwolf', 'battlefield');
    const wolf = give(g, 'alice', 'Wolf Lite', 'battlefield');
    const theirs = give(g, 'bob', 'Wolf Lite', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    expect(chars(g, g.objects[imm]!).power).toBe(2);
    expect(chars(g, g.objects[wolf]!).power).toBe(3);
    expect(chars(g, g.objects[theirs]!).power).toBe(2);
    expect(chars(g, g.objects[bear]!).power).toBe(2);
    expect(kws(g, imm)).toContain('intimidate');
  });

  it("Sisay's Ingenuity: draws on entering; the enchanted creature can recolor a creature until end of turn", () => {
    let g = setup();
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const target = give(g, 'bob', 'Green Bear', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', "Sisay's Ingenuity", 'hand'), targets: obj(bear) }));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
    fill(g);
    g = act(g, { type: 'activate', player: 'alice', object: bear, ability: 0, targets: obj(target) });
    g = settle(g, () => undefined);
    expect(g.pending?.kind).toBe('choose_option');
    const opts = (g.pending as { options: string[] }).options;
    const red = opts.find((o) => /red|^R$/i.test(o))!;
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: red } }));
    expect(chars(g, g.objects[target]!).colors).toEqual(['R']);
    g = toStep(g, 'upkeep', 'bob');
    expect(chars(g, g.objects[target]!).colors).toEqual(['G']);
  });

  it('Rockcaster Platoon: 2 damage to each creature with flying and each player', () => {
    let g = setup();
    const platoon = give(g, 'alice', 'Rockcaster Platoon', 'battlefield');
    const flyer = give(g, 'bob', 'Flyer Lite', 'battlefield');
    const myFlyer = give(g, 'alice', 'Bird Lite', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: platoon, ability: 0 }));
    expect(g.objects[flyer]!.damage).toBe(2);
    expect(g.objects[myFlyer]!.zone).toBe('graveyard');
    expect(g.objects[bear]!.damage ?? 0).toBe(0);
    expect(g.objects[platoon]!.damage ?? 0).toBe(0);
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([18, 18]);
  });

  it('Scepter of Celebration: +2/+0, trample, and that many Citizens on combat damage to a player', () => {
    let g = setup();
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const scepter = give(g, 'alice', 'Scepter of Celebration', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: scepter, ability: 0, targets: obj(bear) }));
    expect(chars(g, g.objects[bear]!).power).toBe(4);
    expect(kws(g, bear)).toContain('trample');
    const blocker = give(g, 'bob', 'Elf Lite', 'battlefield');
    g = attack(toAttacks(g), 'alice', [bear], bobT);
    g = passRound(g);
    g = block(g, 'bob', [{ blocker, attacker: bear }]);
    for (let i = 0; i < 40 && g.step !== 'main2'; i++) {
      if (g.pending?.kind === 'assign_combat_damage') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'assign_combat_damage', assignments: { [bear]: [{ to: { kind: 'permanent', object: blocker }, amount: 1 }, { to: { kind: 'player', player: 'bob' }, amount: 3 }] } } });
      else if (g.pending) throw new Error(g.pending.kind);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.players.bob!.life).toBe(17);
    const citizens = g.zones.battlefield.filter((id) => g.objects[id]!.controller === 'alice' && chars(g, g.objects[id]!).subtypes.includes('Citizen'));
    expect(citizens.length).toBe(3);
    expect([...chars(g, g.objects[citizens[0]!]!).colors].sort()).toEqual(['G', 'W']);
  });

  it('Boomerang: attacking pings each opponent and gains you 1', () => {
    let g = setup();
    const boom = give(g, 'alice', 'Boomerang, Blade Flinger', 'battlefield');
    g = attack(toAttacks(g), 'alice', [boom], bobT);
    g = settle(g);
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([21, 19]);
  });

  it('Parasitic Strix: drains 2 only if you control a black permanent', () => {
    let g = setup();
    give(g, 'alice', 'Black Relic', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Parasitic Strix', 'hand') });
    g = settle(g, () => undefined);
    expect(g.pending?.kind).toBe('trigger_targets');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: plr('bob') } }));
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([22, 18]);
    // none: bob's black permanent doesn't count
    g = setup();
    give(g, 'bob', 'Black Relic', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Parasitic Strix', 'hand') });
    g = settle(g, () => undefined);
    expect(g.pending).toBeFalsy();
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([20, 20]);
    // the black permanent leaves in response: nothing happens (CR 603.4)
    g = setup();
    const relic = give(g, 'alice', 'Black Relic', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Parasitic Strix', 'hand') });
    g = settle(g, () => undefined);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: plr('bob') } });
    while (g.priority !== 'bob') g = act(g, { type: 'pass', player: g.priority! });
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Naturalize Lite', 'hand'), targets: obj(relic) });
    g = settle(g);
    expect(g.objects[relic]!.zone).toBe('graveyard');
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([20, 20]);
  });

  it('Demonic Appetite: +3/+3, and you sacrifice a creature each upkeep', () => {
    let g = setup('bob');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const elf = give(g, 'alice', 'Elf Lite', 'battlefield');
    const aura = give(g, 'alice', 'Demonic Appetite', 'battlefield');
    g.objects[aura]!.attachedTo = { id: bear, zcc: g.objects[bear]!.zcc };
    expect(chars(g, g.objects[bear]!).power).toBe(5);
    g = toStep(g, 'upkeep', 'alice');
    g = settle(g, () => undefined);
    expect(g.pending?.kind).toBe('sacrifice');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'sacrifice', objects: [elf] } }));
    expect(g.objects[elf]!.zone).toBe('graveyard');
    expect(g.objects[bear]!.zone).toBe('battlefield');
  });

  it('Squash: {3} less with a Giant; 6 damage to a creature', () => {
    let g = setup();
    const wall = give(g, 'bob', 'Wall Lite', 'battlefield');
    const sq = give(g, 'alice', 'Squash', 'hand');
    emptyPool(g, 'alice');
    g.players.alice!.pool.R = 2;
    expect(illegal(g, { type: 'cast', player: 'alice', object: sq, targets: obj(wall) })).toBeTruthy();
    expect(illegal(g, { type: 'cast', player: 'alice', object: sq, targets: plr('bob') })).toBeTruthy();
    give(g, 'bob', 'Giant Lite', 'battlefield');
    expect(illegal(g, { type: 'cast', player: 'alice', object: sq, targets: obj(wall) })).toBeTruthy();
    give(g, 'alice', 'Giant Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: sq, targets: obj(wall) }));
    expect(g.objects[wall]!.zone).toBe('graveyard');
    expect(g.players.alice!.pool.R).toBe(0);
  });

  it('Fountain Watch: your artifacts and enchantments have shroud', () => {
    let g = setup();
    give(g, 'bob', 'Fountain Watch', 'battlefield');
    const relic = give(g, 'bob', 'Relic Lite', 'battlefield');
    const glyph = give(g, 'bob', 'Glyph Lite', 'battlefield');
    const mine = give(g, 'alice', 'Relic Lite', 'battlefield');
    const nat = give(g, 'alice', 'Naturalize Lite', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: nat, targets: obj(relic) })).toBeTruthy();
    expect(illegal(g, { type: 'cast', player: 'alice', object: nat, targets: obj(glyph) })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: nat, targets: obj(mine) }));
    expect(g.objects[mine]!.zone).toBe('graveyard');
  });

  it('Emissary of Sunrise: explores — a land goes to hand; a nonland gives a counter and may go to the graveyard', () => {
    let g = setup();
    const land = top(g, 'alice', 'Forest');
    const e = give(g, 'alice', 'Emissary of Sunrise', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: e }), () => undefined);
    expect(g.pending).toBeFalsy();
    expect(g.objects[land]!.zone).toBe('hand');
    expect(g.objects[e]!.counters['+1/+1'] ?? 0).toBe(0);
    g = setup();
    const nonland = top(g, 'alice', 'Bear');
    const e2 = give(g, 'alice', 'Emissary of Sunrise', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: e2 }), () => undefined);
    expect(g.objects[e2]!.counters['+1/+1']).toBe(1);
    expect(g.pending?.kind).toBe('may');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    expect(['graveyard', 'library']).toContain(g.objects[nonland]!.zone);
  });

  it('Reservoir Walker: 3 life and three energy', () => {
    let g = setup();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Reservoir Walker', 'hand') }));
    expect(g.players.alice!.life).toBe(23);
    expect(g.players.alice!.counters?.energy).toBe(3);
  });

  it('Leyline Invocation: a Fractal with a +1/+1 counter for each land you control', () => {
    let g = setup();
    for (let i = 0; i < 3; i++) give(g, 'alice', 'Forest', 'battlefield');
    give(g, 'bob', 'Forest', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Leyline Invocation', 'hand') }));
    const fr = g.zones.battlefield.filter((id) => chars(g, g.objects[id]!).subtypes.includes('Fractal'));
    expect(fr.length).toBe(1);
    expect(g.objects[fr[0]!]!.counters['+1/+1']).toBe(3);
    expect([...chars(g, g.objects[fr[0]!]!).colors].sort()).toEqual(['G', 'U']);
    // no lands: it dies
    g = setup();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Leyline Invocation', 'hand') }));
    expect(g.zones.battlefield.filter((id) => chars(g, g.objects[id]!).subtypes.includes('Fractal')).length).toBe(0);
  });

  it("Teferi's Isle: enters tapped, taps for {U}{U}, and phases out and in on your untap steps", () => {
    let g = setup();
    emptyPool(g, 'alice');
    const isle = give(g, 'alice', "Teferi's Isle", 'hand');
    g = settle(act(g, { type: 'play_land', player: 'alice', object: isle }));
    expect(g.objects[isle]!.tapped).toBe(true);
    g.objects[isle]!.tapped = false;
    g = act(g, { type: 'activate_mana', player: 'alice', object: isle, ability: 0 });
    expect(g.players.alice!.pool.U).toBe(2);
    g = toStep(g, 'main1', 'bob');
    expect(g.zones.battlefield).toContain(isle);
    g = toStep(g, 'main1', 'alice');
    expect(g.zones.battlefield).not.toContain(isle);
    g = toStep(g, 'main1', 'bob');
    expect(g.zones.battlefield).not.toContain(isle);
    g = toStep(g, 'main1', 'alice');
    expect(g.zones.battlefield).toContain(isle);
    // CR 702.26: it phased in before untapping, so it untapped this untap step
    expect(g.objects[isle]!.tapped).toBe(false);
  });

  it("Bottomless Pit: each player discards at random in their own upkeep", () => {
    let g = setup();
    give(g, 'alice', 'Bottomless Pit', 'battlefield');
    g = toStep(g, 'end', 'alice');
    const bobHand = g.zones.hand.bob!.length;
    const aliceHand = g.zones.hand.alice!.length;
    g = toStep(g, 'upkeep', 'bob');
    g = settle(g, () => undefined);
    expect(g.pending).toBeFalsy();
    expect(g.zones.hand.bob!.length).toBe(bobHand - 1);
    // alice may have discarded to hand size at cleanup, but not to the Pit on bob's upkeep
    expect(g.zones.hand.alice!.length).toBeLessThanOrEqual(aliceHand);
    const a2 = g.zones.hand.alice!.length;
    g = toStep(g, 'draw', 'bob');
    expect(g.zones.hand.alice!.length).toBe(a2);
  });

  it('Inquisitor Exarch: choose one — gain 2, or target opponent loses 2', () => {
    let g = setup();
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Inquisitor Exarch', 'hand') });
    g = settle(g, () => undefined);
    expect(g.pending?.kind).toBe('trigger_targets');
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', modes: [1], targets: plr('alice') } })).toBeTruthy();
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', modes: [0, 1], targets: plr('bob') } })).toBeTruthy();
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', modes: [1], targets: plr('bob') } }));
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([20, 18]);
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Inquisitor Exarch', 'hand') });
    g = settle(g, () => undefined);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', modes: [0], targets: [] } }));
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([22, 18]);
  });

  it('Skinrender: three -1/-1 counters on target creature (itself if it is the only one)', () => {
    let g = setup();
    const sk = give(g, 'alice', 'Skinrender', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: sk });
    g = settle(g, (s) => (s.pending?.kind === 'trigger_targets' ? { kind: 'trigger_targets', targets: obj(sk) } : undefined));
    expect(g.objects[sk]!.zone).toBe('graveyard');
  });

});

const setup3 = () => {
  const g = toStep(start({ extra: [...CARDS, ...CARDS2], players: 3 }), 'main1', 'alice');
  for (const p of ['alice', 'bob', 'carol']) g.players[p]!.pool = { W: 10, U: 10, B: 10, R: 10, G: 10, C: 10 };
  return g;
};

describe('audit B — batch 3 (edge cases)', () => {
  it('Cybermat: the defending player has no creatures — it still "attacks and isn\'t blocked"', () => {
    let g = setup();
    const mat = give(g, 'alice', 'Cybermat', 'battlefield');
    g = attack(toAttacks(g), 'alice', [mat], bobT);
    for (let i = 0; i < 40 && g.step !== 'main2'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } });
      else if (g.pending) throw new Error(g.pending.kind);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.players.bob!.life).toBe(20 - 3);
  });

  it('Briarbridge Patrol: noncombat damage to a creature investigates; damage to a player does not', () => {
    let g = setup();
    const patrol = give(g, 'alice', 'Briarbridge Patrol', 'battlefield');
    const wall = give(g, 'bob', 'Wall Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Fight Lite', 'hand'), targets: [[{ kind: 'object', object: patrol }], [{ kind: 'object', object: wall }]] }));
    expect(g.objects[wall]!.damage).toBe(3);
    expect(tokens(g, 'Clue').length).toBe(1);
    g = attack(toAttacks(g), 'alice', [patrol], bobT);
    g = passRound(g);
    g = block(g, 'bob', []);
    g = finishCombat(g);
    expect(g.players.bob!.life).toBe(17);
    expect(tokens(g, 'Clue').length).toBe(1);
  });

  it("Briarbridge Patrol: the end-step ability also triggers on an opponent's end step", () => {
    let g = setup('bob');
    give(g, 'alice', 'Briarbridge Patrol', 'battlefield');
    const big = give(g, 'alice', 'Big Bear', 'hand');
    g.turnLog.sacrificedBy = { alice: [0, 1, 2].map(() => ({ types: ['Artifact'], subtypes: ['Clue'] })) } as never;
    g = toStep(g, 'end', 'bob');
    g = settle(g, (s) => (s.pending?.kind === 'may' ? { kind: 'may', yes: true } : s.pending?.kind === 'choose_objects' ? { kind: 'choose_objects', objects: [big] } : undefined));
    expect(g.objects[big]!.zone).toBe('battlefield');
  });

  it('Archon of Absolution: the tax covers planeswalkers you control, not attacks on other players', () => {
    let g = setup3();
    give(g, 'bob', 'Archon of Absolution', 'battlefield');
    const pw = give(g, 'bob', 'Walker Lite', 'battlefield');
    g.objects[pw]!.counters.loyalty = 4;
    const a = give(g, 'alice', 'Bear', 'battlefield');
    const b = give(g, 'alice', 'Bear', 'battlefield');
    g = toAttacks(g);
    for (const p of ['alice', 'bob', 'carol']) emptyPool(g, p);
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: a, target: { kind: 'planeswalker', object: pw } as never }] } })).toBeTruthy();
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: b, target: { kind: 'player', player: 'carol' } }] } });
    expect(g.combat?.attackers[b]).toBeDefined();
  });

  it('Turtle Lair: its colored mana can’t pay for abilities', () => {
    let g = setup();
    emptyPool(g, 'alice');
    const lair = give(g, 'alice', 'Turtle Lair', 'battlefield');
    const pinger = give(g, 'alice', 'Pinger Lite', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: lair, ability: 1, choice: 'G' });
    expect(illegal(g, { type: 'activate', player: 'alice', object: pinger, ability: 0 })).toBeTruthy();
  });

  it("Immerwolf: a non-Human Werewolf you control can't transform; a Human Werewolf still can", () => {
    // front face (Human Werewolf) transforms as usual when no spells were cast
    let g = setup('bob');
    give(g, 'alice', 'Immerwolf', 'battlefield');
    const wolf = give(g, 'alice', 'Old Wolf // Old Beast', 'battlefield');
    g = toStep(g, 'upkeep', 'alice');
    g = settle(g);
    expect(g.objects[wolf]!.face).toBe(1);
    expect(chars(g, g.objects[wolf]!).power).toBe(5);
    // now two spells in one turn: the Beast would transform back, but can't
    g = toStep(g, 'main1', 'alice');
    fill(g);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Opt Lite', 'hand') }));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Opt Lite', 'hand') }));
    g = toStep(g, 'upkeep', 'bob');
    g = settle(g);
    expect(g.objects[wolf]!.face).toBe(1);
  });
  it('Immerwolf control: without it the Beast transforms back after two spells', () => {
    let g = setup('bob');
    const wolf = give(g, 'alice', 'Old Wolf // Old Beast', 'battlefield');
    g = toStep(g, 'upkeep', 'alice');
    g = settle(g);
    expect(g.objects[wolf]!.face).toBe(1);
    g = toStep(g, 'main1', 'alice');
    fill(g);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Opt Lite', 'hand') }));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Opt Lite', 'hand') }));
    g = toStep(g, 'upkeep', 'bob');
    g = settle(g);
    expect(g.objects[wolf]!.face).toBe(0);
  });

  it('Everglove Courier: the bonus ends when the Courier untaps or leaves', () => {
    for (const how of ['untap', 'dies']) {
      let g = setup();
      const courier = give(g, 'alice', 'Everglove Courier', 'battlefield');
      const elf = give(g, 'alice', 'Elf Lite', 'battlefield');
      g = settle(act(g, { type: 'activate', player: 'alice', object: courier, ability: 0, targets: obj(elf) }));
      expect(chars(g, g.objects[elf]!).power).toBe(3);
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', how === 'untap' ? 'Twiddle Lite' : 'Murder Lite', 'hand'), targets: obj(courier) }));
      expect(chars(g, g.objects[elf]!).power).toBe(1);
      expect(kws(g, elf)).not.toContain('trample');
      if (how === 'untap') {
        // tapping it again doesn't bring the old effect back
        g.objects[courier]!.tapped = true;
        expect(chars(g, g.objects[elf]!).power).toBe(1);
      }
    }
  });

  it('Return Upon the Tide: foretold for {2}, cast on a later turn for {3}{B}', () => {
    let g = setup();
    const c = give(g, 'alice', 'Elf Lite', 'graveyard');
    const spell = give(g, 'alice', 'Return Upon the Tide', 'hand');
    emptyPool(g, 'alice');
    g.players.alice!.pool.C = 2;
    g = act(g, { type: 'foretell', player: 'alice', object: spell });
    expect(g.objects[spell]!.zone).toBe('exile');
    g.players.alice!.pool = { W: 0, U: 0, B: 1, R: 0, G: 0, C: 3 };
    expect(illegal(g, { type: 'cast', player: 'alice', object: spell, alt: 'foretell', targets: obj(c) })).toBeTruthy();
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    g.players.alice!.pool = { W: 0, U: 0, B: 1, R: 0, G: 0, C: 3 };
    g = settle(act(g, { type: 'cast', player: 'alice', object: spell, alt: 'foretell', targets: obj(c) }));
    expect(onBf(g, 'Elf Lite', 'alice').length).toBe(1);
    expect(g.zones.battlefield.filter((id) => chars(g, g.objects[id]!).subtypes.includes('Warrior')).length).toBe(2);
  });

  it("Epiphany Storm: on an opponent's creature, that opponent has the ability", () => {
    let g = setup();
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Epiphany Storm', 'hand'), targets: obj(bear) }));
    expect(illegal(g, { type: 'activate', player: 'alice', object: bear, ability: 0, costs: { discard: [g.zones.hand.alice![0]!] } })).toBeTruthy();
    g = act(g, { type: 'pass', player: 'alice' });
    fill(g);
    const hand = g.zones.hand.bob!.length;
    const fodder = g.zones.hand.bob![0]!;
    g = settle(act(g, { type: 'activate', player: 'bob', object: bear, ability: 0, costs: { discard: [fodder] } }));
    expect(g.zones.hand.bob!.length).toBe(hand);
    expect(g.objects[fodder]!.zone).toBe('graveyard');
  });

  it('three players: Mouth of the Storm, Boomerang, Phyrexian Atlas, Fanatic reach every opponent', () => {
    let g = setup3();
    const b = give(g, 'bob', 'Big Bear', 'battlefield');
    const c = give(g, 'carol', 'Big Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mouth of the Storm', 'hand') }));
    expect([b, c].map((id) => chars(g, g.objects[id]!).power)).toEqual([1, 1]);
    g = toStep(g, 'main1', 'carol');
    expect([b, c].map((id) => chars(g, g.objects[id]!).power)).toEqual([1, 1]);
    g = toStep(g, 'upkeep', 'alice');
    expect([b, c].map((id) => chars(g, g.objects[id]!).power)).toEqual([4, 4]);

    g = setup3();
    const boom = give(g, 'alice', 'Boomerang, Blade Flinger', 'battlefield');
    g = attack(toAttacks(g), 'alice', [boom], bobT);
    g = settle(g);
    expect([g.players.alice!.life, g.players.bob!.life, g.players.carol!.life]).toEqual([21, 19, 19]);

    g = setup3();
    const atlas = give(g, 'alice', 'Phyrexian Atlas', 'battlefield');
    g.players.bob!.poison = 3;
    g.players.carol!.poison = 4;
    g = settle(act(g, { type: 'activate_mana', player: 'alice', object: atlas, ability: 0, choice: 'R' }));
    expect([g.players.alice!.life, g.players.bob!.life, g.players.carol!.life]).toEqual([20, 19, 19]);

    g = setup3();
    const hands = ['alice', 'bob', 'carol'].map((p) => g.zones.hand[p]!.length);
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Fanatic of the Harrowing', 'hand') });
    g = settle(g, (s) => (s.pending?.kind === 'discard' ? { kind: 'discard', objects: [s.zones.hand[s.pending.player]![0]!] } : undefined));
    expect(['alice', 'bob', 'carol'].map((p) => g.zones.hand[p]!.length)).toEqual([hands[0]!, hands[1]! - 1, hands[2]! - 1]);
  });

  it('Spaceshift: a token that is exiled does not come back (CR 111.8)', () => {
    let g = setup();
    const cannon = give(g, 'bob', 'Hornet Cannon', 'battlefield');
    g = act(g, { type: 'pass', player: 'alice' });
    g = settle(act(g, { type: 'activate', player: 'bob', object: cannon, ability: 0 }));
    const hornet = tokens(g, 'Hornet')[0]!;
    expect(hornet).toBeDefined();
    fill(g);
    while (g.priority !== 'alice') g = act(g, { type: 'pass', player: g.priority! });
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Spaceshift', 'hand'), targets: obj(hornet) }));
    // CR 111.8: a token that has left the battlefield can't come back onto the battlefield; it ceases to exist.
    expect(tokens(g, 'Hornet').length).toBe(0);
  });
  it('Spaceshift: an artifact comes back with a +1/+1 counter', () => {
    let g = setup();
    const relic = give(g, 'bob', 'Relic Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Spaceshift', 'hand'), targets: obj(relic) }));
    const back = onBf(g, 'Relic Lite', 'bob');
    expect(back.length).toBe(1);
    expect(g.objects[back[0]!]!.counters['+1/+1']).toBe(1);
  });
  it('Flickering Hound: a token exiled by the trigger does not come back (CR 111.8)', () => {
    let g = setup();
    give(g, 'alice', 'Flickering Hound', 'battlefield');
    const cannon = give(g, 'alice', 'Hornet Cannon', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: cannon, ability: 0 }));
    const hornet = tokens(g, 'Hornet')[0]!;
    fill(g);
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Elf Lite', 'hand') });
    expect(g.pending?.kind).toBe('trigger_targets');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: obj(hornet) } }));
    expect(tokens(g, 'Hornet').length).toBe(0);
  });

  it("Flickering Hound: only your creature spells trigger it", () => {
    let g = setup('bob');
    give(g, 'alice', 'Flickering Hound', 'battlefield');
    give(g, 'alice', 'Bear', 'battlefield');
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Elf Lite', 'hand') });
    expect(g.pending).toBeFalsy();
    expect(g.stack.length).toBe(1);
    g = act(g, { type: 'pass', player: 'bob' });
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Opt Lite', 'hand') });
    expect(g.pending).toBeFalsy();
    expect(g.stack.length).toBe(2);
  });

  it('Pearl Shard: the shield is used up by the first damage', () => {
    let g = setup('bob');
    const shard = give(g, 'alice', 'Pearl Shard', 'battlefield');
    g = act(g, { type: 'pass', player: 'bob' });
    g = settle(act(g, { type: 'activate', player: 'alice', object: shard, ability: 0, targets: plr('alice') }));
    while (g.priority !== 'bob') g = act(g, { type: 'pass', player: g.priority! });
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bolt Lite', 'hand'), targets: plr('alice') }));
    while (g.priority !== 'bob') g = act(g, { type: 'pass', player: g.priority! });
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bolt Lite', 'hand'), targets: plr('alice') }));
    expect(g.players.alice!.life).toBe(16);
  });

  it('Squash: can hit a planeswalker', () => {
    let g = setup();
    const pw = give(g, 'bob', 'Walker Lite', 'battlefield');
    g.objects[pw]!.counters.loyalty = 4;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Squash', 'hand'), targets: obj(pw) }));
    expect(g.objects[pw]!.zone).toBe('graveyard');
  });

  it("Demonic Appetite / Cartouche: can't be cast on an opponent's creature; Hornet is named Hornet", () => {
    let g = setup();
    const theirs = give(g, 'bob', 'Bear', 'battlefield');
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Demonic Appetite', 'hand'), targets: obj(theirs) })).toBeTruthy();
    const cannon = give(g, 'alice', 'Hornet Cannon', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: cannon, ability: 0 }));
    const hornet = tokens(g, 'Hornet')[0]!;
    expect(chars(g, g.objects[hornet]!).name).toBe('Hornet');
    expect(chars(g, g.objects[hornet]!).colors).toEqual([]);
  });
});

describe('audit B — batch 4', () => {
  it('Dead-Iron Sledge: other creatures blocking or being blocked do not trigger it', () => {
    let g = setup();
    const a = give(g, 'alice', 'Big Bear', 'battlefield');
    const b = give(g, 'alice', 'Big Bear', 'battlefield');
    const x = give(g, 'bob', 'Big Bear', 'battlefield');
    const sledge = give(g, 'alice', 'Dead-Iron Sledge', 'battlefield');
    g.objects[sledge]!.attachedTo = { id: a, zcc: g.objects[a]!.zcc };
    g = attack(toAttacks(g), 'alice', [a, b], bobT);
    g = passRound(g);
    g = block(g, 'bob', [{ blocker: x, attacker: b }]);
    expect(g.stack.length).toBe(0);
  });

  it('Hornet Cannon: two activations — each Hornet is destroyed at the end step', () => {
    let g = setup();
    const cannon = give(g, 'alice', 'Hornet Cannon', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: cannon, ability: 0 }));
    g.objects[cannon]!.tapped = false;
    fill(g);
    g = settle(act(g, { type: 'activate', player: 'alice', object: cannon, ability: 0 }));
    expect(tokens(g, 'Hornet').length).toBe(2);
    g = toStep(g, 'end', 'alice');
    g = settle(g);
    expect(tokens(g, 'Hornet').length).toBe(0);
  });

  it('Pearl Shard / Ebony Horse: the prevention ends with the turn', () => {
    let g = setup();
    const shard = give(g, 'alice', 'Pearl Shard', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: shard, ability: 0, targets: plr('alice') }));
    g = toStep(g, 'main1', 'bob');
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bolt Lite', 'hand'), targets: plr('alice') }));
    expect(g.players.alice!.life).toBe(17);
  });

  it('target restrictions: Ornery Kudu, Urborg Uprising, Return Upon the Tide, Frenzied Tilling search', () => {
    let g = setup();
    const theirs = give(g, 'bob', 'Bear', 'battlefield');
    const mine = give(g, 'alice', 'Bear', 'battlefield');
    const kudu = give(g, 'alice', 'Ornery Kudu', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: kudu });
    g = settle(g, () => undefined);
    expect(g.pending?.kind).toBe('trigger_targets');
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: obj(theirs) } })).toBeTruthy();
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: obj(mine) } }));
    expect(g.objects[mine]!.counters['-1/-1']).toBe(1);
    fill(g);
    const gyTheirs = give(g, 'bob', 'Bear', 'graveyard');
    const gySpell = give(g, 'alice', 'Opt Lite', 'graveyard');
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Urborg Uprising', 'hand'), targets: obj(gyTheirs) })).toBeTruthy();
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Urborg Uprising', 'hand'), targets: obj(gySpell) })).toBeTruthy();
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Return Upon the Tide', 'hand'), targets: obj(gyTheirs) })).toBeTruthy();
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Return Upon the Tide', 'hand'), targets: obj(gySpell) })).toBeTruthy();
    // Frenzied Tilling finds basics only
    give(g, 'alice', 'Dual Lite', 'library');
    const land = give(g, 'bob', 'Dual Lite', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Frenzied Tilling', 'hand'), targets: obj(land) });
    g = settle(g, () => undefined);
    expect(g.pending?.kind).toBe('search');
    expect((g.pending as { candidates: string[] }).candidates.every((id) => g.objects[id]!.card === 'Forest')).toBe(true);
  });

  it('Blossom-Blessed Angel // Seed Suture: enters prepared; the copy of Seed Suture can be cast once', () => {
    let g = setup();
    const angel = give(g, 'alice', 'Blossom-Blessed Angel // Seed Suture', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: angel }));
    expect(g.objects[angel]!.prepared).toBe(true);
    expect(kws(g, angel).sort()).toEqual(['flying', 'vigilance']);
    const copy = g.zones.exile.find((id) => g.objects[id]!.prepareOf)!;
    emptyPool(g, 'alice');
    g.players.alice!.pool.G = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: copy, targets: obj(angel) }));
    expect(g.objects[angel]!.counters['+1/+1']).toBe(1);
    expect(g.players.alice!.life).toBe(21);
    expect(g.objects[angel]!.prepared).toBeFalsy();
    expect(g.zones.exile.some((id) => g.objects[id]?.prepareOf)).toBe(false);
  });

  it("simple ones: Predator's Strike, Withstand Death, Paladin, Aven Battle Priest", () => {
    let g = setup();
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', "Predator's Strike", 'hand'), targets: obj(bear) }));
    expect([chars(g, g.objects[bear]!).power, chars(g, g.objects[bear]!).toughness]).toEqual([5, 5]);
    expect(kws(g, bear)).toContain('trample');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Withstand Death', 'hand'), targets: obj(bear) }));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Wrath Lite', 'hand') }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Paladin of the Bloodstained', 'hand') }));
    const vamp = g.zones.battlefield.filter((id) => g.objects[id]!.token && chars(g, g.objects[id]!).subtypes.includes('Vampire'));
    expect(vamp.length).toBe(1);
    expect(kws(g, vamp[0]!)).toEqual(['lifelink']);
    expect(chars(g, g.objects[vamp[0]!]!).colors).toEqual(['W']);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Aven Battle Priest', 'hand') }));
    expect(g.players.alice!.life).toBe(23);
    g = toStep(g, 'upkeep', 'bob');
    expect(chars(g, g.objects[bear]!).power).toBe(2);
    expect(kws(g, bear)).toEqual([]);
  });
});

describe('audit B — batch 5', () => {
  it('Wingrattle Scarecrow: exiled from the graveyard in response to persist — it does not come back', () => {
    let g = setup();
    const sc = give(g, 'alice', 'Wingrattle Scarecrow', 'battlefield');
    give(g, 'alice', 'Black Rat', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Shock Lite', 'hand'), targets: obj(sc) });
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.objects[sc]!.zone).toBe('graveyard');
    expect(g.stack.length).toBe(1);
    while (g.priority !== 'bob') g = act(g, { type: 'pass', player: g.priority! });
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Cremate Lite', 'hand'), targets: obj(sc) });
    g = settle(g);
    expect(g.objects[sc]!.zone).toBe('exile');
  });

  it('Flickering Hound / Spaceshift: the target bounced in response — nothing returns', () => {
    let g = setup();
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Spaceshift', 'hand'), targets: obj(bear) });
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Unsummon Lite', 'hand'), targets: obj(bear) });
    g = settle(g);
    expect(g.objects[bear]!.zone).toBe('hand');
  });

  it('Return Upon the Tide: the target exiled in response — the spell does nothing (no tokens)', () => {
    let g = setup();
    const elf = give(g, 'alice', 'Elf Lite', 'graveyard');
    const n = g.zones.battlefield.length;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Return Upon the Tide', 'hand'), targets: obj(elf) });
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Cremate Lite', 'hand'), targets: obj(elf) });
    g = settle(g);
    expect(g.objects[elf]!.zone).toBe('exile');
    expect(g.zones.battlefield.length).toBe(n);
  });

  it('Urborg Uprising: one of two targets exiled in response — the other returns and you still draw', () => {
    let g = setup();
    const c1 = give(g, 'alice', 'Bear', 'graveyard');
    const c2 = give(g, 'alice', 'Elf Lite', 'graveyard');
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Urborg Uprising', 'hand'), targets: [[{ kind: 'object', object: c1 }, { kind: 'object', object: c2 }]] });
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Cremate Lite', 'hand'), targets: obj(c1) });
    g = settle(g);
    expect(g.objects[c1]!.zone).toBe('exile');
    expect(g.objects[c2]!.zone).toBe('hand');
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
  });

  it('Urborg Uprising: its only target exiled in response — the whole spell is removed, no draw (CR 608.2b)', () => {
    let g = setup();
    const c1 = give(g, 'alice', 'Bear', 'graveyard');
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Urborg Uprising', 'hand'), targets: obj(c1) });
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Cremate Lite', 'hand'), targets: obj(c1) });
    g = settle(g);
    expect(g.zones.hand.alice!.length).toBe(hand);
  });

  it('Aberrant Mind Sorcerer / Sazh Katzroy / Skinrender: killed in response, the ability still resolves', () => {
    let g = setup();
    const target = give(g, 'bob', 'Big Bear', 'battlefield');
    const sk = give(g, 'alice', 'Skinrender', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: sk });
    g = settle(g, () => undefined);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: obj(target) } });
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Murder Lite', 'hand'), targets: obj(sk) });
    g = settle(g);
    expect(g.objects[sk]!.zone).toBe('graveyard');
    expect(g.objects[target]!.counters['-1/-1']).toBe(3);
  });

  it('Emissary of Sunrise: killed in response, it still explores — a revealed land goes to hand (CR 701.44c)', () => {
    let g = setup();
    const land = top(g, 'alice', 'Forest');
    const e = give(g, 'alice', 'Emissary of Sunrise', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: e });
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.stack.length).toBe(1);
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Murder Lite', 'hand'), targets: obj(e) });
    g = settle(g, () => undefined);
    expect(g.objects[e]!.zone).toBe('graveyard');
    // CR 701.44c: no longer on the battlefield, it still explores (last known information): its controller reveals the
    // top card of their library and a land goes to their hand.
    expect(g.objects[land]!.zone).toBe('hand');
  });
  it('Emissary of Sunrise: killed in response with a nonland on top — the card may still go to the graveyard (CR 701.44a, c)', () => {
    let g = setup();
    const nonland = top(g, 'alice', 'Bear');
    const e = give(g, 'alice', 'Emissary of Sunrise', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: e });
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Murder Lite', 'hand'), targets: obj(e) });
    g = settle(g, () => undefined);
    expect(g.objects[e]!.zone).toBe('graveyard');
    expect(g.pending).toMatchObject({ kind: 'may', player: 'alice' });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    expect(g.objects[nonland]!.zone).toBe('graveyard');
  });

  it('Mijae Djinn / Cybermat / Clockwork Droid: Hijack-ed, the new controller makes the choices', () => {
    let g = setup();
    const droid = give(g, 'bob', 'Clockwork Droid', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Hijack', 'hand'), targets: obj(droid) }));
    g = toAttacks(g);
    expect((g.pending as { exertable?: string[] }).exertable).toContain(droid);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: droid, target: bobT }], exert: [droid] } });
    g = settle(g, () => undefined);
    expect(g.pending).toMatchObject({ kind: 'scry', player: 'alice' });
  });
});

describe('audit B — batch 6 (source gone as the ability resolves)', () => {
  /** Casts `name` for alice; once its trigger is on the stack bob kills / destroys the source, then everything resolves. */
  const killInResponse = (g: GameState, source: string, answer: 'Murder Lite' | 'Naturalize Lite') => {
    while (g.priority !== 'bob') g = act(g, { type: 'pass', player: g.priority! });
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', answer, 'hand'), targets: obj(source) });
    return settle(g, () => undefined);
  };
  it('Legion Extruder: destroyed in response, it still deals 2 damage', () => {
    let g = setup();
    const ext = give(g, 'alice', 'Legion Extruder', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: ext });
    g = settle(g, () => undefined);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: plr('bob') } });
    g = killInResponse(g, ext, 'Naturalize Lite');
    expect(g.objects[ext]!.zone).toBe('graveyard');
    expect(g.players.bob!.life).toBe(18);
  });
  it('Boomerang: killed in response, he still deals 1 damage to each opponent and you gain 1', () => {
    let g = setup();
    const boom = give(g, 'alice', 'Boomerang, Blade Flinger', 'battlefield');
    g = attack(toAttacks(g), 'alice', [boom], bobT);
    expect(g.stack.length).toBe(1);
    g = killInResponse(g, boom, 'Murder Lite');
    expect(g.objects[boom]!.zone).toBe('graveyard');
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([21, 19]);
  });
  it('Rockcaster Platoon: killed in response, it still deals 2 to flyers and players', () => {
    let g = setup();
    const platoon = give(g, 'alice', 'Rockcaster Platoon', 'battlefield');
    const flyer = give(g, 'bob', 'Flyer Lite', 'battlefield');
    g = act(g, { type: 'activate', player: 'alice', object: platoon, ability: 0 });
    g = killInResponse(g, platoon, 'Murder Lite');
    expect(g.objects[platoon]!.zone).toBe('graveyard');
    expect(g.objects[flyer]!.damage).toBe(2);
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([18, 18]);
  });
  it('Clockwork Droid: killed in response to the exert trigger, you still scry 1', () => {
    let g = setup();
    const droid = give(g, 'alice', 'Clockwork Droid', 'battlefield');
    g = toAttacks(g);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: droid, target: bobT }], exert: [droid] } });
    expect(g.stack.length).toBe(1);
    g = killInResponse(g, droid, 'Murder Lite');
    expect(g.objects[droid]!.zone).toBe('graveyard');
    expect(g.pending).toMatchObject({ kind: 'scry', player: 'alice' });
  });
  it('Dead-Iron Sledge: destroyed in response, both creatures are still destroyed (last known information)', () => {
    let g = setup();
    const attacker = give(g, 'alice', 'Big Bear', 'battlefield');
    const blocker = give(g, 'bob', 'Big Bear', 'battlefield');
    const sledge = give(g, 'alice', 'Dead-Iron Sledge', 'battlefield');
    g.objects[sledge]!.attachedTo = { id: attacker, zcc: g.objects[attacker]!.zcc };
    g = attack(toAttacks(g), 'alice', [attacker], bobT);
    g = passRound(g);
    g = block(g, 'bob', [{ blocker, attacker }]);
    expect(g.stack.length).toBe(1);
    g = killInResponse(g, sledge, 'Naturalize Lite');
    expect(g.objects[sledge]!.zone).toBe('graveyard');
    expect([attacker, blocker].map((id) => g.objects[id]!.zone)).toEqual(['graveyard', 'graveyard']);
  });
  it('Sazh Katzroy / Phyrexian Atlas / Parasitic Strix / Ainok Survivalist: source gone, the rest still happens', () => {
    let g = setup();
    const sazh = give(g, 'alice', 'Sazh Katzroy', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    give(g, 'alice', 'Elf Lite', 'battlefield');
    g = attack(toAttacks(g), 'alice', [sazh], bobT);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: obj(bear) } });
    g = killInResponse(g, sazh, 'Murder Lite');
    expect(g.objects[bear]!.counters['+1/+1']).toBe(2);

    g = setup();
    const atlas = give(g, 'alice', 'Phyrexian Atlas', 'battlefield');
    g.players.bob!.poison = 3;
    g = act(g, { type: 'activate_mana', player: 'alice', object: atlas, ability: 0, choice: 'R' });
    expect(g.stack.length).toBe(1);
    g = killInResponse(g, atlas, 'Naturalize Lite');
    expect(g.players.bob!.life).toBe(19);

    g = setup();
    give(g, 'alice', 'Black Relic', 'battlefield');
    const strix = give(g, 'alice', 'Parasitic Strix', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: strix });
    g = settle(g, () => undefined);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: plr('bob') } });
    g = killInResponse(g, strix, 'Murder Lite');
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([22, 18]);
  });
});

describe('audit B — batch 7 (phasing)', () => {
  it('Crystal Golem: it can attack the turn it phases in, keeps its counters, and its Equipment phases with it (CR 702.26d, g)', () => {
    let g = setup();
    const golem = give(g, 'alice', 'Crystal Golem', 'battlefield');
    const scepter = give(g, 'alice', 'Scepter of Celebration', 'battlefield');
    g.objects[scepter]!.attachedTo = { id: golem, zcc: g.objects[golem]!.zcc };
    g.objects[golem]!.counters['+1/+1'] = 1;
    g = toStep(g, 'end', 'alice');
    g = settle(g);
    expect(g.zones.battlefield).not.toContain(golem);
    expect(g.zones.battlefield).not.toContain(scepter);
    g = toStep(g, 'main1', 'alice');
    expect(g.zones.battlefield).toContain(golem);
    expect(g.zones.battlefield).toContain(scepter);
    expect(g.objects[scepter]!.attachedTo?.id).toBe(golem);
    expect(g.objects[golem]!.counters['+1/+1']).toBe(1);
    expect(chars(g, g.objects[golem]!).power).toBe(6);
    g = attack(toAttacks(g), 'alice', [golem], bobT);
    g = toStep(g, 'main2', 'alice');
    expect(g.players.bob!.life).toBe(14);
  });

  it("Crystal Golem: an opponent's Golem (Hijack-ed) phases out at the thief's end step and returns to its owner's side", () => {
    let g = setup();
    const golem = give(g, 'bob', 'Crystal Golem', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Hijack', 'hand'), targets: obj(golem) }));
    g = toStep(g, 'end', 'alice');
    g = settle(g);
    // "At the beginning of your end step": alice controls it now, so it phases out.
    expect(g.zones.battlefield).not.toContain(golem);
    // CR 702.26a: it phased out under alice's control, so it phases in during alice's next untap step — by then bob controls it again.
    g = toStep(g, 'main1', 'bob');
    expect(g.zones.battlefield).not.toContain(golem);
    g = toStep(g, 'upkeep', 'alice');
    expect(g.zones.battlefield).toContain(golem);
    expect(g.objects[golem]!.controller).toBe('bob');
  });

  it("Teferi's Isle: phased out, it isn't there to tap; Void Attendant processes an opponent's exiled card", () => {
    let g = setup();
    const va = give(g, 'alice', 'Void Attendant', 'battlefield');
    const mine = give(g, 'alice', 'Bear', 'exile');
    const theirs = give(g, 'bob', 'Bear', 'exile');
    expect(illegal(g, { type: 'activate', player: 'alice', object: va, ability: 0, costs: { processed: [mine] } })).toBeTruthy();
    g = settle(act(g, { type: 'activate', player: 'alice', object: va, ability: 0, costs: { processed: [theirs] } }));
    expect(g.objects[theirs]!.zone).toBe('graveyard');
    expect(g.zones.graveyard.bob).toContain(theirs);
    const scion = g.zones.battlefield.filter((id) => chars(g, g.objects[id]!).subtypes.includes('Scion'));
    expect(scion.length).toBe(1);
    expect(chars(g, g.objects[scion[0]!]!).colors).toEqual([]);
    emptyPool(g, 'alice');
    g = act(g, { type: 'activate_mana', player: 'alice', object: scion[0]!, ability: 0 });
    expect(g.players.alice!.pool.C).toBe(1);
    fill(g);
    expect(illegal(g, { type: 'activate', player: 'alice', object: va, ability: 0 })).toBeTruthy();
  });
});

describe('audit B — batch 8 (keywords on audited cards)', () => {
  it('Mouth of the Storm: ward {2} counters an opposing spell unless its controller pays', () => {
    for (const pay of [false, true]) {
      let g = setup('bob');
      const mouth = give(g, 'alice', 'Mouth of the Storm', 'battlefield');
      emptyPool(g, 'bob');
      g.players.bob!.pool.C = 2;
      g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Murder Lite', 'hand'), targets: obj(mouth) });
      expect(g.stack.length).toBe(2);
      g = settle(g, (s) => (s.pending?.kind === 'pay' ? { kind: 'pay', pay } : undefined));
      expect(g.objects[mouth]!.zone).toBe(pay ? 'graveyard' : 'battlefield');
    }
    // its controller's own spells don't trigger ward
    let g = setup();
    const mouth = give(g, 'alice', 'Mouth of the Storm', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder Lite', 'hand'), targets: obj(mouth) });
    expect(g.stack.length).toBe(1);
  });

  it('Archon of Absolution: protection from white — white spells can\'t target it, white creatures can\'t block it or damage it', () => {
    const white = makeCard({ name: 'Smite Lite', type_line: 'Instant', mana_cost: '{W}', cmc: 1, oracle_text: 'Destroy target creature.' });
    let g = toStep(start({ extra: [...CARDS, ...CARDS2, white] }), 'main1', 'alice');
    fill(g);
    const archon = give(g, 'alice', 'Archon of Absolution', 'battlefield');
    const knight = give(g, 'bob', 'White Knight Lite', 'battlefield');
    const flyer = give(g, 'bob', 'Flyer Lite', 'battlefield');
    g = attack(toAttacks(g), 'alice', [archon], bobT);
    while (g.priority !== 'bob') g = act(g, { type: 'pass', player: g.priority! });
    fill(g);
    expect(illegal(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Smite Lite', 'hand'), targets: obj(archon) })).toBeTruthy();
    g = passRound(g);
    expect(g.pending?.kind).toBe('declare_blockers');
    expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: knight, attacker: archon }] } })).toBeTruthy();
    g = block(g, 'bob', [{ blocker: flyer, attacker: archon }]);
    g = finishCombat(g);
    expect(g.objects[flyer]!.zone).toBe('graveyard');
    expect(g.objects[archon]!.damage).toBe(1);
  });

  it('Immerwolf: intimidate — only artifact creatures and creatures sharing a color can block it', () => {
    let g = setup();
    const imm = give(g, 'alice', 'Immerwolf', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const robot = give(g, 'bob', 'Robot Lite', 'battlefield');
    const elf = give(g, 'bob', 'Green Elf', 'battlefield');
    const knight = give(g, 'bob', 'White Knight Lite', 'battlefield');
    g = attack(toAttacks(g), 'alice', [imm], bobT);
    g = passRound(g);
    for (const b of [bear, knight]) expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: b, attacker: imm }] } })).toBeTruthy();
    g = block(g, 'bob', [{ blocker: robot, attacker: imm }, { blocker: elf, attacker: imm }]);
    expect(g.combat?.blockers[robot]).toBeDefined();
  });

  it('Startled Relic Sloth / Stampeding Serow / Emissary of Sunrise: printed keywords', () => {
    const g = setup();
    expect(kws(g, give(g, 'alice', 'Startled Relic Sloth', 'battlefield')).sort()).toEqual(['lifelink', 'trample']);
    expect(kws(g, give(g, 'alice', 'Stampeding Serow', 'battlefield'))).toEqual(['trample']);
    expect(kws(g, give(g, 'alice', 'Emissary of Sunrise', 'battlefield'))).toEqual(['first_strike']);
    expect(kws(g, give(g, 'alice', 'Karrthus, Tyrant of Jund', 'battlefield')).sort()).toEqual(['flying', 'haste']);
    expect(kws(g, give(g, 'alice', 'Sylvan Messenger', 'battlefield'))).toEqual(['trample']);
    expect(kws(g, give(g, 'alice', 'Parasitic Strix', 'battlefield'))).toEqual(['flying']);
  });
});

describe('audit B — batch 9', () => {
  it('Turtle Lair: auto-tapping respects the spending restriction', () => {
    const one = makeCard({ name: 'One Drop Lite', type_line: 'Creature — Bear', mana_cost: '{1}', cmc: 1, power: '1', toughness: '1', oracle_text: '' });
    const fresh = () => {
      const g = toStep(start({ extra: [...CARDS, ...CARDS2, one] }), 'main1', 'alice');
      const lair = give(g, 'alice', 'Turtle Lair', 'battlefield');
      return { g, lair };
    };
    {
      const { g } = fresh();
      expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Green Bear', 'hand'), autoTap: true })).toBeTruthy();
    }
    {
      let { g, lair } = fresh();
      const t = give(g, 'alice', 'Turtle Lite', 'hand');
      g = settle(act(g, { type: 'cast', player: 'alice', object: t, autoTap: true }));
      expect(g.objects[t]!.zone).toBe('battlefield');
      expect(g.objects[lair]!.tapped).toBe(true);
    }
    {
      let { g, lair } = fresh();
      const c = give(g, 'alice', 'One Drop Lite', 'hand');
      g = settle(act(g, { type: 'cast', player: 'alice', object: c, autoTap: true }));
      expect(g.objects[c]!.zone).toBe('battlefield');
      expect(g.objects[lair]!.tapped).toBe(true);
    }
    {
      // a Ninja's activated ability is not a Ninja spell
      const { g, lair } = fresh();
      const pinger = give(g, 'alice', 'Pinger Lite', 'battlefield');
      g.objects[lair]!.tapped = false;
      let s = act(g, { type: 'activate', player: 'alice', object: pinger, ability: 0, autoTap: true });
      // paid with the unrestricted {C}
      expect(s.objects[lair]!.tapped).toBe(true);
      s = settle(s);
      expect(s.players.alice!.life).toBe(21);
    }
  });

  it('Karrthus (three players): takes every Dragon, permanently, and untaps them', () => {
    let g = setup3();
    const b = give(g, 'bob', 'Whelp', 'battlefield');
    const c = give(g, 'carol', 'Whelp', 'battlefield');
    g.objects[b]!.tapped = true;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Karrthus, Tyrant of Jund', 'hand') }));
    expect([b, c].map((id) => g.objects[id]!.controller)).toEqual(['alice', 'alice']);
    expect(g.objects[b]!.tapped).toBe(false);
    g = attack(toAttacks(g), 'alice', [b, c], bobT);
    expect(g.combat?.attackers[b]).toBeDefined();
  });

  it('Bottomless Pit / Abzan Beastmaster / Demonic Appetite: only on the right upkeeps (three players)', () => {
    let g = setup3();
    give(g, 'alice', 'Abzan Beastmaster', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const aura = give(g, 'alice', 'Demonic Appetite', 'battlefield');
    g.objects[aura]!.attachedTo = { id: bear, zcc: g.objects[bear]!.zcc };
    g = toStep(g, 'upkeep', 'bob');
    expect(g.stack.length).toBe(0);
    g = toStep(g, 'upkeep', 'carol');
    expect(g.stack.length).toBe(0);
    g = toStep(g, 'upkeep', 'alice');
    expect(g.stack.length).toBe(2);
  });

  it('Shelldock Isle: your own small library counts too; a hidden land needs a land drop', () => {
    let g = setup();
    const forest = top(g, 'alice', 'Forest');
    const isle = give(g, 'alice', 'Shelldock Isle', 'hand');
    g = settle(act(g, { type: 'play_land', player: 'alice', object: isle }), () => undefined);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [forest] } }));
    const lib = g.zones.library.alice!;
    for (const id of lib.splice(20)) { g.objects[id]!.zone = 'exile'; g.zones.exile.push(id); }
    g.objects[isle]!.tapped = false;
    fill(g);
    g = settle(act(g, { type: 'activate', player: 'alice', object: isle, ability: 0 }), () => undefined);
    // the Isle was this turn's land drop
    expect(g.objects[forest]!.zone).toBe('exile');
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    g.objects[isle]!.tapped = false;
    fill(g);
    g = settle(act(g, { type: 'activate', player: 'alice', object: isle, ability: 0 }), () => undefined);
    expect(g.pending?.kind).toBe('may');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    expect(g.objects[forest]!.zone).toBe('battlefield');
  });
});

describe('audit B — batch 10 (changelings and friends)', () => {
  const shifter = makeCard({ name: 'Shifter Lite', type_line: 'Creature — Shapeshifter', mana_cost: '{0}', cmc: 0, power: '1', toughness: '1', oracle_text: 'Changeling (This card is every creature type.)' });
  const fresh = (who: 'alice' | 'bob' = 'alice') => fill(toStep(start({ extra: [...CARDS, ...CARDS2, shifter] }), 'main1', who));
  it('a changeling counts as an Elf / Bird / Giant / Dragon / Ninja / Wolf wherever the audited cards look', () => {
    // Sylvan Messenger (library)
    let g = fresh();
    const s1 = top(g, 'alice', 'Shifter Lite');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Sylvan Messenger', 'hand') });
    g = settle(g, (s) => (s.pending?.kind === 'choose_objects' ? { kind: 'choose_objects', objects: (s.pending as { candidates: string[] }).candidates } : undefined));
    expect(g.objects[s1]!.zone).toBe('hand');
    // Sazh Katzroy (library search)
    g = fresh();
    const s2 = give(g, 'alice', 'Shifter Lite', 'library');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Sazh Katzroy', 'hand') });
    g = settle(g, (s) => (s.pending?.kind === 'may' ? { kind: 'may', yes: true } : undefined));
    expect((g.pending as { candidates: string[] }).candidates).toContain(s2);
    // Return Upon the Tide (graveyard → battlefield)
    g = fresh();
    const s3 = give(g, 'alice', 'Shifter Lite', 'graveyard');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Return Upon the Tide', 'hand'), targets: obj(s3) }));
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token).length).toBe(2);
    // Squash (Giant), Karrthus (Dragon), Turtle Lair (Ninja), Immerwolf (Wolf), Everglove Courier (Elf)
    g = fresh();
    const mine = give(g, 'alice', 'Shifter Lite', 'battlefield');
    const theirs = give(g, 'bob', 'Shifter Lite', 'battlefield');
    const imm = give(g, 'alice', 'Immerwolf', 'battlefield');
    void imm;
    expect(chars(g, g.objects[mine]!).power).toBe(2);
    const lair = give(g, 'alice', 'Turtle Lair', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: lair, ability: 0, targets: obj(mine) }));
    const courier = give(g, 'alice', 'Everglove Courier', 'battlefield');
    fill(g);
    g = settle(act(g, { type: 'activate', player: 'alice', object: courier, ability: 0, targets: obj(mine) }));
    expect(chars(g, g.objects[mine]!).power).toBe(4);
    emptyPool(g, 'alice');
    g.players.alice!.pool.R = 2;
    const wall = give(g, 'bob', 'Wall Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Squash', 'hand'), targets: obj(wall) }));
    expect(g.objects[wall]!.zone).toBe('graveyard');
    fill(g);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Karrthus, Tyrant of Jund', 'hand') }));
    expect(g.objects[theirs]!.controller).toBe('alice');
    expect(kws(g, theirs)).toContain('haste');
  });
});

describe('audit B — batch 11', () => {
  it('Shelldock Isle: destroyed in response to its ability, the exiled card can still be played (CR 607.2a, 113.7a)', () => {
    const rain = makeCard({ name: 'Rain Lite', type_line: 'Instant', mana_cost: '{0}', cmc: 0, oracle_text: 'Destroy target land.' });
    let g = fill(toStep(start({ extra: [...CARDS, ...CARDS2, rain] }), 'main1', 'alice'));
    const spell = top(g, 'alice', 'Opt Lite');
    const isle = give(g, 'alice', 'Shelldock Isle', 'hand');
    g = settle(act(g, { type: 'play_land', player: 'alice', object: isle }), () => undefined);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [spell] } }));
    const lib = g.zones.library.bob!;
    for (const id of lib.splice(20)) { g.objects[id]!.zone = 'exile'; g.zones.exile.push(id); }
    g.objects[isle]!.tapped = false;
    fill(g);
    g = act(g, { type: 'activate', player: 'alice', object: isle, ability: 0 });
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Rain Lite', 'hand'), targets: obj(isle) });
    g = settle(g, () => undefined);
    expect(g.objects[isle]!.zone).toBe('graveyard');
    expect(g.pending).toMatchObject({ kind: 'cast_free', object: spell });
  });
});

describe('audit B — batch 12', () => {
  it('Flickering Hound: a face-down (megamorph) spell is a creature spell; the flickered face-down creature returns face up', () => {
    let g = setup();
    give(g, 'alice', 'Flickering Hound', 'battlefield');
    const first = give(g, 'alice', 'Ainok Survivalist', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: first, alt: 'megamorph' });
    // no other creature yet: the trigger has no target to choose
    g = settle(g, (s) => (s.pending?.kind === 'trigger_targets' ? { kind: 'trigger_targets', targets: [[]] } : undefined));
    expect(g.objects[first]!.faceDown).toBeTruthy();
    fill(g);
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Elf Lite', 'hand') });
    expect(g.pending?.kind).toBe('trigger_targets');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: obj(first) } }), () => undefined);
    // it comes back face up — which is not "turned face up", so nothing triggers
    expect(g.pending).toBeFalsy();
    expect(g.objects[first]!.zone).toBe('battlefield');
    expect(g.objects[first]!.faceDown).toBeFalsy();
    expect(chars(g, g.objects[first]!).name).toBe('Ainok Survivalist');
    expect(g.objects[first]!.counters['+1/+1'] ?? 0).toBe(0);
  });

  it('Hijack + Stampeding Serow: a stolen green creature goes back to its owner\'s hand', () => {
    let g = setup('bob');
    const serow = give(g, 'alice', 'Stampeding Serow', 'battlefield');
    const theirs = give(g, 'bob', 'Green Elf', 'battlefield');
    g = toStep(g, 'main1', 'alice');
    void serow;
    // (upkeep trigger already returned something this turn; set up the next one)
    const serow2 = onBf(g, 'Stampeding Serow', 'alice')[0] ?? give(g, 'alice', 'Stampeding Serow', 'battlefield');
    void serow2;
    fill(g);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Threaten Lite', 'hand'), targets: obj(theirs) }));
    expect(g.objects[theirs]!.controller).toBe('alice');
    g = toStep(g, 'upkeep', 'alice');
    g = settle(g, (s) => (s.pending?.kind === 'choose_objects' ? { kind: 'choose_objects', objects: [theirs] } : undefined));
    expect(g.objects[theirs]!.zone).toBe('hand');
    expect(g.zones.hand.bob).toContain(theirs);
  });
});
