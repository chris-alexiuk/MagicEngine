/**
 * Which cards a change to the code can affect — so that the card checks (scripts/sandbox.ts) play those again and
 * take the last run's word for the rest.
 *
 * The idea is the one behind test-impact tools: while a card is played, note which pieces of the code ran; a later
 * run plays the card again only if one of those pieces is no longer what it was (or the card's own definition isn't).
 * A piece that never ran for a card can change as it likes: the card's play goes the way it went, up to the point
 * where it would first enter that piece — and it never does.
 *
 * The pieces ("units") are the blocks of the code: a function's body, the body of an if, an else, a loop, a try, and
 * each clause of a switch on literal values. A unit is known by a hash of its own text — the tokens of the compiled
 * JavaScript, so that comments, layout and types don't count — with the units inside it left out, and the hash of the
 * unit it sits in mixed in. The code is run from a copy in which every unit starts by setting its own flag.
 *
 * What isn't inside any unit — the top level of a module: imports, tables, constants — runs before any card does, so
 * no flag can say which cards it matters to. It is compared statement by statement (see `decide`):
 *   - a declaration that changed touches the units that mention its name, and the cards that ran those;
 *   - a statement that does something as the module loads (`installPlugin(core)`), changed or new: every card;
 *   - a handler added to a plugin's table touches the cards that looked that name up and found nothing — the registry
 *     notes those misses while a card is played (src/registry.ts).
 * Anything this can't place for certain is taken to touch every card.
 *
 * No parser is among this repository's dependencies, and none is needed for this much: a tokenizer that knows
 * strings, templates and regular expressions, and what kind of brace each `{` is.
 */
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';

export const sha = (text: string, length = 12): string => createHash('sha1').update(text).digest('hex').slice(0, length);

/** Whether this Node can turn TypeScript into JavaScript by itself (22.13 and later): without that there is nothing to scan. */
export const canScan = typeof stripTypeScriptTypes === 'function';

/** Node's own TypeScript-to-JavaScript step: types and comments go, enums become plain objects. */
function withoutTypes(source: string): string {
  // (It says once per process that it is experimental; what it is used for here is checked against the real thing.)
  const emit = process.emitWarning;
  process.emitWarning = () => {};
  try {
    return (stripTypeScriptTypes as (code: string, options: { mode: 'strip' | 'transform' }) => string)(source, { mode: 'transform' });
  } finally {
    process.emitWarning = emit;
  }
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

type BraceKind = 'fn' | 'block' | 'switch' | 'class' | 'object' | 'template' | 'module';

export interface Tok {
  /** id: a name or keyword; p: punctuation; tpl: a piece of a template literal, up to and including a `${` or the closing backtick. */
  t: 'id' | 'num' | 'str' | 'tpl' | 're' | 'p';
  v: string;
  s: number;
  e: number;
  /** A bracket: the index of the token that closes or opens it. */
  match?: number;
  /** A brace: what it is the brace of. */
  kind?: BraceKind;
  /** A parenthesis: the index of the token before its "(". */
  head?: number;
  /** A ":" that ends the middle of a conditional expression. */
  tern?: true;
}

const PUNCT = [
  '>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>', '**',
];
const ID_START = /[\p{ID_Start}$_]/u;
const ID_PART = /[\p{ID_Continue}$‌‍]/u;
const NUMBER = /^(?:0[xX][\da-fA-F_]+n?|0[bB][01_]+n?|0[oO][0-7_]+n?|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?n?)/;
/** Keywords after which an expression starts (so a "/" there opens a regular expression). */
const BEFORE_EXPRESSION = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const CONTROL = new Set(['if', 'for', 'while', 'with', 'catch']);
const BLOCK_AFTER = new Set(['else', 'try', 'finally', 'do', 'catch']);

/**
 * The tokens of a JavaScript module, each bracket matched with its partner and each brace told apart: a function's
 * body, another block of statements, a switch, a class, or something that holds no statements (an object literal, a
 * destructuring pattern, the names of an import).
 */
export function tokenize(js: string): Tok[] {
  const toks: Tok[] = [];
  const stack: { tok: number; tern: number }[] = [];
  let baseTern = 0;
  let classAt = -1;
  let i = 0;
  const n = js.length;
  /** A name used as a keyword, not as a property (`x.default`). */
  const keyword = (k: number): boolean => toks[k]?.t === 'id' && toks[k - 1]?.v !== '.' && toks[k - 1]?.v !== '?.';
  const fail = (what: string): never => {
    throw new Error(`impact: ${what} at offset ${i}: ${JSON.stringify(js.slice(Math.max(0, i - 40), i + 40))}`);
  };

  const regexAllowed = (): boolean => {
    const k = toks.length - 1;
    const p = toks[k];
    if (!p) return true;
    if (p.t === 'num' || p.t === 'str' || p.t === 're') return false;
    if (p.t === 'tpl') return !p.v.endsWith('`');
    if (p.t === 'id') return keyword(k) && BEFORE_EXPRESSION.has(p.v);
    if (p.v === ')') return p.head !== undefined && keyword(p.head) && ['if', 'while', 'for', 'with'].includes(toks[p.head]!.v);
    if (p.v === ']') return false;
    if (p.v === '}') return p.kind !== 'object' && p.kind !== 'template' && p.kind !== 'module';
    if (p.v === '++' || p.v === '--') {
      const q = toks[k - 1];
      return !(q && (q.t === 'id' || q.t === 'num' || q.v === ')' || q.v === ']'));
    }
    return true;
  };

  /** What kind of brace the "{" about to be pushed is. */
  const braceKind = (): BraceKind => {
    const k = toks.length - 1;
    const p = toks[k];
    if (classAt === stack.length) {
      classAt = -1;
      return 'class';
    }
    if (!p) return 'block';
    const outer = stack.length ? toks[stack[stack.length - 1]!.tok]! : undefined;
    const inStatements = !outer || (outer.v === '{' && (outer.kind === 'fn' || outer.kind === 'block' || outer.kind === 'switch'));
    if (p.v === '=>') return 'fn';
    if (p.v === ')') {
      const h = p.head ?? -1;
      const head = toks[h];
      if (head && keyword(h)) {
        if (head.v === 'switch') return 'switch';
        if (CONTROL.has(head.v)) return 'block';
        if (head.v === 'await' && toks[h - 1]?.v === 'for') return 'block';
      }
      return 'fn';
    }
    if (p.t === 'id' && keyword(k) && BLOCK_AFTER.has(p.v)) return 'block';
    if (p.t === 'id' && p.v === 'static' && outer?.kind === 'class') return 'block';
    if (p.v === '{' || p.v === '}' || p.v === ';') return inStatements ? 'block' : 'object';
    if (p.v === ':') return !p.tern && inStatements ? 'block' : 'object';
    if (p.t === 'id' && keyword(k) && (p.v === 'import' || p.v === 'export')) return 'module';
    return 'object';
  };

  const open = (kind?: BraceKind): void => {
    const tok = toks.length - 1;
    if (kind) toks[tok]!.kind = kind;
    stack.push({ tok, tern: 0 });
  };
  const close = (ch: string): void => {
    const top = stack.pop();
    const o = top ? toks[top.tok]! : undefined;
    const want = ch === ')' ? '(' : ch === ']' ? '[' : '{';
    if (!o || (o.t === 'p' ? o.v !== want : want !== '{')) fail(`unbalanced "${ch}"`);
    const tok = toks.length - 1;
    toks[tok]!.match = top!.tok;
    o!.match = tok;
    if (o!.kind) toks[tok]!.kind = o!.kind;
    if (o!.head !== undefined) toks[tok]!.head = o!.head;
  };

  /** From a backtick or the "}" that ends a `${…}`: the template's text up to its end or its next `${`. */
  const template = (): void => {
    const s = i++;
    for (; i < n; i++) {
      const c = js[i];
      if (c === '\\') i++;
      else if (c === '`') {
        i++;
        toks.push({ t: 'tpl', v: js.slice(s, i), s, e: i });
        return;
      } else if (c === '$' && js[i + 1] === '{') {
        i += 2;
        toks.push({ t: 'tpl', v: js.slice(s, i), s, e: i });
        open('template');
        return;
      }
    }
    fail('unterminated template');
  };

  while (i < n) {
    const c = js[i]!;
    if (c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === ' ' || c === '﻿' || c === ' ' || c === ' ') {
      i++;
      continue;
    }
    if (c === '/' && js[i + 1] === '/') {
      while (i < n && js[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && js[i + 1] === '*') {
      const end = js.indexOf('*/', i + 2);
      if (end < 0) fail('unterminated comment');
      i = end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const s = i++;
      while (i < n && js[i] !== c) i += js[i] === '\\' ? 2 : 1;
      if (i >= n) fail('unterminated string');
      i++;
      toks.push({ t: 'str', v: js.slice(s, i), s, e: i });
      continue;
    }
    if (c === '`') {
      template();
      continue;
    }
    if (c === '}' && stack.length && toks[stack[stack.length - 1]!.tok]!.kind === 'template') {
      // The template's text goes on from here: the brace is the first character of its next piece.
      const top = stack.pop()!;
      const at = toks.length;
      template();
      toks[top.tok]!.match = at;
      toks[at]!.match = top.tok;
      continue;
    }
    if ((c >= '0' && c <= '9') || (c === '.' && js[i + 1]! >= '0' && js[i + 1]! <= '9')) {
      const m = NUMBER.exec(js.slice(i, i + 80));
      if (!m) fail('a number');
      toks.push({ t: 'num', v: m![0], s: i, e: i + m![0].length });
      i += m![0].length;
      continue;
    }
    if (c === '#' || ID_START.test(c) || c === '\\') {
      const s = i++;
      while (i < n && (ID_PART.test(js[i]!) || js[i] === '\\')) i++;
      toks.push({ t: 'id', v: js.slice(s, i), s, e: i });
      if (js.slice(s, i) === 'class' && keyword(toks.length - 1)) classAt = stack.length;
      continue;
    }
    if (c === '/' && regexAllowed()) {
      const s = i++;
      let inClass = false;
      for (; i < n; i++) {
        const d = js[i];
        if (d === '\\') i++;
        else if (d === '\n') fail('unterminated regular expression');
        else if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
      }
      i++;
      while (i < n && ID_PART.test(js[i]!)) i++;
      toks.push({ t: 're', v: js.slice(s, i), s, e: i });
      continue;
    }
    let p = PUNCT.find((x) => js.startsWith(x, i)) ?? c;
    // `a ?.5 : b` is a conditional, not optional chaining.
    if (p === '?.' && js[i + 2]! >= '0' && js[i + 2]! <= '9') p = '?';
    if (p === '{') {
      const kind = braceKind();
      toks.push({ t: 'p', v: p, s: i, e: i + 1 });
      open(kind);
    } else if (p === '(' || p === '[') {
      const head = toks.length - 1;
      toks.push({ t: 'p', v: p, s: i, e: i + 1, ...(p === '(' ? { head } : {}) });
      open();
    } else if (p === ')' || p === ']' || p === '}') {
      toks.push({ t: 'p', v: p, s: i, e: i + 1 });
      close(p);
    } else {
      const tok: Tok = { t: 'p', v: p, s: i, e: i + p.length };
      const level = stack[stack.length - 1];
      if (p === '?') level ? level.tern++ : baseTern++;
      else if (p === ':' && (level ? level.tern : baseTern) > 0) {
        level ? level.tern-- : baseTern--;
        tok.tern = true;
      }
      toks.push(tok);
    }
    i += p.length;
  }
  if (stack.length) fail(`${stack.length} bracket(s) never closed`);
  return toks;
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export interface Unit {
  kind: 'fn' | 'block' | 'case' | 'nomatch';
  /** Tokens [from, to] are the unit's (a switch clause: its `case`, label and statements); a `nomatch` has none. */
  from: number;
  to: number;
  /** Where in the JavaScript the unit's flag is set, and how. */
  at: number;
  mark: 'first' | 'default';
  children: Unit[];
  hash: string;
  /** A function's name, a clause's label: for a person reading a report. */
  name: string;
  /** The names its own text uses. */
  mentions: Set<string>;
  /** A switch clause: its label's text ('' for `default`); whether control can run on into the next clause. */
  label?: string;
  falls?: boolean;
  /** A clause, or a `nomatch`: the labels of its whole switch, sorted. */
  labels?: string;
}

const DECLARES = new Set(['const', 'let', 'var', 'class', 'function']);
const JUMPS = new Set(['break', 'return', 'throw', 'continue']);

interface Hole {
  from: number;
  to: number;
  text: string;
}

/** The tokens of [from, to], with each hole standing for whatever fills it; the names among them. */
function ownText(toks: Tok[], from: number, to: number, holes: Hole[]): { text: string; mentions: Set<string> } {
  const parts: string[] = [];
  const mentions = new Set<string>();
  let h = 0;
  for (let k = from; k <= to; k++) {
    while (h < holes.length && holes[h]!.to < k) h++;
    const hole = holes[h];
    if (hole && hole.from <= k) {
      parts.push(hole.text);
      k = hole.to;
      continue;
    }
    const t = toks[k]!;
    parts.push(t.v);
    if (t.t === 'id') mentions.add(t.v);
    // (A template's text can name things only inside its `${…}`, and those are tokens of their own.)
  }
  return { text: parts.join(' '), mentions };
}

/** The clauses of a switch whose brace opens at token `open`: null if it can't be taken apart clause by clause. */
function clausesOf(toks: Tok[], open: number): { kw: number; colon: number; end: number; label: string }[] | null {
  const close = toks[open]!.match!;
  const keywordAt = (k: number): boolean => toks[k]!.t === 'id' && (toks[k]!.v === 'case' || toks[k]!.v === 'default') && toks[k - 1]?.v !== '.' && toks[k - 1]?.v !== '?.';
  const out: { kw: number; colon: number; end: number; label: string }[] = [];
  let k = open + 1;
  while (k < close) {
    if (!keywordAt(k)) return null;
    const kw = k;
    let colon = kw + 1;
    while (colon < close && !(toks[colon]!.v === ':' && toks[colon]!.t === 'p' && !toks[colon]!.tern)) colon = (toks[colon]!.match !== undefined && toks[colon]!.match! > colon ? toks[colon]!.match! : colon) + 1;
    if (colon >= close) return null;
    const label = toks.slice(kw + 1, colon);
    const literal = label.length === 0 ? toks[kw]!.v === 'default' : (label.length === 1 && (label[0]!.t === 'str' || label[0]!.t === 'num' || (label[0]!.t === 'tpl' && label[0]!.v.endsWith('`')))) || (label.length === 2 && label[0]!.v === '-' && label[1]!.t === 'num');
    if (!literal) return null;
    k = colon + 1;
    while (k < close && !keywordAt(k)) {
      const t = toks[k]!;
      // A declaration made in one clause is in scope in the others: such a switch stays whole.
      if (t.t === 'id' && DECLARES.has(t.v) && toks[k - 1]?.v !== '.') return null;
      k = (t.match !== undefined && t.match > k ? t.match : k) + 1;
    }
    out.push({ kw, colon, end: k - 1, label: label.map((t) => t.v).join('') });
  }
  if (new Set(out.map((c) => c.label)).size !== out.length) return null;
  return out.length ? out : null;
}

/** Whether the statements in tokens [from, to] always end by leaving: the last one is a break, return, throw or continue. */
function leaves(toks: Tok[], from: number, to: number): boolean {
  if (from > to) return false;
  // One block and nothing else: what the block ends with.
  if (toks[from]!.v === '{' && toks[from]!.match === to) return leaves(toks, from + 1, to - 1);
  if (toks[to]!.v !== ';') return false;
  let start = from;
  for (let k = from; k < to; k++) {
    const t = toks[k]!;
    if (t.match !== undefined && t.match > k) {
      k = t.match;
      if (toks[k]!.v === '}' && toks[k]!.kind !== 'object' && toks[k]!.kind !== 'template') start = k + 1;
      continue;
    }
    if (t.v === ';' && t.t === 'p') start = k + 1;
  }
  const first = toks[start];
  return Boolean(first && first.t === 'id' && JUMPS.has(first.v));
}

const KEEP_WHOLE = new Set(['var']);

/** A person's name for the block that opens at token `open`. */
function nameOf(toks: Tok[], open: number, kind: Unit['kind']): string {
  const before = toks[open - 1];
  if (kind === 'fn') {
    // `name(args) {`, `function name(args) {`, `name = (args) => {`, `name: (args) => {`, `name = function (args) {`.
    let k = open - 1;
    if (before?.v === '=>') {
      k = open - 2;
      k = toks[k]?.v === ')' ? toks[k]!.match! - 1 : k - 1;
      if (toks[k]?.v === 'async') k--;
    } else if (before?.v === ')') k = before.match! - 1;
    for (let hops = 0; hops < 4 && k >= 0; hops++) {
      const t = toks[k]!;
      if (t.t === 'id' && !['function', 'async', 'get', 'set', 'static', 'return', 'export', 'default', 'new', 'await', 'yield'].includes(t.v)) return t.v;
      if (t.t === 'str') return t.v.slice(1, -1);
      if (!(t.t === 'id' || t.v === '=' || t.v === ':' || t.v === '*')) break;
      k--;
    }
    return 'λ';
  }
  if (before?.v === ')') return toks[before.head ?? -1]?.v ?? 'block';
  return before?.t === 'id' ? before.v : 'block';
}

export interface Scan {
  /** The compiled JavaScript, and the same with each unit setting its flag (`__u[slot]=1`). */
  js: string;
  instrumented: string;
  toks: Tok[];
  /** Every unit, parents before children. */
  units: Unit[];
  /** What is at the module's top level, statement by statement. */
  top: Statement[];
}

/**
 * Takes a module apart. `slotOf` gives each unit's flag its number (the same number for units with the same hash).
 * `rewrite`: an import specifier to another (the instrumented copy of a workspace package).
 */
export function scan(file: string, source: string, slotOf: (hash: string) => number, rewrite: (specifier: string) => string | undefined = () => undefined): Scan {
  const js = file.endsWith('.ts') ? withoutTypes(source) : source;
  const toks = tokenize(js);

  // 1. The tree of units, from the braces.
  interface Node extends Omit<Unit, 'children'> {
    children: Node[];
    parent?: Node;
    /** A switch taken apart: the brace's tokens, and its clauses (units) in order. */
    switchOf?: { open: number; close: number };
    dropped?: true;
  }
  const root: Node = { kind: 'fn', from: 0, to: toks.length - 1, at: 0, mark: 'first', children: [], hash: '', name: file, mentions: new Set() };
  const all: Node[] = [];
  const switches: { open: number; close: number; clauses: Node[]; parent: Node; nomatch?: Node }[] = [];
  const build = (parent: Node, from: number, to: number): void => {
    for (let k = from; k <= to; k++) {
      const t = toks[k]!;
      if (t.v !== '{' || t.t !== 'p' || t.match === undefined) continue;
      const close = t.match;
      if (t.kind === 'fn' || t.kind === 'block') {
        const u: Node = { kind: t.kind, from: k, to: close, at: t.e, mark: 'first', children: [], hash: '', name: nameOf(toks, k, t.kind), mentions: new Set(), parent };
        parent.children.push(u);
        all.push(u);
        build(u, k + 1, close - 1);
        k = close;
      } else if (t.kind === 'switch') {
        const clauses = clausesOf(toks, k);
        if (!clauses) continue;
        const labels = clauses
          .map((c) => c.label)
          .filter(Boolean)
          .sort()
          .join(',');
        const group = { open: k, close, clauses: [] as Node[], parent } as (typeof switches)[number];
        for (const c of clauses) {
          const u: Node = { kind: 'case', from: c.kw, to: c.end, at: toks[c.colon]!.e, mark: 'first', children: [], hash: '', name: c.label ? `case ${c.label}` : 'default', mentions: new Set(), parent, label: c.label, falls: !leaves(toks, c.colon + 1, c.end), labels, switchOf: { open: k, close } };
          parent.children.push(u);
          all.push(u);
          group.clauses.push(u);
          build(u, c.colon + 1, c.end);
        }
        if (!clauses.some((c) => !c.label)) {
          const u: Node = { kind: 'nomatch', from: close, to: close - 1, at: toks[close]!.s, mark: 'default', children: [], hash: '', name: 'no case', mentions: new Set(), parent, labels, switchOf: { open: k, close } };
          parent.children.push(u);
          all.push(u);
          group.nomatch = u;
        }
        switches.push(group);
        k = close;
      }
    }
  };
  build(root, 0, toks.length - 1);

  // 2. `var` reaches out of its block to the function around it: the blocks in between aren't units of their own.
  const drop = (u: Node): void => {
    if (u.dropped) return;
    u.dropped = true;
    if (u.switchOf) for (const g of switches) if (g.open === u.switchOf.open) for (const c of [...g.clauses, ...(g.nomatch ? [g.nomatch] : [])]) c.dropped = true;
  };
  const inner = (k: number): Node => {
    let at = root;
    for (;;) {
      const next = at.children.find((c) => c.kind !== 'nomatch' && c.from <= k && k <= c.to);
      if (!next) return at;
      at = next;
    }
  };
  toks.forEach((t, k) => {
    if (t.t !== 'id' || !KEEP_WHOLE.has(t.v) || toks[k - 1]?.v === '.') return;
    for (let u: Node | undefined = inner(k); u && u !== root && u.kind !== 'fn'; u = u.parent) drop(u);
  });
  const prune = (u: Node): void => {
    u.children = u.children.flatMap((c) => {
      prune(c);
      return c.dropped ? c.children.map((g) => Object.assign(g, { parent: u })) : [c];
    });
    u.children.sort((a, b) => a.from - b.from || a.to - b.to);
  };
  prune(root);
  const kept = all.filter((u) => !u.dropped);
  const liveSwitches = switches.filter((g) => !g.clauses[0]!.dropped);

  // 3. Each unit's own text and hash, outermost first; a switch's clauses last to first (one that runs on into the
  //    next is told by the next one's hash too).
  const holesOf = (u: Node): Hole[] => {
    const holes: Hole[] = [];
    const seen = new Set<number>();
    for (const c of u.children) {
      if (c.switchOf) {
        // The whole body of the switch is one hole in what is around it.
        if (!seen.has(c.switchOf.open)) holes.push({ from: c.switchOf.open, to: c.switchOf.close, text: '{§§}' });
        seen.add(c.switchOf.open);
      } else holes.push({ from: c.from, to: c.to, text: '{§}' });
    }
    return holes.sort((a, b) => a.from - b.from);
  };
  const hashed = new Set<Node>();
  const settle = (u: Node): void => {
    if (hashed.has(u)) return;
    hashed.add(u);
    const parent = u.parent && u.parent !== root ? u.parent.hash : '';
    if (u.kind === 'nomatch') {
      u.hash = sha(`${file}\n${parent}\nnomatch\n${u.labels}`);
      return;
    }
    const { text, mentions } = ownText(toks, u.from, u.to, holesOf(u));
    u.mentions = mentions;
    let extra = '';
    if (u.kind === 'case') {
      const group = liveSwitches.find((g) => g.open === u.switchOf!.open)!;
      const next = group.clauses[group.clauses.indexOf(u) + 1];
      if (u.falls && next) {
        settle(next);
        extra += `\nruns on into ${next.hash}`;
      }
      // What reaches `default` depends on which labels there are.
      if (!u.label) extra += `\nlabels ${u.labels}`;
    }
    u.hash = sha(`${file}\n${parent}\n${u.kind}\n${text}${extra}`);
  };
  const order: Node[] = [];
  const visit = (u: Node): void => {
    if (u !== root) {
      settle(u);
      order.push(u);
    }
    for (const c of u.children) visit(c);
  };
  visit(root);

  // 4. The copy that sets a flag on entering each unit.
  const edits: { at: number; text: string; cut?: number }[] = kept.map((u) => ({ at: u.at, text: u.mark === 'default' ? `default:__u[${slotOf(u.hash)}]=1;` : `__u[${slotOf(u.hash)}]=1;` }));
  toks.forEach((t, k) => {
    if (t.t !== 'str') return;
    const prev = toks[k - 1];
    const importing = prev?.t === 'id' && (prev.v === 'from' || prev.v === 'import') && toks[k - 2]?.v !== '.';
    const dynamic = prev?.v === '(' && toks[k - 2]?.v === 'import';
    const to = importing || dynamic ? rewrite(t.v.slice(1, -1)) : undefined;
    if (to !== undefined) edits.push({ at: t.s, cut: t.e - t.s, text: JSON.stringify(to) });
  });
  edits.sort((a, b) => b.at - a.at);
  let instrumented = js;
  for (const e of edits) instrumented = instrumented.slice(0, e.at) + e.text + instrumented.slice(e.at + (e.cut ?? 0));

  return { js, instrumented, toks, units: order, top: statements(file, toks, holesOf(root)) };
}

// ---------------------------------------------------------------------------
// The top level of a module
// ---------------------------------------------------------------------------

export interface Statement {
  /** import: names brought in; from: names passed on from another module; decl: a declaration; effect: anything else. */
  kind: 'import' | 'from' | 'decl' | 'effect';
  /** A declaration's names. */
  names: string[];
  hash: string;
  mentions: Set<string>;
  /** import: local name → "module#name there". */
  imports?: Record<string, string>;
  /** from: the name as passed on → "module#name there" (see TopLevel.from). */
  passes?: Record<string, string>;
  /** Pairs of names for one thing (`a as b`), from imports and exports. */
  aliases?: [string, string][];
  /** A declaration whose value takes no call to make (a table, a regular expression, a function): adding one changes nothing by itself. */
  pure?: boolean;
  /** `installPlugin(x)`: x. */
  installs?: string;
  /**
   * A declaration that is a table — an object literal, or a list of names: under '' its entries, name → a hash of what
   * stands there (of a function only the outline: its body is a unit); under 'key', the entries of a table that is
   * itself the value of `key`.
   */
  tables?: Record<string, Record<string, string>>;
  /** The table's properties that only name something else (`{ effects, triggers }`, `key: name`): key → name. */
  refs?: Record<string, string>;
  /** The declaration's hash without what its table holds. */
  shell?: string;
}

/** `new` of these, calls of these, and these methods of a value only build another value. */
const PURE_NEW = new Set(['Set', 'Map', 'WeakMap', 'WeakSet', 'RegExp', 'Date', 'Array']);
const PURE_CALLS = new Set(['String', 'Number', 'Boolean', 'BigInt', 'Symbol', 'Array', 'Object', 'RegExp', 'parseInt', 'parseFloat', 'isNaN', 'structuredClone']);
const PURE_OWNERS = new Set(['Object', 'Array', 'Math', 'JSON', 'String', 'Number']);
const PURE_METHODS = new Set(
  'map filter flatMap flat join split concat slice sort reverse reduce includes indexOf has get keys values entries toLowerCase toUpperCase trim replace replaceAll match test exec repeat padStart padEnd startsWith endsWith at find findIndex some every toString toFixed'.split(' '),
);
const NOT_CALLED = new Set(['function', 'async', 'if', 'for', 'while', 'switch', 'catch', 'typeof', 'return', 'void', 'delete', 'in', 'of', 'await', 'yield', 'case', 'else', 'do', 'throw', 'instanceof', 'new']);

/**
 * Whether working out the value in tokens [from, to] runs nothing but the building of that value: literals, tables,
 * `new Set([...])`, `xs.map(...)`, and functions that are only defined. A call of anything else — and a function
 * handed to a call, which may run it — makes the answer no.
 */
function onlyBuilds(toks: Tok[], from: number, to: number, holeAt: Map<number, Hole>): boolean {
  /** Past an arrow's expression body: to the "," or bracket that ends it, or the ":" of a conditional around it. */
  const pastArrowBody = (k: number): number => {
    let open = 0;
    for (; k <= to; k++) {
      const t = toks[k]!;
      if (t.t === 'p' && (t.v === ',' || t.v === ';' || t.v === ')' || t.v === ']' || t.v === '}')) return k;
      if (t.t === 'p' && t.v === '?') open++;
      if (t.t === 'p' && t.v === ':' && t.tern && open-- === 0) return k;
      if (t.match !== undefined && t.match > k) k = t.match;
    }
    return k;
  };
  /** The ends of the argument lists token k is inside. */
  const closers: number[] = [];
  for (let k = from; k <= to; k++) {
    const t = toks[k]!;
    while (closers.length && closers[closers.length - 1]! < k) closers.pop();
    const hole = holeAt.get(k);
    if (hole) {
      // A function with a body: defined here, and run by whatever it is handed to.
      if (closers.length) return false;
      k = hole.to;
      continue;
    }
    if (t.t === 'p' && t.v === '=>' && !holeAt.has(k + 1) && !closers.length) {
      k = pastArrowBody(k + 1) - 1;
      continue;
    }
    // A tagged template is a call.
    if (t.t === 'tpl' && t.v.startsWith('`') && k > from && (toks[k - 1]!.t === 'id' || toks[k - 1]!.v === ')' || toks[k - 1]!.v === ']')) return false;
    if (t.t === 'id' && t.v === 'new' && toks[k - 1]?.v !== '.' && !PURE_NEW.has(toks[k + 1]?.v ?? '')) return false;
    if (t.t !== 'p' || t.v !== '(' || k === from) continue;
    const callee = toks[k - 1]!;
    const called = callee.v === ')' || callee.v === ']' || callee.t === 'str' || (callee.t === 'tpl' && callee.v.endsWith('`')) || (callee.t === 'id' && !(NOT_CALLED.has(callee.v) && toks[k - 2]?.v !== '.'));
    // `name(args) {…}` in an object literal is a method's outline, not a call.
    if (!called || holeAt.has(t.match! + 1)) continue;
    const method = toks[k - 2]?.v === '.' || toks[k - 2]?.v === '?.';
    const builds = callee.t === 'id' && (method ? PURE_METHODS.has(callee.v) || PURE_OWNERS.has(toks[k - 3]?.v ?? '') : PURE_CALLS.has(callee.v) || (toks[k - 2]?.v === 'new' && PURE_NEW.has(callee.v)));
    if (!builds) return false;
    closers.push(t.match!);
  }
  return true;
}

/** Splits the tokens of a module that aren't inside a unit into statements, and says what each is. */
function statements(file: string, toks: Tok[], holes: Hole[]): Statement[] {
  const out: Statement[] = [];
  const holeAt = new Map(holes.map((h) => [h.from, h]));
  const n = toks.length;
  const BRACED = new Set(['function', 'class', 'if', 'for', 'while', 'try', 'switch', 'do']);
  let k = 0;
  while (k < n) {
    const from = k;
    // What the statement opens with, past `export`, `default` and `async`.
    let lead = k;
    while (toks[lead]?.t === 'id' && ['export', 'default', 'async'].includes(toks[lead]!.v)) lead++;
    const braced = toks[lead]?.t === 'id' && BRACED.has(toks[lead]!.v);
    let to = from;
    for (; to < n; to++) {
      const t = toks[to]!;
      if (t.match !== undefined && t.match > to) {
        to = t.match;
        // `function f() {…}` and `class A {…}` end at their brace; `try {…} catch {…}` goes on.
        const next = toks[to + 1];
        if (braced && toks[to]!.v === '}' && !(next?.t === 'id' && ['else', 'catch', 'finally', 'while'].includes(next.v))) break;
        continue;
      }
      if (t.v === ';' && t.t === 'p') break;
    }
    to = Math.min(to, n - 1);
    k = to + 1;
    if (to === from && toks[from]!.v === ';') continue;
    out.push(
      statement(
        file,
        toks,
        from,
        to,
        holes.filter((h) => h.from >= from && h.to <= to),
        holeAt,
      ),
    );
  }
  return out;
}

function statement(file: string, toks: Tok[], from: number, to: number, holes: Hole[], holeAt: Map<number, Hole>): Statement {
  const { text, mentions } = ownText(toks, from, to, holes);
  const hash = sha(`${file}\n${text}`);
  const v = (k: number): string | undefined => (k <= to ? toks[k]?.v : undefined);
  const isId = (k: number): boolean => k <= to && toks[k]?.t === 'id';
  /** The index after a bracketed group, a unit or a single token. */
  const skip = (k: number): number => (holeAt.has(k) ? holeAt.get(k)!.to : toks[k]?.match !== undefined && toks[k]!.match! > k ? toks[k]!.match! : k) + 1;

  if (v(from) === 'import' && v(from + 1) !== '(' && v(from + 1) !== '.') {
    const source = [...toks.slice(from, to + 1)].reverse().find((t) => t.t === 'str')?.v.slice(1, -1) ?? '';
    const imports: Record<string, string> = {};
    const aliases: [string, string][] = [];
    for (let k = from + 1; k <= to && v(k) !== 'from'; k++) {
      if (v(k) === '{') {
        for (let j = k + 1; j < toks[k]!.match!; j++) {
          if (!isId(j)) continue;
          const there = toks[j]!.v;
          const local = v(j + 1) === 'as' ? toks[j + 2]!.v : there;
          if (v(j + 1) === 'as') j += 2;
          imports[local] = `${source}#${there}`;
          if (local !== there) aliases.push([there, local]);
        }
        k = toks[k]!.match!;
      } else if (v(k) === '*' && v(k + 1) === 'as') {
        imports[toks[k + 2]!.v] = `${source}#*`;
        k += 2;
      } else if (isId(k)) imports[toks[k]!.v] = `${source}#default`;
    }
    return { kind: 'import', names: [], hash, mentions: new Set(), imports, aliases };
  }

  let k = from;
  const exported = v(k) === 'export';
  if (exported) k++;
  if (exported && (v(k) === '{' || v(k) === '*')) {
    // `export { a, b as c }` and `export … from '…'`: names for things declared elsewhere.
    const aliases: [string, string][] = [];
    const passes: Record<string, string> = {};
    const last = toks[to]!.v === ';' ? to - 1 : to;
    const source = toks[last]!.t === 'str' && v(last - 1) === 'from' ? toks[last]!.v.slice(1, -1) : '';
    if (v(k) === '{') {
      for (let j = k + 1; j < toks[k]!.match!; j++) {
        if (!isId(j)) continue;
        const there = toks[j]!.v;
        const as = v(j + 1) === 'as' ? toks[j + 2]!.v : there;
        if (as !== there) {
          aliases.push([there, as]);
          j += 2;
        }
        passes[as] = `${source}#${there}`;
      }
    } else if (v(k + 1) === 'as') passes[toks[k + 2]!.v] = `${source}#*`;
    else passes[`*${source}`] = '*';
    return { kind: 'from', names: [], hash, mentions: new Set(), aliases, passes };
  }
  if (v(k) === 'default') k++;
  if (v(k) === 'async' && v(k + 1) === 'function') k++;

  if (v(k) === 'function' || v(k) === 'class') {
    const at = v(k + 1) === '*' ? k + 2 : k + 1;
    const name = isId(at) ? toks[at]!.v : 'default';
    mentions.delete(name);
    // A class's fields and static blocks run as the module loads; a function declaration only when it is called.
    return { kind: 'decl', names: [name], hash, mentions, pure: v(k) === 'function' };
  }

  if (v(k) === 'const' || v(k) === 'let' || v(k) === 'var') {
    const names: string[] = [];
    let pure = true;
    let table: { tables: Record<string, Record<string, string>>; refs: Record<string, string>; from: number; to: number } | undefined;
    let j = k + 1;
    let declarators = 0;
    while (j <= to) {
      declarators++;
      // The name, or the names of a pattern.
      if (v(j) === '{' || v(j) === '[') {
        for (let m = j + 1; m < toks[j]!.match!; m++) if (isId(m)) names.push(toks[m]!.v);
        j = toks[j]!.match! + 1;
        pure = false;
      } else if (isId(j)) names.push(toks[j++]!.v);
      if (v(j) !== '=') {
        while (j <= to && v(j) !== ',') j = skip(j);
        j++;
        continue;
      }
      const start = ++j;
      while (j <= to && v(j) !== ',' && !(v(j) === ';' && toks[j]!.t === 'p')) j = skip(j);
      if (!onlyBuilds(toks, start, j - 1, holeAt)) pure = false;
      if (declarators === 1 && toks[start]!.match === j - 1) {
        const found = v(start) === '{' && toks[start]!.kind === 'object' ? tableOf(file, toks, start, holeAt) : v(start) === '[' ? listOf(toks, start) && { tables: { '': listOf(toks, start)! }, refs: {} } : null;
        if (found) table = { ...found, from: start, to: j - 1 };
      }
      j++;
    }
    for (const name of names) mentions.delete(name);
    if (declarators !== 1 || !table) return { kind: 'decl', names, hash, mentions, pure };
    const shell = sha(`${file}\n${ownText(toks, from, to, [...holes.filter((h) => h.to < table!.from || h.from > table!.to), { from: table.from, to: table.to, text: '{table}' }].sort((a, b) => a.from - b.from)).text}`);
    return { kind: 'decl', names, hash, mentions, pure, tables: table.tables, refs: table.refs, shell };
  }

  // `installPlugin(core);`
  if (isId(from) && v(from) === 'installPlugin' && v(from + 1) === '(' && isId(from + 2) && v(from + 3) === ')') return { kind: 'effect', names: [], hash, mentions, installs: toks[from + 2]!.v };
  return { kind: 'effect', names: [], hash, mentions };
}

const NESTED = sha('a table');

/**
 * An object literal as a table: each property's name with a hash of what stands under it (a function's body is a
 * unit, and leaves a hole here: only the function's outline counts). A property whose value is itself an object
 * literal or a list of names is a table under its key. Properties that are a bare name or `key: name` are noted as
 * references. Null if it has a spread or a computed key: then nobody can say what it holds.
 */
function tableOf(file: string, toks: Tok[], open: number, holeAt: Map<number, Hole>): { tables: Record<string, Record<string, string>>; refs: Record<string, string> } | null {
  const close = toks[open]!.match!;
  const tables: Record<string, Record<string, string>> = { '': {} };
  const refs: Record<string, string> = {};
  let k = open + 1;
  while (k < close) {
    let key = toks[k]!;
    // `async name() {…}`, `get name() {…}`, `*name() {…}`.
    while ((key.t === 'id' && ['async', 'get', 'set'].includes(key.v) && toks[k + 1]?.t !== 'p') || key.v === '*') key = toks[++k]!;
    if (!(key.t === 'id' || key.t === 'str' || key.t === 'num')) return null;
    const name = key.t === 'str' ? key.v.slice(1, -1) : key.v;
    let end = k + 1;
    while (end < close && toks[end]!.v !== ',') {
      const hole = holeAt.get(end);
      end = hole ? hole.to + 1 : (toks[end]!.match !== undefined && toks[end]!.match! > end ? toks[end]!.match! : end) + 1;
    }
    const value = toks[k + 1]?.v === ':' ? k + 2 : -1;
    const whole = value > 0 && toks[value]!.match === end - 1;
    const nested = whole && toks[value]!.v === '{' && toks[value]!.kind === 'object' ? tableOf(file, toks, value, holeAt)?.tables[''] : whole && toks[value]!.v === '[' ? listOf(toks, value) : undefined;
    if (nested) {
      tables[name] = nested;
      tables['']![name] = NESTED;
    } else {
      const holes = [...holeAt.values()].filter((h) => h.from > k && h.to < end).sort((a, b) => a.from - b.from);
      if (end === k + 1) refs[name] = name;
      else if (value > 0 && end === k + 3 && toks[value]!.t === 'id') refs[name] = toks[value]!.v;
      tables['']![name] = sha(`${file}\n${ownText(toks, k, end - 1, holes).text}`);
    }
    k = end + 1;
  }
  return { tables, refs };
}

/** A list of string literals as a table of names. */
function listOf(toks: Tok[], open: number): Record<string, string> | undefined {
  const close = toks[open]!.match!;
  const table: Record<string, string> = {};
  for (let k = open + 1; k < close; k++) {
    const t = toks[k]!;
    if (t.t === 'str') table[t.v.slice(1, -1)] = '';
    else if (t.v !== ',') return undefined;
  }
  return table;
}

// ---------------------------------------------------------------------------
// All the code a card's play runs through
// ---------------------------------------------------------------------------

/** The files under watch (from the repository's root), and where each one's copy goes. */
const WATCHED: { dir: string; only?: string[]; out: string }[] = [
  { dir: 'packages/engine/src', out: 'src' },
  { dir: 'packages/schema/src', out: 'schema' },
  { dir: 'packages/engine/scripts/lib', only: ['sandbox.ts', 'bot.ts'], out: 'scripts/lib' },
];
/** The tables a plugin hands to the registry, each looked up by name while a card is played (src/registry.ts). */
export const REGISTRY = ['effects', 'triggers', 'enterReplacements', 'statics'] as const;

/** What the top level of one file holds: enough to say, later, what about it changed. */
export interface TopLevel {
  /** Declared name → [hash, hash without its table's entries (or '')]. */
  decls: Record<string, [string, string]>;
  /** The statements that do something as the module loads, by hash. */
  effects: string[];
  /** Local name → "module#name there". */
  imports: Record<string, string>;
  /**
   * Names passed on (`export { a, b as c } from './x.js'`, `export { a }`): the name as passed on → "module#name there"
   * ("#name" for one of this module's own). `export * from './x.js'` is under "*./x.js".
   */
  from: Record<string, string>;
}

/** The code as one run saw it: kept with that run's results, to compare a later state of the code with. */
export interface Manifest {
  /** Flag number → the hash of the unit (or units alike) that sets it. */
  slots: string[];
  /** Hash → how many units have it, where more than one. */
  twins: Record<string, number>;
  files: Record<string, TopLevel>;
  /** The registry's tables: "effects:draw" → hash (and "plugin:core.id": what else a plugin object holds). */
  registry: Record<string, string>;
}

/** The code as it is now, with what `decide` needs that isn't kept. */
export interface Built extends Manifest {
  /** Flag number → a name for a person ("actions.ts castCost > if"). */
  names: string[];
  /** Flag number → the names the unit's own text uses. */
  mentions: Set<string>[];
  tops: Record<string, Statement[]>;
  /** Where the copy with flags was written, if it was. */
  dir?: string;
}

export interface Files {
  list(dir: string): string[];
  read(path: string): string;
  write?(path: string, text: string): void;
}

/**
 * Reads the code under watch into a manifest; with `outDir` (and `files.write`), also writes the copy in which every
 * unit sets its flag — plain JavaScript modules, laid out so that they import each other as the originals do.
 */
export function build(files: Files, outDir?: string): Built {
  const slotOf = new Map<string, number>();
  const built: Built = { slots: [], twins: {}, files: {}, registry: {}, names: [], mentions: [], tops: {} };
  const count = new Map<string, number>();
  for (const w of WATCHED) {
    for (const name of files.list(w.dir).sort()) {
      if (!name.endsWith('.ts') || name.endsWith('.d.ts') || (w.only && !w.only.includes(name))) continue;
      const file = `${w.dir}/${name}`;
      const depth = w.out.split('/').length;
      const result = scan(
        file,
        files.read(file),
        (hash) => {
          if (!slotOf.has(hash)) {
            slotOf.set(hash, built.slots.length);
            built.slots.push(hash);
          }
          return slotOf.get(hash)!;
        },
        (specifier) => (specifier === '@mtg/schema' ? `${'../'.repeat(depth)}schema/index.js` : undefined),
      );
      const short = name.replace(/\.ts$/, '');
      const path = new Map<Unit, string>();
      for (const u of result.units) {
        const slot = slotOf.get(u.hash)!;
        count.set(u.hash, (count.get(u.hash) ?? 0) + 1);
        const up = (u as Unit & { parent?: Unit }).parent;
        const label = `${up && path.has(up) ? `${path.get(up)} > ` : ''}${u.name}`;
        path.set(u, label);
        built.names[slot] ??= `${short}: ${label.length > 90 ? `…${label.slice(-88)}` : label}`;
        const mentions = (built.mentions[slot] ??= new Set());
        for (const m of u.mentions) mentions.add(m);
      }
      built.tops[file] = result.top;
      built.files[file] = topLevel(result.top);
      if (outDir && files.write) files.write(`${outDir}/${w.out}/${short}.js`, result.instrumented);
    }
  }
  for (const [hash, n] of count) if (n > 1) built.twins[hash] = n;
  built.registry = registryOf(built.tops);
  if (outDir) built.dir = outDir;
  return built;
}

function topLevel(top: Statement[]): TopLevel {
  const t: TopLevel = { decls: {}, effects: [], imports: {}, from: {} };
  for (const st of top) {
    if (st.kind === 'import') Object.assign(t.imports, st.imports);
    else if (st.kind === 'from') Object.assign(t.from, st.passes);
    else if (st.kind === 'effect') t.effects.push(st.hash);
    // (A name declared twice: both count.)
    else for (const name of st.names) t.decls[name] = t.decls[name] ? [sha(t.decls[name]![0] + st.hash), ''] : [st.hash, st.shell ?? ''];
  }
  t.effects.sort();
  return t;
}

/** The entries of the tables handed to `installPlugin`, and which declarations those tables are. */
function registryTables(tops: Record<string, Statement[]>): { entries: Record<string, string>; hosts: Set<string> } {
  const entries: Record<string, string> = {};
  const hosts = new Set<string>();
  for (const [file, top] of Object.entries(tops)) {
    const decl = (name: string) => top.find((s) => s.kind === 'decl' && s.names.length === 1 && s.names[0] === name && s.tables);
    for (const st of top) {
      const plugin = st.installs ? decl(st.installs) : undefined;
      if (!plugin) continue;
      hosts.add(`${file}#${st.installs}`);
      // What else the plugin object says (its id; which table stands under which name) is compared as it is.
      for (const [key, hash] of Object.entries(plugin.tables![''] ?? {})) entries[`plugin:${st.installs}.${key}`] = hash;
      for (const field of REGISTRY) {
        const named = plugin.refs?.[field];
        const table = plugin.tables![field] ?? (named ? decl(named)?.tables?.[''] : undefined);
        if (!table) continue;
        if (named && !plugin.tables![field]) hosts.add(`${file}#${named}`);
        for (const [key, hash] of Object.entries(table)) entries[`${field}:${key}`] = hash;
      }
    }
  }
  return { entries, hosts };
}

const registryOf = (tops: Record<string, Statement[]>): Record<string, string> => registryTables(tops).entries;

// ---------------------------------------------------------------------------
// What a change touches
// ---------------------------------------------------------------------------

export interface Decision {
  /** Every card has to be played again: why. */
  all?: string;
  /** The flags (by the earlier run's numbers) of units that aren't what they were, or that use something that isn't. */
  slots: Set<number>;
  /** Names newly in the registry's tables: a card that looked one up and missed has to be played again. */
  added: Set<string>;
  /** For a person: what changed, most telling first. */
  why: string[];
}

/**
 * Compares the code as an earlier run saw it (`base`, with the flags set before any card was played: `init`) with
 * the code as it is now.
 */
export function decide(base: Manifest, init: Iterable<number>, now: Built): Decision {
  const d: Decision = { slots: new Set(), added: new Set(), why: [] };
  const all = (why: string): Decision => ({ ...d, all: d.all ?? why, why: [why, ...d.why] });
  const nowCount = new Map<string, number>(now.slots.map((h) => [h, now.twins[h] ?? 1]));

  // 1. Units whose own text changed, or that are gone.
  base.slots.forEach((hash, slot) => {
    if ((base.twins[hash] ?? 1) !== (nowCount.get(hash) ?? 0)) d.slots.add(slot);
  });
  const gone = d.slots.size;

  // 2. The top level of each module.
  const changed = new Set<string>();
  const hosts = registryTables(now.tops).hosts;
  let whole: string | undefined;
  for (const file of new Set([...Object.keys(base.files), ...Object.keys(now.files)])) {
    const was = base.files[file] ?? { decls: {}, effects: [], imports: {}, from: {} };
    const is = now.files[file] ?? { decls: {}, effects: [], imports: {}, from: {} };
    const short = file.split('/').pop()!;
    if (was.effects.join() !== is.effects.join()) whole ??= `a statement that runs as ${short} loads is new or changed`;
    for (const [local, target] of Object.entries(was.imports)) if (is.imports[local] !== undefined && is.imports[local] !== target) whole ??= `${short} imports ${local} from somewhere else now`;
    // A name passed on that now stands for something else; `export *` from another set of modules (which name comes
    // from where can change). A name no longer passed on at all has no one left to use it: the copy wouldn't load.
    for (const [name, target] of Object.entries(was.from)) {
      if (is.from[name] === target) continue;
      if (name.startsWith('*')) whole ??= `${short} no longer passes on everything of ${name.slice(1)}`;
      else if (is.from[name] !== undefined || is.decls[name]) whole ??= `${short} passes on ${name} from somewhere else now`;
    }
    if (Object.keys(is.from).some((name) => name.startsWith('*') && was.from[name] === undefined)) whole ??= `${short} passes on everything of another module now`;
    for (const [name, [hash, shell]] of Object.entries(was.decls)) {
      const next = is.decls[name];
      if (next && next[0] === hash) continue;
      // A registry table with entries added or changed: the entries are compared one by one, below.
      if (next && shell && next[1] === shell && hosts.has(`${file}#${name}`)) continue;
      changed.add(name);
      d.why.push(`${short}: ${name} ${next ? 'changed' : 'is gone'}`);
    }
    const stmts = now.tops[file] ?? [];
    for (const name of Object.keys(is.decls)) {
      if (was.decls[name]) continue;
      const st = stmts.find((s) => s.kind === 'decl' && s.names.includes(name));
      if (!st?.pure) whole ??= `${short}: the new ${name} runs code as the module loads`;
    }
  }

  // 3. The registry's tables, entry by entry.
  for (const [key, hash] of Object.entries(now.registry)) {
    if (base.registry[key] === undefined) key.startsWith('plugin:') ? (whole ??= `a plugin has something new: ${key}`) : d.added.add(key);
    else if (base.registry[key] !== hash) whole ??= `the registry's ${key} isn't declared the way it was`;
  }
  for (const key of Object.keys(base.registry)) if (now.registry[key] === undefined) whole ??= `the registry no longer has ${key}`;
  if (d.added.size) d.why.push(`new in the registry: ${[...d.added].slice(0, 6).join(', ')}${d.added.size > 6 ? ', …' : ''}`);

  // 4. Whatever is declared in terms of something that changed has changed too; a statement that runs at load and
  //    uses one touches everything.
  const statementsNow = Object.values(now.tops).flat();
  const alias = statementsNow.flatMap((s) => s.aliases ?? []);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [a, b] of alias) {
      if (changed.has(a) && !changed.has(b)) grew = Boolean(changed.add(b));
      if (changed.has(b) && !changed.has(a)) grew = Boolean(changed.add(a));
    }
    for (const st of statementsNow) {
      if (![...st.mentions].some((m) => changed.has(m))) continue;
      if (st.kind === 'effect') whole ??= `a statement that runs as a module loads uses ${[...st.mentions].find((m) => changed.has(m))}, which changed`;
      for (const name of st.names) if (!changed.has(name)) grew = Boolean(changed.add(name));
    }
  }

  // 5. The units that use a changed name.
  if (changed.size) {
    const baseSlot = new Map(base.slots.map((h, i) => [h, i]));
    now.slots.forEach((hash, slot) => {
      const was = baseSlot.get(hash);
      if (was === undefined || d.slots.has(was)) return;
      for (const m of now.mentions[slot] ?? []) {
        if (!changed.has(m)) continue;
        d.slots.add(was);
        break;
      }
    });
  }
  if (gone) {
    // (A block that changed is, by its new hash, a block the earlier run never saw: its name says where.)
    const known = new Set(base.slots);
    const fresh = [...new Set(now.slots.flatMap((hash, slot) => (known.has(hash) ? [] : [now.names[slot]!])))];
    const where = fresh.length ? ` (${fresh.slice(0, 4).join('; ')}${fresh.length > 4 ? `; ${fresh.length - 4} more` : ''})` : '';
    d.why.unshift(`${gone} block(s) of code changed or went${where}${d.slots.size > gone ? `; ${d.slots.size - gone} more use a declaration that changed` : ''}`);
  }
  if (whole) return all(whole);

  // 6. Code that ran before any card was played: its result is in every card's play.
  for (const slot of init) if (d.slots.has(slot)) return all('code that runs before any card is played changed');
  return d;
}

// ---------------------------------------------------------------------------
// Which flags a card's play set
// ---------------------------------------------------------------------------

/** A set of flag numbers as text: the bits, less those of `core` (the flags most cards set), in base64. */
export function pack(set: Uint8Array, core?: Uint8Array): string {
  const bytes = Buffer.alloc(Math.ceil(set.length / 8));
  for (let i = 0; i < set.length; i++) if (Boolean(set[i]) !== Boolean(core?.[i])) bytes[i >> 3]! |= 1 << (i & 7);
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return bytes.subarray(0, end).toString('base64');
}

export function unpack(text: string, size: number, core?: Uint8Array): Uint8Array {
  const bytes = Buffer.from(text, 'base64');
  const set = new Uint8Array(size);
  for (let i = 0; i < size; i++) set[i] = (((bytes[i >> 3] ?? 0) >> (i & 7)) & 1) ^ (core?.[i] ? 1 : 0);
  return set;
}

// ---------------------------------------------------------------------------
// From one run to the next
// ---------------------------------------------------------------------------

/** Changes when what a run keeps changes shape or meaning: an earlier run's word is then not taken. */
export const FORMAT = 1;

/** What a run keeps beside its results, for the next one to go by. */
export interface Ground extends Manifest {
  format: number;
  /**
   * The flags set as the code loaded and learned the pool (packed as they are): what that leaves behind — tables, the
   * creature types — every play goes by, so a change there touches them all.
   */
  init: string;
  /** The registry names looked up and missed before any card was played. */
  initMiss: string[];
  /** The flags most plays set: each card's are kept as its difference from these. */
  core: string;
  /** The registry names some card looked up and missed; a card's `miss` are numbers into this list. */
  misses: string[];
  /**
   * A hash of where every play starts from: the boards as built (the sandbox's own cards as compiled, the pool's
   * dungeons, and all that the game played to set them up left behind) and the creature types the pool has. Code that
   * only ran to build the boards, changed, shows here or not at all.
   */
  boards: string;
  /** A hash of the code that keeps and reads all this: another reader doesn't take its word. */
  tool: string;
}

/** What a run keeps about one card's play. */
export interface Trail {
  /** A hash of the definition that was played. */
  def?: string;
  /** The flags its play set (`pack`ed against `Ground.core`). */
  u?: string;
  /** The registry names it looked up and missed (numbers into `Ground.misses`). */
  miss?: number[];
}

export interface Replay {
  /** Every card is played: why. */
  all?: string;
  /** The cards whose earlier result stands. */
  keep: Set<string>;
  /** How many cards are played again, by what for. */
  why: { code: number; registry: number; definition: number; unseen: number };
  decision?: Decision;
}

/**
 * Which cards an earlier run's results still stand for. `was`, `trails`: what that run kept. `cards`: the cards now,
 * each with the hash of its definition. `now`: the code as it is. `here`: where the plays start from now, and the
 * code doing this.
 */
export function replay(was: Ground | undefined, trails: Record<string, Trail | undefined>, cards: { id: string; def: string }[], now: Built, here: { boards: string; tool: string }): Replay {
  const everything = (all: string, decision?: Decision): Replay => ({ all, keep: new Set(), why: { code: 0, registry: 0, definition: 0, unseen: 0 }, ...(decision ? { decision } : {}) });
  if (!was || was.format !== FORMAT) return everything('the earlier run kept nothing to go by');
  if (was.tool !== here.tool) return everything('the checks themselves changed since the earlier run');
  const init: number[] = [];
  unpack(was.init, was.slots.length).forEach((bit, i) => bit && init.push(i));
  const decision = decide(was, init, now);
  if (decision.all) return everything(decision.all, decision);
  if (was.boards !== here.boards) return everything("the boards the cards are played on, or the pool's creature types, aren't what they were", decision);
  const hit = was.initMiss.find((key) => decision.added.has(key));
  if (hit) return everything(`the registry has ${hit} now, which was looked up before any card was played`, decision);

  const core = unpack(was.core, was.slots.length);
  const changed = [...decision.slots];
  const added = new Set(was.misses.flatMap((key, i) => (decision.added.has(key) ? [i] : [])));
  const out: Replay = { keep: new Set(), why: { code: 0, registry: 0, definition: 0, unseen: 0 }, decision };
  for (const card of cards) {
    const trail = trails[card.id];
    if (trail?.u === undefined) out.why.unseen++;
    else if (trail.def !== card.def) out.why.definition++;
    else if (has(trail.u, core, changed)) out.why.code++;
    else if (trail.miss?.some((i) => added.has(i))) out.why.registry++;
    else out.keep.add(card.id);
  }
  return out;
}

/** Whether a packed set of flags has any of `slots`. */
function has(packed: string, core: Uint8Array, slots: number[]): boolean {
  if (!slots.length) return false;
  const bytes = Buffer.from(packed, 'base64');
  return slots.some((i) => ((((bytes[i >> 3] ?? 0) >> (i & 7)) & 1) ^ (core[i] ? 1 : 0)) === 1);
}

/**
 * What this run keeps for its cards: the trails of the ones just played (`fresh`: each one's flags, packed as they
 * are, and the names it missed), and those of the cards whose result stands (`keep`), carried over from the earlier
 * run's numbers to today's.
 */
export function carry(
  was: Ground | undefined,
  trails: Record<string, Trail | undefined>,
  keep: Iterable<string>,
  fresh: { flags: Record<string, string>; misses: Record<string, string[]> },
  now: Built,
): { core: string; misses: string[]; trails: Record<string, { u: string; miss?: number[] }> } {
  const size = now.slots.length;
  const sets = new Map<string, Uint8Array>();
  const missed = new Map<string, string[]>();
  for (const [id, packed] of Object.entries(fresh.flags)) {
    sets.set(id, unpack(packed, size));
    missed.set(id, fresh.misses[id] ?? []);
  }
  if (was) {
    const today = new Map(now.slots.map((hash, i) => [hash, i]));
    const renumber = was.slots.map((hash) => today.get(hash));
    const wasCore = unpack(was.core, was.slots.length);
    for (const id of keep) {
      const trail = trails[id];
      if (trail?.u === undefined || sets.has(id)) continue;
      const set = new Uint8Array(size);
      // (A kept card's play ran through no unit that changed: each of its flags has a number today.)
      unpack(trail.u, was.slots.length, wasCore).forEach((bit, i) => {
        const to = renumber[i];
        if (bit && to !== undefined) set[to] = 1;
      });
      sets.set(id, set);
      missed.set(id, (trail.miss ?? []).map((i) => was.misses[i]!));
    }
  }
  const count = new Uint32Array(size);
  for (const set of sets.values()) for (let i = 0; i < size; i++) count[i]! += set[i]!;
  const core = Uint8Array.from(count, (n) => (n * 2 > sets.size ? 1 : 0));
  const names = new Map<string, number>();
  const out: Record<string, { u: string; miss?: number[] }> = {};
  for (const [id, set] of sets) {
    const miss = missed.get(id)!.map((key) => names.get(key) ?? (names.set(key, names.size), names.size - 1));
    out[id] = { u: pack(set, core), ...(miss.length ? { miss } : {}) };
  }
  return { core: pack(core), misses: [...names.keys()], trails: out };
}
