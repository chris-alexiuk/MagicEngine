import type { AmountExpr, ConditionNode, ObjectFilter, Ref } from '@mtg/schema';
import type { Binder } from './binder.js';
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
  if (t === 'tapped' || t === 'untapped') return { tapped: t === 'tapped' };
  const color = COLOR_WORDS[t];
  if (color) return { colors: [color] };
  if (t === 'legendary') return { supertypes: ['Legendary'] };
  if (t === 'multicolored') return { multicolored: true };
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
  const vsStart = /^your life total is (greater|less) than your starting life total$/.exec(t);
  if (vsStart) return { type: 'life', op: vsStart[1] === 'greater' ? 'gt' : 'lt', starting: true };
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
  if (/^an opponent was dealt damage this turn$/.test(t)) return { type: 'this_turn', event: 'opponent_damaged' };
  // Surge (CR 702.117a): "if you or one of your teammates has cast another spell this turn"
  if (/^(?:you or one of your teammates has|you've) cast another spell this turn$/.test(t)) return { type: 'this_turn', event: 'you_cast_spell' };
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
  // "if its evoke cost was paid", "if this spell's dash cost was paid", "if the buyback cost was paid" (CR 601.2f).
  const paid = /^(?:its|~'s|the|her|his) (\w+) cost was paid$/.exec(t) ?? /^an? (\w+) cost was paid for (?:it|~)$/.exec(t);
  if (paid) return { type: 'paid', cost: paid[1]!.toLowerCase() };
  // The Mastery cycle: "You may pay {1}{B} rather than pay this spell's mana cost. … If the {1}{B} cost was paid, …" — the
  // alternative cost (its option is "alt").
  if (/^the (?:\{[^}]+\})+ cost was paid$/.test(t)) return { type: 'paid', cost: 'alt' };
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
  // Sevinne's Reclamation: "If this spell was cast from a graveyard"; "if this spell was cast from your hand" (a copy wasn't
  // cast, CR 707.10).
  // Anti-Venom: "When Anti-Venom enters, if he was cast" — by anyone (CR 601.2: it was a spell before it entered).
  // Mirror of Life Trapping: "Whenever a creature enters, if it was cast" — the entering creature.
  if (/^(?:~|it|he|she) was cast$/.test(t)) return { type: 'cast_by_you', anyone: true, ...(!t.startsWith('~') && b.it && b.it.ref !== 'self' ? { of: b.it } : {}) };
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
  // Merry, Esquire of Rohan: "~ has first strike as long as it's equipped" — "it" being this creature.
  const attached = /^~ is (equipped|enchanted)$/.exec(t) ?? (/^it's (equipped|enchanted)$/.test(t) && (!b.it || b.it.ref === 'self') ? /^it's (equipped|enchanted)$/.exec(t) : null);
  if (attached) return { type: 'has_attached', subtype: attached[1] === 'equipped' ? 'Equipment' : 'Aura' };
  if (/^~ is monstrous$/.test(t)) return { type: 'monstrous' };
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
  if (/^it's your (?:precombat )?main phase$/.test(t)) return { type: 'step', main: true, yours: true };
  // Tribute to the World Tree: "if its power is 3 or greater"; "if that creature's toughness is 2 or less"
  const statIs = /^(its|~'s|that creature's|that card's) (power|toughness|mana value) is (\w+) or (greater|more|less|fewer)$/.exec(t);
  if (statIs) {
    const of = statIs[1] === "~'s" ? ({ ref: 'self' } as Ref) : b.it;
    const n = parseAmount(statIs[3]!);
    if (of && typeof n === 'number') {
      const key = statIs[2] === 'mana value' ? 'manaValue' : (statIs[2] as 'power' | 'toughness');
      return { type: 'is', of, filter: { [key]: { op: /greater|more/.test(statIs[4]!) ? 'ge' : 'le', n } } };
    }
  }
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
  const itsKeyword = /^(?:it|that creature) has (flying|toxic|trample|deathtouch|haste|lifelink|vigilance|reach|defender|menace|first strike|double strike)$/.exec(t);
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
  // "as long as it's attacking" — "it" being what the ability is about.
  const itIs = /^it(?:'s| is) (attacking|blocking|tapped|untapped|attacking or blocking)$/.exec(t);
  if (itIs && b.it) {
    const filter = stateFilter(itIs[1]!, b);
    if (filter) return { type: 'is', of: b.it, filter };
  }
  // CR 705.2: "If you win the flip", "If you lose the flip"
  if (t === 'you win the flip') return { type: 'won_flip' };
  // CR 701.30d: "If you win" (a clash), "If you won"
  if (t === 'you win' || t === 'you won') return { type: 'won_clash' };
  if (t === 'you lose the flip') return { type: 'won_flip', not: true };
  // CR 702.179e: "you have max speed"; CR 702.131c: "you have the city's blessing"
  if (/^you have max speed$/.test(t)) return { type: 'max_speed' };
  if (/^you don't have max speed$/.test(t)) return { type: 'max_speed', not: true };
  if (/^you have the city's blessing$/.test(t)) return { type: 'city_blessing' };
  // CR 702.100a (evolve): "that creature's power is greater than ~'s power and/or that creature's toughness is greater than ~'s toughness"
  if (t === "that creature's power is greater than ~'s power and/or that creature's toughness is greater than ~'s toughness" && b.it) {
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
  // Fear of the Dark: "if defending player controls no Glimmer creatures" — the player this creature is attacking.
  const defNone = /^defending player controls no (.+)$/.exec(t);
  if (defNone && b.it?.ref === 'self' && b.named['defending player']) {
    const pf = parseFilter(defNone[1]!, b.clone());
    if (pf && pf.plural && !pf.filter.zone && !pf.filter.controller) return { type: 'count', who: 'all', filter: { ...pf.filter, controller: 'defending' }, max: 0 };
  }
  // Waterspout Warden: "if another creature entered the battlefield under your control this turn".
  const anotherEntered = /^another (creature|artifact|land|permanent) entered the battlefield under your control this turn$/.exec(t);
  if (anotherEntered) return { type: 'entered_this_turn', filter: { ...(anotherEntered[1] === 'permanent' ? {} : { types: [capitalise(anotherEntered[1]!)] }), other: true }, min: 1 };
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
  const control = /^(you|an opponent|each opponent|your opponents) controls? (a|an|another|no|at least \w+|\w+ or more|\w+ or fewer) (other )?(.+)$/.exec(t);
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
  // CR 701.59c: "if evidence was collected"
  if (t === 'evidence was collected') return { type: 'paid', cost: 'collect_evidence' };
  // CR 702.187b (mayhem): "you discarded this card this turn"
  if (/^you discarded (?:~|it) this turn$/.test(t)) return { type: 'discarded_this_turn' };
  // CR 702.76a (prowl), CR 702.173a (freerunning)
  if (/^a player was dealt combat damage this turn by a source that, at the time it dealt that damage, was under your control and had any of ~'s creature types$/.test(t)) {
    return { type: 'combat_damage_by', sharesType: true };
  }
  // Blitzball: "an opponent was dealt combat damage by a legendary creature this turn".
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
  const fewerGy = /^there are fewer than (\w+) cards in your graveyard$/.exec(t);
  if (fewerGy) {
    const n = parseAmount(fewerGy[1]!);
    return typeof n === 'number' && n > 0 ? { type: 'graveyard', op: 'le', n: n - 1 } : null;
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
    'a spell was warped this turn': 'warped',
    // CR 700.13
    "you've committed a crime this turn": 'you_committed_crime',
    'you committed a crime this turn': 'you_committed_crime',
    // CR 700.11
    'you descended this turn': 'you_descended',
    "you've descended this turn": 'you_descended',
    'a creature died under your control this turn': 'your_creature_died',
    'a creature you controlled died this turn': 'your_creature_died',
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
  // Mirrex: "Activate only if this land entered this turn."
  if (/^(?:~|this (?:land|creature|artifact|permanent|enchantment)) entered (?:the battlefield )?this turn$/.test(t)) return { type: 'is', of: { ref: 'self' }, filter: { enteredThisTurn: true } };
  // Fortune Teller's Talent: "you've cast a spell this turn"; Essence Channeler: "you've lost life this turn".
  if (/^you(?:'ve)? cast a spell this turn$/.test(t)) return { type: 'this_turn', event: 'you_cast_spell' };
  // Conduit of Worlds: "If you haven't cast a spell this turn".
  if (/^you (?:haven't|have not|didn't) cast a spell this turn$/.test(t)) return { type: 'not', cond: { type: 'this_turn', event: 'you_cast_spell' } };
  if (/^you(?:'ve)? lost life this turn$/.test(t)) return { type: 'this_turn', event: 'you_lost_life' };
  // Luminarch Ascension: "if you didn't lose life this turn".
  if (/^you didn't lose life this turn$|^you haven't lost life this turn$/.test(t)) return { type: 'not', cond: { type: 'this_turn', event: 'you_lost_life' } };
  // Stormwing Entity: "if you've cast an instant or sorcery spell this turn".
  const castOne = /^you(?:'ve)? cast an? (.+?) spell this turn$/.exec(t);
  if (castOne) {
    const pf = parseFilter(`${castOne[1]} spell`, b.clone());
    if (pf && !pf.plural && (!pf.filter.zone || pf.filter.zone === 'stack') && !pf.filter.controller) {
      const { zone: _z, ...filter } = pf.filter;
      return { type: 'this_turn', event: 'you_cast', filter, min: 1 };
    }
  }
  // Heroic Return: "if a creature is attacking you".
  if (t === 'a creature is attacking you') return { type: 'attacking_you', min: 1 };
  // Lyse Hext: "you've cast two or more noncreature spells this turn"
  const castN = /^you(?:'ve)? cast (two|three|four|five) or more (.+?) spells this turn$/.exec(t);
  if (castN) {
    const pf = parseFilter(`${castN[2]} spells`, b.clone());
    if (!pf || !pf.plural || (pf.filter.zone && pf.filter.zone !== 'stack') || pf.filter.controller) return null;
    const { zone: _z, ...filter } = pf.filter;
    return { type: 'this_turn', event: 'you_cast', filter, min: parseAmount(castN[1]!) as number };
  }
  // Sentinel Sarah Lyons: "an artifact entered the battlefield under your control this turn"
  const enteredYours = /^an? (\w+) entered the battlefield under your control this turn$/.exec(t);
  if (enteredYours && TYPE_NOUNS[enteredYours[1]!]) return { type: 'this_turn', event: 'entered_yours', filter: { types: [TYPE_NOUNS[enteredYours[1]!]!] } };
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
  if (/^it (was|wasn't) attacking$/.test(t) && b.it?.ref === 'trigger_object') return t.includes("wasn't") ? { type: 'not', cond: { type: 'was_attacking' } } : { type: 'was_attacking' };
  // Guildsworn Prowler: "When this creature dies, if it wasn't blocking, draw a card."
  if (/^it (was|wasn't) blocking$/.test(t) && b.it?.ref === 'trigger_object') return t.includes("wasn't") ? { type: 'not', cond: { type: 'was_attacking', blocking: true } } : { type: 'was_attacking', blocking: true };
  const wasType = /^it was an? (creature|artifact|enchantment|land|planeswalker)$/.exec(t);
  if (wasType) return { type: 'was_type', cardType: wasType[1]!.replace(/^\w/, (c) => c.toUpperCase()) };
  // Endless Evil: "When enchanted creature dies, if that creature was a Horror" — as it last existed.
  const wasSub = /^(?:that creature|it) was an? ([A-Z][a-z]+)$/.exec(t);
  if (wasSub && isSubtype(wasSub[1]!) && (b.it?.ref === 'trigger_object' || (/^that creature/.test(t) && b.named['that creature']?.ref === 'trigger_object'))) return { type: 'was_type', subtype: wasSub[1]! };
  // Uglúk of the White Hand: "If that creature was a Goblin or Orc".
  const wasEither = /^(?:that creature|it) was an? ([A-Z][a-z]+) or (?:an? )?([A-Z][a-z]+)$/.exec(t);
  if (wasEither && isSubtype(wasEither[1]!) && isSubtype(wasEither[2]!) && (b.it?.ref === 'trigger_object' || (/^that creature/.test(t) && b.named['that creature']?.ref === 'trigger_object')))
    return { type: 'or', any: [{ type: 'was_type', subtype: wasEither[1]! }, { type: 'was_type', subtype: wasEither[2]! }] };
  // Samut, Vizier of Naktamun: "if that creature entered this turn".
  if (/^(?:that creature|it) entered (?:the battlefield )?this turn$/.test(t) && b.it?.ref === 'trigger_object') return { type: 'is', of: { ref: 'trigger_object' }, filter: { enteredThisTurn: true } };
  // Grab the Prize: "the discarded card wasn't a land card"; Nasty End: "the sacrificed creature was legendary"; Falkenrath
  // Aristocrat: "the sacrificed creature was a Human" — what it was as it was sacrificed or discarded (CR 608.2h).
  // Vohar, Vodalian Desecrator: "If you discarded an instant or sorcery card this way" — the same as "the discarded card was".
  const discardedThisWay = /^you discarded (an? .+? card) this way$/.exec(t);
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
  // Case of the Gateway Express: "Three or more creatures attacked this turn." — anyone's.
  const creaturesAttacked = /^(\w+) or more creatures attacked this turn$/.exec(t);
  if (creaturesAttacked) {
    const n = parseAmount(creaturesAttacked[1]!);
    return typeof n === 'number' ? { type: 'attacked_with', n, anyone: true } : null;
  }
  // Case of the Gorgon's Kiss: "Three or more creature cards were put into graveyards from anywhere this turn."
  const toYards = /^(\w+) or more (creature |artifact |land )?cards were put into graveyards from anywhere this turn$/.exec(t);
  if (toYards) {
    const n = parseAmount(toYards[1]!);
    return typeof n === 'number' ? { type: 'to_graveyard_this_turn', n, ...(toYards[2] ? { cardType: capitalise(toYards[2].trim()) } : {}) } : null;
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
  const more = /^(an opponent|that player|defending player) controls more (.+?) than you(?: do)?$/.exec(t);
  if (more) {
    const pf = parseFilter(more[2]!, b);
    if (!pf || !pf.plural || pf.filter.zone || pf.filter.controller) return null;
    const player = more[1] !== 'an opponent' ? parsePlayerRef(more[1]!, b) : null;
    if (more[1] !== 'an opponent' && !player) return null;
    return { type: 'opponent_has_more', filter: pf.filter, ...(player ? { player } : {}) };
  }
  if (t === "you created a token this turn" || t === "you've created a token this turn") return { type: 'this_turn', event: 'you_created_token' };
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

  // "if it had no -1/-1 counters on it" (persist, CR 702.79a) — about the object as it last existed.
  const counters = /^it had no (\S+) counters on it$/.exec(t);
  if (counters && b.it) return { type: 'counters', of: b.it, counter: counters[1]!, max: 0 };
  // Blowfly Infestation: "Whenever a creature dies, if it had a -1/-1 counter on it" — as it last existed.
  const hadOne = /^it had (?:an?|one or more) (\S+) counters? on it$/.exec(t);
  if (hadOne && b.it) return { type: 'counters', of: b.it, counter: hadOne[1]!, min: 1 };
  // The Ozolith: "if it had counters on it" (as it last existed), "if ~ has counters on it".
  // Nikara, Lair Scavenger: "if it had one or more counters on it".
  if ((t === 'it had counters on it' || t === 'it had one or more counters on it') && b.it) return { type: 'counters', of: b.it, min: 1 };
  // Unstoppable Slasher: "if it had no counters on it" — any kind.
  if (t === 'it had no counters on it' && b.it) return { type: 'counters', of: b.it, max: 0 };
  if (t === '~ has counters on it') return { type: 'counters', of: { ref: 'self' }, min: 1 };
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
