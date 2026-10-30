import { describe, expect, it } from 'vitest';
import { chars } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';
import { moveObject } from '../src/zones.js';

const CARDS = [
  makeCard({ name: 'Cub', type_line: 'Creature — Bear', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{0}', power: '5', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Bolt', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Bolt deals 3 damage to any target.' }),
  makeCard({ name: 'Soldier Cub', type_line: 'Creature — Human Soldier', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Merfolk Lite', type_line: 'Creature — Merfolk', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Plains', type_line: 'Basic Land — Plains', mana_cost: '', oracle_text: '({T}: Add {W}.)' }),
  makeCard({ name: 'Swamp', type_line: 'Basic Land — Swamp', mana_cost: '', oracle_text: '({T}: Add {B}.)' }),
  makeCard({ name: 'Mountain', type_line: 'Basic Land — Mountain', mana_cost: '', oracle_text: '({T}: Add {R}.)' }),
  makeCard({ name: 'Conch Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}, Sacrifice this artifact: Draw two cards, then put a card from your hand on top of your library.' }),
  makeCard({ name: 'Snail Lite', type_line: 'Creature — Fungus Snail', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: 'When this creature enters, target opponent exiles a card from their hand.' }),
  makeCard({ name: 'Negotiation Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target opponent exiles a card from their hand. If this spell was cast from a graveyard, draw a card.\nFlashback {0}' }),
  makeCard({ name: 'Unified Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Counter target spell if you control more creatures than that spell's controller." }),
  makeCard({ name: 'Cutpurse Lite', type_line: 'Creature — Human Pirate', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'When this creature enters, each opponent sacrifices a permanent of their choice unless they pay {1}.' }),
  makeCard({ name: 'Sigil Lite', type_line: 'Creature — Rhino Soldier', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Whenever a creature you control enters, if that creature is 1/1, put two +1/+1 counters on it.' }),
  makeCard({ name: 'Sextant Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "{T}, Sacrifice this artifact: Add one mana of any color. Draw a card at the beginning of the next turn's upkeep." }),
  makeCard({ name: 'Vigor Lite', type_line: 'Sorcery', mana_cost: '{1}', oracle_text: 'Return target creature card from your graveyard to the battlefield. If {G} was spent to cast this spell, that creature enters with an additional +1/+1 counter on it.' }),
  makeCard({ name: 'Response Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'At the beginning of each upkeep, if you lost life last turn, create a 1/1 white Soldier creature token.' }),
  makeCard({ name: 'Arrester Lite', type_line: 'Creature — Human Soldier', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: 'When this creature enters, detain target creature an opponent controls. (Until your next turn, that creature can\'t attack or block and its activated abilities can\'t be activated.)' }),
  makeCard({ name: 'Pinger Lite', type_line: 'Creature — Human Wizard', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{T}: This creature deals 1 damage to any target.' }),
  makeCard({ name: 'Basin Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{X}, {T}: Put a +1/+1 counter on target creature with power X. Activate only as a sorcery.' }),
  makeCard({ name: 'Venom Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Put three -1/-1 counters on target creature. Its controller loses 3 life unless they sacrifice another nonland permanent of their choice or discard a card.' }),
  makeCard({ name: 'Renewal Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Return target creature card from your graveyard to your hand. Target creature gets -X/-X until end of turn, where X is the toughness of the card returned this way.' }),
  makeCard({ name: 'Horror Lite', type_line: 'Creature — Horror', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: 'When this creature enters, each other player may return a creature card from their graveyard to the battlefield.' }),
  makeCard({ name: 'Guide Lite', type_line: 'Creature — Merfolk Scout', mana_cost: '{0}', power: '3', toughness: '2', oracle_text: 'Whenever this creature attacks, you may tap another untapped Merfolk you control. When you do, return target creature card with mana value 3 or less from your graveyard to the battlefield.' }),
  makeCard({ name: 'Worker Lite', type_line: 'Artifact Creature — Assembly-Worker', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{T}: You gain 1 life. If you control creatures named Plant Lite and Tower Lite, you gain 3 life instead.' }),
  makeCard({ name: 'Plant Lite', type_line: 'Artifact Creature — Assembly-Worker', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Tower Lite', type_line: 'Artifact Creature — Assembly-Worker', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Last Stand Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target opponent loses 2 life for each Swamp you control. Last Stand Lite deals damage to target creature equal to the number of Mountains you control. Create a 1/1 green Saproling creature token for each Forest you control. You gain 2 life for each Plains you control. Draw a card for each Island you control, then discard that many cards.' }),
  makeCard({ name: 'Processor Lite', type_line: 'Creature — Eldrazi Processor', mana_cost: '{0}', power: '7', toughness: '8', oracle_text: "When you cast this spell, you may put a card an opponent owns from exile into that player's graveyard. If you do, you gain 5 life." }),
  makeCard({ name: 'Attendant Lite', type_line: 'Creature — Eldrazi Processor', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: "{0}, Put a card an opponent owns from exile into that player's graveyard: Draw a card." }),
  makeCard({ name: 'Assault Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "As an additional cost to cast this spell, put a card an opponent owns from exile into that player's graveyard.\nAssault Lite deals 5 damage to target creature." }),
  makeCard({ name: 'Priest Lite', type_line: 'Creature — Human Cleric', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'At the beginning of your upkeep, you may reveal a Dinosaur card from your hand. If you do, you gain 2 life.' }),
  makeCard({ name: 'Dino Lite', type_line: 'Creature — Dinosaur', mana_cost: '{5}', cmc: 5, power: '5', toughness: '5', oracle_text: '' }),
  makeCard({ name: 'Zephyr Lite', type_line: 'Creature — Bird Soldier', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "Flying\nWhen this creature enters, return up to one other target creature you control to its owner's hand. If it was a Soldier, put a +1/+1 counter on this creature." }),
  makeCard({ name: 'Indignation Lite', type_line: 'Sorcery', mana_cost: '{X}', oracle_text: 'Mill X cards. Target player loses 2 life for each creature card put into your graveyard this way.' }),
  makeCard({ name: 'Skald Lite', type_line: 'Creature — Dwarf Berserker', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "Whenever this creature becomes tapped, if it's enchanted or equipped, create a 2/1 red Dwarf Berserker creature token." }),
  makeCard({ name: 'Heavy Sword', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equipped creature gets +1/+1.\nEquip {3}' }),
  makeCard({ name: 'Chosen Lite', type_line: 'Creature — Elf Warrior', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: "If this creature would die, put it on the bottom of its owner's library instead." }),
  makeCard({ name: 'Misinformation Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Put up to three target cards from an opponent's graveyard on top of their library in any order." }),
  makeCard({ name: 'Shatter Lite', type_line: 'Sorcery', mana_cost: '{X}', oracle_text: 'Target player discards X cards at random.' }),
  makeCard({ name: 'Salvage Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Draw cards equal to the number of cards target opponent discarded this turn.' }),
  makeCard({ name: 'Mind Rot Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target player discards two cards.' }),
  makeCard({ name: 'Twinned Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Draw a card. If this spell wasn't cast from your hand, draw two cards instead.\nFlashback {0}" }),
  makeCard({ name: 'Gift Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'You may choose a creature card in your graveyard. If you do, return it to the battlefield with an additional +1/+1 counter on it.' }),
  makeCard({ name: 'Minefield Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever a creature attacks or blocks, this enchantment deals 2 damage to it.' }),
  makeCard({ name: 'Axe Lite', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: "Equipped creature gets +1/+1. If it's a Warrior, it gets +2/+1 instead.\nEquip {1}" }),
  makeCard({ name: 'Warrior Cub', type_line: 'Creature — Human Warrior', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Revelation Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Target opponent reveals their hand. You may choose a creature or battle card from it. If you do, that player discards that card. If you don't, incubate 3." }),
  makeCard({ name: 'Hoplite Lite', type_line: 'Creature — Human Soldier', mana_cost: '{0}', power: '1', toughness: '2', oracle_text: 'Heroic — Whenever you cast a spell that targets this creature, put a +1/+1 counter on this creature and prevent all damage that would be dealt to it this turn.' }),
  makeCard({ name: 'Convergence Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Search your library for a Plains card, an Island card, a Swamp card, and a Mountain card. Reveal those cards, put them into your hand, then shuffle.' }),
  makeCard({ name: 'Falling Lite', type_line: 'Enchantment Creature — Nightmare', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: 'Whenever this creature attacks, target creature defending player controls gets -2/-0 and loses flying until your next turn.' }),
  makeCard({ name: 'Flyer', type_line: 'Creature — Bird', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'Flying' }),
  makeCard({ name: 'Phoenix Lite', type_line: 'Creature — Phoenix', mana_cost: '{0}', power: '4', toughness: '2', oracle_text: 'Flying\nAt the beginning of each end step, if you cycled two or more cards this turn, return this card from your graveyard to your hand.' }),
  makeCard({ name: 'Cycler Lite', type_line: 'Creature — Bird', mana_cost: '{1}', power: '1', toughness: '1', oracle_text: 'Cycling {0}' }),
  makeCard({ name: 'Cinderhorn Lite', type_line: 'Creature — Rhino', mana_cost: '{0}', power: '4', toughness: '2', oracle_text: "At the beginning of each player's end step, if no creatures attacked this turn, put a fury counter on this creature. Then this creature deals damage equal to the number of fury counters on it to that player." }),
  makeCard({ name: 'Urgoros Lite', type_line: 'Legendary Creature — Horror', mana_cost: '{0}', power: '6', toughness: '5', oracle_text: "Flying\nWhenever Urgoros Lite deals combat damage to a player, that player discards a card at random. If the player can't, you draw a card." }),
  makeCard({ name: 'Whelp Lite', type_line: 'Creature — Dragon', mana_cost: '{0}', power: '2', toughness: '3', oracle_text: 'Flying\n{0}: This creature gets +1/+0 until end of turn. If this ability has been activated four or more times this turn, sacrifice this creature at the beginning of the next end step.' }),
  makeCard({ name: 'Profusion Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever you play a card, draw a card.' }),
  makeCard({ name: 'Roar Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Until end of turn, target artifact or creature becomes a Dinosaur artifact creature with base power and toughness 4/3 in addition to its other types.' }),
  makeCard({ name: 'Infiniscope Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}: Add {C}{C}. When you next cast a spell with {X} in its mana cost this turn, you draw a card and gain half X life, rounded down.' }),
  makeCard({ name: 'X Burn', type_line: 'Sorcery', mana_cost: '{X}', oracle_text: 'X Burn deals X damage to any target.' }),
  makeCard({ name: 'Camp Lite', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {G}. When you next cast a Bird creature spell this turn, it enters with an additional +1/+1 counter on it.' }),
  makeCard({ name: 'Bird Lite', type_line: 'Creature — Bird', mana_cost: '{1}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Ether Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}, Exile this artifact: Add {U}. When you next cast an instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.' }),
  makeCard({ name: 'Shock Lite', type_line: 'Instant', mana_cost: '{1}', oracle_text: 'Shock Lite deals 2 damage to any target.' }),
  makeCard({ name: 'Array Lite', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}: Add one mana of any color. When you next cast an artifact spell this turn, that spell gains sunburst.' }),
  makeCard({ name: 'Golem Lite', type_line: 'Artifact Creature — Golem', mana_cost: '{2}', power: '0', toughness: '0', oracle_text: '' }),
  makeCard({ name: 'Vale Lite', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add one mana of any color. An opponent gains control of this land at the beginning of the next end step.' }),
  makeCard({ name: 'Priest of Mana Lite', type_line: 'Creature — Human Cleric', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{1}: Add {W}. If this ability has been activated four or more times this turn, sacrifice this creature at the beginning of the next end step.' }),
  makeCard({ name: 'Caress Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Destroy target creature. If that creature was a Human, you gain life equal to its toughness.' }),
  makeCard({ name: 'Stone Human', type_line: 'Creature — Human', mana_cost: '{0}', power: '1', toughness: '4', oracle_text: 'Indestructible' }),
  makeCard({ name: 'Sphinx Lite', type_line: 'Creature — Sphinx', mana_cost: '{0}', power: '3', toughness: '5', oracle_text: "Kicker {0}\nFlying\nWhen this creature enters, draw three cards. Then if it wasn't kicked, discard three cards." }),
  makeCard({ name: 'Grip Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Counter target spell unless its controller exiles all cards from their graveyard.\nDraw a card.' }),
  makeCard({ name: 'Flamebreak Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Flamebreak Lite deals 3 damage to each creature without flying and each player. Creatures dealt damage this way can't be regenerated this turn." }),
  makeCard({ name: 'Mastery Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw a card for each creature target player controls, then draw a card for each creature another target player controls.' }),
  makeCard({ name: 'Cudgels Lite', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: '{0}: Until end of turn, equipped creature gets +X/+0, where X is the number of times this ability has resolved this turn.\nEquip {1}' }),
  makeCard({ name: 'Nurturer Lite', type_line: 'Creature — Elf Druid', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: "When this creature enters, return up to one other target permanent you control to its owner's hand. If you do, put a +1/+1 counter on this creature." }),
  makeCard({ name: 'Manifestation Lite', type_line: 'Creature — Horror', mana_cost: '{0}', power: '0', toughness: '4', oracle_text: 'Defender\nThis creature gets +1/+0 for each card with cycling in your graveyard.' }),
  makeCard({ name: 'Verazol Lite', type_line: 'Legendary Creature — Serpent', mana_cost: '{X}{G}{U}', power: '0', toughness: '0', oracle_text: 'Verazol Lite enters with a +1/+1 counter on it for each mana spent to cast it.' }),
  makeCard({ name: 'Kami Lite', type_line: 'Creature — Spirit', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: "{4}{B}: Each opponent loses 2 life and you gain 2 life. This ability costs {4}{B} less to activate if you've drawn three or more cards this turn. Activate only once each turn." }),
  makeCard({ name: 'Divination Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw three cards.' }),
  makeCard({ name: 'Paladin Lite', type_line: 'Creature — Human Knight', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: "As long as you've put one or more +1/+1 counters on a creature this turn, this creature has trample and lifelink." }),
  makeCard({ name: 'Trumpeter Lite', type_line: 'Creature — Goblin Performer', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'At the beginning of each end step, if a +1/+1 counter was put on a permanent under your control this turn, put a +1/+1 counter on this creature.' }),
  makeCard({ name: 'Counter Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Put a +1/+1 counter on target creature.' }),
  makeCard({ name: 'Stitcher Lite', type_line: 'Creature — Zombie Rogue', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: "When this creature enters, create a 2/2 blue and black Zombie Rogue creature token, then put two +1/+1 counters on that token for each spell you've cast this turn other than the first." }),
  makeCard({ name: 'Mindsparker Lite', type_line: 'Creature — Elemental', mana_cost: '{0}', power: '3', toughness: '2', oracle_text: 'Whenever an opponent casts a white or blue instant or sorcery spell, this creature deals 2 damage to that player.' }),
  makeCard({ name: 'Blue Draw', type_line: 'Sorcery', mana_cost: '{U}', oracle_text: 'Draw a card.' }),
  makeCard({ name: 'Blue Bear', type_line: 'Creature — Bear', mana_cost: '{U}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Stage Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Draw a card.\nAt the beginning of each upkeep, if an opponent was dealt noncombat damage last turn, return this card from your graveyard to your hand.' }),
  makeCard({ name: 'Riftwurm Lite', type_line: 'Creature — Wurm', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: 'Kicker {0}\nVanishing 2\nIf this creature was kicked, it enters with three additional time counters on it.' }),
  makeCard({ name: 'Fowlknight Lite', type_line: 'Creature — Kithkin Knight', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'When this creature enters, creatures you control get +1/+0 until end of turn. Kithkin creatures you control also gain first strike until end of turn.' }),
  makeCard({ name: 'Aggression Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target creature you control fights target creature an opponent controls. If the creature an opponent controls would die this turn, exile it instead.' }),
  makeCard({ name: 'Repopulate Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Shuffle all creature cards from target player's graveyard into that player's library." }),
  makeCard({ name: 'Mongrel Lite', type_line: 'Creature — Dog', mana_cost: '{0}', power: '3', toughness: '1', oracle_text: 'When this creature dies during combat, create four 1/1 green Dog creature tokens.' }),
  makeCard({ name: 'Flesh Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Exile target creature card from a graveyard. Put X +1/+1 counters on target creature, where X is the power of the card you exiled.' }),
  makeCard({ name: 'Ordeal Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: 'Enchant creature\nWhenever enchanted creature attacks, put a +1/+1 counter on it. Then if it has three or more +1/+1 counters on it, sacrifice this Aura.\nWhen you sacrifice this Aura, it deals 3 damage to any target.' }),
  makeCard({ name: 'Eviction Lite', type_line: 'Instant', mana_cost: '{2}', oracle_text: "This spell costs {2} less to cast if you control at least two creatures that share a creature type.\nPut target nonland permanent into its owner's library second from the top." }),
  makeCard({ name: 'Warchief Lite', type_line: 'Creature — Illusion', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: 'Creature spells you cast that share a creature type with this creature cost {1} less to cast.' }),
  makeCard({ name: 'Illusion Lite', type_line: 'Creature — Illusion', mana_cost: '{1}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Second Chance Lite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'At the beginning of your upkeep, if you have 5 or less life, sacrifice this enchantment and take an extra turn after this one.' }),
  makeCard({ name: 'Dragons Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each player other than target player creates a 5/5 red Dragon creature token with flying.' }),
  makeCard({ name: 'Argument Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Argument Lite deals 6 damage to target creature. You may exile a card from your graveyard. If you do, Argument Lite also deals 2 damage to that creature's controller." }),
  makeCard({ name: 'Dust Lite', type_line: 'Creature — Elemental', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: "Flash\nFlying; fear\nWhen this creature enters, return three creatures you control to their owner's hand." }),
  makeCard({ name: 'Prophesied Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Destroy target creature. If it wasn't attacking, its controller draws a card." }),
  makeCard({ name: 'Approach Lite', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: "Enchant creature\nEnchanted creature gets -X/-X, where X is the number of creature cards in its controller's graveyard." }),
  makeCard({ name: 'Serpent Lite', type_line: 'Creature — Serpent', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: "This creature can't be blocked as long as defending player controls an artifact." }),
  makeCard({ name: 'Gorilla Lite', type_line: 'Creature — Ape', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'This creature gets +4/+4 as long as there are no cards in your graveyard.' }),
  makeCard({ name: 'Betrayers Lite', type_line: 'Creature — Elf Warrior', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'This creature has infect as long as an opponent is poisoned.' }),
  makeCard({ name: 'Rimestag Lite', type_line: 'Creature — Elk', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'This creature gets +2/+2 as long as you had another creature enter the battlefield under your control this turn.' }),
  makeCard({ name: 'Exemplar Lite', type_line: 'Artifact Creature — Golem', mana_cost: '{2}', power: '1', toughness: '1', oracle_text: 'This creature enters with two +1/+1 counters on it unless two or more colors of mana were spent to cast it.' }),
  makeCard({ name: 'Commando Lite', type_line: 'Creature — Centaur Mercenary', mana_cost: '{1}', power: '3', toughness: '3', oracle_text: "This creature enters with two +1/+1 counters on it if it wasn't cast or no mana was spent to cast it." }),
  makeCard({ name: 'Reanimate Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Return target creature card from your graveyard to the battlefield.' }),
  makeCard({ name: 'Eruption Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Sacrifice all creatures you control, then create that many 4/4 red Hellion creature tokens.' }),
  makeCard({ name: 'Patrol Lite', type_line: 'Creature — Elf Warrior', mana_cost: '{0}', power: '3', toughness: '2', oracle_text: 'Kinship — At the beginning of your upkeep, you may look at the top card of your library. If it shares a creature type with this creature, you may reveal it. If you do, put a +1/+1 counter on this creature.' }),
  makeCard({ name: 'Elf Cub', type_line: 'Creature — Elf', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Edifice Lite', type_line: 'Artifact Creature — Phyrexian Construct', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: 'When this creature enters, you may pay 2 life. When you do, target creature gets -1/-1 until end of turn.' }),
  makeCard({ name: 'Snake Lite', type_line: 'Creature — Snake', mana_cost: '{0}', power: '4', toughness: '4', keywords: ['Tribute'], oracle_text: "Tribute 3 (As this creature enters, an opponent of your choice may put three +1/+1 counters on it.)\nWhen this creature enters, if tribute wasn't paid, you gain 4 life." } as never),
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
const sacrifice = (who: string, objects: string[]) => (x: GameState) => (x.pending?.kind === 'sacrifice' && x.pending.player === who ? act(x, { type: 'choose', player: who, answer: { kind: 'sacrifice', objects } }) : null);
const pick = (who: string, objects: string[]) => (x: GameState) => (x.pending?.kind === 'choose_objects' && x.pending.player === who ? act(x, { type: 'choose', player: who, answer: { kind: 'choose_objects', objects } }) : null);

describe('staples (slice 269)', () => {
  it('Conch Horn, Skullcap Snail, Ruthless Negotiation', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const conch = give(g, 'alice', 'Conch Lite', 'battlefield');
    g = act(g, { type: 'activate', player: 'alice', object: conch, ability: 0 });
    g = settle(g);
    const back = g.zones.hand.alice![0]!;
    g = drive(g, pick('alice', [back]));
    expect([g.zones.library.alice![0], g.objects[conch]!.zone]).toEqual([back, 'graveyard']);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const theirs = h.zones.hand.bob![2]!;
    h = act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Snail Lite', 'hand') });
    h = drive(h, (x) => (x.pending?.kind === 'trigger_targets' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } }) : pick('bob', [theirs])(x)));
    expect(h.objects[theirs]!.zone).toBe('exile');

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const neg = give(k, 'alice', 'Negotiation Lite', 'graveyard');
    const hand = k.zones.hand.alice!.length;
    k = act(k, { type: 'cast', player: 'alice', object: neg, targets: [[{ kind: 'player', player: 'bob' }]] });
    k = drive(k, pick('bob', [k.zones.hand.bob![0]!]));
    expect([k.zones.hand.alice!.length - hand, k.zones.exile.filter((id) => k.objects[id]!.owner === 'bob').length]).toEqual([1, 1]);
  });

  it('Unified Will, Rishadan Cutpurse, Sigil Captain', () => {
    // Unified Will, cast as a response to Bolt.
    for (const more of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
      give(g, 'alice', 'Cub', 'battlefield');
      give(g, 'bob', 'Cub', 'battlefield');
      if (more) give(g, 'alice', 'Ogre', 'battlefield');
      const bolt = give(g, 'bob', 'Bolt', 'hand');
      g = act(g, { type: 'cast', player: 'bob', object: bolt, targets: [[{ kind: 'player', player: 'alice' }]] });
      g = act(g, { type: 'pass', player: 'bob' });
      const life = g.players.alice!.life;
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Unified Lite', 'hand'), targets: [[{ kind: 'object', object: bolt }]] }));
      expect(life - g.players.alice!.life).toBe(more ? 0 : 3);
    }

    for (const pay of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const cub = give(g, 'bob', 'Cub', 'battlefield');
      const forest = give(g, 'bob', 'Forest', 'battlefield');
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Cutpurse Lite', 'hand') });
      g = drive(g, (x) => (x.pending?.kind === 'pay' ? act(x, { type: 'choose', player: 'bob', answer: { kind: 'pay', pay } }) : x.pending?.kind === 'sacrifice' ? act(x, { type: 'choose', player: 'bob', answer: { kind: 'sacrifice', objects: [cub] } }) : null));
      expect([g.objects[cub]!.zone, g.objects[forest]!.tapped]).toEqual(pay ? ['battlefield', true] : ['graveyard', false]);
    }

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(k, 'alice', 'Sigil Lite', 'battlefield');
    const [cub, ogre] = [give(k, 'alice', 'Cub', 'hand'), give(k, 'alice', 'Ogre', 'hand')];
    k = settle(act(k, { type: 'cast', player: 'alice', object: cub }));
    k = settle(act(k, { type: 'cast', player: 'alice', object: ogre }));
    expect([k.objects[cub]!.counters['+1/+1'], k.objects[ogre]!.counters['+1/+1']]).toEqual([2, undefined]);
  });
});

describe('staples (slice 269, part 2)', () => {
  it('Barbed Sextant, Vigor Mortis, First Response', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const sextant = give(g, 'alice', 'Sextant Lite', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: sextant, ability: 0, choice: 'G' });
    expect([g.objects[sextant]!.zone, g.stack.length, g.delayed.length]).toEqual(['graveyard', 0, 1]);
    const hand = g.zones.hand.alice!.length;
    g = toStep(g, 'main1', 'bob');
    expect(g.zones.hand.alice!.length).toBe(hand + 1);

    for (const green of [true, false]) {
      let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
      give(h, 'alice', green ? 'Forest' : 'Island', 'battlefield');
      const dead = give(h, 'alice', 'Cub', 'graveyard');
      h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Vigor Lite', 'hand'), targets: [[{ kind: 'object', object: dead }]], autoTap: true } as never));
      expect([h.objects[dead]!.zone, h.objects[dead]!.counters['+1/+1']]).toEqual(['battlefield', green ? 1 : undefined]);
    }

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(k, 'alice', 'Response Lite', 'battlefield');
    const soldiers = (x: GameState) => x.zones.battlefield.filter((id) => x.objects[id]!.controller === 'alice' && chars(x, x.objects[id]!).subtypes.includes('Soldier')).length;
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] }));
    k = toStep(k, 'draw', 'bob');
    expect(soldiers(k)).toBe(1);
    k = toStep(k, 'draw', 'alice');
    expect(soldiers(k)).toBe(1);
  });

  it('detain (Azorius Arrester), Ent-Draught Basin', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [ogre, pinger] = [give(g, 'bob', 'Ogre', 'battlefield'), give(g, 'bob', 'Pinger Lite', 'battlefield')];
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Arrester Lite', 'hand') });
    g = drive(g, (x) => (x.pending?.kind === 'trigger_targets' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: pinger }]] } }) : null));
    g = toStep(g, 'main1', 'bob');
    expect(illegal(g, { type: 'activate', player: 'bob', object: pinger, ability: 0, targets: [[{ kind: 'player', player: 'alice' }]] })).toBeTruthy();
    g = toAttack(toStep(g, 'beginning_of_combat', 'bob'));
    expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: pinger, target: { kind: 'player', player: 'alice' } }] } })).toBeTruthy();
    void ogre;
    g = toStep(g, 'upkeep', 'alice');
    g = act(g, { type: 'pass', player: 'alice' });
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'activate', player: 'bob', object: pinger, ability: 0, targets: [[{ kind: 'player', player: 'alice' }]] }));
    expect(life - g.players.alice!.life).toBe(1);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const basin = give(h, 'alice', 'Basin Lite', 'battlefield');
    const [cub, ogre2] = [give(h, 'alice', 'Cub', 'battlefield'), give(h, 'alice', 'Ogre', 'battlefield')];
    give(h, 'alice', 'Forest', 'battlefield');
    expect(illegal(h, { type: 'activate', player: 'alice', object: basin, ability: 0, x: 1, autoTap: true, targets: [[{ kind: 'object', object: ogre2 }]] } as never)).toBeTruthy();
    h = settle(act(h, { type: 'activate', player: 'alice', object: basin, ability: 0, x: 1, autoTap: true, targets: [[{ kind: 'object', object: cub }]] } as never));
    expect(h.objects[cub]!.counters['+1/+1']).toBe(1);
  });

  it('Torment of Venom, Foul Renewal, Enslaved Horror', () => {
    for (const choice of ['sacrifice', 'discard', 'neither'] as const) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const [ogre, cub] = [give(g, 'bob', 'Ogre', 'battlefield'), give(g, 'bob', 'Cub', 'battlefield')];
      const [life, hand] = [g.players.bob!.life, g.zones.hand.bob!.length];
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Venom Lite', 'hand'), targets: [[{ kind: 'object', object: ogre }]] });
      g = drive(g, (x) => {
        const p = x.pending as { kind: string; options?: string[]; candidates?: string[] } | undefined;
        if (p?.kind === 'choose_option') return act(x, { type: 'choose', player: 'bob', answer: { kind: 'choose_option', choice: p.options!.find((o) => (choice === 'neither' ? /^Neither/.test(o) : choice === 'sacrifice' ? /sacrifice/i.test(o) && !/^Neither/.test(o) : /discard/i.test(o) && !/^Neither/.test(o)))! } });
        if (p?.kind === 'sacrifice') {
          expect(p.candidates).not.toContain(ogre);
          return act(x, { type: 'choose', player: 'bob', answer: { kind: 'sacrifice', objects: [cub] } });
        }
        if (p?.kind === 'discard' || p?.kind === 'choose_objects') return act(x, { type: 'choose', player: 'bob', answer: { kind: p.kind, objects: [x.zones.hand.bob![0]!] } as never });
        return null;
      });
      expect([life - g.players.bob!.life, g.objects[cub]!.zone, hand - g.zones.hand.bob!.length]).toEqual(choice === 'neither' ? [3, 'battlefield', 0] : choice === 'sacrifice' ? [0, 'graveyard', 0] : [0, 'battlefield', 1]);
    }

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [dead, ogre] = [give(h, 'alice', 'Ogre', 'graveyard'), give(h, 'bob', 'Ogre', 'battlefield')];
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Renewal Lite', 'hand'), targets: [[{ kind: 'object', object: dead }], [{ kind: 'object', object: ogre }]] }));
    expect([h.objects[dead]!.zone, h.objects[ogre]!.zone]).toEqual(['hand', 'graveyard']);

    let k = toStep(start({ players: 3, extra: CARDS }), 'main1', 'alice');
    const [b, c, a] = [give(k, 'bob', 'Ogre', 'graveyard'), give(k, 'carol', 'Cub', 'graveyard'), give(k, 'alice', 'Cub', 'graveyard')];
    k = act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Horror Lite', 'hand') });
    k = drive(k, (x) => {
      const p = x.pending as { kind: string; player: string } | undefined;
      if (p?.kind === 'may') return act(x, { type: 'choose', player: p.player, answer: { kind: 'may', yes: p.player === 'bob' } });
      if (p?.kind === 'choose_objects') return act(x, { type: 'choose', player: p.player, answer: { kind: 'choose_objects', objects: [p.player === 'bob' ? b : c] } });
      return null;
    });
    expect([k.objects[b]!.zone, k.objects[b]!.controller, k.objects[c]!.zone, k.objects[a]!.zone]).toEqual(['battlefield', 'bob', 'graveyard', 'graveyard']);
  });
});

describe('staples (slice 269, part 3)', () => {
  it('Meanders Guide, Mine Worker, Last Stand', () => {
    for (const tap of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const [guide, fish] = [give(g, 'alice', 'Guide Lite', 'battlefield'), give(g, 'alice', 'Merfolk Lite', 'battlefield')];
      const dead = give(g, 'alice', 'Cub', 'graveyard');
      g = attackWith(g, [guide]);
      g = drive(g, (x) => {
        const p = x.pending as { kind: string } | undefined;
        if (p?.kind === 'may') return act(x, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: tap } });
        if (p?.kind === 'choose_objects') return act(x, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [fish] } });
        if (p?.kind === 'trigger_targets') return act(x, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: dead }]] } });
        return null;
      });
      expect([g.objects[fish]!.tapped, g.objects[dead]!.zone]).toEqual(tap ? [true, 'battlefield'] : [false, 'graveyard']);
    }

    for (const both of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const worker = give(g, 'alice', 'Worker Lite', 'battlefield');
      give(g, 'alice', 'Plant Lite', 'battlefield');
      if (both) give(g, 'alice', 'Tower Lite', 'battlefield');
      const life = g.players.alice!.life;
      g = settle(act(g, { type: 'activate', player: 'alice', object: worker, ability: 0 }));
      expect(g.players.alice!.life - life).toBe(both ? 3 : 1);
    }

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (const land of ['Swamp', 'Mountain', 'Forest', 'Plains', 'Island']) give(k, 'alice', land, 'battlefield');
    const ogre = give(k, 'bob', 'Ogre', 'battlefield');
    const [a, b, hand] = [k.players.alice!.life, k.players.bob!.life, k.zones.hand.alice!.length];
    k = act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Last Stand Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }], [{ kind: 'object', object: ogre }]] });
    k = drive(k, (x) => (x.pending?.kind === 'discard' || x.pending?.kind === 'choose_objects' ? act(x, { type: 'choose', player: 'alice', answer: { kind: x.pending.kind, objects: [x.zones.hand.alice![0]!] } as never }) : null));
    const saprolings = k.zones.battlefield.filter((id) => chars(k, k.objects[id]!).subtypes.includes('Saproling')).length;
    expect([b - k.players.bob!.life, k.objects[ogre]!.damage, saprolings, k.players.alice!.life - a, k.zones.hand.alice!.length - hand]).toEqual([2, 1, 1, 2, 0]);
  });

  it('Ruin Processor, Void Attendant, Processor Assault', () => {
    for (const yes of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const exiled = give(g, 'bob', 'Cub', 'exile');
      give(g, 'alice', 'Ogre', 'exile');
      const life = g.players.alice!.life;
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Processor Lite', 'hand') });
      g = drive(g, (x) => (x.pending?.kind === 'may' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'may', yes } }) : null));
      expect([g.objects[exiled]!.zone, g.players.alice!.life - life]).toEqual(yes ? ['graveyard', 5] : ['exile', 0]);
    }
    // Nothing of an opponent's in exile: no choice to make.
    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(h, 'alice', 'Ogre', 'exile');
    const life = h.players.alice!.life;
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Processor Lite', 'hand') }));
    expect([h.pending, h.players.alice!.life]).toEqual([null, life]);

    let k = toStep(start({ players: 3, extra: CARDS }), 'main1', 'alice');
    const attendant = give(k, 'alice', 'Attendant Lite', 'battlefield');
    const mine = give(k, 'alice', 'Cub', 'exile');
    expect(illegal(k, { type: 'activate', player: 'alice', object: attendant, ability: 0, costs: { processed: [mine] } } as never)).toBeTruthy();
    const [x1, x2] = [give(k, 'bob', 'Cub', 'exile'), give(k, 'carol', 'Ogre', 'exile')];
    const hand = k.zones.hand.alice!.length;
    k = settle(act(k, { type: 'activate', player: 'alice', object: attendant, ability: 0, costs: { processed: [x2] } } as never));
    expect([k.objects[x2]!.zone, k.zones.graveyard.carol!.includes(x2), k.objects[x1]!.zone, k.zones.hand.alice!.length - hand]).toEqual(['graveyard', true, 'exile', 1]);

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(m, 'bob', 'Ogre', 'battlefield');
    const assault = give(m, 'alice', 'Assault Lite', 'hand');
    expect(illegal(m, { type: 'cast', player: 'alice', object: assault, targets: [[{ kind: 'object', object: ogre }]] })).toBeTruthy();
    const x3 = give(m, 'bob', 'Cub', 'exile');
    m = settle(act(m, { type: 'cast', player: 'alice', object: assault, targets: [[{ kind: 'object', object: ogre }]], costs: { processed: [x3] } } as never));
    expect([m.objects[x3]!.zone, m.objects[ogre]!.zone]).toEqual(['graveyard', 'graveyard']);
  });
});

describe('staples (slice 269, part 4)', () => {
  it("Priest of the Wakening Sun, Zephyr Sentinel, Liliana's Indignation", () => {
    for (const dino of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
      give(g, 'alice', 'Priest Lite', 'battlefield');
      const card = give(g, 'alice', dino ? 'Dino Lite' : 'Cub', 'hand');
      const life = g.players.alice!.life;
      g = toStep(g, 'upkeep', 'alice');
      g = drive(g, (x) => (x.pending?.kind === 'may' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }) : null));
      expect([g.players.alice!.life - life, g.objects[card]!.zone]).toEqual([dino ? 2 : 0, 'hand']);
    }

    for (const who of ['Soldier Cub', 'Cub', null] as const) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const back = who ? give(g, 'alice', who, 'battlefield') : null;
      const zephyr = give(g, 'alice', 'Zephyr Lite', 'hand');
      g = act(g, { type: 'cast', player: 'alice', object: zephyr });
      g = drive(g, (x) => (x.pending?.kind === 'trigger_targets' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [back ? [{ kind: 'object', object: back }] : []] } }) : null));
      expect([back ? g.objects[back]!.zone : 'hand', g.objects[zephyr]!.counters['+1/+1']]).toEqual(['hand', who === 'Soldier Cub' ? 1 : undefined]);
    }

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const top = [give(k, 'alice', 'Cub', 'library'), give(k, 'alice', 'Forest', 'library'), give(k, 'alice', 'Ogre', 'library')];
    k.zones.library.alice = [...top, ...k.zones.library.alice!.filter((id) => !top.includes(id))];
    for (let i = 0; i < 3; i++) give(k, 'alice', 'Forest', 'battlefield');
    const life = k.players.bob!.life;
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Indignation Lite', 'hand'), x: 3, autoTap: true, targets: [[{ kind: 'player', player: 'bob' }]] } as never));
    expect(life - k.players.bob!.life).toBe(4);
  });

  it("Warchanter Skald, Nissa's Chosen, Misinformation", () => {
    for (const equipped of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const skald = give(g, 'alice', 'Skald Lite', 'battlefield');
      if (equipped) {
        const sword = give(g, 'alice', 'Heavy Sword', 'battlefield');
        g.objects[sword]!.attachedTo = { id: skald, zcc: g.objects[skald]!.zcc };
      }
      g = attackWith(g, [skald]);
      g = settle(g);
      const dwarves = g.zones.battlefield.filter((id) => id !== skald && chars(g, g.objects[id]!).subtypes.includes('Dwarf')).length;
      expect(dwarves).toBe(equipped ? 1 : 0);
    }

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const chosen = give(h, 'bob', 'Chosen Lite', 'battlefield');
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: chosen }]] }));
    const lib = h.zones.library.bob!;
    expect([h.objects[chosen]!.zone, lib[lib.length - 1]]).toEqual(['library', chosen]);

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cards = [give(k, 'bob', 'Cub', 'graveyard'), give(k, 'bob', 'Ogre', 'graveyard')];
    k = act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Misinformation Lite', 'hand'), targets: [cards.map((object) => ({ kind: 'object' as const, object }))] });
    k = drive(k, pick('alice', [cards[1]!, cards[0]!]));
    expect(k.zones.library.bob!.slice(0, 2)).toEqual([cards[1], cards[0]]);
  });

  it('Mind Shatter, Dream Salvage, Twinned Vision', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (let i = 0; i < 2; i++) give(g, 'alice', 'Forest', 'battlefield');
    const hand = g.zones.hand.bob!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Shatter Lite', 'hand'), x: 2, autoTap: true, targets: [[{ kind: 'player', player: 'bob' }]] } as never));
    expect(hand - g.zones.hand.bob!.length).toBe(2);
    const mine = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Salvage Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.zones.hand.alice!.length - mine).toBe(2);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const n0 = h.zones.hand.alice!.length;
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Twinned Lite', 'hand') }));
    const n1 = h.zones.hand.alice!.length;
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Twinned Lite', 'graveyard') }));
    expect([n1 - n0, h.zones.hand.alice!.length - n1]).toEqual([1, 2]);
  });
});

describe('staples (slice 269, part 5)', () => {
  it("Cauldron's Gift, Powerstone Minefield, Relic Axe", () => {
    for (const yes of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const dead = give(g, 'alice', 'Ogre', 'graveyard');
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Gift Lite', 'hand') });
      g = drive(g, pick('alice', yes ? [dead] : []));
      expect([g.objects[dead]!.zone, g.objects[dead]!.counters['+1/+1']]).toEqual(yes ? ['battlefield', 1] : ['graveyard', undefined]);
    }

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(h, 'bob', 'Minefield Lite', 'battlefield');
    const [ogre, blocker] = [give(h, 'alice', 'Ogre', 'battlefield'), give(h, 'bob', 'Ogre', 'battlefield')];
    h = attackWith(h, [ogre]);
    h = settle(h);
    expect(h.objects[ogre]!.damage).toBe(2);
    for (let i = 0; i < 20 && h.pending?.kind !== 'declare_blockers'; i++) h = act(h, { type: 'pass', player: h.priority! });
    h = settle(act(h, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker, attacker: ogre }] } } as never));
    expect([h.objects[blocker]!.damage, h.objects[ogre]!.zone]).toEqual([2, 'battlefield']);

    for (const [who, pt] of [['Warrior Cub', [3, 2]], ['Cub', [2, 2]]] as const) {
      const k = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const [c, axe] = [give(k, 'alice', who, 'battlefield'), give(k, 'alice', 'Axe Lite', 'battlefield')];
      k.objects[axe]!.attachedTo = { id: c, zcc: k.objects[c]!.zcc };
      const ch = chars(k, k.objects[c]!);
      expect([ch.power, ch.toughness]).toEqual(pt);
    }
  });

  it('Traumatic Revelation, Favored Hoplite, Shard Convergence', () => {
    for (const has of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const ogre = has ? give(g, 'bob', 'Ogre', 'hand') : null;
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Revelation Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] });
      g = drive(g, pick('alice', ogre ? [ogre] : []));
      const incubators = g.zones.battlefield.filter((id) => chars(g, g.objects[id]!).subtypes.includes('Incubator')).length;
      expect([ogre ? g.objects[ogre]!.zone : 'graveyard', incubators]).toEqual(['graveyard', has ? 0 : 1]);
    }

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const hop = give(h, 'alice', 'Hoplite Lite', 'battlefield');
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: hop }]] }));
    expect([h.objects[hop]!.zone, h.objects[hop]!.counters['+1/+1'], h.objects[hop]!.damage]).toEqual(['battlefield', 1, 0]);

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lands = ['Plains', 'Island', 'Swamp', 'Mountain'].map((n) => give(k, 'alice', n, 'library'));
    give(k, 'alice', 'Plains', 'library');
    k = act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Convergence Lite', 'hand') });
    k = settle(k);
    expect(k.pending?.kind).toBe('search');
    const twoPlains = [lands[0]!, k.zones.library.alice!.find((id) => k.objects[id]!.card === 'Plains' && id !== lands[0])!];
    expect(illegal(k, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: twoPlains } } as never)).toBeTruthy();
    k = act(k, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: lands } } as never);
    expect(lands.every((id) => k.objects[id]!.zone === 'hand')).toBe(true);
  });

  it('Fear of Falling, Spellpyre Phoenix, Charging Cinderhorn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [fear, flyer] = [give(g, 'alice', 'Falling Lite', 'battlefield'), give(g, 'bob', 'Flyer', 'battlefield')];
    g = attackWith(g, [fear]);
    g = drive(g, (x) => (x.pending?.kind === 'trigger_targets' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: flyer }]] } }) : null));
    g = toStep(g, 'main1', 'bob');
    const c = chars(g, g.objects[flyer]!);
    expect([c.power, c.keywords.some((k) => k.id === 'flying')]).toEqual([1, false]);
    g = toStep(g, 'main1', 'alice');
    expect(chars(g, g.objects[flyer]!).power).toBe(3);

    for (const n of [2, 1]) {
      let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const phoenix = give(h, 'alice', 'Phoenix Lite', 'graveyard');
      for (let i = 0; i < n; i++) h = settle(act(h, { type: 'activate', player: 'alice', object: give(h, 'alice', 'Cycler Lite', 'hand'), ability: 0 }));
      h = toStep(h, 'end', 'alice');
      h = settle(h);
      expect(h.objects[phoenix]!.zone).toBe(n === 2 ? 'hand' : 'graveyard');
    }

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const horn = give(k, 'bob', 'Cinderhorn Lite', 'battlefield');
    const life = k.players.alice!.life;
    k = settle(toStep(k, 'end', 'alice'));
    expect([k.objects[horn]!.counters.fury, life - k.players.alice!.life]).toEqual([1, 1]);
    const cub = give(k, 'bob', 'Cub', 'battlefield', { sick: false });
    k = toStep(k, 'main1', 'bob');
    k = attackWith(k, [cub], 'alice', 'bob');
    k = settle(toStep(k, 'end', 'bob'));
    expect(k.objects[horn]!.counters.fury).toBe(1);
  });

  it("Urgoros, Dragon Whelp, Null Profusion, Relic's Roar", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const urg = give(g, 'alice', 'Urgoros Lite', 'battlefield');
    g.zones.hand.bob = [];
    const hand = g.zones.hand.alice!.length;
    g = attackWith(g, [urg]);
    for (let i = 0; i < 30 && g.step !== 'main2'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } } as never);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.zones.hand.alice!.length - hand).toBe(1);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const whelp = give(h, 'alice', 'Whelp Lite', 'battlefield');
    for (let i = 0; i < 3; i++) h = settle(act(h, { type: 'activate', player: 'alice', object: whelp, ability: 0 }));
    expect(h.delayed.length).toBe(0);
    h = settle(act(h, { type: 'activate', player: 'alice', object: whelp, ability: 0 }));
    expect([chars(h, h.objects[whelp]!).power, h.delayed.length]).toEqual([6, 1]);
    h = settle(toStep(h, 'end', 'alice'));
    expect(h.objects[whelp]!.zone).toBe('graveyard');

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(k, 'alice', 'Profusion Lite', 'battlefield');
    const n0 = k.zones.hand.alice!.length;
    k = settle(act(k, { type: 'play_land', player: 'alice', object: give(k, 'alice', 'Forest', 'hand') }));
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Cub', 'hand') }));
    expect(k.zones.hand.alice!.length - n0).toBe(2);

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const sword = give(m, 'alice', 'Heavy Sword', 'battlefield');
    m = settle(act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Roar Lite', 'hand'), targets: [[{ kind: 'object', object: sword }]] }));
    const c = chars(m, m.objects[sword]!);
    expect([c.types, c.subtypes.includes('Dinosaur'), c.subtypes.includes('Equipment'), c.power, c.toughness]).toEqual([['Artifact', 'Creature'], true, true, 4, 3]);
  });
});

describe('staples (slice 269, part 6): mana abilities with delayed triggers', () => {
  it('Brass Infiniscope, Chocobo Camp, Ether', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const scope = give(g, 'alice', 'Infiniscope Lite', 'battlefield');
    give(g, 'alice', 'Forest', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: scope, ability: 0 });
    const [hand, life] = [g.zones.hand.alice!.length, g.players.alice!.life];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'X Burn', 'hand'), x: 3, autoTap: true, targets: [[{ kind: 'player', player: 'bob' }]] } as never));
    expect([g.zones.hand.alice!.length - hand, g.players.alice!.life - life, g.players.bob!.life]).toEqual([1, 1, 17]);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const camp = give(h, 'alice', 'Camp Lite', 'battlefield');
    h = act(h, { type: 'activate_mana', player: 'alice', object: camp, ability: 0 });
    const bird = give(h, 'alice', 'Bird Lite', 'hand');
    h = settle(act(h, { type: 'cast', player: 'alice', object: bird }));
    expect(h.objects[bird]!.counters['+1/+1']).toBe(1);

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ether = give(k, 'alice', 'Ether Lite', 'battlefield');
    k = act(k, { type: 'activate_mana', player: 'alice', object: ether, ability: 0 });
    const life2 = k.players.bob!.life;
    k = act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Shock Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] });
    k = drive(k, (x) => (x.pending?.kind === 'may' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: false } }) : x.pending?.kind === 'copy_targets' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'copy_targets' } } as never) : null));
    expect([k.objects[ether]!.zone, life2 - k.players.bob!.life]).toEqual(['exile', 4]);
  });

  it('Solar Array, Rainbow Vale', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const array = give(g, 'alice', 'Array Lite', 'battlefield');
    give(g, 'alice', 'Island', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: array, ability: 0, choice: 'G' });
    const golem = give(g, 'alice', 'Golem Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: golem, autoTap: true } as never));
    expect([g.objects[golem]!.zone, g.objects[golem]!.counters['+1/+1']]).toEqual(['battlefield', 2]);

    let p = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const priest = give(p, 'alice', 'Priest of Mana Lite', 'battlefield');
    for (let i = 0; i < 4; i++) give(p, 'alice', 'Forest', 'battlefield');
    for (const f of p.zones.battlefield.filter((id) => p.objects[id]!.card === 'Forest')) p = act(p, { type: 'activate_mana', player: 'alice', object: f, ability: 0 });
    for (let i = 0; i < 3; i++) p = act(p, { type: 'activate_mana', player: 'alice', object: priest, ability: 0 });
    expect(p.delayed.length).toBe(0);
    p = act(p, { type: 'activate_mana', player: 'alice', object: priest, ability: 0 });
    expect(p.delayed.length).toBe(1);
    p = settle(toStep(p, 'end', 'alice'));
    expect(p.objects[priest]!.zone).toBe('graveyard');

    for (const [who, gain] of [['Stone Human', 4], ['Soldier Cub', 2], ['Ogre', 0]] as const) {
      let c = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const t = give(c, 'bob', who, 'battlefield');
      const life = c.players.alice!.life;
      c = settle(act(c, { type: 'cast', player: 'alice', object: give(c, 'alice', 'Caress Lite', 'hand'), targets: [[{ kind: 'object', object: t }]] }));
      expect(c.players.alice!.life - life).toBe(gain);
    }

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const vale = give(h, 'alice', 'Vale Lite', 'battlefield');
    h = act(h, { type: 'activate_mana', player: 'alice', object: vale, ability: 0, choice: 'R' });
    h = settle(toStep(h, 'end', 'alice'));
    expect(h.objects[vale]!.controller).toBe('bob');
  });
});

describe('staples (slice 269, part 7)', () => {
  it('Sphinx of Lost Truths, Grip of Amnesia, Flamebreak', () => {
    for (const kicked of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const hand = g.zones.hand.alice!.length;
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Sphinx Lite', 'hand'), ...(kicked ? { kicked: true } : {}) } as never);
      g = drive(g, (x) => (x.pending?.kind === 'discard' || x.pending?.kind === 'choose_objects' ? act(x, { type: 'choose', player: 'alice', answer: { kind: x.pending.kind, objects: x.zones.hand.alice!.slice(0, 3) } as never }) : null));
      expect(g.zones.hand.alice!.length - hand).toBe(kicked ? 3 : 0);
    }

    for (const exile of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
      const yard = give(g, 'bob', 'Cub', 'graveyard');
      const bolt = give(g, 'bob', 'Bolt', 'hand');
      g = act(g, { type: 'cast', player: 'bob', object: bolt, targets: [[{ kind: 'player', player: 'alice' }]] });
      g = act(g, { type: 'pass', player: 'bob' });
      const life = g.players.alice!.life;
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Grip Lite', 'hand'), targets: [[{ kind: 'object', object: bolt }]] });
      g = drive(g, (x) => (x.pending?.kind === 'pay' ? act(x, { type: 'choose', player: 'bob', answer: { kind: 'pay', pay: exile } }) : null));
      expect([g.objects[yard]!.zone, life - g.players.alice!.life]).toEqual(exile ? ['exile', 3] : ['graveyard', 0]);
    }

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [cub, ogre, flyer] = [give(k, 'bob', 'Cub', 'battlefield'), give(k, 'bob', 'Ogre', 'battlefield'), give(k, 'bob', 'Flyer', 'battlefield')];
    const [a, b] = [k.players.alice!.life, k.players.bob!.life];
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Flamebreak Lite', 'hand') }));
    expect([k.objects[cub]!.zone, k.objects[ogre]!.zone, k.objects[flyer]!.damage, a - k.players.alice!.life, b - k.players.bob!.life]).toEqual(['graveyard', 'graveyard', 0, 3, 3]);
  });

  it('Biomantic Mastery, Bronze Cudgels, Mirkwood Nurturer, Vile Manifestation', () => {
    let g = toStep(start({ players: 3, extra: CARDS }), 'main1', 'alice');
    for (let i = 0; i < 2; i++) give(g, 'bob', 'Cub', 'battlefield');
    give(g, 'carol', 'Cub', 'battlefield');
    const mastery = give(g, 'alice', 'Mastery Lite', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: mastery, targets: [[{ kind: 'player', player: 'bob' }], [{ kind: 'player', player: 'bob' }]] })).toBeTruthy();
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: mastery, targets: [[{ kind: 'player', player: 'bob' }], [{ kind: 'player', player: 'carol' }]] }));
    expect(g.zones.hand.alice!.length - hand).toBe(2);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [cub, cudgels] = [give(h, 'alice', 'Cub', 'battlefield'), give(h, 'alice', 'Cudgels Lite', 'battlefield')];
    h.objects[cudgels]!.attachedTo = { id: cub, zcc: h.objects[cub]!.zcc };
    for (let i = 0; i < 3; i++) h = settle(act(h, { type: 'activate', player: 'alice', object: cudgels, ability: 0 }));
    expect(chars(h, h.objects[cub]!).power).toBe(1 + 1 + 2 + 3);

    for (const back of [true, false]) {
      let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const other = give(k, 'alice', 'Cub', 'battlefield');
      const nurt = give(k, 'alice', 'Nurturer Lite', 'hand');
      k = act(k, { type: 'cast', player: 'alice', object: nurt });
      k = drive(k, (x) => (x.pending?.kind === 'trigger_targets' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [back ? [{ kind: 'object', object: other }] : []] } }) : null));
      expect([k.objects[other]!.zone, k.objects[nurt]!.counters['+1/+1']]).toEqual(back ? ['hand', 1] : ['battlefield', undefined]);
    }

    const m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const vile = give(m, 'alice', 'Manifestation Lite', 'battlefield');
    give(m, 'alice', 'Cycler Lite', 'graveyard');
    give(m, 'alice', 'Cycler Lite', 'graveyard');
    give(m, 'alice', 'Cub', 'graveyard');
    expect(chars(m, m.objects[vile]!).power).toBe(2);
  });

  it('Verazol, Kami of Jealous Thirst, Sigardian Paladin, Fairgrounds Trumpeter, Outlaw Stitcher', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (let i = 0; i < 2; i++) give(g, 'alice', 'Forest', 'battlefield');
    for (let i = 0; i < 2; i++) give(g, 'alice', 'Island', 'battlefield');
    const vera = give(g, 'alice', 'Verazol Lite', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: vera, x: 2, autoTap: true } as never));
    expect(g.objects[vera]!.counters['+1/+1']).toBe(4);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const kami = give(h, 'alice', 'Kami Lite', 'battlefield', { sick: false });
    expect(illegal(h, { type: 'activate', player: 'alice', object: kami, ability: 0 })).toBeTruthy();
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Divination Lite', 'hand') }));
    const life = h.players.bob!.life;
    h = settle(act(h, { type: 'activate', player: 'alice', object: kami, ability: 0 }));
    expect(life - h.players.bob!.life).toBe(2);

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [paladin, trumpeter] = [give(k, 'alice', 'Paladin Lite', 'battlefield'), give(k, 'alice', 'Trumpeter Lite', 'battlefield')];
    const has = (x: GameState) => chars(x, x.objects[paladin]!).keywords.some((kw) => kw.id === 'lifelink');
    expect(has(k)).toBe(false);
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Counter Lite', 'hand'), targets: [[{ kind: 'object', object: give(k, 'bob', 'Cub', 'battlefield') }]] }));
    // On an opponent's creature: Alice put it there, but not on a permanent she controls.
    expect(has(k)).toBe(true);
    k = settle(toStep(k, 'end', 'alice'));
    expect(k.objects[trumpeter]!.counters['+1/+1']).toBeUndefined();
    k = toStep(k, 'main1', 'bob');
    expect(has(k)).toBe(false);
    k = toStep(k, 'main1', 'alice');
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Counter Lite', 'hand'), targets: [[{ kind: 'object', object: paladin }]] }));
    k = settle(toStep(k, 'end', 'alice'));
    expect(k.objects[trumpeter]!.counters['+1/+1']).toBe(1);

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (let i = 0; i < 2; i++) m = settle(act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Cub', 'hand') }));
    m = settle(act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Stitcher Lite', 'hand') }));
    const token = m.zones.battlefield.find((id) => m.objects[id]!.token && chars(m, m.objects[id]!).subtypes.includes('Rogue'))!;
    expect(m.objects[token]!.counters['+1/+1']).toBe(4);
  });
});

describe('staples (slice 269, part 8)', () => {
  it('Mindsparker, Command the Stage, Ravaging Riftwurm, Gallant Fowlknight', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Mindsparker Lite', 'battlefield');
    give(g, 'bob', 'Island', 'battlefield');
    give(g, 'bob', 'Island', 'battlefield');
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Blue Draw', 'hand'), autoTap: true } as never));
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Blue Bear', 'hand'), autoTap: true } as never));
    expect(life - g.players.bob!.life).toBe(2);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const stage = give(h, 'alice', 'Stage Lite', 'graveyard');
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    h = toStep(h, 'draw', 'bob');
    expect(h.objects[stage]!.zone).toBe('hand');
    moveObject(h, stage, 'graveyard', []);
    h = toStep(h, 'draw', 'alice');
    expect(h.objects[stage]!.zone).toBe('graveyard');

    for (const kicked of [true, false]) {
      let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const wurm = give(k, 'alice', 'Riftwurm Lite', 'hand');
      k = settle(act(k, { type: 'cast', player: 'alice', object: wurm, ...(kicked ? { kicked: true } : {}) } as never));
      expect(k.objects[wurm]!.counters.time).toBe(kicked ? 5 : 2);
    }

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const cub = give(m, 'alice', 'Cub', 'battlefield');
    const knight = give(m, 'alice', 'Fowlknight Lite', 'hand');
    m = settle(act(m, { type: 'cast', player: 'alice', object: knight }));
    const fs = (id: string) => chars(m, m.objects[id]!).keywords.some((kw) => kw.id === 'first_strike');
    expect([chars(m, m.objects[cub]!).power, fs(cub), fs(knight), chars(m, m.objects[knight]!).power]).toEqual([2, false, true, 3]);
  });

  it('Unnatural Aggression, Repopulate, Mongrel Pack, Flesh // Blood', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [ogre, cub] = [give(g, 'alice', 'Ogre', 'battlefield'), give(g, 'bob', 'Cub', 'battlefield')];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Aggression Lite', 'hand'), targets: [[{ kind: 'object', object: ogre }], [{ kind: 'object', object: cub }]] }));
    expect([g.objects[cub]!.zone, g.objects[ogre]!.zone]).toEqual(['exile', 'battlefield']);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [c1, c2, b1] = [give(h, 'bob', 'Cub', 'graveyard'), give(h, 'bob', 'Ogre', 'graveyard'), give(h, 'bob', 'Bolt', 'graveyard')];
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Repopulate Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect([h.objects[c1]!.zone, h.objects[c2]!.zone, h.objects[b1]!.zone]).toEqual(['library', 'library', 'graveyard']);

    for (const inCombat of [true, false]) {
      let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const pack = give(k, 'alice', 'Mongrel Lite', 'battlefield');
      if (inCombat) {
        const blocker = give(k, 'bob', 'Ogre', 'battlefield');
        k = attackWith(k, [pack]);
        for (let i = 0; i < 20 && k.pending?.kind !== 'declare_blockers'; i++) k = act(k, { type: 'pass', player: k.priority! });
        k = act(k, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker, attacker: pack }] } } as never);
        for (let i = 0; i < 30 && k.step !== 'main2'; i++) {
          if (k.pending?.kind === 'assign_combat_damage') {
            const p = k.pending as { player: string; choices: { attacker: string; suggested: unknown[] }[] };
            k = act(k, { type: 'choose', player: p.player, answer: { kind: 'assign_combat_damage', assignments: Object.fromEntries(p.choices.map((c) => [c.attacker, c.suggested])) } } as never);
          } else k = act(k, { type: 'pass', player: k.priority! });
        }
      } else k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Bolt', 'hand'), targets: [[{ kind: 'object', object: pack }]] }));
      const dogs = k.zones.battlefield.filter((id) => k.objects[id]!.token && chars(k, k.objects[id]!).subtypes.includes('Dog')).length;
      expect([k.objects[pack]!.zone, dogs]).toEqual(['graveyard', inCombat ? 4 : 0]);
    }

    let m = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [dead, mine] = [give(m, 'bob', 'Ogre', 'graveyard'), give(m, 'alice', 'Cub', 'battlefield')];
    m = settle(act(m, { type: 'cast', player: 'alice', object: give(m, 'alice', 'Flesh Lite', 'hand'), targets: [[{ kind: 'object', object: dead }], [{ kind: 'object', object: mine }]] }));
    expect([m.objects[dead]!.zone, m.objects[mine]!.counters['+1/+1']]).toEqual(['exile', 5]);
  });

  it('Ordeal of Purphoros, Synchronized Eviction, Mistform Warchief', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [cub, ordeal] = [give(g, 'alice', 'Cub', 'battlefield', { sick: false }), give(g, 'alice', 'Ordeal Lite', 'battlefield')];
    g.objects[ordeal]!.attachedTo = { id: cub, zcc: g.objects[cub]!.zcc };
    g.objects[cub]!.counters['+1/+1'] = 2;
    const target = give(g, 'bob', 'Ogre', 'battlefield');
    g = attackWith(g, [cub]);
    g = drive(g, (x) => (x.pending?.kind === 'trigger_targets' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: target }]] } }) : null));
    expect([g.objects[ordeal]!.zone, g.objects[target]!.zone]).toEqual(['graveyard', 'graveyard']);

    for (const two of [true, false]) {
      let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
      give(h, 'alice', 'Cub', 'battlefield');
      give(h, 'alice', two ? 'Cub' : 'Ogre', 'battlefield');
      const ogre = give(h, 'bob', 'Ogre', 'battlefield');
      const ev = give(h, 'alice', 'Eviction Lite', 'hand');
      if (!two) {
        expect(illegal(h, { type: 'cast', player: 'alice', object: ev, targets: [[{ kind: 'object', object: ogre }]] })).toBeTruthy();
        continue;
      }
      h = settle(act(h, { type: 'cast', player: 'alice', object: ev, targets: [[{ kind: 'object', object: ogre }]] }));
      expect(h.zones.library.bob![1]).toBe(ogre);
    }

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(k, 'alice', 'Warchief Lite', 'battlefield');
    const ill = give(k, 'alice', 'Illusion Lite', 'hand');
    expect(illegal(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Blue Bear', 'hand') })).toBeTruthy();
    k = settle(act(k, { type: 'cast', player: 'alice', object: ill }));
    expect(k.objects[ill]!.zone).toBe('battlefield');
  });
});

describe('staples (slice 269, part 9)', () => {
  it('Second Chance, Death by Dragons, Heated Argument', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const chance = give(g, 'alice', 'Second Chance Lite', 'battlefield');
    g.players.alice!.life = 5;
    g = toStep(g, 'main1', 'alice');
    expect(g.objects[chance]!.zone).toBe('graveyard');
    g = toStep(g, 'main1', 'bob');
    // Alice's extra turn came first.
    expect(g.players.alice!.turnsBegun).toBe(3);

    let h = toStep(start({ players: 3, extra: CARDS }), 'main1', 'alice');
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Dragons Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    const dragons = (p: string) => h.zones.battlefield.filter((id) => h.objects[id]!.controller === p && h.objects[id]!.token).length;
    expect([dragons('alice'), dragons('bob'), dragons('carol')]).toEqual([1, 0, 1]);

    for (const yes of [true, false]) {
      let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const ogre = give(k, 'bob', 'Ogre', 'battlefield');
      const card = give(k, 'alice', 'Cub', 'graveyard');
      const life = k.players.bob!.life;
      k = act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Argument Lite', 'hand'), targets: [[{ kind: 'object', object: ogre }]] });
      k = drive(k, (x) => (x.pending?.kind === 'may' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'may', yes } }) : pick('alice', [card])(x)));
      expect([k.objects[ogre]!.zone, k.objects[card]!.zone, life - k.players.bob!.life]).toEqual(yes ? ['graveyard', 'exile', 2] : ['graveyard', 'graveyard', 0]);
    }
  });

  it('Dust Elemental, Prophesied End', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mine = [give(g, 'alice', 'Cub', 'battlefield'), give(g, 'alice', 'Ogre', 'battlefield')];
    const dust = give(g, 'alice', 'Dust Lite', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: dust });
    g = drive(g, (x) => (x.pending?.kind === 'choose_objects' ? act(x, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: (x.pending as { candidates: string[] }).candidates.slice(0, 3) } }) : null));
    expect([...mine.map((id) => g.objects[id]!.zone), g.objects[dust]!.zone]).toEqual(['hand', 'hand', 'hand']);

    for (const attacking of [true, false]) {
      let h = toStep(start({ extra: CARDS }), 'main1', 'bob');
      const ogre = give(h, 'bob', 'Ogre', 'battlefield', { sick: false });
      const hand = h.zones.hand.bob!.length;
      if (attacking) {
        h = attackWith(h, [ogre], 'alice', 'bob');
        for (let i = 0; i < 10 && h.priority !== 'alice'; i++) h = act(h, { type: 'pass', player: h.priority! });
      } else h = act(h, { type: 'pass', player: 'bob' });
      h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Prophesied Lite', 'hand'), targets: [[{ kind: 'object', object: ogre }]] }));
      expect([h.objects[ogre]!.zone, h.zones.hand.bob!.length - hand]).toEqual(['graveyard', attacking ? 0 : 1]);
    }
  });
});

describe('staples (slice 269, part 10)', () => {
  it("Death's Approach, Scrapdiver Serpent", () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    const aura = give(g, 'alice', 'Approach Lite', 'battlefield');
    g.objects[aura]!.attachedTo = { id: ogre, zcc: g.objects[ogre]!.zcc };
    give(g, 'bob', 'Cub', 'graveyard');
    give(g, 'bob', 'Cub', 'graveyard');
    give(g, 'bob', 'Bolt', 'graveyard');
    give(g, 'alice', 'Cub', 'graveyard');
    expect([chars(g, g.objects[ogre]!).power, chars(g, g.objects[ogre]!).toughness]).toEqual([3, 1]);

    for (const artifact of [true, false]) {
      let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const serpent = give(h, 'alice', 'Serpent Lite', 'battlefield', { sick: false });
      const blocker = give(h, 'bob', 'Ogre', 'battlefield');
      if (artifact) give(h, 'bob', 'Heavy Sword', 'battlefield');
      h = attackWith(h, [serpent]);
      for (let i = 0; i < 20 && h.pending?.kind !== 'declare_blockers'; i++) h = act(h, { type: 'pass', player: h.priority! });
      const block = { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker, attacker: serpent }] } } as never;
      if (artifact) expect(illegal(h, block)).toBeTruthy();
      else expect(act(h, block).combat?.blockers[blocker]).toBeTruthy();
    }
  });
});

describe('staples (slice 269, part 11)', () => {
  it('Gorilla Titan, Viridian Betrayers, Saddled Rimestag', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const [ape, elf] = [give(g, 'alice', 'Gorilla Lite', 'battlefield'), give(g, 'alice', 'Betrayers Lite', 'battlefield')];
    expect(chars(g, g.objects[ape]!).power).toBe(7);
    give(g, 'alice', 'Cub', 'graveyard');
    expect(chars(g, g.objects[ape]!).power).toBe(3);
    const infect = () => chars(g, g.objects[elf]!).keywords.some((k) => k.id === 'infect');
    expect(infect()).toBe(false);
    g.players.bob!.poison = 1;
    expect(infect()).toBe(true);

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const stag = give(h, 'alice', 'Rimestag Lite', 'battlefield');
    expect(chars(h, h.objects[stag]!).power).toBe(2);
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Cub', 'hand') }));
    expect(chars(h, h.objects[stag]!).power).toBe(4);
  });

  it('Steel Exemplar, Freestrider Commando, Hellion Eruption', () => {
    for (const lands of [['Forest', 'Island'], ['Forest', 'Forest']]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      for (const l of lands) give(g, 'alice', l, 'battlefield');
      const ex = give(g, 'alice', 'Exemplar Lite', 'hand');
      g = settle(act(g, { type: 'cast', player: 'alice', object: ex, autoTap: true } as never));
      expect(g.objects[ex]!.counters['+1/+1']).toBe(lands[1] === 'Island' ? undefined : 2);
    }

    let h = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(h, 'alice', 'Forest', 'battlefield');
    const paid = give(h, 'alice', 'Commando Lite', 'hand');
    h = settle(act(h, { type: 'cast', player: 'alice', object: paid, autoTap: true } as never));
    const free = give(h, 'alice', 'Commando Lite', 'graveyard');
    h = settle(act(h, { type: 'cast', player: 'alice', object: give(h, 'alice', 'Reanimate Lite', 'hand'), targets: [[{ kind: 'object', object: free }]] }));
    expect([h.objects[paid]!.counters['+1/+1'], h.objects[free]!.zone, h.objects[free]!.counters['+1/+1']]).toEqual([undefined, 'battlefield', 2]);

    let k = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const mine = [give(k, 'alice', 'Cub', 'battlefield'), give(k, 'alice', 'Ogre', 'battlefield')];
    give(k, 'bob', 'Cub', 'battlefield');
    k = settle(act(k, { type: 'cast', player: 'alice', object: give(k, 'alice', 'Eruption Lite', 'hand') }));
    const hellions = k.zones.battlefield.filter((id) => k.objects[id]!.controller === 'alice' && chars(k, k.objects[id]!).subtypes.includes('Hellion')).length;
    expect([mine.map((id) => k.objects[id]!.zone), hellions]).toEqual([['graveyard', 'graveyard'], 2]);
  });
});

describe('staples (slice 270): tribute', () => {
  it('Snake of the Golden Grove: the opponent chooses', () => {
    const snake = CARDS.find((c) => c.name === 'Snake Lite')!;
    expect([snake.automation, snake.faces[0]!.keywords[0]!.abilities?.length]).toEqual(['full', 1]);
    for (const pay of [true, false]) {
      let g = toStep(start({ players: 3, extra: CARDS }), 'main1', 'alice');
      const life = g.players.alice!.life;
      const s = give(g, 'alice', 'Snake Lite', 'hand');
      g = act(g, { type: 'cast', player: 'alice', object: s });
      g = drive(g, (x) => {
        const p = x.pending as { kind: string; player: string; options?: string[] } | undefined;
        if (p?.kind !== 'as_enters') return null;
        if (p.options) return act(x, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', choice: 'carol' } });
        expect(p.player).toBe('carol');
        return act(x, { type: 'choose', player: 'carol', answer: { kind: 'as_enters', pay } });
      });
      expect([g.objects[s]!.counters['+1/+1'], g.players.alice!.life - life]).toEqual(pay ? [3, 0] : [undefined, 4]);
    }
  });
});

describe('staples (slice 270): kinship, pay life then a reflexive trigger', () => {
  it('Winnower Patrol: the top card is seen either way, revealed only if it shares a creature type', () => {
    for (const top of ['Elf Cub', 'Ogre']) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const patrol = give(g, 'alice', 'Patrol Lite', 'battlefield');
      const card = give(g, 'alice', top, 'library');
      g.zones.library.alice = [card, ...g.zones.library.alice!.filter((id) => id !== card)];
      g = settle(toStep(g, 'upkeep', 'alice'));
      const p = g.pending as { kind: string; candidates: string[]; seen?: string[]; max: number };
      expect([p.kind, p.seen, p.candidates.length, p.max]).toEqual(['choose_objects', [card], top === 'Ogre' ? 0 : 1, top === 'Ogre' ? 0 : 1]);
      if (top === 'Ogre') expect(() => act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [card] } })).toThrow();
      g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: top === 'Ogre' ? [] : [card] } }));
      expect([g.objects[patrol]!.counters['+1/+1'], g.zones.library.alice![0]]).toEqual([top === 'Ogre' ? undefined : 1, card]);
    }
  });

  it('Ambulatory Edifice: pay 2 life, then choose the target', () => {
    for (const pay of [true, false]) {
      let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
      const life = g.players.alice!.life;
      const cub = give(g, 'bob', 'Cub', 'battlefield');
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Edifice Lite', 'hand') }));
      expect(g.pending?.kind).toBe('pay');
      g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay } }));
      if (pay) {
        expect(g.pending?.kind).toBe('trigger_targets');
        g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: cub }]] } }));
      }
      expect([g.players.alice!.life - life, g.objects[cub]!.zone]).toEqual(pay ? [-2, 'graveyard'] : [0, 'battlefield']);
    }
  });
});
