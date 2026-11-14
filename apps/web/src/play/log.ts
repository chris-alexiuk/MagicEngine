import type { AttackTarget, DamageRecipient, GameEvent, GameObject, GameState, ManualOp, PlayerId, Step, TargetRef, ZoneName } from '@mtg/engine';
import { manaSymbols, spendText } from './mana-text';

/**
 * The game log, written from engine events. Hidden information stays hidden: a card moving between hidden zones
 * (a draw, a tutor) is named only in a line its owner sees.
 */

export type LogKind = 'turn' | 'play' | 'combat' | 'damage' | 'life' | 'death' | 'info' | 'manual' | 'end' | 'error';

export interface LogLine {
  id: number;
  turn: number;
  kind: LogKind;
  text: string;
  /** Shown only to this player (their own hidden cards). */
  only?: PlayerId;
  /** Not shown to this player: they get a line of their own that says more ("You draw Forest."). */
  not?: PlayerId;
}

/** Whether a log line is for this viewer (`all`: an open-hands table, where every private line shows). */
export function lineFor(l: LogLine, viewer: PlayerId | null, all = false): boolean {
  if (all) return l.not === undefined;
  return (!l.only || l.only === viewer) && (l.not === undefined || l.not !== viewer);
}

export const STEP_NAME: Record<Step, string> = {
  untap: 'Untap',
  upkeep: 'Upkeep',
  draw: 'Draw',
  main1: 'Main 1',
  beginning_of_combat: 'Beginning of combat',
  declare_attackers: 'Declare attackers',
  declare_blockers: 'Declare blockers',
  combat_damage: 'Combat damage',
  end_of_combat: 'End of combat',
  main2: 'Main 2',
  end: 'End step',
  cleanup: 'Cleanup',
};

const PUBLIC_ZONES: ZoneName[] = ['battlefield', 'graveyard', 'stack', 'exile', 'command'];

function objectOf(id: string, ...states: GameState[]): GameObject | undefined {
  for (const g of states) if (g.objects[id]) return g.objects[id];
  return undefined;
}

/** A card's name as everyone sees it (face-down and hidden-exile cards stay anonymous). */
export function publicName(id: string, ...states: GameState[]): string {
  const o = objectOf(id, ...states);
  if (!o) return 'a card';
  if (o.faceDown && (o.zone === 'battlefield' || o.zone === 'stack')) return 'a face-down creature';
  if (o.zone === 'exile' && (o.hiddenFor !== undefined || o.faceDown || o.foretold !== undefined)) return 'a face-down card';
  return realName(id, ...states);
}

export function realName(id: string, ...states: GameState[]): string {
  const o = objectOf(id, ...states);
  if (!o) return 'a card';
  for (const g of states) {
    const key = o.copyOf?.card ?? o.card;
    const def = g.cards[key];
    if (def) return def.faces[o.copyOf?.face ?? o.face]?.name ?? def.name;
  }
  return o.card;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function narrate(before: GameState, after: GameState, events: GameEvent[], nextId: () => number): LogLine[] {
  const out: LogLine[] = [];
  const turn = after.turn;
  const push = (kind: LogKind, text: string, only?: PlayerId, not?: PlayerId) => out.push({ id: nextId(), turn, kind, text, ...(only ? { only } : {}), ...(not ? { not } : {}) });
  const who = (p: PlayerId) => after.players[p]?.name ?? before.players[p]?.name ?? p;
  const name = (id: string) => publicName(id, after, before);
  const target = (t: AttackTarget) => (t.kind === 'player' ? who(t.player) : name(t.object));
  const recipient = (r: DamageRecipient) => (r.kind === 'player' ? who(r.player) : name(r.object));
  const targetText = (t: TargetRef) => (t.kind === 'player' ? who(t.player) : t.kind === 'ability' ? 'an ability' : name(t.id));
  const landPlays = new Set(events.flatMap((e) => (e.type === 'land_played' ? [e.object] : [])));
  const discards = new Set(events.flatMap((e) => (e.type === 'discarded' ? [e.object] : [])));
  const milled = new Set(events.flatMap((e) => (e.type === 'milled' ? e.objects : [])));
  const opening = !after.started;
  // Mana (CR 106.4): what a player taps a permanent for by hand is told, and so is anything added on top of a tap
  // (Kinnan) or by a spell or ability. Taps made for the player while a cost is being paid aren't.
  const paying = events.some((e) => e.type === 'cast' || e.type === 'ability_activated');
  const tappedNow = new Set(events.flatMap((e) => (e.type === 'tapped' && e.tapped ? [e.object] : [])));

  // What a player did comes before what paying for it did ("You activate Goblin Cratermaker" before "Goblin Cratermaker dies").
  const did = events.findIndex((e) => e.type === 'cast' || e.type === 'ability_activated');
  const ordered = did > 0 ? [events[did]!, ...events.slice(0, did), ...events.slice(did + 1)] : events;
  for (const e of ordered) {
    switch (e.type) {
      case 'game_started':
        push('turn', `The game begins. ${who(e.order[0]!)} goes first.`);
        break;
      case 'turn_began':
        // A player's own count of turns: everyone's first turn is turn 1.
        push('turn', `Turn ${after.players[e.player]?.turnsBegun ?? e.turn} — ${who(e.player)}`);
        break;
      case 'mulligan':
        push('info', `${who(e.player)} mulligans (${plural(e.count, 'mulligan')} so far).`);
        break;
      case 'kept':
        push('info', `${who(e.player)} keeps their hand.`);
        break;
      case 'drew':
        if (opening) break;
        if (e.revealed) push('info', `${who(e.player)} draws ${realName(e.object, after, before)} (revealed).`);
        else {
          push('info', `${who(e.player)} draws a card.`, undefined, e.player);
          push('info', `You draw ${realName(e.object, after, before)}.`, e.player);
        }
        break;
      case 'land_played':
        push('play', `${who(e.player)} plays ${name(e.object)}.`);
        break;
      case 'mana_added': {
        if (!e.mana.length) break;
        const from = e.source ? name(e.source) : null;
        const only = e.spend ? ` (only for ${spendText(e.spend)})` : '';
        if (e.triggered) push('info', `${from ?? 'An effect'} adds ${manaSymbols(e.mana)}${only}.`);
        else if (e.source && tappedNow.has(e.source)) {
          if (!paying) push('info', `${who(e.player)} taps ${from} for ${manaSymbols(e.mana)}${only}.`);
        } else push('info', `${who(e.player)} adds ${manaSymbols(e.mana)}${only}${from ? ` with ${from}` : ''}.`);
        break;
      }
      case 'cast': {
        const entry = after.stack.find((s) => s.kind === 'spell' && s.object === e.object);
        const aimed = entry?.targets.flat().map(targetText) ?? [];
        push('play', `${who(e.player)} casts ${name(e.object)}${aimed.length ? ` targeting ${aimed.join(', ')}` : ''}.`);
        break;
      }
      case 'ability_activated': {
        const entry = after.stack.find((s) => s.kind === 'ability' && s.id === e.entry);
        const aimed = entry?.targets.flat().map(targetText) ?? [];
        push('play', `${who(e.player)} activates ${name(e.source)}: ${e.text}${aimed.length ? ` → ${aimed.join(', ')}` : ''}`);
        break;
      }
      case 'triggered':
        push('play', `${name(e.source)} triggers: ${e.text}`);
        break;
      case 'resolved':
        push('play', e.entry.kind === 'spell' ? `${name(e.entry.object)} resolves.` : `${e.entry.sourceName}’s ability resolves.`);
        break;
      case 'countered':
        push('play', `${name(e.object)} is countered.`);
        break;
      case 'fizzled':
        push('info', `${e.entry.kind === 'spell' ? name(e.entry.object) : `${e.entry.sourceName}’s ability`} doesn’t resolve: its targets are gone.`);
        break;
      case 'attacks_declared':
        push(
          'combat',
          e.attacks.length ? `${who(after.active)} attacks: ${e.attacks.map((a) => `${name(a.attacker)} → ${target(a.target)}`).join(', ')}.` : `${who(after.active)} doesn’t attack.`,
        );
        break;
      case 'blocks_declared':
        push('combat', e.blocks.length ? `${who(e.player)} blocks: ${e.blocks.map((b) => `${name(b.blocker)} blocks ${name(b.attacker)}`).join(', ')}.` : `${who(e.player)} doesn’t block.`);
        break;
      case 'damage':
        if (e.amount > 0) push('damage', `${name(e.source)} deals ${e.amount} damage to ${recipient(e.to)}.`);
        break;
      case 'prevented':
        push('info', `${e.amount} damage from ${name(e.source)} is prevented.`);
        break;
      case 'life':
        if (e.delta !== 0) push('life', `${who(e.player)} ${e.delta > 0 ? 'gains' : 'loses'} ${Math.abs(e.delta)} life (${e.life}).`);
        break;
      case 'counters':
        if (e.delta) push('info', `${name(e.object)} ${e.delta > 0 ? 'gets' : 'loses'} ${plural(Math.abs(e.delta), `${e.counter} counter`)}.`);
        break;
      case 'player_counters':
        if (e.delta) push('info', `${who(e.player)} ${e.delta > 0 ? 'gets' : 'loses'} ${plural(Math.abs(e.delta), `${e.counter} counter`)}.`);
        break;
      case 'discarded':
        push('play', `${who(e.player)} discards ${name(e.object)}${e.madness ? ' (madness: exiled)' : ''}.`);
        break;
      case 'milled':
        push('info', `${who(e.player)} mills ${e.objects.map(name).join(', ')}.`);
        break;
      case 'revealed':
        push('info', `${who(e.player)} reveals ${e.objects.map((id) => realName(id, after, before)).join(', ')}.`);
        break;
      case 'created':
        push('play', `${who(e.controller)} creates ${name(e.object)}.`);
        break;
      case 'scried':
        push('info', `${who(e.player)} scries ${e.top + e.bottom} (${e.top} on top, ${e.bottom} on the bottom).`);
        break;
      case 'surveilled':
        push('info', `${who(e.player)} surveils ${e.top + e.graveyard} (${e.graveyard} into the graveyard).`);
        break;
      case 'searched':
        push('info', `${who(e.player)} searches ${e.owner === e.player ? 'their' : `${who(e.owner)}’s`} library.`);
        break;
      case 'shuffled':
        if (!opening) push('info', `${who(e.player)} shuffles their library.`);
        break;
      case 'transformed':
        push('info', `${name(e.object)} transforms.`);
        break;
      case 'turned_face_up':
        push('play', `${name(e.object)} is turned face up.`);
        break;
      case 'attached':
        push('info', `${name(e.object)} is attached to ${e.player ? who(e.to) : name(e.to)}.`);
        break;
      case 'control_changed':
        push('info', `${who(e.controller)} gains control of ${name(e.object)}.`);
        break;
      case 'monarch':
        push('info', `${who(e.player)} becomes the monarch.`);
        break;
      case 'initiative':
        push('info', `${who(e.player)} takes the initiative.`);
        break;
      case 'day_night':
        push('info', `It becomes ${e.to}.`);
        break;
      case 'coin_flip':
        push('info', `${who(e.player)} flips a coin and ${e.won ? 'wins' : 'loses'}.`);
        break;
      case 'die_rolled':
        push('info', `${who(e.player)} rolls a d${e.sides}: ${e.result}.`);
        break;
      case 'chosen':
        push('info', `${name(e.object)}: ${e.choice} chosen.`);
        break;
      case 'goaded':
        push('info', `${who(e.by)} goads ${name(e.object)}.`);
        break;
      case 'regenerated':
        push('info', `${name(e.object)} regenerates.`);
        break;
      case 'proliferated':
        push('info', `${who(e.player)} proliferates.`);
        break;
      case 'explored':
        push('info', `${name(e.object)} explores.`);
        break;
      case 'ring_tempted':
        push('info', `The Ring tempts ${who(e.player)}${e.object ? ` (Ring-bearer: ${name(e.object)})` : ''}.`);
        break;
      case 'voted':
        push('info', `${who(e.player)} votes for ${e.object ? name(e.object) : e.choice}.`);
        break;
      case 'manual':
        push('manual', `${who(e.player)} (by hand): ${manualText(e.op, after, before)}`);
        break;
      case 'moved': {
        if (landPlays.has(e.object) || discards.has(e.object) || milled.has(e.object)) break;
        const pub = PUBLIC_ZONES.includes(e.from) || PUBLIC_ZONES.includes(e.to);
        if (!pub) break;
        if (e.from === 'stack' || e.to === 'stack') {
          // Resolving and casting are logged as such; a countered or exiled spell says where it went.
          if (e.from === 'stack' && e.to !== 'battlefield' && e.to !== 'graveyard') push('info', `${name(e.object)} goes to ${zoneName(e.to)}.`);
          break;
        }
        const n = PUBLIC_ZONES.includes(e.from) ? publicName(e.object, before, after) : name(e.object);
        if (opening && e.to === 'command') break;
        push(e.from === 'battlefield' && e.to === 'graveyard' ? 'death' : e.to === 'battlefield' ? 'play' : 'info', `${n} ${movePhrase(e.from, e.to, after.cards[e.card] ?? before.cards[e.card], e.face)}.`);
        break;
      }
      case 'player_lost':
        push('end', `${who(e.player)} loses the game (${e.reason}).`);
        break;
      case 'game_over':
        push('end', e.winner ? `${who(e.winner)} wins the game.` : 'The game is a draw.');
        break;
      default:
        break;
    }
  }
  return out;
}

function movePhrase(from: ZoneName, to: ZoneName, def: { faces: { types: string[] }[] } | undefined, face: number): string {
  if (from === 'battlefield') {
    if (to === 'graveyard') return def?.faces[face]?.types.includes('Creature') ? 'dies' : 'is put into its owner’s graveyard';
    if (to === 'hand') return 'returns to its owner’s hand';
    if (to === 'library') return 'is put into its owner’s library';
    if (to === 'exile') return 'is exiled';
    if (to === 'command') return 'goes to the command zone';
  }
  if (to === 'battlefield') return from === 'graveyard' ? 'returns from the graveyard to the battlefield' : from === 'exile' ? 'returns from exile to the battlefield' : `is put onto the battlefield from ${zoneName(from)}`;
  if (to === 'exile') return `is exiled from ${zoneName(from)}`;
  if (to === 'hand') return `is put into its owner’s hand from ${zoneName(from)}`;
  if (to === 'library') return `is put into its owner’s library from ${zoneName(from)}`;
  if (to === 'graveyard') return `is put into its owner’s graveyard from ${zoneName(from)}`;
  return `goes to ${zoneName(to)}`;
}

function zoneName(z: ZoneName): string {
  return z === 'battlefield' ? 'the battlefield' : z === 'command' ? 'the command zone' : z === 'stack' ? 'the stack' : z === 'exile' ? 'exile' : `its owner’s ${z}`;
}

function manualText(op: ManualOp, ...states: GameState[]): string {
  switch (op.kind) {
    case 'move':
      return `moves ${publicName(op.object, ...states)} to ${zoneName(op.to)}${op.position ? ` (${op.position})` : ''}`;
    case 'life':
      return `${op.delta >= 0 ? '+' : ''}${op.delta} life for ${states[0]?.players[op.target]?.name ?? op.target}`;
    case 'tap':
      return `${op.tapped ? 'taps' : 'untaps'} ${publicName(op.object, ...states)}`;
    case 'counters':
      return `${op.delta >= 0 ? '+' : ''}${op.delta} ${op.counter} on ${publicName(op.object, ...states)}`;
    case 'draw':
      return `draws ${plural(op.count, 'card')}`;
  }
}

/**
 * A solo playtest calls the player "You", so lines narrated in the third person ("You draws a card") are put in the
 * second person for display ("You draw a card").
 */
export function asYou(text: string): string {
  // "You’s graveyard" → "Your graveyard"; "You keeps their hand" → "You keep your hand".
  text = text.replace(/\bYou[’']s\b/g, 'Your').replace(/^(You \w+ (?:[^.]*? )?)their\b/, '$1your');
  return text.replace(/\bYou (\w+)/g, (all, verb: string) => {
    if (verb === 'has') return 'You have';
    if (verb === 'is') return 'You are';
    if (verb === 'was') return 'You were';
    if (!/s$/.test(verb) || /ss$/.test(verb) || verb.length < 3) return all;
    if (/ies$/.test(verb)) return `You ${verb.slice(0, -3)}y`;
    if (/(ch|sh|x|z|o)es$/.test(verb)) return `You ${verb.slice(0, -2)}`;
    return `You ${verb.slice(0, -1)}`;
  });
}
