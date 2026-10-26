/**
 * Measures the grammar against a compiled card DB without re-downloading Scryfall data:
 *
 *   tsx scripts/reparse.ts <cards.json.gz> [--out coverage.md] [--grep <regex>] [--limit N]
 *
 * Prints coverage totals. --grep lists unparsed lines matching a pattern (for grammar work).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { CORE_NODES, faceAbilities, nodeTags, type CardDB } from '@mtg/schema';
import { buildCoverage, coverageMarkdown, reparseDB } from '../src/index.js';

const args = process.argv.slice(2).filter((a) => a !== '--');
const input = args[0];
if (!input) throw new Error('usage: reparse <cards.json.gz> [--out file.md] [--grep regex] [--limit N]');
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const raw = readFileSync(input);
const db = JSON.parse((input.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8')) as CardDB;
const before = buildCoverage(db, 0).totals;
const t0 = Date.now();
const next = reparseDB(db);
const report = buildCoverage(next, 200);
const pct = (n: number) => `${((100 * n) / next.cards.length).toFixed(1)}%`;
console.log(`reparsed ${next.cards.length} cards in ${Date.now() - t0} ms`);
for (const k of ['full', 'partial', 'manual'] as const) {
  console.log(`  ${k.padEnd(8)} ${String(report.totals[k]).padStart(6)} ${pct(report.totals[k]).padStart(6)}  (was ${before[k]})`);
}
const lines = next.cards.flatMap((c) => c.faces.flatMap((f) => [...f.keywords.map(() => 1), ...f.abilities.map(() => 1)])).length;
const unparsed = next.cards.flatMap((c) => c.faces.flatMap((f) => f.unparsed)).length;
console.log(`  lines: ${lines} compiled, ${unparsed} unparsed`);

// The compiler/engine contract: only node tags the engine core handles (schema CORE_NODES).
const strays = new Map<string, number>();
for (const c of [...next.cards, ...next.tokens]) {
  for (const f of c.faces) {
    for (const a of faceAbilities(f)) {
      const tags = nodeTags(a);
      for (const k of ['effects', 'statics', 'triggers', 'costs', 'conditions'] as const) {
        for (const t of tags[k]) if (!(CORE_NODES[k] as readonly string[]).includes(t)) strays.set(`${k}:${t}`, (strays.get(`${k}:${t}`) ?? 0) + 1);
      }
    }
  }
}
if (strays.size) {
  console.error(`node tags outside CORE_NODES: ${[...strays].map(([t, n]) => `${t} ×${n}`).join(', ')}`);
  process.exitCode = 1;
}

const out = opt('--out');
if (out) writeFileSync(out, coverageMarkdown(report));
const grep = opt('--grep');
if (grep) {
  const re = new RegExp(grep);
  const limit = Number(opt('--limit') ?? 40);
  const hits = next.cards.flatMap((c) => c.faces.flatMap((f) => f.unparsed.filter((l) => re.test(l)).map((l) => `${c.name}: ${l}`)));
  console.log(`\n${hits.length} unparsed lines match /${grep}/`);
  for (const h of hits.slice(0, limit)) console.log('  ' + h);
}
