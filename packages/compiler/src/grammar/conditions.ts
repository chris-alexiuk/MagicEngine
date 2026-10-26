import type { ConditionNode } from '@mtg/schema';
import type { Binder } from './binder.js';
import { parseFilter } from './nouns.js';
import { parseAmount } from './words.js';

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

export function parseCondition(text: string, b: Binder): ConditionNode | null {
  const t = text.trim();
  // CR 702.33d: "if it was kicked" / "if this spell was kicked".
  if (/^(?:it|~) was kicked$/.test(t)) return { type: 'kicked' };
  const cast = /^you cast it( from your hand)?$/.exec(t);
  if (cast) return { type: 'cast_by_you', ...(cast[1] ? { fromHand: true } : {}) };
  const state = /^~ is (tapped|untapped)$/.exec(t);
  if (state) return { type: 'self_tapped', tapped: state[1] === 'tapped' };
  if (/^it's your turn$/.test(t)) return { type: 'your_turn', value: true };
  if (/^it's not your turn$|^it isn't your turn$/.test(t)) return { type: 'your_turn', value: false };

  // "you control a Forest", "you control three or more artifacts", "an opponent controls no creatures".
  const control = /^(you|an opponent|each opponent) controls? (a|an|another|no|at least \w+|\w+ or more|\w+ or fewer) (.+)$/.exec(t);
  if (control) {
    const c = count(control[2]!);
    const pf = parseFilter(control[3]!, b);
    if (!c || !pf) return null;
    if (control[2] === 'another') pf.filter.other = true;
    return { type: 'count', who: control[1] === 'you' ? 'you' : control[1] === 'an opponent' ? 'any_opponent' : 'each_opponent', filter: pf.filter, ...c };
  }

  const life = /^you have (\w+ or (?:more|less|fewer)) life$/.exec(t);
  if (life) {
    const c = compare(life[1]!);
    return c ? { type: 'life', ...c } : null;
  }
  if (/^you have no cards in hand$/.test(t)) return { type: 'hand', op: 'le', n: 0 };
  const hand = /^you have (\w+ or (?:more|fewer)) cards in hand$/.exec(t);
  if (hand) {
    const c = compare(hand[1]!);
    return c ? { type: 'hand', ...c } : null;
  }
  const gy = /^there are (\w+ or more) cards in your graveyard$/.exec(t);
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
  const has = /^~ has (?:a|an|one or more) (\S+) counters? on it$/.exec(t);
  if (has) return { type: 'counters', of: { ref: 'self' }, counter: has[1]!, min: 1 };
  return null;
}
