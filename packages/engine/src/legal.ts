import { activationProhibited } from './cast-bans.js';
import { auraTargetSpec } from './permanents.js';
import type { AddManaEffect, EffectNode, FaceDef, ObjectFilter } from '@mtg/schema';
import { planAutoTap } from './autotap.js';
import { canUseTapAbilities, chars, isPermanentCard, manaAbilities, power, withCharsCache } from './characteristics.js';
import { helperChoices } from './helpers-cost.js';
import { FACE_DOWN_KEYWORDS, faceDownFace } from './face-down.js';
import { anyColorChoices, manaOption, parseManaCost } from './mana.js';
import { addModeCosts, addPerTargetCost, applyPowerUp, additionalCosts, castRestrictionProblem, hasModeCosts, castOptions, exileActionCost, splitSecond, exileActionTiming, faceUpCost, flashbackCost } from './actions.js';
import { craftCandidates, crewCandidates, tapCostCandidates, discardCandidates, exileCostCandidates, returnCostCandidates, sacrificeCandidates, unblockedAttackers } from './payment.js';
import { activatedAbilities, flatten, spellPrograms } from './program.js';
import { defaultTargets } from './targets.js';
import type { TargetRef, Action, CompiledProgram, CostChoices, GameObject, GameState, ManaColor, ObjectId, PlayerId, Target } from './types.js';
import { applyCostModifiers } from './costs.js';
import { evalCondition } from './conditions.js';
import { mayPlayFrom, playableFromExile } from './permissions.js';
import { landsAllowed, playerRule } from './player-rules.js';
import { activationsThisTurn } from './actions.js';
import { bestowedFace, manaValueOf } from './zones.js';
import { faceOf, zoneList } from './zones.js';

/**
 * Actions the player could take right now, for driving a UI or a bot. Casts and
 * activations are listed when the cost can be met from the pool plus automatic
 * tapping. When something needs targets or modes, the listed action carries a
 * default legal choice (the first modes, the first candidates); UIs let the player
 * change it using targetPrompts(). Choices and manual moves aren't listed; the
 * pending choice and the UI cover those.
 */
export function legalActions(g: GameState, player: PlayerId): Action[] {
  // Read-only: characteristics can be shared across the whole listing.
  return withCharsCache(() => {
    const all = listLegalActions(g, player);
    return splitSecond(g) ? all.filter((a) => a.type !== 'cast' && a.type !== 'activate') : all;
  });
}

function listLegalActions(g: GameState, player: PlayerId): Action[] {
  if (g.over || g.pending || g.priority !== player) return [];
  const out: Action[] = [{ type: 'pass', player }];
  const mainPhaseEmptyStack = g.active === player && (g.step === 'main1' || g.step === 'main2') && g.stack.length === 0;

  // "You may play lands from your graveyard."
  if (mainPhaseEmptyStack && playerRule(g, player, 'lands_from_graveyard') && g.players[player]!.landsPlayedThisTurn < landsAllowed(g, player)) {
    for (const id of zoneList(g, 'graveyard', player)) {
      const def = g.cards[g.objects[id]!.card]!;
      if (def.faces[0]!.types.includes('Land')) out.push({ type: 'play_land', player, object: id });
    }
  }
  // The hand, plus cards an effect lets this player play from exile (impulse draw).
  for (const id of [...zoneList(g, 'hand', player), ...playableFromExile(g, player)]) {
    const o = g.objects[id]!;
    const def = g.cards[o.card]!;
    def.faces.forEach((face, faceIndex) => {
      if (o.prepareOf) {
        // CR 722.3c: only its prepare spell can be cast.
        if (faceIndex !== 1) return;
      } else {
        if (o.zone === 'exile' && !mayPlayFrom(g, player, o, face.types.includes('Land') ? 'land' : 'spell')) return;
        if (faceIndex > 0 && !['split', 'modal_dfc', 'adventure'].includes(def.layout)) return;
        // CR 702.127a: an aftermath half is cast only from a graveyard.
        if (face.keywords.some((k) => k.id === 'aftermath')) return;
      }
      if (face.types.includes('Land')) {
        if (mainPhaseEmptyStack && g.players[player]!.landsPlayedThisTurn < landsAllowed(g, player) && (faceIndex === 0 || def.layout === 'modal_dfc')) {
          out.push({ type: 'play_land', player, object: id, ...(faceIndex ? { face: faceIndex } : {}) });
        }
        return;
      }
      const instantSpeed = face.types.includes('Instant') || face.keywords.some((k) => k.id === 'flash') || playerRule(g, player, 'flash');
      if (!instantSpeed && !mainPhaseEmptyStack) return;
      if (castRestrictionProblem(g, player, face, o)) return;
      const cost = parseManaCost(face.manaCost);
      applyCostModifiers(g, player, o, face, cost);
      // X spells need a value; the UI asks for one (also "discard X cards" as an additional cost).
      if (cost.unsupported.length || cost.x > 0 || additionalCosts(face).some((c) => c.amount === 'X')) return;
      // Convoke, improvise, delve: what they can cover, if mana alone isn't enough.
      const helpers = face.keywords.map((k) => k.id).filter((k) => k === 'convoke' || k === 'delve' || k === 'improvise');
      let help: CostChoices = {};
      const purpose = { kind: 'spell' as const, object: o };
      const costs = defaultCostChoices(g, player, o, additionalCosts(face));
      if (!costs) return;
      // Creatures tapped for an additional cost can't also tap for mana.
      const tappedForCost = costs.crew ?? [];
      if (!planAutoTap(g, player, cost, 0, tappedForCost, purpose)) {
        if (!helpers.length) return;
        help = helperChoices(g, player, o, helpers, cost);
        const rest = { ...cost, specific: { ...cost.specific } };
        payWithHelpersDry(g, help, rest);
        if (!planAutoTap(g, player, rest, 0, [...(help.convoke ?? []), ...(help.improvise ?? []), ...tappedForCost], purpose)) return;
      }
      const choice = defaultSpellChoice(g, player, o, face);
      if (!choice) return;
      // Strive: the chosen targets add to the cost; spree and tiered: the chosen modes do; "costs {3} more to cast
      // if it targets a creature" looks at the targets (CR 601.2f).
      const lookAtTargets = face.abilities.some((a) => a.kind === 'static' && a.effect.type === 'cost_modifier' && Boolean((a.effect as { ifTargets?: unknown }).ifTargets));
      if (face.abilities.some((a) => a.kind === 'static' && a.effect.type === 'per_target_cost') || hasModeCosts(face) || lookAtTargets) {
        const total = parseManaCost(face.manaCost);
        const refs = (choice.targets ?? []).map((list) => list.map((t): TargetRef => (t.kind === 'object' ? { kind: 'object', id: t.object, zcc: g.objects[t.object]!.zcc } : (t as TargetRef))));
        applyCostModifiers(g, player, o, face, total, refs);
        addPerTargetCost(face, choice.targets, total);
        addModeCosts(face, choice.modes, total);
        if (!planAutoTap(g, player, total, 0, tappedForCost, purpose)) return;
      }
      const all = { ...costs, ...help };
      out.push({ type: 'cast', player, object: id, autoTap: true, ...(faceIndex ? { face: faceIndex } : {}), ...choice, ...withCosts(all) });
    });
    // CR 118.9 / 601.2f: the same spell for an alternative cost, or with an optional additional one.
    if (o.zone === 'hand') out.push(...optionCasts(g, player, o, mainPhaseEmptyStack, false));
  }
  // CR 702.138a: escape from the graveyard.
  for (const id of zoneList(g, 'graveyard', player)) out.push(...optionCasts(g, player, g.objects[id]!, mainPhaseEmptyStack, true));

  // Foretell, plot, suspend from the hand (special actions, CR 116.2).
  for (const id of zoneList(g, 'hand', player)) {
    const o = g.objects[id]!;
    const face = g.cards[o.card]!.faces[0]!;
    for (const kind of ['foretell', 'plot', 'suspend'] as const) {
      const costText = exileActionCost(face, kind);
      if (!costText || !exileActionTiming(g, player, face, kind)) continue;
      if (planAutoTap(g, player, parseManaCost(costText))) out.push({ type: kind, player, object: id, autoTap: true });
    }
  }
  // Foretold and plotted cards in exile, on a later turn.
  for (const id of g.zones.exile) {
    const o = g.objects[id]!;
    if (o.owner !== player || (o.foretold === undefined && o.plotted === undefined)) continue;
    const face = g.cards[o.card]!.faces[0]!;
    const opt = castOptions(face).find((x) => x.id === (o.foretold !== undefined ? 'foretell' : 'plot'));
    if (!opt || (o.foretold ?? o.plotted)! >= g.turn) continue;
    if (opt.id === 'plot' && !mainPhaseEmptyStack) continue;
    const instant = face.types.includes('Instant') || face.keywords.some((k) => k.id === 'flash');
    if (opt.id === 'foretell' && !instant && !mainPhaseEmptyStack) continue;
    if (castRestrictionProblem(g, player, face, o)) continue;
    if (!planAutoTap(g, player, parseManaCost(opt.cost.mana ?? ''))) continue;
    const choice = defaultSpellChoice(g, player, o, face);
    if (choice) out.push({ type: 'cast', player, object: id, autoTap: true, alt: opt.id, ...choice });
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
    const fb = flashbackCost(face);
    if (!fb) continue;
    const instantSpeed = face.types.includes('Instant') || face.keywords.some((k) => k.id === 'flash');
    if (!instantSpeed && !mainPhaseEmptyStack) continue;
    if (castRestrictionProblem(g, player, face, o)) continue;
    const fbCost = parseManaCost(fb);
    applyCostModifiers(g, player, o, face, fbCost);
    if (!planAutoTap(g, player, fbCost, 0, [], { kind: 'spell', object: o })) continue;
    const choice = defaultSpellChoice(g, player, o, face);
    const costs = defaultCostChoices(g, player, o, additionalCosts(face));
    if (choice && costs) out.push({ type: 'cast', player, object: id, autoTap: true, ...choice, ...withCosts(costs) });
  }
  // CR 702.127a: aftermath halves of split cards in the graveyard.
  for (const id of zoneList(g, 'graveyard', player)) {
    const o = g.objects[id]!;
    const def = g.cards[o.card]!;
    def.faces.forEach((face, faceIndex) => {
      if (!face.keywords.some((k) => k.id === 'aftermath')) return;
      const instantSpeed = face.types.includes('Instant') || face.keywords.some((k) => k.id === 'flash');
      if (!instantSpeed && !mainPhaseEmptyStack) return;
      if (castRestrictionProblem(g, player, face, o)) return;
      const cost = parseManaCost(face.manaCost);
      applyCostModifiers(g, player, o, face, cost);
      if (cost.unsupported.length || cost.x > 0 || !planAutoTap(g, player, cost, 0, [], { kind: 'spell', object: o })) return;
      const choice = defaultSpellChoice(g, player, o, face);
      const costs = defaultCostChoices(g, player, o, additionalCosts(face));
      if (choice && costs) out.push({ type: 'cast', player, object: id, autoTap: true, face: faceIndex, ...choice, ...withCosts(costs) });
    });
  }
  // Abilities that work from the hand (cycling, CR 702.29a) or the graveyard (CR 113.6m).
  for (const id of [...zoneList(g, 'hand', player), ...zoneList(g, 'graveyard', player)]) {
    const o = g.objects[id]!;
    if (activationProhibited(g, player, o, false)) continue;
    activatedAbilities(g, o).forEach((ab, ability) => {
      const mana = parseManaCost(ab.cost.mana ?? '');
      if (mana.unsupported.length || mana.x > 0 || (ab.cost.mana && !planAutoTap(g, player, mana, 0, [], { kind: 'ability', source: o }))) return;
      if (ab.timing === 'sorcery' && !mainPhaseEmptyStack) return;
      // "Activate only during your upkeep." (CR 602.5b)
      if (ab.activateIf && !evalCondition(ab.activateIf, { g, controller: player, source: o, events: [], targets: [], x: 0, memo: {} })) return;
      const choice = defaultProgramChoice(g, player, o, [ab]);
      const costs = defaultCostChoices(g, player, o, ab.cost.other ?? []);
      if (choice && costs) out.push({ type: 'activate', player, object: id, ability, autoTap: true, ...choice, ...withCosts(costs) });
    });
  }

  const sorcerySpeed = mainPhaseEmptyStack;
  for (const id of g.zones.battlefield) {
    const o = g.objects[id]!;
    // CR 602.2: "Any player may activate this ability."
    const mine = o.controller === player;
    if (!mine && !activatedAbilities(g, o).some((a) => a.anyPlayer)) continue;
    const banned = activationProhibited(g, player, o, false);
    const manaBanned = activationProhibited(g, player, o, true);
    if (mine && !manaBanned) manaAbilities(g, o).forEach((ab, ability) => {
      if (ab.cost.tap && (o.tapped || !canUseTapAbilities(g, o))) return;
      if (ab.cost.mana) return;
      if (ab.activateIf && !evalCondition(ab.activateIf, { g, controller: player, source: o, events: [], targets: [], x: 0, memo: {} })) return;
      if (ab.oncePerTurn && o.activatedTurn?.[-1 - ability] === g.turn) return;
      let costs: CostChoices = {};
      if (ab.cost.other) {
        if (ab.cost.other.some((c) => c.type === 'pay_life' && g.players[player]!.life < Number(c.amount))) return;
        const picked = defaultCostChoices(g, player, o, ab.cost.other);
        if (!picked) return;
        costs = picked;
      }
      const extra = withCosts(costs);
      // One entry per way to make the mana ("{R} or {G}", "one mana of any color").
      const effect = ab.effects[0] as AddManaEffect | undefined;
      if (effect?.anyColor) {
        for (const choice of anyColorChoices(g, player, effect.identity, effect)) out.push({ type: 'activate_mana', player, object: id, ability, choice, ...extra });
      } else if (effect?.options && effect.options.length > 1) {
        effect.options.forEach((opt, choice) => {
          if (manaOption(opt, o)) out.push({ type: 'activate_mana', player, object: id, ability, choice, ...extra });
        });
      } else if (!effect?.options || manaOption(effect.options[0]!, o)) out.push({ type: 'activate_mana', player, object: id, ability, ...extra });
    });
    if (!banned) activatedAbilities(g, o).forEach((ab, ability) => {
      if (!mine && !ab.anyPlayer) return;
      if (ab.maxPerTurn && activationsThisTurn(g, o, ability) >= ab.maxPerTurn) return;
      const { cost } = ab;
      if (ab.activateIf && !evalCondition(ab.activateIf, { g, controller: player, source: o, events: [], targets: [], x: 0, memo: {} })) return;
      if ((ab.timing === 'sorcery' || cost.loyalty !== undefined) && !sorcerySpeed) return;
      if (cost.loyalty !== undefined && (o.loyaltyActivatedTurn === g.turn || (o.counters.loyalty ?? 0) + cost.loyalty < 0)) return;
      if (ab.oncePerTurn && o.activatedTurn?.[ability] === g.turn) return;
      if (ab.oncePerGame && o.activatedOnce?.[ability]) return;
      if (cost.tap && (o.tapped || !canUseTapAbilities(g, o))) return;
      if (cost.untap && !o.tapped) return;
      if (cost.other?.some((c) => c.type === 'pay_life' && g.players[player]!.life < Number(c.amount))) return;
      const mana = parseManaCost(cost.mana ?? '');
      if (mana.unsupported.length || mana.x > 0) return;
      applyPowerUp(g, o, ab, mana);
      const costs = defaultCostChoices(g, player, o, cost.other ?? []);
      if (!costs) return;
      if (cost.mana && !planAutoTap(g, player, mana, 0, [...(cost.tap ? [id] : []), ...(costs.sacrifice ?? []), ...(costs.crew ?? [])], { kind: 'ability', source: o })) return;
      const choice = defaultProgramChoice(g, player, o, [ab]);
      if (!choice) return;
      out.push({ type: 'activate', player, object: id, ability, autoTap: true, ...choice, ...withCosts(costs) });
    });
    if (mine) faceOf(g, o).unparsed.forEach((line, i) => {
      if (line.includes(': ')) out.push({ type: 'activate_manual', player, object: id, line: i, autoTap: true });
    });
  }
  return out;
}

type Choice = { targets?: Target[][]; modes?: number[]; costs?: CostChoices };

/** A default way to pay sacrifice/discard costs (the first candidates), or null if they can't be paid. */
/** Cast actions using an alternative cost or adding one optional cost (from the hand; escape from the graveyard). */
function optionCasts(g: GameState, player: PlayerId, o: GameObject, sorcerySpeed: boolean, fromGraveyard: boolean): Action[] {
  const face = g.cards[o.card]!.faces[0]!;
  const options = castOptions(face);
  if (!options.length || face.types.includes('Land')) return [];
  const instantSpeed = face.types.includes('Instant') || face.keywords.some((k) => k.id === 'flash') || playerRule(g, player, 'flash');
  const out: Action[] = [];
  for (const opt of options) {
    // From exile (foretell, plot, madness) is listed elsewhere.
    if (opt.zone === 'exile' || opt.duringResolution) continue;
    // CR 702.37c: cast face down, it's a creature spell with no text.
    if ((FACE_DOWN_KEYWORDS as readonly string[]).includes(opt.id)) {
      if (fromGraveyard || !sorcerySpeed) continue;
      // Cost changes apply to the face-down spell too ("Creature spells you cast cost {1} more").
      const downCost = parseManaCost('{3}');
      applyCostModifiers(g, player, o, faceDownFace({ ...o, faceDown: opt.id === 'disguise' ? 'disguise' : 'morph' }), downCost);
      if (!downCost.unsupported.length && planAutoTap(g, player, downCost)) out.push({ type: 'cast', player, object: o.id, autoTap: true, alt: opt.id });
      continue;
    }
    // CR 601.3: "Cast this spell only during combat" applies whatever cost it's cast for (not face down: no text).
    if (castRestrictionProblem(g, player, face, o)) continue;
    // CR 702.190a: sneak only during your declare blockers step.
    if (opt.id === 'sneak') {
      if (fromGraveyard || g.active !== player || g.step !== 'declare_blockers') continue;
    } else if (!instantSpeed && !sorcerySpeed) continue;
    if ((opt.zone === 'graveyard') !== fromGraveyard) continue;
    if (opt.kind === 'additional' && fromGraveyard) continue;
    if (opt.condition && !evalCondition(opt.condition, { g, controller: player, source: o, events: [], targets: [], x: 0, memo: {} })) continue;
    const cost = parseManaCost(opt.kind === 'alternative' ? (opt.withManaCost ? `${face.manaCost}${opt.cost.mana ?? ''}` : (opt.cost.mana ?? '')) : face.manaCost);
    if (opt.kind === 'additional') {
      const extra = parseManaCost(opt.cost.mana ?? '');
      cost.generic += extra.generic;
      cost.hybrid.push(...extra.hybrid);
      for (const [k, n] of Object.entries(extra.specific)) cost.specific[k as ManaColor] = (cost.specific[k as ManaColor] ?? 0) + (n ?? 0);
      cost.unsupported.push(...extra.unsupported);
      cost.x += extra.x;
    }
    applyCostModifiers(g, player, o, face, cost);
    // Emerge: the creature it would sacrifice lowers the cost.
    if (opt.reduceBySacrificed) {
      const sac = defaultCostChoices(g, player, o, opt.cost.other ?? [])?.sacrifice?.[0];
      if (sac) cost.generic = Math.max(0, cost.generic - manaValueOf(g, g.objects[sac]!));
    }
    // Creatures it would tap for the cost: harmonize's lowers it; none of them can also tap for mana.
    const tappedForCost = defaultCostChoices(g, player, o, [...additionalCosts(face), ...(opt.cost.other ?? [])])?.crew ?? [];
    if (opt.reduceByTappedPower && tappedForCost[0]) cost.generic = Math.max(0, cost.generic - Math.max(0, power(g, g.objects[tappedForCost[0]]!)));
    if (cost.unsupported.length || cost.x > 0 || !planAutoTap(g, player, cost, 0, tappedForCost, { kind: 'spell', object: o })) continue;
    // Entwine casts it with every mode; otherwise the default choices.
    // Overload: the "each" version takes no targets; disturb: the back face is cast.
    const asCast = opt.spell
      ? { ...face, abilities: [...face.abilities.filter((a) => a.kind !== 'spell'), opt.spell] }
      : opt.transformed
        ? (g.cards[o.card]!.faces[1] ?? face)
        : opt.id === 'bestow'
          ? bestowedFace(face)
          : face;
    const choice = opt.allModes ? defaultEntwined(g, player, o, face) : defaultSpellChoice(g, player, o, asCast);
    const costs = defaultCostChoices(g, player, o, [...additionalCosts(face), ...(opt.cost.other ?? [])]);
    if (!choice || !costs) continue;
    out.push({ type: 'cast', player, object: o.id, autoTap: true, ...choice, ...withCosts(costs), ...(opt.kind === 'alternative' ? { alt: opt.id } : { extras: [opt.id] }) });
  }
  return out;
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

function defaultCostChoices(g: GameState, player: PlayerId, source: GameObject, other: EffectNode[]): CostChoices | null {
  const sacrifice: ObjectId[] = [];
  const discard: ObjectId[] = [];
  const crew: ObjectId[] = [];
  const exile: ObjectId[] = [];
  const returned: ObjectId[] = [];
  // "Remove any number of storage counters": all of them, by default.
  let counters: number | undefined;
  for (const c of other) {
    const n = Number(c.amount ?? 1);
    if (c.type === 'sacrifice') {
      const pick = sacrificeCandidates(g, player, c, source).filter((id) => !sacrifice.includes(id)).slice(0, n);
      if (pick.length < n) return null;
      sacrifice.push(...pick);
    } else if (c.type === 'discard') {
      const pick = discardCandidates(g, player, source, c.filter as ObjectFilter | undefined).filter((id) => !discard.includes(id)).slice(0, n);
      if (pick.length < n) return null;
      discard.push(...pick);
    } else if (c.type === 'collect_evidence') {
      // The biggest cards first, until there's enough.
      const yard = zoneList(g, 'graveyard', player).filter((id) => id !== source.id && !exile.includes(id)).sort((a, b) => manaValueOf(g, g.objects[b]!) - manaValueOf(g, g.objects[a]!));
      let total = 0;
      for (const id of yard) {
        if (total >= n) break;
        exile.push(id);
        total += manaValueOf(g, g.objects[id]!);
      }
      if (total < n) return null;
    } else if (c.type === 'craft') {
      // Cards in the graveyard first, then permanents.
      const pick = craftCandidates(g, player, source, c).filter((id) => !exile.includes(id)).slice(0, n);
      if (pick.length < n) return null;
      exile.push(...pick);
    } else if (c.type === 'exile_cards') {
      const pick = exileCostCandidates(g, player, source, c).filter((id) => !exile.includes(id)).slice(0, n);
      if (pick.length < n) return null;
      exile.push(...pick);
    } else if (c.type === 'pay_life' && g.players[player]!.life < n) return null;
    else if (c.type === 'pay_energy' && (g.players[player]!.counters?.energy ?? 0) < n) return null;
    else if (c.type === 'remove_counters_self' && c.amount === 'X') counters = source.counters[String(c.counter)] ?? 0;
    else if (c.type === 'remove_counters_self' && (source.counters[String(c.counter)] ?? 0) < n) return null;
    else if (c.type === 'return_permanents') {
      // Tapped ones first (their mana is already spent).
      const pick = returnCostCandidates(g, player, source, c)
        .filter((id) => !returned.includes(id))
        .sort((a, b) => Number(g.objects[b]!.tapped) - Number(g.objects[a]!.tapped))
        .slice(0, n);
      if (pick.length < n) return null;
      returned.push(...pick);
    } else if (c.type === 'return_unblocked') {
      const first = unblockedAttackers(g, player)[0];
      if (!first) return null;
      returned.push(first);
    } else if (c.type === 'tap_creatures') {
      // "up to one" (harmonize): the strongest, for the biggest reduction; otherwise what doesn't make mana first.
      const options = tapCostCandidates(g, player, source, c).filter((id) => !crew.includes(id));
      if (c.upTo) options.sort((a, b) => power(g, g.objects[b]!) - power(g, g.objects[a]!));
      else options.sort((a, b) => Number(manaAbilities(g, g.objects[a]!).length > 0) - Number(manaAbilities(g, g.objects[b]!).length > 0));
      const pick = options.slice(0, n);
      if (pick.length < n && !c.upTo) return null;
      crew.push(...pick);
    } else if (c.type === 'station') {
      // The strongest other creature.
      const best = crewCandidates(g, player, source).sort((a, b) => power(g, g.objects[b]!) - power(g, g.objects[a]!))[0];
      if (!best) return null;
      crew.push(best);
    } else if (c.type === 'crew') {
      // The strongest creatures first, until there's enough power.
      const options = crewCandidates(g, player, source).sort((a, b) => power(g, g.objects[b]!) - power(g, g.objects[a]!));
      let total = 0;
      for (const id of options) {
        if (total >= Number(c.power)) break;
        crew.push(id);
        total += power(g, g.objects[id]!);
      }
      if (total < Number(c.power)) return null;
    }
  }
  return { ...(sacrifice.length ? { sacrifice } : {}), ...(discard.length ? { discard } : {}), ...(crew.length ? { crew } : {}), ...(exile.length ? { exile } : {}), ...(returned.length ? { returned } : {}), ...(counters !== undefined ? { counters } : {}) };
}

const withCosts = (costs: CostChoices) => (costs.sacrifice || costs.discard || costs.crew || costs.exile || costs.convoke || costs.delve || costs.improvise || costs.returned || costs.counters !== undefined ? { costs } : {});

/** What convoke/improvise/delve choices would leave of the cost (mirrors payWithHelpers). */
function payWithHelpersDry(g: GameState, help: CostChoices, cost: ReturnType<typeof parseManaCost>): void {
  for (const id of help.convoke ?? []) {
    const color = chars(g, g.objects[id]!).colors.find((c) => (cost.specific[c as ManaColor] ?? 0) > 0) as ManaColor | undefined;
    if (color) cost.specific[color] = cost.specific[color]! - 1;
    else cost.generic--;
  }
  cost.generic -= (help.improvise?.length ?? 0) + (help.delve?.length ?? 0);
}

function defaultProgramChoice(g: GameState, player: PlayerId, source: GameObject, programs: Parameters<typeof flatten>[0]): Choice | null {
  const modal = programs.find((p) => p.modes);
  const modeSets: (number[] | undefined)[] = modal
    ? modal.modes!.options.map((_, i) => Array.from({ length: Math.max(1, modal.modes!.min) }, (_, k) => (modal.modes!.repeat ? i : i + k))).filter((m) => m.every((i) => i < modal.modes!.options.length))
    : [undefined];
  // Modes the engine runs come first; one it can't read is still a legal choice.
  const manual = (modes: number[] | undefined) => (modes ?? []).some((i) => modal!.modes!.options[i]!.manual);
  modeSets.sort((a, b) => Number(manual(a)) - Number(manual(b)));
  for (const modes of modeSets) {
    let program: CompiledProgram;
    try {
      program = flatten(programs, modes);
    } catch {
      continue;
    }
    const targets = defaultTargets(g, player, program.specs, source);
    if (targets) return { ...(program.specs.length ? { targets } : {}), ...(modes ? { modes } : {}) };
  }
  return null;
}

/** Default targets and modes for casting this card now (e.g. for free, as an effect resolves). */
export function defaultCastChoice(g: GameState, player: PlayerId, id: ObjectId): { targets?: Target[][]; modes?: number[] } | null {
  const o = g.objects[id];
  const face = o ? g.cards[o.card]?.faces[0] : undefined;
  if (!o || !face) return null;
  const choice = defaultSpellChoice(g, player, o, face);
  return choice ? { ...(choice.targets ? { targets: choice.targets } : {}), ...(choice.modes ? { modes: choice.modes } : {}) } : null;
}

function defaultSpellChoice(g: GameState, player: PlayerId, o: GameObject, face: FaceDef): Choice | null {
  if (isPermanentCard(face)) {
    const aura = auraTargetSpec(face);
    if (!aura) return {};
    const targets = defaultTargets(g, player, [aura], o);
    return targets ? { targets } : null;
  }
  const programs = spellPrograms(face);
  if (!programs) return {};
  return defaultProgramChoice(g, player, o, programs);
}
