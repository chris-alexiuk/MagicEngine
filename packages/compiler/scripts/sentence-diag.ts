/**
 * Diagnostics for grammar work: which effect sentences fail most often? Takes each unparsed line of
 * cards with exactly one unparsed line, strips a trigger ("When …, ") or cost ("…: ") prefix, splits
 * it into sentences and parses each alone as a sorcery's text. Pronouns lose their antecedents, so
 * some failures are artefacts; the counts still point at missing templates.
 *   tsx scripts/sentence-diag.ts <cards.json.gz> [--limit N]
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { CardDB } from '@mtg/schema';
import { defaultRegistry } from '../src/index.js';

const args = process.argv.slice(2).filter((a) => a !== '--');
const input = args[0]!;
const limit = Number(args[args.indexOf('--limit') + 1] ?? 80) || 80;
const raw = readFileSync(input);
const db = JSON.parse((input.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8')) as CardDB;
const counts = new Map<string, { n: number; example: string }>();
for (const c of db.cards) {
  if (c.automation === 'full') continue;
  const lines = c.faces.flatMap((f) => f.unparsed);
  if (lines.length !== 1) continue;
  let line = lines[0]!.replace(/^[A-Z][A-Za-z' ]* — /, '');
  line = line.replace(/^(?:When|Whenever|At) [^,]+, /, '');
  const colon = line.indexOf(': ');
  if (colon > 0 && colon < 60 && !line.slice(0, colon).includes('.')) line = line.slice(colon + 2);
  for (const raw of line.split(/(?<=\.)\s+(?=[A-Z])/)) {
    let s = raw.trim();
    if (!s) continue;
    s = s.replace(/^(?:Then|Otherwise),? /, '');
    s = s.charAt(0).toUpperCase() + s.slice(1);
    if (!s.endsWith('.')) s += '.';
    const r = defaultRegistry.parse(s, { cardName: c.name, faceName: c.faces[0]!.name, typeLine: 'Sorcery' });
    if (!r.unparsed.length) continue;
    const key = s.replace(c.faces[0]!.name, '~').replace(/\b\d+\b/g, 'N');
    const e = counts.get(key) ?? { n: 0, example: c.name };
    e.n++;
    counts.set(key, e);
  }
}
for (const [k, v] of [...counts].sort((a, b) => b[1].n - a[1].n).slice(0, limit)) console.log(`${v.n}\t${k.slice(0, 150)}\t(${v.example})`);
