import type { AddManaEffect, EffectNode, FaceDef } from '@mtg/schema';
import { planAutoTap } from './autotap.js';
import { canUseTapAbilities, isPermanentCard, manaAbilities, withCharsCache } from './characteristics.js';
import { manaOption, parseManaCost } from './mana.js';
import { additionalCosts, flashbackCost } from './actions.js';
import { discardCandidates, sacrificeCandidates } from './payment.js';
import { activatedAbilities, flatten, spellPrograms } from './program.js';
import { defaultTargets } from './targets.js';
import type { Action, CompiledProgram, CostChoices, GameObject, GameState, ObjectId, PlayerId, Target } from './types.js';
import { applyCostModifiers } from './costs.js';
import { mayPlayFrom, playableFromExile } from './permissions.js';
import { landsAllowed, playerRule } from './player-rules.js';
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
  return withCharsCache(() => listLegalActions(g, player));
}

function listLegalActions(g: GameState, player: PlayerId): Action[] {
  if (g.over || g.pending || g.priority !== player) return [];
  const out: Action[] = [{ type: 'pass', player }];
  const mainPhaseEmptyStack = g.active === player && (g.step === 'main1' || g.step === 'main2') && g.stack.length === 0;

  // The hand, plus cards an effect lets this player play from exile (impulse draw).
  for (const id of [...zoneList(g, 'hand', player), ...playableFromExile(g, player)]) {
    const o = g.objects[id]!;
    const def = g.cards[o.card]!;
    def.faces.forEach((face, faceIndex) => {
      if (o.zone === 'exile' && !mayPlayFrom(g, player, o, face.types.includes('Land') ? 'land' : 'spell')) return;
      if (faceIndex > 0 && !['split', 'modal_dfc', 'adventure'].includes(def.layout)) return;
      if (face.types.includes('Land')) {
        if (mainPhaseEmptyStack && g.players[player]!.landsPlayedThisTurn < landsAllowed(g, player) && (faceIndex === 0 || def.layout === 'modal_dfc')) {
          out.push({ type: 'play_land', player, object: id, ...(faceIndex ? { face: faceIndex } : {}) });
        }
        return;
      }
      const instantSpeed = face.types.includes('Instant') || face.keywords.some((k) => k.id === 'flash') || playerRule(g, player, 'flash');
      if (!instantSpeed && !mainPhaseEmptyStack) return;
      const cost = parseManaCost(face.manaCost);
      applyCostModifiers(g, player, o, face, cost);
      if (cost.unsupported.length || cost.x > 0) return; // X spells need a value; the UI asks for one
      if (!planAutoTap(g, player, cost)) return;
      const choice = defaultSpellChoice(g, player, o, face);
      const costs = defaultCostChoices(g, player, o, additionalCosts(face));
      if (!choice || !costs) return;
      out.push({ type: 'cast', player, object: id, autoTap: true, ...(faceIndex ? { face: faceIndex } : {}), ...choice, ...withCosts(costs) });
    });
  }

  // CR 702.34a: flashback spells in the graveyard.
  for (const id of zoneList(g, 'graveyard', player)) {
    const o = g.objects[id]!;
    const face = g.cards[o.card]!.faces[0]!;
    const fb = flashbackCost(face);
    if (!fb) continue;
    const instantSpeed = face.types.includes('Instant') || face.keywords.some((k) => k.id === 'flash');
    if (!instantSpeed && !mainPhaseEmptyStack) continue;
    const fbCost = parseManaCost(fb);
    applyCostModifiers(g, player, o, face, fbCost);
    if (!planAutoTap(g, player, fbCost)) continue;
    const choice = defaultSpellChoice(g, player, o, face);
    const costs = defaultCostChoices(g, player, o, additionalCosts(face));
    if (choice && costs) out.push({ type: 'cast', player, object: id, autoTap: true, ...choice, ...withCosts(costs) });
  }
  // Abilities that work from the hand (cycling, CR 702.29a) or the graveyard (CR 113.6m).
  for (const id of [...zoneList(g, 'hand', player), ...zoneList(g, 'graveyard', player)]) {
    const o = g.objects[id]!;
    activatedAbilities(g, o).forEach((ab, ability) => {
      const mana = parseManaCost(ab.cost.mana ?? '');
      if (mana.unsupported.length || mana.x > 0 || (ab.cost.mana && !planAutoTap(g, player, mana))) return;
      if (ab.timing === 'sorcery' && !mainPhaseEmptyStack) return;
      const choice = defaultProgramChoice(g, player, o, [ab]);
      const costs = defaultCostChoices(g, player, o, ab.cost.other ?? []);
      if (choice && costs) out.push({ type: 'activate', player, object: id, ability, autoTap: true, ...choice, ...withCosts(costs) });
    });
  }

  const sorcerySpeed = mainPhaseEmptyStack;
  for (const id of g.zones.battlefield) {
    const o = g.objects[id]!;
    if (o.controller !== player) continue;
    manaAbilities(g, o).forEach((ab, ability) => {
      if (ab.cost.tap && (o.tapped || !canUseTapAbilities(g, o))) return;
      if (ab.cost.mana) return;
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
        for (const choice of ['W', 'U', 'B', 'R', 'G'] as const) out.push({ type: 'activate_mana', player, object: id, ability, choice, ...extra });
      } else if (effect?.options && effect.options.length > 1) {
        effect.options.forEach((opt, choice) => {
          if (manaOption(opt, o)) out.push({ type: 'activate_mana', player, object: id, ability, choice, ...extra });
        });
      } else if (!effect?.options || manaOption(effect.options[0]!, o)) out.push({ type: 'activate_mana', player, object: id, ability, ...extra });
    });
    activatedAbilities(g, o).forEach((ab, ability) => {
      const { cost } = ab;
      if ((ab.timing === 'sorcery' || cost.loyalty !== undefined) && !sorcerySpeed) return;
      if (cost.loyalty !== undefined && (o.loyaltyActivatedTurn === g.turn || (o.counters.loyalty ?? 0) + cost.loyalty < 0)) return;
      if (ab.oncePerTurn && o.activatedTurn?.[ability] === g.turn) return;
      if (cost.tap && (o.tapped || !canUseTapAbilities(g, o))) return;
      if (cost.untap && !o.tapped) return;
      if (cost.other?.some((c) => c.type === 'pay_life' && g.players[player]!.life < Number(c.amount))) return;
      const mana = parseManaCost(cost.mana ?? '');
      if (mana.unsupported.length || mana.x > 0) return;
      const costs = defaultCostChoices(g, player, o, cost.other ?? []);
      if (!costs) return;
      if (cost.mana && !planAutoTap(g, player, mana, 0, [...(cost.tap ? [id] : []), ...(costs.sacrifice ?? [])])) return;
      const choice = defaultProgramChoice(g, player, o, [ab]);
      if (!choice) return;
      out.push({ type: 'activate', player, object: id, ability, autoTap: true, ...choice, ...withCosts(costs) });
    });
    faceOf(g, o).unparsed.forEach((line, i) => {
      if (line.includes(': ')) out.push({ type: 'activate_manual', player, object: id, line: i, autoTap: true });
    });
  }
  return out;
}

type Choice = { targets?: Target[][]; modes?: number[]; costs?: CostChoices };

/** A default way to pay sacrifice/discard costs (the first candidates), or null if they can't be paid. */
function defaultCostChoices(g: GameState, player: PlayerId, source: GameObject, other: EffectNode[]): CostChoices | null {
  const sacrifice: ObjectId[] = [];
  const discard: ObjectId[] = [];
  for (const c of other) {
    const n = Number(c.amount ?? 1);
    if (c.type === 'sacrifice') {
      const pick = sacrificeCandidates(g, player, c, source).filter((id) => !sacrifice.includes(id)).slice(0, n);
      if (pick.length < n) return null;
      sacrifice.push(...pick);
    } else if (c.type === 'discard') {
      const pick = discardCandidates(g, player, source).filter((id) => !discard.includes(id)).slice(0, n);
      if (pick.length < n) return null;
      discard.push(...pick);
    } else if (c.type === 'pay_life' && g.players[player]!.life < n) return null;
    else if (c.type === 'pay_energy' && (g.players[player]!.counters?.energy ?? 0) < n) return null;
  }
  return { ...(sacrifice.length ? { sacrifice } : {}), ...(discard.length ? { discard } : {}) };
}

const withCosts = (costs: CostChoices) => (costs.sacrifice || costs.discard ? { costs } : {});

function defaultProgramChoice(g: GameState, player: PlayerId, source: GameObject, programs: Parameters<typeof flatten>[0]): Choice | null {
  const modal = programs.find((p) => p.modes);
  const modeSets: (number[] | undefined)[] = modal
    ? modal.modes!.options.map((_, i) => Array.from({ length: Math.max(1, modal.modes!.min) }, (_, k) => i + k)).filter((m) => m.every((i) => i < modal.modes!.options.length))
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

function defaultSpellChoice(g: GameState, player: PlayerId, o: GameObject, face: FaceDef): Choice | null {
  if (isPermanentCard(face)) {
    const enchant = face.subtypes.includes('Aura') ? face.keywords.find((k) => k.id === 'enchant' && k.filter) : undefined;
    if (!enchant) return {};
    const targets = defaultTargets(g, player, [{ what: 'object', filter: enchant.filter!, text: 'enchant' }], o);
    return targets ? { targets } : null;
  }
  const programs = spellPrograms(face);
  if (!programs) return {};
  return defaultProgramChoice(g, player, o, programs);
}
