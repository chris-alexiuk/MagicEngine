import type { QuantityReplacementNode, StaticAbility } from '@mtg/schema';
import { hasRule, matchesFilter, objectAbilities } from './characteristics.js';
import { fitsDamage } from './damage-filter.js';
import { replaced, type Amount, type Life, type Replacement, type Rules } from './instead.js';
import type { DamageRecipient, GameEvent, GameObject, GameState, PlayerId } from './types.js';
import { abilitySources } from './zones.js';
import { playerRule } from './player-rules.js';

/**
 * Replacement effects that change an amount (CR 614.1a): life gained or lost, counters put on something, cards milled,
 * copies made. Each that applies is put to the amount by instead.ts, once (CR 614.5). CR 616.1: with several, the
 * affected player (or the affected object's controller) chooses the order — nobody is asked; it is taken to be the
 * order that leaves them best off: the most life or counters they gain (one more, then twice that many), the least
 * life lost, cards milled or counters that do harm (twice that much, then one more). (How much damage is dealt and how
 * many tokens are created are settled with everything else about them: instead-damage.ts, instead-tokens.ts.)
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
}

/** Counters nobody wants more of on what is theirs. */
const HARMFUL = /^-|^(?:poison|rad|stun)$/;

/** Whether the one affected is better off with less of it (CR 616.1: theirs is the choice of order). */
function lessIsBetter(event: QuantityReplacementNode['event'], subject: QuantitySubject): boolean {
  if (event === 'damage' || event === 'lose_life' || event === 'mill') return true;
  return event === 'counters' && HARMFUL.test(subject.counter ?? '');
}

/** What one effect makes of an amount. */
export function changedBy(e: QuantityReplacementNode, n: number): number {
  // Vorinclex: "half that many …, rounded down".
  return e.op === 'plus' ? n + (e.n ?? 0) : e.op === 'double' ? n * 2 : e.op === 'triple' ? n * 3 : e.op === 'half' ? Math.floor(n / 2) : n;
}

/** One effect that changes an amount, as it applies to one event: which effect it is, its words, what it makes of the amount. */
export interface AmountEffect {
  key: string;
  label: string;
  change: (n: number) => number;
}

/** The effects that change this amount (CR 614.1a): "twice that many", "that many plus one", "half that many". */
export function amountEffects(g: GameState, event: QuantityReplacementNode['event'], subject: QuantitySubject): AmountEffect[] {
  const found: AmountEffect[] = [];
  for (const id of abilitySources(g)) {
    const source = g.objects[id]!;
    for (const [i, a] of objectAbilities(g, source).entries()) {
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'replace_quantity') continue;
      const e = (a as StaticAbility).effect as QuantityReplacementNode;
      if (e.event !== event || e.op === 'extra' || e.op === 'swap' || !applies(g, e, source, subject)) continue;
      found.push({ key: `${id}:${source.zcc}:${i}`, label: a.text, change: (n) => changedBy(e, n) });
    }
  }
  return found;
}

export function replaceQuantity(g: GameState, event: QuantityReplacementNode['event'], n: number, subject: QuantitySubject): number {
  // Melira, Sylvok Outcast: "Creatures you control can't have -1/-1 counters put on them." (CR 122.1) — none are put.
  if (event === 'counters' && n > 0 && subject.object && subject.counter && counterBlocked(g, subject.object, subject.counter)) return 0;
  if (n <= 0) return n;
  // The effects that apply. (Whether one does doesn't hang on the amount: they are found once.)
  const found: Replacement<Amount>[] = amountEffects(g, event, subject).map((e) => ({ key: e.key, label: e.label, apply: (h) => ({ ...h, n: e.change(h.n) }) }));
  if (!found.length) return n;
  const sign = lessIsBetter(event, subject) ? -1 : 1;
  const end = replaced<Amount>(g, { kind: 'amount', n }, { replace_quantity: (_g, h) => (h.n > 0 ? found : []) }, { prefer: (a, b) => sign * ((a?.n ?? 0) - (b?.n ?? 0)) });
  return end?.n ?? 0;
}

/**
 * The replacement effects on a player about to gain or lose life (CR 119, 614.1a):
 *
 *   becomes_loss   Tainted Remedy, Plague Drone: "If an opponent would gain life, that player loses that much life instead."
 *   changed        "you gain twice that much life instead" (Boon Reflection), "they lose twice that much life instead"
 *                  (Bloodletter of Aclazotz) — of the life as it now is: gained, or lost
 *
 * CR 616.1: the player orders them. Nobody is asked — it is the order that leaves them the most life: a gain that
 * becomes a loss does so before it would have been doubled.
 */
export const LIFE_RULES: Rules<Life> = {
  becomes_loss(g, h) {
    if (h.loss || h.n <= 0 || !playerRule(g, h.player, 'gain_becomes_loss')) return [];
    return [{ key: `gain_becomes_loss:${h.player}`, label: 'An effect: that player loses that much life instead', apply: (l) => ({ ...l, loss: true }) }];
  },
  changed(g, h) {
    if (h.n <= 0) return [];
    return amountEffects(g, h.loss ? 'lose_life' : 'gain_life', { player: h.player }).map((e) => ({ key: e.key, label: e.label, apply: (l) => ({ ...l, n: e.change(l.n) }) }));
  },
};

const lifeAfter = (h: Life | null): number => (h ? (h.loss ? -h.n : h.n) : 0);
const mostLife = (a: Life | null, b: Life | null): number => lifeAfter(a) - lifeAfter(b);

/**
 * How much life a player loses when they would lose `n` (Bloodletter of Aclazotz, CR 614.1a): from damage (CR 120.3a), an
 * effect, or paying life — which is losing it (CR 119.4).
 */
export function lifeLoss(g: GameState, player: PlayerId, n: number): number {
  // Everybody Lives!: "Players can't lose life this turn." (CR 119.7)
  if (cantLoseLife(g, player)) return 0;
  const asked: Life = { kind: 'life', player, n, loss: true };
  return (replaced(g, asked, LIFE_RULES, { prefer: mostLife }) ?? asked).n;
}

/** Melira's Keepers, Melira, Blightbeetle: whether counters of this kind can't be put on this permanent (CR 122.1). */
export function counterBlocked(g: GameState, o: GameObject, counter: string): boolean {
  if (o.zone !== 'battlefield') return false;
  return hasRule(g, o, 'no_counters') || (counter === '-1/-1' && hasRule(g, o, 'no_minus_counters')) || (counter === '+1/+1' && hasRule(g, o, 'no_plus_counters'));
}

/**
 * CR 119.3: a player gains life — unless they can't (CR 119.7) or their life total can't change (CR 119.8). What the
 * replacement effects on that make of it (twice that much; a loss instead) is settled first: each is a rule above,
 * none is known here. Returns the change.
 */
export function applyLifeGain(g: GameState, p: PlayerId, n: number, events: GameEvent[]): number {
  const ps = g.players[p];
  if (!ps || n <= 0 || playerRule(g, p, 'cant_gain_life') || playerRule(g, p, 'life_cant_change')) return 0;
  const asked: Life = { kind: 'life', player: p, n, loss: false };
  const life = replaced(g, asked, LIFE_RULES, { prefer: mostLife }) ?? asked;
  if (life.loss) {
    // Everybody Lives!: "Players can't lose life this turn." (CR 119.7)
    const lost = cantLoseLife(g, p) ? 0 : life.n;
    ps.life -= lost;
    events.push({ type: 'life', player: p, delta: -lost, life: ps.life });
    return -lost;
  }
  ps.life += life.n;
  events.push({ type: 'life', player: p, delta: life.n, life: ps.life });
  return life.n;
}

/** CR 119.7: "can't lose life" (an effect this turn); CR 119.8: such a player can't pay life either. */
export function cantLoseLife(g: GameState, player: PlayerId): boolean {
  return (g.playerEffects ?? []).some((e) => e.player === player && e.rule === 'cant_lose_life' && e.lastTurn >= g.turn);
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
    case 'proliferate':
      return who(s.player);
    case 'lose_life':
      return who(s.player) && (!e.yourTurn || g.active === you);
    case 'counters':
      if (!who(s.player)) return false;
      if (e.counter && e.counter !== s.counter) return false;
      if (e.effectOnly && s.cost) return false;
      // Lae'zel: "or on yourself"; Vorinclex: "on a permanent or player".
      if (s.onPlayer !== undefined) return e.players === 'any' || (e.players === 'you' && s.onPlayer === you);
      if (!s.object || e.onlyPlayers) return false;
      return !e.filter || matchesFilter(g, s.object, e.filter, { controller: you, source });
    case 'damage':
      // Which damage: its source, who it would be dealt to, in combat or not (The Sound of Drums, Torbran, Fiendish Duo,
      // Curse of Bloodletting, Goldnight Castigator, Sawhorn Nemesis).
      return Boolean(s.source && s.to) && fitsDamage(g, e.damage, source, { source: s.source!, to: s.to!, combat: Boolean(s.combat) });
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
