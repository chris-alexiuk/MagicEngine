import { describe, expect, it } from 'vitest';
import { chars, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

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
    for (const id of g.zones.hand.alice!.filter((id) => g.objects[id]!.card && /Forest|Island|Plains|Swamp|Mountain/.test(g.cards[g.objects[id]!.card]!.name))) g.objects[id]!.zone = 'library';
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
