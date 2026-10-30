import type { Amount, AmountExpr, Color, EffectNode, ObjectFilter, Ref } from '@mtg/schema';
import type { Binder } from './binder.js';
import { parseFilter, parseObjectRef, parsePlayerRef } from './nouns.js';
import { capitalise, COLOR_WORDS, parseAmount } from './words.js';

/**
 * Numbers the game counts (CR 107.3, CR 608.2h): "the number of creatures you control",
 * "for each card in your hand", "its power", "your devotion to black".
 */

const ZONES: Record<string, { zone: 'hand' | 'graveyard' | 'library' | 'exile'; who: 'you' | 'opponents' | 'each' }> = {
  'in your hand': { zone: 'hand', who: 'you' },
  // Huskburster Swarm: "each creature card you own in exile".
  'you own in exile': { zone: 'exile', who: 'you' },
  'in your graveyard': { zone: 'graveyard', who: 'you' },
  'in your library': { zone: 'library', who: 'you' },
  'in all graveyards': { zone: 'graveyard', who: 'each' },
  'in each graveyard': { zone: 'graveyard', who: 'each' },
  "in your opponents' graveyards": { zone: 'graveyard', who: 'opponents' },
  "in each opponent's graveyard": { zone: 'graveyard', who: 'opponents' },
  "in an opponent's graveyard": { zone: 'graveyard', who: 'opponents' },
  // Realm Seekers: "the total number of cards in all players' hands".
  "in all players' hands": { zone: 'hand', who: 'each' },
  "in each player's hand": { zone: 'hand', who: 'each' },
  "in your opponents' hands": { zone: 'hand', who: 'opponents' },
};

/** "creatures you control", "creature cards in your graveyard", "cards in your hand" (plural or not). */
function objects(text: string, b: Binder, plural: boolean): AmountExpr | null {
  const other = /^(?:other|another) (.+)$/.exec(text.trim());
  if (other) {
    const inner = objects(other[1]!, b, plural);
    if (inner?.kind !== 'count') return null;
    // Shared Animosity: "each other attacking creature that shares a creature type with it" — other than it.
    const about = inner.filter.sharesCreatureTypeWith as Ref | undefined;
    if (about && about.ref !== 'self') return { ...inner, filter: { ...inner.filter, otherThan: about } };
    // Counted for each object a static applies to (Mirror Box): other than that one.
    if (b.it?.ref === 'affected') return { ...inner, filter: { ...inner.filter, otherThan: b.it } };
    return { ...inner, filter: { ...inner.filter, other: true } };
  }
  const t = text.trim();
  // Fraying Sanity: "the number of cards put into their graveyard from anywhere this turn" (tokens aren't cards).
  const putThere = /^cards put into (your|their|that player's) graveyard from anywhere this turn$/.exec(t);
  if (putThere && plural) {
    const player = putThere[1] === 'your' ? ({ ref: 'you' } as Ref) : b.player && b.player.ref !== 'you' ? b.player : null;
    return player ? { kind: 'to_graveyard_this_turn', player } : null;
  }
  // "for each card in target opponent's hand", "the number of creature cards in target player's graveyard"
  // Peer into the Abyss: "the number of cards in their library" — the player the sentence is about.
  // Animus of Night's Reach: "the number of creature cards in defending player's graveyard".
  // Kaya, Orzhov Usurper: "the number of cards that player owns in exile" (CR 406.3 — exile is shared; these are theirs).
  const theirExile = /^cards (target player|target opponent|that player|the chosen player|defending player) owns in exile$/.exec(t);
  if (theirExile && plural) {
    const player = parsePlayerRef(theirExile[1]!, b);
    return player ? { kind: 'cards', zone: 'exile', who: 'each', player } : null;
  }
  const theirs = /^(.+) in (?:(target player|target opponent|that player|the chosen player|defending player|its controller)'s|their) (hand|graveyard|library)$/.exec(t);
  if (theirs) {
    const head = theirs[1]!;
    let filter: ObjectFilter | undefined;
    if (!/^cards?$/.test(head)) {
      const pf = parseFilter(`${head} in your graveyard`, b);
      if (!pf || pf.plural !== plural) return null;
      const { zone: _z, owner: _o, ...rest } = pf.filter;
      filter = rest as ObjectFilter;
    } else if (head.endsWith('s') !== plural) return null;
    // "each opponent … the number of cards in their graveyard": each of them (see perPlayerCount).
    // Righteous Authority: "for each card in its controller's hand" — the enchanted creature's controller.
    if (theirs[2] === 'its controller' && b.it?.ref !== 'attached' && b.it?.ref !== 'affected') return null;
    const player = theirs[2] === 'its controller' ? ({ ref: 'controller_of', of: b.it! } as Ref) : theirs[2] ? parsePlayerRef(theirs[2], b) : b.player && b.player.ref !== 'you' ? b.player : null;
    if (!player) return null;
    return { kind: 'cards', zone: theirs[3] as 'hand' | 'graveyard' | 'library', who: 'each', player, ...(filter ? { filter } : {}) };
  }
  // Huskburster Swarm: "each creature card you own in exile and in your graveyard" — both counts.
  const both = /^(.+) you own in exile and in your graveyard$/.exec(t);
  if (both) {
    const one = objects(`${both[1]} you own in exile`, b, plural);
    const two = one ? objects(`${both[1]} in your graveyard`, b, plural) : null;
    if (one && two) return { kind: 'sum', parts: [one, two] };
  }
  for (const [suffix, where] of Object.entries(ZONES)) {
    if (!t.endsWith(` ${suffix}`)) continue;
    const head = t.slice(0, -suffix.length - 1);
    if (/^cards?$/.test(head)) return head.endsWith('s') === plural ? { kind: 'cards', ...where } : null;
    // "creature cards in your graveyard": read the noun as if it were in that zone.
    const pf = parseFilter(`${head} in your graveyard`, b);
    if (!pf || pf.plural !== plural) return null;
    const { zone: _z, owner: _o, ...filter } = pf.filter;
    return { kind: 'cards', ...where, filter: filter as ObjectFilter };
  }
  const pf = parseFilter(t, b);
  // "the number of Plains you control": a word whose plural is the same.
  // Eldrazi Linebreaker: "the number of Eldrazi you control" (Merfolk, Kor, Myr, … too).
  const same = /^(?:basic )?(?:Plains|Sheep|Fish|Elk)\b/.test(t) || Boolean(pf?.invariant);
  if (!pf || (pf.plural !== plural && !same) || (pf.filter.zone && pf.filter.zone !== 'battlefield')) return null;
  // Rowdy Research: "for each creature that attacked this turn" counts ones that have since left too.
  if (pf.filter.attackedThisTurn) return null;
  return { kind: 'count', filter: pf.filter };
}

/** "creature destroyed this way", "cards exiled this way": what the resolution moved (by card type only). */
export function movedThisWay(text: string, b: Binder): AmountExpr | null {
  // Terastodon: "each permanent put into a graveyard this way" — from the battlefield to a graveyard.
  // Arid Archway: "another Desert returned this way" — returned to its owner's hand from the battlefield, other than the source.
  // Deadly Tempest: "the number of creatures they controlled that were destroyed this way" — each player's own.
  // Kaya's Wrath: "the number of creatures you controlled that were destroyed this way".
  // Ceaseless Conflict: "for each nontoken creature you controlled that was destroyed this way".
  const yours = /^(.+?) you controlled that (?:were|was) (destroyed|exiled|sacrificed|returned) this way$/.exec(text.trim());
  if (yours) {
    const inner = movedThisWay(`${yours[1]} ${yours[2]} this way`, b);
    return inner && inner.kind === 'moved_this_way' ? { ...inner, yours: true } : null;
  }
  const theirs = /^(.+?) they controlled that were (destroyed|exiled|sacrificed|returned) this way$/.exec(text.trim());
  if (theirs) {
    const each = b.player?.ref === 'each_player' || b.player?.ref === 'players' ? b.player : null;
    const inner = each ? movedThisWay(`${theirs[1]} ${theirs[2]} this way`, b) : null;
    return inner && inner.kind === 'moved_this_way' ? { ...inner, controlledBy: each! } : null;
  }
  // Hellfire: "the number of creatures that died this way" — put into a graveyard from the battlefield (CR 700.4).
  const died = /^(.+?) that died this way$/.exec(text.trim());
  if (died && !/ (?:destroyed|exiled|sacrificed|returned) /.test(died[1]!)) return movedThisWay(`${died[1]} put into a graveyard this way`, b);
  // Liliana's Indignation: "each creature card put into your graveyard this way" (after a mill).
  // Coerced Confession: "each creature card put into their graveyard this way" (after a target player mills).
  const m = /^(.+?) (destroyed|exiled|sacrificed|milled|put into a graveyard|put into (?:your|their|that player's) graveyard|returned|shuffled into a library|put into your hand) this way$/.exec(text.trim());
  if (!m) return null;
  const another = /^another /.test(m[1]!);
  const noun = m[1]!.replace(/^(?:a|an|another) /, '').replace(/ cards?$|^cards?$/, '');
  const how = (/^put into (?:a|your|their|that player's) graveyard$/.test(m[2]!) ? 'graveyard' : m[2] === 'shuffled into a library' ? 'library' : m[2] === 'put into your hand' ? 'hand' : m[2]) as 'destroyed' | 'exiled' | 'sacrificed' | 'milled' | 'graveyard' | 'returned' | 'library' | 'hand';
  if (!noun || /^permanents?$/.test(noun)) return { kind: 'moved_this_way', how, ...(another ? { other: true } : {}) };
  // Bonehoard Dracosaur: "a nonland card exiled this way" — a bare "nonland" is read as "nonland permanent".
  const pf = parseFilter(noun, b.clone()) ?? (/^non[a-z]+$/.test(noun) ? parseFilter(`${noun} permanent`, b.clone()) : null);
  if (!pf) return null;
  const f = pf.filter;
  if (another) f.other = true;
  if (Object.keys(f).some((k) => k !== 'types' && k !== 'notTypes' && k !== 'token' && k !== 'subtypes' && k !== 'other')) return null;
  // Blood Money: "each nontoken creature destroyed this way".
  return { kind: 'moved_this_way', how, ...(f.types ? { types: f.types } : {}), ...(f.notTypes ? { notTypes: f.notTypes } : {}), ...(f.token !== undefined ? { token: f.token } : {}), ...(f.subtypes ? { subtypes: f.subtypes } : {}), ...(f.other ? { other: true } : {}) };
}

/** "creature that died this turn", "nontoken creatures that died this turn", "Zubera that died this turn". */
function diedThisTurn(text: string, b: Binder): AmountExpr | null {
  // Kutzil's Flanker: "each creature that left the battlefield under your control this turn".
  const left = /^(creatures?|permanents?|artifacts?) that left the battlefield (?:under (your|an opponent's) control )?this turn$/.exec(text.trim());
  if (left) {
    const kind = left[1]!.replace(/s$/, '');
    return { kind: 'left_this_turn', ...(kind !== 'creature' ? { types: kind === 'permanent' ? ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'] : ['Artifact'] } : {}), ...(left[2] ? { controller: left[2] === 'your' ? 'you' : 'opponent' } : {}) };
  }
  // Body Count: "each creature that died under your control this turn".
  // Caller of the Claw: "each nontoken creature put into your graveyard from the battlefield this turn" — owned by you.
  const putInto = /^(.+?) put into your graveyard from the battlefield this turn$/.exec(text.trim());
  if (putInto) {
    const a = diedThisTurn(`${putInto[1]} that died this turn`, b);
    return a && a.kind === 'died_this_turn' && !a.controller ? { ...a, owner: 'you' } : null;
  }
  // Tobias, Doomed Conqueror: "each nontoken creature you controlled that died this turn".
  const yoursDied = /^(.+?) you controlled that died this turn$/.exec(text.trim());
  if (yoursDied) return diedThisTurn(`${yoursDied[1]} that died under your control this turn`, b);
  const m = /^(.+?) that died (?:under (your|an opponent's) control )?this turn$/.exec(text.trim());
  if (!m) return null;
  const pf = parseFilter(m[1]!, b.clone());
  if (!pf) return null;
  const under = m[2] === 'your' ? 'you' : m[2] ? 'opponent' : undefined;
  const { types, subtypes, notSubtypes, token, controller: ctl, ...rest } = pf.filter;
  const controller = ctl ?? under;
  if (Object.keys(rest).length || token === true || (controller && controller !== 'you' && controller !== 'opponent') || (ctl && under)) return null;
  return {
    kind: 'died_this_turn',
    ...(types && !(types.length === 1 && types[0] === 'Creature') ? { types } : {}),
    ...(subtypes ? { subtypes } : {}),
    ...(notSubtypes ? { notSubtypes } : {}),
    ...(token === false ? { nontoken: true as const } : {}),
    ...(controller ? { controller: controller as 'you' | 'opponent' } : {}),
  };
}

/** What follows "for each": a singular noun phrase. */
export function parseForEach(text: string, b: Binder): AmountExpr | null {
  // Toil to Renown: "for each tapped artifact, creature, and land you control" — each permanent that's any of them, once.
  const t = text.trim().replace(/^((?:tapped |untapped )?(?:artifact|creature|enchantment|land|planeswalker)), (artifact|creature|enchantment|land|planeswalker),? and (artifact|creature|enchantment|land|planeswalker)(?= you control$)/, '$1, $2, or $3');
  // Multani: "for each land you control and each land card in your graveyard" — the two counts added.
  const added = /^(.+?) and each (.+)$/.exec(t);
  if (added) {
    const one = parseForEach(added[1]!, b.clone());
    const two = one ? parseForEach(added[2]!, b.clone()) : null;
    if (one && two && !one.times && !two.times && !one.plus && !two.plus) return { kind: 'sum', parts: [one, two] };
  }
  const moved = movedThisWay(t, b) ?? diedThisTurn(t, b);
  if (moved) return moved;
  // Bioengineered Future: "for each land that entered the battlefield under your control this turn".
  const enteredEach = /^(?!other )(.+?) that entered the battlefield under your control this turn$/.exec(t);
  if (enteredEach) {
    const pf = parseFilter(enteredEach[1]!, b.clone());
    if (pf && !pf.plural && !pf.filter.zone && !pf.filter.controller && !pf.filter.other) return { kind: 'entered_this_turn', filter: pf.filter };
  }
  // Rowdy Research: "for each creature that attacked this turn" — anyone's.
  if (t === 'creature that attacked this turn') return { kind: 'attackers_this_turn' };
  // Search Party Captain: "for each creature you attacked with this turn".
  if (t === 'creature you attacked with this turn') return { kind: 'attackers_this_turn', mine: true };
  // Delightful Discovery: "for each spell your opponents have cast this turn".
  if (t === 'spell your opponents have cast this turn') return { kind: 'spells_cast_this_turn', opponents: true };
  // Gnoll War Band: "for each opponent who was dealt damage this turn".
  if (t === 'opponent who was dealt damage this turn') return { kind: 'players', who: 'opponents', damaged: true };
  // Demilich: "for each instant and sorcery spell you've cast this turn".
  const castKind = /^(.+?) spells? you've cast this turn$/.exec(t);
  if (castKind) {
    const pf = parseFilter(`${castKind[1]!.replace(/ and /g, ' or ')} spell`, b.clone());
    if (pf && !pf.plural && pf.filter.zone === 'stack' && !pf.filter.controller) {
      const { zone: _z, ...filter } = pf.filter;
      return { kind: 'spells_cast_this_turn', filter };
    }
  }
  // Thrasta, Tempest's Roar: "for each other spell cast this turn" — by anyone.
  if (t === 'other spell cast this turn') return { kind: 'spells_cast_this_turn', anyone: true, other: true };
  // The Balrog, Durin's Bane: "for each permanent sacrificed this turn".
  const sacrificed = /^(permanent|creature|artifact) sacrificed this turn$/.exec(t);
  if (sacrificed) return { kind: 'sacrificed_this_turn', ...(sacrificed[1] !== 'permanent' ? { types: [capitalise(sacrificed[1]!)] } : {}) };
  // Eris, Roar of the Storm: "for each different mana value among instant and sorcery cards in your graveyard".
  const distinctMv = /^different mana value among (.+)$/.exec(t);
  if (distinctMv) {
    const pf = parseFilter(distinctMv[1]!, b.clone());
    // Lunar Insight: "… among nonland permanents you control" — on the battlefield.
    if (pf && pf.plural) return { kind: 'distinct_mana_values', filter: pf.filter };
  }
  // Golden Ratio: "for each different power among creatures you control"; Celebrate the Harvest: "the number of different
  // powers among creatures you control".
  const distinctPow = /^(?:different power|the number of different powers) among (.+)$/.exec(t);
  if (distinctPow) {
    const pf = parseFilter(distinctPow[1]!, b.clone());
    if (pf && pf.plural && !pf.filter.zone) return { kind: 'distinct_powers', filter: pf.filter };
  }
  // Kefka, Court Mage: "for each card type among cards discarded this way".
  if (t === 'card type among cards discarded this way') return { kind: 'card_types', discardedThisWay: true };
  // Discordant Spirit: "for each 1 damage dealt to you this turn".
  if (t === '1 damage dealt to you this turn') return { kind: 'life_this_turn', who: 'you', stat: 'damage' };
  // Mobilized District: "for each legendary creature and planeswalker you control" — each permanent that's either.
  if (t === 'legendary creature and planeswalker you control') {
    return { kind: 'count', filter: { controller: 'you', anyOf: [{ types: ['Creature'], supertypes: ['Legendary'] }, { types: ['Planeswalker'] }] } };
  }
  // Deepwood Denizen: "for each +1/+1 counter on creatures you control" — that kind, on all of them.
  // Ascendant Acolyte: "for each +1/+1 counter among other creatures you control".
  const kindOn = /^([+-]\d+\/[+-]\d+|\w+) counter (?:on|among) (other )?(.+)$/.exec(t);
  if (kindOn && !/^(?:~|it|him|her|this \w+|that \w+|target .+|enchanted .+|equipped .+)$/.test(kindOn[3]!)) {
    const pf = parseFilter(kindOn[3]!, b.clone());
    if (pf && pf.plural && !pf.filter.zone) return { kind: 'counters_among', filter: { ...pf.filter, ...(kindOn[2] ? { other: true } : {}) }, counter: kindOn[1]! };
  }
  // Ancient Imperiosaur: "for each creature that convoked it" (CR 702.51c).
  if (/^creature that convoked (?:it|~|this spell)$/.test(t)) return { kind: 'convoked', of: { ref: 'self' } };
  // Syphon Mind: "for each card discarded this way"
  if (t === 'card discarded this way') return { kind: 'discarded_this_way' };
  // Devout Invocation: "for each creature tapped this way".
  if (/^(?:creature|permanent|artifact|[A-Z][a-z]+) tapped this way$/.test(t)) return { kind: 'tapped_this_way' };
  // Seasoned Pyromancer: "for each nonland card discarded this way".
  const kindDiscarded = /^(nonland|land|creature|noncreature|instant or sorcery) card discarded this way$/.exec(t);
  if (kindDiscarded) {
    const pf = parseFilter(`${kindDiscarded[1]} card in your graveyard`, b.clone());
    if (pf && !pf.plural) {
      const { zone: _z, owner: _o, ...filter } = pf.filter;
      return { kind: 'discarded_this_way', filter };
    }
  }
  // Moraug: "for each time it has attacked this turn".
  if (t === 'time it has attacked this turn') {
    const of = parseObjectRef('it', b.clone(), 'static');
    if (of && !of.plural) return { kind: 'attacks_this_turn', of: of.ref };
  }
  // Otharri: "for each experience counter you have" (CR 122.1: counters on a player).
  const playerCounter = /^(\w+) counter you have$/.exec(t);
  if (playerCounter) return { kind: 'counters', of: { ref: 'you' }, counter: playerCounter[1]! };
  // Whispering Specter: "that player discards a card for each poison counter they have".
  const theyCounter = /^(\w+) counter (?:they have|that player has)$/.exec(t);
  if (theyCounter && b.player?.ref === 'trigger_player') return { kind: 'counters', of: { ref: 'trigger_player' }, counter: theyCounter[1]! };
  // Phyrexian Swarmlord: "for each poison counter your opponents have" — all of theirs together.
  const theirCounter = /^(\w+) counter your opponents have$/.exec(t);
  if (theirCounter) return { kind: 'counters', of: { ref: 'players', who: 'opponents' }, counter: theirCounter[1]! };
  // Wojek Investigator: "once for each opponent who has more cards in hand than you".
  if (/^opponent who has more cards in hand than you$/.test(t)) return { kind: 'players', who: 'opponents', handMoreThanYou: true };
  // Wolfcaller's Howl: "the number of your opponents with four or more cards in hand".
  const handAtLeast = /^(?:of your )?opponents? (?:with|who ha(?:s|ve)) (two|three|four|five|six|seven) or more cards in hand$/.exec(t);
  if (handAtLeast) return { kind: 'players', who: 'opponents', handAtLeast: parseAmount(handAtLeast[1]!) as number };
  // Coalition Relic: "for each charge counter removed this way".
  if (/^(?:\S+ )?counter removed this way$/.test(t)) return { kind: 'counters_removed' };
  // CR 705.2: Ral Zarek: "for each coin that comes up heads"; Crazed Firecat: "for each flip you won".
  if (/^(?:coin that comes up heads|flip you (?:won|win))$/.test(t)) return { kind: 'flips_won' };
  if (/^flip you (?:lost|lose)$/.test(t)) return { kind: 'flips_won', lost: true };
  // Ramos, Dragon Engine: "for each of that spell's colors" (CR 105.2).
  const colorsOf = /^of (that spell|that card|~)'s colors$/.exec(t) ?? (t === 'of its colors' ? [t, 'it'] : null);
  if (colorsOf) {
    const of = parseObjectRef(colorsOf[1]!, b.clone(), 'static');
    if (of && !of.plural) return { kind: 'stat', stat: 'colors', of: of.ref };
  }
  // Fists of Flame: "for each card you've drawn this turn"
  if (t === "card you've drawn this turn") return { kind: 'drawn_this_turn' };
  // Ancient Excavation: "discard a card for each card drawn this way".
  // Laquatus's Creativity: "Target player draws …, then discards a card for each card drawn this way" — by anyone.
  if (t === 'card drawn this way') return { kind: 'drawn_this_way' };
  // Swift Silence: "Draw a card for each spell countered this way."
  if (t === 'spell countered this way') return { kind: 'countered_this_way' };
  // CR 702.82b: Skullmulcher: "for each creature it devoured".
  if (t === 'creature it devoured' || t === 'creature ~ devoured') return { kind: 'devoured' };
  // Heliod, the Radiant Dawn: "for each card your opponents have drawn this turn".
  if (t === 'card your opponents have drawn this turn') return { kind: 'drawn_this_turn', who: 'opponents' };
  if (t === 'opponent' || t === 'opponent you have') return { kind: 'players', who: 'opponents' };
  // Rampant Frogantua: "for each player who has lost the game".
  if (t === 'player who has lost the game') return { kind: 'players', who: 'each', lostGame: true };
  if (t === 'player') return { kind: 'players', who: 'each' };
  // Teysa, Opulent Oligarch: "for each opponent who lost life this turn"
  const lost = /^(opponent|player|of your opponents) who lost life this turn$/.exec(t);
  if (lost) return { kind: 'players', who: lost[1] === 'player' ? 'each' : 'opponents', lostLife: true };
  // Smuggler's Share: "for each opponent who drew two or more cards this turn", "… who had two or more lands enter the
  // battlefield under their control this turn".
  if (/^opponent who drew a card this way$/.test(t)) return { kind: 'players', who: 'opponents', drewThisWay: true };
  // Bandit's Talent: "for each opponent who has one or fewer cards in hand".
  const fewHand = /^opponent who has (no|one or fewer|two or fewer) cards in hand$/.exec(t);
  if (fewHand) return { kind: 'players', who: 'opponents', handAtMost: { no: 0, 'one or fewer': 1, 'two or fewer': 2 }[fewHand[1] as 'no'] };
  // Aclazotz, Deepest Betrayal: "Each opponent discards a card. For each opponent who can't, you draw a card."
  if (t === "opponent who didn't discard a card this way") return { kind: 'players', who: 'opponents', discardedNone: true };
  // Heidegger, Shinra Executive: "for each opponent who controls more creatures than you".
  const more = /^opponents? who controls? (more|fewer) (.+?) than you$/.exec(t);
  if (more) {
    const pf = parseFilter(more[2]!, b.clone());
    if (pf && pf.plural && !pf.filter.zone && !pf.filter.controller && !pf.filter.other) return { kind: 'players', who: 'opponents', ...(more[1] === 'more' ? { controlsMore: pf.filter } : { controlsFewer: pf.filter }) };
  }
  const drewN = /^(opponent|player) who drew (two|three|four) or more cards this turn$/.exec(t);
  if (drewN) return { kind: 'players', who: drewN[1] === 'player' ? 'each' : 'opponents', drew: parseAmount(drewN[2]!) as number };
  const landsN = /^(opponent|player) who had (two|three) or more lands enter the battlefield under their control this turn$/.exec(t);
  if (landsN) return { kind: 'players', who: landsN[1] === 'player' ? 'each' : 'opponents', landsEntered: parseAmount(landsN[2]!) as number };
  // CR 903.8: "for each time you've cast your commander from the command zone this game"
  // Jirina Kudro, Font of Magic: "for each time you've cast a commander from the command zone this game" — yours (CR 903.8).
  if (/^time you've cast (?:your|a) commander from the command zone this game$/.test(t)) return { kind: 'commander_casts' };
  // CR 702.121a (melee): "for each opponent you attacked with a creature this combat"
  if (t === 'opponent you attacked with a creature this combat') return { kind: 'opponents_attacked' };
  // Rose, Cutthroat Raider: "for each opponent you attacked" — this turn.
  if (t === 'opponent you attacked' || t === 'opponent you attacked this turn') return { kind: 'opponents_attacked', thisTurn: true };
  // CR 702.44a / converge: "for each color of mana spent to cast it"
  if (/^color of mana spent to cast (?:it|~|this spell)$/.test(t)) return { kind: 'colors_spent' };
  // Verazol, the Split Current: "for each mana spent to cast it".
  if (/^mana spent to cast (?:it|~|this creature)$/.test(t) && (!b.it || b.it.ref === 'self')) return { kind: 'mana_spent', of: { ref: 'self' } };
  // CR 700.8: "for each creature in your party"
  if (t === 'creature in your party') return { kind: 'party' };
  if (t === "spell you've cast this turn") return { kind: 'spells_cast_this_turn' };
  // Outlaw Stitcher: "for each spell you've cast this turn other than the first" — one fewer.
  if (t === "spell you've cast this turn other than the first") return { kind: 'spells_cast_this_turn', plus: -1 };
  // Hollow One: "for each card you've cycled or discarded this turn" — cycling discards the card (CR 702.29a), so each is one
  // discard.
  if (t === "card you've discarded this turn" || t === "card you've cycled or discarded this turn") return { kind: 'discarded_this_turn' };
  // Lock and Load: "for each other instant and sorcery spell you've cast this turn" — not this one.
  const otherCast = /^other (.+?) spell you've cast this turn$/.exec(t);
  if (otherCast) {
    const pf = parseFilter(`${otherCast[1]} spell`, b.clone());
    if (pf && !pf.plural && (!pf.filter.zone || pf.filter.zone === 'stack') && !pf.filter.controller) {
      const { zone: _z, ...filter } = pf.filter;
      return { kind: 'spells_cast_this_turn', filter, other: true };
    }
  }
  // Rug of Smothering: "they lose 1 life for each spell they've cast this turn" — the player the trigger is about.
  if (/^spell (?:they've|that player has) cast this turn$/.test(t) && b.player && b.player.ref !== 'players' && b.player.ref !== 'you') return { kind: 'spells_cast_this_turn', player: b.player };
  // Thousand-Year Storm: "for each other instant and sorcery spell you've cast before it this turn"
  const castBefore = /^other (.+?) spell you've cast before it this turn$/.exec(t);
  if (castBefore) {
    const pf = parseFilter(`${castBefore[1]!.replace(/^(\w+) and (\w+)$/, '$1 or $2')} spell`, b);
    if (!pf || pf.filter.controller || (pf.filter.zone && pf.filter.zone !== 'stack')) return null;
    // Wherever those spells are now.
    delete pf.filter.zone;
    return { kind: 'cast_before', of: b.it ?? { ref: 'self' }, filter: pf.filter, yours: true };
  }
  // Cradle of Vitality: "Whenever you gain life, … for each 1 life you gained." — that life.
  if (/^1 life you gained$/.test(t) && b.eventAmount) return { kind: 'event' };
  // Neheb, the Eternal: "for each 1 life your opponents have lost this turn"
  const lifeEach = /^1 life (.+?) this turn$/.exec(t);
  if (lifeEach) return lifeThisTurn(lifeEach[1]!);
  // Valiant Changeling: "for each creature type among creatures you control".
  const kindAmong = /^creature type among (other )?(.+)$/.exec(t);
  if (kindAmong) {
    const pf = parseFilter(kindAmong[2]!, b);
    return pf && pf.plural && !pf.filter.zone ? { kind: 'creature_types_among', filter: { ...pf.filter, ...(kindAmong[1] ? { other: true } : {}) } } : null;
  }
  // Faeburrow Elder: "for each color among permanents you control"
  // Sisay, Weatherlight Captain: "for each color among other legendary permanents you control".
  const colorAmong = /^color among (other )?(.+)$/.exec(t);
  if (colorAmong) {
    const pf = parseFilter(colorAmong[2]!, b);
    return pf && pf.plural && !pf.filter.zone ? { kind: 'colors_among', filter: { ...pf.filter, ...(colorAmong[1] ? { other: true } : {}) } } : null;
  }
  // Domain (CR 305.6): "for each basic land type among lands you control"; delirium-style card types.
  if (t === 'basic land type among lands you control') return { kind: 'domain' };
  // Allied Strategies: "Target player draws a card for each basic land type among lands they control."
  if (/^basic land type among lands (?:they control|that player controls)$/.test(t)) return b.player && !['you', 'players', 'each_player'].includes(b.player.ref) ? { kind: 'domain', player: b.player } : null;
  if (t === 'card type among cards in your graveyard') return { kind: 'card_types' };
  // Tarmogoyf: "among cards in all graveyards"; Nighthawk Scavenger: "… in your opponents' graveyards".
  if (t === 'card type among cards in all graveyards') return { kind: 'card_types', whose: 'all' };
  if (t === "card type among cards in your opponents' graveyards") return { kind: 'card_types', whose: 'opponents' };
  // CR 701.38: "for each death vote"
  const vote = /^(.+) vote$/.exec(t);
  if (vote && b.votes.includes(vote[1]!)) return { kind: 'votes', option: vote[1]! };
  // CR 702.23a (rampage): "for each creature blocking it beyond the first"
  const blocking = /^creature blocking (it|~)( beyond the first)?$/.exec(t);
  if (blocking) return { kind: 'blockers', of: blocking[1] === '~' ? { ref: 'self' } : (b.it ?? { ref: 'self' }), ...(blocking[2] ? { beyond: 1 } : {}) };
  // "for each instant and sorcery card in your graveyard": a card of either type.
  const both = /^(\w+) and (\w+) card (in .+)$/.exec(t);
  if (both) return objects(`${both[1]} or ${both[2]} card ${both[3]}`, b, false);
  // Omnath, Locus of Mana: "for each unspent green mana you have"; Omnath, Locus of the Void: "for each unspent mana you have".
  const unspent = /^unspent (?:(white|blue|black|red|green|colorless) )?mana you have$/.exec(t);
  if (unspent) return { kind: 'unspent_mana', ...(unspent[1] ? { color: unspent[1] === 'colorless' ? 'C' : COLOR_WORDS[unspent[1]]! } : {}) };
  // CR 702.33c (multikicker): "for each time it was kicked"
  if (/^time (?:~|it) was kicked$/.test(t)) return { kind: 'kicks' };
  // "for each time its replicate cost was paid", "… its squad cost was paid"
  const paidTimes = /^time (?:its|~'s) (\w+) cost was paid$/.exec(t);
  if (paidTimes) return { kind: 'paid_times', cost: paidTimes[1]!.toLowerCase() };
  // CR 702.40a: "for each other spell that was cast before it this turn"
  if (/^other spell that was cast before (?:it|~) this turn$/.test(t)) return { kind: 'cast_before', of: b.it ?? { ref: 'self' } };
  // Twitching Doll: "for each counter on this creature" — of any kind.
  const counter = /^(?:(\S+) )?counter on (.+)$/.exec(t);
  // Toxrill, the Corrosive: "Creatures you don't control get -1/-1 for each slime counter on them." — each one's own.
  if (counter && counter[2] === 'them' && b.it?.ref === 'affected') return { kind: 'counters', of: b.it, ...(counter[1] ? { counter: counter[1] } : {}) };
  if (counter) {
    const of = parseObjectRef(counter[2]!, b.clone(), 'static');
    return of && !of.plural ? { kind: 'counters', of: of.ref, ...(counter[1] ? { counter: counter[1] } : {}) } : null;
  }
  return objects(t, b, false);
}

/** "you've gained", "your opponents have lost" (this turn). */
function lifeThisTurn(who: string): AmountExpr | null {
  const m = /^(you|your opponents)(?:'ve| have)? (gained|lost)$/.exec(who);
  if (!m) return null;
  return { kind: 'life_this_turn', who: m[1] === 'you' ? 'you' : 'opponents', ...(m[2] === 'lost' ? { stat: 'lost' as const } : {}) };
}

/** A number phrase: "the number of creatures you control", "its power", "twice …", "2 plus …". */
export function parseCount(text: string, b: Binder): AmountExpr | null {
  // Dovescape: "where X is the spell's mana value" — the spell a cast trigger is about.
  // Realm Seekers: "the total number of cards in all players' hands" — the same as "the number of".
  const t = (b.named['that spell'] ? text.trim().replace(/^the spell's /, "that spell's ") : text.trim()).replace(/^the total number of (?=(?:[a-z]+ (?:and|or) [a-z]+ |[a-z]+ )?cards )/, 'the number of ');
  // CR 702.179a: The Speed Demon: "where X is your speed".
  if (t === 'your speed') return { kind: 'speed' };
  // Cryptborn Horror: "the total life lost by your opponents this turn".
  if (t === 'the total life lost by your opponents this turn' || t === 'the total amount of life your opponents have lost this turn') return { kind: 'life_this_turn', who: 'opponents', stat: 'lost' };
  // Molten Hydra, Torture Chamber: "the number of +1/+1 counters removed this way" (by the cost, or by the effect).
  if (/^the number of (?:\S+ )?counters removed this way$/.test(t)) return { kind: 'counters_removed' };
  // Ral Zarek, Guest Lecturer: "where X is the number of coins that came up heads" (CR 705.2).
  if (t === 'the number of coins that came up heads') return { kind: 'flips_won' };
  // Magebane Lizard: "the number of noncreature spells they've cast this turn" — that player's, of that kind.
  const kindCast = /^the number of (.+?) spells (they've|that player has|you've) cast this turn$/.exec(t);
  if (kindCast) {
    const who = kindCast[2] === "you've" ? null : b.player && b.player.ref !== 'players' && b.player.ref !== 'you' ? b.player : undefined;
    const pf = who !== undefined ? parseFilter(`${kindCast[1]} spell`, b.clone()) : null;
    if (pf && !pf.plural && (!pf.filter.zone || pf.filter.zone === 'stack') && !pf.filter.controller) {
      const { zone: _z, ...filter } = pf.filter;
      return { kind: 'spells_cast_this_turn', filter, ...(who ? { player: who } : {}) };
    }
  }
  // Prophet of the Scarab: "the number of Zombies you control or the number of Zombie cards in your graveyard, whichever is
  // greater"; Triumphant Chomp: "2 or the greatest power among Dinosaurs you control, whichever is greater".
  const whichever = /^(.+?) or (.+), whichever is greater$/.exec(t);
  if (whichever) {
    const num = (s: string): AmountExpr | null => (/^\d+$/.test(s) ? { kind: 'sum', parts: [], plus: Number(s) } : parseCount(s, b));
    const one = num(whichever[1]!);
    const two = one && num(whichever[2]!);
    return one && two ? { kind: 'max', parts: [one, two] } : null;
  }
  // Glissa Sunseeker: "the amount of unspent mana you have".
  if (t === 'the amount of unspent mana you have') return { kind: 'unspent_mana' };
  // Federation (Saavik, Stoic Student): "the number of creature types among non-Borg creatures you control".
  const kindsAmong = /^the number of creature types among (other )?(.+)$/.exec(t);
  if (kindsAmong) {
    const pf = parseFilter(kindsAmong[2]!, b);
    return pf && pf.plural && !pf.filter.zone ? { kind: 'creature_types_among', filter: { ...pf.filter, ...(kindsAmong[1] ? { other: true } : {}) } } : null;
  }
  // Dihada's Ploy: "the number of cards you've discarded this turn".
  if (/^the number of cards you(?:'ve)? discarded this turn$/.test(t)) return { kind: 'discarded_this_turn' };
  // Flesh // Blood: "Exile target creature card from a graveyard. Put X +1/+1 counters on target creature, where X is the
  // power of the card you exiled." — that target, in exile.
  const exiledStat = /^the (power|toughness|mana value) of the card you exiled$/.exec(t);
  if (exiledStat && b.it?.ref === 'target' && b.targets[b.it.index]?.filter?.zone === 'graveyard') return { kind: 'stat', stat: exiledStat[1] === 'mana value' ? 'mana_value' : (exiledStat[1] as 'power' | 'toughness'), of: b.it };
  // Bronze Cudgels: "where X is the number of times this ability has resolved this turn".
  if (t === 'the number of times this ability has resolved this turn') return { kind: 'ability_resolutions' };
  // Dream Salvage: "the number of cards target opponent discarded this turn".
  const theyDiscarded = /^the number of cards (target opponent|target player|that player) (?:has )?discarded this turn$/.exec(t);
  if (theyDiscarded) {
    const player = parsePlayerRef(theyDiscarded[1]!, b);
    return player && player.ref !== 'players' ? { kind: 'discarded_this_turn', player } : null;
  }
  // Prismabasher: "the number of colors among permanents you control" (CR 105.2).
  const colorsAmong = /^the number of colors among (other )?(.+)$/.exec(t);
  if (colorsAmong) {
    const pf = parseFilter(colorsAmong[2]!, b);
    return pf && pf.plural && !pf.filter.zone ? { kind: 'colors_among', filter: { ...pf.filter, ...(colorsAmong[1] ? { other: true } : {}) } } : null;
  }
  // Marshal's Anthem: "the number of times this enchantment was kicked" (CR 702.33c, multikicker).
  if (/^the number of times (?:~|it|this \w+) was kicked$/.test(t)) return { kind: 'kicks' };
  // Knight-Errant of Eos: "the number of creatures that convoked it" (CR 702.51c).
  if (/^the number of creatures that convoked (?:it|~|this spell)$/.test(t)) return { kind: 'convoked', of: { ref: 'self' } };
  // Cavern-Hoard Dragon: "the greatest number of artifacts an opponent controls" — the most any one opponent controls.
  const most = /^the greatest number of (.+ (?:an opponent controls|your opponents control))$/.exec(t);
  if (most) {
    const c = parseCount(`the number of ${most[1]!.replace(/ your opponents control$/, ' an opponent controls')}`, b);
    return c?.kind === 'count' && c.filter.controller === 'opponent' && !c.times && !c.plus ? { ...c, most: true } : null;
  }
  // Investigator's Journal: "the greatest number of creatures a player controls" — the most any one player controls.
  const mostAny = /^the greatest number of (.+) a player controls$/.exec(t);
  if (mostAny) {
    const c = parseCount(`the number of ${mostAny[1]}`, b);
    return c?.kind === 'count' && !c.filter.controller && !c.filter.controlledBy && !c.times && !c.plus ? { ...c, most: true, anyPlayer: true } : null;
  }
  // Archfiend of Despair: "the life that player lost this turn" — each of the players in turn.
  const theirLife = /^the life (?:they|that player) (lost|gained) this turn$/.exec(t);
  if (theirLife && b.player?.ref === 'players') return { kind: 'life_this_turn', who: 'you', player: b.player, ...(theirLife[1] === 'lost' ? { stat: 'lost' as const } : {}) };
  // Volcanic Torrent: "the number of spells you've cast this turn".
  if (t === "the number of spells you've cast this turn") return { kind: 'spells_cast_this_turn' };
  // Thunder Salvo: "the number of other spells you've cast this turn" — not counting this spell.
  if (t === "the number of other spells you've cast this turn" && /\b(?:Instant|Sorcery)\b/.test(b.env.typeLine ?? '')) return { kind: 'spells_cast_this_turn', plus: -1 };
  // Hobgoblin Bandit Lord: "the number of Goblins that entered the battlefield under your control this turn".
  // Gyome, Master Chef: "the number of nontoken creatures you had enter the battlefield under your control this turn".
  const enteredThisTurn = /^the number of (.+?) (?:that entered|you had enter) the battlefield under your control this turn$/.exec(t);
  if (enteredThisTurn) {
    const pf = parseFilter(enteredThisTurn[1]!, b);
    if (pf && pf.plural && !pf.filter.zone && !pf.filter.controller) return { kind: 'entered_this_turn', filter: pf.filter };
  }
  // Chandra's Incinerator: "the total amount of noncombat damage dealt to your opponents this turn".
  // Notorious Throng: "the damage dealt to your opponents this turn"; Simulacrum: "the damage dealt to you this turn".
  // Knollspine Dragon: "the damage dealt to target opponent this turn" — that one player.
  // Militant Angel: "equal to the number of opponents you attacked this turn".
  if (t === 'the number of opponents you attacked this turn') return { kind: 'opponents_attacked', thisTurn: true };
  // Final Punishment: "the damage already dealt to that player this turn".
  const dealtToOne = /^the (?:amount of )?damage (?:already )?dealt to (target opponent|target player|that player) this turn$/.exec(t);
  if (dealtToOne) {
    const who = parsePlayerRef(dealtToOne[1]!, b);
    if (who && who.ref !== 'players' && who.ref !== 'you') return { kind: 'life_this_turn', who: 'you', player: who, stat: 'damage' };
  }
  const dealtTo = /^the (?:total )?(?:amount of )?(noncombat )?damage dealt to (your opponents|you) this turn$/.exec(t);
  if (dealtTo) return { kind: 'life_this_turn', who: dealtTo[2] === 'you' ? 'you' : 'opponents', stat: dealtTo[1] ? 'noncombat_damage' : 'damage' };
  // Call Forth the Tempest: "the total mana value of other spells you've cast this turn".
  if (t === "the total mana value of other spells you've cast this turn") return { kind: 'spells_cast_this_turn', totalMv: true, other: true };
  // Sawblade Skinripper: "the number of permanents you sacrificed this turn".
  const sacN = /^the number of (permanent|creature|artifact)s you(?:'ve)? sacrificed this turn$/.exec(t);
  if (sacN) return { kind: 'sacrificed_this_turn', mine: true, ...(sacN[1] !== 'permanent' ? { types: [capitalise(sacN[1]!)] } : {}) };
  // All-Fates Scroll: "the number of differently named lands you control".
  const named = /^the number of differently named (.+)$/.exec(t);
  if (named) {
    const pf = parseFilter(named[1]!, b);
    return pf && pf.plural && (!pf.filter.zone || pf.filter.zone === 'battlefield') ? { kind: 'distinct_names', filter: pf.filter } : null;
  }
  // Jaws of Defeat: "the difference between that creature's power and its toughness" — the larger minus the smaller.
  const pt = /^the difference between (that creature's|its|~'s) power and its toughness$/.exec(t);
  if (pt) {
    const of: Ref | null = pt[1] === "~'s" ? { ref: 'self' } : b.it;
    if (!of) return null;
    const p: AmountExpr = { kind: 'stat', stat: 'power', of };
    const q: AmountExpr = { kind: 'stat', stat: 'toughness', of };
    return { kind: 'max', parts: [{ kind: 'sum', parts: [p, { ...q, times: -1 }] }, { kind: 'sum', parts: [q, { ...p, times: -1 }] }] } as AmountExpr;
  }
  // The Ten Rings: "equal to the difference" — as the condition before it said.
  if (t === 'the difference' && b.difference) return b.difference;
  // Maester Seymour: "the number of counters among creatures you control" — every counter on them.
  // Hydra Trainer: "the number of counters on permanents you control" — the same, with "on".
  const among = /^the (?:total )?number of counters among (.+)$/.exec(t) ?? /^the (?:total )?number of counters on ((?:\S+ )*?(?:permanents|creatures|artifacts|lands|enchantments|planeswalkers) (?:you|your opponents) control)$/.exec(t);
  if (among) {
    const pf = parseFilter(among[1]!, b);
    return pf && pf.plural && !pf.filter.zone ? { kind: 'counters_among', filter: pf.filter } : null;
  }
  // Toph, the Blind Bandit: "the number of +1/+1 counters on lands you control" — that kind, on all of them.
  const kindOn = /^the (?:total )?number of ([+-]\d+\/[+-]\d+|\w+) counters on (.+)$/.exec(t);
  if (kindOn && !/^(?:~|it|him|her|this \w+|that \w+|target .+|enchanted .+|equipped .+)$/.test(kindOn[2]!)) {
    const pf = parseFilter(kindOn[2]!, b);
    if (pf && pf.plural && !pf.filter.zone) return { kind: 'counters_among', filter: pf.filter, counter: kindOn[1]! };
  }
  // Astarion: "Target opponent loses life equal to the amount of life they lost this turn." — that one player.
  const oneLife = /^the (?:amount of )?life (?:they|that player) (lost|gained) this turn$/.exec(t);
  if (oneLife && b.player && b.player.ref !== 'players' && b.player.ref !== 'you') return { kind: 'life_this_turn', who: 'you', player: b.player, ...(oneLife[1] === 'lost' ? { stat: 'lost' as const } : {}) };
  // "the amount of life you gained this turn", "the total amount of life your opponents have lost this turn"
  // Children of Korlis: "the life you've lost this turn".
  const lifeAmount = /^the (?:total )?(?:amount of )?life (.+?) this turn$/.exec(t);
  if (lifeAmount) return lifeThisTurn(lifeAmount[1]!);
  // Well of Lost Dreams: "Whenever you gain life, … the amount of life you gained" — how much the trigger event was.
  if (b.eventAmount && /^the amount of life you (?:gained|lost)$/.test(t)) return { kind: 'event' };
  // Purity: "You gain life equal to the damage prevented this way." (CR 615.5)
  if (b.eventAmount && /^the damage prevented this way$/.test(t)) return { kind: 'event' };
  // Tymna the Weaver: "the number of opponents that were dealt combat damage this turn"
  if (/^the number of opponents (?:that were |who were )?dealt combat damage this turn$/.test(t)) return { kind: 'players', who: 'opponents', combatDamaged: true };
  // Priest of the Blessed Graf: "the number of opponents who control more lands than you".
  const moreThanYou = /^the number of (opponents who control more .+? than you)$/.exec(t);
  if (moreThanYou) {
    const e = parseForEach(moreThanYou[1]!, b.clone());
    if (e) return e;
  }
  // Proft's Eidetic Memory: "the number of cards you've drawn this turn"
  if (/^the number of cards you've drawn this turn$/.test(t)) return { kind: 'drawn_this_turn' };
  // Thought Sponge: "the greatest number of cards an opponent has drawn this turn".
  if (t === 'the greatest number of cards an opponent has drawn this turn') return { kind: 'drawn_this_turn', who: 'opponents', max: true };
  // Thalisse, Reverent Medium: "the number of tokens you created this turn"
  if (/^the number of tokens you(?:'ve)? created this turn$/.test(t)) return { kind: 'tokens_created_this_turn' };
  // Combustible Gearhulk: "you mill three cards, then … the total mana value of those cards".
  if (b.milled && /^the total mana value of (?:those cards|the milled cards|the cards milled this way)$/.test(t)) return { kind: 'moved_this_way', how: 'milled', stat: 'mana_value' };
  // Foul Renewal: "Return target creature card from your graveyard to your hand. … where X is the toughness of the card
  // returned this way." — none if it wasn't (CR 608.2b).
  const returnedStat = /^the (power|toughness|mana value) of the card returned this way$/.exec(t);
  if (returnedStat) return { kind: 'moved_this_way', how: 'hand', stat: returnedStat[1] === 'mana value' ? 'mana_value' : (returnedStat[1] as 'power' | 'toughness') };
  // Mindshrieker: "Target player mills a card. … where X is the milled card's mana value." — the one card milled.
  if (b.milled && /^the milled card's mana value$/.test(t)) return { kind: 'moved_this_way', how: 'milled', stat: 'mana_value' };
  // Ghalta: "the total power of creatures you control"
  // The Skullspore Nexus: "the total power of those creatures" — the ones that died together.
  if (b.batchPower && t === 'the total power of those creatures') return { kind: 'event', stat: 'power' };
  const totalPower = /^the total (power|toughness|mana value) of (other )?(.+)$/.exec(t);
  if (totalPower) {
    // Summon: Bahamut: "the total mana value of other permanents you control" — other than the source.
    const pf = parseFilter(totalPower[3]!, b);
    const stat = totalPower[1] === 'mana value' ? { stat: 'mana_value' as const } : totalPower[1] === 'toughness' ? { stat: 'toughness' as const } : {};
    return pf && pf.plural && !pf.filter.zone ? { kind: 'total_power', filter: { ...pf.filter, ...(totalPower[2] ? { other: true } : {}) }, ...stat } : null;
  }
  // CR 903.4: "the number of colors in your commanders' color identity"
  if (/^the number of colors in your commanders?'s? color identity$/.test(t)) return { kind: 'commander_colors' };
  // Mockingbird: "the amount of mana spent to cast this creature" (CR 601.2h) — the mana paid for it.
  if (/^the amount of mana spent to cast (?:~|this creature|this spell|it)$/.test(t) && (t.endsWith(' it') ? !b.it || b.it.ref === 'self' : true)) return { kind: 'mana_spent', of: { ref: 'self' } };
  // Manaform Hellkite: "the amount of mana spent to cast that spell" — the spell a cast trigger is about (CR 601.2h).
  if (t === 'the amount of mana spent to cast that spell' && b.named['that spell']?.ref === 'trigger_object') return { kind: 'mana_spent', of: { ref: 'trigger_object' } };
  // Crystal, Inhuman Princess: "the number of colors that spell is" (CR 105.2).
  if (t === 'the number of colors that spell is' && b.named['that spell']) return { kind: 'stat', stat: 'colors', of: b.named['that spell']! };
  const twice = /^twice (.+)$/.exec(t);
  if (twice) {
    const inner = parseCount(twice[1]!, b);
    return inner ? { ...inner, times: (inner.times ?? 1) * 2 } : null;
  }
  // Black Vise: "the number of cards in their hand minus 4" (CR 107.1b: a negative result is 0 where it must be).
  const minus = /^(.+) minus (\d+|one|two|three|four|five)$/.exec(t);
  if (minus) {
    const n = parseAmount(minus[2]!);
    const inner = typeof n === 'number' ? parseCount(minus[1]!, b) : null;
    if (inner && typeof n === 'number' && !inner.times && !inner.half) return { ...inner, plus: (inner.plus ?? 0) - n };
  }
  // Dark Suspicions: "the number of cards in that player's hand minus the number of cards in your hand" (CR 107.1b).
  const less = /^(the number of .+?) minus (the number of .+)$/.exec(t);
  if (less) {
    const a = parseCount(less[1]!, b);
    const c = a ? parseCount(less[2]!, b) : null;
    if (a && c && !a.half && !c.half && a.atMost === undefined && c.atMost === undefined) return { kind: 'sum', parts: [a, { ...c, times: -(c.times ?? 1), ...(c.plus ? { plus: -c.plus } : {}) }] } as AmountExpr;
  }
  // The Rack, Wheel of Torture: "3 minus the number of cards in their hand" (CR 107.1b: a negative result is 0).
  const fromN = /^(\d+|one|two|three|four|five) minus (.+)$/.exec(t);
  if (fromN) {
    const n = parseAmount(fromN[1]!);
    const inner = typeof n === 'number' ? parseCount(fromN[2]!, b) : null;
    if (inner && typeof n === 'number' && !inner.half && inner.atMost === undefined) return { ...inner, times: -(inner.times ?? 1), plus: n - (inner.plus ?? 0) };
  }
  // Sea Gate Restoration: "the number of cards in your hand plus one"
  const plusAfter = /^(.+) plus (one|two|three|four|five)$/.exec(t);
  if (plusAfter && !/^\w+$/.test(plusAfter[1]!)) {
    const inner = parseCount(plusAfter[1]!, b);
    const n = parseAmount(plusAfter[2]!);
    if (inner && typeof n === 'number') return { ...inner, plus: (inner.plus ?? 0) + n };
  }
  // Ajani, Strength of the Pride: "the number of creatures you control plus the number of planeswalkers you control".
  const twoCounts = /^(the number of .+?) plus (the number of .+)$/.exec(t);
  if (twoCounts) {
    const one = parseCount(twoCounts[1]!, b.clone());
    const two = one ? parseCount(twoCounts[2]!, b.clone()) : null;
    if (one && two) return { kind: 'sum', parts: [one, two] };
  }
  // Predator's Rapport: "that creature's power plus its toughness" — both of the same object.
  const powerPlus = /^((?:that creature|its|~|this creature)'?s? power) plus its toughness$/.exec(t);
  if (powerPlus) {
    const one = parseCount(powerPlus[1]!.replace(/^its power$/, 'its power'), b.clone());
    if (one?.kind === 'stat' && one.stat === 'power') return { kind: 'sum', parts: [one, { ...one, stat: 'toughness' }] };
  }
  const plus = /^(\w+) plus (.+)$/.exec(t);
  if (plus) {
    const n = parseAmount(plus[1]!);
    const inner = typeof n === 'number' ? parseCount(plus[2]!, b) : null;
    return inner && typeof n === 'number' ? { ...inner, plus: (inner.plus ?? 0) + n } : null;
  }
  // CR 701.38: "the number of profit votes"
  const votes = /^the number of (.+) votes$/.exec(t);
  if (votes && b.votes.includes(votes[1]!)) return { kind: 'votes', option: votes[1]! };
  if (/^the number of colors of mana spent to cast (?:it|~|this spell)$/.test(t)) return { kind: 'colors_spent' };
  if (t === 'the number of creatures in your party') return { kind: 'party' };
  if (t === 'the number of basic land types among lands you control') return { kind: 'domain' };
  if (t === 'the number of card types among cards in your graveyard') return { kind: 'card_types' };
  if (t === 'the number of card types among cards in all graveyards') return { kind: 'card_types', whose: 'all' };
  if (t === "the number of card types among cards in your opponents' graveyards") return { kind: 'card_types', whose: 'opponents' };
  const number = /^the number of (.+)$/.exec(t);
  if (number) {
    const what = number[1]!;
    const moved = movedThisWay(what, b) ?? diedThisTurn(what, b);
    if (moved) return moved;
    if (what === 'opponents you have') return { kind: 'players', who: 'opponents' };
    // Meren: "the number of experience counters you have" (CR 122.1: counters on a player).
    const playerCounters = /^(\w+) counters you have$/.exec(what);
    if (playerCounters) return { kind: 'counters', of: { ref: 'you' }, counter: playerCounters[1]! };
    const handAtLeast = /^your opponents with (two|three|four|five|six|seven) or more cards in hand$/.exec(what);
    if (handAtLeast) return { kind: 'players', who: 'opponents', handAtLeast: parseAmount(handAtLeast[1]!) as number };
    // Within Range: "each opponent loses life equal to the number of creatures attacking them" — each their own.
    const attackingThem = /^(creatures) attacking (them|that player)$/.exec(what);
    const them = attackingThem ? (attackingThem[2] === 'that player' ? parsePlayerRef('that player', b.clone()) : b.player) : null;
    if (attackingThem && them && them.ref !== 'you') return { kind: 'count', filter: { types: ['Creature'], combat: 'attacking', attackingPlayerRef: them } };
    // Unlicensed Hearse: "the number of cards exiled with it" — whoever owns them (CR 607.2a).
    if (/^cards exiled with (?:~|it|this \w+)$/.test(what)) return { kind: 'cards', zone: 'exile', who: 'each', filter: { exiledWithSource: true } };
    const counters = /^(?:(\S+) )?counters on (.+)$/.exec(what);
    if (counters) {
      const of = parseObjectRef(counters[2]!, b.clone(), 'static');
      return of && !of.plural ? { kind: 'counters', of: of.ref, ...(counters[1] ? { counter: counters[1] } : {}) } : null;
    }
    return objects(what, b, true);
  }
  // Endless Ranks of the Dead: "half the number of Zombies you control, rounded down"
  const half = /^half (.+), rounded (up|down)$/.exec(t) ?? (b.halfDir ? /^half (the number of .+)$/.exec(t) : null);
  if (half) {
    const inner = parseCount(half[1]!, b);
    const dir = (half[2] as 'up' | 'down' | undefined) ?? b.halfDir!;
    return inner && !inner.half && !inner.times && !inner.plus ? { ...inner, half: dir } : null;
  }
  // CR 118.3 / 608.2h: "the sacrificed creature's power", "the discarded card's mana value" — as the cost was paid.
  // Food Chain: "1 plus the exiled creature's mana value" (an exile cost; see the activated rule).
  // Morbid Curiosity: "the mana value of the sacrificed permanent" — the same.
  const lkiOf = /^the (power|toughness|mana value) of the (sacrificed|discarded) (?:creature|artifact|permanent|card|land)$/.exec(t);
  const lki =
    /^the (sacrificed|discarded) (?:creature|artifact|enchantment|permanent|card|land)'s (power|toughness|mana value)$/.exec(t) ??
    /^the (exiled) (?:creature|artifact|permanent)'s (power|toughness|mana value)$/.exec(t) ??
    (lkiOf ? ([t, lkiOf[2], lkiOf[1]] as unknown as RegExpExecArray) : null);
  if (lki) {
    // Momentous Fall: "… equal to the sacrificed creature's power, then you gain life equal to its toughness."
    if (lki[1] === 'sacrificed' && (!b.it || b.it.ref === 'self')) b.it = { ref: 'sacrificed_this_way' };
    return { kind: 'cost_lki', cost: lki[1] as 'sacrificed' | 'discarded' | 'exiled', stat: lki[2] === 'mana value' ? 'mana_value' : (lki[2] as 'power' | 'toughness') };
  }
  // Skyclave Apparition: "the mana value of the exiled card"
  const statOfThe = /^the (power|toughness|mana value) of (.+)$/.exec(t);
  if (statOfThe) {
    // Soul's Majesty: "Draw cards equal to the power of target creature you control." — the target is the instruction's.
    const targeted = /^target /.test(statOfThe[2]!);
    const of = targeted ? parseObjectRef(statOfThe[2]!, b) : parseObjectRef(statOfThe[2]!, b.clone(), 'static');
    const s = statOfThe[1] === 'mana value' ? 'mana_value' : (statOfThe[1] as 'power' | 'toughness');
    if (of && !of.plural) return { kind: 'stat', stat: s, of: of.ref };
  }
  // CR 306.5c: "~'s loyalty" (Nissa, Ascended Animist) — the loyalty counters on it.
  if (t === "~'s loyalty") return { kind: 'counters', of: { ref: 'self' }, counter: 'loyalty' };
  // Death's Presence: "the power of the creature that died" — the trigger's creature, as it last existed (CR 608.2h).
  const diedStat = /^the (power|toughness) of the creature that died$/.exec(t);
  if (diedStat && b.named['that creature']?.ref === 'trigger_object') return { kind: 'stat', stat: diedStat[1] as 'power' | 'toughness', of: { ref: 'trigger_object' } };
  // "its power", "~'s toughness", "that creature's power", "the sacrificed creature's power".
  // Soul's Grace: "You gain life equal to target creature's power." — the target, chosen as it's cast (CR 601.2c).
  const targetStat = /^(target (?:creature|artifact|permanent)(?: you control| an opponent controls)?)'s (power|toughness|mana value)$/.exec(t);
  if (targetStat) {
    const of = parseObjectRef(targetStat[1]!, b);
    if (!of || of.plural || of.ref.ref !== 'target') return null;
    return { kind: 'stat', stat: targetStat[2] === 'mana value' ? 'mana_value' : (targetStat[2] as 'power' | 'toughness'), of: of.ref };
  }
  const stat = /^(.+?)(?:'s?)? (power|toughness|mana value)$/.exec(t);
  if (stat) {
    const subject = stat[1] === 'its' ? 'it' : stat[1]!.replace(/'s?$/, '');
    const of = parseObjectRef(subject, b.clone(), 'static');
    const s = stat[2] === 'mana value' ? 'mana_value' : (stat[2] as 'power' | 'toughness');
    // CR 608.2h: what was sacrificed, as it last existed on the battlefield.
    if (of?.ref.ref === 'sacrificed_this_way') return { kind: 'cost_lki', cost: 'sacrificed', stat: s };
    if (of?.ref.ref === 'discarded_this_way') return { kind: 'cost_lki', cost: 'discarded', stat: s };
    // Canopy Gargantuan: "on each other creature you control equal to that creature's toughness" — each its own; not one
    // number.
    return of && !of.plural && of.ref.ref !== 'all' ? { kind: 'stat', stat: s, of: of.ref } : null;
  }
  if (t === 'your life total') return { kind: 'life', who: { ref: 'you' } };
  // Sorin, Grim Nemesis: "the highest life total among all players"; "… among your opponents".
  const highest = /^the (?:highest|greatest) life total among (all players|your opponents)$/.exec(t);
  if (highest) return { kind: 'life', who: { ref: 'players', who: highest[1] === 'all players' ? 'each' : 'opponents' } as Ref, most: true };
  // Heartless Hidetsugu: "half that player's life total, rounded down" — each player's own (perPlayerCount).
  const lifeOf = /^(that player|that opponent|target player|target opponent|their)(?:'s)? life total$/.exec(t);
  if (lifeOf) {
    const who = parsePlayerRef(lifeOf[1] === 'their' ? 'that player' : lifeOf[1]!, b);
    if (who) return { kind: 'life', who };
  }
  // CR 706.2: "equal to the result", "where X is the result"
  if (t === 'the result') return { kind: 'die_result' };
  // Windfall: "the greatest number of cards a player discarded this way"; "the number of cards discarded this way"
  if (t === 'the greatest number of cards a player discarded this way') return { kind: 'discarded_this_way', max: true };
  if (t === 'the number of cards discarded this way') return { kind: 'discarded_this_way' };
  if (t === 'the damage dealt this way') return { kind: 'damage_this_way' };
  // CR 120.10: "the amount of excess damage dealt to that creature this way", "the excess damage dealt this way",
  // "that excess damage" (after "If excess damage was dealt this way").
  if (/^(?:the amount of excess damage|the excess damage|that excess damage)(?: dealt(?: to (?:that|the) (?:creature|permanent))?(?: this way)?)?$/.test(t)) return { kind: 'excess_this_way' };
  // "the greatest power among creatures you control", "the greatest mana value among cards in your graveyard"
  // Prime Speaker Zegana, Arbor Adherent: "… among other creatures you control" — other than the source.
  const greatest = /^the greatest (power|toughness|mana value) among (other )?(.+)$/.exec(t);
  // Ulamog, the Defiler: "the greatest mana value among cards in exile" — everyone's exiled cards.
  const inExile = greatest && !greatest[2] ? /^(?:(.+?) )?cards in exile$/.exec(greatest[3]!) : null;
  if (greatest && inExile) {
    const pf = inExile[1] ? parseFilter(`${inExile[1]} cards in your graveyard`, b) : { filter: {}, plural: true };
    if (!pf || !pf.plural) return null;
    const { zone: _z, owner: _o, ...rest } = pf.filter as ObjectFilter;
    return { kind: 'greatest', stat: greatest[1] === 'mana value' ? 'mana_value' : (greatest[1] as 'power' | 'toughness'), filter: { ...rest, zone: 'exile' } };
  }
  if (greatest) {
    const pf = parseFilter(greatest[3]!.replace(/ or an? /g, ' or '), b);
    if (!pf || !pf.plural || (greatest[2] && pf.filter.zone && pf.filter.zone !== 'battlefield')) return null;
    return { kind: 'greatest', stat: greatest[1] === 'mana value' ? 'mana_value' : (greatest[1] as 'power' | 'toughness'), filter: { ...pf.filter, ...(greatest[2] ? { other: true } : {}) } };
  }
  // CR 702.101a (extort): "the total life lost this way"
  if (t === 'the total life lost this way' || t === 'the life lost this way') return { kind: 'life_lost' };
  // CR 700.5: "your devotion to black", "your devotion to white and black".
  const devotion = /^your devotion to (\w+)(?: and (\w+))?$/.exec(t);
  if (devotion) {
    const colors = [devotion[1], devotion[2]].filter(Boolean).map((c) => COLOR_WORDS[c!]);
    return colors.every(Boolean) ? { kind: 'devotion', colors: colors as Color[] } : null;
  }
  return null;
}

/** Puts a counted amount where the text said X ("where X is …", "equal to …"). */
export function bindX(effects: EffectNode[], expr: AmountExpr): EffectNode[] {
  const sub = (v: unknown): unknown => {
    if (v === 'X') return expr;
    if (v && typeof v === 'object' && !Array.isArray(v) && (v as { kind?: string }).kind === 'x') {
      const t = (v as { times?: number }).times ?? 1;
      // Hellfire: "~ deals X plus 3 damage to you, where X is …" — the 3 stays.
      const plus = (expr.plus ?? 0) * t + ((v as { plus?: number }).plus ?? 0);
      return { ...expr, times: (expr.times ?? 1) * t, ...(plus ? { plus } : {}) };
    }
    return v;
  };
  // Eldritch Evolution: "a creature card with mana value X or less, where X is …"; Scourge of Fleets: "each creature your
  // opponents control with toughness X or less" — a comparison in a filter, wherever the filter is.
  const STATS = ['manaValue', 'power', 'toughness'] as const;
  const bindFilterX = (f: ObjectFilter): ObjectFilter => {
    const out: ObjectFilter = { ...f };
    for (const k of STATS) if (f[k]?.n === 'X') out[k] = { ...f[k]!, n: expr };
    return out;
  };
  const deep = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(deep);
    if (!v || typeof v !== 'object') return v;
    const o = v as Record<string, unknown>;
    if (o.ref && o.filter && typeof o.filter === 'object') return { ...o, filter: bindFilterX(o.filter as ObjectFilter) };
    return v;
  };
  return effects.map((e) => {
    const out: EffectNode = { ...e };
    for (const [k, v] of Object.entries(e)) {
      if ((k === 'effects' || k === 'then' || k === 'else' || k === 'cant') && Array.isArray(v)) out[k] = bindX(v as EffectNode[], expr);
      // Liliana of the Dark Realms: a choice between "+X/+X" and "-X/-X" (choose_one's options).
      else if (k === 'options' && e.type === 'choose_one' && Array.isArray(v)) out[k] = (v as EffectNode[][]).map((o) => bindX(o, expr));
      else if (k === 'filter' && v && typeof v === 'object') out[k] = bindFilterX(v as ObjectFilter);
      // Klauth: "add X mana in any combination of colors, where X is …".
      else if (k === 'combination' && v && typeof v === 'object') out[k] = { ...(v as object), amount: sub((v as { amount?: unknown }).amount) };
      else if (v && typeof v === 'object' && (v as { ref?: string }).ref) out[k] = deep(v);
      else out[k] = sub(v);
    }
    return out;
  });
}

/** Multiplies the one counted number in a clause ("draw a card for each …", "gets +1/+1 for each …"). */
export function scaleBy(effects: EffectNode[], expr: AmountExpr): EffectNode[] | null {
  let scaled = 0;
  const scale = (v: unknown): unknown => {
    if (typeof v === 'number') {
      if (v === 0) return 0;
      scaled++;
      // Outlaw Stitcher: "two +1/+1 counters … for each spell you've cast this turn other than the first" — 2 × (n − 1).
      return { ...expr, times: (expr.times ?? 1) * v, ...(expr.plus ? { plus: expr.plus * v } : {}) };
    }
    return v;
  };
  const out = effects.map((e) => {
    const n: EffectNode = { ...e };
    for (const key of ['amount', 'power', 'toughness']) if (key in e) n[key] = scale(e[key]);
    return n;
  });
  // "+1/+1" is one number scaled twice; anything else must have exactly one.
  const pt = out.length === 1 && 'power' in effects[0]! && 'toughness' in effects[0]!;
  return scaled === 1 || (pt && scaled <= 2 && scaled > 0) ? out : null;
}

export type { Amount };
