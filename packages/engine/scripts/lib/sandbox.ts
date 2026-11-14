/**
 * The card sandbox: every card is played once on a standard board, and what happened is checked and recorded.
 *
 * A card is graded "fully automatic" when every line of it was read. That says the compiler understood the words —
 * not that the engine then plays the card. The sandbox is the other half: it puts the card in a player's hand on a
 * board that has one of everything, plays it every way the engine offers (each face, each alternative cost, each
 * mode), lets it resolve, uses each of its abilities, and reports
 *
 *   - what is wrong for certain: a crash, a broken state, an action the engine offered and then refused, a choice
 *     nobody could answer, a card no board lets you play, a permanent that left the battlefield as it arrived
 *     because the engine doesn't know its size or loyalty;
 *   - what looks wrong: a spell or ability that resolved and changed nothing, an ability that is never offered;
 *   - a fingerprint of everything that happened, so that a change in a card's behaviour between two versions of the
 *     engine shows up as a line in a report rather than at the table.
 *
 * The players are the constructive bot (scripts/lib/bot.ts): the same choices every time, the ones that make
 * something happen. Nothing here is random.
 */
import { createHash } from 'node:crypto';
import { compileCard, type ScryfallCard } from '@mtg/compiler';
import type { CardDef, FaceDef } from '@mtg/schema';
import {
  activatedAbilities,
  apply,
  choiceModes,
  choicePrompts,
  createGame,
  defaultChoiceAtX,
  learnCreatureTypes,
  legalActions,
  manaAbilities,
  type Action,
  type ChoiceAnswer,
  type GameEvent,
  type GameObject,
  type GameState,
  type PlayerId,
  type Target,
} from '../../src/index.js';
import { createToken } from '../../src/permanents.js';
import { createObject } from '../../src/zones.js';
import { checkInvariants, createBot } from './bot.js';

// ---------------------------------------------------------------------------
// The cards the board is made of
// ---------------------------------------------------------------------------

function make(name: string, type_line: string, mana_cost = '', oracle_text = '', extra: Partial<ScryfallCard> = {}): CardDef {
  const symbols = [...mana_cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
  const cmc = symbols.reduce((n, sym) => n + (/^\d+$/.test(sym) ? Number(sym) : 1), 0);
  const colors = [...new Set(`${mana_cost}${oracle_text}`.match(/[WUBRG](?=[^{}]*\})/g) ?? [])];
  const card: ScryfallCard = { object: 'card', id: `sandbox-${name}`, oracle_id: `sandbox-${name}`, layout: 'normal', set: 'sbx', rarity: 'common', name, type_line, mana_cost, oracle_text, cmc, color_identity: colors, legalities: { commander: 'legal' }, ...extra };
  const def = compileCard(card, card.oracle_id!);
  if (def.automation !== 'full') throw new Error(`sandbox card ${name} isn't fully automatic: ${def.faces[0]!.unparsed.join(' / ')}`);
  return def;
}

const creature = (name: string, cost: string, subtype: string, pt: string, text = '', prefix = 'Creature'): CardDef =>
  make(name, `${prefix} — ${subtype}`, cost, text, { power: pt.split('/')[0]!, toughness: pt.split('/')[1]! });

const BASICS: [string, string, string][] = [
  ['Plains', 'W', 'Plains'],
  ['Island', 'U', 'Island'],
  ['Swamp', 'B', 'Swamp'],
  ['Mountain', 'R', 'Mountain'],
  ['Forest', 'G', 'Forest'],
];

/** The board's own cards, by name. Plain on purpose: what happens on the board should be the doing of the card being checked. */
export function sandboxCards(): Record<string, CardDef> {
  const list: CardDef[] = [
    ...BASICS.map(([name, color, type]) => make(name, `Basic Land — ${type}`, '', `({T}: Add {${color}}.)`)),
    make('Sandbox Tower', 'Land', '', '{T}: Add {C}.'),
    make('Sandbox Glacier', 'Snow Land', '', '{T}: Add {C}.'),
    creature('Sandbox Bear', '{1}{G}', 'Bear', '2/2'),
    creature('Sandbox Soldier', '{W}', 'Human Soldier', '1/1'),
    creature('Sandbox Drake', '{2}{U}', 'Drake', '2/2', 'Flying'),
    creature('Sandbox Zombie', '{1}{B}', 'Zombie', '2/2'),
    creature('Sandbox Goblin', '{R}', 'Goblin', '1/1'),
    creature('Sandbox Giant', '{4}{R}', 'Giant', '5/5'),
    creature('Sandbox Shapeshifter', '{2}', 'Shapeshifter', '1/1', 'Changeling (This card is every creature type.)'),
    creature('Sandbox Golem', '{3}', 'Golem', '3/3', '', 'Artifact Creature'),
    creature('Sandbox Commander', '{W}{U}{B}{R}{G}', 'Human', '3/3', '', 'Legendary Creature'),
    creature('Sandbox Hero', '{2}{W}', 'Human Knight', '2/2', '', 'Legendary Creature'),
    creature('Sandbox Knight', '{G}{W}', 'Human Knight', '2/2'),
    creature('Sandbox Wall', '{1}{W}', 'Wall', '0/4', 'Defender'),
    make('Sandbox Relic', 'Artifact', '{1}'),
    make('Sandbox Idol', 'Artifact', '{2}', '{T}: Sandbox Idol deals 1 damage to target player.'),
    make('Sandbox Blade', 'Artifact — Equipment', '{1}', 'Equipped creature gets +1/+0.\nEquip {1}'),
    make('Sandbox Shrine', 'Enchantment', '{1}{W}'),
    make('Sandbox Aura', 'Enchantment — Aura', '{G}', 'Enchant creature\nEnchanted creature gets +0/+1.'),
    make('Sandbox Walker', 'Legendary Planeswalker — Ajani', '{3}{W}', '+1: You gain 1 life.\n−2: Draw a card.', { loyalty: '4' }),
    make('Sandbox Bolt', 'Instant', '{R}', 'Sandbox Bolt deals 1 damage to any target.'),
    make('Sandbox Lesson', 'Sorcery', '{1}{U}', 'Draw a card.'),
    make('Sandbox Insight', 'Instant', '{1}{U}', 'Target player draws a card.'),
    make('Sandbox Omen', 'Enchantment', '{2}{W}{B}', 'Flash'),
  ];
  return Object.fromEntries(list.map((c) => [c.name, c]));
}

const SOLDIER_TOKEN: FaceDef = make('Soldier', 'Token Creature — Soldier', '', '', { power: '1', toughness: '1', colors: ['W'] }).faces[0]!;
const TREASURE_TOKEN: FaceDef = make('Treasure', 'Token Artifact — Treasure', '', '{T}, Sacrifice this token: Add one mana of any color.').faces[0]!;

// ---------------------------------------------------------------------------
// The boards
// ---------------------------------------------------------------------------

export const ME: PlayerId = 'p1';
const P2: PlayerId = 'p2';
const P3: PlayerId = 'p3';
const SEATS: PlayerId[] = [ME, P2, P3];

export type BoardName = 'main' | 'respond' | 'mine' | 'charging' | 'attacking' | 'aftermath' | 'attacked' | 'defending';

export interface Board {
  name: BoardName;
  /** Where the card is played from: never changed, copied for each run. */
  g: GameState;
  /** What is on the stack before the card is played (an opponent's spells, on the board for answering them). */
  stack: number;
}

/** A copy of the state that can be changed freely (card definitions are shared: they never change). */
export function copyOf(g: GameState): GameState {
  const { cards, ...rest } = g;
  return { ...structuredClone(rest), cards: { ...cards } };
}

function must(g: GameState, action: Action): GameState {
  const r = apply(g, action);
  if (!r.ok) throw new Error(`sandbox setup: ${action.type} refused: ${r.error}`);
  return r.state;
}

/** What the bot leaves alone when it has another choice: the card being checked. */
let spared: ReadonlySet<string> = new Set();
const bot = createBot({ rnd: () => 0, constructive: true, protect: () => spared });
/** For a choice the engine refuses the bot's answer to ("controlled by different players"): any legal answer will do. */
let seed = 1;
const dice = createBot({
  rnd: () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  },
});

/**
 * Plays on until `done`: everyone passes, and choices on the way are answered by `script` (combat, for the boards that
 * are in one) or left empty (no attackers, no blockers) or made by the bot.
 */
function advance(g: GameState, done: (g: GameState) => boolean, script: (g: GameState) => ChoiceAnswer | undefined = () => undefined): GameState {
  for (let i = 0; i < 400; i++) {
    if (done(g)) return g;
    if (g.pending) {
      const p = g.pending;
      const answer: ChoiceAnswer | undefined = script(g) ?? (p.kind === 'declare_attackers' ? { kind: 'declare_attackers', attacks: [] } : p.kind === 'declare_blockers' ? { kind: 'declare_blockers', blocks: [] } : bot.answerFor(g)?.answer);
      if (!answer) throw new Error(`sandbox setup: no answer for ${p.kind}`);
      g = must(g, { type: 'choose', player: p.player, answer });
    } else if (g.priority) g = must(g, { type: 'pass', player: g.priority });
    else throw new Error(`sandbox setup: nobody to act in ${g.step}`);
  }
  throw new Error('sandbox setup: the board was never reached');
}

type Placed = Record<string, string>;

/**
 * Puts the standard board in place, bypassing the rules: for each player lands, creatures of several kinds (one
 * tapped, one with a counter, one that is every creature type), an artifact, an Equipment, an enchantment, an Aura, a
 * planeswalker and a token; a hand; a graveyard with a card of every type; a card in exile. Returns the objects by a
 * label ("p1 bear").
 */
function populate(g: GameState, table: Record<string, CardDef>): Placed {
  const placed: Placed = {};
  for (const p of SEATS) {
    for (const id of g.zones.hand[p] ?? []) {
      g.objects[id]!.zone = 'library';
      g.zones.library[p]!.push(id);
    }
    g.zones.hand[p] = [];
  }
  const put = (p: PlayerId, name: string, zone: 'battlefield' | 'hand' | 'graveyard' | 'exile', label?: string): GameObject => {
    g.cards[name] ??= table[name]!;
    const o = createObject(g, name, p, zone);
    if (zone === 'battlefield') o.sick = false;
    if (label) placed[`${p} ${label}`] = o.id;
    return o;
  };
  const attach = (o: GameObject, to: GameObject) => {
    o.attachedTo = { id: to.id, zcc: to.zcc };
  };
  const field = (p: PlayerId, lands: string[], rest: [string, string][]) => {
    for (const name of lands) put(p, name, 'battlefield');
    for (const [name, label] of rest) put(p, name, 'battlefield', label);
  };

  field(
    ME,
    [...BASICS.flatMap(([name]) => [name, name, name]), 'Sandbox Glacier', 'Sandbox Tower', 'Sandbox Tower'],
    [
      ['Sandbox Bear', 'bear'],
      ['Sandbox Soldier', 'soldier'],
      ['Sandbox Drake', 'drake'],
      ['Sandbox Giant', 'giant'],
      ['Sandbox Shapeshifter', 'shapeshifter'],
      ['Sandbox Shapeshifter', 'second shapeshifter'],
      ['Sandbox Golem', 'golem'],
      ['Sandbox Wall', 'wall'],
      ['Sandbox Relic', 'relic'],
      ['Sandbox Blade', 'blade'],
      ['Sandbox Shrine', 'shrine'],
      ['Sandbox Aura', 'aura'],
      ['Sandbox Walker', 'walker'],
    ],
  );
  field(
    P2,
    [...BASICS.flatMap(([name]) => [name, name]), 'Sandbox Tower', 'Sandbox Tower'],
    [
      ['Sandbox Bear', 'bear'],
      ['Sandbox Zombie', 'zombie'],
      ['Sandbox Wall', 'wall'],
      ['Sandbox Drake', 'drake'],
      ['Sandbox Giant', 'giant'],
      ['Sandbox Golem', 'golem'],
      ['Sandbox Hero', 'hero'],
      ['Sandbox Knight', 'knight'],
      ['Sandbox Relic', 'relic'],
      ['Sandbox Idol', 'idol'],
      ['Sandbox Blade', 'blade'],
      ['Sandbox Shrine', 'shrine'],
      ['Sandbox Aura', 'aura'],
      ['Sandbox Walker', 'walker'],
    ],
  );
  field(P3, ['Forest', 'Mountain'], [
    ['Sandbox Bear', 'bear'],
    ['Sandbox Goblin', 'goblin'],
    ['Sandbox Relic', 'relic'],
    ['Sandbox Shrine', 'shrine'],
  ]);
  const at = (label: string) => g.objects[placed[label]!]!;
  // Something tapped of each kind: a creature, an artifact and a land of mine, a creature and a land of an opponent's.
  at('p1 soldier').tapped = true;
  at('p1 relic').tapped = true;
  at('p2 zombie').tapped = true;
  for (const p of [ME, P2]) Object.values(g.objects).findLast((o) => o.zone === 'battlefield' && o.controller === p && o.card === 'Sandbox Tower')!.tapped = true;
  // My commander is on the battlefield: a legendary, multicolored creature I control.
  const commander = g.zones.command.map((id) => g.objects[id]!).find((o) => o.owner === ME && o.commander);
  if (commander) {
    g.zones.command.splice(g.zones.command.indexOf(commander.id), 1);
    g.zones.battlefield.push(commander.id);
    Object.assign(commander, { zone: 'battlefield', sick: false, baseController: ME });
    placed['p1 commander'] = commander.id;
  }
  at('p1 shapeshifter').counters['+1/+1'] = 1;
  attach(at('p1 blade'), at('p1 bear'));
  attach(at('p1 aura'), at('p1 drake'));
  attach(at('p2 aura'), at('p2 bear'));
  at('p1 walker').counters.loyalty = 4;
  at('p2 walker').counters.loyalty = 4;
  const events: GameEvent[] = [];
  for (const p of [ME, P2]) {
    const token = createToken(g, SOLDIER_TOKEN, p, events);
    token.sick = false;
    placed[`${p} token`] = token.id;
  }
  createToken(g, TREASURE_TOKEN, ME, events).sick = false;

  for (const [name, label] of [['Forest', 'land'], ['Sandbox Bear', 'creature'], ['Sandbox Bolt', 'instant'], ['Sandbox Relic', 'artifact']] as const) put(ME, name, 'hand', `hand ${label}`);
  for (const [name, label] of [['Mountain', 'land'], ['Sandbox Golem', 'creature'], ['Sandbox Bolt', 'instant'], ['Sandbox Insight', 'blue instant'], ['Sandbox Omen', 'enchantment'], ['Sandbox Lesson', 'sorcery']] as const) put(P2, name, 'hand', `hand ${label}`);
  for (const [name, label] of [['Forest', 'land'], ['Sandbox Bear', 'creature'], ['Sandbox Bolt', 'instant']] as const) put(P3, name, 'hand', `hand ${label}`);
  for (const p of SEATS) {
    for (const name of ['Sandbox Bear', 'Sandbox Zombie', 'Sandbox Hero', 'Sandbox Bolt', 'Sandbox Lesson', 'Sandbox Relic', 'Sandbox Shrine', 'Forest', 'Sandbox Walker']) put(p, name, 'graveyard');
    put(p, 'Sandbox Bear', 'exile');
  }
  return placed;
}

const DECK = [
  ...BASICS.flatMap(([name]) => [name, name]),
  'Sandbox Tower',
  'Sandbox Tower',
  ...Array.from({ length: 4 }, () => 'Sandbox Bear'),
  ...['Sandbox Soldier', 'Sandbox Drake', 'Sandbox Zombie', 'Sandbox Goblin', 'Sandbox Golem', 'Sandbox Relic', 'Sandbox Shrine', 'Sandbox Aura', 'Sandbox Bolt', 'Sandbox Lesson'].flatMap((n) => [n, n]),
  'Sandbox Giant',
  'Sandbox Shapeshifter',
  'Sandbox Blade',
  'Sandbox Idol',
  'Sandbox Walker',
  'Sandbox Hero',
  'Sandbox Bolt',
  'Sandbox Lesson',
  'Sandbox Relic',
  'Sandbox Commander',
];

const object = (id: string): Target => ({ kind: 'object', object: id });

/**
 * The boards a card is tried on, in order — the first that offers anything is where it is played:
 *   main       my first main phase, nothing on the stack;
 *   respond    an opponent's turn, with a stack to answer: their artifact creature spell, their red instant (aimed at my
 *              creature), their blue instant (aimed at a player), their white-black enchantment spell, and their
 *              ability (aimed at me);
 *   mine       my main phase with my own creature spell and instant on the stack;
 *   charging   my declare attackers step: three of my creatures attack;
 *   attacking  my declare blockers step: one of the three is blocked;
 *   aftermath  my second main phase after that combat: an opponent lost life, a creature died, another was dealt damage;
 *   attacked   an opponent's declare attackers step: two of theirs attack me;
 *   defending  their declare blockers step: I block one.
 * `extra` are card definitions the game should know from the start (the dungeons a card may venture into).
 */
export function buildBoards(extra: Record<string, CardDef> = {}): Board[] {
  const cards = { ...extra, ...sandboxCards() };
  let g = createGame({
    players: SEATS.map((id) => ({ id, name: id === ME ? 'You' : id === P2 ? 'Opponent' : 'Other opponent', deck: DECK, commanders: ['Sandbox Commander'] })),
    cards,
    seed: 20261114,
    format: 'commander',
    firstPlayer: ME,
  }).state;
  // My fourth turn: nobody is in their first turns any more ("can't be cast during your first three turns").
  g = advance(g, (s) => s.turn >= 10 && s.active === ME && s.step === 'main1' && s.priority === ME && !s.pending && !s.stack.length);

  const toPlayer = (p: PlayerId) => ({ kind: 'player' as const, player: p });
  const waiting = (step: GameState['step']) => (s: GameState) => s.step === step && s.priority === ME && !s.pending && !s.stack.length;
  const main = copyOf(g);
  const a = populate(main, cards);

  let mine = must(main, { type: 'cast', player: ME, object: a['p1 hand creature']!, autoTap: true });
  mine = must(mine, { type: 'cast', player: ME, object: a['p1 hand instant']!, autoTap: true, targets: [[object(a['p2 bear']!)]] });
  if (mine.priority !== ME || mine.stack.length !== 2) throw new Error('sandbox setup: my own stack is not as built');

  // My combat: the Bear and the Drake get through, the Giant is blocked by a Golem that dies to it.
  const myCombat = (s: GameState): ChoiceAnswer | undefined =>
    s.pending?.kind === 'declare_attackers'
      ? { kind: 'declare_attackers', attacks: [a['p1 bear']!, a['p1 drake']!, a['p1 giant']!].map((attacker) => ({ attacker, target: toPlayer(P2) })) }
      : s.pending?.kind === 'declare_blockers' && s.pending.player === P2
        ? { kind: 'declare_blockers', blocks: [{ blocker: a['p2 golem']!, attacker: a['p1 giant']! }] }
        : undefined;
  const charging = advance(main, waiting('declare_attackers'), myCombat);
  const attacking = advance(charging, waiting('declare_blockers'), myCombat);
  const aftermath = advance(attacking, waiting('main2'), myCombat);

  // The opponent's turn that follows: the same board, their combat, and their spells to answer.
  g = advance(g, (s) => s.active === P2 && s.step === 'main1' && s.priority === P2 && !s.pending && !s.stack.length);
  const theirs = copyOf(g);
  const b = populate(theirs, cards);
  const theirCombat = (s: GameState): ChoiceAnswer | undefined =>
    s.pending?.kind === 'declare_attackers'
      ? { kind: 'declare_attackers', attacks: [b['p2 bear']!, b['p2 drake']!].map((attacker) => ({ attacker, target: toPlayer(ME) })) }
      : s.pending?.kind === 'declare_blockers' && s.pending.player === ME
        ? { kind: 'declare_blockers', blocks: [{ blocker: b['p1 golem']!, attacker: b['p2 bear']! }] }
        : undefined;
  const attacked = advance(theirs, waiting('declare_attackers'), theirCombat);
  const defending = advance(attacked, waiting('declare_blockers'), theirCombat);

  // (Their spells are paid for from a pool with exactly what they cost: which lands would pay isn't what is being set up.)
  let respond = copyOf(theirs);
  respond.players[P2]!.pool = { ...respond.players[P2]!.pool, W: 1, U: 1, B: 1, R: 1, C: 6 };
  respond = must(respond, { type: 'cast', player: P2, object: b['p2 hand creature']!, autoTap: true });
  respond = must(respond, { type: 'cast', player: P2, object: b['p2 hand instant']!, autoTap: true, targets: [[object(b['p1 soldier']!)]] });
  respond = must(respond, { type: 'cast', player: P2, object: b['p2 hand blue instant']!, autoTap: true, targets: [[toPlayer(P2)]] });
  respond = must(respond, { type: 'cast', player: P2, object: b['p2 hand enchantment']!, autoTap: true });
  const idol = legalActions(respond, P2).find((x) => x.type === 'activate' && x.object === b['p2 idol']);
  if (!idol || idol.type !== 'activate') throw new Error("sandbox setup: the opponent's ability isn't offered");
  respond = must(respond, { ...idol, targets: [[toPlayer(ME)]] });
  const stack = respond.stack.length;
  respond = advance(respond, (s) => s.priority === ME && !s.pending);
  if (respond.stack.length !== stack || stack !== 5) throw new Error('sandbox setup: the stack to respond to is not as built');

  return [
    { name: 'main', g: main, stack: 0 },
    { name: 'respond', g: respond, stack },
    { name: 'mine', g: mine, stack: 2 },
    { name: 'charging', g: charging, stack: 0 },
    { name: 'attacking', g: attacking, stack: 0 },
    { name: 'aftermath', g: aftermath, stack: 0 },
    { name: 'attacked', g: attacked, stack: 0 },
    { name: 'defending', g: defending, stack: 0 },
  ];
}

// ---------------------------------------------------------------------------
// What happened: labels, differences, fingerprints
// ---------------------------------------------------------------------------

/** Names for objects that stay the same from one run to the next: the card's name, whose it is, and which one of several. */
function labels(states: GameState[], self: string | undefined): (id: string) => string {
  const out = new Map<string, string>();
  const groups = new Map<string, GameObject[]>();
  for (const g of states) {
    for (const o of Object.values(g.objects)) {
      if (out.has(o.id)) continue;
      out.set(o.id, '');
      const key = `${o.token ? 'token ' : ''}${g.cards[o.card]?.name ?? o.card}@${o.owner}`;
      groups.set(key, [...(groups.get(key) ?? []), o]);
    }
  }
  for (const [key, os] of groups) {
    os.sort((x, y) => Number(x.id.slice(1)) - Number(y.id.slice(1)));
    os.forEach((o, i) => out.set(o.id, os.length > 1 ? `${key}#${i + 1}` : key));
  }
  if (self) out.set(self, 'self');
  return (id) => out.get(id) ?? id;
}

const named = (text: string, label: (id: string) => string): string => text.replace(/\bo\d+\b/g, (id) => label(id));

/** Parts of the state that change with every action, or only repeat what the rest says. */
const SKIP_STATE = new Set(['cards', 'players', 'objects', 'zones', 'priority', 'passed', 'clock', 'nextId', 'rng', 'stack', 'turnLog', 'lastTurnLog', 'lastKnown', 'resolving', 'triggers', 'heldEvents', 'castNames', 'lastTurnSpells']);
const SKIP_OBJECT = new Set(['timestamp', 'zcc', 'arrived', 'counterStamps', 'sick', 'id', 'cast', 'baseController', 'x']);

/**
 * What differs between two states, as short lines ("p2.life 40→37", "Sandbox Bear@p2: zone battlefield→graveyard"):
 * what a card did, in words a person can check against its text.
 */
export function differences(before: GameState, after: GameState, label: (id: string) => string): string[] {
  const out: string[] = [];
  const short = (v: unknown): string => {
    const s = v === undefined ? '∅' : named(typeof v === 'string' ? v : JSON.stringify(v), label);
    return s.length > 48 ? `${s.slice(0, 45)}…` : s;
  };
  const empty = (v: unknown): boolean => v === undefined || v === null || (typeof v === 'object' && !Object.keys(v as object).length);
  const walk = (path: string, x: unknown, y: unknown, skip?: ReadonlySet<string>): void => {
    if (x === y || (empty(x) && empty(y))) return;
    const jx = JSON.stringify(x);
    const jy = JSON.stringify(y);
    if (jx === jy) return;
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length) {
        const kinds = (y.length > x.length ? y.slice(x.length) : x.slice(y.length)).map((e) => (e && typeof e === 'object' ? String((e as { type?: unknown; kind?: unknown }).type ?? (e as { kind?: unknown }).kind ?? '') : '')).filter(Boolean);
        out.push(`${path}: ${x.length}→${y.length}${kinds.length ? ` (${[...new Set(kinds)].join(', ')})` : ''}`);
        return;
      }
      x.forEach((e, i) => walk(`${path}[${i}]`, e, y[i]));
      return;
    }
    if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x) && !Array.isArray(y)) {
      const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])].sort();
      for (const k of keys) if (!skip?.has(k)) walk(`${path}${path.endsWith(':') ? ' ' : '.'}${k}`, (x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k]);
      return;
    }
    out.push(`${path} ${short(x)}→${short(y)}`);
  };
  for (const p of before.order) walk(p, before.players[p], after.players[p]);
  const ids = [...new Set([...Object.keys(before.objects), ...Object.keys(after.objects)])].sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
  for (const id of ids) {
    const x = before.objects[id];
    const y = after.objects[id];
    if (!x && y) out.push(`+${label(id)} (${y.zone}${y.tapped ? ', tapped' : ''}${Object.keys(y.counters).length ? `, ${short(y.counters)}` : ''})`);
    else if (x && !y) out.push(`-${label(id)}`);
    else walk(`${label(id)}:`, x, y, SKIP_OBJECT);
  }
  // Zones say where things are, which the objects said already: what is left is the order of a library.
  for (const p of before.order) {
    const x = before.zones.library[p] ?? [];
    const y = after.zones.library[p] ?? [];
    const kept = new Set(x.filter((id) => y.includes(id)));
    if (x.filter((id) => kept.has(id)).join() !== y.filter((id) => kept.has(id)).join()) out.push(`${p}.library reordered`);
  }
  for (const k of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (!SKIP_STATE.has(k)) walk(k, (before as unknown as Record<string, unknown>)[k], (after as unknown as Record<string, unknown>)[k]);
  }
  return out;
}

const QUIET_EVENTS = new Set(['priority', 'passed']);
const DROP_EVENT_KEYS = new Set(['zcc', 'fromZcc', 'sourceZcc', 'manaBefore', 'entry']);

/** An event as text that doesn't depend on the ids objects happen to get. */
function eventText(e: GameEvent, label: (id: string) => string): string {
  if (e.type === 'resolved' || e.type === 'fizzled') {
    const entry = e.entry;
    return `${e.type} ${entry.kind === 'spell' ? label(entry.object) : `"${entry.text}"`}`;
  }
  return named(JSON.stringify(e, (k, v) => (DROP_EVENT_KEYS.has(k) ? undefined : v)), label);
}

const sha = (text: string): string => createHash('sha1').update(text).digest('hex').slice(0, 12);

const ART = new Set(['img', 'artist']);
/**
 * A token's card id carries a hash of its whole definition, its picture included (permanents.ts). Which printed token's
 * picture a token was given is not something a card does: in what is compared, the id says the rest of the definition.
 */
const tokenIds = (text: string, g: GameState): string =>
  text.replace(/token:[^":]+:[0-9a-z]+/g, (id) => {
    const def = g.cards[id];
    return def ? `token:${def.name}:${sha(JSON.stringify(def.faces, (k, v: unknown) => (ART.has(k) ? undefined : v)))}` : id;
  });

// ---------------------------------------------------------------------------
// Playing one card
// ---------------------------------------------------------------------------

export interface Run {
  /** What was played and how: "cast", "cast face 1", "cast evoke", "ability 0", "mana 1", "play land", "from graveyard: cast flashback". */
  label: string;
  board: BoardName;
  /** resolved, countered, fizzled, played, done, or how it stopped. */
  outcome: string;
  /** Where the card was at the end. */
  zone?: string;
  /** What changed while it resolved (capped). */
  did: string[];
  fp: string;
  /** With `trace`: the action as it was taken and every event, in order. */
  trace?: string[];
}

export interface CardReport {
  id: string;
  name: string;
  /** Certain problems: each one means the engine does not play this card. */
  issues: string[];
  /** Things to look at: they are wrong more often than not. */
  warnings: string[];
  /** How it went that is no fault: an ability this board gives no use for, a cost the board's lands can't pay. */
  notes: string[];
  runs: Run[];
  /** One fingerprint for everything every run saw. */
  fp: string;
  ms: number;
}

interface Played {
  run: Run;
  issues: string[];
  warnings: string[];
  notes: string[];
  /** The state at the end, when it got there. */
  end?: GameState;
  events: GameEvent[];
  /** The card's object in this run. */
  self: string;
  /** It resolved, and nothing is different for it. */
  nothing: boolean;
  /** Not played: what the engine said to it. */
  refused?: string;
}

const FLOOD = { W: 30, U: 30, B: 30, R: 30, G: 30, C: 30 };

function addToZone(g: GameState, card: CardDef, zone: 'hand' | 'graveyard'): string {
  const key = g.cards[card.name] && g.cards[card.name] !== card ? `checked:${card.name}` : card.name;
  g.cards[key] = card;
  return createObject(g, key, ME, zone).id;
}

const isMine = (a: Action, id: string): boolean => 'object' in a && a.object === id;

/** What kind of play an action is, without its choices: one run for each. */
function actionLabel(a: Action): string {
  switch (a.type) {
    case 'cast':
      return `cast${a.face ? ` face ${a.face}` : ''}${a.alt ? ` ${a.alt}` : ''}${a.kicked ? ' kicked' : ''}${a.extras?.length ? ` +${a.extras.join('+')}` : ''}`;
    case 'play_land':
      return `play land${a.face ? ` face ${a.face}` : ''}`;
    case 'activate':
      return `ability ${a.ability}`;
    case 'activate_mana':
      return `mana ${a.ability}`;
    case 'activate_manual':
      return `by hand ${a.line}`;
    case 'unlock':
      return `unlock ${a.half}`;
    default:
      return a.type;
  }
}

/**
 * The same play at an X worth playing with — 2, then 1 — with the choice the engine gives for that X, and last as it is
 * listed (the least X). The table offers each X in the listed range the same way.
 */
function xVariants(g: GameState, a: Action): Action[] {
  if ((a.type !== 'cast' && a.type !== 'activate') || a.xMax === undefined) return [a];
  const { xMax, ...rest } = a;
  const least = a.x ?? 0;
  const out: Action[] = [];
  for (const x of [2, 1]) {
    if (x <= least || x > xMax) continue;
    const choice = defaultChoiceAtX(g, a, x);
    if (!choice) continue;
    const { targets: _targets, modes: _modes, ...bare } = rest;
    out.push({ ...bare, x, ...choice } as Action);
  }
  out.push(rest as Action);
  return out;
}

/** The other mode choices of a modal spell or ability worth a run each: every mode on its own, or in pairs where two are required. */
function modeVariants(g: GameState, a: Action): Action[] {
  if (a.type !== 'cast' && a.type !== 'activate') return [];
  let menu;
  try {
    menu = choiceModes(g, a);
  } catch {
    return [];
  }
  if (!menu) return [];
  const usable = menu.options.map((o, i) => ({ o, i })).filter(({ o, i }) => !o.manual && !menu.used.includes(i)).map(({ i }) => i);
  const size = Math.max(1, menu.min);
  const sets: number[][] = [];
  for (let k = 0; k + size <= usable.length; k += size) sets.push(usable.slice(k, k + size));
  const out: Action[] = [];
  for (const modes of sets) {
    if (JSON.stringify(modes) === JSON.stringify(a.modes ?? [])) continue;
    try {
      const prompts = choicePrompts(g, { ...a, modes }, modes);
      if (prompts.some((pr) => pr.candidates.length < (pr.upTo ? (pr.min ?? 0) : pr.count))) continue;
      const { targets: _old, ...rest } = a;
      out.push({ ...rest, modes, ...(prompts.length ? { targets: bot.samplePrompts(prompts) } : {}) } as Action);
    } catch {
      /* a mode choice the engine refuses isn't one to try */
    }
  }
  return out.slice(0, 5);
}

/**
 * The same play aimed elsewhere: at what is tapped first, at what an opponent controls first, or at the last things that
 * can be chosen instead of the first. "Untap target creature" does nothing to the first creature on the board and
 * something to the tapped one; "exchange control of this and target permanent" nothing with one of my own.
 */
function retarget(g: GameState, a: Action, how: 'tapped' | 'theirs' | 'last'): Action | null {
  if ((a.type !== 'cast' && a.type !== 'activate') || !a.targets?.length) return null;
  try {
    const prompts = choicePrompts(g, a, a.modes);
    if (prompts.length !== a.targets.length) return null;
    const tappedFirst = (t: Target) => (t.kind === 'object' && g.objects[t.object]?.tapped ? 0 : 1);
    const theirsFirst = (t: Target) => (t.kind === 'object' ? (g.objects[t.object]?.controller === ME ? 1 : 0) : t.kind === 'player' ? (t.player === ME ? 1 : 0) : 0);
    const by = (rank: (t: Target) => number) => (pr: (typeof prompts)[number]) => ({ ...pr, candidates: [...pr.candidates].sort((x, y) => rank(x) - rank(y)) });
    const turned = how === 'tapped' ? prompts.map(by(tappedFirst)) : how === 'theirs' ? prompts.map(by(theirsFirst)) : prompts.map((pr) => ({ ...pr, candidates: [...pr.candidates].reverse() }));
    const targets = bot.samplePrompts(turned);
    return JSON.stringify(targets) === JSON.stringify(a.targets) ? null : ({ ...a, targets } as Action);
  } catch {
    return null;
  }
}

/** Events that say the game went on, not that anything was done. */
const ROUTINE = new Set(['priority', 'passed', 'resolved', 'fizzled', 'step']);

/**
 * Does one thing with the card and sees it through: the action, every choice it leads to, and passing until the stack is
 * back to what it was. `offered`: the action is one the engine listed, so a refusal is the engine's fault.
 */
function play(board: Board, start: GameState, self: string, action: Action, label: string, offered: boolean): Played {
  const issues: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const events: GameEvent[] = [];
  const run: Run = { label, board: board.name, outcome: 'unfinished', did: [], fp: '' };
  spared = new Set([self]);
  const fail = (outcome: string, issue?: string): Played => {
    run.outcome = outcome;
    if (issue) issues.push(`${label}: ${issue}`);
    run.fp = sha(JSON.stringify([label, board.name, outcome, issue ?? '']));
    return { run, issues, warnings, notes, events, self, nothing: false };
  };
  const crash = (err: unknown): Played => fail('crash', `crash: ${String((err as Error).message ?? err).split('\n')[0]}`);

  let g: GameState;
  try {
    const r = apply(start, action);
    if (!r.ok) {
      if (offered) return fail('refused', `offered, then refused: ${r.error}`);
      // Choices the sandbox put together itself from what the engine says can be chosen: the caller's to judge.
      return { ...fail('not tried'), refused: r.error };
    }
    g = r.state;
    events.push(...r.events);
  } catch (err) {
    return crash(err);
  }
  const cast = g;
  const own = events.length;
  let asked = 0;
  let agreed = 0;
  let byHand = false;
  for (let step = 0; ; step++) {
    const bad = checkInvariants(g);
    if (bad) return fail('broken state', `broken state: ${named(bad, labels([g], self))}`);
    if (g.over) break;
    if (step > 150) return fail('never settles', 'never settles: 150 choices and passes later it is still going');
    let next: Action;
    if (g.pending) {
      asked++;
      if (g.pending.kind === 'manual_resolution') byHand = true;
      const answer = bot.answerFor(g);
      if (!answer) return fail('stuck', `no answer to give for the choice "${g.pending.kind}"`);
      // "You may repeat this process any number of times": a few times.
      let a = answer.answer;
      if ((a.kind === 'may' && a.yes) || (a.kind === 'pay' && a.pay)) {
        if (++agreed > 4) a = a.kind === 'may' ? { kind: 'may', yes: false } : { kind: 'pay', pay: false };
      }
      next = { type: 'choose', player: answer.player, answer: a };
    } else if (g.stack.length > board.stack) {
      if (!g.priority) return fail('stuck', 'something is on the stack and nobody has priority');
      next = { type: 'pass', player: g.priority };
    } else break;
    try {
      let r = apply(g, next);
      // A cost the bot agreed to and can't pay, a free spell it can't cast after all: say no instead.
      if (!r.ok && next.type === 'choose') {
        const kind = next.answer.kind;
        const no: ChoiceAnswer | null = kind === 'pay' ? { kind: 'pay', pay: false } : kind === 'cast_free' ? { kind: 'cast_free', cast: false } : kind === 'may' ? { kind: 'may', yes: false } : null;
        if (no) r = apply(g, { type: 'choose', player: next.player, answer: no });
      }
      // An answer the bot's way of choosing can't get right: any answer the engine takes.
      for (let k = 0; !r.ok && next.type === 'choose' && k < 16; k++) {
        const other = dice.answerFor(g);
        if (other) r = apply(g, { type: 'choose', player: other.player, answer: other.answer });
      }
      if (!r.ok) return fail('stuck', next.type === 'choose' ? `the choice "${g.pending?.kind}" can't be answered: ${r.error}` : `passing is refused: ${r.error}`);
      g = r.state;
      events.push(...r.events);
    } catch (err) {
      return crash(err);
    }
  }

  const name = labels([cast, g], self);
  const o = g.objects[self];
  run.zone = o?.zone ?? 'gone';
  const mine = (e: GameEvent, type: 'resolved' | 'fizzled'): boolean =>
    e.type === type && (action.type === 'cast' ? e.entry.kind === 'spell' && e.entry.object === self : e.entry.kind === 'ability' && e.entry.source.id === self);
  // (A fizzled spell or ability is reported as resolved too, once it has left the stack.)
  const fizzled = events.some((e) => mine(e, 'fizzled'));
  const resolved = events.some((e) => mine(e, 'resolved'));
  const countered = events.some((e) => e.type === 'countered' && e.object === self);
  const stacked = action.type === 'cast' || action.type === 'activate' || action.type === 'activate_manual';
  run.outcome = !stacked ? (action.type === 'play_land' ? 'played' : 'done') : fizzled ? 'fizzled' : countered ? 'countered' : resolved ? 'resolved' : 'not resolved';
  if (g.over) run.outcome += ', game over';
  if (byHand) warnings.push(`${label}: asks to be resolved by hand`);

  const did = differences(cast, g, name).map((line) => tokenIds(line, g));
  const told = events.filter((e) => !QUIET_EVENTS.has(e.type)).map((e) => tokenIds(eventText(e, name), g));
  // A spell going where spells go is not what it did.
  const effects = did.filter((line) => !line.startsWith('self: zone stack→'));
  run.did = effects.slice(0, 8).map((line) => (line.length > 90 ? `${line.slice(0, 87)}…` : line));
  if (effects.length > 8) run.did.push(`… and ${effects.length - 8} more`);
  run.fp = sha(JSON.stringify([label, board.name, run.outcome, run.zone, did, told]));
  if (tracing) run.trace = [named(JSON.stringify(action), name), ...told];

  const later = events.slice(own).some((e) => !ROUTINE.has(e.type) && !(e.type === 'moved' && e.object === self && e.from === 'stack'));
  const arrived = action.type === 'cast' && events.some((e) => e.type === 'moved' && e.object === self && e.to === 'battlefield');
  let nothing = false;
  if (action.type === 'activate_mana') {
    if (!events.some((e) => e.type === 'mana_added')) notes.push(`${label}: adds no mana on this board`);
  } else if (stacked && run.outcome === 'resolved' && !arrived && !effects.length && !later && !asked) nothing = true;
  return { run, issues, warnings, notes, end: g, events, self, nothing };
}

/**
 * One way of playing the card. If it changes nothing, or fizzles, as the engine lists it, the same play is tried aimed at
 * other things; what comes back is the first try that did something, or the first try.
 */
function attempt(board: Board, fresh: () => { g: GameState; id: string }, listed: Action, label: string): Played {
  const s = fresh();
  const variants = xVariants(s.g, listed);
  let first = variants.at(-1)!;
  let p: Played | null = null;
  let refusedX = '';
  for (const v of variants) {
    const t = v === variants[0] ? s : fresh();
    const q = play(board, t.g, t.id, v, label, v === variants.at(-1));
    if (q.refused !== undefined) {
      refusedX ||= q.refused;
      continue;
    }
    first = v;
    p = q;
    break;
  }
  if (!p) throw new Error('unreachable: the listed action is always played');
  // The engine lists a range of X and takes only the least: with the choices it gives for the others, they are refused.
  if (refusedX && first === variants.at(-1)) p.issues.push(`${label}: X can only be ${(listed as { x?: number }).x ?? 0}, though up to ${(listed as { xMax?: number }).xMax} is offered: ${refusedX}`);
  if (!p.nothing && p.run.outcome !== 'fizzled') return p;
  for (const how of ['tapped', 'theirs', 'last'] as const) {
    const t = fresh();
    const again = retarget(t.g, first, how);
    if (!again) continue;
    const q = play(board, t.g, t.id, again, label, false);
    if (q.refused !== undefined) continue;
    if (q.issues.length || (!q.nothing && q.run.outcome !== 'fizzled')) return q;
  }
  if (p.nothing) p.warnings.push(`${label}: resolved and changed nothing`);
  else p.warnings.push(`${label}: fizzles as the engine lists it`);
  return p;
}

/** Why a permanent that resolved isn't on the battlefield, when the engine not knowing something about it is the reason. */
function leftAsItArrived(g: GameState, self: string, events: GameEvent[], face: FaceDef): string | null {
  const entered = events.some((e) => e.type === 'moved' && e.object === self && e.to === 'battlefield');
  const left = events.find((e) => e.type === 'moved' && e.object === self && e.from === 'battlefield');
  if (!entered || !left || left.type !== 'moved') return null;
  // Its own doing, or a choice made for it: a sacrifice (evoke, "sacrifice it unless"), an effect that names where it goes.
  if (events.some((e) => e.type === 'sacrificed' && e.object === self)) return null;
  const last = g.lastKnown?.[self];
  if (!last || left.to !== 'graveyard') return null;
  const types = last.types ?? [];
  if (types.includes('Creature') && last.toughness <= 0) return `enters and dies with ${last.toughness} toughness${face.toughness !== undefined && /\*/.test(face.toughness) ? ` (printed ${face.power}/${face.toughness})` : ''}`;
  if (types.includes('Planeswalker') && !(last.counters?.loyalty ?? 0)) return 'enters with no loyalty and is put into the graveyard';
  if (types.includes('Battle') && !(last.counters?.defense ?? 0)) return 'enters with no defense and is put into the graveyard';
  if ((last.subtypes ?? []).includes('Aura') && !last.attachedTo && !last.enchantedPlayer) return 'enters attached to nothing and is put into the graveyard';
  return null;
}

export interface CheckOptions {
  /** At most this many ways of playing one card from the hand (default 10). */
  maxRuns?: number;
  /** Keep every event of every run (for looking at one card). */
  trace?: boolean;
}

let tracing = false;

const firstLine = (err: unknown): string => String((err as Error).message ?? err).split('\n')[0]!;

/** Plays a card every way the engine offers, and reports. */
export function checkCard(card: CardDef, boards: Board[], opts: CheckOptions = {}): CardReport {
  const t0 = performance.now();
  const issues: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  const runs: Run[] = [];
  const limit = opts.maxRuns ?? 10;
  tracing = Boolean(opts.trace);
  learnCreatureTypes([card]);
  const main = boards[0]!;
  const unread = card.faces.some((f) => f.unparsed.length > 0 || (f.manualKeywords?.length ?? 0) > 0);
  seed = 1;

  const fresh = (board: Board, zone: 'hand' | 'graveyard', flood: boolean) => (): { g: GameState; id: string } => {
    const g = copyOf(board.g);
    if (flood) g.players[ME]!.pool = { ...g.players[ME]!.pool, ...FLOOD };
    return { g, id: addToZone(g, card, zone) };
  };
  const offers = (g: GameState, id: string): Action[] => legalActions(g, ME).filter((a) => isMine(a, id) && a.type !== 'activate_manual');
  const kindsOf = (acts: Action[]): Map<string, Action> => {
    const kinds = new Map<string, Action>();
    for (const a of acts) if (!kinds.has(actionLabel(a))) kinds.set(actionLabel(a), a);
    return kinds;
  };
  const keep = (p: Played): void => {
    warnings.push(...p.warnings);
    notes.push(...p.notes);
    if (p.refused !== undefined) {
      warnings.push(`${p.run.label}: these choices, each listed as possible, are refused together: ${p.refused}`);
      return;
    }
    runs.push(p.run);
    issues.push(...p.issues);
  };

  // From the hand: the first board that offers anything; with every color of mana to spare if none does.
  let found: { board: Board; flood: boolean; acts: Action[] } | null = null;
  try {
    for (const flood of [false, true]) {
      for (const board of boards) {
        const { g, id } = fresh(board, 'hand', flood)();
        const acts = offers(g, id);
        if (acts.length) {
          found = { board, flood, acts };
          break;
        }
      }
      if (found) break;
    }
  } catch (err) {
    issues.push(`crash listing what can be done with it: ${firstLine(err)}`);
  }

  let onBattlefield: { g: GameState; id: string } | null = null;
  if (found) {
    const { flood } = found;
    if (flood) notes.push('costs more mana of one color than the board has lands for');
    for (const [label, listed] of kindsOf(found.acts)) {
      if (runs.length >= limit) break;
      let board = found.board;
      let p = attempt(board, fresh(board, 'hand', flood), listed, label);
      // Nothing to do here ("return all attacking creatures", with no combat): the same play on the boards that follow.
      if (p.warnings.some((w) => w.endsWith('resolved and changed nothing'))) {
        for (const other of boards.slice(boards.indexOf(board) + 1)) {
          try {
            const s = fresh(other, 'hand', flood)();
            const same = offers(s.g, s.id).find((a) => actionLabel(a) === label);
            if (!same) continue;
            const q = attempt(other, fresh(other, 'hand', flood), same, label);
            if (q.issues.length || !q.nothing) {
              p = q;
              board = other;
              break;
            }
          } catch (err) {
            issues.push(`crash listing what can be done with it: ${firstLine(err)}`);
          }
        }
      }
      keep(p);
      const action = listed;
      if (p.end) {
        const face = card.faces[action.type === 'cast' || action.type === 'play_land' ? (action.face ?? 0) : 0] ?? card.faces[0]!;
        if (action.type === 'cast' && p.run.outcome === 'resolved' && p.run.zone !== 'battlefield') {
          const why = leftAsItArrived(p.end, p.self, p.events, face);
          // With a line unread, that line is what it lacks: nobody can play it. Read in full, it is this board (a
          // creature that counts something the board has none of) — or a reading that came out wrong.
          if (why && unread) issues.push(`${label}: ${why}, and a line the engine can't read is what it would need`);
          else if (why) warnings.push(`${label}: ${why} on this board`);
        }
        if (!onBattlefield && p.end.objects[p.self]?.zone === 'battlefield' && board.name === 'main' && !p.end.over && !p.end.pending && !p.end.stack.length && p.end.priority === ME) onBattlefield = { g: p.end, id: p.self };
      }
      // The other modes of a modal spell, each once.
      if (board === found.board) {
        const s = fresh(board, 'hand', flood)();
        for (const v of modeVariants(s.g, xVariants(s.g, listed).at(-1)!)) {
          if (runs.length >= limit) break;
          const t = fresh(board, 'hand', flood)();
          keep(play(board, t.g, t.id, v, `${label} modes ${(v as { modes?: number[] }).modes?.join('+')}`, false));
        }
      }
    }
  } else if (!issues.length) {
    // Nothing offered anywhere: what the engine says to simply casting it.
    const { g, id } = fresh(main, 'hand', true)();
    let why = '';
    try {
      const land = card.faces[0]!.types.includes('Land') && !card.faces[0]!.manaCost;
      const r = apply(g, land ? { type: 'play_land', player: ME, object: id } : { type: 'cast', player: ME, object: id, autoTap: true });
      why = r.ok ? 'the engine would take it, and never lists it' : r.error;
    } catch (err) {
      why = `crash: ${firstLine(err)}`;
    }
    // A card that is never cast from a hand, a spell with a condition or a target no board has: no fault of the card's.
    if (/has no mana cost, so it can[’']t be cast this way/.test(why)) notes.push('has no mana cost: it is not cast from a hand');
    else if (/can[’']t be cast now\.?$/.test(why)) notes.push('no board meets its condition to be cast');
    else if (/^Choose /.test(why)) notes.push(`no board has what it needs (${why})`);
    else if (/isn[’']t supported yet/.test(why)) issues.push(`can't be cast: ${why}`);
    else issues.push(`can't be played on any board: ${why}`);
  }

  // On the battlefield: each ability once, with its lands untapped again and, for a planeswalker, loyalty to spare.
  if (onBattlefield) {
    const base = copyOf(onBattlefield.g);
    const o = base.objects[onBattlefield.id]!;
    o.sick = false;
    o.tapped = false;
    for (const id of base.zones.battlefield) {
      const x = base.objects[id]!;
      if (x.controller === ME && base.cards[x.card]?.faces[x.face]?.types.includes('Land')) x.tapped = false;
    }
    if (o.counters.loyalty !== undefined) o.counters.loyalty = Math.max(o.counters.loyalty, 20);
    try {
      const kinds = kindsOf(legalActions(base, ME).filter((a) => (a.type === 'activate' || a.type === 'activate_mana') && a.object === o.id));
      for (const [label, listed] of kinds) {
        if (runs.length >= limit + 8) break;
        keep(attempt(main, () => ({ g: base, id: o.id }), listed, label));
        const variants = modeVariants(base, xVariants(base, listed).at(-1)!);
        for (const v of variants) keep(play(main, base, o.id, v, `${label} modes ${(v as { modes?: number[] }).modes?.join('+')}`, false));
      }
      const never = [...activatedAbilities(base, o).map((_, i) => `ability ${i}`), ...manaAbilities(base, o).map((_, i) => `mana ${i}`)].filter((label) => !kinds.has(label));
      for (const label of never) {
        const index = Number(label.split(' ')[1]);
        let why = '';
        try {
          const r = apply(base, label.startsWith('mana') ? { type: 'activate_mana', player: ME, object: o.id, ability: index, autoTap: true } : { type: 'activate', player: ME, object: o.id, ability: index, autoTap: true });
          why = r.ok ? 'the engine would take it, and never lists it' : r.error;
        } catch (err) {
          why = `crash: ${firstLine(err)}`;
        }
        notes.push(`${label}: not offered (${why})`);
      }
    } catch (err) {
      issues.push(`crash listing its abilities: ${firstLine(err)}`);
    }
  }

  // From the graveyard, for a card whose text speaks of one.
  if (card.faces.some((f) => /graveyard|flashback|escape|unearth|embalm|eternalize|disturb|jump-start|retrace|aftermath|encore|scavenge|dredge|recover/i.test(f.oracle))) {
    try {
      const s = fresh(main, 'graveyard', false)();
      for (const [label, listed] of [...kindsOf(offers(s.g, s.id))].slice(0, 4)) keep(attempt(main, fresh(main, 'graveyard', false), listed, `from graveyard: ${label}`));
    } catch (err) {
      issues.push(`crash listing what it does from the graveyard: ${firstLine(err)}`);
    }
  }

  const unique = <T>(xs: T[]): T[] => [...new Set(xs)];
  return {
    id: card.id,
    name: card.name,
    issues: unique(issues),
    warnings: unique(warnings),
    notes: unique(notes),
    runs,
    fp: sha(JSON.stringify([runs.map((r) => r.fp), issues, warnings, notes])),
    ms: Math.round(performance.now() - t0),
  };
}
