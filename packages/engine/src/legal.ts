import { activationProhibited } from './cast-bans.js';
import { auraTargetSpec } from './permanents.js';
import type { ActivatedAbility, AddManaEffect, EffectNode, FaceDef, Program } from '@mtg/schema';
import { planAutoTap } from './autotap.js';
import { isPermanentCard, manaAbilities, matchesFilter, withCharsCache, withStableChars } from './characteristics.js';
import { FACE_DOWN_KEYWORDS } from './face-down.js';
import { anyColorChoices, branchNow, MANA_COLORS, manaOption, parseManaCost } from './mana.js';
import { amountOf } from './resolve.js';
import {
  activationCost,
  activationTargets,
  activationWay,
  applyPowerUp,
  castAsksX,
  castCost,
  castOptionsFor,
  castTargets,
  castWay,
  exileActionCost,
  exileActionMana,
  exileActionTiming,
  faceUpCost,
  flashbackCostOf,
  hasModeCosts,
  splitSecond,
  type ActivationChoices,
  type CastArgs,
} from './actions.js';
import { bonusManaChoices, manaAbilityWay, manaBonusAsks } from './payment.js';
import { activatedAbilities, flatten, spellPrograms, usedModes } from './program.js';
import { cantDivide, defaultTargets, targetCandidates, targetingAs, targetPrompts } from './targets.js';
import { targetCostModifiersInPlay } from './costs.js';
import { RulesError, type Action, type CompiledProgram, type CostChoices, type GameObject, type GameState, type ManaColor, type ObjectId, type PlayerId, type Target } from './types.js';
import { graveyardLandPermission, mayPlayFrom, permittedFace, playableFromExile, playableFromGraveyard, playableFromTop } from './permissions.js';
import { landsAllowed, ruleAllows } from './player-rules.js';
import { enteringBanned, faceOf, zoneList } from './zones.js';

/** The types of mana one way of activating a mana ability makes, where that's plain from the ability. */
function manaTypesMade(effect: AddManaEffect | undefined, choice: number | string | undefined): ManaColor[] | undefined {
  if (!effect) return undefined;
  const types = (list: readonly string[]) => (list.length && list.every((c) => (MANA_COLORS as readonly string[]).includes(c)) ? ([...new Set(list)] as ManaColor[]) : undefined);
  if (effect.combination || effect.anyColor) return typeof choice === 'string' ? types([...choice]) : undefined;
  const option = effect.options?.[typeof choice === 'number' ? choice : 0];
  return option ? types(option) : undefined;
}

/** The mixes of `n` mana from `colors` ("GGU"), or just the single-color ones when there would be too many to list. */
function manaMixes(colors: string[], n: number): string[] {
  const all = (k: number, from: string[]): string[] => (k === 0 ? [''] : from.flatMap((c, i) => all(k - 1, from.slice(i)).map((rest) => c + rest)));
  let count = 1;
  for (let i = 1; i <= n; i++) count = (count * (colors.length - 1 + i)) / i;
  return count <= 35 ? all(n, colors) : colors.map((c) => c.repeat(n));
}

/** The largest X the listing looks for when it works out how much X a player can pay for. */
const X_LISTING_CAP = 40;

/**
 * Actions the player could take right now, for driving a UI or a bot.
 *
 * This file decides nothing about what is legal. It goes through what the player could try — each card they could cast
 * from where it is, each way of casting it, each ability of each object — and keeps what the engine's own reading of
 * that action accepts (castWay / castCost, activationWay / activationCost in actions.ts, manaAbilityWay in payment.ts:
 * the code that performs the action, stopped before anything is paid). A rule about timing, costs or restrictions
 * belongs there, never here.
 *
 * A listed cast or activation carries default choices (the first modes with legal targets, the first candidates for
 * each cost, mana tapped automatically); a client lets the player change them with choiceModes, choicePrompts and
 * costPrompts (ui.ts). One that asks for X is listed once, with the least X and `xMax`. Answers to pending choices
 * and manual moves aren't listed.
 */
export function legalActions(g: GameState, player: PlayerId): Action[] {
  // Read-only: each object's characteristics are worked out once for the whole listing.
  return withStableChars(g, () => {
    const all = listLegalActions(g, player);
    return splitSecond(g) ? all.filter((a) => a.type !== 'cast' && a.type !== 'activate') : all;
  });
}

function listLegalActions(g: GameState, player: PlayerId): Action[] {
  if (g.over || g.pending || g.priority !== player) return [];
  const out: Action[] = [{ type: 'pass', player }];
  const mainPhaseEmptyStack = g.active === player && (g.step === 'main1' || g.step === 'main2') && g.stack.length === 0;

  // "You may play lands from your graveyard."
  // Titania, Nature's Force: "You may play Forests from your graveyard."
  if (mainPhaseEmptyStack && g.players[player]!.landsPlayedThisTurn < landsAllowed(g, player)) {
    for (const id of zoneList(g, 'graveyard', player)) {
      const def = g.cards[g.objects[id]!.card]!;
      if (def.faces[0]!.types.includes('Land') && (ruleAllows(g, player, 'lands_from_graveyard', g.objects[id]!) || graveyardLandPermission(g, player, g.objects[id]!)) && !enteringBanned(g, g.objects[id]!, 'graveyard')) out.push({ type: 'play_land', player, object: id });
    }
  }
  // The hand, plus cards an effect lets this player play from exile (impulse draw) or from the top of their library,
  // and (CR 903.8) the commanders they own in the command zone.
  const commanders = g.zones.command.filter((c) => g.objects[c]?.commander && g.objects[c]!.owner === player && !g.objects[c]!.emblem);
  for (const id of [...zoneList(g, 'hand', player), ...playableFromExile(g, player), ...playableFromTop(g, player), ...playableFromGraveyard(g, player), ...commanders]) {
    const o = g.objects[id]!;
    const def = g.cards[o.card]!;
    def.faces.forEach((face, faceIndex) => {
      if (o.prepareOf) {
        // CR 722.3c: only its prepare spell can be cast.
        if (faceIndex !== 1) return;
      } else {
        if ((o.zone === 'exile' || o.zone === 'library' || o.zone === 'graveyard') && !mayPlayFrom(g, player, o, face.types.includes('Land') ? 'land' : 'spell')) return;
        if (faceIndex > 0 && !['split', 'modal_dfc', 'adventure'].includes(def.layout)) return;
        // CR 715.3d: a card on an adventure — "but not as an Adventure".
        const onlyFace = permittedFace(g, player, o);
        if (onlyFace !== undefined && faceIndex !== onlyFace) return;
        // CR 702.127a: an aftermath half is cast only from a graveyard.
        if (face.keywords.some((k) => k.id === 'aftermath')) return;
      }
      if (face.types.includes('Land')) {
        // CR 903.8: a commander is cast from the command zone, never played as a land.
        if (o.zone === 'command') return;
        if (mainPhaseEmptyStack && g.players[player]!.landsPlayedThisTurn < landsAllowed(g, player) && (faceIndex === 0 || def.layout === 'modal_dfc') && !((o.zone === 'graveyard' || o.zone === 'library') && enteringBanned(g, o, o.zone))) {
          out.push({ type: 'play_land', player, object: id, ...(faceIndex ? { face: faceIndex } : {}) });
        }
        return;
      }
      // X spells (and "discard X cards" additional costs) are listed once, with the least X they can be cast with now and
      // `xMax`, the most X that can be paid for: a client asks the player for the number (CR 601.2b).
      listCast(g, player, o, faceIndex ? { face: faceIndex } : {}, out, (x, choice, costs) => ({ type: 'cast', player, object: id, autoTap: true, ...(faceIndex ? { face: faceIndex } : {}), ...(x !== undefined ? { x } : {}), ...choice, ...withCosts(costs) }));
    });
    // CR 118.9 / 601.2f: the same spell for an alternative cost, or with an optional additional one — a commander too
    // (CR 903.8), and a card an effect lets them cast from exile, a graveyard or the top of a library (its evoke cost
    // works from there; a warp cost, "from your hand", doesn't).
    out.push(...optionCasts(g, player, o, false));
  }
  // CR 702.138a: escape from the graveyard.
  for (const id of zoneList(g, 'graveyard', player)) out.push(...optionCasts(g, player, g.objects[id]!, true));

  // Foretell, plot, suspend from the hand (special actions, CR 116.2).
  for (const id of zoneList(g, 'hand', player)) {
    const o = g.objects[id]!;
    const face = g.cards[o.card]!.faces[0]!;
    for (const kind of ['foretell', 'plot', 'suspend'] as const) {
      const costText = exileActionCost(face, kind);
      if (!costText || !exileActionTiming(g, player, face, kind)) continue;
      if (planAutoTap(g, player, exileActionMana(g, player, costText, kind))) out.push({ type: kind, player, object: id, autoTap: true });
    }
  }
  // Foretold and plotted cards in exile, on a later turn.
  for (const id of g.zones.exile) {
    const o = g.objects[id]!;
    if (o.owner !== player || (o.foretold === undefined && o.plotted === undefined)) continue;
    const face = g.cards[o.card]!.faces[0]!;
    const options = castOptionsFor(g, player, o, face);
    const opt = options.find((x) => x.id === (o.foretold !== undefined ? 'foretell' : 'plot'));
    if (!opt) continue;
    // Lys Alana Dignitary: "As an additional cost to cast this spell, behold an Elf or pay {2}." — one of them, plotted or
    // not: the first that can be paid.
    const required = options.filter((x) => x.required);
    for (const req of required.length ? required.map((r) => [r]) : [[]]) {
      const from = out.length;
      listCast(g, player, o, { alt: opt.id, ...(req.length ? { extras: req.map((r) => r.id) } : {}) }, out, (x, choice, costs) => ({ type: 'cast', player, object: id, autoTap: true, ...(x !== undefined ? { x } : {}), alt: opt.id, ...(req.length ? { extras: req.map((r) => r.id) } : {}), ...choice, ...withCosts(costs) }));
      if (out.length > from) break;
    }
  }

  // CR 709.5e: unlocking a locked door of a Room you control (a special action, at sorcery timing).
  if (mainPhaseEmptyStack) {
    for (const id of g.zones.battlefield) {
      const o = g.objects[id]!;
      if (o.controller !== player || !o.unlocked) continue;
      ([0, 1] as const).forEach((half) => {
        if (o.unlocked![half]) return;
        const cost = parseManaCost(g.cards[o.card]!.faces[half]!.manaCost);
        if (!cost.unsupported.length && !cost.x && planAutoTap(g, player, cost, 0, [], { kind: 'unlock' })) out.push({ type: 'unlock', player, object: id, half, autoTap: true });
      });
    }
  }
  // CR 702.37e: turning face-down permanents face up (a special action, any time with priority).
  for (const id of g.zones.battlefield) {
    const o = g.objects[id]!;
    if (!o.faceDown || o.controller !== player) continue;
    const costText = faceUpCost(g, o);
    const cost = costText ? parseManaCost(costText) : null;
    if (cost && !cost.unsupported.length && !cost.x && planAutoTap(g, player, cost, 0, [], { kind: 'face_up' })) out.push({ type: 'turn_face_up', player, object: id, autoTap: true });
  }

  // CR 702.34a: flashback spells in the graveyard.
  for (const id of zoneList(g, 'graveyard', player)) {
    const o = g.objects[id]!;
    const face = g.cards[o.card]!.faces[0]!;
    if (!flashbackCostOf(g, o, face)) continue;
    // CR 118.8: additional costs are paid with flashback as without. One of a list ("discard a card or pay {5}") has to
    // be chosen; an optional one (buyback) may be.
    const extras = castOptionsFor(g, player, o, face).filter((x) => x.kind === 'additional');
    const required = extras.filter((x) => x.required);
    for (const how of [...(required.length ? [] : [{}]), ...(required.length ? required : extras).map((x) => ({ extras: [x.id] }))]) {
      // (Cast by a permission instead — "you may cast that card this turn" — it is listed with the cards that are.)
      listCast(g, player, o, how, out, (x, choice, costs) => ({ type: 'cast', player, object: id, autoTap: true, ...(x !== undefined ? { x } : {}), ...choice, ...withCosts(costs), ...how }), (way) => Boolean(way.flashback));
    }
  }
  // CR 702.127a: aftermath halves of split cards in the graveyard.
  for (const id of zoneList(g, 'graveyard', player)) {
    const o = g.objects[id]!;
    const def = g.cards[o.card]!;
    def.faces.forEach((face, faceIndex) => {
      if (!face.keywords.some((k) => k.id === 'aftermath')) return;
      listCast(g, player, o, { face: faceIndex }, out, (x, choice, costs) => ({ type: 'cast', player, object: id, autoTap: true, face: faceIndex, ...(x !== undefined ? { x } : {}), ...choice, ...withCosts(costs) }));
    });
  }
  // Abilities that work from the hand (cycling, CR 702.29a) or the graveyard (CR 113.6m).
  // Commander ninjutsu works from the command zone (CR 702.49d).
  for (const id of [...zoneList(g, 'hand', player), ...zoneList(g, 'graveyard', player), ...g.zones.command.filter((c) => g.objects[c]?.owner === player && !g.objects[c]?.emblem)]) {
    const o = g.objects[id]!;
    if (activationProhibited(g, player, o, false)) continue;
    activatedAbilities(g, o).forEach((ab, ability) => listActivation(g, player, o, ab, ability, out));
  }

  // Simian Spirit Guide: "Exile this card from your hand: Add {R}." (CR 605.1a); Jack-o'-Lantern's from the graveyard.
  for (const id of [...zoneList(g, 'hand', player), ...zoneList(g, 'graveyard', player)]) {
    const o = g.objects[id]!;
    manaAbilities(g, o).forEach((ab, ability) => listManaAbility(g, player, o, ab, ability, out));
  }
  for (const id of g.zones.battlefield) {
    const o = g.objects[id]!;
    // CR 602.2: "Any player may activate this ability."
    const mine = o.controller === player;
    if (!mine && !activatedAbilities(g, o).some((a) => a.anyPlayer)) continue;
    const banned = activationProhibited(g, player, o, false);
    if (mine) manaAbilities(g, o).forEach((ab, ability) => listManaAbility(g, player, o, ab, ability, out));
    if (!banned) activatedAbilities(g, o).forEach((ab, ability) => {
      if (mine || ab.anyPlayer) listActivation(g, player, o, ab, ability, out);
    });
    if (mine) faceOf(g, o).unparsed.forEach((line, i) => {
      if (line.includes(': ')) out.push({ type: 'activate_manual', player, object: id, line: i, autoTap: true });
    });
  }
  return out;
}

type Choice = { targets?: Target[][]; modes?: number[]; costs?: CostChoices };

type CastHow = { face?: number; alt?: string; extras?: string[] };
type CastWay = ReturnType<typeof castWay>;

/** A rules error means "no": anything else is a bug and goes on up. */
function refused(err: unknown): void {
  if (!(err instanceof RulesError)) throw err;
}

/** A cast with nothing chosen yet, as the readings in actions.ts take it. */
function castArgs(player: PlayerId, o: GameObject, how: CastHow, x: number, kicked: boolean | number | number[] = false): CastArgs {
  return { player, id: o.id, faceIndex: how.face ?? 0, x, wantsAutoTap: true, chosenTargets: undefined, modes: undefined, costChoices: {}, kickedArg: kicked, altId: how.alt, extras: how.extras ?? [], autoCosts: true };
}

const NO_TARGETS = { splices: [], program: null, targets: [] };

/**
 * Default modes, targets and cost choices for a cast the engine reads as legal — or null where, with this X, there is
 * nothing legal to choose or the costs can't be paid with what is chosen. Each step is the engine's own reading of the
 * cast (actions.ts: castTargets, castCost), given the default choice: nothing is decided here.
 */
function completeCast(g: GameState, a: CastArgs, way: CastWay): { choice: Choice; costs: CostChoices } | null {
  // (Another set of modes only where the first can't be paid for: a spree spell's modes each cost something. Other
  // targets only where what it costs depends on them.)
  for (const choice of defaultChoicesFor(g, a.player, way, a.x)) {
    const w = way.allModes ? way : { ...way, modes: choice.modes };
    const costsWith = (targets: Target[][] | undefined): CostChoices | null => {
      const full: CastArgs = { ...a, chosenTargets: targets, modes: choice.modes };
      try {
        return castCost(g, full, w, castTargets(g, full, w)).costChoices;
      } catch (err) {
        refused(err);
        return null;
      }
    };
    const costs = costsWith(choice.targets);
    if (costs) return { choice, costs };
    for (const targets of cheaperTargets(g, a, w, choice)) {
      const others = costsWith(targets);
      if (others) return { choice: { ...choice, targets }, costs: others };
    }
  }
  return null;
}

/**
 * Where what a spell costs depends on what it targets — strive's "{1}{W} more for each target beyond the first", "costs
 * {2} less if it targets a permanent with mana value 1", a permanent that taxes spells aimed at it — or whether it can
 * be cast at this moment does ("as though it had flash if it targets a permanent you control") — other targets to try
 * when the default ones aren't taken: fewer of them (as many as can be), then another single one.
 */
function cheaperTargets(g: GameState, a: CastArgs, way: CastWay, choice: Choice): Target[][][] {
  const targets = choice.targets;
  const face = way.castFace;
  if (!targets?.length) return [];
  // (Or whether it can be cast now at all does: "You may cast this spell as though it had flash if it targets a permanent you control.")
  const depends = way.needFlashTarget || face.abilities.some((x) => x.kind === 'static' && (x.effect.type === 'per_target_cost' || (x.effect.type === 'cost_modifier' && Boolean((x.effect as { ifTargets?: unknown }).ifTargets)))) || targetCostModifiersInPlay(g);
  if (!depends) return [];
  let prompts;
  try {
    const aura = isPermanentCard(face) ? auraTargetSpec(face) : undefined;
    const specs = aura ? [aura] : flatten(spellPrograms(face) ?? [], way.modes, way.holds, way.allModes).specs;
    prompts = targetPrompts(g, a.player, specs, way.o, a.x);
  } catch (err) {
    refused(err);
    return [];
  }
  const out: Target[][][] = [];
  const same = (x: Target, y: Target) => JSON.stringify(x) === JSON.stringify(y);
  targets.forEach((list, i) => {
    const pr = prompts[i];
    if (!pr) return;
    const least = pr.upTo ? (pr.min ?? 0) : pr.count;
    for (let k = list.length - 1; k >= least; k--) out.push(targets.map((l, j) => (j === i ? l.slice(0, k) : l)));
    if (list.length !== 1) return;
    const others = pr.candidates.filter((c) => !same(c, list[0]!));
    // (The targets that let it be cast now first: there may be many others before them.)
    const fits = (t: Target) => t.kind === 'object' && Boolean(g.objects[t.object]) && way.flashIfTargets.some((f) => matchesFilter(g, g.objects[t.object]!, f, { controller: a.player, source: way.o }));
    const ordered = way.needFlashTarget ? [...others.filter(fits), ...others.filter((c) => !fits(c))] : others;
    for (const t of ordered.slice(0, 12)) out.push(targets.map((l, j) => (j === i ? [t] : l)));
  });
  return out;
}

/**
 * Lists one way of casting a card, if the engine reads it as something the player can do now: where it is cast from,
 * the timing, restrictions, what it costs and whether that can be paid are all castWay and castCost (actions.ts) — the
 * code that casts it, stopped before anything is paid.
 *
 * A spell that asks for X is listed once, with the least X it can be cast with now and `xMax`, the most X that can be
 * paid for: a client asks the player for the number (CR 601.2b).
 */
function listCast(g: GameState, player: PlayerId, o: GameObject, how: CastHow, out: Action[], build: (x: number | undefined, choice: Choice, costs: CostChoices) => Action, only?: (way: CastWay) => boolean): void {
  const a0 = castArgs(player, o, how, 0);
  let way: CastWay;
  try {
    way = castWay(g, a0);
  } catch (err) {
    return refused(err);
  }
  if (only && !only(way)) return;
  if (!castAsksX(a0, way)) {
    const done = completeCast(g, a0, way);
    if (done) out.push(build(undefined, done.choice, done.costs));
    return;
  }
  let listed: Action | undefined;
  let most = -1;
  for (let n = 0; n <= X_LISTING_CAP; n++) {
    const a = n ? castArgs(player, o, how, n) : a0;
    let w = way;
    try {
      if (n) w = castWay(g, a);
      // Can its costs be paid with this X at all? (Not with this one: not with a larger one either.)
      castCost(g, a, w, NO_TARGETS);
    } catch (err) {
      refused(err);
      break;
    }
    most = n;
    if (listed) continue;
    const done = completeCast(g, a, w);
    if (done) out.push((listed = build(n, done.choice, done.costs)));
  }
  if (listed && listed.type === 'cast') listed.xMax = most;
}

/**
 * Cast actions using an alternative cost or adding one optional cost: those that work wherever the card is cast from,
 * or (`fromGraveyard`) the graveyard's own — escape, retrace, harmonize.
 */
function optionCasts(g: GameState, player: PlayerId, o: GameObject, fromGraveyard: boolean): Action[] {
  const face = g.cards[o.card]!.faces[0]!;
  const options = castOptionsFor(g, player, o, face);
  if (!options.length || face.types.includes('Land')) return [];
  const out: Action[] = [];
  // CR 118.8: with a required choice of additional costs ("sacrifice a creature or pay {3}"), it is cast paying one of
  // them: once for each from the hand (and with no other option), and from the graveyard each of its costs with each.
  const required = options.filter((x) => x.required);
  for (const opt of options) {
    if (required.length && !opt.required && !fromGraveyard) continue;
    // From exile (foretell, plot, madness) is listed elsewhere; as an ability resolves (miracle) isn't a player's action.
    if (opt.zone === 'exile' || opt.duringResolution) continue;
    // Each list has its own: the graveyard's (escape, retrace, harmonize) and the hand's.
    if ((opt.zone === 'graveyard') !== fromGraveyard || (opt.kind === 'additional' && fromGraveyard)) continue;
    // CR 702.37c: cast face down, it's a creature spell with no text — only from the hand.
    if ((FACE_DOWN_KEYWORDS as readonly string[]).includes(opt.id) && fromGraveyard) continue;
    const ways = opt.kind === 'alternative' ? (fromGraveyard && required.length ? required.map((r) => ({ alt: opt.id, extras: [r.id] })) : [{ alt: opt.id }]) : [{ extras: [opt.id] }];
    for (const how of ways) listCast(g, player, o, how, out, (x, choice, costs) => ({ type: 'cast', player, object: o.id, autoTap: true, ...(x !== undefined ? { x } : {}), ...choice, ...withCosts(costs), ...how }));
  }
  return out;
}

/**
 * Lists a mana ability, once for each way it can add its mana now — if the engine reads it as something the player can
 * do (manaAbilityWay in payment.ts: the code that activates it, stopped before anything is paid). A mana cost of its
 * own (a Signet's {1}) is paid from the pool where that covers it; otherwise by tapping other sources as it is
 * activated (`autoTap`).
 */
function listManaAbility(g: GameState, player: PlayerId, o: GameObject, ab: ActivatedAbility, ability: number, out: Action[]): void {
  const id = o.id;
  let costs: CostChoices | undefined;
  let tapForCost = false;
  for (const tapping of ab.cost.mana ? [false, true] : [false]) {
    try {
      costs = manaAbilityWay(g, player, id, ability, {}, tapping, true).costChoices;
      tapForCost = tapping;
      break;
    } catch (err) {
      refused(err);
    }
  }
  if (!costs) return;
  const extra = { ...withCosts(costs), ...(tapForCost ? { autoTap: true } : {}) };
  const from = out.length;
  // One entry per way to make the mana ("{R} or {G}", "one mana of any color"). With "If …, add … instead" it's the
  // mana the ability would add now: Urza's Tower's one or three, Incubation Druid's type, and for Gemstone Caverns
  // "{C}" without its luck counter and each color with it (listed as "{C}" alone, it couldn't be tapped at all).
  // Empowered Autogenerator: "Put a charge counter on this artifact. Add X mana …" — the mana, after what comes first.
  const first = ab.effects.find((e) => e.type === 'add_mana' || e.type === 'if') ?? ab.effects[0];
  const isMana = (e: EffectNode) => e.type === 'add_mana';
  const half = first?.type === 'if' ? (branchNow(g, player, o, first) ?? [...((first.else as EffectNode[] | undefined) ?? []), ...((first.effects as EffectNode[] | undefined) ?? [])]) : null;
  const effect = (half ? (half.find(isMana) ?? ab.effects.find(isMana)) : first) as AddManaEffect | undefined;
  if (effect?.combination) {
    // "X mana in any combination of colors": every mix while there are few; otherwise one of each color (any other
    // mix can still be named).
    const n = Math.max(0, amountOf({ g, controller: player, source: o, events: [], targets: [], x: 0, memo: {} }, effect.combination.amount));
    for (const choice of manaMixes(effect.combination.colors, n)) out.push({ type: 'activate_mana', player, object: id, ability, choice, ...extra });
  } else if (effect?.anyColor) {
    const colors = anyColorChoices(g, player, effect.identity, effect, o);
    for (const choice of colors) out.push({ type: 'activate_mana', player, object: id, ability, choice, ...extra });
    // CR 106.5: with no color it could add (Mox Amber and no legend), it can still be activated, and adds nothing.
    if (!colors.length) out.push({ type: 'activate_mana', player, object: id, ability, ...extra });
  } else if (effect?.options && effect.options.length > 1) {
    effect.options.forEach((opt, choice) => {
      if (manaOption(opt, o)) out.push({ type: 'activate_mana', player, object: id, ability, choice, ...extra });
    });
  } else if (!effect?.options || manaOption(effect.options[0]!, o)) out.push({ type: 'activate_mana', player, object: id, ability, ...extra });
  // Fertile Ground: "… adds an additional one mana of any color" — each color it could add, too. Kinnan: "one mana
  // of any type that permanent produced" — each type this way of making its mana makes, when there's more than one.
  if (ab.cost.tap && manaBonusAsks(g, o)) {
    const listed = out.splice(from, out.length - from);
    for (const a of listed) {
      const bonus = bonusManaChoices(g, o, a.type === 'activate_mana' ? manaTypesMade(effect, a.choice) : undefined);
      if (bonus.length) for (const b of bonus) out.push({ ...a, bonus: [b] } as Action);
      else out.push(a);
    }
  }
}

/** An activation with default modes, targets and cost choices at this X, if the engine reads it as legal. */
function completeActivation(g: GameState, player: PlayerId, o: GameObject, ab: ActivatedAbility, ability: number, x: number, shown: { x?: number; xMax?: number }): Extract<Action, { type: 'activate' }> | null {
  const choice = targetingAs(true, () => defaultProgramChoice(g, player, o, [ab], undefined, x));
  if (!choice) return null;
  // Dragonfire Blade: "This ability costs {1} less to activate for each color of the creature it targets." — the
  // target it costs least with (CR 601.2f: the cost is determined after targets are chosen).
  const spec = ab.costReduction && JSON.stringify(ab.costReduction).includes('"ref":"target"') ? flatten([ab], undefined).specs[0] : undefined;
  if (spec && choice.targets?.length === 1) {
    let best: { generic: number; target: Target } | undefined;
    for (const t of targetingAs(true, () => targetCandidates(g, player, spec, o))) {
      const m = parseManaCost(ab.cost.mana ?? '');
      applyPowerUp(g, o, ab, m, player, [[t.kind === 'object' ? { kind: 'object', id: t.object, zcc: g.objects[t.object]!.zcc } : t]]);
      if (!best || m.generic < best.generic) best = { generic: m.generic, target: t };
    }
    if (best) choice.targets = [[best.target]];
  }
  try {
    const choices: ActivationChoices = { x, autoTap: true, targets: choice.targets, modes: choice.modes, costs: {}, autoCosts: true };
    const way = activationWay(g, player, o.id, ability, choices);
    const costed = activationCost(g, player, way, activationTargets(g, player, way, choices), choices);
    return { type: 'activate', player, object: o.id, ability, autoTap: true, ...shown, ...choice, ...withCosts(costed.costs) };
  } catch (err) {
    refused(err);
    return null;
  }
}

/**
 * Why an activated ability isn't in the player's list right now, in the engine's own words — or null if it is, or
 * would be with other choices. The same reading the list makes (listActivation), keeping what it says where it stops:
 * first whether the ability may be activated at all, then whether its costs can be paid, then whether there is
 * anything to choose for it.
 */
export function whyNotActivated(g: GameState, player: PlayerId, object: ObjectId, ability: number): string | null {
  if (g.over) return 'The game is over.';
  if (g.pending) return `Waiting for ${g.players[g.pending.player]?.name ?? 'a player'} to choose.`;
  if (g.priority !== player) return 'You don’t have priority.';
  if (splitSecond(g)) return 'A spell with split second is on the stack.';
  const o = g.objects[object];
  const ab = o ? activatedAbilities(g, o)[ability] : undefined;
  if (!o || !ab) return 'It has no such ability.';
  const x = ab.cost.loyaltyX ? 1 : (ab.xMin ?? 0);
  return withStableChars(g, () => {
    try {
      const bare: ActivationChoices = { x, autoTap: true, targets: undefined, modes: undefined, costs: {}, autoCosts: true };
      const way = activationWay(g, player, object, ability, bare);
      activationCost(g, player, way, { program: { specs: [], effects: [] }, targets: [], division: undefined, source: { id: object, zcc: o.zcc } }, bare);
      if (completeActivation(g, player, o, ab, ability, x, {})) return null;
      // Nothing to choose for it: what the engine says to it with nothing chosen.
      activationCost(g, player, way, activationTargets(g, player, way, bare), bare);
      return 'There is nothing this ability could be activated with right now.';
    } catch (err) {
      refused(err);
      return (err as Error).message;
    }
  });
}

/**
 * Lists an activated ability, if the engine reads it as something the player can do now — activationWay and
 * activationCost (actions.ts), the code that activates it, stopped before anything is paid.
 */
function listActivation(g: GameState, player: PlayerId, o: GameObject, ab: ActivatedAbility, ability: number, out: Action[]): void {
  const id = o.id;
  const { cost } = ab;
  /** Whether it can be activated and paid for with this X, before anything is chosen for it. */
  const payable = (x: number): boolean => {
    try {
      const choices: ActivationChoices = { x, autoTap: true, targets: undefined, modes: undefined, costs: {}, autoCosts: true };
      const way = activationWay(g, player, id, ability, choices);
      activationCost(g, player, way, { program: { specs: [], effects: [] }, targets: [], division: undefined, source: { id, zcc: o.zcc } }, choices);
      return true;
    } catch (err) {
      refused(err);
      return false;
    }
  };
  const complete = (x: number, shown: { x?: number; xMax?: number }): Action | null => completeActivation(g, player, o, ab, ability, x, shown);
  const push = (a: Action | null): void => {
    if (a) out.push(a);
  };

  // "−X": as much loyalty as it has, and 1 (CR 606.6); "+X": 1.
  if (cost.loyaltyX) {
    const most = cost.loyaltyX < 0 ? (o.counters.loyalty ?? 0) : 1;
    for (const x of [...new Set([1, most])]) if (x >= 1) push(complete(x, { x }));
    return;
  }
  // "{X}: …" is listed once, with the least X (0, or 1 for "X can't be 0") and `xMax`, the most that can be paid for.
  // Ruthless Technomancer: "Sacrifice X artifacts: … X can't be 0." — likewise, with what there is to sacrifice.
  const asksX = parseManaCost(cost.mana ?? '').x > 0 || Boolean(cost.other?.some((c) => c.amount === 'X' && c.type !== 'remove_counters_self'));
  if (asksX) {
    const least = ab.xMin ?? 0;
    if (!payable(least)) return;
    let most = least;
    while (most < X_LISTING_CAP && payable(most + 1)) most++;
    push(complete(least, { x: least, xMax: most }));
    return;
  }
  // Arcbound Javelineer: "Remove X +1/+1 counters from this creature" — all of them.
  const removeX = cost.other?.find((c) => c.type === 'remove_counters_self' && c.xAnnounced);
  const all = removeX ? (o.counters[String(removeX.counter)] ?? 0) : undefined;
  push(complete(all ?? 0, all !== undefined ? { x: all } : {}));
}

/** Every mode, with default targets — or null when some mode has none. */
function defaultEntwined(g: GameState, player: PlayerId, o: GameObject, face: FaceDef): Choice | null {
  const programs = spellPrograms(face);
  const modal = programs?.find((p) => p.modes);
  if (!programs || !modal?.modes) return null;
  const modes = modal.modes.options.map((_, i) => i);
  const flat = flatten(programs, modes, undefined, true);
  const targets = defaultTargets(g, player, flat.specs, o);
  return targets ? { modes, ...(flat.specs.length ? { targets } : {}) } : null;
}

const withCosts = (costs: CostChoices) => (costs.sacrifice || costs.discard || costs.crew || costs.exile || costs.convoke || costs.delve || costs.improvise || costs.returned || costs.reveal || costs.blighted || costs.processed || costs.forageFood || costs.waterbend || costs.removed || costs.counters !== undefined || costs.freeEquip ? { costs } : {});

function defaultProgramChoice(g: GameState, player: PlayerId, source: GameObject, programs: Parameters<typeof flatten>[0], holds?: Parameters<typeof flatten>[2], x = 0): Choice | null {
  return defaultProgramChoices(g, player, source, programs, holds, x, 1)[0] ?? null;
}

/**
 * The default choices of modes and targets, best first: for each set of modes that could be chosen, the first legal
 * targets. Mostly the first is the one; a later one is for when the first can't be paid for (spree: each mode has a cost).
 */
function defaultProgramChoices(g: GameState, player: PlayerId, source: GameObject, programs: Parameters<typeof flatten>[0], holds: Parameters<typeof flatten>[2] | undefined, x: number, limit: number): Choice[] {
  const found: Choice[] = [];
  const modal = programs.find((p) => p.modes);
  // "Choose one that hasn't been chosen this turn": not those.
  const used = modal && 'text' in modal ? usedModes(g, source, modal as Program & { text: string }) : [];
  // Pyrrhic Strike: "choose both instead" once its additional cost is paid.
  const bonus = modal?.modes?.bonus;
  const least = modal ? (bonus?.exact && holds?.(bonus.condition) ? Math.max(modal.modes!.max, bonus.max) : modal.modes!.min) : 0;
  const modeSets: (number[] | undefined)[] = modal
    ? modal.modes!.options
        .map((_, i) => Array.from({ length: Math.max(1, least) }, (_, k) => (modal.modes!.repeat ? i : i + k)))
        .filter((m) => m.every((i) => i < modal.modes!.options.length && !used.includes(i)))
    : [undefined];
  // Modes the engine runs come first; one it can't read is still a legal choice.
  const manual = (modes: number[] | undefined) => (modes ?? []).some((i) => modal!.modes!.options[i]!.manual);
  modeSets.sort((a, b) => Number(manual(a)) - Number(manual(b)));
  for (const modes of modeSets) {
    let program: CompiledProgram;
    try {
      program = flatten(programs, modes, holds);
    } catch {
      continue;
    }
    const targets = defaultTargets(g, player, program.specs, source, x);
    // Fire Covenant with X = 0: nothing to divide among its one target — no choice at this X (CR 601.2d).
    if (targets && cantDivide(program.effects, targets, x)) continue;
    if (targets) found.push({ ...(program.specs.length ? { targets } : {}), ...(modes ? { modes } : {}) });
    if (found.length >= limit) break;
  }
  return found;
}

/** Default targets and modes for casting this card as an effect resolves (for free, whatever the timing), or null with nothing legal to choose. */
export function defaultCastChoice(g: GameState, player: PlayerId, id: ObjectId): { targets?: Target[][]; modes?: number[] } | null {
  const o = g.objects[id];
  if (!o || !g.cards[o.card]?.faces[0]) return null;
  try {
    const choice = defaultChoicesFor(g, player, castWay(g, { ...castArgs(player, o, {}, 0), during: {} }), 0)[0];
    return choice ? { ...(choice.targets ? { targets: choice.targets } : {}), ...(choice.modes ? { modes: choice.modes } : {}) } : null;
  } catch (err) {
    refused(err);
    return null;
  }
}

/**
 * The engine's default modes, targets and cost choices for a listed spell or ability at another X — "destroy X target
 * artifacts" needs X of them and "discard X cards" X cards, so a client offering the listed range asks again as the
 * number changes. Null when it can't be cast or activated with that X.
 */
export function defaultChoiceAtX(g: GameState, a: Extract<Action, { type: 'cast' | 'activate' }>, x: number): { targets?: Target[][]; modes?: number[]; costs?: CostChoices } | null {
  const o = g.objects[a.object];
  if (!o) return null;
  return withCharsCache(() => {
    const pack = (choice: Choice, costs: CostChoices) => ({ ...(choice.targets ? { targets: choice.targets } : {}), ...(choice.modes ? { modes: choice.modes } : {}), ...withCosts(costs) });
    if (a.type === 'activate') {
      const ab = activatedAbilities(g, o)[a.ability];
      const done = ab ? completeActivation(g, a.player, o, ab, a.ability, x, {}) : null;
      return done ? pack(done, done.costs ?? {}) : null;
    }
    const args = castArgs(a.player, o, { ...(a.face ? { face: a.face } : {}), ...(a.alt ? { alt: a.alt } : {}), ...(a.extras ? { extras: a.extras } : {}) }, x, a.kicked ?? false);
    try {
      const done = completeCast(g, args, castWay(g, args));
      return done ? pack(done.choice, done.costs) : null;
    } catch (err) {
      refused(err);
      return null;
    }
  });
}

/**
 * Default modes and targets for a spell as the engine reads its cast (castWay): the face it is cast as, with the
 * conditions its announced costs make true. Best first.
 */
function defaultChoicesFor(g: GameState, player: PlayerId, way: CastWay, x: number): Choice[] {
  const face = way.castFace;
  const one = (c: Choice | null): Choice[] => (c ? [c] : []);
  if (isPermanentCard(face)) {
    const aura = auraTargetSpec(face);
    if (!aura) return [{}];
    const targets = defaultTargets(g, player, [aura], way.o, x);
    return one(targets ? { targets } : null);
  }
  const programs = spellPrograms(face);
  if (!programs) return [{}];
  // CR 702.42a: entwine chooses every mode.
  if (way.allModes) return one(defaultEntwined(g, player, way.o, face));
  return defaultProgramChoices(g, player, way.o, programs, way.holds, x, hasModeCosts(face) ? 8 : 1);
}
