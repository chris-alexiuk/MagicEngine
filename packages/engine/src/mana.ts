import type { AddManaEffect } from '@mtg/schema';
import { hasType, manaAbilities } from './characteristics.js';
import type { GameObject, GameState, ManaColor, ManaPool, PlayerId } from './types.js';

export const MANA_COLORS: readonly ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

/** One way an ability makes mana, with "chosen" read from the source (CR 614.12); null if nothing was chosen. */
export function manaOption(option: string[], source: GameObject | undefined): ManaColor[] | null {
  const out: ManaColor[] = [];
  for (const sym of option) {
    const c = sym === 'chosen' ? source?.chosen?.color : sym;
    if (!c || !MANA_COLORS.includes(c as ManaColor)) return null;
    out.push(c as ManaColor);
  }
  return out;
}

/**
 * CR 903.4: a player's commander color identity — the combined identity of their commanders.
 * Without a commander it's undefined, and "any color in your commander's color identity" makes no mana (CR 903.4f).
 */
export function commanderIdentity(g: GameState, player: PlayerId): ManaColor[] {
  const out = new Set<ManaColor>();
  for (const o of Object.values(g.objects)) {
    if (!o.commander || o.owner !== player) continue;
    for (const c of g.cards[o.card]?.colorIdentity ?? []) out.add(c as ManaColor);
  }
  return [...out];
}

/**
 * CR 106.7: the types of mana the lands of those players could produce, ignoring abilities that themselves depend on
 * what other lands could produce (so two Exotic Orchards don't look at each other).
 */
function producible(g: GameState, player: PlayerId, who: 'opponents' | 'you', anyType: boolean): ManaColor[] {
  const out = new Set<ManaColor>();
  for (const id of g.zones.battlefield) {
    const land = g.objects[id]!;
    if ((who === 'you') !== (land.controller === player) || !hasType(g, land, 'Land')) continue;
    for (const a of manaAbilities(g, land)) {
      for (const e of a.effects) {
        if (e.type !== 'add_mana') continue;
        const m = e as AddManaEffect;
        if (m.couldProduce) continue;
        for (const option of m.options ?? []) for (const c of manaOption(option, land) ?? []) out.add(c);
        if (m.anyColor) for (const c of anyColorChoices(g, land.controller, m.identity)) out.add(c);
      }
    }
  }
  return MANA_COLORS.filter((c) => out.has(c) && (anyType || c !== 'C'));
}

/** The colors an "any color" mana ability can make for this player. */
export function anyColorChoices(g: GameState, player: PlayerId, identity: boolean | undefined, effect?: AddManaEffect): ManaColor[] {
  if (effect?.couldProduce) return producible(g, player, effect.couldProduce, Boolean(effect.anyType));
  const all: ManaColor[] = ['W', 'U', 'B', 'R', 'G'];
  if (!identity) return all;
  const allowed = commanderIdentity(g, player);
  return all.filter((c) => allowed.includes(c));
}

export function emptyPool(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

export function poolTotal(pool: ManaPool): number {
  return MANA_COLORS.reduce((n, c) => n + pool[c], 0);
}

/** A mana cost broken into what the payment algorithm needs. */
export interface ManaCost {
  generic: number;
  /** Colored and colorless ({C}) symbols that need that exact type. */
  specific: Partial<Record<ManaColor, number>>;
  /** Hybrid symbols: each entry lists the ways it can be paid (a color, or "2" for two generic). */
  hybrid: string[][];
  /** Number of {X} symbols. */
  x: number;
  /** Symbols this version can't pay automatically (Phyrexian, snow…). */
  unsupported: string[];
}

/**
 * CR 118.7 / 702.193b: reduce a cost by a mana cost — generic by generic; colored and colorless symbols reduce the same
 * type, and any excess reduces generic.
 */
export function reduceCostBy(cost: ManaCost, by: ManaCost): void {
  let generic = by.generic;
  for (const [c, n] of Object.entries(by.specific) as [ManaColor, number][]) {
    const have = cost.specific[c] ?? 0;
    const off = Math.min(have, n);
    if (off) cost.specific[c] = have - off;
    generic += n - off;
  }
  generic += by.hybrid.length;
  cost.generic = Math.max(0, cost.generic - generic);
}

/** CR 107.4: parses "{2}{G}{G}", "{X}{R}", "{G/U}", "{2/W}". */
export function parseManaCost(cost: string): ManaCost {
  const out: ManaCost = { generic: 0, specific: {}, hybrid: [], x: 0, unsupported: [] };
  for (const m of cost.matchAll(/\{([^}]+)\}/g)) {
    const sym = m[1]!;
    if (/^\d+$/.test(sym)) out.generic += Number(sym); // CR 107.4b
    else if (sym === 'X') out.x++;
    else if (/^[WUBRGC]$/.test(sym)) {
      const c = sym as ManaColor;
      out.specific[c] = (out.specific[c] ?? 0) + 1;
    } else if (/^([WUBRGC2])\/([WUBRG])$/.test(sym)) {
      // CR 107.4e: either half pays; "2" means two mana of any type.
      out.hybrid.push(sym.split('/'));
    } else out.unsupported.push(sym);
  }
  return out;
}

/**
 * Pays `cost` from `pool`, returning the remaining pool, or null if it can't be paid.
 * Specific symbols first, then hybrid (preferring the type the pool has most of),
 * then generic (colorless first, then the most plentiful color).
 * CR 118.3: a cost can't be paid without the resources to pay it fully.
 */
export function payFromPool(pool: ManaPool, cost: ManaCost, xValue = 0): ManaPool | null {
  if (cost.unsupported.length) return null;
  const left: ManaPool = { ...pool };
  for (const c of MANA_COLORS) {
    const need = cost.specific[c] ?? 0;
    if (left[c] < need) return null;
    left[c] -= need;
  }
  let generic = cost.generic + cost.x * xValue;
  for (const options of cost.hybrid) {
    const colors = options.filter((o): o is ManaColor => o !== '2');
    const best = colors.filter((c) => left[c] > 0).sort((a, b) => left[b] - left[a])[0];
    if (best) left[best]--;
    else if (options.includes('2')) generic += 2;
    else return null;
  }
  const order = [...MANA_COLORS].sort((a, b) => (a === 'C' ? -1 : b === 'C' ? 1 : left[b] - left[a]));
  for (const c of order) {
    const take = Math.min(left[c], generic);
    left[c] -= take;
    generic -= take;
  }
  return generic === 0 ? left : null;
}

/** Mana still owed after paying what the pool can: used to plan automatic tapping. */
export function shortfall(pool: ManaPool, cost: ManaCost, xValue = 0): { specific: ManaColor[]; generic: number } | null {
  if (cost.unsupported.length) return null;
  const left: ManaPool = { ...pool };
  const specific: ManaColor[] = [];
  for (const c of MANA_COLORS) {
    let need = cost.specific[c] ?? 0;
    const have = Math.min(left[c], need);
    left[c] -= have;
    need -= have;
    for (let i = 0; i < need; i++) specific.push(c);
  }
  let generic = cost.generic + cost.x * xValue;
  for (const options of cost.hybrid) {
    const color = options.find((o): o is ManaColor => o !== '2' && left[o as ManaColor] > 0);
    if (color) left[color]--;
    else if (options.includes('2')) generic += 2;
    else specific.push(options[0] as ManaColor);
  }
  generic = Math.max(0, generic - poolTotal(left));
  return { specific, generic };
}
