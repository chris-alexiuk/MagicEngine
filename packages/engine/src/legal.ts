import type { AddManaEffect, FaceDef } from '@mtg/schema';
import { planAutoTap } from './autotap.js';
import { canUseTapAbilities, isPermanentCard, manaAbilities } from './characteristics.js';
import { parseManaCost } from './mana.js';
import { activatedAbilities, flatten, spellPrograms } from './program.js';
import { defaultTargets } from './targets.js';
import type { Action, CompiledProgram, GameObject, GameState, PlayerId, Target } from './types.js';
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
  if (g.over || g.pending || g.priority !== player) return [];
  const out: Action[] = [{ type: 'pass', player }];
  const mainPhaseEmptyStack = g.active === player && (g.step === 'main1' || g.step === 'main2') && g.stack.length === 0;

  for (const id of zoneList(g, 'hand', player)) {
    const o = g.objects[id]!;
    const def = g.cards[o.card]!;
    def.faces.forEach((face, faceIndex) => {
      if (faceIndex > 0 && !['split', 'modal_dfc', 'adventure'].includes(def.layout)) return;
      if (face.types.includes('Land')) {
        if (mainPhaseEmptyStack && g.players[player]!.landsPlayedThisTurn < 1 && (faceIndex === 0 || def.layout === 'modal_dfc')) {
          out.push({ type: 'play_land', player, object: id, ...(faceIndex ? { face: faceIndex } : {}) });
        }
        return;
      }
      const instantSpeed = face.types.includes('Instant') || face.keywords.some((k) => k.id === 'flash');
      if (!instantSpeed && !mainPhaseEmptyStack) return;
      const cost = parseManaCost(face.manaCost);
      if (cost.unsupported.length || cost.x > 0) return; // X spells need a value; the UI asks for one
      if (!planAutoTap(g, player, cost)) return;
      const choice = defaultSpellChoice(g, player, o, face);
      if (!choice) return;
      out.push({ type: 'cast', player, object: id, autoTap: true, ...(faceIndex ? { face: faceIndex } : {}), ...choice });
    });
  }

  const sorcerySpeed = mainPhaseEmptyStack;
  for (const id of g.zones.battlefield) {
    const o = g.objects[id]!;
    if (o.controller !== player) continue;
    manaAbilities(g, o).forEach((ab, ability) => {
      if (ab.cost.tap && (o.tapped || !canUseTapAbilities(g, o))) return;
      if (ab.cost.mana || ab.cost.other) return;
      // One entry per way to make the mana ("{R} or {G}", "one mana of any color").
      const effect = ab.effects[0] as AddManaEffect | undefined;
      if (effect?.anyColor) {
        for (const choice of ['W', 'U', 'B', 'R', 'G'] as const) out.push({ type: 'activate_mana', player, object: id, ability, choice });
      } else if (effect?.options && effect.options.length > 1) {
        effect.options.forEach((_, choice) => out.push({ type: 'activate_mana', player, object: id, ability, choice }));
      } else out.push({ type: 'activate_mana', player, object: id, ability });
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
      if (cost.mana && !planAutoTap(g, player, mana, 0, cost.tap ? [id] : [])) return;
      const choice = defaultProgramChoice(g, player, o, [ab]);
      if (!choice) return;
      out.push({ type: 'activate', player, object: id, ability, autoTap: true, ...choice });
    });
    faceOf(g, o).unparsed.forEach((line, i) => {
      if (line.includes(': ')) out.push({ type: 'activate_manual', player, object: id, line: i, autoTap: true });
    });
  }
  return out;
}

type Choice = { targets?: Target[][]; modes?: number[] };

function defaultProgramChoice(g: GameState, player: PlayerId, source: GameObject, programs: Parameters<typeof flatten>[0]): Choice | null {
  const modal = programs.find((p) => p.modes);
  const modeSets: (number[] | undefined)[] = modal
    ? modal.modes!.options.map((_, i) => Array.from({ length: Math.max(1, modal.modes!.min) }, (_, k) => i + k)).filter((m) => m.every((i) => i < modal.modes!.options.length))
    : [undefined];
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
