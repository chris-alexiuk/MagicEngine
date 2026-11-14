/**
 * Robustness check: random bots play many games with random decks drawn from the
 * real card pool, and every action is checked.
 *
 *   tsx scripts/fuzz.ts <cards.json.gz> [--games N] [--seed S] [--players 2|3|4] [--verbose] [--top] [--focus REGEX]
 *
 * --top lists the sources of the most triggers and tokens (to spot runaway loops).
 * --focus fills about half of each deck with cards whose text matches REGEX (to exercise a new mechanic).
 *
 * Failures reported:
 *   - crash:     the engine threw something other than a rules error
 *   - rejected:  legalActions() offered an action that apply() then refused
 *   - invariant: the state broke a structural invariant after an action
 * Exit code 1 if anything failed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { reparseDB } from '@mtg/compiler';
import type { CardDB, CardDef, Color } from '@mtg/schema';
import { apply, createGame, legalActions, type Action, type GameState } from '../src/index.js';
import { checkInvariants, createBot } from './lib/bot.js';

const args = process.argv.slice(2).filter((a) => a !== '--');
const opt = (name: string, d: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1]! : d;
};
const dbPath = args[0];
if (!dbPath) throw new Error('usage: fuzz.ts <cards.json.gz> [--games N] [--seed S] [--players N]');
const GAMES = Number(opt('--games', '40'));
let lastSizes = '';
const SEED = Number(opt('--seed', '1'));
const PLAYERS = opt('--players', 'mixed');
const VERBOSE = args.includes('--verbose');
const TOP = args.includes('--top');
const FOCUS = args.includes('--focus') ? new RegExp(opt('--focus', '')) : null;
/** `--format commander`: each deck gets a legendary creature of its colors as its commander (the command zone, the tax, CR 903.9). */
const FORMAT = opt('--format', 'constructed') as 'commander' | 'constructed';
/** `--as-is`: the pool was compiled by this checkout's compiler already (a reparse's `--save`), so it isn't compiled again. */
const AS_IS = args.includes('--as-is');
let commanderCasts = 0;
let commanderPrompts = 0;
const bySource = new Map<string, number>();

let raw = readFileSync(dbPath);
if (raw[0] === 0x1f && raw[1] === 0x8b) raw = gunzipSync(raw);
const parsed = JSON.parse(raw.toString('utf8')) as CardDB;
const db = AS_IS ? parsed : reparseDB(parsed);

// Small deterministic RNG for the bots (separate from the engine's).
let s = SEED >>> 0;
const rnd = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const { answerFor, randomiseTargets, pick, shuffle } = createBot({ rnd });

// ---------------------------------------------------------------------------
// Decks: two colors, basics plus random spells the engine can mostly run
// ---------------------------------------------------------------------------

const BASICS: Record<Color, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
const byName = new Map(db.cards.map((c) => [c.name, c]));
const pool = db.cards.filter((c) => {
  const f = c.faces[0]!;
  if (f.types.includes('Land') || c.cmc > 6 || c.automation === 'manual') return false;
  if (!c.legal.commander && !c.legal.legacy) return false;
  if (/\{[^}]*(?:P|S|H|\d\/[WUBRG]|C\/)[^}]*\}/.test(f.manaCost) || /\{X\}/.test(f.manaCost)) return false;
  // CR 712.4: meld cards, but not the combined back faces (no mana cost; never cast).
  if (c.layout === 'meld') return f.manaCost !== '';
  return ['normal', 'split', 'adventure', 'transform', 'modal_dfc', 'prepare'].includes(c.layout);
});
// CR 712.5: each meld card's counterpart (from the meld ability's linked pair), so a deck with one has the other.
const meldPartner = new Map<string, string>();
for (const c of db.cards) {
  if (c.layout !== 'meld') continue;
  const nodes = JSON.stringify(c.faces.map((f) => f.abilities)).match(/"type":"meld","into":"[^"]*","partner":"([^"]*)"/g) ?? [];
  for (const m of nodes) {
    const partner = /"partner":"([^"]*)"/.exec(m)![1]!;
    meldPartner.set(c.name, partner);
    meldPartner.set(partner, c.name);
  }
}
// CR 309.2: the dungeons (and Undercity, a token-sized card) players can venture into.
const DUNGEONS: Record<string, CardDef> = Object.fromEntries(
  [...db.cards, ...db.tokens].filter((c) => c.faces[0]!.types.includes('Dungeon')).map((c) => [c.name, c]),
);
// A card's name or any face's name or text; lands can be focused on too (the random part of a deck has none).
const focusable = (c: CardDef) => FOCUS!.test(c.name) || c.faces.some((f) => FOCUS!.test(f.name) || FOCUS!.test(f.oracle));
const focusPool = FOCUS
  ? db.cards.filter((c) => (pool.includes(c) || (c.faces[0]!.types.includes('Land') && c.automation !== 'manual' && !c.faces[0]!.types.includes('Creature'))) && focusable(c))
  : [];
if (FOCUS) console.log(`focus: ${focusPool.length} cards`);

function makeDeck(colors: Color[]): string[] {
  const fits = (c: CardDef) => c.colorIdentity.every((x) => colors.includes(x));
  const focus = shuffle(focusPool.filter(fits)).slice(0, 12);
  const spells = [...focus, ...shuffle(pool.filter((c) => fits(c) && !focus.includes(c))).slice(0, 23 - focus.length)];
  const lands: string[] = Array.from({ length: 17 }, (_, i) => BASICS[colors[i % colors.length]!]);
  const names = spells.map((c) => c.name);
  for (const n of [...names]) {
    const partner = meldPartner.get(n);
    if (!partner || names.includes(partner) || lands.includes(partner) || !byName.has(partner)) continue;
    if (byName.get(partner)!.faces[0]!.types.includes('Land')) lands[0] = partner;
    else names[names.findIndex((x) => !meldPartner.has(x))] = partner;
  }
  return [...lands, ...names];
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

interface Failure {
  game: number;
  kind: 'crash' | 'rejected' | 'invariant';
  detail: string;
  action?: string;
}

let dumped = false;
let slowest = { ms: 0, game: -1, action: '' };
const TRACE = process.env.FUZZ_TRACE ? { file: process.env.FUZZ_TRACE.split(':')[0]!, game: Number(process.env.FUZZ_TRACE.split(':')[1]) } : null;
const failures: Failure[] = [];
let actions = 0;
let turns = 0;
let decided = 0;
const stats = { triggered: 0, resolvedAuto: 0, manual: 0, fizzled: 0, tokens: 0 };
const t0 = Date.now();

let xCasts = 0;
let xPlayed = 0;
for (let game = 0; game < GAMES; game++) {
  const count = PLAYERS === 'mixed' ? 2 + (game % 3) : Number(PLAYERS);
  const ids = ['p1', 'p2', 'p3', 'p4'].slice(0, count);
  const cards: Record<string, CardDef> = { ...DUNGEONS };
  const players = ids.map((id) => {
    const colors = shuffle([...(['W', 'U', 'B', 'R', 'G'] as Color[])]).slice(0, 2);
    const deck = makeDeck(colors);
    const legends = FORMAT === 'commander' ? pool.filter((c) => c.faces[0]!.supertypes.includes('Legendary') && c.faces[0]!.types.includes('Creature') && c.colorIdentity.every((x) => colors.includes(x as Color)) && !deck.includes(c.name)) : [];
    const commander = legends.length ? pick(legends).name : undefined;
    if (commander) deck.push(commander);
    for (const n of deck) cards[n] = byName.get(n)!;
    return { id, name: id, deck, ...(commander ? { commanders: [commander] } : {}) };
  });
  let g: GameState;
  try {
    g = createGame({ players, cards, seed: SEED * 1000 + game, format: FORMAT }).state;
  } catch (err) {
    failures.push({ game, kind: 'crash', detail: `createGame: ${String(err)}` });
    continue;
  }

  const used = new Map<string, number>();
  for (let i = 0; i < 6000 && !g.over && g.turn <= 40; i++) {
    let action: Action;
    let offered = false;
    const answer = answerFor(g);
    if (g.pending?.kind === 'commander_zone') commanderPrompts++;
    if (answer) action = { type: 'choose', player: answer.player, answer: answer.answer };
    else if (g.priority) {
      const options = legalActions(g, g.priority);
      if (options.some((a) => a.type === 'cast' && g.objects[a.object]?.zone === 'command')) commanderCasts++;
      // Nor activate the same ability over and over in one turn ("{0}: … gets -1/-0 until end of turn").
      const active = options.filter((a) => a.type !== 'pass' && a.type !== 'activate_manual' && !(a.type === 'activate' && (used.get(`${g.turn}:${a.object}`) ?? 0) >= 6));
      // Bots don't pile up a huge stack (free abilities like "{0}: …" would otherwise loop for thousands of actions).
      const chosen = active.length && g.stack.length < 20 && rnd() < 0.75 ? pick(active) : options[0]!;
      offered = true;
      // X spells and abilities are listed with the least X and the most that can be paid for: play any X in between
      // (mostly small ones), with targets to match ("X target creatures", "with mana value X or less").
      let base = chosen;
      if ((base.type === 'cast' || base.type === 'activate') && base.xMax !== undefined && base.xMax > (base.x ?? 0) && rnd() < 0.7) {
        const least = base.x ?? 0;
        base = { ...base, x: least + 1 + Math.floor(rnd() * Math.min(base.xMax - least, rnd() < 0.7 ? 3 : 40)) };
        xCasts++;
      }
      action = rnd() < 0.5 || base !== chosen ? randomiseTargets(g, base) : base;
      // Sometimes pay kicker too (the engine refuses if there's no kicker or no mana; then we fall back).
      // (Multikicker: sometimes more than once — CR 702.33c.)
      if (action.type === 'cast' && rnd() < 0.3) action = { ...action, kicked: rnd() < 0.4 ? true : rnd() < 0.5 ? pick([[0], [1], [0, 1]]) : 1 + Math.floor(rnd() * 3) };
      // CR 702.47: sometimes splice the Arcane cards in hand onto it (refused if it isn't Arcane or there's no mana).
      if (action.type === 'cast' && rnd() < 0.5) {
        const cast = action;
        const splice = (g.zones.hand[cast.player] ?? []).filter((id) => id !== cast.object && g.cards[g.objects[id]!.card]?.faces.some((f) => f.keywords.some((k) => k.id === 'splice')));
        if (splice.length) action = { ...cast, costs: { ...cast.costs, splice } };
      }
      // Replicate or squad: sometimes pay it once more.
      if (action.type === 'cast' && action.extras?.length === 1 && rnd() < 0.3) action = { ...action, extras: [...action.extras, action.extras[0]!] };
      if (action !== chosen) offered = false;
      if (!offered) {
        // A randomised version may be illegal; fall back to the offered one if so.
        try {
          const r = apply(g, action);
          if (!r.ok) {
            action = chosen;
            offered = true;
          }
        } catch {
          /* reported below */
        }
      }
    } else {
      failures.push({ game, kind: 'invariant', detail: `no decision possible in ${g.step}` });
      break;
    }
    const objectId = (action as { object?: string }).object;
    const label = JSON.stringify(action).slice(0, 300) + (objectId && g.objects[objectId] ? ` [${g.objects[objectId]!.card}]` : '');
    // FUZZ_TRACE=file:N — before each action of game N, the state and action (to replay one that never returns).
    if (TRACE && game === TRACE.game) writeFileSync(TRACE.file, JSON.stringify({ state: g, action }));
    let r;
    try {
      const started = Date.now();
      r = apply(g, action);
      // The slowest action of the run (an action taking seconds is a bug too: the bots' games would never end).
      const took = Date.now() - started;
      if (took > slowest.ms) slowest = { ms: took, game, action: label };
    } catch (err) {
      failures.push({ game, kind: 'crash', detail: (err as Error).stack?.split('\n').slice(0, 4).join(' | ') ?? String(err), action: label });
      break;
    }
    if (r.ok && (action.type === 'cast' || action.type === 'activate') && (action.x ?? 0) > 0) xPlayed++;
    if (!r.ok && answer?.answer.kind === 'pay' && answer.answer.pay) {
      // Couldn't afford it: decline instead.
      r = apply(g, { type: 'choose', player: answer.player, answer: { kind: 'pay', pay: false } });
    }
    if (!r.ok && answer?.answer.kind === 'cast_free' && answer.answer.cast) {
      // Couldn't cast it (madness's cost, no legal targets): decline instead.
      r = apply(g, { type: 'choose', player: answer.player, answer: { kind: 'cast_free', cast: false } });
    }
    if (!r.ok) {
      if (offered || answer) {
        failures.push({ game, kind: 'rejected', detail: r.error, action: label });
        // FUZZ_DUMP=file: the state and action of the first rejection, to replay it.
        if (process.env.FUZZ_DUMP && !dumped) {
          dumped = true;
          writeFileSync(process.env.FUZZ_DUMP, JSON.stringify({ state: g, action, error: r.error }));
        }
        // Unstick: pass if we can, otherwise give up on this game.
        if (g.priority && !g.pending) {
          const p = apply(g, { type: 'pass', player: g.priority });
          if (p.ok) {
            g = p.state;
            continue;
          }
        }
        break;
      }
      continue;
    }
    actions++;
    decided++;
    if (action.type === 'activate') used.set(`${g.turn}:${action.object}`, (used.get(`${g.turn}:${action.object}`) ?? 0) + 1);
    for (const e of r.events) {
      if (e.type === 'triggered') {
        stats.triggered++;
        if (TOP) {
          const name = r.state.objects[e.source]?.card ?? e.source;
          bySource.set(`trigger: ${name}`, (bySource.get(`trigger: ${name}`) ?? 0) + 1);
        }
      }
      if (TOP && e.type === 'created') {
        const name = r.state.objects[e.object]?.card ?? '?';
        bySource.set(`token: ${name}`, (bySource.get(`token: ${name}`) ?? 0) + 1);
      }
      if (e.type === 'resolved' && (e.entry.program || e.entry.kind === 'spell')) stats.resolvedAuto++;
      if (e.type === 'fizzled') stats.fizzled++;
      if (e.type === 'created') stats.tokens++;
    }
    if (r.state.pending?.kind === 'manual_resolution') stats.manual++;
    g = r.state;
    const bad = checkInvariants(g);
    if (bad) {
      failures.push({ game, kind: 'invariant', detail: bad, action: label });
      break;
    }
  }
  turns += g.turn;
  if (process.env.FUZZ_SIZES) {
    const { cards: _c, ...rest } = g;
    lastSizes = Object.entries(rest)
      .map(([k, v]) => [k, JSON.stringify(v)?.length ?? 0] as const)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, n]) => `${k}=${n}`)
      .join(' ');
    console.log(`game ${game} sizes: ${lastSizes}`);
    if (g.stack.length) console.log(`  stack ${g.stack.length}: ` + g.stack.slice(-3).map((e) => `${e.kind} ${(e as { sourceName?: string }).sourceName ?? ''} ${JSON.stringify(e).length}`).join(' | '));
  }
  if (VERBOSE) console.log(`game ${game}: ${count} players, ${g.turn} turns, winner ${g.winner ?? '-'}`);
}

const ms = Date.now() - t0;
if (process.env.FUZZ_SIZES) console.log(lastSizes);
console.log(`${GAMES} games, ${turns} turns, ${actions} actions in ${(ms / 1000).toFixed(1)} s (${(ms / Math.max(1, actions)).toFixed(2)} ms/action)`);
console.log(`  slowest action: ${slowest.ms} ms (game ${slowest.game}) ${slowest.ms > 1000 ? slowest.action.slice(0, 200) : ''}`);
if (TOP) for (const [k, v] of [...bySource].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${v} ${k}`);
console.log(`  triggers ${stats.triggered}, auto-resolved ${stats.resolvedAuto}, manual ${stats.manual}, fizzled ${stats.fizzled}, tokens ${stats.tokens}`);
console.log(`  X: ${xPlayed} casts and activations with X above 0 (of ${xCasts} tried)`);
if (FORMAT === 'commander') console.log(`  commander: a cast from the command zone offered ${commanderCasts} times, ${commanderPrompts} command-zone choices`);
const byKind = (k: Failure['kind']) => failures.filter((f) => f.kind === k);
for (const k of ['crash', 'rejected', 'invariant'] as const) {
  const list = byKind(k);
  console.log(`  ${k}: ${list.length}`);
  const grouped = new Map<string, Failure[]>();
  for (const f of list) grouped.set(f.detail.slice(0, 160), [...(grouped.get(f.detail.slice(0, 160)) ?? []), f]);
  for (const [detail, fs] of [...grouped].slice(0, 12)) console.log(`    ×${fs.length} ${detail}\n        e.g. game ${fs[0]!.game}: ${fs[0]!.action ?? ''}`);
}
process.exit(failures.length ? 1 : 0);
