/**
 * Shared data shapes for the compiled card database and the ability AST.
 *
 * Everything here is plain JSON so it can be produced at build time, shipped to
 * the browser, stored in caches and sent over the network unchanged.
 *
 * Extensibility rule: AST nodes are discriminated by open string tags
 * (`kind`, `type`). The engine resolves them through registries, so a new
 * mechanic adds a new tag + handler without touching these core types.
 */

export const SCHEMA_VERSION = 1 as const;

export type Color = 'W' | 'U' | 'B' | 'R' | 'G';
export const COLORS: readonly Color[] = ['W', 'U', 'B', 'R', 'G'];

/** How much of a card the engine can run without players resolving it by hand. */
export type Automation = 'full' | 'partial' | 'manual';

/** Legality codes, stored only for formats where the card is not "not_legal". */
export type LegalityCode = 'l' | 'r' | 'b';

export interface CardDB {
  schema: typeof SCHEMA_VERSION;
  builtAt: string;
  source: { kind: 'scryfall-oracle-cards' | 'fixture'; updatedAt?: string };
  cards: CardDef[];
  /** Tokens and emblems, looked up by name when an effect creates one. */
  tokens: CardDef[];
}

/** Small sidecar file so clients can check for a new DB without downloading it. */
export interface CardDBMeta {
  schema: typeof SCHEMA_VERSION;
  builtAt: string;
  sourceUpdatedAt?: string;
  cardCount: number;
  tokenCount: number;
  bytes: number;
  sha256: string;
  coverage: Record<Automation, number>;
}

export interface CardDef {
  /** Scryfall oracle_id — stable across printings. */
  id: string;
  name: string;
  layout: string;
  cmc: number;
  colorIdentity: Color[];
  /** Always at least one face. Single-faced cards have exactly one. */
  faces: FaceDef[];
  legal: Record<string, LegalityCode>;
  gameChanger?: true;
  /** EDHREC popularity rank, handy for sorting search results. */
  rank?: number;
  /** Set code and rarity of the printing Scryfall chose as the default. */
  set: string;
  rarity: string;
  automation: Automation;
}

export interface FaceDef {
  name: string;
  manaCost: string;
  typeLine: string;
  supertypes: string[];
  types: string[];
  subtypes: string[];
  oracle: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  colors: Color[];
  keywords: KeywordInstance[];
  abilities: AbilityNode[];
  /** Oracle lines the compiler could not turn into AST; resolved manually in play. */
  unparsed: string[];
  /** Image path relative to the Scryfall image CDN; see imageUrl(). */
  img?: string;
}

/** A keyword ability as printed, e.g. { id: 'ward', cost: '{2}' } or { id: 'bushido', n: 1 }. */
export interface KeywordInstance {
  id: string;
  n?: number;
  cost?: string;
  /** Free-form parameter, e.g. the quality in "protection from red". */
  text?: string;
}

// ---------------------------------------------------------------------------
// Ability AST
// ---------------------------------------------------------------------------

export interface AbilityBase {
  kind: string;
  /** The oracle line this ability was compiled from (reminder text removed). */
  text: string;
}

export interface ActivatedAbility extends AbilityBase {
  kind: 'activated';
  cost: Cost;
  effects: EffectNode[];
  /** True for mana abilities (CR 605): they don't use the stack. */
  mana?: true;
  timing?: 'sorcery';
}

export interface TriggeredAbility extends AbilityBase {
  kind: 'triggered';
  trigger: TriggerNode;
  effects: EffectNode[];
}

export interface StaticAbility extends AbilityBase {
  kind: 'static';
  effect: EffectNode;
}

export interface SpellAbility extends AbilityBase {
  kind: 'spell';
  effects: EffectNode[];
}

export type AbilityNode = ActivatedAbility | TriggeredAbility | StaticAbility | SpellAbility;

export interface Cost {
  /** Mana cost in oracle notation, e.g. "{2}{G}". */
  mana?: string;
  tap?: true;
  untap?: true;
  /** Non-mana costs (sacrifice, discard, pay life…), as effect nodes. */
  other?: EffectNode[];
}

/** Open node: `type` selects the handler in the engine's effect registry. */
export interface EffectNode {
  type: string;
  [param: string]: unknown;
}

export interface TriggerNode {
  type: string;
  [param: string]: unknown;
}

/** Core effect shapes the compiler emits today. Plugins add more. */
export interface AddManaEffect extends EffectNode {
  type: 'add_mana';
  /** Alternatives the player picks from; each is a list of symbols, e.g. [["R"],["G"]] or [["C","C"]]. */
  options?: string[][];
  /** "Add N mana of any one color" style. */
  anyColor?: number;
}

export interface EntersTappedEffect extends EffectNode {
  type: 'enters_tapped';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export type ImageSize = 'small' | 'normal' | 'large' | 'png' | 'art_crop' | 'border_crop';

export const SCRYFALL_IMAGE_HOST = 'https://cards.scryfall.io';

/** Rebuilds a Scryfall image URL from the compact path stored on a face. */
export function imageUrl(path: string, size: ImageSize = 'normal'): string {
  const fixed = size === 'png' ? path.replace(/\.jpg(\?|$)/, '.png$1') : path;
  return `${SCRYFALL_IMAGE_HOST}/${size}/${fixed}`;
}

/** Removes parenthesised reminder text, which has no rules meaning. */
export function stripReminder(line: string): string {
  return line.replace(/\s*\([^()]*\)/g, '').trim();
}

/** How the engine treats one printed oracle line. */
export type LineStatus = 'auto' | 'manual' | 'reminder';

/** Pairs each printed oracle line with whether the engine runs it or a player resolves it. */
export function annotateOracle(face: FaceDef): { text: string; status: LineStatus }[] {
  const unparsed = new Set(face.unparsed);
  return face.oracle
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((text) => {
      const core = stripReminder(text);
      const status: LineStatus = core === '' ? 'reminder' : unparsed.has(core) ? 'manual' : 'auto';
      return { text, status };
    });
}

/** Name used to refer to a card in its own oracle text ("Kinnan" for "Kinnan, Bonder Prodigy"). */
export function shortName(name: string): string {
  const comma = name.indexOf(',');
  return comma > 0 ? name.slice(0, comma) : name;
}
