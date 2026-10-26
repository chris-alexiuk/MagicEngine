/**
 * Grammar to-do list at the sentence level: for every unparsed oracle line, tries each
 * sentence of its effect text on its own and ranks the sentence templates that fail.
 * Lines fail as a whole, so this shows which fragments block the most lines.
 *
 *   tsx scripts/fragments.ts <cards.json.gz> [top N]
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { CardDB } from '@mtg/schema';
import { defaultRegistry, normaliseSelf, reparseDB, stripAbilityWord, templateOf } from '../src/index.js';
import { Binder, type GrammarEnv } from '../src/grammar/binder.js';
import { parseEffectText } from '../src/grammar/effects.js';
const input = process.argv.slice(2).filter((a) => a !== '--');
const db = reparseDB(JSON.parse(gunzipSync(readFileSync(input[0]!)).toString()) as CardDB);
const counts = new Map<string, { n: number; ex: string[] }>();
let total = 0;
for (const c of db.cards) for (const f of c.faces) for (const raw of f.unparsed) {
  const ctx = { cardName: c.name, faceName: f.name, typeLine: f.typeLine, keywords: defaultRegistry.keywords };
  let line = normaliseSelf(stripAbilityWord(raw), ctx).replace(/[‘’]/g, "'");
  let body = line;
  const trig = /^(?:When|Whenever|At) [^,]+, (.+)$/.exec(line);
  const act = /^[^:]+: (.+)$/.exec(line);
  if (trig) body = trig[1]!;
  else if (act && !/^• /.test(line)) body = act[1]!;
  else if (/^• /.test(line)) body = line.slice(2);
  for (const s of body.split(/(?<=\.)\s+/)) {
    if (!s.endsWith('.')) continue;
    const b = new Binder(ctx as GrammarEnv);
    b.it = { ref: 'self' };
    const sent = s.replace(/^\w/, (x) => x.toUpperCase());
    if (parseEffectText(sent, b)) continue;
    total++;
    const t = templateOf(sent, c.name, f.name);
    const e = counts.get(t) ?? { n: 0, ex: [] };
    e.n++; if (e.ex.length < 2) e.ex.push(c.name);
    counts.set(t, e);
  }
}
console.log('failing sentences', total);
for (const [t, e] of [...counts].sort((a, b) => b[1].n - a[1].n).slice(0, Number(input[1] ?? 60))) console.log(String(e.n).padStart(5), t.slice(0, 140), '|', e.ex.join(', '));
