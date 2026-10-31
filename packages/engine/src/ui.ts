/**
 * Helpers for user interfaces.
 *
 * legalActions() lists each cast or activation with a default legal choice of modes and targets. A UI lets the
 * player change them; these read what that action asks for the way the engine reads it as the action is applied
 * (alternative costs, kicker, fused and bestowed faces, Aura targets, "you may choose both instead"), so the UI offers
 * the same candidates apply() will accept. apply() still has the final word.
 */
import type { ConditionNode, FaceDef, Program, TargetSpec } from '@mtg/schema';
import { castOptionsFor } from './actions.js';
import { isPermanentCard } from './characteristics.js';
import { evalCondition } from './conditions.js';
import { FACE_DOWN_KEYWORDS } from './face-down.js';
import { auraTargetSpec } from './permanents.js';
import { activatedAbilities, flatten, spellPrograms, usedModes } from './program.js';
import { targetingAs, targetPrompts, withTargetKicks } from './targets.js';
import type { Action, GameObject, GameState, TargetPrompt } from './types.js';
import { bestowedFace, fusedFace } from './zones.js';

export { defaultCastChoice } from './legal.js';
export { withCharsCache } from './characteristics.js';

type Choosing = Extract<Action, { type: 'cast' | 'activate' }>;

/** The modes a modal spell or ability offers, as they can be chosen now. */
export interface ModeMenu {
  min: number;
  max: number;
  /** "You may choose the same mode more than once." */
  repeat: boolean;
  /** Modes that can't be chosen again ("choose one that hasn't been chosen this turn"). */
  used: number[];
  options: { text: string; manual: boolean; cost?: string }[];
}

interface Reading {
  source: GameObject;
  ability: boolean;
  kicks: number;
  /** A permanent spell: only an Aura's enchant target (no modes). */
  permanent?: TargetSpec[];
  programs: Program[];
  holds: (c: ConditionNode) => boolean;
  allModes: boolean;
}

function read(g: GameState, a: Choosing): Reading | null {
  const o = g.objects[a.object];
  if (!o) return null;
  if (a.type === 'activate') {
    const ab = activatedAbilities(g, o)[a.ability];
    return ab ? { source: o, ability: true, kicks: 0, programs: [ab], holds: () => false, allModes: false } : null;
  }
  const def = g.cards[o.card];
  const faceIndex = o.prepareOf ? 1 : (a.face ?? 0);
  const face = def?.faces[faceIndex];
  if (!def || !face) return null;
  const options = castOptionsFor(g, a.player, o, face);
  const alt = a.alt ? options.find((x) => x.kind === 'alternative' && x.id === a.alt) : undefined;
  const extras = a.extras ?? [];
  const added = extras.flatMap((x) => options.filter((y) => y.kind === 'additional' && y.id === x));
  const kicks = typeof a.kicked === 'number' ? Math.max(0, Math.floor(a.kicked)) : a.kicked ? 1 : 0;
  const base = { source: o, ability: false, kicks };
  // Face down it's a creature spell with no text: nothing to choose.
  if (alt && (FACE_DOWN_KEYWORDS as readonly string[]).includes(alt.id)) return { ...base, permanent: [], programs: [], holds: () => false, allModes: false };
  const castFace: FaceDef = extras.includes('fuse')
    ? fusedFace(def)
    : alt?.id === 'bestow'
      ? bestowedFace(face)
      : alt?.transformed
        ? (def.faces[1] ?? face)
        : alt?.spell
          ? { ...face, abilities: [...face.abilities.filter((x) => x.kind !== 'spell'), alt.spell] }
          : face;
  const holds = (c: ConditionNode): boolean =>
    c.type === 'kicked'
      ? kicks > 0 || extras.includes('kicker')
      : c.type === 'cast_in_main_phase'
        ? g.active === a.player && (g.step === 'main1' || g.step === 'main2')
        : c.type === 'paid'
          ? (extras.includes(String(c.cost)) || a.alt === c.cost || (c.cost === 'additional' && added.some((x) => !x.required))) !== Boolean(c.not)
          : evalCondition(c, { g, controller: a.player, source: o, events: [], targets: [], x: a.x ?? 0, memo: {} });
  if (isPermanentCard(castFace)) {
    const aura = auraTargetSpec(castFace);
    return { ...base, permanent: aura ? [aura] : [], programs: [], holds, allModes: false };
  }
  return { ...base, programs: spellPrograms(castFace) ?? [], holds, allModes: added.some((x) => x.allModes) };
}

/** The mode menu for a listed cast or activation, or null if it isn't modal (or entwine already chooses every mode). */
export function choiceModes(g: GameState, a: Choosing): ModeMenu | null {
  const r = read(g, a);
  if (!r || r.permanent || r.allModes) return null;
  const modal = r.programs.find((p) => p.modes);
  if (!modal?.modes) return null;
  const m = modal.modes;
  const bonus = m.bonus && r.holds(m.bonus.condition);
  const max = bonus ? Math.max(m.max, m.bonus!.max) : m.max;
  const min = bonus && m.bonus!.exact ? max : m.min;
  const used = 'text' in modal ? usedModes(g, { id: r.source.id, zcc: r.source.zcc }, modal as Program & { text: string }) : [];
  return {
    min,
    max,
    repeat: Boolean(m.repeat),
    used,
    options: m.options.map((opt) => ({ text: opt.text, manual: Boolean(opt.manual), ...(opt.cost ? { cost: opt.cost } : {}) })),
  };
}

/**
 * The target prompts for a listed cast or activation with these modes (the action's own by default): one per target
 * list the action carries, with every legal candidate. Throws a RulesError for a mode choice the engine would refuse.
 */
export function choicePrompts(g: GameState, a: Choosing, modes: number[] | undefined = a.modes): TargetPrompt[] {
  const r = read(g, a);
  if (!r) return [];
  const specs = r.permanent ?? (r.programs.length ? flatten(r.programs, modes, r.holds, r.allModes).specs : []);
  if (!specs.length) return [];
  return targetingAs(r.ability, () => withTargetKicks(r.kicks, () => targetPrompts(g, a.player, specs, r.source, a.x ?? 0)));
}
