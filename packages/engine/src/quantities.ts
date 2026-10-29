import type { QuantityReplacementNode, StaticAbility } from '@mtg/schema';
import { hasRule, matchesFilter, objectAbilities } from './characteristics.js';
import type { DamageRecipient, GameEvent, GameObject, GameState, PlayerId } from './types.js';
import { faceOf, abilitySources } from './zones.js';
import { playerRule } from './player-rules.js';

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
  // Melira, Sylvok Outcast: "Creatures you control can't have -1/-1 counters put on them." (CR 122.1) — none are put.
  if (event === 'counters' && n > 0 && subject.object && subject.counter && counterBlocked(g, subject.object, subject.counter)) return 0;
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

/** Melira's Keepers, Melira, Blightbeetle: whether counters of this kind can't be put on this permanent (CR 122.1). */
export function counterBlocked(g: GameState, o: GameObject, counter: string): boolean {
  if (o.zone !== 'battlefield') return false;
  return hasRule(g, o, 'no_counters') || (counter === '-1/-1' && hasRule(g, o, 'no_minus_counters')) || (counter === '+1/+1' && hasRule(g, o, 'no_plus_counters'));
}

/**
 * CR 119.3: a player gains life — unless they can't (CR 119.7) or their life total can't change (CR 119.8); Tainted Remedy,
 * Plague Drone: "If an opponent would gain life, that player loses that much life instead." (CR 614.1a, applied before a
 * doubling, the affected player's choice of order, CR 616.1); Boon Reflection: twice that much. Returns the change.
 */
export function applyLifeGain(g: GameState, p: PlayerId, n: number, events: GameEvent[]): number {
  const ps = g.players[p];
  if (!ps || n <= 0 || playerRule(g, p, 'cant_gain_life') || playerRule(g, p, 'life_cant_change')) return 0;
  if (playerRule(g, p, 'gain_becomes_loss')) {
    const lost = lifeLoss(g, p, n);
    ps.life -= lost;
    events.push({ type: 'life', player: p, delta: -lost, life: ps.life });
    return -lost;
  }
  const amount = replaceQuantity(g, 'gain_life', n, { player: p });
  ps.life += amount;
  events.push({ type: 'life', player: p, delta: amount, life: ps.life });
  return amount;
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
      // Phial of Galadriel: "… while you have 5 or less life".
      return who(s.player) && (e.lifeAtMost === undefined || (s.player !== undefined && (g.players[s.player]?.life ?? 0) <= e.lifeAtMost));
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
      // Curse of Bloodletting: "If a source would deal damage to enchanted player, …"
      if (e.toEnchantedPlayer && !(s.to?.kind === 'player' && s.to.player === source.attachedToPlayer)) return false;
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
  // Melira, Sylvok Outcast: "You can't get poison counters."
  if (counter === 'poison' && playerRule(g, p, 'no_poison')) return;
  const amount = replaceQuantity(g, 'counters', n, { player: by, onPlayer: p, counter });
  if (amount <= 0) return;
  if (counter === 'poison') ps.poison += amount;
  else (ps.counters ??= {})[counter] = (ps.counters?.[counter] ?? 0) + amount;
  events.push({ type: 'player_counters', player: p, counter, delta: amount, by });
}
