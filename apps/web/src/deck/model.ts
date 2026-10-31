import type { Automation, CardDef, Color } from '@mtg/schema';
import { COLORS } from '@mtg/schema';

/** A saved deck. Cards are referenced by their name in the card DB. */
export interface DeckCard {
  name: string;
  count: number;
}

export interface Deck {
  id: string;
  name: string;
  /** One commander, or two (partners, a Background, a Doctor's companion). */
  commanders: string[];
  /** The rest of the deck: 99 cards with one commander, 98 with two. */
  main: DeckCard[];
  /** Kept with the deck but not played (sideboard, maybeboard, companion). */
  sideboard: DeckCard[];
  updatedAt: string;
  /** Where it was imported from, if anywhere. */
  source?: string;
}

export const DECK_SIZE = 100;

export function newDeckId(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyDeck(name = 'New deck'): Deck {
  return { id: newDeckId(), name, commanders: [], main: [], sideboard: [], updatedAt: new Date().toISOString() };
}

export const deckCount = (d: Pick<Deck, 'commanders' | 'main'>) => d.commanders.length + d.main.reduce((n, c) => n + c.count, 0);

export function addCard(list: DeckCard[], name: string, n = 1): DeckCard[] {
  const i = list.findIndex((c) => c.name === name);
  if (i < 0) return n > 0 ? [...list, { name, count: n }] : list;
  const next = list[i]!.count + n;
  return next <= 0 ? list.filter((_, j) => j !== i) : list.map((c, j) => (j === i ? { ...c, count: next } : c));
}

// ---------------------------------------------------------------------------
// Commander rules (CR 903.3, 702.124 partner, 702.124k–m variants)
// ---------------------------------------------------------------------------

const oracleOf = (c: CardDef) => c.faces.map((f) => f.oracle).join('\n');
const front = (c: CardDef) => c.faces[0]!;

/** Why a card can't be a commander, or null if it can (a legendary creature, or "can be your commander"). */
export function commanderProblem(c: CardDef): string | null {
  const f = front(c);
  if (/can be your commander/i.test(oracleOf(c))) return null;
  if (f.supertypes.includes('Legendary') && f.types.includes('Creature')) return null;
  if (f.subtypes.includes('Background') && f.supertypes.includes('Legendary')) return 'A Background can only be a second commander, next to one with “Choose a Background”.';
  return 'Only a legendary creature (or a card that says it can be your commander) can be your commander.';
}

type PairKind = { kind: 'partner' } | { kind: 'partner_with'; other: string } | { kind: 'partner_kind'; what: string } | { kind: 'friends_forever' } | { kind: 'choose_background' } | { kind: 'background' } | { kind: 'doctors_companion' } | { kind: 'doctor' };

function pairKinds(c: CardDef): PairKind[] {
  const text = oracleOf(c);
  const f = front(c);
  const out: PairKind[] = [];
  for (const line of text.split('\n')) {
    const l = line.replace(/\s*\([^)]*\)/g, '').trim();
    let m: RegExpExecArray | null;
    if ((m = /^Partner with (.+)$/i.exec(l))) out.push({ kind: 'partner_with', other: m[1]!.trim() });
    else if ((m = /^Partner\s*[—-]\s*(.+)$/i.exec(l))) out.push({ kind: 'partner_kind', what: m[1]!.trim().toLowerCase() });
    else if (/^Partner$/i.test(l)) out.push({ kind: 'partner' });
    else if (/^Friends forever$/i.test(l)) out.push({ kind: 'friends_forever' });
    else if (/^Choose a Background$/i.test(l)) out.push({ kind: 'choose_background' });
    else if (/^Doctor['’]s companion$/i.test(l)) out.push({ kind: 'doctors_companion' });
  }
  if (f.subtypes.includes('Background') && f.supertypes.includes('Legendary')) out.push({ kind: 'background' });
  if (/Time Lord Doctor/.test(f.typeLine) && f.supertypes.includes('Legendary')) out.push({ kind: 'doctor' });
  return out;
}

/** Why these two can't be commanders together, or null if they can. */
export function pairProblem(a: CardDef, b: CardDef): string | null {
  const ka = pairKinds(a);
  const kb = pairKinds(b);
  const has = (ks: PairKind[], k: PairKind['kind']) => ks.some((x) => x.kind === k);
  if (has(ka, 'partner') && has(kb, 'partner')) return null;
  if (has(ka, 'friends_forever') && has(kb, 'friends_forever')) return null;
  const withA = ka.find((x): x is Extract<PairKind, { kind: 'partner_with' }> => x.kind === 'partner_with');
  const withB = kb.find((x): x is Extract<PairKind, { kind: 'partner_with' }> => x.kind === 'partner_with');
  if (withA && withB && withA.other.toLowerCase() === b.name.toLowerCase() && withB.other.toLowerCase() === a.name.toLowerCase()) return null;
  const kindA = ka.find((x): x is Extract<PairKind, { kind: 'partner_kind' }> => x.kind === 'partner_kind');
  const kindB = kb.find((x): x is Extract<PairKind, { kind: 'partner_kind' }> => x.kind === 'partner_kind');
  if (kindA && kindB && kindA.what === kindB.what) return null;
  if ((has(ka, 'choose_background') && has(kb, 'background')) || (has(kb, 'choose_background') && has(ka, 'background'))) return null;
  if ((has(ka, 'doctors_companion') && has(kb, 'doctor')) || (has(kb, 'doctors_companion') && has(ka, 'doctor'))) return null;
  return `${a.name} and ${b.name} can’t be commanders together (they need partner, “Partner with” each other, friends forever, a Background, or a Doctor’s companion).`;
}

/** Whether `c` could be added as a second commander next to `first`. */
export const canPair = (first: CardDef, c: CardDef) => pairProblem(first, c) === null;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ProblemKind = 'size' | 'commander' | 'identity' | 'singleton' | 'banned' | 'not_legal' | 'unknown';

export interface DeckProblem {
  kind: ProblemKind;
  message: string;
  cards?: string[];
}

export interface DeckReport {
  total: number;
  identity: Color[];
  problems: DeckProblem[];
  /** Problems per card name, for marking rows. */
  byCard: Map<string, ProblemKind[]>;
  automation: Record<Automation, number>;
  gameChangers: string[];
}

/** CR 903.5b: basic lands are exempt from the singleton rule, as are cards that say "A deck can have any number of cards named …". */
export function copyLimit(c: CardDef): number {
  const f = front(c);
  if (f.supertypes.includes('Basic') && f.types.includes('Land')) return Infinity;
  const text = oracleOf(c);
  if (/A deck can have any number of cards named/i.test(text)) return Infinity;
  const m = /A deck can have up to (\w+) cards named/i.exec(text);
  if (m) {
    const words: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    return words[m[1]!.toLowerCase()] ?? (Number(m[1]) || 1);
  }
  return 1;
}

export function validateDeck(deck: Pick<Deck, 'commanders' | 'main'>, lookup: (name: string) => CardDef | undefined): DeckReport {
  const problems: DeckProblem[] = [];
  const byCard = new Map<string, ProblemKind[]>();
  const mark = (name: string, k: ProblemKind) => byCard.set(name, [...(byCard.get(name) ?? []), k]);
  const automation: Record<Automation, number> = { full: 0, partial: 0, manual: 0 };
  const gameChangers: string[] = [];
  const total = deckCount(deck);

  // Commanders.
  const commanders = deck.commanders.map((n) => ({ n, c: lookup(n) }));
  if (commanders.length === 0) problems.push({ kind: 'commander', message: 'Choose a commander.' });
  if (commanders.length > 2) problems.push({ kind: 'commander', message: 'A deck has at most two commanders.' });
  for (const { n, c } of commanders) {
    if (!c) continue;
    const why = commanderProblem(c);
    if (why && !(commanders.length === 2 && pairKinds(c).some((k) => k.kind === 'background'))) {
      problems.push({ kind: 'commander', message: `${n}: ${why}`, cards: [n] });
      mark(n, 'commander');
    }
  }
  if (commanders.length === 2 && commanders[0]!.c && commanders[1]!.c) {
    const why = pairProblem(commanders[0]!.c, commanders[1]!.c);
    if (why) {
      problems.push({ kind: 'commander', message: why, cards: deck.commanders });
      for (const n of deck.commanders) mark(n, 'commander');
    }
  }
  // CR 903.4: the commanders' combined color identity.
  const identity = COLORS.filter((x) => commanders.some(({ c }) => c?.colorIdentity.includes(x)));

  if (total !== 100) problems.push({ kind: 'size', message: `A Commander deck has exactly 100 cards, commanders included (this one has ${total}).` });

  const unknown: string[] = [];
  const offColor: string[] = [];
  const extra: string[] = [];
  const banned: string[] = [];
  const notLegal: string[] = [];
  const counts = new Map<string, number>();
  for (const n of deck.commanders) counts.set(n, (counts.get(n) ?? 0) + 1);
  for (const e of deck.main) counts.set(e.name, (counts.get(e.name) ?? 0) + e.count);

  for (const [name, count] of counts) {
    const c = lookup(name);
    if (!c) {
      unknown.push(name);
      mark(name, 'unknown');
      continue;
    }
    automation[c.automation] += count;
    if (c.gameChanger) gameChangers.push(name);
    // CR 903.5c: every card's color identity within the commanders'.
    if (commanders.length && !c.colorIdentity.every((x) => identity.includes(x))) {
      offColor.push(name);
      mark(name, 'identity');
    }
    if (count > copyLimit(c)) {
      extra.push(`${name} ×${count}`);
      mark(name, 'singleton');
    }
    const legal = c.legal.commander;
    if (legal === 'b') {
      banned.push(name);
      mark(name, 'banned');
    } else if (!legal) {
      notLegal.push(name);
      mark(name, 'not_legal');
    }
  }
  if (unknown.length) problems.push({ kind: 'unknown', message: `Not in the card DB: ${unknown.join(', ')}.`, cards: unknown });
  if (offColor.length) problems.push({ kind: 'identity', message: `Outside the commander’s color identity: ${offColor.join(', ')}.`, cards: offColor });
  if (extra.length) problems.push({ kind: 'singleton', message: `More copies than allowed (singleton; basic lands exempt): ${extra.join(', ')}.`, cards: extra.map((x) => x.replace(/ ×\d+$/, '')) });
  if (banned.length) problems.push({ kind: 'banned', message: `Banned in Commander: ${banned.join(', ')}.`, cards: banned });
  if (notLegal.length) problems.push({ kind: 'not_legal', message: `Not legal in Commander: ${notLegal.join(', ')}.`, cards: notLegal });
  return { total, identity, problems, byCard, automation, gameChangers };
}
