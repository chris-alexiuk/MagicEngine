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
export * from './qualities.js';
import { qualitiesRead } from './qualities.js';

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
  /** Granted flashback: "The flashback cost is equal to its mana cost." (Snapcaster Mage) */
  costIsManaCost?: true;
  /** Protection granted by an Aura: "This effect doesn't remove this Aura." / "… doesn't remove Auras." (CR 702.16d) */
  keeps?: 'source' | 'auras';
  /** Bound by the engine as a quality keyword is granted: the player "you" means, and the object that granted it. */
  you?: string;
  grantedBy?: string;
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
  /**
   * CR 601.2c: what it does instead when this holds as it's cast. "If this spell was kicked, exile target nonland
   * permanent instead." (Tear Asunder) has other targets, chosen knowing whether it's kicked or the gift promised.
   */
  variant?: { condition: ConditionNode; targets?: TargetSpec[]; effects: EffectNode[] };
}

export interface ModeChoice {
  min: number;
  max: number;
  options: ModeOption[];
  /** "If you control a commander as you cast this spell, you may choose both instead." */
  bonus?: { condition: ConditionNode; max: number };
  /** CR 700.2d: "You may choose the same mode more than once." */
  repeat?: true;
  /**
   * "Choose one that hasn't been chosen this turn —" ('turn'), "… that hasn't been chosen —" ('ever': while it's the
   * same object, CR 400.7): a mode this object's ability had chosen before can't be chosen again (CR 700.2a–b).
   */
  unchosen?: 'turn' | 'ever';
}

export interface ModeOption {
  text: string;
  targets?: TargetSpec[];
  effects: EffectNode[];
  /** The compiler couldn't read this mode: choosing it means players resolve the whole thing by hand. */
  manual?: true;
  /** CR 702.172a (spree) / 702.183a (tiered): the additional cost paid for choosing this mode. */
  cost?: string;
}

export interface ActivatedAbility extends AbilityBase, Program {
  /** "Activate only if this Class is level 1" (CR 716.2a). */
  activateIf?: ConditionNode;
  kind: 'activated';
  cost: Cost;
  /** True for mana abilities (CR 605): they don't use the stack. */
  mana?: true;
  /** CR 602.5d: "Activate only as a sorcery." */
  /** 'instant': "Activate only as an instant" — for a mana ability, only with priority (Lion's Eye Diamond). */
  timing?: 'sorcery' | 'instant';
  /** "Activate only once each turn." */
  oncePerTurn?: true;
  /** CR 702.177a (exhaust): "Activate only once." */
  oncePerGame?: true;
  /** CR 702.193a (power-up): reduced by the permanent's mana cost if it entered this turn. */
  powerUp?: true;
  /**
   * "This ability costs {1} less to activate for each legendary creature you control" (channel lands), "… if you're
   * the monarch", "… during your turn": generic mana off its cost (CR 601.2f via CR 602.2b).
   */
  /** Throne of Eldraine: "Spend only mana of the chosen color to activate this ability" — its whole mana cost in that color. */
  payOnly?: 'chosen';
  costReduction?: { amount: number; per?: AmountExpr; condition?: ConditionNode; yourTurn?: true };
  /** "Activate no more than twice each turn." */
  maxPerTurn?: number;
  /** CR 702.142a: a boast ability (Birgi's "boast twice" raises its limit). */
  boast?: true;
  /** CR 602.2: "Any player may activate this ability." */
  anyPlayer?: true;
  /** Where it can be activated from, when not the battlefield (cycling: the hand, CR 702.29a). */
  zone?: 'hand' | 'graveyard';
}

export interface TriggeredAbility extends AbilityBase, Program {
  /** CR 603.2h: "Do this only once each turn." — it triggers only if its optional action wasn't taken this turn. */
  doOnce?: true;
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
  /** The compiler couldn't read its effect (a dungeon's room ability, CR 309.4c): it triggers, then is resolved by hand. */
  manual?: true;
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
  /** CR 606.4 / 107.3: "−X" — X loyalty counters removed, the X announced as it's activated (with `loyalty: 0`). */
  loyaltyX?: -1 | 1;
  /** Non-mana costs, e.g. { type: 'sacrifice_self' } or { type: 'pay_life', amount: 2 }. */
  other?: EffectNode[];
  /**
   * CR 701.67a: "Waterbend {3}" — that much of the mana cost's generic mana may be paid by tapping untapped artifacts and
   * creatures you control instead (CR 701.67b: only the waterbend cost's).
   */
  waterbend?: number;
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
  /**
   * CR 115.4: "any target" means a creature, player, planeswalker or battle.
   * 'ability': an activated or triggered ability on the stack (CR 113.1c, 602.2a) — "counter target activated ability".
   */
  what: 'any' | 'player' | 'object' | 'ability';
  /** For abilities: which kinds ("target activated or triggered ability"). */
  abilities?: ('activated' | 'triggered')[];
  /** For abilities: what their source must be ("from an artifact source", CR 113.7). */
  source?: ObjectFilter;
  /** For abilities: spells that may be chosen too ("target activated ability, triggered ability, or noncreature spell"). */
  spells?: ObjectFilter;
  /** Bolt Bend: "target spell or ability with a single target" (CR 115.10). */
  singleTarget?: true;
  /** Siren Stormtamer: "target spell or ability that targets you or a creature you control" — what it targets. */
  targeting?: { you?: true; filter?: ObjectFilter };
  /** For objects. */
  filter?: ObjectFilter;
  /** For players: "target opponent". */
  player?: 'opponent' | 'you';
  /** How many; 1 unless stated. */
  count?: number;
  /** "Exile X target creatures": as many as the X announced (CR 601.2b–c). `count` is then ignored. */
  countX?: true;
  /** CR 115.6: "up to N" allows fewer, including zero. */
  upTo?: true;
  /** "one, two, or three targets": at least this many. */
  min?: number;
  /** "up to two target cards from a single graveyard": all of them with the same owner. */
  sameOwner?: true;
  /** Agadeem's Awakening: "any number of target creature cards that each have a different mana value". */
  distinctManaValues?: true;
  /** Gilded Drake: "This ability still resolves if its target becomes illegal." (no CR 608.2b check). */
  stillResolves?: true;
  /** Run Away Together: "two target creatures controlled by different players". */
  differentControllers?: true;
  /** Secret Tunnel: "two target creatures you control that share a creature type"; Shifting Loyalties: "… a card type". */
  shareCreatureType?: true;
  shareCardType?: true;
  /**
   * "For each opponent, exile up to one target creature that player controls": one target for each such player,
   * each controlled by (or, off the battlefield, owned by) a different one of them. `count` is ignored.
   */
  perPlayer?: 'opponents' | 'each';
  /** The printed phrase, for prompts ("target creature you control"). */
  text: string;
}

export type ZoneWord = 'battlefield' | 'stack' | 'graveyard' | 'hand' | 'library' | 'exile' | 'command';

/** Describes a set of objects. Relative words ("you", "another") are relative to the ability's source. */
export interface ObjectFilter {
  /** CR 115.2: permanents unless the text says otherwise. */
  zone?: ZoneWord;
  /** CR 700.6: historic — legendary, an artifact, or a Saga. */
  historic?: true;
  /** Desynchronization: "that's not historic". */
  notHistoric?: true;
  /** CR 700.9: modified — equipped, enchanted by an Aura its controller controls, or with a counter on it. */
  modified?: true;
  /** "with an even mana value" (CR 202.3). */
  manaValueParity?: 'even' | 'odd';
  /** "a card with the same mana value as this card" (transmute, CR 702.53a). */
  sameManaValueAs?: 'self';
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
  /** CR 105.2b: exactly one color. */
  monocolored?: true;
  /** 'enchanted': the player the source Aura is attached to ("creatures enchanted player controls"). */
  /** defending: the player the source is attacking ("target creature defending player controls", CR 506.2). */
  controller?: 'you' | 'opponent' | 'not_you' | 'enchanted' | 'defending';
  owner?: 'you' | 'opponent';
  /** "another" / "other": not the source itself. */
  other?: true;
  tapped?: boolean;
  combat?: 'attacking' | 'blocking' | 'attacking_or_blocking';
  /** "creatures attacking you" — the player whose point of view this is (not their planeswalkers). */
  attackingYou?: true;
  /** Oviya: "Each creature that's attacking one of your opponents" — the player attacked is an opponent. */
  attackingOpponent?: true;
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
  /** Bedrock Tortoise: "with toughness greater than its power". */
  toughnessAbovePower?: true;
  /** Zaxara: "a spell with {X} in its mana cost" (false: "without {X} …"). */
  xInCost?: boolean;
  /** Charix: "Spells your opponents cast that target Charix" — the source itself. */
  isSource?: true;
  /** Moonsilver Key: "an artifact card with a mana ability" (false: "without mana abilities"). */
  manaAbility?: boolean;
  /** Selvala: "its power is greater than each other creature's power" — the greatest, not tied. */
  powerAboveOthers?: true;
  /** The Darkness Crystal: "exiled with ~" — cards its abilities exiled (CR 607.2a). */
  exiledWithSource?: true;
  /** Kutzil: "with power greater than its base power" (CR 208.4b: base power is set by layers 7a–7b). */
  powerAboveBase?: true;
  /** CR 702.78a (conspire): "that each share a color with it" — the source. */
  sharesColorWithSource?: true;
  /** Attached to a permanent ("if this permanent is attached to a creature", reconfigure). */
  attached?: true;
  /** Winds of Rath: "creatures that aren't enchanted" (false); "that's enchanted" (true) — by an Aura (CR 303.4). */
  enchanted?: boolean;
  /** "equipped creatures you control" — an Equipment is attached to it. */
  equipped?: true;
  /** "all creatures target player controls": controlled by the player(s) this refers to (as an effect resolves). */
  controlledBy?: Ref;
  /** "all cards from target player's graveyard": owned by the player(s) this refers to (as an effect resolves). */
  ownedBy?: Ref;
  /** "creatures that aren't of the chosen type" (Kindred Dominance). */
  notChosenType?: true;
  /** "Aura attached to it": attached to the source (self) or to what the source is attached to (attached). */
  attachedTo?: 'self' | 'attached';
  /** Sage's Reverie: "each Aura you control that's attached to a creature". */
  attachedToType?: string;
  /** CR 903.3: a commander. */
  commander?: true;
  /** "with a +1/+1 counter on it" — a counter of this kind ('any': "with a counter on it"). */
  counter?: string;
  /** Wave Goodbye: "without a +1/+1 counter on it" ('any': "without counters on it"). */
  notCounter?: string;
  /** "~ or another Ally you control": the source itself matches too, whatever else it is. */
  orSource?: true;
  /** "a card named Pir, Imaginative Rascal" */
  name?: string;
  /** Urza's Saga: "an artifact card with mana cost {0} or {1}" — its printed mana cost is one of these (CR 202.1). */
  manaCostIs?: string[];
  /** "creature that was dealt damage this turn" */
  damagedThisTurn?: true;
  /** Any one of these ("creature or Vehicle"). */
  anyOf?: ObjectFilter[];
  /** "of the chosen type" / "of the chosen color": what was chosen as the source entered (CR 614.12). */
  chosenType?: true;
  chosenColor?: true;
  /** "with the chosen name": the name chosen as the source entered (CR 201.3). */
  chosenName?: true;
  /** Path of Ancestry: "a creature spell that shares a creature type with your commander". */
  sharesTypeWithCommander?: true;
  /** Braids, Arisen Nightmare: "a permanent … that shares a card type with" what was sacrificed earlier this resolution. */
  sharesCardTypeWithSacrificed?: true;
  /** Shared Animosity: "that shares a creature type with it" (CR 205.3m) — it being this object. */
  sharesCreatureTypeWith?: Ref;
  /** Mirror Box: "with the same name as that creature" — the name it has (CR 201.2); `sameName` is set by the engine. */
  sameNameAs?: Ref;
  sameName?: string;
  /** "each other attacking creature that shares a creature type with it": other than it, not other than the source. */
  otherThan?: Ref;
  /** Set by the engine as an effect applies: the creature types `sharesCreatureTypeWith` stands for, and `otherThan`'s id. */
  sharesCreatureTypes?: string[];
  notObject?: string;
  /** "a creature dealt damage by ~ this turn" */
  damagedBySource?: true;
  /** Vengeful Ancestor: "a goaded creature" (CR 701.15). */
  goaded?: true;
  /** Relentless Assault: it was declared as an attacker this turn (as this object, CR 400.7). */
  attackedThisTurn?: true;
  /** Steel Hellkite: its controller was dealt combat damage by the source this turn. */
  controllerHitBySource?: true;
  /** Oran-Rief: "each green creature that entered this turn" */
  enteredThisTurn?: true;
}

export interface Compare {
  /** `lt` / `gt`: Fell the Mighty's "power greater than target creature's power". */
  op: 'le' | 'ge' | 'eq' | 'lt' | 'gt';
  /**
   * 'X': the spell's X ("a creature card with mana value X or less", Chord of Calling); a counted amount when the text
   * says what X is ("where X is 2 plus the sacrificed creature's mana value", Eldritch Evolution) — worked out as it
   * resolves.
   */
  n: number | 'X' | AmountExpr;
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
  /** Coat of Arms: "… that shares at least one creature type with it" — each object a static effect applies to, in turn. */
  | { ref: 'affected' }
  /** Archfiend of Despair: "each opponent loses life equal to the life that player lost this turn" — each of them in turn. */
  | { ref: 'each_player' }
  /** Every object matching (CR 608.2h: determined as the effect is applied). */
  | { ref: 'all'; filter: ObjectFilter }
  | { ref: 'you' }
  /** `attacking`: only those attacking that player with a creature ("each opponent attacking that player"). */
  /** `except`: Kediss's "each other opponent" — not the player the trigger was about. */
  /** `lostLife`: Papalymo Totolymo's "each opponent who lost life this turn". */
  | { ref: 'players'; who: 'each' | 'opponents'; attacking?: Ref; except?: Ref; lostLife?: true }
  | { ref: 'controller_of'; of: Ref }
  /** Raid Bombardment: "the player or planeswalker that creature is attacking" (a damage recipient). */
  | { ref: 'attacked_by'; of: Ref }
  | { ref: 'owner_of'; of: Ref }
  /** CR 607.2a: "the exiled card", "cards exiled with ~" — what this object's linked ability exiled. */
  | { ref: 'exiled_with' }
  /** CR 303.4: "enchanted player" — the player an Aura is attached to. */
  | { ref: 'enchanted_player' }
  /** "the token", "those tokens": what the effect just created. */
  | { ref: 'created' }
  /** CR 701.38: "each permanent with the most votes or tied for most votes". */
  | { ref: 'voted' }
  /** "Target player sacrifices a creature. You gain life equal to that creature's toughness." — what this effect sacrificed. */
  | { ref: 'sacrificed_this_way' }
  /** "that card's mana value" after "discards a card" — only its characteristics as it was discarded (cost_lki). */
  | { ref: 'discarded_this_way' }
  /** CR 614.12: "the chosen player" — the player chosen as the source entered ("As ~ enters, choose a player"). */
  | { ref: 'chosen_player' }
  // Baleful Mastery: "an opponent draws a card" — the opponent this resolution chose (choose_opponent).
  | { ref: 'chosen_opponent' }
  /** "Put a +1/+1 counter on a creature you control. It gains …" — the object that effect chose. */
  | { ref: 'chosen_object' };

/** A number, X as paid when casting, or a number the game counts (CR 107.3, CR 608.2h). */
export type Amount = number | 'X' | AmountExpr;

/**
 * A number counted as it's needed: "the number of creatures you control", "its power",
 * "for each card in your hand". `times` and `plus` scale it ("twice", "2 plus").
 * One-shot effects count once, as they resolve (CR 608.2h); static abilities count continuously.
 */
export type AmountExpr = (
  /** Permanents on the battlefield matching a filter (from the controller's point of view). */
  // Cavern-Hoard Dragon: `most` — the greatest number any one opponent controls.
  | { kind: 'count'; filter: ObjectFilter; most?: true }
  /** Maester Seymour, Lux Artillery: "the number of counters among creatures you control" — every counter on them. */
  | { kind: 'counters_among'; filter: ObjectFilter }
  // Coalition Relic: "for each charge counter removed this way" — by this resolution's remove-counters effects.
  | { kind: 'counters_removed' }
  /** Cards in hands, graveyards or libraries. */
  /** `player`: "in target opponent's hand" — that player's cards (`who` is then ignored). */
  /** `least`: the fewest any one of those players has (Shelldock Isle: "a library has twenty or fewer cards in it"). */
  | { kind: 'cards'; zone: 'hand' | 'graveyard' | 'library' | 'exile'; who: 'you' | 'opponents' | 'each'; filter?: ObjectFilter; player?: Ref; least?: true }
  /** An object's power, toughness or mana value (last known if it left, CR 608.2h). */
  | { kind: 'stat'; stat: 'power' | 'toughness' | 'mana_value' | 'colors'; of: Ref }
  /** "the amount of mana spent to cast that spell" (CR 601.2h). */
  | { kind: 'mana_spent'; of: Ref }
  /** Multani: "for each land you control and each land card in your graveyard" — counts added together. */
  | { kind: 'sum'; parts: AmountExpr[] }
  | { kind: 'life'; who: Ref }
  | { kind: 'counters'; of: Ref; counter?: string }
  /** Players: "for each opponent". */
  /**
   * `lostLife`: "for each opponent who lost life this turn" (Teysa, Opulent Oligarch); Smuggler's Share: `drew`, "who drew
   * two or more cards this turn"; `landsEntered`, "who had two or more lands enter the battlefield under their control".
   */
  /** `drewThisWay`: Cut a Deal's "for each opponent who drew a card this way". */
  | { kind: 'players'; who: 'opponents' | 'each'; lostLife?: true; drew?: number; landsEntered?: number; drewThisWay?: true; combatDamaged?: true }
  /** CR 700.5: devotion to one or more colors. */
  /** `manaColor`: Nykthos — "your devotion to that color", the color of the mana being added. */
  | { kind: 'devotion'; colors: Color[]; manaColor?: true }
  /** X as paid (CR 107.3m), when it needs scaling ("-X/-X"). */
  | { kind: 'x' }
  /** "that much" / "that many": the amount of the event that triggered the ability. */
  // The Skullspore Nexus: "the total power of those creatures" (stat: the creatures that died together, as they last existed).
  | { kind: 'event'; stat?: 'power' }
  /** CR 702.40a (storm): spells cast before that spell this turn. */
  // Thousand-Year Storm: only spells you cast, and only those that match.
  | { kind: 'cast_before'; of: Ref; filter?: ObjectFilter; yours?: true }
  /** CR 903.8: times you've cast your commander from the command zone this game. */
  | { kind: 'commander_casts' }
  /** CR 702.33c (multikicker): how many times the spell was kicked. */
  | { kind: 'kicks' }
  /** "for each time its replicate cost was paid" (CR 702.56a, 702.157a). */
  | { kind: 'paid_times'; cost: string }
  /** CR 700.8: the creatures in your party (up to one each of Cleric, Rogue, Warrior and Wizard). */
  | { kind: 'party' }
  /** CR 305.6 (domain): the number of basic land types among lands you control. */
  | { kind: 'domain' }
  /** Delirium: the number of card types among cards in your graveyard. */
  // Tarmogoyf: `whose` — all graveyards, or the opponents'; yours without it.
  | { kind: 'card_types'; whose?: 'all' | 'opponents' }
  /** CR 706.2: "equal to the result" — the result of the die roll this resolution made. */
  | { kind: 'die_result' }
  /** CR 701.38: "for each death vote" — votes for that option as this resolves. */
  | { kind: 'votes'; option: string }
  /** Faeburrow Elder: "for each color among permanents you control". */
  | { kind: 'colors_among'; filter: ObjectFilter }
  /** Aetherflux Reservoir: "for each spell you've cast this turn". */
  /** Rug of Smothering: `player` — that player's spells ("each spell they've cast this turn"). */
  | { kind: 'spells_cast_this_turn'; player?: Ref }
  /** Fists of Flame: "for each card you've drawn this turn" */
  | { kind: 'drawn_this_turn' }
  /** Thalisse, Reverent Medium: "the number of tokens you created this turn". */
  | { kind: 'tokens_created_this_turn' }
  /** Myr Battlesphere: "you may tap X untapped Myr you control" — how many were tapped. */
  | { kind: 'tapped_this_way' }
  /** "the number of cards discarded this way"; `max`: "the greatest number of cards a player discarded this way" (Windfall). */
  | { kind: 'discarded_this_way'; max?: true }
  /** "for each creature destroyed this way", "the number of cards exiled this way": what this resolution moved (CR 608.2h). */
  // Combustible Gearhulk: `stat` — "the total mana value of those cards" rather than how many.
  | { kind: 'moved_this_way'; how: 'destroyed' | 'exiled' | 'sacrificed' | 'milled' | 'graveyard' | 'returned'; types?: string[]; notTypes?: string[]; subtypes?: string[]; other?: true; token?: boolean; stat?: 'mana_value' }
  /** "You gain life equal to the damage dealt this way": what this resolution's damage effects dealt. */
  | { kind: 'damage_this_way' }
  /** CR 120.10: "the amount of excess damage dealt to that creature this way". */
  | { kind: 'excess_this_way' }
  /** "for each creature that died this turn", "the number of Zubera that died this turn" (as they last existed). */
  | { kind: 'died_this_turn'; types?: string[]; subtypes?: string[]; nontoken?: true; controller?: 'you' | 'opponent' }
  /** "the greatest power among creatures you control", "the greatest mana value among cards in your graveyard" (0 if none). */
  | { kind: 'greatest'; stat: 'power' | 'toughness' | 'mana_value'; filter: ObjectFilter }
  /** CR 702.23a (rampage): "for each creature blocking it beyond the first" — creatures blocking it, less `beyond`. */
  | { kind: 'blockers'; of: Ref; beyond?: number }
  /** "the total life lost this way" (extort, CR 702.101a). */
  | { kind: 'life_lost' }
  /**
   * This turn's life totals: Haliya's "you've gained 3 or more life this turn" (gained, the default); Neheb's "1 life your
   * opponents have lost this turn" (lost, summed); Spinerock Knoll's "an opponent was dealt 7 or more damage this turn"
   * (damage, the most any one opponent was dealt).
   */
  | { kind: 'life_this_turn'; who: 'you' | 'opponents' | 'an_opponent' | 'a_player'; stat?: 'gained' | 'lost' | 'damage'; player?: Ref }
  /** "for each opponent you attacked with a creature this combat" (melee, CR 702.121a). */
  | { kind: 'opponents_attacked' }
  /** "for each color of mana spent to cast it" (sunburst, converge, CR 702.44a). */
  | { kind: 'colors_spent' }
  /** "the sacrificed creature's power", "the discarded card's mana value" — as it was when the cost was paid. */
  | { kind: 'total_power'; filter: ObjectFilter; stat?: 'mana_value' | 'toughness' }
  | { kind: 'commander_colors' }
  | { kind: 'cost_lki'; cost: 'sacrificed' | 'discarded' | 'exiled'; stat: 'power' | 'toughness' | 'mana_value' }
  /** `half`: "half X, rounded down", "half their life, rounded up" — the count is halved, then scaled (times, plus). */
) & { times?: number; plus?: number; half?: 'up' | 'down' };

/**
 * Rules-meaningful restrictions and requirements carried by continuous effects.
 * Kept as flags so combat and casting can check them cheaply.
 */
export const RULE_FLAGS = [
  // Bender's Waterskin: "Untap this artifact during each other player's untap step."
  'untap_during_others',
  'cant_attack',
  'cant_block',
  /** CR 506.5: "can't attack alone", "can't block alone". */
  'cant_attack_alone',
  'cant_block_alone',
  'cant_be_blocked',
  'attacks_each_combat',
  /** CR 509.1c: "blocks each combat if able". */
  'blocks_each_combat',
  /** CR 510.1c: "You may have ~ assign its combat damage as though it weren't blocked." */
  'assign_as_unblocked',
  'cant_be_countered',
  'doesnt_untap',
  /** "can attack as though it didn't have defender" (CR 702.3b). */
  'can_attack_with_defender',
  /** "its activated abilities can't be activated" (CR 602.5). */
  'cant_activate',
  /** "… can't be activated unless they're mana abilities" (CR 602.5). */
  'cant_activate_nonmana',
  /** CR 502.3: "You may choose not to untap ~ during your untap step." */
  'may_not_untap',
  /** CR 510.1a: Doran — "assigns combat damage equal to its toughness rather than its power". */
  'damage_by_toughness',
  /** Port Razer: "can't attack a player it has already attacked this turn" (CR 508.1c). */
  'cant_attack_same_player',
] as const;
export type RuleFlag = (typeof RULE_FLAGS)[number];

// --- Core node shapes ---------------------------------------------------------

export interface AddManaEffect extends EffectNode {
  type: 'add_mana';
  /** Mirari's Wake: "one mana of any type that land produced". */
  produced?: true;
  /** "When that mana is spent to cast a creature spell …, scry 1." — a `mana_spent` triggered ability. */
  abilities?: AbilityNode[];
  /**
   * Alternatives the player picks from; each is a list of symbols, e.g. [["R"],["G"]] or [["C","C"]].
   * "chosen" stands for the color chosen as the source entered ("one mana of the chosen color").
   */
  options?: string[][];
  /** "Add N mana of any one color" style. */
  anyColor?: number;
  /** CR 903.4: "any color in your commander's color identity" — only those colors. */
  identity?: true;
  /** CR 106.7: "any color that a land an opponent controls could produce" / "any type that a land you control could produce". */
  couldProduce?: 'opponents' | 'you';
  /** With couldProduce: "any type" — colorless too. */
  anyType?: true;
  /** Mox Amber: "any color among legendary creatures and planeswalkers you control"; with `eachColor`, Bloom Tender's "For each color among permanents you control, add one mana of that color". */
  colorsAmong?: ObjectFilter;
  eachColor?: true;
  /** Chrome Mox: "one mana of any of the exiled card's colors" — cards exiled with the source (CR 607.2a). */
  exiledColors?: true;
  /** CR 106.6: "Spend this mana only to …" — what the mana can pay for. */
spend?: ManaSpend;
  /** Arena of Glory: "If any of that mana is spent on a creature spell, it gains haste until end of turn." (`eot`; for good without it) */
  spentHaste?: { filter: ObjectFilter; eot?: true };
  /** "Until end of turn, you don't lose this mana as steps and phases end." (CR 500.5); firebending's "until end of combat". */
  keep?: 'end_of_turn' | 'end_of_combat';
  /** "Add {G} for each Elf you control", "an amount of {G} equal to ~'s power": the option this many times. */
  times?: Amount;
  /**
   * Selvala: "Add X mana in any combination of colors, where X is the greatest power among creatures you control." — N mana,
   * each of any of `colors`. As a mana ability it's told the mix up front ("GGU"); on the stack, each mana is chosen in turn.
   */
  combination?: { amount: Amount; colors: string[] };
}

/** CR 106.6: what restricted mana can be spent on. */
export interface ManaSpend {
  /** Casting spells that match ("to cast creature spells"); {} for any spell. */
  spells?: ObjectFilter;
  /** Activating abilities of sources that match ("or activate abilities of artifacts"); {} for any. */
  abilities?: ObjectFilter;
  /** Special actions it can pay for: "unlock doors" (CR 709.5e), "turn a permanent face up" (CR 702.37e). */
  special?: ('unlock' | 'face_up')[];
  /** Cavern of Souls: "…, and that spell can't be countered." */
  uncounterable?: true;
}

/**
 * CR 603.2d: "If an artifact or creature entering causes a triggered ability of a permanent you control to trigger, that
 * ability triggers an additional time." (Panharmonicon); "If a triggered ability of a Shaman or another Wizard you
 * control triggers, …" (Harmonic Prodigy). With `none`: "Creatures entering don't cause abilities to trigger." (Torpor Orb)
 */
/**
 * CR 615.1a: a static prevention effect — "Prevent all combat damage that would be dealt to attacking creatures you
 * control." (Dolmen Gate), "… to you" (Glacial Chasm), "… to and dealt by this creature" (Fog Bank). Damage that
 * matches any of the listed recipients or sources is prevented.
 */
export interface StaticPreventionNode extends EffectNode {
  type: 'prevent_damage';
  /** Only combat damage, or only noncombat damage. */
  damage?: 'combat' | 'noncombat';
  toYou?: true;
  toSelf?: true;
  /** Permanents (matched with the source's controller as "you"). */
  to?: ObjectFilter;
  bySelf?: true;
  /** "during your turn" (CR 611.3a: checked continuously). */
  condition?: ConditionNode;
  /** Gisela: "prevent half that damage, rounded up" — not all of it. */
  half?: 'up';
}

export interface TriggerExtraNode extends EffectNode {
  type: 'trigger_extra';
  /** The event that must have caused it to trigger, and the object involved ("an artifact or creature entering"). */
  cause?: { event: 'enters' | 'leaves' | 'enters_or_leaves' | 'enters_or_dies' | 'dies' | 'attacks' | 'cast_copy' | 'draw' | 'gain_life' | 'combat_damage_player'; filter?: ObjectFilter };
  /** Whose triggered ability ("of a Shaman or another Wizard you control"), relative to this effect's source. */
  source?: ObjectFilter;
  /** "of equipped creature" */
  sourceAttached?: true;
  /** Only abilities of permanents ("of a permanent you control"). */
  permanent?: true;
  /** It doesn't trigger at all. */
  none?: true;
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
  /** "can't attack unless defending player controls an Island" (CR 508.1c) */
  attackOnlyIfDefenderControls?: ObjectFilter;
  /** CR 509.1a: "can block an additional creature each combat" (1); "can block any number of creatures" (99). */
  extraBlocks?: number;
  /** Shiny Impetus: "Enchanted creature … is goaded" — by the static ability's controller, while it applies (CR 701.15). */
  goaded?: true;
  /** Set by the engine: the object whose ability this is, for "~'s power" in the filters (Champion of Lambholt). */
  from?: string;
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
  /** Retrace (CR 702.81a): a permission to cast from the graveyard; the mana cost is still paid. */
  withManaCost?: true;
  /** Disturb (CR 702.146a): cast transformed — its back face is the spell. */
  transformed?: true;
  /** CR 702.174a (gift): "As an additional cost to cast this spell, you may choose an opponent." */
  chooseOpponent?: true;
  /** Overload (CR 702.96a): the spell as it reads with "target" changed to "each". */
  spell?: SpellAbility;
  /** Replicate, squad: "you may pay [cost] any number of times" (CR 702.56a, 702.157a). */
  repeatable?: true;
  /** Jump-start, flashback: exiled instead of going anywhere else as it leaves the stack (CR 702.133a, 702.34a). */
  exileOnLeave?: true;
  /** Miracle: only as a triggered ability resolves (CR 702.94a), never from the hand on its own. */
  duringResolution?: true;
  /** Emerge: the total cost is reduced by the sacrificed creature's mana value (CR 702.119a). */
  reduceBySacrificed?: true;
  /** Harmonize: reduced by the tapped creature's power (CR 702.180a). */
  reduceByTappedPower?: true;
  /** CR 702.160a / 718.3b: cast prototyped — the inset power and toughness (with this mana cost and its colors). */
  prototype?: { power: string; toughness: string };
  /** One of a list of additional costs ("sacrifice a creature or pay {3}"): exactly one of them is paid (CR 118.8). */
  required?: true;
  /** "You may cast this spell as though it had flash if you pay {2} more to cast it." — any time you could cast an instant. */
  flash?: true;
  /** Squee, the Immortal: "You may cast this card from your graveyard or from exile." — from exile too. */
  alsoExile?: true;
}

/** "As an additional cost to cast this spell, sacrifice a creature, discard a card, or pay 4 life." (CR 118.8, 601.2b) */
export interface AdditionalCostChoiceNode extends EffectNode {
  type: 'additional_cost_choice';
  options: Cost[];
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
  /** Ratadrabik: "it's a 2/2 black Zombie in addition to its other colors and types" — these colors as well. */
  addColors?: Color[];
  /** "it's 1/1" */
  power?: number;
  toughness?: number;
  /** Saw in Half: "their base power is half that creature's power and their base toughness is half that creature's toughness, rounded up" — as it last existed. */
  halfStats?: 'up';
  /** "it has haste" / "it has flying" */
  keywords?: KeywordInstance[];
  /** CR 707.9d: "it has no mana cost" */
  noManaCost?: true;
  /** "except it has this ability" — the ability doing the copying (the engine fills in `abilities`). */
  keepThisAbility?: true;
  abilities?: AbilityNode[];
  /**
   * Spark Double: "it enters with an additional +1/+1 counter on it if it's a creature" — not a copiable value but a
   * replacement effect as it enters (CR 614.1c), checked against what it copied.
   */
  entersWith?: { counter: string; amount: number; ifType?: string }[];
}

export interface ContinuousEffectNode extends EffectNode {
  type: 'continuous';
  affected: Ref;
  /** Shalai: "You, planeswalkers you control, and other creatures you control have hexproof." — its controller too. */
  alsoPlayer?: 'hexproof' | 'shroud';
  /** Wonder, Anger: "As long as this card is in your graveyard …" — it works only from its owner's graveyard. */
  fromGraveyard?: true;
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
  /** Layer 6: "Creatures your opponents control lose trample" — these keywords go (CR 613.1f). */
  loseKeywords?: string[];
  /** "… and can't have or gain hexproof" (Archetype of Endurance, Arcane Lighthouse): whatever would give it to them. */
  cantHave?: string[];
  /** Layer 4: "isn't a creature" (the Theros Gods) — card types it loses. */
  loseTypes?: string[];
  /** Layer 4: "is a Wizard in addition to its other types" (CR 205.1b). */
  /** Roaming Throne: "is the chosen type in addition to its other types" (`chosenType`). */
  /** Maskwood Nexus: `allCreatureTypes` — every creature type; `elsewhere` — creature spells you control and creature cards
   * you own that aren't on the battlefield too. */
  addTypes?: { types: string[]; subtypes: string[]; chosenType?: true; allCreatureTypes?: true; elsewhere?: true };
  /** Layer 4: "is a Frog creature" — types and subtypes it becomes, replacing its own (CR 205.1b). */
  setTypes?: { types: string[]; subtypes: string[] };
  /** Layer 4: "is a Bird" — its creature types become these (CR 205.1b). */
  creatureTypes?: string[];
  /** Layer 4: "Enchanted land is an Island" — CR 305.7: its land types become these, and it loses its rules-text abilities. */
  landTypes?: string[];
  /** Layer 5: "is blue", "is colorless" ([]). */
  colors?: Color[];
  /** Layer 5: "is a black Demon in addition to its other colors and types" — these colors as well. */
  addColors?: Color[];
  /** Layer 6: "loses all abilities" (CR 613.1f). */
  loseAbilities?: true;
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
  /** counter: "You may have ~ enter with an additional +1/+1 counter on it" (riot, unleash; `elseHaste` for riot). */
  /** read_ahead: "As this Saga enters, choose a number between one and this Saga's final chapter number" (CR 702.155b). */
  /** card_name: "As ~ enters, choose a nonland card name" (CR 201.3; `filter` says what kind of card). */
  /** card_type: "As ~ enters, choose artifact, creature, enchantment, instant, or sorcery" (`options`; all card types if absent). */
  /** player: "As ~ enters, choose a player" (`opponent`: "choose an opponent"). */
  /** discard_or_leave: Mox Diamond's "If ~ would enter, you may discard a land card instead. … If you don't, put it into its owner's graveyard." */
  /** sacrifice_or_leave: Lake of the Dead's "If this land would enter, sacrifice a Swamp instead. …" (`amount` of `filter`). */
  choice: 'pay_life' | 'reveal' | 'color' | 'creature_type' | 'copy' | 'counter' | 'devour' | 'read_ahead' | 'card_name' | 'card_type' | 'player' | 'discard_or_leave' | 'sacrifice_or_leave';
  opponent?: true;
  options?: string[];
  /** Banner of Kinship: "… enters with a fellowship counter on it for each creature you control of the chosen type." */
  thenCounters?: { counter: string; filter: ObjectFilter };
  elseHaste?: true;
  /** For copy: how the copy differs from the original (CR 707.9). */
  copyExcept?: CopyExcept;
  amount?: number;
  /** For reveal: the kind of card in hand. */
  filter?: ObjectFilter;
  /** "choose a color other than green" */
  except?: Color;
  /** "This land enters tapped. As it enters, choose a color." */
  tapped?: true;
  /** Vesuva: "You may have this land enter tapped as a copy of …" — tapped only if it copies. */
  copyTapped?: true;
  /** Cursed Mirror: "you may have it become a copy of any creature on the battlefield until end of turn". */
  copyUntil?: 'eot';
}

/**
 * CR 601.2f: cost increases and reductions. On a permanent: "Creature spells you cast cost {1} less
 * to cast." On the spell itself (`self`): "This spell costs {1} less to cast for each artifact you control."
 */
/**
 * CR 101.2: "Your opponents can't cast spells during your turn", "You can't cast creature spells", "Each player
 * can't cast more than one spell each turn", "Players can't cast spells from graveyards or libraries".
 * who: from the source's controller's point of view; enchanted_player: the player the Aura enchants;
 * enchanted_controller: the controller of what it enchants.
 */
export interface CastProhibitionNode extends EffectNode {
  type: 'cast_prohibition';
  who: 'you' | 'opponents' | 'each' | 'enchanted_player' | 'enchanted_controller';
  /** Only spells like this ("noncreature spells", "spells with mana value 3 or less"). */
  filter?: ObjectFilter;
  during?: 'your_turn' | 'combat';
  /** Only spells cast from these zones. */
  fromZones?: ('graveyard' | 'library' | 'exile' | 'command')[];
  /** "can't cast more than one spell each turn" */
  maxPerTurn?: number;
  /** Grand Abolisher: "… or activate abilities of artifacts, creatures, or enchantments" (mana abilities too, unless `nonMana`). */
  activate?: { filter?: ObjectFilter; nonMana?: true };
  /** Only activating is prohibited, not casting ("Players can't activate abilities that aren't mana abilities"). */
  activateOnly?: true;
  condition?: ConditionNode;
}

/**
 * CR 508.1g–h: a cost to attack — "Creatures can't attack you unless their controller pays {2} for each creature
 * they control that's attacking you" (Ghostly Prison, Propaganda). `cost` is paid for each such attacker.
 */
export interface AttackTaxNode extends EffectNode {
  type: 'attack_tax';
  cost: string;
  /** Sphere of Safety: "pays {X} for each of those creatures, where X is the number of enchantments you control". */
  x?: AmountExpr;
  /** "you or planeswalkers you control" */
  planeswalkers?: true;
  /** Only attackers like this ("Nonblack creatures"). */
  filter?: ObjectFilter;
  condition?: ConditionNode;
  /** Sandwurm Convergence: "Creatures with flying can't attack you or planeswalkers you control." — not at any price. */
  banned?: true;
}

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
  /** "This spell costs {2} less to cast if it targets a tapped creature" (CR 601.2f: targets come first). */
  ifTargets?: ObjectFilter;
  /** Emet-Selch: only spells cast from these zones ("from your graveyard"); `notFromHand`: "from anywhere other than your hand". */
  castFrom?: ('graveyard' | 'exile')[];
  notFromHand?: true;
  /** Conduit of Ruin: "The first creature spell you cast each turn costs {2} less to cast." */
  firstEachTurn?: true;
  /** Alisaie Leveilleur: "The second spell you cast each turn" (with `firstEachTurn`). */
  nthEachTurn?: number;
  /** Defense Grid: "except during its controller's turn". */
  exceptCastersTurn?: true;
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
  /** Dauthi Voidwalker: "instead exile it with a void counter on it". */
  withCounter?: string;
  /** The Darkness Crystal: "instead exile it and you gain 2 life". */
  gainLife?: number;
}

/**
 * CR 614.1a: replacement effects that change how much happens — "If you would gain life, you gain twice
 * that much life instead", token and counter doublers, "it deals double that damage instead".
 */
export interface QuantityReplacementNode extends EffectNode {
  type: 'replace_quantity';
  /** `mill`: The Water Crystal — "If an opponent would mill one or more cards, they mill that many cards plus four instead." */
  event: 'gain_life' | 'tokens' | 'counters' | 'damage' | 'mill' | 'lose_life' | 'proliferate';
  /** Bloodletter of Aclazotz: only during its controller's turn. */
  yourTurn?: true;
  /** 'extra' (tokens): "those tokens plus an additional Food token are created instead" (Peregrin Took, Xorn). */
  op: 'double' | 'triple' | 'plus' | 'extra';
  n?: number;
  /** op 'extra': the token made as well — one, or as many as the event made ("plus that many 1/1 Squirrels"). */
  extra?: { token: FaceDef; thatMany?: true };
  /** tokens: only when tokens of these subtypes / types are created ("If you would create one or more Treasure tokens"). */
  tokenFilter?: ObjectFilter;
  /** gain_life: who gains; tokens: under whose control; counters: who puts them (from the source controller's view). */
  who?: 'you' | 'opponents' | 'each';
  /** counters: what they're put on; damage: the source. */
  filter?: ObjectFilter;
  /** counters: which kind (any if absent). */
  counter?: string;
  /** damage: only to opponents and their permanents; only noncombat damage. */
  toOpponents?: true;
  /** Sawhorn Nemesis: "to the chosen player or a permanent they control" (chosen as the source entered). */
  toChosen?: true;
  noncombat?: true;
  /** The Sound of Drums, Mjölnir: damage the enchanted or equipped creature would deal; `combatOnly`: combat damage. */
  fromAttached?: true;
  combatOnly?: true;
}

/** Rules changes for players (CR 402.2, CR 305.2, CR 614.10): "You have no maximum hand size." */
/**
 * look_at_top: the player may look at their library's top card any time; top_revealed: everyone sees it;
 * hexproof / shroud: CR 702.11c / 702.18; cant_gain_life; no_lose_for_life: "You don't lose the game for
 * having 0 or less life"; cant_lose: "You can't lose the game"; flash: "You may cast spells as though they had flash";
 * extra_vote / may_extra_vote: "While voting, you get an additional vote" / "you may vote an additional time" (CR 701.38d).
 */
export const PLAYER_RULES = [
  'no_max_hand_size', 'extra_lands', 'lands_from_graveyard', 'skip_draw', 'look_at_top', 'top_revealed', 'hexproof', 'shroud', 'cant_gain_life',
  'no_lose_for_life', 'cant_lose', 'opponents_cant_win', 'flash', 'extra_vote', 'may_extra_vote', 'untap_during_others', 'protection_everything', 'life_cant_change',
  /** Omniscience: "You may cast spells from your hand without paying their mana costs." */
  'free_from_hand',
  /** Narset, Parter of Veils: "Each opponent can't draw more than one card each turn." (CR 121.2) */
  'max_one_draw',
  /** Thousand-Year Elixir: "You may activate abilities of creatures you control as though those creatures had haste." */
  'abilities_haste',
  /** Veil of Summer: "Spells you control can't be countered this turn" (an effect, optionally for some spells only). */
  'spells_uncounterable',
  /** Veil of Summer: "You … gain hexproof from blue and from black" — the effect's filter says which sources (CR 702.11d). */
  'hexproof_from',
  /** Teferi, Time Raveler: "Each opponent can cast spells only any time they could cast a sorcery." (CR 307.5) */
  'sorcery_timing',
  /** Trouble in Pairs: "If an opponent would begin an extra turn, that player skips that turn instead." (CR 614.10) */
  'skip_extra_turns',
  /** Aven Mindcensor: "If an opponent would search a library, that player searches the top four cards of that library instead." */
  'search_top_four',
  /**
   * CR 402.2: "Your maximum hand size is twenty" (max_hand_size: `amount` is the new maximum); "Each opponent's maximum
   * hand size is reduced by seven" (hand_size_delta: `amount` is added) — applied in timestamp order.
   */
  'max_hand_size', 'hand_size_delta',
  /** CR 704.5j: 'The "legend rule" doesn't apply to permanents you control' — for the permanents its `filter` names (all without one). */
  'no_legend_rule',
  /** CR 609.4b: "You may spend mana as though it were mana of any color" — to cast the spells its `filter` names (any payment without one). */
  'spend_any_color',
  /** CR 500.5: "You don't lose unspent red mana as steps and phases end" — mana of its `colors` (any, without them) stays. */
  'keep_mana',
  /** Birgi, God of Storytelling: "Creatures you control can boast twice during each of your turns rather than once." */
  'boast_twice',
] as const;
export type PlayerRule = (typeof PLAYER_RULES)[number];

export interface PlayerRuleNode extends EffectNode {
  type: 'player_rule';
  /** Who it applies to, from the point of view of the source's controller ('enchanted': the player an Aura enchants). */
  who: 'you' | 'each' | 'opponents' | 'enchanted';
  rule: PlayerRule;
  /** For extra_lands: how many more. */
  amount?: number;
  condition?: ConditionNode;
  /** flash: only for these spells ("You may cast Aura and Equipment spells as though they had flash"). */
  filter?: ObjectFilter;
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
    'add_mana', 'deal_damage', 'draw', 'gain_life', 'lose_life', 'set_life', 'exile_until', 'tap_choice', 'destroy', 'move', 'counter', 'tap', 'untap',
    'put_from_milled', 'grant_play', 'return_chosen', 'add_counters', 'modify', 'create_token', 'scry', 'surveil', 'mill', 'discard', 'regenerate', 'attach',
    'sacrifice', 'may', 'transform', 'monstrosity', 'may_pay', 'unless_pays', 'search', 'sacrifice_choice', 'if', 'may_do',
    'delayed', 'gain_control', 'exchange_control', 'exchange_life', 'exchange_life_stat', 'player_counters_lost', 'choose_object', 'exile_if_dies', 'prevent', 'explore', 'become_monarch', 'get_counters', 'skip_untap',
    'proliferate', 'connive', 'amass', 'exile_top', 'class_level', 'exile_on_leave', 'unless_does',
    'players_do', 'emblem', 'copy_spell', 'manifest', 'cast_free', 'play_free', 'play_exiled', 'cast_among_free', 'cast_copy_of', 'look_sort', 'name_and_dig', 'tainted_pact', 'repeat_may', 'hideaway', 'put_lki_counters', 'cascade', 'discover', 'suspend_tick', 'madness_cast',
    'remove_counters', 'choose_opponent', 'opponents_may', 'become_renowned', 'day_night', 'become_saddled', 'fight', 'move_chosen', 'choose_from_hand', 'bolster', 'reorder_top', 'dig', 'increase_speed', 'shuffle', 'populate', 'flip_coin', 'look_at_hand', 'tap_or_untap', 'extra_turn', 'choose_value', 'goad', 'game_result',
    'become_prepared', 'become_unprepared', 'shuffle_zones', 'extra_land', 'clash', 'piles', 'mana_trigger_this_turn', 'look_at_top', 'put_counters', 'ninjutsu', 'move_counters', 'myriad', 'encore', 'miracle_cast',
    'harness', 'ring_tempts', 'venture', 'take_initiative', 'reveal_until', 'give_gift', 'become_copy', 'extra_combat', 'phase_out', 'lock_untap', 'unlock', 'must_block', 'unattach', 'remove_from_combat', 'prevent_chosen_source', 'cant_block_attacker', 'untap_chosen', 'craft_return', 'damage_unpreventable', 'roll_die', 'vote', 'repeat', 'prohibit_casting', 'retarget', 'player_effect', 'choose_one', 'blight', 'forage', 'reflexive', 'next_spell', 'double_counters', 'swap_graveyard', 'sylvan_library', 'cast_from_hand', 'reveal_top', 'wheel', 'each_deals', 'keep_choose', 'turn_trigger', 'cast_paid', 'reanimate_attach', 'sacrifice_linked', 'delayed_leave', 'airbend', 'tempting_offer',
  ],
  conditions: [
    'greatest_power', 'kicked', 'cast_by_you', 'self_tapped', 'your_turn', 'count', 'life', 'hand', 'graveyard', 'this_turn', 'spells_last_turn',
    'counters', 'is', 'has_attached', 'monstrous', 'harnessed', 'and', 'opponents', 'monarch', 'class_level', 'paid', 'arrived_since_upkeep', 'renowned', 'day_night', 'saddled', 'max_speed', 'city_blessing', 'compare_stats', 'won_flip', 'before_attackers', 'step', 'prepared', 'won_clash', 'ring_bearer', 'chose_other_ring_bearer', 'completed_dungeon', 'initiative',
    'poison', 'different_powers', 'total_power', 'entered_this_turn', 'or', 'amount', 'combat_damage_by', 'discarded_this_turn', 'votes', 'opponent_has_more', 'attacked_with', 'was_type', 'not', 'early_turn', 'distinct_names', 'unique_name', 'greatest_mv', 'first_combat', 'cast_in_main_phase', 'lki_was', 'cast_named_before', 'same_name', 'ability_resolutions', 'attacking_you',
  ],
  statics: [
    'enters_tapped', 'enters_with_counters', 'continuous', 'additional_cost', 'additional_cost_choice', 'top_permission', 'graveyard_to_exile', 'player_rule', 'as_enters', 'deck_rule',
    'cost_modifier', 'replace_quantity', 'exile_instead', 'cast_option', 'resolve_to_hand', 'rebound', 'enters_day', 'as_enters', 'per_target_cost', 'enters_prepared', 'graveyard_to_library', 'exert_option', 'begin_on_battlefield', 'dungeon_entry', 'gift_spell', 'cast_restriction', 'cast_prohibition', 'attack_tax', 'enter_tapped_others', 'enter_counters_others', 'uncounterable', 'draw_replacement', 'trigger_extra', 'prevent_damage', 'token_one_of_each', 'grant_escape', 'grant_retrace', 'target_life_tax', 'ability_cost_reduction', 'mana_multiplier', 'combat_limit', 'spell_keyword', 'enter_untapped_others', 'unpreventable', 'search_control', 'search_exile', 'graveyard_cast',
  ],
  triggers: [
    'enters', 'dies', 'leaves', 'attacks', 'blocks', 'becomes_blocked', 'deals_combat_damage', 'phase', 'cast', 'gain_life', 'draw',
    'becomes_target', 'deals_damage', 'dealt_damage', 'player_dealt_damage', 'lose_life', 'chapter', 'becomes_level',
    'player_attacked', 'turned_face_up', 'last_counter_removed', 'day_night_changed', 'either', 'becomes_tapped', 'state', 'activate', 'exerted', 'clashed', 'put_into_graveyard',
    'you_attack', 'unblocked', 'combat_damage_batch', 'leave_graveyard', 'discard', 'scry', 'counters_put', 'sacrificed',
    'becomes_monstrous', 'ring_tempted', 'room', 'dungeon_completed', 'crime', 'expend', 'transforms', 'unlock_door', 'fully_unlocked', 'die_rolled', 'reflexive', 'mana_spent', 'tapped_for_mana', 'land_played', 'searched', 'counters_spell', 'proliferated', 'coin_flipped',
  ],
  costs: ['exert_self', 'sacrifice_self', 'pay_life', 'discard_self', 'sacrifice', 'discard', 'exile_self', 'pay_energy', 'crew', 'exile_cards', 'remove_counters_self', 'station', 'return_unblocked', 'tap_creatures', 'craft', 'collect_evidence', 'return_permanents', 'reveal_from_hand', 'behold', 'blight', 'forage', 'exile_self_hand', 'discard_hand', 'exile_self_battlefield', 'put_counters_self', 'mill', 'return_self', 'remove_counters'],
  /** Counted amounts (AmountExpr kinds). */
  amounts: ['count', 'cards', 'stat', 'life', 'counters', 'players', 'devotion', 'x', 'event', 'cast_before', 'commander_casts', 'kicks', 'party', 'life_lost', 'opponents_attacked', 'colors_spent', 'cost_lki', 'paid_times', 'domain', 'card_types', 'blockers', 'die_result', 'votes', 'greatest', 'discarded_this_way', 'spells_cast_this_turn', 'colors_among', 'commander_colors', 'total_power', 'moved_this_way', 'died_this_turn', 'damage_this_way', 'life_this_turn', 'excess_this_way', 'mana_spent', 'sum', 'drawn_this_turn', 'tokens_created_this_turn', 'tapped_this_way', 'counters_among', 'counters_removed'],
  /** Keyword abilities (CR 702) the engine applies. Others are recorded but resolved by players. */
  keywords: [
    'flying', 'first_strike', 'double_strike', 'deathtouch', 'defender', 'flash', 'haste', 'hexproof', 'hexproof_from',
    'indestructible', 'lifelink', 'menace', 'reach', 'trample', 'vigilance', 'fear', 'intimidate', 'shroud', 'skulk',
    'horsemanship', 'protection', 'landwalk', 'infect', 'wither', 'toxic', 'shadow', 'enchant', 'devoid', 'changeling',
    'flashback', 'convoke', 'delve', 'improvise', 'morph', 'megamorph', 'disguise', 'foretell', 'plot', 'suspend', 'madness', 'split_second', 'daybound', 'nightbound', 'start_your_engines', 'ascend', 'sunburst',
    // Deck-construction rules only (CR 702.124, 702.124h–k): nothing to do during a game.
    'partner', 'friends_forever', 'choose_a_background', 'doctor_s_companion',
    'kicker', 'multikicker', 'partner_with',
    // CR 702.132a: assist lets another player help pay — never required, so casting without it is always legal.
    'assist',
    // CR 702.127a: aftermath halves are cast from the graveyard (in the engine's casting rules).
    'aftermath',
    // CR 702.103: cast bestowed as an Aura (in the engine's casting and state-based rules).
    'bestow',
    // CR 702.190: cast during your declare blockers step by returning an unblocked attacker.
    'sneak',
    // CR 702.89a (umbra armor, formerly totem armor): a destruction replacement, in the engine's destroy.
    'umbra_armor', 'totem_armor',
    // CR 702.94a (miracle), 702.119a (emerge), 702.154a (enlist): in the engine's drawing, casting and attacking rules.
    'miracle', 'emerge', 'enlist', 'phasing',
    // CR 702.155: read ahead, in the engine's Saga rules; CR 702.52: dredge, in its drawing rules.
    'read_ahead', 'dredge',
    // CR 702.180: harmonize, in the engine's casting rules (castOptions); CR 702.120: escalate, in its costs.
    'harmonize', 'escalate',
    // CR 702.47: splice, in the engine's casting rules.
    'splice',
    // CR 702.102: fuse — both halves of a split card cast from the hand (castOptionsFor).
    'fuse',
  ],
} as const;

/** Whether the engine applies this keyword instance (some need a parameter it understands). */
export function keywordSupported(kw: KeywordInstance): boolean {
  // Defined by abilities the compiler read from the CR (prowess, cycling, equip…).
  if (kw.abilities?.length) return true;
  if (!(CORE_NODES.keywords as readonly string[]).includes(kw.id)) return false;
  // CR 702.124j: partner with's deck rule needs nothing, but its trigger must have compiled.
  if (kw.id === 'partner_with') return false;
  // Enchant with a quality the compiler could read; flashback with a mana cost.
  if (kw.id === 'enchant') return Boolean(kw.filter || kw.player);
  // CR 702.16a / 702.11d: protection and hexproof from qualities the engine can tell apart.
  if (kw.id === 'protection' || kw.id === 'hexproof_from') return Boolean(kw.text && qualitiesRead(kw.text));
  if (kw.id === 'flashback' && kw.costIsManaCost) return true;
  if (['flashback', 'kicker', 'multikicker', 'morph', 'megamorph', 'disguise', 'foretell', 'plot', 'madness', 'bestow', 'sneak', 'miracle', 'emerge', 'harmonize', 'escalate', 'splice'].includes(kw.id)) return Boolean(kw.cost && /^(\{[^}]+\})+$/.test(kw.cost));
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
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const kind = (v as { kind?: unknown }).kind;
      // An ability in a field (overload's spell) isn't an amount; its nodes are walked by nested().
      if (typeof kind === 'string' && !['spell', 'activated', 'triggered', 'static'].includes(kind)) out.amounts.push(kind);
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
    const inner = [...((e.abilities as AbilityNode[] | undefined) ?? []), ...(token?.abilities ?? []), ...kws.flatMap((k) => k.abilities ?? []), ...(e.spell ? [e.spell as AbilityNode] : [])];
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
      for (const key of ['effects', 'then', 'else', 'action', 'theirs', 'mine']) if (Array.isArray(e[key])) visit(e[key] as EffectNode[]);
      if (e.cond) cond(e.cond as ConditionNode);
    }
  };
  if (a.kind === 'triggered' && a.condition) cond(a.condition);
  // "Whenever ~ attacks while …": a condition of the trigger itself.
  if (a.kind === 'triggered' && a.trigger.while) cond(a.trigger.while as ConditionNode);
  if (a.gate) cond(a.gate);
  if (a.kind === 'activated' && a.activateIf) cond(a.activateIf);
  if (a.kind === 'static') {
    out.statics.push(a.effect.type);
    amounts(a.effect);
    if (a.effect.condition) cond(a.effect.condition as ConditionNode);
    if (a.effect.unless) cond(a.effect.unless as ConditionNode);
    if (a.effect.type === 'additional_cost') out.costs.push((a.effect.cost as EffectNode).type);
    if (a.effect.type === 'additional_cost_choice') for (const c of a.effect.options as Cost[]) out.costs.push(...(c.other ?? []).map((x) => x.type));
    nested(a.effect);
  }
  else {
    visit(a.effects);
    for (const m of a.modes?.options ?? []) visit(m.effects);
    if (a.kind === 'triggered') out.triggers.push(a.trigger.type, ...(((a.trigger.of as TriggerNode[] | undefined) ?? []).map((t) => t.type)));
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
