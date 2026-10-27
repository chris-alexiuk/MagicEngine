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
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { reparseDB } from '@mtg/compiler';
import type { CardDB, CardDef, Color } from '@mtg/schema';
import {
  activatedAbilities,
  attackRestriction,
  mustAttack,
  apply,
  blockDeclarationProblem,
  blockProblem,
  chars,
  createGame,
  flatten,
  hasKeyword,
  hasRule,
  legalActions,
  spellPrograms,
  targetCandidates,
  type Action,
  type ChoiceAnswer,
  type GameState,
  type PlayerId,
  type Target,
} from '../src/index.js';
import { defaultCastChoice } from '../src/legal.js';

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
const bySource = new Map<string, number>();

let raw = readFileSync(dbPath);
if (raw[0] === 0x1f && raw[1] === 0x8b) raw = gunzipSync(raw);
const db = reparseDB(JSON.parse(raw.toString('utf8')) as CardDB);

// Small deterministic RNG for the bots (separate from the engine's).
let s = SEED >>> 0;
const rnd = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const shuffle = <T>(xs: T[]): T[] => {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
  return xs;
};

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
  return ['normal', 'split', 'adventure', 'transform', 'modal_dfc', 'prepare'].includes(c.layout);
});
const focusPool = FOCUS ? pool.filter((c) => c.faces.some((f) => FOCUS.test(f.oracle))) : [];

function makeDeck(colors: Color[]): string[] {
  const fits = (c: CardDef) => c.colorIdentity.every((x) => colors.includes(x));
  const focus = shuffle(focusPool.filter(fits)).slice(0, 12);
  const spells = [...focus, ...shuffle(pool.filter((c) => fits(c) && !focus.includes(c))).slice(0, 23 - focus.length)];
  const lands = Array.from({ length: 17 }, (_, i) => BASICS[colors[i % colors.length]!]);
  return [...lands, ...spells.map((c) => c.name)];
}

// ---------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------

function sample(candidates: Target[], count: number, upTo: boolean): Target[] {
  const n = upTo ? Math.floor(rnd() * (Math.min(count, candidates.length) + 1)) : count;
  return shuffle([...candidates]).slice(0, n);
}

/** Re-picks targets at random for a cast/activate action that came with defaults. */
function randomiseTargets(g: GameState, a: Action): Action {
  if ((a.type !== 'cast' && a.type !== 'activate') || !a.targets?.length) return a;
  const o = g.objects[a.object]!;
  let specs;
  try {
    if (a.type === 'cast') {
      const face = g.cards[o.card]!.faces[a.face ?? 0]!;
      const programs = spellPrograms(face);
      if (!programs) return a;
      specs = flatten(programs, a.modes).specs;
    } else {
      specs = flatten([activatedAbilities(g, o)[a.ability]!], a.modes).specs;
    }
  } catch {
    return a;
  }
  return { ...a, targets: specs.map((spec) => sample(targetCandidates(g, a.player, spec, o), spec.count ?? 1, Boolean(spec.upTo))) };
}

function answerFor(g: GameState): { player: PlayerId; answer: ChoiceAnswer } | null {
  const p = g.pending;
  if (!p) return null;
  const me = p.player;
  const hand = () => [...(g.zones.hand[me] ?? [])];
  switch (p.kind) {
    case 'mulligan':
      return { player: me, answer: { kind: 'mulligan', keep: rnd() < 0.85 || g.players[me]!.mulligans >= 2 } };
    case 'bottom_cards':
      return { player: me, answer: { kind: 'bottom_cards', objects: shuffle(hand()).slice(0, p.count) } };
    case 'discard_to_hand_size':
      return { player: me, answer: { kind: 'discard_to_hand_size', objects: shuffle(hand()).slice(0, p.count) } };
    case 'discard':
      return { player: me, answer: { kind: 'discard', objects: shuffle(hand()).slice(0, Math.min(p.count, hand().length)) } };
    case 'legend_rule':
      return { player: me, answer: { kind: 'legend_rule', keep: pick(p.objects) } };
    case 'manual_resolution':
      return { player: me, answer: { kind: 'manual_resolution', done: true } };
    case 'may':
      return { player: me, answer: { kind: 'may', yes: rnd() < 0.7 } };
    case 'cast_free': {
      const choice = rnd() < 0.8 ? defaultCastChoice(g, me, p.object) : null;
      return { player: me, answer: choice ? { kind: 'cast_free', cast: true, ...choice } : { kind: 'cast_free', cast: false } };
    }
    case 'copy_targets': {
      // Keep the targets, or pick new ones where there are enough candidates.
      const fresh = p.prompts.map((pr) => pr.candidates.slice().sort(() => rnd() - 0.5).slice(0, pr.count));
      const ok = p.prompts.every((pr, i) => fresh[i]!.length === pr.count || (pr.upTo && fresh[i]!.length <= pr.count));
      return { player: me, answer: { kind: 'copy_targets', ...(ok && rnd() < 0.5 ? { targets: fresh } : {}) } };
    }
    case 'pay':
      // Try to pay half the time; the main loop falls back to declining if it can't be paid.
      return { player: me, answer: { kind: 'pay', pay: rnd() < 0.5 } };
    case 'sacrifice':
      return { player: me, answer: { kind: 'sacrifice', objects: shuffle([...p.candidates]).slice(0, p.count) } };
    case 'search': {
      const n = p.mustFind ? Math.min(p.count, p.candidates.length) : Math.floor(rnd() * (Math.min(p.count, p.candidates.length) + 1));
      return { player: me, answer: { kind: 'search', objects: shuffle([...p.candidates]).slice(0, n) } };
    }
    case 'scry': {
      const xs = shuffle([...p.objects]);
      // "Put them back in any order": all of them on top.
      const k = p.reorder ? xs.length : Math.floor(rnd() * (xs.length + 1));
      return { player: me, answer: { kind: 'scry', top: xs.slice(0, k), bottom: xs.slice(k) } };
    }
    case 'surveil': {
      const xs = shuffle([...p.objects]);
      const k = Math.floor(rnd() * (xs.length + 1));
      return { player: me, answer: { kind: 'surveil', top: xs.slice(0, k), graveyard: xs.slice(k) } };
    }
    case 'proliferate':
      return { player: me, answer: { kind: 'proliferate', objects: p.objects.filter(() => rnd() < 0.6), players: p.players.filter(() => rnd() < 0.5) } };
    case 'choose_option':
      return { player: me, answer: { kind: 'choose_option', choice: pick(p.options) } };
    case 'choose_objects': {
      const n = p.min + Math.floor(rnd() * (Math.min(p.max, p.candidates.length) - p.min + 1));
      return { player: me, answer: { kind: 'choose_objects', objects: shuffle([...p.candidates]).slice(0, n) } };
    }
    case 'as_enters':
      if (p.choice === 'pay_life') return { player: me, answer: { kind: 'as_enters', pay: g.players[me]!.life >= (p.amount ?? 0) && rnd() < 0.6 } };
      if (p.choice === 'reveal') return { player: me, answer: { kind: 'as_enters', reveal: p.candidates?.length && rnd() < 0.8 ? pick(p.candidates) : null } };
      if (p.choice === 'counter') return { player: me, answer: { kind: 'as_enters', pay: rnd() < 0.5 } };
      if (p.choice === 'copy') return { player: me, answer: { kind: 'as_enters', copy: p.candidates?.length && rnd() < 0.9 ? pick(p.candidates) : null } };
      return { player: me, answer: { kind: 'as_enters', choice: pick(p.options ?? []) } };
    case 'declare_attackers': {
      const attacks = p.attackers
        .filter((id) => mustAttack(g, g.objects[id]!) || rnd() < 0.6)
        .flatMap((attacker) => {
          // CR 508.1c: "can't attack unless defending player controls an Island".
          const ok = p.targets.filter((t) => !attackRestriction(g, g.objects[attacker]!, t));
          return ok.length ? [{ attacker, target: pick(ok) }] : [];
        });
      return { player: me, answer: { kind: 'declare_attackers', attacks } };
    }
    case 'declare_blockers': {
      const random = () => {
        const blocks: { blocker: string; attacker: string }[] = [];
        for (const blocker of p.blockers) {
          if (rnd() < 0.5) continue;
          const options = p.attackers.filter((a) => !blockProblem(g, g.objects[blocker]!, g.objects[a]!) && !hasKeyword(g, g.objects[a]!, 'menace'));
          if (options.length) blocks.push({ blocker, attacker: pick(options) });
        }
        return blocks;
      };
      // Requirements first (CR 509.1c): lures get every creature able to block them; "must be blocked" gets one.
      const forced = () => {
        const must = (a: string, kind: 'one' | 'all') => chars(g, g.objects[a]!).combat.some((r) => r.mustBeBlocked === kind);
        const blocks: { blocker: string; attacker: string }[] = [];
        for (const blocker of p.blockers) {
          const lure = p.attackers.find((a) => must(a, 'all') && !blockProblem(g, g.objects[blocker]!, g.objects[a]!));
          if (lure) blocks.push({ blocker, attacker: lure });
        }
        for (const a of p.attackers.filter((x) => must(x, 'one'))) {
          if (blocks.some((x) => x.attacker === a)) continue;
          const free = p.blockers.find((b) => !blocks.some((x) => x.blocker === b) && !blockProblem(g, g.objects[b]!, g.objects[a]!));
          if (free) blocks.push({ blocker: free, attacker: a });
        }
        return blocks;
      };
      for (let k = 0; k < 12; k++) {
        const blocks = k < 10 ? random() : k === 10 ? forced() : [];
        if (!blockDeclarationProblem(g, me, blocks)) return { player: me, answer: { kind: 'declare_blockers', blocks } };
      }
      return { player: me, answer: { kind: 'declare_blockers', blocks: forced() } };
    }
    case 'assign_combat_damage':
      return { player: me, answer: { kind: 'assign_combat_damage', assignments: Object.fromEntries(p.choices.map((c) => [c.attacker, c.suggested])) } };
    case 'trigger_targets': {
      if (p.modes) {
        const legal = p.modes.options
          .map((o, i) => ({ i, o }))
          .filter(({ o }) => o.prompts.every((pr) => pr.upTo || pr.candidates.length >= pr.count));
        const n = Math.max(p.modes.min, Math.min(p.modes.max, legal.length, 1 + Math.floor(rnd() * p.modes.max)));
        const chosen = shuffle(legal).slice(0, n).sort((a, b) => a.i - b.i);
        const targets = chosen.flatMap(({ o }) => o.prompts.map((pr) => sample(pr.candidates, pr.count, pr.upTo)));
        return { player: me, answer: { kind: 'trigger_targets', modes: chosen.map((c) => c.i), targets: [...targets, ...p.prompts.map((pr) => sample(pr.candidates, pr.count, pr.upTo))] } };
      }
      return { player: me, answer: { kind: 'trigger_targets', targets: p.prompts.map((pr) => sample(pr.candidates, pr.count, pr.upTo)) } };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

function checkInvariants(g: GameState): string | null {
  const seen = new Set<string>();
  const where = (id: string, zone: string, owner?: PlayerId): string | null => {
    const o = g.objects[id];
    if (!o) return `${zone} lists missing object ${id}`;
    if (o.zone !== zone) return `${id} is listed in ${zone} but says ${o.zone}`;
    if (owner && o.owner !== owner) return `${id} is in ${owner}'s ${zone} but owned by ${o.owner}`;
    if (seen.has(id)) return `${id} is in two places`;
    seen.add(id);
    return null;
  };
  for (const p of g.order) {
    for (const zone of ['library', 'hand', 'graveyard'] as const) {
      for (const id of g.zones[zone][p] ?? []) {
        const err = where(id, zone, p);
        if (err) return err;
      }
    }
    const ps = g.players[p]!;
    if (!Number.isFinite(ps.life) || Object.values(ps.pool).some((n) => !Number.isInteger(n) || n < 0)) return `bad numbers for ${p}`;
  }
  for (const zone of ['battlefield', 'exile', 'command'] as const) {
    for (const id of g.zones[zone]) {
      const err = where(id, zone);
      if (err) return err;
    }
  }
  for (const e of g.stack) {
    if (e.kind === 'spell') {
      const err = where(e.object, 'stack');
      if (err) return err;
    }
  }
  for (const o of Object.values(g.objects)) if (!seen.has(o.id)) return `${o.id} (${o.card}) is in no zone list (${o.zone})`;
  if (!g.over && !g.pending && g.started && g.priority === null) return 'nobody has priority and nothing is pending';
  return null;
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

const failures: Failure[] = [];
let actions = 0;
let turns = 0;
let decided = 0;
const stats = { triggered: 0, resolvedAuto: 0, manual: 0, fizzled: 0, tokens: 0 };
const t0 = Date.now();

for (let game = 0; game < GAMES; game++) {
  const count = PLAYERS === 'mixed' ? 2 + (game % 3) : Number(PLAYERS);
  const ids = ['p1', 'p2', 'p3', 'p4'].slice(0, count);
  const cards: Record<string, CardDef> = {};
  const players = ids.map((id) => {
    const colors = shuffle([...(['W', 'U', 'B', 'R', 'G'] as Color[])]).slice(0, 2);
    const deck = makeDeck(colors);
    for (const n of deck) cards[n] = byName.get(n)!;
    return { id, name: id, deck };
  });
  let g: GameState;
  try {
    g = createGame({ players, cards, seed: SEED * 1000 + game, format: 'constructed' }).state;
  } catch (err) {
    failures.push({ game, kind: 'crash', detail: `createGame: ${String(err)}` });
    continue;
  }

  const used = new Map<string, number>();
  for (let i = 0; i < 6000 && !g.over && g.turn <= 40; i++) {
    let action: Action;
    let offered = false;
    const answer = answerFor(g);
    if (answer) action = { type: 'choose', player: answer.player, answer: answer.answer };
    else if (g.priority) {
      const options = legalActions(g, g.priority);
      // Nor activate the same ability over and over in one turn ("{0}: … gets -1/-0 until end of turn").
      const active = options.filter((a) => a.type !== 'pass' && a.type !== 'activate_manual' && !(a.type === 'activate' && (used.get(`${g.turn}:${a.object}`) ?? 0) >= 6));
      // Bots don't pile up a huge stack (free abilities like "{0}: …" would otherwise loop for thousands of actions).
      const chosen = active.length && g.stack.length < 20 && rnd() < 0.75 ? pick(active) : options[0]!;
      offered = true;
      action = rnd() < 0.5 ? randomiseTargets(g, chosen) : chosen;
      // Sometimes pay kicker too (the engine refuses if there's no kicker or no mana; then we fall back).
      // (Multikicker: sometimes more than once — CR 702.33c.)
      if (action.type === 'cast' && rnd() < 0.3) action = { ...action, kicked: rnd() < 0.5 ? true : 1 + Math.floor(rnd() * 3) };
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
    let r;
    try {
      r = apply(g, action);
    } catch (err) {
      failures.push({ game, kind: 'crash', detail: (err as Error).stack?.split('\n').slice(0, 4).join(' | ') ?? String(err), action: label });
      break;
    }
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
if (TOP) for (const [k, v] of [...bySource].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${v} ${k}`);
console.log(`  triggers ${stats.triggered}, auto-resolved ${stats.resolvedAuto}, manual ${stats.manual}, fizzled ${stats.fizzled}, tokens ${stats.tokens}`);
const byKind = (k: Failure['kind']) => failures.filter((f) => f.kind === k);
for (const k of ['crash', 'rejected', 'invariant'] as const) {
  const list = byKind(k);
  console.log(`  ${k}: ${list.length}`);
  const grouped = new Map<string, Failure[]>();
  for (const f of list) grouped.set(f.detail.slice(0, 160), [...(grouped.get(f.detail.slice(0, 160)) ?? []), f]);
  for (const [detail, fs] of [...grouped].slice(0, 12)) console.log(`    ×${fs.length} ${detail}\n        e.g. game ${fs[0]!.game}: ${fs[0]!.action ?? ''}`);
}
process.exit(failures.length ? 1 : 0);
