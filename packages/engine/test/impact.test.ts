import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { FORMAT, build, carry, decide, pack, replay, scan, tokenize, unpack, type Built, type Ground, type Manifest, type Trail } from '../scripts/lib/impact.js';

// Which cards a change to the code can affect (scripts/lib/impact.ts): the code is cut into units — the blocks of
// statements — each known by a hash of its own text; a card's play notes which units ran; a later state of the code
// touches the card only if one of those units isn't what it was.

/** A module scanned on its own: its units by name, and the flags that running it (and `then`) sets. */
function unitsOf(source: string, file = 'a.ts') {
  const slots: string[] = [];
  const r = scan(file, source, (h) => (slots.includes(h) ? slots.indexOf(h) : slots.push(h) - 1));
  const run = (then = ''): string[] => {
    const __u = new Uint8Array(slots.length);
    // (As a script: without the `export`s.)
    runInNewContext(`${r.instrumented.replace(/\bexport (?=function|const|class)/g, '')}\n${then}`, { __u });
    return r.units.filter((u) => __u[slots.indexOf(u.hash)]).map((u) => u.name);
  };
  return { ...r, slots, run, names: r.units.map((u) => (u.kind === 'fn' || u.kind === 'block' ? `${u.kind} ${u.name}` : u.name)) };
}

describe('tokens', () => {
  const kinds = (js: string) =>
    tokenize(js)
      .filter((t) => t.v === '{')
      .map((t) => t.kind);

  it('tells a block of statements from an object literal, a pattern, a class and an import', () => {
    expect(kinds('function f(a) { if (a) { g(); } else { h(); } for (const x of a) { y(x); } }')).toEqual(['fn', 'block', 'block', 'block']);
    expect(kinds('const o = { a: 1, b: { c: 2 } }; const { d } = o; f({ e: 1 }); return { z };')).toEqual(['object', 'object', 'object', 'object', 'object']);
    expect(kinds('class A extends B { m() { return { x: 1 }; } static { init(); } get v() { return 1; } }')).toEqual(['class', 'fn', 'object', 'block', 'fn']);
    expect(kinds("import { a, b as c } from './x.js'; export { a };")).toEqual(['module', 'module']);
    expect(kinds('const f = (a) => { try { g(); } catch { h(); } finally { i(); } }; const k = () => ({ a: 1 });')).toEqual(['fn', 'block', 'block', 'block', 'object']);
    expect(kinds('switch (x) { case 1: { a(); break; } default: b(); } label: { c(); } const v = q ? { a: 1 } : { b: 2 };')).toEqual(['switch', 'block', 'block', 'object', 'object']);
    expect(kinds('const o = { m(a) { return a; }, async n() { await 1; }, [k]() { return 2; }, p: function () { return 3; } };')).toEqual(['object', 'fn', 'fn', 'fn', 'fn']);
  });

  it('tells a regular expression from a division, and reads through strings and templates', () => {
    const texts = (js: string) =>
      tokenize(js)
        .filter((t) => t.t === 're' || t.t === 'tpl' || t.t === 'str')
        .map((t) => t.v);
    expect(texts('const a = b / c / d; const r = /x\\/[/}]{2}/g.test(s); if (a) /y{/.test(b);')).toEqual(['/x\\/[/}]{2}/g', '/y{/']);
    expect(texts('const t = `a{ ${x.map((y) => `${y}}`).join("}")} b`;')).toEqual(['`a{ ${', '`${', '}}`', '"}"', '} b`']);
    expect(texts("const s = 'it\\'s {'; const n = (a + b) / 2; x++ / 3; return /z/;")).toEqual(["'it\\'s {'", '/z/']);
    // Every bracket finds its partner.
    for (const t of tokenize('f(a[0], { b: [1, (2)] }, `x${[1].map((n) => { return n; })}y`);')) if ('([{'.includes(t.v) && t.t === 'p') expect(t.match).toBeGreaterThan(0);
    expect(() => tokenize('function f() { return (1; }')).toThrow(/unbalanced/);
  });
});

describe('units', () => {
  const SOURCE = `
    // A comment.
    const TABLE: Record<string, number> = { a: 1 };
    export function outer(x: number): number {
      if (x > 0) {
        return inner(x);
      } else {
        for (const k of Object.keys(TABLE)) { x += TABLE[k]!; }
      }
      return x;
    }
    const inner = (n: number): number => { return n * 2; };
    const tiny = (n: number) => n + 1;
  `;

  it('a function body and each block inside it is a unit; one-line arrows and literals are not', () => {
    const u = unitsOf(SOURCE);
    expect(u.names).toEqual(['fn outer', 'block if', 'block else', 'block for', 'fn inner']);
    expect(u.top.map((s) => `${s.kind} ${s.names.join()}`)).toEqual(['decl TABLE', 'decl outer', 'decl inner', 'decl tiny']);
  });

  it('running the copy sets the flag of each unit entered, and only those', () => {
    const u = unitsOf(SOURCE);
    expect(u.run()).toEqual([]);
    expect(u.run('outer(1);')).toEqual(['outer', 'if', 'inner']);
    expect(u.run('outer(-1);')).toEqual(['outer', 'else', 'for']);
    expect(u.run('tiny(1);')).toEqual([]);
  });

  it('comments, layout and types are no part of a unit', () => {
    const u = unitsOf(SOURCE);
    const same = unitsOf(SOURCE.replace('// A comment.', '/* Another. */').replace('(x: number): number {', '(x: number | bigint): number\n{').replace('return inner(x);', 'return   inner( x );   // doubled'));
    expect(same.slots).toEqual(u.slots);
    expect(same.top.map((s) => s.hash)).toEqual(u.top.map((s) => s.hash));
  });

  it('a change inside a block changes that block, and what is inside it, and nothing around it', () => {
    const u = unitsOf(SOURCE);
    const v = unitsOf(SOURCE.replace('x += TABLE[k]!;', 'x -= TABLE[k]!;'));
    const moved = u.units.filter((x, i) => x.hash !== v.units[i]!.hash).map((x) => x.name);
    expect(moved).toEqual(['for']);
    // In the block's condition — text of the block around it — the whole branch is another.
    const w = unitsOf(SOURCE.replace('of Object.keys(TABLE)', 'of Object.values(TABLE)'));
    expect(u.units.filter((x, i) => x.hash !== w.units[i]!.hash).map((x) => x.name)).toEqual(['else', 'for']);
    // In the function's own text: all of it.
    const y = unitsOf(SOURCE.replace('x > 0', 'x >= 0'));
    expect(u.units.filter((x, i) => x.hash !== y.units[i]!.hash).map((x) => x.name)).toEqual(['outer', 'if', 'else', 'for']);
  });

  it('two units with the same text under the same parent share a flag', () => {
    const u = unitsOf('function f(a) { if (a.x) { return 1; } if (a.y) { return 1; } return 0; }');
    expect(u.names).toEqual(['fn f', 'block if', 'block if']);
    expect(u.units[1]!.hash).toBe(u.units[2]!.hash);
    expect(u.slots).toHaveLength(2);
  });

  it('a block with a var in it is no unit: the var belongs to the function', () => {
    expect(unitsOf('function f(a) { if (a) { var x = 1; } else { g(); } return x; }').names).toEqual(['fn f', 'block else']);
  });
});

describe('a switch on literal values', () => {
  const SWITCH = `
    function kind(t) {
      switch (t.type) {
        case 'a':
        case 'b':
          return 1;
        case 'c': {
          const n = t.n;
          return n;
        }
        default:
          return 0;
      }
    }`;

  it('each clause is a unit', () => {
    const u = unitsOf(SWITCH);
    expect(u.names).toEqual(['fn kind', "case 'a'", "case 'b'", "case 'c'", 'block block', 'default']);
    expect(u.run("kind({ type: 'b' });")).toEqual(['kind', "case 'b'"]);
    // One that runs on into the next sets both.
    expect(u.run("kind({ type: 'a' });")).toEqual(['kind', "case 'a'", "case 'b'"]);
    expect(u.run("kind({ type: 'z' });")).toEqual(['kind', 'default']);
  });

  it('a new clause changes `default` — where its values went until now — and no other clause, nor the function', () => {
    const u = unitsOf(SWITCH);
    const v = unitsOf(SWITCH.replace('default:', "case 'd':\n return 4;\n default:"));
    const changed = u.units.filter((x) => !v.slots.includes(x.hash)).map((x) => x.name);
    expect(changed).toEqual(['default']);
  });

  it('a clause that runs on into the next changes when the next does', () => {
    const u = unitsOf(SWITCH);
    const v = unitsOf(SWITCH.replace('return 1;', 'return 2;'));
    expect(u.units.filter((x) => !v.slots.includes(x.hash)).map((x) => x.name)).toEqual(["case 'a'", "case 'b'"]);
  });

  it('with no `default`, values no clause takes set a flag of their own', () => {
    const none = "function f(t) { switch (t) { case 1: return 'one'; case 2: return 'two'; } return ''; }";
    const u = unitsOf(none);
    expect(u.names).toEqual(['fn f', 'case 1', 'case 2', 'no case']);
    expect(u.run('f(3);')).toEqual(['f', 'no case']);
    expect(u.run('f(1);')).toEqual(['f', 'case 1']);
    const v = unitsOf(none.replace('case 2:', "case 3: return 'three'; case 2:"));
    expect(u.units.filter((x) => !v.slots.includes(x.hash)).map((x) => x.name)).toEqual(['no case']);
  });

  it('a switch whose clauses declare names, or whose labels are worked out, stays whole', () => {
    expect(unitsOf('function f(t) { switch (t) { case 1: const a = 2; return a; default: return 0; } }').names).toEqual(['fn f']);
    expect(unitsOf('function f(t) { switch (t) { case A.b: return 1; default: return 0; } }').names).toEqual(['fn f']);
  });
});

// ---------------------------------------------------------------------------

const ENGINE = 'packages/engine/src';
type Sources = Record<string, string>;

function code(sources: Sources): Built {
  return build({
    list: (dir) => Object.keys(sources).flatMap((path) => (path.startsWith(`${dir}/`) ? [path.slice(dir.length + 1)] : [])),
    read: (path) => sources[path]!,
  });
}
const stored = (b: Built): Manifest => JSON.parse(JSON.stringify({ slots: b.slots, twins: b.twins, files: b.files, registry: b.registry })) as Manifest;
/** What changing `from` into `to` touches: the units' names, or the reason every card is. */
function touched(from: Sources, to: Sources, init: string[] = []) {
  const base = code(from);
  const d = decide(
    stored(base),
    init.map((name) => base.names.findIndex((n) => n.endsWith(name))),
    code(to),
  );
  return { all: d.all, units: [...d.slots].map((s) => base.names[s]!.replace(/^[^:]*: /, '')).sort(), added: [...d.added] };
}

const BASE: Sources = {
  [`${ENGINE}/rules.ts`]: `
    import { LIMIT, double } from './tables.js';
    export interface Thing { n: number }
    export function grow(t: Thing): number {
      if (t.n > LIMIT) { return t.n; }
      return double(t.n);
    }
    export function shrink(t: Thing): number {
      return t.n - 1;
    }`,
  [`${ENGINE}/tables.ts`]: `
    export const LIMIT = 10;
    export const NAMES = ['a', 'b'];
    export const double = (n: number): number => n * 2;
    export function setup(): string[] { return NAMES.map((n) => n + '!'); }`,
};
const edit = (file: string, from: string, to: string): Sources => {
  expect(BASE[`${ENGINE}/${file}`]).toContain(from);
  return { ...BASE, [`${ENGINE}/${file}`]: BASE[`${ENGINE}/${file}`]!.replace(from, to) };
};

describe('what a change touches', () => {
  it('nothing, when only types, comments or layout changed', () => {
    expect(touched(BASE, edit('rules.ts', 'export interface Thing { n: number }', '// Sizes.\n export interface Thing { n: number; m?: string }\n export type Other = Thing[];'))).toEqual({ all: undefined, units: [], added: [] });
  });

  it('a change in a block: the block', () => {
    expect(touched(BASE, edit('rules.ts', '{ return t.n; }', '{ return t.n + 1; }')).units).toEqual(['grow > if']);
    expect(touched(BASE, edit('rules.ts', 'return t.n - 1;', 'return t.n - 2;')).units).toEqual(['shrink']);
  });

  it('a constant or a one-line function that changed: every unit that uses its name', () => {
    expect(touched(BASE, edit('tables.ts', 'LIMIT = 10', 'LIMIT = 11')).units).toEqual(['grow']);
    expect(touched(BASE, edit('tables.ts', 'n * 2', 'n * 3')).units).toEqual(['grow']);
    expect(touched(BASE, edit('tables.ts', "['a', 'b']", "['a', 'b', 'c']")).units).toEqual(['setup']);
  });

  it('what is declared in terms of a changed name has changed too', () => {
    const from: Sources = { ...BASE, [`${ENGINE}/more.ts`]: "import { LIMIT } from './tables.js'; export const TWICE = LIMIT * 2; export function over(n: number) { return n > TWICE; }" };
    const to = { ...from, [`${ENGINE}/tables.ts`]: from[`${ENGINE}/tables.ts`]!.replace('LIMIT = 10', 'LIMIT = 11') };
    expect(touched(from, to).units).toEqual(['grow', 'over']);
  });

  it('a new declaration touches nothing by itself — unless making it runs code', () => {
    expect(touched(BASE, edit('tables.ts', 'export const LIMIT', "export const MORE = new Set(['x']);\n export const helper = (n: number) => double(n);\n export function other() { return 1; }\n export const LIMIT"))).toEqual({ all: undefined, units: [], added: [] });
    expect(touched(BASE, edit('tables.ts', 'export const LIMIT', 'export const READY = setup();\n export const LIMIT')).all).toMatch(/READY runs code as the module loads/);
    expect(touched(BASE, edit('tables.ts', 'export const LIMIT', 'export const BUILT = NAMES.map((n) => { return setup(); });\n export const LIMIT')).all).toMatch(/BUILT runs code/);
  });

  it('a statement that runs as a module loads, new or changed: every card', () => {
    expect(touched(BASE, edit('tables.ts', 'export const LIMIT', 'NAMES.push("z");\n export const LIMIT')).all).toMatch(/runs as tables.ts loads/);
  });

  it('a name imported from somewhere else: every card', () => {
    const from: Sources = { ...BASE, [`${ENGINE}/other.ts`]: 'export const LIMIT = 99;' };
    const to = { ...from, [`${ENGINE}/rules.ts`]: from[`${ENGINE}/rules.ts`]!.replace("import { LIMIT, double } from './tables.js';", "import { double } from './tables.js'; import { LIMIT } from './other.js';") };
    expect(touched(from, to).all).toMatch(/rules.ts imports LIMIT from somewhere else/);
    // A name imported in addition changes nothing by itself.
    expect(touched(BASE, edit('rules.ts', 'import { LIMIT, double }', 'import { LIMIT, NAMES, double }'))).toEqual({ all: undefined, units: [], added: [] });
  });

  it('names passed on from other modules: one more is nothing, one that stands for something else is every card', () => {
    const index = (line: string): Sources => ({ ...BASE, [`${ENGINE}/other.ts`]: 'export const LIMIT = 99;', [`${ENGINE}/index.ts`]: line });
    const from = index("export { grow } from './rules.js';\n export { LIMIT, double as twice } from './tables.js';");
    expect(touched(from, index("export { grow, shrink, type Thing } from './rules.js';\n export { LIMIT, NAMES, double as twice } from './tables.js';"))).toEqual({ all: undefined, units: [], added: [] });
    expect(touched(from, index("export { grow } from './rules.js';\n export { double as twice } from './tables.js';"))).toEqual({ all: undefined, units: [], added: [] });
    expect(touched(from, index("export { grow } from './rules.js';\n export { double as twice } from './tables.js';\n export { LIMIT } from './other.js';")).all).toMatch(/index.ts passes on LIMIT from somewhere else/);
    expect(touched(from, index("export { grow } from './rules.js';\n export { LIMIT, setup as twice } from './tables.js';")).all).toMatch(/index.ts passes on twice from somewhere else/);
    expect(touched(from, index("export { grow } from './rules.js';\n export { double as twice } from './tables.js';\n export const LIMIT = 3;")).all).toMatch(/index.ts passes on LIMIT from somewhere else/);
    expect(touched(from, index("export { grow } from './rules.js';\n export { LIMIT, double as twice } from './tables.js';\n export * from './other.js';")).all).toMatch(/passes on everything of another module/);
    const star = index("export * from './tables.js';");
    expect(touched(star, index("export { LIMIT } from './tables.js';")).all).toMatch(/no longer passes on everything of .\/tables.js/);
  });

  it('code that ran before any card was played: every card', () => {
    expect(touched(BASE, edit('rules.ts', 'return t.n - 1;', 'return t.n - 2;'), ['shrink']).all).toMatch(/before any card is played/);
    expect(touched(BASE, edit('tables.ts', "['a', 'b']", "['a', 'b', 'c']"), ['setup']).all).toMatch(/before any card is played/);
    expect(touched(BASE, edit('rules.ts', '{ return t.n; }', '{ return t.n + 1; }'), ['shrink']).all).toBeUndefined();
  });

  it('a file that is gone takes its units with it; a new one adds nothing to play again', () => {
    const { [`${ENGINE}/rules.ts`]: _gone, ...rest } = BASE;
    expect(touched(BASE, rest).units).toEqual(['grow', 'grow > if', 'shrink']);
    expect(touched(rest, BASE)).toEqual({ all: undefined, units: [], added: [] });
  });
});

describe('the registry', () => {
  const PLUGIN: Sources = {
    [`${ENGINE}/registry.ts`]: `
      const effects = new Map<string, (n: number) => number>();
      export function installPlugin(p: { id: string; effects: Record<string, (n: number) => number>; statics: string[] }): void {
        for (const [k, h] of Object.entries(p.effects)) { effects.set(k, h); }
      }
      export function run(type: string, n: number): number { return effects.get(type)?.(n) ?? 0; }`,
    [`${ENGINE}/core.ts`]: `
      import { installPlugin } from './registry.js';
      const effects: Record<string, (n: number) => number> = {
        draw(n) { return n + 1; },
        discard(n) {
          if (n > 3) { return 3; }
          return n;
        },
      };
      export const corePlugin = { id: 'core', effects, statics: ['continuous', 'enters_tapped'] };
      installPlugin(corePlugin);`,
  };
  const core = (from: string, to: string): Sources => {
    expect(PLUGIN[`${ENGINE}/core.ts`]).toContain(from);
    return { ...PLUGIN, [`${ENGINE}/core.ts`]: PLUGIN[`${ENGINE}/core.ts`]!.replace(from, to) };
  };

  it('a handler under a new name: the cards that looked the name up and found nothing', () => {
    expect(touched(PLUGIN, core('draw(n) {', 'mill(n) { return n * 2; },\n draw(n) {'))).toEqual({ all: undefined, units: [], added: ['effects:mill'] });
    expect(touched(PLUGIN, core("'enters_tapped']", "'enters_tapped', 'hexproof_from']"))).toEqual({ all: undefined, units: [], added: ['statics:hexproof_from'] });
  });

  it('a handler whose body changed: the cards that ran it', () => {
    expect(touched(PLUGIN, core('return n + 1;', 'return n + 2;')).units).toEqual(['draw']);
    expect(touched(PLUGIN, core('{ return 3; }', '{ return 4; }')).units).toEqual(['discard > if']);
  });

  it('a handler removed, or declared another way, or anything else about the plugin: every card', () => {
    expect(touched(PLUGIN, core('draw(n) { return n + 1; },', '')).all).toMatch(/no longer has effects:draw/);
    expect(touched(PLUGIN, core('draw(n) {', 'draw(n, more = 1) {')).all).toMatch(/effects:draw isn't declared the way it was/);
    expect(touched(PLUGIN, core("id: 'core'", "id: 'kernel'")).all).toMatch(/plugin:corePlugin.id/);
    expect(touched(PLUGIN, core("'continuous', ", '')).all).toMatch(/no longer has statics:continuous/);
  });
});

describe('the flags a play set, as text', () => {
  it('packs to the bits that differ from what most plays set, and back', () => {
    const core = Uint8Array.from([1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0]);
    const set = Uint8Array.from([1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1]);
    expect(pack(core, core)).toBe('');
    expect([...unpack(pack(set, core), set.length, core)]).toEqual([...set]);
    expect([...unpack(pack(set), set.length)]).toEqual([...set]);
    expect([...unpack('', 4, Uint8Array.from([1, 0, 1, 0]))]).toEqual([1, 0, 1, 0]);
  });
});

describe('from one run to the next', () => {
  const flags = (b: Built, ...units: string[]): Uint8Array => {
    const set = new Uint8Array(b.slots.length);
    for (const unit of units) {
      const i = b.names.findIndex((n) => n.endsWith(`: ${unit}`));
      expect(i, unit).toBeGreaterThanOrEqual(0);
      set[i] = 1;
    }
    return set;
  };
  const unitsIn = (b: Built, packed: string, core: string): string[] =>
    [...unpack(packed, b.slots.length, unpack(core, b.slots.length))].flatMap((bit, i) => (bit ? [b.names[i]!.replace(/^[^:]*: /, '')] : [])).sort();
  /** What a run of `b` kept, with `core` the units most plays ran. */
  const ground = (b: Built, core: string[] = [], over: Partial<Ground> = {}): Ground => ({ ...stored(b), format: FORMAT, init: pack(new Uint8Array(b.slots.length)), initMiss: [], core: pack(flags(b, ...core)), misses: [], boards: 'boards', tool: 'tool', ...over });
  const here = { boards: 'boards', tool: 'tool' };
  const base = code(BASE);
  const was = ground(base, ['grow']);
  const trail = (def: string, ...units: string[]): Trail => ({ def, u: pack(flags(base, ...units), flags(base, 'grow')) });
  const trails = { a: trail('1', 'grow', 'grow > if'), b: trail('2', 'shrink'), c: trail('3', 'grow'), d: trail('4', 'grow', 'shrink') };
  const cards = [
    { id: 'a', def: '1' },
    { id: 'b', def: '2' },
    { id: 'c', def: '3' },
    { id: 'd', def: '4' },
  ];

  it('nothing changed: every result stands', () => {
    const r = replay(was, trails, cards, code(BASE), here);
    expect(r.all).toBeUndefined();
    expect([...r.keep]).toEqual(['a', 'b', 'c', 'd']);
  });

  it('a block changed: the cards whose play ran through it are played again, and no others', () => {
    const r = replay(was, trails, cards, code(edit('rules.ts', '{ return t.n; }', '{ return t.n + 1; }')), here);
    expect([...r.keep]).toEqual(['b', 'c', 'd']);
    expect(r.why).toEqual({ code: 1, registry: 0, definition: 0, unseen: 0 });
    // A unit most plays ran (it is in none of the trails as such: they say how they differ from most).
    expect([...replay(was, trails, cards, code(edit('rules.ts', 'return double(t.n);', 'return double(t.n) + 1;')), here).keep]).toEqual(['b']);
  });

  it('a card with another definition, or one the earlier run never played, is played', () => {
    const r = replay(was, trails, [{ id: 'a', def: '1' }, { id: 'b', def: 'other' }, { id: 'new', def: '9' }], code(BASE), here);
    expect([...r.keep]).toEqual(['a']);
    expect(r.why).toEqual({ code: 0, registry: 0, definition: 1, unseen: 1 });
  });

  it('every card: no earlier run, one kept another way, other boards, other checks, a change that reaches them all', () => {
    expect(replay(undefined, {}, cards, code(BASE), here).all).toMatch(/nothing to go by/);
    expect(replay({ ...was, format: FORMAT + 1 }, trails, cards, code(BASE), here).all).toMatch(/nothing to go by/);
    expect(replay(was, trails, cards, code(BASE), { ...here, boards: 'others' }).all).toMatch(/boards/);
    expect(replay(was, trails, cards, code(BASE), { ...here, tool: 'other' }).all).toMatch(/checks themselves changed/);
    expect(replay(was, trails, cards, code(edit('tables.ts', 'export const LIMIT', 'NAMES.push("z");\n export const LIMIT')), here).all).toMatch(/runs as tables.ts loads/);
    // Code that ran as the engine loaded and learned the pool.
    const loaded = ground(base, ['grow'], { init: pack(flags(base, 'setup')) });
    expect(replay(loaded, trails, cards, code(edit('tables.ts', "n + '!'", "n + '?'")), here).all).toMatch(/before any card is played/);
    expect(replay(loaded, trails, cards, code(edit('rules.ts', 'return t.n - 1;', 'return t.n - 2;')), here).all).toBeUndefined();
  });

  it('a name new in the registry: the cards that looked it up and missed', () => {
    const sources = (extra: string): Sources => ({
      [`${ENGINE}/registry.ts`]: 'export function installPlugin(p: { id: string; effects: Record<string, (n: number) => number> }): void { void p; }',
      [`${ENGINE}/core.ts`]: `import { installPlugin } from './registry.js';\n const effects: Record<string, (n: number) => number> = { ${extra} draw(n) { return n + 1; } };\n export const corePlugin = { id: 'core', effects };\n installPlugin(corePlugin);`,
    });
    const before = code(sources(''));
    const kept = { ...ground(before), misses: ['effects:mill', 'effects:scry'] };
    const draw = pack(flags(before, 'draw'));
    const seen = { a: { def: '1', u: draw, miss: [0] }, b: { def: '2', u: draw, miss: [1] }, c: { def: '3', u: draw } };
    const r = replay(kept, seen, cards.slice(0, 3), code(sources('mill(n) { return n * 2; },')), here);
    expect([...r.keep]).toEqual(['b', 'c']);
    expect(r.why.registry).toBe(1);
    // Looked up before any card was played: whatever came of that is in every play.
    expect(replay({ ...kept, initMiss: ['effects:mill'] }, seen, cards.slice(0, 3), code(sources('mill(n) { return n * 2; },')), here).all).toMatch(/registry has effects:mill now/);
  });

  it('what stands is carried over to the numbers the flags have now, beside what was just played', () => {
    // Another function first: every flag after it has another number.
    const now = code(edit('rules.ts', 'export function grow', 'export function early(): number { return 0; }\n export function grow'));
    expect(now.slots.indexOf(base.slots[base.names.findIndex((n) => n.endsWith(': shrink'))]!)).not.toBe(base.names.findIndex((n) => n.endsWith(': shrink')));
    const r = replay(was, trails, [...cards, { id: 'e', def: '5' }], now, here);
    expect([...r.keep]).toEqual(['a', 'b', 'c', 'd']);
    const next = carry({ ...was, misses: ['effects:mill'] }, { ...trails, b: { ...trails.b, miss: [0] } }, r.keep, { flags: { e: pack(flags(now, 'early', 'shrink')) }, misses: { e: ['effects:scry', 'effects:mill'] } }, now);
    const units = (id: string) => unitsIn(now, next.trails[id]!.u, next.core);
    expect(units('a')).toEqual(['grow', 'grow > if']);
    expect(units('b')).toEqual(['shrink']);
    expect(units('c')).toEqual(['grow']);
    expect(units('d')).toEqual(['grow', 'shrink']);
    expect(units('e')).toEqual(['early', 'shrink']);
    // What most plays ran, now: grow (3 of 5) and shrink (3 of 5).
    expect(unitsIn(now, next.core, '')).toEqual(['grow', 'shrink']);
    expect(next.trails.b!.miss!.map((i) => next.misses[i])).toEqual(['effects:mill']);
    expect(next.trails.e!.miss!.map((i) => next.misses[i])).toEqual(['effects:scry', 'effects:mill']);
    expect(next.trails.a!.miss).toBeUndefined();
    // And the next run reads them as they were meant.
    const again = replay({ ...ground(now), core: next.core, misses: next.misses }, Object.fromEntries(Object.entries(next.trails).map(([id, t]) => [id, { ...t, def: id }])), ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, def: id })), code(edit('rules.ts', 'export function grow', 'export function early(): number { return 1; }\n export function grow')), here);
    expect([...again.keep]).toEqual(['a', 'b', 'c', 'd']);
  });

  it('a card played now replaces what was kept for it', () => {
    const next = carry(was, trails, ['a', 'b'], { flags: { a: pack(flags(base, 'shrink')) }, misses: {} }, base);
    expect(unitsIn(base, next.trails.a!.u, next.core)).toEqual(['shrink']);
    expect(Object.keys(next.trails).sort()).toEqual(['a', 'b']);
  });
});
