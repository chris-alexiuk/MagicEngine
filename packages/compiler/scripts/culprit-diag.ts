/**
 * Diagnostics for grammar work, in context: for each card with exactly one unparsed line, parse the
 * line's first k sentences for k = 1, 2, … and report the sentence where it first stops parsing.
 * Templates that span sentences ("Look at the top N cards … Put the rest …") show up as their first
 * sentence; the next one is printed alongside for context.
 *   tsx scripts/culprit-diag.ts <cards.json.gz> [--limit N] [--grep REGEX]
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { CardDB } from '@mtg/schema';
import { defaultRegistry } from '../src/index.js';

const args = process.argv.slice(2).filter((a) => a !== '--');
const input = args[0]!;
const limit = Number(args[args.indexOf('--limit') + 1] ?? 80) || 80;
const grepAt = args.indexOf('--grep');
const grep = grepAt >= 0 ? new RegExp(args[grepAt + 1]!) : null;
const raw = readFileSync(input);
const db = JSON.parse((input.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8')) as CardDB;
const counts = new Map<string, { n: number; example: string; next: string }>();
const norm = (s: string, name: string) =>
  s
    .replaceAll(name, '~')
    .replace(/\b\d+\b/g, 'N')
    .replace(/\b(?:one|two|three|four|five|six|seven)\b/g, 'N');
for (const c of db.cards) {
  if (c.automation === 'full') continue;
  const lines = c.faces.flatMap((f) => f.unparsed.map((l) => ({ l, f })));
  if (lines.length !== 1) continue;
  const { l: line, f: face } = lines[0]!;
  const sentences = line.split(/(?<=\.)\s+(?=[A-Z•])/);
  let culprit = sentences.length - 1;
  for (let k = 1; k <= sentences.length; k++) {
    const text = sentences.slice(0, k).join(' ');
    const r = defaultRegistry.parse(text, { cardName: c.name, faceName: face.name, typeLine: face.typeLine ?? c.faces[0]!.typeLine ?? '' });
    if (r.unparsed.length) {
      culprit = k - 1;
      break;
    }
  }
  const key = norm(sentences[culprit]!, face.name);
  if (grep && !grep.test(key)) continue;
  const e = counts.get(key) ?? { n: 0, example: c.name, next: sentences[culprit + 1] ? norm(sentences[culprit + 1]!, face.name) : '' };
  e.n++;
  counts.set(key, e);
}
for (const [k, v] of [...counts].sort((a, b) => b[1].n - a[1].n).slice(0, limit)) {
  console.log(`${v.n}\t${k.slice(0, 140)}${v.next ? `  ⟶ ${v.next.slice(0, 70)}` : ''}\t(${v.example})`);
}
