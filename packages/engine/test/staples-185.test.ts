import { describe, expect, it } from 'vitest';
import { chars, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';
import { maxHandSize } from '../src/player-rules.js';
import { moveObject } from '../src/zones.js';

const CARDS = [
  makeCard({ name: 'Monument to Endurance', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "Whenever you discard a card, choose one that hasn't been chosen this turn —\n• Draw a card.\n• Create a Treasure token.\n• Each opponent loses 3 life." }),
  makeCard({ name: 'Looting', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw two cards, then discard two cards.' }),
  makeCard({ name: 'Daily Kit', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "{0}: Choose one that hasn't been chosen this turn —\n• Draw a card.\n• You gain 2 life." }),
  makeCard({ name: 'Puzzle Box', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "{0}: Choose one that hasn't been chosen —\n• Draw a card.\n• You gain 2 life." }),
  makeCard({ name: 'Well of Lost Dreams', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Whenever you gain life, you may pay {X}, where X is less than or equal to the amount of life you gained. If you do, draw X cards.' }),
  makeCard({ name: 'Salve', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'You gain 3 life.' }),
  makeCard({ name: 'Primordial Ooze', type_line: 'Creature — Ooze', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "This creature attacks each combat if able.\nAt the beginning of your upkeep, put a +1/+1 counter on this creature. Then you may pay {X}, where X is the number of +1/+1 counters on it. If you don't, tap this creature and it deals X damage to you." }),
  makeCard({ name: 'Jugan Lite', type_line: 'Creature — Dragon', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever another creature you control enters, you may pay {X}. When you do, put X +1/+1 counters on that creature.' }),
  makeCard({ name: 'Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Tempt with Glory', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Tempting offer — Put a +1/+1 counter on each creature you control. Each opponent may put a +1/+1 counter on each creature they control. For each opponent who does, put a +1/+1 counter on each creature you control.' }),
  makeCard({ name: 'Tempt with Immortality', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Tempting offer — Return a creature card from your graveyard to the battlefield. Each opponent may return a creature card from their graveyard to the battlefield. For each opponent who does, return a creature card from your graveyard to the battlefield.' }),
  makeCard({ name: "Smuggler's Share", type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'At the beginning of each end step, draw a card for each opponent who drew two or more cards this turn, then create a Treasure token for each opponent who had two or more lands enter the battlefield under their control this turn.' }),
  makeCard({ name: 'Teysa Lite', type_line: 'Creature — Human Advisor', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'At the beginning of your end step, investigate for each opponent who lost life this turn.' }),
  makeCard({ name: 'Gift of Words', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Each opponent draws two cards.' }),
  makeCard({ name: 'Bolt', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Bolt deals 3 damage to any target.' }),
  makeCard({ name: 'Cut a Deal', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each opponent draws a card, then you draw a card for each opponent who drew a card this way.' }),
  makeCard({ name: 'Forest Call', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Search your library for any number of Forest cards, put them onto the battlefield tapped, then shuffle.' }),
  makeCard({ name: 'Chromatic Orrery', type_line: 'Legendary Artifact', mana_cost: '{0}', oracle_text: 'You may spend mana as though it were mana of any color.' }),
  makeCard({ name: 'Oath Lite', type_line: 'Legendary Enchantment', mana_cost: '{0}', oracle_text: 'You may spend mana as though it were mana of any color to cast planeswalker spells.' }),
  makeCard({ name: 'Hurl Through Hell', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Exile target creature. Until the end of your next turn, you may cast that card and you may spend mana as though it were mana of any color to cast that spell.' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Walker', type_line: 'Legendary Planeswalker — Test', mana_cost: '{1}{G}', cmc: 2, loyalty: '3', oracle_text: '+1: You gain 1 life.' }),
  makeCard({ name: 'Arena of Glory', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {R}.\n{R}, {T}, Exert this land: Add {R}{R}. If any of that mana is spent on a creature spell, it gains haste until end of turn.' }),
  makeCard({ name: 'Goblin Pair', type_line: 'Creature — Goblin', mana_cost: '{R}{R}', cmc: 2, power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Hostage Taker', type_line: 'Creature — Human Pirate', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: 'When this creature enters, exile another target creature or artifact until this creature leaves the battlefield. You may cast that card for as long as it remains exiled, and you may spend mana as though it were mana of any type to cast that spell.' }),
  makeCard({ name: 'Toxrill Lite', type_line: 'Creature — Slug Horror', mana_cost: '{0}', power: '7', toughness: '7', oracle_text: "Creatures you don't control get -1/-1 for each slime counter on them." }),
  makeCard({ name: 'Frenzied Baloth', type_line: 'Creature — Beast', mana_cost: '{0}', power: '3', toughness: '2', oracle_text: "Trample, haste\nCreature spells you control can't be countered.\nCombat damage can't be prevented." }),
  makeCard({ name: 'Chasm Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Prevent all damage that would be dealt to you.' }),
  makeCard({ name: 'Diregraf Colossus', type_line: 'Creature — Zombie Giant', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'This creature enters with a +1/+1 counter on it for each Zombie card in your graveyard.' }),
  makeCard({ name: 'Zombie', type_line: 'Creature — Zombie', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Thirst for Knowledge', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Draw three cards. Then discard two cards unless you discard an artifact card.' }),
  makeCard({ name: 'Trinket', type_line: 'Artifact', mana_cost: '{1}', cmc: 1, oracle_text: '' }),
  makeCard({ name: 'Kreat Lite', type_line: 'Creature — Goblin', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "Whenever one or more Goblins you control attack, create a 1/1 red Goblin creature token that's tapped and attacking." }),
  makeCard({ name: 'Hedge Shredder', type_line: 'Artifact Creature — Vehicle', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: 'Whenever one or more land cards are put into your graveyard from your library, put them onto the battlefield tapped.' }),
  makeCard({ name: 'Mill Three', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Mill three cards.' }),
  makeCard({ name: 'Reality Chip Lite', type_line: 'Legendary Artifact — Equipment', mana_cost: '{0}', oracle_text: 'As long as this Equipment is attached to a creature, you may play lands and cast spells from the top of your library.\nEquip {0}' }),
  makeCard({ name: 'Electro Lite', type_line: 'Legendary Creature — Human Villain', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: "You don't lose unspent red mana as steps and phases end." }),
  makeCard({ name: 'Plains', type_line: 'Basic Land — Plains', mana_cost: '', oracle_text: '({T}: Add {W}.)' }),
  makeCard({ name: 'Lay Down Arms', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Exile target creature with mana value less than or equal to the number of Plains you control. Its controller gains 3 life.' }),
  makeCard({ name: 'Ogre Three', type_line: 'Creature — Ogre', mana_cost: '{2}{R}', cmc: 3, power: '3', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{0}', power: '5', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Ruby Lite', type_line: 'Creature — Human Scout', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Whenever this creature attacks while you control a creature with power 4 or greater, this creature gets +2/+2 until end of turn.' }),
  makeCard({ name: 'Niv Lite', type_line: 'Creature — Dragon Wizard', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Whenever a source you control deals noncombat damage to an opponent, you draw that many cards.' }),
  makeCard({ name: 'Rout Lite', type_line: 'Sorcery', mana_cost: '{1}', cmc: 1, oracle_text: 'You may cast this spell as though it had flash if you pay {2} more to cast it.\nDestroy all creatures.' }),
  makeCard({ name: 'Child of the Volcano', type_line: 'Creature — Elemental', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Trample\nAt the beginning of your end step, if you descended this turn, put a +1/+1 counter on this creature.' }),
  makeCard({ name: 'Cleric Lite', type_line: 'Creature — Human Cleric', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'At the beginning of your end step, if a creature died under your control this turn, create a 1/1 white Human Soldier creature token.' }),
  makeCard({ name: 'Shrine of Loyal Legions', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'At the beginning of your upkeep and whenever you cast a white spell, put a charge counter on this artifact.\n{3}, {T}, Sacrifice this artifact: Create a 1/1 colorless Phyrexian Myr artifact creature token for each charge counter on this artifact.' }),
  makeCard({ name: 'White Salve', type_line: 'Instant', mana_cost: '{W}', cmc: 1, colors: ['W'], oracle_text: 'You gain 1 life.' }),
  makeCard({ name: 'Orcish Mine', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant land\nThis Aura enters with three ore counters on it.\nAt the beginning of your upkeep and whenever enchanted land becomes tapped, remove an ore counter from this Aura.\nWhen the last ore counter is removed from this Aura, destroy enchanted land and this Aura deals 2 damage to that land\'s controller.' }),
  makeCard({ name: 'Tap Land', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Tap target land.' }),
  makeCard({ name: 'Heartless Act', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Choose one —\n• Destroy target creature with no counters on it.\n• Remove up to three counters from target creature.' }),
  makeCard({ name: 'Leatherhead Lite', type_line: 'Creature — Crocodile', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Whenever this creature deals combat damage to a player, you may remove a counter from this creature. When you do, you gain 5 life.' }),
  makeCard({ name: 'Great Train Heist', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Choose target opponent. Whenever a creature you control deals combat damage to that player this turn, create a tapped Treasure token.' }),
  makeCard({ name: 'Thousand-Year Storm', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Whenever you cast an instant or sorcery spell, copy it for each other instant and sorcery spell you've cast before it this turn. You may choose new targets for the copies." }),
  makeCard({ name: 'Cavern-Hoard Dragon', type_line: 'Creature — Dragon', mana_cost: '{7}{R}{R}', cmc: 9, power: '6', toughness: '6', oracle_text: 'This spell costs {X} less to cast, where X is the greatest number of artifacts an opponent controls.\nFlying' }),
  makeCard({ name: 'Laelia Lite', type_line: 'Creature — Spirit Warrior', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever one or more cards are put into exile from your library and/or your graveyard, put a +1/+1 counter on this creature.' }),
  makeCard({ name: 'Exile Two', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Exile the top two cards of your library.' }),
  makeCard({ name: 'Steel Hellkite', type_line: 'Artifact Creature — Dragon', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: 'Flying\n{X}: Destroy each nonland permanent with mana value X whose controller was dealt combat damage by this creature this turn. Activate only once each turn.' }),
  makeCard({ name: 'Combustible Gearhulk', type_line: 'Artifact Creature — Construct', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: "First strike\nWhen this creature enters, target opponent may have you draw three cards. If the player doesn't, you mill three cards, then this creature deals damage to that player equal to the total mana value of those cards." }),
  makeCard({ name: 'Finale of Revelation', type_line: 'Sorcery', mana_cost: '{X}{U}{U}', oracle_text: 'Draw X cards. If X is 10 or more, instead shuffle your graveyard into your library, draw X cards, untap up to five lands, and you have no maximum hand size for the rest of the game.\nExile Finale of Revelation.' }),
  makeCard({ name: 'Relentless Assault', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Untap all creatures that attacked this turn. After this main phase, there is an additional combat phase followed by an additional main phase.' }),
  makeCard({ name: 'Antiquities Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Artifacts you control become artifact creatures with base power and toughness 5/5 until end of turn.' }),
  makeCard({ name: 'Sword Lite', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equipped creature gets +1/+1.\nEquip {1}' }),
  makeCard({ name: 'Proft Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "At the beginning of combat on your turn, if you've drawn more than one card this turn, put X +1/+1 counters on target creature you control, where X is the number of cards you've drawn this turn minus one." }),
  makeCard({ name: 'Draw Three', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw three cards.' }),
  makeCard({ name: 'Baleful Mastery', type_line: 'Instant', mana_cost: '{3}{B}', cmc: 4, oracle_text: "You may pay {1}{B} rather than pay this spell's mana cost.\nIf the {1}{B} cost was paid, an opponent draws a card.\nExile target creature or planeswalker." }),
  makeCard({ name: 'Vaultborn Tyrant', type_line: 'Creature — Dinosaur', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: "Trample\nWhen this creature dies, if it's not a token, create a token that's a copy of it, except it's an artifact in addition to its other types." }),
  makeCard({ name: 'Behind the Mask', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Kicker {1}\nUntil end of turn, target artifact or creature becomes an artifact creature with base power and toughness 4/3. If this spell was kicked, it has base power and toughness 1/1 until end of turn instead.' }),
  makeCard({ name: 'Braggart Lite', type_line: 'Creature — Dwarf Berserker', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Boast — {0}: You gain 1 life. (Activate only if this creature attacked this turn and only once each turn.)' }),
  makeCard({ name: 'Birgi Lite', type_line: 'Legendary Creature — God', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Creatures you control can boast twice during each of your turns rather than once.' }),
  makeCard({ name: 'Archway of Innovation', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {U}.\n{U}, {T}: The next spell you cast this turn has improvise.' }),
  makeCard({ name: 'Ogre Spell', type_line: 'Sorcery', mana_cost: '{3}', cmc: 3, oracle_text: 'You gain 3 life.' }),
  makeCard({ name: 'Braids, Arisen Nightmare', type_line: 'Legendary Creature — Nightmare', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: "At the beginning of your end step, you may sacrifice an artifact, creature, enchantment, land, or planeswalker. If you do, each opponent may sacrifice a permanent of their choice that shares a card type with it. For each opponent who doesn't, that player loses 2 life and you draw a card." }),
  makeCard({ name: 'Lithoform Lite', type_line: 'Legendary Artifact', mana_cost: '{0}', oracle_text: '{0}, {T}: Copy target permanent spell you control. (The copy becomes a token.)' }),
  makeCard({ name: 'Tarmogoyf', type_line: 'Creature — Lhurgoyf', mana_cost: '{0}', power: '*', toughness: '1+*', oracle_text: "Tarmogoyf's power is equal to the number of card types among cards in all graveyards and its toughness is equal to that number plus 1." }),
  makeCard({ name: 'Mutavault', type_line: 'Land', mana_cost: '', oracle_text: "{T}: Add {C}.\n{1}: This land becomes a 2/2 creature with all creature types until end of turn. It's still a land." }),
  makeCard({ name: 'Sudden Spoiling', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Until end of turn, creatures target player controls lose all abilities and have base power and toughness 0/2.' }),
  makeCard({ name: 'Oko Lite', type_line: 'Legendary Planeswalker — Oko', mana_cost: '{0}', loyalty: '4', oracle_text: '+1: Target artifact or creature loses all abilities and becomes a green Elk creature with base power and toughness 3/3.' }),
  makeCard({ name: 'Wiccan Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}: Exile the top card of your library. Until your next end step, you may play it.' }),
  makeCard({ name: 'Peacemaker Lite', type_line: 'Creature — Human', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever an opponent commits a crime, you gain 2 life.' }),
  makeCard({ name: 'Opposition Agent', type_line: 'Creature — Human Rogue', mana_cost: '{0}', power: '3', toughness: '2', oracle_text: "Flash\nYou control your opponents while they're searching their libraries.\nWhile an opponent is searching their library, they exile each card they find. You may play those cards for as long as they remain exiled, and you may spend mana as though it were mana of any color to cast them." }),
  makeCard({ name: 'Tutor Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Search your library for a card, put that card into your hand, then shuffle.' }),
  makeCard({ name: "Black Sun's Twilight", type_line: 'Sorcery', mana_cost: '{X}{B}', oracle_text: 'Up to one target creature gets -X/-X until end of turn. If X is 5 or more, return a creature card with mana value X or less from your graveyard to the battlefield tapped.' }),
  makeCard({ name: 'Big Ogre', type_line: 'Creature — Ogre', mana_cost: '{4}{R}', cmc: 5, power: '5', toughness: '5', oracle_text: '' }),
  makeCard({ name: 'Masked Vandal', type_line: 'Creature — Shapeshifter', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: 'Changeling\nWhen this creature enters, you may exile a creature card from your graveyard. If you do, exile target artifact or enchantment an opponent controls.' }),
  makeCard({ name: 'Knights Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Other creatures you control get +2/+2 until end of turn. Put an indestructible counter on each of them.' }),
  makeCard({ name: "Urza's Workshop", type_line: 'Land', mana_cost: '', oracle_text: "Metalcraft — {T}: Add {C} for each Urza's land you control. Activate only if you control three or more artifacts." }),
  makeCard({ name: "Urza's Mine", type_line: 'Land — Urza’s Mine', mana_cost: '', oracle_text: '' }),
  makeCard({ name: 'Lignify', type_line: 'Tribal Enchantment — Treefolk Aura', mana_cost: '{0}', oracle_text: 'Enchant creature\nEnchanted creature is a Treefolk with base power and toughness 0/4 and loses all abilities.' }),
  makeCard({ name: 'Spiteful Visions', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'At the beginning of each player\'s draw step, that player draws an additional card.\nWhenever a player draws a card, this enchantment deals 1 damage to that player.' }),
  makeCard({ name: 'Auramancy Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Enchanted creatures you control have shroud.' }),
  makeCard({ name: 'Plain Aura', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature\nEnchanted creature gets +1/+0.' }),
  makeCard({ name: 'Necro Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'At the beginning of your end step, you may pay any amount of life. If you do, draw that many cards.' }),
  makeCard({ name: 'Mask Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever a creature you control dies, you may pay X life, where X is its power. If you do, draw X cards.' }),
  makeCard({ name: 'Arclight Phoenix', type_line: 'Creature — Phoenix', mana_cost: '{3}{R}', cmc: 4, power: '3', toughness: '2', oracle_text: "Flying, haste\nAt the beginning of combat on your turn, if you've cast three or more instant and sorcery spells this turn, return this card from your graveyard to the battlefield." }),
  makeCard({ name: 'Sarah Lite', type_line: 'Creature — Human', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'As long as an artifact entered the battlefield under your control this turn, creatures you control get +2/+2.' }),
  makeCard({ name: 'Lamia Lite', type_line: 'Creature — Snake Lamia', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: 'Spells you cast from your graveyard cost {1} less to cast.' }),
  makeCard({ name: 'Grave Spell', type_line: 'Sorcery', mana_cost: '{2}', cmc: 2, oracle_text: 'You gain 2 life.\nFlashback {2}' }),
  makeCard({ name: 'Technician Lite', type_line: 'Creature — Human', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever this creature deals combat damage to a player, you may put an artifact card with mana value less than or equal to that damage from your hand onto the battlefield.' }),
  makeCard({ name: 'Two Relic', type_line: 'Artifact', mana_cost: '{2}', cmc: 2, oracle_text: '' }),
  makeCard({ name: 'Three Relic', type_line: 'Artifact', mana_cost: '{3}', cmc: 3, oracle_text: '' }),
  makeCard({ name: 'Production Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'At the beginning of your upkeep, if you control eight or more artifacts with the same name as one another, you win the game.' }),
  makeCard({ name: 'Horn Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Whenever two or more creatures you control attack a player, draw a card.' }),
  makeCard({ name: 'Lightbringer Lite', type_line: 'Creature — Spirit', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "Whenever you attack a player, create a 1/1 white Glimmer enchantment creature token that's tapped and attacking that player." }),
  makeCard({ name: 'Camellia Lite', type_line: 'Creature — Squirrel', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever you sacrifice one or more Foods, create a 1/1 green Squirrel creature token.' }),
  makeCard({ name: 'Food Card', type_line: 'Artifact — Food', mana_cost: '{0}', oracle_text: '' }),
  makeCard({ name: 'Feast Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Sacrifice two Foods: You gain 1 life.' }),
  makeCard({ name: 'Endstone Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Whenever you play a land or cast a spell, draw a card.' }),
  makeCard({ name: 'Ezuri Lite', type_line: 'Creature — Phyrexian', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever you proliferate, draw a card.' }),
  makeCard({ name: 'Proliferate Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Proliferate.' }),
  makeCard({ name: 'Patron Lite', type_line: 'Creature — Elf', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "Whenever you put one or more counters on a creature you don't control, draw a card." }),
  makeCard({ name: 'Grow Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Put a +1/+1 counter on target creature.' }),
  makeCard({ name: 'Tergrid Lite', type_line: 'Legendary Creature — God', mana_cost: '{0}', power: '4', toughness: '5', oracle_text: 'Whenever an opponent sacrifices a nontoken permanent or discards a permanent card, you may put that card from a graveyard onto the battlefield under your control.' }),
  makeCard({ name: 'Edict Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Each opponent sacrifices a creature of their choice.' }),
  makeCard({ name: 'Merfolk Lord', type_line: 'Creature — Merfolk', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Other Merfolk you control get +1/+1.' }),
  makeCard({ name: 'Merfolk Grunt', type_line: 'Creature — Merfolk', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Caduceus Lite', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equipped creature has "Prevent all damage that would be dealt to this creature."\nEquip {0}' }),
  makeCard({ name: 'Nabber Lite', type_line: 'Creature — Goblin Rogue', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Whenever an opponent taps an artifact for mana, gain control of that artifact until the end of your next turn.' }),
  makeCard({ name: 'Mind Stone Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}: Add {C}.' }),
  makeCard({ name: 'Throttle Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'After this main phase, there are two additional combat phases.\nAt the beginning of each combat this turn, untap all creatures that attacked this turn.' }),
  makeCard({ name: 'Palantir Lite', type_line: 'Legendary Artifact', mana_cost: '{0}', oracle_text: "At the beginning of your end step, put an influence counter on this artifact and scry 2. Then target opponent may have you draw a card. If that player doesn't, you mill X cards, where X is the number of influence counters on this artifact, and that player loses life equal to the total mana value of those cards." }),
  makeCard({ name: 'Containment Lite', type_line: 'Artifact Creature — Construct', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: 'Whenever you discard a card, you may exile that card from your graveyard. If you do, you may play that card this turn.' }),
  makeCard({ name: 'Taunt Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Goad all creatures your opponents control. Until your next turn, those creatures can't block." }),
  makeCard({ name: 'Maha Lite', type_line: 'Legendary Creature — Elemental Bird', mana_cost: '{0}', power: '6', toughness: '5', oracle_text: 'Creatures your opponents control have base toughness 1.' }),
  makeCard({ name: 'Jarad Lite', type_line: 'Legendary Creature — Zombie Elf', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Sacrifice a Swamp and a Forest: Return this card from your graveyard to your hand.' }),
  makeCard({ name: 'Swamp', type_line: 'Basic Land — Swamp', mana_cost: '', oracle_text: '({T}: Add {B}.)' }),
  makeCard({ name: 'Gix Lite', type_line: 'Legendary Creature — Phyrexian Praetor', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Whenever a creature deals combat damage to one of your opponents, its controller may pay 1 life. If they do, they draw a card.' }),
  makeCard({ name: 'Caryatid Lite', type_line: 'Creature — Plant', mana_cost: '{0}', power: '0', toughness: '1', oracle_text: '{T}: Add one mana of any color. If you control a creature with power 4 or greater, add two mana of any one color instead.' }),
  makeCard({ name: 'Chainer Lite', type_line: 'Legendary Creature — Human Minion', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "Whenever a nontoken creature you control enters, if you didn't cast it from your hand, it gains haste until your next turn." }),
  makeCard({ name: 'Reanimate Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Return target creature card from your graveyard to the battlefield.' }),
  makeCard({ name: 'Winds Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each player shuffles the cards from their hand into their library, then draws that many cards.' }),
  makeCard({ name: 'Manabarbs Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever a player taps a land for mana, this enchantment deals 1 damage to that player.' }),
  makeCard({ name: 'Vraska Fall Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Each opponent sacrifices a creature or planeswalker of their choice and gets a poison counter.' }),
  makeCard({ name: 'Debt Lite', type_line: 'Sorcery', mana_cost: '{X}', oracle_text: 'Each opponent loses two times X life. You gain life equal to the life lost this way.' }),
  makeCard({ name: 'Conduit Lite', type_line: 'Creature — Eldrazi', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: 'The first creature spell you cast each turn costs {2} less to cast.' }),
  makeCard({ name: 'Sandwurm Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Creatures with flying can't attack you or planeswalkers you control." }),
  makeCard({ name: 'Bird Lite', type_line: 'Creature — Bird', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Flying' }),
  makeCard({ name: 'Formation Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "{0}: Target creature with defender can attack this turn as though it didn't have defender." }),
  makeCard({ name: 'Wall Lite', type_line: 'Creature — Wall', mana_cost: '{0}', power: '0', toughness: '4', oracle_text: 'Defender' }),
  makeCard({ name: 'Zul Lite', type_line: 'Legendary Creature — Zombie Warlock', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '{T}: You may cast target Zombie creature card from your graveyard this turn.' }),
  makeCard({ name: 'Razer Lite', type_line: 'Creature — Orc Pirate', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "Whenever this creature deals combat damage to a player, untap each creature you control. After this phase, there is an additional combat phase.\nThis creature can't attack a player it has already attacked this turn." }),
  makeCard({ name: 'Valgavoth Lite', type_line: 'Legendary Creature — Elder Demon', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: 'Whenever an opponent loses life for the first time during each of their turns, put a +1/+1 counter on this creature and draw a card.' }),
  makeCard({ name: 'Drain One', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Each opponent loses 1 life.' }),
  makeCard({ name: 'Lurrus Lite', type_line: 'Legendary Creature — Cat Nightmare', mana_cost: '{0}', power: '3', toughness: '2', oracle_text: 'Lifelink\nOnce during each of your turns, you may cast a permanent spell with mana value 2 or less from your graveyard.' }),
  makeCard({ name: 'Lapse Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Counter target spell. If that spell is countered this way, put it on top of its owner's library instead of into that player's graveyard." }),
  makeCard({ name: 'Remand Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Counter target spell. If that spell is countered this way, put it into its owner's hand instead of into that player's graveyard.\nDraw a card." }),
  makeCard({ name: 'Artisan Lite', type_line: 'Legendary Enchantment — Background', mana_cost: '{0}', oracle_text: 'Commander creatures you own have "Whenever this creature attacks a player, if no opponent has more life than that player, you create two Treasure tokens."' }),
  makeCard({ name: 'Rivaz Lite', type_line: 'Legendary Creature — Kobold Warlock', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Once during each of your turns, you may cast a Dragon creature spell from your graveyard.\nWhenever you cast a Dragon creature spell from your graveyard, it gains "When this creature dies, exile it."' }),
  makeCard({ name: 'Whelp', type_line: 'Creature — Dragon', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Flying' }),
  makeCard({ name: 'Unsealing Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever you cast a creature spell with mana value 4, 5, or 6, draw a card.' }),
  makeCard({ name: 'Four Drop', type_line: 'Creature — Beast', mana_cost: '{4}', cmc: 4, power: '4', toughness: '4', oracle_text: '' }),
  makeCard({ name: 'Cotton Lite', type_line: 'Legendary Creature — Halfling Peasant', mana_cost: '{X}', power: '1', toughness: '1', oracle_text: 'When this creature enters, create X 1/1 white Halfling creature tokens and X Food tokens.' }),
  makeCard({ name: 'Ramos Lite', type_line: 'Legendary Artifact Creature — Dragon', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: "Whenever you cast a spell, put a +1/+1 counter on this creature for each of that spell's colors." }),
  makeCard({ name: 'Gold Spell', type_line: 'Sorcery', mana_cost: '{W}{U}', cmc: 2, colors: ['W', 'U'], oracle_text: 'You gain 1 life.' }),
  makeCard({ name: 'Endstone Life', type_line: 'Legendary Artifact', mana_cost: '{0}', oracle_text: 'At the beginning of your end step, your life total becomes half your starting life total, rounded up.' }),
  makeCard({ name: 'Set Twenty', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Target player's life total becomes 20." }),
  makeCard({ name: 'Rejuvenator Lite', type_line: 'Creature — Plant Hydra', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: "When this creature dies, search your library for up to X basic land cards, where X is this creature's power, put them onto the battlefield, then shuffle." }),
  makeCard({ name: 'Hydra Lite', type_line: 'Creature — Hydra', mana_cost: '{0}', power: '3', toughness: '1', oracle_text: 'When this creature dies, you gain life and draw cards equal to its power.' }),
  makeCard({ name: 'Raid Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever a creature you control with power 2 or less attacks, this enchantment deals 1 damage to the player or planeswalker that creature is attacking.' }),
  makeCard({ name: 'Grafter Lite', type_line: 'Creature — Phyrexian Druid', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Whenever one or more creatures you control deal combat damage to one or more players, draw a card.' }),
  makeCard({ name: 'Titan Lite', type_line: 'Artifact Creature — Golem', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'When this creature dies, create a 3/3 colorless Golem artifact creature token with flying, a 3/3 colorless Golem artifact creature token with vigilance, and a 3/3 colorless Golem artifact creature token with lifelink.' }),
  makeCard({ name: 'Rotpriest Lite', type_line: 'Creature — Phyrexian Druid', mana_cost: '{0}', power: '1', toughness: '2', oracle_text: 'Whenever a creature you control becomes the target of a spell, target opponent gets a poison counter.' }),
  makeCard({ name: 'Thalisse Lite', type_line: 'Legendary Creature — Human Cleric', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: 'At the beginning of each end step, create X 1/1 white Spirit creature tokens with flying, where X is the number of tokens you created this turn.' }),
  makeCard({ name: 'Make Two', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Create two 1/1 white Soldier creature tokens.' }),
  makeCard({ name: 'Specimen Lite', type_line: 'Creature — Weird', mana_cost: '{0}', power: '1', toughness: '4', oracle_text: 'Flash\nWhen this creature enters, you may change the target of target instant or sorcery spell with a single target to this creature.' }),
  makeCard({ name: 'Trawler Lite', type_line: 'Artifact Creature — Construct', mana_cost: '{3}', cmc: 3, power: '3', toughness: '2', oracle_text: 'Whenever this creature dies or another artifact you control is put into a graveyard from the battlefield, return to your hand target artifact card in your graveyard with lesser mana value.' }),
  makeCard({ name: 'Two Rock', type_line: 'Artifact', mana_cost: '{2}', cmc: 2, oracle_text: '' }),
  makeCard({ name: 'Shatter Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target artifact.' }),
  makeCard({ name: 'Etali Lite', type_line: 'Legendary Creature — Elder Dinosaur', mana_cost: '{0}', power: '7', toughness: '7', oracle_text: 'When Etali enters, each player exiles cards from the top of their library until they exile a nonland card. You may cast any number of spells from among the nonland cards exiled this way without paying their mana costs.' }),
  makeCard({ name: 'Battlesphere Lite', type_line: 'Artifact Creature — Myr Construct', mana_cost: '{0}', power: '4', toughness: '7', oracle_text: "Whenever this creature attacks, you may tap X untapped Myr you control. If you do, this creature gets +X/+0 until end of turn and deals X damage to the player or planeswalker it's attacking." }),
  makeCard({ name: 'Myr Lite', type_line: 'Artifact Creature — Myr', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Spellskite Lite', type_line: 'Artifact Creature — Horror', mana_cost: '{0}', power: '0', toughness: '4', oracle_text: '{0}: Change a target of target spell or ability to this creature.' }),
  makeCard({ name: 'Celebrant Lite', type_line: 'Creature — Human Warrior', mana_cost: '{0}', power: '4', toughness: '1', oracle_text: "Vigilance\nIf this creature hasn't been exerted this turn, you may exert it as it attacks. When you do, untap all other creatures you control and after this phase, there is an additional combat phase." }),
  makeCard({ name: 'Scourge Lite', type_line: 'Creature — Dragon', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: "Whenever this creature attacks for the first time each turn, if it's attacking the player with the most life or tied for most life, untap all attacking creatures. After this phase, there is an additional combat phase." }),
  makeCard({ name: 'Kambal Lite', type_line: 'Legendary Creature — Human Advisor', mana_cost: '{0}', power: '2', toughness: '4', oracle_text: "Whenever one or more tokens your opponents control enter, for each of them, create a tapped token that's a copy of it. This ability triggers only once each turn." }),
  makeCard({ name: 'Omnath Lite', type_line: 'Legendary Creature — Elemental', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: "Landfall — Whenever a land you control enters, you gain 4 life if this is the first time this ability has resolved this turn. If it's the second time, add {R}{G}{W}{U}. If it's the third time, Omnath Lite deals 4 damage to each opponent and each planeswalker you don't control." }),
  makeCard({ name: 'Rumor Gatherer Lite', type_line: 'Creature — Elf Wizard', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: 'Alliance — Whenever another creature you control enters, scry 1. If this is the second time this ability has resolved this turn, draw a card instead.' }),
  makeCard({ name: 'Soulbright Lite', type_line: 'Creature — Elemental Sorcerer', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: '{0}: Target creature you control gains trample until end of turn. If this is the third time this ability has resolved this turn, add {R}{R}{R}{R}.' }),
  makeCard({ name: 'Nissa Lite', type_line: 'Legendary Creature — Elf Scout', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Landfall — Whenever a land you control enters, add one mana of any color. Then if this is the second time this ability has resolved this turn, reveal cards from the top of your library until you reveal an Elf or Elemental card. Put that card into your hand and the rest on the bottom of your library in a random order.' }),
  makeCard({ name: 'Ignus Lite', type_line: 'Creature — Elemental', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '{R}, Return this creature to its owner\'s hand: Add {C}{C}{R}. Activate only as a sorcery.' }),
  makeCard({ name: 'Shigeki Lite', type_line: 'Legendary Enchantment Creature — Snake Druid', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: "{0}, Return Shigeki Lite to its owner's hand: Reveal the top four cards of your library. You may put a land card from among them onto the battlefield tapped. Put the rest into your graveyard." }),
  makeCard({ name: 'Pod Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "{0}, Sacrifice a creature: Search your library for a creature card with mana value equal to 1 plus the sacrificed creature's mana value, put that card onto the battlefield, then shuffle. Activate only as a sorcery." }),
  makeCard({ name: 'Neoform Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "As an additional cost to cast this spell, sacrifice a creature.\nSearch your library for a creature card with mana value equal to 1 plus the sacrificed creature's mana value, put that card onto the battlefield with an additional +1/+1 counter on it, then shuffle." }),
  makeCard({
    name: 'Praetor Lite // Scriptures Lite',
    layout: 'transform',
    type_line: 'Legendary Creature — Phyrexian Praetor // Enchantment — Saga',
    oracle_text: '',
    mana_cost: '{0}',
    card_faces: [
      { object: 'card_face', name: 'Praetor Lite', type_line: 'Legendary Creature — Phyrexian Praetor', mana_cost: '{0}', power: '4', toughness: '5', oracle_text: '{0}: Exile Praetor Lite, then return it to the battlefield transformed under its owner\'s control. Activate only as a sorcery and only if an opponent has eight or more cards in their graveyard.' },
      { object: 'card_face', name: 'Scriptures Lite', type_line: 'Enchantment — Saga', mana_cost: '', oracle_text: '(As this Saga enters and after your draw step, add a lore counter.)\nI — Each opponent discards three cards, then mills three cards.\nII — You gain 1 life.\nIII — You gain 1 life.' },
    ],
  } as never),
  makeCard({ name: 'Vivien Hunt Lite', type_line: 'Legendary Planeswalker — Vivien', mana_cost: '{0}', loyalty: '4', oracle_text: "+2: You may sacrifice a creature. If you do, search your library for a creature card with mana value equal to 1 plus the sacrificed creature's mana value, put it onto the battlefield, then shuffle." }),
  makeCard({ name: 'Sorcery Elf', type_line: 'Creature — Elf Druid', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{T}: Add {G}{G}. Activate only as a sorcery.' }),
  makeCard({ name: 'Archway Lite', type_line: 'Land — Desert', mana_cost: '', oracle_text: "When this land enters, return a land you control to its owner's hand. If another Desert was returned this way, surveil 1.\n{T}: Add {C}{C}." }),
  makeCard({ name: 'Desert Lite', type_line: 'Land — Desert', mana_cost: '', oracle_text: '{T}: Add {C}.' }),
  makeCard({ name: 'Commando Lite', type_line: 'Creature — Angel Soldier', mana_cost: '{0}', power: '4', toughness: '3', oracle_text: 'Flying\nWhenever another player attacks with two or more creatures, they draw a card if none of those creatures attacked you.' }),
  makeCard({ name: 'Wrath Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Choose up to one target creature, then airbend all other creatures.\nUntil your next turn, your opponents can't cast spells from anywhere other than their hands." }),
  makeCard({ name: 'Fighter Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Equip abilities you activate cost {2} less to activate.' }),
  makeCard({ name: 'Heavy Sword', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equipped creature gets +1/+1.\nEquip {3}\n{2}: You gain 1 life.' }),
  makeCard({ name: 'Two Salve', type_line: 'Instant', mana_cost: '{2}', cmc: 2, oracle_text: 'You gain 2 life.' }),
  makeCard({ name: 'Battlecrier Lite', type_line: 'Creature — Orc Ranger', mana_cost: '{0}', power: '4', toughness: '3', oracle_text: 'During your turn, spells you cast cost {1} less to cast for each creature you control with power 4 or greater.' }),
  makeCard({ name: 'Glare Lite', type_line: 'Sorcery', mana_cost: '{X}', oracle_text: 'Destroy target creature with power X or less.' }),
  makeCard({ name: 'Lyre Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{X}, {T}: Tap target creature with power X or less.' }),
  makeCard({ name: 'Sprite Lite', type_line: 'Creature — Faerie Wizard', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Flash\nWhen this creature enters, counter target spell with mana value X or less, where X is the number of Faeries you control.' }),
  makeCard({ name: 'Progress Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Progress Lite deals damage to each player equal to twice the number of nonbasic lands that player controls.' }),
  makeCard({ name: 'Beast Lite', type_line: 'Legendary Creature — Beast', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: "Haste\nCombat damage that would be dealt by creatures you control can't be prevented." }),
  makeCard({ name: 'Stormtide Lite', type_line: 'Creature — Leviathan', mana_cost: '{0}', power: '8', toughness: '8', oracle_text: "Islandwalk\nCreatures without flying or islandwalk can't attack." }),
  makeCard({ name: 'Roots Lite', type_line: 'Creature — Plant Wall', mana_cost: '{0}', power: '0', toughness: '5', oracle_text: 'Defender\nPut a -0/-1 counter on this creature: Add {G}. Activate only once each turn.' }),
  makeCard({ name: 'Push Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target creature if it has mana value 2 or less.\nRevolt — Destroy that creature if it has mana value 4 or less instead if a permanent left the battlefield under your control this turn.' }),
  makeCard({ name: 'Hidetsugu Lite', type_line: 'Legendary Creature — Ogre Shaman', mana_cost: '{0}', power: '1', toughness: '2', oracle_text: "{T}: Hidetsugu Lite deals damage to each player equal to half that player's life total, rounded down." }),
  makeCard({ name: 'Oven Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "{T}, Sacrifice a creature: Create a Food token. If the sacrificed creature's toughness was 4 or greater, create two Food tokens instead." }),
  makeCard({ name: 'Den Lite', type_line: 'Land', mana_cost: '', oracle_text: 'If you control two or more other lands, this land enters tapped.\n{T}: Add {R}.' }),
  makeCard({ name: 'Stretch Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target player takes two extra turns after this one.' }),
  makeCard({ name: 'Bloom Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'You may play up to three additional lands this turn.' }),
  makeCard({ name: 'Merchant Lite', type_line: 'Creature — Human Citizen', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{T}, Remove a counter from a nonland permanent you control: Draw a card.' }),
  makeCard({ name: 'Initiate Lite', type_line: 'Creature — Human Warlock', mana_cost: '{0}', power: '1', toughness: '2', oracle_text: '{0}, Remove two +1/+1 counters from among creatures you control: You gain 5 life.' }),
  makeCard({ name: 'Nexus Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "Creatures you control are every creature type. The same is true for creature spells you control and creature cards you own that aren't on the battlefield." }),
  makeCard({ name: 'Awakening Lite', type_line: 'Sorcery', mana_cost: '{X}', oracle_text: 'Return from your graveyard to the battlefield any number of target creature cards that each have a different mana value X or less.' }),
  makeCard({ name: 'Run Away Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Choose two target creatures controlled by different players. Return those creatures to their owners' hands." }),
  makeCard({ name: 'Tunnel Lite', type_line: 'Land', mana_cost: '', oracle_text: "{0}, {T}: Two target creatures you control that share a creature type can't be blocked this turn." }),
  makeCard({ name: 'Switcheroo Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Exchange control of two target creatures.' }),
  makeCard({ name: 'Gilded Lite', type_line: 'Creature — Drake', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: "Flying\nWhen this creature enters, exchange control of this creature and up to one target creature an opponent controls. If you don't or can't make an exchange, sacrifice this creature. This ability still resolves if its target becomes illegal." }),
  makeCard({ name: 'Stormdrake Lite', type_line: 'Creature — Drake', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: 'When this creature enters, exchange control of this creature and target creature an opponent controls. If you do, you get {E}{E}{E}{E}, then sacrifice that creature unless you pay an amount of {E} equal to its mana value.' }),
  makeCard({ name: 'Tree Lite', type_line: 'Creature — Plant', mana_cost: '{0}', power: '0', toughness: '13', oracle_text: "Defender\n{T}: Exchange your life total with this creature's toughness." }),
  makeCard({ name: 'Soul Conduit Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{0}, {T}: Two target players exchange life totals.' }),
  makeCard({ name: 'Leyline Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Your opponents can't gain life." }),
  makeCard({ name: 'Mox Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "If this artifact would enter, you may discard a land card instead. If you do, put this artifact onto the battlefield. If you don't, put it into its owner's graveyard.\n{T}: Add one mana of any color." }),
  makeCard({ name: 'Artifact Watcher', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever an artifact you control enters, you gain 1 life.\nWhenever an artifact is put into a graveyard from the battlefield, you gain 2 life.\nWhenever a card is put into your graveyard from anywhere, you gain 5 life.' }),
  makeCard({ name: 'Lake Lite', type_line: 'Land', mana_cost: '', oracle_text: "If this land would enter, sacrifice a Swamp instead. If you do, put this land onto the battlefield. If you don't, put it into its owner's graveyard.\n{T}: Add {B}." }),
  makeCard({ name: 'Mentor Lite', type_line: 'Creature — Human Cleric', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "Whenever an opponent activates an ability of an artifact, creature, or land on the battlefield, if it isn't a mana ability, this creature deals 2 damage to that player." }),
  makeCard({ name: 'Fetch Lite', type_line: 'Land', mana_cost: '', oracle_text: '{T}, Pay 1 life, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield, then shuffle.' }),
  makeCard({ name: 'Doom Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Choose up to two creatures, then destroy the rest.' }),
  makeCard({ name: 'Reckoning Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each player chooses a creature they control. Destroy the rest.' }),
  makeCard({ name: 'Colossus Lite', type_line: 'Creature — Plant Beast', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: 'When this creature enters, you may put a land card from your hand onto the battlefield tapped. If you do, draw a card and repeat this process.' }),
  makeCard({ name: 'Key Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Search your library for an artifact card with a mana ability or a basic land card, reveal it, put it into your hand, then shuffle.' }),
  makeCard({ name: 'Signet Lite', type_line: 'Artifact', mana_cost: '{2}', cmc: 2, oracle_text: '{T}: Add {C}.' }),
  makeCard({ name: 'Show Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each player may put an artifact, creature, enchantment, or land card from their hand onto the battlefield.' }),
  makeCard({ name: 'Jeskai Wheel', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each player may discard their hand and draw five cards.' }),
  makeCard({ name: 'Final Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each opponent loses all counters.' }),
  makeCard({ name: 'Vanity Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Choose a creature or planeswalker, then destroy all other creatures and planeswalkers.' }),
  makeCard({ name: 'Scry Command', type_line: 'Instant', mana_cost: '{X}', oracle_text: 'Target player scries X, then draws a card.' }),
  makeCard({ name: 'Feed Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Target opponent loses life equal to the amount of life they lost this turn.' }),
  makeCard({ name: 'Punk Lite', type_line: 'Legendary Creature — Spider Human Hero', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: "Spells and abilities can't be countered." }),
  makeCard({ name: 'Squelch Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Counter target activated ability.' }),
  makeCard({ name: 'Pinger', type_line: 'Creature — Goblin', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{0}: You gain 1 life.' }),
  makeCard({ name: 'Charix Lite', type_line: 'Legendary Creature — Leviathan Crab', mana_cost: '{0}', power: '0', toughness: '17', oracle_text: 'Spells your opponents cast that target Charix Lite cost {2} more to cast.' }),
  makeCard({ name: 'Alisaie Lite', type_line: 'Legendary Creature — Elf Wizard', mana_cost: '{0}', power: '3', toughness: '2', oracle_text: 'The second spell you cast each turn costs {2} less to cast.' }),
  makeCard({ name: 'Reactor Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'When this artifact has twenty or more charge counters on it, you win the game.' }),
  makeCard({ name: 'Octopus Lite', type_line: 'Artifact Creature — Equipment Octopus', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever this creature or equipped creature deals combat damage to a player, draw a card.' }),
  makeCard({ name: 'Horrigan Lite', type_line: 'Legendary Creature — Mutant Warrior', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: 'Horrigan Lite has indestructible as long as it attacked this turn.' }),
  makeCard({ name: 'Deathmantle Lite', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equipped creature gets +2/+2, has intimidate, and is a black Zombie.\nEquip {4}' }),
  makeCard({ name: 'Visions Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Draw a card. If a graveyard has twenty or more cards in it, draw three cards instead.' }),
  makeCard({ name: 'Teeg Lite', type_line: 'Legendary Creature — Kithkin Advisor', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "Noncreature spells with {X} in their mana costs can't be cast." }),
  makeCard({ name: 'X Burn', type_line: 'Instant', mana_cost: '{X}', oracle_text: 'X Burn deals X damage to any target.' }),
  makeCard({ name: 'Tortoise Lite', type_line: 'Creature — Turtle', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Each creature you control with toughness greater than its power assigns combat damage equal to its toughness rather than its power.' }),
  makeCard({ name: 'Wall Guy', type_line: 'Creature — Wall', mana_cost: '{0}', power: '1', toughness: '4', oracle_text: '' }),
  makeCard({ name: 'Kaalia Lite', type_line: 'Legendary Creature — Human Cleric', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever Kaalia Lite attacks an opponent, you may put an Angel, Demon, or Dragon creature card from your hand onto the battlefield tapped and attacking that opponent.' }),
  makeCard({ name: 'Dragon Lite', type_line: 'Creature — Dragon', mana_cost: '{6}', cmc: 6, power: '6', toughness: '6', oracle_text: 'Flying' }),
  makeCard({ name: 'Teachings Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Search your library for an instant card or a card with flash, reveal it, put it into your hand, then shuffle.' }),
  makeCard({ name: 'Flash Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle_text: 'Flash' }),
  makeCard({ name: 'Sower Lite', type_line: 'Creature — Faerie Wizard', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'When this creature enters, gain control of target creature for as long as this creature remains on the battlefield.' }),
  makeCard({ name: 'Jailer Lite', type_line: 'Creature — Human Soldier', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'When this creature enters, exile target creature an opponent controls until an opponent becomes the monarch.' }),
  makeCard({ name: 'Crown Grab', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target player becomes the monarch.' }),
  makeCard({ name: 'Ten Rings Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'At the beginning of your end step, if you have fewer than ten cards in hand, draw cards equal to the difference.' }),
  makeCard({ name: 'Oracle Lite', type_line: 'Artifact Creature — Sphinx', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: 'When this creature enters, choose an opponent. If that player has more cards in hand than you, draw cards equal to the difference.' }),
  makeCard({ name: 'Hakbal Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each Merfolk creature you control explores.' }),
  makeCard({ name: 'Merfolk', type_line: 'Creature — Merfolk', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Hammer Lite', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Double all damage equipped creature would deal.\nEquip {4}' }),
  makeCard({ name: 'Titania Lite', type_line: 'Legendary Creature — Elemental', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'You may play Forests from your graveyard.' }),
  makeCard({ name: 'Scoundrel Lite', type_line: 'Creature — Human Rogue', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: 'Whenever you win a coin flip, create two Treasure tokens.\n{0}: Flip a coin.' }),
  makeCard({ name: 'Raptor Lite', type_line: 'Creature — Dinosaur', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: "Whenever a player casts a spell, if it's not their turn, this creature deals 4 damage to them." }),
  makeCard({ name: 'Traxos Lite', type_line: 'Legendary Artifact Creature — Dragon Construct', mana_cost: '{0}', power: '7', toughness: '7', oracle_text: "Trample\nTraxos Lite enters tapped and doesn't untap during your untap step." }),
  makeCard({ name: 'Rug Lite', type_line: 'Artifact Creature — Construct', mana_cost: '{0}', power: '2', toughness: '4', oracle_text: "Whenever a player casts a spell, they lose 1 life for each spell they've cast this turn." }),
  makeCard({ name: 'Bontu Lite', type_line: 'Legendary Creature — Zombie God', mana_cost: '{0}', power: '5', toughness: '6', oracle_text: 'When this creature enters, sacrifice any number of other permanents, then draw that many cards.' }),
  makeCard({ name: 'Dracosaur Lite', type_line: 'Creature — Dinosaur Dragon', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: 'At the beginning of your upkeep, exile the top two cards of your library. You may play them this turn. If you exiled a land card this way, create a 3/1 red Dinosaur creature token. If you exiled a nonland card this way, create a Treasure token.' }),
  makeCard({ name: 'Exploration Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Landfall — Whenever a land you control enters, exile the top card of your library. You may play that card for as long as it remains exiled.\nAt the beginning of your end step, if there are cards exiled with this enchantment, put them into their owner's graveyard, then this enchantment deals that much damage to each opponent." }),
  makeCard({ name: 'Skullspore Lite', type_line: 'Legendary Artifact', mana_cost: '{0}', oracle_text: 'Whenever one or more nontoken creatures you control die, create a green Fungus Dinosaur creature token with base power and toughness each equal to the total power of those creatures.' }),
  makeCard({ name: 'Annihilate Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Destroy all creatures.' }),
  makeCard({ name: 'Ring Lite', type_line: 'Snow Artifact', mana_cost: '{0}', oracle_text: 'At the beginning of your upkeep, put a night counter on this artifact. Then if it has eight or more night counters on it, remove all of them and create eight colorless snow artifact tokens named Replicated Ring with "{T}: Add one mana of any color."' }),
  makeCard({ name: 'Pig Lite', type_line: 'Creature — Boar', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever you gain life, put that many ribbon counters on this creature. Then if there are three or more ribbon counters on this creature, remove those counters and untap it.' }),
  makeCard({ name: 'Relic Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}: Put a charge counter on this artifact.\nAt the beginning of your first main phase, remove all charge counters from this artifact. Add one mana of any color for each charge counter removed this way.' }),
  makeCard({ name: 'Kodama Lite', type_line: 'Legendary Creature — Spirit', mana_cost: '{0}', power: '6', toughness: '3', oracle_text: "Whenever another permanent you control enters, if it wasn't put onto the battlefield with this ability, you may put a permanent card with equal or lesser mana value from your hand onto the battlefield." }),
  makeCard({ name: 'Grid Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "Each spell costs {3} more to cast except during its controller's turn." }),
  makeCard({ name: 'Coppercoats Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Choose any number of target opponents. Create X 1/1 white Human Soldier creature tokens, where X is the number of creatures those opponents control.' }),
  makeCard({ name: 'Oketra Lite', type_line: 'Legendary Creature — Zombie God', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: "When this creature dies or is put into exile from the battlefield, you may put it into its owner's library third from the top." }),
  makeCard({ name: 'Mantle Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature you control\nWhen this Aura enters, return any number of target Aura and/or Equipment cards from your graveyard to the battlefield attached to enchanted creature.' }),
  makeCard({ name: 'Boon Aura', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature\nEnchanted creature gets +1/+1.' }),
  makeCard({ name: 'Land Aura', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant land\nEnchanted land has "{T}: Add {C}{C}."' }),
  makeCard({ name: 'Blade Lite', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equipped creature gets +2/+0.\nEquip {2}' }),
  makeCard({ name: 'Business Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Return target creature card from your graveyard to the battlefield, then return up to two target Aura and/or Equipment cards from your graveyard to the battlefield attached to that creature.' }),
  makeCard({ name: 'Gift Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: "Enchant creature\nWhen enchanted creature dies, return that card to the battlefield under its owner's control. Return this card to the battlefield attached to that creature at the beginning of the next end step." }),
  makeCard({ name: 'Malcolm Lite', type_line: 'Creature — Siren Pirate', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: 'Whenever this creature deals combat damage to a player, put a chorus counter on it. Draw a card, then discard a card. If there are four or more chorus counters on this creature, you may cast the discarded card without paying its mana cost.' }),
  makeCard({ name: 'Phelia Lite', type_line: 'Creature — Dog', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "Whenever this creature attacks, exile up to one other target nonland permanent. At the beginning of the next end step, return that card to the battlefield under its owner's control. If it entered under your control, put a +1/+1 counter on this creature." }),
  makeCard({ name: 'Aberration Lite', type_line: 'Creature — Horror', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Whenever you cast a spell, each opponent reveals cards from the top of their library until they reveal a land card, then puts those cards into their graveyard.' }),
  makeCard({ name: 'Destiny Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: "Enchant creature\nEnchanted creature gets +4/+4.\nWhen enchanted creature dies, return this card to its owner's hand." }),
  makeCard({ name: 'Raise Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Return target creature card from your graveyard to the battlefield. That creature is a black Zombie in addition to its other colors and types.' }),
  makeCard({ name: 'Ghoul Aura', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature\nEnchanted creature gets -1/-1 and is a black Zombie in addition to its other colors and types.' }),
  makeCard({ name: 'Red Ogre', type_line: 'Creature — Ogre', mana_cost: '{R}', cmc: 1, power: '5', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Shepherd Lite', type_line: 'Creature — Angel', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: 'Landfall — Whenever a land you control enters, you may return target nonland permanent card from your graveyard to your hand. If that land is a Plains, you may return that nonland permanent card to the battlefield instead.' }),
  makeCard({ name: 'Shinobi Lite', type_line: 'Creature — Zombie Ninja', mana_cost: '{0}', power: '5', toughness: '4', oracle_text: 'Whenever this creature deals combat damage to a player, that player exiles the top two cards of their library. Until end of turn, you may play those cards without paying their mana costs.' }),
  makeCard({ name: 'Symmetry Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Choose two target players. Each of them searches their library for a card, then shuffles and puts that card on top.' }),
  makeCard({ name: 'Chain Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Exile a creature you control: Add X mana of any one color, where X is 1 plus the exiled creature's mana value. Spend this mana only to cast creature spells." }),
  makeCard({ name: 'Soul Stone Lite', type_line: 'Legendary Artifact — Infinity Stone', mana_cost: '{0}', oracle_text: 'Indestructible\n{T}, Exile a creature you control: Harness Soul Stone Lite.\n∞ — At the beginning of your upkeep, return target creature card from your graveyard to the battlefield.' }),
  makeCard({ name: 'Wrenn Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Create a green Treefolk creature token with reach and "This token\'s power and toughness are each equal to the number of lands you control."' }),
  makeCard({ name: 'Dark Realms Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Target creature gets +X/+X or -X/-X until end of turn, where X is the number of Plains you control.' }),
  makeCard({ name: 'Phantom Lite', type_line: 'Creature — Illusion', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'When this creature becomes the target of a spell or ability, sacrifice it.' }),
  makeCard({ name: 'Skitterspike Lite', type_line: 'Artifact Creature — Toy', mana_cost: '{0}', power: '1', toughness: '4', oracle_text: 'Whenever this creature attacks, blocks, or becomes the target of a spell, it deals damage equal to its power to each opponent.' }),
  makeCard({ name: 'Abduction Lite', type_line: 'Enchantment Creature — Nightmare', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: "As an additional cost to cast this spell, exile a creature you control.\nWhen this creature enters, exile target creature an opponent controls.\nWhen this creature leaves the battlefield, put each card exiled with it into its owner's hand." }),
  makeCard({ name: 'Gate Lite', type_line: 'Legendary Land — Gate', mana_cost: '', oracle_text: '{T}: Add {B}.\n{T}: Choose a player with the most life or tied for most life. Target creature can\'t be blocked by creatures that player controls this turn.' }),
  makeCard({ name: 'Odric Lite', type_line: 'Legendary Creature — Human Soldier', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'At the beginning of each combat, creatures you control gain first strike until end of turn if a creature you control has first strike. The same is true for flying, deathtouch, double strike, haste, hexproof, indestructible, lifelink, menace, reach, skulk, trample, and vigilance.' }),
  makeCard({ name: 'Flier', type_line: 'Creature — Bird', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Flying' }),
  makeCard({ name: 'Warden Lite', type_line: 'Creature — Hydra Dryad', mana_cost: '{0}', power: '0', toughness: '0', oracle_text: 'This creature enters with two +1/+1 counters on it.\nWhenever another nontoken creature you control enters, it endures X, where X is the number of counters on this creature.' }),
  makeCard({ name: 'Prosper Lite', type_line: 'Legendary Creature — Tiefling Warlock', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: 'Whenever you play a card from exile, create a Treasure token.' }),
  makeCard({ name: 'Kwain Lite', type_line: 'Legendary Creature — Rabbit Warrior', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '{T}: Each player may draw a card, then each player who drew a card this way gains 1 life.' }),
  makeCard({ name: 'Symbiosis Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Look at the top seven cards of your library. You may put a creature card from among them onto the battlefield. If that card has mana value 3 or less, it enters with three additional +1/+1 counters on it. Put the rest on the bottom of your library in a random order.' }),
  makeCard({ name: 'Presence Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Reveal the top four cards of your library. You may put a creature card and/or a land card from among them into your hand. Put the rest into your graveyard.' }),
  makeCard({ name: 'Wrathful Lite', type_line: 'Creature — Dragon', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: "Whenever a Dragon you control is dealt damage, it deals that much damage to any target that isn't a Dragon." }),
  makeCard({ name: 'Small Drake', type_line: 'Creature — Dragon', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Converter Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "Whenever you discard a card, you may exile that card from your graveyard.\n{T}: Put a card exiled with this artifact into its owner's graveyard. If it's a land card, create a Treasure token. If it's a nonland card, create a 2/2 black Rogue creature token." }),
  makeCard({ name: 'Oathkeeper Lite', type_line: 'Legendary Artifact — Equipment', mana_cost: '{0}', oracle_text: "Equipped creature gets +3/+1.\nWhen this Equipment is put into a graveyard from the battlefield, exile equipped creature.\nEquip {2}" }),
  makeCard({ name: 'Nantuko Lite', type_line: 'Enchantment Creature — Insect Monk', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], power: '1', toughness: '1', oracle_text: "Bestow {1}{G}\nEnchanted creature gets +1/+1.\nLandfall — Whenever a land you control enters, you may pay {1}{G} if this permanent is attached to a creature you control. If you do, create a token that's a copy of that creature. If you didn't create a token this way, create a 1/1 green Insect creature token." }),
  makeCard({ name: 'Opal Lite', type_line: 'Land', mana_cost: '', oracle_text: "{T}: Add {C}.\n{1}, {T}: Add one mana of any color in your commander's color identity. If you spend this mana to cast your commander, it enters with a number of additional +1/+1 counters on it equal to the number of times it's been cast from the command zone this game." }),
  makeCard({ name: 'Ghalta Lite', type_line: 'Legendary Creature — Dinosaur Vampire', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: 'Whenever you attack, create a tapped and attacking X/X green Dinosaur creature token with trample, where X is the greatest power among other attacking creatures.' }),
  makeCard({ name: 'Dirge Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Return up to two creature cards with total mana value 4 or less from your graveyard to the battlefield.' }),
  makeCard({ name: 'Hulk Lite', type_line: 'Creature — Beast', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'When this creature dies, search your library for any number of creature cards with total mana value 6 or less, put them onto the battlefield, then shuffle.' }),
  makeCard({ name: 'Patch Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Return up to three target creature cards with total mana value 3 or less from your graveyard to the battlefield. Put a +1/+1 counter on each of them.' }),
  makeCard({ name: 'Genesis Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Look at the top four cards of your library. You may put a land card from among them onto the battlefield tapped. If you don't, put a card from among them into your hand. Put the rest on the bottom of your library in a random order." }),
  makeCard({ name: 'Anor Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Choose one. If you control a Wizard as you cast this spell, you may choose two instead.\n• Target player draws two cards.\n• Destroy target artifact.\n• This spell deals 5 damage to target creature.' }),
  makeCard({ name: 'Wizard Lite', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Conduit of Worlds Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "{T}: Choose target nonland permanent card in your graveyard. If you haven't cast a spell this turn, you may cast that card. If you do, you can't cast additional spells this turn. Activate only as a sorcery." }),
  makeCard({ name: 'Technique Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Look at the top eight cards of your library. Put up to two creature cards with total mana value 6 or less from among them onto the battlefield and the rest on the bottom of your library in a random order.' }),
  makeCard({ name: 'Giant Four', type_line: 'Creature — Giant', mana_cost: '{3}{G}', cmc: 4, power: '4', toughness: '4', oracle_text: '' }),
  makeCard({ name: 'Ao Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Put two +1/+1 counters on each permanent you control that's a creature or Vehicle." }),
  makeCard({ name: 'Trickery Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Counter target spell. Choose 1, 2, or 3 at random. Its controller mills that many cards, then exiles cards from the top of their library until they exile a nonland card with a different name than that spell. They may cast that card without paying its mana cost. Then they put the exiled cards on the bottom of their library in a random order.' }),
  makeCard({ name: 'Hydraulic Lite', type_line: 'Artifact Creature — Construct', mana_cost: '{0}', power: '0', toughness: '3', oracle_text: "{T}: Add {U}. This mana can't be spent to cast a nonartifact spell." }),
  makeCard({ name: 'Blue Salve', type_line: 'Instant', mana_cost: '{U}', cmc: 1, colors: ['U'], oracle_text: 'You gain 1 life.' }),
  makeCard({ name: 'Rupture Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Destroy all creatures, then any number of target players each mill half their library, rounded down.' }),
  makeCard({ name: 'Wave Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Return all creatures to their owners' hands except for Krakens, Leviathans, Octopuses, and Serpents." }),
  makeCard({ name: 'Kraken Lite', type_line: 'Creature — Kraken', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: '' }),
  makeCard({ name: 'Klauth Lite', type_line: 'Legendary Creature — Dragon', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: "Whenever this creature attacks, add X mana in any combination of colors, where X is the total power of attacking creatures. Spend this mana only to cast spells. Until end of turn, you don't lose this mana as steps and phases end." }),
  makeCard({ name: 'Pact Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Choose a creature type. Target player draws X cards and loses X life, where X is the number of creatures they control of the chosen type.' }),
  makeCard({ name: 'Intuition Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Search your library for three cards and reveal them. Target opponent chooses one. Put that card into your hand and the rest into your graveyard. Then shuffle.' }),
  makeCard({ name: 'Gifts Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Search your library for up to four cards with different names and reveal them. Target opponent chooses two of those cards. Put the chosen cards into your graveyard and the rest into your hand. Then shuffle.' }),
  makeCard({ name: 'Silkguard Lite', type_line: 'Instant', mana_cost: '{X}{G}', colors: ['G'], oracle_text: 'Put a +1/+1 counter on each of up to X target creatures you control.\nAuras, Equipment, and modified creatures you control gain hexproof until end of turn.' }),
  makeCard({ name: 'Hydra Lair Lite', type_line: 'Land', mana_cost: '', oracle_text: "{T}: Add {G}.\n{X}{G}: Until end of turn, this land becomes an X/X green Hydra creature. It's still a land. X can't be 0." }),
  makeCard({ name: 'Labyrinth Lite', type_line: 'Land', mana_cost: '', oracle_text: 'Imprint — When this land enters, you may exile a colorless card with mana value 7 or greater from your hand.\n{T}: Add {C}. If a card is exiled with this land, add {C}{C} instead.' }),
  makeCard({ name: 'Big Eldrazi', type_line: 'Creature — Eldrazi', mana_cost: '{7}', cmc: 7, power: '7', toughness: '7', oracle_text: '' }),
  makeCard({ name: 'Parting Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Search your library for two cards. Put one into your hand and the other into your graveyard. Then shuffle.' }),
  makeCard({ name: 'Emiel Lite', type_line: 'Creature — Unicorn', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: "Whenever another creature you control enters, you may pay {G/W}. If you do, put a +1/+1 counter on it. If it's a Unicorn, put two +1/+1 counters on it instead." }),
  makeCard({ name: 'Unicorn Lite', type_line: 'Creature — Unicorn', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Refrain Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Add {R} for each card in target opponent's hand. Until end of turn, you don't lose this mana as steps and phases end. Exile this spell with three time counters on it.\nSuspend 3—{1}{R}" }),
  makeCard({ name: 'Ziatora Lite', type_line: 'Legendary Creature — Demon Dragon', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: "At the beginning of your end step, you may sacrifice another creature. When you do, this creature deals damage equal to that creature's power to any target and you create three Treasure tokens." }),
  makeCard({ name: 'Wake Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Return all artifact cards from your graveyard to the battlefield. They gain haste until end of turn.' }),
  makeCard({ name: 'Construct Lite', type_line: 'Artifact Creature — Construct', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Judgment Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'For any number of opponents, destroy target nonland permanent that player controls.' }),
  makeCard({ name: 'Inkshield Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Prevent all combat damage that would be dealt to you this turn. For each 1 damage prevented this way, create a 2/1 white and black Inkling creature token with flying.' }),
  makeCard({ name: 'Palm Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "The next time a source of your choice would deal damage to you this turn, prevent that damage. If damage is prevented this way, this spell deals that much damage to that source's controller." }),
  makeCard({ name: 'Vigor Lite', type_line: 'Creature — Elemental Incarnation', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: 'Trample\nIf damage would be dealt to another creature you control, prevent that damage. Put a +1/+1 counter on that creature for each 1 damage prevented this way.' }),
  makeCard({ name: 'Squire Lite', type_line: 'Creature — Human Soldier', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'When this creature enters, prevent all damage that would be dealt to you this turn.\nWhenever damage that would be dealt to you is prevented, put that many +1/+1 counters on this creature.' }),
  makeCard({ name: 'Mastery Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Exile target card that's an instant or sorcery from your graveyard. For each card exiled this way, copy it, and you may cast the copy without paying its mana cost. Exile this spell.\nOverload {1}" }),
  makeCard({ name: 'Ripples Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Proliferate, then choose any number of permanents you control that had a counter put on them this way. Those permanents phase out.' }),
  makeCard({ name: 'Breach Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Each player mills ten cards. For each player, choose a creature or planeswalker card in that player's graveyard. Put those cards onto the battlefield under your control. Then each creature you control becomes a Phyrexian in addition to its other types." }),
  makeCard({ name: 'Faith Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Prevent the next 3 damage that would be dealt to target creature this turn. For each 1 damage prevented this way, put a +1/+1 counter on that creature.' }),
  makeCard({ name: 'Moraug Lite', type_line: 'Legendary Creature — Minotaur Warrior', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: "Each creature you control gets +1/+0 for each time it has attacked this turn.\nLandfall — Whenever a land you control enters, if it's your main phase, there's an additional combat phase after this phase. At the beginning of that combat, untap all creatures you control." }),
  makeCard({ name: 'Vapor Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Return target nonland permanent to its owner's hand. Then that permanent's controller may sacrifice a land of their choice. If the player does, they may copy this spell and may choose a new target for that copy." }),
  makeCard({ name: 'Lightning Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "This spell deals 3 damage to any target. Then that player or that permanent's controller may pay {R}{R}. If the player does, they may copy this spell and may choose a new target for that copy." }),
  makeCard({ name: 'Beseech Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Bargain\nSearch your library for a card, exile it face down, then shuffle. If this spell was bargained, you may cast the exiled card without paying its mana cost if that spell's mana value is 4 or less. Put the exiled card into your hand if it wasn't cast this way." }),
  makeCard({ name: 'Ugin Lite', type_line: 'Legendary Planeswalker — Ugin', mana_cost: '{0}', loyalty: '4', oracle_text: '+1: Exile the top card of your library face down and look at it. Create a 2/2 colorless Spirit creature token. When that token leaves the battlefield, put the exiled card into your hand.' }),
  makeCard({ name: 'Grasp Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Search target opponent's library for a card and exile it face down. Then that player shuffles. You may play that card for as long as it remains exiled." }),
  makeCard({ name: 'Ultimatum Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Return any number of permanent cards with different names from your graveyard to the battlefield.' }),
  makeCard({ name: 'Vastlands Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each player looks at the top five cards of their library and may reveal a land card and/or an instant or sorcery card from among them. Each player puts the cards they revealed this way into their hand and the rest on the bottom of their library in a random order. Each player gains 3 life.' }),
  makeCard({ name: 'Kozilek Lite', type_line: 'Legendary Creature — Eldrazi', mana_cost: '{0}', power: '12', toughness: '12', oracle_text: 'Discard a card with mana value X: Counter target spell with mana value X.' }),
  makeCard({ name: 'Sakashima Lite', type_line: 'Legendary Creature — Human Rogue', mana_cost: '{0}', power: '3', toughness: '1', oracle_text: "You may have Sakashima Lite enter as a copy of another creature you control, except it has Sakashima Lite's other abilities.\nThe \"legend rule\" doesn't apply to permanents you control." }),
  makeCard({ name: 'Thrasher Lite', type_line: 'Creature — Lizard Wizard', mana_cost: '{0}', power: '1', toughness: '4', oracle_text: 'Whenever this creature attacks, you may discard a card. If you do, exile the top two cards of your library, then choose one of them. You may play that card this turn.' }),
  makeCard({ name: 'Hostage Taker 2025', type_line: 'Creature — Human Pirate', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: 'When this creature enters, exile another target creature or artifact until this creature leaves the battlefield. You may cast that card for as long as it remains exiled, and mana of any type can be spent to cast that spell.' }),
  makeCard({ name: 'Dire Fleet Daredevil', type_line: 'Creature — Human Pirate', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: "First strike\nWhen this creature enters, exile target instant or sorcery card from an opponent's graveyard. You may cast it this turn, and mana of any type can be spent to cast that spell. If that spell would be put into a graveyard, exile it instead." }),
  makeCard({ name: 'Eye of the Storms Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Search your library for any number of colorless nonland cards, exile them, then shuffle. Until end of turn, you may cast those cards without paying their mana costs.' }),
  makeCard({ name: "Lae'zel Lite", type_line: 'Legendary Creature — Gith Warrior', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'If you would put one or more counters on a creature or planeswalker you control or on yourself, put that many plus one of each of those kinds of counters on that permanent or player instead.' }),
  makeCard({ name: 'Vorinclex Lite', type_line: 'Legendary Creature — Phyrexian Praetor', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: 'If you would put one or more counters on a permanent or player, put twice that many of each of those kinds of counters on that permanent or player instead.\nIf an opponent would put one or more counters on a permanent or player, they put half that many of each of those kinds of counters on that permanent or player instead, rounded down.' }),
  makeCard({ name: 'Season Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.' }),
  makeCard({ name: 'Walker Three', type_line: 'Legendary Planeswalker — Test', mana_cost: '{0}', loyalty: '3', oracle_text: '+1: You gain 1 life.' }),
  makeCard({ name: 'Energy Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'You get {E}{E}{E}.' }),
  makeCard({ name: 'Bolster Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Put three +1/+1 counters on target creature.' }),
  makeCard({ name: 'Sting Lite', type_line: 'Legendary Artifact — Equipment', mana_cost: '{0}', oracle_text: "Equipped creature has first strike as long as it's blocking or blocked by a Goblin or Orc.\nEquip {2}" }),
  makeCard({ name: 'Chainer Adept Lite', type_line: 'Legendary Creature — Human Minion', mana_cost: '{0}', power: '3', toughness: '2', oracle_text: 'Discard a card: You may cast a creature spell from your graveyard this turn. Activate only once each turn.' }),
  makeCard({ name: 'Land Awakening Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target land you control becomes a creature with haste and "This creature\'s power and toughness are each equal to the number of lands you control." It\'s still a land.' }),
  makeCard({ name: 'Chimeric Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{0}: Until end of turn, this artifact becomes a Construct artifact creature with "This creature\'s power and toughness are each equal to the number of charge counters on it."' }),
  makeCard({ name: 'Ajani Token Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Create a white Avatar creature token. It has "This token\'s power and toughness are each equal to your life total."' }),
  makeCard({ name: 'Hoarding Dragon Lite', type_line: 'Creature — Dragon', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: "When this creature enters, you may search your library for an artifact card, exile it, then shuffle.\nWhen this creature dies, you may put the exiled card into its owner's hand." }),
  makeCard({ name: 'Constrictor Lite', type_line: 'Creature — Snake', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: 'If one or more counters would be put on an artifact or creature you control, that many plus one of each of those kinds of counters are put on that permanent instead.\nIf you would get one or more counters, you get that many plus one of each of those kinds of counters instead.' }),
  makeCard({ name: 'Dismember Lite', type_line: 'Instant', mana_cost: '{1}{B/P}{B/P}', cmc: 3, colors: ['B'], oracle_text: '({B/P} can be paid with either {B} or 2 life.)\nTarget creature gets -5/-5 until end of turn.' }),
  makeCard({ name: 'Probe Lite', type_line: 'Sorcery', mana_cost: '{U/P}', cmc: 1, colors: ['U'], oracle_text: '({U/P} can be paid with either {U} or 2 life.)\nDraw a card.' }),
  makeCard({ name: 'Hybrid Phyrexian Lite', type_line: 'Sorcery', mana_cost: '{G/U/P}', cmc: 1, colors: ['G', 'U'], oracle_text: 'Draw a card.' }),
  makeCard({ name: 'Phyrexian Lens', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{W/P}, {T}: Draw a card.' }),
  makeCard({ name: "K'rrik Lite", type_line: 'Legendary Creature — Phyrexian Horror Minion', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'For each {B} in a cost, you may pay 2 life rather than pay that mana.' }),
  makeCard({ name: 'Black Draw', type_line: 'Sorcery', mana_cost: '{B}{B}', cmc: 2, colors: ['B'], oracle_text: 'Draw a card.' }),
  makeCard({ name: 'Compleated Lite', type_line: 'Legendary Planeswalker — Test', mana_cost: '{G/U/P}{G/U/P}', cmc: 2, colors: ['G', 'U'], loyalty: '5', oracle_text: 'Compleated ({G/U/P} can be paid with {G}, {U}, or 2 life. If life was paid, this planeswalker enters with two fewer loyalty counters.)\n+1: You gain 1 life.' }),
  makeCard({ name: 'Vraska Sting Lite', type_line: 'Legendary Planeswalker — Vraska', mana_cost: '{0}', loyalty: '12', oracle_text: '−2: Target creature becomes a Treasure artifact with "{T}, Sacrifice this artifact: Add one mana of any color" and loses all other card types and abilities.\n−9: If target player has fewer than nine poison counters, they get a number of poison counters equal to the difference.' }),
  makeCard({ name: 'Nissa Animist Lite', type_line: 'Legendary Planeswalker — Nissa', mana_cost: '{0}', loyalty: '7', oracle_text: "+1: Create an X/X green Phyrexian Horror creature token, where X is Nissa's loyalty.\n−7: Until end of turn, creatures you control get +1/+1 for each Forest you control and gain trample." }),
  makeCard({ name: 'Promise Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Each player puts a vow counter on a creature they control and sacrifices the rest. Each of those creatures can't attack you or planeswalkers you control for as long as it has a vow counter on it." }),
  makeCard({ name: 'Necromancy Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'You may cast this spell as though it had flash. If you cast it any time a sorcery couldn\'t have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step.\nWhen this enchantment enters, if it\'s on the battlefield, it becomes an Aura with "enchant creature put onto the battlefield with Necromancy Lite." Put target creature card from a graveyard onto the battlefield under your control and attach this enchantment to it. When this enchantment leaves the battlefield, that creature\'s controller sacrifices it.' }),
  makeCard({ name: 'Disenchant Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target artifact or enchantment.' }),
  makeCard({ name: 'Morophon Lite', type_line: 'Legendary Creature — Shapeshifter', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: 'As Morophon Lite enters, choose a creature type.\nSpells of the chosen type you cast cost {W}{U}{B}{R}{G} less to cast. This effect reduces only the amount of colored mana you pay.' }),
  makeCard({ name: 'Rainbow Bear', type_line: 'Creature — Bear', mana_cost: '{2}{W}{U}{B}{R}{G}', cmc: 7, colors: ['W', 'U', 'B', 'R', 'G'], power: '7', toughness: '7', oracle_text: '' }),
  makeCard({ name: 'Defiler of Vigor Lite', type_line: 'Creature — Phyrexian Dragon', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: 'As an additional cost to cast green permanent spells, you may pay 2 life. Those spells cost {G} less to cast if you paid life this way. This effect reduces only the amount of green mana you pay.' }),
  makeCard({ name: 'Muldrotha Lite', type_line: 'Legendary Creature — Elemental Avatar', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: 'During each of your turns, you may play a land and cast a permanent spell of each permanent type from your graveyard.' }),
  makeCard({ name: 'Broodship Lite', type_line: 'Artifact — Spacecraft', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 8+.)\n8+ | Flying\nOnce during each of your turns, you may cast a permanent spell from your graveyard by sacrificing a land in addition to paying its other costs." }),
  makeCard({ name: 'Hearthhull Lite', type_line: 'Legendary Artifact — Spacecraft', mana_cost: '{0}', power: '6', toughness: '7', oracle_text: "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 8+.)\n2+ | {0}, Sacrifice a land: You gain 1 life.\n8+ | Flying, vigilance, haste\nWhenever you sacrifice a land, each opponent loses 2 life." }),
  makeCard({ name: 'Lethal Scheme Lite', type_line: 'Instant', mana_cost: '{2}{B}{B}', cmc: 4, colors: ['B'], oracle_text: 'Convoke\nDestroy target creature or planeswalker. Each creature that convoked this spell connives.' }),
  makeCard({ name: 'Black Cub', type_line: 'Creature — Bear', mana_cost: '{0}', colors: ['B'], power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Loxodon Lite', type_line: 'Creature — Elephant Cleric', mana_cost: '{4}{W}', cmc: 5, colors: ['W'], power: '4', toughness: '4', oracle_text: 'Convoke\nWhen this creature enters, put a +1/+1 counter on each creature that convoked it.' }),
  makeCard({ name: 'Imperiosaur Lite', type_line: 'Creature — Dinosaur', mana_cost: '{5}{G}{G}', cmc: 7, colors: ['G'], power: '2', toughness: '2', oracle_text: 'Convoke\nThis creature enters with two +1/+1 counters on it for each creature that convoked it.' }),
  makeCard({ name: 'All Will Be One Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever you put one or more counters on a permanent or player, this enchantment deals that much damage to target opponent, creature an opponent controls, or planeswalker an opponent controls.' }),
  makeCard({ name: 'Skrelv Lite', type_line: 'Legendary Artifact Creature — Phyrexian Mite', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{W/P}, {T}: Choose a color. Another target creature you control gains toxic 1 and hexproof from that color until end of turn. It can\'t be blocked by creatures of that color this turn.' }),
  makeCard({ name: 'Plumb Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'As an additional cost to cast this spell, you may sacrifice one or more creatures. When you do, copy this spell for each creature sacrificed this way.\nYou draw a card and you lose 1 life.' }),
  makeCard({ name: 'Torgaar Lite', type_line: 'Legendary Creature — Avatar', mana_cost: '{6}{B}{B}', cmc: 8, colors: ['B'], power: '7', toughness: '6', oracle_text: 'As an additional cost to cast this spell, you may sacrifice any number of creatures. This spell costs {2} less to cast for each creature sacrificed this way.' }),
  makeCard({ name: 'Cage Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "Creature cards in graveyards and libraries can't enter the battlefield.\nPlayers can't cast spells from graveyards or libraries." }),
  makeCard({ name: 'Priest Lite', type_line: 'Creature — Human Cleric', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "Flash\nIf a nontoken creature would enter and it wasn't cast, exile it instead." }),
  makeCard({ name: 'Zombify Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Return target creature card from your graveyard to the battlefield.' }),
  makeCard({ name: 'Dracogenesis Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'You may cast Dragon spells without paying their mana costs.' }),
  makeCard({ name: 'Big Dragon', type_line: 'Creature — Dragon', mana_cost: '{6}{R}{R}', cmc: 8, colors: ['R'], power: '8', toughness: '8', oracle_text: 'Flying' }),
  makeCard({ name: 'Teferi Time Lite', type_line: 'Legendary Planeswalker — Teferi', mana_cost: '{0}', loyalty: '3', oracle_text: "You may activate loyalty abilities of Teferi Time Lite on any player's turn any time you could cast an instant.\n+1: You gain 1 life." }),
  makeCard({ name: 'Winds of Abandon Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Exile target creature you don't control. For each creature exiled this way, its controller searches their library for a basic land card. Those players put those cards onto the battlefield tapped, then shuffle.\nOverload {0}" }),
  makeCard({ name: 'Single Combat Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Each player chooses a creature or planeswalker they control, then sacrifices the rest. Players can't cast creature or planeswalker spells until the end of your next turn." }),
  makeCard({ name: 'Witch-king Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each player sacrifices a creature of their choice. If you sacrificed a creature this way, you may return another permanent card from your graveyard to the battlefield.' }),
  makeCard({ name: 'Puzzle Box Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "At the beginning of each player's draw step, that player puts the cards in their hand on the bottom of their library in any order, then draws that many cards." }),
  makeCard({ name: 'Worship Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'If you control a creature, damage that would reduce your life total to less than 1 reduces it to 1 instead.' }),
  makeCard({ name: "Angel's Grace Lite", type_line: 'Instant', mana_cost: '{0}', oracle_text: "Split second\nYou can't lose the game this turn and your opponents can't win the game this turn. Until end of turn, damage that would reduce your life total to less than 1 reduces it to 1 instead." }),
  makeCard({ name: 'Everybody Lives Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "All creatures gain hexproof and indestructible until end of turn. Players gain hexproof until end of turn. Players can't lose life this turn and players can't lose the game or win the game this turn." }),
  makeCard({ name: 'Portent Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Look at the top three cards of target player's library, then put them back in any order. You may have that player shuffle." }),
  makeCard({ name: 'Syncopate Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Counter target spell unless its controller pays {3}. If that spell is countered this way, exile it instead of putting it into its owner's graveyard." }),
  makeCard({ name: 'Fortress Lite', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {B} or {R}. Activate only if this land entered this turn or if you control a basic land.' }),
  makeCard({ name: 'Altered Ego Lite', type_line: 'Creature — Shapeshifter', mana_cost: '{X}', power: '0', toughness: '0', oracle_text: 'You may have this creature enter as a copy of any creature on the battlefield, except it enters with X additional +1/+1 counters on it.' }),
  makeCard({ name: 'Effigy Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'You may have this artifact enter as a copy of any creature on the battlefield, except it\'s an artifact and it has "{T}: Add {U}."' }),
  makeCard({ name: 'Mirrorlake Lite', type_line: 'Land', mana_cost: '', oracle_text: "{T}: Create a token that's a copy of target creature you control, except it enters with an additional +1/+1 counter on it." }),
  makeCard({ name: 'Intangible Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Exile target creature or enchantment. If it wasn't an Aura, create a token that's a copy of it, except it's a 1/1 white Spirit creature with flying in addition to its other types." }),
  makeCard({ name: 'Impostor Lite', type_line: 'Legendary Creature — Human Rogue', mana_cost: '{0}', power: '0', toughness: '0', oracle_text: 'You may have Impostor Lite enter as a copy of any creature on the battlefield, except its name is Impostor Lite, it\'s legendary in addition to its other types, and it has "{0}: Return Impostor Lite to its owner\'s hand at the beginning of the next end step."' }),
  makeCard({ name: 'Mech Lite', type_line: 'Artifact — Vehicle', mana_cost: '{0}', power: '3', toughness: '4', oracle_text: "You may have this Vehicle enter as a copy of a creature an opponent controls, except it's a Vehicle artifact with crew 3 and it loses all other card types." }),
  makeCard({ name: 'Castaway Lite', type_line: 'Legendary Planeswalker — Jace', mana_cost: '{0}', loyalty: '3', oracle_text: "+1: Create two tokens that are copies of Castaway Lite, except they're not legendary." }),
  makeCard({ name: 'Mirror Mage Lite', type_line: 'Legendary Planeswalker — Jace', mana_cost: '{0}', loyalty: '4', oracle_text: "+1: Create a token that's a copy of Mirror Mage Lite, except it's not legendary and its starting loyalty is 1." }),
  makeCard({ name: 'Siege Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'As this enchantment enters, choose Khans or Dragons.\n• Khans — At the beginning of each of your main phases, add {G}{G}.\n• Dragons — Spells your opponents cast that target you or a permanent you control cost {2} more to cast.' }),
  makeCard({ name: 'Besieged Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'As this enchantment enters, choose Mirran or Phyrexian.\n• Mirran — Creatures you control get +1/+1.\n• Phyrexian — Creatures you control have flying.' }),
  makeCard({ name: 'Carpet Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "At the beginning of each of your main phases, if you haven't added mana with this ability this turn, you may add X mana of any one color, where X is the number of Islands target opponent controls." }),
  makeCard({ name: 'March Mist Lite', type_line: 'Instant', mana_cost: '{X}{U}{U}', cmc: 2, colors: ['U'], oracle_text: 'As an additional cost to cast this spell, you may exile any number of blue cards from your hand. This spell costs {2} less to cast for each card exiled this way.\nUp to X target creatures phase out.' }),
  makeCard({ name: 'Electromancer Lite', type_line: 'Creature — Goblin Wizard', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Instant and sorcery spells you cast cost {1} less to cast.' }),
  makeCard({ name: 'Fireball Lite', type_line: 'Sorcery', mana_cost: '{X}{R}', cmc: 1, colors: ['R'], oracle_text: 'Fireball Lite deals X damage to any target.' }),
  makeCard({ name: 'Passage Lite', type_line: 'Land', mana_cost: '', oracle_text: "As this land enters, choose a basic land type. Then you may pay 2 life. If you don't, it enters tapped.\nThis land is the chosen type." }),
  makeCard({ name: 'Talion Lite', type_line: 'Legendary Creature — Faerie Noble', mana_cost: '{0}', power: '3', toughness: '4', oracle_text: 'As Talion Lite enters, choose a number between 1 and 10.\nWhenever an opponent casts a spell with mana value, power, or toughness equal to the chosen number, that player loses 2 life and you draw a card.' }),
  makeCard({ name: 'Tithes Lite', type_line: 'Creature — Angel', mana_cost: '{0}', power: '3', toughness: '5', oracle_text: "As long as this creature is attacking, creatures can't block unless their controller pays {1} for each of those creatures." }),
  makeCard({ name: 'Overlord Lite', type_line: 'Enchantment Creature — Avatar Horror', mana_cost: '{4}{G}{G}', cmc: 6, colors: ['G'], power: '6', toughness: '5', oracle_text: 'Impending 2—{G}\nWhenever this permanent enters or attacks, create a tapped colorless land token named Everywhere that is every basic land type.' }),
  makeCard({ name: 'Forge Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'At the beginning of combat on your turn, put an oil counter on this artifact, then create an X/1 red Phyrexian Horror creature token with trample and haste, where X is the number of oil counters on this artifact. Sacrifice that token at the beginning of the next end step.' }),
  makeCard({ name: 'Dusk Knight Lite', type_line: 'Creature — Human Knight', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '{0}: Destroy target creature blocking this creature.' }),
  makeCard({ name: 'Maelstrom Nexus Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'The first spell you cast each turn has cascade.' }),
  makeCard({ name: 'Twinning Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'If you would copy a spell one or more times, instead copy it that many times plus an additional time. You may choose new targets for the additional copy.' }),
  makeCard({ name: 'Twin Spell Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Copy target instant or sorcery spell you control.' }),
  makeCard({ name: 'Visitation Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'If one or more creature tokens would be created under your control, that many 4/4 white Angel creature tokens with flying and vigilance are created instead.' }),
  makeCard({ name: 'Spores Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Create two 1/1 green Saproling creature tokens and a Treasure token.' }),
  makeCard({ name: 'Tempest Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Tempest Lite deals damage to each creature your opponents control equal to the total mana value of other spells you've cast this turn." }),
  makeCard({ name: 'Mother Lode Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Discover 10. If the discovered card's mana value is less than 10, create a number of tapped Treasure tokens equal to the difference." }),
  makeCard({ name: 'Predation Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'For each creature your opponents control, create a 4/4 green Phyrexian Beast creature token. Each of those tokens fights a different one of those creatures.' }),
  makeCard({ name: 'Bidding Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each player chooses a creature type. Each player returns all creature cards of a type chosen this way from their graveyard to the battlefield.' }),
  makeCard({ name: 'Scroll Rack Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}: Exile any number of cards from your hand face down. Put that many cards from the top of your library into your hand. Then look at the exiled cards and put them on top of your library in any order.' }),
  makeCard({ name: 'Forge Anew Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'During your turn, you may activate equip abilities any time you could cast an instant.\nYou may pay {0} rather than pay the equip cost of the first equip ability you activate during each of your turns.' }),
  makeCard({ name: 'Bruenor Lite', type_line: 'Legendary Creature — Dwarf Warrior', mana_cost: '{0}', power: '5', toughness: '4', oracle_text: 'Each creature you control gets +2/+0 for each Equipment attached to it.\nYou may pay {0} rather than pay the equip cost of the first equip ability you activate each turn.' }),
  makeCard({ name: 'Comet Lite', type_line: 'Instant', mana_cost: '{X}{R}{R}', cmc: 2, colors: ['R'], oracle_text: 'Multikicker {1}\nChoose any target, then choose another target for each time this spell was kicked. Comet Lite deals X damage to each of them.' }),
  makeCard({ name: 'Smashing Lite', type_line: 'Sorcery', mana_cost: '{X}{R}{R}', cmc: 2, colors: ['R'], oracle_text: 'Smashing Lite deals X damage divided as you choose among up to two target creatures and/or planeswalkers. If X is 6 or more, Smashing Lite deals twice X damage divided as you choose among them instead.' }),
  makeCard({ name: 'Defiler Lite', type_line: 'Legendary Creature — Eldrazi', mana_cost: '{0}', power: '7', toughness: '7', oracle_text: 'When you cast this spell, target opponent exiles the top half of their library, rounded up.\nDefiler Lite enters with a number of +1/+1 counters on it equal to the greatest mana value among cards in exile.\nDefiler Lite has annihilator X, where X is the number of +1/+1 counters on it.' }),
  makeCard({
    name: 'Soldier Lite // Angel Lite',
    layout: 'transform',
    type_line: 'Creature — Human Soldier // Creature — Angel',
    oracle_text: '',
    mana_cost: '{0}',
    card_faces: [
      { object: 'card_face', name: 'Soldier Lite', type_line: 'Creature — Human Soldier', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '{0}: Transform this creature.' },
      { object: 'card_face', name: 'Angel Lite', type_line: 'Creature — Angel', mana_cost: '', power: '4', toughness: '4', oracle_text: 'Super Nova — As this creature transforms into Angel Lite, you get an emblem with "Whenever a creature dies, you gain 1 life."\nWhenever Angel Lite attacks, you may sacrifice any number of other creatures. If you do, draw that many cards.' },
    ],
  } as never),
  makeCard({ name: 'Timely Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'You may cast this spell as though it had flash if it targets a commander.\nEnchant creature\nEnchanted creature has indestructible.' }),
  makeCard({ name: 'Spinners Lite', type_line: 'Creature — Faerie Wizard', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'You may cast this spell as though it had flash if you control a Faerie.' }),
  makeCard({ name: 'Faerie Friend', type_line: 'Creature — Faerie', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Yuriko Commander Lite', type_line: 'Legendary Creature — Human Ninja', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Tyr Lite', type_line: 'Creature — Angel Knight', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever this creature deals combat damage to a player, draw a card if that player has more cards in hand than each other player. Then you gain 3 life if that player has more life than each other player.' }),
  makeCard({ name: 'Needlehead Lite', type_line: 'Creature — Human Assassin', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever an opponent draws a card, this creature deals 1 damage to them.' }),
  makeCard({ name: 'Guardian Angel Lite', type_line: 'Creature — Angel', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever one or more creatures you control attack, they gain indestructible until end of turn.' }),
  makeCard({ name: 'Gond Gate Lite', type_line: 'Land — Gate', mana_cost: '', oracle_text: 'Gates you control enter untapped.\n{T}: Add {C}.\n{T}: Add one mana of any color that a Gate you control could produce.' }),
  makeCard({ name: 'Guildgate Lite', type_line: 'Land — Gate', mana_cost: '', oracle_text: 'This land enters tapped.\n{T}: Add {W} or {U}.' }),
  makeCard({ name: 'Aettir Lite', type_line: 'Legendary Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equipped creature has base power and toughness X/X, where X is your life total.\nEquip {0}' }),
  makeCard({ name: 'Oath Teferi Lite', type_line: 'Legendary Enchantment', mana_cost: '{0}', oracle_text: 'You may activate the loyalty abilities of planeswalkers you control twice each turn rather than only once.' }),
  makeCard({ name: 'Immortal Sun Lite', type_line: 'Legendary Artifact', mana_cost: '{0}', oracle_text: "Players can't activate planeswalkers' loyalty abilities." }),
  makeCard({ name: 'Dream Render Lite', type_line: 'Legendary Planeswalker — Ashiok', mana_cost: '{0}', loyalty: '5', oracle_text: "Spells and abilities your opponents control can't cause their controller to search their library." }),
  makeCard({ name: 'Heart Warden Lite', type_line: 'Creature — Human Druid', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{T}: Add {G}.\n{2}, Sacrifice this creature: Draw a card.' }),
  makeCard({
    name: 'Liliana Lite // Necromancer Lite',
    layout: 'transform',
    type_line: 'Legendary Creature — Human Cleric // Legendary Planeswalker — Liliana',
    oracle_text: '',
    mana_cost: '{0}',
    card_faces: [
      { object: 'card_face', name: 'Liliana Lite', type_line: 'Legendary Creature — Human Cleric', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: "Whenever another nontoken creature you control dies, exile Liliana Lite, then return her to the battlefield transformed under her owner's control. If you do, create a 2/2 black Zombie creature token." },
      { object: 'card_face', name: 'Necromancer Lite', type_line: 'Legendary Planeswalker — Liliana', mana_cost: '', loyalty: '3', oracle_text: '+2: Each player discards a card.' },
    ],
  } as never),
  makeCard({
    name: 'Chandra Lite // Roaring Lite',
    layout: 'transform',
    type_line: 'Legendary Creature — Human Shaman // Legendary Planeswalker — Chandra',
    oracle_text: '',
    mana_cost: '{0}',
    card_faces: [
      { object: 'card_face', name: 'Chandra Lite', type_line: 'Legendary Creature — Human Shaman', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "{T}: Chandra Lite deals 1 damage to target player or planeswalker. If Chandra Lite has dealt 3 or more damage this turn, exile her, then return her to the battlefield transformed under her owner's control." },
      { object: 'card_face', name: 'Roaring Lite', type_line: 'Legendary Planeswalker — Chandra', mana_cost: '', loyalty: '4', oracle_text: '+1: You gain 1 life.' },
    ],
  } as never),
  makeCard({
    name: 'Kytheon Lite // Battle-Forged Lite',
    layout: 'transform',
    type_line: 'Legendary Creature — Human Soldier // Legendary Planeswalker — Gideon',
    oracle_text: '',
    mana_cost: '{0}',
    card_faces: [
      { object: 'card_face', name: 'Kytheon Lite', type_line: 'Legendary Creature — Human Soldier', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: "At end of combat, if Kytheon Lite and at least two other creatures attacked this combat, exile Kytheon Lite, then return him to the battlefield transformed under his owner's control." },
      { object: 'card_face', name: 'Battle-Forged Lite', type_line: 'Legendary Planeswalker — Gideon', mana_cost: '', loyalty: '3', oracle_text: '+1: You gain 1 life.' },
    ],
  } as never),
  makeCard({
    name: 'Garruk Lite // Veil-Cursed Lite',
    layout: 'transform',
    type_line: 'Legendary Planeswalker — Garruk // Legendary Planeswalker — Garruk',
    oracle_text: '',
    mana_cost: '{0}',
    card_faces: [
      { object: 'card_face', name: 'Garruk Lite', type_line: 'Legendary Planeswalker — Garruk', mana_cost: '{0}', loyalty: '3', oracle_text: 'When Garruk Lite has two or fewer loyalty counters on him, transform him.\n0: Garruk Lite deals 3 damage to target creature. That creature deals damage equal to its power to him.' },
      { object: 'card_face', name: 'Veil-Cursed Lite', type_line: 'Legendary Planeswalker — Garruk', mana_cost: '', oracle_text: '+1: You gain 1 life.' },
    ],
  } as never),
  makeCard({ name: 'Mass Grave Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Destroy all creatures.' }),
  makeCard({ name: 'Avenging Arrow Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target creature that dealt damage this turn.' }),
  makeCard({ name: 'Resistance Wall Lite', type_line: 'Creature — Wall', mana_cost: '{0}', power: '0', toughness: '8', oracle_text: 'At the beginning of each end step, if this creature was dealt damage this turn, put a +0/+1 counter on it.' }),
  makeCard({ name: 'Inflame Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Inflame Lite deals 2 damage to each creature dealt damage this turn.' }),
  makeCard({ name: 'Pinger Lite', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{T}: This creature deals 1 damage to any target.' }),
  makeCard({ name: 'Snacker Lite', type_line: 'Creature — Faerie Rogue', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: 'Flying\nWhen you draw your third card in a turn, return this card from your graveyard to the battlefield tapped.' }),
  makeCard({ name: "T'Challa Lite", type_line: 'Legendary Creature — Human Noble', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever a player draws their second card each turn, you draw a card.' }),
  makeCard({ name: 'Triple Draw Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw three cards.' }),
  makeCard({ name: 'Council Lite', type_line: 'Legendary Creature — Human Noble', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever a player draws their second card during their turn, you draw a card.\nWhenever a player casts their second spell during their turn, you create a 2/2 white Knight creature token.' }),
  makeCard({ name: 'Leveler Lite', type_line: 'Artifact Creature — Construct', mana_cost: '{0}', power: '8', toughness: '8', oracle_text: 'When you cast this spell and whenever this creature attacks, destroy up to one target nonland permanent. Its controller creates a tapped Powerstone token.' }),
  makeCard({ name: 'Interrupter Lite', type_line: 'Creature — Bird Rogue', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: 'Flash\nWhen this creature enters, exile target spell. It becomes plotted.\nSpells your opponents cast from graveyards or from exile cost {2} more to cast.' }),
  makeCard({ name: 'Kellan Lite', type_line: 'Legendary Enchantment', mana_cost: '{0}', oracle_text: 'When Kellan Lite enters, you may exile a nonland card with mana value 3 or less from your hand. If you do, it becomes plotted.' }),
  makeCard({ name: 'Anvil Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Imprint — When this artifact enters, you may exile a nonland card from your hand.\nSpells you cast that share a card type with the exiled card cost {2} less to cast.' }),
  makeCard({ name: 'Technomancer Lite', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: "{0}, Sacrifice X artifacts: Return target creature card with power X or less from your graveyard to the battlefield. X can't be 0." }),
  makeCard({ name: 'Morgul Lite', type_line: 'Legendary Land', mana_cost: '', oracle_text: "{0}: Put a shadow counter on target creature. For as long as that creature has a shadow counter on it, it's a Wraith in addition to its other types." }),
  makeCard({ name: 'Dragon Temple Lite', type_line: 'Land', mana_cost: '', oracle_text: 'As this land enters, you may reveal a Dragon card from your hand. This land enters tapped unless you revealed a Dragon card this way or you control a Dragon.\n{T}: Add {R}.' }),
  makeCard({ name: 'Whelp Lite', type_line: 'Creature — Dragon', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Regal Lite', type_line: 'Creature — Dinosaur', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: "Whenever you tap a land for mana while you're the monarch, add an additional one mana of any color." }),
  makeCard({ name: 'Alandra Lite', type_line: 'Legendary Creature — Merfolk Wizard', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: 'Whenever you draw your second card each turn, Alandra Lite and Drakes you control each get +X/+X until end of turn, where X is the number of cards in your hand.' }),
  makeCard({ name: 'Drake Lite', type_line: 'Creature — Drake', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Aurlock Lite', type_line: 'Legendary Creature — Human Wizard', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Plotting cards from your hand costs {2} less.' }),
  makeCard({ name: 'Plotter Lite', type_line: 'Sorcery', mana_cost: '{3}', cmc: 3, oracle_text: 'You gain 3 life.\nPlot {3}' }),
  makeCard({ name: 'Reawakened Lite', type_line: 'Legendary Planeswalker — Jace', mana_cost: '{0}', loyalty: '5', oracle_text: "You can't cast Reawakened Lite during your first, second, or third turns of the game.\n+1: Draw a card, then discard a card." }),
  makeCard({ name: 'Fuse Bomb Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'At the beginning of your upkeep, you may flip a coin. If you win the flip, put a fuse counter on this enchantment. If you lose the flip, remove a fuse counter from this enchantment.' }),
  makeCard({ name: 'Danny Lite', type_line: 'Creature — Human', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Creatures you control have "Whenever one or more counters are put on this creature for the first time each turn, draw a card."' }),
  makeCard({ name: 'Counter Pump Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Put a +1/+1 counter on target creature.' }),
  makeCard({ name: 'Twinferno Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Choose one —\n• When you cast your next instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.\n• Target creature you control gains double strike until end of turn.' }),
  makeCard({ name: 'Choosy Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'As an additional cost to cast this spell, sacrifice a creature or pay {3}.\nYou gain 1 life.' }),
  makeCard({ name: 'Jolrael Lite', type_line: 'Legendary Creature — Human Druid', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{0}: Until end of turn, creatures you control have base power and toughness each equal to the number of cards in your hand.' }),
  makeCard({ name: 'Crawling Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever one or more land cards are put into your graveyard from anywhere for the first time each turn, create a 1/1 green Insect creature token.' }),
  makeCard({ name: 'Land Toss Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Discard a card.' }),
  makeCard({ name: 'Toph Lite', type_line: 'Legendary Creature — Human Warrior', mana_cost: '{0}', power: '*', toughness: '3', oracle_text: "Toph Lite's power is equal to the number of +1/+1 counters on lands you control." }),
  makeCard({ name: 'Tyvar Lite', type_line: 'Legendary Creature — Elf Warrior', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Tap another untapped creature you control: Tyvar Lite gains indestructible until end of turn. Tap it.' }),
  makeCard({ name: 'Any Counter Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever a counter is put on a creature you control, draw a card.' }),
  makeCard({ name: 'Snatcher Lite', type_line: 'Creature — Rat Ninja', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "Whenever this creature deals combat damage to a player, exile up to two target cards from that player's graveyard." }),
  makeCard({ name: 'Betor Lite', type_line: 'Legendary Creature — Spirit Dragon', mana_cost: '{0}', power: '5', toughness: '7', oracle_text: 'At the beginning of your end step, if creatures you control have total toughness 10 or greater, draw a card. Then if creatures you control have total toughness 20 or greater, untap each creature you control. Then if creatures you control have total toughness 40 or greater, each opponent loses half their life, rounded up.' }),
  makeCard({ name: 'Thick Wall Lite', type_line: 'Creature — Wall', mana_cost: '{0}', power: '0', toughness: '33', oracle_text: '' }),
  makeCard({ name: 'Bonded Lite', type_line: 'Artifact Creature — Construct', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: "This creature attacks each combat if able.\nThis creature can't attack alone." }),
  makeCard({ name: 'Thryx Lite', type_line: 'Legendary Creature — Elemental Giraffe', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: "Spells you cast with mana value 5 or greater cost {1} less to cast and can't be countered." }),
  makeCard({ name: 'Big Spell Lite', type_line: 'Sorcery', mana_cost: '{5}', cmc: 5, oracle_text: 'You gain 5 life.' }),
  makeCard({ name: 'Negate Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Counter target spell.' }),
  makeCard({ name: 'Golem Lite', type_line: 'Artifact Creature — Golem', mana_cost: '{0}', power: '4', toughness: '5', oracle_text: 'Artifact creature spells you cast have affinity for artifacts.' }),
  makeCard({ name: 'Affinity Construct Lite', type_line: 'Artifact Creature — Construct', mana_cost: '{3}', cmc: 3, power: '3', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Lulu Lite', type_line: 'Legendary Creature — Moogle', mana_cost: '{0}', power: '0', toughness: '3', oracle_text: 'Whenever an opponent attacks you, choose target creature attacking you. Put a stun counter on that creature.' }),
  makeCard({ name: 'Saruman Storm Lite', type_line: 'Legendary Enchantment', mana_cost: '{0}', oracle_text: "Whenever you cast your second spell each turn, copy it, except the copy isn't legendary. You may choose new targets for the copy." }),
  makeCard({ name: 'Legend Lite', type_line: 'Legendary Creature — Human', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Wildsear Lite', type_line: 'Legendary Creature — Dragon', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: 'Enchantment spells you cast from your hand have cascade.' }),
  makeCard({ name: 'Stone Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "{T}: Add {C}. This mana can't be spent to cast a nonartifact spell." }),
  makeCard({ name: 'Morph Lite', type_line: 'Creature — Human Wizard', mana_cost: '{5}{U}', cmc: 6, power: '1', toughness: '1', oracle_text: 'Morph {3}' }),
  makeCard({ name: 'Vohar Lite', type_line: 'Legendary Creature — Merfolk Wizard', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: '{T}: Draw a card, then discard a card. If you discarded an instant or sorcery card this way, each opponent loses 1 life and you gain 1 life.' }),
  makeCard({ name: 'Goblin Visions Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'At the beginning of your first main phase, discard a card. If you do, draw a card.' }),
  makeCard({ name: 'Dion Lite', type_line: 'Legendary Creature — Human Knight', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'During your turn, Dion Lite and other Knights you control have flying.' }),
  makeCard({ name: 'Knight Squire Lite', type_line: 'Creature — Human Knight', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Sinew Sword Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy up to one target planeswalker and up to one target artifact.' }),
  makeCard({ name: 'Mauhur Lite', type_line: 'Legendary Creature — Orc Soldier', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'If one or more +1/+1 counters would be put on an Army, Goblin, or Orc you control, that many plus one +1/+1 counters are put on it instead.' }),
  makeCard({ name: 'Goblin Lite', type_line: 'Creature — Goblin', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Zhalfir Lite', type_line: 'Legendary Creature — Human Wizard', mana_cost: '{0}', power: '3', toughness: '4', oracle_text: "Creature cards you own that aren't on the battlefield have flash." }),
  makeCard({ name: 'Within Range', type_line: 'Enchantment', mana_cost: '{2}{B}', cmc: 3, oracle_text: 'Whenever you attack, each opponent loses life equal to the number of creatures attacking them.' }),
  makeCard({ name: 'Mindskinner Lite', type_line: 'Legendary Enchantment Creature — Nightmare', mana_cost: '{0}', power: '10', toughness: '1', oracle_text: 'If a source you control would deal damage to an opponent, prevent that damage and each opponent mills that many cards.' }),
  makeCard({ name: 'Anti-Venom Lite', type_line: 'Legendary Creature — Symbiote Hero', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'When Anti-Venom Lite enters, if he was cast, return target creature card from your graveyard to the battlefield.\nIf damage would be dealt to Anti-Venom Lite, prevent that damage and put that many +1/+1 counters on him.' }),
  makeCard({ name: 'Undergrowth Champion Lite', type_line: 'Creature — Elemental', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'If damage would be dealt to this creature while it has a +1/+1 counter on it, prevent that damage and remove a +1/+1 counter from this creature.' }),
  makeCard({ name: 'Panther Habit Lite', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'If equipped creature would be dealt damage, prevent that damage and put that many +1/+1 counters on it.\nEquip {2}' }),
  makeCard({ name: 'Angel of Suffering Lite', type_line: 'Creature — Nightmare Angel', mana_cost: '{0}', power: '5', toughness: '3', oracle_text: 'Flying\nIf damage would be dealt to you, prevent that damage and mill twice that many cards.' }),
  makeCard({ name: 'Dragonfire Blade Lite', type_line: 'Artifact — Equipment', mana_cost: '{1}', oracle_text: 'Equipped creature gets +2/+2 and has hexproof.\nEquip {4}. This ability costs {1} less to activate for each color of the creature it targets.' }),
  makeCard({ name: 'Tricolor Knight Lite', type_line: 'Creature — Human Knight', mana_cost: '{W}{U}{B}', cmc: 3, colors: ['W', 'U', 'B'], power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Plate Armor Lite', type_line: 'Artifact — Equipment', mana_cost: '{2}', oracle_text: 'Equipped creature gets +3/+3.\nEquip {3}. This ability costs {1} less to activate for each other Equipment you control.' }),
  makeCard({ name: 'Bow of Nylea Lite', type_line: 'Legendary Enchantment Artifact', mana_cost: '{0}', oracle_text: '{1}{G}, {T}: Choose one —\n• You gain 3 life.\n• Put up to four target cards from your graveyard on the bottom of your library in any order.' }),
  makeCard({ name: 'PuPu Lite', type_line: 'Artifact Creature — Construct Alien', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: "{3}: Until end of turn, this creature's base power becomes equal to the number of Towns you control." }),
  makeCard({ name: 'Town Lite', type_line: 'Land — Town', mana_cost: '', oracle_text: '' }),
  makeCard({ name: 'Evra Lite', type_line: 'Legendary Creature — Avatar', mana_cost: '{0}', power: '1', toughness: '4', oracle_text: "Lifelink\n{4}: Exchange your life total with Evra Lite's power." }),
  makeCard({ name: 'Deepwood Lite', type_line: 'Creature — Elf Warrior', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{5}{G}, {T}: Draw a card. This ability costs {1} less to activate for each +1/+1 counter on creatures you control.' }),
  makeCard({ name: 'Incinerator Lite', type_line: 'Creature — Elemental', mana_cost: '{5}{R}', cmc: 6, colors: ['R'], power: '6', toughness: '6', oracle_text: 'This spell costs {X} less to cast, where X is the total amount of noncombat damage dealt to your opponents this turn.\nTrample' }),
  makeCard({ name: 'Aclazotz Lite', type_line: 'Legendary Creature — Bat God', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: "Whenever Aclazotz Lite attacks, each opponent discards a card. For each opponent who can't, you draw a card." }),
  makeCard({ name: 'Lord of Pain Lite', type_line: 'Legendary Creature — Human Assassin', mana_cost: '{0}', power: '4', toughness: '3', oracle_text: "Whenever a player casts their first spell each turn, choose another target player. Lord of Pain Lite deals damage equal to that spell's mana value to the chosen player." }),
  makeCard({ name: 'Tinder Wall Lite', type_line: 'Creature — Plant Wall', mana_cost: '{0}', colors: ['R'], power: '0', toughness: '3', oracle_text: "Defender\nSacrifice this creature: Add {R}{R}.\n{R}, Sacrifice this creature: It deals 2 damage to target creature it's blocking." }),
  makeCard({ name: 'Cellarspawn Lite', type_line: 'Enchantment Creature — Horror', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Whenever you cast a spell, if the amount of mana spent to cast it was less than its mana value, target opponent loses life equal to the difference.' }),
  makeCard({ name: 'Mirror of Life Trapping Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "Whenever a creature enters, if it was cast, exile it, then return all other permanent cards exiled with this artifact to the battlefield under their owners' control." }),
  makeCard({ name: 'Virtue of Strength Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'If you tap a basic land for mana, it produces three times as much of that mana instead.' }),
  makeCard({ name: 'Nonbasic Grove Lite', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {G}.' }),
  makeCard({ name: 'Zurgo Lite', type_line: 'Legendary Creature — Orc Warrior', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Whenever a creature token you control leaves the battlefield, draw a card if it was attacking. Otherwise, each opponent loses 1 life.' }),
  makeCard({ name: 'Wilhelt Lite', type_line: 'Legendary Creature — Zombie Warrior', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: "Whenever another Zombie you control dies, if it didn't have decayed, create a 2/2 black Zombie creature token with decayed." }),
  makeCard({ name: 'Heaped Harvest Lite', type_line: 'Artifact — Food', mana_cost: '{0}', oracle_text: 'When this artifact enters and when you sacrifice it, you may search your library for a basic land card, put it onto the battlefield tapped, then shuffle.\n{2}, {T}, Sacrifice this artifact: You gain 3 life.' }),
  makeCard({ name: 'Pilot Lite', type_line: 'Creature — Pilot', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'This creature saddles Mounts and crews Vehicles as though its power were 2 greater.' }),
  makeCard({ name: 'Crew Three Lite', type_line: 'Artifact — Vehicle', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: 'Crew 3' }),
  makeCard({ name: 'Flamer Lite', type_line: 'Creature — Demon', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'At the beginning of your upkeep, return an instant or sorcery card at random from your graveyard to your hand.' }),
  makeCard({ name: 'Blowfly Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever a creature dies, if it had a -1/-1 counter on it, put a -1/-1 counter on target creature.' }),
  makeCard({ name: 'Kelpie Lite', type_line: 'Creature — Beast', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Whenever this creature or another permanent enters from a graveyard, draw a card.' }),
  makeCard({ name: 'Unearth Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Return target creature card from your graveyard to the battlefield.' }),
  makeCard({ name: 'Tablet Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'When this artifact enters, mill a card. You may play that card this turn.' }),
  makeCard({ name: 'Bandit Lord Lite', type_line: 'Creature — Goblin Rogue', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '{R}, {T}: This creature deals damage equal to the number of Goblins that entered the battlefield under your control this turn to any target.' }),
  makeCard({ name: 'Goblin Maker Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Create a 1/1 red Goblin creature token.' }),
  makeCard({ name: 'Ojer Pakpatiq Lite', type_line: 'Legendary Creature — God', mana_cost: '{0}', power: '4', toughness: '3', oracle_text: 'Flying\nWhenever you cast an instant spell from your hand, it gains rebound.' }),
  makeCard({ name: 'Satchel Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "{T}: You gain 1 life. Activate only if you've sacrificed an artifact this turn." }),
  makeCard({ name: 'Junk Food Lite', type_line: 'Artifact — Food', mana_cost: '{0}', oracle_text: 'Sacrifice this artifact: You gain 2 life.' }),
  makeCard({ name: 'Kefka Lite', type_line: 'Legendary Creature — Human Wizard', mana_cost: '{0}', power: '4', toughness: '5', oracle_text: 'Whenever Kefka Lite enters or attacks, each player discards a card. Then you draw a card for each card type among cards discarded this way.' }),
  makeCard({ name: 'Jenova Lite', type_line: 'Legendary Creature — Alien', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever a Zombie you control dies during your turn, you draw cards equal to its power.' }),
  makeCard({ name: 'Eidolon Lite', type_line: 'Enchantment Creature — Spirit', mana_cost: '{0}', power: '0', toughness: '0', oracle_text: 'Bestow {2}{W}{W}\nThis creature and enchanted creature each get +1/+1 for each creature you control and +1/+1 for each Aura you control.' }),
  makeCard({ name: 'Aura Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature' }),
  makeCard({ name: 'Murmuration Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "At the beginning of your end step, for each spell you've cast this turn, create a 1/2 blue Bird creature token with flying named Storm Crow." }),
  makeCard({ name: 'Red Bolt Lite', type_line: 'Instant', mana_cost: '{0}', colors: ['R'], oracle_text: 'Red Bolt Lite deals 3 damage to any target.' }),
  makeCard({ name: 'Mechanized Warfare Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'If a red or artifact source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus 1 instead.' }),
  makeCard({ name: 'White Plume Lite', type_line: 'Creature — Orc Cleric', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: "At the beginning of each opponent's upkeep, untap a creature you control." }),
  makeCard({ name: 'Autogenerator Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}: Put a charge counter on this artifact. Add X mana of any one color, where X is the number of charge counters on this artifact.' }),
  makeCard({ name: 'Glowing One Lite', type_line: 'Creature — Zombie Mutant', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever a player mills a nonland card, you gain 1 life.' }),
  makeCard({ name: 'Collar Lite', type_line: 'Artifact — Equipment', mana_cost: '{1}', oracle_text: 'Equipped creature gets +1/+0 and has vigilance.\nWhenever equipped creature dies, if it was a Human, create a 1/1 white Spirit creature token with flying.\nEquip {2}' }),
  makeCard({ name: 'Villager Lite', type_line: 'Creature — Human Peasant', mana_cost: '{1}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Essence Sliver Lite', type_line: 'Creature — Sliver', mana_cost: '{3}{W}', power: '3', toughness: '3', oracle_text: 'Whenever a Sliver deals damage, its controller gains that much life.' }),
  makeCard({ name: 'Plain Sliver Lite', type_line: 'Creature — Sliver', mana_cost: '{1}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Killer Service Lite', type_line: 'Enchantment', mana_cost: '{2}', oracle_text: 'At the beginning of your end step, you may pay {2} and sacrifice a token. If you do, create a 4/4 green Rhino Warrior creature token.' }),
  makeCard({ name: 'Heidegger Lite', type_line: 'Creature — Human Soldier', mana_cost: '{1}', power: '1', toughness: '1', oracle_text: 'At the beginning of your end step, create a number of 1/1 white Soldier creature tokens equal to the number of opponents who control more creatures than you.' }),
  makeCard({ name: 'Dawn Lite', type_line: 'Enchantment', mana_cost: '{1}', oracle_text: 'At the beginning of your end step, remove a hope counter from this enchantment. If you do, draw a card. Then if this enchantment has no hope counters on it, sacrifice it and you gain 4 life.' }),
  makeCard({ name: 'Soothsayer Lite', type_line: 'Creature — Bat Cleric', mana_cost: '{1}', power: '1', toughness: '1', oracle_text: 'At the beginning of your end step, if you gained or lost life this turn, surveil 1.' }),
  makeCard({ name: 'Seraph Lite', type_line: 'Creature — Angel', mana_cost: '{1}', power: '3', toughness: '3', oracle_text: 'At the beginning of combat on your turn, target creature you control gains your choice of flying, vigilance, or lifelink until end of turn.' }),
  makeCard({ name: 'Wojek Lite', type_line: 'Creature — Angel Detective', mana_cost: '{1}', power: '1', toughness: '1', oracle_text: 'At the beginning of your upkeep, investigate once for each opponent who has more cards in hand than you.' }),
  makeCard({ name: 'Beastmaster Lite', type_line: 'Creature — Dog Shaman', mana_cost: '{1}', power: '1', toughness: '5', oracle_text: 'At the beginning of your upkeep, draw a card if you control the creature with the greatest toughness or tied for the greatest toughness.' }),
  makeCard({ name: 'Swarmlord Lite', type_line: 'Creature — Phyrexian Insect Horror', mana_cost: '{1}', power: '1', toughness: '1', oracle_text: 'At the beginning of your upkeep, create a 1/1 green Phyrexian Insect creature token with infect for each poison counter your opponents have.' }),
  makeCard({ name: 'Blazing Bomb Lite', type_line: 'Creature — Elemental', mana_cost: '{1}', power: '1', toughness: '1', oracle_text: 'Whenever you cast a noncreature spell, if at least four mana was spent to cast it, put a +1/+1 counter on this creature.' }),
  makeCard({ name: 'Big Salve', type_line: 'Sorcery', mana_cost: '{4}', oracle_text: 'You gain 1 life.' }),
  makeCard({ name: 'Raff Lite', type_line: 'Legendary Creature — Human Wizard', mana_cost: '{1}', power: '1', toughness: '1', oracle_text: 'Whenever you cast an instant or sorcery spell, you may tap two untapped creatures you control. If you do, draw a card.' }),
  makeCard({ name: 'Pillager Lite', type_line: 'Creature — Dragon', mana_cost: '{1}', power: '3', toughness: '3', oracle_text: 'Whenever this creature deals combat damage to a player, exile that many cards from the top of your library. Until end of turn, you may cast spells from among those exiled cards.' }),
  makeCard({ name: 'Archangel Lite', type_line: 'Creature — Angel', mana_cost: '{1}', power: '4', toughness: '5', oracle_text: 'When this creature enters, if your life total is less than your starting life total, it becomes equal to your starting life total.' }),
  makeCard({ name: 'Sarkhan Unsealing Lite', type_line: 'Enchantment', mana_cost: '{1}', oracle_text: 'Whenever you cast a creature spell with power 4, 5, or 6, this enchantment deals 4 damage to any target.' }),
  makeCard({ name: 'Big Bear', type_line: 'Creature — Bear', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: '' }),
  makeCard({ name: 'Modulation Lite', type_line: 'Instant', mana_cost: '{1}{U}', oracle_text: 'This spell costs {1} less to cast during your turn.\nDraw a card.' }),
  makeCard({ name: 'Thornbow Lite', type_line: 'Creature — Elf Archer', mana_cost: '{1}', power: '1', toughness: '2', oracle_text: "Whenever this creature attacks, each opponent who doesn't control an Elf loses 1 life." }),
  makeCard({ name: 'Elf Lite', type_line: 'Creature — Elf', mana_cost: '{1}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Septic Lite', type_line: 'Creature — Phyrexian Rat', mana_cost: '{1}', power: '2', toughness: '2', oracle_text: 'Whenever this creature attacks, if defending player is poisoned, it gets +1/+1 until end of turn.' }),
  makeCard({ name: 'Huntbonder Lite', type_line: 'Creature — Human Warrior', mana_cost: '{1}', power: '2', toughness: '2', oracle_text: 'Whenever this creature attacks, put a double strike counter on another target attacking creature.' }),
  makeCard({ name: 'Hordechief Lite', type_line: 'Creature — Orc Warrior', mana_cost: '{1}', power: '1', toughness: '1', oracle_text: 'Whenever a creature you control attacks, defending player loses 1 life and you gain 1 life.' }),
  makeCard({ name: 'Taborax Lite', type_line: 'Legendary Creature — Demon Cleric', mana_cost: '{1}', power: '2', toughness: '2', oracle_text: 'Whenever another nontoken creature you control dies, put a +1/+1 counter on Taborax Lite. If that creature was a Cleric, you may draw a card. If you do, you lose 1 life.' }),
  makeCard({ name: 'Plain Cleric Lite', type_line: 'Creature — Human Cleric', mana_cost: '{1}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: "Death's Presence Lite", type_line: 'Enchantment', mana_cost: '{1}', oracle_text: 'Whenever a creature you control dies, put X +1/+1 counters on target creature you control, where X is the power of the creature that died.' }),
  makeCard({ name: 'Abigale Lite', type_line: 'Legendary Creature — Bird Bard', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'When Abigale Lite enters, up to one other target creature loses all abilities. Put a flying counter, a first strike counter, and a lifelink counter on that creature.' }),
  makeCard({ name: 'Vigil Lite', type_line: 'Creature — Human', mana_cost: '{1}', power: '2', toughness: '2', oracle_text: 'Vigilance' }),
  makeCard({ name: 'Lake-town Lite', type_line: 'Legendary Creature — Human Advisor', mana_cost: '{1}', power: '1', toughness: '1', oracle_text: 'Whenever a player loses life, that player mills that many cards.' }),
  makeCard({ name: 'War Elemental Lite', type_line: 'Creature — Elemental', mana_cost: '{1}', power: '1', toughness: '1', oracle_text: 'Whenever an opponent is dealt damage, put that many +1/+1 counters on this creature.' }),
  makeCard({ name: 'Spitfire Lite', type_line: 'Creature — Elemental', mana_cost: '{1}', power: '1', toughness: '4', oracle_text: 'Whenever an opponent is dealt noncombat damage, this creature gets +3/+0 until end of turn.' }),
  makeCard({ name: 'Omnivore Lite', type_line: 'Creature — Fungus', mana_cost: '{1}', power: '1', toughness: '1', oracle_text: '{1}, Sacrifice another creature: This creature gets +2/+2 until end of turn. If a Saproling was sacrificed this way, you gain 2 life.' }),
  makeCard({ name: 'Saproling Lite', type_line: 'Creature — Saproling', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Phyrexian Awakening Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'When this enchantment enters, incubate 4.' }),
  makeCard({ name: 'Ragga Lite', type_line: 'Legendary Creature — Ogre Warrior', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Each creature you control with a mana ability gets +2/+2.' }),
  makeCard({ name: 'Mana Elf Lite', type_line: 'Creature — Elf Druid', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{T}: Add {G}.' }),
  makeCard({ name: 'Frog Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Until end of turn, target creature loses all abilities and becomes a blue Frog with base power and toughness 1/1.' }),
  makeCard({ name: 'Vigilant Golem Lite', type_line: 'Artifact Creature — Golem', mana_cost: '{1}', power: '3', toughness: '3', oracle_text: 'Vigilance' }),
  makeCard({ name: 'Bonfire Lite', type_line: 'Sorcery', mana_cost: '{X}', oracle_text: "Bonfire Lite deals X damage to target player or planeswalker and each creature that player or that planeswalker's controller controls." }),
  makeCard({ name: 'Blightning Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Blightning Lite deals 3 damage to target player or planeswalker. That player or that planeswalker's controller discards two cards." }),
  makeCard({ name: 'Walker Lite', type_line: 'Legendary Planeswalker — Test', mana_cost: '{0}', loyalty: '5', oracle_text: '+1: You gain 1 life.' }),
  makeCard({ name: 'Prophecy Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Prophecy Lite deals 3 damage to target creature. You may put a card from your hand on the bottom of your library. If you do, draw a card.' }),
  makeCard({ name: 'Shandalar Lite', type_line: 'Creature — Avatar', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "{0}: This creature deals 3 damage to target player or planeswalker and 3 damage to up to one target creature that player or that planeswalker's controller controls." }),
  makeCard({ name: 'Wasps Lite', type_line: 'Creature — Insect', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Whenever this creature deals combat damage to a player, destroy target artifact that player controls.' }),
  makeCard({ name: 'Mutiny Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target creature an opponent controls deals damage equal to its power to another target creature that player controls.' }),
  makeCard({ name: 'Regrowth Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Return target card from your graveyard to your hand.' }),
  makeCard({ name: 'Banish Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Exile target creature.' }),
  makeCard({ name: 'Research Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'At the beginning of your end step, if a card left your graveyard this turn, draw a card.' }),
  makeCard({ name: 'Gourmand Lite', type_line: 'Creature — Human', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'At the beginning of your end step, if another Human died under your control this turn, you gain 3 life.' }),
  makeCard({ name: 'Human Lite', type_line: 'Creature — Human', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Crab Lite', type_line: 'Creature — Crab', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "At the beginning of your end step, if you haven't cast a spell from your hand this turn, draw a card." }),
  makeCard({ name: 'Ennis Lite', type_line: 'Creature — Human', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'At the beginning of your end step, if one or more cards were put into exile this turn, put a +1/+1 counter on this creature.' }),
  makeCard({ name: 'Incinerate Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Incinerate Lite deals 3 damage to any target. A creature dealt damage this way can't be regenerated this turn." }),
  makeCard({ name: 'Regen Lite', type_line: 'Creature — Troll', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '{0}: Regenerate this creature.' }),
  makeCard({ name: 'Ringwraiths Lite', type_line: 'Creature — Wraith Knight', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: 'When this creature enters, target creature an opponent controls gets -3/-3 until end of turn. If that creature is legendary, its controller loses 3 life.' }),
  makeCard({ name: 'Big Legend Lite', type_line: 'Legendary Creature — Human', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: '' }),
  makeCard({ name: 'Goby Lite', type_line: 'Legendary Creature — Frog', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Whenever you cast a noncreature spell, counter that spell. Create a number of 1/1 blue Merfolk creature tokens equal to the amount of mana spent to cast that spell.' }),
  makeCard({ name: 'Growth Lite', type_line: 'Sorcery', mana_cost: '{1}{G}', oracle_text: 'Draw a card.' }),
  makeCard({ name: 'Rabble Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever you attack with one or more creatures, create that many 1/1 green and white Citizen creature tokens.' }),
  makeCard({ name: 'Decree Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Whenever one or more creatures an opponent controls deal combat damage to you, that opponent gets a poison counter." }),
  makeCard({ name: 'Tracker Lite', type_line: 'Artifact Creature — Ferret', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Whenever you cast a spell other than your first spell each turn, put a +1/+1 counter on this creature.' }),
  makeCard({ name: 'Pulse Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Destroy target nonland permanent and all other permanents with the same name as that permanent.' }),
  makeCard({ name: 'Blight Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Target creature and all other creatures with the same name as that creature get -3/-3 until end of turn.' }),
  makeCard({ name: 'Exhume Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each player puts a creature card from their graveyard onto the battlefield.' }),
  makeCard({ name: 'Storyteller Lite', type_line: 'Creature — Treefolk', mana_cost: '{0}', power: '0', toughness: '5', oracle_text: "Whenever a player casts a noncreature spell, each of that player's opponents may draw a card." }),
  makeCard({ name: 'Opal Angel Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'When an opponent casts a creature spell, if this enchantment is an enchantment, it becomes a 5/5 Angel creature with flying and vigilance.' }),
  makeCard({ name: 'Basics Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Return target nonland permanent to its owner's hand. If you controlled that permanent, draw a card." }),
  makeCard({ name: 'Cut Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target creature with total power and toughness 5 or less.' }),
  makeCard({ name: 'Logic Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Counter target spell unless its controller pays {1} for each card in your graveyard.' }),
  makeCard({ name: 'Stutter Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Counter target spell unless its controller pays {2} plus an additional {1} for each Zombie you control.' }),
  makeCard({ name: 'Gale Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Counter target creature spell. If it was a legendary spell, you gain 5 life.' }),
  makeCard({ name: 'Remake Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target creature. Its controller manifests dread.' }),
  makeCard({ name: 'Phytotitan Lite', type_line: 'Creature — Plant Elemental', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "When this creature dies, return it to the battlefield tapped under its owner's control at the beginning of their next upkeep." }),
  makeCard({ name: 'Counterbalance Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever an opponent casts a spell, you may reveal the top card of your library. If you do, counter that spell if it has the same mana value as the revealed card.' }),
  makeCard({ name: 'Predators Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Whenever an opponent casts a spell, reveal the top card of your library. If it's a creature card, put it onto the battlefield. Otherwise, you may put that card on the bottom of your library." }),
  makeCard({ name: 'Telling Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Look at the top three cards of your library. Put one of those cards into your hand, one on top of your library, and one on the bottom of your library.' }),
  makeCard({ name: 'Dovescape Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Whenever a player casts a noncreature spell, counter that spell. That player creates X 1/1 white and blue Bird creature tokens with flying, where X is the spell's mana value." }),
  makeCard({ name: 'Insight X Lite', type_line: 'Sorcery', mana_cost: '{X}{U}', cmc: 1, oracle_text: 'Draw X cards.' }),
  makeCard({ name: 'Mana Breach Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever a player casts a spell, that player returns a land they control to its owner\'s hand.' }),
  makeCard({ name: 'Loch Mare Lite', type_line: 'Creature — Horse Serpent', mana_cost: '{0}', power: '4', toughness: '5', oracle_text: '{0}, Remove a counter from this creature: Draw a card.' }),
  makeCard({ name: 'Bridge Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "Creatures with power greater than the number of cards in your hand can't attack." }),
  makeCard({ name: 'Fortune Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Discard your hand, then draw a card for each card you've discarded this turn." }),
  makeCard({ name: 'Needle Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Needle Lite deals 1 damage to any target that was dealt damage this turn.' }),
  makeCard({ name: 'Deed Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: '{X}, Sacrifice this enchantment: Destroy each artifact, creature, and enchantment with mana value X or less.' }),
  makeCard({ name: 'Waker Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Each player discards a card. Each opponent who can't loses 3 life." }),
  makeCard({ name: 'Emperor Lite', type_line: 'Legendary Planeswalker — Test', mana_cost: '{0}', loyalty: '3', oracle_text: 'Flash\nAs long as Emperor Lite entered this turn, you may activate her loyalty abilities any time you could cast an instant.\n+1: You gain 1 life.' }),
  makeCard({ name: 'Shrieker Lite', type_line: 'Creature — Cat Beast', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'If this creature would die, exile it instead.' }),
  makeCard({ name: 'Insignificance Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature\nEnchanted creature loses all abilities and has base power and toughness 1/1.' }),
  makeCard({ name: 'Grave-Reaver Lite', type_line: 'Creature — Dragon', mana_cost: '{0}', power: '7', toughness: '6', oracle_text: 'Whenever one or more creature cards are put into your graveyard from your library, put one of them onto the battlefield.' }),
  makeCard({ name: 'Heavenward Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'When you next cast a creature spell this turn, that creature enters with an additional +1/+1 counter on it.' }),
  makeCard({ name: "Storm King's Thunder Lite", type_line: 'Instant', mana_cost: '{X}', cmc: 0, oracle_text: 'When you next cast an instant or sorcery spell this turn, copy that spell X times. You may choose new targets for the copies.' }),
  makeCard({ name: 'Path of Peril Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Cleave {1} (You may cast this spell for its cleave cost. If you do, remove the words in square brackets.)\nDestroy all creatures [with mana value 2 or less].' }),
  makeCard({ name: 'Wash Away Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Cleave {1} (You may cast this spell for its cleave cost. If you do, remove the words in square brackets.)\nCounter target spell [that wasn't cast from its owner's hand]." }),
  makeCard({ name: 'Inspired Idea Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Cleave {1} (You may cast this spell for its cleave cost. If you do, remove the words in square brackets.)\nDraw three cards. [Your maximum hand size is reduced by three for the rest of the game.]' }),
  makeCard({ name: 'Lantern Flare Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Cleave {X} (You may cast this spell for its cleave cost. If you do, remove the words in square brackets.)\n~ deals X damage to target creature or planeswalker and you gain X life. [X is the number of creatures you control.]' }),
  makeCard({ name: 'Expel Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Choose a number between 0 and 10. Destroy all creatures with power greater than or equal to the chosen number.' }),
  makeCard({ name: 'Invitation Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Choose a number between 0 and 13. Each player sacrifices that many creatures of their choice.' }),
  makeCard({ name: 'Settle Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Exile all attacking creatures target player controls. That player may search their library for that many basic land cards, put those cards onto the battlefield tapped, then shuffle.' }),
  makeCard({ name: 'Water Whip Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'As an additional cost to cast this spell, waterbend {3}. (While paying a waterbend cost, you can tap your artifacts and creatures to help. Each one pays for {1}.)\nDraw two cards.' }),
  makeCard({ name: 'Katara Lite', type_line: 'Creature — Human Warrior', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'As an additional cost to cast this spell, you may waterbend {2}. (While paying a waterbend cost, you can tap your artifacts and creatures to help. Each one pays for {1}.)\nWhen this creature enters, draw a card, then discard a card unless her additional cost was paid.' }),
  makeCard({ name: 'Punch Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Target creature you control deals damage equal to twice its power to target creature an opponent controls.' }),
  makeCard({ name: 'Outburst Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Target creature gets +1/+0 until end of turn. When that creature dies this turn, create a 3/2 colorless Eldrazi Horror creature token.' }),
  makeCard({ name: 'Meditate Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Draw four cards. You skip your next turn.' }),
  makeCard({ name: 'Fatigue Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target player skips their next draw step.' }),
  makeCard({ name: 'Stonehorn Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target opponent skips their next combat phase.' }),
  makeCard({ name: 'Brine Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each opponent skips their next untap step.' }),
  makeCard({ name: 'Starfall Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Gift a card (You may promise an opponent a gift as you cast this spell. If you do, they draw a card before its other effects.)\nDestroy all creatures. If the gift was promised, return a creature card put into your graveyard this way to the battlefield under your control.' }),
  makeCard({ name: 'Tyrant Lite', type_line: 'Creature — Dragon', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'When this creature dies, you may pay any amount of {R}. When you do, it deals that much damage to any target.' }),
  makeCard({ name: 'Courser Lite', type_line: 'Creature — Dragon', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: 'When this creature enters, you may put a commander you own from the command zone onto the battlefield. It gains haste. Return it to the command zone at the beginning of the next end step.' }),
  makeCard({ name: 'Slag Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Slag Lite deals 1 damage to target creature. Destroy all Equipment attached to that creature.' }),
  makeCard({ name: 'Dart Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Dart Lite deals 1 damage to target creature. If that creature is white or blue, Dart Lite deals 4 damage to it instead.' }),
  makeCard({ name: 'Spill Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Spill Lite deals 4 damage to target creature. Excess damage is dealt to that creature's controller instead." }),
  makeCard({ name: 'Annihilation Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Annihilation Lite deals 5 damage to target creature. Exile up to one target Equipment attached to that creature. If that creature would die this turn, exile it instead.' }),
  makeCard({ name: 'Incarnation Lite', type_line: 'Creature — Elemental', mana_cost: '{2}', cmc: 2, power: '1', toughness: '1', oracle_text: 'When this creature enters, if {G}{G} was spent to cast it, draw a card.' }),
  makeCard({ name: 'Defang Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature\nPrevent all damage that would be dealt by enchanted creature.' }),
  makeCard({ name: 'Ophidian Lite', type_line: 'Creature — Snake', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: "Whenever this creature attacks and isn't blocked, you may draw a card. If you do, this creature assigns no combat damage this turn." }),
  makeCard({ name: 'Void Lord Lite', type_line: 'Creature — Demon', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "Whenever this creature deals combat damage to a player, exile the top seven cards of that player's library, then put a creature card from among them onto the battlefield under your control." }),
  makeCard({ name: 'Extract Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each player mills two cards. Then you put a creature card from a graveyard onto the battlefield under your control.' }),
  makeCard({ name: 'Berserk Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Target creature gains trample and gets +X/+0 until end of turn, where X is its power. At the beginning of the next end step, destroy that creature if it attacked this turn.' }),
  makeCard({ name: 'Command Bridge Lite', type_line: 'Land', mana_cost: '', oracle_text: 'This land enters tapped.\nWhen this land enters, sacrifice it unless you tap an untapped permanent you control.\n{T}: Add one mana of any color.' }),
  makeCard({ name: 'Hammerhead Lite', type_line: 'Creature — Dragon', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: "Whenever you cast a spell, return up to one target nonland permanent an opponent controls with mana value less than or equal to that spell's mana value to its owner's hand." }),
  makeCard({ name: 'Fireball Evenly Lite', type_line: 'Sorcery', mana_cost: '{X}', cmc: 0, oracle_text: 'This spell costs {1} more to cast for each target beyond the first.\nFireball Evenly Lite deals X damage divided evenly, rounded down, among any number of targets.' }),
  makeCard({ name: 'Progenitus Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}: Target player exiles a card from their graveyard.' }),
  makeCard({ name: 'Knuckles Lite', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equipped creature gets +4/+2.\nEquipped creature has double strike as long as two or more Equipment are attached to it.\nEquip {1}' }),
  makeCard({ name: 'Pack Leader Lite', type_line: 'Creature — Werewolf', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Pack tactics — Whenever this creature attacks, if you attacked with creatures with total power 6 or greater this combat, draw a card.' }),
  makeCard({ name: 'Kroxa Lite', type_line: 'Creature — Giant', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: "When this creature enters, each opponent discards a card, then each opponent who didn't discard a nonland card this way loses 3 life." }),
  makeCard({ name: 'Vow Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: "Enchant creature\nEnchanted creature gets +2/+2, has vigilance, and can't attack you or planeswalkers you control." }),
  makeCard({ name: 'Prophet Lite', type_line: 'Creature — Zombie', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'When this creature enters, draw cards equal to the number of Zombies you control or the number of Zombie cards in your graveyard, whichever is greater.' }),
  makeCard({ name: 'Ravager Lite', type_line: 'Creature — Minotaur', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'When this creature enters, each player loses a third of their life, rounded up.' }),
  makeCard({ name: 'Servitor Lite', type_line: 'Creature — Construct', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'When this creature enters, suspect it.' }),
  makeCard({ name: 'Agrus Lite', type_line: 'Creature — Spirit', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "When this creature enters, choose up to one target creature. If it's suspected, exile it. Otherwise, suspect it." }),
  makeCard({ name: 'Lammasu Lite', type_line: 'Creature — Lammasu', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'When this creature enters, all suspected creatures are no longer suspected.' }),
  makeCard({ name: 'Case Lite', type_line: 'Enchantment — Case', mana_cost: '{0}', oracle_text: 'To solve — You control three or more artifacts. (If unsolved, solve at the beginning of your end step.)\nSolved — {T}: Draw a card.' }),
  makeCard({ name: 'Rot Hulk Lite', type_line: 'Creature — Zombie', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: 'When this creature enters, return up to X target Zombie cards from your graveyard to the battlefield, where X is the number of opponents you have.' }),
  makeCard({ name: 'Requiem Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: '{1}, Sacrifice this enchantment: Destroy up to X target creatures, where X is the number of verse counters on this enchantment.' }),
  makeCard({ name: 'Tormentor Lite', type_line: 'Creature — Demon', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'At the beginning of your upkeep, draw a card unless target opponent sacrifices a creature of their choice or pays 3 life.' }),
  makeCard({ name: 'Skirmisher Lite', type_line: 'Creature — Angel', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'At the beginning of each combat, choose first strike, vigilance, or lifelink. Creatures you control gain that ability until end of turn.' }),
  makeCard({ name: 'Raven Man Lite', type_line: 'Creature — Human', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'At the beginning of each end step, if a player discarded a card this turn, create a 1/1 black Bird creature token with flying.' }),
  makeCard({ name: 'Fangorn Lite', type_line: 'Creature — Treefolk', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: 'Whenever one or more Treefolk you control attack, add twice that much {G}.' }),
  makeCard({ name: 'Time Twist Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Exile target permanent you control. Return that card to the battlefield under its owner's control at the beginning of the next end step. If it enters as a creature, it enters with an additional +1/+1 counter on it." }),
  makeCard({ name: 'Kruphix Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'If you would lose unspent mana, that mana becomes colorless instead.' }),
  makeCard({ name: 'Omnath Mana Lite', type_line: 'Creature — Elemental', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Omnath Mana Lite gets +1/+1 for each unspent green mana you have.' }),
  makeCard({ name: 'Wingcrafter Lite', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Soulbond (You may pair this creature with another unpaired creature when either enters. They remain paired for as long as you control both of them.)\nAs long as this creature is paired with another creature, both creatures have flying.' }),
  makeCard({ name: 'Witness Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature\nEnchanted creature loses all abilities and is a green and white Citizen creature with base power and toughness 1/1 named Legitimate Businessperson.' }),
  makeCard({ name: 'Zero Instant', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Draw a card.' }),
  makeCard({ name: 'Stormwing Lite', type_line: 'Creature — Elemental', mana_cost: '{3}{U}{U}', cmc: 5, power: '3', toughness: '3', oracle_text: "This spell costs {2}{U} less to cast if you've cast an instant or sorcery spell this turn." }),
  makeCard({ name: 'Balrog Lite', type_line: 'Creature — Demon', mana_cost: '{7}', cmc: 7, power: '7', toughness: '7', oracle_text: 'This spell costs {1} less to cast for each permanent sacrificed this turn.' }),
  makeCard({ name: 'Perfect Lite', type_line: 'Creature — Elf Warrior', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: "As an additional cost to cast this spell, behold an Elf and exile it. (Exile an Elf you control or an Elf card from your hand.)\nWhen this creature leaves the battlefield, return the exiled card to its owner's hand." }),
  makeCard({ name: 'Elf Card Lite', type_line: 'Creature — Elf', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Massacre Lite', type_line: 'Sorcery', mana_cost: '{2}{B}{B}', cmc: 4, oracle_text: 'If an opponent controls a Plains and you control a Swamp, you may cast this spell without paying its mana cost.\nAll creatures get -2/-2 until end of turn.' }),
  makeCard({ name: 'Slick Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Slick Lite deals 2 damage to any target. If you've cast another spell this turn, draw a card." }),
  makeCard({ name: 'Discharge Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Choose target creature or planeswalker. You get {E}{E}{E}, then you may pay any amount of {E}. Discharge Lite deals that much damage to that permanent.' }),
  makeCard({ name: 'Swipe Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Choose target creature you control and target creature you don't control. If you cast this spell during your main phase, the creature you control gets +1/+1 until end of turn. Then those creatures fight each other." }),
  makeCard({ name: 'Brought Back Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Choose up to two target permanent cards in your graveyard that were put there from the battlefield this turn. Return them to the battlefield tapped.' }),
  makeCard({ name: 'Wargear Lite', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equipped creature gets +3/+2.\nWhenever this Equipment becomes unattached from a permanent, sacrifice that permanent.\nEquip {0}' }),
  makeCard({ name: 'Edgar Lite', type_line: 'Legendary Creature — Vampire Knight', mana_cost: '{2}', cmc: 2, power: '4', toughness: '4', oracle_text: 'Eminence — Whenever you cast another Vampire spell, if Edgar Lite is in the command zone or on the battlefield, create a 1/1 black Vampire creature token.' }),
  makeCard({ name: 'Vampire Cub', type_line: 'Creature — Vampire', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Ur Lite', type_line: 'Legendary Creature — Dragon Avatar', mana_cost: '{4}', cmc: 4, power: '10', toughness: '10', oracle_text: 'Eminence — As long as Ur Lite is in the command zone or on the battlefield, other Dragon spells you cast cost {1} less to cast.' }),
  makeCard({ name: 'Dragon Three', type_line: 'Creature — Dragon', mana_cost: '{3}', cmc: 3, power: '3', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Emissary Lite', type_line: 'Creature — Angel', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'As this creature enters, choose a card type.\nYou and creatures you control have protection from the chosen card type.' }),
  makeCard({ name: 'Virtue Lite', type_line: 'Creature — Avatar', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'You have protection from each of your opponents.' }),
  makeCard({ name: 'Halo Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'As this enchantment enters, choose a card name.\nYou have protection from the chosen card name.' }),
  makeCard({ name: 'Each Pulse Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Each Pulse Lite deals 2 damage to each player.' }),
  makeCard({ name: 'Planar Nexus Lite', type_line: 'Land', mana_cost: '', oracle_text: 'This land is every nonbasic land type.\n{T}: Add {C}.' }),
  makeCard({ name: 'Surging Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Ripple 4\nSurging Lite deals 2 damage to target player.' }),
  makeCard({ name: 'Thrumming Lite', type_line: 'Legendary Artifact', mana_cost: '{0}', oracle_text: 'Spells you cast have ripple 4.' }),
  makeCard({ name: 'Monolith Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: 'Once each turn, you may pay {0} rather than pay the mana cost for a colorless spell you cast from your hand.' }),
  makeCard({ name: 'Showdown Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Put a double strike counter on target creature, then goad each creature that had a double strike counter put on it this way.\nOverload {0}' }),
  makeCard({ name: 'Ant Lite', type_line: 'Creature — Insect', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'At the beginning of your end step, each player may put two +1/+1 counters on a creature they control. Goad each creature that had counters put on it this way.' }),
  makeCard({ name: 'Spouts Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'For each attacking creature, its owner puts it on their choice of the top or bottom of their library.' }),
  makeCard({ name: 'Kess Lite', type_line: 'Legendary Creature — Human Wizard', mana_cost: '{0}', power: '3', toughness: '4', oracle_text: 'Once during each of your turns, you may cast an instant or sorcery spell from your graveyard. If a spell cast this way would be put into your graveyard, exile it instead.' }),
  makeCard({ name: 'Misthollow Griffin', type_line: 'Creature — Griffin', mana_cost: '{2}', cmc: 2, power: '3', toughness: '3', oracle_text: 'Flying\nYou may cast this card from exile.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const kitActions = (g: GameState, id: string) => legalActions(g, 'alice').filter((a) => a.type === 'activate' && a.object === id);

describe('staples (slice 185): choose one that hasn\'t been chosen', () => {
  it('Monument to Endurance: each mode once per turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Monument to Endurance', 'battlefield');
    const hand = [give(g, 'alice', 'Island', 'hand'), give(g, 'alice', 'Island', 'hand')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Looting', 'hand') }));
    expect(g.pending?.kind).toBe('discard');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: hand } });
    expect(g.pending?.kind).toBe('trigger_targets');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', modes: [2], targets: [] } });
    const p = g.pending;
    expect(p?.kind === 'trigger_targets' && p.modes?.used).toEqual([2]);
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', modes: [2], targets: [] } })).toMatch(/already been chosen/);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', modes: [0], targets: [] } });
    const life = g.players.bob!.life;
    const cards = g.zones.hand.alice!.length;
    g = settle(g);
    expect(g.players.bob!.life).toBe(life - 3);
    expect(g.zones.hand.alice!.length).toBe(cards + 1);
    // A new turn: every mode again (with no discards to hand size on the way).
    for (const id of g.zones.hand.alice!.splice(0)) {
      g.objects[id]!.zone = 'library';
      g.zones.library.alice!.push(id);
    }
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    const more = [give(g, 'alice', 'Island', 'hand'), give(g, 'alice', 'Island', 'hand')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Looting', 'hand') }));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: more } });
    const q = g.pending;
    expect(q?.kind === 'trigger_targets' && q.modes?.used).toBeUndefined();
  });

  it('with every mode chosen this turn, the ability is removed as it triggers (CR 700.2b)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const monument = give(g, 'alice', 'Monument to Endurance', 'battlefield');
    g.modesChosen = { [`${monument}:${g.objects[monument]!.zcc}:${g.cards[g.objects[monument]!.card]!.faces[0]!.abilities[0]!.text}`]: { turn: g.turn, modes: [0, 1, 2] } };
    const hand = [give(g, 'alice', 'Island', 'hand'), give(g, 'alice', 'Island', 'hand')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Looting', 'hand') }));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: hand } });
    expect(g.pending).toBeNull();
    expect(g.stack.length).toBe(0);
  });

  it('an activated ability: the modes not chosen this turn; none once all are', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const kit = give(g, 'alice', 'Daily Kit', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: kit, ability: 0, modes: [1] }));
    expect(illegal(g, { type: 'activate', player: 'alice', object: kit, ability: 0, modes: [1] })).toMatch(/already been chosen/);
    expect(kitActions(g, kit).map((a) => (a as { modes?: number[] }).modes)).toEqual([[0]]);
    g = settle(act(g, { type: 'activate', player: 'alice', object: kit, ability: 0, modes: [0] }));
    expect(kitActions(g, kit)).toEqual([]);
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    expect(kitActions(g, kit).length).toBe(1);
  });

  it('"that hasn\'t been chosen": not again on a later turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const box = give(g, 'alice', 'Puzzle Box', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: box, ability: 0, modes: [0] }));
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    expect(kitActions(g, box).map((a) => (a as { modes?: number[] }).modes)).toEqual([[1]]);
  });
});

describe('staples (slice 185): you may pay {X}', () => {
  it('Well of Lost Dreams: X up to the life gained, then draw X', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Well of Lost Dreams', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Salve', 'hand') }));
    expect(g.pending).toMatchObject({ kind: 'pay', cost: '{X}', x: { max: 3 } });
    g.players.alice!.pool.C = 4;
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true, x: 4 } })).toMatch(/greater than 3/);
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true, x: 2 } }));
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
    expect(g.players.alice!.pool.C).toBe(2);
  });

  it('Primordial Ooze: X is its +1/+1 counters; if you don\'t pay, it taps and deals X damage to you', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const ooze = give(g, 'alice', 'Primordial Ooze', 'battlefield');
    g.objects[ooze]!.counters['+1/+1'] = 2;
    g = toStep(g, 'upkeep', 'alice');
    g = settle(g);
    expect(g.pending).toMatchObject({ kind: 'pay', cost: '{3}' });
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: false } }));
    expect(g.objects[ooze]!.tapped).toBe(true);
    expect(g.players.alice!.life).toBe(life - 3);
  });

  it('"When you do": the reflexive ability uses the X paid', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Jugan Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: cub }));
    expect(g.pending).toMatchObject({ kind: 'pay', x: {} });
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true, x: 2 } }));
    expect(g.objects[cub]!.counters['+1/+1']).toBe(2);
  });
});

describe('staples (slice 185): tempting offer', () => {
  it('each opponent who accepts does it too; then you do it again for each of them', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const [mine, bobs, carols] = [give(g, 'alice', 'Cub', 'battlefield'), give(g, 'bob', 'Cub', 'battlefield'), give(g, 'carol', 'Cub', 'battlefield')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Tempt with Glory', 'hand') }));
    expect(g.pending).toMatchObject({ kind: 'may', player: 'bob' });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'may', yes: true } });
    expect(g.pending).toMatchObject({ kind: 'may', player: 'carol' });
    g = settle(act(g, { type: 'choose', player: 'carol', answer: { kind: 'may', yes: false } }));
    expect(g.objects[mine]!.counters['+1/+1']).toBe(2);
    expect(g.objects[bobs]!.counters['+1/+1']).toBe(1);
    expect(g.objects[carols]!.counters['+1/+1'] ?? 0).toBe(0);
  });

  it('an opponent who can\'t do it isn\'t offered it', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const [a1, a2, b1] = [give(g, 'alice', 'Cub', 'graveyard'), give(g, 'alice', 'Cub', 'graveyard'), give(g, 'bob', 'Cub', 'graveyard')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Tempt with Immortality', 'hand') }));
    if (g.pending?.kind === 'choose_objects') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [a1] } });
    expect(g.pending).toMatchObject({ kind: 'may', player: 'bob' });
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'may', yes: true } }));
    expect(g.pending).toBeNull();
    expect([a1, a2, b1].map((id) => g.objects[id]!.zone)).toEqual(['battlefield', 'battlefield', 'battlefield']);
    expect(g.objects[b1]!.controller).toBe('bob');
  });
});

describe('staples (slice 185): each opponent who …', () => {
  it('Teysa: for each opponent who lost life this turn', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    give(g, 'alice', 'Teysa Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    g = toStep(g, 'end', 'alice');
    g = settle(g);
    const clues = g.zones.battlefield.filter((id) => g.objects[id]!.controller === 'alice' && g.cards[g.objects[id]!.card]!.name === 'Clue');
    expect(clues.length).toBe(1);
  });

  it('Cut a Deal: for each opponent who drew a card this way (not one with no library)', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    for (const id of g.zones.library.bob!.splice(0)) {
      g.objects[id]!.zone = 'exile';
      g.zones.exile.push(id);
    }
    const [mine, carols] = [g.zones.hand.alice!.length, g.zones.hand.carol!.length];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Cut a Deal', 'hand') }));
    expect(g.zones.hand.carol!.length).toBe(carols + 1);
    expect(g.zones.hand.alice!.length).toBe(mine + 1);
  });

  it("Smuggler's Share: for each opponent who drew two or more cards this turn", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', "Smuggler's Share", 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Gift of Words', 'hand') }));
    const hand = g.zones.hand.alice!.length;
    g = toStep(g, 'end', 'alice');
    g = settle(g);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });
});

describe('staples (slice 185): search for any number of cards', () => {
  it('as many as you like, none at all too', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const forests = [give(g, 'alice', 'Forest', 'library'), give(g, 'alice', 'Forest', 'library'), give(g, 'alice', 'Forest', 'library')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Forest Call', 'hand') }));
    expect(g.pending?.kind).toBe('search');
    const p = g.pending as { candidates: string[]; count: number; mustFind: boolean };
    expect(p.candidates).toEqual(expect.arrayContaining(forests));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: forests } }));
    expect(forests.every((id) => g.objects[id]!.zone === 'battlefield' && g.objects[id]!.tapped)).toBe(true);
  });
});

describe('staples (slice 185): spending mana as though it were mana of any color (CR 609.4b)', () => {
  it('Chromatic Orrery: any mana pays colored costs ({C} still needs colorless)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'hand');
    g.players.alice!.pool.U = 2;
    expect(illegal(g, { type: 'cast', player: 'alice', object: bear })).toMatch(/mana/i);
    give(g, 'alice', 'Chromatic Orrery', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.players.alice!.pool.U).toBe(0);
  });

  it('only for the spells it names', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Oath Lite', 'battlefield');
    const [bear, walker] = [give(g, 'alice', 'Bear', 'hand'), give(g, 'alice', 'Walker', 'hand')];
    g.players.alice!.pool.U = 2;
    expect(illegal(g, { type: 'cast', player: 'alice', object: bear })).toMatch(/mana/i);
    g = settle(act(g, { type: 'cast', player: 'alice', object: walker }));
    expect(g.objects[walker]!.zone).toBe('battlefield');
  });

  it('Hurl Through Hell: cast the exiled card until the end of your next turn, with mana of any color', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Hurl Through Hell', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[bear]!.zone).toBe('exile');
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    g.players.alice!.pool.R = 2;
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === bear)).toBe(true);
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.objects[bear]!.controller).toBe('alice');
  });
});

describe('staples (slice 186): Arena of Glory', () => {
  it('exerted as a cost (it stays tapped), and the creature cast with its mana has haste this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const arena = give(g, 'alice', 'Arena of Glory', 'battlefield');
    g.players.alice!.pool.R = 1;
    g = act(g, { type: 'activate_mana', player: 'alice', object: arena, ability: 1 });
    expect(g.objects[arena]!.exerted).toBe(true);
    const goblin = give(g, 'alice', 'Goblin Pair', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: goblin }));
    expect(chars(g, g.objects[goblin]!).keywords.some((k) => k.id === 'haste')).toBe(true);
    g = toStep(g, 'main1', 'bob');
    expect(chars(g, g.objects[goblin]!).keywords.some((k) => k.id === 'haste')).toBe(false);
    g = toStep(g, 'main1', 'alice');
    expect(g.objects[arena]!.tapped).toBe(true);
  });
});

describe('staples (slice 187): Hostage Taker', () => {
  it('cast the exiled card for as long as it remains exiled, with mana of any type', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const taker = give(g, 'alice', 'Hostage Taker', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: taker }));
    if (g.pending?.kind === 'trigger_targets') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: bear }]] } }));
    expect(g.objects[bear]!.zone).toBe('exile');
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.objects[bear]!.controller).toBe('alice');
  });
});

const toAttack = (g: GameState) => {
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return g;
};

describe('staples (slice 187)', () => {
  it('Toxrill: each creature you don\'t control gets -1/-1 for each slime counter on it', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Toxrill Lite', 'battlefield');
    const [a, b] = [give(g, 'bob', 'Zombie', 'battlefield'), give(g, 'bob', 'Zombie', 'battlefield')];
    g.objects[a]!.counters.slime = 1;
    expect([chars(g, g.objects[a]!).power, chars(g, g.objects[b]!).power]).toEqual([1, 2]);
  });

  it('Frenzied Baloth: combat damage can\'t be prevented', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const baloth = give(g, 'alice', 'Frenzied Baloth', 'battlefield');
    give(g, 'bob', 'Chasm Lite', 'battlefield');
    const life = g.players.bob!.life;
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: baloth, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 30 && g.step !== 'end'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } } as never);
      else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
      else break;
    }
    expect(g.players.bob!.life).toBe(life - 3);
  });

  it('Diregraf Colossus: a counter for each Zombie card in your graveyard', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Zombie', 'graveyard');
    give(g, 'alice', 'Zombie', 'graveyard');
    const colossus = give(g, 'alice', 'Diregraf Colossus', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: colossus }));
    expect(g.objects[colossus]!.counters['+1/+1']).toBe(2);
  });

  it('Thirst for Knowledge: discard an artifact card, or two cards', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const trinket = give(g, 'alice', 'Trinket', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Thirst for Knowledge', 'hand') }));
    const hand = g.zones.hand.alice!.length;
    expect(g.pending?.kind).toBe('pay');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true } }));
    // Another artifact card drawn: which one is the player's choice.
    if (g.pending?.kind === 'choose_objects') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [trinket] } }));
    expect(g.objects[trinket]!.zone).toBe('graveyard');
    expect(g.zones.hand.alice!.length).toBe(hand - 1);
  });

  it('"Whenever one or more Goblins you control attack": only when one of them attacks', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const kreat = give(g, 'alice', 'Kreat Lite', 'battlefield');
    const zombie = give(g, 'alice', 'Zombie', 'battlefield');
    g.objects[kreat]!.sick = false;
    g.objects[zombie]!.sick = false;
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: zombie, target: { kind: 'player', player: 'bob' } }] } });
    g = settle(g);
    const goblins = () => g.zones.battlefield.filter((id) => g.objects[id]!.controller === 'alice' && g.cards[g.objects[id]!.card]!.name === 'Goblin Token');
    expect(goblins().length).toBe(0);
  });
});

describe('staples (slice 187): from the library', () => {
  it('Hedge Shredder: the land cards milled at once go onto the battlefield tapped', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Hedge Shredder', 'battlefield');
    const lib = g.zones.library.alice!;
    const forests = [give(g, 'alice', 'Forest', 'library'), give(g, 'alice', 'Forest', 'library')];
    for (const f of forests) lib.splice(lib.indexOf(f), 1);
    lib.unshift(...forests, give(g, 'alice', 'Bear', 'library'));
    lib.splice(lib.lastIndexOf(lib[2]!), 1);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mill Three', 'hand') }));
    g = settle(g);
    expect(forests.map((id) => [g.objects[id]!.zone, g.objects[id]!.tapped])).toEqual([['battlefield', true], ['battlefield', true]]);
  });

  it('The Reality Chip: playing from the top only while attached to a creature', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const chip = give(g, 'alice', 'Reality Chip Lite', 'battlefield');
    const bear = give(g, 'alice', 'Zombie', 'battlefield');
    // A card that can be played from the top (whatever the shuffle put there).
    const top = give(g, 'alice', 'Salve', 'library');
    g.zones.library.alice!.splice(g.zones.library.alice!.indexOf(top), 1);
    g.zones.library.alice!.unshift(top);
    const playsTop = () => legalActions(g, 'alice').some((a) => (a.type === 'cast' || a.type === 'play_land') && (a as { object: string }).object === top);
    g.players.alice!.pool.C = 9;
    g.players.alice!.pool.G = 9;
    expect(playsTop()).toBe(false);
    g = settle(act(g, { type: 'activate', player: 'alice', object: chip, ability: 0, targets: [[{ kind: 'object', object: bear }]] }));
    g.players.alice!.pool.C = 9;
    g.players.alice!.pool.G = 9;
    g.players.alice!.pool.W = 9;
    g.players.alice!.pool.U = 9;
    g.players.alice!.pool.B = 9;
    g.players.alice!.pool.R = 9;
    expect(g.objects[chip]!.attachedTo?.id).toBe(bear);
    expect(playsTop()).toBe(true);
  });
});

describe('staples (slice 188): keeping unspent mana (CR 500.5)', () => {
  it("Electro: unspent red mana isn't lost as steps and phases end; other mana is", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Electro Lite', 'battlefield');
    g.players.alice!.pool.R = 2;
    g.players.alice!.pool.G = 1;
    g = toStep(g, 'end', 'alice');
    expect([g.players.alice!.pool.R, g.players.alice!.pool.G]).toEqual([2, 0]);
  });
});

describe('staples (slice 189): counted target filters', () => {
  it('Lay Down Arms: mana value up to the number of Plains you control, counted as the target is chosen', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Plains', 'battlefield');
    give(g, 'alice', 'Plains', 'battlefield');
    const [bear, ogre] = [give(g, 'bob', 'Bear', 'battlefield'), give(g, 'bob', 'Ogre Three', 'battlefield')];
    const spell = give(g, 'alice', 'Lay Down Arms', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: spell, targets: [[{ kind: 'object', object: ogre }]] })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: spell, targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[bear]!.zone).toBe('exile');
  });
});

describe('staples (slice 189): attacks while, sources you control', () => {
  it('"attacks while …": checked as it attacks only', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ruby = give(g, 'alice', 'Ruby Lite', 'battlefield');
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: ruby, target: { kind: 'player', player: 'bob' } }] } });
    expect(g.stack.length).toBe(0);
    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ruby2 = give(h, 'alice', 'Ruby Lite', 'battlefield');
    give(h, 'alice', 'Ogre', 'battlefield');
    h = toAttack(toStep(h, 'beginning_of_combat'));
    h = act(h, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: ruby2, target: { kind: 'player', player: 'bob' } }] } });
    h = settle(h);
    expect(chars(h, h.objects[ruby2]!).power).toBe(3);
  });

  it('Niv-Mizzet, Visionary: draw that many when a source you control deals noncombat damage to an opponent', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Niv Lite', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.zones.hand.alice!.length).toBe(hand + 3);
  });
});

describe('staples (slice 189): flash for more', () => {
  it('Rout: at instant speed only by paying {2} more', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const rout = give(g, 'alice', 'Rout Lite', 'hand');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g.players.alice!.pool.C = 3;
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.priority).toBe('alice');
    expect(illegal(g, { type: 'cast', player: 'alice', object: rout })).toMatch(/main phase/);
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === rout && (a as { extras?: string[] }).extras?.includes('flash'))).toBe(true);
    g = settle(act(g, { type: 'cast', player: 'alice', object: rout, extras: ['flash'] }));
    expect(g.objects[bear]!.zone).toBe('graveyard');
    expect(g.players.alice!.pool.C).toBe(0);
  });
});

describe('staples (slice 189): cast from exile', () => {
  it('Misthollow Griffin: its owner may cast it from exile, paying its mana cost', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const griffin = give(g, 'alice', 'Misthollow Griffin', 'exile');
    const theirs = give(g, 'bob', 'Misthollow Griffin', 'exile');
    g.players.alice!.pool.C = 2;
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === theirs)).toBe(false);
    g = settle(act(g, { type: 'cast', player: 'alice', object: griffin }));
    expect(g.objects[griffin]!.zone).toBe('battlefield');
  });
});

describe('staples (slice 190): descended, died under your control, two-event triggers', () => {
  it('Child of the Volcano: grows at your end step only if a permanent card went to your graveyard this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const child = give(g, 'alice', 'Child of the Volcano', 'battlefield');
    g = settle(toStep(g, 'end', 'alice'));
    expect(g.objects[child]!.counters['+1/+1'] ?? 0).toBe(0);
    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const child2 = give(h, 'alice', 'Child of the Volcano', 'battlefield');
    const bear = give(h, 'alice', 'Bear', 'battlefield');
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    expect(h.objects[bear]!.zone).toBe('graveyard');
    h = settle(toStep(h, 'end', 'alice'));
    expect(h.objects[child2]!.counters['+1/+1']).toBe(1);
  });

  it('"if a creature died under your control this turn": an opponent\'s creature dying doesn\'t count', () => {
    const tokens = (g: GameState) => g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice').length;
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Cleric Lite', 'battlefield');
    const theirs = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: theirs }]] }));
    g = settle(toStep(g, 'end', 'alice'));
    expect(tokens(g)).toBe(0);
    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(h, 'alice', 'Cleric Lite', 'battlefield');
    const mine = give(h, 'alice', 'Bear', 'battlefield');
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: mine }]] }));
    h = settle(toStep(h, 'end', 'alice'));
    expect(tokens(h)).toBe(1);
  });

  it('Shrine of Loyal Legions: "at the beginning of your upkeep and whenever you cast a white spell"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const shrine = give(g, 'alice', 'Shrine of Loyal Legions', 'battlefield');
    g.players.alice!.pool.W = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'White Salve', 'hand') }));
    expect(g.objects[shrine]!.counters.charge).toBe(1);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Salve', 'hand') }));
    expect(g.objects[shrine]!.counters.charge).toBe(1);
    g = settle(toStep(g, 'upkeep', 'alice'));
    expect(g.objects[shrine]!.counters.charge).toBe(2);
  });

  it('Orcish Mine: the last ore counter destroys the land and deals 2 damage to its controller', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const land = give(g, 'bob', 'Forest', 'battlefield');
    const mine = give(g, 'alice', 'Orcish Mine', 'battlefield');
    g.objects[mine]!.attachedTo = { id: land, zcc: g.objects[land]!.zcc };
    g.objects[mine]!.counters.ore = 1;
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Tap Land', 'hand'), targets: [[{ kind: 'object', object: land }]] }));
    expect(g.objects[land]!.zone).toBe('graveyard');
    expect(g.players.bob!.life).toBe(life - 2);
  });
});

describe('staples (slice 191)', () => {
  it('Heartless Act: up to three counters of any kinds, the caster choosing which', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g.objects[bear]!.counters = { '+1/+1': 2, shield: 1 };
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Heartless Act', 'hand'), modes: [1], targets: [[{ kind: 'object', object: bear }]] });
    g = settle(g);
    expect(g.pending).toMatchObject({ kind: 'choose_option', options: ['+1/+1', 'shield', 'Done'] });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: 'shield' } });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: '+1/+1' } });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: 'Done' } }));
    expect(g.objects[bear]!.counters).toEqual({ '+1/+1': 1 });
  });

  it('"you may remove a counter … When you do": not without a counter to remove', () => {
    const hit = (counters: Record<string, number>) => {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const croc = give(g, 'alice', 'Leatherhead Lite', 'battlefield');
      g.objects[croc]!.counters = counters;
      g = toAttack(toStep(g, 'beginning_of_combat'));
      g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: croc, target: { kind: 'player', player: 'bob' } }] } });
      for (let i = 0; i < 40 && g.step !== 'main2'; i++) {
        if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'may', yes: true } });
        else if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks: [] } });
        else if (g.pending) break;
        else g = act(g, { type: 'pass', player: g.priority! });
      }
      return g;
    };
    const none = hit({});
    const one = hit({ shield: 1 });
    expect(one.players.alice!.life - none.players.alice!.life).toBe(5);
  });

  it('Great Train Heist: combat damage to the chosen opponent this turn', () => {
    let g = toStep(start({ players: 3, extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Great Train Heist', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: bear, target: { kind: 'player', player: 'bob' } }, { attacker: cub, target: { kind: 'player', player: 'carol' } }] } });
    for (let i = 0; i < 40 && g.step !== 'main2'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks: [] } });
      else if (g.pending) break;
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    const treasures = g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice');
    expect(treasures.length).toBe(1);
    expect(g.objects[treasures[0]!]!.tapped).toBe(true);
  });

  it('Thousand-Year Storm: a copy for each instant and sorcery you cast before it this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Thousand-Year Storm', 'battlefield');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Salve', 'hand') }));
    expect(g.players.alice!.life).toBe(life + 3);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Cub', 'hand') }));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Salve', 'hand') }));
    expect(g.players.alice!.life).toBe(life + 9);
  });

  it('Cavern-Hoard Dragon: {X} less for the most artifacts any one opponent controls', () => {
    let g = toStep(start({ players: 3, extra: CARDS }), 'main1', 'alice');
    for (let i = 0; i < 3; i++) give(g, 'bob', 'Trinket', 'battlefield');
    for (let i = 0; i < 2; i++) give(g, 'carol', 'Trinket', 'battlefield');
    const dragon = give(g, 'alice', 'Cavern-Hoard Dragon', 'hand');
    g.players.alice!.pool.R = 2;
    g.players.alice!.pool.C = 3;
    expect(illegal(g, { type: 'cast', player: 'alice', object: dragon })).toBeTruthy();
    g.players.alice!.pool.C = 4;
    g = settle(act(g, { type: 'cast', player: 'alice', object: dragon }));
    expect(g.objects[dragon]!.zone).toBe('battlefield');
  });

  it('Laelia: once for each batch of cards exiled from your library', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const laelia = give(g, 'alice', 'Laelia Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Exile Two', 'hand') }));
    expect(g.objects[laelia]!.counters['+1/+1']).toBe(1);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mill Three', 'hand') }));
    expect(g.objects[laelia]!.counters['+1/+1']).toBe(1);
  });

  it('Steel Hellkite: only permanents of the players it dealt combat damage to', () => {
    let g = toStep(start({ players: 3, extra: CARDS }), 'main1', 'alice');
    const kite = give(g, 'alice', 'Steel Hellkite', 'battlefield');
    const [theirs, other, mine] = [give(g, 'bob', 'Trinket', 'battlefield'), give(g, 'carol', 'Trinket', 'battlefield'), give(g, 'alice', 'Trinket', 'battlefield')];
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: kite, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 40 && g.step !== 'main2'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks: [] } });
      else if (g.pending) break;
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'activate', player: 'alice', object: kite, ability: 0, x: 1 }));
    expect([g.objects[theirs]!.zone, g.objects[other]!.zone, g.objects[mine]!.zone]).toEqual(['graveyard', 'battlefield', 'battlefield']);
  });

  it('Combustible Gearhulk: the opponent chooses; declining, they take the milled cards\' total mana value', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lib = g.zones.library.alice!;
    for (const name of ['Ogre Three', 'Bear', 'Trinket']) {
      const id = give(g, 'alice', name, 'library');
      lib.splice(lib.indexOf(id), 1);
      lib.unshift(id);
    }
    const life = g.players.bob!.life;
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Combustible Gearhulk', 'hand') }));
    expect(g.pending).toMatchObject({ kind: 'may', player: 'bob' });
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'may', yes: false } }));
    expect(g.players.bob!.life).toBe(life - 6);
    expect(g.zones.hand.alice!.length).toBe(hand);
  });

  it('Finale of Revelation: X of 10 or more does the rest instead', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const hand = g.zones.hand.alice!.length;
    g.players.alice!.pool.U = 2;
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Finale of Revelation', 'hand'), x: 2 }));
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
  });
});

describe('staples (slice 192)', () => {
  const combat = (g: GameState, attacks: { attacker: string; target: { kind: 'player'; player: string } }[]) => {
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks } });
    for (let i = 0; i < 40 && g.step !== 'main2'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks: [] } });
      else if (g.pending) break;
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    return g;
  };

  it('Relentless Assault: untaps the creatures that attacked this turn — not the others', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [bear, cub] = [give(g, 'alice', 'Bear', 'battlefield'), give(g, 'alice', 'Cub', 'battlefield')];
    g = combat(g, [{ attacker: bear, target: { kind: 'player', player: 'bob' } }]);
    g.objects[cub]!.tapped = true;
    expect(g.objects[bear]!.tapped).toBe(true);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Relentless Assault', 'hand') }));
    expect([g.objects[bear]!.tapped, g.objects[cub]!.tapped]).toEqual([false, true]);
  });

  it('"become artifact creatures with base power and toughness 5/5": an Equipment stays an Equipment (CR 205.1a)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const sword = give(g, 'alice', 'Sword Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Antiquities Lite', 'hand') }));
    const c = chars(g, g.objects[sword]!);
    expect([c.power, c.toughness, c.types, c.subtypes]).toEqual([5, 5, ['Artifact', 'Creature'], ['Equipment']]);
  });

  it("Proft's Eidetic Memory: more than one card drawn this turn, X one less than that", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Proft Lite', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Draw Three', 'hand') }));
    g = toStep(g, 'beginning_of_combat');
    for (let i = 0; i < 10 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: bear }]] } });
      else if (g.pending) break;
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    // Drew one in the draw step too? Alice's first turn skips it (CR 103.8a) — so three this turn.
    expect(g.objects[bear]!.counters['+1/+1']).toBe(g.turnLog.drawn!.alice! - 1);
  });

  it('Baleful Mastery: an opponent draws a card only for the alternative cost', () => {
    let g = toStep(start({ players: 3, extra: CARDS }), 'main1', 'alice');
    const [b1, b2] = [give(g, 'bob', 'Bear', 'battlefield'), give(g, 'bob', 'Bear', 'battlefield')];
    const hands = () => [g.zones.hand.bob!.length, g.zones.hand.carol!.length];
    const before = hands();
    g.players.alice!.pool.B = 1;
    g.players.alice!.pool.C = 1;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Baleful Mastery', 'hand'), targets: [[{ kind: 'object', object: b1 }]], alt: 'alt' });
    g = settle(g);
    expect(g.pending).toMatchObject({ kind: 'choose_option', player: 'alice' });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: (g.pending as { options: string[] }).options.find((o) => /carol/i.test(o))! } }));
    expect(hands()).toEqual([before[0], before[1]! + 1]);
    expect(g.objects[b1]!.zone).toBe('exile');
    g.players.alice!.pool.B = 1;
    g.players.alice!.pool.C = 3;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Baleful Mastery', 'hand'), targets: [[{ kind: 'object', object: b2 }]] }));
    expect(hands()).toEqual([before[0], before[1]! + 1]);
  });

  it("Vaultborn Tyrant: its token copy doesn't make another", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const rex = give(g, 'alice', 'Vaultborn Tyrant', 'battlefield');
    g.objects[rex]!.damage = 6;
    g = settle(act(g, { type: 'pass', player: 'alice' }));
    g = settle(g);
    const copies = () => g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice');
    expect(copies().length).toBe(1);
    expect(chars(g, g.objects[copies()[0]!]!).types).toEqual(expect.arrayContaining(['Artifact', 'Creature']));
    g.objects[copies()[0]!]!.damage = 6;
    g = settle(act(g, { type: 'pass', player: g.priority! }));
    expect(copies().length).toBe(0);
  });

  it('Behind the Mask: kicked, it still becomes an artifact creature — a 1/1', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const trinket = give(g, 'alice', 'Trinket', 'battlefield');
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Behind the Mask', 'hand'), targets: [[{ kind: 'object', object: trinket }]], kicked: true }));
    const c = chars(g, g.objects[trinket]!);
    expect([c.types.includes('Creature'), c.power, c.toughness]).toEqual([true, 1, 1]);
  });
});

describe('staples (slice 192): boast (CR 702.142a)', () => {
  const attackWith = (g: GameState, attacker: string) => {
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 40 && g.step !== 'main2'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks: [] } });
      else if (g.pending) break;
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    return g;
  };
  it('only after it attacked, and once each turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const dwarf = give(g, 'alice', 'Braggart Lite', 'battlefield');
    expect(illegal(g, { type: 'activate', player: 'alice', object: dwarf, ability: 0 })).toBeTruthy();
    g = attackWith(g, dwarf);
    g = settle(act(g, { type: 'activate', player: 'alice', object: dwarf, ability: 0 }));
    expect(illegal(g, { type: 'activate', player: 'alice', object: dwarf, ability: 0 })).toMatch(/once/);
  });
  it('Birgi: twice during your turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Birgi Lite', 'battlefield');
    const dwarf = give(g, 'alice', 'Braggart Lite', 'battlefield');
    g = attackWith(g, dwarf);
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'activate', player: 'alice', object: dwarf, ability: 0 }));
    g = settle(act(g, { type: 'activate', player: 'alice', object: dwarf, ability: 0 }));
    expect(g.players.alice!.life).toBe(life + 2);
    expect(illegal(g, { type: 'activate', player: 'alice', object: dwarf, ability: 0 })).toBeTruthy();
  });
});

describe('staples (slice 192): the next spell has improvise', () => {
  it('Archway of Innovation: only that next spell', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const arch = give(g, 'alice', 'Archway of Innovation', 'battlefield');
    const relics = [give(g, 'alice', 'Trinket', 'battlefield'), give(g, 'alice', 'Trinket', 'battlefield'), give(g, 'alice', 'Trinket', 'battlefield')];
    const spell = give(g, 'alice', 'Ogre Spell', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: spell, costs: { improvise: relics } })).toBeTruthy();
    g.players.alice!.pool.U = 1;
    g = settle(act(g, { type: 'activate', player: 'alice', object: arch, ability: 0 }));
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: spell, costs: { improvise: relics } }));
    expect(g.players.alice!.life).toBe(life + 3);
    for (const r of relics) g.objects[r]!.tapped = false;
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ogre Spell', 'hand'), costs: { improvise: relics } })).toBeTruthy();
  });
});

describe('staples (slice 193): Braids, Arisen Nightmare', () => {
  it('each opponent may sacrifice a permanent sharing a card type; each who doesn\'t loses 2 life and you draw', () => {
    let g = toStep(start({ players: 3, extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Braids, Arisen Nightmare', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const carolBear = give(g, 'carol', 'Bear', 'battlefield');
    const bobTrinket = give(g, 'bob', 'Trinket', 'battlefield');
    const [bobLife, carolLife, hand] = [g.players.bob!.life, g.players.carol!.life, g.zones.hand.alice!.length];
    g = toStep(g, 'end', 'alice');
    for (let i = 0; i < 30 && (g.stack.length || g.pending); i++) {
      const p = g.pending;
      if (p?.kind === 'may') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'may', yes: true } });
      else if (p?.kind === 'sacrifice') {
        const pick = p.player === 'alice' ? bear : carolBear;
        g = act(g, { type: 'choose', player: p.player, answer: { kind: 'sacrifice', objects: [pick] } });
      } else if (p) throw new Error(`unexpected ${p.kind}`);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.objects[bear]!.zone).toBe('graveyard');
    expect(g.objects[carolBear]!.zone).toBe('graveyard');
    expect(g.objects[bobTrinket]!.zone).toBe('battlefield');
    expect([g.players.bob!.life, g.players.carol!.life]).toEqual([bobLife - 2, carolLife]);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });
});

describe('staples (slice 193): copying a permanent spell', () => {
  it('Lithoform Engine: the copy becomes a token (CR 707.10f)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const engine = give(g, 'alice', 'Lithoform Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: cub });
    g = settle(act(g, { type: 'activate', player: 'alice', object: engine, ability: 0, targets: [[{ kind: 'object', object: cub }]] }));
    const cubs = g.zones.battlefield.filter((id) => g.objects[id]!.card === g.objects[cub]!.card);
    expect(cubs.length).toBe(2);
    expect(cubs.filter((id) => g.objects[id]!.token).length).toBe(1);
  });
});

describe('staples (slice 194)', () => {
  it('Tarmogoyf: card types among cards in all graveyards', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const goyf = give(g, 'alice', 'Tarmogoyf', 'battlefield');
    give(g, 'bob', 'Bolt', 'graveyard');
    give(g, 'alice', 'Bear', 'graveyard');
    give(g, 'alice', 'Trinket', 'graveyard');
    const c = chars(g, g.objects[goyf]!);
    expect([c.power, c.toughness]).toEqual([3, 4]);
  });

  it('Mutavault: a 2/2 with every creature type, still a land', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const vault = give(g, 'alice', 'Mutavault', 'battlefield');
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'activate', player: 'alice', object: vault, ability: 0 }));
    const c = chars(g, g.objects[vault]!);
    expect(c.types).toEqual(expect.arrayContaining(['Land', 'Creature']));
    expect(c.subtypes).toEqual(expect.arrayContaining(['Goblin', 'Elf', 'Shapeshifter']));
    expect([c.power, c.toughness]).toEqual([2, 2]);
  });

  it('Sudden Spoiling: creatures target player controls', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [theirs, mine] = [give(g, 'bob', 'Ogre', 'battlefield'), give(g, 'alice', 'Ogre', 'battlefield')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Sudden Spoiling', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect([chars(g, g.objects[theirs]!).power, chars(g, g.objects[theirs]!).toughness]).toEqual([0, 2]);
    expect(chars(g, g.objects[mine]!).power).toBe(5);
  });

  it("Oko's +1: an artifact becomes a green Elk creature and stops being an artifact", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const oko = give(g, 'alice', 'Oko Lite', 'battlefield');
    g.objects[oko]!.counters.loyalty = 4;
    const relic = give(g, 'bob', 'Trinket', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: oko, ability: 0, targets: [[{ kind: 'object', object: relic }]] }));
    const c = chars(g, g.objects[relic]!);
    expect([c.types, c.subtypes, c.colors, c.power, c.toughness]).toEqual([['Creature'], ['Elk'], ['G'], 3, 3]);
  });

  it('"until your next end step": gone at this turn\'s end step when made before it', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lib = g.zones.library.alice!;
    const top = give(g, 'alice', 'Salve', 'library');
    lib.splice(lib.indexOf(top), 1);
    lib.unshift(top);
    const w = give(g, 'alice', 'Wiccan Lite', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: w, ability: 0 }));
    expect(g.objects[top]!.zone).toBe('exile');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === top)).toBe(true);
    g = toStep(g, 'end', 'alice');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === top)).toBe(false);
  });

  it('Patrolling Peacemaker: an opponent committing a crime', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Peacemaker Lite', 'battlefield');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] }));
    expect(g.players.alice!.life).toBe(life - 3 + 2);
  });
});

describe('staples (slice 194): Opposition Agent', () => {
  it("the Agent's controller searches for them, and what they find is exiled for the Agent's controller to play", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'bob', 'Opposition Agent', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'library');
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Tutor Lite', 'hand') });
    g = settle(g);
    expect(g.pending).toMatchObject({ kind: 'search', player: 'bob' });
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'search', objects: [bear] } }));
    expect(g.objects[bear]!.zone).toBe('exile');
    expect(g.zones.hand.alice!.length).toBe(hand);
    // Bob may cast it on his turn, with mana of any color.
    g = toStep(g, 'main1', 'bob');
    g.players.bob!.pool.R = 2;
    g = settle(act(g, { type: 'cast', player: 'bob', object: bear }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.objects[bear]!.controller).toBe('bob');
  });
});

describe('staples (slice 194): chosen cards from your graveyard', () => {
  it("Black Sun's Twilight: X of 5 or more returns a creature card with mana value X or less", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'alice', 'Big Ogre', 'graveyard');
    g.players.alice!.pool.B = 1;
    g.players.alice!.pool.C = 5;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', "Black Sun's Twilight", 'hand'), x: 5, targets: [[]] });
    g = settle(g);
    if (g.pending?.kind === 'choose_objects') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [ogre] } }));
    expect(g.objects[ogre]!.zone).toBe('battlefield');
    expect(g.objects[ogre]!.tapped).toBe(true);
  });

  it('Masked Vandal: only by exiling a creature card from your graveyard', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const relic = give(g, 'bob', 'Trinket', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'graveyard');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Masked Vandal', 'hand') });
    for (let i = 0; i < 20 && (g.stack.length || g.pending); i++) {
      const p = g.pending;
      if (p?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: relic }]] } });
      else if (p?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
      else if (p) throw new Error(p.kind);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect([g.objects[bear]!.zone, g.objects[relic]!.zone]).toEqual(['exile', 'exile']);
  });

  it('"Put an indestructible counter on each of them": the creatures just pumped', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [bear, theirs] = [give(g, 'alice', 'Bear', 'battlefield'), give(g, 'bob', 'Bear', 'battlefield')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Knights Lite', 'hand') }));
    expect(g.objects[bear]!.counters.indestructible).toBe(1);
    expect(g.objects[theirs]!.counters.indestructible ?? 0).toBe(0);
  });

  it("Urza's Workshop: {C} for each Urza's land, with metalcraft", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const shop = give(g, 'alice', "Urza's Workshop", 'battlefield');
    give(g, 'alice', "Urza's Mine", 'battlefield');
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate_mana' && a.object === shop)).toBe(false);
    for (let i = 0; i < 3; i++) give(g, 'alice', 'Trinket', 'battlefield');
    const act1 = legalActions(g, 'alice').find((a) => a.type === 'activate_mana' && a.object === shop);
    expect(act1).toBeTruthy();
    g = act(g, act1!);
    expect(g.players.alice!.pool.C).toBe(1);
  });
});

describe('staples (slice 195)', () => {
  it('Lignify: a 0/4 Treefolk with no abilities, still a creature', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    const aura = give(g, 'alice', 'Lignify', 'battlefield');
    g.objects[aura]!.attachedTo = { id: ogre, zcc: g.objects[ogre]!.zcc };
    const c = chars(g, g.objects[ogre]!);
    expect([c.types, c.subtypes, c.power, c.toughness]).toEqual([['Creature'], ['Treefolk'], 0, 4]);
  });

  it('Spiteful Visions: each player who draws takes 1 damage', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Spiteful Visions', 'battlefield');
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Gift of Words', 'hand') }));
    expect(g.players.bob!.life).toBe(life - 2);
  });

  it('Greater Auramancy: only enchanted creatures you control', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Auramancy Lite', 'battlefield');
    const [a, b] = [give(g, 'alice', 'Bear', 'battlefield'), give(g, 'alice', 'Bear', 'battlefield')];
    const aura = give(g, 'alice', 'Plain Aura', 'battlefield');
    g.objects[aura]!.attachedTo = { id: a, zcc: g.objects[a]!.zcc };
    expect([chars(g, g.objects[a]!).keywords.some((k) => k.id === 'shroud'), chars(g, g.objects[b]!).keywords.some((k) => k.id === 'shroud')]).toEqual([true, false]);
  });
});

describe('staples (slice 195): paying X life', () => {
  it('Necrodominance: any amount of life, that many cards', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Necro Lite', 'battlefield');
    const [life, hand] = [g.players.alice!.life, g.zones.hand.alice!.length];
    g = toStep(g, 'end', 'alice');
    for (let i = 0; i < 10 && !g.pending && g.stack.length; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.pending).toMatchObject({ kind: 'pay', player: 'alice', x: { max: life } });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true, x: 3 } }));
    expect([g.players.alice!.life, g.zones.hand.alice!.length]).toEqual([life - 3, hand + 3]);
  });

  it('Mask of Griselbrand: X life where X is its power', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Mask Lite', 'battlefield');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    const [life, hand] = [g.players.alice!.life, g.zones.hand.alice!.length];
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: ogre }]] });
    for (let i = 0; i < 10 && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.pending).toMatchObject({ kind: 'pay', player: 'alice' });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true } }));
    expect([g.players.alice!.life, g.zones.hand.alice!.length]).toEqual([life - 5, hand + 5]);
  });
});

describe('staples (slice 196): what you did this turn', () => {
  it('Arclight Phoenix: three or more instant and sorcery spells this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const phoenix = give(g, 'alice', 'Arclight Phoenix', 'graveyard');
    for (let i = 0; i < 2; i++) g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Salve', 'hand') }));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Cub', 'hand') }));
    let h = structuredClone(g);
    h = settle(toStep(h, 'beginning_of_combat'));
    expect(h.objects[phoenix]!.zone).toBe('graveyard');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mill Three', 'hand') }));
    g = settle(toStep(g, 'beginning_of_combat'));
    expect(g.objects[phoenix]!.zone).toBe('battlefield');
  });

  it('Sentinel Sarah Lyons: once an artifact entered under your control this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const sarah = give(g, 'alice', 'Sarah Lite', 'battlefield');
    expect(chars(g, g.objects[sarah]!).power).toBe(2);
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Trinket', 'hand') }));
    expect(chars(g, g.objects[sarah]!).power).toBe(4);
  });
});

describe('staples (slice 196): spells cast from a graveyard', () => {
  it('Gravebreaker Lamia: {1} less from your graveyard, not from your hand', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Lamia Lite', 'battlefield');
    const inHand = give(g, 'alice', 'Grave Spell', 'hand');
    const inYard = give(g, 'alice', 'Grave Spell', 'graveyard');
    g.players.alice!.pool.C = 1;
    expect(illegal(g, { type: 'cast', player: 'alice', object: inHand })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: inYard }));
    expect(g.objects[inYard]!.zone).toBe('exile');
  });
});

describe('staples (slice 196): "that damage" and same names', () => {
  it('Covert Technician: an artifact card with mana value up to the damage dealt', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const tech = give(g, 'alice', 'Technician Lite', 'battlefield');
    const [two, three] = [give(g, 'alice', 'Two Relic', 'hand'), give(g, 'alice', 'Three Relic', 'hand')];
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: tech, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 40 && g.step !== 'main2'; i++) {
      const p = g.pending;
      if (p?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'declare_blockers', blocks: [] } });
      else if (p?.kind === 'may') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'may', yes: true } });
      else if (p?.kind === 'choose_objects') {
        expect(p.candidates.includes(two) && !p.candidates.includes(three)).toBe(true);
        g = act(g, { type: 'choose', player: p.player, answer: { kind: 'choose_objects', objects: [two] } });
      } else if (p) throw new Error(p.kind);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect([g.objects[two]!.zone, g.objects[three]!.zone]).toEqual(['battlefield', 'hand']);
  });

  it('Mechanized Production: eight artifacts with the same name', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Production Lite', 'battlefield');
    for (let i = 0; i < 7; i++) give(g, 'alice', 'Trinket', 'battlefield');
    give(g, 'alice', 'Two Relic', 'battlefield');
    let h = settle(toStep(structuredClone(g), 'upkeep', 'alice'));
    expect(h.over).toBeFalsy();
    give(g, 'alice', 'Trinket', 'battlefield');
    g = settle(toStep(g, 'upkeep', 'alice'));
    expect(g.over).toBeTruthy();
  });
});

describe('staples (slice 197): attacking a player, batches of sacrifices, counters', () => {
  const declare = (g: GameState, attacks: { attacker: string; player: string }[]) =>
    act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: attacks.map(({ attacker, player }) => ({ attacker, target: { kind: 'player', player } })) } });

  it('Horn of the Mark: only for a player attacked by two or more creatures', () => {
    for (const split of [false, true]) {
      let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
      give(g, 'alice', 'Horn Lite', 'battlefield');
      const [a, b] = [give(g, 'alice', 'Cub', 'battlefield'), give(g, 'alice', 'Cub', 'battlefield')];
      const hand = g.zones.hand.alice!.length;
      g = toAttack(toStep(g, 'beginning_of_combat'));
      g = settle(declare(g, [{ attacker: a, player: 'bob' }, { attacker: b, player: split ? 'carol' : 'bob' }]));
      expect(g.zones.hand.alice!.length).toBe(hand + (split ? 0 : 1));
    }
  });

  it('Soaring Lightbringer: the token attacks the player that was attacked', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const lb = give(g, 'alice', 'Lightbringer Lite', 'battlefield');
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = settle(declare(g, [{ attacker: lb, player: 'carol' }]));
    const tokens = Object.entries(g.combat!.attackers).filter(([id]) => g.objects[id]!.token);
    expect(tokens.length).toBe(1);
    expect(tokens[0]![1].target).toEqual({ kind: 'player', player: 'carol' });
  });

  it('Camellia: one trigger for Foods sacrificed together', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Camellia Lite', 'battlefield');
    const feast = give(g, 'alice', 'Feast Lite', 'battlefield');
    const foods = [give(g, 'alice', 'Food Card', 'battlefield'), give(g, 'alice', 'Food Card', 'battlefield')];
    const before = g.zones.battlefield.filter((id) => g.objects[id]!.token).length;
    g = settle(act(g, kitActions(g, feast)[0]!));
    expect(foods.every((id) => g.objects[id]!.zone === 'graveyard')).toBe(true);
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token).length).toBe(before + 1);
  });

  it('The Endstone: a land played or a spell cast', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Endstone Lite', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Forest', 'hand') }));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Salve', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
  });

  it('Ezuri: whenever you proliferate, even choosing nothing', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Ezuri Lite', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Proliferate Lite', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('Generous Patron: counters you put on a creature you don\'t control', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Patron Lite', 'battlefield');
    const [mine, theirs] = [give(g, 'alice', 'Cub', 'battlefield'), give(g, 'bob', 'Cub', 'battlefield')];
    const hand = g.zones.hand.alice!.length;
    for (const target of [mine, theirs]) {
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Grow Lite', 'hand'), targets: [[{ kind: 'object', object: target }]] }));
    }
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('Tergrid: what an opponent sacrifices comes back under your control', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Tergrid Lite', 'battlefield');
    const cub = give(g, 'bob', 'Cub', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Edict Lite', 'hand') });
    for (let i = 0; i < 20 && (g.stack.length || g.pending); i++) {
      const p = g.pending;
      if (p?.kind === 'may') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'may', yes: true } });
      else if (p?.kind === 'choose_objects') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'choose_objects', objects: [cub] } });
      else if (p) throw new Error(p.kind);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    const back = g.zones.battlefield.find((id) => g.objects[id]!.card === g.objects[cub]!.card && g.objects[id]!.controller === 'alice' && !g.objects[id]!.token);
    expect(back).toBeTruthy();
  });

  it('Merfolk: the same word in the plural', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Merfolk Lord', 'battlefield');
    const grunt = give(g, 'alice', 'Merfolk Grunt', 'battlefield');
    expect(chars(g, g.objects[grunt]!).power).toBe(2);
  });
});

describe('staples (slice 197): granted prevention, borrowed artifacts, extra combats', () => {
  it('Caduceus: the equipped creature has "Prevent all damage that would be dealt to this creature."', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const staff = give(g, 'alice', 'Caduceus Lite', 'battlefield');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    g.objects[staff]!.attachedTo = { id: ogre, zcc: g.objects[ogre]!.zcc };
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: ogre }]] }));
    expect(g.objects[ogre]!.damage).toBe(0);
  });

  it('Treasure Nabber: an artifact an opponent taps for mana, until the end of your next turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Nabber Lite', 'battlefield');
    const stone = give(g, 'bob', 'Mind Stone Lite', 'battlefield');
    g = settle(act(g, { type: 'activate_mana', player: 'bob', object: stone, ability: 0 }));
    expect(g.objects[stone]!.controller).toBe('alice');
    g = toStep(g, 'main1', 'alice');
    expect(g.objects[stone]!.controller).toBe('alice');
    g = toStep(g, 'upkeep', 'bob');
    expect(g.objects[stone]!.controller).toBe('bob');
  });

  it('Full Throttle: two more combats, each untapping what attacked', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Throttle Lite', 'hand') }));
    let combats = 0;
    for (let i = 0; i < 200 && g.step !== 'main2'; i++) {
      const p = g.pending;
      if (p?.kind === 'declare_attackers') {
        combats++;
        expect(g.objects[cub]!.tapped).toBe(false);
        g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: cub, target: { kind: 'player', player: 'bob' } }] } });
      } else if (p?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'declare_blockers', blocks: [] } });
      else if (p) throw new Error(p.kind);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(combats).toBe(3);
  });

  it('Palantír of Orthanc: declined, you mill and they lose life equal to the total mana value', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const palantir = give(g, 'alice', 'Palantir Lite', 'battlefield');
    g.objects[palantir]!.counters.influence = 1;
    const top = [give(g, 'alice', 'Ogre Three', 'library'), give(g, 'alice', 'Ogre Spell', 'library')];
    const lib = g.zones.library.alice!;
    lib.splice(lib.indexOf(top[0]!), 1);
    lib.splice(lib.indexOf(top[1]!), 1);
    lib.unshift(...top);
    const life = g.players.bob!.life;
    g = toStep(g, 'end', 'alice');
    for (let i = 0; i < 40 && (g.stack.length || g.pending); i++) {
      const p = g.pending;
      if (p?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } });
      else if (p?.kind === 'scry') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'scry', top: p.objects, bottom: [] } });
      else if (p?.kind === 'may') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'may', yes: false } });
      else if (p) throw new Error(p.kind);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    // Two influence counters: both cards milled (3 + 3).
    expect(top.every((id) => g.objects[id]!.zone === 'graveyard')).toBe(true);
    expect(g.players.bob!.life).toBe(life - 6);
  });
});

describe('staples (slice 198)', () => {
  it('Containment Construct: a discarded card exiled may be played this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Containment Lite', 'battlefield');
    const [a, b] = [give(g, 'alice', 'Salve', 'hand'), give(g, 'alice', 'Salve', 'hand')];
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Looting', 'hand') });
    for (let i = 0; i < 30 && (g.stack.length || g.pending); i++) {
      const p = g.pending;
      if (p?.kind === 'discard') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: [a, b] } });
      else if (p?.kind === 'may') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'may', yes: true } });
      else if (p) throw new Error(p.kind);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.objects[a]!.zone).toBe('exile');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: a }));
    expect(g.players.alice!.life).toBe(life + 3);
  });

  it("Taunt from the Rampart: goaded, and they can't block until your next turn", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cub = give(g, 'bob', 'Cub', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Taunt Lite', 'hand') }));
    expect(chars(g, g.objects[cub]!).rules.has('cant_block')).toBe(true);
    g = toStep(g, 'main1', 'bob');
    expect(chars(g, g.objects[cub]!).rules.has('cant_block')).toBe(true);
    g.objects[cub]!.tapped = true;
    g = toStep(g, 'main1', 'alice');
    expect(chars(g, g.objects[cub]!).rules.has('cant_block')).toBe(false);
  });

  it('Maha: base toughness 1, power unchanged', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Maha Lite', 'battlefield');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    expect([chars(g, g.objects[ogre]!).power, chars(g, g.objects[ogre]!).toughness]).toEqual([5, 1]);
  });

  it('Jarad: a Swamp and a Forest, two different lands', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const jarad = give(g, 'alice', 'Jarad Lite', 'graveyard');
    const swamp = give(g, 'alice', 'Swamp', 'battlefield');
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === jarad)).toBe(false);
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    expect(illegal(g, { type: 'activate', player: 'alice', object: jarad, ability: 0, costs: { sacrifice: [swamp, swamp] } } as never)).toBeTruthy();
    g = settle(act(g, { type: 'activate', player: 'alice', object: jarad, ability: 0, costs: { sacrifice: [swamp, forest] } } as never));
    expect(g.objects[jarad]!.zone).toBe('hand');
  });

  it('Gix: the attacking player may pay 1 life to draw', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Gix Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    const [life, hand] = [g.players.alice!.life, g.zones.hand.alice!.length];
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: cub, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 40 && g.step !== 'main2'; i++) {
      const p = g.pending;
      if (p?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'declare_blockers', blocks: [] } });
      else if (p?.kind === 'pay') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'pay', pay: true } });
      else if (p) throw new Error(p.kind);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect([g.players.alice!.life, g.zones.hand.alice!.length]).toEqual([life - 1, hand + 1]);
  });

  it('Ilysian Caryatid: two mana of one color with a big creature', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const plant = give(g, 'alice', 'Caryatid Lite', 'battlefield');
    let h = act(structuredClone(g), { type: 'activate_mana', player: 'alice', object: plant, ability: 0, choice: 'U' });
    expect(h.players.alice!.pool.U).toBe(1);
    give(g, 'alice', 'Ogre', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: plant, ability: 0, choice: 'U' });
    expect(g.players.alice!.pool.U).toBe(2);
  });

  it("Chainer: haste for a creature you didn't cast from your hand", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Chainer Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'graveyard');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Reanimate Lite', 'hand'), targets: [[{ kind: 'object', object: cub }]] }));
    expect(chars(g, g.objects[cub]!).keywords.some((k) => k.id === 'haste')).toBe(true);
    const bear = give(g, 'alice', 'Cub', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear }));
    expect(chars(g, g.objects[bear]!).keywords.some((k) => k.id === 'haste')).toBe(false);
  });
});

describe('staples (slice 199)', () => {
  it('Winds of Change: hands shuffled away, the same number drawn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (let i = 0; i < 3; i++) give(g, 'bob', 'Salve', 'hand');
    const [a, b] = [g.zones.hand.alice!.length, g.zones.hand.bob!.length];
    const old = [...g.zones.hand.bob!];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Winds Lite', 'hand') }));
    expect([g.zones.hand.alice!.length, g.zones.hand.bob!.length]).toEqual([a, b]);
    expect(old.some((id) => g.objects[id]!.zone === 'library')).toBe(true);
  });

  it('Manabarbs: 1 damage to whoever taps a land for mana', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Manabarbs Lite', 'battlefield');
    const forest = give(g, 'bob', 'Forest', 'battlefield');
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'activate_mana', player: 'bob', object: forest, ability: 0 }));
    expect(g.players.bob!.life).toBe(life - 1);
  });

  it("Vraska's Fall: a sacrifice and a poison counter for each opponent", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cub = give(g, 'bob', 'Cub', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Vraska Fall Lite', 'hand') }));
    expect([g.objects[cub]!.zone, g.players.bob!.poison]).toEqual(['graveyard', 1]);
  });

  it('Debt to the Deathless: two times X, and you gain what they lost', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    g.players.alice!.pool.C = 2;
    const [a, b, c] = [g.players.alice!.life, g.players.bob!.life, g.players.carol!.life];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Debt Lite', 'hand'), x: 2 } as never));
    expect([g.players.alice!.life, g.players.bob!.life, g.players.carol!.life]).toEqual([a + 8, b - 4, c - 4]);
  });

  it('Conduit of Ruin: only the first creature spell each turn is cheaper', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Conduit Lite', 'battlefield');
    const [one, two] = [give(g, 'alice', 'Bear', 'hand'), give(g, 'alice', 'Bear', 'hand')];
    g.players.alice!.pool.G = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: one }));
    expect(g.objects[one]!.zone).toBe('battlefield');
    g.players.alice!.pool.G = 1;
    expect(illegal(g, { type: 'cast', player: 'alice', object: two })).toBeTruthy();
  });

  it("Sandwurm Convergence: fliers can't attack you", () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    give(g, 'bob', 'Sandwurm Lite', 'battlefield');
    const bird = give(g, 'alice', 'Bird Lite', 'battlefield');
    g = toAttack(toStep(g, 'beginning_of_combat'));
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: bird, target: { kind: 'player', player: 'bob' } }] } })).toBeTruthy();
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: bird, target: { kind: 'player', player: 'carol' } }] } });
    expect(g.combat?.attackers[bird]).toBeTruthy();
  });

  it('Assault Formation: a creature with defender can attack this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const f = give(g, 'alice', 'Formation Lite', 'battlefield');
    const wall = give(g, 'alice', 'Wall Lite', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: f, ability: 0, targets: [[{ kind: 'object', object: wall }]] } as never));
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: wall, target: { kind: 'player', player: 'bob' } }] } });
    expect(g.combat?.attackers[wall]).toBeTruthy();
  });

  it('Zul Ashur: a target Zombie card in your graveyard may be cast this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const zul = give(g, 'alice', 'Zul Lite', 'battlefield');
    const zombie = give(g, 'alice', 'Zombie', 'graveyard');
    g = settle(act(g, { type: 'activate', player: 'alice', object: zul, ability: 0, targets: [[{ kind: 'object', object: zombie }]] } as never));
    g = settle(act(g, { type: 'cast', player: 'alice', object: zombie }));
    expect(g.objects[zombie]!.zone).toBe('battlefield');
  });
});

describe('staples (slice 199): attacks and life loss once a turn', () => {
  it("Port Razer: in the extra combat it can't attack the same player again", () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const razer = give(g, 'alice', 'Razer Lite', 'battlefield');
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: razer, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 60 && g.pending?.kind !== 'declare_attackers'; i++) {
      const p = g.pending;
      if (p?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'declare_blockers', blocks: [] } });
      else if (p) throw new Error(p.kind);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.pending?.kind).toBe('declare_attackers');
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: razer, target: { kind: 'player', player: 'bob' } }] } })).toBeTruthy();
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: razer, target: { kind: 'player', player: 'carol' } }] } });
    expect(g.combat?.attackers[razer]).toBeTruthy();
  });

  it('Valgavoth: only the first life an opponent loses during their own turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Valgavoth Lite', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Drain One', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(hand);
    g = toStep(g, 'main1', 'bob');
    const h2 = g.zones.hand.alice!.length;
    for (let i = 0; i < 2; i++) {
      g = act(g, { type: 'pass', player: 'bob' });
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Drain One', 'hand') });
      g = settle(g);
    }
    expect(g.zones.hand.alice!.length).toBe(h2 + 1);
  });
});

describe('staples (slice 199): once during each of your turns, from your graveyard', () => {
  it('Lurrus: one permanent spell with mana value 2 or less each of your turns', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Lurrus Lite', 'battlefield');
    const [a, b] = [give(g, 'alice', 'Bear', 'graveyard'), give(g, 'alice', 'Bear', 'graveyard')];
    const big = give(g, 'alice', 'Ogre Three', 'graveyard');
    g.players.alice!.pool.G = 4;
    g.players.alice!.pool.R = 3;
    expect(illegal(g, { type: 'cast', player: 'alice', object: big })).toBeTruthy();
    expect(legalActions(g, 'alice').some((x) => x.type === 'cast' && x.object === a)).toBe(true);
    g = settle(act(g, { type: 'cast', player: 'alice', object: a }));
    expect(g.objects[a]!.zone).toBe('battlefield');
    expect(illegal(g, { type: 'cast', player: 'alice', object: b })).toBeTruthy();
    g = toStep(g, 'main1', 'bob');
    expect(legalActions(g, 'alice').some((x) => x.type === 'cast' && x.object === b)).toBe(false);
    g = toStep(g, 'main1', 'alice');
    g.players.alice!.pool.G = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: b }));
    expect(g.objects[b]!.zone).toBe('battlefield');
  });
});

describe('staples (slice 199): where a countered spell goes', () => {
  for (const [name, zone] of [['Lapse Lite', 'library'], ['Remand Lite', 'hand']] as const) {
    it(`${name}: the countered spell goes to its owner's ${zone}`, () => {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const salve = give(g, 'alice', 'Salve', 'hand');
      g = act(g, { type: 'cast', player: 'alice', object: salve });
      g = act(g, { type: 'pass', player: 'alice' });
      g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', name, 'hand'), targets: [[{ kind: 'object', object: salve }]] }));
      expect(g.objects[salve]!.zone).toBe(zone);
      if (zone === 'library') expect(g.zones.library.alice![0]).toBe(salve);
    });
  }
});

describe('staples (slice 199): backgrounds', () => {
  for (const [defender, made] of [['bob', 2], ['carol', 0]] as const) {
    it(`Guild Artisan: attacking ${defender}`, () => {
      let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
      give(g, 'alice', 'Artisan Lite', 'battlefield');
      const cmdr = give(g, 'alice', 'Cub', 'battlefield');
      g.objects[cmdr]!.commander = true;
      g.players.carol!.life = 15;
      const before = g.zones.battlefield.filter((id) => g.objects[id]!.token).length;
      g = toAttack(toStep(g, 'beginning_of_combat'));
      g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: cmdr, target: { kind: 'player', player: defender } }] } }));
      expect(g.zones.battlefield.filter((id) => g.objects[id]!.token).length).toBe(before + made);
    });
  }
});

describe('staples (slice 199): what a spell gained, the permanent keeps (CR 400.7a)', () => {
  it('Rivaz of the Claw: a Dragon cast from the graveyard is exiled when it dies', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Rivaz Lite', 'battlefield');
    const whelp = give(g, 'alice', 'Whelp', 'graveyard');
    g = settle(act(g, { type: 'cast', player: 'alice', object: whelp }));
    expect(g.objects[whelp]!.zone).toBe('battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: whelp }]] }));
    expect(g.objects[whelp]!.zone).toBe('exile');
  });
});

describe('staples (slice 200)', () => {
  it("Kozilek's Unsealing: mana value 4, 5, or 6", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Unsealing Lite', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g.players.alice!.pool.C = 4;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Four Drop', 'hand') }));
    g.players.alice!.pool.G = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bear', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('Farmer Cotton: X of each kind of token', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Cotton Lite', 'hand'), x: 2 } as never));
    const tokens = g.zones.battlefield.filter((id) => g.objects[id]!.token).map((id) => chars(g, g.objects[id]!).subtypes.join());
    expect(tokens.sort()).toEqual(['Food', 'Food', 'Halfling', 'Halfling']);
  });

  it("Ramos: a counter for each of the spell's colors", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ramos = give(g, 'alice', 'Ramos Lite', 'battlefield');
    g.players.alice!.pool.W = 1;
    g.players.alice!.pool.U = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Gold Spell', 'hand') }));
    expect(g.objects[ramos]!.counters['+1/+1']).toBe(2);
  });

  it('The Endstone and "life total becomes": gaining or losing the difference (CR 119.5)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Endstone Life', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Set Twenty', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.players.bob!.life).toBe(20);
    g = settle(toStep(g, 'end', 'alice'));
    expect(g.players.alice!.life).toBe(Math.ceil(g.config.startingLife / 2));
  });
});

describe('staples (slice 200): what died, as it last existed', () => {
  it("Rampant Rejuvenator: X is this creature's power as it died", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const r = give(g, 'alice', 'Rejuvenator Lite', 'battlefield');
    const lands = g.zones.battlefield.filter((id) => chars(g, g.objects[id]!).types.includes('Land')).length;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: r }]] });
    for (let i = 0; i < 30 && (g.stack.length || g.pending); i++) {
      const p = g.pending;
      if (p?.kind === 'search') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'search', objects: p.candidates.slice(0, p.count) } });
      else if (p) throw new Error(p.kind + JSON.stringify(p).slice(0, 200));
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.zones.battlefield.filter((id) => chars(g, g.objects[id]!).types.includes('Land')).length).toBe(lands + 2);
  });

  it('Lifeblood Hydra: gain life and draw cards equal to its power', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const h = give(g, 'alice', 'Hydra Lite', 'battlefield');
    const [life, hand] = [g.players.alice!.life, g.zones.hand.alice!.length];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: h }]] }));
    expect([g.players.alice!.life, g.zones.hand.alice!.length]).toEqual([life + 3, hand + 3]);
  });
});

describe('staples (slice 200): combat and token counts', () => {
  it('Raid Bombardment: damage to the player that creature is attacking', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    give(g, 'alice', 'Raid Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    const life = g.players.carol!.life;
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: cub, target: { kind: 'player', player: 'carol' } }] } }));
    expect(g.players.carol!.life).toBe(life - 1);
  });

  it('Contaminant Grafter: once for damage to one or more players', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    give(g, 'alice', 'Grafter Lite', 'battlefield');
    const [a, b] = [give(g, 'alice', 'Cub', 'battlefield'), give(g, 'alice', 'Cub', 'battlefield')];
    const hand = g.zones.hand.alice!.length;
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: a, target: { kind: 'player', player: 'bob' } }, { attacker: b, target: { kind: 'player', player: 'carol' } }] } });
    for (let i = 0; i < 40 && g.step !== 'main2'; i++) {
      const p = g.pending;
      if (p?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'declare_blockers', blocks: [] } });
      else if (p) throw new Error(p.kind);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('Triplicate Titan: three different tokens', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const t = give(g, 'alice', 'Titan Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: t }]] }));
    const kws = g.zones.battlefield.filter((id) => g.objects[id]!.token).map((id) => chars(g, g.objects[id]!).keywords.map((k) => k.id).join()).sort();
    expect(kws).toEqual(['flying', 'lifelink', 'vigilance']);
  });

  it('Venerated Rotpriest: a creature you control targeted by a spell', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Rotpriest Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Grow Lite', 'hand'), targets: [[{ kind: 'object', object: cub }]] });
    for (let i = 0; i < 20 && (g.stack.length || g.pending); i++) {
      const p = g.pending;
      if (p?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } });
      else if (p) throw new Error(p.kind);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.players.bob!.poison).toBe(1);
  });

  it('Thalisse: as many Spirits as tokens you created this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Thalisse Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Make Two', 'hand') }));
    g = settle(toStep(g, 'end', 'alice'));
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token).length).toBe(4);
  });
});

describe('staples (slice 200): redirecting a spell', () => {
  it('Hydroelectric Specimen: the spell now targets this creature', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    const bolt = give(g, 'bob', 'Bolt', 'hand');
    g = act(g, { type: 'cast', player: 'bob', object: bolt, targets: [[{ kind: 'object', object: ogre }]] });
    g = act(g, { type: 'pass', player: 'bob' });
    const spec = give(g, 'alice', 'Specimen Lite', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: spec });
    for (let i = 0; i < 30 && (g.stack.length || g.pending); i++) {
      const p = g.pending;
      if (p?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: bolt }]] } });
      else if (p?.kind === 'may') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'may', yes: true } });
      else if (p) throw new Error(p.kind);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect([g.objects[ogre]!.damage, g.objects[spec]!.damage]).toEqual([0, 3]);
  });
});

describe('staples (slice 200): targets counted from the event', () => {
  it('Scrap Trawler: an artifact card with lesser mana value than the one that went to the graveyard', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Trawler Lite', 'battlefield');
    const rock = give(g, 'alice', 'Two Rock', 'battlefield');
    const [one, zero, three] = [give(g, 'alice', 'Trinket', 'graveyard'), give(g, 'alice', 'Food Card', 'graveyard'), give(g, 'alice', 'Three Relic', 'graveyard')];
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Shatter Lite', 'hand'), targets: [[{ kind: 'object', object: rock }]] });
    let offered: string[] = [];
    for (let i = 0; i < 30 && (g.stack.length || g.pending); i++) {
      const p = g.pending;
      if (p?.kind === 'trigger_targets') {
        offered = p.prompts[0]!.candidates.map((c) => (c.kind === 'object' ? c.object : ''));
        g = act(g, { type: 'choose', player: p.player, answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: one }]] } });
      } else if (p) throw new Error(p.kind);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(offered.includes(one) && offered.includes(zero) && !offered.includes(rock) && !offered.includes(three)).toBe(true);
    expect(g.objects[one]!.zone).toBe('hand');
  });
});

describe('staples (slice 200): Etali, Primal Conqueror', () => {
  it('each player exiles until a nonland card; you cast them free', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const top = (p: string, name: string) => {
      const id = give(g, p, name, 'library');
      const lib = g.zones.library[p]!;
      lib.splice(lib.indexOf(id), 1);
      lib.unshift(id);
      return id;
    };
    const salve = top('alice', 'Salve');
    top('alice', 'Forest');
    const draw = top('bob', 'Draw Three');
    const [life, hand] = [g.players.alice!.life, g.zones.hand.alice!.length];
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Etali Lite', 'hand') });
    for (let i = 0; i < 40 && (g.stack.length || g.pending); i++) {
      const p = g.pending;
      if (p?.kind === 'choose_objects') {
        expect([...p.candidates].sort()).toEqual([salve, draw].sort());
        g = act(g, { type: 'choose', player: p.player, answer: { kind: 'choose_objects', objects: [salve, draw] } });
      } else if (p?.kind === 'cast_free') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'cast_free', cast: true } } as never);
      else if (p) throw new Error(p.kind);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect([g.players.alice!.life, g.zones.hand.alice!.length]).toEqual([life + 3, hand - 1 + 1 + 3]);
  });
});

describe('staples (slice 200): Myr Battlesphere', () => {
  it('X Myr tapped: +X/+0 and X damage to the player it attacks', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const sphere = give(g, 'alice', 'Battlesphere Lite', 'battlefield');
    const myr = [give(g, 'alice', 'Myr Lite', 'battlefield'), give(g, 'alice', 'Myr Lite', 'battlefield')];
    const life = g.players.bob!.life;
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: sphere, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 40 && g.step !== 'main2'; i++) {
      const p = g.pending;
      if (p?.kind === 'choose_objects') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'choose_objects', objects: myr } });
      else if (p?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'declare_blockers', blocks: [] } });
      else if (p) throw new Error(p.kind);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(myr.every((id) => g.objects[id]!.tapped)).toBe(true);
    expect(g.players.bob!.life).toBe(life - 2 - 6);
  });
});

describe('staples (slice 201): Spellskite', () => {
  it('changes a target of a spell to itself', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    const skite = give(g, 'alice', 'Spellskite Lite', 'battlefield');
    const bolt = give(g, 'bob', 'Bolt', 'hand');
    g = act(g, { type: 'cast', player: 'bob', object: bolt, targets: [[{ kind: 'object', object: ogre }]] });
    g = act(g, { type: 'pass', player: 'bob' });
    g = settle(act(g, { type: 'activate', player: 'alice', object: skite, ability: 0, targets: [[{ kind: 'object', object: bolt }]] } as never));
    expect([g.objects[ogre]!.damage, g.objects[skite]!.damage]).toEqual([0, 3]);
  });
});

describe('staples (slice 201): Combat Celebrant', () => {
  it("exerted once this turn, it can't be exerted again in the extra combat", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cel = give(g, 'alice', 'Celebrant Lite', 'battlefield');
    g = toAttack(toStep(g, 'beginning_of_combat'));
    expect(g.pending?.kind === 'declare_attackers' && g.pending.exertable?.includes(cel)).toBe(true);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: cel, target: { kind: 'player', player: 'bob' } }], exert: [cel] } });
    let second = false;
    for (let i = 0; i < 60 && g.step !== 'main2'; i++) {
      const p = g.pending;
      if (p?.kind === 'declare_attackers') {
        second = true;
        expect(p.exertable?.includes(cel) ?? false).toBe(false);
        g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [] } });
      } else if (p?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'declare_blockers', blocks: [] } });
      else if (p) throw new Error(p.kind);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(second).toBe(true);
  });
});

describe('staples (slice 201): Scourge of the Throne', () => {
  for (const [bobLife, combats] of [[20, 2], [15, 1]] as const) {
    it(`attacking a player at ${bobLife} life: ${combats} combat(s)`, () => {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const sc = give(g, 'alice', 'Scourge Lite', 'battlefield');
      g.players.bob!.life = bobLife;
      g = toAttack(toStep(g, 'beginning_of_combat'));
      let n = 0;
      for (let i = 0; i < 80 && g.step !== 'main2'; i++) {
        const p = g.pending;
        if (p?.kind === 'declare_attackers') {
          n++;
          g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: n === 1 ? [{ attacker: sc, target: { kind: 'player', player: 'bob' } }] : [] } });
        } else if (p?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'declare_blockers', blocks: [] } });
        else if (p) throw new Error(p.kind);
        else g = act(g, { type: 'pass', player: g.priority! });
      }
      expect(n).toBe(combats);
    });
  }
});

describe('staples (slice 201): Kambal', () => {
  it('a tapped copy of each token an opponent created', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Kambal Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Make Two', 'hand') }));
    const mine = g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice');
    expect(mine.length).toBe(2);
    expect(mine.every((id) => g.objects[id]!.tapped)).toBe(true);
  });
});

describe('staples (slice 202): "if this is the second time this ability has resolved this turn"', () => {
  it('Omnath: life, then mana, then damage, as its landfall ability resolves the first, second and third time', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Omnath Lite', 'battlefield');
    const forests = [give(g, 'alice', 'Forest', 'library'), give(g, 'alice', 'Forest', 'library'), give(g, 'alice', 'Forest', 'library')];
    const life = g.players.alice!.life;
    const bob = g.players.bob!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Forest Call', 'hand') }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: forests } }));
    expect(g.stack.length).toBe(0);
    expect(g.players.alice!.life).toBe(life + 4);
    expect([g.players.alice!.pool.R, g.players.alice!.pool.G, g.players.alice!.pool.W, g.players.alice!.pool.U]).toEqual([1, 1, 1, 1]);
    expect(g.players.bob!.life).toBe(bob - 4);
  });

  it('Rumor Gatherer: scry 1 the first time, draw a card instead the second time', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Rumor Gatherer Lite', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Make Two', 'hand') });
    let scries = 0;
    for (let i = 0; i < 40 && (g.stack.length || g.pending); i++) {
      const p = g.pending;
      if (p?.kind === 'scry') {
        scries++;
        g = act(g, { type: 'choose', player: p.player, answer: { kind: 'scry', top: p.objects, bottom: [] } });
      } else if (p) throw new Error(p.kind);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(scries).toBe(1);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('Soulbright: an activated ability counts its own resolutions; the count starts over each turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const sb = give(g, 'alice', 'Soulbright Lite', 'battlefield');
    const once = (g: GameState) => settle(act(g, { type: 'activate', player: 'alice', object: sb, ability: 0, targets: [[{ kind: 'object', object: sb }]] }));
    g = once(once(g));
    expect(g.players.alice!.pool.R ?? 0).toBe(0);
    g = once(g);
    expect(g.players.alice!.pool.R).toBe(4);
    g = once(g);
    expect(g.players.alice!.pool.R).toBe(4);
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    g = once(once(once(g)));
    expect(g.players.alice!.pool.R).toBe(4);
  });

  it('Nissa: the second time, reveal until an Elf or Elemental card and put it into your hand', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Nissa Lite', 'battlefield');
    const forests = [give(g, 'alice', 'Forest', 'library'), give(g, 'alice', 'Forest', 'library')];
    const elf = give(g, 'alice', 'Rumor Gatherer Lite', 'library');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Forest Call', 'hand') }));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: forests } });
    // The search shuffled; the Elf goes on top now, before the landfall abilities resolve.
    g.zones.library.alice = [elf, ...g.zones.library.alice!.filter((id) => id !== elf)];
    for (let i = 0; i < 40 && (g.stack.length || g.pending); i++) {
      const p = g.pending;
      if (p?.kind === 'choose_option') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'choose_option', choice: p.options[0]! } });
      else if (p) throw new Error(p.kind);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.objects[elf]!.zone).toBe('hand');
  });
});

describe('staples (slice 202): returning the permanent to its owner\'s hand as a cost', () => {
  it('Grinning Ignus: a mana ability activated only as a sorcery', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ignus = give(g, 'alice', 'Ignus Lite', 'battlefield');
    g.players.alice!.pool.R = 1;
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate_mana' && a.object === ignus)).toBe(true);
    g = act(g, { type: 'activate_mana', player: 'alice', object: ignus, ability: 0 });
    expect(g.objects[ignus]!.zone).toBe('hand');
    expect([g.players.alice!.pool.C, g.players.alice!.pool.R]).toEqual([2, 1]);
    // Not with a spell on the stack.
    const again = give(g, 'alice', 'Ignus Lite', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Salve', 'hand') });
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate_mana' && a.object === again)).toBe(false);
    expect(illegal(g, { type: 'activate_mana', player: 'alice', object: again, ability: 0 })).toMatch(/as a sorcery/);
  });

  it('a sorcery-speed mana ability is never tapped for while casting (CR 602.5d)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const elf = give(g, 'alice', 'Sorcery Elf', 'battlefield');
    g.objects[elf]!.sick = false;
    const bear = give(g, 'alice', 'Bear', 'hand');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === bear)).toBe(false);
    expect(illegal(g, { type: 'cast', player: 'alice', object: bear, autoTap: true })).toBeTruthy();
    g = act(g, { type: 'activate_mana', player: 'alice', object: elf, ability: 0 });
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
  });

  it('Shigeki: returned to hand, then a land from the top four onto the battlefield tapped', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const sh = give(g, 'alice', 'Shigeki Lite', 'battlefield');
    const forest = give(g, 'alice', 'Forest', 'library');
    g.zones.library.alice = [forest, ...g.zones.library.alice!.filter((id) => id !== forest)];
    const top = g.zones.library.alice!.slice(0, 4);
    g = act(g, { type: 'activate', player: 'alice', object: sh, ability: 0 });
    expect(g.objects[sh]!.zone).toBe('hand');
    g = settle(g);
    for (let i = 0; i < 5 && g.pending; i++) {
      const p = g.pending as { kind: string; player: string; candidates?: string[] };
      g = settle(act(g, { type: 'choose', player: p.player, answer: { kind: p.kind, objects: [forest] } as never }));
    }
    expect(g.objects[forest]!.zone).toBe('battlefield');
    expect(g.objects[forest]!.tapped).toBe(true);
    expect(top.filter((id) => id !== forest).every((id) => g.objects[id]!.zone === 'graveyard')).toBe(true);
  });
});

describe('staples (slice 202): "with mana value equal to 1 plus the sacrificed creature\'s mana value"', () => {
  it('Birthing Pod: only a creature card with mana value one more', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const pod = give(g, 'alice', 'Pod Lite', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const ogre = give(g, 'alice', 'Ogre Three', 'library');
    const other = give(g, 'alice', 'Bear', 'library');
    g = settle(act(g, { type: 'activate', player: 'alice', object: pod, ability: 0, costs: { sacrifice: [bear] } }));
    const p = g.pending as { kind: string; candidates: string[] };
    expect(p.kind).toBe('search');
    expect(p.candidates).toContain(ogre);
    expect(p.candidates).not.toContain(other);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [ogre] } }));
    expect(g.objects[ogre]!.zone).toBe('battlefield');
  });

  it('Vivien on the Hunt: the creature sacrificed as the ability resolves', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const viv = give(g, 'alice', 'Vivien Hunt Lite', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const ogre = give(g, 'alice', 'Ogre Three', 'library');
    const other = give(g, 'alice', 'Bear', 'library');
    g = settle(act(g, { type: 'activate', player: 'alice', object: viv, ability: 0 }));
    for (let i = 0; i < 6 && g.pending && g.pending.kind !== 'search'; i++) {
      const p = g.pending as { kind: string; player: string };
      if (p.kind === 'may') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'may', yes: true } as never });
      else if (p.kind === 'choose_objects' || p.kind === 'sacrifice') g = act(g, { type: 'choose', player: p.player, answer: { kind: p.kind, objects: [bear] } as never });
      else throw new Error(p.kind);
    }
    const p = g.pending as { kind: string; candidates: string[] };
    expect(p.kind).toBe('search');
    expect(p.candidates).toContain(ogre);
    expect(p.candidates).not.toContain(other);
  });

  it('Neoform: it enters with an additional +1/+1 counter', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const ogre = give(g, 'alice', 'Ogre Three', 'library');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Neoform Lite', 'hand'), costs: { sacrifice: [bear] } }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [ogre] } }));
    expect(g.objects[ogre]!.zone).toBe('battlefield');
    expect(g.objects[ogre]!.counters['+1/+1']).toBe(1);
  });
});

describe('staples (slice 202): "Activate only as a sorcery and only if an opponent has eight or more cards in their graveyard"', () => {
  it('Sheoldred: transforms once an opponent has eight cards in their graveyard', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const pr = give(g, 'alice', 'Praetor Lite // Scriptures Lite', 'battlefield');
    for (let i = 0; i < 7; i++) give(g, 'bob', 'Forest', 'graveyard');
    expect(kitActions(g, pr).length).toBe(0);
    give(g, 'bob', 'Forest', 'graveyard');
    expect(kitActions(g, pr).length).toBe(1);
    g = settle(act(g, { type: 'activate', player: 'alice', object: pr, ability: 0 }));
    const back = g.zones.battlefield.find((id) => g.objects[id]!.card === g.objects[pr]!.card)!;
    expect(back).toBeDefined();
    expect(g.objects[back]!.face).toBe(1);
  });
});

describe('staples (slice 202): "If another Desert was returned this way"', () => {
  for (const [what, surveils] of [['another Desert', true], ['itself', false], ['a Forest', false]] as const) {
    it(`Arid Archway returning ${what}: ${surveils ? 'surveil 1' : 'no surveil'}`, () => {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const desert = give(g, 'alice', 'Desert Lite', 'battlefield');
      const forest = give(g, 'alice', 'Forest', 'battlefield');
      const arch = give(g, 'alice', 'Archway Lite', 'hand');
      g = settle(act(g, { type: 'play_land', player: 'alice', object: arch }));
      expect(g.pending?.kind).toBe('choose_objects');
      const pick = what === 'itself' ? arch : what === 'a Forest' ? forest : desert;
      g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [pick] } }));
      expect(g.objects[pick]!.zone).toBe('hand');
      expect(g.pending?.kind === 'surveil').toBe(surveils);
    });
  }
});

describe('staples (slice 202): Firemane Commando', () => {
  for (const [label, atAlice, draws] of [['attacking only others', false, true], ['one of them attacking you', true, false]] as const) {
    it(`another player attacks with two creatures, ${label}: ${draws ? 'they draw' : 'no card'}`, () => {
      let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'bob');
      give(g, 'alice', 'Commando Lite', 'battlefield');
      const [x, y] = [give(g, 'bob', 'Bear', 'battlefield'), give(g, 'bob', 'Bear', 'battlefield')];
      for (const id of [x, y]) g.objects[id]!.sick = false;
      g = toAttack(toStep(g, 'beginning_of_combat'));
      const hand = g.zones.hand.bob!.length;
      g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: x, target: { kind: 'player', player: 'carol' } }, { attacker: y, target: { kind: 'player', player: atAlice ? 'alice' : 'carol' } }] } });
      g = settle(g);
      expect(g.zones.hand.bob!.length).toBe(hand + (draws ? 1 : 0));
    });
  }
});

describe("staples (slice 202): Avatar's Wrath", () => {
  it('spares the chosen creature; opponents cast only from their hands until your next turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const kept = give(g, 'bob', 'Bear', 'battlefield');
    const gone = give(g, 'bob', 'Bear', 'battlefield');
    const mine = give(g, 'alice', 'Ogre', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Wrath Lite', 'hand'), targets: [[{ kind: 'object', object: kept }]] }));
    expect(g.objects[kept]!.zone).toBe('battlefield');
    expect([g.objects[gone]!.zone, g.objects[mine]!.zone]).toEqual(['exile', 'exile']);
    g.players.alice!.pool.C = 2;
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === mine)).toBe(true);
    g.players.alice!.pool.C = 0;
    g = toStep(g, 'main1', 'bob');
    g.players.bob!.pool.C = 2;
    expect(legalActions(g, 'bob').some((a) => a.type === 'cast' && a.object === gone)).toBe(false);
    expect(illegal(g, { type: 'cast', player: 'bob', object: gone })).toMatch(/can't/);
    const salve = give(g, 'bob', 'Salve', 'hand');
    expect(legalActions(g, 'bob').some((a) => a.type === 'cast' && a.object === salve)).toBe(true);
  });
});

describe('staples (slice 202): cost reductions', () => {
  it('Fighter Class: equip abilities cost {2} less, other abilities don\'t', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Fighter Lite', 'battlefield');
    const sword = give(g, 'alice', 'Heavy Sword', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g.players.alice!.pool.C = 1;
    expect(illegal(g, { type: 'activate', player: 'alice', object: sword, ability: 0 })).toBeTruthy();
    g = settle(act(g, { type: 'activate', player: 'alice', object: sword, ability: 1, targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[sword]!.attachedTo?.id).toBe(bear);
    expect(g.players.alice!.pool.C ?? 0).toBe(0);
  });

  it('Temur Battlecrier: {1} less for each creature with power 4 or greater, during your turn only', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Battlecrier Lite', 'battlefield');
    give(g, 'alice', 'Ogre', 'battlefield');
    g.players.alice!.pool.R = 1;
    const ogre = give(g, 'alice', 'Ogre Three', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: ogre }));
    expect(g.objects[ogre]!.zone).toBe('battlefield');
    // On another player's turn: full price.
    g = toStep(g, 'upkeep', 'bob');
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.priority).toBe('alice');
    g.players.alice!.pool.C = 1;
    const salve = give(g, 'alice', 'Two Salve', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: salve })).toMatch(/Not enough mana/);
  });
});

describe('staples (slice 202): targets "with mana value X or less" (CR 601.2b–c)', () => {
  it('Killing Glare: X announced, then a creature with power X or less', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const small = give(g, 'bob', 'Bear', 'battlefield');
    const big = give(g, 'bob', 'Ogre', 'battlefield');
    const glare = give(g, 'alice', 'Glare Lite', 'hand');
    g.players.alice!.pool.C = 2;
    expect(illegal(g, { type: 'cast', player: 'alice', object: glare, x: 2, targets: [[{ kind: 'object', object: big }]] })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: glare, x: 2, targets: [[{ kind: 'object', object: small }]] }));
    expect(g.objects[small]!.zone).toBe('graveyard');
    expect(g.objects[big]!.zone).toBe('battlefield');
  });

  it('Entrancing Lyre: an activated ability with {X}', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lyre = give(g, 'alice', 'Lyre Lite', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g.players.alice!.pool.C = 1;
    expect(illegal(g, { type: 'activate', player: 'alice', object: lyre, ability: 0, x: 1, targets: [[{ kind: 'object', object: bear }]] })).toBeTruthy();
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'activate', player: 'alice', object: lyre, ability: 0, x: 2, targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[bear]!.tapped).toBe(true);
  });

  it('Spellstutter Sprite: X is the number of Faeries, counted as targets are chosen and again as it resolves', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Sprite Lite', 'battlefield');
    g.players.bob!.pool.C = 3;
    const spell = give(g, 'bob', 'Ogre Spell', 'hand');
    g = act(g, { type: 'cast', player: 'bob', object: spell });
    g = act(g, { type: 'pass', player: 'bob' });
    // Two Faeries once this one enters: a 3-mana spell can't be the target.
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Sprite Lite', 'hand') });
    for (let i = 0; i < 10 && g.stack.length > 1 && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.stack.some((e) => e.kind === 'ability')).toBe(false);
    give(g, 'alice', 'Sprite Lite', 'battlefield');
    g = settle(g);
    expect(g.objects[spell]!.zone).toBe('graveyard');
    expect(g.players.bob!.life).toBe(23);
  });

  it('Spellstutter Sprite: with three Faeries, it counters a 3-mana spell', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Sprite Lite', 'battlefield');
    give(g, 'alice', 'Sprite Lite', 'battlefield');
    g.players.bob!.pool.C = 3;
    const spell = give(g, 'bob', 'Ogre Spell', 'hand');
    g = act(g, { type: 'cast', player: 'bob', object: spell });
    g = act(g, { type: 'pass', player: 'bob' });
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Sprite Lite', 'hand') });
    g = settle(g);
    expect(g.objects[spell]!.zone).toBe('graveyard');
    expect(g.players.bob!.life).toBe(20);
  });
});

describe('staples (slice 202): damage counted for each player', () => {
  it('Price of Progress: twice the nonbasic lands each player controls', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Arena of Glory', 'battlefield');
    give(g, 'alice', 'Forest', 'battlefield');
    give(g, 'bob', 'Arena of Glory', 'battlefield');
    give(g, 'bob', 'Desert Lite', 'battlefield');
    const [a, b] = [g.players.alice!.life, g.players.bob!.life];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Progress Lite', 'hand') }));
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([a - 2, b - 4]);
  });
});

describe('staples (slice 202): Questing Beast and Stormtide Leviathan', () => {
  it("Questing Beast: your creatures' combat damage can't be prevented; other damage still is", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const beast = give(g, 'alice', 'Beast Lite', 'battlefield');
    give(g, 'bob', 'Chasm Lite', 'battlefield');
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.players.bob!.life).toBe(life);
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: beast, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 30 && g.step !== 'end'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } } as never);
      else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
      else break;
    }
    expect(g.players.bob!.life).toBe(life - 4);
  });

  it("Stormtide Leviathan: creatures without flying or islandwalk can't attack", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lev = give(g, 'alice', 'Stormtide Lite', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    for (const id of [lev, bear]) g.objects[id]!.sick = false;
    g = toAttack(toStep(g, 'beginning_of_combat'));
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: bear, target: { kind: 'player', player: 'bob' } }] } })).toBeTruthy();
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: lev, target: { kind: 'player', player: 'bob' } }] } });
    expect(g.combat?.attackers[lev]).toBeDefined();
  });
});

describe('staples (slice 203): counters other than +1/+1 and -1/-1 (CR 122.1a)', () => {
  it('Wall of Roots: a -0/-1 counter lowers its toughness', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const wall = give(g, 'alice', 'Roots Lite', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: wall, ability: 0 });
    expect(g.players.alice!.pool.G).toBe(1);
    expect(chars(g, g.objects[wall]!).toughness).toBe(4);
    g.objects[wall]!.counters['+2/+2'] = 1;
    expect([chars(g, g.objects[wall]!).power, chars(g, g.objects[wall]!).toughness]).toEqual([2, 6]);
  });
});

describe('staples (slice 203): Fatal Push and friends', () => {
  for (const [revolt, ogre] of [[false, 'battlefield'], [true, 'graveyard']] as const) {
    it(`Fatal Push: a 3-mana creature ${revolt ? 'is' : "isn't"} destroyed ${revolt ? 'with' : 'without'} revolt`, () => {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const three = give(g, 'bob', 'Ogre Three', 'battlefield');
      if (revolt) g.turnLog.left = ['alice'];
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Push Lite', 'hand'), targets: [[{ kind: 'object', object: three }]] }));
      expect(g.objects[three]!.zone).toBe(ogre);
    });
  }

  it('Heartless Hidetsugu: half of each player\'s own life total', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const hid = give(g, 'alice', 'Hidetsugu Lite', 'battlefield');
    g.objects[hid]!.sick = false;
    g.players.alice!.life = 21;
    g.players.bob!.life = 10;
    g = settle(act(g, { type: 'activate', player: 'alice', object: hid, ability: 0 }));
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([11, 5]);
  });

  it("Witch's Oven: two Foods for a creature with toughness 4 or greater", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const oven = give(g, 'alice', 'Oven Lite', 'battlefield');
    const big = give(g, 'alice', 'Stormtide Lite', 'battlefield');
    const foods = () => g.zones.battlefield.filter((id) => g.objects[id]!.token).length;
    g = settle(act(g, { type: 'activate', player: 'alice', object: oven, ability: 0, costs: { sacrifice: [big] } } as never));
    expect(foods()).toBe(2);
  });

  it('Den of the Bugbear: tapped with two or more other lands', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const one = give(g, 'alice', 'Den Lite', 'hand');
    g = settle(act(g, { type: 'play_land', player: 'alice', object: one }));
    expect(g.objects[one]!.tapped).toBe(false);
    give(g, 'alice', 'Forest', 'battlefield');
    give(g, 'alice', 'Forest', 'battlefield');
    g.players.alice!.landsPlayedThisTurn = 0;
    const two = give(g, 'alice', 'Den Lite', 'hand');
    g = settle(act(g, { type: 'play_land', player: 'alice', object: two }));
    expect(g.objects[two]!.tapped).toBe(true);
  });

  it('Time Stretch: two extra turns', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Stretch Lite', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] }));
    expect(g.extraTurns).toEqual(['alice', 'alice']);
  });

  it('Summer Bloom: three more land plays this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bloom Lite', 'hand') }));
    for (let i = 0; i < 4; i++) g = settle(act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Forest', 'hand') }));
    expect(illegal(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Forest', 'hand') })).toBeTruthy();
  });
});

describe('staples (slice 203): removing counters from permanents you control as a cost', () => {
  it("O'aka: any counter from a nonland permanent you control", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const m = give(g, 'alice', 'Merchant Lite', 'battlefield');
    g.objects[m]!.sick = false;
    expect(kitActions(g, m).length).toBe(0);
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g.objects[bear]!.counters.oil = 2;
    const hand = g.zones.hand.alice!.length;
    const [a] = kitActions(g, m);
    expect(a).toBeDefined();
    g = settle(act(g, a!));
    expect(g.objects[bear]!.counters.oil).toBe(1);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('Hopeful Initiate: two +1/+1 counters from among creatures you control', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ini = give(g, 'alice', 'Initiate Lite', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g.objects[ini]!.counters['+1/+1'] = 1;
    g.objects[bear]!.counters['+1/+1'] = 1;
    expect(illegal(g, { type: 'activate', player: 'alice', object: ini, ability: 0, costs: { removed: [{ object: bear, counter: '+1/+1', n: 2 }] } })).toBeTruthy();
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'activate', player: 'alice', object: ini, ability: 0, costs: { removed: [{ object: bear, counter: '+1/+1', n: 1 }, { object: ini, counter: '+1/+1', n: 1 }] } }));
    expect(g.players.alice!.life).toBe(life + 5);
    expect([g.objects[ini]!.counters['+1/+1'], g.objects[bear]!.counters['+1/+1']]).toEqual([undefined, undefined]);
  });
});

describe('staples (slice 205): Maskwood Nexus', () => {
  it('your creatures, creature spells and creature cards elsewhere are every creature type', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Nexus Lite', 'battlefield');
    const mine = give(g, 'alice', 'Bear', 'battlefield');
    const theirs = give(g, 'bob', 'Bear', 'battlefield');
    const inHand = give(g, 'alice', 'Bear', 'hand');
    const theirHand = give(g, 'bob', 'Bear', 'hand');
    expect(chars(g, g.objects[mine]!).subtypes).toContain('Goblin');
    expect(chars(g, g.objects[inHand]!).subtypes).toContain('Elf');
    expect(chars(g, g.objects[theirs]!).subtypes).not.toContain('Goblin');
    expect(chars(g, g.objects[theirHand]!).subtypes).not.toContain('Elf');
  });
});

describe("staples (slice 205): Agadeem's Awakening", () => {
  it('creature cards with mana value X or less, each a different mana value', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [a, b] = [give(g, 'alice', 'Bear', 'graveyard'), give(g, 'alice', 'Bear', 'graveyard')];
    const ogre = give(g, 'alice', 'Ogre Three', 'graveyard');
    const spell = give(g, 'alice', 'Awakening Lite', 'hand');
    g.players.alice!.pool.C = 3;
    const obj = (id: string) => ({ kind: 'object' as const, object: id });
    expect(illegal(g, { type: 'cast', player: 'alice', object: spell, x: 3, targets: [[obj(a), obj(b)]] })).toMatch(/different mana value/);
    g = settle(act(g, { type: 'cast', player: 'alice', object: spell, x: 3, targets: [[obj(a), obj(ogre)]] }));
    expect([g.objects[a]!.zone, g.objects[b]!.zone, g.objects[ogre]!.zone]).toEqual(['battlefield', 'graveyard', 'battlefield']);
  });
});

describe('staples (slice 205): targets related to each other', () => {
  it('Run Away Together: two creatures controlled by different players', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [b1, b2] = [give(g, 'bob', 'Bear', 'battlefield'), give(g, 'bob', 'Bear', 'battlefield')];
    const mine = give(g, 'alice', 'Bear', 'battlefield');
    const spell = give(g, 'alice', 'Run Away Lite', 'hand');
    const obj = (id: string) => ({ kind: 'object' as const, object: id });
    expect(illegal(g, { type: 'cast', player: 'alice', object: spell, targets: [[obj(b1), obj(b2)]] })).toMatch(/different players/);
    g = settle(act(g, { type: 'cast', player: 'alice', object: spell, targets: [[obj(b1), obj(mine)]] }));
    expect([g.objects[b1]!.zone, g.objects[mine]!.zone, g.objects[b2]!.zone]).toEqual(['hand', 'hand', 'battlefield']);
  });

  it('Secret Tunnel: two creatures that share a creature type (and the default picks such a pair)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const tunnel = give(g, 'alice', 'Tunnel Lite', 'battlefield');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    const [x, y] = [give(g, 'alice', 'Bear', 'battlefield'), give(g, 'alice', 'Bear', 'battlefield')];
    const obj = (id: string) => ({ kind: 'object' as const, object: id });
    expect(illegal(g, { type: 'activate', player: 'alice', object: tunnel, ability: 0, targets: [[obj(ogre), obj(x)]] })).toMatch(/share a creature type/);
    const [a] = kitActions(g, tunnel);
    expect((a as { targets: { object: string }[][] }).targets[0]!.map((t) => t.object).sort()).toEqual([x, y].sort());
    g = settle(act(g, a!));
    expect(chars(g, g.objects[x]!).rules.has('cant_be_blocked')).toBe(true);
  });
});

describe('staples (slice 206): exchanges (CR 701.12)', () => {
  const obj = (id: string) => ({ kind: 'object' as const, object: id });
  const ply = (p: string) => ({ kind: 'player' as const, player: p });

  it('Switcheroo: two creatures controlled by different players swap; the same player, nothing', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mine = give(g, 'alice', 'Bear', 'battlefield');
    const theirs = give(g, 'bob', 'Ogre', 'battlefield');
    const mine2 = give(g, 'alice', 'Cub', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Switcheroo Lite', 'hand'), targets: [[obj(mine), obj(theirs)]] }));
    expect([g.objects[mine]!.controller, g.objects[theirs]!.controller]).toEqual(['bob', 'alice']);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Switcheroo Lite', 'hand'), targets: [[obj(theirs), obj(mine2)]] }));
    expect([g.objects[theirs]!.controller, g.objects[mine2]!.controller]).toEqual(['alice', 'alice']);
  });

  it('Switcheroo: if one target is gone, no part of the exchange happens', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mine = give(g, 'alice', 'Bear', 'battlefield');
    const theirs = give(g, 'bob', 'Ogre', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Switcheroo Lite', 'hand'), targets: [[obj(mine), obj(theirs)]] });
    g = act(g, { type: 'pass', player: 'alice' });
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bolt', 'hand'), targets: [[obj(theirs)]] }));
    expect(g.objects[theirs]!.zone).toBe('graveyard');
    expect(g.objects[mine]!.controller).toBe('alice');
  });

  it('Gilded Drake: trades itself for the target, or is sacrificed with no exchange', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const theirs = give(g, 'bob', 'Ogre', 'battlefield');
    const drake = give(g, 'alice', 'Gilded Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: drake }));
    if (g.pending?.kind === 'trigger_targets') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[obj(theirs)]] } }));
    expect([g.objects[drake]!.controller, g.objects[theirs]!.controller]).toEqual(['bob', 'alice']);
    // None chosen: sacrificed.
    const drake2 = give(g, 'alice', 'Gilded Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: drake2 }));
    if (g.pending?.kind === 'trigger_targets') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[]] } }));
    expect(g.objects[drake2]!.zone).toBe('graveyard');
  });

  it('Gilded Drake: still resolves (and is sacrificed) when its target becomes illegal', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const theirs = give(g, 'bob', 'Ogre', 'battlefield');
    const drake = give(g, 'alice', 'Gilded Lite', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: drake });
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[obj(theirs)]] } });
    g = act(g, { type: 'pass', player: 'alice' });
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bolt', 'hand'), targets: [[obj(theirs)]] }));
    expect(g.objects[theirs]!.zone).toBe('graveyard');
    expect(g.objects[drake]!.zone).toBe('graveyard');
  });

  it('Volatile Stormdrake: energy, then pay energy equal to its mana value or sacrifice it', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const theirs = give(g, 'bob', 'Ogre Three', 'battlefield');
    const drake = give(g, 'alice', 'Stormdrake Lite', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: drake });
    g = settle(g);
    if (g.pending?.kind === 'trigger_targets') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[obj(theirs)]] } }));
    expect(g.pending?.kind).toBe('pay');
    expect(g.pending?.kind === 'pay' && g.pending.cost).toBe('{E}{E}{E}');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true } }));
    expect([g.objects[drake]!.controller, g.objects[theirs]!.controller]).toEqual(['bob', 'alice']);
    expect(g.players.alice!.counters?.energy).toBe(1);
  });

  it('Tree of Redemption: the life total becomes its toughness and its toughness the old life total', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const tree = give(g, 'alice', 'Tree Lite', 'battlefield');
    g.objects[tree]!.sick = false;
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'activate', player: 'alice', object: tree, ability: 0 }));
    expect(g.players.alice!.life).toBe(13);
    expect(chars(g, g.objects[tree]!).toughness).toBe(life);
    expect(chars(g, g.objects[tree]!).power).toBe(0);
  });

  it('Soul Conduit: two players exchange life totals, unless one of them can\'t gain the life', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const conduit = give(g, 'alice', 'Soul Conduit Lite', 'battlefield');
    g.players.alice!.life = 5;
    g.players.bob!.life = 30;
    g = settle(act(g, { type: 'activate', player: 'alice', object: conduit, ability: 0, targets: [[ply('alice'), ply('bob')]] }));
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([30, 5]);
    // Bob can't gain life: no part of the exchange happens.
    give(g, 'alice', 'Leyline Lite', 'battlefield');
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    g = settle(act(g, { type: 'activate', player: 'alice', object: conduit, ability: 0, targets: [[ply('alice'), ply('bob')]] }));
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([30, 5]);
  });
});

describe('staples (slice 206): Mox Diamond', () => {
  it('enters only if a land card is discarded instead', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Artifact Watcher', 'battlefield');
    const land = give(g, 'alice', 'Forest', 'hand');
    const mox = give(g, 'alice', 'Mox Lite', 'hand');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: mox }));
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'discard_or_leave' });
    expect(g.pending?.kind === 'as_enters' && g.pending.candidates).toContain(land);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', reveal: land } }));
    expect([g.objects[mox]!.zone, g.objects[land]!.zone]).toEqual(['battlefield', 'graveyard']);
    // It entered (+1) and the land went to the graveyard (+5).
    expect(g.players.alice!.life).toBe(life + 6);
  });

  it("if you don't, it goes to the graveyard without ever entering", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Artifact Watcher', 'battlefield');
    const land = give(g, 'alice', 'Forest', 'hand');
    const mox = give(g, 'alice', 'Mox Lite', 'hand');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: mox }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', reveal: null } }));
    expect([g.objects[mox]!.zone, g.objects[land]!.zone]).toEqual(['graveyard', 'hand']);
    // Only "put into your graveyard from anywhere": no entering, nothing from the battlefield.
    expect(g.players.alice!.life).toBe(life + 5);
  });

  it('with no land card in hand, it goes straight to the graveyard', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (const id of g.zones.hand.alice!.filter((id) => g.cards[g.objects[id]!.card]!.faces[0]!.types.includes('Land'))) g.objects[id]!.zone = 'library';
    g.zones.hand.alice = g.zones.hand.alice!.filter((id) => g.objects[id]!.zone === 'hand');
    const mox = give(g, 'alice', 'Mox Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: mox }));
    expect(g.pending).toBeFalsy();
    expect(g.objects[mox]!.zone).toBe('graveyard');
  });
});

describe('staples (slice 206): Lake of the Dead', () => {
  it('a Swamp is sacrificed for it to enter; with none, it goes to the graveyard', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lake = give(g, 'alice', 'Lake Lite', 'hand');
    g = settle(act(g, { type: 'play_land', player: 'alice', object: lake }));
    expect(g.objects[lake]!.zone).toBe('graveyard');
    g.players.alice!.landsPlayedThisTurn = 0;
    const swamp = give(g, 'alice', 'Swamp', 'battlefield');
    const lake2 = give(g, 'alice', 'Lake Lite', 'hand');
    g = settle(act(g, { type: 'play_land', player: 'alice', object: lake2 }));
    expect([g.objects[lake2]!.zone, g.objects[swamp]!.zone]).toEqual(['battlefield', 'graveyard']);
  });
});

describe('staples (slice 207): Harsh Mentor', () => {
  it('a land sacrificed to pay for its ability still counts; mana abilities never do', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'bob', 'Mentor Lite', 'battlefield');
    const fetch = give(g, 'alice', 'Fetch Lite', 'battlefield');
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    const life = g.players.alice!.life;
    g = act(g, { type: 'activate_mana', player: 'alice', object: forest, ability: 0 });
    expect(g.players.alice!.life).toBe(life);
    g = settle(act(g, { type: 'activate', player: 'alice', object: fetch, ability: 0 }));
    if (g.pending?.kind === 'search') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [] } } as never));
    expect(g.players.alice!.life).toBe(life - 1 - 2);
  });
});

describe('staples (slice 207): keep some, destroy the rest', () => {
  it('Mount Doom: you choose up to two creatures (anyone\'s) and the rest are destroyed', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [a1, a2] = [give(g, 'alice', 'Bear', 'battlefield'), give(g, 'alice', 'Cub', 'battlefield')];
    const [b1, b2] = [give(g, 'bob', 'Ogre', 'battlefield'), give(g, 'bob', 'Bear', 'battlefield')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Doom Lite', 'hand') }));
    expect(g.pending?.kind).toBe('choose_objects');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [a1, b1] } }));
    expect([a1, a2, b1, b2].map((id) => g.objects[id]!.zone)).toEqual(['battlefield', 'graveyard', 'battlefield', 'graveyard']);
  });

  it('Divine Reckoning: each player keeps one creature of theirs', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [a1, a2] = [give(g, 'alice', 'Bear', 'battlefield'), give(g, 'alice', 'Cub', 'battlefield')];
    const b1 = give(g, 'bob', 'Ogre', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Reckoning Lite', 'hand') }));
    expect(g.pending?.kind).toBe('choose_objects');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [a2] } }));
    expect([a1, a2, b1].map((id) => g.objects[id]!.zone)).toEqual(['graveyard', 'battlefield', 'battlefield']);
  });
});

describe('staples (slice 207): Cultivator Colossus', () => {
  it('put a land from hand, draw, and again — until you don\'t (or can\'t)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (const id of g.zones.hand.alice!) g.objects[id]!.zone = 'library';
    g.zones.library.alice!.unshift(...g.zones.hand.alice!);
    g.zones.hand.alice = [];
    const land = give(g, 'alice', 'Forest', 'hand');
    const top = give(g, 'alice', 'Bear', 'library');
    g.zones.library.alice = [top, ...g.zones.library.alice!.filter((id) => id !== top)];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Colossus Lite', 'hand') }));
    expect(g.pending?.kind).toBe('may');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    expect(g.objects[land]!.zone).toBe('battlefield');
    expect(g.objects[land]!.tapped).toBe(true);
    expect(g.objects[top]!.zone).toBe('hand');
    // No land card in hand now: it ends, with nothing more drawn.
    expect(g.pending).toBeFalsy();
    expect(g.zones.hand.alice).toEqual([top]);
  });
});

describe('staples (slice 207): Moonsilver Key', () => {
  it('an artifact card with a mana ability or a basic land card', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const signet = give(g, 'alice', 'Signet Lite', 'library');
    const trinket = give(g, 'alice', 'Trinket', 'library');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Key Lite', 'hand') });
    g = settle(g);
    expect(g.pending?.kind).toBe('search');
    const p = g.pending as { candidates?: string[] };
    expect(p.candidates).toContain(signet);
    expect(p.candidates).not.toContain(trinket);
  });
});

describe('staples (slice 207): each player may', () => {
  it('Show and Tell: each chooses in turn, then everything chosen enters at once', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mine = give(g, 'alice', 'Ogre', 'hand');
    const theirs = give(g, 'bob', 'Bear', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Show Lite', 'hand') }));
    expect(g.pending).toMatchObject({ kind: 'choose_objects', player: 'alice', min: 0 });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [mine] } });
    // Nothing has entered yet while Bob chooses.
    expect(g.objects[mine]!.zone).toBe('hand');
    expect(g.pending).toMatchObject({ kind: 'choose_objects', player: 'bob' });
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'choose_objects', objects: [theirs] } }));
    expect([g.objects[mine]!.zone, g.objects[theirs]!.zone]).toEqual(['battlefield', 'battlefield']);
    expect([g.objects[mine]!.controller, g.objects[theirs]!.controller]).toEqual(['alice', 'bob']);
  });

  it('Will of the Jeskai: each player chooses whether to discard their hand and draw five', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bobHand = [...g.zones.hand.bob!];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Jeskai Wheel', 'hand') }));
    expect(g.pending).toMatchObject({ kind: 'may', player: 'alice' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    expect(g.pending).toMatchObject({ kind: 'may', player: 'bob' });
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'may', yes: false } }));
    expect(g.zones.hand.alice!.length).toBe(5);
    expect(g.zones.hand.bob).toEqual(bobHand);
  });

  it('Final Act: each opponent loses all counters', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.players.bob!.poison = 7;
    g.players.bob!.counters = { energy: 3 };
    g.players.alice!.poison = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Final Lite', 'hand') }));
    expect([g.players.bob!.poison, g.players.bob!.counters?.energy ?? 0, g.players.alice!.poison]).toEqual([0, 0, 2]);
  });

  it('Deadly Vanity: "other" is other than the chosen one', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [a, b, c] = [give(g, 'alice', 'Bear', 'battlefield'), give(g, 'bob', 'Ogre', 'battlefield'), give(g, 'bob', 'Cub', 'battlefield')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Vanity Lite', 'hand') }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [b] } }));
    expect([a, b, c].map((id) => g.objects[id]!.zone)).toEqual(['graveyard', 'battlefield', 'graveyard']);
  });

  it("Kozilek's Command: the target player scries and draws", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.players.alice!.pool.C = 2;
    const hand = g.zones.hand.bob!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Scry Command', 'hand'), x: 2, targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.pending).toMatchObject({ kind: 'scry', player: 'bob' });
    const top = (g.pending as { objects: string[] }).objects;
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'scry', top: [], bottom: top } }));
    expect(g.zones.hand.bob!.length).toBe(hand + 1);
    expect(g.zones.library.bob!.slice(-2).sort()).toEqual([...top].sort());
  });

  it('Astarion: life equal to the life that player lost this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Feed Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.players.bob!.life).toBe(life - 3);
  });
});

describe('staples (slice 208)', () => {
  const obj = (id: string) => ({ kind: 'object' as const, object: id });
  const ply = (p: string) => ({ kind: 'player' as const, player: p });
  const combat = (g: GameState, attacks: { attacker: string; target: { kind: 'player'; player: string } }[], blocks: { blocker: string; attacker: string }[] = []) => {
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks } });
    for (let i = 0; i < 40 && g.step !== 'end'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks } });
      else if (g.pending) break;
      else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
      else break;
    }
    return g;
  };

  it("Spider-Punk: abilities can't be countered either", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'bob', 'Punk Lite', 'battlefield');
    const pinger = give(g, 'alice', 'Pinger', 'battlefield');
    const life = g.players.alice!.life;
    g = act(g, { type: 'activate', player: 'alice', object: pinger, ability: 0 });
    const entry = g.stack[g.stack.length - 1]!;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Squelch Lite', 'hand'), targets: [[{ kind: 'ability', entry: entry.kind === 'ability' ? entry.id : '' }]] } as never);
    g = settle(g);
    expect(g.players.alice!.life).toBe(life + 1);
  });

  it('Charix: spells your opponents cast that target it cost {2} more', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const charix = give(g, 'bob', 'Charix Lite', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const bolt = give(g, 'alice', 'Bolt', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: bolt, targets: [[obj(charix)]] })).toBeTruthy();
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: bolt, targets: [[obj(charix)]] }));
    expect(g.players.alice!.pool.C ?? 0).toBe(0);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[obj(bear)]] }));
    expect(g.objects[bear]!.zone).toBe('graveyard');
  });

  it('Alisaie: the second spell each turn costs {2} less', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Alisaie Lite', 'battlefield');
    const first = give(g, 'alice', 'Ogre Spell', 'hand');
    const second = give(g, 'alice', 'Ogre Spell', 'hand');
    g.players.alice!.pool.C = 3;
    g = settle(act(g, { type: 'cast', player: 'alice', object: first }));
    expect(g.players.alice!.pool.C ?? 0).toBe(0);
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: second }));
    expect(g.objects[second]!.zone).toBe('graveyard');
  });

  it('Darksteel Reactor: twenty charge counters win the game', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const reactor = give(g, 'alice', 'Reactor Lite', 'battlefield');
    g.objects[reactor]!.counters.charge = 19;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Salve', 'hand') }));
    expect(g.over).toBeFalsy();
    g.objects[reactor]!.counters.charge = 20;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Salve', 'hand') });
    for (let i = 0; i < 20 && !g.over && g.priority; i++) g = act(g, { type: 'pass', player: g.priority });
    expect(g.over).toBeTruthy();
  });

  it('Acquisition Octopus: this creature or the equipped one dealing combat damage', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const oct = give(g, 'alice', 'Octopus Lite', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g.objects[oct]!.sick = false;
    g.objects[bear]!.sick = false;
    const hand = g.zones.hand.alice!.length;
    g = combat(g, [{ attacker: oct, target: ply('bob') }]);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('Agent Frank Horrigan: indestructible once it has attacked this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const frank = give(g, 'alice', 'Horrigan Lite', 'battlefield');
    g.objects[frank]!.sick = false;
    expect(chars(g, g.objects[frank]!).keywords.some((k) => k.id === 'indestructible')).toBe(false);
    g = combat(g, [{ attacker: frank, target: ply('bob') }]);
    expect(chars(g, g.objects[frank]!).keywords.some((k) => k.id === 'indestructible')).toBe(true);
  });

  it('Nim Deathmantle: the equipped creature is a black Zombie (its creature types replaced)', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const mantle = give(g, 'alice', 'Deathmantle Lite', 'battlefield');
    g.objects[mantle]!.attachedTo = { id: bear, zcc: g.objects[bear]!.zcc };
    const c = chars(g, g.objects[bear]!);
    expect([c.power, c.toughness, c.colors, c.subtypes]).toEqual([4, 4, ['B'], ['Zombie']]);
  });

  it('Visions of Beyond: three cards if any graveyard has twenty or more', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    let hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Visions Lite', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
    for (let i = 0; i < 20; i++) give(g, 'bob', 'Cub', 'graveyard');
    hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Visions Lite', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(hand + 3);
  });

  it("Gaddock Teeg: noncreature spells with {X} in their mana costs can't be cast", () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'bob', 'Teeg Lite', 'battlefield');
    g.players.alice!.pool.C = 1;
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'X Burn', 'hand'), x: 1, targets: [[ply('bob')]] })).toBeTruthy();
  });

  it('Bedrock Tortoise: only creatures with toughness greater than power assign damage by toughness', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Tortoise Lite', 'battlefield');
    const wall = give(g, 'alice', 'Wall Guy', 'battlefield');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    g.objects[wall]!.sick = false;
    g.objects[ogre]!.sick = false;
    const life = g.players.bob!.life;
    g = combat(g, [{ attacker: wall, target: ply('bob') }, { attacker: ogre, target: ply('bob') }]);
    expect(g.players.bob!.life).toBe(life - 4 - 5);
  });

  it('Kaalia: a Dragon from your hand enters tapped and attacking that opponent', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const kaalia = give(g, 'alice', 'Kaalia Lite', 'battlefield');
    g.objects[kaalia]!.sick = false;
    const dragon = give(g, 'alice', 'Dragon Lite', 'hand');
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: kaalia, target: ply('bob') }] } });
    for (let i = 0; i < 10 && g.pending?.kind !== 'may'; i++) {
      if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [] } });
      else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
    }
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    if (g.pending?.kind === 'choose_objects') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [dragon] } });
    expect(g.objects[dragon]!.zone).toBe('battlefield');
    expect(g.objects[dragon]!.tapped).toBe(true);
    expect(g.combat?.attackers[dragon]?.target).toEqual(ply('bob'));
  });

  it('Mystical Teachings: an instant card or a card with flash', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const fb = give(g, 'alice', 'Flash Bear', 'library');
    const bolt = give(g, 'alice', 'Bolt', 'library');
    const bear = give(g, 'alice', 'Bear', 'library');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Teachings Lite', 'hand') }));
    const p = g.pending as { kind: string; candidates?: string[] };
    expect(p.kind).toBe('search');
    expect(p.candidates).toEqual(expect.arrayContaining([fb, bolt]));
    expect(p.candidates).not.toContain(bear);
  });
});

describe('staples (slice 209)', () => {
  const obj = (id: string) => ({ kind: 'object' as const, object: id });
  const ply = (p: string) => ({ kind: 'player' as const, player: p });
  const triggerTarget = (g: GameState, id: string) => (g.pending?.kind === 'trigger_targets' ? settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[obj(id)]] } })) : g);

  it('Sower of Temptation: control lasts as long as it remains on the battlefield', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    const sower = give(g, 'alice', 'Sower Lite', 'hand');
    g = triggerTarget(settle(act(g, { type: 'cast', player: 'alice', object: sower })), ogre);
    expect(g.objects[ogre]!.controller).toBe('alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[obj(sower)]] }));
    expect(g.objects[ogre]!.controller).toBe('bob');
  });

  it('Palace Jailer: back when an opponent becomes the monarch, not when you do', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    g = triggerTarget(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Jailer Lite', 'hand') })), ogre);
    expect(g.objects[ogre]!.zone).toBe('exile');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Crown Grab', 'hand'), targets: [[ply('alice')]] }));
    expect(g.objects[ogre]!.zone).toBe('exile');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Crown Grab', 'hand'), targets: [[ply('bob')]] }));
    expect(g.objects[ogre]!.zone).toBe('battlefield');
    expect(g.objects[ogre]!.controller).toBe('bob');
  });

  it('The Ten Rings: draw up to ten at the end step', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Ten Rings Lite', 'battlefield');
    g = toStep(g, 'end', 'alice');
    g = settle(g);
    expect(g.zones.hand.alice!.length).toBe(10);
  });

  it('Sandstone Oracle: draw the difference if the chosen opponent has more cards', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (let i = 0; i < 4; i++) give(g, 'bob', 'Cub', 'hand');
    const mine = g.zones.hand.alice!.length;
    const diff = g.zones.hand.bob!.length - mine;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Oracle Lite', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(mine + diff);
  });

  it('Hakbal: each Merfolk explores, one at a time', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [m1, m2] = [give(g, 'alice', 'Merfolk', 'battlefield'), give(g, 'alice', 'Merfolk', 'battlefield')];
    const [c1, c2] = [give(g, 'alice', 'Cub', 'library'), give(g, 'alice', 'Cub', 'library')];
    g.zones.library.alice = [c1, c2, ...g.zones.library.alice!.filter((id) => id !== c1 && id !== c2)];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Hakbal Lite', 'hand') }));
    expect(g.pending?.kind).toBe('may');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    expect(g.objects[c1]!.zone).toBe('graveyard');
    expect(g.pending?.kind).toBe('may');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: false } }));
    expect([g.objects[m1]!.counters['+1/+1'], g.objects[m2]!.counters['+1/+1'], g.objects[c2]!.zone]).toEqual([1, 1, 'library']);
  });

  it('Mjölnir: the equipped creature deals double damage', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    g.objects[ogre]!.sick = false;
    const hammer = give(g, 'alice', 'Hammer Lite', 'battlefield');
    g.objects[hammer]!.attachedTo = { id: ogre, zcc: g.objects[ogre]!.zcc };
    const life = g.players.bob!.life;
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: ogre, target: ply('bob') }] } });
    for (let i = 0; i < 30 && g.step !== 'end'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } });
      else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
      else break;
    }
    expect(g.players.bob!.life).toBe(life - 10);
  });

  it('Titania: Forests (and only Forests) from your graveyard', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Titania Lite', 'battlefield');
    const forest = give(g, 'alice', 'Forest', 'graveyard');
    const plains = give(g, 'alice', 'Plains', 'graveyard');
    expect(illegal(g, { type: 'play_land', player: 'alice', object: plains })).toBeTruthy();
    g = settle(act(g, { type: 'play_land', player: 'alice', object: forest }));
    expect(g.objects[forest]!.zone).toBe('battlefield');
  });

  it('Tavern Scoundrel: treasure for each coin flip won', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const s = give(g, 'alice', 'Scoundrel Lite', 'battlefield');
    let wins = 0;
    for (let i = 0; i < 6; i++) {
      const before = g.zones.battlefield.length;
      g = settle(act(g, { type: 'activate', player: 'alice', object: s, ability: 0 }));
      if (g.zones.battlefield.length > before) wins++;
      expect([before, before + 2]).toContain(g.zones.battlefield.length);
    }
    expect(wins).toBeGreaterThanOrEqual(0);
  });

  it("Scytheclaw Raptor: damage to the player who cast a spell on someone else's turn", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Raptor Lite', 'battlefield');
    const life = g.players.bob!.life;
    const mine = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Salve', 'hand') }));
    expect(g.players.alice!.life).toBe(mine + 3);
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Salve', 'hand') });
    g = act(g, { type: 'pass', player: 'alice' });
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Salve', 'hand') }));
    expect(g.players.bob!.life).toBe(life + 3 - 4);
  });

  it("Traxos: enters tapped and doesn't untap", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const tx = give(g, 'alice', 'Traxos Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: tx }));
    expect(g.objects[tx]!.tapped).toBe(true);
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    expect(g.objects[tx]!.tapped).toBe(true);
  });

  it("Rug of Smothering: life for each spell that player has cast this turn", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'bob', 'Rug Lite', 'battlefield');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Looting', 'hand') }));
    if (g.pending?.kind === 'discard') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: g.zones.hand.alice!.slice(0, 2) } }));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Looting', 'hand') }));
    if (g.pending?.kind === 'discard') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: g.zones.hand.alice!.slice(0, 2) } }));
    expect(g.players.alice!.life).toBe(life - 1 - 2);
  });
});

describe('staples (slice 210)', () => {
  const obj = (id: string) => ({ kind: 'object' as const, object: id });
  const ply = (p: string) => ({ kind: 'player' as const, player: p });
  const tokens = (g: GameState, name: string) => g.zones.battlefield.filter((id) => g.cards[g.objects[id]!.card]!.faces[0]!.name === name);

  it('God-Eternal Bontu: sacrifice any number of other permanents, then draw that many', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cubs = [give(g, 'alice', 'Cub', 'battlefield'), give(g, 'alice', 'Cub', 'battlefield'), give(g, 'alice', 'Cub', 'battlefield')];
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bontu Lite', 'hand') }));
    expect(g.pending?.kind).toBe('choose_objects');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: cubs.slice(0, 2) } }));
    expect(cubs.map((id) => g.objects[id]!.zone)).toEqual(['graveyard', 'graveyard', 'battlefield']);
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
  });

  it('Bonehoard Dracosaur: a Dinosaur for a land, a Treasure for a nonland card', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Dracosaur Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'library');
    const lib = g.zones.library.alice!;
    g.zones.library.alice = [lib.find((id) => id !== cub && g.cards[g.objects[id]!.card]!.faces[0]!.name === 'Forest')!, cub, ...lib.filter((id) => id !== cub)];
    g.zones.library.alice = [...new Set(g.zones.library.alice)];
    const [land] = g.zones.library.alice;
    g = settle(toStep(g, 'upkeep', 'alice'));
    expect([g.objects[land!]!.zone, g.objects[cub]!.zone]).toEqual(['exile', 'exile']);
    expect(tokens(g, 'Dinosaur Token').length).toBe(1);
    expect(tokens(g, 'Treasure').length).toBe(1);
  });

  it('Valakut Exploration: the exiled cards go to the graveyard and deal that much damage', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Exploration Lite', 'battlefield');
    const top = g.zones.library.alice![0]!;
    g = settle(act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Plains', 'hand') }));
    expect(g.objects[top]!.zone).toBe('exile');
    const life = g.players.bob!.life;
    g = settle(toStep(g, 'end', 'alice'));
    expect(g.objects[top]!.zone).toBe('graveyard');
    expect(g.players.bob!.life).toBe(life - 1);
  });

  it('The Skullspore Nexus: a token as big as the total power of those creatures', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Skullspore Lite', 'battlefield');
    give(g, 'alice', 'Ogre', 'battlefield');
    give(g, 'alice', 'Cub', 'battlefield');
    give(g, 'bob', 'Ogre', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Annihilate Lite', 'hand') }));
    const [token] = tokens(g, 'Fungus Dinosaur Token');
    expect(token).toBeDefined();
    expect([chars(g, g.objects[token!]!).power, chars(g, g.objects[token!]!).toughness]).toEqual([6, 6]);
  });

  it('Replicating Ring: eight snow Replicated Rings at the eighth night counter', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const ring = give(g, 'alice', 'Ring Lite', 'battlefield');
    g.objects[ring]!.counters.night = 7;
    g = settle(toStep(g, 'upkeep', 'alice'));
    expect(g.objects[ring]!.counters.night).toBeUndefined();
    const made = tokens(g, 'Replicated Ring');
    expect(made.length).toBe(8);
    expect(chars(g, g.objects[made[0]!]!).supertypes).toContain('Snow');
  });

  it('Prize Pig: three ribbon counters come off and it untaps', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const pig = give(g, 'alice', 'Pig Lite', 'battlefield');
    g.objects[pig]!.tapped = true;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Salve', 'hand') }));
    expect(g.objects[pig]!.counters.ribbon).toBeUndefined();
    expect(g.objects[pig]!.tapped).toBe(false);
  });

  it('Coalition Relic: one mana of any color for each charge counter removed', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const relic = give(g, 'alice', 'Relic Lite', 'battlefield');
    g.objects[relic]!.counters.charge = 2;
    g = toStep(g, 'main1', 'alice');
    g = settle(g);
    for (const c of ['W', 'U']) {
      expect(g.pending?.kind).toBe('choose_option');
      g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: c } }));
    }
    expect(g.objects[relic]!.counters.charge).toBeUndefined();
    expect([g.players.alice!.pool.W, g.players.alice!.pool.U]).toEqual([1, 1]);
  });

  it("Kodama of the East Tree: equal or lesser mana value, and not again for what it put there", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Kodama Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'hand');
    const trinket = give(g, 'alice', 'Trinket', 'hand');
    g = settle(act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Plains', 'hand') }));
    expect(g.pending?.kind).toBe('may');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    const p = g.pending;
    const candidates = p?.kind === 'choose_objects' ? p.candidates : [];
    expect(candidates).toContain(cub);
    expect(candidates).not.toContain(trinket);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [cub] } }));
    expect(g.objects[cub]!.zone).toBe('battlefield');
    expect(g.objects[trinket]!.zone).toBe('hand');
    expect(g.pending).toBeFalsy();
    expect(g.stack.length).toBe(0);
  });

  it("Defense Grid: {3} more except during the caster's turn", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Grid Lite', 'battlefield');
    const salve = give(g, 'bob', 'Salve', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Salve', 'hand') });
    expect(g.stack.length).toBe(1);
    g = act(g, { type: 'pass', player: 'alice' });
    expect(illegal(g, { type: 'cast', player: 'bob', object: salve })).toBeTruthy();
  });

  it('Call the Coppercoats: tokens for the creatures those opponents control', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'bob', 'Cub', 'battlefield');
    give(g, 'bob', 'Cub', 'battlefield');
    give(g, 'alice', 'Cub', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Coppercoats Lite', 'hand'), targets: [[ply('bob')]] }));
    expect(tokens(g, 'Human Soldier Token').length).toBe(2);
  });

  it('God-Eternal Oketra: third from the top when it dies', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const god = give(g, 'alice', 'Oketra Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[obj(god)]] }));
    expect(g.pending?.kind).toBe('may');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    expect(g.zones.library.alice!.indexOf(god)).toBe(2);
  });
});

describe('staples (slice 210): returned attached', () => {
  const obj = (id: string) => ({ kind: 'object' as const, object: id });

  it('Mantle of the Ancients: Auras and Equipment come back attached to the enchanted creature', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    const [aura, sword, landAura] = [give(g, 'alice', 'Boon Aura', 'graveyard'), give(g, 'alice', 'Blade Lite', 'graveyard'), give(g, 'alice', 'Land Aura', 'graveyard')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mantle Lite', 'hand'), targets: [[obj(ogre)]] }));
    expect(g.pending?.kind).toBe('trigger_targets');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[obj(aura), obj(sword), obj(landAura)]] } }));
    expect([aura, sword].map((id) => [g.objects[id]!.zone, g.objects[id]!.attachedTo?.id])).toEqual([['battlefield', ogre], ['battlefield', ogre]]);
    // CR 303.4f: an Aura that can't enchant it stays in the graveyard.
    expect(g.objects[landAura]!.zone).toBe('graveyard');
    expect(chars(g, g.objects[ogre]!).power).toBe(5 + 1 + 2);
  });

  it('Unfinished Business: attached to the creature returned with it', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [ogre, aura] = [give(g, 'alice', 'Ogre', 'graveyard'), give(g, 'alice', 'Boon Aura', 'graveyard')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Business Lite', 'hand'), targets: [[obj(ogre)], [obj(aura)]] }));
    expect(g.objects[ogre]!.zone).toBe('battlefield');
    expect(g.objects[aura]!.attachedTo?.id).toBe(ogre);
  });

  it('Gift of Immortality: the creature returns, and the Aura returns attached to it at the end step', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    const gift = give(g, 'alice', 'Gift Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: gift, targets: [[obj(ogre)]] }));
    expect(g.objects[gift]!.attachedTo?.id).toBe(ogre);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[obj(ogre)]] }));
    expect(g.objects[ogre]!.zone).toBe('battlefield');
    expect(g.objects[gift]!.zone).toBe('graveyard');
    g = settle(toStep(g, 'end', 'alice'));
    expect(g.objects[gift]!.zone).toBe('battlefield');
    expect(g.objects[gift]!.attachedTo?.id).toBe(ogre);
  });

  it("Angelic Destiny: CR 400.7f — the Aura put into the graveyard for not being attached returns to its owner's hand", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    const aura = give(g, 'alice', 'Destiny Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: aura, targets: [[obj(cub)]] }));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Annihilate Lite', 'hand') }));
    expect(g.objects[cub]!.zone).toBe('graveyard');
    expect(g.objects[aura]!.zone).toBe('hand');
  });

  it('Malcolm: with four chorus counters, the discarded card may be cast for free', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const m = give(g, 'alice', 'Malcolm Lite', 'battlefield');
    g.objects[m]!.sick = false;
    g.objects[m]!.counters.chorus = 3;
    for (const id of g.zones.hand.alice!.splice(0)) {
      g.objects[id]!.zone = 'library';
      g.zones.library.alice!.push(id);
    }
    const bear = give(g, 'alice', 'Ogre', 'library');
    g.zones.library.alice = [bear, ...g.zones.library.alice!.filter((id) => id !== bear)];
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: m, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 30 && g.objects[bear]!.zone !== 'battlefield'; i++) {
      const p = g.pending;
      if (p?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } });
      else if (p?.kind === 'discard') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: [bear] } });
      else if (p?.kind === 'cast_free') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: true } });
      else if (p) break;
      else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
      else break;
    }
    expect(g.objects[m]!.counters.chorus).toBe(4);
    expect(g.objects[bear]!.zone).toBe('battlefield');
  });

  it('Phelia: a counter only when what returns enters under your control', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ph = give(g, 'alice', 'Phelia Lite', 'battlefield');
    g.objects[ph]!.sick = false;
    const mine = give(g, 'alice', 'Cub', 'battlefield');
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: ph, target: { kind: 'player', player: 'bob' } }] } });
    if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[obj(mine)]] } });
    g = settle(g);
    expect(g.objects[mine]!.zone).toBe('exile');
    g = settle(toStep(g, 'end', 'alice'));
    expect(g.objects[mine]!.zone).toBe('battlefield');
    expect(g.objects[ph]!.counters['+1/+1']).toBe(1);
  });

  it('Consuming Aberration: each opponent reveals until a land and mills those cards', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Aberration Lite', 'battlefield');
    const [c1, c2] = [give(g, 'bob', 'Cub', 'library'), give(g, 'bob', 'Cub', 'library')];
    const land = g.zones.library.bob!.find((id) => g.cards[g.objects[id]!.card]!.faces[0]!.name === 'Forest')!;
    g.zones.library.bob = [c1, c2, land, ...g.zones.library.bob!.filter((id) => ![c1, c2, land].includes(id))];
    const before = g.zones.library.bob.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Salve', 'hand') }));
    expect([c1, c2, land].map((id) => g.objects[id]!.zone)).toEqual(['graveyard', 'graveyard', 'graveyard']);
    expect(g.zones.library.bob!.length).toBe(before - 3);
  });
});

describe('staples (slice 210): in addition to its other colors', () => {
  const obj = (id: string) => ({ kind: 'object' as const, object: id });
  it("Liliana, Death's Majesty: the returned creature is a black Zombie as well", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'alice', 'Red Ogre', 'graveyard');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Raise Lite', 'hand'), targets: [[obj(ogre)]] }));
    const c = chars(g, g.objects[ogre]!);
    expect([c.colors, c.subtypes]).toEqual([['B', 'R'], ['Ogre', 'Zombie']]);
  });

  it('Ghoulflesh: black and a Zombie, keeping its own color and types', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'alice', 'Red Ogre', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ghoul Aura', 'hand'), targets: [[obj(ogre)]] }));
    const c = chars(g, g.objects[ogre]!);
    expect([c.colors, c.subtypes, c.power]).toEqual([['B', 'R'], ['Ogre', 'Zombie'], 4]);
  });
});

describe('staples (slice 210): more', () => {
  const obj = (id: string) => ({ kind: 'object' as const, object: id });
  const ply = (p: string) => ({ kind: 'player' as const, player: p });

  it('Emeria Shepherd: a Plains lets it return to the battlefield instead', () => {
    for (const land of ['Plains', 'Forest']) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      give(g, 'alice', 'Shepherd Lite', 'battlefield');
      const ogre = give(g, 'alice', 'Ogre', 'graveyard');
      g = act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', land, 'hand') });
      if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[obj(ogre)]] } });
      g = settle(g);
      expect(g.pending?.kind).toBe('may');
      g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
      expect(g.objects[ogre]!.zone).toBe(land === 'Plains' ? 'battlefield' : 'hand');
    }
  });

  it('Fallen Shinobi: you may play the cards that player exiled, for free', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ninja = give(g, 'alice', 'Shinobi Lite', 'battlefield');
    g.objects[ninja]!.sick = false;
    const [c1, c2] = [give(g, 'bob', 'Bear', 'library'), give(g, 'bob', 'Bear', 'library')];
    g.zones.library.bob = [c1, c2, ...g.zones.library.bob!.filter((id) => id !== c1 && id !== c2)];
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: ninja, target: ply('bob') }] } });
    for (let i = 0; i < 30 && g.step !== 'main2'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } });
      else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
      else break;
    }
    expect([g.objects[c1]!.zone, g.objects[c2]!.zone]).toEqual(['exile', 'exile']);
    g = settle(act(g, { type: 'cast', player: 'alice', object: c1 }));
    expect(g.objects[c1]!.zone).toBe('battlefield');
    expect(g.objects[c1]!.controller).toBe('alice');
  });

  it('Scheming Symmetry: each of the two players puts a card on top', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [a, b2] = [give(g, 'alice', 'Ogre', 'library'), give(g, 'bob', 'Cub', 'library')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Symmetry Lite', 'hand'), targets: [[ply('alice'), ply('bob')]] }));
    for (let i = 0; i < 4 && g.pending; i++) {
      const p = g.pending;
      if (p.kind !== 'search') break;
      g = settle(act(g, { type: 'choose', player: p.player, answer: { kind: 'search', objects: [p.player === 'alice' ? a : b2] } }));
    }
    expect([g.zones.library.alice![0], g.zones.library.bob![0]]).toEqual([a, b2]);
  });
});

describe('staples (slice 211)', () => {
  const obj = (id: string) => ({ kind: 'object' as const, object: id });

  it('Phantasmal Image: "sacrifice it" — the creature, not the spell targeting it', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ph = give(g, 'alice', 'Phantom Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Salve', 'hand') }));
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[obj(ph)]] });
    g = settle(g);
    expect(g.objects[ph]!.zone).toBe('graveyard');
  });

  it('Giggling Skitterspike: damage equal to its power when a spell targets it', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const s = give(g, 'alice', 'Skitterspike Lite', 'battlefield');
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[obj(s)]] }));
    expect(g.players.bob!.life).toBe(life - 1);
  });

  it('Fear of Abduction: the creature exiled to cast it comes back too (CR 607.2a)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    const fear = give(g, 'alice', 'Abduction Lite', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: fear, costs: { exile: [cub] } });
    expect(g.objects[cub]!.zone).toBe('exile');
    g = settle(g);
    if (g.pending?.kind === 'trigger_targets') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[obj(ogre)]] } }));
    expect(g.objects[ogre]!.zone).toBe('exile');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[obj(fear)]] }));
    expect([g.objects[cub]!.zone, g.objects[ogre]!.zone]).toEqual(['hand', 'hand']);
  });

  it('The Black Gate: unblockable by the creatures of the player with the most life', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const gate = give(g, 'alice', 'Gate Lite', 'battlefield');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    g.objects[ogre]!.sick = false;
    const wall = give(g, 'bob', 'Ogre', 'battlefield');
    g.players.bob!.life = g.players.alice!.life + 5;
    g = settle(act(g, { type: 'activate', player: 'alice', object: gate, ability: 0, targets: [[obj(ogre)]] }));
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: ogre, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 10 && g.pending?.kind !== 'declare_blockers'; i++) if (g.priority) g = act(g, { type: 'pass', player: g.priority });
    expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: wall, attacker: ogre }] } })).toBeTruthy();
  });

  it('Odric, Lunarch Marshal: creatures share the keywords any of them has', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Odric Lite', 'battlefield');
    give(g, 'alice', 'Flier', 'battlefield');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    g = settle(toStep(g, 'beginning_of_combat'));
    expect(chars(g, g.objects[ogre]!).keywords.map((k) => k.id)).toContain('flying');
    expect(chars(g, g.objects[ogre]!).keywords.map((k) => k.id)).not.toContain('trample');
  });

  it('Food Chain: exile a creature for one more mana than its mana value, for creature spells only', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const chain = give(g, 'alice', 'Chain Lite', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: chain, ability: 0, choice: 'G', costs: { exile: [bear] } });
    expect(g.objects[bear]!.zone).toBe('exile');
    const pool = g.players.alice!.restricted ?? [];
    expect(pool.filter((r) => r.color === 'G').reduce((n, r) => n + r.amount, 0)).toBe(3);
  });

  it('The Soul Stone: once harnessed, its upkeep ability returns a creature', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const stone = give(g, 'alice', 'Soul Stone Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    const ogre = give(g, 'alice', 'Ogre', 'graveyard');
    g = settle(act(g, { type: 'activate', player: 'alice', object: stone, ability: 0, costs: { exile: [cub] } } as never));
    expect(g.objects[stone]!.harnessed).toBe(true);
    g = toStep(g, 'upkeep', 'alice');
    if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[obj(ogre)]] } });
    g = settle(g);
    expect(g.objects[ogre]!.zone).toBe('battlefield');
  });

  it("The Soul Stone: not harnessed, no upkeep trigger", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Soul Stone Lite', 'battlefield');
    const ogre = give(g, 'alice', 'Ogre', 'graveyard');
    g = settle(toStep(g, 'upkeep', 'alice'));
    expect(g.pending).toBeFalsy();
    expect(g.objects[ogre]!.zone).toBe('graveyard');
  });

  it("Wrenn and Seven: the Treefolk's power and toughness are the number of lands you control", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (let i = 0; i < 3; i++) give(g, 'alice', 'Forest', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Wrenn Lite', 'hand') }));
    const tree = g.zones.battlefield.find((id) => g.cards[g.objects[id]!.card]!.faces[0]!.name === 'Treefolk Token')!;
    const lands = g.zones.battlefield.filter((id) => g.objects[id]!.controller === 'alice' && chars(g, g.objects[id]!).types.includes('Land')).length;
    expect([chars(g, g.objects[tree]!).power, chars(g, g.objects[tree]!).toughness]).toEqual([lands, lands]);
  });

  it('Liliana of the Dark Realms: +X/+X or -X/-X, chosen as it resolves', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (let i = 0; i < 2; i++) give(g, 'alice', 'Plains', 'battlefield');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Dark Realms Lite', 'hand'), targets: [[obj(ogre)]] }));
    expect(g.pending?.kind).toBe('choose_option');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: '-X/-X' } }));
    expect(chars(g, g.objects[ogre]!).power).toBe(5 - 2);
  });
});

describe('staples (slice 212)', () => {
  it('Warden of the Grove: another creature endures X', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Warden Lite', 'hand') }));
    const cub = give(g, 'alice', 'Cub', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: cub }));
    expect(g.pending?.kind).toBe('may');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    expect(g.objects[cub]!.counters['+1/+1']).toBe(2);
  });

  it('Prosper: a Treasure whenever you play a card from exile', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Prosper Lite', 'battlefield');
    const griffin = give(g, 'alice', 'Misthollow Griffin', 'exile');
    for (const p of ['W', 'U']) g.players.alice!.pool[p as 'W']++;
    g = settle(act(g, { type: 'cast', player: 'alice', object: griffin }));
    expect(g.zones.battlefield.filter((id) => g.cards[g.objects[id]!.card]!.faces[0]!.name === 'Treasure').length).toBe(1);
  });

  it('Kwain: each player who draws gains 1 life', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const k = give(g, 'alice', 'Kwain Lite', 'battlefield');
    g.objects[k]!.sick = false;
    const [ha, hb, la, lb] = [g.zones.hand.alice!.length, g.zones.hand.bob!.length, g.players.alice!.life, g.players.bob!.life];
    g = settle(act(g, { type: 'activate', player: 'alice', object: k, ability: 0 }));
    for (let i = 0; i < 2 && g.pending?.kind === 'may'; i++) g = settle(act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'may', yes: g.pending.player === 'alice' } }));
    expect([g.zones.hand.alice!.length, g.zones.hand.bob!.length, g.players.alice!.life, g.players.bob!.life]).toEqual([ha + 1, hb, la + 1, lb]);
  });

  it('Turntimber Symbiosis: three extra counters on a creature with mana value 3 or less', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cub = give(g, 'alice', 'Cub', 'library');
    g.zones.library.alice = [cub, ...g.zones.library.alice!.filter((id) => id !== cub)];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Symbiosis Lite', 'hand') }));
    const p = g.pending;
    expect(p?.kind).toBe('choose_objects');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [cub] } }));
    expect(g.objects[cub]!.zone).toBe('battlefield');
    expect(g.objects[cub]!.counters['+1/+1']).toBe(3);
  });
});

describe('staples (slice 212): and/or', () => {
  it('Wrathful Red Dragon: a Dragon that dies of the damage still deals it (CR 113.7a)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Wrathful Lite', 'battlefield');
    const whelp = give(g, 'alice', 'Small Drake', 'battlefield');
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: whelp }]] }));
    expect(g.objects[whelp]!.zone).toBe('graveyard');
    expect(g.pending?.kind).toBe('trigger_targets');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } }));
    expect(g.players.bob!.life).toBe(life - 3);
  });

  it('Currency Converter: a token by whether the card put into the graveyard is a land', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const conv = give(g, 'alice', 'Converter Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'exile');
    g.objects[cub]!.exiledBy = { id: conv, zcc: g.objects[conv]!.zcc };
    g = settle(act(g, { type: 'activate', player: 'alice', object: conv, ability: 0 }));
    expect(g.objects[cub]!.zone).toBe('graveyard');
    const names = g.zones.battlefield.map((id) => g.cards[g.objects[id]!.card]!.faces[0]!.name);
    expect(names).toContain('Rogue Token');
    expect(names).not.toContain('Treasure');
  });

  it('Oathkeeper: exile equipped creature as it leaves (CR 603.10a)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    const eq = give(g, 'alice', 'Oathkeeper Lite', 'battlefield');
    g.objects[eq]!.attachedTo = { id: ogre, zcc: g.objects[ogre]!.zcc };
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Shatter Lite', 'hand'), targets: [[{ kind: 'object', object: eq }]] }));
    expect(g.objects[ogre]!.zone).toBe('exile');
  });

  it('In the Presence of Ages: up to one creature card and one land card', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [cub, bear] = [give(g, 'alice', 'Cub', 'library'), give(g, 'alice', 'Bear', 'library')];
    const forest = g.zones.library.alice!.find((id) => g.cards[g.objects[id]!.card]!.faces[0]!.name === 'Forest')!;
    const other = g.zones.library.alice!.find((id) => id !== forest && g.cards[g.objects[id]!.card]!.faces[0]!.name === 'Forest')!;
    g.zones.library.alice = [cub, bear, forest, other, ...g.zones.library.alice!.filter((id) => ![cub, bear, forest, other].includes(id))];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Presence Lite', 'hand') }));
    expect(g.pending?.kind).toBe('choose_objects');
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [cub, bear] } })).toMatch(/each kind/);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [cub, forest] } }));
    expect([cub, forest, bear, other].map((id) => g.objects[id]!.zone)).toEqual(['hand', 'hand', 'graveyard', 'graveyard']);
  });
});

describe('staples (slice 213): Springheart Nantuko, Opal Palace', () => {
  const bears = (g: GameState) => g.zones.battlefield.filter((id) => g.objects[id]!.card === 'Bear');
  const insects = (g: GameState) => g.zones.battlefield.filter((id) => g.objects[id]!.token && chars(g, g.objects[id]!).subtypes.includes('Insect'));
  it('Springheart Nantuko: bestowed, pay {1}{G} to copy the creature; unattached (or unpaid), an Insect', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g.players.alice!.pool.G = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Nantuko Lite', 'hand'), alt: 'bestow', targets: [[{ kind: 'object', object: bear }]] }));
    g.players.alice!.pool.G = 2;
    g = act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Forest', 'hand') });
    g = settle(g);
    expect(g.pending).toMatchObject({ kind: 'pay' });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true } }));
    expect(bears(g).length).toBe(2);
    expect(insects(g)).toEqual([]);
    // Declined: an Insect.
    g.players.alice!.landsPlayedThisTurn = 0;
    g = settle(act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Forest', 'hand') }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: false } }));
    expect(bears(g).length).toBe(2);
    expect(insects(g).length).toBe(1);
  });
  it('Springheart Nantuko: as a creature, a land just makes an Insect', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Nantuko Lite', 'battlefield');
    give(g, 'alice', 'Bear', 'battlefield');
    g.players.alice!.pool.G = 2;
    g = settle(act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Forest', 'hand') }));
    expect(g.pending).toBeFalsy();
    expect(bears(g).length).toBe(1);
    expect(insects(g).length).toBe(1);
  });
  it('Opal Palace: the commander enters with a +1/+1 counter for each time it has been cast from the command zone', () => {
    const deck = [...Array.from({ length: 40 }, () => 'Forest'), 'Kinnan, Bonder Prodigy', 'Opal Lite'];
    let g = toStep(start({ format: 'commander', extra: CARDS, decks: { alice: deck, bob: deck }, commanders: { alice: ['Kinnan, Bonder Prodigy'] } }), 'main1', 'alice');
    const palace = give(g, 'alice', 'Opal Lite', 'battlefield');
    const kinnan = g.zones.command.find((id) => g.objects[id]!.commander)!;
    g.players.alice!.pool.G = 2;
    g = act(g, { type: 'activate_mana', player: 'alice', object: palace, ability: 1, choice: 'U' });
    g = settle(act(g, { type: 'cast', player: 'alice', object: kinnan }));
    expect(g.objects[kinnan]).toMatchObject({ zone: 'battlefield', counters: { '+1/+1': 1 } });
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: kinnan, to: 'command' } });
    g.objects[palace]!.tapped = false;
    g.players.alice!.pool.G = 4; // {1} for the Palace; {2}{G} with the tax
    g = act(g, { type: 'activate_mana', player: 'alice', object: palace, ability: 1, choice: 'U' });
    g = settle(act(g, { type: 'cast', player: 'alice', object: kinnan }));
    expect(g.objects[kinnan]).toMatchObject({ zone: 'battlefield', counters: { '+1/+1': 2 } });
    // Without the Palace's mana, no counters.
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: kinnan, to: 'command' } });
    g.players.alice!.pool.G = 5;
    g.players.alice!.pool.U = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: kinnan }));
    expect(g.objects[kinnan]!.zone).toBe('battlefield');
    expect(g.objects[kinnan]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

describe('staples (slice 213): total mana value, tapped and attacking, fallbacks', () => {
  const onTop = (g: GameState, names: string[]) => {
    const lib = g.zones.library.alice!;
    const ids = names.map((n) => give(g, 'alice', n, 'library'));
    for (const id of ids) lib.splice(lib.indexOf(id), 1);
    lib.unshift(...ids);
    return ids;
  };
  it('Ghalta and Mavren: a tapped and attacking X/X, X the greatest power among the other attackers', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ghalta = give(g, 'alice', 'Ghalta Lite', 'battlefield');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [ghalta, ogre].map((attacker) => ({ attacker, target: { kind: 'player' as const, player: 'bob' } })) } });
    g = settle(g);
    const token = g.zones.battlefield.find((id) => g.objects[id]!.token)!;
    expect(token).toBeDefined();
    expect(g.objects[token]!.tapped).toBe(true);
    expect(chars(g, g.objects[token]!)).toMatchObject({ power: 5, toughness: 5 });
    expect(g.combat?.attackers[token]).toBeDefined();
  });
  it('Lively Dirge: up to two creature cards with total mana value 4 or less', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [bear, ogre, cub] = ['Bear', 'Ogre Three', 'Cub'].map((n) => give(g, 'alice', n, 'graveyard'));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Dirge Lite', 'hand') }));
    expect(g.pending).toMatchObject({ kind: 'choose_objects', max: 2, totalMV: { max: 4 } });
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [bear!, ogre!] } })).toMatch(/total mana value/);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [ogre!, cub!] } }));
    expect([bear, ogre, cub].map((id) => g.objects[id!]!.zone)).toEqual(['graveyard', 'battlefield', 'battlefield']);
  });
  it('Protean Hulk: any number of creature cards with total mana value 6 or less', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const hulk = give(g, 'alice', 'Hulk Lite', 'battlefield');
    const [bear, ogre, giant] = ['Bear', 'Ogre Three', 'Giant Four'].map((n) => give(g, 'alice', n, 'library'));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: hulk }]] }));
    expect(g.pending).toMatchObject({ kind: 'search', totalMV: { max: 6 } });
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [ogre!, giant!] } })).toMatch(/total mana value/);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [bear!, giant!] } }));
    expect([bear, ogre, giant].map((id) => g.objects[id!]!.zone)).toEqual(['battlefield', 'library', 'battlefield']);
  });
  it('Patch Up: up to three targets with total mana value 3 or less; a counter on each of them', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [bear, ogre, cub] = ['Bear', 'Ogre Three', 'Cub'].map((n) => give(g, 'alice', n, 'graveyard'));
    const patch = give(g, 'alice', 'Patch Lite', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: patch, targets: [[bear!, ogre!].map((object) => ({ kind: 'object' as const, object }))] })).toMatch(/total mana value 3 or less/);
    g = settle(act(g, { type: 'cast', player: 'alice', object: patch, targets: [[bear!, cub!].map((object) => ({ kind: 'object' as const, object }))] }));
    expect([bear, ogre, cub].map((id) => g.objects[id!]!.zone)).toEqual(['battlefield', 'graveyard', 'battlefield']);
    expect([bear, cub].map((id) => g.objects[id!]!.counters['+1/+1'])).toEqual([1, 1]);
  });
  it('Planar Genesis: a land onto the battlefield tapped; if you don\'t, a card into your hand', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    let [forest, bear] = onTop(g, ['Forest', 'Bear', 'Cub', 'Trinket']);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Genesis Lite', 'hand') }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [forest!] } }));
    expect(g.objects[forest!]).toMatchObject({ zone: 'battlefield', tapped: true });
    expect(g.zones.library.alice!.slice(-3).length).toBe(3);
    [forest, bear] = onTop(g, ['Forest', 'Bear', 'Cub', 'Trinket']);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Genesis Lite', 'hand') }));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [] } });
    expect(g.pending).toMatchObject({ kind: 'choose_objects', min: 1, max: 1 });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [bear!] } }));
    expect(g.objects[bear!]!.zone).toBe('hand');
    expect(g.objects[forest!]!.zone).toBe('library');
    expect(g.zones.library.alice![0]).not.toBe(forest);
  });
  it('Flame of Anor: two modes only with a Wizard', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const flame = give(g, 'alice', 'Anor Lite', 'hand');
    const trinket = give(g, 'bob', 'Trinket', 'battlefield');
    const targets = [[{ kind: 'player' as const, player: 'alice' }], [{ kind: 'object' as const, object: trinket }]];
    expect(illegal(g, { type: 'cast', player: 'alice', object: flame, modes: [0, 1], targets })).toMatch(/mode/);
    give(g, 'alice', 'Wizard Lite', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: flame, modes: [0, 1], targets }));
    expect(g.objects[trinket]!.zone).toBe('graveyard');
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });
  it('Conduit of Worlds: cast a permanent card from your graveyard, paying its costs; then no more spells this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const conduit = give(g, 'alice', 'Conduit of Worlds Lite', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'graveyard');
    g.players.alice!.pool.G = 2;
    g = settle(act(g, { type: 'activate', player: 'alice', object: conduit, ability: 0, targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.pending).toMatchObject({ kind: 'cast_free' });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: true } }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Salve', 'hand') })).toMatch(/can't cast/);
  });
  it('Conduit of Worlds: not after you\'ve cast a spell this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const conduit = give(g, 'alice', 'Conduit of Worlds Lite', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'graveyard');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Salve', 'hand') }));
    g.players.alice!.pool.G = 2;
    g = settle(act(g, { type: 'activate', player: 'alice', object: conduit, ability: 0, targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.pending).toBeFalsy();
    expect(g.objects[bear]!.zone).toBe('graveyard');
  });
  it("Michelangelo's Technique: up to two creature cards with total mana value 6 or less from among them", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [giant, ogre, bear] = onTop(g, ['Giant Four', 'Ogre Three', 'Bear']);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Technique Lite', 'hand') }));
    expect(g.pending).toMatchObject({ kind: 'choose_objects', totalMV: { max: 6 } });
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [giant!, ogre!] } })).toMatch(/total mana value/);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [giant!, bear!] } }));
    expect([giant, ogre, bear].map((id) => g.objects[id!]!.zone)).toEqual(['battlefield', 'library', 'battlefield']);
  });
  it("Tibalt's Trickery: mill 1–3, then exile to a nonland card with another name, which its controller may cast free", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lib = g.zones.library.alice!;
    const cub2 = give(g, 'alice', 'Cub', 'library');
    const bear = give(g, 'alice', 'Bear', 'library');
    const forests = [0, 1, 2].map(() => give(g, 'alice', 'Forest', 'library'));
    for (const id of [cub2, bear, ...forests]) lib.splice(lib.indexOf(id), 1);
    lib.unshift(...forests, cub2, bear);
    const cub = give(g, 'alice', 'Cub', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: cub });
    g = act(g, { type: 'pass', player: 'alice' });
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Trickery Lite', 'hand'), targets: [[{ kind: 'object', object: cub }]] }));
    expect(g.objects[cub]!.zone).toBe('graveyard');
    expect(g.pending).toMatchObject({ kind: 'cast_free', player: 'alice', object: bear });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: true } }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    const milled = forests.filter((id) => g.objects[id]!.zone === 'graveyard').length;
    expect(milled).toBeGreaterThanOrEqual(1);
    expect(milled).toBeLessThanOrEqual(3);
    // The Cub (same name) and any unmilled Forests went to the bottom.
    expect(g.objects[cub2]!.zone).toBe('library');
    expect(g.zones.library.alice!.slice(-(4 - milled)).sort()).toEqual([cub2, ...forests.filter((id) => g.objects[id]!.zone === 'library')].sort());
  });
  it("Powerstone mana: can't be spent to cast a nonartifact spell", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const helper = give(g, 'alice', 'Hydraulic Lite', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: helper, ability: 0 });
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Blue Salve', 'hand') })).toMatch(/mana/);
    const trinket = give(g, 'alice', 'Trinket', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: trinket }));
    expect(g.objects[trinket]!.zone).toBe('battlefield');
  });
  it('Singularity Rupture: each target player mills half their own library', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [a, b] = [g.zones.library.alice!.length, g.zones.library.bob!.length];
    for (let i = 0; i < 10; i++) give(g, 'bob', 'Forest', 'library');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Rupture Lite', 'hand'), targets: [[{ kind: 'player', player: 'alice' }, { kind: 'player', player: 'bob' }]] }));
    expect(g.zones.library.alice!.length).toBe(a - Math.floor(a / 2));
    expect(g.zones.library.bob!.length).toBe(b + 10 - Math.floor((b + 10) / 2));
  });
  it('Whelming Wave: all creatures except Krakens, Leviathans, Octopuses, and Serpents', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const kraken = give(g, 'bob', 'Kraken Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Wave Lite', 'hand') }));
    expect([g.objects[bear]!.zone, g.objects[kraken]!.zone]).toEqual(['hand', 'battlefield']);
  });
  it('Klauth: mana in any combination of colors equal to the attackers\' total power, kept until end of turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const klauth = give(g, 'alice', 'Klauth Lite', 'battlefield');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [klauth, ogre].map((attacker) => ({ attacker, target: { kind: 'player' as const, player: 'bob' } })) } });
    g = settle(g);
    for (let i = 0; i < 8; i++) {
      expect(g.pending).toMatchObject({ kind: 'choose_option' });
      g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: i < 2 ? 'R' : 'G' } });
    }
    g = settle(g);
    const kept = () => (g.players.alice!.restricted ?? []).reduce((n, r) => n + r.amount, 0);
    expect(kept()).toBe(8);
    for (let i = 0; i < 30 && g.step !== 'main2'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } } as never);
      else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
      else break;
    }
    expect(g.step).toBe('main2');
    expect(kept()).toBe(8);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Giant Four', 'hand') }));
    expect(kept()).toBe(4);
  });
  it('Pact of the Serpent: X is the number of creatures of the chosen type that target player controls', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'bob', 'Ogre', 'battlefield');
    give(g, 'bob', 'Ogre Three', 'battlefield');
    give(g, 'bob', 'Bear', 'battlefield');
    const [hand, life] = [g.zones.hand.bob!.length, g.players.bob!.life];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Pact Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.pending).toMatchObject({ kind: 'choose_option' });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: 'Ogre' } }));
    expect([g.zones.hand.bob!.length, g.players.bob!.life]).toEqual([hand + 2, life - 2]);
  });
  it("Ao, the Dawn Sky: each permanent you control that's a creature or Vehicle", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const trinket = give(g, 'alice', 'Trinket', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ao Lite', 'hand') }));
    expect(g.objects[bear]!.counters['+1/+1']).toBe(2);
    expect(g.objects[trinket]!.counters['+1/+1'] ?? 0).toBe(0);
  });
});

describe('staples (slice 214)', () => {
  it('Intuition: the opponent chooses which revealed card goes to your hand', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [bear, ogre, cub] = ['Bear', 'Ogre Three', 'Cub'].map((n) => give(g, 'alice', n, 'library'));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Intuition Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [bear!, ogre!, cub!] } });
    expect(g.pending).toMatchObject({ kind: 'choose_objects', player: 'bob', min: 1, max: 1 });
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'choose_objects', objects: [cub!] } }));
    expect([bear, ogre, cub].map((id) => g.objects[id!]!.zone)).toEqual(['graveyard', 'graveyard', 'hand']);
  });
  it('Gifts Ungiven: up to four with different names; the two the opponent chooses go to the graveyard', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [bear, ogre, cub, bear2] = ['Bear', 'Ogre Three', 'Cub', 'Bear'].map((n) => give(g, 'alice', n, 'library'));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Gifts Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [bear!, bear2!, cub!] } })).toMatch(/different names/);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [bear!, ogre!, cub!] } });
    expect(g.pending).toMatchObject({ kind: 'choose_objects', player: 'bob', min: 2, max: 2 });
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'choose_objects', objects: [bear!, ogre!] } }));
    expect([bear, ogre, cub, bear2].map((id) => g.objects[id!]!.zone)).toEqual(['graveyard', 'graveyard', 'hand', 'library']);
  });
  it("Lair of the Hydra: X can't be 0", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lair = give(g, 'alice', 'Hydra Lair Lite', 'battlefield');
    g.players.alice!.pool.G = 4;
    expect(illegal(g, { type: 'activate', player: 'alice', object: lair, ability: 0, x: 0 })).toMatch(/X can't be less than 1/);
    g = settle(act(g, { type: 'activate', player: 'alice', object: lair, ability: 0, x: 3 }));
    expect(chars(g, g.objects[lair]!)).toMatchObject({ power: 3, toughness: 3 });
  });
  it("Ugin's Labyrinth: {C}{C} while a card is exiled with it", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const big = give(g, 'alice', 'Big Eldrazi', 'hand');
    const lab = give(g, 'alice', 'Labyrinth Lite', 'hand');
    g = act(g, { type: 'play_land', player: 'alice', object: lab });
    g = settle(g);
    if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    if (g.pending?.kind === 'choose_objects') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [big] } });
    g = settle(g);
    expect(g.objects[big]!.zone).toBe('exile');
    g = act(g, { type: 'activate_mana', player: 'alice', object: lab, ability: 0 });
    expect(g.players.alice!.pool.C).toBe(2);
  });
  it('Final Parting: one of the two found cards to your hand, the other to your graveyard', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [bear, ogre] = ['Bear', 'Ogre Three'].map((n) => give(g, 'alice', n, 'library'));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Parting Lite', 'hand') }));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [bear!, ogre!] } });
    expect(g.pending).toMatchObject({ kind: 'choose_objects', player: 'alice', min: 1, max: 1 });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [ogre!] } }));
    expect([g.objects[bear!]!.zone, g.objects[ogre!]!.zone]).toEqual(['graveyard', 'hand']);
  });
  it('Emiel the Blessed: two counters instead on a Unicorn, if you paid', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Emiel Lite', 'battlefield');
    for (const [name, want] of [['Cub', 1], ['Unicorn Lite', 2]] as const) {
      g.players.alice!.pool.G = 1;
      const id = give(g, 'alice', name, 'hand');
      g = settle(act(g, { type: 'cast', player: 'alice', object: id }));
      if (g.pending?.kind === 'pay') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true } }));
      expect(g.objects[id]!.counters['+1/+1']).toBe(want);
    }
  });
  it('Rousing Refrain: exiled with three time counters, it is suspended (CR 702.62b)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const refrain = give(g, 'alice', 'Refrain Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: refrain, targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.objects[refrain]).toMatchObject({ zone: 'exile', counters: { time: 3 } });
    expect(g.players.alice!.restricted?.reduce((n, r) => n + r.amount, 0)).toBe(g.zones.hand.bob!.length);
    g = toStep(toStep(g, 'main1', 'bob'), 'main1', 'alice');
    expect(g.objects[refrain]!.counters.time).toBe(2);
  });
  it("Ziatora: the sacrificed creature's power, as it last existed (CR 608.2h)", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Ziatora Lite', 'battlefield');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    const life = g.players.bob!.life;
    g = toStep(g, 'end', 'alice');
    g = settle(g);
    for (let i = 0; i < 6 && g.pending; i++) {
      const p = g.pending;
      if (p.kind === 'may') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
      else if (p.kind === 'sacrifice') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'sacrifice', objects: [ogre] } }));
      else if (p.kind === 'trigger_targets') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } }));
      else break;
    }
    expect(g.objects[ogre]!.zone).toBe('graveyard');
    expect(g.players.bob!.life).toBe(life - 5);
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token).length).toBe(3);
  });
  it('Wake the Past: "they" are the permanents the returned cards became', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const c = give(g, 'alice', 'Construct Lite', 'graveyard');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Wake Lite', 'hand') }));
    expect(g.objects[c]!.zone).toBe('battlefield');
    expect(chars(g, g.objects[c]!).keywords.some((k) => k.id === 'haste')).toBe(true);
  });
  it("Windgrace's Judgment: a target for any number of opponents", () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const b = give(g, 'bob', 'Trinket', 'battlefield');
    const c = give(g, 'carol', 'Trinket', 'battlefield');
    const judgment = give(g, 'alice', 'Judgment Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: judgment, targets: [[{ kind: 'object', object: b }]] }));
    expect([g.objects[b]!.zone, g.objects[c]!.zone]).toEqual(['graveyard', 'battlefield']);
  });
  for (const name of ['Inkshield Lite', 'Palm Lite'] as const) {
    it(`${name}: what it does with the damage it prevented (CR 615.5)`, () => {
      let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
      const ogre = give(g, 'bob', 'Ogre', 'battlefield');
      g = act(g, { type: 'pass', player: 'bob' });
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand') });
      g = settle(g);
      if (g.pending?.kind === 'choose_objects') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [ogre] } }));
      const [a, b] = [g.players.alice!.life, g.players.bob!.life];
      g = toAttack(toStep(g, 'beginning_of_combat'));
      g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: ogre, target: { kind: 'player', player: 'alice' } }] } });
      for (let i = 0; i < 30 && g.step !== 'end'; i++) {
        if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_blockers', blocks: [] } } as never);
        else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
        else break;
      }
      expect(g.players.alice!.life).toBe(a);
      if (name === 'Inkshield Lite') expect(g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice').length).toBe(5);
      else expect(g.players.bob!.life).toBe(b - 5);
    });
  }
  it('Selfless Squire: that many counters when damage to you is prevented', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const squire = give(g, 'alice', 'Squire Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: squire }));
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] }));
    expect(g.players.alice!.life).toBe(life);
    expect(g.objects[squire]!.counters['+1/+1']).toBe(3);
  });
  it('Vigor: counters instead of damage on another creature you control', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const vigor = give(g, 'alice', 'Vigor Lite', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[bear]).toMatchObject({ zone: 'battlefield', damage: 0, counters: { '+1/+1': 3 } });
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: vigor }]] }));
    expect(g.objects[vigor]).toMatchObject({ damage: 3 });
  });
  it('Silkguard: a counter on each of up to X targets; Auras, Equipment and modified creatures gain hexproof', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [a, b, c] = [0, 1, 2].map(() => give(g, 'alice', 'Bear', 'battlefield'));
    const silk = give(g, 'alice', 'Silkguard Lite', 'hand');
    g.players.alice!.pool.G = 3;
    expect(illegal(g, { type: 'cast', player: 'alice', object: silk, x: 2, targets: [[a!, b!, c!].map((object) => ({ kind: 'object' as const, object }))] })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: silk, x: 2, targets: [[a!, b!].map((object) => ({ kind: 'object' as const, object }))] }));
    expect([a, b, c].map((id) => g.objects[id!]!.counters['+1/+1'] ?? 0)).toEqual([1, 1, 0]);
    const hexproof = (id: string) => chars(g, g.objects[id]!).keywords.some((k) => k.id === 'hexproof');
    expect([a, b, c].map((id) => hexproof(id!))).toEqual([true, true, false]);
  });
});

describe('staples (slice 215)', () => {
  it('Breach the Multiverse: one creature or planeswalker card from each graveyard, all under your control', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mine = give(g, 'alice', 'Bear', 'graveyard');
    const [o1, o2] = [give(g, 'bob', 'Ogre', 'graveyard'), give(g, 'bob', 'Walker', 'graveyard')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Breach Lite', 'hand') }));
    for (let i = 0; i < 4 && g.pending?.kind === 'choose_objects'; i++) {
      const p = g.pending;
      const pick = p.candidates.includes(o2) ? o2 : p.candidates.includes(mine) ? mine : p.candidates[0]!;
      g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [pick] } }));
    }
    expect([g.objects[mine]!.zone, g.objects[o2]!.zone, g.objects[o1]!.zone]).toEqual(['battlefield', 'battlefield', 'graveyard']);
    expect(g.objects[o2]!.controller).toBe('alice');
    expect(chars(g, g.objects[mine]!).subtypes).toContain('Phyrexian');
  });
  it('Test of Faith: a counter on the target for each damage its shield prevented', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Faith Lite', 'hand'), targets: [[{ kind: 'object', object: ogre }]] }));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: ogre }]] }));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: ogre }]] }));
    expect(g.objects[ogre]).toMatchObject({ damage: 3, counters: { '+1/+1': 3 } });
  });
  it('Moraug: landfall in main 2 adds a combat that begins by untapping; +1/+0 for each attack this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Moraug Lite', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const attack = () => {
      g = toAttack(toStep(g, 'beginning_of_combat'));
      g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: bear, target: { kind: 'player', player: 'bob' } }] } });
    };
    attack();
    expect(chars(g, g.objects[bear]!).power).toBe(3);
    g = toStep(g, 'main2', 'alice');
    expect(g.objects[bear]!.tapped).toBe(true);
    g = settle(act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Forest', 'hand') }));
    g = settle(g);
    for (let i = 0; i < 20 && g.step !== 'beginning_of_combat'; i++) if (g.priority) g = act(g, { type: 'pass', player: g.priority });
    g = settle(g);
    expect(g.step).toBe('beginning_of_combat');
    for (let i = 0; i < 10 && g.objects[bear]!.tapped && g.priority; i++) g = act(g, { type: 'pass', player: g.priority });
    expect(g.objects[bear]!.tapped).toBe(false);
    g = toAttack(g);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: bear, target: { kind: 'player', player: 'bob' } }] } });
    expect(chars(g, g.objects[bear]!).power).toBe(4);
  });
  it('Chain of Vapor: the bounced permanent\'s controller may sacrifice a land to copy it, with a new target', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const land = give(g, 'bob', 'Forest', 'battlefield');
    const trinket = give(g, 'alice', 'Trinket', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Vapor Lite', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.pending).toMatchObject({ kind: 'choose_objects', player: 'bob' });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'choose_objects', objects: [land] } });
    expect(g.pending).toMatchObject({ kind: 'may', player: 'bob' });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'may', yes: true } });
    expect(g.pending).toMatchObject({ kind: 'copy_targets', player: 'bob' });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'copy_targets', targets: [[{ kind: 'object', object: trinket }]] } });
    g = settle(g);
    // Alice may now chain it back; she has no land.
    expect([g.objects[bear]!.zone, g.objects[land]!.zone, g.objects[trinket]!.zone]).toEqual(['hand', 'graveyard', 'hand']);
  });
  it('Chain Lightning: the damaged player may pay {R}{R} to copy it back', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [a, b] = [g.players.alice!.life, g.players.bob!.life];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Lightning Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.pending).toMatchObject({ kind: 'pay', player: 'bob' });
    g.players.bob!.pool.R = 2;
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'pay', pay: true } });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'may', yes: true } });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'copy_targets', targets: [[{ kind: 'player', player: 'alice' }]] } });
    g = settle(g);
    if (g.pending?.kind === 'pay') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: false } }));
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([a - 3, b - 3]);
  });
  it('Ripples of Potential: proliferate, then phase out any of yours that got a counter', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [a, b] = [give(g, 'alice', 'Bear', 'battlefield'), give(g, 'alice', 'Bear', 'battlefield')];
    const theirs = give(g, 'bob', 'Bear', 'battlefield');
    for (const id of [a, b, theirs]) g.objects[id]!.counters['+1/+1'] = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ripples Lite', 'hand') }));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'proliferate', objects: [a, theirs], players: [] } });
    expect(g.pending).toMatchObject({ kind: 'choose_objects', candidates: [a] });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [a] } }));
    expect([g.objects[a]!.phasedOut, g.objects[b]!.phasedOut, g.objects[theirs]!.phasedOut]).toEqual(['directly', undefined, undefined]);
    expect(g.objects[theirs]!.counters['+1/+1']).toBe(2);
  });
  it("Mizzix's Mastery: copy the exiled card and cast the copy free; overloaded, each of them in the order chosen", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const salve = give(g, 'alice', 'Salve', 'graveyard');
    const life = g.players.alice!.life;
    const mastery = give(g, 'alice', 'Mastery Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: mastery, targets: [[{ kind: 'object', object: salve }]] }));
    expect(g.pending).toMatchObject({ kind: 'cast_free' });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: true } }));
    expect(g.players.alice!.life).toBe(life + 3);
    expect([g.objects[salve]!.zone, g.objects[mastery]!.zone]).toEqual(['exile', 'exile']);
    // Overloaded: each instant and sorcery card in the graveyard.
    const [s1, s2] = [give(g, 'alice', 'Salve', 'graveyard'), give(g, 'alice', 'Gift of Words', 'graveyard')];
    g.players.alice!.pool.C = 1;
    const hand = g.zones.hand.bob!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mastery Lite', 'hand'), alt: 'overload', autoTap: true }));
    expect(g.pending).toMatchObject({ kind: 'choose_objects', ordered: true });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [s2, s1] } });
    for (let i = 0; i < 2; i++) g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: true } });
    g = settle(g);
    expect(g.players.alice!.life).toBe(life + 6);
    expect(g.zones.hand.bob!.length).toBe(hand + 2);
  });
});

describe('staples (slice 216)', () => {
  it("Praetor's Grasp: a card from their library, face down, that you may play while it remains exiled", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cub = give(g, 'bob', 'Cub', 'library');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Grasp Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [cub] } }));
    expect(g.objects[cub]).toMatchObject({ zone: 'exile', hiddenFor: 'alice' });
    g = settle(act(g, { type: 'cast', player: 'alice', object: cub }));
    expect(g.objects[cub]).toMatchObject({ zone: 'battlefield', controller: 'alice' });
  });
  it('Explore the Vastlands: each player takes up to a land and an instant or sorcery from their top five', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const put = (p: 'alice' | 'bob', names: string[]) => {
      const lib = g.zones.library[p]!;
      const ids = names.map((n) => give(g, p, n, 'library'));
      for (const id of ids) lib.splice(lib.indexOf(id), 1);
      lib.unshift(...ids);
      return ids;
    };
    const [af, as] = put('alice', ['Forest', 'Salve', 'Bear', 'Forest', 'Salve']);
    const [bf] = put('bob', ['Forest', 'Bear', 'Bear', 'Bear', 'Bear']);
    const [la, lb] = [g.players.alice!.life, g.players.bob!.life];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Vastlands Lite', 'hand') }));
    expect(g.pending).toMatchObject({ kind: 'choose_objects', player: 'alice' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [af!, as!] } });
    expect(g.pending).toMatchObject({ kind: 'choose_objects', player: 'bob' });
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'choose_objects', objects: [bf!] } }));
    expect([g.objects[af!]!.zone, g.objects[as!]!.zone, g.objects[bf!]!.zone]).toEqual(['hand', 'hand', 'hand']);
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([la + 3, lb + 3]);
  });
  it('Kozilek, the Great Distortion: discard a card with mana value X to counter a spell with mana value X', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const koz = give(g, 'alice', 'Kozilek Lite', 'battlefield');
    const [two, three] = [give(g, 'alice', 'Bear', 'hand'), give(g, 'alice', 'Ogre Three', 'hand')];
    g.players.bob!.pool.G = 2;
    const spell = give(g, 'bob', 'Bear', 'hand');
    g = act(g, { type: 'cast', player: 'bob', object: spell, autoTap: true });
    g = act(g, { type: 'pass', player: 'bob' });
    const target = [[{ kind: 'object' as const, object: spell }]];
    expect(illegal(g, { type: 'activate', player: 'alice', object: koz, ability: 0, x: 2, targets: target, costs: { discard: [three!] } })).toBeTruthy();
    expect(illegal(g, { type: 'activate', player: 'alice', object: koz, ability: 0, x: 3, targets: target, costs: { discard: [three!] } })).toBeTruthy();
    g = settle(act(g, { type: 'activate', player: 'alice', object: koz, ability: 0, x: 2, targets: target, costs: { discard: [two!] } }));
    expect([g.objects[spell]!.zone, g.objects[two!]!.zone]).toEqual(['graveyard', 'graveyard']);
  });
  it("Sakashima of a Thousand Faces: a copy that keeps its other abilities (no legend rule)", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ghalta = give(g, 'alice', 'Ghalta Lite', 'battlefield');
    const saka = give(g, 'alice', 'Sakashima Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: saka }));
    expect(g.pending).toMatchObject({ kind: 'as_enters' });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', copy: ghalta } }));
    expect([g.objects[ghalta]!.zone, g.objects[saka]!.zone]).toEqual(['battlefield', 'battlefield']);
    expect(chars(g, g.objects[saka]!).name).toBe('Ghalta Lite');
  });
  it('Party Thrasher: exile two, choose one of them, play it this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const thrasher = give(g, 'alice', 'Thrasher Lite', 'battlefield');
    const junk = give(g, 'alice', 'Trinket', 'hand');
    const lib = g.zones.library.alice!;
    const [c1, c2] = [give(g, 'alice', 'Cub', 'library'), give(g, 'alice', 'Salve', 'library')];
    for (const id of [c1, c2]) lib.splice(lib.indexOf(id), 1);
    lib.unshift(c1, c2);
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: thrasher, target: { kind: 'player', player: 'bob' } }] } });
    g = settle(g);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    if (g.pending?.kind === 'discard') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: [junk] } });
    expect(g.pending).toMatchObject({ kind: 'choose_objects', candidates: [c1, c2] });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [c2] } }));
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === c2)).toBe(true);
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === c1)).toBe(false);
  });
  it('Eerie Ultimatum: permanent cards with different names', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [b1, b2, t1] = [give(g, 'alice', 'Bear', 'graveyard'), give(g, 'alice', 'Bear', 'graveyard'), give(g, 'alice', 'Trinket', 'graveyard')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ultimatum Lite', 'hand') }));
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [b1, b2, t1] } })).toMatch(/different names/);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [b1, t1] } }));
    expect([b1, b2, t1].map((id) => g.objects[id]!.zone)).toEqual(['battlefield', 'graveyard', 'battlefield']);
  });
  it('Ugin, the Ineffable: the face-down card comes to hand when the Spirit token leaves', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ugin = give(g, 'alice', 'Ugin Lite', 'battlefield');
    g.objects[ugin]!.counters.loyalty = 4;
    const top = g.zones.library.alice![0]!;
    g = settle(act(g, { type: 'activate', player: 'alice', object: ugin, ability: 0 }));
    expect(g.objects[top]).toMatchObject({ zone: 'exile', hiddenFor: 'alice' });
    const token = g.zones.battlefield.find((id) => g.objects[id]!.token)!;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: token }]] }));
    expect(g.objects[top]!.zone).toBe('hand');
  });
  it('Beseech the Mirror: bargained, cast the found card free (mana value 4 or less); otherwise it goes to hand', () => {
    for (const bargain of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const trinket = give(g, 'alice', 'Trinket', 'battlefield');
      const bear = give(g, 'alice', 'Bear', 'library');
      const beseech = give(g, 'alice', 'Beseech Lite', 'hand');
      g = settle(act(g, { type: 'cast', player: 'alice', object: beseech, ...(bargain ? { extras: ['bargain'], costs: { sacrifice: [trinket] } } : {}) }));
      g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [bear] } });
      if (bargain) {
        expect(g.pending).toMatchObject({ kind: 'cast_free', object: bear });
        g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: true } }));
        expect([g.objects[bear]!.zone, g.objects[trinket]!.zone]).toEqual(['battlefield', 'graveyard']);
      } else {
        g = settle(g);
        expect(g.objects[bear]!.zone).toBe('hand');
      }
    }
  });
});

describe('staples (slice 218)', () => {
  it('Hostage Taker (2025 wording): "mana of any type can be spent to cast that spell"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Hostage Taker 2025', 'hand') }));
    if (g.pending?.kind === 'trigger_targets') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: bear }]] } }));
    expect(g.objects[bear]!.zone).toBe('exile');
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.objects[bear]!.controller).toBe('alice');
  });

  it('Dire Fleet Daredevil: cast the exiled instant this turn with any mana; it is exiled instead of going to a graveyard', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const salve = give(g, 'bob', 'White Salve', 'graveyard');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Dire Fleet Daredevil', 'hand') }));
    if (g.pending?.kind === 'trigger_targets') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: salve }]] } }));
    expect(g.objects[salve]!.zone).toBe('exile');
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: salve }));
    expect(g.players.alice!.life).toBe(21);
    expect(g.objects[salve]!.zone).toBe('exile');
  });

  it('Dire Fleet Daredevil: the permission ends with the turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const salve = give(g, 'bob', 'White Salve', 'graveyard');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Dire Fleet Daredevil', 'hand') }));
    if (g.pending?.kind === 'trigger_targets') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: salve }]] } }));
    g = toStep(g, 'main1', 'bob');
    g.players.alice!.pool.W = 1;
    expect(illegal(g, { type: 'cast', player: 'alice', object: salve })).toBeTruthy();
  });

  it('Ugin, Eye of the Storms: exile any number of colorless nonland cards; cast them free this turn only', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [t1, t2, bear] = ['Trinket', 'Trinket', 'Bear'].map((n) => give(g, 'alice', n, 'library'));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Eye of the Storms Lite', 'hand') }));
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [t1!, bear!] } })).toBeTruthy();
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [t1!, t2!] } }));
    expect([t1, t2, bear].map((id) => g.objects[id!]!.zone)).toEqual(['exile', 'exile', 'library']);
    g = settle(act(g, { type: 'cast', player: 'alice', object: t1! }));
    expect(g.objects[t1!]!.zone).toBe('battlefield');
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    g.players.alice!.pool.C = 1;
    expect(illegal(g, { type: 'cast', player: 'alice', object: t2! })).toBeTruthy();
  });

  it("Lae'zel: one more counter on your creatures, planeswalkers (entering, loyalty costs) and yourself", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', "Lae'zel Lite", 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    const theirs = give(g, 'bob', 'Cub', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolster Lite', 'hand'), targets: [[{ kind: 'object', object: cub }]] }));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolster Lite', 'hand'), targets: [[{ kind: 'object', object: theirs }]] }));
    expect([g.objects[cub]!.counters['+1/+1'], g.objects[theirs]!.counters['+1/+1']]).toEqual([4, 3]);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Energy Lite', 'hand') }));
    expect(g.players.alice!.counters?.energy).toBe(4);
    const walker = give(g, 'alice', 'Walker Three', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: walker }));
    expect(g.objects[walker]!.counters.loyalty).toBe(4);
    g = settle(act(g, { type: 'activate', player: 'alice', object: walker, ability: 0 }));
    expect(g.objects[walker]!.counters.loyalty).toBe(6);
  });

  it('Vorinclex: twice the counters you put (players and loyalty costs too); half what opponents put, rounded down', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Vorinclex Lite', 'battlefield');
    const walker = give(g, 'alice', 'Walker Three', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: walker }));
    expect(g.objects[walker]!.counters.loyalty).toBe(6);
    g = settle(act(g, { type: 'activate', player: 'alice', object: walker, ability: 0 }));
    expect(g.objects[walker]!.counters.loyalty).toBe(8);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Energy Lite', 'hand') }));
    expect(g.players.alice!.counters?.energy).toBe(6);
    g = toStep(g, 'main1', 'bob');
    const cub = give(g, 'bob', 'Cub', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bolster Lite', 'hand'), targets: [[{ kind: 'object', object: cub }]] }));
    expect(g.objects[cub]!.counters['+1/+1']).toBe(1);
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Energy Lite', 'hand') }));
    expect(g.players.bob!.counters?.energy).toBe(1);
  });

  it('Doubling Season: a planeswalker enters with twice its loyalty, but a loyalty cost isn\'t doubled', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Season Lite', 'battlefield');
    const walker = give(g, 'alice', 'Walker Three', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: walker }));
    expect(g.objects[walker]!.counters.loyalty).toBe(6);
    g = settle(act(g, { type: 'activate', player: 'alice', object: walker, ability: 0 }));
    expect(g.objects[walker]!.counters.loyalty).toBe(7);
  });

  it('Sting: first strike while blocked by a Goblin — it kills the blocker and survives', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const sting = give(g, 'alice', 'Sting Lite', 'battlefield');
    g.objects[sting]!.attachedTo = { id: bear, zcc: g.objects[bear]!.zcc };
    const goblin = give(g, 'bob', 'Goblin Pair', 'battlefield');
    expect(chars(g, g.objects[bear]!).keywords.some((k) => k.id === 'first_strike')).toBe(false);
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: bear, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 40 && g.step !== 'main2'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks: [{ blocker: goblin, attacker: bear }] } });
      else if (g.pending) break;
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.objects[goblin]!.zone).toBe('graveyard');
    expect(g.objects[bear]!.zone).toBe('battlefield');
  });

  it('Chainer: one creature spell from your graveyard this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const chainer = give(g, 'alice', 'Chainer Adept Lite', 'battlefield');
    const [cub1, cub2, trinket] = ['Cub', 'Cub', 'Trinket'].map((n) => give(g, 'alice', n, 'graveyard'));
    const fodder = give(g, 'alice', 'Cub', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: cub1! })).toBeTruthy();
    g = settle(act(g, { type: 'activate', player: 'alice', object: chainer, ability: 0, costs: { discard: [fodder] } }));
    g.players.alice!.pool.C = 1;
    expect(illegal(g, { type: 'cast', player: 'alice', object: trinket! })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: cub1! }));
    expect(g.objects[cub1!]!.zone).toBe('battlefield');
    expect(illegal(g, { type: 'cast', player: 'alice', object: cub2! })).toBeTruthy();
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    expect(illegal(g, { type: 'cast', player: 'alice', object: cub2! })).toBeTruthy();
  });

  it('Druid Class level 3: a land creature whose power and toughness keep counting your lands', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    give(g, 'alice', 'Forest', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Land Awakening Lite', 'hand'), targets: [[{ kind: 'object', object: forest }]] }));
    let c = chars(g, g.objects[forest]!);
    expect([c.types.includes('Creature'), c.types.includes('Land'), c.power, c.toughness]).toEqual([true, true, 2, 2]);
    expect(c.keywords.some((k) => k.id === 'haste')).toBe(true);
    give(g, 'alice', 'Forest', 'battlefield');
    c = chars(g, g.objects[forest]!);
    expect([c.power, c.toughness]).toEqual([3, 3]);
  });

  it('Chimeric Mass: a creature until end of turn, its power and toughness the charge counters on it', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mass = give(g, 'alice', 'Chimeric Lite', 'battlefield');
    g.objects[mass]!.counters.charge = 3;
    g = settle(act(g, { type: 'activate', player: 'alice', object: mass, ability: 0 }));
    expect([chars(g, g.objects[mass]!).power, chars(g, g.objects[mass]!).toughness]).toEqual([3, 3]);
    g.objects[mass]!.counters.charge = 5;
    expect(chars(g, g.objects[mass]!).power).toBe(5);
    g = toStep(g, 'main1', 'bob');
    expect(chars(g, g.objects[mass]!).types.includes('Creature')).toBe(false);
  });

  it('Ajani Goldmane: the Avatar token has "power and toughness each equal to your life total"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ajani Token Lite', 'hand') }));
    const token = g.zones.battlefield.find((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice')!;
    expect(chars(g, g.objects[token]!).power).toBe(20);
    g.players.alice!.life = 7;
    expect(chars(g, g.objects[token]!).toughness).toBe(7);
  });

  it('Hoarding Dragon: the artifact it exiled comes to hand when it dies', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const trinket = give(g, 'alice', 'Trinket', 'library');
    const dragon = give(g, 'alice', 'Hoarding Dragon Lite', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: dragon });
    for (let i = 0; i < 20; i++) {
      if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
      else if (g.pending?.kind === 'search') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [trinket!] } });
      else if (g.pending) break;
      else if (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
      else break;
    }
    expect(g.objects[trinket!]!.zone).toBe('exile');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: dragon }]] });
    g.objects[dragon]!.damage = 3;
    for (let i = 0; i < 20; i++) {
      if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
      else if (g.pending) break;
      else if (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
      else break;
    }
    expect(g.objects[dragon]!.zone).toBe('graveyard');
    expect(g.objects[trinket!]!.zone).toBe('hand');
  });

  it('Winding Constrictor: one more counter on your artifacts and creatures, and one more for you', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Constrictor Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    const walker = give(g, 'alice', 'Walker Three', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: walker }));
    expect(g.objects[walker]!.counters.loyalty).toBe(3);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolster Lite', 'hand'), targets: [[{ kind: 'object', object: cub }]] }));
    expect(g.objects[cub]!.counters['+1/+1']).toBe(4);
    g = settle(act(g, { type: 'activate', player: 'alice', object: walker, ability: 0 }));
    expect(g.objects[walker]!.counters.loyalty).toBe(4);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Energy Lite', 'hand') }));
    expect(g.players.alice!.counters?.energy).toBe(4);
  });
});

describe('staples (slice 219): Phyrexian mana (CR 107.4f)', () => {
  it('each Phyrexian symbol is paid with mana of its color or 2 life — mana when it can, by default', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g.players.alice!.pool.C = 1;
    g.players.alice!.pool.B = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Dismember Lite', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[bear]!.zone).toBe('graveyard');
    expect(g.players.alice!.life).toBe(18);
    expect(g.players.alice!.pool.B).toBe(0);
  });

  it('the caster may choose life for a symbol they could pay with mana', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.players.alice!.pool.U = 1;
    const probe = give(g, 'alice', 'Probe Lite', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: probe, costs: { phyrexian: [] } })).toMatch(/Phyrexian/);
    g = settle(act(g, { type: 'cast', player: 'alice', object: probe, costs: { phyrexian: ['life'] } }));
    expect([g.players.alice!.life, g.players.alice!.pool.U]).toEqual([18, 1]);
  });

  it('with no mana and too little life, it can\'t be cast; legal actions offer it when life pays', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const probe = give(g, 'alice', 'Probe Lite', 'hand');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === probe)).toBe(true);
    g.players.alice!.life = 1;
    expect(illegal(g, { type: 'cast', player: 'alice', object: probe })).toBeTruthy();
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === probe)).toBe(false);
  });

  it('a hybrid Phyrexian symbol takes either color; an activated ability\'s Phyrexian cost too', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.players.alice!.pool.U = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Hybrid Phyrexian Lite', 'hand') }));
    expect([g.players.alice!.life, g.players.alice!.pool.U]).toEqual([20, 0]);
    const lens = give(g, 'alice', 'Phyrexian Lens', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'activate', player: 'alice', object: lens, ability: 0 }));
    expect([g.players.alice!.life, g.zones.hand.alice!.length]).toEqual([18, hand + 1]);
  });

  it("K'rrik: each {B} may be paid with 2 life", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const draw = give(g, 'alice', 'Black Draw', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: draw })).toBeTruthy();
    give(g, 'alice', "K'rrik Lite", 'battlefield');
    g.players.alice!.pool.B = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: draw }));
    expect([g.players.alice!.life, g.players.alice!.pool.B]).toEqual([18, 0]);
  });

  it('compleated: two fewer loyalty counters for each Phyrexian symbol paid with life', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const a = give(g, 'alice', 'Compleated Lite', 'hand');
    g.players.alice!.pool.G = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: a }));
    expect([g.players.alice!.life, g.objects[a]!.counters.loyalty]).toEqual([18, 3]);
    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const b = give(h, 'alice', 'Compleated Lite', 'hand');
    h.players.alice!.pool.G = 1;
    h.players.alice!.pool.U = 1;
    h = settle(act(h, { type: 'cast', player: 'alice', object: b }));
    expect([h.players.alice!.life, h.objects[b]!.counters.loyalty]).toEqual([20, 5]);
  });

  it("Vraska, Betrayal's Sting: a creature becomes a Treasure that keeps only its mana ability; poison up to nine", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const vraska = give(g, 'alice', 'Vraska Sting Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: vraska }));
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: vraska, ability: 0, targets: [[{ kind: 'object', object: bear }]] }));
    const c = chars(g, g.objects[bear]!);
    expect([c.types, c.subtypes]).toEqual([['Artifact'], ['Treasure']]);
    g = toStep(g, 'main1', 'bob');
    g = act(g, { type: 'activate_mana', player: 'bob', object: bear, ability: 0, choice: 'G' } as never);
    expect([g.objects[bear]!.zone, g.players.bob!.pool.G]).toEqual(['graveyard', 1]);
    g = toStep(g, 'main1', 'alice');
    g.players.bob!.poison = 3;
    g = settle(act(g, { type: 'activate', player: 'alice', object: vraska, ability: 1, targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.players.bob!.poison).toBe(9);
  });

  it('Nissa, Ascended Animist: an X/X where X is her loyalty; +1/+1 for each Forest and trample', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const nissa = give(g, 'alice', 'Nissa Animist Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: nissa }));
    g = settle(act(g, { type: 'activate', player: 'alice', object: nissa, ability: 0 }));
    const token = g.zones.battlefield.find((id) => g.objects[id]!.token)!;
    expect([chars(g, g.objects[token]!).power, chars(g, g.objects[token]!).toughness]).toEqual([8, 8]);
    give(g, 'alice', 'Forest', 'battlefield');
    give(g, 'alice', 'Forest', 'battlefield');
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    g = settle(act(g, { type: 'activate', player: 'alice', object: nissa, ability: 1 }));
    const c = chars(g, g.objects[token]!);
    expect([c.power, c.keywords.some((k) => k.id === 'trample')]).toEqual([10, true]);
  });

  it("Promise of Loyalty: each player keeps one creature with a vow counter; it can't attack you while it has one", () => {
    let g = toStep(start({ players: 3, extra: CARDS }), 'main1', 'alice');
    const [bear, cub] = [give(g, 'alice', 'Bear', 'battlefield'), give(g, 'alice', 'Cub', 'battlefield')];
    const [zombie, goblin] = [give(g, 'bob', 'Zombie', 'battlefield'), give(g, 'bob', 'Goblin Pair', 'battlefield')];
    const carols = give(g, 'carol', 'Zombie', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Promise Lite', 'hand') });
    for (let i = 0; i < 20 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'choose_objects') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'choose_objects', objects: [g.pending.player === 'alice' ? bear : zombie] } });
      else if (g.pending) break;
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect([bear, cub, zombie, goblin, carols].map((id) => g.objects[id]!.zone)).toEqual(['battlefield', 'graveyard', 'battlefield', 'graveyard', 'battlefield']);
    expect([g.objects[zombie]!.counters.vow, g.objects[carols]!.counters.vow]).toEqual([1, 1]);
    g = toAttack(toStep(g, 'beginning_of_combat', 'bob'));
    expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: zombie, target: { kind: 'player', player: 'alice' } }] } })).toMatch(/can’t attack/);
    expect(() => act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: zombie, target: { kind: 'player', player: 'carol' } }] } })).not.toThrow();
    g.objects[zombie]!.counters.vow = 0;
    expect(() => act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: zombie, target: { kind: 'player', player: 'alice' } }] } })).not.toThrow();
  });

  it('Necromancy: as a sorcery, it becomes an Aura on the creature it returns; when it leaves, that creature goes', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'graveyard');
    const necro = give(g, 'alice', 'Necromancy Lite', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: necro });
    for (let i = 0; i < 20 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: bear }]] } });
      else if (g.pending) break;
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect([g.objects[bear]!.zone, g.objects[bear]!.controller]).toEqual(['battlefield', 'alice']);
    expect(chars(g, g.objects[necro]!).subtypes).toContain('Aura');
    expect(g.objects[necro]!.attachedTo?.id).toBe(bear);
    g = toStep(g, 'main1', 'bob');
    expect([g.objects[necro]!.zone, g.objects[bear]!.zone]).toEqual(['battlefield', 'battlefield']);
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Disenchant Lite', 'hand'), targets: [[{ kind: 'object', object: necro }]] }));
    expect([g.objects[necro]!.zone, g.objects[bear]!.zone]).toEqual(['graveyard', 'graveyard']);
  });

  it('Necromancy: cast when a sorcery couldn\'t be, it is sacrificed at the beginning of the next cleanup step', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const bear = give(g, 'bob', 'Bear', 'graveyard');
    const necro = give(g, 'alice', 'Necromancy Lite', 'hand');
    g = act(g, { type: 'pass', player: 'bob' });
    g = act(g, { type: 'cast', player: 'alice', object: necro });
    for (let i = 0; i < 20 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: bear }]] } });
      else if (g.pending) break;
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect([g.objects[bear]!.zone, g.objects[bear]!.controller]).toEqual(['battlefield', 'alice']);
    // Through Bob's end step it stays; the cleanup step's delayed trigger sacrifices it (CR 514.3a).
    let atEnd = '';
    for (let i = 0; i < 200 && g.active === 'bob'; i++) {
      if (g.step === 'end') atEnd = g.objects[necro]!.zone;
      if (g.pending?.kind === 'declare_attackers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_attackers', attacks: [] } });
      else if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks: [] } });
      else if (g.pending?.kind === 'discard_to_hand_size') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'discard_to_hand_size', objects: g.zones.hand[g.pending.player]!.slice(0, g.pending.count) } });
      else if (g.pending) break;
      else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
      else break;
    }
    expect([g.active, atEnd]).toEqual(['alice', 'battlefield']);
    expect([g.objects[necro]!.zone, g.objects[bear]!.zone]).toEqual(['graveyard', 'graveyard']);
  });

  it('Morophon: spells of the chosen type cost {W}{U}{B}{R}{G} less, only their colored mana', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const m = give(g, 'alice', 'Morophon Lite', 'battlefield');
    g.objects[m]!.chosen = { creatureType: 'Bear' };
    const rainbow = give(g, 'alice', 'Rainbow Bear', 'hand');
    g.players.alice!.pool.C = 1;
    expect(illegal(g, { type: 'cast', player: 'alice', object: rainbow })).toBeTruthy();
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: rainbow }));
    expect(g.objects[rainbow]!.zone).toBe('battlefield');
    const bear = give(g, 'alice', 'Bear', 'hand');
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
  });

  it('Defiler of Vigor: one {G} of a green permanent spell may be paid with 2 life', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Defiler of Vigor Lite', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'hand');
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear }));
    expect([g.objects[bear]!.zone, g.players.alice!.life]).toEqual(['battlefield', 18]);
    const bear2 = give(g, 'alice', 'Bear', 'hand');
    g.players.alice!.pool.C = 1;
    g.players.alice!.pool.G = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear2 }));
    expect([g.objects[bear2]!.zone, g.players.alice!.life]).toEqual(['battlefield', 18]);
  });

  it('Muldrotha: a land and one permanent spell of each permanent type from your graveyard, during each of your turns', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Muldrotha Lite', 'battlefield');
    const [cub1, cub2, trinket, forest] = ['Cub', 'Cub', 'Trinket', 'Forest'].map((n) => give(g, 'alice', n, 'graveyard'));
    g = settle(act(g, { type: 'cast', player: 'alice', object: cub1! }));
    expect(g.objects[cub1!]!.zone).toBe('battlefield');
    expect(illegal(g, { type: 'cast', player: 'alice', object: cub2! })).toBeTruthy();
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: trinket! }));
    expect(g.objects[trinket!]!.zone).toBe('battlefield');
    expect(legalActions(g, 'alice').some((a) => a.type === 'play_land' && a.object === forest)).toBe(true);
    g = settle(act(g, { type: 'play_land', player: 'alice', object: forest! }));
    expect(g.objects[forest!]!.zone).toBe('battlefield');
    g = toStep(g, 'main1', 'bob');
    expect(illegal(g, { type: 'cast', player: 'alice', object: cub2! })).toBeTruthy();
    g = toStep(g, 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: cub2! }));
    expect(g.objects[cub2!]!.zone).toBe('battlefield');
  });

  it('Exploration Broodship: at 8+, a permanent spell from your graveyard by sacrificing a land — once each turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ship = give(g, 'alice', 'Broodship Lite', 'battlefield');
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    give(g, 'alice', 'Forest', 'battlefield');
    const [cub1, cub2] = [give(g, 'alice', 'Cub', 'graveyard'), give(g, 'alice', 'Cub', 'graveyard')];
    expect(illegal(g, { type: 'cast', player: 'alice', object: cub1, costs: { sacrifice: [forest] } })).toBeTruthy();
    g.objects[ship]!.counters.charge = 8;
    expect(illegal(g, { type: 'cast', player: 'alice', object: cub1 })).toBeTruthy();
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === cub1)).toBe(true);
    g = settle(act(g, { type: 'cast', player: 'alice', object: cub1, costs: { sacrifice: [forest] } }));
    expect([g.objects[cub1]!.zone, g.objects[forest]!.zone]).toEqual(['battlefield', 'graveyard']);
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === cub2)).toBe(false);
  });

  it("a Spacecraft's later lines are in its last striation's box (Hearthhull: the life loss only at 8+)", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ship = give(g, 'alice', 'Hearthhull Lite', 'battlefield');
    g.objects[ship]!.counters.charge = 2;
    give(g, 'alice', 'Forest', 'battlefield');
    give(g, 'alice', 'Forest', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: ship, ability: 0, costs: { sacrifice: [g.zones.battlefield.find((id) => g.objects[id]!.card === 'Forest')!] } }));
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([21, 20]);
    g.objects[ship]!.counters.charge = 8;
    g = settle(act(g, { type: 'activate', player: 'alice', object: ship, ability: 0, costs: { sacrifice: [g.zones.battlefield.find((id) => g.objects[id]!.card === 'Forest')!] } }));
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([22, 18]);
  });

  it('Lethal Scheme: each creature that convoked it connives, one at a time', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cubs = [0, 1, 2, 3].map(() => give(g, 'alice', 'Black Cub', 'battlefield'));
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g.players.alice!.pool.B = 1;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Lethal Scheme Lite', 'hand'), targets: [[{ kind: 'object', object: bear }]], costs: { convoke: cubs.slice(0, 3) } });
    for (let i = 0; i < 20 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'discard') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: [g.zones.hand.alice![0]!] } });
      else if (g.pending) break;
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.objects[bear]!.zone).toBe('graveyard');
    expect(cubs.slice(0, 3).every((id) => g.objects[id]!.tapped)).toBe(true);
    const grown = cubs.filter((id) => (g.objects[id]!.counters['+1/+1'] ?? 0) > 0);
    expect(grown.every((id) => cubs.slice(0, 3).includes(id))).toBe(true);
  });

  it('Venerated Loxodon and Ancient Imperiosaur: counters for the creatures that convoked them', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cubs = [0, 1, 2, 3, 4, 5].map(() => give(g, 'alice', 'Cub', 'battlefield'));
    g.players.alice!.pool.W = 1;
    g.players.alice!.pool.C = 2;
    const lox = give(g, 'alice', 'Loxodon Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: lox, costs: { convoke: cubs.slice(0, 2) } }));
    expect(cubs.map((id) => g.objects[id]!.counters['+1/+1'] ?? 0)).toEqual([1, 1, 0, 0, 0, 0]);
    g.players.alice!.pool.G = 2;
    g.players.alice!.pool.C = 2;
    const dino = give(g, 'alice', 'Imperiosaur Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: dino, costs: { convoke: cubs.slice(2, 5) } }));
    expect(g.objects[dino]!.counters['+1/+1']).toBe(6);
  });

  it('All Will Be One: counters you put on a permanent or a player deal that much damage', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'All Will Be One Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    const answer = (gg: typeof g) => {
      let x = gg;
      for (let i = 0; i < 20 && (x.stack.length || x.pending); i++) {
        if (x.pending?.kind === 'trigger_targets') x = act(x, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } });
        else if (x.pending) break;
        else x = act(x, { type: 'pass', player: x.priority! });
      }
      return x;
    };
    g = answer(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolster Lite', 'hand'), targets: [[{ kind: 'object', object: cub }]] }));
    expect(g.players.bob!.life).toBe(17);
    g = answer(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Energy Lite', 'hand') }));
    expect(g.players.bob!.life).toBe(14);
  });

  it('Skrelv: toxic 1, hexproof from the chosen color, and unblockable by creatures of that color', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const skrelv = give(g, 'alice', 'Skrelv Lite', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const [black, green] = [give(g, 'bob', 'Black Cub', 'battlefield'), give(g, 'bob', 'Cub', 'battlefield')];
    g.players.alice!.pool.W = 1;
    g = act(g, { type: 'activate', player: 'alice', object: skrelv, ability: 0, targets: [[{ kind: 'object', object: bear }]] });
    for (let i = 0; i < 10 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'choose_option') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: 'B' } });
      else if (g.pending) break;
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(chars(g, g.objects[bear]!).keywords.some((k) => k.id === 'toxic')).toBe(true);
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: bear, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 10 && g.pending?.kind !== 'declare_blockers'; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: black, attacker: bear }] } })).toBeTruthy();
    expect(() => act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: green, attacker: bear }] } })).not.toThrow();
  });

  it('Plumb the Forbidden: a copy for each creature sacrificed as it was cast', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cubs = [0, 1].map(() => give(g, 'alice', 'Cub', 'battlefield'));
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Plumb Lite', 'hand'), costs: { sacrifice: cubs } }));
    expect(cubs.map((id) => g.objects[id]!.zone)).toEqual(['graveyard', 'graveyard']);
    expect([g.zones.hand.alice!.length - hand, g.players.alice!.life]).toEqual([3, 17]);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Plumb Lite', 'hand') }));
    expect([g.zones.hand.alice!.length - hand, g.players.alice!.life]).toEqual([4, 16]);
  });

  it('Torgaar: {2} less for each creature sacrificed as it was cast', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cubs = [0, 1, 2].map(() => give(g, 'alice', 'Cub', 'battlefield'));
    const torgaar = give(g, 'alice', 'Torgaar Lite', 'hand');
    g.players.alice!.pool.B = 2;
    expect(illegal(g, { type: 'cast', player: 'alice', object: torgaar, costs: { sacrifice: cubs.slice(0, 2) } })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: torgaar, costs: { sacrifice: cubs } }));
    expect(g.objects[torgaar]!.zone).toBe('battlefield');
    expect(cubs.every((id) => g.objects[id]!.zone === 'graveyard')).toBe(true);
  });

  it("Grafdigger's Cage: a creature card in a graveyard can't enter the battlefield; Containment Priest exiles one not cast", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'graveyard');
    const cage = give(g, 'alice', 'Cage Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Zombify Lite', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[bear]!.zone).toBe('graveyard');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Disenchant Lite', 'hand'), targets: [[{ kind: 'object', object: cage }]] }));
    give(g, 'bob', 'Priest Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Zombify Lite', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[bear]!.zone).toBe('exile');
    const cub = give(g, 'alice', 'Cub', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: cub }));
    expect(g.objects[cub]!.zone).toBe('battlefield');
  });

  it('Dracogenesis: Dragon spells without paying their mana costs', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Dracogenesis Lite', 'battlefield');
    const dragon = give(g, 'alice', 'Big Dragon', 'hand');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === dragon)).toBe(true);
    g = settle(act(g, { type: 'cast', player: 'alice', object: dragon, alt: 'free' }));
    expect(g.objects[dragon]!.zone).toBe('battlefield');
  });

  it('Teferi, Master of Time: loyalty abilities on any player\'s turn, at instant speed — once each turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const teferi = give(g, 'alice', 'Teferi Time Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: teferi }));
    g = toStep(g, 'main1', 'bob');
    g = act(g, { type: 'pass', player: 'bob' });
    g = settle(act(g, { type: 'activate', player: 'alice', object: teferi, ability: 0 }));
    expect([g.objects[teferi]!.counters.loyalty, g.players.alice!.life]).toEqual([4, 21]);
  });

  it('Winds of Abandon (overloaded): each exiled creature\'s controller searches for a basic land, tapped', () => {
    let g = toStep(start({ players: 3, extra: CARDS }), 'main1', 'alice');
    const [b1, b2, c1] = [give(g, 'bob', 'Bear', 'battlefield'), give(g, 'bob', 'Cub', 'battlefield'), give(g, 'carol', 'Bear', 'battlefield')];
    const mine = give(g, 'alice', 'Cub', 'battlefield');
    const [f1, f2, f3] = [give(g, 'bob', 'Forest', 'library'), give(g, 'bob', 'Forest', 'library'), give(g, 'carol', 'Forest', 'library')];
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Winds of Abandon Lite', 'hand'), alt: 'overload' });
    for (let i = 0; i < 20 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'search') {
        const pick = (g.pending as { candidates: string[] }).candidates.find((id) => [f1, f2, f3].includes(id) && g.objects[id]!.zone === 'library')!;
        g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'search', objects: [pick] } });
      } else if (g.pending) break;
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect([b1, b2, c1, mine].map((id) => g.objects[id]!.zone)).toEqual(['exile', 'exile', 'exile', 'battlefield']);
    expect([f1, f2, f3].map((id) => g.objects[id]!.zone)).toEqual(['battlefield', 'battlefield', 'battlefield']);
    expect(g.objects[f1]!.tapped).toBe(true);
  });

  it('Single Combat: keep one creature or planeswalker; no creature spells until the end of your next turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [a1, a2] = [give(g, 'alice', 'Bear', 'battlefield'), give(g, 'alice', 'Cub', 'battlefield')];
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Single Combat Lite', 'hand') });
    for (let i = 0; i < 20 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'choose_objects') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'choose_objects', objects: [a1] } });
      else if (g.pending) break;
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect([g.objects[a1]!.zone, g.objects[a2]!.zone]).toEqual(['battlefield', 'graveyard']);
    const cub = give(g, 'alice', 'Cub', 'hand');
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    expect(illegal(g, { type: 'cast', player: 'alice', object: cub })).toBeTruthy();
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: cub }));
    expect(g.objects[cub]!.zone).toBe('battlefield');
  });

  it('Rise of the Witch-king: only if you sacrificed one; another permanent card, not the sacrificed one', () => {
    const run = (mine: boolean) => {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const bear = mine ? give(g, 'alice', 'Bear', 'battlefield') : null;
      give(g, 'bob', 'Zombie', 'battlefield');
      const old = give(g, 'alice', 'Ogre Three', 'graveyard');
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Witch-king Lite', 'hand') });
      let offered: string[] = [];
      for (let i = 0; i < 20 && (g.stack.length || g.pending); i++) {
        if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
        else if (g.pending?.kind === 'choose_objects') {
          offered = (g.pending as { candidates: string[] }).candidates;
          g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [old] } });
        } else if (g.pending) break;
        else g = act(g, { type: 'pass', player: g.priority! });
      }
      return { zone: g.objects[old]!.zone, offered, bear };
    };
    const yes = run(true);
    expect(yes.zone).toBe('battlefield');
    expect(yes.offered.includes(yes.bear!)).toBe(false);
    expect(run(false).zone).toBe('graveyard');
  });

  it("Teferi's Puzzle Box: the hand goes to the bottom in the order chosen, then that many are drawn", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Puzzle Box Lite', 'battlefield');
    g = toStep(g, 'upkeep', 'bob');
    const before = [...g.zones.hand.bob!];
    g = act(g, { type: 'pass', player: 'bob' });
    g = act(g, { type: 'pass', player: 'alice' });
    for (let i = 0; i < 10 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'choose_objects') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'choose_objects', objects: [...(g.pending as { candidates: string[] }).candidates].reverse() } });
      else if (g.pending) break;
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    const lib = g.zones.library.bob!;
    expect(g.zones.hand.bob!.length).toBe(before.length + 1);
    expect(before.every((id) => lib.slice(-(before.length + 1)).includes(id))).toBe(true);
  });

  it('Worship: with a creature, damage leaves you at 1; Angel\'s Grace until end of turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Worship Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    g.players.alice!.life = 2;
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] }));
    expect(g.players.alice!.life).toBe(1);
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: cub }]] }));
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] }));
    expect(g.players.alice!.lost).toBe(true);
    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    h.players.alice!.life = 2;
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', "Angel's Grace Lite", 'hand') }));
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] }));
    expect([h.players.alice!.life, Boolean(h.players.alice!.lost)]).toEqual([1, false]);
  });

  it("Everybody Lives!: players can't lose life or be targeted by opponents this turn", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Everybody Lives Lite', 'hand') }));
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] }));
    expect(g.players.alice!.life).toBe(20);
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Probe Lite', 'hand'), costs: { phyrexian: ['life'] } })).toBeTruthy();
    g = toStep(g, 'main1', 'bob');
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] }));
    expect(g.players.alice!.life).toBe(17);
  });

  it("Portent: the top three of target player's library, back in the order chosen", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const top = g.zones.library.bob!.slice(0, 3);
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Portent Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] });
    for (let i = 0; i < 10 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'scry') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'scry', top: [...top].reverse(), bottom: [] } });
      else if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: false } });
      else if (g.pending) break;
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.zones.library.bob!.slice(0, 3)).toEqual([...top].reverse());
  });

  it('Syncopate: countered unless its controller pays, and exiled', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bolt = give(g, 'alice', 'Bolt', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: bolt, targets: [[{ kind: 'player', player: 'bob' }]] });
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Syncopate Lite', 'hand'), targets: [[{ kind: 'object', object: bolt }]] });
    for (let i = 0; i < 10 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'pay') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'pay', pay: false } as never });
      else if (g.pending) break;
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect([g.objects[bolt]!.zone, g.players.bob!.life]).toEqual(['exile', 20]);
  });

  it('Dark Fortress: tapped for mana the turn it entered, or with a basic land', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const fort = give(g, 'alice', 'Fortress Lite', 'battlefield');
    g.objects[fort]!.zcc += 0;
    g.zones.battlefield.filter((id) => g.objects[id]!.controller === 'alice' && chars(g, g.objects[id]!).supertypes.includes('Basic')).forEach((id) => (g.objects[id]!.zone = 'graveyard'));
    expect(illegal(g, { type: 'activate_mana', player: 'alice', object: fort, ability: 0, choice: 0 } as never)).toBeTruthy();
    give(g, 'alice', 'Forest', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: fort, ability: 0, choice: 0 } as never);
    expect(g.players.alice!.pool.B + g.players.alice!.pool.R).toBe(1);
  });
});

describe('copy exceptions', () => {
  it("Altered Ego: enters as a copy with X additional +1/+1 counters", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const ego = give(g, 'alice', 'Altered Ego Lite', 'hand');
    g.players.alice!.pool.C = 3;
    g = settle(act(g, { type: 'cast', player: 'alice', object: ego, x: 3 }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', copy: bear } }));
    const c = chars(g, g.objects[ego]!);
    expect([c.name, g.objects[ego]!.counters['+1/+1'], c.power]).toEqual(['Bear', 3, 5]);
  });
  it("Machine God's Effigy: a copy that's an artifact (not a creature) with a mana ability", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const effigy = give(g, 'alice', 'Effigy Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: effigy }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', copy: bear } }));
    const c = chars(g, g.objects[effigy]!);
    expect([c.name, c.types, c.subtypes]).toEqual(['Bear', ['Artifact'], []]);
    g = act(g, { type: 'activate_mana', player: 'alice', object: effigy, ability: 0 });
    expect(g.players.alice!.pool.U).toBe(1);
  });
  it('Imposter Mech: a Vehicle artifact with crew 3 that loses its other card types', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const mech = give(g, 'alice', 'Mech Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: mech }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', copy: bear } }));
    const c = chars(g, g.objects[mech]!);
    expect([c.types, c.subtypes, c.power, c.keywords.some((k) => k.id === 'crew' && k.n === 3)]).toEqual([['Artifact'], ['Vehicle'], 2, true]);
  });
  it('Littjara Mirrorlake: a token copy that enters with an additional +1/+1 counter', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const lake = give(g, 'alice', 'Mirrorlake Lite', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: lake, ability: 0, targets: [[{ kind: 'object', object: bear }]] }));
    const token = Object.values(g.objects).find((o) => o.token && o.zone === 'battlefield')!;
    expect([chars(g, token).name, token.counters['+1/+1'], chars(g, token).power]).toEqual(['Bear', 1, 3]);
  });
  it("Kaya, Intangible Slayer: if it wasn't an Aura, a 1/1 white Spirit copy with flying", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Intangible Lite', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    const token = Object.values(g.objects).find((o) => o.token && o.zone === 'battlefield')!;
    const c = chars(g, token);
    expect([g.objects[bear]!.zone, c.name, c.power, c.colors, c.subtypes, c.keywords.some((k) => k.id === 'flying')]).toEqual(['exile', 'Bear', 1, ['W'], ['Bear', 'Spirit'], true]);
  });
  it('Sakashima the Impostor: its own name, legendary, and a quoted ability that means the copy', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const imp = give(g, 'alice', 'Impostor Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: imp }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', copy: bear } }));
    const c = chars(g, g.objects[imp]!);
    expect([c.name, c.supertypes, c.power]).toEqual(['Impostor Lite', ['Legendary'], 2]);
    g = settle(act(g, { type: 'activate', player: 'alice', object: imp, ability: 0 }));
    expect([g.objects[imp]!.zone, g.delayed?.length]).toEqual(['battlefield', 1]);
    g = toStep(g, 'end', 'alice');
    g = settle(g);
    expect(g.objects[imp]!.zone).toBe('hand');
  });
  it('Jace, Cunning Castaway: token copies of a planeswalker enter with its printed loyalty', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const jace = give(g, 'alice', 'Castaway Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: jace }));
    g = settle(act(g, { type: 'activate', player: 'alice', object: jace, ability: 0 }));
    const tokens = Object.values(g.objects).filter((o) => o.token && o.zone === 'battlefield');
    expect([g.objects[jace]!.counters.loyalty, tokens.map((t) => t.counters.loyalty), tokens.map((t) => chars(g, t).supertypes)]).toEqual([4, [3, 3], [[], []]]);
  });
  it('Jace, Mirror Mage: "its starting loyalty is 1"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const jace = give(g, 'alice', 'Mirror Mage Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: jace }));
    g = settle(act(g, { type: 'activate', player: 'alice', object: jace, ability: 0 }));
    const token = Object.values(g.objects).find((o) => o.token && o.zone === 'battlefield')!;
    expect(token.counters.loyalty).toBe(1);
  });
  it("K'rrik: auto-tapping a {B} cost with mana available pays mana, not life (and terminates)", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', "K'rrik Lite", 'battlefield');
    const swamps = [give(g, 'alice', 'Swamp', 'battlefield'), give(g, 'alice', 'Swamp', 'battlefield')];
    for (const o of Object.values(g.objects)) if (o.controller === 'alice' && o.zone === 'battlefield' && !swamps.includes(o.id) && chars(g, o).types.includes('Land')) o.tapped = true;
    expect(legalActions(g, 'alice').length).toBeGreaterThan(0);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Black Draw', 'hand'), autoTap: true }));
    expect([g.players.alice!.life, swamps.every((s) => g.objects[s]!.tapped)]).toEqual([20, true]);
  });
});

describe('cost totals', () => {
  it('March of Swirling Mist: {2} less for each blue card exiled — off the X too', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bears = [give(g, 'bob', 'Bear', 'battlefield'), give(g, 'bob', 'Bear', 'battlefield')];
    const march = give(g, 'alice', 'March Mist Lite', 'hand');
    const blue = [give(g, 'alice', 'Blue Salve', 'hand'), give(g, 'alice', 'Blue Salve', 'hand')];
    g.players.alice!.pool.U = 2;
    const targets = [bears.map((b) => ({ kind: 'object' as const, object: b }))];
    expect(illegal(g, { type: 'cast', player: 'alice', object: march, x: 4, targets, costs: { exile: [blue[0]!] } })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: march, x: 4, targets, costs: { exile: blue } }));
    expect([blue.map((b) => g.objects[b]!.zone), bears.map((b) => Boolean(g.objects[b]!.phasedOut))]).toEqual([['exile', 'exile'], [true, true]]);
  });
  it('a cost reduction takes generic mana off the value chosen for X (CR 601.2f)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Electromancer Lite', 'battlefield');
    g.players.alice!.pool.R = 1;
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Fireball Lite', 'hand'), x: 3, targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.players.bob!.life).toBe(17);
  });
});

describe('Sieges', () => {
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
  const attackWith = (g: GameState, attackers: string[], to = 'bob'): GameState => {
    g = toAttack(toStep(g, 'beginning_of_combat'));
    return act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: attackers.map((attacker) => ({ attacker, target: { kind: 'player' as const, player: to } })) } });
  };
  it("Thornbow Archer: only opponents who don't control an Elf", () => {
    for (const elf of [false, true]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const archer = give(g, 'alice', 'Thornbow Lite', 'battlefield', { sick: false });
      if (elf) give(g, 'bob', 'Elf Lite', 'battlefield');
      const life = g.players.bob!.life;
      g = drive(attackWith(g, [archer]), () => null);
      expect(life - g.players.bob!.life).toBe(elf ? 0 : 1);
    }
  });
  it('Septic Rats: +1/+1 only if defending player is poisoned', () => {
    for (const poison of [0, 1]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const rats = give(g, 'alice', 'Septic Lite', 'battlefield', { sick: false });
      g.players.bob!.poison = poison;
      g = drive(attackWith(g, [rats]), () => null);
      expect(chars(g, g.objects[rats]!).power).toBe(2 + poison);
    }
  });
  it('Avenging Huntbonder: a double strike counter gives double strike (CR 122.1b)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const hb = give(g, 'alice', 'Huntbonder Lite', 'battlefield', { sick: false });
    const z = give(g, 'alice', 'Zombie', 'battlefield', { sick: false });
    g = attackWith(g, [hb, z]);
    g = drive(g, (g) => (g.pending?.kind === 'trigger_targets' ? act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: z }]] } } as never) : null));
    expect([g.objects[z]!.counters.double_strike, chars(g, g.objects[z]!).keywords.map((k) => k.id)]).toEqual([1, ['double_strike']]);
  });
  it('Brutal Hordechief: "defending player" for each attacking creature', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Hordechief Lite', 'battlefield');
    const a = [give(g, 'alice', 'Zombie', 'battlefield', { sick: false }), give(g, 'alice', 'Zombie', 'battlefield', { sick: false })];
    const [mine, theirs] = [g.players.alice!.life, g.players.bob!.life];
    g = drive(attackWith(g, a), () => null);
    expect([g.players.alice!.life - mine, theirs - g.players.bob!.life]).toEqual([2, 2]);
  });
  it('Taborax: "If that creature was a Cleric" — the creature that died, not Taborax', () => {
    for (const name of ['Plain Cleric Lite', 'Zombie']) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const tab = give(g, 'alice', 'Taborax Lite', 'battlefield');
      const victim = give(g, 'alice', name, 'battlefield');
      const hand = g.zones.hand.alice!.length;
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: victim }]] }));
      g = drive(g, (g) => (g.pending?.kind === 'may' ? act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }) : null));
      expect([g.objects[tab]!.counters['+1/+1'], g.zones.hand.alice!.length - hand]).toEqual([1, name === 'Plain Cleric Lite' ? 1 : 0]);
    }
  });
  it("Death's Presence: X is the power of the creature that died", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', "Death's Presence Lite", 'battlefield');
    const keep = give(g, 'alice', 'Zombie', 'battlefield');
    const victim = give(g, 'alice', 'Big Bear', 'battlefield');
    g.objects[victim]!.damage = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: victim }]] }));
    g = drive(g, (g) => (g.pending?.kind === 'trigger_targets' ? act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: keep }]] } } as never) : null));
    expect(g.objects[keep]!.counters['+1/+1']).toBe(5);
  });
  it('Abigale: keyword counters put on after "loses all abilities" still give their keywords (CR 613.7)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const vigil = give(g, 'alice', 'Vigil Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Abigale Lite', 'hand') }));
    g = drive(g, (g) => (g.pending?.kind === 'trigger_targets' ? act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: vigil }]] } } as never) : null));
    expect(chars(g, g.objects[vigil]!).keywords.map((k) => k.id).sort()).toEqual(['first_strike', 'flying', 'lifelink']);
  });
  it('The Master of Lake-town: any player who loses life mills that many', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Lake-town Lite', 'battlefield');
    const [lib, gy] = [g.zones.library.alice!.length, g.zones.graveyard.alice!.length];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] }));
    g = drive(g, () => null);
    expect([lib - g.zones.library.alice!.length, g.zones.graveyard.alice!.length - gy]).toEqual([3, 4]);
  });
  it("War Elemental and Chandra's Spitfire: an opponent dealt damage (noncombat only for the Spitfire)", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const war = give(g, 'alice', 'War Elemental Lite', 'battlefield');
    const spit = give(g, 'alice', 'Spitfire Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    g = drive(g, () => null);
    expect([g.objects[war]!.counters['+1/+1'], chars(g, g.objects[spit]!).power]).toEqual([3, 4]);
    const z = give(g, 'alice', 'Zombie', 'battlefield', { sick: false });
    g = toStep(g, 'end', 'alice');
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    g = attackWith(g, [z]);
    for (let i = 0; i < 30 && g.step !== 'main2'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } } as never);
      else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
      else break;
    }
    expect([g.objects[war]!.counters['+1/+1'], chars(g, g.objects[spit]!).power]).toEqual([5, 1]);
  });
  it('Thallid Omnivore: "If a Saproling was sacrificed this way" — what the cost sacrificed', () => {
    for (const name of ['Saproling Lite', 'Zombie']) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const om = give(g, 'alice', 'Omnivore Lite', 'battlefield');
      const fodder = give(g, 'alice', name, 'battlefield');
      g.players.alice!.pool.C = 1;
      const life = g.players.alice!.life;
      g = settle(act(g, { type: 'activate', player: 'alice', object: om, ability: 0, costs: { sacrifice: [fodder] } }));
      g = drive(g, () => null);
      expect([g.players.alice!.life - life, chars(g, g.objects[om]!).power]).toEqual([name === 'Zombie' ? 0 : 2, 3]);
    }
  });
  it('CR 701.53: incubate — an Incubator with the counters; {2} transforms it into a Phyrexian artifact creature', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Phyrexian Awakening Lite', 'hand') }));
    g = drive(g, () => null);
    const inc = g.zones.battlefield.find((id) => g.objects[id]!.token && chars(g, g.objects[id]!).name === 'Incubator')!;
    expect([g.objects[inc]!.counters['+1/+1'], chars(g, g.objects[inc]!).types]).toEqual([4, ['Artifact']]);
    g.players.alice!.pool.C = 2;
    g = drive(settle(act(g, { type: 'activate', player: 'alice', object: inc, ability: 0 })), () => null);
    const c = chars(g, g.objects[inc]!);
    expect([c.name, c.types, c.subtypes, c.power, c.toughness]).toEqual(['Phyrexian Token', ['Artifact', 'Creature'], ['Phyrexian'], 4, 4]);
  });
  it('Raggadragga: "with a mana ability" in layer 7c reads the abilities layer 6 gave (no recursion)', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Ragga Lite', 'battlefield');
    const elf = give(g, 'alice', 'Mana Elf Lite', 'battlefield');
    const z = give(g, 'alice', 'Zombie', 'battlefield');
    expect([chars(g, g.objects[elf]!).power, chars(g, g.objects[z]!).power]).toEqual([3, 2]);
  });
  it('Turn to Frog: a blue Frog 1/1 with no abilities that keeps its card types (CR 205.1b)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const golem = give(g, 'bob', 'Vigilant Golem Lite', 'battlefield');
    g = drive(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Frog Lite', 'hand'), targets: [[{ kind: 'object', object: golem }]] })), () => null);
    const c = chars(g, g.objects[golem]!);
    expect([c.types, c.subtypes, c.colors, c.power, c.toughness, c.keywords.length]).toEqual([['Artifact', 'Creature'], ['Frog'], ['U'], 1, 1, 0]);
    g = toStep(g, 'main1', 'bob');
    expect([chars(g, g.objects[golem]!).power, chars(g, g.objects[golem]!).subtypes]).toEqual([3, ['Golem']]);
  });
  it('Bonfire of the Damned and Blightning: "that player or that planeswalker\'s controller"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const walker = give(g, 'bob', 'Walker Lite', 'battlefield');
    g.objects[walker]!.counters.loyalty = 5;
    const theirs = give(g, 'bob', 'Zombie', 'battlefield');
    const mine = give(g, 'alice', 'Zombie', 'battlefield');
    g.players.alice!.pool.C = 2;
    g = drive(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bonfire Lite', 'hand'), x: 2, targets: [[{ kind: 'object', object: walker }]] })), () => null);
    expect([g.objects[walker]!.counters.loyalty, g.objects[theirs]!.zone, g.objects[mine]!.zone]).toEqual([3, 'graveyard', 'battlefield']);
    const hand = g.zones.hand.bob!.length;
    g = drive(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Blightning Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] })), (g) => {
      const p = g.pending!;
      if (p.kind !== 'discard') return null;
      return act(g, { type: 'choose', player: p.player, answer: { kind: 'discard', objects: g.zones.hand.bob!.slice(0, 2) } } as never);
    });
    expect(hand - g.zones.hand.bob!.length).toBe(Math.min(2, hand));
  });
  it('Fire Prophecy: a card from your hand on the bottom of your library, then a draw', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const z = give(g, 'bob', 'Zombie', 'battlefield');
    const keep = give(g, 'alice', 'Forest', 'hand');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Prophecy Lite', 'hand'), targets: [[{ kind: 'object', object: z }]] }));
    g = drive(g, (g) => {
      if (g.pending?.kind === 'may') return act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
      if (g.pending?.kind === 'choose_objects') return act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [keep] } });
      return null;
    });
    const lib = g.zones.library.alice!;
    expect([g.objects[z]!.zone, lib[lib.length - 1], g.zones.hand.alice!.length]).toEqual(['graveyard', keep, hand]);
  });
  it('Soul of Shandalar: the creature must be controlled by the targeted player', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const soul = give(g, 'alice', 'Shandalar Lite', 'battlefield');
    const [bobs, carols] = [give(g, 'bob', 'Big Bear', 'battlefield'), give(g, 'carol', 'Big Bear', 'battlefield')];
    const ability = legalActions(g, 'alice').find((a) => a.type === 'activate' && a.object === soul)! as { ability: number };
    expect(illegal(g, { type: 'activate', player: 'alice', object: soul, ability: ability.ability, targets: [[{ kind: 'player', player: 'bob' }], [{ kind: 'object', object: carols }]] })).toMatch(/legal target/);
    g = settle(act(g, { type: 'activate', player: 'alice', object: soul, ability: ability.ability, targets: [[{ kind: 'player', player: 'bob' }], [{ kind: 'object', object: bobs }]] }));
    g = drive(g, () => null);
    expect([g.objects[bobs]!.damage, g.objects[carols]!.damage, g.players.bob!.life]).toEqual([3, 0, 17]);
  });
  it('Caustic Wasps: "target artifact that player controls" — only the damaged player\'s', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const wasps = give(g, 'alice', 'Wasps Lite', 'battlefield');
    const [bobs, carols] = [give(g, 'bob', 'Trinket', 'battlefield'), give(g, 'carol', 'Trinket', 'battlefield')];
    give(g, 'bob', 'Trinket', 'battlefield');
    g = attackWith(g, [wasps]);
    let seen: string[] = [];
    for (let i = 0; i < 40 && g.step !== 'main2'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks: [] } });
      else if (g.pending?.kind === 'trigger_targets') {
        const p = g.pending;
        seen = p.prompts[0]!.candidates.map((t) => (t.kind === 'object' ? g.objects[t.object]!.controller : '?'));
        expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: carols }]] } })).toMatch(/legal target/);
        g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: bobs }]] } });
      } else if (g.pending) break;
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(seen).toEqual(['bob', 'bob']);
    expect([g.objects[bobs]!.zone, g.objects[carols]!.zone]).toEqual(['graveyard', 'battlefield']);
  });
  it('Mutiny: "another target creature that player controls" — the first target\'s controller', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const [big, zombie, carols] = [give(g, 'bob', 'Big Bear', 'battlefield'), give(g, 'bob', 'Zombie', 'battlefield'), give(g, 'carol', 'Zombie', 'battlefield')];
    const mutiny = give(g, 'alice', 'Mutiny Lite', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: mutiny, targets: [[{ kind: 'object', object: big }], [{ kind: 'object', object: carols }]] })).toMatch(/legal target/);
    g = settle(act(g, { type: 'cast', player: 'alice', object: mutiny, targets: [[{ kind: 'object', object: big }], [{ kind: 'object', object: zombie }]] }));
    g = drive(g, () => null);
    expect([g.objects[zombie]!.zone, g.objects[carols]!.zone]).toEqual(['graveyard', 'battlefield']);
  });
  it('Primary Research, White Glove Gourmand, Canyon Crab, Ennis: what happened this turn', () => {
    const run = (setup: (g: GameState) => GameState) => {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      for (const n of ['Research Lite', 'Gourmand Lite', 'Crab Lite']) give(g, 'alice', n, 'battlefield');
      const ennis = give(g, 'alice', 'Ennis Lite', 'battlefield');
      g = setup(g);
      const [hand, life] = [g.zones.hand.alice!.length, g.players.alice!.life];
      g = settle(toStep(g, 'end', 'alice'));
      return { drew: g.zones.hand.alice!.length - hand, gained: g.players.alice!.life - life, counters: g.objects[ennis]!.counters['+1/+1'] ?? 0 };
    };
    // Nothing happened: only the crab draws.
    expect(run((g) => g)).toMatchObject({ drew: 1, gained: 0, counters: 0 });
    // A card returned from the graveyard (a spell cast from the hand): research draws, the crab doesn't.
    expect(
      run((g) => {
        const card = give(g, 'alice', 'Zombie', 'graveyard');
        return drive(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Regrowth Lite', 'hand'), targets: [[{ kind: 'object', object: card }]] })), () => null);
      }),
    ).toMatchObject({ drew: 1, gained: 0, counters: 0 });
    // Another Human of mine died, and a creature was exiled.
    expect(
      run((g) => {
        const human = give(g, 'alice', 'Human Lite', 'battlefield');
        const z = give(g, 'bob', 'Zombie', 'battlefield');
        g = drive(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: human }]] })), () => null);
        return drive(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Banish Lite', 'hand'), targets: [[{ kind: 'object', object: z }]] })), () => null);
      }),
    ).toMatchObject({ drew: 0, gained: 3, counters: 1 });
  });
  it('Incinerate: a creature dealt damage this way can\'t be regenerated this turn (CR 701.19c)', () => {
    for (const card of ['Bolt', 'Incinerate Lite']) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const troll = give(g, 'bob', 'Regen Lite', 'battlefield');
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', card, 'hand'), targets: [[{ kind: 'object', object: troll }]] });
      // Bob regenerates in response.
      g = act(g, { type: 'pass', player: 'alice' });
      const ability = legalActions(g, 'bob').find((a) => a.type === 'activate' && a.object === troll) as { ability: number };
      g = settle(act(g, { type: 'activate', player: 'bob', object: troll, ability: ability.ability }));
      g = drive(g, () => null);
      expect([card, g.objects[troll]!.zone]).toEqual([card, card === 'Bolt' ? 'battlefield' : 'graveyard']);
    }
  });
  it('Ringwraiths: "If that creature is legendary, its controller loses 3 life"', () => {
    for (const name of ['Big Bear', 'Big Legend Lite']) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const victim = give(g, 'bob', name, 'battlefield');
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ringwraiths Lite', 'hand') }));
      g = drive(g, (g) => (g.pending?.kind === 'trigger_targets' ? act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: victim }]] } }) : null));
      expect([name, g.players.bob!.life]).toEqual([name, name === 'Big Legend Lite' ? 17 : 20]);
    }
  });
  it('Grandmother Goby: the mana spent to cast the countered spell, as it was cast', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Goby Lite', 'battlefield');
    g.players.alice!.pool.G = 2;
    const spell = give(g, 'alice', 'Growth Lite', 'hand');
    const hand = g.zones.hand.alice!.length;
    g = drive(settle(act(g, { type: 'cast', player: 'alice', object: spell })), () => null);
    const merfolk = g.zones.battlefield.filter((id) => g.cards[g.objects[id]!.card]!.name === 'Merfolk Token');
    expect([g.objects[spell]!.zone, merfolk.length, g.zones.hand.alice!.length]).toEqual(['graveyard', 2, hand - 1]);
  });
  it('Rabble Rousing: "create that many" — how many creatures attack', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Rabble Lite', 'battlefield');
    const attackers = [give(g, 'alice', 'Zombie', 'battlefield'), give(g, 'alice', 'Zombie', 'battlefield')];
    g = drive(attackWith(g, attackers), () => null);
    const citizens = g.zones.battlefield.filter((id) => g.cards[g.objects[id]!.card]!.name === 'Citizen Token');
    expect(citizens.length).toBe(2);
  });
  it("Norn's Decree: an opponent's creatures deal combat damage to you — that opponent gets a poison counter", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Decree Lite', 'battlefield');
    const [a, b] = [give(g, 'bob', 'Zombie', 'battlefield'), give(g, 'bob', 'Zombie', 'battlefield')];
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [a, b].map((attacker) => ({ attacker, target: { kind: 'player' as const, player: 'alice' } })) } });
    for (let i = 0; i < 40 && g.step !== 'main2'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks: [] } });
      else if (g.pending) break;
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect([g.players.alice!.life, g.players.bob!.poison ?? 0]).toEqual([16, 1]);
  });
  it('Arcbound Tracker: only spells after the first each turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const tracker = give(g, 'alice', 'Tracker Lite', 'battlefield');
    for (let i = 0; i < 3; i++) g = drive(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Salve', 'hand') })), () => null);
    expect(g.objects[tracker]!.counters['+1/+1'] ?? 0).toBe(2);
  });
  it('Maelstrom Pulse and Bile Blight: the target and all others with its name', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const zombies = [give(g, 'bob', 'Zombie', 'battlefield'), give(g, 'alice', 'Zombie', 'battlefield'), give(g, 'carol', 'Zombie', 'battlefield')];
    const bear = give(g, 'bob', 'Big Bear', 'battlefield');
    g = drive(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Pulse Lite', 'hand'), targets: [[{ kind: 'object', object: zombies[0]! }]] })), () => null);
    expect([...zombies, bear].map((id) => g.objects[id]!.zone)).toEqual(['graveyard', 'graveyard', 'graveyard', 'battlefield']);
    const bears = [bear, give(g, 'alice', 'Big Bear', 'battlefield')];
    g = drive(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Blight Lite', 'hand'), targets: [[{ kind: 'object', object: bear }]] })), () => null);
    expect(bears.map((id) => chars(g, g.objects[id]!).power)).toEqual([2, 2]);
  });
  it('Exhume: each player chooses a creature card from their own graveyard; it enters under its owner\'s control', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [mine, other] = [give(g, 'alice', 'Zombie', 'graveyard'), give(g, 'alice', 'Big Bear', 'graveyard')];
    const bobs = give(g, 'bob', 'Zombie', 'graveyard');
    let asked = '';
    g = drive(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Exhume Lite', 'hand') })), (g) => {
      if (g.pending?.kind !== 'choose_objects') return null;
      asked = g.pending.player;
      return act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'choose_objects', objects: [mine] } });
    });
    expect([asked, g.objects[mine]!.zone, g.objects[other]!.zone, g.objects[bobs]!.zone, g.objects[bobs]!.controller]).toEqual(['alice', 'battlefield', 'graveyard', 'battlefield', 'bob']);
  });
  it("Heartwood Storyteller: each of that player's opponents may draw — not the caster", () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    give(g, 'bob', 'Storyteller Lite', 'battlefield');
    const hands = () => ['alice', 'bob', 'carol'].map((p) => g.zones.hand[p]?.length ?? 0);
    const before = hands();
    const asked: string[] = [];
    g = drive(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Salve', 'hand') })), (g) => {
      if (g.pending?.kind !== 'may') return null;
      asked.push(g.pending.player);
      return act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'may', yes: true } });
    }, 20);
    expect(asked).toEqual(['bob', 'carol']);
    expect(hands().map((n, i) => n - before[i]!)).toEqual([0, 1, 1]);
  });
  it('Opal Archangel: "it becomes a 5/5 Angel creature" — this enchantment, not the spell', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const opal = give(g, 'alice', 'Opal Angel Lite', 'battlefield');
    const zombie = give(g, 'bob', 'Zombie', 'hand');
    g = drive(settle(act(g, { type: 'cast', player: 'bob', object: zombie })), () => null);
    const [o, z] = [chars(g, g.objects[opal]!), chars(g, g.objects[zombie]!)];
    expect([o.types, o.subtypes, o.power, z.subtypes, z.power]).toEqual([['Creature'], ['Angel'], 5, ['Zombie'], 2]);
  });
  it('Boomerang Basics: "If you controlled that permanent" — as the spell began to resolve', () => {
    for (const whose of ['alice', 'bob']) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const z = give(g, whose, 'Zombie', 'battlefield');
      const spell = give(g, 'alice', 'Basics Lite', 'hand');
      const hand = g.zones.hand.alice!.length;
      g = drive(settle(act(g, { type: 'cast', player: 'alice', object: spell, targets: [[{ kind: 'object', object: z }]] })), () => null);
      // Cast (-1), drew (+1) — and the Zombie comes back to its owner's hand.
      expect([whose, g.objects[z]!.zone, g.zones.hand.alice!.length - hand]).toEqual([whose, 'hand', whose === 'alice' ? 1 : -1]);
    }
  });
  it('Cut Down: total power and toughness 5 or less', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [big, z] = [give(g, 'bob', 'Big Bear', 'battlefield'), give(g, 'bob', 'Zombie', 'battlefield')];
    const cut = give(g, 'alice', 'Cut Lite', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: cut, targets: [[{ kind: 'object', object: big }]] })).toMatch(/legal target/);
    const after = drive(settle(act(g, { type: 'cast', player: 'alice', object: cut, targets: [[{ kind: 'object', object: z }]] })), () => null);
    expect(after.objects[z]!.zone).toBe('graveyard');
  });
  it('Circular Logic and Spell Stutter: "pays {1} for each …" — counted as it resolves', () => {
    for (const [card, want] of [['Logic Lite', '{3}'], ['Stutter Lite', '{4}']] as const) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      for (let i = 0; i < 3; i++) give(g, 'alice', 'Zombie', 'graveyard');
      for (let i = 0; i < 2; i++) give(g, 'alice', 'Zombie', 'battlefield');
      const salve = give(g, 'alice', 'Salve', 'hand');
      g = act(g, { type: 'cast', player: 'alice', object: salve });
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', card, 'hand'), targets: [[{ kind: 'object', object: salve }]] });
      for (let i = 0; i < 6 && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
      expect([card, g.pending?.kind, (g.pending as { cost?: string }).cost]).toEqual([card, 'pay', want]);
    }
  });
  it('Glorious Gale: "If it was a legendary spell" — the countered spell', () => {
    for (const name of ['Zombie', 'Big Legend Lite']) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const spell = give(g, 'alice', name, 'hand');
      g = act(g, { type: 'cast', player: 'alice', object: spell });
      g = drive(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Gale Lite', 'hand'), targets: [[{ kind: 'object', object: spell }]] })), () => null);
      expect([name, g.objects[spell]!.zone, g.players.alice!.life]).toEqual([name, 'graveyard', name === 'Zombie' ? 20 : 25]);
    }
  });
  it('Unwanted Remake: its controller manifests dread — from their library, their choice', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const z = give(g, 'bob', 'Zombie', 'battlefield');
    let chooser = '';
    g = drive(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Remake Lite', 'hand'), targets: [[{ kind: 'object', object: z }]] })), (g) => {
      if (g.pending?.kind !== 'choose_objects') return null;
      chooser = g.pending.player;
      return act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'choose_objects', objects: [g.pending.candidates[0]!] } });
    });
    const faceDown = g.zones.battlefield.filter((id) => g.objects[id]!.faceDown);
    expect([chooser, g.objects[z]!.zone, faceDown.map((id) => g.objects[id]!.controller)]).toEqual(['bob', 'graveyard', ['bob']]);
  });
  it("Phytotitan: back at the beginning of its owner's next upkeep, tapped", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const titan = give(g, 'alice', 'Phytotitan Lite', 'battlefield');
    g = drive(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: titan }]] })), () => null);
    expect(g.objects[titan]!.zone).toBe('graveyard');
    g = settle(toStep(g, 'draw', 'bob'));
    expect(g.objects[titan]!.zone).toBe('graveyard');
    g = settle(toStep(g, 'draw', 'alice'));
    expect([g.objects[titan]!.zone, g.objects[titan]!.tapped, g.objects[titan]!.controller]).toEqual(['battlefield', true, 'alice']);
  });
  it('Counterbalance: counters a spell with the same mana value as the revealed card', () => {
    for (const top of ['Trinket', 'Zombie']) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
      give(g, 'alice', 'Counterbalance Lite', 'battlefield');
      const card = give(g, 'alice', top, 'library');
      // On top.
      g.zones.library.alice = [card, ...g.zones.library.alice!.filter((id) => id !== card)];
      g.players.bob!.pool.C = 1;
      const spell = give(g, 'bob', 'Trinket', 'hand');
      g = drive(settle(act(g, { type: 'cast', player: 'bob', object: spell })), (g) => (g.pending?.kind === 'may' ? act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }) : null), 20);
      expect([top, g.objects[spell]!.zone, g.zones.library.alice![0]]).toEqual([top, top === 'Trinket' ? 'graveyard' : 'battlefield', card]);
    }
  });
  it('Lurking Predators: a creature onto the battlefield; otherwise, maybe to the bottom', () => {
    for (const [top, keep] of [['Zombie', false], ['Trinket', false], ['Trinket', true]] as const) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
      give(g, 'alice', 'Predators Lite', 'battlefield');
      const card = give(g, 'alice', top, 'library');
      g.zones.library.alice = [card, ...g.zones.library.alice!.filter((id) => id !== card)];
      g = drive(settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Salve', 'hand') })), (g) =>
        g.pending?.kind === 'choose_objects' ? act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'choose_objects', objects: keep ? [card] : [] } }) : null,
      20);
      const lib = g.zones.library.alice!;
      const where = g.objects[card]!.zone === 'battlefield' ? 'battlefield' : lib[0] === card ? 'top' : lib[lib.length - 1] === card ? 'bottom' : '?';
      expect([top, keep, where]).toEqual([top, keep, top === 'Zombie' ? 'battlefield' : keep ? 'top' : 'bottom']);
    }
  });
  it('Telling Time: one into your hand, one on top, one on the bottom', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [a, b, c] = g.zones.library.alice!.slice(0, 3);
    const picks = [b!, c!];
    g = drive(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Telling Lite', 'hand') })), (g) =>
      g.pending?.kind === 'choose_objects' ? act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [picks.shift()!] } }) : null,
    );
    const lib = g.zones.library.alice!;
    expect([g.objects[b!]!.zone, lib[0], lib[lib.length - 1]]).toEqual(['hand', c, a]);
  });
  it("Dovescape: X is the countered spell's mana value as it was on the stack (X included)", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'bob', 'Dovescape Lite', 'battlefield');
    g.players.alice!.pool.U = 3;
    const spell = give(g, 'alice', 'Insight X Lite', 'hand');
    g = drive(settle(act(g, { type: 'cast', player: 'alice', object: spell, x: 2 })), () => null);
    const birds = g.zones.battlefield.filter((id) => g.cards[g.objects[id]!.card]!.name === 'Bird Token');
    expect([g.objects[spell]!.zone, birds.length, birds.every((id) => g.objects[id]!.controller === 'alice')]).toEqual(['graveyard', 3, true]);
  });
  it('Mana Breach: the caster returns a land they control — their choice', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Mana Breach Lite', 'battlefield');
    const lands = [give(g, 'bob', 'Forest', 'battlefield'), give(g, 'bob', 'Forest', 'battlefield')];
    const mine = give(g, 'alice', 'Forest', 'battlefield');
    let chooser = '';
    g = drive(settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Salve', 'hand') })), (g) => {
      if (g.pending?.kind !== 'choose_objects') return null;
      chooser = g.pending.player;
      return act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'choose_objects', objects: [lands[1]!] } });
    });
    expect([chooser, ...lands.map((id) => g.objects[id]!.zone), g.objects[mine]!.zone]).toEqual(['bob', 'battlefield', 'hand', 'battlefield']);
  });
  it('Glen Elendra Guardian: "Remove a counter from this creature" — any kind, the player\'s choice', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mare = give(g, 'alice', 'Loch Mare Lite', 'battlefield');
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === mare)).toBe(false);
    g.objects[mare]!.counters = { '+1/+1': 1, '-1/-1': 1 };
    const ability = legalActions(g, 'alice').find((a) => a.type === 'activate' && a.object === mare) as { ability: number };
    const hand = g.zones.hand.alice!.length;
    g = drive(settle(act(g, { type: 'activate', player: 'alice', object: mare, ability: ability.ability, costs: { removed: [{ object: mare, counter: '-1/-1', n: 1 }] } })), () => null);
    expect([g.objects[mare]!.counters, g.zones.hand.alice!.length]).toEqual([{ '+1/+1': 1 }, hand + 1]);
  });
  it('Ensnaring Bridge: power greater than the number of cards in its controller\'s hand can\'t attack', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Bridge Lite', 'battlefield');
    g.zones.hand.alice = g.zones.hand.alice!.slice(0, 2);
    const [zombie, big] = [give(g, 'bob', 'Zombie', 'battlefield'), give(g, 'bob', 'Big Bear', 'battlefield')];
    g = toAttack(toStep(g, 'beginning_of_combat'));
    expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: big, target: { kind: 'player', player: 'alice' } }] } })).toBeTruthy();
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: zombie, target: { kind: 'player', player: 'alice' } }] } });
    expect(Object.keys(g.combat?.attackers ?? {})).toEqual([zombie]);
  });
  it("Change of Fortune: draw a card for each card you've discarded this turn — the hand just discarded too", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const hand = g.zones.hand.alice!.length;
    g = drive(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Fortune Lite', 'hand') })), () => null);
    expect(g.zones.hand.alice!.length).toBe(hand);
  });
  it('Needle Drop: only a player or permanent that was dealt damage this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const needle = give(g, 'alice', 'Needle Lite', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: needle, targets: [[{ kind: 'player', player: 'bob' }]] })).toMatch(/legal target|can't|no legal/i);
    g = drive(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] })), () => null);
    g = drive(settle(act(g, { type: 'cast', player: 'alice', object: needle, targets: [[{ kind: 'player', player: 'bob' }]] })), () => null);
    expect(g.players.bob!.life).toBe(16);
  });
  it('Pernicious Deed: each artifact, creature, and enchantment with mana value X or less', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const deed = give(g, 'alice', 'Deed Lite', 'battlefield');
    const [trinket, zombie, land] = [give(g, 'bob', 'Trinket', 'battlefield'), give(g, 'bob', 'Zombie', 'battlefield'), give(g, 'bob', 'Forest', 'battlefield')];
    g.players.alice!.pool.C = 1;
    g = drive(settle(act(g, { type: 'activate', player: 'alice', object: deed, ability: 0, x: 1 })), () => null);
    expect([deed, trinket, zombie, land].map((id) => g.objects[id]!.zone)).toEqual(['graveyard', 'graveyard', 'graveyard', 'battlefield']);
  });
  it("Liliana, Waker of the Dead: each opponent who can't discard loses 3 life", () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    g.zones.hand.bob = g.zones.hand.bob!.slice(0, 1);
    g.zones.hand.carol = [];
    g = drive(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Waker Lite', 'hand') })), (g) =>
      g.pending?.kind === 'discard' ? act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'discard', objects: g.zones.hand[g.pending.player]!.slice(0, g.pending.count) } }) : null,
    20);
    expect([g.players.alice!.life, g.players.bob!.life, g.players.carol!.life]).toEqual([20, 20, 17]);
  });
  it('The Wandering Emperor: loyalty abilities at instant speed only the turn she entered', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const old = give(g, 'alice', 'Emperor Lite', 'battlefield');
    g.objects[old]!.counters.loyalty = 3;
    g = act(g, { type: 'pass', player: 'bob' });
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === old)).toBe(false);
    g.zones.battlefield = g.zones.battlefield.filter((id) => id !== old);
    const fresh = give(g, 'alice', 'Emperor Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: fresh }));
    while (g.priority && g.priority !== 'alice') g = act(g, { type: 'pass', player: g.priority });
    const ability = legalActions(g, 'alice').find((a) => a.type === 'activate' && a.object === fresh) as { ability: number } | undefined;
    expect(ability).toBeTruthy();
    g = settle(act(g, { type: 'activate', player: 'alice', object: fresh, ability: ability!.ability }));
    expect(g.players.alice!.life).toBe(21);
  });
  it('Gloomshrieker: "If this creature would die, exile it instead" — only itself', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [me, other] = [give(g, 'alice', 'Shrieker Lite', 'battlefield'), give(g, 'alice', 'Zombie', 'battlefield')];
    for (const t of [me, other]) g = drive(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: t }]] })), () => null);
    expect([g.objects[me]!.zone, g.objects[other]!.zone]).toEqual(['exile', 'graveyard']);
  });
  it('Utter Insignificance: loses all abilities and has base power and toughness 1/1', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const big = give(g, 'bob', 'Big Bear', 'battlefield');
    const aura = give(g, 'alice', 'Insignificance Lite', 'battlefield');
    g.objects[aura]!.attachedTo = { id: big, zcc: g.objects[big]!.zcc };
    expect([chars(g, g.objects[big]!).power, chars(g, g.objects[big]!).toughness]).toEqual([1, 1]);
  });
  it('Colossal Grave-Reaver: one of the creature cards milled onto the battlefield — your choice', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Grave-Reaver Lite', 'battlefield');
    const [a, b, land] = [give(g, 'alice', 'Zombie', 'library'), give(g, 'alice', 'Big Bear', 'library'), give(g, 'alice', 'Forest', 'library')];
    g.zones.library.alice = [a!, b!, land!, ...g.zones.library.alice!.filter((id) => ![a, b, land].includes(id))];
    let offered: string[] = [];
    g = drive(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mill Three', 'hand') })), (g) => {
      if (g.pending?.kind !== 'choose_objects') return null;
      offered = [...g.pending.candidates].sort();
      return act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [b!] } });
    });
    expect([offered, g.objects[a!]!.zone, g.objects[b!]!.zone, g.objects[land!]!.zone]).toEqual([[a, b].sort(), 'graveyard', 'battlefield', 'graveyard']);
  });
  it('Summon: Fenrir: the next creature spell enters with an additional +1/+1 counter (once)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = drive(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Heavenward Lite', 'hand') })), () => null);
    const [one, two] = [give(g, 'alice', 'Zombie', 'hand'), give(g, 'alice', 'Zombie', 'hand')];
    for (const z of [one, two]) g = drive(settle(act(g, { type: 'cast', player: 'alice', object: z })), () => null);
    expect([g.objects[one]!.counters['+1/+1'] ?? 0, g.objects[two]!.counters['+1/+1'] ?? 0]).toEqual([1, 0]);
  });
  it("Storm King's Thunder: copies the next instant or sorcery X times, X as paid", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.players.alice!.pool.R = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', "Storm King's Thunder Lite", 'hand'), x: 2, autoTap: true } as never));
    const life = g.players.bob!.life;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] });
    for (let i = 0; i < 20 && (g.pending || g.stack.length); i++) {
      if (g.pending?.kind === 'copy_targets') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'copy_targets' } } as never);
      else if (g.pending) throw new Error(`pending ${g.pending.kind}`);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.players.bob!.life).toBe(life - 9);
  });
  for (const cleave of [false, true]) {
    it(`Path of Peril: ${cleave ? 'cleaved, every creature' : 'only those with mana value 2 or less'}`, () => {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const small = give(g, 'alice', 'Zombie', 'battlefield');
      const big = give(g, 'bob', 'Four Drop', 'battlefield');
      g.players.alice!.pool.C = 1;
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Path of Peril Lite', 'hand'), ...(cleave ? { alt: 'cleave' } : {}) } as never));
      expect(g.objects[small]!.zone).toBe('graveyard');
      expect(g.objects[big]!.zone).toBe(cleave ? 'graveyard' : 'battlefield');
    });
  }
  it("Wash Away: can't target a spell cast from its owner's hand unless cleaved", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] });
    const top = g.stack[g.stack.length - 1]!;
    const bolt = top.kind === 'spell' ? top.object : '';
    g = act(g, { type: 'pass', player: 'alice' });
    const wash = give(g, 'bob', 'Wash Away Lite', 'hand');
    expect(illegal(g, { type: 'cast', player: 'bob', object: wash, targets: [[{ kind: 'object', object: bolt }]] } as never)).toBeTruthy();
    g.players.bob!.pool.C = 1;
    g = settle(act(g, { type: 'cast', player: 'bob', object: wash, alt: 'cleave', targets: [[{ kind: 'object', object: bolt }]] } as never));
    expect(g.players.bob!.life).toBe(20);
  });
  for (const cleave of [false, true]) {
    it(`Inspired Idea: ${cleave ? 'cleaved, no change to hand size' : 'maximum hand size three less for the rest of the game'}`, () => {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      g.players.alice!.pool.C = 1;
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Inspired Idea Lite', 'hand'), ...(cleave ? { alt: 'cleave' } : {}) } as never));
      expect(maxHandSize(g, 'alice')).toBe(cleave ? 7 : 4);
      expect(maxHandSize(g, 'bob')).toBe(7);
    });
    it(`Lantern Flare: X is ${cleave ? 'paid (cleaved)' : 'the number of creatures you control'}`, () => {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      give(g, 'alice', 'Zombie', 'battlefield');
      const big = give(g, 'bob', 'Big Eldrazi', 'battlefield');
      g.players.alice!.pool.C = 3;
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Lantern Flare Lite', 'hand'), targets: [[{ kind: 'object', object: big }]], ...(cleave ? { alt: 'cleave', x: 3 } : {}) } as never));
      expect(g.objects[big]!.damage).toBe(cleave ? 3 : 1);
      expect(g.players.alice!.life).toBe(cleave ? 23 : 21);
    });
  }
  it('Expel the Interlopers: destroys creatures with power at least the number chosen as it resolves', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const small = give(g, 'alice', 'Zombie', 'battlefield');
    const big = give(g, 'bob', 'Four Drop', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Expel Lite', 'hand') }));
    expect(g.pending).toMatchObject({ kind: 'choose_option', player: 'alice' });
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: '11' } })).toBeTruthy();
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: '3' } }));
    expect(g.objects[small]!.zone).toBe('battlefield');
    expect(g.objects[big]!.zone).toBe('graveyard');
  });
  it('By Invitation Only: each player sacrifices the chosen number of creatures', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mine = [give(g, 'alice', 'Zombie', 'battlefield'), give(g, 'alice', 'Zombie', 'battlefield')];
    const theirs = [give(g, 'bob', 'Zombie', 'battlefield'), give(g, 'bob', 'Zombie', 'battlefield'), give(g, 'bob', 'Zombie', 'battlefield')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Invitation Lite', 'hand') }));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: '2' } });
    for (let i = 0; i < 6 && g.pending; i++) {
      const p = g.pending as { kind: string; player: string; candidates: string[]; count: number };
      expect(p.kind).toBe('sacrifice');
      g = act(g, { type: 'choose', player: p.player, answer: { kind: 'sacrifice', objects: p.candidates.slice(0, p.count) } } as never);
    }
    g = settle(g);
    expect(mine.filter((id) => g.objects[id]!.zone === 'battlefield')).toHaveLength(0);
    expect(theirs.filter((id) => g.objects[id]!.zone === 'battlefield')).toHaveLength(1);
  });
  it('Settle the Wreckage: exiles the attackers; their controller may search for that many basic lands', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const a = [give(g, 'alice', 'Zombie', 'battlefield'), give(g, 'alice', 'Zombie', 'battlefield')];
    const home = give(g, 'alice', 'Zombie', 'battlefield');
    g = attackWith(g, a);
    while (g.priority === 'alice' && !g.pending) g = act(g, { type: 'pass', player: 'alice' });
    const lands = g.zones.battlefield.filter((id) => g.objects[id]!.controller === 'alice').length;
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Settle Lite', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] });
    g = drive(g, (g) => {
      const p = g.pending as { kind: string; player: string; candidates?: string[] };
      if (p.kind === 'may') return act(g, { type: 'choose', player: p.player, answer: { kind: 'may', yes: true } });
      if (p.kind === 'search') return act(g, { type: 'choose', player: p.player, answer: { kind: 'search', objects: p.candidates!.slice(0, 2) } } as never);
      return null;
    }, 20);
    g = settle(g);
    expect(a.map((id) => g.objects[id]!.zone)).toEqual(['exile', 'exile']);
    expect(g.objects[home]!.zone).toBe('battlefield');
    const now = g.zones.battlefield.filter((id) => g.objects[id]!.controller === 'alice');
    expect(now.length).toBe(lands - 2 + 2);
    expect(now.filter((id) => g.objects[id]!.tapped)).toHaveLength(2);
  });
  it('Water Whip: waterbend {3} as an additional cost — mana, or artifacts and creatures tapped', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const zs = [give(g, 'alice', 'Zombie', 'battlefield'), give(g, 'alice', 'Zombie', 'battlefield'), give(g, 'alice', 'Zombie', 'battlefield'), give(g, 'alice', 'Zombie', 'battlefield')];
    const whip = give(g, 'alice', 'Water Whip Lite', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: whip })).toMatch(/mana/i);
    expect(illegal(g, { type: 'cast', player: 'alice', object: whip, costs: { waterbend: zs } } as never)).toMatch(/at most 3/);
    const offered = legalActions(g, 'alice').find((a) => a.type === 'cast' && a.object === whip) as { costs?: { waterbend?: string[] } } | undefined;
    expect(offered?.costs?.waterbend).toHaveLength(3);
    g.players.alice!.pool.C = 1;
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: whip, costs: { waterbend: zs.slice(0, 2) } } as never));
    expect(zs.map((z) => g.objects[z]!.tapped)).toEqual([true, true, false, false]);
    expect(g.players.alice!.pool.C ?? 0).toBe(0);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });
  for (const paid of [false, true]) {
    it(`Katara, Seeking Revenge: draws, then discards ${paid ? 'nothing — waterbended' : 'a card'}`, () => {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const zs = [give(g, 'alice', 'Zombie', 'battlefield'), give(g, 'alice', 'Zombie', 'battlefield')];
      const katara = give(g, 'alice', 'Katara Lite', 'hand');
      const before = g.zones.hand.alice!.length;
      g = settle(act(g, { type: 'cast', player: 'alice', object: katara, ...(paid ? { extras: ['additional'], costs: { waterbend: zs } } : {}) } as never));
      for (let i = 0; i < 4 && g.pending; i++) {
        const p = g.pending as { kind: string; player: string };
        expect(p.kind).toBe('discard');
        const hand = g.zones.hand.alice!;
        g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: [hand[0]!] } }));
      }
      expect(g.zones.hand.alice!.length).toBe(paid ? before : before - 1);
      expect(zs.every((z) => g.objects[z]!.tapped)).toBe(paid);
    });
  }
  it('Punishing Punch: damage equal to twice its power, dealt by it', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const z = give(g, 'alice', 'Zombie', 'battlefield');
    const big = give(g, 'bob', 'Big Eldrazi', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Punch Lite', 'hand'), targets: [[{ kind: 'object', object: z }], [{ kind: 'object', object: big }]] } as never));
    expect(g.objects[big]!.damage).toBe(4);
  });
  it('Otherworldly Outburst: a token when that creature dies this turn — only that one', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const z = give(g, 'alice', 'Zombie', 'battlefield');
    const other = give(g, 'alice', 'Zombie', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Outburst Lite', 'hand'), targets: [[{ kind: 'object', object: z }]] } as never));
    const tokens = () => g.zones.battlefield.filter((id) => g.objects[id]!.token).length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: other }]] } as never));
    expect(tokens()).toBe(0);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: z }]] } as never));
    expect(tokens()).toBe(1);
    // Back on the battlefield, it's a new object (CR 400.7): its dying again doesn't trigger it.
    moveObject(g, z, 'battlefield', []);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: z }]] } as never));
    expect(g.objects[z]!.zone).toBe('graveyard');
    expect(tokens()).toBe(1);
  });
  it('Meditate: you skip your next turn — the next player goes again', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Meditate Lite', 'hand') }));
    const turn = g.turn;
    g = toStep(g, 'upkeep');
    expect([g.active, g.turn]).toEqual(['bob', turn + 1]);
    g = toStep(toStep(g, 'main1'), 'upkeep');
    expect([g.active, g.turn]).toEqual(['bob', turn + 2]);
    g = toStep(toStep(g, 'main1'), 'upkeep');
    expect([g.active, g.turn]).toEqual(['alice', turn + 3]);
  });
  it('Fatigue: target player skips their next draw step', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Fatigue Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    g = toStep(g, 'upkeep', 'bob');
    const hand = g.zones.hand.bob!.length;
    g = toStep(g, 'main1', 'bob');
    expect(g.zones.hand.bob!.length).toBe(hand);
    g = toStep(toStep(g, 'upkeep', 'bob'), 'main1', 'bob');
    expect(g.zones.hand.bob!.length).toBe(hand + 1);
  });
  it('Stonehorn Dignitary: the opponent skips their next combat phase', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Stonehorn Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    g = toStep(g, 'beginning_of_combat');
    expect(g.active).toBe('alice');
    g = toStep(g, 'main1', 'bob');
    const steps: string[] = [];
    for (let i = 0; i < 6 && g.step !== 'main2'; i++) {
      g = act(g, { type: 'pass', player: g.priority! });
      steps.push(g.step);
    }
    expect(steps.includes('beginning_of_combat')).toBe(false);
    expect(g.step).toBe('main2');
    g = toStep(toStep(g, 'main1', 'bob'), 'beginning_of_combat');
    expect(g.active).toBe('bob');
  });
  it('Brine Elemental: each opponent skips their next untap step', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const z = give(g, 'bob', 'Zombie', 'battlefield');
    g.objects[z]!.tapped = true;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Brine Lite', 'hand') }));
    g = toStep(g, 'upkeep', 'bob');
    expect(g.objects[z]!.tapped).toBe(true);
    g = toStep(toStep(g, 'main1', 'bob'), 'upkeep', 'bob');
    expect(g.objects[z]!.tapped).toBe(false);
  });
  it('Starfall Invocation: with the gift, one of your creature cards destroyed this way comes back', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const z = give(g, 'alice', 'Zombie', 'battlefield');
    const four = give(g, 'alice', 'Four Drop', 'battlefield');
    const bear = give(g, 'bob', 'Big Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Starfall Lite', 'hand'), extras: ['gift'] } as never));
    expect(g.pending).toMatchObject({ kind: 'choose_objects', player: 'alice' });
    expect([...(g.pending as { candidates: string[] }).candidates].sort()).toEqual([z, four].sort());
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [four] } }));
    expect(g.objects[four]!.zone).toBe('battlefield');
    expect(g.objects[z]!.zone).toBe('graveyard');
    expect(g.objects[bear]!.zone).toBe('graveyard');
  });
  it('Leyline Tyrant: any amount of {R} — red mana only — then that much damage', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const t = give(g, 'alice', 'Tyrant Lite', 'battlefield');
    g.players.alice!.pool.C = 3;
    g.players.alice!.pool.R = 2;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: t }]] } as never);
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    for (let i = 0; i < 6 && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.pending).toMatchObject({ kind: 'pay', player: 'alice' });
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true, x: 3 } })).toBeTruthy();
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true, x: 2 } });
    for (let i = 0; i < 10 && (g.pending || g.stack.length); i++) {
      if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } });
      else if (g.pending) throw new Error(`pending ${g.pending.kind}`);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.players.bob!.life).toBe(18);
    expect(g.players.alice!.pool.C).toBe(3);
  });
  it('Hellkite Courser: your commander from the command zone, with haste, back at the next end step', () => {
    const deck = [...Array.from({ length: 40 }, () => 'Forest'), 'Kinnan, Bonder Prodigy', 'Courser Lite'];
    let g = toStep(start({ format: 'commander', extra: CARDS, decks: { alice: deck, bob: deck }, commanders: { alice: ['Kinnan, Bonder Prodigy'] } }), 'main1', 'alice');
    const kinnan = g.zones.command.find((id) => g.objects[id]!.commander)!;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Courser Lite', 'hand') }));
    expect(g.pending).toMatchObject({ kind: 'may', player: 'alice' });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    expect(g.objects[kinnan]!.zone).toBe('battlefield');
    expect(chars(g, g.objects[kinnan]!).keywords.some((k) => k.id === 'haste')).toBe(true);
    g = toStep(g, 'end', 'alice');
    g = settle(g);
    expect(g.objects[kinnan]!.zone).toBe('command');
  });
  it('Turn to Slag: destroys the Equipment attached to that creature, not others', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const big = give(g, 'bob', 'Big Eldrazi', 'battlefield');
    const other = give(g, 'bob', 'Zombie', 'battlefield');
    const on = give(g, 'bob', 'Sword Lite', 'battlefield');
    const off = give(g, 'bob', 'Sword Lite', 'battlefield');
    g.objects[on]!.attachedTo = { id: big, zcc: g.objects[big]!.zcc };
    g.objects[off]!.attachedTo = { id: other, zcc: g.objects[other]!.zcc };
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Slag Lite', 'hand'), targets: [[{ kind: 'object', object: big }]] } as never));
    expect(g.objects[on]!.zone).toBe('graveyard');
    expect(g.objects[off]!.zone).toBe('battlefield');
  });
  it('Lightning Dart: 4 damage instead to a white or blue creature', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const big = give(g, 'bob', 'Big Eldrazi', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Dart Lite', 'hand'), targets: [[{ kind: 'object', object: big }]] } as never));
    expect(g.objects[big]!.damage).toBe(1);
  });
  it("Flame Spill: excess damage is dealt to that creature's controller instead", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const z = give(g, 'bob', 'Zombie', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Spill Lite', 'hand'), targets: [[{ kind: 'object', object: z }]] } as never));
    expect(g.objects[z]!.zone).toBe('graveyard');
    expect(g.players.bob!.life).toBe(18);
  });
  it('Fiery Annihilation: only an Equipment attached to that creature; the creature is exiled if it would die', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const z = give(g, 'bob', 'Zombie', 'battlefield');
    const other = give(g, 'bob', 'Zombie', 'battlefield');
    const on = give(g, 'bob', 'Sword Lite', 'battlefield');
    const off = give(g, 'bob', 'Sword Lite', 'battlefield');
    g.objects[on]!.attachedTo = { id: z, zcc: g.objects[z]!.zcc };
    g.objects[off]!.attachedTo = { id: other, zcc: g.objects[other]!.zcc };
    const spell = give(g, 'alice', 'Annihilation Lite', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: spell, targets: [[{ kind: 'object', object: z }], [{ kind: 'object', object: off }]] } as never)).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: spell, targets: [[{ kind: 'object', object: z }], [{ kind: 'object', object: on }]] } as never));
    expect(g.objects[on]!.zone).toBe('exile');
    expect(g.objects[z]!.zone).toBe('exile');
    expect(g.objects[off]!.zone).toBe('battlefield');
  });
  for (const green of [false, true]) {
    it(`Wistfulness: "if {G}{G} was spent to cast it" — ${green ? 'it was' : 'colorless mana was'}`, () => {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      if (green) g.players.alice!.pool.G = 2;
      else g.players.alice!.pool.C = 2;
      const hand = g.zones.hand.alice!.length;
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Incarnation Lite', 'hand') }));
      expect(g.zones.hand.alice!.length).toBe(hand + (green ? 1 : 0));
    });
  }
  it('Defang: damage enchanted creature would deal is prevented', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const z = give(g, 'alice', 'Zombie', 'battlefield');
    const free = give(g, 'alice', 'Zombie', 'battlefield');
    const aura = give(g, 'bob', 'Defang Lite', 'battlefield');
    g.objects[aura]!.attachedTo = { id: z, zcc: g.objects[z]!.zcc };
    g = attackWith(g, [z, free]);
    for (let i = 0; i < 20 && g.step !== 'main2'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks: [] } });
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.players.bob!.life).toBe(18);
  });
  it('Ophidian: unblocked, draw a card and it assigns no combat damage', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const snake = give(g, 'alice', 'Ophidian Lite', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = attackWith(g, [snake]);
    for (let i = 0; i < 30 && g.step !== 'main2'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks: [] } });
      else if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'may', yes: true } });
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
    expect(g.players.bob!.life).toBe(20);
  });
  it("Lord of the Void: a creature card from among the exiled ones, under your control", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lord = give(g, 'alice', 'Void Lord Lite', 'battlefield');
    const z = give(g, 'bob', 'Zombie', 'library');
    g.zones.library.bob = [z, ...g.zones.library.bob!.filter((id) => id !== z)];
    g = attackWith(g, [lord]);
    for (let i = 0; i < 30 && g.step !== 'main2'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks: [] } });
      else if (g.pending?.kind === 'choose_objects') {
        expect((g.pending as { candidates: string[] }).candidates).toContain(z);
        g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [z] } });
      } else if (g.pending) throw new Error(`pending ${g.pending.kind}`);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.objects[z]).toMatchObject({ zone: 'battlefield', controller: 'alice', owner: 'bob' });
  });
  it('Extract from Darkness: a creature card from any graveyard, under your control', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const z = give(g, 'bob', 'Zombie', 'graveyard');
    const four = give(g, 'alice', 'Four Drop', 'graveyard');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Extract Lite', 'hand') }));
    expect(g.pending).toMatchObject({ kind: 'choose_objects', player: 'alice' });
    expect((g.pending as { candidates: string[] }).candidates).toEqual(expect.arrayContaining([z, four]));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [z] } }));
    expect(g.objects[z]).toMatchObject({ zone: 'battlefield', controller: 'alice' });
  });
  for (const attacked of [false, true]) {
    it(`Berserk: doubles its power; destroyed at the end step ${attacked ? 'since it attacked' : '— not, since it didn\'t attack'}`, () => {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const z = give(g, 'alice', 'Zombie', 'battlefield');
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Berserk Lite', 'hand'), targets: [[{ kind: 'object', object: z }]] } as never));
      expect(chars(g, g.objects[z]!).power).toBe(4);
      if (attacked) g = attackWith(g, [z]);
      g = settle(toStep(g, 'end', 'alice'));
      expect(g.objects[z]!.zone).toBe(attacked ? 'graveyard' : 'battlefield');
    });
  }
  for (const tap of [false, true]) {
    it(`Command Bridge: sacrificed unless you tap an untapped permanent (${tap ? 'tapped one' : 'declined'})`, () => {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const z = give(g, 'alice', 'Zombie', 'battlefield');
      const bridge = give(g, 'alice', 'Command Bridge Lite', 'hand');
      g = act(g, { type: 'play_land', player: 'alice', object: bridge });
      g = drive(g, (g) => {
        const p = g.pending as { kind: string; player: string; options?: string[]; candidates?: string[] };
        if (p.kind === 'pay') return act(g, { type: 'choose', player: p.player, answer: { kind: 'pay', pay: tap } });
        if (p.kind === 'choose_objects') return act(g, { type: 'choose', player: p.player, answer: { kind: 'choose_objects', objects: [p.candidates![0]!] } });
        return null;
      }, 20);
      g = settle(g);
      expect(g.objects[bridge]!.zone).toBe(tap ? 'battlefield' : 'graveyard');
      expect(g.objects[z]!.tapped).toBe(tap);
    });
  }
  it("Hammerhead Tyrant: only a permanent with mana value at most that spell's", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Hammerhead Lite', 'battlefield');
    const four = give(g, 'bob', 'Four Drop', 'battlefield');
    const big = give(g, 'bob', 'Big Eldrazi', 'battlefield');
    g.players.alice!.pool.C = 4;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Four Drop', 'hand'), autoTap: true } as never);
    expect(g.pending).toMatchObject({ kind: 'trigger_targets' });
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: big }]] } })).toBeTruthy();
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: four }]] } }));
    expect(g.objects[four]!.zone).toBe('hand');
    expect(g.objects[big]!.zone).toBe('battlefield');
  });
  it('Fireball: X damage divided evenly, rounded down, among the targets', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const big = give(g, 'bob', 'Big Eldrazi', 'battlefield');
    g.players.alice!.pool.C = 8;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Fireball Evenly Lite', 'hand'), x: 7, autoTap: true, targets: [[{ kind: 'player', player: 'bob' }, { kind: 'object', object: big }]] } as never));
    expect(g.players.bob!.life).toBe(17);
    expect(g.objects[big]!.damage).toBe(3);
    expect(g.players.alice!.pool.C ?? 0).toBe(0);
  });
  it('Relic of Progenitus: the target player chooses a card from their graveyard to exile', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const relic = give(g, 'alice', 'Progenitus Lite', 'battlefield');
    const a = give(g, 'bob', 'Zombie', 'graveyard');
    const b2 = give(g, 'bob', 'Four Drop', 'graveyard');
    g = settle(act(g, { type: 'activate', player: 'alice', object: relic, ability: 0, targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.pending).toMatchObject({ kind: 'choose_objects', player: 'bob' });
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'choose_objects', objects: [b2] } }));
    expect(g.objects[b2]!.zone).toBe('exile');
    expect(g.objects[a]!.zone).toBe('graveyard');
  });
  it('Brass Knuckles: double strike only with two or more Equipment attached', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const z = give(g, 'alice', 'Zombie', 'battlefield');
    const k = give(g, 'alice', 'Knuckles Lite', 'battlefield');
    g.objects[k]!.attachedTo = { id: z, zcc: g.objects[z]!.zcc };
    expect(chars(g, g.objects[z]!).keywords.some((x) => x.id === 'double_strike')).toBe(false);
    const sword = give(g, 'alice', 'Sword Lite', 'battlefield');
    g.objects[sword]!.attachedTo = { id: z, zcc: g.objects[z]!.zcc };
    expect(chars(g, g.objects[z]!).keywords.some((x) => x.id === 'double_strike')).toBe(true);
  });
  for (const big of [false, true]) {
    it(`Pack tactics: ${big ? 'total power 6 — draws' : 'total power 4 — no card'}`, () => {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const leader = give(g, 'alice', 'Pack Leader Lite', 'battlefield');
      const other = give(g, 'alice', big ? 'Four Drop' : 'Zombie', 'battlefield');
      const hand = g.zones.hand.alice!.length;
      g = attackWith(g, [leader, other]);
      g = settle(g);
      expect(g.zones.hand.alice!.length).toBe(hand + (big ? 1 : 0));
    });
  }
  for (const land of [true, false]) {
    it(`Kroxa: an opponent who ${land ? 'discards a land' : 'discards a nonland card'} ${land ? 'loses' : "doesn't lose"} 3 life`, () => {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      for (const id of g.zones.hand.bob!.splice(0)) g.objects[id]!.zone = 'exile';
      give(g, 'bob', land ? 'Forest' : 'Zombie', 'hand');
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Kroxa Lite', 'hand') }));
      expect(g.zones.hand.bob!.length).toBe(0);
      expect(g.players.bob!.life).toBe(land ? 17 : 20);
    });
  }
  it("Vow of Duty: the enchanted creature can't attack the Aura's controller, only others (CR 508.1c)", () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const z = give(g, 'alice', 'Zombie', 'battlefield', { sick: false });
    const vow = give(g, 'bob', 'Vow Lite', 'battlefield');
    g.objects[vow]!.attachedTo = { id: z, zcc: g.objects[z]!.zcc };
    expect(chars(g, g.objects[z]!).power).toBe(4);
    g = toAttack(toStep(g, 'beginning_of_combat'));
    const at = (player: string) => ({ type: 'choose' as const, player: 'alice', answer: { kind: 'declare_attackers' as const, attacks: [{ attacker: z, target: { kind: 'player' as const, player } }] } });
    expect(illegal(g, at('bob'))).toMatch(/can’t attack Bob/);
    g = act(g, at('carol'));
    expect(g.objects[z]!.tapped).toBeFalsy();
  });
  it('Prophet of the Scarab: the greater of two counts', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Zombie', 'battlefield');
    for (let i = 0; i < 3; i++) give(g, 'alice', 'Zombie', 'graveyard');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Prophet Lite', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(hand + 3);
  });
  it('Dire Fleet Ravager: each player loses a third of their life, rounded up', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.players.bob!.life = 10;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ravager Lite', 'hand') }));
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([13, 6]);
  });
  it("Suspect: menace and can't block until it's no longer suspected (CR 701.60)", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const sv = give(g, 'alice', 'Servitor Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: sv }));
    const c = chars(g, g.objects[sv]!);
    expect([c.keywords.some((k) => k.id === 'menace'), c.rules.has('cant_block')]).toEqual([true, true]);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Lammasu Lite', 'hand') }));
    const d = chars(g, g.objects[sv]!);
    expect([g.objects[sv]!.suspected, d.keywords.some((k) => k.id === 'menace'), d.rules.has('cant_block')]).toEqual([undefined, false, false]);
  });
  it("Agrus Kos: suspects a creature that isn't, exiles one that is", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const z = give(g, 'bob', 'Zombie', 'battlefield');
    for (let i = 0; i < 2; i++) {
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Agrus Lite', 'hand') });
      g = drive(g, (g) => (g.pending?.kind === 'trigger_targets' ? act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: z }]] } } as never) : null));
      expect(i === 0 ? g.objects[z]!.suspected !== undefined : g.objects[z]!.zone === 'exile').toBe(true);
    }
  });
  for (const n of [2, 3]) {
    it(`Case: ${n === 3 ? 'solved at the end step, then its Solved ability works' : 'not solved without three artifacts'} (CR 719.3)`, () => {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const cs = give(g, 'alice', 'Case Lite', 'battlefield');
      for (let i = 0; i < n; i++) give(g, 'alice', 'Sword Lite', 'battlefield');
      expect(() => act(g, { type: 'activate', player: 'alice', object: cs, ability: 0 })).toThrow();
      g = toStep(g, 'end', 'alice');
      g = settle(g);
      expect(Boolean(g.objects[cs]!.solved)).toBe(n === 3);
      if (n === 3) {
        const hand = g.zones.hand.alice!.length;
        g = settle(act(g, { type: 'activate', player: 'alice', object: cs, ability: 0 }));
        expect(g.zones.hand.alice!.length).toBe(hand + 1);
      }
    });
  }
  it('Rot Hulk: up to X targets, X counted as they are chosen (one per opponent)', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    const zs = [0, 1, 2].map(() => give(g, 'alice', 'Zombie', 'graveyard'));
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Rot Hulk Lite', 'hand') });
    g = settle(g);
    expect(g.pending).toMatchObject({ kind: 'trigger_targets' });
    expect((g.pending as { prompts?: { count: number }[] }).prompts?.[0]?.count ?? (g.pending as never as { targets: { count: number }[] }).targets?.[0]?.count).toBe(2);
    expect(() => act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [zs.map((z) => ({ kind: 'object' as const, object: z }))] } } as never)).toThrow();
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [zs.slice(0, 2).map((z) => ({ kind: 'object' as const, object: z }))] } } as never));
    expect(zs.map((z) => g.objects[z]!.zone)).toEqual(['battlefield', 'battlefield', 'graveyard']);
  });
  it('Vile Requiem: X is its verse counters as targets are chosen, before it is sacrificed', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const rq = give(g, 'alice', 'Requiem Lite', 'battlefield');
    g.objects[rq]!.counters.verse = 2;
    const zs = [0, 1].map(() => give(g, 'bob', 'Zombie', 'battlefield'));
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'activate', player: 'alice', object: rq, ability: 0, targets: [zs.map((z) => ({ kind: 'object' as const, object: z }))] }));
    expect(zs.map((z) => g.objects[z]!.zone)).toEqual(['graveyard', 'graveyard']);
  });
  it('Indulgent Tormentor: the opponent may pay 3 life instead (CR 119.4)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Tormentor Lite', 'battlefield');
    g = toStep(g, 'upkeep', 'alice');
    g = drive(g, (g) => (g.pending?.kind === 'trigger_targets' ? act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } } as never) : null), 4);
    expect(g.pending).toMatchObject({ kind: 'choose_option', player: 'bob' });
    const options = (g.pending as { options: string[] }).options;
    expect(options).toEqual(['pay 3 life', 'Neither: draw']);
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'choose_option', choice: 'pay 3 life' } }));
    expect([g.players.bob!.life, g.zones.hand.alice!.length]).toEqual([17, hand]);
  });
  it('Angelic Skirmisher: the chosen ability for creatures you control', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const sk = give(g, 'alice', 'Skirmisher Lite', 'battlefield');
    g = toStep(g, 'beginning_of_combat', 'alice');
    g = drive(g, () => null, 2);
    expect(g.pending).toMatchObject({ kind: 'choose_option' });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: 'lifelink' } }));
    expect(chars(g, g.objects[sk]!).keywords.map((k) => k.id)).toContain('lifelink');
  });
  for (const discard of [false, true]) {
    it(`The Raven Man: a Bird ${discard ? 'when' : 'only if'} a player discarded this turn`, () => {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      give(g, 'alice', 'Raven Man Lite', 'battlefield');
      if (discard) g.turnLog.discarded = [{ id: g.zones.hand.bob![0]!, zcc: 0, player: 'bob' }];
      const n = g.zones.battlefield.length;
      g = settle(toStep(g, 'end', 'alice'));
      expect(g.zones.battlefield.length - n).toBe(discard ? 1 : 0);
    });
  }
  it('Fangorn: twice as much {G} as Treefolk attacking', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const a = [give(g, 'alice', 'Fangorn Lite', 'battlefield', { sick: false }), give(g, 'alice', 'Fangorn Lite', 'battlefield', { sick: false })];
    g = settle(attackWith(g, a));
    expect(g.players.alice!.pool.G ?? 0).toBe(8);
  });
  for (const creature of [true, false]) {
    it(`Teferi's Time Twist: ${creature ? 'a creature returns with a +1/+1 counter' : 'a noncreature returns without one'}`, () => {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const p = give(g, 'alice', creature ? 'Zombie' : 'Sword Lite', 'battlefield');
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Time Twist Lite', 'hand'), targets: [[{ kind: 'object', object: p }]] }));
      expect(g.objects[p]!.zone).toBe('exile');
      g = settle(toStep(g, 'end', 'alice'));
      expect([g.objects[p]!.zone, g.objects[p]!.counters['+1/+1'] ?? 0]).toEqual(['battlefield', creature ? 1 : 0]);
    });
  }
  it('Kruphix: unspent mana becomes colorless instead of being lost (CR 614.1a)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Kruphix Lite', 'battlefield');
    g.players.alice!.pool.G = 2;
    g.players.alice!.pool.R = 1;
    g.players.bob!.pool.G = 2;
    g = toStep(g, 'beginning_of_combat', 'alice');
    expect([g.players.alice!.pool.G, g.players.alice!.pool.R, g.players.alice!.pool.C, g.players.bob!.pool.G]).toEqual([0, 0, 3, 0]);
  });
  it('Omnath, Locus of Mana: +1/+1 for each unspent green mana', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const o = give(g, 'alice', 'Omnath Mana Lite', 'battlefield');
    g.players.alice!.pool.G = 3;
    g.players.alice!.pool.R = 2;
    expect(chars(g, g.objects[o]!).power).toBe(4);
  });
  it('Soulbond: paired as either enters, both have the ability, unpaired when one leaves (CR 702.95)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const z = give(g, 'alice', 'Zombie', 'battlefield');
    const w = give(g, 'alice', 'Wingcrafter Lite', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: w });
    g = drive(g, (g) => (g.pending?.kind === 'choose_objects' ? act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [z] } }) : null));
    const flies = (id: string) => chars(g, g.objects[id]!).keywords.some((k) => k.id === 'flying');
    expect([flies(w), flies(z)]).toEqual([true, true]);
    moveObject(g, z, 'graveyard', []);
    expect(flies(w)).toBe(false);
    // "Whenever another creature you control enters" — it pairs with the new one.
    const z2 = give(g, 'alice', 'Zombie', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: z2 });
    g = drive(g, (g) => (g.pending?.kind === 'choose_objects' ? act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [z2] } }) : null));
    expect([flies(w), flies(z2)]).toEqual([true, true]);
  });
  it('Witness Protection: a new name, types, colors and base P/T', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const z = give(g, 'bob', 'Four Drop', 'battlefield');
    const wp = give(g, 'alice', 'Witness Lite', 'battlefield');
    g.objects[wp]!.attachedTo = { id: z, zcc: g.objects[z]!.zcc };
    const c = chars(g, g.objects[z]!);
    expect([c.name, c.subtypes, c.colors, c.power, c.toughness]).toEqual(['Legitimate Businessperson', ['Citizen'], ['G', 'W'], 1, 1]);
  });
  it('Stormwing Entity: "{2}{U} less" takes off the blue symbol and two generic', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const sw = give(g, 'alice', 'Stormwing Lite', 'hand');
    g.players.alice!.pool.U = 2;
    expect(illegal(g, { type: 'cast', player: 'alice', object: sw })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Zero Instant', 'hand') }));
    g = settle(act(g, { type: 'cast', player: 'alice', object: sw }));
    expect([g.objects[sw]!.zone, g.players.alice!.pool.U]).toEqual(['battlefield', 0]);
  });
  it("The Balrog, Durin's Bane: {1} less for each permanent sacrificed this turn", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.turnLog.sacrificedBy = { bob: [0, 1, 2].map(() => ({ types: ['Creature'], subtypes: [] })) };
    g.players.alice!.pool.C = 4;
    const b = give(g, 'alice', 'Balrog Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: b }));
    expect(g.objects[b]!.zone).toBe('battlefield');
  });
  it('Champions of the Perfect: "behold an Elf and exile it" — returned when it leaves', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const elf = give(g, 'alice', 'Elf Card Lite', 'hand');
    const champ = give(g, 'alice', 'Perfect Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: champ, costs: { reveal: [elf] } } as never));
    expect([g.objects[champ]!.zone, g.objects[elf]!.zone]).toEqual(['battlefield', 'exile']);
    g.players.alice!.pool.C = 6;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Glare Lite', 'hand'), x: 6, autoTap: true, targets: [[{ kind: 'object', object: champ }]] } as never));
    expect([g.objects[champ]!.zone, g.objects[elf]!.zone]).toEqual(['graveyard', 'hand']);
  });
  it('Massacre: "If an opponent controls a Plains and you control a Swamp, you may cast this spell without paying its mana cost" (CR 118.9)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const m = give(g, 'alice', 'Massacre Lite', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: m, alt: 'alt' })).toBeTruthy();
    give(g, 'bob', 'Plains', 'battlefield');
    give(g, 'alice', 'Swamp', 'battlefield');
    const z = give(g, 'bob', 'Zombie', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: m, alt: 'alt' }));
    expect(g.objects[z]!.zone).toBe('graveyard');
  });
  for (const before of [false, true]) {
    it(`Slick Sequence: "if you've cast another spell this turn" ${before ? 'draws after another spell' : "doesn't count itself"}`, () => {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      if (before) g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Zero Instant', 'hand') }));
      const hand = g.zones.hand.alice!.length;
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Slick Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
      expect(g.zones.hand.alice!.length - hand).toBe(before ? 1 : 0);
    });
  }
  it('Galvanic Discharge: you get {E}{E}{E}, then pay any amount of {E} for that much damage', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const big = give(g, 'bob', 'Big Eldrazi', 'battlefield');
    g.players.alice!.counters = { energy: 2 };
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Discharge Lite', 'hand'), targets: [[{ kind: 'object', object: big }]] });
    g = drive(g, () => null, 3);
    expect(g.pending).toMatchObject({ kind: 'pay', x: { max: 5 } });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true, x: 4 } } as never));
    expect([g.objects[big]!.damage, g.players.alice!.counters?.energy]).toEqual([4, 1]);
  });
  it('Tail Swipe: the creature you control gets +1/+1 in your main phase, then they fight', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mine = give(g, 'alice', 'Zombie', 'battlefield');
    const theirs = give(g, 'bob', 'Zombie', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Swipe Lite', 'hand'), targets: [[{ kind: 'object', object: mine }], [{ kind: 'object', object: theirs }]] }));
    expect([g.objects[mine]!.zone, g.objects[theirs]!.zone]).toEqual(['battlefield', 'graveyard']);
  });
  it('Brought Back: only permanent cards put into your graveyard from the battlefield this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const died = give(g, 'alice', 'Zombie', 'battlefield');
    const milled = give(g, 'alice', 'Four Drop', 'graveyard');
    g.players.alice!.pool.C = 6;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Glare Lite', 'hand'), x: 2, autoTap: true, targets: [[{ kind: 'object', object: died }]] } as never));
    expect(g.objects[died]!.zone).toBe('graveyard');
    const bb = give(g, 'alice', 'Brought Back Lite', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: bb, targets: [[{ kind: 'object', object: milled }]] })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: bb, targets: [[{ kind: 'object', object: died }]] }));
    expect([g.objects[died]!.zone, g.objects[died]!.tapped]).toEqual(['battlefield', true]);
  });
  it('Grafted Wargear: moving it to another creature sacrifices the first one', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const a = give(g, 'alice', 'Zombie', 'battlefield');
    const b2 = give(g, 'alice', 'Zombie', 'battlefield');
    const w = give(g, 'alice', 'Wargear Lite', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: w, ability: 0, targets: [[{ kind: 'object', object: a }]] }));
    expect(chars(g, g.objects[a]!).power).toBe(5);
    g = settle(act(g, { type: 'activate', player: 'alice', object: w, ability: 0, targets: [[{ kind: 'object', object: b2 }]] }));
    expect([g.objects[a]!.zone, g.objects[b2]!.zone]).toEqual(['graveyard', 'battlefield']);
  });
  it('Eminence: Edgar triggers from the command zone and the battlefield, not for himself; The Ur-Dragon reduces from there', () => {
    const deck = [...Array.from({ length: 40 }, () => 'Swamp'), 'Edgar Lite', 'Vampire Cub'];
    let g = toStep(start({ format: 'commander', extra: CARDS, decks: { alice: deck, bob: deck }, commanders: { alice: ['Edgar Lite'] } }), 'main1', 'alice');
    const edgar = g.zones.command.find((id) => g.objects[id]!.commander)!;
    const tokens = () => g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice').length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Vampire Cub', 'hand') }));
    expect(tokens()).toBe(1);
    // Casting Edgar himself isn't "another Vampire spell".
    g.players.alice!.pool.B = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: edgar }));
    expect(g.objects[edgar]!.zone).toBe('battlefield');
    expect(tokens()).toBe(1);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Vampire Cub', 'hand') }));
    expect(tokens()).toBe(2);
    // In the graveyard it does nothing.
    moveObject(g, edgar, 'graveyard', []);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Vampire Cub', 'hand') }));
    expect(tokens()).toBe(2);

    const deck2 = [...Array.from({ length: 40 }, () => 'Swamp'), 'Ur Lite', 'Dragon Three'];
    let h = toStep(start({ format: 'commander', extra: CARDS, decks: { alice: deck2, bob: deck2 }, commanders: { alice: ['Ur Lite'] } }), 'main1', 'alice');
    const ur = h.zones.command.find((id) => h.objects[id]!.commander)!;
    h.players.alice!.pool.B = 2;
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Dragon Three', 'hand') }));
    expect(h.zones.battlefield.filter((id) => h.objects[id]!.card === 'Dragon Three')).toHaveLength(1);
    // Not itself: The Ur-Dragon costs its full {4}.
    h.players.alice!.pool.B = 3;
    illegal(h, { type: 'cast', player: 'alice', object: ur });
    // Elsewhere (the graveyard), no reduction.
    const two = give(h, 'alice', 'Dragon Three', 'hand');
    moveObject(h, ur, 'graveyard', []);
    h.players.alice!.pool.B = 2;
    illegal(h, { type: 'cast', player: 'alice', object: two });
  });

  it("Player protection: Serra's Emissary's chosen card type, Absolute Virtue's opponents, Runed Halo's chosen name", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const emissary = give(g, 'alice', 'Emissary Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: emissary }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', choice: 'Instant' } }));
    const life = g.players.alice!.life;
    const bobLife = g.players.bob!.life;
    // Can't be targeted by an instant, or have its creatures targeted; damage from instants is prevented.
    illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] });
    illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: emissary }]] });
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Each Pulse Lite', 'hand') }));
    expect(g.players.alice!.life).toBe(life);
    expect(g.players.bob!.life).toBe(bobLife - 2);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(h, 'alice', 'Virtue Lite', 'battlefield');
    h = act(h, { type: 'pass', player: 'alice' });
    illegal(h, { type: 'cast', player: 'bob', object: give(h, 'bob', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] });
    const al = h.players.alice!.life;
    h = settle(act(h, { type: 'cast', player: 'bob', object: give(h, 'bob', 'Each Pulse Lite', 'hand') }));
    expect(h.players.alice!.life).toBe(al);

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Halo Lite', 'hand') }));
    k = settle(act(k, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', choice: 'Bolt' } }));
    k = act(k, { type: 'pass', player: 'alice' });
    illegal(k, { type: 'cast', player: 'bob', object: give(k, 'bob', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] });
    const kl = k.players.alice!.life;
    k = settle(act(k, { type: 'cast', player: 'bob', object: give(k, 'bob', 'Each Pulse Lite', 'hand') }));
    expect(k.players.alice!.life).toBe(kl - 2);
  });

  it('Planar Nexus: every nonbasic land type, in every zone', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const inHand = give(g, 'alice', 'Planar Nexus Lite', 'hand');
    const onField = give(g, 'alice', 'Planar Nexus Lite', 'battlefield');
    for (const id of [inHand, onField]) expect(chars(g, g.objects[id]!).subtypes).toEqual(expect.arrayContaining(['Gate', 'Desert', 'Cave', 'Locus', 'Urza’s']));
    expect(chars(g, g.objects[onField]!).subtypes).not.toContain('Forest');
  });

  it('Ripple: cast the same-named cards among the top four for free, the rest on the bottom in your order (and from Thrumming Stone)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lib = g.zones.library.alice!;
    const top = ['Surging Lite', 'Bear', 'Surging Lite', 'Zombie'].map((n) => give(g, 'alice', n, 'library'));
    for (const id of top) lib.splice(lib.indexOf(id), 1);
    lib.unshift(...top);
    const bob = g.players.bob!.life;
    const atBob = [[{ kind: 'player' as const, player: 'bob' }]];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Surging Lite', 'hand'), targets: atBob }));
    let reveals = 0;
    g = drive(g, (g) => {
      const p = g.pending!;
      // The first ripple reveals; the copies' own ripples don't.
      if (p.kind === 'may') return act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: reveals++ === 0 } });
      if (p.kind === 'cast_free') return act(g, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: true, targets: atBob } });
      if (p.kind === 'choose_objects') return act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [top[3]!, top[1]!] } });
      return null;
    }, 30);
    expect(g.players.bob!.life).toBe(bob - 6);
    expect(g.zones.library.alice!.slice(-2)).toEqual([top[3], top[1]]);
    expect(g.zones.graveyard.alice!.filter((id) => g.objects[id]!.card === 'Surging Lite')).toHaveLength(3);

    // Thrumming Stone: a spell without ripple gets it.
    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(h, 'alice', 'Thrumming Lite', 'battlefield');
    const hl = h.zones.library.alice!;
    const bolt = give(h, 'alice', 'Bolt', 'library');
    hl.splice(hl.indexOf(bolt), 1);
    hl.unshift(bolt);
    const bl = h.players.bob!.life;
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Bolt', 'hand'), targets: atBob }));
    let asked = 0;
    h = drive(h, (h) => {
      const p = h.pending!;
      if (p.kind === 'may') return act(h, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: asked++ === 0 } });
      if (p.kind === 'cast_free') return act(h, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: true, targets: atBob } });
      if (p.kind === 'choose_objects') return act(h, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [...p.candidates] } });
      return null;
    }, 30);
    expect(h.players.bob!.life).toBe(bl - 6);
  });

  it('Darksteel Monolith: once each turn, a colorless spell from your hand for {0}', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Monolith Lite', 'battlefield');
    illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bear', 'hand'), alt: 'free_once' });
    illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Trinket', 'graveyard'), alt: 'free_once' });
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Trinket', 'hand'), alt: 'free_once' }));
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.card === 'Trinket')).toHaveLength(1);
    illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Trinket', 'hand'), alt: 'free_once' });
  });

  it('Spectacular Showdown and Agitator Ant: goad each creature that had counters put on it this way', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mine = give(g, 'alice', 'Bear', 'battlefield');
    const theirs = give(g, 'alice', 'Bear', 'battlefield');
    g.objects[theirs]!.controller = 'bob';
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Showdown Lite', 'hand'), targets: [[{ kind: 'object', object: theirs }]] }));
    expect(g.objects[theirs]!.counters.double_strike).toBe(1);
    expect(g.objects[theirs]!.goadedBy).toEqual(['alice']);
    expect(g.objects[mine]!.goadedBy).toBeUndefined();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Showdown Lite', 'hand'), alt: 'overload' }));
    expect(g.objects[mine]!.counters.double_strike).toBe(1);
    expect(g.objects[mine]!.goadedBy).toEqual(['alice']);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ant = give(h, 'alice', 'Ant Lite', 'battlefield');
    const bobs = give(h, 'bob', 'Bear', 'battlefield');
    const other = give(h, 'bob', 'Bear', 'battlefield');
    h = toStep(h, 'end', 'alice');
    h = drive(h, (h) => {
      const p = h.pending!;
      if (p.kind === 'may') return act(h, { type: 'choose', player: p.player, answer: { kind: 'may', yes: p.player === 'bob' } });
      if (p.kind === 'choose_objects') return act(h, { type: 'choose', player: p.player, answer: { kind: 'choose_objects', objects: [bobs] } });
      return null;
    }, 20);
    expect(h.objects[bobs]!.counters['+1/+1']).toBe(2);
    expect(h.objects[bobs]!.goadedBy).toEqual(['alice']);
    expect(h.objects[other]!.goadedBy).toBeUndefined();
    expect(h.objects[ant]!.goadedBy).toBeUndefined();
  });

  it("Aetherspouts: each attacker's owner chooses top or bottom, and orders each pile", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bears = [0, 1, 2].map(() => give(g, 'alice', 'Bear', 'battlefield'));
    const stay = give(g, 'alice', 'Bear', 'battlefield');
    g = attackWith(g, bears);
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Spouts Lite', 'hand') });
    const where = ['top', 'top', 'bottom'];
    let k = 0;
    g = drive(g, (g) => {
      const p = g.pending!;
      expect(p.player).toBe('alice');
      if (p.kind === 'choose_option') return act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: where[k++]! } });
      if (p.kind === 'choose_objects') return act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [bears[1]!, bears[0]!] } });
      return null;
    }, 20);
    const lib = g.zones.library.alice!;
    expect(lib.slice(0, 2)).toEqual([bears[1], bears[0]]);
    expect(lib[lib.length - 1]).toBe(bears[2]);
    expect(g.objects[stay]!.zone).toBe('battlefield');
  });

  it('Kess, Dissident Mage: once each turn from the graveyard, then exiled instead', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Kess Lite', 'battlefield');
    const zero = give(g, 'alice', 'Zero Instant', 'graveyard');
    g = settle(act(g, { type: 'cast', player: 'alice', object: zero }));
    expect(g.objects[zero]!.zone).toBe('exile');
    illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Zero Instant', 'graveyard') });
  });

  it('Blazing Bomb: only a spell with four or more mana spent to cast it', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bomb = give(g, 'alice', 'Blazing Bomb Lite', 'battlefield');
    for (const name of ['Salve', 'Big Salve']) {
      g.players.alice!.pool.C = 4;
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand') }));
      g = drive(g, () => null);
    }
    expect(g.objects[bomb]!.counters['+1/+1'] ?? 0).toBe(1);
  });
  it('Raff: tap exactly two untapped creatures to draw — not offered with only one', () => {
    for (const n of [1, 2]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const raff = give(g, 'alice', 'Raff Lite', 'battlefield');
      g.objects[raff]!.tapped = true;
      const bears = Array.from({ length: n }, () => give(g, 'alice', 'Zombie', 'battlefield'));
      const hand = g.zones.hand.alice!.length;
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Salve', 'hand') }));
      let asked = false;
      g = drive(g, (g) => {
        if (g.pending?.kind === 'may') return ((asked = true), act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
        if (g.pending?.kind === 'choose_objects') return act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: bears } });
        return null;
      });
      expect([asked, g.zones.hand.alice!.length - hand, bears.every((b) => g.objects[b]!.tapped)]).toEqual(n === 2 ? [true, 1, true] : [false, 0, false]);
    }
  });
  it('Dream Pillager: exile as many cards as the damage dealt', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const dragon = give(g, 'alice', 'Pillager Lite', 'battlefield', { sick: false });
    const exiled = g.zones.exile.length;
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: dragon, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 30 && g.step !== 'end' && g.step !== 'main2'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } } as never);
      else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
      else break;
    }
    expect(g.zones.exile.length - exiled).toBe(3);
  });
  it('Resolute Archangel: your life total becomes your starting life total', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.players.alice!.life = 5;
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Archangel Lite', 'hand') }));
    g = drive(g, () => null);
    expect(g.players.alice!.life).toBe(g.config.startingLife);
  });
  it("Sarkhan's Unsealing: power 4, 5, or 6 only", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Sarkhan Unsealing Lite', 'battlefield');
    const life = g.players.bob!.life;
    for (const name of ['Bear', 'Big Bear']) {
      g.players.alice!.pool.G = 2;
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), autoTap: true }));
      g = drive(g, (g) => (g.pending?.kind === 'trigger_targets' ? act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } } as never) : null));
    }
    expect(life - g.players.bob!.life).toBe(4);
  });
  it('Mental Modulation: {1} less only during your turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (const o of Object.values(g.objects)) if (o.zone === 'battlefield' && chars(g, o).types.includes('Land')) o.tapped = true;
    g.players.alice!.pool.U = 1;
    const mine = give(g, 'alice', 'Modulation Lite', 'hand');
    g = drive(settle(act(g, { type: 'cast', player: 'alice', object: mine })), () => null);
    expect(g.objects[mine]!.zone).toBe('graveyard');
    g = toStep(g, 'upkeep', 'bob');
    for (const o of Object.values(g.objects)) if (o.zone === 'battlefield' && chars(g, o).types.includes('Land')) o.tapped = true;
    g.players.alice!.pool.U = 1;
    g.priority = 'alice';
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Modulation Lite', 'hand') })).toBeTruthy();
  });
  it('Killer Service: "pay {2} and sacrifice a token" — not offered without a token; with one, both are paid', () => {
    for (const withToken of [false, true]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      give(g, 'alice', 'Killer Service Lite', 'battlefield');
      const tok = give(g, 'alice', 'Zombie', 'battlefield');
      if (withToken) g.objects[tok]!.token = true;
      for (const o of Object.values(g.objects)) if (o.controller === 'alice' && o.zone === 'battlefield' && chars(g, o).types.includes('Land')) o.tapped = true;
      give(g, 'alice', 'Forest', 'battlefield');
      give(g, 'alice', 'Forest', 'battlefield');
      g = toStep(g, 'end', 'alice');
      let asked = false;
      g = drive(g, (g) => (g.pending?.kind === 'pay' ? ((asked = true), act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true } })) : g.pending?.kind === 'choose_objects' ? act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [tok] } }) : null));
      const rhinos = g.zones.battlefield.filter((id) => chars(g, g.objects[id]!).subtypes.includes('Rhino'));
      expect([asked, rhinos.length, g.objects[tok]?.zone === 'battlefield']).toEqual(withToken ? [true, 1, false] : [false, 0, true]);
    }
  });
  it('Heidegger: a Soldier for each opponent who controls more creatures than you', () => {
    let g = toStep(start({ extra: CARDS, players: 3 } as never), 'main1', 'alice');
    give(g, 'alice', 'Heidegger Lite', 'battlefield');
    for (let k = 0; k < 2; k++) give(g, 'bob', 'Zombie', 'battlefield');
    const others = Object.keys(g.players).filter((p) => p !== 'alice' && p !== 'bob');
    if (others[0]) give(g, others[0], 'Zombie', 'battlefield');
    const before = g.zones.battlefield.filter((id) => g.objects[id]!.token).length;
    g = toStep(g, 'end', 'alice');
    g = drive(g, () => null);
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token).length - before).toBe(1);
  });
  it('Dawn of a New Age: a hope counter off and a card; the last one off, sacrifice it and gain 4', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const dawn = give(g, 'alice', 'Dawn Lite', 'battlefield');
    g.objects[dawn]!.counters.hope = 2;
    const hand = g.zones.hand.alice!.length;
    g = drive(toStep(g, 'end', 'alice'), () => null);
    expect([g.objects[dawn]!.counters.hope, g.zones.hand.alice!.length - hand, g.objects[dawn]!.zone]).toEqual([1, 1, 'battlefield']);
    g = toStep(g, 'main1', 'alice');
    const life = g.players.alice!.life;
    g = drive(toStep(g, 'end', 'alice'), () => null);
    expect([g.objects[dawn]!.zone, g.players.alice!.life - life]).toEqual(['graveyard', 4]);
  });
  it('Starlit Soothsayer: "if you gained or lost life this turn"', () => {
    for (const lose of [false, true]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      give(g, 'alice', 'Soothsayer Lite', 'battlefield');
      if (lose) g.turnLog.lostLife.push('alice');
      g = toStep(g, 'end', 'alice');
      let surveiled = false;
      g = drive(g, (g) => {
        surveiled = true;
        return null;
      });
      expect(surveiled).toBe(lose);
    }
  });
  it('Steel Seraph: the controller picks which keyword as it resolves', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const seraph = give(g, 'alice', 'Seraph Lite', 'battlefield');
    g = toStep(g, 'beginning_of_combat', 'alice');
    g = drive(g, (g) => (g.pending?.kind === 'choose_option' ? act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: 'lifelink' } }) : null));
    expect(chars(g, g.objects[seraph]!).keywords.map((k) => k.id)).toEqual(['lifelink']);
  });
  it('Wojek Investigator: a Clue for each opponent with more cards in hand', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Wojek Lite', 'battlefield');
    while (g.zones.hand.alice!.length > 1) g.zones.hand.alice!.pop();
    g = drive(toStep(g, 'upkeep', 'alice'), () => null);
    expect(g.zones.battlefield.filter((id) => chars(g, g.objects[id]!).name === 'Clue').length).toBe(g.zones.hand.bob!.length > 1 ? 1 : 0);
  });
  it('Abzan Beastmaster: the greatest toughness, ties included', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Beastmaster Lite', 'battlefield');
    const wall = give(g, 'bob', 'Zombie', 'battlefield');
    g.objects[wall]!.counters['+1/+1'] = 3;
    const hand = g.zones.hand.alice!.length;
    g = drive(toStep(g, 'upkeep', 'alice'), () => null);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });
  it("Phyrexian Swarmlord: an Insect for each poison counter your opponents have", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Swarmlord Lite', 'battlefield');
    g.players.bob!.poison = 3;
    g.players.alice!.poison = 5;
    g = drive(toStep(g, 'upkeep', 'alice'), () => null);
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token).length).toBe(3);
  });
  it("Avacyn's Collar: a Spirit only when the equipped creature was a Human", () => {
    for (const [name, expected] of [['Villager Lite', 1], ['Zombie', 0]] as const) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const collar = give(g, 'alice', 'Collar Lite', 'battlefield');
      const victim = give(g, 'alice', name, 'battlefield');
      g.objects[collar]!.attachedTo = { id: victim, zcc: g.objects[victim]!.zcc };
      g.players.alice!.pool.R = 1;
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: victim }]] }));
      for (let i = 0; i < 6 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
      const spirits = g.zones.battlefield.filter((id) => g.objects[id]!.token && chars(g, g.objects[id]!).subtypes.includes('Spirit'));
      expect([g.objects[victim]!.zone, spirits.length]).toEqual(['graveyard', expected]);
    }
  });
  it('Essence Sliver: each Sliver\'s controller gains the damage it dealt', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ess = give(g, 'alice', 'Essence Sliver Lite', 'battlefield', { sick: false });
    const theirs = give(g, 'bob', 'Plain Sliver Lite', 'battlefield');
    const [a, b] = [g.players.alice!.life, g.players.bob!.life];
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: ess, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 30 && g.step !== 'end'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: theirs, attacker: ess }] } } as never);
      else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
      else break;
    }
    expect([g.players.alice!.life - a, g.players.bob!.life - b]).toEqual([3, 2]);
  });
  it('CR 728: rad counters — mill that many at your precombat main phase; 1 life and a counter for each nonland card', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'bob', 'Glowing One Lite', 'battlefield');
    g.players.alice!.counters = { rad: 3 };
    g = toStep(g, 'draw', 'alice');
    const top = [give(g, 'alice', 'Bolt', 'library'), give(g, 'alice', 'Forest', 'library'), give(g, 'alice', 'Bear', 'library')];
    g.zones.library.alice = [...top, ...g.zones.library.alice!.filter((id) => !top.includes(id))];
    const [life, bob] = [g.players.alice!.life, g.players.bob!.life];
    g = toStep(g, 'main1', 'alice');
    for (let i = 0; i < 6 && (g.stack.length || g.pending); i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    expect(top.map((id) => g.objects[id]!.zone)).toEqual(['graveyard', 'graveyard', 'graveyard']);
    // Two nonland cards: 2 life and two of the three counters; Glowing One sees each nonland card milled.
    expect([life - g.players.alice!.life, g.players.alice!.counters?.rad ?? 0, g.players.bob!.life - bob]).toEqual([2, 1, 2]);
  });
  it('Empowered Autogenerator: a counter first, then that many mana of one color', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const gen = give(g, 'alice', 'Autogenerator Lite', 'battlefield');
    g.objects[gen]!.counters.charge = 1;
    const options = legalActions(g, 'alice').filter((a) => a.type === 'activate_mana' && a.object === gen);
    expect(options.length).toBe(5);
    g = act(g, options.find((a) => (a as { choice?: unknown }).choice === 'G')!);
    expect(g.players.alice!.pool.G).toBe(2);
  });
  it('White Plume Adventurer: untap one creature you control in each opponent\'s upkeep', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const plume = give(g, 'alice', 'White Plume Lite', 'battlefield');
    const [a, b] = [give(g, 'alice', 'Zombie', 'battlefield'), give(g, 'alice', 'Zombie', 'battlefield')];
    for (const id of [plume, a, b]) g.objects[id]!.tapped = true;
    g = toStep(g, 'upkeep', 'bob');
    for (let i = 0; i < 6 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'choose_objects') {
        expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [] } })).toBeTruthy();
        g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [a] } });
      } else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
      else break;
    }
    expect([plume, a, b].map((id) => g.objects[id]!.tapped)).toEqual([true, false, true]);
  });
  it('Murmuration: a Storm Crow for each spell you cast this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Murmuration Lite', 'battlefield');
    for (let k = 0; k < 2; k++) {
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Salve', 'hand') }));
      for (let i = 0; i < 4 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    }
    g = toStep(g, 'end');
    for (let i = 0; i < 4 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    const crows = g.zones.battlefield.filter((id) => g.objects[id]!.token && chars(g, g.objects[id]!).name === 'Storm Crow');
    expect(crows.length).toBe(2);
  });
  it('Mechanized Warfare: a red source you control deals 1 more to an opponent, not to you', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Mechanized Warfare Lite', 'battlefield');
    const bolt = (p: string) => {
      const b = give(g, 'alice', 'Red Bolt Lite', 'hand');
      g = settle(act(g, { type: 'cast', player: 'alice', object: b, targets: [[{ kind: 'player', player: p }]] }));
      for (let i = 0; i < 4 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    };
    const [bob, alice] = [g.players.bob!.life, g.players.alice!.life];
    bolt('bob');
    bolt('alice');
    expect([bob - g.players.bob!.life, alice - g.players.alice!.life]).toEqual([4, 3]);
  });
  it('Eidolon of Countless Battles: +1/+1 for each creature and for each Aura you control', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const eidolon = give(g, 'alice', 'Eidolon Lite', 'battlefield');
    const bear = give(g, 'alice', 'Zombie', 'battlefield');
    const aura = give(g, 'alice', 'Aura Lite', 'battlefield');
    g.objects[aura]!.attachedTo = { id: bear, zcc: g.objects[bear]!.zcc };
    // Two creatures and one Aura.
    expect([chars(g, g.objects[eidolon]!).power, chars(g, g.objects[eidolon]!).toughness]).toEqual([3, 3]);
  });
  it('Kefka, Court Mage: a card for each card type among the discarded cards', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const kefka = give(g, 'alice', 'Kefka Lite', 'hand');
    g.zones.hand.alice = [kefka];
    g.zones.hand.bob = [];
    give(g, 'alice', 'Bolt', 'hand');
    give(g, 'bob', 'Bear', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: kefka });
    for (let i = 0; i < 12 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'discard') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'discard', objects: g.zones.hand[g.pending.player]!.slice(0, 1) } } as never);
      else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
      else break;
    }
    expect([g.zones.hand.alice!.length, g.zones.hand.bob!.length]).toEqual([2, 0]);
  });
  it('Jenova: draws only when the Zombie dies during your turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Jenova Lite', 'battlefield');
    const [z1, z2] = [give(g, 'alice', 'Zombie', 'battlefield'), give(g, 'alice', 'Zombie', 'battlefield')];
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: z1 }]] }));
    for (let i = 0; i < 4 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    expect(g.zones.hand.alice!.length).toBe(hand);
    g = toStep(g, 'main1', 'alice');
    const now = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: z2 }]] }));
    for (let i = 0; i < 4 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    expect(g.zones.hand.alice!.length).toBe(now + 2);
  });
  it("Detective's Satchel: only once you've sacrificed an artifact this turn", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [satchel, food] = [give(g, 'alice', 'Satchel Lite', 'battlefield'), give(g, 'alice', 'Junk Food Lite', 'battlefield')];
    expect(illegal(g, { type: 'activate', player: 'alice', object: satchel, ability: 0 })).toBeTruthy();
    g = settle(act(g, { type: 'activate', player: 'alice', object: food, ability: 0 }));
    for (let i = 0; i < 4 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'activate', player: 'alice', object: satchel, ability: 0 }));
    for (let i = 0; i < 4 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    expect(g.players.alice!.life).toBe(life + 1);
    g = toStep(toStep(g, 'main1', 'bob'), 'main1', 'alice');
    expect(illegal(g, { type: 'activate', player: 'alice', object: satchel, ability: 0 })).toBeTruthy();
  });
  it('Ojer Pakpatiq: an instant cast from your hand gains rebound', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Ojer Pakpatiq Lite', 'battlefield');
    const bolt = give(g, 'alice', 'Bolt', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: bolt, targets: [[{ kind: 'player', player: 'bob' }]] });
    for (let i = 0; i < 6 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    expect(g.objects[bolt]!.zone).toBe('exile');
    expect(g.delayed.some((d) => d.text === 'rebound')).toBe(true);
  });
  it('Hobgoblin Bandit Lord: Goblins that entered this turn, a token that has since died included', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lord = give(g, 'alice', 'Bandit Lord Lite', 'battlefield', { sick: false });
    const run = (a: Parameters<typeof act>[1]) => {
      g = settle(act(g, a));
      for (let i = 0; i < 4 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    };
    run({ type: 'cast', player: 'alice', object: give(g, 'alice', 'Goblin Lite', 'hand') });
    run({ type: 'cast', player: 'alice', object: give(g, 'alice', 'Goblin Maker Lite', 'hand') });
    const token = g.zones.battlefield.find((id) => g.objects[id]!.token)!;
    run({ type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: token }]] });
    expect(g.objects[token]).toBeUndefined();
    const life = g.players.bob!.life;
    g.players.alice!.pool.R = 1;
    run({ type: 'activate', player: 'alice', object: lord, ability: 0, targets: [[{ kind: 'player', player: 'bob' }]] });
    expect(life - g.players.bob!.life).toBe(2);
  });
  it('Tablet of Discovery: you may play the milled card this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const top = give(g, 'alice', 'Bolt', 'library');
    g.zones.library.alice = [top, ...g.zones.library.alice!.filter((x) => x !== top)];
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Tablet Lite', 'hand') });
    for (let i = 0; i < 6 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    expect(g.objects[top]!.zone).toBe('graveyard');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === top)).toBe(true);
    g = toStep(toStep(g, 'main1', 'bob'), 'main1', 'alice');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === top)).toBe(false);
  });
  it('River Kelpie: a card for a permanent entering from a graveyard, not from the hand', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Kelpie Lite', 'battlefield');
    const bear = give(g, 'alice', 'Zombie', 'graveyard');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Zombie', 'hand') }));
    for (let i = 0; i < 4 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    expect(g.zones.hand.alice!.length).toBe(hand);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Unearth Lite', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    for (let i = 0; i < 4 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    expect([g.objects[bear]!.zone, g.zones.hand.alice!.length]).toEqual(['battlefield', hand + 1]);
  });
  it('Exalted Flamer: an instant or sorcery card at random from your graveyard', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Flamer Lite', 'battlefield');
    const [bolt, bear] = [give(g, 'alice', 'Bolt', 'graveyard'), give(g, 'alice', 'Bear', 'graveyard')];
    g = toStep(g, 'upkeep', 'alice');
    for (let i = 0; i < 4 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    expect([g.objects[bolt]!.zone, g.objects[bear]!.zone]).toEqual(['hand', 'graveyard']);
  });
  it('Blowfly Infestation: a -1/-1 counter moves on when a creature with one dies', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Blowfly Lite', 'battlefield');
    const [a, b] = [give(g, 'alice', 'Zombie', 'battlefield'), give(g, 'bob', 'Zombie', 'battlefield')];
    g.objects[a]!.counters['-1/-1'] = 1;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: a }]] });
    for (let i = 0; i < 8 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: b }]] } });
      else if (g.priority) g = settle(act(g, { type: 'pass', player: g.priority }));
      else break;
    }
    expect(g.objects[b]!.counters['-1/-1']).toBe(1);
  });
  it('Pilot token: crews Vehicles as though its power were 2 greater', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [pilot, plain, vehicle] = [give(g, 'alice', 'Pilot Lite', 'battlefield'), give(g, 'alice', 'Zombie', 'battlefield'), give(g, 'alice', 'Crew Three Lite', 'battlefield')];
    g.objects[plain]!.counters['-1/-1'] = 1;
    expect(illegal(g, { type: 'activate', player: 'alice', object: vehicle, ability: 0, costs: { crew: [plain] } })).toBeTruthy();
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === vehicle)).toBe(true);
    g = settle(act(g, { type: 'activate', player: 'alice', object: vehicle, ability: 0, costs: { crew: [pilot] } }));
    expect(chars(g, g.objects[vehicle]!).types).toContain('Creature');
  });
  it('Heaped Harvest: a basic land as it enters and again as you sacrifice it', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lands = () => g.zones.battlefield.filter((id) => g.objects[id]!.controller === 'alice' && chars(g, g.objects[id]!).types.includes('Land')).length;
    const before = lands();
    const food = give(g, 'alice', 'Heaped Harvest Lite', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: food });
    for (let i = 0; i < 10 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
      else if (g.pending?.kind === 'search') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: (g.pending as { candidates: string[] }).candidates.slice(0, 1) } } as never);
      else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
      else break;
    }
    expect(lands()).toBe(before + 1);
    g.players.alice!.pool.C = 2;
    g = act(g, { type: 'activate', player: 'alice', object: food, ability: 0 });
    for (let i = 0; i < 10 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
      else if (g.pending?.kind === 'search') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: (g.pending as { candidates: string[] }).candidates.slice(0, 1) } } as never);
      else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
      else break;
    }
    expect(lands()).toBe(before + 2);
  });
  it("Wilhelt: a decayed Zombie token when a Zombie without decayed dies", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Wilhelt Lite', 'battlefield');
    const z = give(g, 'alice', 'Zombie', 'battlefield');
    const bolt = (id: string) => {
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: id }]] }));
      for (let i = 0; i < 4 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    };
    const tokens = () => g.zones.battlefield.filter((id) => g.objects[id]!.token);
    bolt(z);
    expect(tokens().length).toBe(1);
    bolt(tokens()[0]!);
    expect(tokens().length).toBe(0);
  });
  it('Zurgo Stormrender: a draw if the token was attacking, otherwise each opponent loses 1 life', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Zurgo Lite', 'battlefield');
    const [a, b] = [give(g, 'alice', 'Zombie', 'battlefield', { sick: false }), give(g, 'alice', 'Zombie', 'battlefield', { sick: false })];
    g.objects[a]!.token = true;
    g.objects[b]!.token = true;
    const [life, hand] = [g.players.bob!.life, g.zones.hand.alice!.length];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: b }]] }));
    for (let i = 0; i < 4 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    expect([life - g.players.bob!.life, g.zones.hand.alice!.length - hand]).toEqual([1, 0]);
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: a, target: { kind: 'player', player: 'bob' } }] } });
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: a }]] }));
    for (let i = 0; i < 4 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    expect([life - g.players.bob!.life, g.zones.hand.alice!.length - hand]).toEqual([1, 1]);
  });
  it('Virtue of Strength: basic lands tapped for mana make three times as much; other lands don\'t', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Virtue of Strength Lite', 'battlefield');
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    const grove = give(g, 'alice', 'Nonbasic Grove Lite', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: forest, ability: 0 });
    expect(g.players.alice!.pool.G).toBe(3);
    g = act(g, { type: 'activate_mana', player: 'alice', object: grove, ability: 0 });
    expect(g.players.alice!.pool.G).toBe(4);
  });
  it('Undergrowth Champion: damage from two blockers at once is prevented, removing only one counter', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const champ = give(g, 'alice', 'Undergrowth Champion Lite', 'battlefield', { sick: false });
    g.objects[champ]!.counters['+1/+1'] = 1;
    const [x, y] = [give(g, 'bob', 'Zombie', 'battlefield'), give(g, 'bob', 'Zombie', 'battlefield')];
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: champ, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 40 && g.step !== 'end'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: x, attacker: champ }, { blocker: y, attacker: champ }] } });
      else if (g.pending?.kind === 'assign_combat_damage') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'assign_combat_damage', assignments: { [champ]: [{ to: { kind: 'permanent', object: x }, amount: 3 }] } } } as never);
      else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
      else break;
    }
    expect(g.objects[champ]).toMatchObject({ zone: 'battlefield', damage: 0 });
    expect(g.objects[champ]!.counters['+1/+1'] ?? 0).toBe(0);
  });
  it('Mirror of Life Trapping: a cast creature is exiled and the one exiled before returns', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Mirror of Life Trapping Lite', 'battlefield');
    const [a, b] = [give(g, 'alice', 'Zombie', 'hand'), give(g, 'alice', 'Zombie', 'hand')];
    const castIt = (id: string) => {
      g = act(g, { type: 'cast', player: 'alice', object: id });
      for (let i = 0; i < 8 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    };
    g.players.alice!.pool.B = 4;
    castIt(a);
    expect(g.objects[a]!.zone).toBe('exile');
    castIt(b);
    expect([g.objects[a]!.zone, g.objects[b]!.zone]).toEqual(['battlefield', 'exile']);
    give(g, 'alice', 'Zombie', 'battlefield');
    expect(g.stack.length).toBe(0);
  });
  it('Ancient Cellarspawn: an opponent loses the difference when less mana was spent than the mana value', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.zones.battlefield = g.zones.battlefield.filter((id) => g.objects[id]!.controller !== 'alice');
    give(g, 'alice', 'Cellarspawn Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    const life = g.players.bob!.life;
    g.players.alice!.pool.R = 1;
    g.players.alice!.pool.C = 2;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Incinerator Lite', 'hand') });
    if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } });
    for (let i = 0; i < 6 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    expect(life - g.players.bob!.life).toBe(3);
  });
  it("Tinder Wall: sacrificed, it still deals 2 damage to the creature it was blocking", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const wall = give(g, 'alice', 'Tinder Wall Lite', 'battlefield');
    const [bear, other] = [give(g, 'bob', 'Bear', 'battlefield', { sick: false }), give(g, 'bob', 'Bear', 'battlefield', { sick: false })];
    g = toStep(toStep(g, 'main1', 'bob'), 'beginning_of_combat');
    g = toAttack(g);
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [bear, other].map((attacker) => ({ attacker, target: { kind: 'player' as const, player: 'alice' } })) } });
    for (let i = 0; i < 6 && g.pending?.kind !== 'declare_blockers'; i++) g = act(g, { type: 'pass', player: g.priority! });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_blockers', blocks: [{ blocker: wall, attacker: bear }] } });
    while (g.priority === 'bob') g = act(g, { type: 'pass', player: 'bob' });
    g.players.alice!.pool.R = 1;
    expect(illegal(g, { type: 'activate', player: 'alice', object: wall, ability: 0, targets: [[{ kind: 'object', object: other }]] })).toBeTruthy();
    g = act(g, { type: 'activate', player: 'alice', object: wall, ability: 0, targets: [[{ kind: 'object', object: bear }]] });
    for (let i = 0; i < 6 && g.stack.length; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect([g.objects[wall]!.zone, g.objects[bear]!.zone]).toEqual(['graveyard', 'graveyard']);
  });
  it('The Lord of Pain: another target player than the one who cast the spell', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'bob');
    give(g, 'alice', 'Lord of Pain Lite', 'battlefield');
    g.players.bob!.pool.W = 1;
    g.players.bob!.pool.U = 1;
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Gold Spell', 'hand') });
    expect(g.pending).toMatchObject({ kind: 'trigger_targets', player: 'alice' });
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } })).toBeTruthy();
    const life = g.players.carol!.life;
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'carol' }]] } }));
    for (let i = 0; i < 6 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    expect(g.players.carol!.life).toBe(life - 2);
  });
  it("Aclazotz: each opponent discards a card; you draw for each who can't", () => {
    for (const cards of [0, 2]) {
      let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
      const bat = give(g, 'alice', 'Aclazotz Lite', 'battlefield', { sick: false });
      g.zones.hand.bob = [];
      g.zones.hand.carol = g.zones.hand.carol!.slice(0, cards);
      const hand = g.zones.hand.alice!.length;
      g = toAttack(toStep(g, 'beginning_of_combat'));
      g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: bat, target: { kind: 'player', player: 'bob' } }] } });
      for (let i = 0; i < 6 && g.pending?.kind !== 'declare_blockers'; i++) {
        if (g.pending?.kind === 'discard') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'discard', objects: g.zones.hand[g.pending.player]!.slice(0, 1) } } as never);
        else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
        else break;
      }
      expect(g.zones.hand.alice!.length - hand).toBe(cards ? 1 : 2);
    }
  });
  it("Chandra's Incinerator: {X} less, X being noncombat damage dealt to your opponents this turn", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.zones.battlefield = g.zones.battlefield.filter((id) => g.objects[id]!.controller !== 'alice');
    const inc = give(g, 'alice', 'Incinerator Lite', 'hand');
    g.players.alice!.pool.R = 1;
    g.players.alice!.pool.C = 2;
    expect(illegal(g, { type: 'cast', player: 'alice', object: inc })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    g = settle(act(g, { type: 'cast', player: 'alice', object: inc }));
    expect(g.objects[inc]!.zone).toBe('battlefield');
  });
  it('Bow of Nylea: up to four target cards from your graveyard on the bottom of your library in the order you choose', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bow = give(g, 'alice', 'Bow of Nylea Lite', 'battlefield');
    const [a, b] = [give(g, 'alice', 'Bear', 'graveyard'), give(g, 'alice', 'Bolt', 'graveyard')];
    g.players.alice!.pool.G = 2;
    g = settle(act(g, { type: 'activate', player: 'alice', object: bow, ability: 0, modes: [1], targets: [[{ kind: 'object', object: a }, { kind: 'object', object: b }]] }));
    expect(g.pending).toMatchObject({ kind: 'choose_objects', ordered: true });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [b, a] } }));
    expect(g.zones.library.alice!.slice(-2)).toEqual([b, a]);
  });
  it('PuPu UFO: only its base power becomes the number of Towns you control', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ufo = give(g, 'alice', 'PuPu Lite', 'battlefield');
    [0, 1].forEach(() => give(g, 'alice', 'Town Lite', 'battlefield'));
    g.players.alice!.pool.C = 3;
    g = settle(act(g, { type: 'activate', player: 'alice', object: ufo, ability: 0 }));
    expect([chars(g, g.objects[ufo]!).power, chars(g, g.objects[ufo]!).toughness]).toEqual([2, 3]);
  });
  it("Evra: exchanging life with its power leaves its toughness", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const evra = give(g, 'alice', 'Evra Lite', 'battlefield');
    const life = g.players.alice!.life;
    g.players.alice!.pool.C = 4;
    g = settle(act(g, { type: 'activate', player: 'alice', object: evra, ability: 0 }));
    expect([g.objects[evra]!.zone, chars(g, g.objects[evra]!).power, chars(g, g.objects[evra]!).toughness, g.players.alice!.life]).toEqual(['battlefield', life, 4, 1]);
  });
  it('Deepwood Denizen: {1} less for each +1/+1 counter on creatures you control', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const elf = give(g, 'alice', 'Deepwood Lite', 'battlefield', { sick: false });
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g.objects[bear]!.counters['+1/+1'] = 3;
    g.objects[elf]!.counters['+1/+1'] = 1;
    g.zones.battlefield = g.zones.battlefield.filter((id) => g.objects[id]!.controller !== 'alice' || !chars(g, g.objects[id]!).types.includes('Land'));
    g.players.alice!.pool.C = 1;
    g.players.alice!.pool.G = 1;
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'activate', player: 'alice', object: elf, ability: 0 }));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });
  it('Dragonfire Blade: equip costs {1} less for each color of the creature it targets', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.zones.battlefield = g.zones.battlefield.filter((id) => g.objects[id]!.controller !== 'alice');
    const [blade, knight, bear] = [give(g, 'alice', 'Dragonfire Blade Lite', 'battlefield'), give(g, 'alice', 'Tricolor Knight Lite', 'battlefield'), give(g, 'alice', 'Bear', 'battlefield')];
    g.players.alice!.pool.C = 1;
    const equips = legalActions(g, 'alice').filter((a) => a.type === 'activate' && a.object === blade);
    expect(equips.map((a) => (a as { targets?: { object: string }[][] }).targets?.[0]?.[0]?.object)).toEqual([knight]);
    expect(illegal(g, { type: 'activate', player: 'alice', object: blade, ability: 0, targets: [[{ kind: 'object', object: bear }]] })).toBeTruthy();
    g = settle(act(g, { type: 'activate', player: 'alice', object: blade, ability: 0, targets: [[{ kind: 'object', object: knight }]] }));
    expect(g.objects[blade]!.attachedTo?.id).toBe(knight);
  });
  it('Plate Armor: equip costs {1} less for each other Equipment you control', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [armor, bear] = [give(g, 'alice', 'Plate Armor Lite', 'battlefield'), give(g, 'alice', 'Bear', 'battlefield')];
    give(g, 'alice', 'Dragonfire Blade Lite', 'battlefield');
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'activate', player: 'alice', object: armor, ability: 0, targets: [[{ kind: 'object', object: bear }]] }));
    expect([g.objects[armor]!.attachedTo?.id, chars(g, g.objects[bear]!).power]).toEqual([bear, 5]);
  });
  const bolt = (g: GameState, target: { kind: 'object'; object: string } | { kind: 'player'; player: string }) =>
    settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[target]] }));
  it('The Mindskinner: damage to an opponent is prevented and each opponent mills that many', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Mindskinner Lite', 'battlefield');
    const [life, library, mine] = [g.players.bob!.life, g.zones.library.bob!.length, g.players.alice!.life];
    g = bolt(g, { kind: 'player', player: 'bob' });
    expect([g.players.bob!.life, g.zones.library.bob!.length]).toEqual([life, library - 3]);
    g = bolt(g, { kind: 'player', player: 'alice' });
    expect(g.players.alice!.life).toBe(mine - 3);
  });
  it('Anti-Venom: counters instead of damage; returns a creature card only if he was cast', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'graveyard');
    const venom = give(g, 'alice', 'Anti-Venom Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: venom }));
    for (let i = 0; i < 4 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    g = bolt(g, { kind: 'object', object: venom });
    expect(g.objects[venom]).toMatchObject({ zone: 'battlefield', damage: 0, counters: { '+1/+1': 3 } });
  });
  it('Undergrowth Champion: a counter instead of damage only while it has one', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const champ = give(g, 'alice', 'Undergrowth Champion Lite', 'battlefield');
    g.objects[champ]!.counters['+1/+1'] = 1;
    g = bolt(g, { kind: 'object', object: champ });
    expect(g.objects[champ]).toMatchObject({ zone: 'battlefield', damage: 0 });
    expect(g.objects[champ]!.counters['+1/+1'] ?? 0).toBe(0);
    g = bolt(g, { kind: 'object', object: champ });
    expect(g.objects[champ]!.zone).toBe('graveyard');
  });
  it('Panther Habit: the equipped creature gets counters instead of damage', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [habit, bear, other] = [give(g, 'alice', 'Panther Habit Lite', 'battlefield'), give(g, 'alice', 'Bear', 'battlefield'), give(g, 'alice', 'Bear', 'battlefield')];
    g.objects[habit]!.attachedTo = { id: bear, zcc: g.objects[bear]!.zcc };
    g = bolt(g, { kind: 'object', object: bear });
    expect(g.objects[bear]).toMatchObject({ zone: 'battlefield', damage: 0, counters: { '+1/+1': 3 } });
    g = bolt(g, { kind: 'object', object: other });
    expect(g.objects[other]!.zone).toBe('graveyard');
  });
  it('Angel of Suffering: damage to you is prevented and you mill twice that many', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Angel of Suffering Lite', 'battlefield');
    const [life, library] = [g.players.alice!.life, g.zones.library.alice!.length];
    g = bolt(g, { kind: 'player', player: 'alice' });
    expect([g.players.alice!.life, g.zones.library.alice!.length]).toEqual([life, library - 6]);
  });
  it('Within Range: each opponent loses life equal to the number of creatures attacking them', () => {
    let g = toStep(start({ extra: CARDS, players: 3 }), 'main1', 'alice');
    give(g, 'alice', 'Within Range', 'battlefield');
    const zs = [0, 1, 2].map(() => give(g, 'alice', 'Zombie', 'battlefield', { sick: false }));
    const [bob, carol] = [g.players.bob!.life, g.players.carol!.life];
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [
      { attacker: zs[0]!, target: { kind: 'player', player: 'bob' } },
      { attacker: zs[1]!, target: { kind: 'player', player: 'bob' } },
      { attacker: zs[2]!, target: { kind: 'player', player: 'carol' } },
    ] } });
    g = settle(g);
    expect([bob - g.players.bob!.life, carol - g.players.carol!.life]).toEqual([2, 1]);
  });
  it('Mauhúr: one more +1/+1 counter on an Army, Goblin or Orc', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Mauhur Lite', 'battlefield');
    const gob = give(g, 'alice', 'Goblin Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    for (const t of [gob, cub]) g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Counter Pump Lite', 'hand'), targets: [[{ kind: 'object', object: t }]] }));
    expect([g.objects[gob]!.counters['+1/+1'], g.objects[cub]!.counters['+1/+1']]).toEqual([2, 1]);
  });
  it("Teferi, Mage of Zhalfir: your creature cards have flash", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Zhalfir Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'hand');
    g = toStep(g, 'upkeep', 'bob');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === cub) || g.priority !== 'alice').toBe(true);
    for (let i = 0; i < 5 && g.priority !== 'alice'; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === cub)).toBe(true);
  });
  it('Vohar: drains only when an instant or sorcery card was discarded this way', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const vohar = give(g, 'alice', 'Vohar Lite', 'battlefield', { sick: false });
    for (const id of [...g.zones.hand.alice!]) g.zones.hand.alice = g.zones.hand.alice!.filter((x) => x !== id);
    const bolt = give(g, 'alice', 'Bolt', 'library');
    g.zones.library.alice = [bolt, ...g.zones.library.alice!.filter((x) => x !== bolt)];
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'activate', player: 'alice', object: vohar, ability: 0 }));
    if (g.pending?.kind === 'discard') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: g.zones.hand.alice!.slice(0, 1) } } as never));
    expect(g.players.bob!.life).toBe(life - 1);
  });
  it('Shadow of the Goblin: no card to discard, no card drawn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Goblin Visions Lite', 'battlefield');
    g = toStep(toStep(g, 'main1', 'bob'), 'main1', 'alice');
    expect(g.stack.length).toBe(1);
    const library = g.zones.library.alice!.length;
    g.zones.hand.alice = [];
    for (let i = 0; i < 5 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    expect([g.zones.hand.alice!.length, g.zones.library.alice!.length]).toEqual([0, library]);
  });
  it('Dion: he and other Knights fly during your turn only', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const dion = give(g, 'alice', 'Dion Lite', 'battlefield');
    const squire = give(g, 'alice', 'Knight Squire Lite', 'battlefield');
    const fly = (id: string) => chars(g, g.objects[id]!).keywords.some((k) => k.id === 'flying');
    expect([fly(dion), fly(squire)]).toEqual([true, true]);
    g = toStep(g, 'main1', 'bob');
    expect([fly(dion), fly(squire)]).toEqual([false, false]);
  });
  it('Sword of Sinew and Steel: up to one planeswalker and up to one artifact', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const trinket = give(g, 'bob', 'Trinket', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Sinew Sword Lite', 'hand'), targets: [[], [{ kind: 'object', object: trinket }]] }));
    expect(g.objects[trinket]!.zone).toBe('graveyard');
  });
  it("a face-down spell isn't an artifact: Powerstone-style mana can't pay for it", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (const id of g.zones.battlefield) if (g.objects[id]!.controller === 'alice') g.objects[id]!.tapped = true;
    give(g, 'alice', 'Island', 'battlefield');
    give(g, 'alice', 'Island', 'battlefield');
    const stone = give(g, 'alice', 'Stone Lite', 'battlefield');
    const morph = give(g, 'alice', 'Morph Lite', 'hand');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === morph)).toBe(false);
    g.objects[stone]!.tapped = true;
    give(g, 'alice', 'Island', 'battlefield');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === morph && (a as { alt?: string }).alt === 'morph')).toBe(true);
  });
  it("Storm of Saruman: the copy of the second spell isn't legendary", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Saruman Storm Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Salve', 'hand') }));
    const legend = give(g, 'alice', 'Legend Lite', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: legend });
    for (let i = 0; i < 10 && (g.pending || g.stack.length); i++) {
      if (g.pending?.kind === 'copy_targets') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'copy_targets' } } as never);
      else if (g.pending) throw new Error(`pending ${g.pending.kind}`);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    const mine = g.zones.battlefield.filter((id) => chars(g, g.objects[id]!).name === 'Legend Lite');
    expect(mine.length).toBe(2);
    expect(mine.filter((id) => chars(g, g.objects[id]!).supertypes.includes('Legendary')).length).toBe(1);
  });
  it('Wildsear: enchantment spells cast from your hand have cascade', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Wildsear Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Kellan Lite', 'hand') }));
    expect(g.pending?.kind === 'cast_free' || g.stack.length > 0 || g.zones.exile.length > 0).toBe(true);
  });
  it("Thryx: big spells cost {1} less and can't be countered", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Thryx Lite', 'battlefield');
    for (const id of g.zones.battlefield) if (g.objects[id]!.controller === 'alice') g.objects[id]!.tapped = true;
    g.players.alice!.pool.C = 4;
    const big = give(g, 'alice', 'Big Spell Lite', 'hand');
    const life = g.players.alice!.life;
    g = act(g, { type: 'cast', player: 'alice', object: big });
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Negate Lite', 'hand'), targets: [[{ kind: 'object', object: big }]] });
    g = settle(g);
    for (let i = 0; i < 6 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    expect(g.players.alice!.life).toBe(life + 5);
  });
  it('Mycosynth Golem: artifact creature spells have affinity for artifacts', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Golem Lite', 'battlefield');
    give(g, 'alice', 'Trinket', 'battlefield');
    for (const id of g.zones.battlefield) if (g.objects[id]!.controller === 'alice') g.objects[id]!.tapped = true;
    g.players.alice!.pool.C = 1;
    const c = give(g, 'alice', 'Affinity Construct Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: c }));
    expect(g.objects[c]!.zone).toBe('battlefield');
  });
  it('Lulu, Stern Guardian: a stun counter on a creature attacking you', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Lulu Lite', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield', { sick: false });
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: bear, target: { kind: 'player', player: 'alice' } }] } });
    for (let i = 0; i < 10 && !(g.objects[bear]!.counters.stun); i++) {
      if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: bear }]] } } as never);
      else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
      else break;
    }
    expect(g.objects[bear]!.counters.stun).toBe(1);
  });
  for (const friend of [false, true]) {
    it(`a creature that must attack but can't attack alone: ${friend ? 'brings a friend' : 'stays home with no one to go with'} (CR 508.1d)`, () => {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      for (const id of g.zones.battlefield) if (g.objects[id]!.controller === 'alice') g.objects[id]!.tapped = true;
      give(g, 'alice', 'Bonded Lite', 'battlefield', { sick: false });
      if (friend) give(g, 'alice', 'Cub', 'battlefield', { sick: false });
      g = toAttack(toStep(g, 'beginning_of_combat'));
      const none = { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [] } } as const;
      if (friend) expect(illegal(g, none as never)).toMatch(/attacks each combat/);
      else expect(() => act(g, none as never)).not.toThrow();
    });
  }
  it('Betor, Kin to All: total toughness 40 — each opponent loses half their life, rounded up', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Betor Lite', 'battlefield');
    const wall = give(g, 'alice', 'Thick Wall Lite', 'battlefield');
    g.objects[wall]!.tapped = true;
    g.players.bob!.life = 37;
    const hand = g.zones.hand.alice!.length;
    g = settle(toStep(g, 'end', 'alice'));
    for (let i = 0; i < 5 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    expect([g.players.bob!.life, g.zones.hand.alice!.length, g.objects[wall]!.tapped]).toEqual([18, hand + 1, false]);
  });
  it("Skullsnatcher: targets only cards in the damaged player's graveyard", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const rat = give(g, 'alice', 'Snatcher Lite', 'battlefield', { sick: false });
    const mine = give(g, 'alice', 'Cub', 'graveyard');
    const theirs = give(g, 'bob', 'Cub', 'graveyard');
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: rat, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 30 && g.pending?.kind !== 'trigger_targets'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } } as never);
      else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
      else break;
    }
    expect(g.pending?.kind).toBe('trigger_targets');
    expect(() => act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: mine }]] } } as never)).toThrow();
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: theirs }]] } } as never);
    for (let i = 0; i < 10 && g.stack.length; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect([g.objects[theirs]!.zone, g.objects[mine]!.zone]).toEqual(['exile', 'graveyard']);
  });
  it('Jolrael: base power and toughness equal to the cards in your hand, counted as it resolves', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const jol = give(g, 'alice', 'Jolrael Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: jol, ability: 0 }));
    const n = g.zones.hand.alice!.length;
    expect([chars(g, g.objects[jol]!).power, chars(g, g.objects[cub]!).toughness]).toEqual([n, n]);
    give(g, 'alice', 'Cub', 'hand');
    expect(chars(g, g.objects[cub]!).power).toBe(n);
  });
  it('Crawling Sensation: only the first land cards put into your graveyard each turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Crawling Lite', 'battlefield');
    const insects = () => g.zones.battlefield.filter((id) => g.objects[id]!.token && chars(g, g.objects[id]!).subtypes.includes('Insect')).length;
    for (let i = 0; i < 2; i++) {
      const forest = give(g, 'alice', 'Forest', 'hand');
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Land Toss Lite', 'hand') });
      g = settle(g);
      if (g.pending?.kind === 'discard') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: [forest] } } as never));
      expect(g.objects[forest]!.zone).toBe('graveyard');
    }
    expect(insects()).toBe(1);
  });
  it("Toph, the Blind Bandit: power equal to the +1/+1 counters on lands you control", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const toph = give(g, 'alice', 'Toph Lite', 'battlefield');
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    g.objects[forest]!.counters['+1/+1'] = 2;
    g.objects[cub]!.counters['+1/+1'] = 5;
    expect(chars(g, g.objects[toph]!).power).toBe(2);
  });
  it('Tyvar, the Pummeler: tap another creature; then he taps himself', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const tyvar = give(g, 'alice', 'Tyvar Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: tyvar, ability: 0, costs: { crew: [cub] } } as never));
    expect([g.objects[cub]!.tapped, g.objects[tyvar]!.tapped]).toEqual([true, true]);
    expect(chars(g, g.objects[tyvar]!).keywords.some((k) => k.id === 'indestructible')).toBe(true);
    expect(illegal(g, { type: 'activate', player: 'alice', object: tyvar, ability: 0, costs: { crew: [tyvar] } } as never)).toBeTruthy();
  });
  it('a counter of any kind put on a creature: once for each counter', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Any Counter Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Counter Pump Lite', 'hand'), targets: [[{ kind: 'object', object: cub }]] }));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });
  it("Goblin Bomb: declining the flip isn't losing it", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bomb = give(g, 'alice', 'Fuse Bomb Lite', 'battlefield');
    g.objects[bomb]!.counters.fuse = 2;
    g = toStep(g, 'main1', 'bob');
    for (let i = 0; i < 40 && !(g.active === 'alice' && g.step === 'upkeep' && g.pending?.kind === 'may'); i++) {
      if (g.pending?.kind === 'discard_to_hand_size') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'discard_to_hand_size', objects: g.zones.hand[g.pending.player]!.slice(0, g.pending.count) } } as never);
      else if (g.pending?.kind === 'declare_attackers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_attackers', attacks: [] } } as never);
      else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
    }
    expect(g.pending?.kind).toBe('may');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: false } } as never));
    expect(g.objects[bomb]!.counters.fuse).toBe(2);
  });
  it('Danny Pink: a card the first time counters are put on a creature each turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Danny Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    for (let i = 0; i < 2; i++) g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Counter Pump Lite', 'hand'), targets: [[{ kind: 'object', object: cub }]] }));
    expect(g.objects[cub]!.counters['+1/+1']).toBe(2);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });
  it('Twinferno: copies your next instant or sorcery spell this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Twinferno Lite', 'hand'), modes: [0] } as never));
    const life = g.players.bob!.life;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] });
    for (let i = 0; i < 10 && (g.pending || g.stack.length); i++) {
      if (g.pending?.kind === 'copy_targets') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'copy_targets' } } as never);
      else if (g.pending) throw new Error(`pending ${g.pending.kind}`);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.players.bob!.life).toBe(life - 6);
  });
  for (const dragon of [true, false]) {
    it(`Temple of the Dragon Queen: ${dragon ? 'untapped while you control a Dragon' : 'asks for a Dragon card otherwise'}`, () => {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      if (dragon) give(g, 'alice', 'Whelp Lite', 'battlefield');
      const temple = give(g, 'alice', 'Dragon Temple Lite', 'hand');
      g = act(g, { type: 'play_land', player: 'alice', object: temple });
      expect(g.pending?.kind === 'as_enters').toBe(!dragon);
      if (g.pending?.kind === 'as_enters') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', reveal: null } } as never);
      expect(g.objects[temple]!.tapped).toBe(!dragon);
    });
  }
  it("Regal Behemoth: extra mana only while you're the monarch", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Regal Lite', 'battlefield');
    const f1 = give(g, 'alice', 'Forest', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: f1, ability: 0 });
    expect(Object.values(g.players.alice!.pool).reduce((a: number, b) => a + Number(b ?? 0), 0)).toBe(1);
    g.monarch = 'alice';
    const f2 = give(g, 'alice', 'Forest', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: f2, ability: 0, bonus: ['U'] } as never);
    expect(g.players.alice!.pool.U).toBe(1);
  });
  it('Alandra, Sky Dreamer: she and each Drake get +X/+X', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const alandra = give(g, 'alice', 'Alandra Lite', 'battlefield');
    const drake = give(g, 'alice', 'Drake Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Triple Draw Lite', 'hand') }));
    const x = g.zones.hand.alice!.length;
    expect([chars(g, g.objects[alandra]!).power, chars(g, g.objects[drake]!).power]).toEqual([4 + x, 2 + x]);
  });
  it('Doc Aurlock: plotting costs {2} less', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (const id of g.zones.battlefield) if (g.objects[id]!.controller === 'alice') g.objects[id]!.tapped = true;
    const card = give(g, 'alice', 'Plotter Lite', 'hand');
    g.players.alice!.pool.C = 1;
    expect(legalActions(g, 'alice').some((a) => a.type === 'plot' && a.object === card)).toBe(false);
    give(g, 'alice', 'Aurlock Lite', 'battlefield');
    expect(legalActions(g, 'alice').some((a) => a.type === 'plot' && a.object === card)).toBe(true);
    g = act(g, { type: 'plot', player: 'alice', object: card });
    expect([g.objects[card]!.zone, g.players.alice!.pool.C ?? 0]).toEqual(['exile', 0]);
  });
  it("Jace Reawakened: can't be cast during your first three turns", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const jace = give(g, 'alice', 'Reawakened Lite', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: jace })).toBeTruthy();
    for (let t = 0; t < 3; t++) g = toStep(toStep(g, 'main1', 'bob'), 'main1', 'alice');
    expect(g.players.alice!.turnsBegun).toBe(4);
    g = settle(act(g, { type: 'cast', player: 'alice', object: jace }));
    expect(g.objects[jace]!.zone).toBe('battlefield');
  });
  const answerAll = (g: GameState, pick: string[] = []): GameState => {
    for (let i = 0; i < 10 && g.pending; i++) {
      const p = g.pending;
      if (p.kind === 'may') g = settle(act(g, { type: 'choose', player: p.player, answer: { kind: 'may', yes: true } } as never));
      else if (p.kind === 'choose_objects') g = settle(act(g, { type: 'choose', player: p.player, answer: { kind: 'choose_objects', objects: p.candidates.filter((c: string) => pick.includes(c)).slice(0, p.max) } } as never));
      else if (p.kind === 'trigger_targets') g = settle(act(g, { type: 'choose', player: p.player, answer: { kind: 'trigger_targets', targets: [pick.map((object) => ({ kind: 'object', object }))] } } as never));
      else break;
    }
    return g;
  };
  it('a plotted card with a required choice of additional costs is offered paying one', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const choosy = give(g, 'alice', 'Choosy Lite', 'hand');
    g = answerAll(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Kellan Lite', 'hand') })), [choosy]);
    expect(g.objects[choosy]!.plotted).toBe(g.turn);
    g = toStep(toStep(g, 'main1', 'bob'), 'main1', 'alice');
    give(g, 'alice', 'Cub', 'battlefield');
    const life = g.players.alice!.life;
    const offered = legalActions(g, 'alice').find((a) => a.type === 'cast' && a.object === choosy);
    expect(offered).toMatchObject({ alt: 'plot' });
    g = settle(act(g, offered!));
    expect(g.players.alice!.life).toBe(life + 1);
  });
  it('The Council of Four: second card and second spell during their own turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Council Lite', 'battlefield');
    const gift = give(g, 'alice', 'Gift of Words', 'hand');
    const draw3 = give(g, 'alice', 'Triple Draw Lite', 'hand');
    const [mine, theirs] = [g.zones.hand.alice!.length, g.zones.hand.bob!.length];
    g = settle(act(g, { type: 'cast', player: 'alice', object: gift }));
    expect(g.zones.hand.bob!.length).toBe(theirs + 2);
    expect(g.zones.hand.alice!.length).toBe(mine - 1);
    g = settle(act(g, { type: 'cast', player: 'alice', object: draw3 }));
    expect(g.zones.hand.alice!.length).toBe(mine - 2 + 3 + 1);
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token && chars(g, g.objects[id]!).subtypes.includes('Knight')).length).toBe(1);
  });
  it('Cityscape Leveler: "When you cast this spell" destroys, and its controller gets a tapped Powerstone', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Leveler Lite', 'hand') });
    g = answerAll(settle(g), [bear]);
    g = settle(g);
    expect(g.objects[bear]!.zone).toBe('graveyard');
    const stone = g.zones.battlefield.find((id) => g.objects[id]!.token && chars(g, g.objects[id]!).subtypes.includes('Powerstone'));
    expect(stone && [g.objects[stone]!.controller, g.objects[stone]!.tapped]).toEqual(['bob', true]);
  });
  it('Aven Interrupter: the exiled spell is plotted, cast free on a later turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cub = give(g, 'alice', 'Cub', 'hand');
    const bird = give(g, 'bob', 'Interrupter Lite', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: cub });
    g = act(g, { type: 'pass', player: 'alice' });
    g = settle(act(g, { type: 'cast', player: 'bob', object: bird }));
    g = answerAll(settle(g), [cub]);
    expect([g.objects[cub]!.zone, g.objects[cub]!.plotted]).toEqual(['exile', g.turn]);
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === cub)).toBe(false);
    g = toStep(toStep(g, 'main1', 'bob'), 'main1', 'alice');
    g.objects[bird]!.zone === 'battlefield' && g.zones.battlefield.splice(g.zones.battlefield.indexOf(bird), 1);
    g.objects[bird]!.zone = 'exile';
    g.zones.exile.push(bird);
    const plot = legalActions(g, 'alice').find((a) => a.type === 'cast' && a.object === cub);
    expect(plot).toMatchObject({ alt: 'plot' });
    g = settle(act(g, plot!));
    expect(g.objects[cub]!.zone).toBe('battlefield');
  });
  it('Kellan Joins Up: a plotted card; Aven Interrupter taxes casting it from exile', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const salve = give(g, 'alice', 'Two Salve', 'hand');
    g = answerAll(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Kellan Lite', 'hand') })), [salve]);
    expect([g.objects[salve]!.zone, g.objects[salve]!.plotted]).toEqual(['exile', g.turn]);
    give(g, 'bob', 'Interrupter Lite', 'battlefield');
    g = toStep(toStep(g, 'main1', 'bob'), 'main1', 'alice');
    for (const id of g.zones.battlefield) if (g.objects[id]!.controller === 'alice') g.objects[id]!.tapped = true;
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === salve)).toBe(false);
    g.players.alice!.pool.C = 2;
    expect(legalActions(g, 'alice').find((a) => a.type === 'cast' && a.object === salve)).toMatchObject({ alt: 'plot' });
  });
  it('Semblance Anvil: spells sharing a card type with the imprinted card cost {2} less', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cub = give(g, 'alice', 'Cub', 'hand');
    g = answerAll(settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Anvil Lite', 'hand') })), [cub]);
    expect(g.objects[cub]!.zone).toBe('exile');
    for (const id of g.zones.battlefield) if (g.objects[id]!.controller === 'alice') g.objects[id]!.tapped = true;
    const bear = give(g, 'alice', 'Bear', 'hand');
    const salve = give(g, 'alice', 'Two Salve', 'hand');
    g.players.alice!.pool.G = 1;
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === bear)).toBe(true);
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === salve)).toBe(false);
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
  });
  it('Ruthless Technomancer: sacrifice X artifacts for a creature card with power X or less', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const tech = give(g, 'alice', 'Technomancer Lite', 'battlefield');
    const [t1, t2] = [give(g, 'alice', 'Trinket', 'battlefield'), give(g, 'alice', 'Trinket', 'battlefield')];
    const zombie = give(g, 'alice', 'Zombie', 'graveyard');
    const base = { type: 'activate', player: 'alice', object: tech, ability: 0, targets: [[{ kind: 'object', object: zombie }]] } as const;
    expect(illegal(g, { ...base, x: 1, costs: { sacrifice: [t1] } } as never)).toBeTruthy();
    expect(illegal(g, { ...base, x: 0, costs: { sacrifice: [] } } as never)).toMatch(/X can't/);
    g = settle(act(g, { ...base, x: 2, costs: { sacrifice: [t1, t2] } } as never));
    expect([g.objects[zombie]!.zone, g.objects[t1]!.zone, g.objects[t2]!.zone]).toEqual(['battlefield', 'graveyard', 'graveyard']);
  });
  it('Minas Morgul: a Wraith for as long as it has a shadow counter', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const land = give(g, 'alice', 'Morgul Lite', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: land, ability: 0, targets: [[{ kind: 'object', object: bear }]] }));
    expect(chars(g, g.objects[bear]!).subtypes).toEqual(expect.arrayContaining(['Bear', 'Wraith']));
    g = toStep(g, 'main1', 'bob');
    expect(chars(g, g.objects[bear]!).subtypes).toContain('Wraith');
    delete g.objects[bear]!.counters.shadow;
    expect(chars(g, g.objects[bear]!).subtypes).not.toContain('Wraith');
  });
  it('Sneaky Snacker: returns from the graveyard when you draw your third card in a turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const snack = give(g, 'alice', 'Snacker Lite', 'graveyard');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Triple Draw Lite', 'hand') }));
    expect([g.objects[snack]!.zone, g.objects[snack]!.tapped]).toEqual(['battlefield', true]);
  });
  it("King T'Challa: whenever any player draws their second card each turn", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', "T'Challa Lite", 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Gift of Words', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });
  const backOf = (g: GameState, id: string) => g.zones.battlefield.find((b) => g.objects[b]!.card === g.objects[id]!.card && g.objects[b]!.face === 1);
  it('Liliana, Heretical Healer: transforms when another creature dies, and makes a Zombie', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lili = give(g, 'alice', 'Liliana Lite // Necromancer Lite', 'battlefield');
    const cub = give(g, 'alice', 'Cub', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: cub }]] }));
    const back = backOf(g, lili);
    expect(back).toBeDefined();
    expect(g.objects[back!]!.counters.loyalty).toBe(3);
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token && chars(g, g.objects[id]!).subtypes.includes('Zombie')).length).toBe(1);
  });
  it("Liliana, Heretical Healer: no Zombie when she dies at the same time (she can't be exiled)", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lili = give(g, 'alice', 'Liliana Lite // Necromancer Lite', 'battlefield');
    give(g, 'alice', 'Cub', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mass Grave Lite', 'hand') }));
    expect(g.objects[lili]!.zone).toBe('graveyard');
    expect(g.zones.battlefield.some((id) => g.objects[id]!.token)).toBe(false);
  });
  it('Chandra, Fire of Kaladesh: transforms once she has dealt 3 damage this turn, counting this ability', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const chandra = give(g, 'alice', 'Chandra Lite // Roaring Lite', 'battlefield');
    const life = g.players.bob!.life;
    for (let i = 0; i < 3; i++) {
      expect(backOf(g, chandra)).toBeUndefined();
      g.objects[chandra]!.tapped = false;
      g = settle(act(g, { type: 'activate', player: 'alice', object: chandra, ability: 0, targets: [[{ kind: 'player', player: 'bob' }]] }));
    }
    expect(g.players.bob!.life).toBe(life - 3);
    expect(backOf(g, chandra)).toBeDefined();
  });
  for (const attackers of [3, 2]) {
    it(`Kytheon, Hero of Akros: ${attackers === 3 ? 'transforms after attacking with two others' : 'stays with only one other attacker'}`, () => {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const ky = give(g, 'alice', 'Kytheon Lite // Battle-Forged Lite', 'battlefield');
      const others = Array.from({ length: attackers - 1 }, () => give(g, 'alice', 'Cub', 'battlefield'));
      g = toAttack(toStep(g, 'beginning_of_combat'));
      g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [ky, ...others].map((attacker) => ({ attacker, target: { kind: 'player', player: 'bob' } })) } });
      for (let i = 0; i < 40 && g.step !== 'main2'; i++) {
        if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } } as never);
        else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
        else break;
      }
      expect(g.step).toBe('main2');
      expect(Boolean(backOf(g, ky))).toBe(attackers === 3);
    });
  }
  it('Garruk Relentless: transforms once he has two or fewer loyalty counters', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const garruk = give(g, 'alice', 'Garruk Lite // Veil-Cursed Lite', 'battlefield');
    g.objects[garruk]!.counters.loyalty = 3;
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: garruk, ability: 0, targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[bear]!.zone).toBe('graveyard');
    const back = backOf(g, garruk);
    expect(back).toBeDefined();
    expect(g.objects[back!]!.counters.loyalty).toBe(1);
  });
  it('Avenging Arrow: only a creature that dealt damage this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const pinger = give(g, 'bob', 'Pinger Lite', 'battlefield', { sick: false });
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const arrow = give(g, 'alice', 'Avenging Arrow Lite', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: arrow, targets: [[{ kind: 'object', object: pinger }]] })).toBeTruthy();
    g = act(g, { type: 'pass', player: 'alice' });
    g = settle(act(g, { type: 'activate', player: 'bob', object: pinger, ability: 0, targets: [[{ kind: 'player', player: 'alice' }]] }));
    expect(g.priority).toBe('alice');
    expect(illegal(g, { type: 'cast', player: 'alice', object: arrow, targets: [[{ kind: 'object', object: bear }]] })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: arrow, targets: [[{ kind: 'object', object: pinger }]] }));
    expect(g.objects[pinger]!.zone).toBe('graveyard');
  });
  it('Inflame and Wall of Resistance: creatures dealt damage this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const wall = give(g, 'alice', 'Resistance Wall Lite', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: wall }]] }));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Inflame Lite', 'hand') }));
    expect([g.objects[wall]!.damage, g.objects[bear]!.damage]).toEqual([5, 0]);
    g = settle(toStep(g, 'end', 'alice'));
    for (let i = 0; i < 5 && g.stack.length; i++) g = settle(act(g, { type: 'pass', player: g.priority! }));
    expect(g.objects[wall]!.counters['+0/+1']).toBe(1);
  });
  it("Heart Warden: its own {G} helps pay for sacrificing it (CR 601.2g–h)", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const warden = give(g, 'alice', 'Heart Warden Lite', 'battlefield');
    for (const o of Object.values(g.objects)) if (o.controller === 'alice' && o.zone === 'battlefield' && o.id !== warden) o.tapped = true;
    give(g, 'alice', 'Forest', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    const offered = legalActions(g, 'alice').find((a) => a.type === 'activate' && a.object === warden);
    expect(offered).toBeTruthy();
    g = settle(act(g, offered!));
    expect([g.objects[warden]!.zone, g.zones.hand.alice!.length]).toEqual(['graveyard', hand + 1]);
  });
  it("Ashiok, Dream Render: an opponent's tutor finds nothing", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.objects[give(g, 'bob', 'Dream Render Lite', 'battlefield')]!.counters.loyalty = 5;
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Tutor Lite', 'hand') }));
    if (g.pending?.kind === 'search') {
      expect(g.pending.candidates).toEqual([]);
      g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [] } }));
    }
    expect(g.zones.hand.alice!.length).toBe(hand);
  });
  it("The Immortal Sun: loyalty abilities can't be activated", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const walker = give(g, 'alice', 'Walker', 'hand');
    g.players.alice!.pool.G = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: walker }));
    give(g, 'bob', 'Immortal Sun Lite', 'battlefield');
    expect(illegal(g, { type: 'activate', player: 'alice', object: walker, ability: 0 })).toMatch(/can’t be activated/);
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === walker)).toBe(false);
  });
  it('Oath of Teferi: loyalty abilities twice each turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Oath Teferi Lite', 'battlefield');
    const walker = give(g, 'alice', 'Walker', 'hand');
    g.players.alice!.pool.G = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: walker }));
    g = settle(act(g, { type: 'activate', player: 'alice', object: walker, ability: 0 }));
    g = settle(act(g, { type: 'activate', player: 'alice', object: walker, ability: 0 }));
    expect(g.objects[walker]!.counters.loyalty).toBe(5);
    expect(illegal(g, { type: 'activate', player: 'alice', object: walker, ability: 0 })).toBeTruthy();
  });
  it('Gond Gate: Gates enter untapped; any color a Gate you control could produce', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const gond = give(g, 'alice', 'Gond Gate Lite', 'battlefield');
    const gate = give(g, 'alice', 'Guildgate Lite', 'hand');
    g = act(g, { type: 'play_land', player: 'alice', object: gate });
    expect(g.objects[gate]!.tapped).toBe(false);
    const choices = legalActions(g, 'alice').filter((a) => a.type === 'activate_mana' && a.object === gond && a.ability === 1).map((a) => (a as { choice?: unknown }).choice);
    expect(choices.sort()).toEqual(['U', 'W']);
  });
  it('Aettir and Priwen: base power and toughness equal to your life total', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const sword = give(g, 'alice', 'Aettir Lite', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: sword, ability: 0, targets: [[{ kind: 'object', object: bear }]] }));
    g.players.alice!.life = 13;
    expect([chars(g, g.objects[bear]!).power, chars(g, g.objects[bear]!).toughness]).toEqual([13, 13]);
  });
  it('Razorkin Needlehead: damage to the opponent who drew (not to itself)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const needle = give(g, 'alice', 'Needlehead Lite', 'battlefield');
    g = settle(toStep(g, 'main1', 'bob'));
    expect([g.players.bob!.life, g.objects[needle]!.damage ?? 0]).toEqual([19, 0]);
  });
  it('Angelic Guardian: the attacking creatures gain indestructible', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Guardian Angel Lite', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: bear, target: { kind: 'player', player: 'bob' } }] } }));
    expect(chars(g, g.objects[bear]!).keywords.some((k) => k.id === 'indestructible')).toBe(true);
  });
  it('Battle Angels of Tyr: "more … than each other player"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const angel = give(g, 'alice', 'Tyr Lite', 'battlefield');
    for (let i = 0; i < 9; i++) give(g, 'bob', 'Bear', 'hand');
    g.players.bob!.life = 30;
    const hand = g.zones.hand.alice!.length;
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: angel, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 30 && g.step !== 'end_of_combat'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } });
      else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
      else break;
    }
    expect([g.zones.hand.alice!.length, g.players.alice!.life]).toEqual([hand + 1, 23]);
  });
  it('Timely Ward: flash only if it targets a commander; Illusion Spinners: flash if you control a Faerie', () => {
    let g = toStep(start({ format: 'commander', extra: CARDS, decks: { alice: [...Array(94).fill('Bear'), 'Timely Lite', 'Spinners Lite', 'Faerie Friend', 'Bolt', 'Yuriko Commander Lite'], bob: [...Array(98).fill('Bear'), 'Bolt'] }, commanders: { alice: ['Yuriko Commander Lite'] } }), 'main1', 'alice');
    const cmdr = Object.values(g.objects).find((o) => o.commander && o.owner === 'alice')!.id;
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: cmdr, to: 'battlefield' } });
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = toStep(g, 'main1', 'bob');
    const [w1, w2] = [give(g, 'alice', 'Timely Lite', 'hand'), give(g, 'alice', 'Timely Lite', 'hand')];
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] });
    expect(illegal(g, { type: 'cast', player: 'alice', object: w1, targets: [[{ kind: 'object', object: bear }]] })).toBeTruthy();
    g = act(g, { type: 'pass', player: 'bob' });
    g = act(g, { type: 'cast', player: 'alice', object: w2, targets: [[{ kind: 'object', object: cmdr }]] });
    expect(g.stack.length).toBe(2);
    const spinners = give(g, 'alice', 'Spinners Lite', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: spinners })).toBeTruthy();
    give(g, 'alice', 'Faerie Friend', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: spinners });
    expect(g.stack.length).toBe(3);
  });
  it('Sephiroth: "As this creature transforms into …, you get an emblem" — no trigger, it just happens', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const seph = give(g, 'alice', 'Soldier Lite // Angel Lite', 'battlefield');
    g = act(g, { type: 'activate', player: 'alice', object: seph, ability: 0 });
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    expect([g.objects[seph]!.face, g.zones.command.filter((id) => g.objects[id]!.emblem).length, g.stack.length]).toEqual([1, 1, 0]);
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: give(g, 'bob', 'Bear', 'battlefield') }]] }));
    expect(g.players.alice!.life).toBe(life + 1);
  });
  it('Ulamog, the Defiler: half their library exiled, counters from exile, annihilator X', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Bear', 'exile');
    const lib = g.zones.library.bob!.length;
    const ulamog = give(g, 'alice', 'Defiler Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: ulamog }));
    const most = Math.max(...g.zones.exile.map((id) => g.cards[g.objects[id]!.card]!.cmc ?? 0));
    expect([g.zones.library.bob!.length, g.objects[ulamog]!.counters['+1/+1'], most >= 2]).toEqual([lib - Math.ceil(lib / 2), most, true]);
    g.objects[ulamog]!.counters['+1/+1'] = 2;
    g.objects[ulamog]!.sick = false;
    const bobs = [give(g, 'bob', 'Bear', 'battlefield'), give(g, 'bob', 'Bear', 'battlefield'), give(g, 'bob', 'Bear', 'battlefield')];
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: ulamog, target: { kind: 'player', player: 'bob' } }] } });
    g = settle(g);
    expect(g.pending).toMatchObject({ kind: 'sacrifice', player: 'bob', count: 2 });
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'sacrifice', objects: bobs.slice(0, 2) } }));
    expect(bobs.map((b) => g.objects[b]!.zone)).toEqual(['graveyard', 'graveyard', 'battlefield']);
  });
  it('Shatterskull Smashing: twice X divided when X is 6 or more', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [a, b] = [give(g, 'bob', 'Bear', 'battlefield'), give(g, 'bob', 'Bear', 'battlefield')];
    const smash = give(g, 'alice', 'Smashing Lite', 'hand');
    g.players.alice!.pool.R = 2;
    g.players.alice!.pool.C = 6;
    const targets = [[{ kind: 'object' as const, object: a }, { kind: 'object' as const, object: b }]];
    expect(illegal(g, { type: 'cast', player: 'alice', object: smash, x: 6, targets, divide: [3, 3] })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: smash, x: 6, targets, divide: [10, 2] }));
    expect([g.objects[a]!.zone, g.objects[b]!.zone]).toEqual(['graveyard', 'graveyard']);
  });
  it('Comet Storm: one target, and another for each time it was kicked', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const comet = give(g, 'alice', 'Comet Lite', 'hand');
    g.players.alice!.pool.R = 2;
    g.players.alice!.pool.C = 3;
    const two = [[{ kind: 'player' as const, player: 'bob' }, { kind: 'object' as const, object: bear }]];
    expect(illegal(g, { type: 'cast', player: 'alice', object: comet, x: 2, targets: two })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: comet, x: 2, kicked: 1, targets: two }));
    expect([g.players.bob!.life, g.objects[bear]!.zone]).toEqual([18, 'graveyard']);
  });
  it('Bruenor Battlehammer: +2/+0 for each Equipment on each creature; a free equip on any turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Bruenor Lite', 'battlefield');
    const [s1, s2] = [give(g, 'alice', 'Sword Lite', 'battlefield'), give(g, 'alice', 'Sword Lite', 'battlefield')];
    const [b1, b2] = [give(g, 'alice', 'Bear', 'battlefield'), give(g, 'alice', 'Bear', 'battlefield')];
    g = settle(act(g, { type: 'activate', player: 'alice', object: s1, ability: 0, targets: [[{ kind: 'object', object: b1 }]], costs: { freeEquip: true } }));
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'activate', player: 'alice', object: s2, ability: 0, targets: [[{ kind: 'object', object: b1 }]] }));
    expect([chars(g, g.objects[b1]!).power, chars(g, g.objects[b1]!).toughness, chars(g, g.objects[b2]!).power]).toEqual([8, 4, 2]);
  });
  it('Forge Anew: equip at instant speed on your turn; the first equip each turn for {0}', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Forge Anew Lite', 'battlefield');
    const sword = give(g, 'alice', 'Sword Lite', 'battlefield');
    const [b1, b2] = [give(g, 'alice', 'Bear', 'battlefield'), give(g, 'alice', 'Bear', 'battlefield')];
    for (const o of Object.values(g.objects)) if (o.controller === 'alice' && chars(g, o).types.includes('Land')) o.tapped = true;
    const free = legalActions(g, 'alice').find((a) => a.type === 'activate' && a.object === sword);
    expect(free).toMatchObject({ costs: { freeEquip: true } });
    g = settle(act(g, { type: 'activate', player: 'alice', object: sword, ability: 0, targets: [[{ kind: 'object', object: b1 }]], costs: { freeEquip: true } }));
    expect(g.objects[sword]!.attachedTo?.id).toBe(b1);
    expect(illegal(g, { type: 'activate', player: 'alice', object: sword, ability: 0, targets: [[{ kind: 'object', object: b2 }]], costs: { freeEquip: true } })).toBeTruthy();
    g = toStep(g, 'beginning_of_combat', 'alice');
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'activate', player: 'alice', object: sword, ability: 0, targets: [[{ kind: 'object', object: b2 }]] }));
    expect(g.objects[sword]!.attachedTo?.id).toBe(b2);
  });
  it('Scroll Rack: swap cards in hand for the top of the library, then stack them in any order', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const rack = give(g, 'alice', 'Scroll Rack Lite', 'battlefield');
    const [a, b] = [give(g, 'alice', 'Bolt', 'hand'), give(g, 'alice', 'Bear', 'hand')];
    const lib = g.zones.library.alice!;
    const [t1, t2] = [lib[0]!, lib[1]!];
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'activate', player: 'alice', object: rack, ability: 0 }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [a, b] } }));
    expect([g.zones.hand.alice!.includes(t1), g.zones.hand.alice!.includes(t2), g.zones.hand.alice!.length]).toEqual([true, true, hand]);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [b, a] } }));
    expect(g.zones.library.alice!.slice(0, 2)).toEqual([b, a]);
  });
  it("Patriarch's Bidding: each player chooses a type; all creature cards of any chosen type return", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mine = give(g, 'alice', 'Bear', 'graveyard');
    const theirs = give(g, 'bob', 'Bear', 'graveyard');
    const elf = give(g, 'bob', 'Patron Lite', 'graveyard');
    const goblin = give(g, 'alice', 'Goblin Pair', 'graveyard');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bidding Lite', 'hand') }));
    expect(g.pending).toMatchObject({ kind: 'choose_option', player: 'alice' });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: 'Bear' } }));
    expect(g.pending).toMatchObject({ kind: 'choose_option', player: 'bob' });
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'choose_option', choice: 'Goblin' } }));
    expect([g.objects[mine]!.zone, g.objects[theirs]!.zone, g.objects[theirs]!.controller, g.objects[elf]!.zone, g.objects[goblin]!.zone]).toEqual(['battlefield', 'battlefield', 'bob', 'graveyard', 'battlefield']);
  });
  it("Ezuri's Predation: a 4/4 for each of their creatures, each fighting a different one", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bears = [give(g, 'bob', 'Bear', 'battlefield'), give(g, 'bob', 'Bear', 'battlefield')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Predation Lite', 'hand') }));
    const beasts = Object.values(g.objects).filter((o) => o.token && o.zone === 'battlefield');
    expect([bears.map((b) => g.objects[b]!.zone), beasts.length, beasts.map((b) => b.damage)]).toEqual([['graveyard', 'graveyard'], 2, [2, 2]]);
  });
  it('Hit the Mother Lode: tapped Treasures for the difference', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'library');
    const lib = g.zones.library.alice!;
    lib.splice(lib.indexOf(bear), 1);
    lib.unshift(bear);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mother Lode Lite', 'hand') }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: false } }));
    const treasures = Object.values(g.objects).filter((o) => o.token && o.zone === 'battlefield');
    expect([g.objects[bear]!.zone, treasures.length, treasures.every((t) => t.tapped)]).toEqual(['hand', 8, true]);
  });
  it('Call Forth the Tempest: damage equal to the total mana value of the other spells you cast this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const theirs = give(g, 'bob', 'Bear', 'battlefield');
    g.players.alice!.pool.G = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bear', 'hand') }));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Tempest Lite', 'hand') }));
    expect(g.objects[theirs]!.zone).toBe('graveyard');
  });
  it('Divine Visitation: creature tokens are 4/4 Angels instead; a Treasure is a Treasure', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Visitation Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Spores Lite', 'hand') }));
    const tokens = Object.values(g.objects).filter((o) => o.token && o.zone === 'battlefield').map((o) => chars(g, o).name).sort();
    expect(tokens).toEqual(['Angel Token', 'Angel Token', 'Treasure']);
  });
  it('Twinning Staff: one more copy, and new targets for that one', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Twinning Lite', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const bolt = give(g, 'alice', 'Bolt', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: bolt, targets: [[{ kind: 'player', player: 'bob' }]] });
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Twin Spell Lite', 'hand'), targets: [[{ kind: 'object', object: bolt }]] });
    g = settle(g);
    expect(g.pending).toMatchObject({ kind: 'copy_targets' });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'copy_targets', targets: [[{ kind: 'object', object: bear }]] } }));
    expect([g.players.bob!.life, g.objects[bear]!.zone]).toEqual([14, 'graveyard']);
  });
  it('Maelstrom Nexus: only the first spell each turn has cascade', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Maelstrom Nexus Lite', 'battlefield');
    g.players.alice!.pool.G = 4;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bear', 'hand') });
    expect(g.stack.map((e) => e.kind)).toEqual(['spell', 'ability']);
    g = settle(g);
    while (g.pending) g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: false } }));
    const before = g.stack.length;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bear', 'hand') });
    expect(g.stack.length).toBe(before + 1);
  });
  it('Knight of Dusk: "target creature blocking this creature"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const knight = give(g, 'alice', 'Dusk Knight Lite', 'battlefield');
    const [b1, b2] = [give(g, 'bob', 'Bear', 'battlefield'), give(g, 'bob', 'Bear', 'battlefield')];
    expect(illegal(g, { type: 'activate', player: 'alice', object: knight, ability: 0, targets: [[{ kind: 'object', object: b1 }]] })).toBeTruthy();
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: knight, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 10 && g.pending?.kind !== 'declare_blockers'; i++) if (g.priority) g = act(g, { type: 'pass', player: g.priority });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: b1, attacker: knight }] } });
    for (let i = 0; i < 10 && g.priority !== 'alice'; i++) if (g.priority) g = act(g, { type: 'pass', player: g.priority });
    expect(illegal(g, { type: 'activate', player: 'alice', object: knight, ability: 0, targets: [[{ kind: 'object', object: b2 }]] })).toBeTruthy();
    g = settle(act(g, { type: 'activate', player: 'alice', object: knight, ability: 0, targets: [[{ kind: 'object', object: b1 }]] }));
    expect([g.objects[b1]!.zone, g.objects[b2]!.zone]).toEqual(['graveyard', 'battlefield']);
  });
  it("Urabrask's Forge: an X/1 token, X the oil counters", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const forge = give(g, 'alice', 'Forge Lite', 'battlefield');
    g.objects[forge]!.counters.oil = 1;
    g = settle(toStep(g, 'beginning_of_combat', 'alice'));
    const token = Object.values(g.objects).find((o) => o.token && o.zone === 'battlefield')!;
    expect([chars(g, token).power, chars(g, token).toughness]).toEqual([2, 1]);
    g = settle(toStep(g, 'end', 'alice'));
    expect(g.objects[token.id]?.zone ?? 'gone').not.toBe('battlefield');
  });
  it('impending: cast for its impending cost, it enters with time counters and is not a creature until the last is removed', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lord = give(g, 'alice', 'Overlord Lite', 'hand');
    g.players.alice!.pool.G = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: lord, alt: 'impending' }));
    const everywhere = Object.values(g.objects).find((o) => o.token && o.zone === 'battlefield')!;
    expect([g.objects[lord]!.counters.time, chars(g, g.objects[lord]!).types, chars(g, everywhere).subtypes, everywhere.tapped]).toEqual([2, ['Enchantment'], ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'], true]);
    g = settle(toStep(g, 'end', 'alice'));
    expect(g.objects[lord]!.counters.time).toBe(1);
    g = settle(toStep(toStep(g, 'main1', 'alice'), 'end', 'alice'));
    expect([g.objects[lord]!.counters.time ?? 0, chars(g, g.objects[lord]!).types]).toEqual([0, ['Enchantment', 'Creature']]);
  });
  it('Archangel of Tithes: while it attacks, blocking costs {1} for each blocker', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const angel = give(g, 'alice', 'Tithes Lite', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    for (const o of Object.values(g.objects)) if (o.controller === 'bob' && o.zone === 'battlefield' && o.id !== bear) o.tapped = true;
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: angel, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 10 && g.pending?.kind !== 'declare_blockers'; i++) if (g.priority) g = act(g, { type: 'pass', player: g.priority });
    const block = { type: 'choose' as const, player: 'bob', answer: { kind: 'declare_blockers' as const, blocks: [{ blocker: bear, attacker: angel }] } };
    expect(illegal(g, block)).toMatch(/costs \{1\}/);
    g.players.bob!.pool.C = 1;
    g = act(g, block);
    expect([g.players.bob!.pool.C, g.combat?.attackers[angel]?.blocked]).toEqual([0, true]);
  });
  it('Talion, the Kindly Lord: a spell with the chosen mana value, power, or toughness', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const talion = give(g, 'alice', 'Talion Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: talion }));
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'number' });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', choice: '2' } }));
    g = toStep(g, 'main1', 'bob');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] }));
    expect([g.players.bob!.life, g.zones.hand.alice!.length]).toEqual([20, hand]);
    g.players.bob!.pool.G = 2;
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Bear', 'hand') }));
    expect([g.players.bob!.life, g.zones.hand.alice!.length]).toEqual([18, hand + 1]);
  });
  it('Multiversal Passage: choose a basic land type, then pay 2 life or it enters tapped; it taps for that color', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const land = give(g, 'alice', 'Passage Lite', 'hand');
    g = act(g, { type: 'play_land', player: 'alice', object: land });
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'land_type' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', choice: 'Island' } });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', pay: true } });
    expect([g.players.alice!.life, g.objects[land]!.tapped, chars(g, g.objects[land]!).subtypes]).toEqual([18, false, ['Island']]);
    g = act(g, { type: 'activate_mana', player: 'alice', object: land, ability: 0 });
    expect(g.players.alice!.pool.U).toBe(1);
  });
  it("Carpet of Flowers: once you've taken the mana this turn it doesn't trigger again", () => {
    let g = toStep(start({ extra: CARDS }), 'upkeep', 'alice');
    give(g, 'alice', 'Carpet Lite', 'battlefield');
    give(g, 'bob', 'Island', 'battlefield');
    give(g, 'bob', 'Island', 'battlefield');
    g = toStep(g, 'main1', 'alice');
    g = settle(g);
    expect(g.pending).toMatchObject({ kind: 'may' });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: 'G' } });
    expect(g.players.alice!.pool.G).toBe(2);
    g = toStep(g, 'main2', 'alice');
    expect([g.stack.length, g.pending]).toEqual([0, null]);
  });
  it('Carpet of Flowers: declined, it triggers again in the second main phase', () => {
    let g = toStep(start({ extra: CARDS }), 'upkeep', 'alice');
    give(g, 'alice', 'Carpet Lite', 'battlefield');
    give(g, 'bob', 'Island', 'battlefield');
    g = settle(toStep(g, 'main1', 'alice'));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: false } }));
    g = settle(toStep(g, 'main2', 'alice'));
    expect(g.pending).toMatchObject({ kind: 'may' });
  });
  it('Mirrodin Besieged: only the chosen bullet is an ability of the permanent', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const siege = give(g, 'alice', 'Besieged Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: siege }));
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'word', options: ['Mirran', 'Phyrexian'] });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', choice: 'Phyrexian' } }));
    const c = chars(g, g.objects[bear]!);
    expect([c.power, c.keywords.some((k) => k.id === 'flying')]).toEqual([2, true]);
  });
  it('Frontier Siege (Khans): {G}{G} at the beginning of each of your main phases', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const siege = give(g, 'alice', 'Siege Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: siege }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', choice: 'Khans' } }));
    g = toStep(g, 'main2', 'alice');
    g = settle(g);
    expect(g.players.alice!.pool.G).toBe(2);
  });
  it('Monastery Siege (Dragons): opponents\' spells that target you or your permanents cost {2} more', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const siege = give(g, 'alice', 'Siege Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: siege }));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', choice: 'Dragons' } }));
    g = toStep(g, 'main1', 'bob');
    const bolts = [give(g, 'bob', 'Bolt', 'hand'), give(g, 'bob', 'Bolt', 'hand')];
    for (const o of Object.values(g.objects)) if (o.controller === 'bob' && o.zone === 'battlefield') o.tapped = true;
    expect(illegal(g, { type: 'cast', player: 'bob', object: bolts[0]!, targets: [[{ kind: 'object', object: bear }]] })).toBeTruthy();
    expect(illegal(g, { type: 'cast', player: 'bob', object: bolts[0]!, targets: [[{ kind: 'player', player: 'alice' }]] })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'bob', object: bolts[0]!, targets: [[{ kind: 'player', player: 'bob' }]] }));
    g.players.bob!.pool.C = 2;
    g = settle(act(g, { type: 'cast', player: 'bob', object: bolts[1]!, targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[bear]!.zone).toBe('graveyard');
  });
});

describe('staples test cards', () => {
  it('have unique names (a later card with the same name would replace an earlier one)', () => {
    const names = CARDS.map((c) => (c as { name: string }).name);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });
});
