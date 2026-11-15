/**
 * How much of the grammar is written for one card: for every pattern in its source, the number of cards in the pool
 * it ever matches.
 *
 *   tsx scripts/patterns.ts <cards.json.gz> [out.json] [--update [--allow-more]]
 *   tsx scripts/patterns.ts --check
 *
 * A pattern that matches a single card among 33,000 is a line of that card's text spelled out as a pattern: the next
 * card worded a little differently needs another. The count is the grammar's debt, as ONE_CARD_PARAMETERS is the
 * schema's. (Counted: pattern literals of 12 characters or more; a pattern "matches" a card when it matches anything
 * while that card's text is read.)
 *
 * The count is a ratchet (instruments.json, beside this package's source): it may fall and may not rise.
 *   --update   counts on the full card pool and writes the file; refuses to write a higher count (the patterns that
 *              are new are listed) unless --allow-more says the debt is taken on knowingly — the file's diff shows it.
 *   --check    what CI runs, with no pool: fails if the grammar's patterns aren't the ones the file was written for.
 *              So a change to the patterns comes with the file written again, and the count was held when it was.
 * A pattern that matched no card when the file was written and matches one now did nothing new: a card arrived. Those
 * are not counted against the ratchet.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const seen = new Map<string, { cards: Set<number>; hits: number }>();
let current = -1;
const exec = RegExp.prototype.exec;
RegExp.prototype.exec = function (this: RegExp, s: string) {
  const r = exec.call(this, s);
  if (r && current >= 0) {
    let e = seen.get(this.source);
    if (!e) seen.set(this.source, (e = { cards: new Set(), hits: 0 }));
    e.hits++;
    if (e.cards.size < 12) e.cards.add(current);
  }
  return r;
};

/** The patterns as written in the grammar's source. */
function written(): { file: string; line: number; source: string }[] {
  const dir = fileURLToPath(new URL('../src/', import.meta.url));
  const files = [...readdirSync(dir + 'grammar').map((f) => 'grammar/' + f), 'parser.ts', 'keywords.ts', 'keyword-definitions.ts'].filter((f) => f.endsWith('.ts'));
  const literal = /(?<![\w)\]])\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n[])+)\/([dgimsuy]*)/g;
  const out: { file: string; line: number; source: string }[] = [];
  for (const file of files) {
    readFileSync(dir + file, 'utf8')
      .split('\n')
      .forEach((ln, n) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(ln)) return;
        for (const m of ln.matchAll(literal)) if (m[1]!.length >= 12) out.push({ file, line: n + 1, source: m[1]! });
      });
  }
  return out;
}
const id = (source: string) => createHash('sha256').update(source).digest('hex').slice(0, 10);
/** One value for the whole set of patterns: the file was written for this grammar, or it wasn't. */
const digestOf = (sources: string[]) => createHash('sha256').update(sources.map(id).sort().join('\n')).digest('hex').slice(0, 16);
/** A pool smaller than this isn't the card pool (the sample the web app is built against in CI is a few dozen cards). */
const FULL_POOL = 20000;

type OnRecord = { digest?: string; all: number; oneCard: number; one: string[]; never: string[] };

async function main(): Promise<void> {
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
  const [poolPath, outPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const file = fileURLToPath(new URL('../instruments.json', import.meta.url));
  const instruments = (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}) as { patterns?: OnRecord; [k: string]: unknown };
  const was = instruments.patterns;
  const source = written();
  const digest = digestOf(source.map((r) => r.source));

  if (flags.has('--check')) {
    if (!was?.digest) throw new Error('packages/compiler/instruments.json has no pattern count: run `pnpm grammar:update` with the full card pool and commit it');
    if (was.digest !== digest) {
      console.error(
        `The grammar's patterns aren't the ones packages/compiler/instruments.json was written for (${source.length} now, ${was.all} then).\n` +
          'Run `pnpm grammar:update` with the full card pool and commit the file. It refuses if more patterns serve one card than before:\n' +
          'fold the new ones into a reader other cards use, or take the debt on knowingly (tools/dev/README.md, "The grammar\'s instruments").',
      );
      process.exit(1);
    }
    console.log(`pattern count: ${was.oneCard} of the grammar's ${was.all} patterns serve one card, as on record`);
    return;
  }
  if (!poolPath) throw new Error('usage: patterns.ts <cards.json.gz> [out.json] [--update [--allow-more]] | patterns.ts --check');

  const { ParserRegistry } = await import('../src/parser.js');
  const compile = await import('../src/compile.js');
  const db = JSON.parse(gunzipSync(readFileSync(poolPath)).toString('utf8')) as { cards: { name: string; faces: { name: string; oracle: string; typeLine: string; manaCost: string }[] }[]; tokens: unknown[] };
  // (reparseDB registers the pool's subtypes; run it on an empty pool with the type lines for that side effect.)
  compile.reparseDB({ ...db, cards: db.cards.map((c) => ({ ...c, faces: c.faces.map((f) => ({ ...f, oracle: '' })) })), tokens: [] } as never);
  seen.clear();
  const registry = new ParserRegistry();
  db.cards.forEach((card, i) => {
    current = i;
    for (const f of card.faces) registry.parse(f.oracle, { cardName: card.name, faceName: f.name, typeLine: f.typeLine, manaCost: f.manaCost });
  });
  current = -1;

  const rows = source.map((r) => {
    const e = seen.get(r.source);
    // plain words in the pattern: what it spells out
    const words = (r.source.replace(/\\[a-zA-Z]/g, ' ').match(/[A-Za-z']{3,}/g) ?? []).length;
    return { ...r, cards: e ? e.cards.size : 0, hits: e ? e.hits : 0, words, ...(e && e.cards.size === 1 ? { example: db.cards[[...e.cards][0]!]!.name } : {}) };
  });
  if (outPath) writeFileSync(outPath, JSON.stringify(rows));
  const by = (lo: number, hi: number) => rows.filter((r) => r.cards >= lo && r.cards <= hi).length;
  console.log(`${rows.length} patterns of 12+ characters in the grammar's source`);
  console.log(`  never matched: ${by(0, 0)}; one card: ${by(1, 1)}; 2–3 cards: ${by(2, 3)}; 4–11: ${by(4, 11)}; 12 or more: ${by(12, 99)}`);
  const files = [...new Set(rows.map((r) => r.file))].map((f) => ({ f, all: rows.filter((r) => r.file === f).length, one: rows.filter((r) => r.file === f && r.cards === 1).length }));
  for (const x of files.sort((a, b) => b.all - a.all).slice(0, 8)) console.log(`  ${x.f.padEnd(24)} ${String(x.all).padStart(5)} patterns, ${String(x.one).padStart(4)} for one card`);

  // The ratchet.
  if (!flags.has('--update')) return;
  if (db.cards.length < FULL_POOL) throw new Error(`the count is taken on the full card pool; this one has ${db.cards.length} cards (pnpm cards:build, or cards.json.gz from the reports branch)`);
  const one = rows.filter((r) => r.cards === 1);
  // Not against the ratchet: a pattern that matched nothing when the file was written, and that a card has since met.
  const counted = one.filter((r) => !was?.never.includes(id(r.source)));
  const fresh = counted.filter((r) => !was?.one.includes(id(r.source)));
  if (was && counted.length > was.oneCard && !flags.has('--allow-more')) {
    console.error(
      `\n${counted.length} patterns serve one card; there were ${was.oneCard}. Not among them before:\n` +
        fresh.map((r) => `  ${r.file}:${r.line}  [${r.example ?? '?'}]  ${r.source.slice(0, 110)}`).join('\n') +
        '\nFold them into a reader other cards use — or take the debt on knowingly: patterns.ts <pool> --update --allow-more.',
    );
    process.exit(1);
  }
  const ids = (rs: typeof rows) => [...new Set(rs.map((r) => id(r.source)))].sort();
  instruments.patterns = { digest, all: rows.length, oneCard: one.length, one: ids(one), never: ids(rows.filter((r) => r.cards === 0)) };
  writeFileSync(file, `${JSON.stringify(instruments, null, 1)}\n`);
  console.log(`pattern count on record: ${one.length} for one card${was ? ` (was ${was.oneCard})` : ''}`);
}
void main();
