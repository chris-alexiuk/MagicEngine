import { SUBTYPES } from '@mtg/schema';
import type {
  AbilityNode,
  ActivatedAbility,
  Amount,
  Color,
  CombatRules,
  ConditionNode,
  ContinuousEffectNode,
  FaceDef,
  KeywordInstance,
  ObjectFilter,
  Ref,
  RuleFlag,
  StaticAbility,
} from '@mtg/schema';
import { evalCondition } from './conditions.js';
import { amountOf } from './resolve.js';
import type { GameObject, GameState, ManaColor, PlayerId } from './types.js';
import { abilitySources, faceOf, manaValueOf } from './zones.js';

// ---------------------------------------------------------------------------
// Characteristics through the layer system (CR 613)
// ---------------------------------------------------------------------------

export interface Characteristics {
  name: string;
  types: string[];
  subtypes: string[];
  supertypes: string[];
  colors: Color[];
  keywords: KeywordInstance[];
  power: number;
  toughness: number;
  /** Restrictions and requirements from continuous effects ("can't block"). */
  rules: Set<RuleFlag>;
  /** Blocking restrictions and requirements (CR 509.1b–c). */
  combat: CombatRules[];
  /** Whether it has a power and toughness at all (creatures, Vehicles…). */
  hasPT: boolean;
}

/** One continuous effect that might apply, with what's needed to order and scope it. */
interface ActiveEffect {
  timestamp: number;
  /** Layer 7c: how much it adds to power and toughness (counted as needed). */
  pt?: () => [number, number];
  /** Layer 7a / 7b: what it sets power and toughness to (null: leaves that one alone). */
  set?: { layer: '7a' | '7b'; pt: () => [number | null, number | null] };
  /** Layer 4: types it becomes (CR 205.1b: replacing the old ones unless retained). */
  types?: { types: string[]; subtypes: string[]; retain: boolean };
  /** Layer 5: colors it becomes. */
  colors?: Color[];
  keywords?: KeywordInstance[];
  rules?: readonly RuleFlag[];
  combat?: CombatRules;
  /** Does it apply to `o`, whose characteristics so far are `c`? */
  applies(o: GameObject, c: Characteristics): boolean;
}

const CREATURE_TYPES = SUBTYPES.creature;

function printed(face: FaceDef): Characteristics {
  // CR 702.73a / CR 604.3: changeling is a characteristic-defining ability — every creature type.
  const changeling = face.keywords.some((k) => k.id === 'changeling');
  return {
    name: face.name,
    types: [...face.types],
    subtypes: changeling ? [...new Set([...face.subtypes, ...CREATURE_TYPES])] : [...face.subtypes],
    supertypes: [...face.supertypes],
    colors: [...face.colors],
    keywords: [...face.keywords],
    power: Number(face.power ?? 0) || 0,
    toughness: Number(face.toughness ?? 0) || 0,
    rules: new Set(),
    combat: [],
    hasPT: face.power !== undefined,
  };
}

/** Abilities a keyword stands for (compiled from its CR 702 definition), e.g. prowess's trigger. */
export function keywordAbilities(keywords: KeywordInstance[]): AbilityNode[] {
  return keywords.flatMap((k) => k.abilities ?? []);
}

/** Printed abilities plus those of printed keywords — what static abilities come from (no granted ones, to avoid loops). */
export function printedAbilities(face: FaceDef): AbilityNode[] {
  return [...face.abilities, ...keywordAbilities(face.keywords)];
}

/** Whether the object has a gated ability now: a Class level (CR 716.2a), a leveler's striation (CR 711.2a). */
export function gateOpen(g: GameState, o: GameObject, a: AbilityNode): boolean {
  if (!a.gate) return true;
  if (a.gate.type === 'class_level') return (o.classLevel ?? 1) >= Number(a.gate.min ?? 1);
  return evalCondition(a.gate, { g, controller: o.controller, source: o, events: [], targets: [], x: 0, memo: {} });
}

/** The abilities printed on an object (and its printed keywords) that it has right now. */
export function objectAbilities(g: GameState, o: GameObject): AbilityNode[] {
  return printedAbilities(faceOf(g, o)).filter((a) => gateOpen(g, o, a));
}

/** Every ability an object has now: printed, and those its current keywords stand for (granted ones too). */
export function abilitiesOf(g: GameState, o: GameObject): AbilityNode[] {
  return [...faceOf(g, o).abilities.filter((a) => gateOpen(g, o, a)), ...keywordAbilities(chars(g, o).keywords)];
}

/**
 * Conditional static abilities being checked right now. A condition can look at
 * characteristics ("as long as you control a creature with power 4 or greater"), which
 * look at static abilities again; while its own condition is being checked, an
 * ability doesn't apply. (A simplification of dependency, CR 613.8.)
 */
const checking: [ConditionalNode, string][] = [];
/** Condition results for the duration of one outermost chars() call, so nested lookups stay linear. */
let conditionMemo: Map<ConditionalNode, Map<string, boolean>> | null = null;
/** Counted amounts of static abilities, for the same duration. */
let amountMemo: Map<object, Map<string, number>> | null = null;
/** The continuous effects that might apply, for the same duration. */
let effectsMemo: { g: GameState; list: ActiveEffect[] } | null = null;

/** A static ability's effect that may carry a condition. */
type ConditionalNode = { condition?: ConditionNode };
let charsDepth = 0;

/** Whether a static ability's condition holds now ("As long as …", "During your turn, …"; CR 611.3a). */
export function staticConditionHolds(g: GameState, e: ConditionalNode, source: GameObject): boolean {
  if (!e.condition) return true;
  const key = `${source.id}:${source.zcc}`;
  const cached = conditionMemo?.get(e)?.get(key);
  if (cached !== undefined) return cached;
  if (checking.some(([n, k]) => n === e && k === key)) return false;
  checking.push([e, key]);
  let holds: boolean;
  try {
    holds = evalCondition(e.condition, { g, controller: source.controller, source, events: [], targets: [], x: 0, memo: {} });
  } finally {
    checking.pop();
  }
  if (conditionMemo) {
    let m = conditionMemo.get(e);
    if (!m) conditionMemo.set(e, (m = new Map()));
    m.set(key, holds);
  }
  return holds;
}

/** Amounts being counted for static abilities right now (same loop guard as conditions). */
const counting: [Amount, string][] = [];

/** A static ability's number, counted now ("+1/+1 for each other Zombie you control"); 0 inside its own count. */
function staticAmount(g: GameState, a: Amount | undefined, source: GameObject): number {
  if (a === undefined) return 0;
  if (typeof a === 'number') return a;
  const key = `${source.id}:${source.zcc}`;
  const cached = typeof a === 'object' ? amountMemo?.get(a)?.get(key) : undefined;
  if (cached !== undefined) return cached;
  if (counting.some(([n, k]) => n === a && k === key)) return 0;
  counting.push([a, key]);
  let n: number;
  try {
    n = amountOf({ g, controller: source.controller, source, events: [], targets: [], x: 0, memo: {} }, a);
  } finally {
    counting.pop();
  }
  // Counts of objects, cards and players don't depend on power and toughness, so they can be reused.
  if (amountMemo && typeof a === 'object' && a.kind !== 'stat') {
    let m = amountMemo.get(a);
    if (!m) amountMemo.set(a, (m = new Map()));
    m.set(key, n);
  }
  return n;
}

/** The P/T parts of a static ability's effect. */
function ptParts(g: GameState, e: ContinuousEffectNode, source: GameObject): Pick<ActiveEffect, 'pt' | 'set'> {
  const out: Pick<ActiveEffect, 'pt' | 'set'> = {};
  if (e.power !== undefined || e.toughness !== undefined) out.pt = () => [staticAmount(g, e.power, source), staticAmount(g, e.toughness, source)];
  if (e.setPower !== undefined || e.setToughness !== undefined) {
    out.set = {
      layer: e.setLayer ?? '7b',
      pt: () => [e.setPower === undefined ? null : staticAmount(g, e.setPower, source), e.setToughness === undefined ? null : staticAmount(g, e.setToughness, source)],
    };
  }
  return out;
}

/** The static abilities of permanents on the battlefield that create continuous effects (CR 611.3). */
function staticEffects(g: GameState): ActiveEffect[] {
  const out: ActiveEffect[] = [];
  for (const id of abilitySources(g)) {
    const source = g.objects[id];
    if (!source) continue;
    for (const ability of objectAbilities(g, source)) {
      if (ability.kind !== 'static' || ability.effect.type !== 'continuous') continue;
      const e = (ability as StaticAbility).effect as ContinuousEffectNode;
      if (!staticConditionHolds(g, e, source)) continue;
      out.push({
        // CR 613.7a: a static ability's effect has the timestamp of the object it's on.
        timestamp: source.timestamp,
        ...ptParts(g, e, source),
        ...(e.keywords ? { keywords: e.keywords } : {}),
        ...(e.rules ? { rules: e.rules } : {}),
        ...(e.combat ? { combat: e.combat } : {}),
        // CR 611.3a: not locked in — it applies to whatever matches at any given moment.
        applies: (o, c) => affectedBy(g, e.affected, source, o, c),
      });
    }
  }
  return out;
}

function affectedBy(g: GameState, ref: Ref, source: GameObject, o: GameObject, c: Characteristics): boolean {
  switch (ref.ref) {
    case 'self':
      return o.id === source.id;
    case 'attached':
      return source.attachedTo?.id === o.id && source.attachedTo.zcc === o.zcc;
    case 'all':
      return matchesFilter(g, o, ref.filter, { controller: source.controller, source }, c);
    default:
      return false;
  }
}

function resolvedEffects(g: GameState): ActiveEffect[] {
  return g.effects.map((e) => ({
    timestamp: e.timestamp,
    ...(e.power !== undefined ? { pt: (): [number, number] => [e.power ?? 0, e.toughness ?? 0] } : {}),
    ...(e.setPower !== undefined ? { set: { layer: '7b' as const, pt: (): [number, number] => [e.setPower!, e.setToughness ?? 0] } } : {}),
    ...(e.types ? { types: { types: e.types, subtypes: e.subtypes ?? [], retain: Boolean(e.retainTypes) } } : {}),
    ...(e.colors ? { colors: e.colors } : {}),
    ...(e.keywords ? { keywords: e.keywords } : {}),
    ...(e.rules ? { rules: e.rules } : {}),
    ...(e.combat ? { combat: e.combat } : {}),
    // CR 611.2c: locked to the objects it affected when it was created.
    applies: (o) => e.objects.some((r) => r.id === o.id && r.zcc === o.zcc),
  }));
}

/**
 * An object's current characteristics. Printed values, then continuous effects
 * layer by layer (CR 613.1), each layer in timestamp order (CR 613.7).
 * Implemented so far: layer 6 (abilities), 7a (characteristic-defining P/T), 7b (P/T setting),
 * 7c (P/T changes and counters). Layers 1–5, 7d and dependency (rule 613.8) arrive with the
 * effects that need them.
 */
export function chars(g: GameState, o: GameObject): Characteristics {
  return withCharsCache(() => layered(g, o));
}

/**
 * Runs `fn` with characteristics lookups sharing their intermediate results (the effects list,
 * conditions, counts). Only for code that doesn't change the state meanwhile.
 */
export function withCharsCache<T>(fn: () => T): T {
  if (charsDepth === 0) {
    conditionMemo = new Map();
    amountMemo = new Map();
  }
  charsDepth++;
  try {
    return fn();
  } finally {
    if (--charsDepth === 0) {
      conditionMemo = amountMemo = null;
      effectsMemo = null;
      grantedManaMemo = null;
    }
  }
}

function layered(g: GameState, o: GameObject): Characteristics {
  const c = printed(faceOf(g, o));
  // CR 702.62a: cast from suspend, a creature has haste while its caster controls it.
  if (o.cast?.suspended && o.controller === o.cast.by && !c.keywords.some((k) => k.id === 'haste')) c.keywords.push({ id: 'haste' });
  if (o.zone === 'stack') {
    // A spell's own "can't be countered" works while it's on the stack.
    for (const a of printedAbilities(faceOf(g, o))) {
      const e = a.kind === 'static' && a.effect.type === 'continuous' ? (a.effect as ContinuousEffectNode) : null;
      if (e && e.affected.ref === 'self') for (const r of e.rules ?? []) c.rules.add(r);
    }
    applyOwnCDA(g, o, c);
    return c;
  }
  if (o.zone !== 'battlefield') {
    applyOwnCDA(g, o, c);
    return withCounters(c, o);
  }

  // The state doesn't change while characteristics are computed, so nested lookups share one list
  // (and the memoised conditions and counts belong to this state only).
  if (!effectsMemo || effectsMemo.g !== g) {
    conditionMemo?.clear();
    amountMemo?.clear();
    effectsMemo = { g, list: [...staticEffects(g), ...resolvedEffects(g)].sort((a, b) => a.timestamp - b.timestamp) };
  }
  const effects = effectsMemo.list;
  // CR 613.1d: layer 4 — type-changing effects.
  for (const e of effects) {
    if (!e.types || !e.applies(o, c)) continue;
    if (e.types.retain) {
      c.types = [...new Set([...c.types, ...e.types.types])];
      c.subtypes = [...new Set([...c.subtypes, ...e.types.subtypes])];
    } else {
      c.types = [...e.types.types];
      c.subtypes = [...e.types.subtypes];
    }
    if (c.types.includes('Creature')) c.hasPT = true;
  }
  // CR 613.1e: layer 5 — color-changing effects.
  for (const e of effects) if (e.colors && e.applies(o, c)) c.colors = [...e.colors];
  // CR 613.1f: layer 6 — ability-adding effects (and here, rule flags, which ride along with abilities).
  const inLayer6 = effects.filter((e) => (e.keywords || e.rules || e.combat) && e.applies(o, c));
  for (const e of inLayer6) {
    if (e.keywords) c.keywords.push(...e.keywords);
    for (const r of e.rules ?? []) c.rules.add(r);
    if (e.combat) c.combat.push(e.combat);
  }
  // CR 613.4a / 613.4b: layer 7a (characteristic-defining abilities), then 7b (effects that set P/T).
  for (const layer of ['7a', '7b'] as const) {
    for (const e of effects) {
      if (e.set?.layer !== layer || !e.applies(o, c)) continue;
      const [p, t] = e.set.pt();
      if (p !== null) c.power = p;
      if (t !== null) c.toughness = t;
    }
  }
  // CR 613.4c: layer 7c — effects and counters that modify power and toughness.
  for (const e of effects) {
    if (!e.pt || !e.applies(o, c)) continue;
    const [p, t] = e.pt();
    c.power += p;
    c.toughness += t;
  }
  return withCounters(c, o);
}

/** CR 604.3 / CR 113.6a: a characteristic-defining ability works in every zone. */
function applyOwnCDA(g: GameState, o: GameObject, c: Characteristics): void {
  for (const a of printedAbilities(faceOf(g, o))) {
    if (a.kind !== 'static' || a.effect.type !== 'continuous') continue;
    const e = a.effect as ContinuousEffectNode;
    if (e.setLayer !== '7a' || e.affected.ref !== 'self') continue;
    if (e.setPower !== undefined) c.power = staticAmount(g, e.setPower, o);
    if (e.setToughness !== undefined) c.toughness = staticAmount(g, e.setToughness, o);
  }
}

function withCounters(c: Characteristics, o: GameObject): Characteristics {
  // CR 122.1a / CR 613.4c: +1/+1 and -1/-1 counters.
  const plus = o.counters['+1/+1'] ?? 0;
  const minus = o.counters['-1/-1'] ?? 0;
  c.power += plus - minus;
  c.toughness += plus - minus;
  return c;
}

/** Whether it has a card type now (CR 613.1d: type-changing effects included). */
export function hasType(g: GameState, o: GameObject, type: string): boolean {
  if (o.zone !== 'battlefield') return faceOf(g, o).types.includes(type);
  return chars(g, o).types.includes(type);
}

export function hasKeyword(g: GameState, o: GameObject, id: string): boolean {
  return chars(g, o).keywords.some((k) => k.id === id);
}

export function hasRule(g: GameState, o: GameObject, rule: RuleFlag): boolean {
  return chars(g, o).rules.has(rule);
}

export function isPermanentCard(face: FaceDef): boolean {
  return face.types.some((t) => ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'].includes(t));
}

export function power(g: GameState, o: GameObject): number {
  return chars(g, o).power;
}

export function toughness(g: GameState, o: GameObject): number {
  return chars(g, o).toughness;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface FilterContext {
  /** The player "you" refers to. */
  controller: PlayerId;
  /** The ability's source, for "another" / "other". */
  source?: GameObject | null;
  /** Ignore the zone (trigger look-back, CR 603.10a). */
  anyZone?: boolean;
  /** The object's controller at the time, if it has since left the battlefield. */
  lastController?: PlayerId;
}

const compare = (v: number, c: { op: string; n: number }) => (c.op === 'le' ? v <= c.n : c.op === 'ge' ? v >= c.n : v === c.n);

/** Whether an object matches a filter from the compiled AST. */
export function matchesFilter(
  g: GameState,
  o: GameObject,
  f: ObjectFilter,
  ctx: FilterContext,
  c: Characteristics = chars(g, o),
): boolean {
  if (!ctx.anyZone && o.zone !== (f.zone ?? 'battlefield')) return false;
  // "~ or another Ally you control": the source itself always matches.
  if (f.orSource && ctx.source && o.id === ctx.source.id) return true;
  const controller = ctx.lastController ?? o.controller;
  if (f.types && !f.types.some((t) => c.types.includes(t))) return false;
  if (f.allTypes && !f.allTypes.every((t) => c.types.includes(t))) return false;
  if (f.notTypes?.some((t) => c.types.includes(t))) return false;
  if (f.subtypes && !f.subtypes.some((t) => c.subtypes.includes(t))) return false;
  if (f.notSubtypes?.some((t) => c.subtypes.includes(t))) return false;
  if (f.supertypes && !f.supertypes.every((t) => c.supertypes.includes(t))) return false;
  if (f.notSupertypes?.some((t) => c.supertypes.includes(t))) return false;
  if (f.colors && !f.colors.some((x) => c.colors.includes(x))) return false;
  if (f.notColors?.some((x) => c.colors.includes(x))) return false;
  if (f.colorless && c.colors.length > 0) return false;
  if (f.multicolored && c.colors.length < 2) return false;
  if (f.controller === 'you' && controller !== ctx.controller) return false;
  if ((f.controller === 'opponent' || f.controller === 'not_you') && controller === ctx.controller) return false;
  if (f.controller === 'enchanted' && (!ctx.source?.attachedToPlayer || controller !== ctx.source.attachedToPlayer)) return false;
  if (f.owner === 'you' && o.owner !== ctx.controller) return false;
  if (f.owner === 'opponent' && o.owner === ctx.controller) return false;
  if (f.other && ctx.source && ctx.source.id === o.id) return false;
  if (f.tapped !== undefined && o.tapped !== f.tapped) return false;
  if (f.token !== undefined && Boolean(o.token) !== f.token) return false;
  if (f.commander && !o.commander) return false;
  if (f.anyOf && !f.anyOf.some((alt) => matchesFilter(g, o, alt, { ...ctx, anyZone: true }, c))) return false;
  if (f.combat) {
    const attacking = Boolean(g.combat?.attackers[o.id]);
    const blocking = Boolean(g.combat?.blockers[o.id]);
    if (f.combat === 'attacking' && !attacking) return false;
    if (f.combat === 'blocking' && !blocking) return false;
    if (f.combat === 'attacking_or_blocking' && !attacking && !blocking) return false;
  }
  if (f.keywords && !f.keywords.some((k) => c.keywords.some((x) => x.id === k))) return false;
  if (f.notKeywords?.some((k) => c.keywords.some((x) => x.id === k))) return false;
  if (f.power && !compare(c.power, f.power)) return false;
  if (f.toughness && !compare(c.toughness, f.toughness)) return false;
  if (f.manaValue && !compare(manaValueOf(g, o), f.manaValue)) return false;
  // "with a +1/+1 counter on it" (CR 122.1)
  if (f.counter && !(f.counter === 'any' ? Object.values(o.counters).some((n) => n > 0) : (o.counters[f.counter] ?? 0) > 0)) return false;
  // CR 702.134a: "with power less than this creature's power"
  if (f.powerBelowSource && (!ctx.source || c.power >= chars(g, ctx.source).power)) return false;
  // "of the chosen type/color": what the source's controller chose as it entered (CR 614.12).
  if (f.chosenType && !(ctx.source?.chosen?.creatureType && c.subtypes.includes(ctx.source.chosen.creatureType))) return false;
  if (f.chosenColor && !(ctx.source?.chosen?.color && c.colors.includes(ctx.source.chosen.color))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Mana abilities, summoning sickness, protection
// ---------------------------------------------------------------------------

const BASIC_LAND_MANA: Record<string, ManaColor> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };

function intrinsicManaAbility(color: ManaColor): ActivatedAbility {
  return {
    kind: 'activated',
    text: `{T}: Add {${color}}.`,
    cost: { tap: true },
    effects: [{ type: 'add_mana', options: [[color]] }],
    mana: true,
  };
}

/**
 * Mana abilities of a permanent, in a stable order: intrinsic basic-land-type
 * abilities first, then compiled ones.
 * CR 305.6: a land with a basic land type has the intrinsic ability "{T}: Add [mana symbol]."
 */
export function manaAbilities(g: GameState, o: GameObject): ActivatedAbility[] {
  const face = faceOf(g, o);
  const out: ActivatedAbility[] = [];
  if (face.types.includes('Land')) {
    for (const sub of face.subtypes) {
      const color = BASIC_LAND_MANA[sub];
      if (color) out.push(intrinsicManaAbility(color));
    }
  }
  for (const a of face.abilities) if (a.kind === 'activated' && a.mana && gateOpen(g, o, a)) out.push(a);
  // Granted ones ("Creatures you control have "{T}: Add {G}."", CR 613.1f).
  if (o.zone === 'battlefield' && anyGrantedMana(g)) for (const a of keywordAbilities(chars(g, o).keywords)) if (a.kind === 'activated' && a.mana) out.push(a);
  return out;
}

const grantsMana = (kws: KeywordInstance[] | undefined): boolean => Boolean(kws?.some((k) => k.abilities?.some((a) => a.kind === 'activated' && a.mana)));
let grantedManaMemo: { g: GameState; v: boolean } | null = null;

/** Whether anything grants a mana ability right now — rare, so other objects skip computing their characteristics. */
function anyGrantedMana(g: GameState): boolean {
  if (grantedManaMemo?.g === g) return grantedManaMemo.v;
  let v = g.effects.some((e) => grantsMana(e.keywords));
  for (const id of abilitySources(g)) {
    if (v) break;
    const o = g.objects[id];
    if (!o) continue;
    v = printedAbilities(faceOf(g, o)).some((a) => a.kind === 'static' && a.effect.type === 'continuous' && grantsMana((a.effect as ContinuousEffectNode).keywords));
  }
  if (charsDepth > 0) grantedManaMemo = { g, v };
  return v;
}

/**
 * CR 302.6: a creature's {T}/{Q} abilities need continuous control since the turn began;
 * CR 702.10c: haste lifts that restriction.
 */
export function canUseTapAbilities(g: GameState, o: GameObject): boolean {
  if (!hasType(g, o, 'Creature')) return true;
  return !o.sick || hasKeyword(g, o, 'haste');
}

const COLOR_WORDS: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const TYPE_WORDS: Record<string, string> = {
  creatures: 'Creature',
  artifacts: 'Artifact',
  enchantments: 'Enchantment',
  instants: 'Instant',
  sorceries: 'Sorcery',
  planeswalkers: 'Planeswalker',
  lands: 'Land',
};

function qualities(keywords: KeywordInstance[], id: string): string[] {
  return keywords
    .filter((k) => k.id === id && k.text)
    .flatMap((k) => k.text!.split(/\s*(?:,\s*)?and from\s+|,\s*from\s+/))
    .map((q) => q.trim().toLowerCase());
}

/** CR 702.16g: "protection from A and from B" is two protection abilities. */
export function protectionQualities(g: GameState, o: GameObject): string[] {
  return qualities(chars(g, o).keywords, 'protection');
}

function sourceHasQuality(g: GameState, source: GameObject, q: string): boolean {
  const c = chars(g, source);
  if (q === 'everything') return true;
  if (COLOR_WORDS[q]) return c.colors.includes(COLOR_WORDS[q] as Color);
  if (q === 'multicolored') return c.colors.length > 1;
  if (q === 'monocolored') return c.colors.length === 1;
  if (q === 'colorless') return c.colors.length === 0;
  if (TYPE_WORDS[q]) return c.types.includes(TYPE_WORDS[q]!);
  const singular = q.replace(/(?:ies)$/, 'y').replace(/s$/, '');
  return c.subtypes.some((t) => t.toLowerCase() === singular);
}

/**
 * Whether `o` has protection from `source` (CR 702.16a). Colors, multicolored/monocolored,
 * card types and creature types are understood; CR 702.16j: "everything" covers every source.
 * Qualities that need a choice ("the color of your choice") are left to players.
 */
export function hasProtectionFrom(g: GameState, o: GameObject, source: GameObject): boolean {
  return protectionQualities(g, o).some((q) => sourceHasQuality(g, source, q));
}

/** CR 702.11d: "hexproof from [quality]". */
export function hasHexproofFrom(g: GameState, o: GameObject, source: GameObject): boolean {
  return qualities(chars(g, o).keywords, 'hexproof_from').some((q) => sourceHasQuality(g, source, q));
}
