import { activationProhibited } from './cast-bans.js';
import type { ActivatedAbility, AddManaEffect, EffectNode } from '@mtg/schema';
import { anyManaTriggers, canActivateTapAbilities, manaAbilities, manaMultipliers, isBasicLand, matchesFilter, objectAbilities } from './characteristics.js';
import { abilitySources } from './zones.js';
import type { ObjectFilter } from '@mtg/schema';
import { evalCondition } from './conditions.js';
import { anyColorChoices, branchNow, type ManaCost, manaOnly, manaOption, parseManaCost, shortfall } from './mana.js';
import { bonusManaChoices, manaBonusAsks, manaTriggered, runManaAbility } from './payment.js';
import { playerRule } from './player-rules.js';
import { cantLoseLife } from './quantities.js';
import { RulesError } from './types.js';
import { anyColorCost, asThoughAnyColor, canSpend, OTHER_PURPOSE, spendablePool, type ManaPurpose } from './spending.js';
import type { GameEvent, GameObject, GameState, ManaColor, ObjectId, PlayerId } from './types.js';

export interface PlannedActivation {
  object: ObjectId;
  ability: number;
  choice?: number | ManaColor;
  /** The type of the mana a "tapped for mana" trigger adds on top, where there is a choice (Kinnan with a Signet). */
  bonus?: (number | ManaColor)[];
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

/**
 * A mana ability's effects as they would run right now. "{T}: Add {C}. If you control an Urza's Mine and an Urza's
 * Power-Plant, add {C}{C}{C} instead." (and Incubation Druid's "add three mana of that type instead") is one "if": as
 * the ability resolves it becomes whichever of the two holds, so that is what a payment can count on.
 */
function effectsNow(g: GameState, player: PlayerId, o: GameObject, ab: ActivatedAbility): EffectNode[] {
  const only = ab.effects.length === 1 ? ab.effects[0]! : null;
  return (only && branchNow(g, player, o, only)) ?? ab.effects;
}

function manaSources(g: GameState, player: PlayerId, exclude: readonly ObjectId[], purpose: ManaPurpose, skipped?: { any: boolean }): Source[] {
  const out: Source[] = [];
  // CR 106.12b: Nyxbloom Ancient's "three times as much".
  const mult = manaMultipliers(g, player);
  for (const id of g.zones.battlefield) {
    const o = g.objects[id]!;
    // Virtue of Strength: "If you tap a basic land for mana" — only for those.
    const times = mult.basicLand === 1 || o.controller !== player ? mult.any : mult.any * (isBasicLand(g, o) ? mult.basicLand : 1);
    const many = (mana: ManaColor[]) => (times === 1 ? mana : Array.from({ length: times }, () => mana).flat());
    if (o.controller !== player || o.tapped || !canActivateTapAbilities(g, o) || exclude.includes(id) || activationProhibited(g, player, o, true)) continue;
    const modes: Mode[] = [];
    manaAbilities(g, o).forEach((ab, ability) => {
      // Only simple "{T}: Add …" abilities are planned for here; the rest are tried one at a time when these fall short
      // (planByTrying).
      // CR 602.5d: "Activate only as a sorcery" can't be activated while a spell or ability is being paid for.
      const now = effectsNow(g, player, o, ab);
      if (!ab.cost.tap || ab.cost.mana || ab.cost.untap || ab.cost.other || now.length !== 1 || ab.oncePerTurn || ab.timing === 'sorcery') {
        if (skipped) skipped.any = true;
        return;
      }
      // CR 602.5b: "Activate only if you control a Swamp."
      if (ab.activateIf && !evalCondition(ab.activateIf, { g, controller: player, source: o, events: [], targets: [], x: 0, memo: {} })) return;
      const effect = now[0] as AddManaEffect;
      if (effect.type !== 'add_mana' || effect.times !== undefined || effect.eachColor) {
        if (skipped) skipped.any = true;
        return;
      }
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
  const most = !ps || playerRule(g, player, 'life_cant_change') || cantLoseLife(g, player) ? 0 : Math.floor(Math.max(0, ps.life) / 2);
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
    const payable = (c: ManaCost) => (autoTapping ? planManaOnly(g, player, c, x, exclude, purpose) !== null : (() => { const need = shortfall(spendablePool(g, player, purpose), c, x); return Boolean(need && !need.specific.length && !need.generic); })());
    life = phyrexianLifeOptions(g, player, full).find((opt) => payable(manaOnly(full, opt))) ?? [];
  }
  Object.assign(cost, manaOnly(full, life));
  return 2 * life.length;
}

export function planAutoTap(g: GameState, player: PlayerId, cost: ManaCost, x = 0, exclude: readonly ObjectId[] = [], purpose: ManaPurpose = OTHER_PURPOSE): PlannedActivation[] | null {
  // CR 107.4f: Phyrexian symbols — mana if that's payable, else 2 life for as few of them as needed.
  const phy = withPlayerPhyrexian(g, player, cost, purpose);
  if (phy.phyrexian.length) {
    // The rest is mana only: converting it again (K'rrik, Defiler of Vigor) would never end.
    for (const life of phyrexianLifeOptions(g, player, phy)) {
      const plan = planManaOnly(g, player, manaOnly(phy, life), x, exclude, purpose);
      if (plan) return plan;
    }
    return null;
  }
  return planManaOnly(g, player, cost, x, exclude, purpose);
}

/** planAutoTap for a cost already settled to mana only (no Phyrexian symbols left to convert). */
export function planManaOnly(g: GameState, player: PlayerId, cost: ManaCost, x: number, exclude: readonly ObjectId[], purpose: ManaPurpose): PlannedActivation[] | null {
  // CR 609.4b: "as though it were mana of any color" — any mana pays its colored symbols.
  const anyColor = asThoughAnyColor(g, player, purpose);
  if (anyColor) cost = anyColorCost(cost, anyColor);
  const skipped = { any: false };
  const quick = planQuick(g, player, cost, x, exclude, purpose, skipped);
  // Mana the quick plan can't count on: abilities it leaves out (Bloom Tender, a Signet, a Treasure), and mana added
  // when a permanent is tapped for mana (Kinnan). Only then is it worth trying them one at a time.
  if (cost.unsupported.length) return quick;
  // With mana being added as permanents are tapped, the quick plan would tap more than it needs: one at a time instead.
  const extra = anyManaTriggers(g);
  if (quick ? !(extra && quick.length > 1) : !(skipped.any || extra)) return quick;
  return planByTrying(g, player, cost, x, exclude, purpose, extra) ?? quick;
}

/** The quick plan: only abilities that are just "{T}: Add …", counted from their text. */
function planQuick(g: GameState, player: PlayerId, cost: ManaCost, x: number, exclude: readonly ObjectId[], purpose: ManaPurpose, skipped?: { any: boolean }): PlannedActivation[] | null {
  const need = shortfall(spendablePool(g, player, purpose), cost, x);
  if (!need) return null;
  const sources = manaSources(g, player, exclude, purpose, skipped);
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
  // Generic mana from what makes the least first (a land before a Gilded Lotus), so little is left floating.
  const most = (s: Source) => Math.max(...s.modes.map((m) => m.mana.length));
  const rest = sources
    .filter((s) => !used.has(s.object))
    .sort((a, b) => most(a) - most(b) || flexibility(a) - flexibility(b));
  // A source that could make any color for generic mana makes one the player has a use for (what's left floating, a
  // Gilded Lotus's third mana, is then worth something): the colors of the cards they could still cast.
  let liked: Map<ManaColor, number> | null = null;
  const like = (m: Mode) => {
    if (!liked) {
      liked = new Map();
      const held = [...(g.zones.hand[player] ?? []), ...g.zones.command.filter((id) => g.objects[id]?.owner === player)];
      for (const id of held) for (const sym of (g.cards[g.objects[id]!.card]?.faces[0]?.manaCost ?? '').match(/[WUBRGC]/g) ?? []) liked.set(sym as ManaColor, (liked.get(sym as ManaColor) ?? 0) + 1);
    }
    return m.mana.reduce((n, c) => n + (liked!.get(c) ?? 0), 0);
  };
  for (const source of rest) {
    if (generic <= 0) break;
    const mode = [...source.modes].sort((a, b) => b.mana.length - a.mana.length || (source.modes.length > 1 ? like(b) - like(a) : 0))[0]!;
    used.add(source.object);
    plan.push(toActivation(source, mode));
    generic -= mode.mana.length;
  }
  return generic <= 0 ? plan : null;
}

/** A mana ability the engine can activate without asking anything, and the ways to (a color, or which of its options). */
interface Try {
  object: ObjectId;
  ability: number;
  choices: (number | ManaColor | undefined)[];
  /** The colors a choice makes, as far as its text says (a counted amount makes at least one of these). */
  colors: (choice: number | ManaColor | undefined) => ManaColor[];
  /** "{1}, {T}: Add {G}{U}." — mana to pay first. */
  mana?: string;
  /** It costs more than a tap (a Treasure is sacrificed, a pain land deals damage): used after the ones that don't. */
  dear: boolean;
  /**
   * Its own mana can't be spent on this (CR 106.6), but tapping it for mana adds mana that can: Kinnan's "one mana of
   * any type that permanent produced" has no restriction of its own. Tried last, and kept only if it helped.
   */
  onlyForBonus?: true;
}

function tries(g: GameState, player: PlayerId, exclude: readonly ObjectId[], purpose: ManaPurpose, done: ReadonlySet<string>, extra = false): Try[] {
  const out: Try[] = [];
  for (const id of g.zones.battlefield) {
    const o = g.objects[id]!;
    if (o.controller !== player || exclude.includes(id) || activationProhibited(g, player, o, true)) continue;
    manaAbilities(g, o).forEach((ab, ability) => {
      if (done.has(`${id}:${ability}`) || ab.cost.untap || ab.oncePerTurn || ab.maxPerTurn || ab.timing === 'sorcery') return;
      // Its own cost must use it up — it taps, or it's sacrificed — and ask for nothing else.
      const other = ab.cost.other ?? [];
      if (!other.every((c) => c.type === 'sacrifice_self') || !(ab.cost.tap || other.length)) return;
      if (ab.cost.tap && (o.tapped || !canActivateTapAbilities(g, o))) return;
      if (ab.activateIf && !evalCondition(ab.activateIf, { g, controller: player, source: o, events: [], targets: [], x: 0, memo: {} })) return;
      const now = effectsNow(g, player, o, ab);
      const add = now.find((e) => e.type === 'add_mana') as AddManaEffect | undefined;
      if (!add || add.combination) return;
      const unspendable = Boolean(add.spend && !canSpend(g, player, add.spend, purpose, o));
      if (unspendable && !(extra && ab.cost.tap && manaTriggered(g, o))) return;
      const options = (add.options ?? []).map((opt) => manaOption(opt, o));
      const choices: (number | ManaColor | undefined)[] = add.anyColor ? anyColorChoices(g, player, add.identity, add, o) : options.length > 1 ? options.flatMap((m, i) => (m ? [i] : [])) : [undefined];
      if (!choices.length || (!add.anyColor && options.length === 1 && !options[0])) return;
      const colors = (choice: number | ManaColor | undefined): ManaColor[] => (typeof choice === 'string' ? [choice] : (options[choice ?? 0] ?? []));
      out.push({ object: id, ability, choices, colors, ...(ab.cost.mana ? { mana: ab.cost.mana } : {}), dear: other.length > 0 || now.length > 1, ...(unspendable ? { onlyForBonus: true as const } : {}) });
    });
  }
  return out;
}

/**
 * The slower plan, for mana the quick one can't count from an ability's text: activates mana abilities one at a time on
 * a copy of the game — whatever makes a color still needed first, anything that costs more than a tap last — until the
 * cost is covered or the quick plan can finish. What it returns has been done on the copy, in that order, so doing it
 * for real does the same. Null if everything was tried and the cost still isn't covered.
 */
function planByTrying(g: GameState, player: PlayerId, cost: ManaCost, x: number, exclude: readonly ObjectId[], purpose: ManaPurpose, extra: boolean): PlannedActivation[] | null {
  // The colors this cost has a use for at all (what a choice is worth beyond the color needed right now).
  const useful = new Set<string>([...Object.keys(cost.specific).filter((c) => (cost.specific[c as ManaColor] ?? 0) > 0), ...cost.hybrid.flat(), ...cost.phyrexian.flat()]);
  const { cards, ...rest } = g;
  let sim: GameState = { ...structuredClone(rest), cards };
  const events: GameEvent[] = [];
  const plan: PlannedActivation[] = [];
  const done = new Set<string>();
  const run = (step: PlannedActivation): boolean => {
    try {
      runManaAbility(sim, player, step.object, step.ability, step.choice, events, {}, step.bonus ?? []);
      plan.push(step);
      return true;
    } catch (err) {
      if (err instanceof RulesError) return false;
      throw err;
    }
  };
  for (let guard = 0; guard < 200; guard++) {
    const need = shortfall(spendablePool(sim, player, purpose), cost, x);
    if (!need) return null;
    if (!need.specific.length && need.generic <= 0) return plan;
    // The plain sources can be counted the rest of the way — unless tapping them adds mana of its own (Kinnan).
    const finish = extra ? null : planQuick(sim, player, cost, x, exclude, purpose);
    if (finish) return [...plan, ...finish];
    // The next one to try: one that makes a color still needed, then the ones that cost only a tap, then no mana to pay.
    const wanted = new Set(need.specific);
    let best: { t: Try; choice: number | ManaColor | undefined; score: number } | null = null;
    for (const t of tries(sim, player, exclude, purpose, done, extra)) {
      for (const choice of t.choices) {
        const made = t.colors(choice);
        const score = (made.some((c) => wanted.has(c)) ? 100 : 0) + (t.dear ? 0 : 20) + (t.mana ? 0 : 10) + made.filter((c) => useful.has(c)).length - (t.onlyForBonus ? 1000 : 0);
        if (!best || score > best.score) best = { t, choice, score };
      }
    }
    if (!best) return null;
    const { t, choice } = best;
    done.add(`${t.object}:${t.ability}`);
    // A source tapped only for what its tapping adds: undone again if that didn't bring the cost any closer.
    const undo = t.onlyForBonus ? { state: structuredClone({ ...sim, cards: undefined }), events: events.length, plan: plan.length, missing: need.specific.length + need.generic } : null;
    if (t.mana) {
      // What it costs comes from the pool, or from the plain sources (never from itself).
      const pay = planQuick(sim, player, parseManaCost(t.mana), 0, [...exclude, t.object], { kind: 'ability', source: sim.objects[t.object]! });
      if (!pay || !pay.every(run)) continue;
    }
    // Mana added on top as it's tapped ("one mana of any type that permanent produced", "one mana of any color"): of
    // the type this cost still needs once the permanent's own mana is counted.
    let bonus: ManaColor[] | undefined;
    const tapped = sim.objects[t.object]!;
    if (extra && manaBonusAsks(sim, tapped)) {
      const made = t.colors(choice);
      const still = [...need.specific];
      for (const c of made) {
        const i = still.indexOf(c);
        if (i >= 0) still.splice(i, 1);
      }
      const options = bonusManaChoices(sim, tapped, made).filter((c): c is ManaColor => typeof c === 'string');
      const pick = options.find((c) => still.includes(c)) ?? (still.length ? undefined : options.find((c) => useful.has(c)));
      if (pick) bonus = [pick];
    }
    run({ object: t.object, ability: t.ability, ...(choice !== undefined ? { choice } : {}), ...(bonus ? { bonus } : {}) });
    if (undo) {
      const now = shortfall(spendablePool(sim, player, purpose), cost, x);
      if (!now || now.specific.length + now.generic >= undo.missing) {
        sim = { ...undo.state, cards } as GameState;
        events.length = undo.events;
        plan.length = undo.plan;
      }
    }
  }
  return null;
}
