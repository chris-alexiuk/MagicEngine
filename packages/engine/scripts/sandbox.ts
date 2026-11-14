/**
 * Plays the cards of a compiled pool in the sandbox (scripts/lib/sandbox.ts), corrects the grades by what it finds,
 * and says what changed since the last time.
 *
 *   tsx scripts/sandbox.ts <cards.json.gz> [--top N] [--card NAME]... [--grade full|partial|manual] [--jobs N]
 *                          [--out checks.json.gz] [--baseline checks.json.gz] [--previous-pool cards.json.gz]
 *                          [--report changes.md] [--save regraded.json.gz | --save DIR]
 *                          [--full] [--plain] [--strict] [--allow-regrades N] [--commit SHA] [--trace] [--verbose]
 *   tsx scripts/sandbox.ts --compare old-checks.json.gz new-checks.json.gz [--report changes.md]
 *
 * With a --baseline, only the cards a change can have touched are played: those whose definition isn't what it was,
 * and those whose last play ran through code that isn't what it was (scripts/lib/impact.ts). The rest keep the
 * baseline's result. Without one — or when the change reaches code every play runs through — every card is played.
 *
 * --top N            only the N most-played cards (by EDHREC rank)
 * --card NAME        only this card, played whatever the baseline says, with what each run did (repeatable);
 *                    --trace adds every event
 * --grade G          only cards the compiler graded G
 * --jobs N           N processes side by side
 * --out              every card's result and fingerprint, and what its play ran through: what a later run compares with
 * --baseline         an earlier --out: which cards to play, and which cards' results or behaviour changed since
 * --previous-pool    the pool that --baseline was made from: which cards left the pool
 * --report           the comparison, as Markdown
 * --save             the pool with the grades corrected — a card with a certain problem isn't fully automatic. A file,
 *                    or a directory: cards.json.gz with its cards.meta.json, coverage.json and coverage.md
 * --full             play every card whatever the baseline says — and hold the baseline to it: a card that would
 *                    have kept its old result and plays differently is reported (with --strict, a failure)
 * --plain            the engine as it is, without the flags that note what a play runs through (nothing a later run
 *                    could go by is kept)
 * --strict           exit 1 if a card left the pool, if a card with no certain problem before has one now, or if more
 *                    cards stopped being fully automatic than --allow-regrades N (default 0)
 * --commit SHA       which commit this run is of (kept in --out; an allowance doesn't carry over to a later run of it)
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { automationOf, buildCoverage, coverageMarkdown } from '@mtg/compiler';
import type { Automation, CardDB, CardDBMeta, CardDef } from '@mtg/schema';
import { FORMAT, build, canScan, carry, pack, replay, sha, type Built, type Ground, type Replay, type Trail } from './lib/impact.js';
import type { Board, CardReport } from './lib/sandbox.js';

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

/** A card's result, with the grade the compiler gave it and how much it is played — and what its play ran through. */
type Row = CardReport & Trail & { grade: Automation; rank?: number };

export interface Checks {
  builtAt: string;
  /** The commit the engine and compiler were at (--commit). */
  commit?: string;
  cards: Record<string, Row>;
  /** What the plays ran through, kept with their results: what a later run goes by to say which cards to play again. */
  impact?: Ground;
  /** How many cards were played for this run (the rest kept an earlier run's result). */
  played?: number;
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

function markdown(c: Changes, now: Checks, before?: Checks, notes: string[] = []): string {
  const rows = Object.values(now.cards);
  const count = (cs: Checks) => Object.values(cs.cards).filter(fully).length;
  const out: string[] = ['# Card checks', ''];
  out.push(`${rows.length} cards checked in the sandbox, ${rows.reduce((n, r) => n + r.runs.length, 0)} runs.`);
  for (const note of notes) out.push('', note);
  if (notes.length) out.push('');
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
if (!poolPath || poolPath.startsWith('--')) throw new Error('usage: sandbox.ts <cards.json.gz> [--top N] [--card NAME] [--jobs N] [--out FILE] [--baseline FILE] [--report FILE] [--save FILE|DIR] [--full]');
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
const only = opt('--only') ? new Set(read<string[]>(opt('--only')!)) : undefined;
/** Without the flags: asked for, or this Node can't make the copy that has them. */
const bare = flag('--plain') || !canScan;
const worker = opt('--part');

let cards: CardDef[] = db.cards;
if (names.length) cards = cards.filter((c) => names.includes(c.name) || c.faces.some((f) => names.includes(f.name)));
if (grade) cards = cards.filter((c) => c.automation === grade);
if (top) {
  cards = [...cards]
    .filter((c) => c.rank !== undefined)
    .sort((a, b) => a.rank! - b.rank!)
    .slice(0, top);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
/** Where the copy of the code with a flag in every block goes. */
const COPY = resolve(HERE, '../.impact');

/** The code as it is, read into units — and its copy written out, for the plays to run. A job gets both from the process that started it. */
let code: Built | null = null;
if (!bare && !worker) {
  rmSync(COPY, { recursive: true, force: true });
  code = build(
    {
      list: (dir) => readdirSync(join(REPO, dir)),
      read: (path) => readFileSync(join(REPO, path), 'utf8'),
      write: (path, text) => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
      },
    },
    COPY,
  );
  writeFileSync(join(COPY, 'flags.json'), JSON.stringify({ flags: code.slots.length }));
}
const flagCount = bare ? 0 : (code?.slots.length ?? read<{ flags: number }>(join(COPY, 'flags.json')).flags);

const ART = new Set(['img', 'artist', 'backImg']);
const withoutArt = (k: string, v: unknown): unknown => (ART.has(k) ? undefined : v);
/** A hash of what of a card's definition its play can depend on: not its rank, its printing, where it is legal. */
function defHash(c: CardDef): string {
  const { rank: _rank, set: _set, rarity: _rarity, legal: _legal, gameChanger: _gc, aka: _aka, issues: _issues, automation: _grade, ...rest } = c;
  return sha(JSON.stringify(rest, withoutArt));
}
const dungeons = Object.fromEntries([...db.cards, ...db.tokens].filter((c) => c.faces[0]!.types.includes('Dungeon')).map((c) => [c.name, c]));

/** What one process played: each card's report, the flags its play set (packed as they are) and the registry names it missed. */
interface Part {
  reports: Record<string, CardReport>;
  flags: Record<string, string>;
  misses: Record<string, string[]>;
}

/** The engine loaded (its copy with the flags, unless --plain), the pool learned, the boards built. */
interface Stage {
  lib: typeof import('./lib/sandbox.js');
  boards: Board[];
  flags?: Uint8Array;
  missed: Set<string>;
  /** The flags set up to where the pool was learned, packed; the names missed before any card was played. */
  init?: string;
  initMiss: string[];
  /** The creature types the pool has. */
  types: string[];
}
let stage: Stage | undefined;
async function setStage(): Promise<Stage> {
  if (stage) return stage;
  const hooks = globalThis as { __u?: Uint8Array; __miss?: (key: string) => void };
  const flags = bare ? undefined : (hooks.__u = new Uint8Array(flagCount));
  const missed = new Set<string>();
  if (flags) hooks.__miss = (key) => missed.add(key);
  const lib = (await import(bare ? './lib/sandbox.js' : pathToFileURL(join(COPY, 'scripts/lib/sandbox.js')).href)) as typeof import('./lib/sandbox.js');
  const types = lib.prepare([...db.cards, ...db.tokens]);
  const init = flags ? pack(flags) : undefined;
  const boards = lib.buildBoards(dungeons);
  return (stage = { lib, boards, ...(flags ? { flags } : {}), missed, ...(init !== undefined ? { init } : {}), initMiss: [...missed], types });
}

async function playHere(list: CardDef[]): Promise<Part> {
  const { lib, boards, flags, missed } = await setStage();
  const part: Part = { reports: {}, flags: {}, misses: {} };
  for (const card of list) {
    flags?.fill(0);
    missed.clear();
    part.reports[card.id] = lib.checkCard(card, boards, { trace: flag('--trace') });
    if (!flags) continue;
    part.flags[card.id] = pack(flags);
    if (missed.size) part.misses[card.id] = [...missed];
  }
  return part;
}

const OWN = ['--jobs', '--out', '--baseline', '--previous-pool', '--report', '--save', '--allow-regrades', '--commit'];

/** One process per job, each on its share of the cards; their results are read back and merged. */
async function inJobs(jobs: number, list: CardDef[]): Promise<Part> {
  const self = fileURLToPath(import.meta.url);
  const pass = args.filter((a, i) => !OWN.includes(a) && !OWN.includes(args[i - 1] ?? '') && a !== '--strict' && a !== '--verbose' && a !== '--full');
  const stem = `${opt('--out') ?? join(process.env.TMPDIR ?? '/tmp', `sandbox-${process.pid}`)}`;
  const ids = `${stem}.ids.json`;
  write(ids, list.map((c) => c.id));
  const parts = await Promise.all(
    Array.from({ length: jobs }, (_, k) => {
      const out = `${stem}.part${k}.json`;
      return new Promise<Part>((done, failed) => {
        const child = spawn(process.execPath, [...process.execArgv, self, ...pass, '--only', ids, '--shard', `${k}/${jobs}`, '--part', out], { stdio: ['ignore', 'inherit', 'inherit'] });
        child.on('exit', (exit) => {
          if (exit !== 0) return failed(new Error(`sandbox job ${k} ended with code ${exit}`));
          const part = read<Part>(out);
          rmSync(out);
          done(part);
        });
      });
    }),
  );
  rmSync(ids);
  return {
    reports: Object.assign({}, ...parts.map((p) => p.reports)) as Part['reports'],
    flags: Object.assign({}, ...parts.map((p) => p.flags)) as Part['flags'],
    misses: Object.assign({}, ...parts.map((p) => p.misses)) as Part['misses'],
  };
}

if (worker) {
  const mine = cards.filter((c) => !only || only.has(c.id)).filter((_, i) => !shard || i % shard[1]! === shard[0]);
  write(worker, await playHere(mine));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Which cards to play
// ---------------------------------------------------------------------------

const usable = (path: string | undefined): path is string => Boolean(path && existsSync(path) && statSync(path).size > 0);
const baseline = opt('--baseline');
const before = usable(baseline) ? read<Checks>(baseline) : undefined;
/** The boards as this code builds them from the sandbox's own cards and the pool's dungeons: every play starts from one. */
const start = bare ? undefined : await setStage();
const boards = start ? sha(JSON.stringify([start.boards, start.types], withoutArt), 24) : '';
const tool = sha(readFileSync(fileURLToPath(import.meta.url), 'utf8') + readFileSync(join(HERE, 'lib/impact.ts'), 'utf8'));

interface Plan {
  play: CardDef[];
  /** The cards that keep the earlier run's result. */
  kept: Set<string>;
  /** The cards that would have kept it, when every card is played all the same (--full): what the earlier run is held to. */
  held?: Set<string>;
  /** For a person: how many cards are played again, and for what. */
  notes: string[];
}

function plan(): Plan {
  const everything = (why: string): Plan => ({ play: cards, kept: new Set(), notes: [`Every card was played: ${why}.`] });
  if (bare) return everything(canScan ? 'the engine ran without its flags (--plain)' : `this Node (${process.version}) can't make the copy of the engine that says what a play runs through`);
  if (!before) return everything('there is no earlier run to go by');
  const r: Replay = replay(
    before.impact,
    before.cards,
    cards.map((c) => ({ id: c.id, def: defHash(c) })),
    code!,
    { boards, tool },
  );
  const changes = r.decision?.why.length ? [`What changed in the code: ${r.decision.why.slice(0, 6).join('; ')}.`] : [];
  if (r.all) return { ...everything(r.all), notes: [`Every card was played: ${r.all}.`, ...changes] };
  const play = cards.filter((c) => !r.keep.has(c.id));
  const reasons = [
    ...(r.why.code ? [`${r.why.code} whose last play ran through code that changed`] : []),
    ...(r.why.registry ? [`${r.why.registry} that looked up a name the registry has now`] : []),
    ...(r.why.definition ? [`${r.why.definition} whose definition changed`] : []),
    ...(r.why.unseen ? [`${r.why.unseen} not checked before`] : []),
  ];
  const count = `${play.length} of ${cards.length} cards${reasons.length ? ` (${reasons.join('; ')})` : ''}`;
  if (flag('--full') || names.length) return { play: cards, kept: new Set(), held: r.keep, notes: [`Every card was played (asked for). Going by the run before, ${count} would have been.`, ...changes] };
  return { play, kept: r.keep, notes: [`Played again: ${count}. The rest keep the result of the run before.`, ...changes] };
}

const started = Date.now();
const todo = plan();
// (A job loads the pool and builds the boards again: for a few hundred cards that takes longer than it saves.)
const jobs = Math.max(1, Math.min(Number(opt('--jobs') ?? 1), Math.ceil(todo.play.length / 600)));
const fresh: Part = !todo.play.length ? { reports: {}, flags: {}, misses: {} } : jobs > 1 ? await inJobs(jobs, todo.play) : await playHere(todo.play);
const playSeconds = (Date.now() - started) / 1000;

// ---------------------------------------------------------------------------
// The results: what was played now, and what an earlier run found for the rest
// ---------------------------------------------------------------------------

const checks: Checks = { builtAt: new Date().toISOString(), ...(opt('--commit') ? { commit: opt('--commit')! } : {}), cards: {}, played: todo.play.length };
for (const card of cards) {
  const rest = { grade: card.automation, ...(card.rank !== undefined ? { rank: card.rank } : {}) };
  const report = fresh.reports[card.id];
  if (report) checks.cards[card.id] = { ...report, ...rest, def: defHash(card) };
  else if (todo.kept.has(card.id)) {
    const { u: _u, miss: _miss, ...row } = before!.cards[card.id]!;
    checks.cards[card.id] = { ...row, ...rest };
  }
}
if (code && start && Object.keys(checks.cards).length) {
  const kept = carry(before?.impact, before?.cards ?? {}, todo.kept, fresh, code);
  for (const [id, trail] of Object.entries(kept.trails)) Object.assign(checks.cards[id]!, trail);
  checks.impact = { format: FORMAT, slots: code.slots, twins: code.twins, files: code.files, registry: code.registry, init: start.init!, initMiss: start.initMiss, core: kept.core, misses: kept.misses, boards, tool };
}
if (opt('--out')) write(opt('--out')!, checks);

// An earlier run held to this one: a card that would have kept its result has to have played the same.
const misjudged = [...(todo.held ?? [])].filter((id) => fresh.reports[id] && fresh.reports[id]!.fp !== before!.cards[id]!.fp).map((id) => checks.cards[id]!);
if (todo.held) todo.notes.push(misjudged.length ? `**${misjudged.length} of the ${todo.held.size} cards that would have kept their result played differently: ${misjudged.sort(byRank).slice(0, 30).map((r) => r.name).join('; ')}.** What decides which cards to play again is wrong about them (scripts/lib/impact.ts).` : `All ${todo.held.size} cards that would have kept their result played as before.`);

// ---------------------------------------------------------------------------
// The pool with its grades corrected
// ---------------------------------------------------------------------------

/** What a card's page says is wrong: without which play found it. */
const plain = (issue: string): string => issue.replace(/^(?:from graveyard: )?(?:cast|play land|ability \d+|mana \d+|unlock \d+|foretell|plot|suspend|turn_face_up)[^:]*: /, '');
const save = opt('--save');
if (save) {
  for (const c of db.cards) {
    const r = checks.cards[c.id];
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
      ...(was?.printingsUpdatedAt ? { printingsUpdatedAt: was.printingsUpdatedAt } : {}),
      ...(was?.compiler ? { compiler: was.compiler } : {}),
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
console.log(`${rows.length} cards, ${todo.play.length} played in ${playSeconds.toFixed(0)} s (${(ms / Math.max(1, rows.length)).toFixed(1)} ms each when played), ${rows.reduce((n, r) => n + r.runs.length, 0)} runs`);
for (const note of todo.notes) console.log(note.replace(/\*\*/g, ''));
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

if (before) {
  const previous = opt('--previous-pool');
  const c = compare(before, checks, usable(previous) ? { before: read<CardDB>(previous), now: db } : undefined);
  if (opt('--report')) writeFileSync(opt('--report')!, markdown(c, checks, before, todo.notes));
  console.log(`\nSince the last run: ${c.lost.length} left the pool, ${c.regraded.length} no longer fully automatic, ${c.promoted.length} fully automatic now, ${c.broke.length} new problems, ${c.mended.length} problems gone, ${c.moved.length} played differently`);
  if (flag('--strict')) {
    // What a commit says it expects is for the run of that commit, not for a later run of the same code on newer card data.
    const allowed = before.commit !== undefined && before.commit === checks.commit ? 0 : Number(opt('--allow-regrades') ?? 0);
    const why = [
      ...(c.lost.length ? [`${c.lost.length} cards left the pool (${c.lost.slice(0, 8).join('; ')})`] : []),
      ...(c.broke.length ? [`${c.broke.length} cards have a certain problem they didn't have`] : []),
      ...(c.regraded.length > allowed ? [`${c.regraded.length} cards are no longer fully automatic, and ${allowed} were expected (a "Regrades: N" line in the commit message says how many are)`] : []),
      ...(misjudged.length ? [`${misjudged.length} cards that would have kept the last run's result played differently (${misjudged.slice(0, 8).map((r) => r.name).join('; ')}): what decides which cards to play again is wrong about them`] : []),
    ];
    if (why.length) {
      console.error(`\n::error::${why.join('; ')}`);
      process.exit(1);
    }
  }
} else if (opt('--report')) writeFileSync(opt('--report')!, markdown({ lost: [], regraded: [], promoted: [], broke: [], mended: [], moved: [] }, checks, undefined, todo.notes));
