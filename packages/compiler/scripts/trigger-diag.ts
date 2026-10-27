/**
 * Diagnostics: which trigger conditions ("Whenever you commit a crime, …") the grammar can't read. For each
 * unparsed line that starts with When/Whenever/At, swap the effect for "draw a card." and see if the trigger
 * alone parses; count the ones that don't.
 *   tsx scripts/trigger-diag.ts <cards.json.gz> [--limit N]
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { CardDB } from '@mtg/schema';
import { defaultRegistry } from '../src/index.js';

const args = process.argv.slice(2).filter((a) => a !== '--');
const input = args[0]!;
const limit = Number(args[args.indexOf('--limit') + 1] ?? 60) || 60;
const raw = readFileSync(input);
const db = JSON.parse((input.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8')) as CardDB;
const counts = new Map<string, { n: number; example: string }>();
for (const c of db.cards) {
  if (c.automation === 'full') continue;
  for (const f of c.faces) {
    for (const line of f.unparsed) {
      const m = /^(?:[A-Z][A-Za-z' ]* — )?((?:When|Whenever|At) [^,]+?)(?:, if [^,]+)?, /.exec(line);
      if (!m) continue;
      const r = defaultRegistry.parse(`${m[1]}, draw a card.`, { cardName: c.name, faceName: f.name, typeLine: f.typeLine ?? '' });
      if (!r.unparsed.length) continue;
      const key = m[1]!.replaceAll(f.name, '~').replace(/\b\d+\b/g, 'N');
      const e = counts.get(key) ?? { n: 0, example: c.name };
      e.n++;
      counts.set(key, e);
    }
  }
}
for (const [k, v] of [...counts].sort((a, b) => b[1].n - a[1].n).slice(0, limit)) console.log(`${v.n}\t${k.slice(0, 120)}\t(${v.example})`);
