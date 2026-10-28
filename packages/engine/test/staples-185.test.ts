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
    const top = g.zones.library.alice![0]!;
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
