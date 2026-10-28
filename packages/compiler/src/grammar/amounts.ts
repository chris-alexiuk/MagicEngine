import type { Amount, AmountExpr, Color, EffectNode, ObjectFilter, Ref } from '@mtg/schema';
import type { Binder } from './binder.js';
import { parseFilter, parseObjectRef, parsePlayerRef } from './nouns.js';
import { COLOR_WORDS, parseAmount } from './words.js';

/**
 * Numbers the game counts (CR 107.3, CR 608.2h): "the number of creatures you control",
 * "for each card in your hand", "its power", "your devotion to black".
 */

const ZONES: Record<string, { zone: 'hand' | 'graveyard' | 'library'; who: 'you' | 'opponents' | 'each' }> = {
  'in your hand': { zone: 'hand', who: 'you' },
  'in your graveyard': { zone: 'graveyard', who: 'you' },
  'in your library': { zone: 'library', who: 'you' },
  'in all graveyards': { zone: 'graveyard', who: 'each' },
  'in each graveyard': { zone: 'graveyard', who: 'each' },
  "in your opponents' graveyards": { zone: 'graveyard', who: 'opponents' },
  "in each opponent's graveyard": { zone: 'graveyard', who: 'opponents' },
  "in an opponent's graveyard": { zone: 'graveyard', who: 'opponents' },
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
  // "for each card in target opponent's hand", "the number of creature cards in target player's graveyard"
  // Peer into the Abyss: "the number of cards in their library" — the player the sentence is about.
  const theirs = /^(.+) in (?:(target player|target opponent|that player|the chosen player)'s|their) (hand|graveyard|library)$/.exec(t);
  if (theirs) {
    const head = theirs[1]!;
    let filter: ObjectFilter | undefined;
    if (!/^cards?$/.test(head)) {
      const pf = parseFilter(`${head} in your graveyard`, b);
      if (!pf || pf.plural !== plural) return null;
      const { zone: _z, owner: _o, ...rest } = pf.filter;
      filter = rest as ObjectFilter;
    } else if (head.endsWith('s') !== plural) return null;
    const player = theirs[2] ? parsePlayerRef(theirs[2], b) : b.player && b.player.ref !== 'players' && b.player.ref !== 'you' ? b.player : null;
    if (!player) return null;
    return { kind: 'cards', zone: theirs[3] as 'hand' | 'graveyard' | 'library', who: 'each', player, ...(filter ? { filter } : {}) };
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
  if (!pf || pf.plural !== plural || (pf.filter.zone && pf.filter.zone !== 'battlefield')) return null;
  return { kind: 'count', filter: pf.filter };
}

/** "creature destroyed this way", "cards exiled this way": what the resolution moved (by card type only). */
export function movedThisWay(text: string, b: Binder): AmountExpr | null {
  // Terastodon: "each permanent put into a graveyard this way" — from the battlefield to a graveyard.
  const m = /^(.+?) (destroyed|exiled|sacrificed|milled|put into a graveyard) this way$/.exec(text.trim());
  if (!m) return null;
  const noun = m[1]!.replace(/^(?:a|an) /, '').replace(/ cards?$|^cards?$/, '');
  const how = (m[2] === 'put into a graveyard' ? 'graveyard' : m[2]) as 'destroyed' | 'exiled' | 'sacrificed' | 'milled' | 'graveyard';
  if (!noun || /^permanents?$/.test(noun)) return { kind: 'moved_this_way', how };
  const pf = parseFilter(noun, b.clone());
  if (!pf) return null;
  const f = pf.filter;
  if (Object.keys(f).some((k) => k !== 'types' && k !== 'notTypes' && k !== 'token')) return null;
  // Blood Money: "each nontoken creature destroyed this way".
  return { kind: 'moved_this_way', how, ...(f.types ? { types: f.types } : {}), ...(f.notTypes ? { notTypes: f.notTypes } : {}), ...(f.token !== undefined ? { token: f.token } : {}) };
}

/** "creature that died this turn", "nontoken creatures that died this turn", "Zubera that died this turn". */
function diedThisTurn(text: string, b: Binder): AmountExpr | null {
  const m = /^(.+?) that died this turn$/.exec(text.trim());
  if (!m) return null;
  const pf = parseFilter(m[1]!, b.clone());
  if (!pf) return null;
  const { types, subtypes, token, controller, ...rest } = pf.filter;
  if (Object.keys(rest).length || token === true || (controller && controller !== 'you' && controller !== 'opponent')) return null;
  return {
    kind: 'died_this_turn',
    ...(types && !(types.length === 1 && types[0] === 'Creature') ? { types } : {}),
    ...(subtypes ? { subtypes } : {}),
    ...(token === false ? { nontoken: true as const } : {}),
    ...(controller ? { controller: controller as 'you' | 'opponent' } : {}),
  };
}

/** What follows "for each": a singular noun phrase. */
export function parseForEach(text: string, b: Binder): AmountExpr | null {
  const t = text.trim();
  // Multani: "for each land you control and each land card in your graveyard" — the two counts added.
  const added = /^(.+?) and each (.+)$/.exec(t);
  if (added) {
    const one = parseForEach(added[1]!, b.clone());
    const two = one ? parseForEach(added[2]!, b.clone()) : null;
    if (one && two && !one.times && !two.times && !one.plus && !two.plus) return { kind: 'sum', parts: [one, two] };
  }
  const moved = movedThisWay(t, b) ?? diedThisTurn(t, b);
  if (moved) return moved;
  // Syphon Mind: "for each card discarded this way"
  if (t === 'card discarded this way') return { kind: 'discarded_this_way' };
  if (t === 'opponent' || t === 'opponent you have') return { kind: 'players', who: 'opponents' };
  if (t === 'player') return { kind: 'players', who: 'each' };
  // CR 903.8: "for each time you've cast your commander from the command zone this game"
  if (/^time you've cast your commander from the command zone this game$/.test(t)) return { kind: 'commander_casts' };
  // CR 702.121a (melee): "for each opponent you attacked with a creature this combat"
  if (t === 'opponent you attacked with a creature this combat') return { kind: 'opponents_attacked' };
  // CR 702.44a / converge: "for each color of mana spent to cast it"
  if (/^color of mana spent to cast (?:it|~|this spell)$/.test(t)) return { kind: 'colors_spent' };
  // CR 700.8: "for each creature in your party"
  if (t === 'creature in your party') return { kind: 'party' };
  if (t === "spell you've cast this turn") return { kind: 'spells_cast_this_turn' };
  // Neheb, the Eternal: "for each 1 life your opponents have lost this turn"
  const lifeEach = /^1 life (.+?) this turn$/.exec(t);
  if (lifeEach) return lifeThisTurn(lifeEach[1]!);
  // Faeburrow Elder: "for each color among permanents you control"
  const colorAmong = /^color among (.+)$/.exec(t);
  if (colorAmong) {
    const pf = parseFilter(colorAmong[1]!, b);
    return pf && pf.plural && !pf.filter.zone ? { kind: 'colors_among', filter: pf.filter } : null;
  }
  // Domain (CR 305.6): "for each basic land type among lands you control"; delirium-style card types.
  if (t === 'basic land type among lands you control') return { kind: 'domain' };
  if (t === 'card type among cards in your graveyard') return { kind: 'card_types' };
  // CR 701.38: "for each death vote"
  const vote = /^(.+) vote$/.exec(t);
  if (vote && b.votes.includes(vote[1]!)) return { kind: 'votes', option: vote[1]! };
  // CR 702.23a (rampage): "for each creature blocking it beyond the first"
  const blocking = /^creature blocking (it|~)( beyond the first)?$/.exec(t);
  if (blocking) return { kind: 'blockers', of: blocking[1] === '~' ? { ref: 'self' } : (b.it ?? { ref: 'self' }), ...(blocking[2] ? { beyond: 1 } : {}) };
  // "for each instant and sorcery card in your graveyard": a card of either type.
  const both = /^(\w+) and (\w+) card (in .+)$/.exec(t);
  if (both) return objects(`${both[1]} or ${both[2]} card ${both[3]}`, b, false);
  // CR 702.33c (multikicker): "for each time it was kicked"
  if (/^time (?:~|it) was kicked$/.test(t)) return { kind: 'kicks' };
  // "for each time its replicate cost was paid", "… its squad cost was paid"
  const paidTimes = /^time (?:its|~'s) (\w+) cost was paid$/.exec(t);
  if (paidTimes) return { kind: 'paid_times', cost: paidTimes[1]!.toLowerCase() };
  // CR 702.40a: "for each other spell that was cast before it this turn"
  if (/^other spell that was cast before (?:it|~) this turn$/.test(t)) return { kind: 'cast_before', of: b.it ?? { ref: 'self' } };
  // Twitching Doll: "for each counter on this creature" — of any kind.
  const counter = /^(?:(\S+) )?counter on (.+)$/.exec(t);
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
  const t = text.trim();
  // "the amount of life you gained this turn", "the total amount of life your opponents have lost this turn"
  const lifeAmount = /^the (?:total )?amount of life (.+?) this turn$/.exec(t);
  if (lifeAmount) return lifeThisTurn(lifeAmount[1]!);
  // Ghalta: "the total power of creatures you control"
  const totalPower = /^the total (power|mana value) of (.+)$/.exec(t);
  if (totalPower) {
    const pf = parseFilter(totalPower[2]!, b);
    return pf && pf.plural && !pf.filter.zone ? { kind: 'total_power', filter: pf.filter, ...(totalPower[1] === 'mana value' ? { stat: 'mana_value' as const } : {}) } : null;
  }
  // CR 903.4: "the number of colors in your commanders' color identity"
  if (/^the number of colors in your commanders?'s? color identity$/.test(t)) return { kind: 'commander_colors' };
  // Mockingbird: "the amount of mana spent to cast this creature" (CR 601.2h) — the mana paid for it.
  if (/^the amount of mana spent to cast (?:~|this creature|this spell)$/.test(t)) return { kind: 'mana_spent', of: { ref: 'self' } };
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
  // Sea Gate Restoration: "the number of cards in your hand plus one"
  const plusAfter = /^(.+) plus (one|two|three|four|five)$/.exec(t);
  if (plusAfter && !/^\w+$/.test(plusAfter[1]!)) {
    const inner = parseCount(plusAfter[1]!, b);
    const n = parseAmount(plusAfter[2]!);
    if (inner && typeof n === 'number') return { ...inner, plus: (inner.plus ?? 0) + n };
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
  const number = /^the number of (.+)$/.exec(t);
  if (number) {
    const what = number[1]!;
    const moved = movedThisWay(what, b) ?? diedThisTurn(what, b);
    if (moved) return moved;
    if (what === 'opponents you have') return { kind: 'players', who: 'opponents' };
    // Meren: "the number of experience counters you have" (CR 122.1: counters on a player).
    const playerCounters = /^(\w+) counters you have$/.exec(what);
    if (playerCounters) return { kind: 'counters', of: { ref: 'you' }, counter: playerCounters[1]! };
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
  const lki = /^the (sacrificed|discarded) (?:creature|artifact|permanent|card|land)'s (power|toughness|mana value)$/.exec(t);
  if (lki) {
    // Momentous Fall: "… equal to the sacrificed creature's power, then you gain life equal to its toughness."
    if (lki[1] === 'sacrificed' && (!b.it || b.it.ref === 'self')) b.it = { ref: 'sacrificed_this_way' };
    return { kind: 'cost_lki', cost: lki[1] as 'sacrificed' | 'discarded', stat: lki[2] === 'mana value' ? 'mana_value' : (lki[2] as 'power' | 'toughness') };
  }
  // Skyclave Apparition: "the mana value of the exiled card"
  const statOfThe = /^the (power|toughness|mana value) of (.+)$/.exec(t);
  if (statOfThe) {
    const of = parseObjectRef(statOfThe[2]!, b.clone(), 'static');
    const s = statOfThe[1] === 'mana value' ? 'mana_value' : (statOfThe[1] as 'power' | 'toughness');
    if (of && !of.plural) return { kind: 'stat', stat: s, of: of.ref };
  }
  // "its power", "~'s toughness", "that creature's power", "the sacrificed creature's power".
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
  const greatest = /^the greatest (power|toughness|mana value) among (.+)$/.exec(t);
  if (greatest) {
    const pf = parseFilter(greatest[2]!.replace(/ or an? /g, ' or '), b);
    if (!pf || !pf.plural) return null;
    return { kind: 'greatest', stat: greatest[1] === 'mana value' ? 'mana_value' : (greatest[1] as 'power' | 'toughness'), filter: pf.filter };
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
      return { ...expr, times: (expr.times ?? 1) * t, ...(expr.plus ? { plus: expr.plus * t } : {}) };
    }
    return v;
  };
  return effects.map((e) => {
    const out: EffectNode = { ...e };
    for (const [k, v] of Object.entries(e)) {
      if ((k === 'effects' || k === 'then' || k === 'else' || k === 'cant') && Array.isArray(v)) out[k] = bindX(v as EffectNode[], expr);
      // Eldritch Evolution: "a creature card with mana value X or less, where X is …"
      else if (k === 'filter' && (v as ObjectFilter | undefined)?.manaValue?.n === 'X') out[k] = { ...(v as ObjectFilter), manaValue: { ...(v as ObjectFilter).manaValue!, n: expr } };
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
      return { ...expr, times: (expr.times ?? 1) * v };
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
