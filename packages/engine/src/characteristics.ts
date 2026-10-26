import { SUBTYPES } from '@mtg/schema';
import type {
  AbilityNode,
  ActivatedAbility,
  Color,
  ContinuousEffectNode,
  FaceDef,
  KeywordInstance,
  ObjectFilter,
  Ref,
  RuleFlag,
  StaticAbility,
} from '@mtg/schema';
import type { GameObject, GameState, ManaColor, PlayerId } from './types.js';
import { faceOf } from './zones.js';

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
  /** Whether it has a power and toughness at all (creatures, Vehicles…). */
  hasPT: boolean;
}

/** One continuous effect that might apply, with what's needed to order and scope it. */
interface ActiveEffect {
  timestamp: number;
  power?: number;
  toughness?: number;
  keywords?: KeywordInstance[];
  rules?: readonly RuleFlag[];
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

/** Every ability an object has now: printed, and those its current keywords stand for (granted ones too). */
export function abilitiesOf(g: GameState, o: GameObject): AbilityNode[] {
  return [...faceOf(g, o).abilities, ...keywordAbilities(chars(g, o).keywords)];
}

/** The static abilities of permanents on the battlefield that create continuous effects (CR 611.3). */
function staticEffects(g: GameState): ActiveEffect[] {
  const out: ActiveEffect[] = [];
  for (const id of g.zones.battlefield) {
    const source = g.objects[id];
    if (!source) continue;
    for (const ability of printedAbilities(faceOf(g, source))) {
      if (ability.kind !== 'static' || ability.effect.type !== 'continuous') continue;
      const e = (ability as StaticAbility).effect as ContinuousEffectNode;
      out.push({
        // CR 613.7a: a static ability's effect has the timestamp of the object it's on.
        timestamp: source.timestamp,
        ...(e.power !== undefined ? { power: e.power, toughness: e.toughness ?? 0 } : {}),
        ...(e.keywords ? { keywords: e.keywords } : {}),
        ...(e.rules ? { rules: e.rules } : {}),
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
    ...(e.power !== undefined ? { power: e.power, toughness: e.toughness ?? 0 } : {}),
    ...(e.keywords ? { keywords: e.keywords } : {}),
    ...(e.rules ? { rules: e.rules } : {}),
    // CR 611.2c: locked to the objects it affected when it was created.
    applies: (o) => e.objects.some((r) => r.id === o.id && r.zcc === o.zcc),
  }));
}

/**
 * An object's current characteristics. Printed values, then continuous effects
 * layer by layer (CR 613.1), each layer in timestamp order (CR 613.7).
 * Implemented so far: layer 6 (abilities), 7c (P/T changes and counters).
 * Layers 1–5, 7a, 7b, 7d and dependency (rule 613.8) arrive with the effects that need them.
 */
export function chars(g: GameState, o: GameObject): Characteristics {
  const c = printed(faceOf(g, o));
  if (o.zone === 'stack') {
    // A spell's own "can't be countered" works while it's on the stack.
    for (const a of printedAbilities(faceOf(g, o))) {
      const e = a.kind === 'static' && a.effect.type === 'continuous' ? (a.effect as ContinuousEffectNode) : null;
      if (e && e.affected.ref === 'self') for (const r of e.rules ?? []) c.rules.add(r);
    }
    return c;
  }
  if (o.zone !== 'battlefield') return withCounters(c, o);

  const effects = [...staticEffects(g), ...resolvedEffects(g)].sort((a, b) => a.timestamp - b.timestamp);
  // CR 613.1f: layer 6 — ability-adding effects (and here, rule flags, which ride along with abilities).
  const inLayer6 = effects.filter((e) => (e.keywords || e.rules) && e.applies(o, c));
  for (const e of inLayer6) {
    if (e.keywords) c.keywords.push(...e.keywords);
    for (const r of e.rules ?? []) c.rules.add(r);
  }
  // CR 613.4c: layer 7c — effects and counters that modify power and toughness.
  for (const e of effects) {
    if (e.power === undefined || !e.applies(o, c)) continue;
    c.power += e.power;
    c.toughness += e.toughness ?? 0;
  }
  return withCounters(c, o);
}

function withCounters(c: Characteristics, o: GameObject): Characteristics {
  // CR 122.1a / CR 613.4c: +1/+1 and -1/-1 counters.
  const plus = o.counters['+1/+1'] ?? 0;
  const minus = o.counters['-1/-1'] ?? 0;
  c.power += plus - minus;
  c.toughness += plus - minus;
  return c;
}

export function hasType(g: GameState, o: GameObject, type: string): boolean {
  return faceOf(g, o).types.includes(type);
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
  if (f.owner === 'you' && o.owner !== ctx.controller) return false;
  if (f.owner === 'opponent' && o.owner === ctx.controller) return false;
  if (f.other && ctx.source && ctx.source.id === o.id) return false;
  if (f.tapped !== undefined && o.tapped !== f.tapped) return false;
  if (f.token !== undefined && Boolean(o.token) !== f.token) return false;
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
  if (f.manaValue && !compare(g.cards[o.card]?.cmc ?? 0, f.manaValue)) return false;
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
  for (const a of face.abilities) if (a.kind === 'activated' && a.mana) out.push(a);
  return out;
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
