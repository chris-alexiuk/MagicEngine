import type { QuantityReplacementNode, StaticAbility } from '@mtg/schema';
import { matchesFilter, objectAbilities } from './characteristics.js';
import type { DamageRecipient, GameEvent, GameObject, GameState, PlayerId } from './types.js';
import { faceOf, abilitySources } from './zones.js';

/**
 * Replacement effects that change an amount (CR 614.1a): life gained, tokens created, counters
 * put on something, damage dealt. CR 616.1: with several, the affected player (or the affected
 * object's controller) chooses the order — here, the order that's best for them: increases add
 * before they double for what they gain; doubling comes first for damage they're dealt.
 */
export interface QuantitySubject {
  /** Who gains the life, gets the tokens, or puts the counters. */
  player?: PlayerId;
  /** What the counters are put on. */
  object?: GameObject;
  /** The player the counters are put on (CR 122.1: counters on players). */
  onPlayer?: PlayerId;
  /** Counters put on as a cost (CR 606.4: a loyalty cost) — not by an effect (Doubling Season). */
  cost?: true;
  counter?: string;
  /** The damage source and recipient. */
  source?: GameObject;
  to?: DamageRecipient;
  combat?: boolean;
  /** The tokens being created (Ojer Taq: "If one or more creature tokens would be created …"). */
  made?: { types: string[]; subtypes: string[] };
}

export function replaceQuantity(g: GameState, event: QuantityReplacementNode['event'], n: number, subject: QuantitySubject): number {
  if (n <= 0) return n;
  const mods: QuantityReplacementNode[] = [];
  for (const id of abilitySources(g)) {
    const source = g.objects[id]!;
    for (const a of objectAbilities(g, source)) {
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'replace_quantity') continue;
      const e = (a as StaticAbility).effect as QuantityReplacementNode;
      if (e.event !== event || e.op === 'extra' || !applies(g, e, source, subject)) continue;
      mods.push(e);
    }
  }
  if (!mods.length) return n;
  const plus = mods.filter((m) => m.op === 'plus').reduce((x, m) => x + (m.n ?? 0), 0);
  const factor = mods.reduce((x, m) => x * (m.op === 'double' ? 2 : m.op === 'triple' ? 3 : m.op === 'half' ? 0.5 : 1), 1);
  // Vorinclex: "half that many …, rounded down".
  return Math.floor(event === 'damage' ? n * factor + plus : (n + plus) * factor);
}

/**
 * How much life a player loses when they would lose `n` (Bloodletter of Aclazotz, CR 614.1a): from damage (CR 120.3a), an
 * effect, or paying life — which is losing it (CR 119.4).
 */
export function lifeLoss(g: GameState, player: PlayerId, n: number): number {
  // Everybody Lives!: "Players can't lose life this turn." (CR 119.7)
  if (cantLoseLife(g, player)) return 0;
  return replaceQuantity(g, 'lose_life', n, { player });
}

/** CR 119.7: "can't lose life" (an effect this turn); CR 119.8: such a player can't pay life either. */
export function cantLoseLife(g: GameState, player: PlayerId): boolean {
  return (g.playerEffects ?? []).some((e) => e.player === player && e.rule === 'cant_lose_life' && e.lastTurn >= g.turn);
}

/**
 * Peregrin Took, Xorn: the extra tokens to create as well when a player creates tokens (CR 614.1a), and how many —
 * for tokens matching `tokenFilter` (by the created face's types and subtypes).
 */
export function extraTokens(g: GameState, player: PlayerId, made: { types: string[]; subtypes: string[] }, n: number): { token: NonNullable<QuantityReplacementNode['extra']>['token']; count: number }[] {
  const out: { token: NonNullable<QuantityReplacementNode['extra']>['token']; count: number }[] = [];
  if (n <= 0) return out;
  for (const id of abilitySources(g)) {
    const source = g.objects[id]!;
    for (const a of objectAbilities(g, source)) {
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'replace_quantity') continue;
      const e = (a as StaticAbility).effect as QuantityReplacementNode;
      if (e.event !== 'tokens' || e.op !== 'extra' || !e.extra || source.controller !== player) continue;
      const f = e.tokenFilter;
      if (f?.subtypes && !f.subtypes.some((t) => made.subtypes.includes(t))) continue;
      if (f?.types && !f.types.some((t) => made.types.includes(t))) continue;
      out.push({ token: e.extra.token, count: e.extra.thatMany ? n : 1 });
    }
  }
  return out;
}

function applies(g: GameState, e: QuantityReplacementNode, source: GameObject, s: QuantitySubject): boolean {
  const you = source.controller;
  const who = (p: PlayerId | undefined) => !e.who || e.who === 'each' || (e.who === 'you' ? p === you : p !== undefined && p !== you);
  switch (e.event) {
    case 'gain_life':
    case 'mill':
    case 'copies':
      return who(s.player);
    case 'lose_life':
      return who(s.player) && (!e.yourTurn || g.active === you);
    case 'tokens': {
      if (!who(s.player)) return false;
      const f = e.tokenFilter;
      if (f && s.made) {
        if (f.types && !f.types.some((t) => s.made!.types.includes(t))) return false;
        if (f.subtypes && !f.subtypes.some((t) => s.made!.subtypes.includes(t))) return false;
      }
      return !f || Boolean(s.made);
    }
    case 'counters':
      if (!who(s.player)) return false;
      if (e.counter && e.counter !== s.counter) return false;
      if (e.effectOnly && s.cost) return false;
      // Lae'zel: "or on yourself"; Vorinclex: "on a permanent or player".
      if (s.onPlayer !== undefined) return e.players === 'any' || (e.players === 'you' && s.onPlayer === you);
      if (!s.object || e.onlyPlayers) return false;
      return !e.filter || matchesFilter(g, s.object, e.filter, { controller: you, source });
    case 'damage': {
      if (!s.source || (e.noncombat && s.combat) || (e.combatOnly && !s.combat)) return false;
      // The Sound of Drums: the creature this Aura or Equipment is attached to.
      if (e.fromAttached && !(source.attachedTo && source.attachedTo.id === s.source.id && source.attachedTo.zcc === s.source.zcc)) return false;
      if (e.filter && !matchesFilter(g, s.source, e.filter, { controller: you, source, anyZone: true })) return false;
      if (e.toOpponents) {
        const p = s.to?.kind === 'player' ? s.to.player : s.to ? g.objects[s.to.object]?.controller : undefined;
        if (!p || p === you) return false;
      }
      if (e.toPlayersOnly && s.to?.kind !== 'player') return false;
      if (e.toChosen) {
        const p = s.to?.kind === 'player' ? s.to.player : s.to ? g.objects[s.to.object]?.controller : undefined;
        if (!p || p !== source.chosen?.player) return false;
      }
      return true;
    }
    default:
      return false;
  }
}

/**
 * CR 122.1: counters put on a player by `by` ("you get {E}{E}", proliferate) — CR 614.1a replacements first (Lae'zel,
 * Vorinclex). CR 122.1f / 104.3d: poison counters (ten or more and the player loses).
 */
export function putPlayerCounters(g: GameState, by: PlayerId, p: PlayerId, counter: string, n: number, events: GameEvent[]): void {
  const ps = g.players[p];
  if (!ps || n <= 0) return;
  const amount = replaceQuantity(g, 'counters', n, { player: by, onPlayer: p, counter });
  if (amount <= 0) return;
  if (counter === 'poison') ps.poison += amount;
  else (ps.counters ??= {})[counter] = (ps.counters?.[counter] ?? 0) + amount;
  events.push({ type: 'player_counters', player: p, counter, delta: amount, by });
}
