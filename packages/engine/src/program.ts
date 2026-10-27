import type { ActivatedAbility, ConditionNode, EffectNode, FaceDef, Program, TargetSpec } from '@mtg/schema';
import { abilitiesOf, hasRule } from './characteristics.js';
import { canAutomate } from './registry.js';
import { RulesError, type CompiledProgram, type GameObject, type GameState } from './types.js';

/**
 * Turns the compiled programs of a spell or ability (with modes chosen) into the one
 * list of target specs and effects the engine runs. Target indexes in later programs
 * are shifted so every effect points at the right spec.
 */
export function flatten(programs: Program[], modes: number[] | undefined, holds?: (c: ConditionNode) => boolean, allModes = false): CompiledProgram {
  const specs: TargetSpec[] = [];
  const effects: EffectNode[] = [];
  const add = (targets: TargetSpec[] | undefined, list: EffectNode[]) => {
    const offset = specs.length;
    specs.push(...(targets ?? []));
    effects.push(...list.map((e) => shiftTargets(e, offset)));
  };
  let usedModes = false;
  let manual = false;
  for (const p of programs) {
    if ((p as { manual?: true }).manual) manual = true;
    if (p.modes) {
      // CR 700.2a / CR 700.2d: the chosen modes, each at most once, followed in printed order.
      const chosen = modes ?? [];
      if (usedModes) throw new RulesError('Only one modal choice is supported per spell or ability.');
      usedModes = true;
      // "If you control a commander as you cast this spell, you may choose both instead."
      // CR 702.42a: entwine chooses every mode.
      const max = allModes ? p.modes.options.length : p.modes.bonus && holds?.(p.modes.bonus.condition) ? Math.max(p.modes.max, p.modes.bonus.max) : p.modes.max;
      if (chosen.length < p.modes.min || chosen.length > max) {
        throw new RulesError(`Choose ${p.modes.min === max ? p.modes.min : `${p.modes.min}–${max}`} mode(s).`);
      }
      if (new Set(chosen).size !== chosen.length || chosen.some((m) => !p.modes!.options[m])) {
        throw new RulesError('Choose each mode at most once.');
      }
      for (const m of [...chosen].sort((a, b) => a - b)) add(p.modes.options[m]!.targets, p.modes.options[m]!.effects);
      if (chosen.some((m) => p.modes!.options[m]!.manual)) manual = true;
    }
    add(p.targets, p.effects);
  }
  if (modes?.length && !usedModes) throw new RulesError('That isn’t modal.');
  return { specs, effects, ...(manual ? { manual: true as const } : {}) };
}

function shiftTargets<T>(node: T, offset: number): T {
  if (offset === 0) return structuredClone(node);
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x);
      if (out.ref === 'target' && typeof out.index === 'number') out.index = out.index + offset;
      return out;
    }
    return v;
  };
  return walk(node) as T;
}

/** Every effect in a program, including those inside modes and "may" wrappers. */
function allEffects(p: Program): EffectNode[] {
  const out: EffectNode[] = [];
  const visit = (list: EffectNode[]) => {
    for (const e of list) {
      out.push(e);
      if (Array.isArray(e.effects)) visit(e.effects as EffectNode[]);
    }
  };
  visit(p.effects);
  for (const m of p.modes?.options ?? []) visit(m.effects);
  return out;
}

/** True when the engine has a handler for every effect a program can produce. */
export function programRuns(p: Program): boolean {
  return canAutomate({ effects: allEffects(p) });
}

/** The spell programs of an instant or sorcery face, or null if players must resolve it (some line unparsed). */
export function spellPrograms(face: FaceDef): Program[] | null {
  if (face.unparsed.length) return null;
  const programs = face.abilities.filter((a) => a.kind === 'spell');
  return programs.every(programRuns) ? programs : null;
}

/**
 * The non-mana activated abilities an object can use from where it is now, in a stable
 * order: printed ones, then those its keywords stand for (equip, cycling… compiled from
 * CR 702). Most work on the battlefield; some only from the hand (cycling, CR 702.29a).
 */
export function activatedAbilities(g: GameState, o: GameObject): ActivatedAbility[] {
  // CR 602.5: "its activated abilities can't be activated" (Arrest).
  if (o.zone === 'battlefield' && hasRule(g, o, 'cant_activate')) return [];
  return abilitiesOf(g, o).filter(
    (a): a is ActivatedAbility => a.kind === 'activated' && !a.mana && (a.zone ?? 'battlefield') === o.zone && programRuns(a),
  );
}
