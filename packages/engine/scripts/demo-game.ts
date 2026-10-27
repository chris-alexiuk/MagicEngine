/**
 * Plays a complete two-player game between two simple bots and records it.
 *
 *   tsx scripts/demo-game.ts <cards.json.gz> <out.json> [seed]
 *
 * The bots are demo drivers, not opponents: they play a land, cast their biggest
 * spell, point removal at the best target, attack when it's safe and block when
 * it's worth it. Everything else is the real engine: every frame is the state
 * after one action.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { reparseDB } from '@mtg/compiler';
import type { CardDB, CardDef } from '@mtg/schema';
import {
  blockDeclarationProblem,
  activatedAbilities,
  apply,
  blockProblem,
  createGame,
  flatten,
  hasKeyword,
  legalActions,
  power,
  spellPrograms,
  targetCandidates,
  toughness,
  type Action,
  type AttackTarget,
  type GameEvent,
  type GameObject,
  type GameState,
  type PlayerId,
  type Step,
  type Target,
  type TargetPrompt,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

const DECKS: Record<PlayerId, { name: string; cards: [string, number][] }> = {
  alice: {
    name: 'Alice',
    cards: [
      ['Forest', 9], ['Mountain', 8],
      ['Llanowar Elves', 3], ['Grizzly Bears', 3], ['Kalonian Tusker', 2], ['Centaur Courser', 3],
      ['Gnarled Mass', 2], ['Hill Giant', 1], ['Elvish Visionary', 2], ['Colossal Dreadmaw', 3],
      ['Craw Wurm', 1], ['Lightning Bolt', 3],
    ],
  },
  bob: {
    name: 'Bob',
    cards: [
      ['Plains', 9], ['Swamp', 8],
      ['Savannah Lions', 2], ['Typhoid Rats', 3], ['Knight of Meadowgrain', 2], ['White Knight', 2],
      ['Child of Night', 3], ['Gravedigger', 1], ['Vampire Nighthawk', 3], ['Leonin Skyhunter', 2],
      ['Pacifism', 2], ['Serra Angel', 2], ['Baneslayer Angel', 1],
    ],
  },
};

// ---------------------------------------------------------------------------
// Bot helpers
// ---------------------------------------------------------------------------

const opponent = (g: GameState, p: PlayerId) => g.order.find((x) => x !== p && !g.players[x]!.lost)!;
const def = (g: GameState, o: GameObject) => g.cards[o.card]!;
const isLand = (g: GameState, o: GameObject) => def(g, o).faces[0]!.types.includes('Land');
const creaturesOf = (g: GameState, p: PlayerId) =>
  g.zones.battlefield.map((id) => g.objects[id]!).filter((o) => o.controller === p && def(g, o).faces[0]!.types.includes('Creature'));

/** Would `a` kill `b` in a straight fight? */
function kills(g: GameState, a: GameObject, b: GameObject): boolean {
  const pa = power(g, a);
  return pa > 0 && (hasKeyword(g, a, 'deathtouch') || pa >= toughness(g, b) - b.damage);
}

/** Does `a` survive fighting `b`? First strike that kills first means no damage back. */
function survives(g: GameState, a: GameObject, b: GameObject): boolean {
  const aFirst = hasKeyword(g, a, 'first_strike') || hasKeyword(g, a, 'double_strike');
  const bFirst = hasKeyword(g, b, 'first_strike') || hasKeyword(g, b, 'double_strike');
  if (aFirst && !bFirst && kills(g, a, b)) return true;
  return !kills(g, b, a);
}

function chooseAttacks(g: GameState, me: PlayerId, attackers: string[]): { attacker: string; target: AttackTarget }[] {
  const opp = opponent(g, me);
  const blockers = creaturesOf(g, opp).filter((o) => !o.tapped);
  const total = attackers.reduce((n, id) => n + power(g, g.objects[id]!), 0);
  const alpha = total >= g.players[opp]!.life && blockers.length === 0;
  return attackers
    .filter((id) => {
      const a = g.objects[id]!;
      if (power(g, a) <= 0) return false;
      if (alpha) return true;
      // Safe if no available blocker can kill it and live.
      return !blockers.some((b) => !blockProblem(g, b, a) && kills(g, b, a) && survives(g, b, a));
    })
    .map((attacker) => ({ attacker, target: { kind: 'player', player: opp } as AttackTarget }));
}

function chooseBlocks(g: GameState, me: PlayerId, blockers: string[], attackers: string[]) {
  const free = new Set(blockers);
  const blocks: { blocker: string; attacker: string }[] = [];
  const sorted = [...attackers].sort((x, y) => power(g, g.objects[y]!) - power(g, g.objects[x]!));
  let incoming = sorted.reduce((n, id) => n + power(g, g.objects[id]!), 0);
  for (const aid of sorted) {
    const a = g.objects[aid]!;
    if (hasKeyword(g, a, 'menace')) continue;
    const able = [...free].map((id) => g.objects[id]!).filter((b) => !blockProblem(g, b, a));
    const good = able.find((b) => kills(g, b, a) && survives(g, b, a));
    const wall = able.find((b) => survives(g, b, a));
    const trade = power(g, a) >= 3 ? able.find((b) => kills(g, b, a)) : undefined;
    const lethal = incoming >= g.players[me]!.life;
    const chump = lethal ? able.sort((x, y) => power(g, x) - power(g, y))[0] : undefined;
    const pick = good ?? wall ?? trade ?? chump;
    if (pick) {
      free.delete(pick.id);
      blocks.push({ blocker: pick.id, attacker: aid });
      if (!hasKeyword(g, a, 'trample')) incoming -= power(g, a);
    }
  }
  return blocks;
}

/** How much the bot wants to point a harmful spell or ability at a target (higher is better, ≤ 0 means don't). */
function harmScore(g: GameState, me: PlayerId, t: Target, damage: number | null): number {
  if (t.kind === 'player') return t.player === me ? -100 : g.players[t.player]!.life <= (damage ?? 0) ? 1000 : 1;
  if (t.kind === 'ability') return 0;
  const o = g.objects[t.object]!;
  if (o.controller === me) return -100;
  const isCreature = def(g, o).faces[o.face]!.types.includes('Creature');
  if (!isCreature) return 0.5;
  if (damage !== null && toughness(g, o) - o.damage > damage) return -1; // it wouldn't die
  return 2 + power(g, o) + (hasKeyword(g, o, 'flying') ? 2 : 0);
}

/** Picks targets: harmful effects at opponents' best stuff, helpful ones at our own. */
function pickTargets(g: GameState, me: PlayerId, prompts: TargetPrompt[], effects: { type: string; amount?: unknown }[]): Target[][] | null {
  const harmful = effects.some((e) => ['deal_damage', 'destroy', 'move', 'tap', 'lose_life', 'discard'].includes(e.type));
  const damage = effects.find((e) => e.type === 'deal_damage')?.amount;
  return prompts.map((p) => {
    const scored = p.candidates
      .map((t) => ({ t, s: harmful ? harmScore(g, me, t, typeof damage === 'number' ? damage : null) : -harmScore(g, me, t, null) }))
      .sort((a, b) => b.s - a.s);
    const good = scored.filter((x) => x.s > 0).map((x) => x.t);
    return (p.upTo ? good : scored.map((x) => x.t)).slice(0, p.count);
  });
}

function promptsFor(g: GameState, me: PlayerId, a: Extract<Action, { type: 'cast' | 'activate' }>) {
  const o = g.objects[a.object]!;
  const program =
    a.type === 'cast'
      ? (() => {
          const face = def(g, o).faces[a.face ?? 0]!;
          const enchant = face.keywords.find((k) => k.id === 'enchant' && k.filter);
          if (enchant) return { specs: [{ what: 'object' as const, filter: enchant.filter!, text: 'enchant' }], effects: [{ type: 'destroy' }] };
          const programs = spellPrograms(face);
          return programs ? flatten(programs, a.modes) : null;
        })()
      : flatten([activatedAbilities(g, o)[a.ability]!], a.modes);
  if (!program) return null;
  const prompts: TargetPrompt[] = program.specs.map((spec) => ({
    text: spec.text,
    count: spec.count ?? 1,
    upTo: Boolean(spec.upTo),
    candidates: targetCandidates(g, me, spec, o),
  }));
  return { prompts, effects: program.effects };
}

/** One decision for whoever has to act. */
function decide(g: GameState): { action: Action; note?: string } | null {
  const p = g.pending;
  if (p) {
    const me = p.player;
    switch (p.kind) {
      case 'mulligan': {
        const lands = g.zones.hand[me]!.filter((id) => isLand(g, g.objects[id]!)).length;
        const keep = (lands >= 2 && lands <= 5) || g.players[me]!.mulligans >= 1;
        return { action: { type: 'choose', player: me, answer: { kind: 'mulligan', keep } } };
      }
      case 'bottom_cards': {
        const hand = [...g.zones.hand[me]!].sort((x, y) => def(g, g.objects[y]!).cmc - def(g, g.objects[x]!).cmc);
        return { action: { type: 'choose', player: me, answer: { kind: 'bottom_cards', objects: hand.slice(0, p.count) } } };
      }
      case 'discard_to_hand_size': {
        const hand = [...g.zones.hand[me]!].sort((x, y) => def(g, g.objects[y]!).cmc - def(g, g.objects[x]!).cmc);
        return { action: { type: 'choose', player: me, answer: { kind: 'discard_to_hand_size', objects: hand.slice(0, p.count) } } };
      }
      case 'legend_rule':
        return { action: { type: 'choose', player: me, answer: { kind: 'legend_rule', keep: p.objects[0]! } } };
      case 'declare_attackers':
        return { action: { type: 'choose', player: me, answer: { kind: 'declare_attackers', attacks: chooseAttacks(g, me, p.attackers) } } };
      case 'declare_blockers': {
        const blocks = chooseBlocks(g, me, p.blockers, p.attackers);
        // The heuristic doesn't know about requirements ("must be blocked if able"); fall back to none.
        return { action: { type: 'choose', player: me, answer: { kind: 'declare_blockers', blocks: blockDeclarationProblem(g, me, blocks) ? [] : blocks } } };
      }
      case 'assign_combat_damage':
        return {
          action: {
            type: 'choose',
            player: me,
            answer: { kind: 'assign_combat_damage', assignments: Object.fromEntries(p.choices.map((c) => [c.attacker, c.suggested])) },
          },
        };
      case 'manual_resolution':
        return { action: { type: 'choose', player: me, answer: { kind: 'manual_resolution', done: true } } };
      case 'trigger_targets': {
        const t = g.triggers.find((x) => x.id === p.trigger)!;
        const targets = pickTargets(g, me, p.prompts, t.ability.effects);
        return { action: { type: 'choose', player: me, answer: { kind: 'trigger_targets', targets: targets ?? [] } } };
      }
      case 'may':
        return { action: { type: 'choose', player: me, answer: { kind: 'may', yes: true } } };
      case 'pay':
        return { action: { type: 'choose', player: me, answer: { kind: 'pay', pay: false } } };
      case 'scry':
        return { action: { type: 'choose', player: me, answer: { kind: 'scry', top: p.objects, bottom: [] } } };
      case 'surveil':
        return { action: { type: 'choose', player: me, answer: { kind: 'surveil', top: p.objects, graveyard: [] } } };
      case 'discard': {
        const hand = [...g.zones.hand[me]!].sort((x, y) => def(g, g.objects[y]!).cmc - def(g, g.objects[x]!).cmc);
        return { action: { type: 'choose', player: me, answer: { kind: 'discard', objects: hand.slice(0, p.count) } } };
      }
      case 'sacrifice': {
        // Least valuable first.
        const worst = [...p.candidates].sort((x, y) => def(g, g.objects[x]!).cmc - def(g, g.objects[y]!).cmc);
        return { action: { type: 'choose', player: me, answer: { kind: 'sacrifice', objects: worst.slice(0, p.count) } } };
      }
      case 'search':
        return { action: { type: 'choose', player: me, answer: { kind: 'search', objects: p.candidates.slice(0, p.count) } } };
      case 'proliferate':
        // Our own permanents' counters, and opponents' poison.
        return {
          action: {
            type: 'choose',
            player: me,
            answer: { kind: 'proliferate', objects: p.objects.filter((id) => g.objects[id]!.controller === me), players: p.players.filter((x) => x !== me) },
          },
        };
      case 'choose_objects':
        return { action: { type: 'choose', player: me, answer: { kind: 'choose_objects', objects: p.candidates.slice(0, p.min || 1) } } };
      case 'as_enters': {
        // Pay life for an untapped land while it's cheap; reveal when possible; otherwise the first option.
        if (p.choice === 'pay_life') return { action: { type: 'choose', player: me, answer: { kind: 'as_enters', pay: g.players[me]!.life > 10 } } };
        if (p.choice === 'reveal') return { action: { type: 'choose', player: me, answer: { kind: 'as_enters', reveal: p.candidates?.[0] ?? null } } };
        return { action: { type: 'choose', player: me, answer: { kind: 'as_enters', choice: p.options![0]! } } };
      }
    }
  }

  const me = g.priority;
  if (!me) return null;
  const options = legalActions(g, me);
  const myMain = g.active === me && (g.step === 'main1' || g.step === 'main2') && g.stack.length === 0;
  if (myMain) {
    const land = options.find((a) => a.type === 'play_land');
    if (land) return { action: land };
    const casts = options
      .filter((a): a is Extract<Action, { type: 'cast' }> => a.type === 'cast')
      .map((a) => {
        // Re-aim targeted spells; skip them when there's nothing worth hitting.
        const info = promptsFor(g, me, a);
        if (!info || !info.prompts.length) return { a, card: def(g, g.objects[a.object]!), worth: true };
        const targets = pickTargets(g, me, info.prompts, info.effects)!;
        const harmful = info.effects.some((e) => ['deal_damage', 'destroy'].includes(e.type));
        const worth = targets.every((ts) => ts.length > 0) && targets.flat().every((t) => harmScore(g, me, t, harmful ? 3 : null) > (harmful ? 1.5 : -50));
        return { a: { ...a, targets }, card: def(g, g.objects[a.object]!), worth };
      })
      .filter((x) => x.worth)
      .sort((x, y) => y.card.cmc - x.card.cmc);
    if (casts[0]) return { action: casts[0].a };
  }
  return { action: { type: 'pass', player: me } };
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

const STEP_RULE: Record<Step, string> = {
  untap: '502.3',
  upkeep: '503.1',
  draw: '504.1',
  main1: '505.1',
  beginning_of_combat: '507.1',
  declare_attackers: '508.1',
  declare_blockers: '509.1',
  combat_damage: '510.1',
  end_of_combat: '511.1',
  main2: '505.1',
  end: '513.1',
  cleanup: '514.1',
};
const STEP_NAME: Record<Step, string> = {
  untap: 'Untap',
  upkeep: 'Upkeep',
  draw: 'Draw',
  main1: 'First main phase',
  beginning_of_combat: 'Beginning of combat',
  declare_attackers: 'Declare attackers',
  declare_blockers: 'Declare blockers',
  combat_damage: 'Combat damage',
  end_of_combat: 'End of combat',
  main2: 'Second main phase',
  end: 'End step',
  cleanup: 'Cleanup',
};

interface LogLine {
  text: string;
  rule?: string;
  kind: 'turn' | 'step' | 'play' | 'combat' | 'damage' | 'life' | 'death' | 'manual' | 'end' | 'info';
}

function narrate(g: GameState, before: GameState, events: GameEvent[], note?: string): LogLine[] {
  const name = (id: string) => {
    const o = g.objects[id] ?? before.objects[id];
    return o ? (g.cards[o.card] ?? before.cards[o.card])!.faces[o.face]?.name ?? o.card : id;
  };
  const who = (p: string) => g.players[p]!.name;
  const target = (t: AttackTarget) => (t.kind === 'player' ? who(t.player) : name(t.object));
  const out: LogLine[] = [];
  if (note) out.push({ text: note, kind: 'manual' });
  for (const e of events) {
    switch (e.type) {
      case 'turn_began':
        out.push({ text: `Turn ${e.turn} — ${who(e.player)}`, kind: 'turn' });
        break;
      case 'step':
        out.push({ text: STEP_NAME[e.step], rule: STEP_RULE[e.step], kind: 'step' });
        break;
      case 'mulligan':
        out.push({ text: `${who(e.player)} mulligans (now ${e.count})`, rule: '103.5', kind: 'info' });
        break;
      case 'kept':
        out.push({ text: `${who(e.player)} keeps their hand`, rule: '103.5', kind: 'info' });
        break;
      case 'drew':
        out.push({ text: `${who(e.player)} draws ${name(e.object)}`, kind: 'info' });
        break;
      case 'land_played':
        out.push({ text: `${who(e.player)} plays ${name(e.object)}`, rule: '305.1', kind: 'play' });
        break;
      case 'cast': {
        const entry = g.stack.find((x) => x.kind === 'spell' && x.object === e.object);
        const aimed = entry?.targets.flat().map((t) => (t.kind === 'player' ? who(t.player) : t.kind === 'ability' ? 'an ability' : name(t.id))) ?? [];
        out.push({ text: `${who(e.player)} casts ${name(e.object)}${aimed.length ? ` targeting ${aimed.join(', ')}` : ''}`, rule: '601.2', kind: 'play' });
        break;
      }
      case 'resolved':
        if (e.entry.kind === 'spell') {
          const o = g.objects[e.entry.object];
          const perm = o?.zone === 'battlefield';
          // CR 608.3c: an Aura spell enters attached to what it targeted; CR 608.3a: other permanents just enter.
          const rule = perm ? (e.entry.program?.specs.length ? '608.3c' : '608.3a') : '608.2n';
          out.push({ text: `${name(e.entry.object)} resolves`, rule, kind: 'play' });
        } else out.push({ text: `${e.entry.sourceName}’s ability resolves`, rule: '608.2', kind: 'play' });
        break;
      case 'attacks_declared':
        out.push(
          e.attacks.length
            ? { text: `${who(g.active)} attacks: ${e.attacks.map((x) => `${name(x.attacker)} → ${target(x.target)}`).join(', ')}`, rule: '508.1', kind: 'combat' }
            : { text: `${who(g.active)} doesn’t attack`, rule: '508.8', kind: 'combat' },
        );
        break;
      case 'blocks_declared':
        out.push(
          e.blocks.length
            ? { text: `${who(e.player)} blocks: ${e.blocks.map((x) => `${name(x.blocker)} blocks ${name(x.attacker)}`).join(', ')}`, rule: '509.1', kind: 'combat' }
            : { text: `${who(e.player)} doesn’t block`, rule: '509.1', kind: 'combat' },
        );
        break;
      case 'damage':
        out.push({
          text: `${name(e.source)} deals ${e.amount} damage to ${e.to.kind === 'player' ? who(e.to.player) : name(e.to.object)}`,
          rule: e.combat ? '510.2' : '120.3',
          kind: 'damage',
        });
        break;
      case 'life':
        if (e.delta > 0) out.push({ text: `${who(e.player)} gains ${e.delta} life`, rule: '119.3', kind: 'life' });
        break;
      case 'moved':
        if (e.from === 'battlefield' && e.to === 'graveyard' && !(g.cards[e.card] ?? before.cards[e.card])!.faces[e.face]!.types.includes('Creature')) {
          out.push({ text: `${name(e.object)} is put into the graveyard`, rule: '704.5m', kind: 'death' });
          break;
        }
        if (e.from === 'graveyard' && e.to === 'hand') {
          out.push({ text: `${name(e.object)} returns to ${who(g.objects[e.object]?.owner ?? '')}’s hand`, kind: 'play' });
          break;
        }
        if (e.from === 'battlefield' && e.to === 'graveyard') {
          if (note) {
            out.push({ text: `${name(e.object)} is put into the graveyard`, kind: 'death' });
            break;
          }
          // Name the state-based action that killed it: deathtouch (704.5h) or lethal damage (704.5g).
          const touched = events.some(
            (d) =>
              d.type === 'damage' &&
              d.to.kind === 'permanent' &&
              d.to.object === e.object &&
              (g.cards[(g.objects[d.source] ?? before.objects[d.source])!.card]!.faces[0]!.keywords.some((k) => k.id === 'deathtouch')),
          );
          out.push({ text: `${name(e.object)} dies${touched ? ' (deathtouch)' : ''}`, rule: touched ? '704.5h' : '704.5g', kind: 'death' });
        }
        break;
      case 'triggered':
        out.push({ text: `${name(e.source)} triggers: ${e.text}`, rule: '603.3', kind: 'play' });
        break;
      case 'attached':
        out.push({ text: `${name(e.object)} is attached to ${name(e.to)}`, rule: '303.4b', kind: 'play' });
        break;
      case 'fizzled':
        out.push({ text: `${e.entry.kind === 'spell' ? name(e.entry.object) : e.entry.sourceName} doesn’t resolve: its target is gone`, rule: '608.2b', kind: 'info' });
        break;
      case 'player_lost':
        out.push({ text: `${who(e.player)} loses the game (${e.reason})`, rule: e.reason.startsWith('life') ? '704.5a' : '704.5b', kind: 'end' });
        break;
      case 'game_over':
        out.push({ text: e.winner ? `${who(e.winner)} wins` : 'The game is a draw', rule: '104.2a', kind: 'end' });
        break;
    }
  }
  return out;
}

interface Frame {
  action: string;
  log: LogLine[];
  turn: number;
  active: PlayerId;
  step: Step;
  priority: PlayerId | null;
  pending: { kind: string; player: PlayerId } | null;
  players: { id: PlayerId; life: number; library: number; hand: string[]; graveyard: string[]; pool: string }[];
  battlefield: { id: string; ctrl: PlayerId; tapped: boolean; damage: number; sick: boolean; attacking?: string; blocking?: string }[];
  stack: { id?: string; text?: string; ctrl: PlayerId }[];
}

function snapshot(g: GameState, action: string, log: LogLine[]): Frame {
  const combat = g.combat;
  return {
    action,
    log,
    turn: g.turn,
    active: g.active,
    step: g.step,
    priority: g.priority,
    pending: g.pending ? { kind: g.pending.kind, player: g.pending.player } : null,
    players: g.order.map((p) => {
      const ps = g.players[p]!;
      const pool = Object.entries(ps.pool).flatMap(([c, n]) => Array.from({ length: n }, () => `{${c}}`)).join('');
      return { id: p, life: ps.life, library: g.zones.library[p]!.length, hand: [...g.zones.hand[p]!], graveyard: [...g.zones.graveyard[p]!], pool };
    }),
    battlefield: g.zones.battlefield.map((id) => {
      const o = g.objects[id]!;
      const atk = combat?.attackers[id];
      const blk = combat?.blockers[id];
      return {
        id,
        ctrl: o.controller,
        tapped: o.tapped,
        damage: o.damage,
        sick: o.sick,
        ...(atk ? { attacking: atk.target.kind === 'player' ? atk.target.player : atk.target.object } : {}),
        ...(blk ? { blocking: blk.blocking } : {}),
      };
    }),
    stack: g.stack.map((e) => (e.kind === 'spell' ? { id: e.object, ctrl: e.controller } : { text: e.text, ctrl: e.controller })),
  };
}

function describe(g: GameState, a: Action): string {
  const who = g.players[a.player]!.name;
  const name = (id: string) => g.cards[g.objects[id]!.card]!.name;
  switch (a.type) {
    case 'pass':
      return `${who} passes`;
    case 'play_land':
      return `${who} plays ${name(a.object)}`;
    case 'cast':
      return `${who} casts ${name(a.object)}`;
    case 'choose':
      return `${who}: ${a.answer.kind.replace(/_/g, ' ')}`;
    case 'manual':
      return `${who} makes a manual move`;
    default:
      return `${who}: ${a.type}`;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const [dbPath, outPath, seedArg] = process.argv.slice(2).filter((a) => a !== '--');
if (!dbPath || !outPath) throw new Error('usage: demo-game.ts <cards.json.gz> <out.json> [seed]');
let raw = readFileSync(dbPath);
if (raw[0] === 0x1f && raw[1] === 0x8b) raw = gunzipSync(raw);
// Recompile the oracle text with the current grammar, so the demo always shows what the engine can do now.
const db = reparseDB(JSON.parse(raw.toString('utf8')) as CardDB);
const byName = new Map(db.cards.map((c) => [c.name, c]));

const cards: Record<string, CardDef> = {};
const players = Object.entries(DECKS).map(([id, deck]) => ({
  id,
  name: deck.name,
  deck: deck.cards.flatMap(([n, count]) => {
    const card = byName.get(n);
    if (!card) throw new Error(`card not found: ${n}`);
    cards[n] = card;
    return Array.from({ length: count }, () => n);
  }),
}));

const seed = Number(seedArg ?? 7);
let { state: g, events } = createGame({ players, cards, seed, firstPlayer: 'alice' });
const frames: Frame[] = [snapshot(g, 'The game begins', narrate(g, g, events))];
// Object → card, collected as we go: a player who leaves the game takes their objects with them (CR 800.4a).
const objects: Record<string, string> = {};
const remember = (s: GameState) => {
  for (const o of Object.values(s.objects)) objects[o.id] = o.card;
};
remember(g);

for (let i = 0; i < 5000 && !g.over; i++) {
  const choice = decide(g);
  if (!choice) break;
  const before = g;
  const r = apply(g, choice.action);
  if (!r.ok) throw new Error(`bot made an illegal move (${describe(g, choice.action)}): ${r.error}`);
  g = r.state;
  remember(g);
  frames.push(snapshot(g, describe(before, choice.action), narrate(g, before, r.events, choice.note)));
}

const replay = {
  meta: {
    seed,
    winner: g.winner ? g.players[g.winner]!.name : null,
    turns: g.turn,
    actions: frames.length - 1,
    rulesCited: undefined as number | undefined,
  },
  players: g.order.map((p) => ({ id: p, name: g.players[p]!.name })),
  cards: Object.fromEntries(
    Object.values(cards).map((c) => {
      const f = c.faces[0]!;
      return [
        c.name,
        {
          cost: f.manaCost,
          type: f.typeLine,
          text: f.oracle,
          pt: f.power !== undefined ? `${f.power}/${f.toughness}` : undefined,
          colors: f.colors,
          img: f.img,
          kw: f.keywords.map((k) => [k.id.replace(/_/g, ' '), k.text, k.n, k.cost].filter((x) => x !== undefined).join(' ')),
          automation: c.automation,
          land: f.types.includes('Land'),
        },
      ];
    }),
  ),
  objects,
  frames,
};
writeFileSync(outPath, JSON.stringify(replay));
console.log(
  `${replay.meta.winner ?? 'nobody'} won on turn ${g.turn} after ${frames.length - 1} actions; ` +
    `${(JSON.stringify(replay).length / 1e6).toFixed(2)} MB → ${outPath}`,
);
