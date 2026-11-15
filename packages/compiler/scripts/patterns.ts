/**
 * How much of the grammar is written for one card: for every pattern in its source, the number of cards in the pool
 * it ever matches.
 *
 *   tsx scripts/patterns.ts <cards.json.gz> [out.json]
 *
 * A pattern that matches a single card among 33,000 is a line of that card's text spelled out as a pattern: the next
 * card worded a little differently needs another. The count is the grammar's debt, as ONE_CARD_PARAMETERS is the
 * schema's. (Counted: pattern literals of 12 characters or more; a pattern "matches" a card when it matches anything
 * while that card's text is read.)
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
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

async function main(): Promise<void> {
const { ParserRegistry } = await import('../src/parser.js');
const compile = await import('../src/compile.js');
const [poolPath, outPath] = process.argv.slice(2);
const db = JSON.parse(gunzipSync(readFileSync(poolPath!)).toString('utf8')) as { cards: { name: string; faces: { name: string; oracle: string; typeLine: string; manaCost: string }[] }[]; tokens: unknown[] };
// (reparseDB registers the pool's subtypes; run it on an empty pool with the type lines for that side effect.)
compile.reparseDB({ ...db, cards: db.cards.map((c) => ({ ...c, faces: c.faces.map((f) => ({ ...f, oracle: '' })) })), tokens: [] } as never);
seen.clear();
const registry = new ParserRegistry();
db.cards.forEach((card, i) => {
  current = i;
  for (const f of card.faces) registry.parse(f.oracle, { cardName: card.name, faceName: f.name, typeLine: f.typeLine, manaCost: f.manaCost });
});
current = -1;

// The patterns as written in the grammar's source.
const dir = fileURLToPath(new URL('../src/', import.meta.url));
const files = [...readdirSync(dir + 'grammar').map((f) => 'grammar/' + f), 'parser.ts', 'keywords.ts', 'keyword-definitions.ts'].filter((f) => f.endsWith('.ts'));
const rows: { file: string; line: number; source: string; cards: number; hits: number; words: number; example?: string }[] = [];
const literal = /(?<![\w)\]])\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n[])+)\/([dgimsuy]*)/g;
for (const file of files) {
  const text = readFileSync(dir + file, 'utf8').split('\n');
  text.forEach((ln, n) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(ln)) return;
    for (const m of ln.matchAll(literal)) {
      const source = m[1]!;
      if (source.length < 12) continue;
      const e = seen.get(source);
      // plain words in the pattern: what it spells out
      const words = (source.replace(/\\[a-zA-Z]/g, ' ').match(/[A-Za-z']{3,}/g) ?? []).length;
      rows.push({ file, line: n + 1, source, cards: e ? e.cards.size : 0, hits: e ? e.hits : 0, words, ...(e && e.cards.size === 1 ? { example: db.cards[[...e.cards][0]!]!.name } : {}) });
    }
  });
}
if (outPath) writeFileSync(outPath, JSON.stringify(rows));
const by = (lo: number, hi: number) => rows.filter((r) => r.cards >= lo && r.cards <= hi).length;
console.log(`${rows.length} patterns of 12+ characters in the grammar's source`);
console.log(`  never matched: ${by(0, 0)}; one card: ${by(1, 1)}; 2–3 cards: ${by(2, 3)}; 4–11: ${by(4, 11)}; 12 or more: ${by(12, 99)}`);
const files2 = [...new Set(rows.map((r) => r.file))].map((f) => ({ f, all: rows.filter((r) => r.file === f).length, one: rows.filter((r) => r.file === f && r.cards === 1).length }));
for (const x of files2.sort((a, b) => b.all - a.all).slice(0, 8)) console.log(`  ${x.f.padEnd(24)} ${String(x.all).padStart(5)} patterns, ${String(x.one).padStart(4)} for one card`);
}
void main();
