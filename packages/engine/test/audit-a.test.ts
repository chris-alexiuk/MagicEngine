import { describe, expect, it } from 'vitest';
import { chars, type GameState } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

// The November 2026 grading audit, sample A: 60 random "full" cards from the 5,000 most played, each played through
// the engine with its real Oracle text and checked against what the rules require. The cases the audit found wrong
// (Adventures, cards with no mana cost, Auras entering without being cast, extra-token replacements, a defined X used
// in a later sentence) are regression tests now.

const CARDS = [
  // --- helpers -------------------------------------------------------------------------------------------------
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{0}', cmc: 0, power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Big Hamster', type_line: 'Creature — Hamster', mana_cost: '{0}', cmc: 0, power: '3', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Murder Lite', type_line: 'Instant', mana_cost: '{0}', cmc: 0, oracle_text: 'Destroy target creature.' }),
  makeCard({ name: 'Glory Lite', type_line: 'Enchantment', mana_cost: '{0}', cmc: 0, oracle_text: 'Creatures you control get +1/+1.' }),
  makeCard({ name: 'Strength Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', cmc: 0, oracle_text: 'Enchant creature\nEnchanted creature gets +1/+2.' }),
  makeCard({ name: 'Nonbasic Lite', type_line: 'Land', mana_cost: '', cmc: 0, oracle_text: '{T}: Add {C}.' }),
  // --- audited cards (real text) -------------------------------------------------------------------------------
  makeCard({
    name: 'Minsc & Boo, Timeless Heroes', type_line: 'Legendary Planeswalker — Minsc', mana_cost: '{2}{R}{G}', cmc: 4, loyalty: '3',
    oracle_text: "When Minsc & Boo enters and at the beginning of your upkeep, you may create Boo, a legendary 1/1 red Hamster creature token with trample and haste.\n+1: Put three +1/+1 counters on up to one target creature with trample or haste.\n−2: Sacrifice a creature. When you do, Minsc & Boo deals X damage to any target, where X is that creature's power. If the sacrificed creature was a Hamster, draw X cards.\nMinsc & Boo, Timeless Heroes can be your commander.",
  }),
  makeCard({
    name: 'Resurgent Belief', type_line: 'Sorcery', mana_cost: '', cmc: 0, colors: ['W'],
    oracle_text: 'Suspend 2—{1}{W} (Rather than cast this card from your hand, pay {1}{W} and exile it with two time counters on it. At the beginning of your upkeep, remove a time counter. When the last is removed, you may cast it without paying its mana cost.)\nReturn all enchantment cards from your graveyard to the battlefield. (Auras with nothing to enchant remain in your graveyard.)',
  }),
  makeCard({
    name: 'Volatile Fault', type_line: 'Land — Cave', mana_cost: '', cmc: 0,
    oracle_text: '{T}: Add {C}.\n{1}, {T}, Sacrifice this land: Destroy target nonbasic land an opponent controls. That player may search their library for a basic land card, put it onto the battlefield, then shuffle. You create a Treasure token.',
  }),
  makeCard({
    name: 'Akroan Horse', type_line: 'Artifact Creature — Horse', mana_cost: '{4}', cmc: 4, power: '0', toughness: '4',
    oracle_text: 'Defender\nWhen this creature enters, an opponent gains control of it.\nAt the beginning of your upkeep, each opponent creates a 1/1 white Soldier creature token.',
  }),
  makeCard({
    name: 'Undying Malice', type_line: 'Instant', mana_cost: '{B}', cmc: 1,
    oracle_text: 'Until end of turn, target creature gains "When this creature dies, return it to the battlefield tapped under its owner\'s control with a +1/+1 counter on it."',
  }),
  makeCard({ name: 'Black Murder', type_line: 'Instant', mana_cost: '{B}', cmc: 1, colors: ['B'], oracle_text: 'Destroy target creature.' }),
  makeCard({ name: 'Red Zap', type_line: 'Instant', mana_cost: '{R}', cmc: 1, colors: ['R'], oracle_text: 'Red Zap deals 1 damage to any target.' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{0}', cmc: 0, power: '5', toughness: '5', oracle_text: '' }),
  makeCard({ name: 'Two Drop', type_line: 'Creature — Human', mana_cost: '{2}', cmc: 2, power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Warden Lite', type_line: 'Creature — Human Cleric', mana_cost: '{0}', cmc: 0, power: '1', toughness: '1', oracle_text: 'Whenever another creature enters, you gain 1 life.' }),
  makeCard({ name: 'Visionary Lite', type_line: 'Creature — Elf Shaman', mana_cost: '{0}', cmc: 0, power: '1', toughness: '1', oracle_text: 'When this creature enters, draw a card.' }),
  makeCard({ name: 'Treasure Maker', type_line: 'Sorcery', mana_cost: '{0}', cmc: 0, oracle_text: 'Create two Treasure tokens.' }),
  makeCard({ name: 'Soldier Maker', type_line: 'Sorcery', mana_cost: '{0}', cmc: 0, oracle_text: 'Create a 1/1 white Soldier creature token.' }),
  makeCard({ name: 'Trinket', type_line: 'Artifact', mana_cost: '{0}', cmc: 0, oracle_text: '' }),
  makeCard({ name: 'Zap Lite', type_line: 'Instant', mana_cost: '{0}', cmc: 0, oracle_text: 'Zap Lite deals 1 damage to any target.' }),
  makeCard({
    name: 'Marang River Regent // Coil and Catch', layout: 'adventure', type_line: 'Creature — Dragon // Instant — Omen', mana_cost: '{4}{U}{U}', cmc: 6, oracle_text: '',
    card_faces: [
      { object: 'card_face', name: 'Marang River Regent', type_line: 'Creature — Dragon', mana_cost: '{4}{U}{U}', power: '6', toughness: '7', oracle_text: "Flying\nWhen this creature enters, return up to two other target nonland permanents to their owners' hands." },
      { object: 'card_face', name: 'Coil and Catch', type_line: 'Instant — Omen', mana_cost: '{3}{U}', oracle_text: "Draw three cards, then discard a card. (Then shuffle this card into its owner's library.)" },
    ],
  } as never),
  makeCard({
    name: 'Bonecrusher Giant // Stomp', layout: 'adventure', type_line: 'Creature — Giant // Instant — Adventure', mana_cost: '{2}{R}', cmc: 3, oracle_text: '',
    card_faces: [
      { object: 'card_face', name: 'Bonecrusher Giant', type_line: 'Creature — Giant', mana_cost: '{2}{R}', power: '4', toughness: '3', oracle_text: "Whenever this creature becomes the target of a spell, this creature deals 2 damage to that spell's controller." },
      { object: 'card_face', name: 'Stomp', type_line: 'Instant — Adventure', mana_cost: '{1}{R}', oracle_text: "Damage can't be prevented this turn. Stomp deals 2 damage to any target. (Then exile this card. You may cast the creature later from exile.)" },
    ],
  } as never),
  makeCard({
    name: 'Ojer Pakpatiq, Deepest Epoch // Temple of Cyclical Time', layout: 'transform', type_line: 'Legendary Creature — God // Land', mana_cost: '{2}{U}{U}', cmc: 4, oracle_text: '',
    card_faces: [
      { object: 'card_face', name: 'Ojer Pakpatiq, Deepest Epoch', type_line: 'Legendary Creature — God', mana_cost: '{2}{U}{U}', power: '4', toughness: '3', oracle_text: "Flying\nWhenever you cast an instant spell from your hand, it gains rebound. (Exile it as it resolves. At the beginning of your next upkeep, you may cast it from exile without paying its mana cost.)\nWhen Ojer Pakpatiq dies, return it to the battlefield tapped and transformed under its owner's control with three time counters on it." },
      { object: 'card_face', name: 'Temple of Cyclical Time', type_line: 'Land', mana_cost: '', oracle_text: '(Transforms from Ojer Pakpatiq, Deepest Epoch.)\n{T}: Add {U}. Remove a time counter from this land.\n{2}{U}, {T}: Transform this land. Activate only if it has no time counters on it and only as a sorcery.' },
    ],
  } as never),
  makeCard({ name: 'Yarok, the Desecrated', type_line: 'Legendary Creature — Elemental Horror', mana_cost: '{2}{B}{G}{U}', cmc: 5, power: '3', toughness: '5', oracle_text: 'Deathtouch, lifelink\nIf a permanent entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.' }),
  makeCard({ name: 'Infantry Shield', type_line: 'Artifact — Equipment', mana_cost: '{2}{R}', cmc: 3, oracle_text: 'Equipped creature has menace and mobilize X, where X is its power. (Whenever it attacks, create X tapped and attacking 1/1 red Warrior creature tokens. Sacrifice them at the beginning of the next end step.)\nEquip {2}' }),
  makeCard({ name: 'Golgari Thug', type_line: 'Creature — Human Warrior', mana_cost: '{1}{B}', cmc: 2, power: '1', toughness: '1', oracle_text: 'When this creature dies, put target creature card from your graveyard on top of your library.\nDredge 4 (If you would draw a card, you may mill four cards instead. If you do, return this card from your graveyard to your hand.)' }),
  makeCard({ name: 'Selvala, Heart of the Wilds', type_line: 'Legendary Creature — Elf Scout', mana_cost: '{1}{G}{G}', cmc: 3, power: '2', toughness: '3', oracle_text: "Whenever another creature enters, its controller may draw a card if its power is greater than each other creature's power.\n{G}, {T}: Add X mana in any combination of colors, where X is the greatest power among creatures you control." }),
  makeCard({ name: "Alseid of Life's Bounty", type_line: 'Enchantment Creature — Nymph', mana_cost: '{W}', cmc: 1, power: '1', toughness: '1', oracle_text: 'Lifelink\n{1}, Sacrifice this creature: Target creature or enchantment you control gains protection from the color of your choice until end of turn.' }),
  makeCard({
    name: 'Heliod, the Radiant Dawn // Heliod, the Warped Eclipse', layout: 'transform', type_line: 'Legendary Enchantment Creature — God // Legendary Enchantment Creature — Phyrexian God', mana_cost: '{2}{W}{W}', cmc: 4, oracle_text: '',
    card_faces: [
      { object: 'card_face', name: 'Heliod, the Radiant Dawn', type_line: 'Legendary Enchantment Creature — God', mana_cost: '{2}{W}{W}', power: '4', toughness: '4', oracle_text: "When Heliod enters, return target enchantment card that isn't a God from your graveyard to your hand.\n{3}{U/P}: Transform Heliod. Activate only as a sorcery. ({U/P} can be paid with either {U} or 2 life.)" },
      { object: 'card_face', name: 'Heliod, the Warped Eclipse', type_line: 'Legendary Enchantment Creature — Phyrexian God', mana_cost: '', power: '4', toughness: '6', oracle_text: 'You may cast spells as though they had flash.\nSpells you cast cost {1} less to cast for each card your opponents have drawn this turn.' },
    ],
  } as never),
  makeCard({ name: 'Worldwalker Helm', type_line: 'Artifact', mana_cost: '{2}{U}', cmc: 3, oracle_text: 'If you would create one or more artifact tokens, instead create those tokens plus an additional Map token. (It\'s an artifact with "{1}, {T}, Sacrifice this token: Target creature you control explores. Activate only as a sorcery.")\n{1}{U}, {T}: Create a token that\'s a copy of target artifact token you control.' }),
  makeCard({ name: 'Knuckles the Echidna', type_line: 'Legendary Creature — Echidna Warrior', mana_cost: '{2}{R}{R}', cmc: 4, power: '2', toughness: '4', oracle_text: 'Double strike, trample, haste\nWhenever one or more creatures you control deal combat damage to a player, create a Treasure token.\nTreasure Hunter — At the beginning of your upkeep, if you control thirty or more artifacts, you win the game.' }),
  makeCard({ name: "Explorer's Scope", type_line: 'Artifact — Equipment', mana_cost: '{1}', cmc: 1, oracle_text: "Whenever equipped creature attacks, look at the top card of your library. If it's a land card, you may put it onto the battlefield tapped.\nEquip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)" }),
  makeCard({ name: 'Swamp', type_line: 'Basic Land — Swamp', mana_cost: '', cmc: 0, oracle_text: '({T}: Add {B}.)' }),
  makeCard({ name: 'Golem', type_line: 'Artifact Creature — Golem', mana_cost: '{2}', cmc: 2, power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Mass Return', type_line: 'Sorcery', mana_cost: '{0}', cmc: 0, oracle_text: 'Return all creature cards from your graveyard to your hand.' }),
  makeCard({ name: 'Looter Lite', type_line: 'Sorcery', mana_cost: '{0}', cmc: 0, oracle_text: 'Draw a card, then discard a card.' }),
  makeCard({ name: 'Discard Lite', type_line: 'Sorcery', mana_cost: '{0}', cmc: 0, oracle_text: 'Discard a card.' }),
  makeCard({
    name: 'Charred Foyer // Warped Space', layout: 'split', type_line: 'Enchantment — Room // Enchantment — Room', mana_cost: '{3}{R} // {4}{R}{R}', cmc: 10, oracle_text: '',
    card_faces: [
      { object: 'card_face', name: 'Charred Foyer', type_line: 'Enchantment — Room', mana_cost: '{3}{R}', oracle_text: 'At the beginning of your upkeep, exile the top card of your library. You may play it this turn.\n(You may cast either half. That door unlocks on the battlefield. As a sorcery, you may pay the mana cost of a locked door to unlock it.)' },
      { object: 'card_face', name: 'Warped Space', type_line: 'Enchantment — Room', mana_cost: '{4}{R}{R}', oracle_text: 'Once each turn, you may pay {0} rather than pay the mana cost for a spell you cast from exile.\n(You may cast either half. That door unlocks on the battlefield. As a sorcery, you may pay the mana cost of a locked door to unlock it.)' },
    ],
  } as never),
  makeCard({ name: 'Cyberman Patrol', type_line: 'Artifact Creature — Cyberman', mana_cost: '{2}', cmc: 2, power: '2', toughness: '2', oracle_text: 'Artifact creatures you control have afflict 3. (Whenever a creature with afflict 3 becomes blocked, defending player loses 3 life.)' }),
  makeCard({ name: 'Tormod, the Desecrator', type_line: 'Legendary Creature — Zombie Wizard', mana_cost: '{3}{B}', cmc: 4, power: '4', toughness: '2', oracle_text: 'Whenever one or more cards leave your graveyard, create a tapped 2/2 black Zombie creature token.\nPartner (You can have two commanders if both have partner.)' }),
  makeCard({ name: "Hashaton, Scarab's Fist", type_line: 'Legendary Creature — Zombie Wizard', mana_cost: '{W}{B}', cmc: 2, power: '1', toughness: '3', oracle_text: "Whenever you discard a creature card, you may pay {2}{U}. If you do, create a tapped token that's a copy of that card, except it's a 4/4 black Zombie." }),
  makeCard({ name: 'The Mightstone and Weakstone', type_line: 'Legendary Artifact — Powerstone', mana_cost: '{5}', cmc: 5, oracle_text: "When The Mightstone and Weakstone enters, choose one —\n• Draw two cards.\n• Target creature gets -5/-5 until end of turn.\n{T}: Add {C}{C}. This mana can't be spent to cast nonartifact spells.\n(Melds with Urza, Lord Protector.)" }),
  makeCard({ name: 'The Great Henge', type_line: 'Legendary Artifact', mana_cost: '{7}{G}{G}', cmc: 9, oracle_text: 'This spell costs {X} less to cast, where X is the greatest power among creatures you control.\n{T}: Add {G}{G}. You gain 2 life.\nWhenever a nontoken creature you control enters, put a +1/+1 counter on it and draw a card.' }),
  makeCard({ name: 'Bubbling Muck', type_line: 'Sorcery', mana_cost: '{B}', cmc: 1, oracle_text: 'Until end of turn, whenever a player taps a Swamp for mana, that player adds an additional {B}.' }),
  makeCard({ name: 'Craterhoof Behemoth', type_line: 'Creature — Beast', mana_cost: '{5}{G}{G}{G}', cmc: 8, power: '5', toughness: '5', oracle_text: 'Haste\nWhen this creature enters, creatures you control gain trample and get +X/+X until end of turn, where X is the number of creatures you control.' }),
  makeCard({ name: 'Surly Badgersaur', type_line: 'Creature — Badger Dinosaur', mana_cost: '{3}{R}', cmc: 4, power: '3', toughness: '3', oracle_text: 'Whenever you discard a creature card, put a +1/+1 counter on this creature.\nWhenever you discard a land card, create a Treasure token. (It\'s an artifact with "{T}, Sacrifice this token: Add one mana of any color.")\nWhenever you discard a noncreature, nonland card, this creature fights up to one target creature you don\'t control.' }),
  makeCard({ name: 'Stitch Together', type_line: 'Sorcery', mana_cost: '{B}{B}', cmc: 2, oracle_text: 'Return target creature card from your graveyard to your hand.\nThreshold — Return that card from your graveyard to the battlefield instead if there are seven or more cards in your graveyard.' }),
  makeCard({ name: 'In the Darkness Bind Them', type_line: 'Enchantment — Saga', mana_cost: '{2}{U}{B}{R}', cmc: 5, oracle_text: '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after IV.)\nI, II, III — Create a 3/3 black Wraith creature token with menace. The Ring tempts you.\nIV — For each opponent, gain control of up to one target creature that player controls until end of turn. Untap those creatures. They gain haste until end of turn. The Ring tempts you.' }),
  makeCard({ name: 'Ashling, Flame Dancer', type_line: 'Legendary Creature — Elemental Shaman', mana_cost: '{2}{R}{R}', cmc: 4, power: '4', toughness: '4', oracle_text: "You don't lose unspent red mana as steps and phases end.\nMagecraft — Whenever you cast or copy an instant or sorcery spell, discard a card, then draw a card. If this is the second time this ability has resolved this turn, Ashling deals 2 damage to each opponent and each creature they control. If it's the third time, add {R}{R}{R}{R}." }),
  makeCard({ name: 'Galadhrim Brigade', type_line: 'Creature — Elf Soldier', mana_cost: '{2}{G}', cmc: 3, power: '2', toughness: '2', oracle_text: 'Squad {1}{G} (As an additional cost to cast this spell, you may pay {1}{G} any number of times. When this creature enters, create that many tokens that are copies of it.)\nOther Elves you control get +1/+1.' }),
  makeCard({ name: 'Infectious Bite', type_line: 'Instant', mana_cost: '{1}{G}', cmc: 2, oracle_text: "Target creature you control deals damage equal to its power to target creature you don't control. Each opponent gets a poison counter." }),
  makeCard({ name: 'Monumental Henge', type_line: 'Land', mana_cost: '', cmc: 0, oracle_text: 'This land enters tapped unless you control a Plains.\n{T}: Add {W}.\n{2}{W}{W}, {T}: Look at the top five cards of your library. You may reveal a historic card from among them and put it into your hand. Put the rest on the bottom of your library in a random order. (Artifacts, legendaries, and Sagas are historic.)' }),
  makeCard({ name: 'The Darkness Crystal', type_line: 'Legendary Artifact', mana_cost: '{2}{B}{B}', cmc: 4, oracle_text: 'Black spells you cast cost {1} less to cast.\nIf a nontoken creature an opponent controls would die, instead exile it and you gain 2 life.\n{4}{B}{B}, {T}: Put target creature card exiled with The Darkness Crystal onto the battlefield tapped under your control with two additional +1/+1 counters on it.' }),
  makeCard({ name: 'Black Bear', type_line: 'Creature — Bear', mana_cost: '{1}{B}', cmc: 2, power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Faerie Lite', type_line: 'Creature — Faerie', mana_cost: '{0}', cmc: 0, power: '1', toughness: '1', oracle_text: 'Flying' }),
  makeCard({ name: 'Mouse Lite', type_line: 'Creature — Mouse', mana_cost: '{0}', cmc: 0, power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Vampire Lite', type_line: 'Creature — Vampire', mana_cost: '{0}', cmc: 0, power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Elf Lite', type_line: 'Creature — Elf', mana_cost: '{0}', cmc: 0, power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Gate Lite', type_line: 'Land — Gate', mana_cost: '', cmc: 0, oracle_text: '{T}: Add {C}.' }),
  makeCard({ name: 'Plains', type_line: 'Basic Land — Plains', mana_cost: '', cmc: 0, oracle_text: '({T}: Add {W}.)' }),
  makeCard({ name: 'Eldrazi Lite', type_line: 'Creature — Eldrazi', mana_cost: '{7}', cmc: 7, power: '7', toughness: '7', oracle_text: '' }),
  makeCard({ name: 'Divination Lite', type_line: 'Sorcery', mana_cost: '{0}', cmc: 0, oracle_text: 'Draw two cards.' }),
  makeCard({ name: 'Twinferno', type_line: 'Instant', mana_cost: '{1}{R}', cmc: 2, oracle_text: 'Choose one —\n• When you cast your next instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.\n• Target creature you control gains double strike until end of turn. (It deals both first-strike and regular combat damage.)' }),
  makeCard({ name: 'Spell Stutter', type_line: 'Instant', mana_cost: '{1}{U}', cmc: 2, oracle_text: 'Counter target spell unless its controller pays {2} plus an additional {1} for each Faerie you control.' }),
  makeCard({ name: 'Astral Cornucopia', type_line: 'Artifact', mana_cost: '{X}{X}{X}', cmc: 0, oracle_text: 'This artifact enters with X charge counters on it.\n{T}: Choose a color. Add one mana of that color for each charge counter on this artifact.' }),
  makeCard({ name: 'Master Biomancer', type_line: 'Creature — Elf Wizard', mana_cost: '{2}{G}{U}', cmc: 4, power: '2', toughness: '4', oracle_text: "Each other creature you control enters with a number of additional +1/+1 counters on it equal to this creature's power and as a Mutant in addition to its other types." }),
  makeCard({ name: 'Farmer Cotton', type_line: 'Legendary Creature — Halfling Peasant', mana_cost: '{X}{G}{W}', cmc: 2, power: '1', toughness: '1', oracle_text: 'When this creature enters, create X 1/1 white Halfling creature tokens and X Food tokens. (They\'re artifacts with "{2}, {T}, Sacrifice this token: You gain 3 life.")' }),
  makeCard({ name: 'Weftstalker Ardent', type_line: 'Creature — Drix Artificer', mana_cost: '{2}{R}', cmc: 3, power: '2', toughness: '3', oracle_text: 'Whenever another creature or artifact you control enters, this creature deals 1 damage to each opponent.\nWarp {R} (You may cast this card from your hand for its warp cost. Exile this creature at the beginning of the next end step, then you may cast it from exile on a later turn.)' }),
  makeCard({ name: 'Fire Nation Palace', type_line: 'Land', mana_cost: '', cmc: 0, oracle_text: 'This land enters tapped unless you control a basic land.\n{T}: Add {R}.\n{1}{R}, {T}: Target creature you control gains firebending 4 until end of turn. (Whenever it attacks, add {R}{R}{R}{R}. This mana lasts until end of combat.)' }),
  makeCard({
    name: 'Witch Enchanter // Witch-Blessed Meadow', layout: 'modal_dfc', type_line: 'Creature — Human Warlock // Land', mana_cost: '{3}{W}', cmc: 4, oracle_text: '',
    card_faces: [
      { object: 'card_face', name: 'Witch Enchanter', type_line: 'Creature — Human Warlock', mana_cost: '{3}{W}', power: '2', toughness: '2', oracle_text: 'When this creature enters, destroy target artifact or enchantment an opponent controls.' },
      { object: 'card_face', name: 'Witch-Blessed Meadow', type_line: 'Land', mana_cost: '', oracle_text: "As this land enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {W}." },
    ],
  } as never),
  makeCard({ name: 'Siege-Gang Commander', type_line: 'Creature — Goblin', mana_cost: '{3}{R}{R}', cmc: 5, power: '2', toughness: '2', oracle_text: 'When this creature enters, create three 1/1 red Goblin creature tokens.\n{1}{R}, Sacrifice a Goblin: This creature deals 2 damage to any target.' }),
  makeCard({ name: 'Gamble', type_line: 'Sorcery', mana_cost: '{R}', cmc: 1, oracle_text: 'Search your library for a card, put that card into your hand, discard a card at random, then shuffle.' }),
  makeCard({ name: 'Liquimetal Coating', type_line: 'Artifact', mana_cost: '{2}', cmc: 2, oracle_text: '{T}: Target permanent becomes an artifact in addition to its other types until end of turn.' }),
  makeCard({ name: 'Prince Imrahil the Fair', type_line: 'Legendary Creature — Human Noble', mana_cost: '{W}{U}', cmc: 2, power: '2', toughness: '2', oracle_text: 'Whenever you draw your second card each turn, create a 1/1 white Human Soldier creature token.' }),
  makeCard({ name: 'Serra Ascendant', type_line: 'Creature — Human Monk', mana_cost: '{W}', cmc: 1, power: '1', toughness: '1', oracle_text: 'Lifelink (Damage dealt by this creature also causes you to gain that much life.)\nAs long as you have 30 or more life, this creature gets +5/+5 and has flying.' }),
  makeCard({ name: 'Aphetto Alchemist', type_line: 'Creature — Human Wizard', mana_cost: '{1}{U}', cmc: 2, power: '1', toughness: '2', oracle_text: '{T}: Untap target artifact or creature.\nMorph {U} (You may cast this card face down as a 2/2 creature for {3}. Turn it face up any time for its morph cost.)' }),
  makeCard({ name: 'Might of the Meek', type_line: 'Instant', mana_cost: '{R}', cmc: 1, oracle_text: 'Target creature gains trample until end of turn. It also gets +1/+0 until end of turn if you control a Mouse.\nDraw a card.' }),
  makeCard({ name: 'Basilisk Gate', type_line: 'Land — Gate', mana_cost: '', cmc: 0, oracle_text: '{T}: Add {C}.\n{2}, {T}: Target creature gets +X/+X until end of turn, where X is the number of Gates you control. Activate only as a sorcery.' }),
  makeCard({ name: 'Chittering Witch', type_line: 'Creature — Human Warlock', mana_cost: '{3}{B}', cmc: 4, power: '2', toughness: '2', oracle_text: 'When this creature enters, create a number of 1/1 black Rat creature tokens equal to the number of opponents you have.\n{1}{B}, Sacrifice a creature: Target creature gets -2/-2 until end of turn.' }),
  makeCard({ name: 'From Beyond', type_line: 'Enchantment', mana_cost: '{3}{G}', cmc: 4, colors: [], oracle_text: 'Devoid (This card has no color.)\nAt the beginning of your upkeep, create a 1/1 colorless Eldrazi Scion creature token. It has "Sacrifice this token: Add {C}."\n{1}{G}, Sacrifice this enchantment: Search your library for an Eldrazi card, reveal it, put it into your hand, then shuffle.' }),
  makeCard({ name: "Rogue's Gloves", type_line: 'Artifact — Equipment', mana_cost: '{2}', cmc: 2, oracle_text: 'Whenever equipped creature deals combat damage to a player, you may draw a card.\nEquip {2} ({2}: Attach to target creature you control. Equip only as a sorcery.)' }),
  makeCard({ name: 'Unruly Catapult', type_line: 'Artifact Creature — Construct', mana_cost: '{2}{R}', cmc: 3, power: '0', toughness: '4', oracle_text: 'Defender\n{T}: This creature deals 1 damage to each opponent.\nWhenever you cast an instant or sorcery spell, untap this creature.' }),
  makeCard({ name: 'Stromkirk Captain', type_line: 'Creature — Vampire Soldier', mana_cost: '{1}{B}{R}', cmc: 3, power: '2', toughness: '2', oracle_text: 'First strike\nOther Vampire creatures you control get +1/+1 and have first strike.' }),
  makeCard({ name: 'Secluded Steppe', type_line: 'Land', mana_cost: '', cmc: 0, oracle_text: 'This land enters tapped.\n{T}: Add {W}.\nCycling {W} ({W}, Discard this card: Draw a card.)' }),
  makeCard({ name: 'Vibrant Cityscape', type_line: 'Land', mana_cost: '', cmc: 0, oracle_text: '{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.' }),
  makeCard({ name: 'Bone Shards', type_line: 'Sorcery', mana_cost: '{B}', cmc: 1, oracle_text: 'As an additional cost to cast this spell, sacrifice a creature or discard a card.\nDestroy target creature or planeswalker.' }),
  makeCard({ name: 'Auramancer', type_line: 'Creature — Human Wizard', mana_cost: '{2}{W}', cmc: 3, power: '2', toughness: '2', oracle_text: 'When this creature enters, you may return target enchantment card from your graveyard to your hand.' }),
  makeCard({ name: 'Changeling Wayfinder', type_line: 'Creature — Shapeshifter', mana_cost: '{3}', cmc: 3, power: '1', toughness: '2', oracle_text: 'Changeling (This card is every creature type.)\nWhen this creature enters, you may search your library for a basic land card, reveal it, put it into your hand, then shuffle.' }),
  makeCard({ name: 'Investigate Lite', type_line: 'Sorcery', mana_cost: '{0}', cmc: 0, oracle_text: 'Investigate.' }),
  makeCard({ name: 'Thopter Maker', type_line: 'Sorcery', mana_cost: '{0}', cmc: 0, oracle_text: 'Create two 1/1 colorless Thopter artifact creature tokens with flying.' }),
  makeCard({ name: 'Landfall Lite', type_line: 'Creature — Elemental', mana_cost: '{0}', cmc: 0, power: '1', toughness: '1', oracle_text: 'Landfall — Whenever a land you control enters, you gain 1 life.' }),
  makeCard({ name: 'Prowess Lite', type_line: 'Creature — Monk', mana_cost: '{0}', cmc: 0, power: '1', toughness: '1', oracle_text: 'Whenever you cast a noncreature spell, you gain 1 life.' }),
  makeCard({ name: 'Dier Lite', type_line: 'Creature — Spirit', mana_cost: '{0}', cmc: 0, power: '1', toughness: '1', oracle_text: 'When this creature dies, you gain 1 life.' }),
  makeCard({ name: 'Forest', type_line: 'Basic Land — Forest', mana_cost: '', cmc: 0, oracle_text: '({T}: Add {G}.)' }),
  makeCard({ name: 'Peregrin Took', type_line: 'Legendary Creature — Halfling Citizen', mana_cost: '{2}{G}', cmc: 3, power: '2', toughness: '3', oracle_text: 'If one or more tokens would be created under your control, those tokens plus an additional Food token are created instead. (It\'s an artifact with "{2}, {T}, Sacrifice this token: You gain 3 life.")\nSacrifice three Foods: Draw a card.' }),
  makeCard({ name: 'Token Watcher', type_line: 'Enchantment', mana_cost: '{0}', cmc: 0, oracle_text: 'Whenever one or more tokens you control enter, you gain 1 life.' }),
  makeCard({ name: 'Sun Titan', type_line: 'Creature — Giant', mana_cost: '{4}{W}{W}', cmc: 6, power: '6', toughness: '6', oracle_text: 'Vigilance\nWhenever this creature enters or attacks, you may return target permanent card with mana value 3 or less from your graveyard to the battlefield.' }),
  makeCard({ name: 'Zur the Enchanter', type_line: 'Legendary Creature — Human Wizard', mana_cost: '{1}{W}{U}{B}', cmc: 4, power: '1', toughness: '4', oracle_text: 'Flying\nWhenever Zur attacks, you may search your library for an enchantment card with mana value 3 or less, put it onto the battlefield, then shuffle.' }),
  makeCard({ name: 'Incubate Lite', type_line: 'Sorcery', mana_cost: '{0}', cmc: 0, oracle_text: 'Incubate 2. (Create an Incubator token with two +1/+1 counters on it and "{2}: Transform this token." It transforms into a 0/0 Phyrexian artifact creature.)' }),
  makeCard({ name: 'Populate Lite', type_line: 'Sorcery', mana_cost: '{0}', cmc: 0, oracle_text: "Populate. (Create a token that's a copy of a creature token you control.)" }),
];

const obj = (id: string) => ({ kind: 'object' as const, object: id });
const plr = (p: string) => ({ kind: 'player' as const, player: p });

type Answerer = (g: GameState) => unknown;
/** Passes priority until the stack is empty; pending choices go to `answer` (stop when it returns nothing). */
function settle(g: GameState, answer?: Answerer): GameState {
  for (let i = 0; i < 80 && (g.stack.length || g.pending); i++) {
    if (g.pending) {
      const a = answer?.(g);
      if (!a) break;
      g = act(g, { type: 'choose', player: (g.pending as { player: string }).player, answer: a } as never);
    } else g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
}
/** From a main phase: passes to the declare-attackers choice and declares these attackers at `defender`. */
function attackWith(g: GameState, attackers: string[], defender = 'bob'): GameState {
  for (let i = 0; i < 20 && g.pending?.kind !== 'declare_attackers'; i++) {
    if (g.pending) throw new Error(`unexpected pending ${g.pending.kind}`);
    g = act(g, { type: 'pass', player: g.priority! });
  }
  return act(g, { type: 'choose', player: (g.pending as { player: string }).player, answer: { kind: 'declare_attackers', attacks: attackers.map((attacker) => ({ attacker, target: { kind: 'player', player: defender } })) } } as never);
}
/** Plays combat out to the second main phase. */
function finishCombat(g: GameState, blocks: { blocker: string; attacker: string }[] = [], answer?: Answerer): GameState {
  for (let i = 0; i < 120 && g.step !== 'main2'; i++) {
    if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks } } as never);
    else if (g.pending) {
      const a = answer?.(g);
      if (!a) break;
      g = act(g, { type: 'choose', player: (g.pending as { player: string }).player, answer: a } as never);
    } else g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
}
const toTop = (g: GameState, player: string, id: string) => {
  const lib = g.zones.library[player]!;
  lib.splice(lib.indexOf(id), 1);
  lib.unshift(id);
};
/** Passes priority (declaring no attackers/blockers, discarding to hand size) until `done`; other choices go to `answer`. */
function advance(g: GameState, done: (g: GameState) => boolean, answer?: Answerer): GameState {
  for (let i = 0; i < 600 && !g.over && !done(g); i++) {
    const p = g.pending;
    if (p?.kind === 'declare_attackers') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'declare_attackers', attacks: [] } });
    else if (p?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'declare_blockers', blocks: [] } });
    else if (p?.kind === 'discard_to_hand_size') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'discard_to_hand_size', objects: g.zones.hand[p.player]!.slice(0, p.count) } });
    else if (p) {
      const a = answer?.(g);
      if (!a) throw new Error(`unanswered pending ${p.kind}: ${JSON.stringify(p).slice(0, 400)}`);
      g = act(g, { type: 'choose', player: (p as { player: string }).player, answer: a } as never);
    } else g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
}
const tokens = (g: GameState, player: string, re: RegExp) => g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === player && re.test(g.objects[id]!.card));

describe('audit A', () => {
  it('Minsc & Boo −2: sacrificing a Hamster deals X damage AND draws X cards (X = its power)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const minsc = give(g, 'alice', 'Minsc & Boo, Timeless Heroes', 'battlefield');
    g.objects[minsc]!.counters.loyalty = 3;
    const hamster = give(g, 'alice', 'Big Hamster', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'activate', player: 'alice', object: minsc, ability: 1 });
    g = settle(g, (s) => {
      const p = s.pending!;
      if (p.kind === 'sacrifice') return { kind: 'sacrifice', objects: [hamster] };
      if (p.kind === 'trigger_targets') return { kind: 'trigger_targets', targets: [[plr('bob')]] };
      return undefined;
    });
    expect(g.pending).toBeNull();
    expect(g.objects[hamster]!.zone).toBe('graveyard');
    expect(g.players.bob!.life).toBe(17);
    expect(g.zones.hand.alice!.length - hand).toBe(3);
  });

  it('Resurgent Belief: an Aura returns attached to something it can enchant (CR 303.4f)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const glory = give(g, 'alice', 'Glory Lite', 'graveyard');
    const aura = give(g, 'alice', 'Strength Lite', 'graveyard');
    const belief = give(g, 'alice', 'Resurgent Belief', 'hand');
    g.players.alice!.pool.W = 2;
    g = act(g, { type: 'suspend', player: 'alice', object: belief });
    expect(g.objects[belief]).toMatchObject({ zone: 'exile', counters: { time: 2 } });
    g = toStep(g, 'upkeep', 'bob');
    g = passRound(toStep(g, 'upkeep', 'alice'));
    g = toStep(g, 'upkeep', 'bob');
    g = passRound(toStep(g, 'upkeep', 'alice'));
    expect(g.pending).toMatchObject({ kind: 'cast_free', object: belief });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: true } });
    g = settle(g, (s) => {
      const p = s.pending!;
      if (p.kind === 'choose_objects') return { kind: 'choose_objects', objects: p.candidates.slice(0, Math.max(1, p.min)) };
      return undefined;
    });
    expect(g.objects[glory]!.zone).toBe('battlefield');
    expect(g.objects[aura]!.zone).toBe('battlefield');
    expect(g.objects[aura]!.attachedTo?.id).toBe(bear);
    expect(chars(g, g.objects[bear]!).toughness).toBe(2 + 1 + 2);
  });

  it('Volatile Fault: the destroyed land\'s controller may fetch a basic; you create a Treasure', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const fault = give(g, 'alice', 'Volatile Fault', 'battlefield');
    const land = give(g, 'bob', 'Nonbasic Lite', 'battlefield');
    g.players.alice!.pool.C = 1;
    const bobLands = () => g.zones.battlefield.filter((id) => g.objects[id]!.controller === 'bob' && chars(g, g.objects[id]!).types.includes('Land'));
    g = act(g, { type: 'activate', player: 'alice', object: fault, ability: 0, targets: [[obj(land)]] });
    let asked: string[] = [];
    g = settle(g, (s) => {
      const p = s.pending!;
      asked.push(`${p.kind}:${p.player}`);
      if (p.kind === 'may') return { kind: 'may', yes: true };
      if (p.kind === 'search') return { kind: 'search', objects: [p.candidates[0]!] };
      return undefined;
    });
    expect(asked).toEqual(['may:bob', 'search:bob']);
    expect(g.objects[fault]!.zone).toBe('graveyard');
    expect(g.objects[land]!.zone).toBe('graveyard');
    const lands = bobLands();
    expect(lands).toHaveLength(1);
    expect(chars(g, g.objects[lands[0]!]!).supertypes).toContain('Basic');
    expect(g.objects[lands[0]!]!.tapped).toBe(false);
    expect(tokens(g, 'alice', /Treasure/)).toHaveLength(1);
    expect(tokens(g, 'bob', /Treasure/)).toHaveLength(0);
  });

  it('Akroan Horse: an opponent gains control; on THEIR upkeep each of THEIR opponents gets a Soldier', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const horse = give(g, 'alice', 'Akroan Horse', 'hand');
    g.players.alice!.pool.C = 4;
    g = settle(act(g, { type: 'cast', player: 'alice', object: horse }));
    expect(g.objects[horse]!.zone).toBe('battlefield');
    expect(g.objects[horse]!.controller).toBe('bob');
    g = settle(toStep(g, 'upkeep', 'bob'));
    expect(tokens(g, 'alice', /Soldier/)).toHaveLength(1);
    expect(tokens(g, 'bob', /Soldier/)).toHaveLength(0);
    g = settle(toStep(g, 'upkeep', 'alice'));
    expect(tokens(g, 'alice', /Soldier/)).toHaveLength(1);
    expect(tokens(g, 'bob', /Soldier/)).toHaveLength(0);
  });

  it('Undying Malice: returns tapped with a +1/+1 counter, once', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g.players.alice!.pool.B = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Undying Malice', 'hand'), targets: [[obj(bear)]] }));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder Lite', 'hand'), targets: [[obj(bear)]] }));
    expect(g.objects[bear]).toMatchObject({ zone: 'battlefield', tapped: true, controller: 'alice' });
    expect(g.objects[bear]!.counters['+1/+1']).toBe(1);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder Lite', 'hand'), targets: [[obj(bear)]] }));
    expect(g.objects[bear]!.zone).toBe('graveyard');
  });
  it('Coil and Catch (Omen): as it resolves it is shuffled into its owner\'s library (CR 720.3d)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const regent = give(g, 'alice', 'Marang River Regent // Coil and Catch', 'hand');
    g.players.alice!.pool.U = 4;
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'cast', player: 'alice', object: regent, face: 1 });
    g = settle(g, (s) => (s.pending!.kind === 'discard' ? { kind: 'discard', objects: [s.zones.hand.alice![0]!] } : undefined));
    expect(g.pending).toBeNull();
    expect(g.zones.hand.alice!.length).toBe(hand - 1 + 3 - 1);
    expect(g.objects[regent]!.zone).toBe('library');
  });

  it('Stomp (Adventure): exiled as it resolves, and the creature may be cast from exile (CR 715.3d)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const giant = give(g, 'alice', 'Bonecrusher Giant // Stomp', 'hand');
    g.players.alice!.pool.R = 5;
    g = settle(act(g, { type: 'cast', player: 'alice', object: giant, face: 1, targets: [[plr('bob')]] }));
    expect(g.players.bob!.life).toBe(18);
    expect(g.objects[giant]!.zone).toBe('exile');
    g = settle(act(g, { type: 'cast', player: 'alice', object: giant }));
    expect(g.objects[giant]!.zone).toBe('battlefield');
  });

  it('Ojer Pakpatiq: dies → returns tapped, transformed, with three time counters; the Temple ticks down and flips back', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const ojer = give(g, 'alice', 'Ojer Pakpatiq, Deepest Epoch // Temple of Cyclical Time', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Murder Lite', 'hand'), targets: [[obj(ojer)]] }));
    expect(g.objects[ojer]).toMatchObject({ zone: 'battlefield', tapped: true, face: 1, controller: 'alice' });
    expect(g.objects[ojer]!.counters.time).toBe(3);
    expect(chars(g, g.objects[ojer]!).types).toEqual(['Land']);
    g = toStep(g, 'main1', 'alice');
    g = act(g, { type: 'activate_mana', player: 'alice', object: ojer, ability: 0 });
    expect(g.players.alice!.pool.U).toBe(1);
    expect(g.objects[ojer]!.counters.time).toBe(2);
    g.objects[ojer]!.tapped = false;
    g.players.alice!.pool.U = 3;
    expect(illegal(g, { type: 'activate', player: 'alice', object: ojer, ability: 0 })).toBeTruthy();
    g.objects[ojer]!.counters.time = 0;
    g = settle(act(g, { type: 'activate', player: 'alice', object: ojer, ability: 0 }));
    expect(g.objects[ojer]).toMatchObject({ zone: 'battlefield', face: 0 });
    expect(chars(g, g.objects[ojer]!).types).toContain('Creature');
  });

  it('Ojer Pakpatiq: an instant cast from hand rebounds — cast again free at your next upkeep, then to the graveyard', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Ojer Pakpatiq, Deepest Epoch // Temple of Cyclical Time', 'battlefield');
    const zap = give(g, 'alice', 'Zap Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: zap, targets: [[plr('bob')]] }));
    expect(g.players.bob!.life).toBe(19);
    expect(g.objects[zap]!.zone).toBe('exile');
    g = toStep(g, 'upkeep', 'bob');
    g = toStep(g, 'draw', 'bob');
    expect(g.objects[zap]!.zone).toBe('exile');
    g = passRound(toStep(g, 'upkeep', 'alice'));
    expect(g.pending).toMatchObject({ kind: 'cast_free', object: zap });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: true, targets: [[plr('bob')]] } } as never);
    g = settle(g);
    expect(g.players.bob!.life).toBe(18);
    expect(g.objects[zap]!.zone).toBe('graveyard');
  });

  it('Yarok: enters-triggers of permanents you control trigger twice; an opponent\'s do not', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Yarok, the Desecrated', 'battlefield');
    give(g, 'alice', 'Warden Lite', 'battlefield');
    give(g, 'bob', 'Warden Lite', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Visionary Lite', 'hand') }));
    expect(g.zones.hand.alice!.length - hand).toBe(2);
    expect(g.players.alice!.life).toBe(22);
    expect(g.players.bob!.life).toBe(21);
  });

  it('Infantry Shield: menace and mobilize X, X the equipped creature\'s power as the trigger resolves', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ham = give(g, 'alice', 'Big Hamster', 'battlefield');
    give(g, 'alice', 'Glory Lite', 'battlefield');
    const shield = give(g, 'alice', 'Infantry Shield', 'battlefield');
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'activate', player: 'alice', object: shield, ability: 0, targets: [[obj(ham)]] }));
    expect(g.objects[shield]!.attachedTo?.id).toBe(ham);
    expect(chars(g, g.objects[ham]!).keywords.some((k) => k.id === 'menace')).toBe(true);
    g = attackWith(g, [ham]);
    g = settle(g);
    const warriors = tokens(g, 'alice', /Warrior/);
    expect(warriors).toHaveLength(4);
    expect(warriors.every((id) => g.objects[id]!.tapped && Boolean(g.combat?.attackers[id]))).toBe(true);
    g = finishCombat(g);
    expect(g.players.bob!.life).toBe(20 - 4 - 4 * 2);
    g = settle(toStep(g, 'end', 'alice'));
    expect(tokens(g, 'alice', /Warrior/)).toHaveLength(0);
  });

  it('Golgari Thug: its dies trigger can put the Thug itself on top of your library', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const thug = give(g, 'alice', 'Golgari Thug', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder Lite', 'hand'), targets: [[obj(thug)]] });
    g = settle(g, (s) => {
      const p = s.pending!;
      if (p.kind === 'trigger_targets') {
        expect(p.prompts[0]!.candidates).toContainEqual(obj(thug));
        return { kind: 'trigger_targets', targets: [[obj(thug)]] };
      }
      return undefined;
    });
    expect(g.objects[thug]!.zone).toBe('library');
    expect(g.zones.library.alice![0]).toBe(thug);
  });

  it('Selvala: the entering creature\'s controller may draw only if its power is greater than each other creature\'s', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const selvala = give(g, 'alice', 'Selvala, Heart of the Wilds', 'battlefield');
    const hand = () => g.zones.hand.bob!.length;
    let before = hand();
    const asked: string[] = [];
    const yes: Answerer = (s) => (asked.push(`${s.pending!.kind}:${(s.pending as { player: string }).player}`), s.pending!.kind === 'may' ? { kind: 'may', yes: true } : undefined);
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Ogre', 'hand') }), yes);
    expect(asked).toEqual(['may:bob']);
    expect(hand() - before).toBe(1);
    before = hand();
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Ogre', 'hand') }), yes);
    expect(asked).toEqual(['may:bob']); // a tie: not greater than each other creature's power
    expect(hand() - before).toBe(0);
    g = toStep(g, 'main1', 'alice');
    g.players.alice!.pool.G = 1;
    g = act(g, { type: 'activate_mana', player: 'alice', object: selvala, ability: 0, choice: 'WU' } as never);
    expect([g.players.alice!.pool.W, g.players.alice!.pool.U, g.players.alice!.pool.G]).toEqual([1, 1, 0]);
  });

  it('Alseid of Life\'s Bounty: protection from the chosen color only', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const alseid = give(g, 'alice', "Alseid of Life's Bounty", 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const theirs = give(g, 'bob', 'Bear', 'battlefield');
    g.players.alice!.pool.C = 1;
    expect(illegal(g, { type: 'activate', player: 'alice', object: alseid, ability: 0, targets: [[obj(theirs)]] })).toBeTruthy();
    g = act(g, { type: 'activate', player: 'alice', object: alseid, ability: 0, targets: [[obj(bear)]] });
    const seen: unknown[] = [];
    g = settle(g, (s) => {
      const p = s.pending!;
      seen.push(p);
      if (p.kind === 'choose_option') return { kind: 'choose_option', choice: p.options.find((o) => /black|^B$/i.test(o))! };
      return undefined;
    });
    expect(g.pending).toBeNull();
    expect(g.objects[alseid]!.zone).toBe('graveyard');
    g.players.alice!.pool.B = 1;
    g.players.alice!.pool.R = 1;
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Black Murder', 'hand'), targets: [[obj(bear)]] })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Red Zap', 'hand'), targets: [[obj(bear)]] }));
    expect(g.objects[bear]!.damage).toBe(1);
    // … until end of turn.
    g = toStep(g, 'main1', 'bob');
    g.players.bob!.pool.B = 1;
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Black Murder', 'hand'), targets: [[obj(bear)]] }));
    expect(g.objects[bear]!.zone).toBe('graveyard');
  });

  it('Heliod: returns a non-God enchantment card; transformed, gives flash and a discount per card opponents drew this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const glory = give(g, 'alice', 'Glory Lite', 'graveyard');
    const heliod = give(g, 'alice', 'Heliod, the Radiant Dawn // Heliod, the Warped Eclipse', 'hand');
    g.players.alice!.pool.W = 4;
    g = act(g, { type: 'cast', player: 'alice', object: heliod });
    g = settle(g, (s) => (s.pending!.kind === 'trigger_targets' ? { kind: 'trigger_targets', targets: [[obj(glory)]] } : undefined));
    expect(g.objects[glory]!.zone).toBe('hand');
    // {3}{U/P}: 3 mana and 2 life.
    g.players.alice!.pool.C = 3;
    g = settle(act(g, { type: 'activate', player: 'alice', object: heliod, ability: 0, costs: { phyrexian: ['life'] } } as never));
    expect(g.objects[heliod]!.face).toBe(1);
    expect(g.players.alice!.life).toBe(18);
    expect(g.players.alice!.pool.C).toBe(0);
    // Alice's own turn: Bob has drawn nothing — full price.
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Two Drop', 'hand') })).toBeTruthy();
    // Bob's turn, after his draw step: one card drawn — {1} less, and at instant speed.
    g = toStep(g, 'main1', 'bob');
    const drop = give(g, 'alice', 'Two Drop', 'hand');
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.priority).toBe('alice');
    expect(illegal(g, { type: 'cast', player: 'alice', object: drop })).toBeTruthy();
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: drop }));
    expect(g.objects[drop]!.zone).toBe('battlefield');
  });

  it('Worldwalker Helm: one extra Map whenever you create artifact tokens (copies included), none for creature tokens', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const helm = give(g, 'alice', 'Worldwalker Helm', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Soldier Maker', 'hand') }));
    expect(tokens(g, 'alice', /Map/)).toHaveLength(0);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Treasure Maker', 'hand') }));
    expect(tokens(g, 'alice', /Treasure/)).toHaveLength(2);
    expect(tokens(g, 'alice', /Map/)).toHaveLength(1);
    const treasure = tokens(g, 'alice', /Treasure/)[0]!;
    g.players.alice!.pool.U = 2;
    g = settle(act(g, { type: 'activate', player: 'alice', object: helm, ability: 0, targets: [[obj(treasure)]] }));
    const mine = g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice');
    expect(mine.filter((id) => chars(g, g.objects[id]!).subtypes.includes('Treasure'))).toHaveLength(3);
    expect(mine.filter((id) => chars(g, g.objects[id]!).subtypes.includes('Map'))).toHaveLength(2);
    // An opponent's tokens aren't yours.
    g = toStep(g, 'main1', 'bob');
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Treasure Maker', 'hand') }));
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token && chars(g, g.objects[id]!).subtypes.includes('Map'))).toHaveLength(2);
  });

  it('Knuckles: one Treasure per combat damage step in which your creatures hit a player; thirty artifacts win', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const knuckles = give(g, 'alice', 'Knuckles the Echidna', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = finishCombat(attackWith(g, [knuckles, bear]));
    expect(g.players.bob!.life).toBe(20 - 2 - 2 - 2);
    expect(tokens(g, 'alice', /Treasure/)).toHaveLength(2);
    for (let i = 0; i < 27; i++) give(g, 'alice', 'Trinket', 'battlefield');
    g = settle(toStep(g, 'upkeep', 'alice'));
    expect(g.over).toBeFalsy(); // 29 artifacts
    give(g, 'alice', 'Trinket', 'battlefield');
    g = toStep(g, 'upkeep', 'bob');
    for (let i = 0; i < 200 && !g.over && !(g.active === 'alice' && g.step === 'draw'); i++) {
      if (g.pending?.kind === 'declare_attackers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_attackers', attacks: [] } });
      else if (g.pending?.kind === 'discard_to_hand_size') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'discard_to_hand_size', objects: g.zones.hand[g.pending.player]!.slice(0, g.pending.count) } });
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.over).toBeTruthy();
    expect(g.players.bob!.lost).toBeTruthy();
  });

  it('Explorer\'s Scope: a land on top may be put onto the battlefield tapped; a nonland stays on top', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const scope = give(g, 'alice', "Explorer's Scope", 'battlefield');
    g.objects[scope]!.attachedTo = { id: bear, zcc: g.objects[bear]!.zcc };
    const land = give(g, 'alice', 'Nonbasic Lite', 'library');
    toTop(g, 'alice', land);
    g = attackWith(g, [bear]);
    const kinds: string[] = [];
    g = settle(g, (s) => {
      const p = s.pending!;
      kinds.push(p.kind);
      if (p.kind === 'may') return { kind: 'may', yes: true };
      if (p.kind === 'choose_objects') return { kind: 'choose_objects', objects: [land] };
      return undefined;
    });
    expect(g.objects[land]).toMatchObject({ zone: 'battlefield', tapped: true, controller: 'alice' });
    g = toStep(toStep(g, 'main1', 'bob'), 'main1', 'alice');
    const spell = give(g, 'alice', 'Murder Lite', 'library');
    toTop(g, 'alice', spell);
    g = attackWith(g, [bear]);
    g = settle(g, (s) => (s.pending!.kind === 'choose_objects' ? { kind: 'choose_objects', objects: [] } : s.pending!.kind === 'may' ? { kind: 'may', yes: true } : undefined));
    expect(g.objects[spell]!.zone).toBe('library');
    expect(g.zones.library.alice![0]).toBe(spell);
  });
  it('Resurgent Belief has no mana cost: it can\'t be cast from hand (CR 202.1b), only suspended', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const belief = give(g, 'alice', 'Resurgent Belief', 'hand');
    g.players.alice!.pool.W = 5;
    expect(illegal(g, { type: 'cast', player: 'alice', object: belief })).toBeTruthy();
  });

  it('Charred Foyer // Warped Space: the upkeep card is playable that turn only; Warped Space (once unlocked) makes one exile-cast free', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const room = give(g, 'alice', 'Charred Foyer // Warped Space', 'hand');
    g.players.alice!.pool.R = 4;
    g = settle(act(g, { type: 'cast', player: 'alice', object: room, face: 0 }));
    expect(g.objects[room]!.unlocked).toEqual([true, false]);
    // Turn 3: a land on top is exiled at upkeep and may be played ("play", not just "cast") — or left.
    g = advance(g, (s) => s.active === 'bob' && s.step === 'end');
    const land1 = give(g, 'alice', 'Swamp', 'library');
    toTop(g, 'alice', land1);
    g = advance(g, (s) => s.active === 'alice' && s.step === 'main1');
    expect(g.objects[land1]!.zone).toBe('exile');
    // Bob can't play it; Alice could — she leaves it this turn.
    const check = act(g, { type: 'play_land', player: 'alice', object: land1 });
    expect(check.objects[land1]!.zone).toBe('battlefield');
    // Turn 5: the first card's permission is gone; the new one (a spell) can be cast, at full price while Warped Space is locked.
    g = advance(g, (s) => s.active === 'bob' && s.step === 'end');
    const drop = give(g, 'alice', 'Two Drop', 'library');
    toTop(g, 'alice', drop);
    g = advance(g, (s) => s.active === 'alice' && s.step === 'main1');
    expect(g.objects[drop]!.zone).toBe('exile');
    expect(illegal(g, { type: 'play_land', player: 'alice', object: land1 })).toBeTruthy();
    expect(illegal(g, { type: 'cast', player: 'alice', object: drop })).toBeTruthy();
    expect(illegal(g, { type: 'cast', player: 'alice', object: drop, alt: 'free_once' })).toBeTruthy();
    g.players.alice!.pool.R = 6;
    g = settle(act(g, { type: 'unlock', player: 'alice', object: room, half: 1 }));
    expect(g.objects[room]!.unlocked).toEqual([true, true]);
    expect(g.players.alice!.pool.R).toBe(0);
    // Not for spells cast from hand.
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Two Drop', 'hand'), alt: 'free_once' })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: drop, alt: 'free_once' }));
    expect(g.objects[drop]!.zone).toBe('battlefield');
  });

  it('Cyberman Patrol: artifact creatures you control (itself included) have afflict 3; others don\'t', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const patrol = give(g, 'alice', 'Cyberman Patrol', 'battlefield');
    const golem = give(g, 'alice', 'Golem', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const b1 = give(g, 'bob', 'Bear', 'battlefield');
    const b2 = give(g, 'bob', 'Bear', 'battlefield');
    const b3 = give(g, 'bob', 'Bear', 'battlefield');
    g = attackWith(g, [patrol, golem, bear]);
    g = finishCombat(g, [{ blocker: b1, attacker: golem }, { blocker: b2, attacker: bear }, { blocker: b3, attacker: patrol }]);
    expect(g.players.bob!.life).toBe(20 - 3 - 3);
  });

  it('Tormod: one Zombie for any number of cards leaving YOUR graveyard at once', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Tormod, the Desecrator', 'battlefield');
    give(g, 'alice', 'Bear', 'graveyard');
    give(g, 'alice', 'Bear', 'graveyard');
    give(g, 'bob', 'Bear', 'graveyard');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mass Return', 'hand') }));
    const z = tokens(g, 'alice', /Zombie/);
    expect(z).toHaveLength(1);
    expect(g.objects[z[0]!]!.tapped).toBe(true);
    expect([chars(g, g.objects[z[0]!]!).power, chars(g, g.objects[z[0]!]!).toughness, chars(g, g.objects[z[0]!]!).colors]).toEqual([2, 2, ['B']]);
    g = toStep(g, 'main1', 'bob');
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Mass Return', 'hand') }));
    expect(tokens(g, 'alice', /Zombie/)).toHaveLength(1);
  });

  it('Hashaton: pay {2}{U} for a tapped 4/4 black Zombie copy of the discarded creature card', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', "Hashaton, Scarab's Fist", 'battlefield');
    const ogre = give(g, 'alice', 'Ogre', 'hand');
    g.players.alice!.pool.U = 1;
    g.players.alice!.pool.C = 2;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Looter Lite', 'hand') });
    g = settle(g, (s) => {
      const p = s.pending!;
      if (p.kind === 'discard') return { kind: 'discard', objects: [ogre] };
      if (p.kind === 'pay') return { kind: 'pay', pay: true };
      if (p.kind === 'may') return { kind: 'may', yes: true };
      return undefined;
    });
    expect(g.pending).toBeNull();
    const t = g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice');
    expect(t).toHaveLength(1);
    const c = chars(g, g.objects[t[0]!]!);
    expect([c.name, c.power, c.toughness, c.colors, g.objects[t[0]!]!.tapped]).toEqual(['Ogre', 4, 4, ['B'], true]);
    expect(c.subtypes).toContain('Zombie');
    expect(g.players.alice!.pool.U + g.players.alice!.pool.C).toBe(0);
  });

  it('The Mightstone and Weakstone: its mana can\'t cast nonartifact spells, but can cast artifacts and pay for abilities', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const stone = give(g, 'alice', 'The Mightstone and Weakstone', 'hand');
    const theirs = give(g, 'bob', 'Ogre', 'battlefield');
    g.players.alice!.pool.C = 5;
    g = act(g, { type: 'cast', player: 'alice', object: stone });
    g = settle(g, (s) => (s.pending!.kind === 'trigger_targets' ? { kind: 'trigger_targets', modes: [1], targets: [[obj(theirs)]] } : undefined));
    expect(g.objects[theirs]!.zone).toBe('graveyard');
    const tap = () => {
      g.objects[stone]!.tapped = false;
      g = act(g, { type: 'activate_mana', player: 'alice', object: stone, ability: 0 });
    };
    tap();
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Two Drop', 'hand') })).toBeTruthy();
    const golem = give(g, 'alice', 'Golem', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: golem }));
    expect(g.objects[golem]!.zone).toBe('battlefield');
    tap();
    const shield = give(g, 'alice', 'Infantry Shield', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: shield, ability: 0, targets: [[obj(golem)]] }));
    expect(g.objects[shield]!.attachedTo?.id).toBe(golem);
  });

  it('The Great Henge: costs less by your greatest power; counter + card for nontoken creatures; {G}{G} and 2 life', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Ogre', 'battlefield');
    const henge = give(g, 'alice', 'The Great Henge', 'hand');
    g.players.alice!.pool.G = 2;
    g.players.alice!.pool.C = 1;
    expect(illegal(g, { type: 'cast', player: 'alice', object: henge })).toBeTruthy();
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: henge }));
    expect(g.objects[henge]!.zone).toBe('battlefield');
    const hand = g.zones.hand.alice!.length;
    const bear = give(g, 'alice', 'Bear', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear }));
    expect(g.objects[bear]!.counters['+1/+1']).toBe(1);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Soldier Maker', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
    g = act(g, { type: 'activate_mana', player: 'alice', object: henge, ability: 0 });
    expect(g.players.alice!.pool.G).toBe(2);
    expect(g.players.alice!.life).toBe(22);
  });

  it('Bubbling Muck: whoever taps a Swamp gets the extra {B}, this turn only', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mine = give(g, 'alice', 'Swamp', 'battlefield');
    const theirs = give(g, 'bob', 'Swamp', 'battlefield');
    g.players.alice!.pool.B = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bubbling Muck', 'hand') }));
    g = act(g, { type: 'activate_mana', player: 'alice', object: mine, ability: 0 });
    expect(g.players.alice!.pool.B).toBe(2);
    g = act(g, { type: 'pass', player: 'alice' });
    if (g.priority === 'bob' && g.step === 'main1') {
      g = act(g, { type: 'activate_mana', player: 'bob', object: theirs, ability: 0 });
      expect(g.players.bob!.pool.B).toBe(2);
      expect(g.players.alice!.pool.B).toBe(2);
    }
    g = toStep(g, 'main1', 'bob');
    g.objects[theirs]!.tapped = false;
    g = act(g, { type: 'activate_mana', player: 'bob', object: theirs, ability: 0 });
    expect(g.players.bob!.pool.B).toBe(1);
  });

  it('Craterhoof Behemoth: X and the affected creatures are fixed as the trigger resolves', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    give(g, 'alice', 'Bear', 'battlefield');
    const theirs = give(g, 'bob', 'Bear', 'battlefield');
    const hoof = give(g, 'alice', 'Craterhoof Behemoth', 'hand');
    g.players.alice!.pool.G = 8;
    g = settle(act(g, { type: 'cast', player: 'alice', object: hoof }));
    const pt = (id: string) => [chars(g, g.objects[id]!).power, chars(g, g.objects[id]!).toughness];
    expect(pt(bear)).toEqual([5, 5]);
    expect(pt(hoof)).toEqual([8, 8]);
    expect(pt(theirs)).toEqual([2, 2]);
    expect(chars(g, g.objects[bear]!).keywords.some((k) => k.id === 'trample')).toBe(true);
    const late = give(g, 'alice', 'Bear', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: late }));
    expect(pt(late)).toEqual([2, 2]);
    expect(pt(bear)).toEqual([5, 5]);
    g = toStep(g, 'main1', 'bob');
    expect(pt(bear)).toEqual([2, 2]);
  });

  it('Surly Badgersaur: creature → counter; land → Treasure; anything else → fights up to one creature you don\'t control', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const badger = give(g, 'alice', 'Surly Badgersaur', 'battlefield');
    const theirs = give(g, 'bob', 'Bear', 'battlefield');
    const mineToo = give(g, 'alice', 'Bear', 'battlefield');
    const discard = (card: string, targets?: unknown) => {
      const id = give(g, 'alice', card, 'hand');
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Discard Lite', 'hand') });
      g = settle(g, (s) => {
        const p = s.pending!;
        if (p.kind === 'discard') return { kind: 'discard', objects: [id] };
        if (p.kind === 'trigger_targets') {
          expect(p.prompts[0]!.candidates).not.toContainEqual(obj(mineToo));
          return { kind: 'trigger_targets', targets };
        }
        return undefined;
      });
      expect(g.pending).toBeNull();
    };
    discard('Bear');
    expect(g.objects[badger]!.counters['+1/+1']).toBe(1);
    expect(tokens(g, 'alice', /Treasure/)).toHaveLength(0);
    discard('Swamp');
    expect(g.objects[badger]!.counters['+1/+1']).toBe(1);
    expect(tokens(g, 'alice', /Treasure/)).toHaveLength(1);
    discard('Murder Lite', [[]]);
    expect(g.objects[badger]!.damage).toBe(0);
    discard('Murder Lite', [[obj(theirs)]]);
    expect(g.objects[theirs]!.zone).toBe('graveyard');
    expect(g.objects[badger]!.damage).toBe(2);
    expect(g.objects[badger]!.counters['+1/+1']).toBe(1);
    expect(tokens(g, 'alice', /Treasure/)).toHaveLength(1);
  });

  it('Stitch Together: to hand, or to the battlefield with seven or more cards in your graveyard as it resolves', () => {
    for (const [others, zone] of [[5, 'hand'], [6, 'battlefield']] as const) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const ogre = give(g, 'alice', 'Ogre', 'graveyard');
      for (let i = 0; i < others; i++) give(g, 'alice', 'Swamp', 'graveyard');
      g.players.alice!.pool.B = 2;
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Stitch Together', 'hand'), targets: [[obj(ogre)]] }));
      expect(g.objects[ogre]!.zone).toBe(zone);
    }
  });

  it('In the Darkness Bind Them: I–III make Wraiths; IV takes up to one creature from EACH opponent until end of turn', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const saga = give(g, 'alice', 'In the Darkness Bind Them', 'hand');
    g.players.alice!.pool.U = 1;
    g.players.alice!.pool.B = 1;
    g.players.alice!.pool.R = 3;
    const ring: Answerer = (s) => {
      const p = s.pending!;
      if (p.kind === 'choose_objects') return { kind: 'choose_objects', objects: p.candidates.slice(0, Math.max(1, p.min)) };
      return undefined;
    };
    g = settle(act(g, { type: 'cast', player: 'alice', object: saga }), ring);
    expect(g.pending).toBeNull();
    expect(g.objects[saga]!.counters.lore).toBe(1);
    expect(tokens(g, 'alice', /Wraith/)).toHaveLength(1);
    const wraith = tokens(g, 'alice', /Wraith/)[0]!;
    expect([chars(g, g.objects[wraith]!).power, chars(g, g.objects[wraith]!).toughness, chars(g, g.objects[wraith]!).colors, chars(g, g.objects[wraith]!).keywords.some((k) => k.id === 'menace')]).toEqual([3, 3, ['B'], true]);
    g.objects[saga]!.counters.lore = 3;
    const bobs = give(g, 'bob', 'Ogre', 'battlefield');
    const bobs2 = give(g, 'bob', 'Bear', 'battlefield');
    const carols = give(g, 'carol', 'Ogre', 'battlefield');
    g.objects[bobs]!.tapped = true;
    let prompt: unknown;
    g = advance(g, (s) => s.active === 'alice' && s.step === 'main1' && s.turn > 1 && !s.stack.length && !s.pending && s.objects[saga]!.zone !== 'battlefield', (s) => {
      const p = s.pending!;
      if (p.kind === 'trigger_targets') {
        prompt = p.prompts;
        // Two creatures of one opponent is not "up to one … that player controls".
        expect(illegal(s, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[obj(bobs), obj(bobs2)]] } } as never)).toBeTruthy();
        return { kind: 'trigger_targets', targets: [[obj(bobs), obj(carols)]] };
      }
      return ring(s);
    });
    expect(prompt).toBeTruthy();
    expect(g.objects[saga]!.zone).toBe('graveyard');
    expect(g.objects[bobs]).toMatchObject({ controller: 'alice', tapped: false });
    expect(g.objects[carols]).toMatchObject({ controller: 'alice' });
    expect(chars(g, g.objects[carols]!).keywords.some((k) => k.id === 'haste')).toBe(true);
    g = advance(g, (s) => s.active === 'bob' && s.step === 'upkeep');
    expect(g.objects[bobs]!.controller).toBe('bob');
    expect(g.objects[carols]!.controller).toBe('carol');
  });

  it('Ashling, Flame Dancer: loot each time; 2nd resolution burns opponents and their creatures; 3rd adds {R}{R}{R}{R}, which stays', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ashling = give(g, 'alice', 'Ashling, Flame Dancer', 'battlefield');
    const mine = give(g, 'alice', 'Ogre', 'battlefield');
    const theirs = give(g, 'bob', 'Ogre', 'battlefield');
    const loot: Answerer = (s) => (s.pending!.kind === 'discard' ? { kind: 'discard', objects: [s.zones.hand.alice![0]!] } : undefined);
    const zap = () => {
      const hand = g.zones.hand.alice!.length;
      const grave = g.zones.graveyard.alice!.length;
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Zap Lite', 'hand'), targets: [[plr('bob')]] }), loot);
      expect(g.pending).toBeNull();
      expect(g.zones.hand.alice!.length).toBe(hand); // +Zap −Zap, −1 discarded, +1 drawn
      expect(g.zones.graveyard.alice!.length).toBe(grave + 2);
    };
    zap();
    expect([g.players.bob!.life, g.objects[theirs]!.damage, g.players.alice!.pool.R]).toEqual([19, 0, 0]);
    zap();
    expect([g.players.bob!.life, g.objects[theirs]!.damage, g.players.alice!.pool.R]).toEqual([16, 2, 0]);
    expect([g.players.alice!.life, g.objects[mine]!.damage, g.objects[ashling]!.damage]).toEqual([20, 0, 0]);
    zap();
    expect([g.players.bob!.life, g.objects[theirs]!.damage, g.players.alice!.pool.R]).toEqual([15, 2, 4]);
    zap();
    expect([g.players.bob!.life, g.objects[theirs]!.damage, g.players.alice!.pool.R]).toEqual([14, 2, 4]);
    g.players.alice!.pool.G = 1;
    g = advance(g, (s) => s.active === 'bob' && s.step === 'main1');
    expect([g.players.alice!.pool.R, g.players.alice!.pool.G]).toEqual([4, 0]);
    // A new turn: the count starts over.
    g = advance(g, (s) => s.active === 'alice' && s.step === 'main1');
    zap();
    expect(g.players.bob!.life).toBe(13);
    expect(g.players.alice!.pool.R).toBe(4);
  });

  it('Galadhrim Brigade: squad copies, each pumping the other Elves', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const brigade = give(g, 'alice', 'Galadhrim Brigade', 'hand');
    g.players.alice!.pool.G = 7;
    g = settle(act(g, { type: 'cast', player: 'alice', object: brigade, extras: ['squad', 'squad'] } as never));
    const all = g.zones.battlefield.filter((id) => g.objects[id]!.card === 'Galadhrim Brigade');
    expect(all).toHaveLength(3);
    expect(g.players.alice!.pool.G).toBe(0);
    expect(all.map((id) => chars(g, g.objects[id]!).power)).toEqual([4, 4, 4]);
  });

  it('Infectious Bite: power-sized damage from your creature, and each opponent gets a poison counter', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mine = give(g, 'alice', 'Ogre', 'battlefield');
    const theirs = give(g, 'bob', 'Ogre', 'battlefield');
    g.players.alice!.pool.G = 2;
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Infectious Bite', 'hand'), targets: [[obj(theirs)], [obj(mine)]] })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Infectious Bite', 'hand'), targets: [[obj(mine)], [obj(theirs)]] }));
    expect(g.objects[theirs]!.zone).toBe('graveyard');
    expect(g.objects[mine]!.damage).toBe(0);
    expect([g.players.bob!.poison, g.players.alice!.poison]).toEqual([1, 0]);
  });

  it('Monumental Henge: tapped without a Plains; digs five for a historic card, the rest to the bottom', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const henge = give(g, 'alice', 'Monumental Henge', 'hand');
    g = settle(act(g, { type: 'play_land', player: 'alice', object: henge }));
    expect(g.objects[henge]!.tapped).toBe(true);
    g.objects[henge]!.tapped = false;
    const trinket = give(g, 'alice', 'Trinket', 'library');
    const bear = give(g, 'alice', 'Bear', 'library');
    toTop(g, 'alice', bear);
    toTop(g, 'alice', trinket);
    const top5 = g.zones.library.alice!.slice(0, 5);
    const size = g.zones.library.alice!.length;
    g.players.alice!.pool.W = 4;
    g = act(g, { type: 'activate', player: 'alice', object: henge, ability: 0 });
    g = settle(g, (s) => {
      const p = s.pending!;
      if (p.kind === 'choose_objects') {
        // Exactly the historic cards among the five (the deck holds a copy of every test card, so others may turn up).
        const historic = (id: string) => {
          const c = chars(s, s.objects[id]!);
          return c.types.includes('Artifact') || c.supertypes.includes('Legendary') || c.subtypes.includes('Saga');
        };
        expect([...p.candidates].sort()).toEqual(top5.filter(historic).sort());
        expect(p.candidates).toContain(trinket);
        expect(p.candidates).not.toContain(bear);
        return { kind: 'choose_objects', objects: [trinket] };
      }
      return undefined;
    });
    expect(g.pending).toBeNull();
    expect(g.objects[trinket]!.zone).toBe('hand');
    expect(g.zones.library.alice!.length).toBe(size - 1);
    expect([...g.zones.library.alice!.slice(-4)].sort()).toEqual(top5.filter((id) => id !== trinket).sort());
  });

  it('The Darkness Crystal: black spells cost {1} less; tokens and your own creatures die normally', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'The Darkness Crystal', 'battlefield');
    g.players.alice!.pool.B = 1;
    const bb = give(g, 'alice', 'Black Bear', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: bb }));
    expect(g.objects[bb]!.zone).toBe('battlefield');
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Two Drop', 'hand') })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder Lite', 'hand'), targets: [[obj(bb)]] }));
    expect(g.objects[bb]!.zone).toBe('graveyard');
    expect(g.players.alice!.life).toBe(20);
    g = toStep(g, 'main1', 'bob');
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Soldier Maker', 'hand') }));
    const soldier = tokens(g, 'bob', /Soldier/)[0]!;
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Murder Lite', 'hand'), targets: [[obj(soldier)]] }));
    expect(g.players.alice!.life).toBe(20);
    const real = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Murder Lite', 'hand'), targets: [[obj(real)]] }));
    expect(g.objects[real]!.zone).toBe('exile');
    expect(g.players.alice!.life).toBe(22);
  });
  it('Twinferno: copies only the NEXT instant or sorcery, and only this turn; mode two gives double strike', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.players.alice!.pool.R = 4;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Twinferno', 'hand'), modes: [0] }));
    const keep: Answerer = (s) => (s.pending!.kind === 'copy_targets' ? { kind: 'copy_targets' } : undefined);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Zap Lite', 'hand'), targets: [[plr('bob')]] }), keep);
    expect(g.players.bob!.life).toBe(18);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Zap Lite', 'hand'), targets: [[plr('bob')]] }), keep);
    expect(g.players.bob!.life).toBe(17);
    // Unused, it's gone with the turn.
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Twinferno', 'hand'), modes: [0] }));
    g = advance(g, (s) => s.active === 'alice' && s.step === 'main1' && s.turn > 1);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Zap Lite', 'hand'), targets: [[plr('bob')]] }), keep);
    expect(g.players.bob!.life).toBe(16);
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g.players.alice!.pool.R = 2;
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Twinferno', 'hand'), modes: [1], targets: [[obj(give(g, 'bob', 'Bear', 'battlefield'))]] })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Twinferno', 'hand'), modes: [1], targets: [[obj(bear)]] }));
    g = finishCombat(attackWith(g, [bear]));
    expect(g.players.bob!.life).toBe(12);
  });

  it('Spell Stutter: {2} plus {1} for each Faerie you control, counted as it resolves', () => {
    for (const [faeries, mana, countered] of [[0, 2, false], [2, 3, true], [2, 4, false]] as const) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
      for (let i = 0; i < faeries; i++) give(g, 'alice', 'Faerie Lite', 'battlefield');
      give(g, 'bob', 'Faerie Lite', 'battlefield');
      const spell = give(g, 'bob', 'Divination Lite', 'hand');
      g = act(g, { type: 'cast', player: 'bob', object: spell });
      g = act(g, { type: 'pass', player: 'bob' });
      g.players.alice!.pool.U = 2;
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Spell Stutter', 'hand'), targets: [[obj(spell)]] });
      g.players.bob!.pool.C = mana;
      const hand = g.zones.hand.bob!.length;
      let cost = '';
      g = settle(g, (s) => {
        const p = s.pending!;
        if (p.kind !== 'pay') return undefined;
        cost = p.cost;
        expect(p.player).toBe('bob');
        return { kind: 'pay', pay: !countered };
      });
      expect(cost).toBe(`{${2 + faeries}}`);
      expect(g.zones.hand.bob!.length - hand).toBe(countered ? 0 : 2);
      expect(g.players.bob!.pool.C).toBe(countered ? mana : mana - 2 - faeries);
    }
  });

  it('Astral Cornucopia: X charge counters for {X}{X}{X}; taps for that many mana of one color', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const horn = give(g, 'alice', 'Astral Cornucopia', 'hand');
    g.players.alice!.pool.C = 6;
    g = settle(act(g, { type: 'cast', player: 'alice', object: horn, x: 2 }));
    expect(g.objects[horn]!.counters.charge).toBe(2);
    expect(g.players.alice!.pool.C).toBe(0);
    g = act(g, { type: 'activate_mana', player: 'alice', object: horn, ability: 0, choice: 'U' });
    expect(g.players.alice!.pool.U).toBe(2);
  });

  it('Master Biomancer: other creatures you control (tokens too) enter with counters equal to its power, as Mutants', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bio = give(g, 'alice', 'Master Biomancer', 'battlefield');
    g.objects[bio]!.counters['+1/+1'] = 1;
    const bear = give(g, 'alice', 'Bear', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear }));
    expect(g.objects[bear]!.counters['+1/+1']).toBe(3);
    expect(chars(g, g.objects[bear]!).subtypes.sort()).toEqual(['Bear', 'Mutant']);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Soldier Maker', 'hand') }));
    const soldier = tokens(g, 'alice', /Soldier/)[0]!;
    expect(g.objects[soldier]!.counters['+1/+1']).toBe(3);
    expect(chars(g, g.objects[soldier]!).subtypes).toContain('Mutant');
    g = toStep(g, 'main1', 'bob');
    const theirs = give(g, 'bob', 'Bear', 'hand');
    g = settle(act(g, { type: 'cast', player: 'bob', object: theirs }));
    expect(g.objects[theirs]!.counters['+1/+1']).toBeUndefined();
    expect(chars(g, g.objects[theirs]!).subtypes).toEqual(['Bear']);
  });

  it('Farmer Cotton: X Halflings and X Foods', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.players.alice!.pool.G = 3;
    g.players.alice!.pool.W = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Farmer Cotton', 'hand'), x: 2 }));
    expect(tokens(g, 'alice', /Halfling/)).toHaveLength(2);
    expect(tokens(g, 'alice', /Food/)).toHaveLength(2);
  });

  it('Weftstalker Ardent: pings for other creatures and artifacts you control; warped, it is exiled at the end step and castable later', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ardent = give(g, 'alice', 'Weftstalker Ardent', 'hand');
    g.players.alice!.pool.R = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: ardent, alt: 'warp' }));
    expect(g.objects[ardent]!.zone).toBe('battlefield');
    expect(g.players.bob!.life).toBe(20);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bear', 'hand') }));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Trinket', 'hand') }));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Glory Lite', 'hand') }));
    expect(g.players.bob!.life).toBe(18);
    g = advance(g, (s) => s.active === 'bob' && s.step === 'main1');
    expect(g.objects[ardent]!.zone).toBe('exile');
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bear', 'hand') }));
    expect(g.players.bob!.life).toBe(18);
    g = advance(g, (s) => s.active === 'alice' && s.step === 'main1');
    g.players.alice!.pool.R = 3;
    g = settle(act(g, { type: 'cast', player: 'alice', object: ardent }));
    expect(g.objects[ardent]!.zone).toBe('battlefield');
    g = advance(g, (s) => s.active === 'bob' && s.step === 'main1');
    expect(g.objects[ardent]!.zone).toBe('battlefield');
  });

  it('Fire Nation Palace: untapped with a basic land; firebending 4 adds {R}{R}{R}{R} until end of combat', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Swamp', 'battlefield');
    const palace = give(g, 'alice', 'Fire Nation Palace', 'hand');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'play_land', player: 'alice', object: palace }));
    expect(g.objects[palace]!.tapped).toBe(false);
    g.players.alice!.pool.R = 2;
    g = settle(act(g, { type: 'activate', player: 'alice', object: palace, ability: 0, targets: [[obj(bear)]] }));
    g = settle(attackWith(g, [bear]));
    const red = () => (g.players.alice!.restricted ?? []).filter((r) => r.color === 'R').reduce((n, r) => n + r.amount, 0) + g.players.alice!.pool.R;
    expect(red()).toBe(4);
    g = finishCombat(g);
    expect(red()).toBe(0);
    // Without a basic land it enters tapped.
    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const p2 = give(h, 'alice', 'Fire Nation Palace', 'hand');
    h = settle(act(h, { type: 'play_land', player: 'alice', object: p2 }));
    expect(h.objects[p2]!.tapped).toBe(true);
  });

  it('Witch Enchanter // Witch-Blessed Meadow: either face; the land asks for 3 life or enters tapped', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const theirs = give(g, 'bob', 'Trinket', 'battlefield');
    const mine = give(g, 'alice', 'Trinket', 'battlefield');
    const witch = give(g, 'alice', 'Witch Enchanter // Witch-Blessed Meadow', 'hand');
    g.players.alice!.pool.W = 4;
    g = act(g, { type: 'cast', player: 'alice', object: witch });
    g = settle(g, (s) => {
      const p = s.pending!;
      if (p.kind !== 'trigger_targets') return undefined;
      expect(p.prompts[0]!.candidates).toEqual([obj(theirs)]);
      return { kind: 'trigger_targets', targets: [[obj(theirs)]] };
    });
    expect([g.objects[theirs]!.zone, g.objects[mine]!.zone]).toEqual(['graveyard', 'battlefield']);
    for (const pay of [true, false]) {
      let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const land = give(h, 'alice', 'Witch Enchanter // Witch-Blessed Meadow', 'hand');
      h = act(h, { type: 'play_land', player: 'alice', object: land, face: 1 });
      expect(h.pending).toMatchObject({ kind: 'as_enters', choice: 'pay_life' });
      h = act(h, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', pay } });
      expect([h.objects[land]!.tapped, h.players.alice!.life]).toEqual(pay ? [false, 17] : [true, 20]);
      h.objects[land]!.tapped = false;
      h = act(h, { type: 'activate_mana', player: 'alice', object: land, ability: 0 });
      expect(h.players.alice!.pool.W).toBe(1);
    }
  });

  it('Siege-Gang Commander: three Goblins; it can sacrifice itself and still deal the damage', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const gang = give(g, 'alice', 'Siege-Gang Commander', 'hand');
    g.players.alice!.pool.R = 9;
    g = settle(act(g, { type: 'cast', player: 'alice', object: gang }));
    const gobs = tokens(g, 'alice', /Goblin/);
    expect(gobs).toHaveLength(3);
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    expect(illegal(g, { type: 'activate', player: 'alice', object: gang, ability: 0, targets: [[plr('bob')]], costs: { sacrifice: [bear] } })).toBeTruthy();
    g = settle(act(g, { type: 'activate', player: 'alice', object: gang, ability: 0, targets: [[plr('bob')]], costs: { sacrifice: [gobs[0]!] } }));
    expect(g.players.bob!.life).toBe(18);
    g = settle(act(g, { type: 'activate', player: 'alice', object: gang, ability: 0, targets: [[plr('bob')]], costs: { sacrifice: [gang] } }));
    expect(g.objects[gang]!.zone).toBe('graveyard');
    expect(g.players.bob!.life).toBe(16);
  });

  it('Gamble: any card to hand, then a random discard', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'alice', 'Ogre', 'library');
    g.players.alice!.pool.R = 1;
    const hand = g.zones.hand.alice!.length;
    const grave = g.zones.graveyard.alice!.length;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Gamble', 'hand') });
    g = settle(g, (s) => (s.pending!.kind === 'search' ? { kind: 'search', objects: [ogre] } : undefined));
    expect(g.pending).toBeNull();
    expect(g.zones.hand.alice!.length).toBe(hand);
    expect(g.zones.graveyard.alice!.length).toBe(grave + 2);
    expect(['hand', 'graveyard']).toContain(g.objects[ogre]!.zone);
  });

  it('Liquimetal Coating: an artifact in addition to its other types, until end of turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const coat = give(g, 'alice', 'Liquimetal Coating', 'battlefield');
    const land = give(g, 'bob', 'Swamp', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: coat, ability: 0, targets: [[obj(land)]] }));
    expect([...chars(g, g.objects[land]!).types].sort()).toEqual(['Artifact', 'Land']);
    expect(chars(g, g.objects[land]!).subtypes).toEqual(['Swamp']);
    g = toStep(g, 'main1', 'bob');
    expect(chars(g, g.objects[land]!).types).toEqual(['Land']);
  });

  it('Prince Imrahil: the second card you draw each turn — not the first or third', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Prince Imrahil the Fair', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Divination Lite', 'hand') }));
    expect(tokens(g, 'alice', /Soldier/)).toHaveLength(1);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Divination Lite', 'hand') }));
    expect(tokens(g, 'alice', /Soldier/)).toHaveLength(1);
    g = toStep(g, 'main1', 'bob');
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Divination Lite', 'hand') }));
    expect(tokens(g, 'alice', /Soldier/)).toHaveLength(1);
    // Alice's next turn: the draw step is her first card, so one more is her second.
    g = advance(g, (s) => s.active === 'alice' && s.step === 'main1');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Looter Lite', 'hand') }), (s) => (s.pending!.kind === 'discard' ? { kind: 'discard', objects: [s.zones.hand.alice![0]!] } : undefined));
    expect(tokens(g, 'alice', /Soldier/)).toHaveLength(2);
  });

  it('Serra Ascendant: 6/6 flier at 30 or more life only', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const serra = give(g, 'alice', 'Serra Ascendant', 'battlefield');
    g.players.alice!.life = 29;
    expect([chars(g, g.objects[serra]!).power, chars(g, g.objects[serra]!).keywords.some((k) => k.id === 'flying')]).toEqual([1, false]);
    g.players.alice!.life = 30;
    g.players.bob!.life = 40;
    expect([chars(g, g.objects[serra]!).power, chars(g, g.objects[serra]!).toughness, chars(g, g.objects[serra]!).keywords.some((k) => k.id === 'flying')]).toEqual([6, 6, true]);
  });

  it('Aphetto Alchemist: morph for {3}, face up for {U}; untaps an artifact or creature', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const al = give(g, 'alice', 'Aphetto Alchemist', 'hand');
    g.players.alice!.pool.C = 3;
    g = settle(act(g, { type: 'cast', player: 'alice', object: al, alt: 'morph' }));
    expect(chars(g, g.objects[al]!)).toMatchObject({ name: '', power: 2, toughness: 2 });
    g.players.alice!.pool.U = 1;
    g = act(g, { type: 'turn_face_up', player: 'alice', object: al });
    expect(chars(g, g.objects[al]!)).toMatchObject({ name: 'Aphetto Alchemist', power: 1, toughness: 2 });
    g.objects[al]!.sick = false;
    const trinket = give(g, 'bob', 'Trinket', 'battlefield');
    const land = give(g, 'alice', 'Swamp', 'battlefield');
    g.objects[trinket]!.tapped = true;
    expect(illegal(g, { type: 'activate', player: 'alice', object: al, ability: 0, targets: [[obj(land)]] })).toBeTruthy();
    g = settle(act(g, { type: 'activate', player: 'alice', object: al, ability: 0, targets: [[obj(trinket)]] }));
    expect([g.objects[trinket]!.tapped, g.objects[al]!.tapped]).toEqual([false, true]);
  });

  it('Might of the Meek: trample and a card; +1/+0 only with a Mouse', () => {
    for (const mouse of [false, true]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      if (mouse) give(g, 'alice', 'Mouse Lite', 'battlefield');
      else give(g, 'bob', 'Mouse Lite', 'battlefield');
      const bear = give(g, 'bob', 'Bear', 'battlefield');
      g.players.alice!.pool.R = 1;
      const hand = g.zones.hand.alice!.length;
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Might of the Meek', 'hand'), targets: [[obj(bear)]] }));
      const c = chars(g, g.objects[bear]!);
      expect([c.power, c.toughness, c.keywords.some((k) => k.id === 'trample'), g.zones.hand.alice!.length - hand]).toEqual([mouse ? 3 : 2, 2, true, 1]);
    }
  });

  it('Basilisk Gate: +X/+X for the Gates you control, as a sorcery', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const gate = give(g, 'alice', 'Basilisk Gate', 'battlefield');
    give(g, 'alice', 'Gate Lite', 'battlefield');
    give(g, 'bob', 'Gate Lite', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'activate', player: 'alice', object: gate, ability: 0, targets: [[obj(bear)]] }));
    expect([chars(g, g.objects[bear]!).power, chars(g, g.objects[bear]!).toughness]).toEqual([4, 4]);
    g = toStep(g, 'main1', 'bob');
    expect(chars(g, g.objects[bear]!).power).toBe(2);
    g.players.alice!.pool.C = 2;
    g = act(g, { type: 'pass', player: 'bob' });
    expect(illegal(g, { type: 'activate', player: 'alice', object: gate, ability: 0, targets: [[obj(bear)]] })).toBeTruthy();
  });

  it('Chittering Witch: a Rat for each opponent', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const witch = give(g, 'alice', 'Chittering Witch', 'hand');
    g.players.alice!.pool.B = 6;
    g = settle(act(g, { type: 'cast', player: 'alice', object: witch }));
    const rats = tokens(g, 'alice', /Rat/);
    expect(rats).toHaveLength(2);
    const theirs = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: witch, ability: 0, targets: [[obj(theirs)]], costs: { sacrifice: [rats[0]!] } }));
    expect(g.objects[theirs]!.zone).toBe('graveyard');
  });

  it('From Beyond: colorless; a Scion each upkeep that sacrifices for {C}; fetches an Eldrazi card', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const fb = give(g, 'alice', 'From Beyond', 'battlefield');
    expect(chars(g, g.objects[fb]!).colors).toEqual([]);
    const eldrazi = give(g, 'alice', 'Eldrazi Lite', 'library');
    g = advance(g, (s) => s.active === 'alice' && s.step === 'main1' && s.turn > 1);
    const scions = tokens(g, 'alice', /Scion/);
    expect(scions).toHaveLength(1);
    expect([chars(g, g.objects[scions[0]!]!).power, chars(g, g.objects[scions[0]!]!).colors, [...chars(g, g.objects[scions[0]!]!).subtypes].sort()]).toEqual([1, [], ['Eldrazi', 'Scion']]);
    g = act(g, { type: 'activate_mana', player: 'alice', object: scions[0]!, ability: 0 });
    expect(g.players.alice!.pool.C).toBe(1);
    expect(g.objects[scions[0]!]).toBeUndefined();
    g.players.alice!.pool.G = 1;
    g = act(g, { type: 'activate', player: 'alice', object: fb, ability: 0 });
    g = settle(g, (s) => {
      const p = s.pending!;
      if (p.kind !== 'search') return undefined;
      // (The deck holds a copy of every test card: the other Eldrazi Lite and the Changeling qualify too.)
      expect(p.candidates).toContain(eldrazi);
      expect(p.candidates.every((id) => chars(s, s.objects[id]!).subtypes.includes('Eldrazi'))).toBe(true);
      return { kind: 'search', objects: [eldrazi] };
    });
    expect([g.objects[fb]!.zone, g.objects[eldrazi]!.zone]).toEqual(['graveyard', 'hand']);
  });

  it("Rogue's Gloves, Unruly Catapult, Stromkirk Captain", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const gloves = give(g, 'alice', "Rogue's Gloves", 'battlefield');
    g.objects[gloves]!.attachedTo = { id: bear, zcc: g.objects[bear]!.zcc };
    const cat = give(g, 'alice', 'Unruly Catapult', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: cat, ability: 0 }));
    expect([g.players.bob!.life, g.players.alice!.life, g.objects[cat]!.tapped]).toEqual([19, 20, true]);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Divination Lite', 'hand') }));
    expect(g.objects[cat]!.tapped).toBe(false);
    const captain = give(g, 'alice', 'Stromkirk Captain', 'battlefield');
    const vamp = give(g, 'alice', 'Vampire Lite', 'battlefield');
    const theirVamp = give(g, 'bob', 'Vampire Lite', 'battlefield');
    const fs = (id: string) => chars(g, g.objects[id]!).keywords.some((k) => k.id === 'first_strike');
    expect([chars(g, g.objects[vamp]!).power, fs(vamp), chars(g, g.objects[captain]!).power, fs(captain), chars(g, g.objects[theirVamp]!).power, fs(theirVamp), fs(bear)]).toEqual([2, true, 2, true, 1, false, false]);
    const hand = g.zones.hand.alice!.length;
    g = finishCombat(attackWith(g, [bear]), [], (s) => (s.pending!.kind === 'may' ? { kind: 'may', yes: true } : undefined));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('Secluded Steppe, Vibrant Cityscape, Bone Shards, Auramancer, Changeling Wayfinder', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const steppe = give(g, 'alice', 'Secluded Steppe', 'hand');
    const cyc = give(g, 'alice', 'Secluded Steppe', 'hand');
    g = settle(act(g, { type: 'play_land', player: 'alice', object: steppe }));
    expect(g.objects[steppe]!.tapped).toBe(true);
    g.players.alice!.pool.W = 1;
    let hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'activate', player: 'alice', object: cyc, ability: 0 }));
    expect([g.objects[cyc]!.zone, g.zones.hand.alice!.length]).toEqual(['graveyard', hand]);
    const city = give(g, 'alice', 'Vibrant Cityscape', 'battlefield');
    g = act(g, { type: 'activate', player: 'alice', object: city, ability: 0 });
    let found = '';
    g = settle(g, (s) => {
      const p = s.pending!;
      if (p.kind !== 'search') return undefined;
      found = p.candidates[0]!;
      expect(p.candidates.every((id) => chars(s, s.objects[id]!).supertypes.includes('Basic'))).toBe(true);
      return { kind: 'search', objects: [found] };
    });
    expect([g.objects[city]!.zone, g.objects[found]!.zone, g.objects[found]!.tapped]).toEqual(['graveyard', 'battlefield', true]);
    // Bone Shards: one of the two costs.
    const theirs = give(g, 'bob', 'Ogre', 'battlefield');
    const fodder = give(g, 'alice', 'Bear', 'battlefield');
    g.players.alice!.pool.B = 2;
    const cardInHand = give(g, 'alice', 'Swamp', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bone Shards', 'hand'), targets: [[obj(theirs)]] })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bone Shards', 'hand'), targets: [[obj(theirs)]], extras: ['choice2'], costs: { discard: [cardInHand] } } as never));
    expect([g.objects[theirs]!.zone, g.objects[cardInHand]!.zone, g.objects[fodder]!.zone]).toEqual(['graveyard', 'graveyard', 'battlefield']);
    const theirs2 = give(g, 'bob', 'Ogre', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bone Shards', 'hand'), targets: [[obj(theirs2)]], extras: ['choice1'], costs: { sacrifice: [fodder] } } as never));
    expect([g.objects[theirs2]!.zone, g.objects[fodder]!.zone]).toEqual(['graveyard', 'graveyard']);
    // Auramancer
    const glory = give(g, 'alice', 'Glory Lite', 'graveyard');
    g.players.alice!.pool.W = 3;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Auramancer', 'hand') });
    g = settle(g, (s) => (s.pending!.kind === 'trigger_targets' ? { kind: 'trigger_targets', targets: [[obj(glory)]] } : s.pending!.kind === 'may' ? { kind: 'may', yes: true } : undefined));
    expect(g.objects[glory]!.zone).toBe('hand');
    // Changeling Wayfinder
    g.players.alice!.pool.C = 3;
    const way = give(g, 'alice', 'Changeling Wayfinder', 'hand');
    hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'cast', player: 'alice', object: way });
    g = settle(g, (s) => (s.pending!.kind === 'may' ? { kind: 'may', yes: true } : s.pending!.kind === 'search' ? { kind: 'search', objects: [s.pending!.candidates[0]!] } : undefined));
    expect(g.zones.hand.alice!.length).toBe(hand);
    expect(chars(g, g.objects[way]!).subtypes).toEqual(expect.arrayContaining(['Elf', 'Goblin', 'Zombie']));
  });
  it('Worldwalker Helm: investigate and artifact creature tokens count; the Map explores', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Worldwalker Helm', 'battlefield');
    const maps = () => g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice' && chars(g, g.objects[id]!).subtypes.includes('Map'));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Investigate Lite', 'hand') }));
    expect(tokens(g, 'alice', /Clue/)).toHaveLength(1);
    expect(maps()).toHaveLength(1);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Thopter Maker', 'hand') }));
    expect(tokens(g, 'alice', /Thopter/)).toHaveLength(2);
    expect(maps()).toHaveLength(2);
    // The Map: {1}, {T}, sacrifice: target creature you control explores (a land on top goes to hand; otherwise a counter).
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const top = give(g, 'alice', 'Murder Lite', 'library');
    toTop(g, 'alice', top);
    g.players.alice!.pool.C = 1;
    const map = maps()[0]!;
    g = act(g, { type: 'activate', player: 'alice', object: map, ability: 0, targets: [[obj(bear)]] });
    g = settle(g, (s) => (s.pending!.kind === 'may' ? { kind: 'may', yes: false } : s.pending!.kind === 'choose_option' ? { kind: 'choose_option', choice: s.pending!.options[0]! } : undefined));
    expect(g.pending).toBeNull();
    expect(g.objects[map]).toBeUndefined();
    expect(g.objects[bear]!.counters['+1/+1']).toBe(1);
  });

  it('Yarok: lands entering count too; cast and dies triggers are not doubled', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Yarok, the Desecrated', 'battlefield');
    give(g, 'alice', 'Landfall Lite', 'battlefield');
    give(g, 'alice', 'Prowess Lite', 'battlefield');
    const dier = give(g, 'alice', 'Dier Lite', 'battlefield');
    g = settle(act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Swamp', 'hand') }));
    expect(g.players.alice!.life).toBe(22);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder Lite', 'hand'), targets: [[obj(dier)]] }));
    expect(g.players.alice!.life).toBe(22 + 1 + 1);
  });
  it('Minsc & Boo: Boo on entering and each upkeep (your choice); +1 only on a creature with trample or haste', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const minsc = give(g, 'alice', 'Minsc & Boo, Timeless Heroes', 'hand');
    g.players.alice!.pool.R = 2;
    g.players.alice!.pool.G = 2;
    const yes: Answerer = (s) => (s.pending!.kind === 'may' ? { kind: 'may', yes: true } : undefined);
    g = settle(act(g, { type: 'cast', player: 'alice', object: minsc }), yes);
    expect(g.objects[minsc]!.counters.loyalty).toBe(3);
    const boo = g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice');
    expect(boo).toHaveLength(1);
    const c = chars(g, g.objects[boo[0]!]!);
    expect([c.name, c.power, c.toughness, c.colors, c.supertypes, c.subtypes, c.keywords.map((k) => k.id).sort()]).toEqual(['Boo', 1, 1, ['R'], ['Legendary'], ['Hamster'], ['haste', 'trample']]);
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    expect(illegal(g, { type: 'activate', player: 'alice', object: minsc, ability: 0, targets: [[obj(bear)]] })).toBeTruthy();
    g = settle(act(g, { type: 'activate', player: 'alice', object: minsc, ability: 0, targets: [[obj(boo[0]!)]] }));
    expect([g.objects[minsc]!.counters.loyalty, g.objects[boo[0]!]!.counters['+1/+1']]).toEqual([4, 3]);
    // Next upkeep: decline, and no second Boo appears.
    let asked = 0;
    g = advance(g, (s) => s.active === 'alice' && s.step === 'main1' && s.turn > 1, (s) => (s.pending!.kind === 'may' ? (asked++, { kind: 'may', yes: false }) : undefined));
    expect(asked).toBe(1);
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice')).toHaveLength(1);
    // −2 on the 4/4 Boo: 4 damage — and (the bug above) 4 cards.
    g = act(g, { type: 'activate', player: 'alice', object: minsc, ability: 1 });
    g = settle(g, (s) => {
      const p = s.pending!;
      if (p.kind === 'sacrifice') return { kind: 'sacrifice', objects: [boo[0]!] };
      if (p.kind === 'trigger_targets') return { kind: 'trigger_targets', targets: [[plr('bob')]] };
      return undefined;
    });
    expect(g.players.bob!.life).toBe(16);
  });

  it('Marang River Regent: bounces up to two OTHER nonland permanents', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const regent = give(g, 'alice', 'Marang River Regent // Coil and Catch', 'hand');
    const theirs = give(g, 'bob', 'Ogre', 'battlefield');
    const mine = give(g, 'alice', 'Trinket', 'battlefield');
    const land = give(g, 'bob', 'Swamp', 'battlefield');
    g.players.alice!.pool.U = 6;
    g = act(g, { type: 'cast', player: 'alice', object: regent });
    g = settle(g, (s) => {
      const p = s.pending!;
      if (p.kind !== 'trigger_targets') return undefined;
      expect(p.prompts[0]!.candidates).not.toContainEqual(obj(regent));
      expect(p.prompts[0]!.candidates).not.toContainEqual(obj(land));
      return { kind: 'trigger_targets', targets: [[obj(theirs), obj(mine)]] };
    });
    expect([g.objects[regent]!.zone, g.objects[theirs]!.zone, g.objects[mine]!.zone]).toEqual(['battlefield', 'hand', 'hand']);
    expect(g.zones.hand.bob).toContain(theirs);
    expect(chars(g, g.objects[regent]!)).toMatchObject({ power: 6, toughness: 7 });
  });
  it('Farmer Cotton creates its Halflings and Foods as ONE event: Peregrin Took adds a single Food (CR 614.1a, 616.1)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Peregrin Took', 'battlefield');
    g.players.alice!.pool.G = 3;
    g.players.alice!.pool.W = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Farmer Cotton', 'hand'), x: 2 }));
    expect(tokens(g, 'alice', /Halfling/)).toHaveLength(2);
    expect(tokens(g, 'alice', /Food/)).toHaveLength(3);
  });

  it('Farmer Cotton + Worldwalker Helm: one Map for the whole batch', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Worldwalker Helm', 'battlefield');
    g.players.alice!.pool.G = 3;
    g.players.alice!.pool.W = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Farmer Cotton', 'hand'), x: 2 }));
    expect(tokens(g, 'alice', /Food/)).toHaveLength(2);
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token && chars(g, g.objects[id]!).subtypes.includes('Map'))).toHaveLength(1);
  });

  it('Farmer Cotton: "one or more tokens enter" sees the Halflings and Foods together', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Token Watcher', 'battlefield');
    g.players.alice!.pool.G = 3;
    g.players.alice!.pool.W = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Farmer Cotton', 'hand'), x: 2 }));
    expect(g.players.alice!.life).toBe(21);
  });
  it('Sun Titan returning an Aura: it enters attached to something you choose (CR 303.4f)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const aura = give(g, 'alice', 'Strength Lite', 'graveyard');
    g.players.alice!.pool.W = 6;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Sun Titan', 'hand') });
    g = settle(g, (s) => {
      const p = s.pending!;
      if (p.kind === 'trigger_targets') return { kind: 'trigger_targets', targets: [[obj(aura)]] };
      if (p.kind === 'may') return { kind: 'may', yes: true };
      if (p.kind === 'as_enters') return { kind: 'as_enters', attach: bear };
      return undefined;
    });
    expect(g.objects[aura]!.zone).toBe('battlefield');
    expect(g.objects[aura]!.attachedTo?.id).toBe(bear);
  });

  it('Zur fetching an Aura: it enters attached to something you choose (CR 303.4f)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const zur = give(g, 'alice', 'Zur the Enchanter', 'battlefield');
    const aura = give(g, 'alice', 'Strength Lite', 'library');
    g = attackWith(g, [zur]);
    g = settle(g, (s) => {
      const p = s.pending!;
      if (p.kind === 'may') return { kind: 'may', yes: true };
      if (p.kind === 'search') return { kind: 'search', objects: [aura] };
      if (p.kind === 'choose_objects') return { kind: 'choose_objects', objects: [p.candidates.includes(zur) ? zur : p.candidates[0]!] };
      return undefined;
    });
    expect(g.objects[aura]!.zone).toBe('battlefield');
    expect(g.objects[aura]!.attachedTo).toBeTruthy();
  });
  it('Worldwalker Helm also sees artifact tokens made by incubate and populate', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Worldwalker Helm', 'battlefield');
    const maps = () => g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice' && chars(g, g.objects[id]!).subtypes.includes('Map')).length;
    const pick: Answerer = (s) => (s.pending!.kind === 'choose_objects' ? { kind: 'choose_objects', objects: [s.pending!.candidates[0]!] } : undefined);
    const gained: Record<string, number> = {};
    for (const card of ['Thopter Maker', 'Incubate Lite', 'Populate Lite']) {
      const before = maps();
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', card, 'hand') }), pick);
      expect(g.pending).toBeNull();
      gained[card] = maps() - before;
    }
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token && chars(g, g.objects[id]!).subtypes.includes('Incubator'))).toHaveLength(1);
    expect(tokens(g, 'alice', /Thopter/)).toHaveLength(3);
    expect(gained).toEqual({ 'Thopter Maker': 1, 'Incubate Lite': 1, 'Populate Lite': 1 });
  });
});
