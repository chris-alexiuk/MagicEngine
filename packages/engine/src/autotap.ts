import { activationProhibited } from './cast-bans.js';
import type { AddManaEffect } from '@mtg/schema';
import { canActivateTapAbilities, manaAbilities, manaMultiplier, matchesFilter, objectAbilities } from './characteristics.js';
import { abilitySources } from './zones.js';
import type { ObjectFilter } from '@mtg/schema';
import { evalCondition } from './conditions.js';
import { anyColorChoices, type ManaCost, manaOnly, manaOption, shortfall } from './mana.js';
import { playerRule } from './player-rules.js';
import { RulesError } from './types.js';
import { anyColorCost, asThoughAnyColor, canSpend, OTHER_PURPOSE, spendablePool, type ManaPurpose } from './spending.js';
import type { GameState, ManaColor, ObjectId, PlayerId } from './types.js';

export interface PlannedActivation {
  object: ObjectId;
  ability: number;
  choice?: number | ManaColor;
}

interface Mode {
  ability: number;
  mana: ManaColor[];
  choice?: number | ManaColor;
}

/** One permanent that can tap for mana, and every way it can do so. A permanent taps only once. */
interface Source {
  object: ObjectId;
  modes: Mode[];
}

function manaSources(g: GameState, player: PlayerId, exclude: readonly ObjectId[], purpose: ManaPurpose): Source[] {
  const out: Source[] = [];
  // CR 106.12b: Nyxbloom Ancient's "three times as much".
  const times = manaMultiplier(g, player);
  const many = (mana: ManaColor[]) => (times === 1 ? mana : Array.from({ length: times }, () => mana).flat());
  for (const id of g.zones.battlefield) {
    const o = g.objects[id]!;
    if (o.controller !== player || o.tapped || !canActivateTapAbilities(g, o) || exclude.includes(id) || activationProhibited(g, player, o, true)) continue;
    const modes: Mode[] = [];
    manaAbilities(g, o).forEach((ab, ability) => {
      // Only simple "{T}: Add …" abilities are used automatically.
      // CR 602.5d: "Activate only as a sorcery" can't be activated while a spell or ability is being paid for.
      if (!ab.cost.tap || ab.cost.mana || ab.cost.untap || ab.cost.other || ab.effects.length !== 1 || ab.oncePerTurn || ab.timing === 'sorcery') return;
      // CR 602.5b: "Activate only if you control a Swamp."
      if (ab.activateIf && !evalCondition(ab.activateIf, { g, controller: player, source: o, events: [], targets: [], x: 0, memo: {} })) return;
      const effect = ab.effects[0] as AddManaEffect;
      if (effect.type !== 'add_mana' || effect.times !== undefined || effect.eachColor) return;
      // CR 106.6: restricted mana only helps when it can be spent on this.
      if (effect.spend && !canSpend(g, player, effect.spend, purpose, o)) return;
      if (effect.anyColor) {
        for (const c of anyColorChoices(g, player, effect.identity, effect, o)) {
          modes.push({ ability, mana: many(Array.from({ length: effect.anyColor }, () => c)), choice: c });
        }
      } else {
        const options = effect.options ?? [];
        options.forEach((opt, i) => {
          const mana = manaOption(opt, o);
          if (mana) modes.push({ ability, mana: many(mana), ...(options.length > 1 ? { choice: i } : {}) });
        });
      }
    });
    if (modes.length) out.push({ object: id, modes });
  }
  return out;
}

const flexibility = (s: Source) => new Set(s.modes.flatMap((m) => m.mana)).size;
const toActivation = (s: Source, m: Mode): PlannedActivation => ({
  object: s.object,
  ability: m.ability,
  ...(m.choice !== undefined ? { choice: m.choice } : {}),
});

/**
 * Picks permanents to tap for a cost, beyond what's already in the pool.
 * Greedy: the scarcest colors first, each paid by the least flexible source,
 * then generic mana from whatever is left. Returns null if the cost can't be met.
 */
/** `exclude`: permanents that can't be tapped for mana here (their own cost taps or sacrifices them). */
/** `purpose`: what the mana is for, which decides whether restricted mana can help (CR 106.6). */
/**
 * CR 107.4f: the ways to pay a cost's Phyrexian symbols with life — the indices of those paid with 2 life each, fewest first
 * (CR 119.4: only with that much life; CR 119.8: not if the life total can't change). K'rrik, Son of Yawgmoth: "For each {B}
 * in a cost, you may pay 2 life rather than pay that mana." — its {B} symbols are Phyrexian too.
 */
export function phyrexianLifeOptions(g: GameState, player: PlayerId, cost: ManaCost): number[][] {
  const n = cost.phyrexian.length;
  const ps = g.players[player];
  const most = !ps || playerRule(g, player, 'life_cant_change') ? 0 : Math.floor(Math.max(0, ps.life) / 2);
  const out: number[][] = [];
  // Symbols that are the same can be paid either way alike: only how many of each kind matters.
  const kinds = new Map<string, number[]>();
  cost.phyrexian.forEach((c, i) => kinds.set(c.join('/'), [...(kinds.get(c.join('/')) ?? []), i]));
  const groups = [...kinds.values()];
  const walk = (k: number, picked: number[]) => {
    if (picked.length > most) return;
    if (k === groups.length) {
      out.push(picked);
      return;
    }
    for (let m = 0; m <= groups[k]!.length; m++) walk(k + 1, [...picked, ...groups[k]!.slice(0, m)]);
  };
  if (n) walk(0, []);
  return out.sort((a, b) => a.length - b.length);
}

/**
 * K'rrik, Son of Yawgmoth: the cost with its {B} symbols Phyrexian (each payable with 2 life instead). Defiler of Vigor: one
 * {G} of a green permanent spell, for each Defiler.
 */
export function withPlayerPhyrexian(g: GameState, player: PlayerId, cost: ManaCost, purpose: ManaPurpose = OTHER_PURPOSE): ManaCost {
  let out = cost;
  const convert = (color: ManaColor, n: number) => {
    const have = out.specific[color] ?? 0;
    const k = Math.min(have, n);
    if (k > 0) out = { ...out, specific: { ...out.specific, [color]: have - k }, phyrexian: [...out.phyrexian, ...Array.from({ length: k }, () => [color])] };
  };
  if (purpose.kind === 'spell') {
    for (const id of abilitySources(g)) {
      const src = g.objects[id]!;
      if (src.zone !== 'battlefield' || src.controller !== player) continue;
      for (const a of objectAbilities(g, src)) {
        if (a.kind !== 'static' || a.effect.type !== 'phyrexian_grant') continue;
        const e = a.effect as unknown as { filter: ObjectFilter; color: ManaColor };
        if (matchesFilter(g, purpose.object, e.filter, { controller: player, source: src, anyZone: true })) convert(e.color, 1);
      }
    }
  }
  if (playerRule(g, player, 'black_as_phyrexian')) convert('B', out.specific.B ?? 0);
  return out;
}

/**
 * CR 107.4f / 601.2h: how the player pays a cost's Phyrexian symbols — as they chose (`choice`, one entry per symbol), or
 * else mana when they can and 2 life for as few as they must. Makes `cost` the mana left to pay; returns the life to pay.
 */
export function settlePhyrexian(g: GameState, player: PlayerId, cost: ManaCost, choice: readonly ('life' | 'mana')[] | undefined, x: number, autoTapping: boolean, exclude: readonly ObjectId[] = [], purpose: ManaPurpose = OTHER_PURPOSE): number {
  const full = withPlayerPhyrexian(g, player, cost, purpose);
  if (!full.phyrexian.length) return 0;
  let life: number[] = [];
  if (choice) {
    if (choice.length !== full.phyrexian.length) throw new RulesError(`Say how to pay each of the ${full.phyrexian.length} Phyrexian mana symbols: with mana or 2 life.`);
    life = choice.flatMap((c, i) => (c === 'life' ? [i] : []));
  } else {
    const payable = (c: ManaCost) => (autoTapping ? planAutoTap(g, player, c, x, exclude, purpose) !== null : (() => { const need = shortfall(spendablePool(g, player, purpose), c, x); return Boolean(need && !need.specific.length && !need.generic); })());
    life = phyrexianLifeOptions(g, player, full).find((opt) => payable(manaOnly(full, opt))) ?? [];
  }
  Object.assign(cost, manaOnly(full, life));
  return 2 * life.length;
}

export function planAutoTap(g: GameState, player: PlayerId, cost: ManaCost, x = 0, exclude: readonly ObjectId[] = [], purpose: ManaPurpose = OTHER_PURPOSE): PlannedActivation[] | null {
  // CR 107.4f: Phyrexian symbols — mana if that's payable, else 2 life for as few of them as needed.
  const phy = withPlayerPhyrexian(g, player, cost, purpose);
  if (phy.phyrexian.length) {
    for (const life of phyrexianLifeOptions(g, player, phy)) {
      const plan = planAutoTap(g, player, manaOnly(phy, life), x, exclude, purpose);
      if (plan) return plan;
    }
    return null;
  }
  // CR 609.4b: "as though it were mana of any color" — any mana pays its colored symbols.
  const anyColor = asThoughAnyColor(g, player, purpose);
  if (anyColor) cost = anyColorCost(cost, anyColor);
  const need = shortfall(spendablePool(g, player, purpose), cost, x);
  if (!need) return null;
  const sources = manaSources(g, player, exclude, purpose);
  const used = new Set<ObjectId>();
  const plan: PlannedActivation[] = [];
  let surplus = 0; // extra mana from a source tapped for a color (e.g. the second {C} from Sol Ring)

  const counts = new Map<ManaColor, number>();
  for (const c of need.specific) counts.set(c, (counts.get(c) ?? 0) + 1);
  const supply = (c: ManaColor) => sources.filter((s) => s.modes.some((m) => m.mana.includes(c))).length;
  const colors = [...counts.keys()].sort((a, b) => supply(a) - supply(b));

  for (const color of colors) {
    let remaining = counts.get(color)!;
    while (remaining > 0) {
      const source = sources
        .filter((s) => !used.has(s.object) && s.modes.some((m) => m.mana.includes(color)))
        .sort((a, b) => flexibility(a) - flexibility(b))[0];
      if (!source) return null;
      const mode = source.modes
        .filter((m) => m.mana.includes(color))
        .sort((a, b) => b.mana.filter((c) => c === color).length - a.mana.filter((c) => c === color).length)[0]!;
      used.add(source.object);
      plan.push(toActivation(source, mode));
      const produced = mode.mana.filter((c) => c === color).length;
      const usedForColor = Math.min(produced, remaining);
      remaining -= usedForColor;
      surplus += mode.mana.length - usedForColor;
    }
  }

  let generic = need.generic - surplus;
  const rest = sources
    .filter((s) => !used.has(s.object))
    .sort((a, b) => flexibility(a) - flexibility(b));
  for (const source of rest) {
    if (generic <= 0) break;
    const mode = [...source.modes].sort((a, b) => b.mana.length - a.mana.length)[0]!;
    used.add(source.object);
    plan.push(toActivation(source, mode));
    generic -= mode.mana.length;
  }
  return generic <= 0 ? plan : null;
}
