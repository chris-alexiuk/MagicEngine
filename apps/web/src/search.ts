import type { Automation, CardDef, Color } from '@mtg/schema';
import { COLORS } from '@mtg/schema';

/**
 * A small subset of Scryfall's search syntax, run locally against the compiled DB.
 *
 *   bolt               name contains "bolt"
 *   t:elf              type line contains "elf"
 *   o:"draw a card"    oracle text contains the phrase
 *   c:ug  c=r  c<=ug   card colors (":" means "has all of these")
 *   id:ug              fits in a deck with this color identity (Commander)
 *   mv<=2              mana value comparison (also cmc)
 *   pow>=4  tou<3      power/toughness of the front face
 *   f:commander        legal (or restricted) in a format
 *   r:mythic           rarity
 *   kw:flying          has a keyword the engine recognises
 *   is:gc              on the Commander Game Changers list (also is:legendary)
 *   auto:manual        engine automation: full, partial or manual
 *   -t:land            prefix any term with "-" to negate it
 */

export type SortKey = 'name' | 'popularity' | 'mv';

export interface Term {
  neg: boolean;
  key: string | null;
  op: string;
  value: string;
}

export interface CompiledQuery {
  test: (card: CardDef) => boolean;
  errors: string[];
}

export const FILTER_HELP: [string, string][] = [
  ['t:elf', 'Type line contains'],
  ['o:"draw a card"', 'Rules text contains'],
  ['c:ug', 'Has all these colors'],
  ['id:ug', 'Fits this color identity'],
  ['mv<=2', 'Mana value'],
  ['pow>=4', 'Power (also tou)'],
  ['f:commander', 'Legal in format'],
  ['r:mythic', 'Rarity'],
  ['kw:flying', 'Has keyword'],
  ['is:gc', 'Game Changer (also is:legendary)'],
  ['auto:manual', 'Engine automation'],
  ['-t:land', 'Exclude matches'],
];

const TOKEN = /(-?)(?:([a-z]+)(:|<=|>=|!=|=|<|>))?(?:"([^"]*)"|(\S+))/gi;

export function parseQuery(input: string): Term[] {
  const terms: Term[] = [];
  for (const m of input.matchAll(TOKEN)) {
    const value = m[4] ?? m[5] ?? '';
    if (value === '' && !m[2]) continue;
    terms.push({ neg: m[1] === '-', key: m[2]?.toLowerCase() ?? null, op: m[3] ?? ':', value });
  }
  return terms;
}

const COLOR_WORDS: Record<string, Color> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

export function parseColors(value: string): Color[] | null {
  const v = value.toLowerCase();
  if (v === 'c' || v === 'colorless') return [];
  if (COLOR_WORDS[v]) return [COLOR_WORDS[v]];
  const letters = v.toUpperCase().split('');
  if (!letters.every((l) => (COLORS as readonly string[]).includes(l))) return null;
  return COLORS.filter((c) => letters.includes(c));
}

function compareSets(have: Color[], want: Color[], op: string, defaultOp: ':>=' | ':<='): boolean {
  const effective = op === ':' ? defaultOp.slice(1) : op;
  const hasAll = want.every((c) => have.includes(c));
  const within = have.every((c) => want.includes(c));
  switch (effective) {
    case '>=': return hasAll;
    case '<=': return within;
    case '=': return hasAll && within;
    case '!=': return !(hasAll && within);
    case '>': return hasAll && have.length > want.length;
    case '<': return within && have.length < want.length;
    default: return false;
  }
}

function compareNum(a: number, op: string, b: number): boolean {
  switch (op) {
    case ':':
    case '=': return a === b;
    case '!=': return a !== b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
    default: return false;
  }
}

const lower = (s: string) => s.toLowerCase();
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const cardColors = (card: CardDef) => COLORS.filter((c) => card.faces.some((f) => f.colors.includes(c)));
const AUTOMATION: Automation[] = ['full', 'partial', 'manual'];

function termPredicate(term: Term): ((card: CardDef) => boolean) | string {
  const v = lower(term.value);
  switch (term.key) {
    case null:
      return (c) => lower(c.name).includes(v);
    case 't':
    case 'type':
      return (c) => c.faces.some((f) => lower(f.typeLine).includes(v));
    case 'o':
    case 'oracle':
      return (c) => c.faces.some((f) => lower(f.oracle).includes(v));
    case 'c':
    case 'color': {
      const want = parseColors(term.value);
      if (!want) return `"${term.value}" isn't a color. Use letters like ug, or colorless.`;
      return (c) => compareSets(cardColors(c), want, term.op, ':>=');
    }
    case 'id':
    case 'ci':
    case 'identity': {
      const want = parseColors(term.value);
      if (!want) return `"${term.value}" isn't a color identity. Use letters like ug.`;
      return (c) => compareSets(c.colorIdentity, want, term.op, ':<=');
    }
    case 'mv':
    case 'cmc': {
      const n = Number(term.value);
      if (Number.isNaN(n)) return `Mana value needs a number, like mv<=3.`;
      return (c) => compareNum(c.cmc, term.op, n);
    }
    case 'pow':
    case 'power':
    case 'tou':
    case 'toughness': {
      const n = Number(term.value);
      if (Number.isNaN(n)) return `${term.key} needs a number, like ${term.key}>=3.`;
      const field = term.key.startsWith('p') ? 'power' : 'toughness';
      return (c) => {
        const raw = c.faces[0]?.[field];
        const x = raw === undefined ? NaN : Number(raw);
        return !Number.isNaN(x) && compareNum(x, term.op, n);
      };
    }
    case 'f':
    case 'format':
    case 'legal':
      return (c) => c.legal[v] === 'l' || c.legal[v] === 'r';
    case 'banned':
      return (c) => c.legal[v] === 'b';
    case 'r':
    case 'rarity':
      return (c) => c.rarity.startsWith(v);
    case 'kw':
    case 'keyword': {
      const id = slug(term.value);
      return (c) => c.faces.some((f) => f.keywords.some((k) => k.id === id));
    }
    case 'is':
      if (v === 'gc' || v === 'gamechanger') return (c) => c.gameChanger === true;
      if (v === 'legendary') return (c) => c.faces.some((f) => f.supertypes.includes('Legendary'));
      if (v === 'commander')
        return (c) => c.faces[0]?.supertypes.includes('Legendary') === true && c.faces[0].types.includes('Creature');
      return `Unknown is: value "${term.value}". Try is:gc, is:legendary or is:commander.`;
    case 'auto':
    case 'automation': {
      const level = AUTOMATION.find((a) => a.startsWith(v));
      if (!level) return `auto: takes full, partial or manual.`;
      return (c) => c.automation === level;
    }
    default:
      return `Unknown filter "${term.key}:". Open the search guide for the full list.`;
  }
}

export function compileQuery(input: string): CompiledQuery {
  const errors: string[] = [];
  const preds: ((c: CardDef) => boolean)[] = [];
  for (const term of parseQuery(input)) {
    const p = termPredicate(term);
    if (typeof p === 'string') {
      errors.push(p);
      continue;
    }
    preds.push(term.neg ? (c) => !p(c) : p);
  }
  return { test: (card) => preds.every((p) => p(card)), errors };
}

export function sortCards(cards: CardDef[], key: SortKey): CardDef[] {
  const out = [...cards];
  const byName = (a: CardDef, b: CardDef) => a.name.localeCompare(b.name);
  if (key === 'name') out.sort(byName);
  else if (key === 'mv') out.sort((a, b) => a.cmc - b.cmc || byName(a, b));
  else out.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || byName(a, b));
  return out;
}
