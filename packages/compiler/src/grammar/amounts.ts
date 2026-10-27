import type { Amount, AmountExpr, Color, EffectNode, ObjectFilter } from '@mtg/schema';
import type { Binder } from './binder.js';
import { parseFilter, parseObjectRef } from './nouns.js';
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
  "in your opponents' graveyards": { zone: 'graveyard', who: 'opponents' },
  "in each opponent's graveyard": { zone: 'graveyard', who: 'opponents' },
  "in an opponent's graveyard": { zone: 'graveyard', who: 'opponents' },
};

/** "creatures you control", "creature cards in your graveyard", "cards in your hand" (plural or not). */
function objects(text: string, b: Binder, plural: boolean): AmountExpr | null {
  const other = /^(?:other|another) (.+)$/.exec(text.trim());
  if (other) {
    const inner = objects(other[1]!, b, plural);
    return inner?.kind === 'count' ? { ...inner, filter: { ...inner.filter, other: true } } : null;
  }
  const t = text.trim();
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

/** What follows "for each": a singular noun phrase. */
export function parseForEach(text: string, b: Binder): AmountExpr | null {
  const t = text.trim();
  if (t === 'opponent' || t === 'opponent you have') return { kind: 'players', who: 'opponents' };
  if (t === 'player') return { kind: 'players', who: 'each' };
  // CR 903.8: "for each time you've cast your commander from the command zone this game"
  if (/^time you've cast your commander from the command zone this game$/.test(t)) return { kind: 'commander_casts' };
  // CR 700.8: "for each creature in your party"
  if (t === 'creature in your party') return { kind: 'party' };
  // "for each instant and sorcery card in your graveyard": a card of either type.
  const both = /^(\w+) and (\w+) card (in .+)$/.exec(t);
  if (both) return objects(`${both[1]} or ${both[2]} card ${both[3]}`, b, false);
  // CR 702.33c (multikicker): "for each time it was kicked"
  if (/^time (?:~|it) was kicked$/.test(t)) return { kind: 'kicks' };
  // CR 702.40a: "for each other spell that was cast before it this turn"
  if (/^other spell that was cast before (?:it|~) this turn$/.test(t)) return { kind: 'cast_before', of: b.it ?? { ref: 'self' } };
  const counter = /^(\S+) counter on (.+)$/.exec(t);
  if (counter) {
    const of = parseObjectRef(counter[2]!, b.clone(), 'static');
    return of && !of.plural ? { kind: 'counters', of: of.ref, counter: counter[1]! } : null;
  }
  return objects(t, b, false);
}

/** A number phrase: "the number of creatures you control", "its power", "twice …", "2 plus …". */
export function parseCount(text: string, b: Binder): AmountExpr | null {
  const t = text.trim();
  const twice = /^twice (.+)$/.exec(t);
  if (twice) {
    const inner = parseCount(twice[1]!, b);
    return inner ? { ...inner, times: (inner.times ?? 1) * 2 } : null;
  }
  const plus = /^(\w+) plus (.+)$/.exec(t);
  if (plus) {
    const n = parseAmount(plus[1]!);
    const inner = typeof n === 'number' ? parseCount(plus[2]!, b) : null;
    return inner && typeof n === 'number' ? { ...inner, plus: (inner.plus ?? 0) + n } : null;
  }
  const number = /^the number of (.+)$/.exec(t);
  if (number) {
    const what = number[1]!;
    if (what === 'opponents you have') return { kind: 'players', who: 'opponents' };
    const counters = /^(\S+) counters on (.+)$/.exec(what);
    if (counters) {
      const of = parseObjectRef(counters[2]!, b.clone(), 'static');
      return of && !of.plural ? { kind: 'counters', of: of.ref, counter: counters[1]! } : null;
    }
    return objects(what, b, true);
  }
  // "its power", "~'s toughness", "that creature's power", "the sacrificed creature's power".
  const stat = /^(.+?)(?:'s?)? (power|toughness|mana value)$/.exec(t);
  if (stat) {
    const subject = stat[1] === 'its' ? 'it' : stat[1]!.replace(/'s?$/, '');
    const of = parseObjectRef(subject, b.clone(), 'static');
    const s = stat[2] === 'mana value' ? 'mana_value' : (stat[2] as 'power' | 'toughness');
    return of && !of.plural ? { kind: 'stat', stat: s, of: of.ref } : null;
  }
  if (t === 'your life total') return { kind: 'life', who: { ref: 'you' } };
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
      if (k === 'effects' || k === 'then' || k === 'else') out[k] = bindX(v as EffectNode[], expr);
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
