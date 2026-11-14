/**
 * Helpers for user interfaces.
 *
 * legalActions() lists each cast or activation with a default legal choice of modes and targets. A UI lets the
 * player change them; these read what that action asks for the way the engine reads it as the action is applied
 * (alternative costs, kicker, fused and bestowed faces, Aura targets, "you may choose both instead"), so the UI offers
 * the same candidates apply() will accept. apply() still has the final word.
 */
import type { ConditionNode, Cost, Program, TargetSpec } from '@mtg/schema';
import { activationWay, castArgsOf, castCostParts, castWaterbend, castWay } from './actions.js';
import { hasType, isPermanentCard, manaAbilities } from './characteristics.js';
import { helperKeywords } from './helpers-cost.js';
import { auraTargetSpec } from './permanents.js';
import { chosenFor, costAsks, costWeight, type CostAsk } from './payment.js';
import { activatedAbilities, flatten, spellPrograms, usedModes } from './program.js';
import { targetingAs, targetPrompts, withTargetKicks } from './targets.js';
import { RulesError, type Action, type CostChoices, type GameObject, type GameState, type ObjectId, type TargetPrompt } from './types.js';
import { nameOf, zoneList } from './zones.js';

export { defaultCastChoice, defaultChoiceAtX, whyNotActivated } from './legal.js';
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
  /** CR 700.2i: "Choose up to five {P} worth of modes" — the most pawprints the chosen modes may add up to. */
  budget?: number;
  options: { text: string; manual: boolean; cost?: string; /** Its pawprints ({P}). */ weight?: number }[];
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

/** A cast being chosen for as an effect resolves ("you may cast it without paying its mana cost"): timing doesn't apply. */
const duringOf = (g: GameState, a: Choosing) => (g.pending?.kind === 'cast_free' && g.pending.object === a.object ? {} : undefined);

/**
 * What the action's modes and targets are chosen from, as the engine reads the action when it is applied: for a cast,
 * castWay (actions.ts) — the face it is cast as for the costs announced, and the conditions those make true. Throws
 * the engine's reason where the action can't be taken at all.
 */
function read(g: GameState, a: Choosing): Reading | null {
  const o = g.objects[a.object];
  if (!o) return null;
  if (a.type === 'activate') {
    const ab = activatedAbilities(g, o)[a.ability];
    return ab ? { source: o, ability: true, kicks: 0, programs: [ab], holds: () => false, allModes: false } : null;
  }
  if (!g.cards[o.card]?.faces[a.face ?? 0]) return null;
  const way = castWay(g, castArgsOf(a, duringOf(g, a)));
  const base = { source: o, ability: false, kicks: way.kicks, holds: way.holds, allModes: way.allModes };
  // (Face down it's a creature spell with no text: nothing to choose.)
  if (isPermanentCard(way.castFace)) {
    const aura = auraTargetSpec(way.castFace);
    return { ...base, permanent: aura ? [aura] : [], programs: [], allModes: false };
  }
  return { ...base, programs: spellPrograms(way.castFace) ?? [] };
}

/** The mode menu for a listed cast or activation, or null if it isn't modal (or entwine already chooses every mode). */
export function choiceModes(g: GameState, a: Choosing): ModeMenu | null {
  let r: Reading | null;
  try {
    r = read(g, a);
  } catch (err) {
    if (!(err instanceof RulesError)) throw err;
    return null;
  }
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
    ...(m.budget !== undefined ? { budget: m.budget } : {}),
    // The compiler's "~" is the card itself: a player reads its name.
    options: m.options.map((opt) => ({ text: opt.text.replace(/~/g, nameOf(g, r.source)), manual: Boolean(opt.manual), ...(opt.cost ? { cost: opt.cost } : {}), ...(opt.weight ? { weight: opt.weight } : {}) })),
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

/**
 * One thing a player decides as a cost is paid (CR 601.2h): which objects one part of it takes. `list` and `at` say
 * where the answer goes in the action's `costs` (`withCostAnswers` puts it there).
 */
export interface CostPrompt {
  list: 'sacrifice' | 'discard' | 'exile' | 'crew' | 'returned' | 'reveal' | 'blighted' | 'processed' | 'convoke' | 'improvise' | 'delve' | 'waterbend';
  at: number;
  /** How many: exactly `min` when `max` is the same. */
  min: number;
  max: number;
  candidates: ObjectId[];
  /** What the action has for it now (a listed action: the engine's default). */
  chosen: ObjectId[];
  /** What happens to what is chosen: "sacrifice", "discard", "exile", "tap", "return to your hand"… */
  verb: string;
  /** The same as a sentence for the player. */
  text: string;
  /** A total the chosen objects must reach (a crew cost's power, collected evidence's mana value), with what each candidate counts for. */
  total?: { need: number; of: 'power' | 'mana value'; each: Record<ObjectId, number> };
  /** May be left empty: convoke, improvise, delve and waterbend only pay mana another way. */
  optional?: true;
}

const COUNT_WORDS = ['no', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

function promptOf(g: GameState, ask: CostAsk, choices: CostChoices): CostPrompt {
  const max = Number.isFinite(ask.max) ? ask.max : ask.candidates.length;
  const count = (n: number) => COUNT_WORDS[n] ?? String(n);
  const [one, several] = ask.what;
  const text = ask.total
    ? `Choose ${several} to ${ask.verb}: total ${ask.total.of} ${ask.total.need} or greater.`
    : ask.min === max
      ? `Choose ${count(max)} ${max === 1 ? one : several} to ${ask.verb}.`
      : ask.min === 0 && !Number.isFinite(ask.max)
        ? `Choose any number of ${several} to ${ask.verb}.`
        : ask.min === 0
          ? `Choose up to ${count(max)} ${max === 1 ? one : several} to ${ask.verb}.`
          : `Choose ${count(ask.min)} or more ${several} to ${ask.verb}.`;
  return {
    list: ask.list,
    at: ask.at,
    min: ask.min,
    max,
    candidates: ask.candidates,
    chosen: chosenFor(ask, choices).filter((id) => ask.candidates.includes(id)),
    verb: ask.verb,
    text: text.replace('Choose a other', 'Choose another').replace(/^Choose a ([aeiou])/i, 'Choose an $1'),
    ...(ask.total ? { total: { need: ask.total.need, of: ask.total.of, each: Object.fromEntries(ask.candidates.map((id) => [id, costWeight(g, ask, id)])) } } : {}),
  };
}

type Paying = Extract<Action, { type: 'cast' | 'activate' | 'activate_mana' }>;

/**
 * What the costs of a cast or an activation ask the player to choose, in the order the cost lists its parts: what to
 * sacrifice, discard, exile, tap or return, and what convokes, improvises, delves or waterbends. Read from the action
 * as the engine reads it when it is applied (castWay, activationWay) and from the one description of a cost's parts
 * (costAsks), so what is offered here is what apply() accepts. Parts with nothing to decide (a random discard,
 * "sacrifice all creatures") aren't listed. Throws the engine's reason where the action can't be taken at all.
 */
export function costPrompts(g: GameState, a: Paying): CostPrompt[] {
  const o = g.objects[a.object];
  if (!o) return [];
  const choices = a.costs ?? {};
  const player = a.player;
  let cost: Cost;
  const extra: CostPrompt[] = [];
  const untapped = (also: (p: GameObject) => boolean) => g.zones.battlefield.filter((id) => g.objects[id]!.controller === player && !g.objects[id]!.tapped && also(g.objects[id]!));
  const optional = (list: 'convoke' | 'improvise' | 'delve' | 'waterbend', candidates: ObjectId[], max: number, verb: string, text: string): void => {
    if (candidates.length && max > 0) extra.push({ list, at: 0, min: 0, max: Math.min(max, candidates.length), candidates, chosen: (choices[list] ?? []).filter((id) => candidates.includes(id)), verb, text, optional: true });
  };
  if (a.type === 'cast') {
    const during = duringOf(g, a);
    const way = castWay(g, castArgsOf(a, during));
    cost = { other: castCostParts(g, way, way.x) };
    // (Cast as an effect resolves, there is usually no mana to pay another way.)
    const helpers = during ? [] : helperKeywords(g, player, o, way.face);
    if (helpers.includes('convoke')) optional('convoke', untapped((p) => hasType(g, p, 'Creature')), Infinity, 'tap', 'Convoke: choose creatures to tap. Each pays for {1} or one mana of its color.');
    if (helpers.includes('improvise')) optional('improvise', untapped((p) => hasType(g, p, 'Artifact')), Infinity, 'tap', 'Improvise: choose artifacts to tap. Each pays for {1}.');
    if (helpers.includes('delve')) optional('delve', zoneList(g, 'graveyard', player).filter((id) => id !== o.id), Infinity, 'exile', 'Delve: choose cards in your graveyard to exile. Each pays for {1}.');
    const bend = castWaterbend(way, way.x);
    optional('waterbend', untapped((p) => hasType(g, p, 'Artifact') || hasType(g, p, 'Creature')), bend, 'tap', `Waterbend: choose up to ${bend} artifacts and creatures to tap. Each pays for {1}.`);
  } else if (a.type === 'activate') {
    const way = activationWay(g, player, a.object, a.ability, { x: a.x ?? 0, autoTap: a.autoTap ?? false, targets: a.targets, modes: a.modes, costs: choices });
    cost = way.cost;
    const bend = way.cost.waterbend ?? 0;
    optional('waterbend', untapped((p) => p.id !== o.id && (hasType(g, p, 'Artifact') || hasType(g, p, 'Creature'))), bend, 'tap', `Waterbend: choose up to ${bend} artifacts and creatures to tap. Each pays for {1}.`);
  } else {
    const ab = manaAbilities(g, o)[a.ability];
    if (!ab) return [];
    cost = ab.cost;
  }
  const asked = costAsks(g, player, o, cost, choices)
    .filter((ask) => !ask.random)
    .map((ask) => promptOf(g, ask, choices));
  return [...asked, ...extra].map((p) => ({ ...p, text: p.text.replace(/~/g, nameOf(g, o)) }));
}

/** Whether a cost prompt leaves the player anything to decide: more candidates than it takes, or a number that is theirs to pick. */
export function costPromptOpen(p: CostPrompt): boolean {
  return p.min !== p.max || p.candidates.length > p.min;
}

/** The action with these answers to its cost prompts (one list of objects per prompt, in the prompts' order). */
export function withCostAnswers<T extends Paying>(a: T, prompts: readonly CostPrompt[], answers: readonly (readonly ObjectId[])[]): T {
  const costs: CostChoices = { ...(a.costs ?? {}) };
  const lists = new Set(prompts.map((p) => p.list));
  for (const list of lists) {
    const all = prompts.flatMap((p, i) => (p.list === list ? [...(answers[i] ?? [])] : []));
    if (all.length) costs[list] = all;
    else delete costs[list];
  }
  return { ...a, costs };
}
