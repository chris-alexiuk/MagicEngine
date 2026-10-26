import type { ConditionNode, ObjectFilter, Ref } from '@mtg/schema';
import type { Binder } from './binder.js';
import { parseFilter, parseObjectRef } from './nouns.js';
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
  const single = parseOne(t, b);
  if (single) return single;
  // "you have 30 or more life and an opponent has 10 or less life"
  const parts = t.split(/ and (?=you |an opponent |~ |there |it's )/);
  if (parts.length > 1) {
    const all = parts.map((p) => parseOne(p, b));
    if (all.every(Boolean)) return { type: 'and', all: all as ConditionNode[] };
  }
  return null;
}

function parseOne(t: string, b: Binder): ConditionNode | null {
  // "if its evoke cost was paid", "if this spell's dash cost was paid", "if the buyback cost was paid" (CR 601.2f).
  const paid = /^(?:its|~'s|the) (\w+) cost was paid$/.exec(t);
  if (paid) return { type: 'paid', cost: paid[1]!.toLowerCase() };
  // CR 702.33d: "if it was kicked" / "if this spell was kicked".
  if (/^(?:it|~) was kicked$/.test(t)) return { type: 'kicked' };
  const cast = /^you cast it( from your hand)?$/.exec(t);
  if (cast) return { type: 'cast_by_you', ...(cast[1] ? { fromHand: true } : {}) };
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
  // CR 725: "you're the monarch"
  if (/^you're the monarch$|^you are the monarch$/.test(t)) return { type: 'monarch' };
  if (/^there is no monarch$/.test(t)) return { type: 'monarch', none: true };
  if (/^it's not your turn$|^it isn't your turn$/.test(t)) return { type: 'your_turn', value: false };

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
  // Threshold and friends: "there are seven or more cards in your graveyard", "seven or more cards are in your graveyard".
  const gy = /^there are (\w+ or more) cards in your graveyard$/.exec(t) ?? /^(\w+ or more) cards are in your graveyard$/.exec(t);
  if (gy) {
    const c = compare(gy[1]!);
    return c ? { type: 'graveyard', ...c } : null;
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
  };
  if (events[t]) return { type: 'this_turn', event: events[t] };
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
      return { ref: 'self' };
    case 'is':
    case 'counters':
      return c.of as Ref;
    default:
      return null;
  }
}
