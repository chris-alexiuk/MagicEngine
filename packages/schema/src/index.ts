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

export const SCHEMA_VERSION = 2 as const;

export { SUBTYPES } from './subtypes.js';

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
  /** Keyword lines the engine doesn't apply yet (the keywords are still listed); resolved manually in play. */
  manualKeywords?: string[];
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
  /** The parameter parsed as an object description, e.g. "Enchant creature you control" (CR 702.5a). */
  filter?: ObjectFilter;
  /** "Enchant player" / "Enchant opponent" (CR 303.4: an Aura can be attached to a player). */
  player?: 'any' | 'opponent';
  /** What the keyword means, compiled from its definition in CR 702 (prowess → a triggered ability). */
  abilities?: AbilityNode[];
}

// ---------------------------------------------------------------------------
// Ability AST
// ---------------------------------------------------------------------------
//
// One oracle line compiles to one ability node, or to nothing (then players
// resolve it by hand). A line is never half-compiled: every node the compiler
// emits has an engine handler (see CORE_NODES below; both packages test it).

export interface AbilityBase {
  kind: string;
  /** The oracle line this ability was compiled from (reminder text removed). */
  text: string;
  /**
   * The object has this ability only while this holds: a Class level (CR 716.2a) or a leveler's
   * striation (CR 711.2a).
   */
  gate?: ConditionNode;
}

/**
 * What a spell or ability does when it resolves: the targets it needs, then its
 * instructions in the order written (CR 608.2c). Effects point at targets by index.
 */
export interface Program {
  /** CR 115.1: chosen as the spell is cast, the ability activated, or the trigger put on the stack. */
  targets?: TargetSpec[];
  effects: EffectNode[];
  /** CR 700.2: modal — the chosen modes' targets and effects are used, in printed order. */
  modes?: ModeChoice;
}

export interface ModeChoice {
  min: number;
  max: number;
  options: ModeOption[];
  /** "If you control a commander as you cast this spell, you may choose both instead." */
  bonus?: { condition: ConditionNode; max: number };
}

export interface ModeOption {
  text: string;
  targets?: TargetSpec[];
  effects: EffectNode[];
  /** The compiler couldn't read this mode: choosing it means players resolve the whole thing by hand. */
  manual?: true;
}

export interface ActivatedAbility extends AbilityBase, Program {
  /** "Activate only if this Class is level 1" (CR 716.2a). */
  activateIf?: ConditionNode;
  kind: 'activated';
  cost: Cost;
  /** True for mana abilities (CR 605): they don't use the stack. */
  mana?: true;
  /** CR 602.5d: "Activate only as a sorcery." */
  timing?: 'sorcery';
  /** "Activate only once each turn." */
  oncePerTurn?: true;
  /** CR 702.177a (exhaust): "Activate only once." */
  oncePerGame?: true;
  /** Where it can be activated from, when not the battlefield (cycling: the hand, CR 702.29a). */
  zone?: 'hand' | 'graveyard';
}

export interface TriggeredAbility extends AbilityBase, Program {
  kind: 'triggered';
  trigger: TriggerNode;
  /** "This ability triggers only once each turn." */
  oncePerTurn?: true;
  /** CR 603.4: an intervening "if" — checked as it triggers and again as it resolves. */
  condition?: ConditionNode;
  /**
   * CR 113.6m: it triggers from this zone, not the battlefield ("return ~ from your graveyard to the battlefield");
   * "When you cast this spell" works on the stack (storm, CR 702.40a).
   */
  zone?: 'graveyard' | 'stack';
}

export interface StaticAbility extends AbilityBase {
  kind: 'static';
  effect: EffectNode;
}

export interface SpellAbility extends AbilityBase, Program {
  kind: 'spell';
}

export type AbilityNode = ActivatedAbility | TriggeredAbility | StaticAbility | SpellAbility;

export interface Cost {
  /** Mana cost in oracle notation, e.g. "{2}{G}". */
  mana?: string;
  tap?: true;
  untap?: true;
  /** CR 606.4: a loyalty ability's cost, e.g. +1 or -3. */
  loyalty?: number;
  /** Non-mana costs, e.g. { type: 'sacrifice_self' } or { type: 'pay_life', amount: 2 }. */
  other?: EffectNode[];
}

/** Open node: `type` selects the handler in the engine's registries. */
export interface EffectNode {
  type: string;
  [param: string]: unknown;
}

export interface TriggerNode {
  type: string;
  [param: string]: unknown;
}

/** A condition in an "if" clause (CR 603.4 intervening "if", or "If …, …" in effect text). */
export interface ConditionNode {
  type: string;
  [param: string]: unknown;
}

// --- Targets, filters and references ----------------------------------------

/** One instance of the word "target" (CR 115.3), possibly for several objects ("two target creatures"). */
export interface TargetSpec {
  /** CR 115.4: "any target" means a creature, player, planeswalker or battle. */
  what: 'any' | 'player' | 'object';
  /** For objects. */
  filter?: ObjectFilter;
  /** For players: "target opponent". */
  player?: 'opponent' | 'you';
  /** How many; 1 unless stated. */
  count?: number;
  /** CR 115.6: "up to N" allows fewer, including zero. */
  upTo?: true;
  /** The printed phrase, for prompts ("target creature you control"). */
  text: string;
}

export type ZoneWord = 'battlefield' | 'stack' | 'graveyard' | 'hand' | 'library' | 'exile';

/** Describes a set of objects. Relative words ("you", "another") are relative to the ability's source. */
export interface ObjectFilter {
  /** CR 115.2: permanents unless the text says otherwise. */
  zone?: ZoneWord;
  /** Any one of these card types ("artifact or enchantment"); omitted = any. */
  types?: string[];
  /** All of these card types too ("artifact creature"). */
  allTypes?: string[];
  /** Any one of these subtypes. */
  subtypes?: string[];
  /** All of these supertypes. */
  supertypes?: string[];
  notTypes?: string[];
  notSubtypes?: string[];
  notSupertypes?: string[];
  /** Any one of these colors. */
  colors?: Color[];
  notColors?: Color[];
  colorless?: true;
  multicolored?: true;
  /** 'enchanted': the player the source Aura is attached to ("creatures enchanted player controls"). */
  controller?: 'you' | 'opponent' | 'not_you' | 'enchanted';
  owner?: 'you' | 'opponent';
  /** "another" / "other": not the source itself. */
  other?: true;
  tapped?: boolean;
  combat?: 'attacking' | 'blocking' | 'attacking_or_blocking';
  token?: boolean;
  /** "with flying" (any of). */
  keywords?: string[];
  /** "without flying". */
  notKeywords?: string[];
  power?: Compare;
  toughness?: Compare;
  manaValue?: Compare;
  /** CR 702.134a (mentor): power less than the source's. */
  powerBelowSource?: true;
  /** CR 903.3: a commander. */
  commander?: true;
  /** "with a +1/+1 counter on it" — a counter of this kind ('any': "with a counter on it"). */
  counter?: string;
  /** "~ or another Ally you control": the source itself matches too, whatever else it is. */
  orSource?: true;
  /** Any one of these ("creature or Vehicle"). */
  anyOf?: ObjectFilter[];
  /** "of the chosen type" / "of the chosen color": what was chosen as the source entered (CR 614.12). */
  chosenType?: true;
  chosenColor?: true;
}

export interface Compare {
  op: 'le' | 'ge' | 'eq';
  n: number;
}

/**
 * Who or what an effect acts on. Pronouns ("it", "that creature", "its controller")
 * are resolved by the compiler to one of these.
 */
export type Ref =
  /** The source of the ability: the permanent, or the spell itself. */
  | { ref: 'self' }
  /** A chosen target (object or player), by index into the program's targets. */
  | { ref: 'target'; index: number }
  /** The object a trigger event was about ("Whenever a creature you control dies, … it …"). */
  | { ref: 'trigger_object' }
  /** The player a trigger event was about ("deals combat damage to a player, that player …"). */
  | { ref: 'trigger_player' }
  /** What the source Aura or Equipment is attached to. */
  | { ref: 'attached' }
  /** Every object matching (CR 608.2h: determined as the effect is applied). */
  | { ref: 'all'; filter: ObjectFilter }
  | { ref: 'you' }
  /** `attacking`: only those attacking that player with a creature ("each opponent attacking that player"). */
  | { ref: 'players'; who: 'each' | 'opponents'; attacking?: Ref }
  | { ref: 'controller_of'; of: Ref }
  | { ref: 'owner_of'; of: Ref }
  /** CR 607.2a: "the exiled card", "cards exiled with ~" — what this object's linked ability exiled. */
  | { ref: 'exiled_with' }
  /** CR 303.4: "enchanted player" — the player an Aura is attached to. */
  | { ref: 'enchanted_player' }
  /** "the token", "those tokens": what the effect just created. */
  | { ref: 'created' };

/** A number, X as paid when casting, or a number the game counts (CR 107.3, CR 608.2h). */
export type Amount = number | 'X' | AmountExpr;

/**
 * A number counted as it's needed: "the number of creatures you control", "its power",
 * "for each card in your hand". `times` and `plus` scale it ("twice", "2 plus").
 * One-shot effects count once, as they resolve (CR 608.2h); static abilities count continuously.
 */
export type AmountExpr = (
  /** Permanents on the battlefield matching a filter (from the controller's point of view). */
  | { kind: 'count'; filter: ObjectFilter }
  /** Cards in hands, graveyards or libraries. */
  | { kind: 'cards'; zone: 'hand' | 'graveyard' | 'library' | 'exile'; who: 'you' | 'opponents' | 'each'; filter?: ObjectFilter }
  /** An object's power, toughness or mana value (last known if it left, CR 608.2h). */
  | { kind: 'stat'; stat: 'power' | 'toughness' | 'mana_value'; of: Ref }
  | { kind: 'life'; who: Ref }
  | { kind: 'counters'; of: Ref; counter?: string }
  /** Players: "for each opponent". */
  | { kind: 'players'; who: 'opponents' | 'each' }
  /** CR 700.5: devotion to one or more colors. */
  | { kind: 'devotion'; colors: Color[] }
  /** X as paid (CR 107.3m), when it needs scaling ("-X/-X"). */
  | { kind: 'x' }
  /** "that much" / "that many": the amount of the event that triggered the ability. */
  | { kind: 'event' }
  /** CR 702.40a (storm): spells cast before that spell this turn. */
  | { kind: 'cast_before'; of: Ref }
  /** CR 903.8: times you've cast your commander from the command zone this game. */
  | { kind: 'commander_casts' }
  /** CR 702.33c (multikicker): how many times the spell was kicked. */
  | { kind: 'kicks' }
) & { times?: number; plus?: number };

/**
 * Rules-meaningful restrictions and requirements carried by continuous effects.
 * Kept as flags so combat and casting can check them cheaply.
 */
export const RULE_FLAGS = [
  'cant_attack',
  'cant_block',
  'cant_be_blocked',
  'attacks_each_combat',
  'cant_be_countered',
  'doesnt_untap',
  /** "can attack as though it didn't have defender" (CR 702.3b). */
  'can_attack_with_defender',
] as const;
export type RuleFlag = (typeof RULE_FLAGS)[number];

// --- Core node shapes ---------------------------------------------------------

export interface AddManaEffect extends EffectNode {
  type: 'add_mana';
  /**
   * Alternatives the player picks from; each is a list of symbols, e.g. [["R"],["G"]] or [["C","C"]].
   * "chosen" stands for the color chosen as the source entered ("one mana of the chosen color").
   */
  options?: string[][];
  /** "Add N mana of any one color" style. */
  anyColor?: number;
  /** CR 903.4: "any color in your commander's color identity" — only those colors. */
  identity?: true;
}

export interface EntersTappedEffect extends EffectNode {
  type: 'enters_tapped';
  /** "enters tapped unless you control a Forest" */
  unless?: ConditionNode;
}

/** Blocking restrictions and requirements (CR 509.1b–c) carried by continuous effects. */
export interface CombatRules {
  /** "can't be blocked by creatures with power 2 or less" */
  cantBeBlockedBy?: ObjectFilter;
  /** "can't be blocked except by creatures with flying" */
  blockableOnlyBy?: ObjectFilter;
  /** "can block only creatures with flying" */
  canBlockOnly?: ObjectFilter;
  /** "can't be blocked by more than one creature" */
  maxBlockers?: number;
  /** "can't be blocked except by three or more creatures" */
  minBlockers?: number;
  /** "must be blocked if able" (one) / "All creatures able to block ~ do so" (all) */
  mustBeBlocked?: 'one' | 'all';
}

/** A static ability's continuous effect (CR 611.3): layer 6 abilities, layer 7c P/T, rule flags. */
/**
 * CR 118.9 / CR 601.2b, 601.2f: a cost chosen as the spell is cast. An alternative cost replaces
 * the mana cost ("You may cast this card by paying [cost] rather than paying its mana cost": evoke,
 * dash, escape); an additional one is paid on top ("You may pay an additional [cost] as you cast
 * this spell": buyback). `id` names it for "if its evoke cost was paid" (the keyword, or "alt").
 */
export interface CastOptionNode extends EffectNode {
  type: 'cast_option';
  id: string;
  kind: 'alternative' | 'additional';
  cost: Cost;
  /** Escape: cast from your graveyard this way (CR 702.138a); foretell, plot, madness: from exile. */
  zone?: 'graveyard' | 'exile';
  /** Spectacle: "if an opponent lost life this turn" (CR 702.137a). */
  condition?: ConditionNode;
  /** Entwine: all modes are chosen (CR 702.42a). */
  allModes?: true;
}

/**
 * CR 707.9: "…a copy of …, except …" — exceptions that become part of the copy's copiable values.
 * Applied in layer 1 along with the copy itself.
 */
export interface CopyExcept {
  name?: string;
  /** "it isn't legendary" */
  nonlegendary?: true;
  /** "it's legendary in addition to its other types" */
  supertypes?: string[];
  /** "it's an artifact in addition to its other types" */
  addTypes?: string[];
  /** "it's a Spirit in addition to its other types" */
  addSubtypes?: string[];
  /** "it's a 4/4 black Zombie": these replace its creature types. */
  setCreatureTypes?: string[];
  /** "it's white" / "it's black": its colors become these. */
  colors?: Color[];
  /** "it's 1/1" */
  power?: number;
  toughness?: number;
  /** "it has haste" / "it has flying" */
  keywords?: KeywordInstance[];
  /** CR 707.9d: "it has no mana cost" */
  noManaCost?: true;
}

export interface ContinuousEffectNode extends EffectNode {
  type: 'continuous';
  affected: Ref;
  /** Layer 7c: "gets +1/+1", "gets +1/+1 for each other Zombie you control". */
  power?: Amount;
  toughness?: Amount;
  /**
   * Layer 7a (characteristic-defining, CR 604.3: "~'s power and toughness are each equal to …") or
   * 7b ("has base power and toughness 1/1"): power and toughness set to a value.
   */
  setPower?: Amount;
  setToughness?: Amount;
  setLayer?: '7a' | '7b';
  keywords?: KeywordInstance[];
  rules?: RuleFlag[];
  /** Blocking restrictions and requirements. */
  combat?: CombatRules;
  /** Layer 2: the source's controller controls the affected permanents. */
  control?: 'you';
  /** "As long as [condition], …" / "During your turn, …": applies only while this is true. */
  condition?: ConditionNode;
}

/**
 * "As ~ enters, …" (CR 614.12): a choice made as the permanent enters.
 * pay_life / reveal: if the player doesn't, it enters tapped (shocklands, reveal lands).
 * color / creature_type: remembered on the permanent for "the chosen color/type".
 */
export interface AsEntersNode extends EffectNode {
  type: 'as_enters';
  /** copy: "You may have ~ enter as a copy of any creature on the battlefield" (CR 707.5, CR 614.1c). */
  choice: 'pay_life' | 'reveal' | 'color' | 'creature_type' | 'copy';
  /** For copy: how the copy differs from the original (CR 707.9). */
  copyExcept?: CopyExcept;
  amount?: number;
  /** For reveal: the kind of card in hand. */
  filter?: ObjectFilter;
  /** "choose a color other than green" */
  except?: Color;
  /** "This land enters tapped. As it enters, choose a color." */
  tapped?: true;
}

/**
 * CR 601.2f: cost increases and reductions. On a permanent: "Creature spells you cast cost {1} less
 * to cast." On the spell itself (`self`): "This spell costs {1} less to cast for each artifact you control."
 */
export interface CostModifierNode extends EffectNode {
  type: 'cost_modifier';
  /** The spell's own cost (works wherever it's cast from, CR 113.6e). */
  self?: true;
  /** Whose spells, from the point of view of the permanent's controller. */
  who?: 'you' | 'opponents' | 'each';
  /** Which spells ("creature spells", "instant and sorcery spells"). */
  filter?: ObjectFilter;
  /** Generic mana (or one colored symbol, `color`) per unit. */
  amount: Amount;
  color?: Color;
  change: 'less' | 'more';
  condition?: ConditionNode;
}

/**
 * CR 614.1a: "If a creature an opponent controls would die, exile it instead." / "If a card or token would
 * be put into your graveyard from anywhere, exile it instead." (Rest in Peace and friends.)
 */
export interface ExileInsteadNode extends EffectNode {
  type: 'exile_instead';
  /** Whose graveyard (by owner), from the source controller's point of view. */
  owner?: 'you' | 'opponents' | 'each';
  /** Only objects like this. */
  filter?: ObjectFilter;
  /** Only when dying (from the battlefield). */
  dies?: true;
}

/**
 * CR 614.1a: replacement effects that change how much happens — "If you would gain life, you gain twice
 * that much life instead", token and counter doublers, "it deals double that damage instead".
 */
export interface QuantityReplacementNode extends EffectNode {
  type: 'replace_quantity';
  event: 'gain_life' | 'tokens' | 'counters' | 'damage';
  op: 'double' | 'triple' | 'plus';
  n?: number;
  /** gain_life: who gains; tokens: under whose control; counters: who puts them (from the source controller's view). */
  who?: 'you' | 'opponents' | 'each';
  /** counters: what they're put on; damage: the source. */
  filter?: ObjectFilter;
  /** counters: which kind (any if absent). */
  counter?: string;
  /** damage: only to opponents and their permanents; only noncombat damage. */
  toOpponents?: true;
  noncombat?: true;
}

/** Rules changes for players (CR 402.2, CR 305.2, CR 614.10): "You have no maximum hand size." */
/**
 * look_at_top: the player may look at their library's top card any time; top_revealed: everyone sees it;
 * hexproof / shroud: CR 702.11c / 702.18; cant_gain_life; no_lose_for_life: "You don't lose the game for
 * having 0 or less life"; cant_lose: "You can't lose the game"; flash: "You may cast spells as though they had flash".
 */
export const PLAYER_RULES = [
  'no_max_hand_size', 'extra_lands', 'skip_draw', 'look_at_top', 'top_revealed', 'hexproof', 'shroud', 'cant_gain_life',
  'no_lose_for_life', 'cant_lose', 'flash',
] as const;
export type PlayerRule = (typeof PLAYER_RULES)[number];

export interface PlayerRuleNode extends EffectNode {
  type: 'player_rule';
  /** Who it applies to, from the point of view of the source's controller. */
  who: 'you' | 'each' | 'opponents';
  rule: PlayerRule;
  /** For extra_lands: how many more. */
  amount?: number;
  condition?: ConditionNode;
}

/** A token as created: a face definition plus a name (CR 111.4). */
export interface TokenSpec {
  face: FaceDef;
}

/**
 * Node tags the engine core handles. The compiler emits only these (or tags a
 * plugin registers), so a compiled line always runs.
 */
export const CORE_NODES = {
  effects: [
    'add_mana', 'deal_damage', 'draw', 'gain_life', 'lose_life', 'destroy', 'move', 'counter', 'tap', 'untap',
    'add_counters', 'modify', 'create_token', 'scry', 'surveil', 'mill', 'discard', 'regenerate', 'attach',
    'sacrifice', 'may', 'transform', 'monstrosity', 'may_pay', 'unless_pays', 'search', 'sacrifice_choice', 'if', 'may_do',
    'delayed', 'gain_control', 'exile_if_dies', 'prevent', 'explore', 'become_monarch', 'get_counters', 'skip_untap',
    'proliferate', 'connive', 'amass', 'exile_top', 'class_level', 'exile_on_leave', 'unless_does',
    'players_do', 'emblem', 'copy_spell', 'manifest', 'cast_free', 'cascade', 'discover', 'suspend_tick', 'madness_cast',
    'remove_counters', 'become_renowned', 'day_night', 'become_saddled', 'fight', 'move_chosen',
  ],
  conditions: [
    'kicked', 'cast_by_you', 'self_tapped', 'your_turn', 'count', 'life', 'hand', 'graveyard', 'this_turn', 'spells_last_turn',
    'counters', 'is', 'has_attached', 'monstrous', 'and', 'opponents', 'monarch', 'class_level', 'paid', 'arrived_since_upkeep', 'renowned', 'day_night', 'saddled',
  ],
  statics: [
    'enters_tapped', 'enters_with_counters', 'continuous', 'additional_cost', 'graveyard_to_exile', 'player_rule', 'as_enters', 'deck_rule',
    'cost_modifier', 'replace_quantity', 'exile_instead', 'cast_option', 'resolve_to_hand', 'rebound', 'enters_day',
  ],
  triggers: [
    'enters', 'dies', 'leaves', 'attacks', 'blocks', 'becomes_blocked', 'deals_combat_damage', 'phase', 'cast', 'gain_life', 'draw',
    'becomes_target', 'deals_damage', 'dealt_damage', 'player_dealt_damage', 'lose_life', 'chapter', 'becomes_level',
    'player_attacked', 'turned_face_up', 'last_counter_removed', 'day_night_changed',
  ],
  costs: ['sacrifice_self', 'pay_life', 'discard_self', 'sacrifice', 'discard', 'exile_self', 'pay_energy', 'crew', 'exile_cards'],
  /** Counted amounts (AmountExpr kinds). */
  amounts: ['count', 'cards', 'stat', 'life', 'counters', 'players', 'devotion', 'x', 'event', 'cast_before', 'commander_casts', 'kicks'],
  /** Keyword abilities (CR 702) the engine applies. Others are recorded but resolved by players. */
  keywords: [
    'flying', 'first_strike', 'double_strike', 'deathtouch', 'defender', 'flash', 'haste', 'hexproof', 'hexproof_from',
    'indestructible', 'lifelink', 'menace', 'reach', 'trample', 'vigilance', 'fear', 'intimidate', 'shroud', 'skulk',
    'horsemanship', 'protection', 'landwalk', 'infect', 'wither', 'toxic', 'shadow', 'enchant', 'devoid', 'changeling',
    'flashback', 'convoke', 'delve', 'improvise', 'morph', 'megamorph', 'disguise', 'foretell', 'plot', 'suspend', 'madness', 'split_second', 'daybound', 'nightbound',
    // Deck-construction rules only (CR 702.124, 702.124h–k): nothing to do during a game.
    'partner', 'friends_forever', 'choose_a_background', 'doctor_s_companion',
    'kicker', 'multikicker',
  ],
} as const;

/** Whether the engine applies this keyword instance (some need a parameter it understands). */
export function keywordSupported(kw: KeywordInstance): boolean {
  // Defined by abilities the compiler read from the CR (prowess, cycling, equip…).
  if (kw.abilities?.length) return true;
  if (!(CORE_NODES.keywords as readonly string[]).includes(kw.id)) return false;
  // Enchant with a quality the compiler could read; flashback with a mana cost.
  if (kw.id === 'enchant') return Boolean(kw.filter || kw.player);
  if (['flashback', 'kicker', 'multikicker', 'morph', 'megamorph', 'disguise', 'foretell', 'plot', 'madness'].includes(kw.id)) return Boolean(kw.cost && /^(\{[^}]+\})+$/.test(kw.cost));
  // Suspend N—[cost]
  if (kw.id === 'suspend') return Boolean(kw.n && kw.cost && /^(\{[^}]+\})+$/.test(kw.cost));
  return true;
}

/** Modes of a face's modal abilities that players resolve by hand, as "• text" lines. */
export function manualModes(face: FaceDef): string[] {
  return face.abilities.flatMap((a) => (a.kind === 'static' ? [] : (a.modes?.options ?? []).filter((m) => m.manual).map((m) => `• ${m.text}`)));
}

/** A face's abilities, including those its keywords stand for. */
export function faceAbilities(face: FaceDef): AbilityNode[] {
  return [...face.abilities, ...face.keywords.flatMap((k) => k.abilities ?? [])];
}

/** Every node tag used by one ability, by kind — for checking the CORE_NODES invariant. */
export function nodeTags(a: AbilityNode): { effects: string[]; statics: string[]; triggers: string[]; costs: string[]; conditions: string[]; amounts: string[] } {
  const out = { effects: [] as string[], statics: [] as string[], triggers: [] as string[], costs: [] as string[], conditions: [] as string[], amounts: [] as string[] };
  // Counted amounts sit in an effect's own fields ("amount", "power"…).
  const amounts = (e: EffectNode) => {
    for (const v of Object.values(e)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { kind?: unknown }).kind === 'string') out.amounts.push((v as { kind: string }).kind);
    }
  };
  const cond = (c: ConditionNode) => {
    out.conditions.push(c.type);
    if (c.type === 'and') for (const part of c.all as ConditionNode[]) cond(part);
  };
  // Abilities an effect gives something: quoted ones granted ("gains "…""), an emblem's, a token's.
  const nested = (e: EffectNode) => {
    const token = e.token as FaceDef | undefined;
    const kws = [...((e.keywords as KeywordInstance[] | undefined) ?? []), ...(token?.keywords ?? []), ...(((e.except ?? e.copyExcept) as CopyExcept | undefined)?.keywords ?? [])];
    const inner = [...((e.abilities as AbilityNode[] | undefined) ?? []), ...(token?.abilities ?? []), ...kws.flatMap((k) => k.abilities ?? [])];
    for (const n of inner) {
      const t = nodeTags(n);
      for (const k of Object.keys(out) as (keyof typeof out)[]) out[k].push(...t[k]);
    }
  };
  const visit = (list: EffectNode[] | undefined) => {
    for (const e of list ?? []) {
      out.effects.push(e.type);
      amounts(e);
      nested(e);
      for (const key of ['effects', 'then', 'else', 'action']) if (Array.isArray(e[key])) visit(e[key] as EffectNode[]);
      if (e.cond) cond(e.cond as ConditionNode);
    }
  };
  if (a.kind === 'triggered' && a.condition) cond(a.condition);
  if (a.gate) cond(a.gate);
  if (a.kind === 'activated' && a.activateIf) cond(a.activateIf);
  if (a.kind === 'static') {
    out.statics.push(a.effect.type);
    amounts(a.effect);
    if (a.effect.condition) cond(a.effect.condition as ConditionNode);
    if (a.effect.unless) cond(a.effect.unless as ConditionNode);
    if (a.effect.type === 'additional_cost') out.costs.push((a.effect.cost as EffectNode).type);
    nested(a.effect);
  }
  else {
    visit(a.effects);
    for (const m of a.modes?.options ?? []) visit(m.effects);
    if (a.kind === 'triggered') out.triggers.push(a.trigger.type);
    if (a.kind === 'activated') for (const c of a.cost.other ?? []) out.costs.push(c.type);
  }
  return out;
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
  const unparsed = new Set([...face.unparsed, ...(face.manualKeywords ?? [])]);
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
