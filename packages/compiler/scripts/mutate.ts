/**
 * How well the grammar copes with wording it hasn't seen: take lines it reads, change one thing that shouldn't matter
 * to it — a number, a color, a creature type, how long an effect lasts — and count how many it still reads.
 *
 *   tsx scripts/mutate.ts <cards.json.gz> [per-kind=1500] [failures.json] [--check | --update [--allow-worse]]
 *
 * Near 100% for a kind of change means that part of a sentence is read by a shared piece; lower means some patterns
 * spell that part out (the failures are those patterns' lines). Some changed lines aren't Magic ("if you don't control
 * seven or more permanents"): read the failures before the number.
 *
 * The lines are taken in an order that doesn't depend on the pool (by a hash of the line), so two pools are measured
 * on nearly the same lines. --update writes the scores to instruments.json; --check (CI) fails if a kind reads more
 * than SLACK points fewer of its lines than that — a shared reader made narrower. --update refuses to record such a
 * fall too, unless --allow-worse says it is known.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { byHand } from '@mtg/schema';
import { ParserRegistry } from '../src/parser.js';
import { reparseDB } from '../src/compile.js';

const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--') && a !== '--'));
const [poolPath, perArg, outPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const PER = Number(perArg ?? 1500);
/** How far below its recorded score a kind may read before --check fails, in points. */
const SLACK = 1.5;
type Face = { name: string; oracle: string; typeLine: string; manaCost: string; unparsed: string[] };
const db = JSON.parse(gunzipSync(readFileSync(poolPath!)).toString('utf8')) as { cards: { name: string; automation: unknown; faces: Face[] }[]; tokens: unknown[] };
reparseDB({ ...db, cards: db.cards.map((c) => ({ ...c, faces: c.faces.map((f) => ({ ...f, oracle: '' })) })), tokens: [] } as never);
const registry = new ParserRegistry();


const WORDS: Record<string, string> = { two: 'three', three: 'four', four: 'five', five: 'six' };
const COLORS: Record<string, string> = { white: 'blue', blue: 'black', black: 'red', red: 'green', green: 'white' };
const KEYWORDS: Record<string, string> = { flying: 'trample', trample: 'flying', haste: 'vigilance', vigilance: 'haste', lifelink: 'deathtouch', deathtouch: 'lifelink', menace: 'reach', hexproof: 'indestructible' };
const TYPES: Record<string, string> = { Elf: 'Goblin', Goblin: 'Zombie', Zombie: 'Vampire', Vampire: 'Elf', Human: 'Merfolk', Soldier: 'Wizard', Wizard: 'Soldier', Dragon: 'Angel', Angel: 'Dragon' };
/** Each: what it changes; a line it applies to gives the changed line (null: nothing to change). Text in quotes and reminder text are left alone. */
const MUTATIONS: Record<string, (l: string) => string | null> = {
  'a number (3 damage → 4 damage)': (l) => (/(?<![{+\-/\d])\b([2-9])\b(?![}/])(?= (?:damage|life|cards?\b))/.test(l) ? l.replace(/(?<![{+\-/\d])\b([2-9])\b(?![}/])(?= (?:damage|life|cards?\b))/, (d) => String(Number(d) + 1)) : null),
  'a number word (two → three)': (l) => (/\b(two|three|four|five)\b/.test(l) ? l.replace(/\b(two|three|four|five)\b/, (w) => WORDS[w]!) : null),
  'a bonus (+1/+1 → +2/+2 until end of turn)': (l) => (/gets? \+1\/\+1 until/.test(l) ? l.replace(/(gets?) \+1\/\+1 until/, '$1 +2/+2 until') : null),
  'a mana amount ({2} → {3})': (l) => (/\{[2-5]\}/.test(l) ? l.replace(/\{([2-5])\}/, (_m, d) => `{${Number(d) + 1}}`) : null),
  'a color (red → green)': (l) => (/\b(white|blue|black|red|green)\b(?! mana)/.test(l) ? l.replace(/\b(white|blue|black|red|green)\b(?! mana)/, (w) => COLORS[w]!) : null),
  'a keyword (flying → trample)': (l) => (/\b(flying|trample|haste|vigilance|lifelink|deathtouch|menace|hexproof)\b/.test(l) && !/^(?:Flying|Trample|Haste)/.test(l) ? l.replace(/\b(flying|trample|haste|vigilance|lifelink|deathtouch|menace|hexproof)\b/, (w) => KEYWORDS[w]!) : null),
  'a creature type (Elf → Goblin)': (l) => (/\b(Elf|Goblin|Zombie|Vampire|Human|Soldier|Wizard|Dragon|Angel)s?\b/.test(l) ? l.replace(/\b(Elf|Goblin|Zombie|Vampire|Human|Soldier|Wizard|Dragon|Angel)\b/, (w) => TYPES[w]!).replace(/\bElfs\b/, 'Elves') : null),
  'a card type (artifact → enchantment)': (l) => (/\bartifacts?\b/.test(l) && !/artifact creature|artifact land/.test(l) ? l.replace(/\bartifact(s?)\b/, 'enchantment$1') : null),
  'whose (you control → you don\'t control)': (l) => (/ you control\b/.test(l) ? l.replace(/ you control\b/, " you don't control") : null),
  'which player (each opponent → each player)': (l) => (/\b(each|target) opponent\b/.test(l) ? l.replace(/\b(each|target) opponent\b/, '$1 player') : null),
  'how long (until end of turn → until your next turn)': (l) => (/ until end of turn/.test(l) ? l.replace(/ until end of turn/, ' until your next turn') : null),
  'a counter (+1/+1 counter → -1/-1 counter)': (l) => (/\+1\/\+1 counters?\b/.test(l) ? l.replace(/\+1\/\+1 (counters?)\b/, '-1/-1 $1') : null),
  'optional (… → you may …)': (l) => (/^(When|Whenever|At) [^,]+, (draw|create|put|return|destroy|exile|untap|tap) /.test(l) && !/you may/.test(l) ? l.replace(/^((?:When|Whenever|At) [^,]+, )([a-z])/, (_m, a, b) => `${a}you may ${b}`) : null),
  'a trigger\'s condition (…, do X → …, if you control a creature, do X)': (l) => (/^(When|Whenever) [^,]+, [a-z]/.test(l) && !/, if /.test(l) ? l.replace(/^((?:When|Whenever) [^,]+, )/, '$1if you control an artifact, ') : null),
};

const reads = (line: string, f: Face, cardName: string): boolean => {
  try {
    const p = registry.parse(line, { cardName, faceName: f.name, typeLine: f.typeLine, manaCost: f.manaCost });
    // (Read by the grammar: not with a sentence left to the player, which is what happens to one it can't read.)
    return p.unparsed.length === 0 && p.manualKeywords.length === 0 && p.abilities.length + p.keywords.length > 0 && byHand(p.abilities).length === 0;
  } catch {
    return false;
  }
};

// Lines of fully automatic cards that read on their own, in an order the pool has no say in: by a hash of the line.
const lines: { line: string; f: Face; card: string; key: string }[] = [];
for (const c of db.cards.filter((c) => c.automation === 'full')) {
  for (const f of c.faces) {
    for (const line of f.oracle.split('\n')) {
      if (!line || line.length > 260 || /^[•IVX]|—$|"/.test(line) || f.unparsed.includes(line)) continue;
      lines.push({ line: line.replace(/ ?\([^)]*\)/g, '').trim(), f, card: c.name, key: createHash('sha256').update(`${c.name}\n${line}`).digest('hex') });
    }
  }
}
lines.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
const out: Record<string, { tried: number; read: number; failures: { card: string; was: string; now: string }[] }> = {};
for (const [name, mutate] of Object.entries(MUTATIONS)) {
  const o = (out[name] = { tried: 0, read: 0, failures: [] as { card: string; was: string; now: string }[] });
  for (const { line, f, card } of lines) {
    if (o.tried >= PER) break;
    const now = line ? mutate(line) : null;
    if (!now || now === line || !reads(line, f, card)) continue;
    o.tried++;
    if (reads(now, f, card)) o.read++;
    else if (o.failures.length < 400) o.failures.push({ card, was: line, now });
  }
  console.log(`${String(o.read).padStart(5)} / ${String(o.tried).padEnd(5)} ${(100 * o.read / Math.max(1, o.tried)).toFixed(1).padStart(5)}%  ${name}`);
}
if (outPath) writeFileSync(outPath, JSON.stringify(out));

// The scores on record (instruments.json, beside this package's source).
if (flags.has('--check') || flags.has('--update')) {
  const file = fileURLToPath(new URL('../instruments.json', import.meta.url));
  const instruments = (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}) as { mutation?: { per: number; kinds: Record<string, number> }; [k: string]: unknown };
  // (A pool smaller than this isn't the card pool: the sample the web app is built against in CI is a few dozen cards.)
  if (db.cards.length < 20000) throw new Error(`the wording test is scored on the full card pool; this one has ${db.cards.length} cards (pnpm cards:build, or cards.json.gz from the reports branch)`);
  const now = Object.fromEntries(Object.entries(out).map(([k, o]) => [k, Math.round((1000 * o.read) / Math.max(1, o.tried)) / 10]));
  const was = instruments.mutation;
  const worse = was && was.per === PER ? Object.entries(was.kinds).filter(([k, score]) => (now[k] ?? 0) < score - SLACK) : [];
  const fall = `The grammar reads fewer changed lines than on record:\n${worse.map(([k, score]) => `  ${k}: ${now[k] ?? 0}% (was ${score}%)`).join('\n')}`;
  if (flags.has('--update')) {
    if (worse.length && !flags.has('--allow-worse')) {
      console.error(`\n${fall}\nA shared reader was made narrower (the failures say which lines: pass a file name to see them) — or record the fall knowingly: mutate.ts <pool> ${PER} --update --allow-worse.`);
      process.exit(1);
    }
    instruments.mutation = { per: PER, kinds: now };
    writeFileSync(file, `${JSON.stringify(instruments, null, 1)}\n`);
    console.log('wording scores on record');
  } else {
    if (!was) throw new Error('packages/compiler/instruments.json has no wording scores: run `pnpm grammar:update` with the full card pool and commit it');
    if (was.per !== PER) throw new Error(`instruments.json was written with ${was.per} lines a kind; this run takes ${PER}`);
    if (worse.length) {
      console.error(`\n${fall}`);
      process.exit(1);
    }
    console.log(`wording test: no kind more than ${SLACK} points below its score on record`);
  }
}
