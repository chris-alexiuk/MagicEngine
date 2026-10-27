/**
 * Diagnostics for grammar work: for unparsed lines with a granted quoted ability, does the quoted
 * text parse on its own? Splits "the grant is the problem" from "the inner ability is".
 *   tsx scripts/quotes-diag.ts <cards.json.gz>
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { CardDB } from '@mtg/schema';
import { defaultRegistry } from '../src/index.js';

const input = process.argv.slice(2).filter((a) => a !== '--')[0]!;
const raw = readFileSync(input);
const db = JSON.parse((input.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8')) as CardDB;
const ok: string[] = [];
const bad: string[] = [];
for (const c of db.cards) {
  if (c.automation === 'full') continue;
  for (const f of c.faces) {
    for (const line of f.unparsed) {
      for (const m of line.matchAll(/(?:has|have|gains?) "([^"]+)"/g)) {
        const inner = m[1]!.replace(/[.,]$/, '') + '.';
        const r = defaultRegistry.parse(inner, { cardName: 'Granted', faceName: 'Granted', typeLine: 'Creature — Test' });
        (r.unparsed.length || r.manualKeywords.length ? bad : ok).push(`${c.name} :: ${line.slice(0, 140)} :: [${inner.slice(0, 100)}]`);
      }
    }
  }
}
console.log(`inner parses: ${ok.length}, inner fails: ${bad.length}`);
console.log('--- inner parses (the grant is the problem):');
for (const l of ok.slice(0, 60)) console.log(l);
