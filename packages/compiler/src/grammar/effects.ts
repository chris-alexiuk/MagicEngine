import type { EffectNode, FaceDef, Ref, RuleFlag } from '@mtg/schema';
import { attempt, type Binder } from './binder.js';
import { bindX, parseCount, parseForEach, scaleBy } from './amounts.js';
import { parseCombatRule } from './combat.js';
import { parseCopyExcept } from './copies.js';
import { parseCondition } from './conditions.js';
import { parseFilter, parseKeywordList, parseObjectRef, parsePlayerRef, parseRecipients } from './nouns.js';
import { addTokenText, parseTokenPhrase } from './tokens.js';
import { COLOR_WORDS, parseAmount, parsePT, subtypeOf, TYPE_NOUNS } from './words.js';

/**
 * Effect text → effect nodes, compositionally:
 *   text      = sentence ( ". " sentence )*
 *   sentence  = clause ( ", then " clause | " and " clause )*   — a later clause may reuse the subject
 *   clause    = [subject] verb arguments
 * Everything is all-or-nothing: if any part doesn't parse, the whole text is rejected.
 */

/** Splits on sentence ends. Quoted abilities aren't supported yet, so text with quotes is rejected. */
export function splitSentences(text: string): string[] | null {
  if (/["“”]/.test(text)) return null;
  const t = text.trim();
  if (!t.endsWith('.')) return null;
  return t
    .slice(0, -1)
    .split(/\.\s+/)
    .map((s) => s.trim());
}

export function parseEffectText(text: string, b: Binder): EffectNode[] | null {
  return attempt(b, (b) => {
    const sentences = splitSentences(text);
    if (!sentences) return null;
    const out: EffectNode[] = [];
    for (let i = 0; i < sentences.length; i++) {
      let s = sentences[i]!;
      // "…, reveal it, and put it into your hand. Then shuffle your library." (CR 702.29e wording).
      if (/^Search /.test(s) && /^Then shuffle(?: your library)?$/.test(sentences[i + 1] ?? '')) {
        s = `${s.replace(/, and put /, ', put ')}, then shuffle`;
        i++;
      }
      // CR 118.12: "You may pay {2}. If you do, …" — an optional cost paid on resolution.
      // Mana the engine can pay as a resolution-time cost (no {X}, snow or Phyrexian symbols), or energy (CR 107.14).
      const pay = /^You may pay ((?:\{(?:\d+|[WUBRGC]|[WUBRG2]\/[WUBRG])\})+|(?:\{E\})+)$/.exec(s);
      const then = sentences[i + 1] ? /^If you do, (.+)$/.exec(sentences[i + 1]!) : null;
      if (pay && then) {
        const inner = parseSentence(capitalise(then[1]!), b);
        if (!inner) return null;
        out.push({ type: 'may_pay', cost: pay[1]!, effects: inner });
        i++;
        continue;
      }
      // CR 118.12: "You may sacrifice a creature. If you do, …" — the first part is done only if possible.
      const mayDo = /^You may (.+)$/.exec(s);
      if (mayDo && then) {
        const first = parseSentence(capitalise(mayDo[1]!), b);
        const rest = first ? parseSentence(capitalise(then[1]!), b) : null;
        if (!first || !rest) return null;
        out.push({ type: 'may_do', effects: first, then: rest });
        i++;
        continue;
      }
      // Curses: "Create a Gold token. Each opponent attacking that player does the same." — each of
      // those players does it as if they were "you".
      const same = sentences[i + 1] ? /^Each opponent attacking (that player|enchanted player) does the same$/.exec(sentences[i + 1]!) : null;
      if (same) {
        const first = parseSentence(capitalise(s), b);
        const defender = first ? parsePlayerRef(same[1]!, b) : null;
        if (!first || !defender) return null;
        out.push(...first, { type: 'players_do', players: { ref: 'players', who: 'opponents', attacking: defender }, effects: structuredClone(first) });
        i++;
        continue;
      }
      // "That player may discard a card. If they do, they draw a card." — another player chooses.
      const theyMay = /^(.+?) may (.+)$/.exec(s);
      const theyDo = sentences[i + 1] ? /^If (?:they do|the player does|that player does|they don't|the player doesn't|that player doesn't), (.+)$/.exec(sentences[i + 1]!) : null;
      if (theyMay && theyDo && !/^You$/.test(theyMay[1]!)) {
        const who = singlePlayer(theyMay[1]!, b);
        const first = who ? attempt(b, (b) => parseClause(theyMay[2]!, b, who)) : null;
        const rest = first ? parseSentence(capitalise(theyDo[1]!), b) : null;
        if (!who || !first || !rest) return null;
        const declined = /n't, /.test(sentences[i + 1]!);
        out.push({ type: 'may_do', who, effects: first.effects, ...(declined ? { else: rest, then: [] } : { then: rest }) });
        i++;
        continue;
      }
      // "If [condition], [effect]." with an optional "Otherwise, [effect]." (CR 608.2c).
      const iff = /^If ([^,]+), (.+)$/.exec(s);
      const cond = iff && !/^If you do\b/.test(s) ? parseCondition(iff[1]!, b) : null;
      if (iff && cond) {
        const yes = parseSentence(capitalise(iff[2]!), b);
        if (!yes) return null;
        const node: EffectNode = { type: 'if', cond, effects: yes };
        const otherwise = sentences[i + 1] ? /^Otherwise, (.+)$/.exec(sentences[i + 1]!) : null;
        if (otherwise) {
          const no = parseSentence(capitalise(otherwise[1]!), b);
          if (!no) return null;
          node.else = no;
          i++;
        }
        out.push(node);
        continue;
      }
      // Impulse draw: "Exile the top card of your library. Until the end of your next turn, you may play that card."
      const top = /^[Ee]xile the top (card|(\w+) cards) of your library$/.exec(s);
      const next = sentences[i + 1] ?? '';
      const untilPlay = /^Until (end of turn|the end of your next turn|your next end step), you may (play|cast) (?:that card|those cards|them|it)$/.exec(next);
      const thisTurn = /^You may (play|cast) (?:that card|those cards|them|it) this turn$/.exec(next);
      if (top && (untilPlay || thisTurn)) {
        const amount = top[2] ? parseAmount(top[2]) : 1;
        if (typeof amount !== 'number') return null;
        const until = untilPlay && untilPlay[1] !== 'end of turn' ? 'next_turn' : 'eot';
        const mode = (untilPlay ? untilPlay[2] : thisTurn![1]) as 'play' | 'cast';
        out.push({ type: 'exile_top', amount, who: { ref: 'you' }, play: { mode, until } });
        i++;
        continue;
      }
      // "Create a 1/1 Eldrazi Scion creature token. It has "Sacrifice this token: Add {C}."" — the token's own text.
      const tokenHas = /^(?:It|They) (?:has|have) (.+)$/.exec(s);
      const made = out[out.length - 1];
      if (tokenHas && made?.type === 'create_token' && made.token) {
        const face = addTokenText(made.token as FaceDef, tokenHas[1]!, b);
        if (!face) return null;
        made.token = face;
        continue;
      }
      // CR 603.7: a delayed trigger — "Sacrifice it at the beginning of the next end step."
      const delayed =
        /^(.+) at the beginning of the next (end step|turn's upkeep)$/.exec(s) ?? /^At the beginning of the next (end step|turn's upkeep), (.+)$/.exec(s);
      if (delayed) {
        const [what, when] = delayed[0].startsWith('At ') ? [delayed[2]!, delayed[1]!] : [delayed[1]!, delayed[2]!];
        const inner = parseSentence(capitalise(what), b);
        if (!inner) return null;
        out.push({ type: 'delayed', step: when === 'end step' ? 'end' : 'upkeep', effects: inner });
        continue;
      }
      // CR 608.2c: later text can modify earlier text ("Destroy target creature. It can't be regenerated.").
      // CR 205.1b: "It's still a land." — the earlier "becomes a creature" keeps its other types.
      if (/^(?:It's|They're) still (?:a land|lands|an artifact|artifacts|an enchantment|a planeswalker)$/.test(s)) {
        const last = out[out.length - 1];
        if (!last || last.type !== 'modify' || !last.types) return null;
        last.retainTypes = true;
        continue;
      }
      if (/^(?:It|They) can't be regenerated$/.test(s)) {
        const last = out[out.length - 1];
        if (!last || last.type !== 'destroy') return null;
        last.noRegen = true;
        continue;
      }
      const effects = parseSentence(s, b);
      if (!effects) return null;
      out.push(...effects);
    }
    return out.length ? out : null;
  });
}

function capitalise(s: string): string {
  return s.replace(/^\w/, (c) => c.toUpperCase());
}

/** "draws cards equal to …" → "draws X cards" plus what X is (then bound with bindX). */
const EQUAL_TO: [RegExp, (m: RegExpExecArray) => [string, string]][] = [
  [/^(.*?\bdeals?) damage equal to (.+?) to (.+)$/i, (m) => [`${m[1]} X damage to ${m[3]}`, m[2]!]],
  [/^(.*?\b(?:gains?|loses?)) life equal to (.+)$/i, (m) => [`${m[1]} X life`, m[2]!]],
  [/^(.*?\b(?:draws?|mills?|discards?)) cards equal to (.+)$/i, (m) => [`${m[1]} X cards`, m[2]!]],
  [/^(.*?\bputs?) a number of (\S+) counters on (.+?) equal to (.+)$/i, (m) => [`${m[1]} X ${m[2]} counters on ${m[3]}`, m[4]!]],
  [/^(.*?\bscry) equal to (.+)$/i, (m) => [`${m[1]} X`, m[2]!]],
];

/** Numbers the game counts: "for each …", "equal to …" (CR 608.2h: counted as the effect happens). */
function parseCounted(s: string, b: Binder): EffectNode[] | null {
  const at = s.indexOf(' for each ');
  if (at > 0) {
    const tail = s.slice(at + ' for each '.length);
    // "gets +1/+1 for each creature you control until end of turn": the duration stays with the effect.
    const suffix = / until end of turn$/.exec(tail);
    const options: [string, string][] = [[tail, '']];
    if (suffix) options.unshift([tail.slice(0, suffix.index), suffix[0]]);
    for (const [what, rest] of options) {
      const r = attempt(b, (b) => {
        const expr = parseForEach(what, b);
        const inner = expr && parseSentence(s.slice(0, at) + rest, b);
        return inner && expr ? scaleBy(inner, expr) : null;
      });
      if (r) return r;
    }
  }
  // "you gain that much life", "put that many +1/+1 counters on it" — the trigger event's amount.
  if (b.eventAmount && /\bthat (?:much|many)\b/.test(s)) {
    const text = s.replace(/\bthat (?:much|many)\b/g, 'X');
    const r = attempt(b, (b) => {
      const inner = parseSentence(text, b);
      return inner ? bindX(inner, { kind: 'event' }) : null;
    });
    if (r) return r;
  }
  if (/ equal to /.test(s)) {
    for (const [re, rewrite] of EQUAL_TO) {
      const m = re.exec(s);
      if (!m) continue;
      const [text, what] = rewrite(m);
      const r = attempt(b, (b) => {
        const expr = parseCount(what, b);
        const inner = expr && parseSentence(text, b);
        return inner && expr ? bindX(inner, expr) : null;
      });
      if (r) return r;
    }
  }
  return null;
}

function parseSentence(s: string, b: Binder): EffectNode[] | null {
  // "…, where X is the number of creatures you control." (CR 107.3a: X defined by the text)
  const where = /^(.+), where X is (.+)$/.exec(s);
  if (where) {
    return attempt(b, (b) => {
      const expr = parseCount(where[2]!, b);
      const inner = expr && parseSentence(where[1]!, b);
      return inner && expr ? bindX(inner, expr) : null;
    });
  }
  // CR 118.12a / CR 119.4: "… unless that player pays 3 life" (or "{2} and 2 life").
  const unlessLife = /^(.+) unless (.+?) (?:pays|pay) (?:((?:\{(?:\d+|[WUBRGC])\})+) and )?(\d+) life$/.exec(s);
  if (unlessLife) {
    return attempt(b, (b) => {
      const inner = parseSentence(unlessLife[1]!, b);
      const payer = inner ? parsePlayerRef(unlessLife[2]!, b) : null;
      return inner && payer ? [{ type: 'unless_pays', payer, cost: unlessLife[3] ?? '', life: Number(unlessLife[4]), effects: inner }] : null;
    });
  }
  // "… unless that player discards a card" / "sacrifices a creature".
  const unlessDoes = /^(.+) unless (.+?) (discards|sacrifices) (.+)$/.exec(s);
  if (unlessDoes) {
    const r = attempt(b, (b) => {
      const inner = parseSentence(unlessDoes[1]!, b);
      const payer = inner ? parsePlayerRef(unlessDoes[2]!, b) : null;
      if (!inner || !payer) return null;
      const action = attempt(b, (b) => parseClause(`${unlessDoes[3]} ${unlessDoes[4]}`, b, payer));
      return action ? [{ type: 'unless_does', payer, action: action.effects, effects: inner }] : null;
    });
    if (r) return r;
  }
  // CR 118.12a: "[Do something] unless [a player] pays [cost]."
  const unless = /^(.+) unless (.+?) (?:pays|pay) ((?:\{(?:\d+|[WUBRGC]|[WUBRG2]\/[WUBRG])\})+)$/.exec(s);
  if (unless) {
    return attempt(b, (b) => {
      const inner = parseSentence(unless[1]!, b);
      const payer = inner ? parsePlayerRef(unless[2]!, b) : null;
      return inner && payer ? [{ type: 'unless_pays', payer, cost: unless[3]!, effects: inner }] : null;
    });
  }
  const may = /^[Yy]ou may (.+)$/.exec(s);
  if (may) {
    const inner = attempt(b, (b) => parseSentence(may[1]!, b));
    return inner ? [{ type: 'may', effects: inner }] : null;
  }
  // CR 114.1: "You get an emblem with "…"" (planeswalkers' ultimates).
  const emblem = /^[Yy]ou get an emblem with (.+)$/.exec(s);
  if (emblem) {
    const kws = parseKeywordList(emblem[1]!, b, true);
    if (!kws || kws.some((k) => k.id !== 'ability')) return null;
    return [{ type: 'emblem', abilities: kws.flatMap((k) => k.abilities ?? []), text: kws.map((k) => k.text).join('\n') }];
  }
  // "That player may draw a card", "its controller may create a token": another player chooses (CR 603.5).
  const theyMay = /^(.+?) may (.+)$/.exec(s);
  if (theyMay) {
    const r = attempt(b, (b) => {
      const who = singlePlayer(theyMay[1]!, b);
      const inner = who ? parseClause(theyMay[2]!, b, who) : null;
      return who && inner ? [{ type: 'may', who, effects: inner.effects }] : null;
    });
    if (r) return r;
  }
  const until = /^Until end of turn, (.+?) (gets?|gains?|has|have|can't|becomes?) (.+)$/.exec(s);
  if (until) return parseSentence(`${until[1]} ${until[2]} ${until[3]} until end of turn`, b);

  const whole = attempt(b, (b) => parseClause(s, b, null));
  if (whole) return whole.effects;
  const counted = parseCounted(s, b);
  if (counted) return counted;

  // Try each conjunction as the split point; a clause without a subject reuses the previous one's.
  const joints = [...s.matchAll(/, then | and then | and |, /g)];
  for (const j of joints) {
    const left = s.slice(0, j.index);
    const right = s.slice(j.index! + j[0].length);
    const r = attempt(b, (b) => {
      const l = parseClause(left, b, null);
      if (!l) return null;
      // "Target creature gets +3/+3 until end of turn and must be blocked this turn if able": the object goes on.
      const rest = parseSentenceWithSubject(right, b, l.subject) ?? (!l.subject && b.it ? attempt(b, (b) => parseClause(`it ${right}`, b, null))?.effects ?? null : null);
      return rest ? [...l.effects, ...rest] : null;
    });
    if (r) return r;
  }
  return null;
}

function parseSentenceWithSubject(s: string, b: Binder, subject: Ref | null): EffectNode[] | null {
  const whole = attempt(b, (b) => parseClause(s, b, subject));
  if (whole) return whole.effects;
  const joints = [...s.matchAll(/, then | and then | and |, /g)];
  for (const j of joints) {
    const r = attempt(b, (b) => {
      const l = parseClause(s.slice(0, j.index), b, subject);
      if (!l) return null;
      const rest = parseSentenceWithSubject(s.slice(j.index! + j[0].length), b, l.subject);
      return rest ? [...l.effects, ...rest] : null;
    });
    if (r) return r;
  }
  return null;
}

interface Clause {
  effects: EffectNode[];
  /** The player who performs the action, for a following subjectless clause. */
  subject: Ref | null;
}

/** Player verbs: lemma → handler. The subject is the player performing it ("you" when imperative). */
type VerbHandler = (args: string, who: Ref, b: Binder, imperative: boolean) => EffectNode[] | null;

const VERB_FORMS: Record<string, string> = {};
const VERBS: Record<string, VerbHandler> = {
  draw(args, who) {
    const m = /^(\S+) cards?$/.exec(args);
    const amount = m && parseAmount(m[1]!);
    return amount !== null && amount !== undefined ? [{ type: 'draw', amount, who }] : null;
  },
  gain(args, who, b, imperative) {
    // Layer 2 (CR 613.1b): "Gain control of target creature until end of turn."
    const control = /^control of (.+?)( until end of turn)?$/.exec(args);
    if (control) {
      if (!imperative) return null;
      const what = parseObjectRef(control[1]!, b);
      return what ? [{ type: 'gain_control', what: what.ref, ...(control[2] ? { until: 'eot' } : {}) }] : null;
    }
    const m = /^(\S+) life$/.exec(args);
    const amount = m && parseAmount(m[1]!);
    return amount !== null && amount !== undefined ? [{ type: 'gain_life', amount, who }] : null;
  },
  lose(args, who) {
    const m = /^(\S+) life$/.exec(args);
    const amount = m && parseAmount(m[1]!);
    return amount !== null && amount !== undefined ? [{ type: 'lose_life', amount, who }] : null;
  },
  discard(args, who) {
    // "discards their hand" (CR 701.9a: all the cards in it).
    if (/^(?:their|your|his or her) hand$/.test(args)) return [{ type: 'discard', all: true, amount: 0, who }];
    const m = /^(\S+) cards?$/.exec(args);
    const amount = m && parseAmount(m[1]!);
    return amount !== null && amount !== undefined ? [{ type: 'discard', amount, who }] : null;
  },
  mill(args, who) {
    const m = /^(\S+) cards?$/.exec(args);
    const amount = m && parseAmount(m[1]!);
    return amount !== null && amount !== undefined ? [{ type: 'mill', amount, who }] : null;
  },
  scry(args, who) {
    const amount = parseAmount(args);
    return amount !== null && who.ref === 'you' ? [{ type: 'scry', amount }] : null;
  },
  surveil(args, who) {
    const amount = parseAmount(args);
    return amount !== null && who.ref === 'you' ? [{ type: 'surveil', amount }] : null;
  },
  create(args, who, b) {
    // CR 707.2: "a token that's a copy of target creature you control, except it has haste".
    const copy = /^(a|an|one|two|three|four|five|X|that many) (tapped )?tokens? (?:that's a copy|that are copies) of (.+?)(?:,? except (.+))?$/.exec(args);
    if (copy) {
      const amount = parseAmount(copy[1] === 'an' ? 'a' : copy[1]!);
      if (amount === null || amount === undefined) return null;
      const of = parseObjectRef(copy[3]!, b);
      if (!of || of.plural) return null;
      const except = copy[4] ? parseCopyExcept(copy[4], b) : undefined;
      if (except === null) return null;
      const node: EffectNode = { type: 'create_token', amount, copyOf: of.ref, who };
      if (except) node.except = except;
      if (copy[2]) node.tapped = true;
      createdTokens(b);
      return [node];
    }
    const attached = /^(.+?) attached to (.+)$/.exec(args);
    const token = parseTokenPhrase(attached ? attached[1]! : args, b);
    if (!token) return null;
    const node: EffectNode = { type: 'create_token', amount: token.amount, token: token.face, who };
    if (token.tapped) node.tapped = true;
    createdTokens(b);
    if (attached) {
      const to = parseObjectRef(attached[2]!, b);
      if (!to || to.plural || !token.face.subtypes.includes('Aura')) return null;
      node.attachTo = to.ref;
    }
    return [node];
  },
  sacrifice(args, who, b) {
    // CR 701.21a. "Each opponent sacrifices a creature": each of those players chooses one.
    const choice = /^(a|an|one|two|three|four|five|\d+|another) (.+)$/.exec(args);
    if (choice) {
      const pf = parseFilter(choice[2]!, b);
      const amount = choice[1] === 'another' ? 1 : parseAmount(choice[1]!);
      // A numeral comes from a keyword definition ("sacrifices N permanents" with N = 1), so either number is fine.
      if (!pf || typeof amount !== 'number' || (pf.plural !== amount > 1 && !/^\d+$/.test(choice[1]!))) return null;
      if (choice[1] === 'another') pf.filter.other = true;
      return [{ type: 'sacrifice_choice', who, filter: pf.filter, amount }];
    }
    // Specific objects: "sacrifice ~", "sacrifice it".
    const what = parseObjectRef(args, b);
    if (!what || what.targeted || what.ref.ref === 'all' || who.ref !== 'you') return null;
    return [{ type: 'sacrifice', what: what.ref }];
  },
  put(args, who, b, imperative) {
    if (!imperative) return null;
    const counters = /^(\S+) (\S+) counters? on (.+)$/.exec(args);
    if (counters) {
      const amount = parseAmount(counters[1]!);
      const what = parseObjectRef(counters[3]!, b);
      if (amount === null || !what || !/^[+-]?\w+(?:\/[+-]\d+)?$/.test(counters[2]!)) return null;
      return [{ type: 'add_counters', what: what.ref, counter: counters[2]!.replace(/−/g, '-'), amount }];
    }
    const lib = /^(.+?) on (top|the bottom) of (?:its owner's|their owners'|your) library$/.exec(args);
    if (lib) {
      const what = parseObjectRef(lib[1]!, b);
      return what ? [{ type: 'move', what: what.ref, to: 'library', position: lib[2] === 'top' ? 'top' : 'bottom' }] : null;
    }
    return null;
  },
  destroy: objectVerb('destroy'),
  exile(args, who, b, imperative) {
    if (!imperative) return null;
    // CR 610.3: "exile target creature until ~ leaves the battlefield" (Banishing Light).
    const until = / until ~ leaves the battlefield$/.exec(args);
    const what = parseObjectRef(until ? args.slice(0, until.index) : args, b);
    if (!what) return null;
    return [{ type: 'move', what: what.ref, to: 'exile', ...(until ? { until: 'source_leaves' } : {}) }];
  },
  return(args, who, b, imperative) {
    if (!imperative) return null;
    const hand = /^(.+?) to (?:its owner's|their owners'|their owner's|your|its owners') hands?$/.exec(args);
    if (hand) {
      const what = parseObjectRef(hand[1]!, b);
      return what ? [{ type: 'move', what: what.ref, to: 'hand' }] : null;
    }
    const field = /^(.+?) to the battlefield( tapped)?( transformed)?( under (?:your|its owner's|their owners'|their owner's) control)?(?: with (a|an|one|two|three) (\S+) counters? on it)?$/.exec(args);
    if (field) {
      const what = parseObjectRef(field[1]!, b);
      if (!what) return null;
      const node: EffectNode = { type: 'move', what: what.ref, to: 'battlefield' };
      if (field[2]) node.tapped = true;
      // CR 712.14a
      if (field[3]) node.transformed = true;
      if (field[4] === ' under your control') node.under = 'you';
      // CR 122.6: "with a -1/-1 counter on it" — it enters with the counter.
      if (field[5]) node.counters = { [field[6]!.replace(/−/g, '-')]: parseAmount(field[5]!) };
      return [node];
    }
    return null;
  },
  tap: objectVerb('tap'),
  untap: objectVerb('untap'),
  counter: objectVerb('counter'),
  regenerate: objectVerb('regenerate'),
  search(args, who, b, imperative) {
    // CR 701.23: "Search your library for a basic land card, put it onto the battlefield tapped, then shuffle."
    if (!imperative) return null;
    const m =
      /^your library for (.+?), (?:reveal (?:it|them|those cards), )?put (?:it|them|that card|those cards) (into your hand|onto the battlefield( tapped)?|into your graveyard), then shuffle$/.exec(args) ??
      /^your library for (.+?), then shuffle and put (?:that card|it) (on top)$/.exec(args);
    if (!m) return null;
    const q = /^(?:(a|an|one)|up to (\w+)|(\w+)) (.+)$/.exec(m[1]!);
    if (!q) return null;
    const amount = q[1] ? 1 : parseAmount(q[2] ?? q[3]!);
    if (typeof amount !== 'number') return null;
    const pf = parseFilter(`${q[4]} in your library`, b);
    if (!pf || pf.plural !== amount > 1) return null;
    const to = m[2]!.startsWith('into your hand') ? 'hand' : m[2]!.startsWith('onto') ? 'battlefield' : m[2] === 'on top' ? 'library' : 'graveyard';
    const node: EffectNode = { type: 'search', filter: pf.filter, amount, to };
    if (q[2]) node.upTo = true;
    if (m[3]) node.tapped = true;
    return [node];
  },
  attach(args, who, b, imperative) {
    const m = /^(~|it) to (.+)$/.exec(args);
    if (!m || !imperative || (m[1] === 'it' && b.it?.ref !== 'self')) return null;
    const to = parseObjectRef(m[2]!, b);
    return to && !to.plural ? [{ type: 'attach', what: { ref: 'self' }, to: to.ref }] : null;
  },
};

function objectVerb(type: string): VerbHandler {
  return (args, _who, b, imperative) => {
    if (!imperative) return null;
    const what = parseObjectRef(args, b);
    return what ? [{ type, what: what.ref }] : null;
  };
}

for (const lemma of Object.keys(VERBS)) {
  VERB_FORMS[lemma] = lemma;
  VERB_FORMS[lemma.endsWith('y') ? `${lemma.slice(0, -1)}ies` : `${lemma}s`] = lemma;
}
VERB_FORMS.scries = 'scry';

const VERB_ALT = Object.keys(VERB_FORMS)
  .sort((a, b) => b.length - a.length)
  .join('|');
const IMPERATIVE = new RegExp(`^(${VERB_ALT}) (.+)$`, 'i');
const WITH_SUBJECT = new RegExp(`^(.+?) (${VERB_ALT}) (.+)$`);

/** Replacement and prevention effects created by a resolving spell (CR 614, CR 615). */
function parseReplacement(c: string, b: Binder): EffectNode[] | null {
  // CR 614.1a: "If that creature would die this turn, exile it instead."
  const dies = /^If (.+?) would die this turn, exile it instead$/.exec(c);
  if (dies) {
    const what = parseObjectRef(dies[1]!, b);
    return what ? [{ type: 'exile_if_dies', what: what.ref }] : null;
  }
  // CR 702.84a (unearth): "If it would leave the battlefield, exile it instead of putting it anywhere else."
  const leave = /^If (.+?) would leave the battlefield, exile (?:it|them) instead of putting (?:it|them) anywhere else$/.exec(c);
  if (leave) {
    const what = parseObjectRef(leave[1]!, b);
    return what ? [{ type: 'exile_on_leave', what: what.ref }] : null;
  }
  // CR 615.1a: prevention. "Prevent all combat damage that would be dealt this turn."
  if (/^Prevent all combat damage that would be dealt this turn$/.test(c)) return [{ type: 'prevent', amount: 'all', combat: true }];
  const next = /^Prevent the next (\S+) damage that would be dealt to (.+?) this turn$/.exec(c);
  if (next) {
    const amount = parseAmount(next[1]!);
    const to = parseRecipients(next[2]!, b);
    return amount !== null && to?.length === 1 ? [{ type: 'prevent', amount, to: to[0] }] : null;
  }
  const all = /^Prevent all (combat )?damage that would be dealt (?:to|by) (.+?) this turn$/.exec(c);
  if (all) {
    const to = parseRecipients(all[2]!, b);
    const by = /dealt by/.test(c);
    return to?.length === 1 ? [{ type: 'prevent', amount: 'all', ...(all[1] ? { combat: true } : {}), [by ? 'by' : 'to']: to[0] }] : null;
  }
  return null;
}

/** Keyword actions that are a whole clause on their own. */
function parseKeywordAction(c: string, b: Binder): EffectNode[] | null {
  // CR 701.16a: "Investigate" means "Create a Clue token."
  if (/^investigate$/i.test(c)) {
    const clue = parseTokenPhrase('a Clue token', b);
    return clue ? [{ type: 'create_token', amount: 1, token: clue.face, who: { ref: 'you' } }] : null;
  }
  // CR 701.37a: "Monstrosity N".
  const monstrosity = /^monstrosity (\S+)$/i.exec(c);
  if (monstrosity) {
    const amount = parseAmount(monstrosity[1]!);
    return amount !== null ? [{ type: 'monstrosity', amount }] : null;
  }
  // CR 701.46a: "Adapt N" means "If this permanent has no +1/+1 counters on it, put N +1/+1 counters on it."
  const adapt = /^adapt (\S+)$/i.exec(c);
  if (adapt) {
    const amount = parseAmount(adapt[1]!);
    if (amount === null || amount === undefined) return null;
    return [
      {
        type: 'if',
        cond: { type: 'counters', of: { ref: 'self' }, counter: '+1/+1', max: 0 },
        effects: [{ type: 'add_counters', what: { ref: 'self' }, counter: '+1/+1', amount }],
      },
    ];
  }
  // CR 701.44a: "~ explores", "target creature you control explores".
  const explore = /^(.+?) explores$/i.exec(c);
  if (explore) {
    const what = parseObjectRef(explore[1]!, b);
    return what && !what.plural ? [{ type: 'explore', what: what.ref }] : null;
  }
  // CR 107.14 / CR 122.1: "you get {E}{E}", "you get an experience counter" — counters on a player.
  const energy = /^(.+?) gets? ((?:\{E\})+)$/i.exec(c);
  const experience = /^(.+?) gets? (an?|one|two|three) (experience|rad) counters?$/i.exec(c);
  if (energy || experience) {
    const who = parsePlayerRef((energy ?? experience)![1]!, b);
    const amount = energy ? energy[2]!.length / 3 : parseAmount(experience![2]!);
    return who && typeof amount === 'number' ? [{ type: 'get_counters', who, counter: energy ? 'energy' : experience![3]!, amount }] : null;
  }
  // CR 701.34a
  if (/^proliferate$/i.test(c)) return [{ type: 'proliferate' }];
  // CR 701.50a: "~ connives", "target creature you control connives".
  const connive = /^(.+?) connives$/i.exec(c);
  if (connive) {
    const what = parseObjectRef(connive[1]!, b);
    return what && !what.plural ? [{ type: 'connive', what: what.ref }] : null;
  }
  // CR 701.47a: "Amass Orcs 2" (older cards: "Amass 2", Zombies).
  const amass = /^amass(?: (\w+))? (\S+)$/i.exec(c);
  if (amass) {
    const amount = parseAmount(amass[2]!);
    const subtype = amass[1] ? subtypeOf(amass[1]) : 'Zombie';
    return amount !== null && subtype ? [{ type: 'amass', subtype, amount }] : null;
  }
  // "It doesn't untap during its controller's next untap step." (CR 502.3)
  const stay = /^(.+?) (?:doesn't|don't) untap during (?:its controller's|their controllers'|their controller's|your) next untap step$/i.exec(c);
  if (stay) {
    const what = parseObjectRef(stay[1]!, b);
    return what ? [{ type: 'skip_untap', what: what.ref }] : null;
  }
  // CR 725.1: "you become the monarch", "target player becomes the monarch".
  const monarch = /^(.+?) becomes? the monarch$/i.exec(c);
  if (monarch) {
    const who = parsePlayerRef(monarch[1]!, b);
    return who ? [{ type: 'become_monarch', who }] : null;
  }
  // CR 701.27a: transforming turns a double-faced permanent over.
  const transform = /^transform (~|it)$/i.exec(c);
  if (transform && (transform[1] === '~' || b.it?.ref === 'self')) return [{ type: 'transform', what: { ref: 'self' } }];
  // CR 106.4: "Add {R}{R}{R}." as an instruction (rituals, triggered mana).
  const add = /^add ((?:\{[WUBRGC]\})+)$/i.exec(c);
  if (add) return [{ type: 'add_mana', options: [[...add[1]!.matchAll(/\{([WUBRGC])\}/g)].map((m) => m[1]!)] }];
  return null;
}

/**
 * "This land becomes a 3/3 green Elemental creature with trample until end of turn." Layers 4 (types),
 * 5 (colors), 6 (abilities) and 7b (P/T), CR 613.1d–f / 613.4b. Types replace the old ones unless
 * it's "still a land" or "in addition to its other types" (CR 205.1b).
 */
function parseBecomes(c: string, b: Binder): EffectNode[] | null {
  const m = /^(.+?) becomes? an? (?:(\d+|X)\/(\d+|X) )?(.+?)(?: with (.+?))?( that's still an? (?:land|planeswalker|artifact|enchantment))?( in addition to its other types)?( until end of turn)?$/.exec(c);
  if (!m) return null;
  // Without a P/T it keeps its own ("This Vehicle becomes an artifact creature", CR 702.122a).
  if (!m[2] && !/\bcreature$/.test(m[4]!)) return null;
  return attempt(b, (b) => {
    const what = parseObjectRef(m[1]!, b);
    if (!what) return null;
    const words = m[4]!.replace(/ and /g, ' ').split(' ');
    if (words[words.length - 1] !== 'creature') return null;
    const colors: string[] = [];
    const types: string[] = [];
    const subtypes: string[] = [];
    for (const w of words) {
      if (COLOR_WORDS[w]) colors.push(COLOR_WORDS[w]!);
      else if (TYPE_NOUNS[w] && TYPE_NOUNS[w]!.toLowerCase() === w) types.push(TYPE_NOUNS[w]!);
      else if (subtypeOf(w) === w) subtypes.push(w);
      else return null;
    }
    const pt = (v: string) => (v === 'X' ? 'X' : Number(v));
    const node: EffectNode = { type: 'modify', what: what.ref, types, subtypes, ...(m[2] ? { setPower: pt(m[2]), setToughness: pt(m[3]!) } : {}), until: m[8] ? 'eot' : 'game' };
    // An artifact that becomes an artifact creature is still what it was (CR 205.1b).
    if (!m[2] && types.includes('Artifact')) node.retainTypes = true;
    if (colors.length) node.colors = colors;
    if (m[6] || m[7]) node.retainTypes = true;
    if (m[5]) {
      const kws = parseKeywordList(m[5], b);
      if (!kws) return null;
      node.keywords = kws;
    }
    return [node];
  });
}

/** After "create …": "it", "the token", "those tokens" mean what was just created. */
function createdTokens(b: Binder): void {
  b.it = { ref: 'created' };
  for (const n of ['the token', 'that token', 'the tokens', 'those tokens', 'the copy', 'the token copy']) b.named[n] = { ref: 'created' };
}

/** One player other than "you" who makes a choice: "that player", "target opponent", "its controller". */
function singlePlayer(text: string, b: Binder): Ref | null {
  const who = parsePlayerRef(text, b);
  return who && who.ref !== 'you' && who.ref !== 'players' ? who : null;
}

function parseClause(c: string, b: Binder, inherited: Ref | null): Clause | null {
  // Object-subject clauses first: damage, pumps, restrictions.
  const special = parseDamage(c, b) ?? parsePump(c, b) ?? parseBecomes(c, b) ?? parseRestriction(c, b) ?? parseKeywordAction(c, b) ?? parseReplacement(c, b);
  if (special) return { effects: special, subject: null };

  const imp = IMPERATIVE.exec(c);
  if (imp) {
    const lemma = VERB_FORMS[imp[1]!.toLowerCase()]!;
    const who = inherited ?? { ref: 'you' };
    const imperative = who.ref === 'you';
    // A subjectless verb with a non-"you" subject must agree in form ("draws"), which is fine to skip checking.
    const effects = attempt(b, (b) => VERBS[lemma]!(imp[2]!, who, b, imperative));
    if (effects) return { effects, subject: who };
  }

  const sub = WITH_SUBJECT.exec(c);
  if (sub) {
    const r = attempt(b, (b) => {
      const who = parsePlayerRef(sub[1]!, b);
      if (!who) return null;
      const lemma = VERB_FORMS[sub[2]!.toLowerCase()]!;
      const effects = VERBS[lemma]!(sub[3]!, who, b, who.ref === 'you');
      return effects ? { effects, subject: who } : null;
    });
    if (r) return r;
  }
  return null;
}

/** "~ deals 3 damage to any target", "… to target creature and 2 damage to its controller". */
function parseDamage(c: string, b: Binder): EffectNode[] | null {
  const m = /^(~|[Ii]t) deals (\S+) damage to (.+)$/.exec(c);
  if (!m) return null;
  return attempt(b, (b) => {
    if (m[1] !== '~' && b.it?.ref !== 'self' && !(b.itIsSource && b.it?.ref === 'trigger_object')) return null;
    const amount = parseAmount(m[2]!);
    if (amount === null) return null;
    const out: EffectNode[] = [];
    const second = /^(.+?) and (\S+) damage to (.+)$/.exec(m[3]!);
    const first = parseRecipients(second ? second[1]! : m[3]!, b);
    if (!first) return null;
    for (const to of first) out.push({ type: 'deal_damage', amount, to });
    if (second) {
      const amount2 = parseAmount(second[2]!);
      const rest = amount2 !== null ? parseRecipients(second[3]!, b) : null;
      if (!rest || amount2 === null) return null;
      for (const to of rest) out.push({ type: 'deal_damage', amount: amount2, to });
    }
    return out;
  });
}

/** "Target creature gets +2/+2 and gains trample until end of turn." (CR 611.2a: lasts as stated.) */
function parsePump(c: string, b: Binder): EffectNode[] | null {
  // Without a duration it lasts indefinitely (CR 611.2a): "It gains haste." (unearth).
  const m = /^(.+?) (?:gets?|gains?|has|have) (.+) until end of turn$/.exec(c) ?? /^(.+?) (?:gains?) ((?!control\b).+)$/.exec(c);
  if (!m) return null;
  const until = / until end of turn$/.test(c) ? 'eot' : 'game';
  return attempt(b, (b) => {
    const what = parseObjectRef(m[1]!, b);
    if (!what) return null;
    const verb = /^(.+?) (gets?|gains?|has|have) /.exec(c)![2]!;
    const parts = `${verb} ${m[2]}`.split(/ and (?=gets? |gains? |has |have )/);
    const node: EffectNode = { type: 'modify', what: what.ref, until };
    for (const part of parts) {
      const pm = /^(gets?|gains?|has|have) (.+)$/.exec(part);
      if (!pm) return null;
      if (/^get/.test(pm[1]!)) {
        const pt = parsePT(pm[2]!);
        if (!pt || node.power !== undefined) return null;
        node.power = pt.power;
        node.toughness = pt.toughness;
      } else {
        const kws = parseKeywordList(pm[2]!, b);
        if (!kws || node.keywords) return null;
        node.keywords = kws;
      }
    }
    return [node];
  });
}

const RESTRICTIONS: Record<string, RuleFlag[]> = {
  "can't block": ['cant_block'],
  "can't attack": ['cant_attack'],
  "can't attack or block": ['cant_attack', 'cant_block'],
  "can't be blocked": ['cant_be_blocked'],
};

/** "Target creature can't block this turn." */
function parseRestriction(c: string, b: Binder): EffectNode[] | null {
  // "Target creature must be blocked this turn if able." / "~ can't be blocked by more than one creature this turn."
  const combat = /^(.+?) (must be blocked this turn if able|can't be blocked .+? this turn|can block only .+? this turn)$/.exec(c);
  if (combat) {
    const r = attempt(b, (b) => {
      const rule = parseCombatRule(combat[2]!.replace(' this turn', ''), b);
      const what = rule && parseObjectRef(combat[1]!, b);
      return what && rule ? [{ type: 'modify', what: what.ref, combat: rule, until: 'eot' }] : null;
    });
    if (r) return r;
  }
  const lure = /^All creatures able to block (.+?) this turn do so$/.exec(c);
  if (lure) {
    const what = parseObjectRef(lure[1]!, b);
    return what ? [{ type: 'modify', what: what.ref, combat: { mustBeBlocked: 'all' }, until: 'eot' }] : null;
  }
  const m = /^(.+?) (can't (?:attack or block|attack|block|be blocked)) this turn$/.exec(c);
  if (!m) return null;
  return attempt(b, (b) => {
    const what = parseObjectRef(m[1]!, b);
    return what ? [{ type: 'modify', what: what.ref, rules: RESTRICTIONS[m[2]!]!, until: 'eot' }] : null;
  });
}
