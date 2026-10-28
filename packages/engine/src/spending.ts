import type { ManaSpend, ObjectFilter } from '@mtg/schema';
import { matchesFilter } from './characteristics.js';
import { MANA_COLORS, manaOnly, payFromPool, type ManaCost } from './mana.js';
import { anyColorPermission } from './permissions.js';
import { spendAnyColor } from './player-rules.js';
import type { GameObject, GameState, ManaPool, PlayerId, RestrictedMana } from './types.js';

/**
 * CR 106.6: some mana can be spent only on certain things ("Spend this mana only to cast creature spells").
 * Restricted mana sits beside the player's pool, and a payment can use it only when it's for one of those things.
 */
export type ManaPurpose = { kind: 'spell'; object: GameObject } | { kind: 'ability'; source: GameObject } | { kind: 'unlock' } | { kind: 'face_up' } | { kind: 'other' };

export const OTHER_PURPOSE: ManaPurpose = { kind: 'other' };

/** Whether mana with this restriction can be spent on this. */
export function canSpend(g: GameState, player: PlayerId, spend: ManaSpend | undefined, purpose: ManaPurpose, source?: GameObject | null): boolean {
  if (!spend) return true;
  // "a creature spell of the chosen type": the type chosen for the permanent that made the mana.
  const ok = (o: GameObject, f: ObjectFilter) => matchesFilter(g, o, f, { controller: player, anyZone: true, source: source ?? null });
  if (purpose.kind === 'spell') return Boolean(spend.spells && ok(purpose.object, spend.spells));
  if (purpose.kind === 'ability') return Boolean(spend.abilities && ok(purpose.source, spend.abilities));
  if (purpose.kind === 'unlock' || purpose.kind === 'face_up') return Boolean(spend.special?.includes(purpose.kind));
  return Boolean(spend.other);
}

/** The mana a player could spend on this: their pool plus the restricted mana that may go to it. */
export function spendablePool(g: GameState, player: PlayerId, purpose: ManaPurpose): ManaPool {
  const ps = g.players[player]!;
  const out: ManaPool = { ...ps.pool };
  for (const r of ps.restricted ?? []) if (canSpend(g, player, r.spend, purpose, sourceOf(g, r))) out[r.color] += r.amount;
  return out;
}

/**
 * CR 601.2h / 602.2b: pays a mana cost from what the player could spend on it — restricted mana first,
 * since it's good for less. Returns the mana spent, or null (paying nothing) if the cost can't be paid.
 */
const sourceOf = (g: GameState, r: RestrictedMana): GameObject | null => (r.source ? (g.objects[r.source.id] ?? null) : null);

/** Restricted mana a payment used, for its riders ("and that spell can't be countered"). */
export let lastSpentRestricted: RestrictedMana[] = [];

/**
 * CR 609.4b: may this payment spend mana as though it were mana of any color? (Chromatic Orrery; a spell cast with a
 * permission that says so — the card is still where it was cast from as its costs are paid, CR 601.2a–h.)
 */
export function asThoughAnyColor(g: GameState, player: PlayerId, purpose: ManaPurpose): false | 'color' | 'type' {
  const spell = purpose.kind === 'spell' ? purpose.object : undefined;
  const permission = spell ? anyColorPermission(g, player, spell) : false;
  return permission === 'type' ? 'type' : permission || spendAnyColor(g, player, spell) ? 'color' : false;
}

/**
 * The cost as it can be paid when any mana can be spent as though it were any color: each colored or hybrid symbol
 * takes one mana of any type; {C} still needs colorless mana (it isn't a color).
 */
export function anyColorCost(cost: ManaCost, how: 'color' | 'type' = 'color'): ManaCost {
  // CR 107.4f: Phyrexian symbols still to pay with mana are colored mana.
  cost = manaOnly(cost);
  // "mana of any type" (Hostage Taker): {C} too.
  const kinds = how === 'type' ? MANA_COLORS : MANA_COLORS.filter((c) => c !== 'C');
  const colored = kinds.reduce((n, c) => n + (cost.specific[c] ?? 0), 0);
  return { ...cost, generic: cost.generic + colored + cost.hybrid.length, specific: how === 'color' && cost.specific.C ? { C: cost.specific.C } : {}, hybrid: [] };
}

export function payMana(g: GameState, player: PlayerId, cost: ManaCost, x: number, purpose: ManaPurpose): ManaPool | null {
  const anyColor = asThoughAnyColor(g, player, purpose);
  if (anyColor) cost = anyColorCost(cost, anyColor);
  const ps = g.players[player]!;
  const usable = (ps.restricted ?? []).filter((r) => r.amount > 0 && canSpend(g, player, r.spend, purpose, sourceOf(g, r)));
  lastSpentRestricted = [];
  const combined: ManaPool = { ...ps.pool };
  for (const r of usable) combined[r.color] += r.amount;
  const left = payFromPool(combined, cost, x);
  if (!left) return null;
  const spent = { ...combined };
  for (const c of MANA_COLORS) {
    spent[c] = combined[c] - left[c];
    let owed = spent[c];
    for (const r of usable) {
      if (r.color !== c || !owed) continue;
      const take = Math.min(r.amount, owed);
      r.amount -= take;
      owed -= take;
      if (take) lastSpentRestricted.push(r);
    }
    ps.pool[c] -= owed;
  }
  if (ps.restricted) ps.restricted = ps.restricted.filter((r) => r.amount > 0);
  return spent;
}
