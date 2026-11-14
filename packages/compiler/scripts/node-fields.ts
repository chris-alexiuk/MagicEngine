/**
 * The table of every parameter the compiler puts on each kind of node (schema NODE_FIELDS), checked against a compiled
 * card DB or written from one:
 *
 *   tsx scripts/node-fields.ts <cards.json.gz>            what the pool uses that isn't declared, and the reverse
 *   tsx scripts/node-fields.ts <cards.json.gz> --write    rewrite packages/schema/src/node-fields.ts from the pool
 *
 * The pool is reparsed with this checkout's grammar first (pass --as-is for one that already is).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { NODE_FIELDS, nodeFields, type CardDB } from '@mtg/schema';
import { reparseDB } from '../src/index.js';

const args = process.argv.slice(2).filter((a) => a !== '--');
const input = args[0];
if (!input) throw new Error('usage: node-fields.ts <cards.json.gz> [--write] [--as-is]');
const raw = readFileSync(input);
const parsed = JSON.parse((raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw).toString('utf8')) as CardDB;
const db = args.includes('--as-is') ? parsed : reparseDB(parsed);

/** type → field → the cards that use it. */
const used = new Map<string, Map<string, string[]>>();
for (const card of [...db.cards, ...db.tokens]) {
  for (const [type, fields] of nodeFields(card)) {
    const of = used.get(type) ?? used.set(type, new Map()).get(type)!;
    for (const f of fields) (of.get(f) ?? of.set(f, []).get(f)!).push(card.name);
  }
}

if (args.includes('--write')) {
  const lines = [...used].sort(([a], [b]) => a.localeCompare(b)).map(([type, fields]) => `  ${/^[a-z_][a-z0-9_]*$/i.test(type) ? type : JSON.stringify(type)}: [${[...fields.keys()].sort().map((f) => `'${f}'`).join(', ')}],`);
  const file = fileURLToPath(new URL('../../schema/src/node-fields.ts', import.meta.url));
  const src = readFileSync(file, 'utf8');
  const start = src.indexOf('export const NODE_FIELDS');
  const end = src.indexOf('\n};', start);
  if (start < 0 || end < 0) throw new Error('node-fields.ts has no NODE_FIELDS table to replace');
  writeFileSync(file, `${src.slice(0, start)}export const NODE_FIELDS: Readonly<Record<string, readonly string[]>> = {\n${lines.join('\n')}${src.slice(end)}`);
  console.log(`wrote ${used.size} kinds of node, ${[...used.values()].reduce((n, f) => n + f.size, 0)} parameters`);
  process.exit(0);
}

const undeclared: string[] = [];
for (const [type, fields] of used) {
  for (const [f, cards] of fields) if (!NODE_FIELDS[type]?.includes(f)) undeclared.push(`${type}.${f} — ${cards.length} card${cards.length === 1 ? '' : 's'} (${[...new Set(cards)].slice(0, 3).join('; ')})`);
}
const unused = Object.entries(NODE_FIELDS).flatMap(([type, fields]) => fields.filter((f) => !used.get(type)?.has(f)).map((f) => `${type}.${f}`));
console.log(`${used.size} kinds of node, ${[...used.values()].reduce((n, f) => n + f.size, 0)} parameters in the pool`);
if (unused.length) console.log(`declared and no longer used by any card (remove them from NODE_FIELDS): ${unused.join(', ')}`);
if (undeclared.length) {
  console.error(`parameters the compiler writes that NODE_FIELDS doesn't declare:\n  ${undeclared.sort().join('\n  ')}`);
  console.error('Declare each in packages/schema/src/node-fields.ts — after asking whether a filter, an amount or a condition would say the same thing.');
  process.exit(1);
}
