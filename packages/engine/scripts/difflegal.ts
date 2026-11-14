/**
 * For a change to how legal actions are listed: plays random games with this checkout's engine and, at every state
 * with priority, compares what this checkout's legalActions() lists with what another checkout's lists. A refactor
 * should show no difference; a change should show the differences it meant and no others.
 *
 *   OLD=/path/to/other/checkout/packages/engine/src/index.ts \
 *     tsx scripts/difflegal.ts <cards.json.gz> [--games N] [--seed S] [--players N] [--format commander] [--focus REGEX] [--show N]
 *
 * The other checkout can be the snapshot tools/dev/fuzz-all.sh makes (its fourth argument says where), or a
 * `git worktree` of the commit before. Both read the same states, so the state's shape must be the same in the two.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { CardDB, CardDef, Color } from '@mtg/schema';
import { apply, createGame, legalActions, type Action, type GameState } from '../src/index.js';
import { createBot } from './lib/bot.js';

const old = (await import(process.env.OLD!)) as { legalActions: typeof legalActions };
const args = process.argv.slice(2);
const opt = (name: string, d: string) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1]! : d);
const GAMES = Number(opt('--games', '10'));
const SEED = Number(opt('--seed', '1'));
const PLAYERS = Number(opt('--players', '2'));
const FORMAT = opt('--format', 'constructed') as 'commander' | 'constructed';
const FOCUS = args.includes('--focus') ? new RegExp(opt('--focus', '')) : null;
const SHOW = Number(opt('--show', '12'));
let raw = readFileSync(args[0]!);
if (raw[0] === 0x1f && raw[1] === 0x8b) raw = gunzipSync(raw);
const db = JSON.parse(raw.toString('utf8')) as CardDB;
let s = SEED >>> 0;
const rnd = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const { answerFor, randomiseTargets, pick, shuffle } = createBot({ rnd });
const BASICS: Record<Color, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
const byName = new Map(db.cards.map((c) => [c.name, c]));
const pool = db.cards.filter((c) => {
  const f = c.faces[0]!;
  if (f.types.includes('Land') || c.cmc > 6 || c.automation === 'manual') return false;
  if (!c.legal.commander && !c.legal.legacy) return false;
  if (/\{[^}]*(?:P|S|H|\d\/[WUBRG]|C\/)[^}]*\}/.test(f.manaCost)) return false;
  if (c.layout === 'meld') return f.manaCost !== '';
  return ['normal', 'split', 'adventure', 'transform', 'modal_dfc', 'prepare'].includes(c.layout);
});
const DUNGEONS: Record<string, CardDef> = Object.fromEntries([...db.cards, ...db.tokens].filter((c) => c.faces[0]!.types.includes('Dungeon')).map((c) => [c.name, c]));
const focusPool = FOCUS ? db.cards.filter((c) => (pool.includes(c) || (c.faces[0]!.types.includes('Land') && c.automation !== 'manual')) && (FOCUS.test(c.name) || c.faces.some((f) => FOCUS.test(f.oracle)))) : [];
function makeDeck(colors: Color[]): string[] {
  const fits = (c: CardDef) => c.colorIdentity.every((x) => colors.includes(x));
  const focus = shuffle(focusPool.filter(fits)).slice(0, 14);
  const spells = [...focus, ...shuffle(pool.filter((c) => fits(c) && !focus.includes(c))).slice(0, 23 - focus.length)];
  return [...Array.from({ length: 17 }, (_, i) => BASICS[colors[i % colors.length]!]), ...spells.map((c) => c.name)];
}
const key = (a: Action) => JSON.stringify(a);
let states = 0;
let differing = 0;
let shown = 0;
const kinds = new Map<string, number>();
for (let game = 0; game < GAMES; game++) {
  const ids = ['p1', 'p2', 'p3', 'p4'].slice(0, PLAYERS);
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
  let g: GameState = createGame({ players, cards, seed: SEED * 1000 + game, format: FORMAT }).state;
  const used = new Map<string, number>();
  for (let i = 0; i < 6000 && !g.over && g.turn <= 40; i++) {
    let action: Action;
    const answer = answerFor(g);
    if (answer) action = { type: 'choose', player: answer.player, answer: answer.answer };
    else if (g.priority) {
      const options = legalActions(g, g.priority);
      const before = old.legalActions(g, g.priority);
      states++;
      const a = options.map(key);
      const b = before.map(key);
      if (a.join('\n') !== b.join('\n')) {
        differing++;
        const gone = b.filter((x) => !a.includes(x));
        const added = a.filter((x) => !b.includes(x));
        const name = (x: string) => {
          const act = JSON.parse(x) as Action & { object?: string };
          const o = act.object ? g.objects[act.object] : undefined;
          return `${o ? g.cards[o.card]!.name : ''} [${o?.zone ?? ''}]`;
        };
        const kind = gone.length || added.length ? `${gone.length ? 'gone' : ''}${added.length ? 'new' : ''}` : 'order';
        kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
        if (shown < SHOW) {
          shown++;
          console.log(`--- game ${game} step ${i} turn ${g.turn} ${g.step} (${kind})`);
          for (const x of gone.slice(0, 4)) console.log(`  - ${name(x)} ${x.slice(0, 330)}`);
          for (const x of added.slice(0, 4)) console.log(`  + ${name(x)} ${x.slice(0, 330)}`);
        }
      }
      const active = options.filter((x) => x.type !== 'pass' && x.type !== 'activate_manual' && !(x.type === 'activate' && (used.get(`${g.turn}:${x.object}`) ?? 0) >= 6));
      const chosen = active.length && g.stack.length < 20 && rnd() < 0.75 ? pick(active) : options[0]!;
      action = rnd() < 0.5 ? randomiseTargets(g, chosen) : chosen;
      if (action !== chosen && !apply(g, action).ok) action = chosen;
      if (action.type === 'activate') used.set(`${g.turn}:${action.object}`, (used.get(`${g.turn}:${action.object}`) ?? 0) + 1);
    } else break;
    const r = apply(g, action);
    if (!r.ok) {
      console.log(`REFUSED game ${game} step ${i}: ${r.error} ${JSON.stringify(action).slice(0, 300)}`);
      break;
    }
    g = r.state;
  }
}
console.log(`${states} states compared, ${differing} differ ${JSON.stringify([...kinds])}`);
