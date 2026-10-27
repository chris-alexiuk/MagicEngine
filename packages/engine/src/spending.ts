import type { ManaSpend, ObjectFilter } from '@mtg/schema';
import { matchesFilter } from './characteristics.js';
import { MANA_COLORS, payFromPool, type ManaCost } from './mana.js';
import type { GameObject, GameState, ManaPool, PlayerId } from './types.js';

/**
 * CR 106.6: some mana can be spent only on certain things ("Spend this mana only to cast creature spells").
 * Restricted mana sits beside the player's pool, and a payment can use it only when it's for one of those things.
 */
export type ManaPurpose = { kind: 'spell'; object: GameObject } | { kind: 'ability'; source: GameObject } | { kind: 'other' };

export const OTHER_PURPOSE: ManaPurpose = { kind: 'other' };

/** Whether mana with this restriction can be spent on this. */
export function canSpend(g: GameState, player: PlayerId, spend: ManaSpend | undefined, purpose: ManaPurpose): boolean {
  if (!spend) return true;
  const ok = (o: GameObject, f: ObjectFilter) => matchesFilter(g, o, f, { controller: player, anyZone: true });
  if (purpose.kind === 'spell') return Boolean(spend.spells && ok(purpose.object, spend.spells));
  if (purpose.kind === 'ability') return Boolean(spend.abilities && ok(purpose.source, spend.abilities));
  return false;
}

/** The mana a player could spend on this: their pool plus the restricted mana that may go to it. */
export function spendablePool(g: GameState, player: PlayerId, purpose: ManaPurpose): ManaPool {
  const ps = g.players[player]!;
  const out: ManaPool = { ...ps.pool };
  for (const r of ps.restricted ?? []) if (canSpend(g, player, r.spend, purpose)) out[r.color] += r.amount;
  return out;
}

/**
 * CR 601.2h / 602.2b: pays a mana cost from what the player could spend on it — restricted mana first,
 * since it's good for less. Returns the mana spent, or null (paying nothing) if the cost can't be paid.
 */
export function payMana(g: GameState, player: PlayerId, cost: ManaCost, x: number, purpose: ManaPurpose): ManaPool | null {
  const ps = g.players[player]!;
  const usable = (ps.restricted ?? []).filter((r) => r.amount > 0 && canSpend(g, player, r.spend, purpose));
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
    }
    ps.pool[c] -= owed;
  }
  if (ps.restricted) ps.restricted = ps.restricted.filter((r) => r.amount > 0);
  return spent;
}
