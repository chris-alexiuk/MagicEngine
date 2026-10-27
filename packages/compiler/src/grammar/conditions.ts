import type { ConditionNode, ObjectFilter, Ref } from '@mtg/schema';
import type { Binder } from './binder.js';
import { parseFilter, parseObjectRef, parsePlayerRef } from './nouns.js';
import { parseCount } from './amounts.js';
import { COLOR_WORDS, parseAmount } from './words.js';

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
  const t = text.trim();
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
  const parts = t.split(/ and (?=you |an opponent |~ |there |it's )/);
  if (parts.length > 1) {
    const all = parts.map((p) => parseOne(p, b));
    if (all.every(Boolean)) return { type: 'and', all: all as ConditionNode[] };
  }
  // "if a nonland permanent left the battlefield this turn or a spell was warped this turn"
  const either = t.split(/ or (?=a |an |you |there |it's )/);
  if (either.length > 1) {
    const any = either.map((p) => parseOne(p, b));
    if (any.every(Boolean)) return { type: 'or', any: any as ConditionNode[] };
  }
  return null;
}

function parseOne(t: string, b: Binder): ConditionNode | null {
  // Haliya: "if you've gained 3 or more life this turn"; Bloodchief Ascension: "if an opponent lost 2 or more life this
  // turn"; Spinerock Knoll: "if an opponent was dealt 7 or more damage this turn".
  const lifeN =
    /^(you|an opponent)(?:'ve| has| have)? (gained|lost) (\w+) or more life this turn$/.exec(t) ??
    /^(you|an opponent) (?:were|was) (dealt) (\w+) or more damage this turn$/.exec(t);
  if (lifeN) {
    const n = parseAmount(lifeN[3]!);
    const stat = lifeN[2] === 'dealt' ? 'damage' : lifeN[2] === 'lost' ? 'lost' : null;
    if (typeof n === 'number') return { type: 'amount', amount: { kind: 'life_this_turn', who: lifeN[1] === 'you' ? 'you' : 'an_opponent', ...(stat ? { stat } : {}) }, op: 'ge', n };
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
  // CR 702.194b: "if this spell was cast using teamwork"
  if (/^(?:~|this spell|it) was cast using teamwork$/.test(t)) return { type: 'paid', cost: 'teamwork' };
  // CR 702.174: "if the gift was promised", "if the gift wasn't promised"
  const promised = /^the gift (was|wasn't|was not) promised$/.exec(t);
  if (promised) return { type: 'paid', cost: 'gift', ...(promised[1] !== 'was' ? { not: true } : {}) };
  // CR 702.166b: "if this spell was bargained"
  if (/^(?:~|it) was bargained$/.test(t)) return { type: 'paid', cost: 'bargain' };
  // "if its evoke cost was paid", "if this spell's dash cost was paid", "if the buyback cost was paid" (CR 601.2f).
  const paid = /^(?:its|~'s|the) (\w+) cost was paid$/.exec(t) ?? /^an? (\w+) cost was paid for (?:it|~)$/.exec(t);
  if (paid) return { type: 'paid', cost: paid[1]!.toLowerCase() };
  // CR 702.33d: "if it was kicked" / "if this spell was kicked".
  if (/^(?:it|~) was kicked$/.test(t)) return { type: 'kicked' };
  const cast = /^you cast it( from your hand)?$/.exec(t);
  // "Whenever a creature you control enters, if you cast it, …": "it" is the entering creature.
  if (cast) return { type: 'cast_by_you', ...(cast[1] ? { fromHand: true } : {}), ...(b.it && b.it.ref !== 'self' ? { of: b.it } : {}) };
  const state = /^~ is (tapped|untapped)$/.exec(t);
  if (state) return { type: 'self_tapped', tapped: state[1] === 'tapped' };
  // "~ is equipped", "~ is enchanted" — something of that kind is attached to it.
  const attached = /^~ is (equipped|enchanted)$/.exec(t);
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
  // Tribute to the World Tree: "if its power is 3 or greater"; "if that creature's toughness is 2 or less"
  const statIs = /^(its|~'s|that creature's) (power|toughness|mana value) is (\w+) or (greater|more|less|fewer)$/.exec(t);
  if (statIs) {
    const of = statIs[1] === "~'s" ? ({ ref: 'self' } as Ref) : b.it;
    const n = parseAmount(statIs[3]!);
    if (of && typeof n === 'number') {
      const key = statIs[2] === 'mana value' ? 'manaValue' : (statIs[2] as 'power' | 'toughness');
      return { type: 'is', of, filter: { [key]: { op: /greater|more/.test(statIs[4]!) ? 'ge' : 'le', n } } };
    }
  }
  // Selvala: "if its power is greater than each other creature's power"
  if (t === "its power is greater than each other creature's power" && b.it) return { type: 'is', of: b.it, filter: { powerAboveOthers: true } };
  // Tezzeret: "If it's an artifact creature, put a +1/+1 counter on it." — what it is now (the sentence loop makes sure an
  // earlier effect didn't move it).
  const itsA = /^(?:it|that creature|that permanent)(?:'s| is) (an? .+)$/.exec(t);
  if (itsA && b.it && b.it.ref !== 'self') {
    const pf = parseFilter(itsA[1]!.replace(/^an? /, ''), b);
    if (pf && !pf.plural && !pf.filter.zone && !pf.filter.controller) return { type: 'is', of: b.it, filter: pf.filter };
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

  // Coven: "you control three or more creatures with different powers"
  const coven = /^you control (\w+ or more) creatures with different powers$/.exec(t);
  if (coven) {
    const c = compare(coven[1]!);
    return c ? { type: 'different_powers', ...c } : null;
  }
  // Formidable: "creatures you control have total power 8 or greater"
  const total = /^creatures you control have total power (\d+) or greater$/.exec(t);
  if (total) return { type: 'total_power', op: 'ge', n: Number(total[1]) };
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

  const life = /^(you|an opponent|a player) ha(?:ve|s) (\w+ or (?:more|less|fewer)) life$/.exec(t);
  if (life) {
    const c = compare(life[2]!);
    return c ? { type: 'life', ...c, ...(life[1] === 'you' ? {} : { who: life[1] === 'a player' ? 'any_player' : 'any_opponent' }) } : null;
  }
  if (/^you have no cards in hand$/.test(t)) return { type: 'hand', op: 'le', n: 0 };
  // "you have more cards in hand than each opponent"
  const moreHand = /^you have (more|fewer) cards in hand than (each|an) opponent$/.exec(t);
  if (moreHand) return { type: 'hand', than: moreHand[2] === 'each' ? 'each_opponent' : 'an_opponent', op: moreHand[1] === 'more' ? 'gt' : 'lt' };
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
  const freerun = /^a player was dealt combat damage this turn by a creature that, at the time it dealt that damage, was an? (\w+) creature or a commander under your control$/.exec(t);
  if (freerun) return { type: 'combat_damage_by', subtype: freerun[1]!, orCommander: true };
  // CR 702.156a (ravenous): "if X is 5 or more"
  const xIs = /^X is (\w+ or (?:more|greater|less|fewer))$/.exec(t);
  if (xIs) {
    const c = compare(xIs[1]!);
    return c ? { type: 'amount', amount: { kind: 'x' }, ...c } : null;
  }
  // Delirium: "there are four or more card types among cards in your graveyard"
  const cardTypes = /^there are (\w+ or more) card types among cards in your graveyard$/.exec(t);
  if (cardTypes) {
    const c = compare(cardTypes[1]!);
    return c ? { type: 'graveyard', ...c, cardTypes: true } : null;
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
  // Threshold and friends: "there are seven or more cards in your graveyard", "seven or more cards are in your graveyard".
  const gy = /^there are (\w+ or more) cards in your graveyard$/.exec(t) ?? /^(\w+ or more) cards are in your graveyard$/.exec(t);
  if (gy) {
    const c = compare(gy[1]!);
    return c ? { type: 'graveyard', ...c } : null;
  }

  // Starting Town: "it's your first, second, or third turn of the game"
  if (t === "it's your first, second, or third turn of the game") return { type: 'early_turn', max: 3 };
  // The Theros Gods: "your devotion to red is less than five", "your devotion to white and black is less than seven"
  const devotion = /^your devotion to (\w+)(?: and (\w+))? is less than (\w+)$/.exec(t);
  if (devotion) {
    const colors = [devotion[1], devotion[2]].filter(Boolean).map((c) => COLOR_WORDS[c!]);
    const n = parseAmount(devotion[3]!);
    if (colors.every(Boolean) && typeof n === 'number') return { type: 'amount', amount: { kind: 'devotion', colors: colors as never }, op: 'le', n: n - 1 };
  }
  // "if two or more creatures died this turn", "if three or more Zubera died this turn"
  const died = /^(\w+ or more) (.+?) died this turn$/.exec(t);
  if (died) {
    const c = compare(died[1]!);
    const amount = c ? parseCount(`the number of ${died[2]} that died this turn`, b) : null;
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
    'a nonland permanent left the battlefield this turn': 'nonland_left',
    'a spell was warped this turn': 'warped',
    // CR 700.13
    "you've committed a crime this turn": 'you_committed_crime',
    'you committed a crime this turn': 'you_committed_crime',
  };
  if (events[t]) return { type: 'this_turn', event: events[t] };
  if (t === 'an opponent gained life this turn') return { type: 'this_turn', event: 'opponent_gained_life' };
  // The Enduring cycle: "it was a creature" (a leaves-the-battlefield trigger looks back, CR 603.10a)
  const wasType = /^it was an? (creature|artifact|enchantment|land|planeswalker)$/.exec(t);
  if (wasType) return { type: 'was_type', cardType: wasType[1]!.replace(/^\w/, (c) => c.toUpperCase()) };
  // Minas Tirith: "you attacked with two or more creatures this turn"
  const attackedWith = /^you attacked with (\w+) or more creatures this turn$/.exec(t);
  if (attackedWith) {
    const n = parseAmount(attackedWith[1]!);
    return typeof n === 'number' ? { type: 'attacked_with', n } : null;
  }
  // Land Tax: "if an opponent controls more lands than you"
  // Archaeomancer's Map: "if that player controls more lands than you"
  const more = /^(an opponent|that player) controls more (.+?) than you(?: do)?$/.exec(t);
  if (more) {
    const pf = parseFilter(more[2]!, b);
    if (!pf || !pf.plural || pf.filter.zone || pf.filter.controller) return null;
    const player = more[1] === 'that player' ? parsePlayerRef('that player', b) : null;
    if (more[1] === 'that player' && !player) return null;
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
  const oppDrew = /^an opponent drew (\w+ or more) cards this turn$/.exec(t);
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
  // The Ozolith: "if it had counters on it" (as it last existed), "if ~ has counters on it".
  if (t === 'it had counters on it' && b.it) return { type: 'counters', of: b.it, min: 1 };
  if (t === '~ has counters on it') return { type: 'counters', of: { ref: 'self' }, min: 1 };
  // Depletion lands: "there are no depletion counters on ~", "~ has no time counters on it"
  const none = /^(?:there are no (\S+) counters on ~|~ has no (\S+) counters on it)$/.exec(t);
  if (none) return { type: 'counters', of: { ref: 'self' }, counter: none[1] ?? none[2]!, max: 0 };
  // "~ has a +1/+1 counter on it", "~ has three or more +1/+1 counters on it", "~ has a counter on it".
  const has =
    /^(?:~|it) has (a|an|one or more|\w+ or more) (?:(\S+) )?counters? on (?:it|him|her|them)$/.exec(t) ??
    /^there are (\w+ or more) (\S+) counters on ~$/.exec(t);
  if (has) {
    const n = /^(?:a|an|one or more)$/.test(has[1]!) ? 1 : parseAmount(has[1]!.replace(/ or more$/, ''));
    if (typeof n !== 'number') return null;
    const of: Ref = /^it /.test(t) ? (b.it ?? { ref: 'self' }) : { ref: 'self' };
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
