import type { AmountExpr, ConditionNode, ObjectFilter, Ref } from '@mtg/schema';
import { attempt, type Binder } from './binder.js';
import { parseFilter, parseObjectRef, parsePlayerRef, type ParsedFilter } from './nouns.js';
import { movedThisWay, parseCount } from './amounts.js';
import { capitalise, COLOR_WORDS, isSubtype, parseAmount, subtypeOf, TYPE_NOUNS } from './words.js';

/**
 * Conditions in "if" clauses: intervening "if" on triggers (CR 603.4) and
 * "If [condition], [effect]." sentences. Each returns a node the engine evaluates.
 */

function count(word: string): { min?: number; max?: number } | null {
  if (/^(?:a|an|another|at least one)$/.test(word)) return { min: 1 };
  if (word === 'no') return { max: 0 };
  const more = /^(\w+) or more$/.exec(word) ?? /^at least (\w+)$/.exec(word);
  if (more) {
    const n = parseAmount(more[1]!);
    return typeof n === 'number' ? { min: n } : null;
  }
  // Demonic Rising: "if you control exactly one creature".
  const exactly = /^exactly (\w+)$/.exec(word);
  if (exactly) {
    const n = parseAmount(exactly[1]!);
    return typeof n === 'number' ? { min: n, max: n } : null;
  }
  const fewer = /^(\w+) or (?:fewer|less)$/.exec(word);
  if (fewer) {
    const n = parseAmount(fewer[1]!);
    return typeof n === 'number' ? { max: n } : null;
  }
  return null;
}

const compare = (word: string): { op: 'ge' | 'le'; n: number } | null => {
  const m = /^(\w+) or (more|greater|less|fewer)$/.exec(word);
  const n = m ? parseAmount(m[1]!) : null;
  return m && typeof n === 'number' ? { op: m[2] === 'more' || m[2] === 'greater' ? 'ge' : 'le', n } : null;
};

/** What an object "is": "attacking", "blue", "legendary", "a Human or an Angel", "a creature". */
function stateFilter(text: string, b: Binder): ObjectFilter | null {
  const t = text.trim();
  if (t === 'attacking' || t === 'blocking') return { combat: t };
  if (t === 'attacking or blocking') return { combat: 'attacking_or_blocking' };
  // Security Bypass: "As long as enchanted creature is attacking alone" (CR 506.5).
  if (t === 'attacking alone') return { combat: 'attacking', attackingAlone: true };
  if (t === 'tapped' || t === 'untapped') return { tapped: t === 'tapped' };
  const color = COLOR_WORDS[t];
  if (color) return { colors: [color] };
  if (t === 'legendary') return { supertypes: ['Legendary'] };
  if (t === 'multicolored') return { multicolored: true };
  // Obstinate Gargoyle: "as long as it's modified" (CR 700.9: equipped, enchanted by an Aura its controller controls, or
  // with a counter on it).
  if (t === 'modified') return { modified: true };
  if (t === 'colorless') return { colorless: true };
  const pf = parseFilter(t.replace(/^an? /, '').replace(/ or an? /g, ' or '), b);
  return pf && !pf.plural ? pf.filter : null;
}

export function parseCondition(text: string, b: Binder): ConditionNode | null {
  // Catapult Fodder: "if you control three or more creatures that each have toughness greater than their power".
  const t = text.trim().replace(/ that each have toughness greater than their power$/, ' with toughness greater than its power');
  // Urza's Tower: "you control an Urza's Mine and an Urza's Power-Plant" — both.
  const both = /^you control (an? [^,]+?) and (an? .+)$/.exec(t.replace(/\bUrza's (Mine|Tower|Power-Plant)\b/g, '$1'));
  if (both) {
    const one = parseCondition(`you control ${both[1]}`, b);
    const two = one ? parseCondition(`you control ${both[2]}`, b) : null;
    if (one && two) return { type: 'and', all: [one, two] };
  }
  // Mine Worker: "you control creatures named Power Plant Worker and Tower Worker"; Throne of Empires: "artifacts named
  // Crown of Empires and Scepter of Empires" — one of each.
  const namedPair = /^you control (creatures|artifacts|lands|permanents) named ([A-Z][^,]+?) and ([A-Z].+)$/.exec(t);
  if (namedPair) {
    const kind = namedPair[1]!.replace(/s$/, '');
    const one = parseCondition(`you control a ${kind} named ${namedPair[2]}`, b);
    const two = one ? parseCondition(`you control a ${kind} named ${namedPair[3]}`, b) : null;
    if (one && two) return { type: 'and', all: [one, two] };
  }
  const single = parseOne(t, b);
  if (single) return single;
  // "you have 30 or more life and an opponent has 10 or less life"
  const parts = t.split(/ and (?=you |you've |an opponent |~ |there |it's )/);
  if (parts.length > 1) {
    const all = parts.map((p) => parseOne(p, b));
    if (all.every(Boolean)) return { type: 'and', all: all as ConditionNode[] };
  }
  // "if a nonland permanent left the battlefield this turn or a spell was warped this turn"
  // Dark Fortress: "if this land entered this turn or if you control a basic land".
  const either = t.split(/ or if | or (?=a |an |you |there |it's )/);
  if (either.length > 1) {
    const any = either.map((p) => parseOne(p, b));
    if (any.every(Boolean)) return { type: 'or', any: any as ConditionNode[] };
  }
  return null;
}

function parseOne(t: string, b: Binder): ConditionNode | null {
  // Dragon Whelp: "If this ability has been activated four or more times this turn".
  const activatedN = /^this ability has been activated (\w+) or more times this turn$/.exec(t);
  if (activatedN) {
    const n = parseAmount(activatedN[1]!);
    if (typeof n === 'number') return { type: 'activated_times', min: n };
  }
  // Omnath, Locus of Creation: "if this is the first time this ability has resolved this turn. If it's the second time, …";
  // Rose Room Treasurer: "if this is the first or second time this ability has resolved this turn".
  const nth = /^(?:this is|it's) the (first|second|third|fourth|fifth)(?: or (second|third|fourth))? time(?: this ability has resolved this turn)?$/.exec(t);
  if (nth && (/ this ability has resolved this turn$/.test(t) || t.startsWith("it's"))) {
    const ORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
    return nth[2] ? { type: 'ability_resolutions', max: ORD[nth[2]]! } : { type: 'ability_resolutions', n: ORD[nth[1]!]! };
  }
  // Haliya: "if you've gained 3 or more life this turn"; Bloodchief Ascension: "if an opponent lost 2 or more life this
  // turn"; Spinerock Knoll: "if an opponent was dealt 7 or more damage this turn".
  // Y'shtola, Night's Blessed: "if a player lost 4 or more life this turn".
  const lifeN =
    /^(you|an opponent|a player)(?:'ve| has| have)? (gained|lost) (\w+) or more life this turn$/.exec(t) ??
    /^(you|an opponent) (?:were|was) (dealt) (\w+) or more damage this turn$/.exec(t);
  if (lifeN) {
    const n = parseAmount(lifeN[3]!);
    const stat = lifeN[2] === 'dealt' ? 'damage' : lifeN[2] === 'lost' ? 'lost' : null;
    if (typeof n === 'number') return { type: 'amount', amount: { kind: 'life_this_turn', who: lifeN[1] === 'you' ? 'you' : lifeN[1] === 'a player' ? 'a_player' : 'an_opponent', ...(stat ? { stat } : {}) }, op: 'ge', n };
  }
  // Chandra, Fire of Kaladesh: "If Chandra has dealt 3 or more damage this turn".
  // CR 701.60: "If it's suspected", Rubblebelt Braggart: "if it's not suspected"; Repeat Offender: "If this creature is suspected".
  const itsSuspected = /^(it|that creature|this creature|~)(?:'s| is)( not)? suspected$/.exec(t);
  if (itsSuspected) {
    const of: Ref | null | undefined = itsSuspected[1] === 'this creature' || itsSuspected[1] === '~' ? { ref: 'self' } : b.it;
    if (of) return { type: 'is', of, filter: { suspected: !itsSuspected[2] } };
  }
  const srcDealt = /^(?:~|it|this creature) has dealt (\w+) or more damage this turn$/.exec(t);
  if (srcDealt) {
    const n = parseAmount(srcDealt[1]!);
    if (typeof n === 'number') return { type: 'amount', amount: { kind: 'source_damage_this_turn' }, op: 'ge', n };
  }
  // Proft's Eidetic Memory: "if you've drawn more than one card this turn"; "… two or more cards this turn".
  const drewN = /^you(?:'ve| have)? drawn (?:(more than one) card|(\w+) or more cards) this turn$/.exec(t);
  if (drewN) {
    const n = drewN[1] ? 2 : parseAmount(drewN[2]!);
    if (typeof n === 'number') return { type: 'amount', amount: { kind: 'drawn_this_turn' }, op: 'ge', n };
  }
  // Lunar Convocation: "if you gained and lost life this turn".
  if (t === 'you gained and lost life this turn') {
    return { type: 'and', all: [{ type: 'amount', amount: { kind: 'life_this_turn', who: 'you' }, op: 'ge', n: 1 }, { type: 'amount', amount: { kind: 'life_this_turn', who: 'you', stat: 'lost' }, op: 'ge', n: 1 }] };
  }
  // Queen Marchesa: "if an opponent is the monarch" (CR 725).
  if (t === 'an opponent is the monarch') return { type: 'monarch', opponent: true };
  // Pyrohemia: "if no creatures are on the battlefield".
  const noneThere = /^(?:no (.+?) are on the battlefield|there are no (.+?) on the battlefield)$/.exec(t);
  if (noneThere) {
    const pf = parseFilter(noneThere[1] ?? noneThere[2]!, b);
    if (pf && pf.plural && !pf.filter.zone) return { type: 'count', who: 'all', filter: pf.filter, max: 0 };
  }
  // Cosmos Elixir: "if your life total is greater than your starting life total" (CR 103.4).
  // Path of Bravery: "As long as your life total is greater than or equal to your starting life total".
  const vsStart = /^your life total is (greater|less) than (or equal to )?your starting life total$/.exec(t);
  if (vsStart) return { type: 'life', op: vsStart[1] === 'greater' ? (vsStart[2] ? 'ge' : 'gt') : vsStart[2] ? 'le' : 'lt', starting: true };
  // Game Over: "if a player's life total is less than or equal to half their starting life total".
  const halfStart = /^(a player's|an opponent's|your) life total is less than or equal to half (?:their|your) starting life total$/.exec(t);
  if (halfStart) return { type: 'life', halfStarting: halfStart[1] === "a player's" ? 'any' : halfStart[1] === 'your' ? 'you' : 'opponent' };
  // Elderscale Wurm: "if your life total is less than 7".
  const vsN = /^your life total is (greater|less) than (\d+)$/.exec(t);
  if (vsN) return { type: 'life', op: vsN[1] === 'greater' ? 'gt' : 'lt', n: Number(vsN[2]) };
  // Scourge of the Throne: "if it's attacking the player with the most life or tied for most life".
  if (/^(?:it's|~ is) attacking the player with the most life or tied for most life$/.test(t)) return { type: 'life', attackingMost: true };
  // Guild Artisan: "if no opponent has more life than that player" — that player has the most life among opponents.
  const noMore = /^no opponent has more life than (that player|defending player)$/.exec(t);
  if (noMore) {
    const of = parsePlayerRef(noMore[1]!, b);
    return of ? { type: 'life', mostAmongOpponents: true, of } : null;
  }
  // Battle Angels of Tyr: "that player has more cards in hand than each other player", "… controls more lands than each
  // other player", "… has more life than each other player" — strictly the most.
  const most = /^(that player|you) (has|have|controls?) more (cards in hand|lands|life) than each other player$/.exec(t);
  if (most) {
    const of = parsePlayerRef(most[1]!, b);
    return of ? { type: 'most_of', of, what: most[3] === 'cards in hand' ? 'hand' : most[3] === 'lands' ? 'lands' : 'life' } : null;
  }
  // Preacher of the Schism: "you have the most life or are tied for most life"
  if (/^you have the most life or are tied for (?:the )?most life$/.test(t)) return { type: 'life', most: true };
  // Righteous Valkyrie: "you have at least 7 life more than your starting life total"
  // Elenda, Saint of Dusk: "your life total is at least 10 greater than your starting life total".
  const moreThanStart = /^you have at least (\w+) life more than your starting life total$/.exec(t) ?? /^your life total is at least (\w+) greater than your starting life total$/.exec(t);
  if (moreThanStart && typeof parseAmount(moreThanStart[1]!) === 'number') return { type: 'life', op: 'ge', starting: true, plus: parseAmount(moreThanStart[1]!) as number };
  // Thickest in the Thicket: "if you control the creature with the greatest power or tied for the greatest power".
  if (t === 'you control the creature with the greatest power or tied for the greatest power') return { type: 'greatest_power', filter: { types: ['Creature'] } };
  // Abzan Beastmaster: "if you control the creature with the greatest toughness or tied for the greatest toughness".
  if (t === 'you control the creature with the greatest toughness or tied for the greatest toughness') return { type: 'greatest_power', filter: { types: ['Creature'] }, stat: 'toughness' };
  // High Score: "if you control a creature with the greatest power among creatures on the battlefield" (ties count).
  if (t === 'you control a creature with the greatest power among creatures on the battlefield') return { type: 'greatest_power', filter: { types: ['Creature'] } };
  // The Chain Veil: "if you didn't activate a loyalty ability of a planeswalker this turn".
  if (t === "you didn't activate a loyalty ability of a planeswalker this turn") return { type: 'not', cond: { type: 'this_turn', event: 'you_activated_loyalty' } };
  // Ghirapur Orrery: "if that player has no cards in hand" — the player the trigger is about.
  if (t === 'that player has no cards in hand' && b.player) return { type: 'hand', op: 'le', n: 0, who: b.player };
  // Bandit's Talent: "if that player has one or fewer cards in hand".
  const thatHand = /^that player has (\w+ or (?:fewer|more)) cards in hand$/.exec(t);
  if (thatHand && b.player && b.player.ref !== 'players') {
    const c = compare(thatHand[1]!);
    return c ? { type: 'hand', ...c, who: b.player } : null;
  }
  if (t === "it's the first combat phase of the turn") return { type: 'first_combat' };
  // Firemane Commando: "if none of those creatures attacked you" — the attackers just declared.
  if (t === 'none of those creatures attacked you' && b.named['those creatures']) return { type: 'attacking_you', max: 0 };
  // CR 120.10: "If excess damage was dealt this way", "… to that creature this way", "… to a permanent this way".
  if (/^excess damage was dealt (?:to (?:that creature|that permanent|a permanent|a creature) )?this way$/.test(t)) return { type: 'amount', amount: { kind: 'excess_this_way' }, op: 'ge', n: 1 };
  // Saw in Half: "If that creature dies this way" — put into a graveyard from the battlefield by this (CR 700.4).
  if (/^(?:that creature|it) dies this way$/.test(t)) return { type: 'amount', amount: { kind: 'moved_this_way', how: 'graveyard' }, op: 'ge', n: 1 };
  // Noxious Gearhulk: "If a creature is destroyed this way, you gain life equal to its toughness."
  // Renegade Reaper: "If at least one Angel card is milled this way".
  const movedOne = /^(?:a|an|at least one) (.+?) (?:is|was) (destroyed|exiled|sacrificed|returned|milled) this way$/.exec(t) ?? /^(another .+?) (?:is|was) (returned) this way$/.exec(t);
  if (movedOne) {
    const amount = movedThisWay(`${movedOne[1]} ${movedOne[2]} this way`, b);
    if (amount) return { type: 'amount', amount, op: 'ge', n: 1 };
  }
  // Turntimber Symbiosis: "If that card has mana value 3 or less".
  const hasMV = /^(that card|that creature|it) has mana value (\d+) or (less|greater)$/.exec(t);
  if (hasMV) {
    const of = b.named[hasMV[1]!] ?? (hasMV[1] === 'it' ? b.it : null);
    if (of) return { type: 'is', of, filter: { manaValue: { op: hasMV[3] === 'less' ? 'le' : 'ge', n: Number(hasMV[2]) } } };
  }
  // Boomerang Basics: "If you controlled that permanent, draw a card." — as the spell began to resolve (CR 608.2h).
  if (/^you controlled (?:that permanent|that creature|that artifact|it)$/.test(t)) {
    const of = b.named[t.replace(/^you controlled /, '')] ?? (b.it && b.it.ref === 'target' ? b.it : null);
    if (of && of.ref === 'target') return { type: 'controlled_it', of };
  }
  // Reject Imperfection: "If that spell's mana value was 3 or less"; Serum Snare: "If that permanent had mana value 3 or
  // less" — the target, wherever it is now.
  // Fading Hope: "If its mana value was 3 or less".
  const targetMV = /^(?:that (?:spell|permanent|creature|card)'s mana value was|that (?:spell|permanent|creature|card) had mana value|it had mana value|its mana value was) (\d+) or (less|greater)$/.exec(t);
  if (targetMV && b.it?.ref === 'target') return { type: 'amount', amount: { kind: 'stat', stat: 'mana_value', of: b.it }, op: targetMV[2] === 'less' ? 'le' : 'ge', n: Number(targetMV[1]) };
  // Glorious Gale: "Counter target creature spell. If it was a legendary spell, the Ring tempts you."
  if (/^(?:it|that spell) was a legendary spell$/.test(t) && b.it?.ref === 'target') return { type: 'is', of: b.it, filter: { supertypes: ['Legendary'] } };
  // Jace's Defeat: "Counter target blue spell. If it was a Jace planeswalker spell, scry 2." — the card it was.
  const wasSpell = /^(?:it|that spell) was an? (.+? spell)$/.exec(t);
  if (wasSpell && b.it?.ref === 'target') {
    const pf = parseFilter(wasSpell[1]!, b.clone());
    if (pf && !pf.plural && pf.filter.zone === 'stack') {
      const { zone: _z, ...filter } = pf.filter;
      if (Object.keys(filter).length && Object.keys(filter).every((k) => ['types', 'subtypes', 'supertypes', 'colors', 'notTypes'].includes(k))) return { type: 'is', of: b.it, filter };
    }
  }
  // Avatar of Woe: "if there are ten or more creature cards total in all graveyards".
  const allGy = /^there are (\w+) or more (.+?) cards (?:total )?in all graveyards$/.exec(t);
  if (allGy) {
    const n = parseAmount(allGy[1]!);
    const pf = typeof n === 'number' ? parseFilter(`${allGy[2]} cards in all graveyards`, b.clone()) : null;
    if (pf && typeof n === 'number') {
      const { zone: _z, ...filter } = pf.filter;
      return { type: 'amount', amount: { kind: 'cards', zone: 'graveyard', who: 'each', filter }, op: 'ge', n };
    }
  }
  // Ringwraiths: "If that creature is legendary, its controller loses 3 life." — the target, now.
  if (/^(?:that creature|it) is legendary$/.test(t)) {
    const of = b.named['that creature'] ?? (b.it && b.it.ref !== 'self' ? b.it : null);
    if (of) return { type: 'is', of, filter: { supertypes: ['Legendary'] } };
  }
  // Emeria Shepherd: "If that land is a Plains" — the land that entered.
  const thatIs = /^that (land|creature|permanent) is an? ([A-Z][a-z]+)$/.exec(t);
  const thatOne = b.it?.ref === 'trigger_object' ? b.it : thatIs && b.named[`that ${thatIs[1]}`]?.ref === 'trigger_object' ? b.named[`that ${thatIs[1]}`]! : null;
  if (thatIs && thatOne && subtypeOf(thatIs[2]!) === thatIs[2]) return { type: 'is', of: thatOne, filter: { subtypes: [thatIs[2]!] } };
  // Phelia: "return that card to the battlefield under its owner's control. If it entered under your control, …" — it's
  // on the battlefield, and you control it.
  if (/^(?:it|that card|that permanent) entered (?:the battlefield )?under your control$/.test(t) && b.it && b.it.ref !== 'self') return { type: 'is', of: b.it, filter: { zone: 'battlefield', controller: 'you' } };
  // Valakut Exploration: "if there are cards exiled with this enchantment" (CR 607.2a).
  // Ugin's Labyrinth: "If a card is exiled with this land".
  if (/^there (?:are|is) (?:one or more )?cards? exiled with ~$|^(?:a card is|one or more cards are) exiled with ~$/.test(t)) return { type: 'amount', amount: { kind: 'cards', zone: 'exile', who: 'each', filter: { exiledWithSource: true } }, op: 'ge', n: 1 };
  // Bonehoard Dracosaur: "If you exiled a land card this way", "If you exiled a nonland card this way".
  const youMoved = /^you (exiled|milled|sacrificed|destroyed) (?:a|an|one or more) (.+?) this way$/.exec(t);
  if (youMoved) {
    const amount = movedThisWay(`${youMoved[2]} ${youMoved[1]} this way`, b);
    // "If you sacrificed a creature this way" after "Each player sacrifices …" — only yours.
    if (amount) return { type: 'amount', amount: youMoved[1] === 'sacrificed' ? { ...amount, yours: true } : amount, op: 'ge', n: 1 } as ConditionNode;
  }
  // Padeem: "if you control the artifact with the greatest mana value or tied for the greatest mana value"
  const greatest = /^you control the (\w+) with the greatest mana value or tied for the greatest mana value$/.exec(t);
  if (greatest) {
    const pf = parseFilter(greatest[1]!, b);
    if (pf && !pf.plural && !pf.filter.zone) return { type: 'greatest_mv', filter: pf.filter };
  }
  // Guardian Project: "if it doesn't have the same name as another creature you control or a creature card in your graveyard"
  if (/^it doesn't have the same name as another creature you control or a creature card in your graveyard$/.test(t) && b.it) return { type: 'unique_name', of: b.it };
  // Howltooth Hollow: "if each player has no cards in hand"; Shelldock Isle: "if a library has twenty or fewer cards in it"
  if (/^each player has no cards in hand$/.test(t)) return { type: 'amount', amount: { kind: 'cards', zone: 'hand', who: 'each' }, op: 'eq', n: 0 };
  const aLibrary = /^a library has (\w+) or fewer cards in it$/.exec(t);
  if (aLibrary) {
    const n = parseAmount(aLibrary[1]!);
    if (typeof n === 'number') return { type: 'amount', amount: { kind: 'cards', zone: 'library', who: 'each', least: true }, op: 'le', n };
  }
  // Triskaidekaphile: "if you have exactly thirteen cards in your hand"
  const exactlyHand = /^you have exactly (\w+) cards in (?:your )?hand$/.exec(t);
  if (exactlyHand) {
    const n = parseAmount(exactlyHand[1]!);
    if (typeof n === 'number') return { type: 'amount', amount: { kind: 'cards', zone: 'hand', who: 'you' }, op: 'eq', n };
  }
  // Lieutenant (Loyal Apprentice): "if you control your commander" — a commander you own (CR 903.3).
  if (t === 'you control your commander') return { type: 'count', who: 'you', filter: { commander: true, owner: 'you' }, min: 1 };
  // Crimson Honor Guard: "unless they control a commander" — anyone's commander, controlled by that player.
  const theyCommander = /^(?:they|that player) (?:controls?|control) a commander$/.exec(t);
  if (theyCommander && b.player && b.player.ref !== 'you' && b.player.ref !== 'players') return { type: 'amount', amount: { kind: 'count', filter: { commander: true, controlledBy: b.player } }, op: 'ge', n: 1 };
  // Jace, Wielder of Mysteries: "if your library has no cards in it"
  if (/^your library has no cards in it$/.test(t)) return { type: 'amount', amount: { kind: 'cards', zone: 'library', who: 'you' }, op: 'eq', n: 0 };
  // Mechanized Production: "you control eight or more artifacts with the same name as one another"; Sceptre of Eternal
  // Glory: "you control three or more lands with the same name".
  const sameName = /^you control (\w+) or more (.+?) with the same name(?: as one another)?$/.exec(t);
  if (sameName) {
    const n = parseAmount(sameName[1]!);
    const pf = parseFilter(sameName[2]!, b.clone());
    if (typeof n === 'number' && pf && pf.plural && !pf.filter.zone && !pf.filter.controller) return { type: 'same_name', filter: pf.filter, min: n };
  }
  // Field of the Dead: "you control seven or more lands with different names"
  const names = /^you control (\w+ or more) (.+?) with different names$/.exec(t);
  if (names) {
    const c = count(names[1]!);
    const pf = parseFilter(names[2]!, b);
    if (c && pf && pf.plural && !pf.filter.zone && !pf.filter.controller) return { type: 'distinct_names', filter: pf.filter, ...c };
  }
  // CR 731: "if it's night", "if it's day", "if it's neither day nor night"
  const dayNight = /^it(?:'s| is) (day|night|neither day nor night)$/.exec(t);
  if (dayNight) return { type: 'day_night', is: dayNight[1] === 'neither day nor night' ? 'neither' : dayNight[1] };
  // CR 722.3a: "if this creature isn't prepared"
  const prepared = /^(?:it|~) (is|isn't) prepared$/.exec(t);
  if (prepared) return { type: 'prepared', ...(prepared[1] === "isn't" ? { not: true } : {}) };
  // CR 309.7: "if you've completed a dungeon", "if you haven't completed Tomb of Annihilation"; CR 726: "if you have the initiative"
  const completed = /^you(?:'ve| have)( not|n't)? completed (a dungeon|.+)$/.exec(t) ?? /^you have(n't| not) completed (a dungeon|.+)$/.exec(t);
  if (completed) return { type: 'completed_dungeon', ...(completed[2] !== 'a dungeon' ? { name: completed[2] } : {}), ...(completed[1] ? { not: true } : {}) };
  if (t === 'you have the initiative') return { type: 'initiative' };
  if (t === "you don't have the initiative") return { type: 'initiative', not: true };
  // CR 701.54e: "if ~ is your Ring-bearer", "if you don't control a Ring-bearer", "if you chose a creature other than ~ …"
  const bearer = /^(?:it|~) (is|isn't) your Ring-bearer$/.exec(t);
  if (bearer) return { type: 'ring_bearer', ...(bearer[1] === "isn't" ? { not: true } : {}) };
  if (/^you (?:don't|do not) control a Ring-bearer$/.test(t)) return { type: 'ring_bearer', any: true, not: true };
  if (/^you control a Ring-bearer$/.test(t)) return { type: 'ring_bearer', any: true };
  if (t === 'you chose a creature other than ~ as your Ring-bearer') return { type: 'chose_other_ring_bearer' };
  // CR 702.171b (saddle): "if it's saddled", "~ is saddled"
  if (/^(?:it(?:'s| is)|~ is) saddled$/.test(t)) return { type: 'saddled' };
  // CR 702.54a (bloodthirst): "if an opponent was dealt damage this turn"
  // Bloodcrazed Goblin: "unless an opponent has been dealt damage this turn".
  if (/^an opponent (?:was|has been) dealt damage this turn$/.test(t)) return { type: 'this_turn', event: 'opponent_damaged' };
  // Antagonism: "unless one of their opponents was dealt damage this turn" — the opponents of the player the trigger is about.
  if (/^one of (?:their|that player's) opponents (?:was|has been) dealt damage this turn$/.test(t) && b.player?.ref === 'trigger_player') return { type: 'this_turn', event: 'opponent_damaged', of: b.player };
  // Surge (CR 702.117a): "if you or one of your teammates has cast another spell this turn"
  // (Not the spell this source is or was: an enters trigger checks after it was cast.)
  if (/^(?:you or one of your teammates has|you've) cast another spell this turn$/.test(t)) return { type: 'this_turn', event: 'you_cast', min: 1, other: true };
  // CR 702.112b (renown): "if it isn't renowned", "as long as ~ is renowned"
  const renowned = /^(?:it|~) (is|isn't) renowned$/.exec(t);
  if (renowned) return { type: 'renowned', ...(renowned[1] === "isn't" ? { not: true } : {}) };
  // CR 702.30a (echo): "if this permanent came under your control since the beginning of your last upkeep"
  if (/^~ came under your control since the beginning of your last upkeep$/.test(t)) return { type: 'arrived_since_upkeep' };
  // CR 702.24a (cumulative upkeep): "if this permanent is on the battlefield"
  if (/^~ is on the battlefield$/.test(t)) return { type: 'is', of: { ref: 'self' }, filter: {} };
  // "if ~ attacked this turn" (as this object, CR 400.7).
  if (/^~ attacked this turn$/.test(t)) return { type: 'is', of: { ref: 'self' }, filter: { attackedThisTurn: true } };
  // Wall of Resistance: "if this creature was dealt damage this turn" (as this object, CR 400.7).
  if (/^~ was dealt damage this turn$/.test(t)) return { type: 'is', of: { ref: 'self' }, filter: { damagedThisTurn: true } };
  // Agent Frank Horrigan: "~ has indestructible as long as it attacked this turn" — "it" being this object.
  if (/^it attacked this turn$/.test(t) && (!b.it || b.it.ref === 'self')) return { type: 'is', of: { ref: 'self' }, filter: { attackedThisTurn: true } };
  // Berserk: "destroy that creature if it attacked this turn" — the target.
  if (/^it attacked this turn$/.test(t) && b.it?.ref === 'target') return { type: 'is', of: b.it, filter: { attackedThisTurn: true } };
  // Vaultborn Tyrant: "When this creature dies, if it's not a token, …" — a token that died has ceased to exist.
  if (/^(?:it's not|it isn't|it wasn't|it was not|~ isn't|~ wasn't|~ is not|~ was not) a token$/.test(t)) return { type: 'is', of: b.it ?? { ref: 'self' }, filter: { token: false } };
  // CR 702.194b: "if this spell was cast using teamwork"
  if (/^(?:~|this spell|it) was cast using teamwork$/.test(t)) return { type: 'paid', cost: 'teamwork' };
  // CR 702.174: "if the gift was promised", "if the gift wasn't promised"
  const promised = /^the gift (was|wasn't|was not) promised$/.exec(t);
  if (promised) return { type: 'paid', cost: 'gift', ...(promised[1] !== 'was' ? { not: true } : {}) };
  // CR 702.138c: "unless it escaped" — cast with its escape cost.
  if (/^(?:it|~) escaped$/.test(t)) return { type: 'paid', cost: 'escape' };
  // CR 702.166b: "if this spell was bargained"
  if (/^(?:~|it) was bargained$/.test(t)) return { type: 'paid', cost: 'bargain' };
  // Face of Divinity: "As long as another Aura is attached to enchanted creature" — anyone's.
  const alsoOn = /^another (Aura|Equipment) is attached to (?:enchanted|equipped) creature$/.exec(t);
  if (alsoOn) return { type: 'count', who: 'all', filter: { subtypes: [alsoOn[1]!], attachedTo: 'attached', other: true }, min: 1 };
  // CR 702.143c: Poison the Cup: "If this spell was foretold" — cast for its foretell cost.
  if (/^(?:~|it) was foretold$/.test(t)) return { type: 'paid', cost: 'foretell' };
  // "if its evoke cost was paid", "if this spell's dash cost was paid", "if the buyback cost was paid" (CR 601.2f).
  const paid = /^(?:its|~'s|the|her|his) (\w+) cost was paid$/.exec(t) ?? /^an? (\w+) cost was paid for (?:it|~)$/.exec(t);
  if (paid) return { type: 'paid', cost: paid[1]!.toLowerCase() };
  // The Mastery cycle: "You may pay {1}{B} rather than pay this spell's mana cost. … If the {1}{B} cost was paid, …" — the
  // alternative cost (its option is "alt").
  if (/^the (?:\{[^}]+\})+ cost was paid$/.test(t)) return { type: 'paid', cost: 'alt' };
  // Littjara Kinseekers: "if you control three or more creatures that share a creature type".
  // Synchronized Eviction: "if you control at least two creatures that share a creature type" — the same.
  const sharing = /^you control (\w+) or more creatures that share a creature type$/.exec(t) ?? /^you control at least (\w+) creatures that share a creature type$/.exec(t);
  if (sharing && typeof parseAmount(sharing[1]!) === 'number') return { type: 'amount', amount: { kind: 'most_sharing_type', filter: { types: ['Creature'], controller: 'you' } }, op: 'ge', n: parseAmount(sharing[1]!) as number };
  // Chrome Courier: "If you put an artifact card into your hand this way"; Town Greeter: "If you put a Town card …".
  const putHand = /^you put an? (.+? card) into your hand this way$/.exec(t);
  if (putHand) {
    const amount = movedThisWay(`${putHand[1]} put into your hand this way`, b);
    if (amount) return { type: 'amount', amount, op: 'ge', n: 1 };
  }
  // Spelunking: "If you put a Cave onto the battlefield this way" — what the effect before put there.
  const putThisWay = /^you put an? (.+?) onto the battlefield this way$/.exec(t);
  if (putThisWay) {
    const pf = parseFilter(putThisWay[1]!, b);
    return pf && !pf.plural && !pf.filter.zone ? { type: 'is', of: { ref: 'created' }, filter: pf.filter } : null;
  }
  // Addendum: "If you cast this spell during your main phase" (a copy wasn't cast, CR 707.10).
  if (/^you cast (?:~|this spell) during your main phase$/.test(t)) return { type: 'cast_in_main_phase' };
  // CR 702.33d: "if it was kicked" / "if this spell was kicked".
  if (/^(?:it|~|he|she) was kicked$/.test(t)) return { type: 'kicked' };
  // CR 702.104b: "if tribute wasn't paid".
  if (t === "tribute wasn't paid") return { type: 'not', cond: { type: 'tribute_paid' } };
  if (t === 'tribute was paid') return { type: 'tribute_paid' };
  // Sphinx of Lost Truths: "if it wasn't kicked".
  if (/^(?:it|~|he|she) wasn't kicked$/.test(t)) return { type: 'not', cond: { type: 'kicked' } };
  // Sevinne's Reclamation: "If this spell was cast from a graveyard"; "if this spell was cast from your hand" (a copy wasn't
  // cast, CR 707.10).
  // Anti-Venom: "When Anti-Venom enters, if he was cast" — by anyone (CR 601.2: it was a spell before it entered).
  // Mirror of Life Trapping: "Whenever a creature enters, if it was cast" — the entering creature.
  if (/^(?:~|it|he|she) was cast$/.test(t)) return { type: 'cast_by_you', anyone: true, ...(!t.startsWith('~') && b.it && b.it.ref !== 'self' ? { of: b.it } : {}) };
  // Otterball Antics: "If this spell was cast from anywhere other than your hand" — cast, and not from there.
  // Twinned Vision: "If this spell wasn't cast from your hand" — a copy wasn't cast at all (CR 707.10), so it holds.
  if (t === "~ wasn't cast from your hand") return { type: 'not', cond: { type: 'cast_by_you', fromHand: true } };
  if (t === '~ was cast from anywhere other than your hand') return { type: 'and', all: [{ type: 'cast_by_you' }, { type: 'not', cond: { type: 'cast_by_you', fromHand: true } }] };
  const castFrom = /^~ was cast from (your hand|a graveyard|exile)$/.exec(t);
  if (castFrom) return { type: 'cast_by_you', ...(castFrom[1] === 'your hand' ? { fromHand: true } : { from: castFrom[1] === 'exile' ? 'exile' : 'graveyard' }) };
  // Approach of the Second Sun: "you've cast another spell named ~ this game".
  if (t === "you've cast another spell named ~ this game") return { type: 'cast_named_before' };
  const cast = /^you (cast|didn't cast) it( from your hand)?$/.exec(t);
  // "Whenever a creature you control enters, if you cast it, …": "it" is the entering creature.
  // Chainer, Nightmare Adept: "if you didn't cast it from your hand".
  if (cast) {
    const cond: ConditionNode = { type: 'cast_by_you', ...(cast[2] ? { fromHand: true } : {}), ...(b.it && b.it.ref !== 'self' ? { of: b.it } : {}) };
    return cast[1] === 'cast' ? cond : { type: 'not', cond };
  }
  const state = /^~ is (tapped|untapped)$/.exec(t);
  if (state) return { type: 'self_tapped', tapped: state[1] === 'tapped' };
  // "~ is equipped", "~ is enchanted" — something of that kind is attached to it.
  // The Reality Chip: "~ is attached to a creature" — what it's attached to is one.
  const attachedTo = /^(?:~|it) is attached to (a|an) (creature|permanent|land|artifact)$/.exec(t);
  if (attachedTo) return { type: 'is', of: { ref: 'attached' }, filter: attachedTo[2] === 'permanent' ? {} : { types: [capitalise(attachedTo[2]!)] } };
  // Brass Knuckles: "Equipped creature has double strike as long as two or more Equipment are attached to it."
  const manyAttached = /^(two|three|four) or more (Equipment|Auras) are attached to it$/.exec(t);
  if (manyAttached && (b.it?.ref === 'attached' || (!b.it && /\b(?:Equipment|Aura)\b/.test(b.env.typeLine)))) {
    return { type: 'amount', amount: { kind: 'count', filter: { subtypes: [manyAttached[2] === 'Auras' ? 'Aura' : 'Equipment'], attachedTo: 'attached' } }, op: 'ge', n: parseAmount(manyAttached[1]!) as number };
  }
  // Balan, Wandering Knight: "~ has double strike as long as two or more Equipment are attached to it."
  if (manyAttached && b.it?.ref === 'self') {
    return { type: 'amount', amount: { kind: 'count', filter: { subtypes: [manyAttached[2] === 'Auras' ? 'Aura' : 'Equipment'], attachedTo: 'self' } }, op: 'ge', n: parseAmount(manyAttached[1]!) as number };
  }
  // Merry, Esquire of Rohan: "~ has first strike as long as it's equipped" — "it" being this creature.
  const attached = /^~ is (equipped|enchanted)$/.exec(t) ?? (/^it's (equipped|enchanted)$/.test(t) && (!b.it || b.it.ref === 'self') ? /^it's (equipped|enchanted)$/.exec(t) : null);
  if (attached) return { type: 'has_attached', subtype: attached[1] === 'equipped' ? 'Equipment' : 'Aura' };
  // Warchanter Skald: "if it's enchanted or equipped" — either.
  if ((t === "it's enchanted or equipped" || t === '~ is enchanted or equipped') && (!b.it || b.it.ref === 'self')) return { type: 'or', any: [{ type: 'has_attached', subtype: 'Aura' }, { type: 'has_attached', subtype: 'Equipment' }] };
  // Awaken the Sleeper: "Gain control of target creature …. If it's equipped, …" — an Equipment is attached to that creature.
  const otherAttached = /^(?:it's|that creature is) (equipped|enchanted)$/.exec(t);
  if (otherAttached && b.it && b.it.ref === 'target')
    return { type: 'amount', amount: { kind: 'count', filter: { subtypes: [otherAttached[1] === 'equipped' ? 'Equipment' : 'Aura'], attachedToRef: b.it } }, op: 'ge', n: 1 };
  if (/^~ is monstrous$/.test(t)) return { type: 'monstrous' };
  // Tadeas, Juniper Ascendant: "As long as ~ isn't attacking".
  const notAttacking = /^(~|it) (?:isn't|is not) (attacking|blocking)$/.exec(t);
  if (notAttacking && (notAttacking[1] === '~' || b.it?.ref === 'self')) return { type: 'not', cond: { type: 'is', of: { ref: 'self' }, filter: { combat: notAttacking[2] as 'attacking' | 'blocking' } } };
  // Tahngarth's Rage: "Enchanted creature gets -2/-1 as long as it isn't attacking."
  if (notAttacking && notAttacking[1] === 'it' && b.it?.ref === 'attached') return { type: 'not', cond: { type: 'is', of: { ref: 'attached' }, filter: { combat: notAttacking[2] as 'attacking' | 'blocking' } } };
  // Gift of Fangs: "as long as it isn't a Vampire" — what the static ability is about.
  const isnt = /^(~|it|(?:enchanted|equipped) (?:creature|permanent)) isn't (an? [A-Z][\w-]*|(?:white|blue|black|red|green))$/.exec(t);
  if (isnt) {
    const subject = isnt[1] === 'it' ? (b.it ? { ref: b.it } : null) : parseObjectRef(isnt[1]!, b.clone(), 'static');
    const filter = subject ? stateFilter(isnt[2]!, b) : null;
    if (subject && filter) return { type: 'not', cond: { type: 'is', of: subject.ref, filter } };
  }
  // "~ is attacking", "enchanted creature is blue", "equipped creature is a Human", "enchanted permanent is a creature".
  const is = /^(~|(?:enchanted|equipped) (?:creature|permanent|artifact|land)) is (?!not\b)(.+)$/.exec(t);
  if (is) {
    // A copy of the binder: what "it" refers to afterwards is the caller's business (see conditionSubject).
    const subject = parseObjectRef(is[1]!, b.clone(), 'static');
    const filter = subject && stateFilter(is[2]!, b);
    if (!subject || !filter) return null;
    return { type: 'is', of: subject.ref, filter };
  }
  if (/^it's your turn$/.test(t)) return { type: 'your_turn', value: true };
  // Great Train Heist: "If it's your combat phase, there is an additional combat phase after this phase."
  if (/^it's your combat phase$/.test(t)) return { type: 'step', combat: true, yours: true };
  // Mongrel Pack: "When this creature dies during combat" — in the combat phase (any player's).
  if (t === 'it died during combat') return { type: 'step', combat: true };
  if (/^it's your (?:precombat )?main phase$/.test(t)) return { type: 'step', main: true, yours: true };
  // Tribute to the World Tree: "if its power is 3 or greater"; "if that creature's toughness is 2 or less"
  // Level Up: "if it has power 10 or greater" — the same.
  // Arachnus Web: "if enchanted creature's power is 4 or greater" — what this Aura is attached to.
  const hasStat = /^(it|~|that creature|enchanted creature|equipped creature) has (power|toughness|mana value) (\w+) or (greater|more|less|fewer)$/.exec(t);
  // Viv Vision: "draw a card if her power is 4 or greater" — a named character's own.
  // Savage Swipe: "if its power is 2" — exactly.
  const statIs = /^(its|her|his|~'s|that creature's|that card's|enchanted creature's|equipped creature's) (power|toughness|mana value) is (\w+)(?: or (greater|more|less|fewer))?$/.exec(t) ?? (hasStat ? ([t, hasStat[1] === '~' ? "~'s" : /^(?:enchanted|equipped) creature$/.test(hasStat[1]!) ? `${hasStat[1]}'s` : 'its', hasStat[2], hasStat[3], hasStat[4]] as unknown as RegExpExecArray) : null);
  if (statIs) {
    const of = statIs[1] === "~'s" || statIs[1] === 'her' || statIs[1] === 'his' ? ({ ref: 'self' } as Ref) : /^(?:enchanted|equipped) creature's$/.test(statIs[1]!) ? ({ ref: 'attached' } as Ref) : b.it;
    const n = parseAmount(statIs[3]!);
    if (of && typeof n === 'number') {
      const key = statIs[2] === 'mana value' ? 'manaValue' : (statIs[2] as 'power' | 'toughness');
      return { type: 'is', of, filter: { [key]: { op: !statIs[4] ? 'eq' : /greater|more/.test(statIs[4]) ? 'ge' : 'le', n } } };
    }
  }
  // Sigil Captain: "if that creature is 1/1" — exactly that power and toughness.
  const ptIs = /^(it|that creature) is (\d+)\/(\d+)$/.exec(t);
  if (ptIs && b.it) return { type: 'is', of: b.it, filter: { power: { op: 'eq', n: Number(ptIs[2]) }, toughness: { op: 'eq', n: Number(ptIs[3]) } } };
  // Witch's Oven: "If the sacrificed creature's toughness was 4 or greater" — as it last existed (CR 608.2h).
  const sacStat = /^the sacrificed (?:creature|artifact|permanent)'s (power|toughness|mana value) (?:was|is) (\w+) or (greater|more|less)$/.exec(t);
  if (sacStat) {
    const n = parseAmount(sacStat[2]!);
    const stat = sacStat[1] === 'mana value' ? 'mana_value' : sacStat[1];
    if (typeof n === 'number') return { type: 'amount', amount: { kind: 'cost_lki', cost: 'sacrificed', stat }, op: /greater|more/.test(sacStat[3]!) ? 'ge' : 'le', n };
  }
  // Massacre Girl, Known Killer: "if its toughness was less than 1" — the creature that died, as it last existed.
  const statWas = /^its (power|toughness) was (less than|greater than) (\w+)$/.exec(t);
  if (statWas && b.it?.ref === 'trigger_object') {
    const n = parseAmount(statWas[3]!);
    if (typeof n === 'number') return { type: 'is', of: b.it, filter: { [statWas[1]!]: { op: statWas[2] === 'less than' ? 'lt' : 'gt', n } }, was: true };
  }
  // Deathknell Berserker: "When this creature dies, if its power was 3 or greater, …" — as it last existed (CR 603.10a).
  const statOrMore = /^its (power|toughness) was (\w+) or (greater|less)$/.exec(t);
  if (statOrMore && (b.it?.ref === 'trigger_object' || (b.it?.ref === 'self' && b.itIsSource))) {
    const n = parseAmount(statOrMore[2]!);
    if (typeof n === 'number') return { type: 'is', of: b.it, filter: { [statOrMore[1]!]: { op: statOrMore[3] === 'less' ? 'le' : 'ge', n } }, was: true };
  }
  // Selvala: "if its power is greater than each other creature's power"
  if (t === "its power is greater than each other creature's power" && b.it) return { type: 'is', of: b.it, filter: { powerAboveOthers: true } };
  // Tezzeret: "If it's an artifact creature, put a +1/+1 counter on it." — what it is now (the sentence loop makes sure an
  // earlier effect didn't move it).
  // Tezzeret, Cruel Captain's emblem: "If it's not a creature, it becomes a 0/0 Robot artifact creature."
  const itsA = /^(?:it|that creature|that permanent)(?:'s| is)( not)? (an? .+)$/.exec(t);
  if (itsA && b.it && b.it.ref !== 'self') {
    // Currency Converter: "If it's a land card", "If it's a nonland card".
    const noun = itsA[2]!.replace(/^an? /, '');
    const bare = noun.replace(/ card$/, '');
    // Karametra's Blessing: "If it's an enchanted creature or enchantment creature" — either.
    const either = (): ParsedFilter | null => {
      const parts = noun.split(/ or (?:an? )?/);
      if (parts.length !== 2) return null;
      const fs = parts.map((x) => parseFilter(x, b));
      return fs.every((f) => f && !f.plural && !f.filter.zone && !f.filter.controller) ? { filter: { anyOf: fs.map((f) => f!.filter) }, plural: false } : null;
    };
    const pf = parseFilter(noun, b) ?? (bare !== noun ? (parseFilter(bare, b) ?? (/^non[a-z]+$/.test(bare) ? parseFilter(`${bare} permanent`, b) : null)) : null) ?? either();
    if (pf && !pf.plural && !pf.filter.zone && !pf.filter.controller) {
      const cond: ConditionNode = { type: 'is', of: b.it, filter: pf.filter };
      return itsA[1] ? { type: 'not', cond } : cond;
    }
  }
  // Burning Hands: "If that permanent is green, …"; Lightning Dart: "If that creature is white or blue, …" (CR 105.2).
  const itsColor = /^(?:it|that creature|that permanent|that target)(?:'s| is)( not)? (white|blue|black|red|green)(?:,? (?:or|and\/or) (white|blue|black|red|green))?$/.exec(t);
  if (itsColor && b.it && b.it.ref !== 'self') {
    const code = (c: string) => ({ white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' })[c]!;
    const cond: ConditionNode = { type: 'is', of: b.it, filter: { colors: [code(itsColor[2]!), ...(itsColor[3] ? [code(itsColor[3])] : [])] } };
    return itsColor[1] ? { type: 'not', cond } : cond;
  }
  // Hexgold Slash: "If that creature has toxic, …".
  const itsKeyword = /^(?:it|that creature) has (flying|toxic|trample|deathtouch|haste|lifelink|vigilance|reach|defender|menace|first strike|double strike|madness|flashback|cycling)$/.exec(t);
  if (itsKeyword && b.it && b.it.ref !== 'self') return { type: 'is', of: b.it, filter: { keywords: [itsKeyword[1]!.replace(' ', '_')] } };
  // Gimli's Fury: "If it's legendary, it also gains trample until end of turn."
  const itsLegendary = /^(?:it|that creature|that permanent)(?:'s| is)( not)? legendary$/.exec(t);
  if (itsLegendary && b.it && b.it.ref !== 'self') {
    const cond: ConditionNode = { type: 'is', of: b.it, filter: { supertypes: ['Legendary'] } };
    return itsLegendary[1] ? { type: 'not', cond } : cond;
  }
  // Fatal Push: "if it has mana value 2 or less" — the object the instruction is about.
  const itHas = /^(?:it|that creature|that permanent) has (mana value|power|toughness) (\d+) or (less|greater)$/.exec(t);
  if (itHas && b.it && b.it.ref !== 'self') {
    const key = itHas[1] === 'mana value' ? 'manaValue' : (itHas[1] as 'power' | 'toughness');
    return { type: 'is', of: b.it, filter: { [key]: { op: itHas[3] === 'less' ? 'le' : 'ge', n: Number(itHas[2]) } } };
  }
  // Sting, the Glinting Dagger: "as long as it's blocking or blocked by a Goblin or Orc".
  const partner = /^it(?:'s| is) blocking or blocked by (an? .+)$/.exec(t);
  if (partner && b.it) {
    const filter = stateFilter(partner[1]!, b);
    if (filter && !filter.zone && !filter.controller) return { type: 'is', of: b.it, filter: { combatPartner: { types: ['Creature'], ...filter } } };
  }
  // Dreamdew Entrancer: "If you control that creature, draw two cards." — the one the effect is about, now.
  if (/^you control (?:that creature|that permanent)$/.test(t) && b.it && ['target', 'trigger_object', 'chosen_object'].includes(b.it.ref)) return { type: 'is', of: b.it, filter: { controller: 'you' } };
  // Lord Windgrace: "If a land card is discarded this way" — the one card just discarded.
  const discardedIs = /^an? (.+?) card (?:is|was) discarded this way$/.exec(t);
  if (discardedIs && b.other?.ref === 'discarded_this_way') {
    const pf = parseFilter(`${discardedIs[1]} card in your graveyard`, b.clone());
    if (pf && !pf.plural) {
      const { zone: _z, owner: _o, ...filter } = pf.filter;
      if (Object.keys(filter).length) return { type: 'is', of: { ref: 'discarded_this_way' }, filter };
    }
  }
  // "as long as it's attacking" — "it" being what the ability is about.
  const itIs = /^it(?:'s| is) (attacking|blocking|tapped|untapped|attacking or blocking|attacking alone|modified)$/.exec(t);
  if (itIs && b.it) {
    const filter = stateFilter(itIs[1]!, b);
    if (filter) return { type: 'is', of: b.it, filter };
  }
  // CR 705.2: "If you win the flip", "If you lose the flip"
  if (t === 'you win the flip') return { type: 'won_flip' };
  // CR 701.30d: "If you win" (a clash), "If you won"
  if (t === 'you win' || t === 'you won') return { type: 'won_clash' };
  if (t === 'you lose the flip') return { type: 'won_flip', not: true };
  // Planar Chaos: "If they lose the flip" — the player who flipped.
  const theyFlip = /^(?:they|that player) (win|lose)s? the flip$/.exec(t);
  if (theyFlip) return { type: 'won_flip', ...(theyFlip[1] === 'lose' ? { not: true } : {}) };
  // CR 702.179e: "you have max speed"; CR 702.131c: "you have the city's blessing"
  if (/^you have max speed$/.test(t)) return { type: 'max_speed' };
  if (/^you don't have max speed$/.test(t)) return { type: 'max_speed', not: true };
  if (/^you have the city's blessing$/.test(t)) return { type: 'city_blessing' };
  // Pelt Collector: "if that creature's power is greater than this creature's".
  if (/^that creature's power is greater than (?:~|this creature)'s(?: power)?$/.test(t) && b.it?.ref === 'trigger_object') return { type: 'compare_stats', of: b.it, than: { ref: 'self' }, stats: ['power'] };
  // CR 702.100a (evolve): "that creature's power is greater than ~'s power and/or that creature's toughness is greater than ~'s toughness"
  // Evolving Adaptive: "if that creature has greater power or toughness than this creature" — the same.
  // Sharp-Eyed Rookie: "if its power is greater than this creature's power or its toughness is greater than this creature's
  // toughness".
  if ((t === "that creature's power is greater than ~'s power and/or that creature's toughness is greater than ~'s toughness" || /^(?:that creature|it) has greater power or toughness than (?:~|this creature)$/.test(t) || /^its power is greater than ~'s power or its toughness is greater than ~'s toughness$/.test(t)) && b.it) {
    return { type: 'compare_stats', of: b.it, than: { ref: 'self' }, stats: ['power', 'toughness'] };
  }
  // CR 725: "you're the monarch"
  if (/^you're the monarch$|^you are the monarch$/.test(t)) return { type: 'monarch' };
  if (/^there is no monarch$/.test(t)) return { type: 'monarch', none: true };
  if (/^it's not your turn$|^it isn't your turn$/.test(t)) return { type: 'your_turn', value: false };
  // Tataru Taru: "if it isn't that player's turn" — the player the trigger is about.
  // March of the World Ooze: "Whenever an opponent casts a spell, if it's not their turn" — the same player.
  if (/^it(?:'s not| isn't) (?:that player's|their) turn$/.test(t)) return { type: 'your_turn', value: false, who: { ref: 'trigger_player' } };
  if (/^it's (?:that player's|their) turn$/.test(t)) return { type: 'your_turn', value: true, who: { ref: 'trigger_player' } };

  // Coven: "you control three or more creatures with different powers"
  const coven = /^you control (\w+ or more) creatures with different powers$/.exec(t);
  if (coven) {
    const c = compare(coven[1]!);
    return c ? { type: 'different_powers', ...c } : null;
  }
  // Formidable: "creatures you control have total power 8 or greater"
  // Betor, Kin to All: "creatures you control have total toughness 10 or greater".
  const total = /^creatures you control have total (power|toughness) (\d+) or greater$/.exec(t);
  if (total) return { type: 'total_power', op: 'ge', n: Number(total[2]), ...(total[1] === 'toughness' ? { stat: 'toughness' } : {}) };
  // Septic Rats: "if defending player is poisoned" (one or more poison counters).
  if (t === 'defending player is poisoned' && b.named['defending player']) return { type: 'poison', player: b.named['defending player'], min: 1 };
  // Break the Spell: "If a permanent you controlled or a token was destroyed this way, draw a card."
  if (t === 'a permanent you controlled or a token was destroyed this way') {
    return { type: 'or', any: [{ type: 'amount', amount: { kind: 'moved_this_way', how: 'destroyed', yours: true }, op: 'ge', n: 1 }, { type: 'amount', amount: { kind: 'moved_this_way', how: 'destroyed', token: true }, op: 'ge', n: 1 }] };
  }
  // Fanatic of the Harrowing: "each player discards a card. If you discarded a card this way, draw a card."
  if (t === 'you discarded a card this way') return { type: 'amount', amount: { kind: 'discarded_this_way', mine: true }, op: 'ge', n: 1 };
  // Viridian Betrayers: "as long as an opponent is poisoned".
  if (t === 'an opponent is poisoned') return { type: 'poison', who: 'any_opponent', min: 1 };
  // Corrupted Resolve: "Counter target spell if its controller is poisoned."
  const poisoned = t !== 'defending player is poisoned' ? /^(its controller|that player|target player|they|you) (?:is|are) poisoned$/.exec(t) : null;
  if (poisoned) {
    const player = poisoned[1] === 'they' ? b.player : parsePlayerRef(poisoned[1]!, b);
    if (player && player.ref !== 'players') return { type: 'poison', ...(player.ref === 'you' ? {} : { player }), min: 1 };
  }
  // Fear of the Dark: "if defending player controls no Glimmer creatures" — the player this creature is attacking.
  const defNone = /^defending player controls no (.+)$/.exec(t);
  if (defNone && b.it?.ref === 'self' && b.named['defending player']) {
    const pf = parseFilter(defNone[1]!, b.clone());
    if (pf && pf.plural && !pf.filter.zone && !pf.filter.controller) return { type: 'count', who: 'all', filter: { ...pf.filter, controller: 'defending' }, max: 0 };
  }
  // Waterspout Warden: "if another creature entered the battlefield under your control this turn".
  // Saddled Rimestag: "as long as you had another creature enter the battlefield under your control this turn".
  const anotherEntered = /^another (creature|artifact|land|permanent) entered the battlefield under your control this turn$/.exec(t) ?? /^you had another (creature|artifact|land|permanent) enter the battlefield under your control this turn$/.exec(t);
  if (anotherEntered) return { type: 'entered_this_turn', filter: { ...(anotherEntered[1] === 'permanent' ? {} : { types: [capitalise(anotherEntered[1]!)] }), other: true }, min: 1 };
  // Tenacious Hunter: "As long as a creature has a -1/-1 counter on it".
  const hasCounter = /^an? (creature|permanent)( you control)? has an? (\S+) counter on it$/.exec(t);
  if (hasCounter) return { type: 'count', who: hasCounter[2] ? 'you' : 'all', filter: { ...(hasCounter[1] === 'creature' ? { types: ['Creature'] } : {}), counter: hasCounter[3]!.replace(/−/g, '-') }, min: 1 };
  // Swordsworn Cavalier: "as long as another Knight entered the battlefield under your control this turn".
  const anotherKind = /^another ([A-Z][a-z]+) entered the battlefield under your control this turn$/.exec(t);
  if (anotherKind && isSubtype(anotherKind[1]!)) return { type: 'entered_this_turn', filter: { subtypes: [anotherKind[1]!], other: true }, min: 1 };
  // Corrupted: "an opponent has three or more poison counters"
  const poison = /^(an opponent|you) ha(?:s|ve) (\w+ or more) poison counters$/.exec(t);
  if (poison) {
    const c = compare(poison[2]!);
    return c ? { type: 'poison', ...c, ...(poison[1] === 'you' ? {} : { who: 'any_opponent' }) } : null;
  }
  // Celebration: "two or more nonland permanents entered the battlefield under your control this turn";
  // "you had a land enter the battlefield under your control this turn"
  const entered = /^(\w+ or more) (.+?) entered the battlefield under your control this turn$/.exec(t);
  const hadEnter = /^you had (?:a|an) (.+?) enter the battlefield under your control this turn$/.exec(t);
  if (entered || hadEnter) {
    const c = entered ? compare(entered[1]!) : { op: 'ge', n: 1 };
    const pf = parseFilter(entered ? entered[2]! : hadEnter![1]!, b);
    if (!c || !pf || pf.filter.zone) return null;
    return { type: 'entered_this_turn', filter: pf.filter, ...c };
  }
  // "you control a Forest", "you control three or more artifacts", "an opponent controls no creatures",
  // "you control a Plains or an Island", "you control two or more other lands", "your opponents control eight or more lands".
  // Pugnacious Hammerskull: "you don't control another Dinosaur" — none other.
  const dont = /^you don't control (a|an|another) (.+)$/.exec(t);
  if (dont) {
    const pf = parseFilter(dont[2]!, b);
    if (!pf || pf.plural) return null;
    return { type: 'count', who: 'you', filter: { ...pf.filter, ...(dont[1] === 'another' ? { other: true } : {}) }, max: 0 };
  }
  const control = /^(you|an opponent|each opponent|your opponents) controls? (a|an|another|no|at least \w+|\w+ or more|\w+ or fewer|exactly \w+) (other )?(?!more )(.+)$/.exec(t);
  if (control) {
    const c = count(control[2]!);
    const pf = parseFilter(control[4]!.replace(/ or an? /g, ' or '), b);
    if (!c || !pf) return null;
    if (control[2] === 'another' || control[3]) pf.filter.other = true;
    const who = control[1] === 'you' ? 'you' : control[1] === 'an opponent' ? 'any_opponent' : control[1] === 'each opponent' ? 'each_opponent' : 'opponents_total';
    return { type: 'count', who, filter: pf.filter, ...c };
  }
  // "you have two or more opponents" (CR 102.3)
  const opponents = /^you have (\w+ or more) opponents$/.exec(t);
  if (opponents) {
    const c = compare(opponents[1]!);
    return c ? { type: 'opponents', ...c } : null;
  }

  // Vampire Nocturnus: "the top card of your library is black"; Mul Daya Channelers: "… is a creature card".
  const topIs = /^the top card of your library is (white|blue|black|red|green|an? (.+? card))$/.exec(t);
  if (topIs) {
    if (!topIs[2]) return { type: 'top_card', filter: { colors: [COLOR_WORDS[topIs[1]!]!] } } as ConditionNode;
    const pf = parseFilter(`${topIs[2]} in your hand`, b.clone());
    if (!pf || pf.plural) return null;
    const { zone: _z, owner: _o, ...filter } = pf.filter;
    return { type: 'top_card', filter } as ConditionNode;
  }
  // Sunset Revelry: "if an opponent has more life than you"; Timely Reinforcements: "if you have less life than an
  // opponent".
  if (t === 'an opponent has more life than you' || t === 'you have less life than an opponent') return { type: 'life', than: 'an_opponent', op: 'lt' };
  if (t === 'you have more life than each opponent') return { type: 'life', than: 'each_opponent', op: 'gt' };
  // Survival Cache: "if you have more life than an opponent" — than at least one of them.
  if (t === 'you have more life than an opponent' || t === 'an opponent has less life than you') return { type: 'life', than: 'an_opponent', op: 'gt' };
  // Sunset Revelry: "if an opponent has more cards in hand than you"; Teachings of the Archaics: "… at least four more
  // cards in hand than you".
  const oppMoreHand = /^an opponent has (?:at least (two|three|four|five) )?more cards in hand than you$/.exec(t);
  if (oppMoreHand) return { type: 'hand', than: 'an_opponent', op: 'lt', ...(oppMoreHand[1] ? { by: parseAmount(oppMoreHand[1]) } : {}) };
  // Pulse of the Forge: "if that player or that planeswalker's controller has more life than you".
  const moreLife = /^(.+?) has more life than you$/.exec(t);
  if (moreLife && !/^(?:an?|each|any) /.test(moreLife[1]!)) {
    const who = parsePlayerRef(moreLife[1]!, b);
    if (who && who.ref !== 'you' && who.ref !== 'players') return { type: 'amount', amount: { kind: 'life', who }, op: 'gt', n: { kind: 'life', who: { ref: 'you' } } } as ConditionNode;
  }
  const life = /^(you|an opponent|a player|each player) ha(?:ve|s) (\w+ or (?:more|less|fewer)) life$/.exec(t);
  if (life) {
    const c = compare(life[2]!);
    // Cryptolith Fragment: "if each player has 10 or less life".
    const who = { you: undefined, 'a player': 'any_player', 'an opponent': 'any_opponent', 'each player': 'each_player' }[life[1] as 'you'];
    return c ? { type: 'life', ...c, ...(who ? { who } : {}) } : null;
  }
  // Resonating Lute: "… cards in your hand" means the same.
  if (/^you have /.test(t)) t = t.replace(/ cards in your hand( than|$)/, ' cards in hand$1');
  if (/^you have no cards in hand$/.test(t)) return { type: 'hand', op: 'le', n: 0 };
  // Imaginary Pet: "if you have a card in hand".
  if (/^you have (?:a card|one or more cards|any cards) in hand$/.test(t)) return { type: 'hand', op: 'ge', n: 1 };
  // Temple of the Dead: "if a player has one or fewer cards in hand"; "an opponent has no cards in hand".
  const someHand = /^(a player|an opponent) has (no|\w+ or (?:fewer|more)) cards in hand$/.exec(t);
  if (someHand) {
    const c = someHand[2] === 'no' ? { op: 'le' as const, n: 0 } : compare(someHand[2]!);
    return c ? { type: 'hand', ...c, any: someHand[1] === 'a player' ? 'player' : 'opponent' } : null;
  }
  // "you have more cards in hand than each opponent"
  const moreHand = /^you have (more|fewer) cards in hand than (each|an) opponent$/.exec(t);
  if (moreHand) return { type: 'hand', than: moreHand[2] === 'each' ? 'each_opponent' : 'an_opponent', op: moreHand[1] === 'more' ? 'gt' : 'lt' };
  // Sandstone Oracle: "choose an opponent. If that player has more cards in hand than you, draw cards equal to the
  // difference."; Balance of Power: "If target opponent has more cards in hand than you, …"
  const moreThanYou = /^(that player|that opponent|target opponent|target player) has more cards in hand than you$/.exec(t);
  if (moreThanYou) {
    const who = parsePlayerRef(moreThanYou[1]!, b);
    if (!who || who.ref === 'you' || who.ref === 'players') return null;
    const theirs: AmountExpr = { kind: 'cards', zone: 'hand', who: 'you', player: who };
    const mine: AmountExpr = { kind: 'cards', zone: 'hand', who: 'you' };
    b.difference = { kind: 'sum', parts: [theirs, { ...mine, times: -1 }] };
    return { type: 'amount', amount: theirs, op: 'gt', n: mine } as ConditionNode;
  }
  // The Ten Rings: "if you have fewer than ten cards in hand, draw cards equal to the difference" — "the difference" is
  // then that number minus the cards in hand.
  const fewerHand = /^you have fewer than (\w+) cards in hand$/.exec(t);
  if (fewerHand) {
    const n = parseAmount(fewerHand[1]!);
    if (typeof n !== 'number') return null;
    b.difference = { kind: 'cards', zone: 'hand', who: 'you', times: -1, plus: n };
    return { type: 'hand', op: 'lt', n };
  }
  const hand = /^you have (\w+ or (?:more|fewer)) cards in hand$/.exec(t);
  if (hand) {
    const c = compare(hand[1]!);
    return c ? { type: 'hand', ...c } : null;
  }
  // CR 701.38: "if sickness gets more votes", "if psychosis gets more votes or the vote is tied"
  const votes = /^(.+?) gets more votes( or the vote is tied)?$/.exec(t);
  if (votes && b.votes.includes(votes[1]!)) return { type: 'votes', option: votes[1]!, ...(votes[2] ? { orTied: true } : {}) };
  // CR 706.2: "If the result is 4 or less" — the die rolled by this resolution.
  const result = /^the result is (\d+)(?: or (less|greater|more))?$/.exec(t);
  if (result) return { type: 'amount', amount: { kind: 'die_result' }, op: result[2] === 'less' ? 'le' : result[2] ? 'ge' : 'eq', n: Number(result[1]) } as ConditionNode;
  // CR 701.59c: "if evidence was collected"
  if (t === 'evidence was collected') return { type: 'paid', cost: 'collect_evidence' };
  // CR 702.187b (mayhem): "you discarded this card this turn"
  if (/^you discarded (?:~|it) this turn$/.test(t)) return { type: 'discarded_this_turn' };
  // The Raven Man: "if a player discarded a card this turn"; Tinybones: "if an opponent discarded a card this turn".
  // Recalibrate: "If you've discarded a card this turn".
  const someoneDiscarded = /^(a player|an opponent|you)(?:'ve| have)? discarded a card this turn$/.exec(t);
  if (someoneDiscarded) return { type: 'discarded_this_turn', who: someoneDiscarded[1] === 'a player' ? 'any' : someoneDiscarded[1] === 'you' ? 'you' : 'opponent' };
  // CR 702.76a (prowl), CR 702.173a (freerunning)
  if (/^a player was dealt combat damage this turn by a source that, at the time it dealt that damage, was under your control and had any of ~'s creature types$/.test(t)) {
    return { type: 'combat_damage_by', sharesType: true };
  }
  // Blitzball: "an opponent was dealt combat damage by a legendary creature this turn".
  // Lost Monarch of Ifnir: "if a player was dealt combat damage by a Zombie this turn" — anyone's.
  const bySubtype = /^a player was dealt combat damage by an? ([A-Z]\w+) this turn$/.exec(t);
  if (bySubtype && isSubtype(bySubtype[1]!)) return { type: 'combat_damage_by', anyone: true, subtype: bySubtype[1]! };
  const byLegend = /^an opponent was dealt combat damage by an? (legendary )?creature this turn$/.exec(t);
  if (byLegend) return { type: 'combat_damage_by', toOpponent: true, ...(byLegend[1] ? { legendary: true } : {}) };
  const freerun = /^a player was dealt combat damage this turn by a creature that, at the time it dealt that damage, was an? (\w+) creature or a commander under your control$/.exec(t);
  if (freerun) return { type: 'combat_damage_by', subtype: freerun[1]!, orCommander: true };
  // Meren: "that card's mana value is less than or equal to the number of experience counters you have"; "its power is 3
  // or less" — the object the text named, as the instruction is followed.
  // Liberator: "the amount of mana spent to cast that spell is greater than ~'s power".
  // Ancient Cellarspawn: "if the amount of mana spent to cast it was less than its mana value, target opponent loses life
  // equal to the difference".
  const spentVs = /^the amount of mana spent to cast (?:that spell|it) (?:is|was) (greater|less) than (.+)$/.exec(t);
  if (spentVs && b.it?.ref === 'trigger_object') {
    const n = parseCount(spentVs[2]!, b);
    if (!n) return null;
    const spent: AmountExpr = { kind: 'mana_spent', of: b.it };
    b.difference = spentVs[1] === 'greater' ? { kind: 'sum', parts: [spent, { ...n, times: -1 } as AmountExpr] } : { kind: 'sum', parts: [n, { ...spent, times: -1 }] };
    return { type: 'amount', amount: spent, op: spentVs[1] === 'greater' ? 'gt' : 'lt', n };
  }
  // Marauding Raptor: "If a Dinosaur is dealt damage this way" — what the damage was just dealt to, if any was.
  const dealtThisWay = /^(?:a|an) ([A-Z][a-z]+|creature) is dealt damage this way$/.exec(t);
  if (dealtThisWay && b.damaged) {
    const pf = parseFilter(dealtThisWay[1] === 'creature' ? 'creature' : dealtThisWay[1]!, b.clone());
    if (pf && !pf.plural) {
      // The Black Arrow: "If a Dragon is dealt damage this way, destroy it." — "it" is that creature.
      const of = b.damaged;
      b.it = of;
      return { type: 'and', all: [{ type: 'is', of, filter: pf.filter }, { type: 'amount', amount: { kind: 'damage_this_way' }, op: 'ge', n: 1 }] };
    }
  }
  // Pack tactics: "if you attacked with creatures with total power 6 or greater this combat".
  const packTactics = /^you attacked with creatures with total power (\d+) or greater this combat$/.exec(t);
  if (packTactics) return { type: 'attack_power', n: Number(packTactics[1]) };
  // Wistfulness: "if {G}{G} was spent to cast it"; Seed Spark: "If {G} was spent to cast this spell".
  const spentColors = /^((?:\{[WUBRG]\})+) was spent to cast (?:it|this spell|~)$/.exec(t);
  if (spentColors) {
    const need: Record<string, number> = {};
    for (const m of spentColors[1]!.matchAll(/\{([WUBRG])\}/g)) need[m[1]!] = (need[m[1]!] ?? 0) + 1;
    return { type: 'spent_colors', need };
  }
  // Adamant (Foreboding Fruit): "If at least three black mana was spent to cast this spell".
  const adamant = /^at least (\w+) (white|blue|black|red|green) mana was spent to cast (?:it|this spell|~)$/.exec(t);
  if (adamant && typeof parseAmount(adamant[1]!) === 'number') return { type: 'spent_colors', need: { [COLOR_WORDS[adamant[2]!]!]: parseAmount(adamant[1]!) as number } };
  // Adamant (Clockwork Servant): "if at least three mana of the same color was spent to cast it".
  const sameColor = /^at least (\w+) mana of the same color was spent to cast (?:it|this spell|~)$/.exec(t);
  if (sameColor && typeof parseAmount(sameColor[1]!) === 'number') return { type: 'spent_colors', need: {}, anyColor: parseAmount(sameColor[1]!) as number } as ConditionNode;
  // Blazing Bomb: "if at least four mana was spent to cast it"; Tellah: "If four or more mana was spent to cast that spell".
  const spentAtLeast = /^(?:at least (\w+)|(\w+) or more) mana was spent to cast (?:that spell|it)$/.exec(t);
  if (spentAtLeast && b.it?.ref === 'trigger_object') {
    const n = parseAmount((spentAtLeast[1] ?? spentAtLeast[2])!);
    if (typeof n === 'number') return { type: 'amount', amount: { kind: 'mana_spent', of: b.it }, op: 'ge', n };
  }
  const statVs = /^(that card|that creature|it)(?:'s|s) (mana value|power|toughness) is (less|greater) than or equal to (.+)$/.exec(t);
  if (statVs && b.it && b.it.ref !== 'self') {
    const amount = { kind: 'stat' as const, stat: statVs[2] === 'mana value' ? ('mana_value' as const) : (statVs[2] as 'power' | 'toughness'), of: b.it };
    const n = parseCount(statVs[4]!, b);
    return n ? { type: 'amount', amount, op: statVs[3] === 'less' ? 'le' : 'ge', n } : null;
  }
  // Prismari Pianist: "If that spell's mana value is 5 or greater"; Herald of Ilharg: "If that spell has mana value 5 or
  // greater" — the spell a cast trigger is about.
  const spellMV = /^that spell(?:'s mana value is| has mana value) (\d+) or (greater|less)$/.exec(t);
  const thatSpell = b.named['that spell'] ?? (b.it?.ref === 'trigger_object' ? b.it : undefined);
  if (spellMV && thatSpell) {
    return { type: 'amount', amount: { kind: 'stat', stat: 'mana_value', of: thatSpell }, op: spellMV[2] === 'greater' ? 'ge' : 'le', n: Number(spellMV[1]) };
  }
  // CR 702.156a (ravenous): "if X is 5 or more"
  const xIs = /^X is (\w+ or (?:more|greater|less|fewer))$/.exec(t);
  if (xIs) {
    const c = compare(xIs[1]!);
    return c ? { type: 'amount', amount: { kind: 'x' }, ...c } : null;
  }
  // Aven Heartstabber: "there are five or more mana values among cards in your graveyard".
  const mvAmong = /^there are (\w+ or more) mana values among cards in your graveyard$/.exec(t);
  if (mvAmong) {
    const c = compare(mvAmong[1]!);
    return c ? { type: 'amount', amount: { kind: 'distinct_mana_values', filter: { zone: 'graveyard', owner: 'you' } }, ...c } : null;
  }
  // Delirium: "there are four or more card types among cards in your graveyard"
  // Matzalantli: "there are four or more permanent types among cards in your graveyard".
  const cardTypes = /^there are (\w+ or more) (card|permanent) types among cards in your graveyard$/.exec(t);
  if (cardTypes) {
    const c = compare(cardTypes[1]!);
    return c ? { type: 'graveyard', ...c, cardTypes: true, ...(cardTypes[2] === 'permanent' ? { permanentTypes: true } : {}) } : null;
  }
  // Descend: "there are four or more permanent cards in your graveyard", "five or more creature cards are in your graveyard"
  const gyKind = /^there are (\w+ or more) (.+?) cards in your graveyard$/.exec(t) ?? /^(\w+ or more) (.+?) cards are in your graveyard$/.exec(t);
  if (gyKind) {
    const c = compare(gyKind[1]!);
    const pf = parseFilter(`${gyKind[2]} cards in your graveyard`, b);
    if (!c || !pf || pf.filter.zone !== 'graveyard') return null;
    const { zone: _z, owner: _o, ...filter } = pf.filter;
    return { type: 'graveyard', ...c, filter };
  }
  // Walltop Sentries: "if there's a Lesson card in your graveyard"; "if there is an instant card in your graveyard".
  const gyOne = /^there(?:'s| is) an? (.+?) card in your graveyard$/.exec(t);
  if (gyOne) {
    const pf = parseFilter(`${gyOne[1]} cards in your graveyard`, b);
    if (!pf || pf.filter.zone !== 'graveyard') return null;
    const { zone: _z, owner: _o, ...filter } = pf.filter;
    return { type: 'graveyard', min: 1, filter };
  }
  // Oversold Cemetery: "you have four or more creature cards in your graveyard".
  const haveKind = /^you have (\w+ or more) (.+?) cards in your graveyard$/.exec(t);
  if (haveKind) {
    const c = compare(haveKind[1]!);
    const pf = parseFilter(`${haveKind[2]} cards in your graveyard`, b);
    if (!c || !pf || pf.filter.zone !== 'graveyard') return null;
    const { zone: _z, owner: _o, ...filter } = pf.filter;
    return { type: 'graveyard', ...c, filter };
  }
  // Threshold and friends: "there are seven or more cards in your graveyard", "seven or more cards are in your graveyard".
  // Search for Azcanta: "if you have seven or more cards in your graveyard".
  const gy = /^there are (\w+ or more) cards in your graveyard$/.exec(t) ?? /^(\w+ or more) cards are in your graveyard$/.exec(t) ?? /^you have (\w+ or more) cards in your graveyard$/.exec(t);
  if (gy) {
    const c = compare(gy[1]!);
    return c ? { type: 'graveyard', ...c } : null;
  }
  // Steel Exemplar: "two or more colors of mana were spent to cast it" — converge's count (CR 702.44a's colors spent).
  const colorsSpentN = /^(two|three|four|five) or more colors of mana were spent to cast (?:it|~|this spell)$/.exec(t);
  if (colorsSpentN) return { type: 'amount', amount: { kind: 'colors_spent' }, op: 'ge', n: parseAmount(colorsSpentN[1]!) as number };
  // Freestrider Commando: "if it wasn't cast or no mana was spent to cast it".
  if (t === "it wasn't cast or no mana was spent to cast it") return { type: 'or', any: [{ type: 'not', cond: { type: 'cast_by_you', anyone: true } }, { type: 'amount', amount: { kind: 'mana_spent', of: { ref: 'self' } }, op: 'le', n: 0 }] };
  // Gorilla Titan: "as long as there are no cards in your graveyard".
  if (t === 'there are no cards in your graveyard') return { type: 'graveyard', max: 0 };
  // Sheoldred // The True Scriptures: "an opponent has eight or more cards in their graveyard".
  const oppGy = /^an opponent has (\w+ or more) cards in their graveyard$/.exec(t);
  if (oppGy) {
    const c = compare(oppGy[1]!);
    return c ? { type: 'graveyard', ...c, who: 'any_opponent' } : null;
  }
  // Lux Artillery: "there are thirty or more counters among artifacts and creatures you control".
  const countersAmong = /^there are (\w+) or more counters among (.+)$/.exec(t);
  if (countersAmong) {
    const n = parseAmount(countersAmong[1]!);
    const amount = typeof n === 'number' ? parseCount(`the number of counters among ${countersAmong[2]!}`, b) : null;
    return amount ? { type: 'amount', amount, op: 'ge', n: n as number } : null;
  }
  // Visions of Beyond: "a graveyard has twenty or more cards in it" — any player's.
  const anyGy = /^a graveyard has (\w+ or more) cards in it$/.exec(t);
  if (anyGy) {
    const c = compare(anyGy[1]!);
    return c ? { type: 'graveyard', ...c, who: 'any_player' } : null;
  }
  // The Warring Triad: "there are fewer than eight cards in your graveyard"
  // Shadowborn Demon: "if there are fewer than six creature cards in your graveyard".
  const fewerGy = /^there are fewer than (\w+) (creature |land |instant |sorcery |artifact |enchantment )?cards in your graveyard$/.exec(t);
  if (fewerGy) {
    const n = parseAmount(fewerGy[1]!);
    const kind = fewerGy[2]?.trim();
    return typeof n === 'number' && n > 0 ? { type: 'graveyard', op: 'le', n: n - 1, ...(kind ? { filter: { types: [capitalise(kind)] } } : {}) } : null;
  }

  // Starting Town: "it's your first, second, or third turn of the game"
  if (t === "it's your first, second, or third turn of the game") return { type: 'early_turn', max: 3 };
  if (t === "it isn't your first, second, or third turn of the game") return { type: 'not', cond: { type: 'early_turn', max: 3 } };
  // The Theros Gods: "your devotion to red is less than five", "your devotion to white and black is less than seven"
  const devotion = /^your devotion to (\w+)(?: and (\w+))? is (less than (\w+)|(\w+) or greater)$/.exec(t);
  if (devotion) {
    const colors = [devotion[1], devotion[2]].filter(Boolean).map((c) => COLOR_WORDS[c!]);
    const n = parseAmount((devotion[4] ?? devotion[5])!);
    // March of the Canonized: "if your devotion to white and black is seven or greater".
    if (colors.every(Boolean) && typeof n === 'number') return { type: 'amount', amount: { kind: 'devotion', colors: colors as never }, ...(devotion[4] ? { op: 'le', n: n - 1 } : { op: 'ge', n }) };
  }
  // "if two or more creatures died this turn", "if three or more Zubera died this turn"
  // Gimli: "two or more creatures died under your control this turn".
  const died = /^(\w+ or more) (.+?) died ((?:under (?:your|an opponent's) control )?)this turn$/.exec(t);
  if (died) {
    const c = compare(died[1]!);
    const amount = c ? parseCount(`the number of ${died[2]} that died ${died[3]}this turn`, b) : null;
    if (c && amount) return { type: 'amount', amount, ...c };
  }
  // Path to the Festival: "if there are three or more basic land types among lands you control" (domain).
  const domainN = /^there are (two|three|four|five) or more basic land types among lands you control$/.exec(t);
  if (domainN) return { type: 'amount', amount: { kind: 'domain' }, op: 'ge', n: parseAmount(domainN[1]!) as number };
  // Titan Hunter: "if no creatures died this turn".
  if (t === 'no creatures died this turn') return { type: 'not', cond: { type: 'this_turn', event: 'creature_died' } };
  // Things that happened this turn.
  const events: Record<string, string> = {
    'a creature died this turn': 'creature_died',
    'you attacked this turn': 'you_attacked',
    'you attacked with a creature this turn': 'you_attacked',
    'you gained life this turn': 'you_gained_life',
    'an opponent lost life this turn': 'opponent_lost_life',
    'you cast a noncreature spell this turn': 'you_cast_noncreature',
    "you've cast a noncreature spell this turn": 'you_cast_noncreature',
    // Revolt; void (CR 702.185c: "a spell was warped this turn").
    'a permanent you controlled left the battlefield this turn': 'your_permanent_left',
    'a permanent left the battlefield under your control this turn': 'your_permanent_left',
    'a nonland permanent left the battlefield this turn': 'nonland_left',
    'a creature left the battlefield under your control this turn': 'your_creature_left',
    'a creature you controlled left the battlefield this turn': 'your_creature_left',
    'a spell was warped this turn': 'warped',
    // CR 700.13
    "you've committed a crime this turn": 'you_committed_crime',
    'you committed a crime this turn': 'you_committed_crime',
    // CR 700.11
    'you descended this turn': 'you_descended',
    "you've descended this turn": 'you_descended',
    'a creature died under your control this turn': 'your_creature_died',
    'a creature you controlled died this turn': 'your_creature_died',
    // Archive Trap: "If an opponent searched their library this turn" (CR 701.23).
    'an opponent searched their library this turn': 'opponent_searched',
  };
  if (events[t]) return { type: 'this_turn', event: events[t] };
  // CR 700.8: "if you have a full party" — four creatures, one each of Cleric, Rogue, Warrior and Wizard.
  if (t === 'you have a full party') return { type: 'amount', amount: { kind: 'party' }, op: 'ge', n: 4 };
  if (t === "you don't have a full party") return { type: 'amount', amount: { kind: 'party' }, op: 'le', n: 3 };
  // Eshki Dragonclaw: "if you've cast both a creature spell and a noncreature spell this turn".
  if (t === "you've cast both a creature spell and a noncreature spell this turn") {
    return { type: 'and', all: [{ type: 'this_turn', event: 'you_cast', filter: { types: ['Creature'] }, min: 1 }, { type: 'this_turn', event: 'you_cast', filter: { notTypes: ['Creature'] }, min: 1 }] };
  }
  // White Glove Gourmand: "if another Human died under your control this turn"; Cult Conscript: "a non-Skeleton
  // creature"; Sidequest: Hunt the Mark: "a creature died under an opponent's control this turn".
  const diedOne = /^(?:another|an?) (.+?) died under (your|an opponent's) control this turn$/.exec(t);
  if (diedOne) {
    const amount = parseCount(`the number of ${diedOne[1]}s that died under ${diedOne[2]} control this turn`, b);
    if (amount && amount.kind === 'died_this_turn') return { type: 'amount', amount, op: 'ge', n: 1 };
  }
  // Gau, Feral Youth: "if a card left your graveyard this turn"; Syrix: "a creature card"; Bonecache Overseer: "three
  // or more cards".
  const leftGy = /^(a|one or more|two or more|three or more) (card|creature card)s? left your graveyard this turn$/.exec(t);
  if (leftGy) {
    const min = { a: 1, 'one or more': 1, 'two or more': 2, 'three or more': 3 }[leftGy[1] as 'a'];
    return { type: 'left_graveyard', min, ...(leftGy[2] === 'creature card' ? { filter: { types: ['Creature'] } } : {}) };
  }
  // Ennis, Debate Moderator: "if one or more cards were put into exile this turn".
  if (/^(?:a card was|one or more cards were) put into exile this turn$/.test(t)) return { type: 'this_turn', event: 'card_exiled' };
  // Canyon Crab: "if you haven't cast a spell from your hand this turn".
  if (/^you (?:haven't|have not|didn't) cast a spell from your hand this turn$/.test(t)) return { type: 'not', cond: { type: 'this_turn', event: 'you_cast', from: 'hand', min: 1 } };
  // Curious Obsession: "if you didn't attack with a creature this turn".
  if (/^you didn't attack(?: with a creature)? this turn$/.test(t)) return { type: 'not', cond: { type: 'this_turn', event: 'you_attacked' } };
  // Starlit Soothsayer: "if you gained or lost life this turn".
  if (t === 'you gained or lost life this turn') return { type: 'or', any: [{ type: 'this_turn', event: 'you_gained_life' }, { type: 'this_turn', event: 'you_lost_life' }] };
  // River of Tears: "If you played a land this turn" (CR 305.1: played, not just put onto the battlefield).
  if (/^you(?:'ve)? played a land this turn$/.test(t)) return { type: 'this_turn', event: 'you_played_land' };
  // Mercadian Atlas: "if you didn't play a land this turn".
  if (/^you (?:didn't|did not|haven't) play(?:ed)? a land this turn$/.test(t)) return { type: 'not', cond: { type: 'this_turn', event: 'you_played_land' } };
  // Mirrex: "Activate only if this land entered this turn."
  if (/^(?:~|this (?:land|creature|artifact|permanent|enchantment)) entered (?:the battlefield )?this turn$/.test(t)) return { type: 'is', of: { ref: 'self' }, filter: { enteredThisTurn: true } };
  // Thrasta, Tempest's Roar: "~ has hexproof as long as it entered this turn" — itself.
  if (t === 'it entered this turn' && (!b.it || b.it.ref === 'self')) return { type: 'is', of: { ref: 'self' }, filter: { enteredThisTurn: true } };
  // Malamet Battle Glyph: "If the creature you control entered this turn" — the object the text named.
  const namedEntered = /^(that creature|it|the creature you control) entered (?:the battlefield )?this turn$/.exec(t);
  if (namedEntered) {
    const of = attempt(b, (b) => parseObjectRef(namedEntered[1]!, b));
    if (of && !of.plural && of.ref.ref !== 'self') return { type: 'is', of: of.ref, filter: { enteredThisTurn: true } };
  }
  // Fortune Teller's Talent: "you've cast a spell this turn"; Essence Channeler: "you've lost life this turn".
  if (/^you(?:'ve)? cast a spell this turn$/.test(t)) return { type: 'this_turn', event: 'you_cast_spell' };
  // Impatience: "At the beginning of each player's end step, if that player didn't cast a spell this turn, …".
  // Predatory Advantage: "if that player didn't cast a creature spell this turn".
  const theyCast = /^(that player|they) (didn't|did not|hasn't|haven't|has|have) cast an? (?:(creature|noncreature|instant|sorcery|artifact|enchantment) )?spell this turn$/.exec(t);
  if (theyCast) {
    const who = parsePlayerRef(theyCast[1]!, b);
    const kind = theyCast[3];
    const filter = kind ? (kind === 'noncreature' ? { notTypes: ['Creature'] } : { types: [capitalise(kind)] }) : undefined;
    if (who && who.ref !== 'you' && who.ref !== 'players') return { type: 'amount', amount: { kind: 'spells_cast_this_turn', player: who, ...(filter ? { filter } : {}) }, op: /n't|not/.test(theyCast[2]!) ? 'eq' : 'ge', n: /n't|not/.test(theyCast[2]!) ? 0 : 1 } as ConditionNode;
  }
  // Conduit of Worlds: "If you haven't cast a spell this turn".
  if (/^you (?:haven't|have not|didn't) cast a spell this turn$/.test(t)) return { type: 'not', cond: { type: 'this_turn', event: 'you_cast_spell' } };
  if (/^you(?:'ve)? lost life this turn$/.test(t)) return { type: 'this_turn', event: 'you_lost_life' };
  // Luminarch Ascension: "if you didn't lose life this turn".
  if (/^you didn't lose life this turn$|^you haven't lost life this turn$/.test(t)) return { type: 'not', cond: { type: 'this_turn', event: 'you_lost_life' } };
  // Stormwing Entity: "if you've cast an instant or sorcery spell this turn".
  // Mage Duel: "if you've cast another instant or sorcery spell this turn" — as its cost is worked out, it isn't cast yet.
  const castOne = /^you(?:'ve)? cast (an?|another) (.+?) spell this turn$/.exec(t);
  if (castOne) {
    const pf = parseFilter(`${castOne[2]} spell`, b.clone());
    if (pf && !pf.plural && (!pf.filter.zone || pf.filter.zone === 'stack') && !pf.filter.controller) {
      const { zone: _z, ...filter } = pf.filter;
      return { type: 'this_turn', event: 'you_cast', filter, min: 1, ...(castOne[1] === 'another' ? { other: true } : {}) };
    }
  }
  // Rhino, Barreling Brute: "if you've cast a spell with mana value 4 or greater this turn" — as each was cast.
  const castWith = /^you(?:'ve)? cast (an?|another) ((?:\S+ )*?)spell (with mana value \d+ or (?:greater|less)) this turn$/.exec(t);
  if (castWith) {
    const pf = parseFilter(`${castWith[2]}spell ${castWith[3]}`, b.clone());
    if (pf && !pf.plural && (!pf.filter.zone || pf.filter.zone === 'stack') && !pf.filter.controller) {
      const { zone: _z, ...filter } = pf.filter;
      return { type: 'this_turn', event: 'you_cast', filter, min: 1, ...(castWith[1] === 'another' ? { other: true } : {}) };
    }
  }
  // Heroic Return: "if a creature is attacking you".
  if (t === 'a creature is attacking you') return { type: 'attacking_you', min: 1 };
  // Lyse Hext: "you've cast two or more noncreature spells this turn"
  // The Howling Abomination: "you've cast three or more spells this turn" — any spells.
  const castN = /^you(?:'ve)? cast (two|three|four|five) or more (?:(.+?) )?spells this turn$/.exec(t);
  if (castN && !castN[2]) return { type: 'this_turn', event: 'you_cast', min: parseAmount(castN[1]!) as number };
  if (castN) {
    const pf = parseFilter(`${castN[2]} spells`, b.clone());
    if (!pf || !pf.plural || (pf.filter.zone && pf.filter.zone !== 'stack') || pf.filter.controller) return null;
    const { zone: _z, ...filter } = pf.filter;
    return { type: 'this_turn', event: 'you_cast', filter, min: parseAmount(castN[1]!) as number };
  }
  // Sentinel Sarah Lyons: "an artifact entered the battlefield under your control this turn"
  const enteredYours = /^an? (\w+) entered the battlefield under your control this turn$/.exec(t);
  if (enteredYours && TYPE_NOUNS[enteredYours[1]!]) return { type: 'this_turn', event: 'entered_yours', filter: { types: [TYPE_NOUNS[enteredYours[1]!]!] } };
  // Lictor: "if a creature entered the battlefield under an opponent's control this turn".
  const enteredTheirs = /^an? (\w+) entered the battlefield under an opponent's control this turn$/.exec(t);
  if (enteredTheirs && TYPE_NOUNS[enteredTheirs[1]!]) return { type: 'this_turn', event: 'entered_yours', opponents: true, filter: { types: [TYPE_NOUNS[enteredTheirs[1]!]!] } };
  // Lilypad Village: "a Bird, Frog, Otter, or Rat entered the battlefield under your control this turn".
  const enteredKinds = /^an? ((?:[A-Z][a-z]+, )+(?:or )?[A-Z][a-z]+|[A-Z][a-z]+ or [A-Z][a-z]+|[A-Z][a-z]+) entered the battlefield under your control this turn$/.exec(t);
  if (enteredKinds) {
    const pf = parseFilter(enteredKinds[1]!, b);
    if (pf && !pf.plural && pf.filter.subtypes?.length && Object.keys(pf.filter).length === 1) return { type: 'this_turn', event: 'entered_yours', filter: { subtypes: pf.filter.subtypes } };
  }
  if (t === 'an opponent gained life this turn') return { type: 'this_turn', event: 'opponent_gained_life' };
  // The Enduring cycle: "it was a creature" (a leaves-the-battlefield trigger looks back, CR 603.10a)
  // Scavenging Ooze: "Exile target card from a graveyard. If it was a creature card, …" — the card, now in exile.
  const wasCard = /^it was an? (creature|artifact|enchantment|land|planeswalker|instant|sorcery|permanent) card$/.exec(t);
  // Lion Sash: "If it was a permanent card" (CR 110.4a: artifact, battle, creature, enchantment, land, planeswalker).
  const typesOf = (w: string) => (w === 'permanent' ? ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'] : [w.replace(/^\w/, (c) => c.toUpperCase())]);
  if (wasCard && b.it && (b.it.ref === 'target' || b.it.ref === 'created')) return { type: 'is', of: b.it, filter: { types: typesOf(wasCard[1]!) } };
  // Kaya, Intangible Slayer: "Exile target creature or enchantment. If it wasn't an Aura, …" — the card, now in exile.
  const wasntSub = /^it wasn't an? (Aura|Equipment|Vehicle|Saga)$/.exec(t);
  if (wasntSub && b.it && b.it.ref === 'target') return { type: 'is', of: b.it, filter: { notSubtypes: [wasntSub[1]!] } };
  // Elanor Gardner: "if you sacrificed a Food this turn"; Havengul Laboratory: "three or more Clues"; Goblin Blast-Runner:
  // "a permanent".
  const sacThisTurn = /^you(?:'ve)? sacrificed (a|an|one or more|two or more|three or more) (.+?) this turn$/.exec(t);
  if (sacThisTurn) {
    const min = { a: 1, an: 1, 'one or more': 1, 'two or more': 2, 'three or more': 3 }[sacThisTurn[1] as 'a'];
    const word = sacThisTurn[2]!.replace(/s$/, '');
    const pf = word === 'permanent' ? { filter: {} as ObjectFilter } : parseFilter(word, b);
    const keys = pf ? Object.keys(pf.filter).filter((k) => k !== 'types' && k !== 'subtypes') : ['x'];
    if (pf && !keys.length) return { type: 'sacrificed_this_turn', filter: pf.filter, min };
  }
  // Zurgo Stormrender: "Whenever a creature token you control leaves the battlefield, draw a card if it was attacking." —
  // as it last existed (CR 506.4: only during combat).
  // Wilhelt, the Rotcleaver: "if it didn't have decayed" — the creature that died, as it last existed.
  const hadKw = /^it (had|didn't have) (decayed|flying|haste|deathtouch|lifelink|trample|vigilance|menace|reach|defender|indestructible|first strike|double strike)$/.exec(t);
  if (hadKw && b.it?.ref === 'trigger_object') {
    const c: ConditionNode = { type: 'had_keyword', keyword: hadKw[2]!.replace(/ /g, '_') };
    return hadKw[1] === 'had' ? c : { type: 'not', cond: c };
  }
  // Momentum Rumbler: "Whenever this creature attacks, if it doesn't have first strike, …" — as it is now.
  const hasKw = /^(?:it|~) (has|doesn't have) (flying|haste|deathtouch|lifelink|trample|vigilance|menace|reach|defender|indestructible|first strike|double strike|hexproof)$/.exec(t);
  if (hasKw && (t.startsWith('~') || b.it?.ref === 'self')) {
    const c: ConditionNode = { type: 'is', of: { ref: 'self' }, filter: { keywords: [hasKw[2]!.replace(/ /g, '_')] } };
    return hasKw[1] === 'has' ? c : { type: 'not', cond: c };
  }
  if (/^it (was|wasn't) attacking$/.test(t) && b.it?.ref === 'trigger_object') return t.includes("wasn't") ? { type: 'not', cond: { type: 'was_attacking' } } : { type: 'was_attacking' };
  // Prophesied End: "Destroy target creature. If it wasn't attacking, its controller draws a card."
  if (/^it (was|wasn't) attacking$/.test(t) && b.it?.ref === 'target') return t.includes("wasn't") ? { type: 'not', cond: { type: 'was_attacking', of: b.it } } : { type: 'was_attacking', of: b.it };
  // Guildsworn Prowler: "When this creature dies, if it wasn't blocking, draw a card."
  if (/^it (was|wasn't) blocking$/.test(t) && b.it?.ref === 'trigger_object') return t.includes("wasn't") ? { type: 'not', cond: { type: 'was_attacking', blocking: true } } : { type: 'was_attacking', blocking: true };
  // Gunner Conscript: "When this creature dies, if it was enchanted"; Koll, the Forgemaster: "if it was enchanted or
  // equipped" — as it last existed.
  const wasAttached = /^it was (enchanted|equipped|enchanted or equipped)$/.exec(t);
  if (wasAttached && (b.it?.ref === 'trigger_object' || b.it?.ref === 'self')) return { type: 'was_type', attachment: wasAttached[1] === 'enchanted' ? 'Aura' : wasAttached[1] === 'equipped' ? 'Equipment' : 'either' };
  const wasType = /^it was an? (creature|artifact|enchantment|land|planeswalker)$/.exec(t);
  if (wasType) return { type: 'was_type', cardType: wasType[1]!.replace(/^\w/, (c) => c.toUpperCase()) };
  // Endless Evil: "When enchanted creature dies, if that creature was a Horror" — as it last existed.
  // Infernal Vessel: "When this creature dies, if it wasn't a Demon, …".
  const wasSub = /^(?:that creature|it) (was|wasn't) an? ([A-Z][a-z]+)$/.exec(t);
  if (wasSub && isSubtype(wasSub[2]!) && (b.it?.ref === 'trigger_object' || (/^that creature/.test(t) && b.named['that creature']?.ref === 'trigger_object'))) {
    const c: ConditionNode = { type: 'was_type', subtype: wasSub[2]! };
    return wasSub[1] === 'was' ? c : { type: 'not', cond: c };
  }
  // Liliana's Defeat: "Destroy target black creature or black planeswalker. If that permanent was a Liliana planeswalker, …";
  // Choking Sands: "Destroy target non-Swamp land. If that land was nonbasic, …" — as it last existed.
  // Filigree Fracture: "If that permanent was blue or black, draw a card."
  const wasColor = /^that (?:permanent|creature|artifact|enchantment|planeswalker) was (white|blue|black|red|green)(?: or (white|blue|black|red|green))?$/.exec(t);
  if (wasColor && b.it?.ref === 'target') return { type: 'was_type', of: b.it, colors: [wasColor[1]!, wasColor[2]].filter(Boolean).map((c) => COLOR_WORDS[c!]!) } as ConditionNode;
  // Budding Insurgent: "If that permanent was a legendary enchantment, draw a card."
  const wasSuperType = /^that (?:permanent|creature|land|artifact|enchantment|planeswalker) was an? (legendary|snow|basic) (artifact|creature|enchantment|land|planeswalker)$/.exec(t);
  if (wasSuperType && b.it?.ref === 'target') return { type: 'was_type', of: b.it, supertype: capitalise(wasSuperType[1]!), cardType: capitalise(wasSuperType[2]!) } as ConditionNode;
  const wasKind = /^that (?:permanent|creature|land|artifact|planeswalker) was (?:an? ([A-Z][a-z]+) (planeswalker|creature|land|artifact)|(nonbasic|basic|legendary|nonlegendary))$/.exec(t);
  if (wasKind && b.it?.ref === 'target' && (!wasKind[1] || isSubtype(wasKind[1]))) {
    if (wasKind[1]) return { type: 'was_type', of: b.it, subtype: wasKind[1], cardType: capitalise(wasKind[2]!) };
    const sup = wasKind[3]!.replace(/^non/, '');
    return { type: 'was_type', of: b.it, supertype: capitalise(sup), ...(wasKind[3]!.startsWith('non') ? { notSupertype: true } : {}) } as ConditionNode;
  }
  // Zephyr Sentinel: "return up to one other target creature you control to its owner's hand. If it was a Soldier, …".
  if (wasSub && wasSub[1] === 'was' && isSubtype(wasSub[2]!) && b.it?.ref === 'target') return { type: 'was_type', subtype: wasSub[2]!, of: b.it };
  // Uglúk of the White Hand: "If that creature was a Goblin or Orc".
  const wasEither = /^(?:that creature|it) was an? ([A-Z][a-z]+) or (?:an? )?([A-Z][a-z]+)$/.exec(t);
  if (wasEither && isSubtype(wasEither[1]!) && isSubtype(wasEither[2]!) && (b.it?.ref === 'trigger_object' || (/^that creature/.test(t) && b.named['that creature']?.ref === 'trigger_object')))
    return { type: 'or', any: [{ type: 'was_type', subtype: wasEither[1]! }, { type: 'was_type', subtype: wasEither[2]! }] };
  // Samut, Vizier of Naktamun: "if that creature entered this turn".
  if (/^(?:that creature|it) entered (?:the battlefield )?this turn$/.test(t) && b.it?.ref === 'trigger_object') return { type: 'is', of: { ref: 'trigger_object' }, filter: { enteredThisTurn: true } };
  // Grab the Prize: "the discarded card wasn't a land card"; Nasty End: "the sacrificed creature was legendary"; Falkenrath
  // Aristocrat: "the sacrificed creature was a Human" — what it was as it was sacrificed or discarded (CR 608.2h).
  // Vohar, Vodalian Desecrator: "If you discarded an instant or sorcery card this way" — the same as "the discarded card was".
  // Silvan Reveler: "If you discard a land card this way" — the same.
  const discardedThisWay = /^you discard(?:ed)? (an? .+? card) this way$/.exec(t);
  if (discardedThisWay) return parseCondition(`the discarded card was ${discardedThisWay[1]}`, b);
  const lkiWas = /^the (discarded|sacrificed) (?:card|creature|permanent|artifact) (was|wasn't) (an? )?(.+)$/.exec(t);
  if (lkiWas) {
    const quality = lkiWas[4]!;
    const pf = parseFilter(/ card$/.test(quality) ? `${quality} in your graveyard` : lkiWas[3] ? quality : `${quality} permanent`, b.clone());
    const f = pf && !pf.plural ? pf.filter : null;
    if (f) {
      delete f.zone;
      delete f.owner;
    }
    const allowed = ['types', 'subtypes', 'supertypes', 'colors', 'multicolored'];
    if (!f || !Object.keys(f).length || Object.keys(f).some((k) => !allowed.includes(k))) return null;
    return { type: 'lki_was', what: lkiWas[1], filter: f, ...(lkiWas[2] === "wasn't" ? { not: true } : {}) };
  }
  // Minas Tirith: "you attacked with two or more creatures this turn"
  const attackedWith = /^you attacked with (\w+) or more creatures this turn$/.exec(t);
  if (attackedWith) {
    const n = parseAmount(attackedWith[1]!);
    return typeof n === 'number' ? { type: 'attacked_with', n } : null;
  }
  // Deepway Navigator: "As long as you attacked with three or more Merfolk this turn".
  const attackedWithKind = /^you attacked with (\w+) or more ([A-Z][\w-]*) this turn$/.exec(t);
  if (attackedWithKind) {
    const n = parseAmount(attackedWithKind[1]!);
    const st = subtypeOf(attackedWithKind[2]!);
    if (typeof n === 'number' && st) return { type: 'attacked_with', n, subtype: st };
  }
  // Case of the Gateway Express: "Three or more creatures attacked this turn." — anyone's.
  const creaturesAttacked = /^(\w+) or more creatures attacked this turn$/.exec(t);
  if (creaturesAttacked) {
    const n = parseAmount(creaturesAttacked[1]!);
    return typeof n === 'number' ? { type: 'attacked_with', n, anyone: true } : null;
  }
  // Ichor Shade: "if an artifact or creature was put into a graveyard from the battlefield this turn" — as it last existed.
  const fromField = /^an? (artifact|creature|enchantment|land|planeswalker|artifact or creature|creature or artifact|permanent) (?:was|were) put into a graveyard from the battlefield this turn$/.exec(t);
  if (fromField) {
    const types = fromField[1] === 'permanent' ? ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'] : fromField[1]!.split(' or ').map(capitalise);
    return { type: 'amount', amount: { kind: 'died_this_turn', types }, op: 'ge', n: 1 } as ConditionNode;
  }
  // Case of the Gorgon's Kiss: "Three or more creature cards were put into graveyards from anywhere this turn."
  // Macabre Reconstruction: "if a creature card was put into your graveyard from anywhere this turn".
  const toYards = /^(?:(a|an)|(\w+) or more) (creature |artifact |land )?cards? (?:was|were) put into (graveyards|your graveyard) from anywhere this turn$/.exec(t);
  if (toYards) {
    const n = toYards[1] ? 1 : parseAmount(toYards[2]!);
    return typeof n === 'number' ? { type: 'to_graveyard_this_turn', n, ...(toYards[3] ? { cardType: capitalise(toYards[3].trim()) } : {}), ...(toYards[4] === 'your graveyard' ? { yours: true } : {}) } : null;
  }
  // Skullcage: "unless they have exactly three or exactly four cards in hand".
  const exactHand = /^(?:they|that player) (?:has|have) exactly (\w+)(?: or exactly (\w+))? cards? in (?:hand|their hand)$/.exec(t);
  if (exactHand && b.player) {
    const count = parseCount('the number of cards in their hand', b.clone());
    const ns = [exactHand[1], exactHand[2]].filter(Boolean).map((w) => parseAmount(w!));
    if (count && ns.every((n) => typeof n === 'number')) {
      const one = ns.map((n) => ({ type: 'amount', amount: count, op: 'eq', n }) as ConditionNode);
      return one.length === 1 ? one[0]! : { type: 'or', any: one };
    }
  }
  // Cactuar: "if this creature didn't enter the battlefield this turn".
  if (/^~ didn't enter (?:the battlefield )?this turn$/.test(t)) return { type: 'not', cond: { type: 'is', of: { ref: 'self' }, filter: { enteredThisTurn: true } } };
  // Fear of Immobility: "tap up to one target creature. If an opponent controls that creature, put a stun counter on it."
  if (/^an opponent controls (?:that creature|that permanent|it)$/.test(t)) {
    const of = b.named[t.replace(/^an opponent controls /, '')] ?? (b.it && b.it.ref !== 'self' ? b.it : null);
    if (of) return { type: 'is', of, filter: { controller: 'opponent' } };
  }
  // Hidetsugu's Second Rite: "If target player has exactly 10 life" — the target named here, for "that player" after.
  const exactLife = /^(target player|target opponent|that player|you) (?:has|have) exactly (\w+) life$/.exec(t);
  if (exactLife) {
    const n = parseAmount(exactLife[2]!);
    const who = typeof n === 'number' ? parsePlayerRef(exactLife[1]!, b) : null;
    if (who && typeof n === 'number') return { type: 'amount', amount: { kind: 'life', who }, op: 'eq', n };
  }
  // The End: "if your life total is 5 or less".
  const lifeAtMost = /^your life total is (\d+) or (less|greater)$/.exec(t);
  if (lifeAtMost) return { type: 'life', op: lifeAtMost[2] === 'less' ? 'le' : 'ge', n: Number(lifeAtMost[1]) };
  // Ozai, the Phoenix King: "as long as you have six or more unspent mana".
  const unspent = /^you have (\w+) or more unspent mana$/.exec(t);
  if (unspent) {
    const n = parseAmount(unspent[1]!);
    return typeof n === 'number' ? { type: 'amount', amount: { kind: 'unspent_mana' }, op: 'ge', n } : null;
  }
  // Case of the Shattered Pact: "There are five colors among permanents you control."
  const colorsAmong = /^there are (\w+)(?: or more)? colors among (.+)$/.exec(t);
  if (colorsAmong) {
    const n = parseAmount(colorsAmong[1]!);
    const pf = typeof n === 'number' ? parseFilter(colorsAmong[2]!, b) : null;
    return pf && pf.plural && !pf.filter.zone ? { type: 'amount', amount: { kind: 'colors_among', filter: pf.filter }, op: 'ge', n: n as number } : null;
  }
  // Kytheon, Hero of Akros: "if Kytheon and at least two other creatures attacked this combat".
  const withSelf = /^~ and at least (\w+) other creatures attacked this combat$/.exec(t);
  if (withSelf) {
    const n = parseAmount(withSelf[1]!);
    return typeof n === 'number' ? { type: 'attacked_with', n, withSelf: true } : null;
  }
  // Land Tax: "if an opponent controls more lands than you"
  // Archaeomancer's Map: "if that player controls more lands than you"
  // Aerial Surveyor: "if defending player controls more lands than you".
  // Isolated Watchtower: "if an opponent controls at least two more lands than you" — by that many.
  // Timely Reinforcements: "if you control fewer creatures than an opponent" — the same test.
  const fewerThan = /^you control fewer (.+?) than an opponent$/.exec(t);
  if (fewerThan) t = `an opponent controls more ${fewerThan[1]} than you`;
  // Unified Will: "if you control more creatures than that spell's controller" — the other way round.
  const youMore = /^you control more (.+?) than (that spell's controller|that player|defending player|target opponent|an opponent)$/.exec(t);
  if (youMore) {
    const pf = parseFilter(youMore[1]!, b);
    if (!pf || !pf.plural || pf.filter.zone || pf.filter.controller) return null;
    const player = youMore[2] !== 'an opponent' ? parsePlayerRef(youMore[2]!, b) : null;
    if (youMore[2] !== 'an opponent' && (!player || player.ref === 'you' || player.ref === 'players')) return null;
    return { type: 'opponent_has_more', filter: pf.filter, ...(player ? { player } : {}), youMore: true };
  }
  const more = /^(an opponent|that player|defending player) controls (?:at least (two|three|four) )?more (.+?) than you(?: do)?$/.exec(t);
  if (more) {
    const pf = parseFilter(more[3]!, b);
    if (!pf || !pf.plural || pf.filter.zone || pf.filter.controller) return null;
    const player = more[1] !== 'an opponent' ? parsePlayerRef(more[1]!, b) : null;
    if (more[1] !== 'an opponent' && !player) return null;
    return { type: 'opponent_has_more', filter: pf.filter, ...(player ? { player } : {}), ...(more[2] ? { by: parseAmount(more[2]) } : {}) };
  }
  if (t === "you created a token this turn" || t === "you've created a token this turn") return { type: 'this_turn', event: 'you_created_token' };
  if (t === 'a permanent was put into your hand from the battlefield this turn') return { type: 'this_turn', event: 'bounced_to_your_hand' };
  if (/^(?:it|~) dealt combat damage to a player this turn$/.test(t) && (!b.it || b.it.ref === 'self' || b.it.ref === 'trigger_object')) return { type: 'this_turn', event: 'self_dealt_combat_damage' };
  // "If an opponent cast a blue spell this turn", "… cast three or more spells this turn"
  const oppCast = /^an opponent (?:has )?cast (a|an|\w+ or more) (.*?)spells? this turn$/.exec(t);
  if (oppCast) {
    const c = count(oppCast[1]!);
    const words = oppCast[2]!.trim();
    const pf = words ? parseFilter(`${words} spell`, b) : null;
    if (!c?.min || (words && (!pf || pf.plural))) return null;
    return { type: 'this_turn', event: 'opponent_cast', min: c.min, ...(pf ? { filter: (({ zone: _z, ...f }) => f)(pf.filter) } : {}) };
  }
  // "If an opponent drew three or more cards this turn"
  // Even the Score: "if an opponent has drawn four or more cards this turn".
  const oppDrew = /^an opponent (?:drew|has drawn) (\w+ or more) cards this turn$/.exec(t);
  if (oppDrew) {
    const c = count(oppDrew[1]!);
    return c?.min ? { type: 'this_turn', event: 'opponent_drew', min: c.min } : null;
  }
  // Knight of Grace: "as long as any player controls a black permanent" — anyone's.
  const anyControls = /^any player controls (an? .+)$/.exec(t);
  if (anyControls) {
    const pf = parseFilter(anyControls[1]!, b.clone());
    if (pf && !pf.plural && !pf.filter.zone && !pf.filter.controller) return { type: 'count', who: 'all', filter: pf.filter, min: 1 };
  }
  // Blasphemous Edict: "there are thirteen or more creatures on the battlefield" — everyone's.
  const onField = /^there are (\w+ or more) (.+?) on the battlefield$/.exec(t);
  if (onField) {
    const c = count(onField[1]!);
    const pf = parseFilter(onField[2]!, b);
    if (c && pf && pf.plural && !pf.filter.zone && !pf.filter.controller) return { type: 'count', who: 'all', filter: pf.filter, ...c };
  }
  // "If three or more creatures are attacking", "If exactly one creature is attacking", "If a white creature is attacking"
  const attacking = /^(a|an|exactly \w+|\w+ or more|\w+ or fewer) (.+?) (?:is|are) attacking$/.exec(t);
  if (attacking) {
    const exact = /^exactly (\w+)$/.exec(attacking[1]!);
    const n = exact ? parseAmount(exact[1]!) : null;
    const c = exact ? (typeof n === 'number' ? { min: n, max: n } : null) : count(attacking[1]!);
    const pf = parseFilter(attacking[2]!, b);
    if (!c || !pf || pf.filter.zone || pf.filter.controller || pf.filter.combat) return null;
    return { type: 'count', who: 'all', filter: { ...pf.filter, combat: 'attacking' }, ...c };
  }
  // Werewolves (and others) look at the previous turn.
  if (t === 'no spells were cast last turn') return { type: 'spells_last_turn', max: 0 };
  const lastTurn = /^a player cast (\w+) or more spells last turn$/.exec(t);
  if (lastTurn) {
    const n = parseAmount(lastTurn[1]!);
    return typeof n === 'number' ? { type: 'spells_last_turn', perPlayerMin: n } : null;
  }
  // Sigardian Paladin: "As long as you've put one or more +1/+1 counters on a creature this turn".
  if (t === "you've put one or more +1/+1 counters on a creature this turn") return { type: 'this_turn', event: 'you_put_plus_counters' };
  // Fairgrounds Trumpeter: "if a +1/+1 counter was put on a permanent under your control this turn".
  if (t === 'a +1/+1 counter was put on a permanent under your control this turn') return { type: 'this_turn', event: 'plus_counters_on_yours' };
  // Charging Cinderhorn: "if no creatures attacked this turn" — no player attacked with any.
  if (t === 'no creatures attacked this turn') return { type: 'not', cond: { type: 'this_turn', event: 'anyone_attacked' } };
  // Spellpyre Phoenix: "if you cycled two or more cards this turn" (CR 702.29e: activated a cycling ability).
  const cycledN = /^you(?:'ve)? cycled (a card|(?:two|three|four) or more cards) this turn$/.exec(t);
  if (cycledN) {
    const n = cycledN[1] === 'a card' ? 1 : parseAmount(cycledN[1]!.split(' ')[0]!);
    if (typeof n === 'number') return { type: 'this_turn', event: 'you_cycled', min: n };
  }
  // First Response: "if you lost life last turn" — the previous turn's log.
  const prevTurn = /^(you|an opponent) lost life last turn$/.exec(t);
  if (prevTurn) return { type: 'this_turn', event: prevTurn[1] === 'you' ? 'you_lost_life' : 'opponent_lost_life', lastTurn: true };
  // Command the Stage: "if an opponent was dealt noncombat damage last turn".
  if (t === 'an opponent was dealt noncombat damage last turn') return { type: 'this_turn', event: 'opponent_noncombat_damaged', lastTurn: true };

  // "if it had no -1/-1 counters on it" (persist, CR 702.79a) — about the object as it last existed.
  const counters = /^it had no (\S+) counters on it$/.exec(t);
  if (counters && b.it) return { type: 'counters', of: b.it, counter: counters[1]!, max: 0 };
  // Blowfly Infestation: "Whenever a creature dies, if it had a -1/-1 counter on it" — as it last existed.
  const hadOne = /^it had (?:an?|one or more) (\S+) counters? on it$/.exec(t);
  if (hadOne && b.it) return { type: 'counters', of: b.it, counter: hadOne[1]!, min: 1 };
  // The Ozolith: "if it had counters on it" (as it last existed), "if ~ has counters on it".
  // Nikara, Lair Scavenger: "if it had one or more counters on it".
  // Leader's Talent: "if it had a counter on it".
  if ((t === 'it had counters on it' || t === 'it had one or more counters on it' || t === 'it had a counter on it') && b.it) return { type: 'counters', of: b.it, min: 1 };
  // Unstoppable Slasher: "if it had no counters on it" — any kind.
  if (t === 'it had no counters on it' && b.it) return { type: 'counters', of: b.it, max: 0 };
  if (t === '~ has counters on it') return { type: 'counters', of: { ref: 'self' }, min: 1 };
  // Shatterskull Charger: "if this creature doesn't have a +1/+1 counter on it".
  const lacks = /^(?:~|it) doesn't have an? (\S+) counter on it$/.exec(t);
  if (lacks && (t.startsWith('~') || !b.it || b.it.ref === 'self')) return { type: 'counters', of: { ref: 'self' }, counter: lacks[1]!.replace(/−/g, '-'), max: 0 };
  // Marcus, Mutant Mayor: "if that creature has a +1/+1 counter on it" — the creature the trigger is about, now.
  const thatHas = /^(?:that creature|it) has (?:an?|one or more) (\S+) counters? on it$/.exec(t);
  if (thatHas && b.it?.ref === 'trigger_object') return { type: 'counters', of: b.it, counter: thatHas[1]!, min: 1 };
  // Depletion lands: "there are no depletion counters on ~", "~ has no time counters on it"
  // Temple of Cyclical Time: "Activate only if it has no time counters on it" — this land.
  const none = /^(?:there are no (\S+) counters on ~|~ has no (\S+) counters on it)$/.exec(t) ?? (!b.it || b.it.ref === 'self' ? /^it has no ()(\S+) counters on it$/.exec(t) : null);
  if (none) return { type: 'counters', of: { ref: 'self' }, counter: none[1] || none[2]!, max: 0 };
  // Garruk Relentless: "When Garruk has two or fewer loyalty counters on him, transform him."
  const orFewer = /^~ has (\w+) or fewer (\S+) counters on (?:it|him|her)$/.exec(t);
  if (orFewer) {
    const n = parseAmount(orFewer[1]!);
    return typeof n === 'number' ? { type: 'counters', of: { ref: 'self' }, counter: orFewer[2]!, max: n } : null;
  }
  // Runaway Steam-Kin: "if this creature has fewer than three +1/+1 counters on it".
  const fewer = /^(?:~|it) has fewer than (\w+) (\S+) counters on (?:it|him|her)$/.exec(t);
  if (fewer) {
    const n = parseAmount(fewer[1]!);
    const of: Ref = /^it /.test(t) ? (b.it ?? { ref: 'self' }) : { ref: 'self' };
    return typeof n === 'number' ? { type: 'counters', of, counter: fewer[2]!, max: n - 1 } : null;
  }
  // "~ has a +1/+1 counter on it", "~ has three or more +1/+1 counters on it", "~ has a counter on it".
  const has =
    /^(?:~|it|that creature) has (a|an|one or more|\w+ or more) (?:(\S+) )?counters? on (?:it|him|her|them)$/.exec(t) ??
    // Twenty-Toed Toad: "there are twenty or more counters on it" — any kind.
    /^there are (\w+ or more) (?:(\S+) )?counters on (?:~|it)$/.exec(t);
  if (has) {
    const n = /^(?:a|an|one or more)$/.test(has[1]!) ? 1 : parseAmount(has[1]!.replace(/ or more$/, ''));
    if (typeof n !== 'number') return null;
    // Hadana's Climb: "Then if that creature has three or more +1/+1 counters on it" — the target named before.
    const that = b.named['that creature'] ?? (b.it?.ref === 'target' ? b.it : undefined);
    if (/^that creature /.test(t) && !that) return null;
    const of: Ref = /^that creature /.test(t) ? that! : /^it |^there are .+ on it$/.test(t) ? (b.it ?? { ref: 'self' }) : { ref: 'self' };
    return { type: 'counters', of, ...(has[2] ? { counter: has[2] } : {}), min: n };
  }
  return null;
}

/** The object a condition is about ("As long as ~ is equipped, it …"), for the pronoun after it. */
export function conditionSubject(c: ConditionNode): Ref | null {
  switch (c.type) {
    case 'self_tapped':
    case 'has_attached':
    case 'monstrous':
    case 'paid':
    case 'arrived_since_upkeep':
    case 'renowned':
    case 'saddled':
    case 'prepared':
      return { ref: 'self' };
    case 'ring_bearer':
      return c.any ? null : { ref: 'self' };
    case 'is':
    case 'counters':
      return c.of as Ref;
    default:
      return null;
  }
}
