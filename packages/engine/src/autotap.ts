import { activationProhibited } from './cast-bans.js';
import type { AddManaEffect } from '@mtg/schema';
import { canActivateTapAbilities, manaAbilities, manaMultiplier } from './characteristics.js';
import { evalCondition } from './conditions.js';
import { anyColorChoices, type ManaCost, manaOption, shortfall } from './mana.js';
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
export function planAutoTap(g: GameState, player: PlayerId, cost: ManaCost, x = 0, exclude: readonly ObjectId[] = [], purpose: ManaPurpose = OTHER_PURPOSE): PlannedActivation[] | null {
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
