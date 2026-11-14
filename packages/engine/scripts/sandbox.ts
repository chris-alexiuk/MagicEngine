/**
 * Plays every card of a compiled pool once in the sandbox (scripts/lib/sandbox.ts), corrects the grades by what it
 * finds, and says what changed since the last time.
 *
 *   tsx scripts/sandbox.ts <cards.json.gz> [--top N] [--card NAME]... [--grade full|partial|manual] [--jobs N]
 *                          [--out checks.json.gz] [--baseline checks.json.gz] [--previous-pool cards.json.gz]
 *                          [--report changes.md] [--save regraded.json.gz | --save DIR]
 *                          [--strict] [--allow-regrades N] [--commit SHA] [--trace] [--verbose]
 *   tsx scripts/sandbox.ts --compare old-checks.json.gz new-checks.json.gz [--report changes.md]
 *
 * --top N            only the N most-played cards (by EDHREC rank)
 * --card NAME        only this card, with what each run did (repeatable); --trace adds every event
 * --grade G          only cards the compiler graded G
 * --jobs N           N processes side by side
 * --out              every card's result and fingerprint, to compare a later run against
 * --baseline         an earlier --out: which cards' results or behaviour changed since
 * --previous-pool    the pool that --baseline was made from: which cards left the pool
 * --report           the comparison, as Markdown
 * --save             the pool with the grades corrected — a card with a certain problem isn't fully automatic. A file,
 *                    or a directory: cards.json.gz with its cards.meta.json, coverage.json and coverage.md
 * --strict           exit 1 if a card left the pool, if a card with no certain problem before has one now, or if more
 *                    cards stopped being fully automatic than --allow-regrades N (default 0)
 * --commit SHA       which commit this run is of (kept in --out; an allowance doesn't carry over to a later run of it)
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { automationOf, buildCoverage, coverageMarkdown } from '@mtg/compiler';
import type { Automation, CardDB, CardDBMeta, CardDef } from '@mtg/schema';
import { buildBoards, checkCard, type CardReport } from './lib/sandbox.js';

const args = process.argv.slice(2).filter((a) => a !== '--');
const flag = (name: string) => args.includes(name);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const all = (name: string): string[] => args.flatMap((a, i) => (a === name && args[i + 1] !== undefined ? [args[i + 1]!] : []));

const read = <T>(path: string): T => {
  const raw = readFileSync(path);
  return JSON.parse((raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw).toString('utf8')) as T;
};
const write = (path: string, value: unknown): void => {
  const json = Buffer.from(JSON.stringify(value));
  writeFileSync(path, path.endsWith('.gz') ? gzipSync(json) : json);
};

/** A card's result, with the grade the compiler gave it and how much it is played. */
type Row = CardReport & { grade: Automation; rank?: number };

export interface Checks {
  builtAt: string;
  /** The commit the engine and compiler were at (--commit). */
  commit?: string;
  cards: Record<string, Row>;
}

// ---------------------------------------------------------------------------
// What changed between two runs
// ---------------------------------------------------------------------------

interface Changes {
  /** In the earlier pool, not in this one. */
  lost: string[];
  /** Were fully automatic, aren't now: the name and why. */
  regraded: string[];
  /** Weren't fully automatic, are now. */
  promoted: string[];
  /** No certain problem before, one now (and not fully automatic before either). */
  broke: string[];
  /** A certain problem before, none now (and still not fully automatic). */
  mended: string[];
  /** Played differently than before (and not listed above). */
  moved: string[];
}

const byRank = (a: { rank?: number; name: string }, b: { rank?: number; name: string }) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.name.localeCompare(b.name);
const fully = (r: Row): boolean => r.grade === 'full' && !r.issues.length;

function compare(before: Checks, now: Checks, pools?: { before: CardDB; now: CardDB }): Changes {
  const c: Changes = { lost: [], regraded: [], promoted: [], broke: [], mended: [], moved: [] };
  if (pools) {
    const here = new Set(pools.now.cards.map((x) => x.id));
    c.lost = pools.before.cards
      .filter((x) => !here.has(x.id))
      .sort(byRank)
      .map((x) => x.name);
  }
  for (const r of Object.values(now.cards).sort(byRank)) {
    const was = before.cards[r.id];
    if (!was) continue;
    if (fully(was) && !fully(r)) c.regraded.push(`${r.name} — ${r.issues[0] ?? `the compiler reads less of it now (${r.grade})`}`);
    else if (!fully(was) && fully(r)) c.promoted.push(r.name);
    else if (!was.issues.length && r.issues.length) c.broke.push(`${r.name} — ${r.issues[0]}`);
    else if (was.issues.length && !r.issues.length) c.mended.push(r.name);
    else if (was.fp !== r.fp) {
      const i = r.runs.findIndex((run, k) => run.fp !== was.runs[k]?.fp);
      const run = r.runs[i];
      const old = was.runs[i];
      const what = !run
        ? was.runs.length > r.runs.length
          ? `no longer: ${was.runs[r.runs.length]!.label}`
          : 'what is noted about it changed'
        : !old
          ? `new: ${run.label} (${run.outcome})`
          : `${run.label}: ${old.label !== run.label ? `was ${old.label}` : old.outcome !== run.outcome ? `${old.outcome} → ${run.outcome}` : `[${old.did.slice(0, 2).join('; ')}] → [${run.did.slice(0, 2).join('; ')}]`}`;
      c.moved.push(`${r.name} — ${what}`);
    }
  }
  return c;
}

function markdown(c: Changes, now: Checks, before?: Checks): string {
  const rows = Object.values(now.cards);
  const count = (cs: Checks) => Object.values(cs.cards).filter(fully).length;
  const out: string[] = ['# Card checks', ''];
  out.push(`${rows.length} cards played in the sandbox, ${rows.reduce((n, r) => n + r.runs.length, 0)} runs.`);
  out.push(`Fully automatic: **${count(now)}**${before ? ` (was ${count(before)})` : ''}. With a certain problem: ${rows.filter((r) => r.issues.length).length}. To look at: ${rows.filter((r) => !r.issues.length && r.warnings.length).length}.`);
  const section = (title: string, list: string[], max: number) => {
    out.push('', `## ${title}: ${list.length}`);
    for (const line of list.slice(0, max)) out.push(`- ${line}`);
    if (list.length > max) out.push(`- … and ${list.length - max} more (most-played first)`);
  };
  section('Left the pool', c.lost, 60);
  section('No longer fully automatic', c.regraded, 80);
  section('Fully automatic now', c.promoted, 80);
  section('A certain problem that is new', c.broke, 60);
  section('A certain problem that is gone', c.mended, 60);
  section('Played differently than before', c.moved, 120);
  return `${out.join('\n')}\n`;
}

if (flag('--compare')) {
  const [a, b] = [args[args.indexOf('--compare') + 1], args[args.indexOf('--compare') + 2]];
  if (!a || !b) throw new Error('usage: sandbox.ts --compare old-checks.json.gz new-checks.json.gz [--report FILE]');
  const before = read<Checks>(a);
  const now = read<Checks>(b);
  const text = markdown(compare(before, now), now, before);
  if (opt('--report')) writeFileSync(opt('--report')!, text);
  console.log(text);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const poolPath = args[0];
if (!poolPath || poolPath.startsWith('--')) throw new Error('usage: sandbox.ts <cards.json.gz> [--top N] [--card NAME] [--jobs N] [--out FILE] [--baseline FILE] [--report FILE] [--save FILE|DIR]');
const db = read<CardDB>(poolPath);
// The grade the compiler gave: what a run on a pool already corrected by an earlier run starts from too.
for (const c of db.cards) {
  c.automation = automationOf(c.faces);
  delete c.issues;
}
const names = all('--card');
const top = Number(opt('--top') ?? 0);
const grade = opt('--grade');
const shard = opt('--shard')?.split('/').map(Number);

let cards: CardDef[] = db.cards;
if (names.length) cards = cards.filter((c) => names.includes(c.name) || c.faces.some((f) => names.includes(f.name)));
if (grade) cards = cards.filter((c) => c.automation === grade);
if (top) {
  cards = [...cards]
    .filter((c) => c.rank !== undefined)
    .sort((a, b) => a.rank! - b.rank!)
    .slice(0, top);
}
if (shard) cards = cards.filter((_, i) => i % shard[1]! === shard[0]);

const OWN = ['--jobs', '--out', '--baseline', '--previous-pool', '--report', '--save', '--allow-regrades', '--commit'];

/** One process per job, each on its share of the cards; their results are read back and merged. */
async function inJobs(jobs: number): Promise<Record<string, CardReport>> {
  const self = fileURLToPath(import.meta.url);
  const pass = args.filter((a, i) => !OWN.includes(a) && !OWN.includes(args[i - 1] ?? '') && a !== '--strict' && a !== '--verbose');
  const parts = await Promise.all(
    Array.from({ length: jobs }, (_, k) => {
      const out = `${opt('--out') ?? join(process.env.TMPDIR ?? '/tmp', `sandbox-${process.pid}`)}.part${k}.json`;
      return new Promise<Record<string, CardReport>>((resolve, reject) => {
        const child = spawn(process.execPath, [...process.execArgv, self, ...pass, '--shard', `${k}/${jobs}`, '--part', out], { stdio: ['ignore', 'inherit', 'inherit'] });
        child.on('exit', (code) => {
          if (code !== 0) return reject(new Error(`sandbox job ${k} ended with code ${code}`));
          const part = read<Record<string, CardReport>>(out);
          rmSync(out);
          resolve(part);
        });
      });
    }),
  );
  return Object.assign({}, ...parts) as Record<string, CardReport>;
}

function runHere(): Record<string, CardReport> {
  const dungeons = Object.fromEntries([...db.cards, ...db.tokens].filter((c) => c.faces[0]!.types.includes('Dungeon')).map((c) => [c.name, c]));
  const boards = buildBoards(dungeons);
  const out: Record<string, CardReport> = {};
  for (const card of cards) out[card.id] = checkCard(card, boards, { trace: flag('--trace') });
  return out;
}

const started = Date.now();
const jobs = Number(opt('--jobs') ?? 1);
const results = jobs > 1 && !shard ? await inJobs(jobs) : runHere();
if (opt('--part')) {
  write(opt('--part')!, results);
  process.exit(0);
}

const byId = new Map(db.cards.map((c) => [c.id, c]));
const checks: Checks = { builtAt: new Date().toISOString(), ...(opt('--commit') ? { commit: opt('--commit')! } : {}), cards: {} };
for (const [id, r] of Object.entries(results)) {
  const card = byId.get(id)!;
  checks.cards[id] = { ...r, grade: card.automation, ...(card.rank !== undefined ? { rank: card.rank } : {}) };
}
if (opt('--out')) write(opt('--out')!, checks);

// ---------------------------------------------------------------------------
// The pool with its grades corrected
// ---------------------------------------------------------------------------

/** What a card's page says is wrong: without which play found it. */
const plain = (issue: string): string => issue.replace(/^(?:from graveyard: )?(?:cast|play land|ability \d+|mana \d+|unlock \d+|foretell|plot|suspend|turn_face_up)[^:]*: /, '');
const save = opt('--save');
if (save) {
  for (const c of db.cards) {
    const r = results[c.id];
    if (!r?.issues.length) continue;
    c.issues = [...new Set(r.issues.map(plain))];
    if (c.automation === 'full') c.automation = 'partial';
  }
  if (existsSync(save) && statSync(save).isDirectory()) {
    const report = buildCoverage(db);
    const gz = gzipSync(JSON.stringify(db), { level: 9 });
    const metaPath = join(save, 'cards.meta.json');
    const was = existsSync(metaPath) ? read<CardDBMeta>(metaPath) : undefined;
    const meta: CardDBMeta = {
      schema: db.schema,
      builtAt: db.builtAt,
      ...(was?.sourceUpdatedAt ? { sourceUpdatedAt: was.sourceUpdatedAt } : {}),
      cardCount: db.cards.length,
      tokenCount: db.tokens.length,
      bytes: gz.length,
      sha256: createHash('sha256').update(gz).digest('hex'),
      coverage: report.totals,
    };
    writeFileSync(join(save, 'cards.json.gz'), gz);
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    writeFileSync(join(save, 'coverage.json'), JSON.stringify(report, null, 2));
    writeFileSync(join(save, 'coverage.md'), coverageMarkdown(report));
  } else write(save, db);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const rows = Object.values(checks.cards);
/** A problem without what is particular to the card, so that the same problem on many cards counts once. */
const kind = (text: string): string =>
  plain(text)
    .replace(/"[^"]*"/g, '"…"')
    .replace(/\b\d+\b/g, 'N')
    .replace(/\((?!…)[^)]*\)/g, '(…)')
    .slice(0, 120);
const tally = (pick: (r: Row) => string[], only: (r: Row) => boolean): [string, Row[]][] => {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    if (!only(r)) continue;
    for (const k of new Set(pick(r).map(kind))) groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups].sort((a, b) => b[1].length - a[1].length);
};
const mostPlayed = (rs: Row[]): string =>
  rs
    .sort(byRank)
    .slice(0, 5)
    .map((r) => r.name)
    .join(', ');

const ms = rows.reduce((n, r) => n + r.ms, 0);
console.log(`${rows.length} cards in ${((Date.now() - started) / 1000).toFixed(0)} s (${(ms / Math.max(1, rows.length)).toFixed(1)} ms each), ${rows.reduce((n, r) => n + r.runs.length, 0)} runs`);
for (const g of ['full', 'partial', 'manual'] as const) {
  const of = rows.filter((r) => r.grade === g);
  if (of.length) console.log(`  read ${g === 'full' ? 'in full' : g === 'partial' ? 'in part' : 'not at all'}: ${String(of.length).padStart(6)} cards, ${of.filter((r) => r.issues.length).length} with a certain problem, ${of.filter((r) => !r.issues.length && r.warnings.length).length} more to look at`);
}
const listing = (title: string, groups: [string, Row[]][], max: number) => {
  if (!groups.length) return;
  console.log(`\n${title}`);
  for (const [k, rs] of groups.slice(0, max)) console.log(`  ${String(rs.length).padStart(5)}  ${k}\n         ${mostPlayed(rs)}`);
  if (groups.length > max) console.log(`  … and ${groups.length - max} more kinds`);
};
const readInFull = (r: Row) => r.grade === 'full';
const verbose = flag('--verbose');
listing('Certain problems, cards read in full:', tally((r) => r.issues, readInFull), verbose ? 300 : 25);
listing('To look at, cards read in full:', tally((r) => r.warnings, readInFull), verbose ? 300 : 15);
listing('Certain problems, other cards:', tally((r) => r.issues, (r) => !readInFull(r)), verbose ? 300 : 12);
if (verbose) listing('Notes, cards read in full:', tally((r) => r.notes.map((n) => n.replace(/\(([^)]*)\)$/, '— $1')), readInFull), 60);

if (names.length) {
  for (const r of rows) {
    console.log(`\n${r.name} [${r.grade}] ${r.fp} (${r.ms} ms)`);
    for (const run of r.runs) {
      console.log(`  ${run.label} — ${run.board}: ${run.outcome}${run.zone ? `, ends in ${run.zone}` : ''}`);
      for (const d of run.did) console.log(`      ${d}`);
      for (const t of run.trace ?? []) console.log(`        · ${t.length > 230 ? `${t.slice(0, 227)}…` : t}`);
    }
    for (const i of r.issues) console.log(`  PROBLEM  ${i}`);
    for (const w of r.warnings) console.log(`  look at  ${w}`);
    for (const n of r.notes) console.log(`  note     ${n}`);
  }
}

// ---------------------------------------------------------------------------
// Against the last run
// ---------------------------------------------------------------------------

const usable = (path: string | undefined): path is string => Boolean(path && existsSync(path) && statSync(path).size > 0);
const baseline = opt('--baseline');
if (usable(baseline)) {
  const before = read<Checks>(baseline);
  const previous = opt('--previous-pool');
  const c = compare(before, checks, usable(previous) ? { before: read<CardDB>(previous), now: db } : undefined);
  if (opt('--report')) writeFileSync(opt('--report')!, markdown(c, checks, before));
  console.log(`\nSince the last run: ${c.lost.length} left the pool, ${c.regraded.length} no longer fully automatic, ${c.promoted.length} fully automatic now, ${c.broke.length} new problems, ${c.mended.length} problems gone, ${c.moved.length} played differently.`);
  if (flag('--strict')) {
    // What a commit says it expects is for the run of that commit, not for a later run of the same code on newer card data.
    const allowed = before.commit !== undefined && before.commit === checks.commit ? 0 : Number(opt('--allow-regrades') ?? 0);
    const why = [
      ...(c.lost.length ? [`${c.lost.length} cards left the pool (${c.lost.slice(0, 8).join('; ')})`] : []),
      ...(c.broke.length ? [`${c.broke.length} cards have a certain problem they didn't have`] : []),
      ...(c.regraded.length > allowed ? [`${c.regraded.length} cards are no longer fully automatic, and ${allowed} were expected (a "Regrades: N" line in the commit message says how many are)`] : []),
    ];
    if (why.length) {
      console.error(`\n::error::${why.join('; ')}`);
      process.exit(1);
    }
  }
} else if (opt('--report')) writeFileSync(opt('--report')!, markdown({ lost: [], regraded: [], promoted: [], broke: [], mended: [], moved: [] }, checks));
