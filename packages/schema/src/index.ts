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
  /** `untargetable` (Shanna, Sisay's Legacy; Dense Foliage): only by spells, or only by abilities; only those "your
   * opponents control"; `filter`: only from such sources ("red spells or abilities from red sources"). */
  by?: 'spells' | 'abilities';
  opponents?: true;
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
  bonus?: { condition: ConditionNode; max: number; /** Pyrrhic Strike, teamwork: "choose both instead" — not "may". */ exact?: true };
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
  /** Lair of the Hydra: "X can't be 0." — the least X it can be activated with. */
  xMin?: number;
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
  costReduction?: { amount: number; per?: AmountExpr; condition?: ConditionNode; yourTurn?: true; /** Loreseeker's Stone: "costs {1} more". */ more?: true; /** Kami of Jealous Thirst: "costs {4}{B} less" — colored mana too. */ mana?: string };
  /** "Activate no more than twice each turn." */
  maxPerTurn?: number;
  /** CR 702.142a: a boast ability (Birgi's "boast twice" raises its limit). */
  boast?: true;
  /** CR 602.2: "Any player may activate this ability." */
  anyPlayer?: true;
  /** Where it can be activated from, when not the battlefield (cycling: the hand, CR 702.29a; commander ninjutsu: the command zone, CR 702.49d). */
  zone?: 'hand' | 'graveyard' | 'command';
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
   * "When you cast this spell" works on the stack (storm, CR 702.40a). 'command': eminence — from the command zone and the
   * battlefield both ("if Edgar is in the command zone or on the battlefield").
   */
  zone?: 'graveyard' | 'stack' | 'command';
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
  /** The Lord of Pain: "Whenever a player casts …, choose another target player" — not the player the trigger is about. */
  notTriggerPlayer?: true;
  /** Needle Drop: "any target that was dealt damage this turn" — a player too. */
  damagedThisTurn?: true;
  /** How many; 1 unless stated. */
  count?: number;
  /** "Exile X target creatures": as many as the X announced (CR 601.2b–c). `count` is then ignored. */
  countX?: true;
  /** Rot Hulk: "up to X target Zombie cards …, where X is the number of opponents you have" — counted as targets are chosen. */
  countAmount?: AmountExpr;
  /** Comet Storm: "then choose another target for each time this spell was kicked" — `count` plus the kicks. */
  plusKicks?: true;
  /** CR 115.6: "up to N" allows fewer, including zero. */
  upTo?: true;
  /** "one, two, or three targets": at least this many. */
  min?: number;
  /** "up to two target cards from a single graveyard": all of them with the same owner. */
  sameOwner?: true;
  /** Agadeem's Awakening: "any number of target creature cards that each have a different mana value". */
  distinctManaValues?: true;
  /** Flames of Rebirth: "any number of target creature cards with total mana value 6 or less" (X: the X announced). */
  maxTotalMV?: number | 'X';
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
  /**
   * Its combat with the source: Knight of Dusk's "creature blocking this creature" ('blocking'), Goblin Snowman's "creature
   * it's blocking" ('blocked'), "creature blocking or blocked by this creature" ('either').
   */
  combatWithSource?: 'blocking' | 'blocked' | 'either';
  /**
   * Maelstrom Nexus: "The first spell you cast each turn" — a spell that's the first its controller cast this turn
   * (Wild-Magic Sorcerer: `fromZone` 'exile', the first they cast from exile).
   */
  firstCastThisTurn?: { fromZone?: 'exile' | 'hand' | 'graveyard' };
  /** Patriarch's Bidding: "creature cards of a type chosen this way" (the types chosen as this resolves). */
  subtypesChosenThisWay?: true;
  /** Talion, the Kindly Lord: "a spell with mana value, power, or toughness equal to the chosen number" (the source's). */
  statIsChosenNumber?: true;
  /** Drown in the Loch: "with mana value less than or equal to the number of cards in its controller's graveyard" — each object's own. */
  manaValueAtMostControllersGraveyard?: true;
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
  /** Fight to the Death: "blocked creatures"; "unblocked creatures" — attacking creatures, blocked or not (CR 509.1h). */
  blockedState?: 'blocked' | 'unblocked';
  /** CR 506.5: "attacking alone" — the only attacking creature. */
  attackingAlone?: true;
  /** Sting, the Glinting Dagger: "blocking or blocked by a Goblin or Orc" — a creature it blocks or that blocks it matches. */
  combatPartner?: ObjectFilter;
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
  /** CR 708.2: "a face-down creature you control" (as it last existed, looking back). */
  faceDown?: boolean;
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
  /** The player who owns it (ownedBy, bound as a target is checked). */
  ownerPlayer?: string;
  /** The player who controls it (controlledBy, bound as a target is checked). */
  controllerPlayer?: string;
  /** Edgewall Innkeeper: "a creature spell that has an Adventure" (CR 715). */
  hasAdventure?: true;
  /** Cut Down: "with total power and toughness 5 or less". */
  totalPT?: { op: 'le' | 'ge'; n: number };
  /** "creatures that aren't of the chosen type" (Kindred Dominance). */
  notChosenType?: true;
  /** "Aura attached to it": attached to the source (self) or to what the source is attached to (attached). */
  attachedTo?: 'self' | 'attached' | 'affected';
  /** The object `attachedTo: 'affected'` stands for, bound as a static ability's amount is counted for it. */
  attachedToObject?: { id: string; zcc: number };
  /** Sage's Reverie: "each Aura you control that's attached to a creature". */
  attachedToType?: string;
  /** CR 903.3: a commander. */
  commander?: boolean;
  /** Shaile, Dean of Radiance: it entered the battlefield under your control this turn. */
  enteredUnderYou?: true;
  /** Prehistoric Pet: "creatures with greater power" — than the source (the attacking creature, as blocks are checked). */
  powerAboveSource?: true;
  /** "with a +1/+1 counter on it" — a counter of this kind ('any': "with a counter on it"). */
  counter?: string;
  /** Wave Goodbye: "without a +1/+1 counter on it" ('any': "without counters on it"). */
  notCounter?: string;
  /** "~ or another Ally you control": the source itself matches too, whatever else it is. */
  orSource?: true;
  /** "a card named Pir, Imaginative Rascal" */
  name?: string;
  /** Tiamat: "Dragon cards not named Tiamat". */
  notName?: string;
  /** Urza's Saga: "an artifact card with mana cost {0} or {1}" — its printed mana cost is one of these (CR 202.1). */
  manaCostIs?: string[];
  /** "creature that was dealt damage this turn" */
  damagedThisTurn?: true;
  /** Any one of these ("creature or Vehicle"). */
  anyOf?: ObjectFilter[];
  /** "… except for tokens you control": what's left out. */
  except?: ObjectFilter;
  /** Power Artifact: "enchanted artifact's activated abilities" — the permanent the source is attached to. */
  sourceAttachedTo?: true;
  /** "of the chosen type" / "of the chosen color": what was chosen as the source entered (CR 614.12). */
  chosenType?: true;
  chosenColor?: true;
  /** "with the chosen name": the name chosen as the source entered (CR 201.3). */
  chosenName?: true;
  /** Path of Ancestry: "a creature spell that shares a creature type with your commander". */
  sharesTypeWithCommander?: true;
  /** Braids, Arisen Nightmare: "a permanent … that shares a card type with" what was sacrificed earlier this resolution. */
  sharesCardTypeWithSacrificed?: true;
  /** Semblance Anvil: "that share a card type with the exiled card" — a card this object exiled (CR 607.2a). */
  sharesCardTypeWithExiled?: true;
  /** Shared Animosity: "that shares a creature type with it" (CR 205.3m) — it being this object. */
  sharesCreatureTypeWith?: Ref;
  /** Mirror Box: "with the same name as that creature" — the name it has (CR 201.2); `sameName` is set by the engine. */
  sameNameAs?: Ref;
  sameName?: string;
  /** Tibalt's Trickery: "a nonland card with a different name than that spell" — `differentName` is set by the engine. */
  differentNameAs?: Ref;
  differentName?: string;
  /** "each other attacking creature that shares a creature type with it": other than it, not other than the source. */
  otherThan?: Ref;
  /** Set by the engine as an effect applies: the creature types `sharesCreatureTypeWith` stands for, and `otherThan`'s id. */
  sharesCreatureTypes?: string[];
  notObject?: string;
  /** "a creature dealt damage by ~ this turn" */
  damagedBySource?: true;
  /** Vengeful Ancestor: "a goaded creature" (CR 701.15). */
  goaded?: true;
  /** Trailblazer's Torch: `combatWithSource` is about what the source is attached to ("each creature blocking it"). */
  combatWithAttached?: true;
  /** Brought Back: a card in a graveyard "that was put there from the battlefield this turn" (or from a library, or anywhere). */
  putThereThisTurn?: 'battlefield' | 'library' | 'anywhere';
  /** Nelly Borca: "all suspected creatures" (true); "if it's not suspected" (false) (CR 701.60). */
  suspected?: boolean;
  /** Relentless Assault: it was declared as an attacker this turn (as this object, CR 400.7). */
  attackedThisTurn?: true;
  /** Wildsear, Scouring Maw: "Enchantment spells you cast from your hand" — a spell cast from that zone. */
  castFromZone?: 'hand' | 'exile' | 'graveyard';
  /** Blastfire Bolt: "all Equipment attached to that creature" — attached to what the reference names (bound as it applies). */
  attachedToRef?: Ref;
  /** Witchbane Orb: "all Curses attached to you"; Curse of Thirst: "… attached to them" — attached to that player (bound to
   * `attachedToPlayerId` as it applies). */
  attachedToPlayerRef?: Ref;
  attachedToPlayerId?: string;
  /** Wash Away: "target spell that wasn't cast from its owner's hand" — a copy, or one cast from anywhere else. */
  notCastFromHand?: true;
  /** Within Range: "creatures attacking them" — that player (bound to `attackingPlayer` as it's counted). */
  attackingPlayerRef?: Ref;
  attackingPlayer?: string;
  /** Domri, Anarch of Bolas: "Creature spells you cast" — not a copy of a spell (CR 707.10). */
  notCopy?: true;
  /** Avenging Arrow: "that dealt damage this turn" */
  dealtDamageThisTurn?: true;
  /** Steel Hellkite: its controller was dealt combat damage by the source this turn. */
  controllerHitBySource?: true;
  /** Oran-Rief: "each green creature that entered this turn" */
  enteredThisTurn?: boolean;
  /** Eriette of the Charmed Apple: "enchanted by an Aura you control". */
  enchantedByYou?: true;
  /** Spear of Heliod: "that dealt damage to you this turn" ('combat': "that dealt combat damage to you this turn"). */
  dealtDamageToYou?: true | 'combat';
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
  /** Willbreaker: "Whenever a creature an opponent controls becomes the target of …, gain control of that creature" — the
   * permanent that became a target (the trigger's object is the spell or ability). */
  | { ref: 'trigger_targeted' }
  /** What the source Aura or Equipment is attached to. */
  | { ref: 'attached' }
  /** CR 702.95: soulbond's "each of those creatures" — the source and the creature it's paired with (none if unpaired). */
  | { ref: 'pair' }
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
  | { ref: 'players'; who: 'each' | 'opponents'; attacking?: Ref; except?: Ref; lostLife?: true; controlsNone?: ObjectFilter; opponentsOf?: Ref; discardedNone?: true; /** Feed the Infection: "each opponent who has three or more poison counters". */ poisonAtLeast?: number; /** Depopulate: "each player who controls a multicolored creature". */ controlsSome?: ObjectFilter; /** Gor Muldrak: "each player who controls the fewest creatures" (ties all count). */ controlsMost?: { filter: ObjectFilter; fewest?: true } }
  | { ref: 'controller_of'; of: Ref }
  /** Blightning, Bonfire of the Damned: "that player or that planeswalker's controller" — a target player, or the controller of a
   * target permanent. */
  | { ref: 'player_or_controller'; of: Ref }
  /** Raid Bombardment: "the player or planeswalker that creature is attacking" (a damage recipient). */
  | { ref: 'attacked_by'; of: Ref }
  | { ref: 'owner_of'; of: Ref }
  /** CR 607.2a: "the exiled card", "cards exiled with ~" — what this object's linked ability exiled. */
  | { ref: 'exiled_with' }
  /** CR 303.4: "enchanted player" — the player an Aura is attached to. */
  | { ref: 'enchanted_player' }
  /** Souls of the Faultless: "attacking player" — the player whose turn it is, who attacked (CR 506.2). */
  | { ref: 'active_player' }
  /** "the token", "those tokens": what the effect just created. */
  | { ref: 'created' }
  /** Spectacular Showdown: "each creature that had a double strike counter put on it this way" (`counter`: of that kind). */
  | { ref: 'countered_this_way'; counter?: string }
  /** "Return all creature cards from your graveyard to the battlefield. They gain haste …" — the permanents they became. */
  | { ref: 'moved_onto' }
  /** CR 701.38: "each permanent with the most votes or tied for most votes". */
  | { ref: 'voted' }
  /** "Target player sacrifices a creature. You gain life equal to that creature's toughness." — what this effect sacrificed. */
  | { ref: 'sacrificed_this_way' }
  /** Starfall Invocation: "a creature card put into your graveyard this way" — what this resolution put into a graveyard. */
  | { ref: 'graveyard_this_way' }
  /** Tablet of Discovery: "mill a card. You may play that card this turn." — the card this resolution milled. */
  | { ref: 'milled_this_way' }
  /** "that card's mana value" after "discards a card" — only its characteristics as it was discarded (cost_lki). */
  | { ref: 'discarded_this_way' }
  /** CR 614.12: "the chosen player" — the player chosen as the source entered ("As ~ enters, choose a player"). */
  | { ref: 'chosen_player' }
  // Baleful Mastery: "an opponent draws a card" — the opponent this resolution chose (choose_opponent).
  | { ref: 'chosen_opponent' }
  /** "Put a +1/+1 counter on a creature you control. It gains …" — the object that effect chose. */
  | { ref: 'chosen_object' }
  /** CR 702.51c: "each creature that convoked this spell" — the creatures tapped to cast it (Lethal Scheme). */
  | { ref: 'convoked' };

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
  | { kind: 'count'; filter: ObjectFilter; most?: true; /** Investigator's Journal: "the greatest number of creatures a player controls" — you too. */ anyPlayer?: true }
  /** Maester Seymour, Lux Artillery: "the number of counters among creatures you control" — every counter on them. */
  | { kind: 'counters_among'; filter: ObjectFilter; /** Toph: only counters of this kind. */ counter?: string }
  // Coalition Relic: "for each charge counter removed this way" — by this resolution's remove-counters effects.
  | { kind: 'counters_removed' }
  /** CR 702.179a: "your speed" (0 before you have any). */
  | { kind: 'speed' }
  /** CR 705.2: the coin flips won (`lost`: lost) as this resolves — Ral Zarek's "for each coin that comes up heads". */
  | { kind: 'flips_won'; lost?: true }
  /** Moraug: "for each time it has attacked this turn" (CR 508.1: each time it's declared as an attacker). */
  | { kind: 'attacks_this_turn'; of: Ref }
  /** Cards in hands, graveyards or libraries. */
  /** `player`: "in target opponent's hand" — that player's cards (`who` is then ignored). */
  /** `least`: the fewest any one of those players has (Shelldock Isle: "a library has twenty or fewer cards in it"). */
  | { kind: 'cards'; zone: 'hand' | 'graveyard' | 'library' | 'exile'; who: 'you' | 'opponents' | 'each'; filter?: ObjectFilter; player?: Ref; least?: true }
  /** An object's power, toughness or mana value (last known if it left, CR 608.2h). */
  | { kind: 'stat'; stat: 'power' | 'toughness' | 'mana_value' | 'colors'; of: Ref }
  /** "the amount of mana spent to cast that spell" (CR 601.2h). */
  | { kind: 'mana_spent'; of: Ref }
  /** Ancient Imperiosaur: "for each creature that convoked it" (CR 702.51c). */
  | { kind: 'convoked'; of: Ref }
  /** Plumb the Forbidden: "for each creature sacrificed this way" — as the spell was cast. */
  | { kind: 'sacrificed_to_cast'; of: Ref }
  /** Multani: "for each land you control and each land card in your graveyard" — counts added together. */
  | { kind: 'sum'; parts: AmountExpr[] }
  /** CR 106.4: Omnath, Locus of Mana: "for each unspent green mana you have" (any color, if absent). */
  | { kind: 'unspent_mana'; color?: string }
  /** "A or B, whichever is greater" (Prophet of the Scarab). */
  | { kind: 'max'; parts: AmountExpr[] }
  /** `most`: Sorin, Grim Nemesis — "the highest life total among all players" (the greatest of theirs). */
  | { kind: 'life'; who: Ref; most?: true }
  | { kind: 'counters'; of: Ref; counter?: string }
  /** Players: "for each opponent". */
  /**
   * `lostLife`: "for each opponent who lost life this turn" (Teysa, Opulent Oligarch); Smuggler's Share: `drew`, "who drew
   * two or more cards this turn"; `landsEntered`, "who had two or more lands enter the battlefield under their control".
   */
  /** `drewThisWay`: Cut a Deal's "for each opponent who drew a card this way". */
  | { kind: 'players'; who: 'opponents' | 'each'; /** Rampant Frogantua: players who have lost the game. */ lostGame?: true; lostLife?: true; drew?: number; landsEntered?: number; drewThisWay?: true; combatDamaged?: true; /** Gnoll War Band: "each opponent who was dealt damage this turn". */ damaged?: true; discardedNone?: true; handAtMost?: number; handAtLeast?: number; handMoreThanYou?: true; controlsMore?: ObjectFilter; /** Voice of Many: "each opponent who controls fewer creatures than you". */ controlsFewer?: ObjectFilter }
  /** CR 700.5: devotion to one or more colors. */
  /** `manaColor`: Nykthos — "your devotion to that color", the color of the mana being added. */
  | { kind: 'devotion'; colors: Color[]; manaColor?: true }
  /** X as paid (CR 107.3m), when it needs scaling ("-X/-X"). */
  /** Shatterskull Smashing: "If X is 6 or more, … twice X … instead" (`doubledAtLeast`: 6). */
  | { kind: 'x'; doubledAtLeast?: number }
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
  | { kind: 'domain'; /** Allied Strategies: "among lands they control" — that player's. */ player?: Ref }
  /** Delirium: the number of card types among cards in your graveyard. */
  // Tarmogoyf: `whose` — all graveyards, or the opponents'; yours without it.
  | { kind: 'card_types'; whose?: 'all' | 'opponents'; discardedThisWay?: true }
  /** Hobgoblin Bandit Lord: "the number of Goblins that entered the battlefield under your control this turn". */
  | { kind: 'entered_this_turn'; filter: ObjectFilter }
  /** CR 706.2: "equal to the result" — the result of the die roll this resolution made. */
  | { kind: 'die_result' }
  /** CR 701.38: "for each death vote" — votes for that option as this resolves. */
  | { kind: 'votes'; option: string }
  /** Faeburrow Elder: "for each color among permanents you control". */
  | { kind: 'colors_among'; filter: ObjectFilter }
  /** Valiant Changeling: "for each creature type among creatures you control" (CR 205.3m; changeling: all of them). */
  | { kind: 'creature_types_among'; filter: ObjectFilter }
  /** Aetherflux Reservoir: "for each spell you've cast this turn". */
  /** Rug of Smothering: `player` — that player's spells ("each spell they've cast this turn"). */
  /** Hit the Mother Lode: N minus the discovered card's mana value (0 if none, or if it's N or more). */
  | { kind: 'discover_shortfall'; n: number }
  | { kind: 'source_damage_this_turn' }
  /** Change of Fortune: "for each card you've discarded this turn". */
  | { kind: 'discarded_this_turn'; /** Dream Salvage: "the number of cards target opponent discarded this turn". */ player?: Ref }
  /** All-Fates Scroll: "the number of differently named lands you control". */
  | { kind: 'distinct_names'; filter: ObjectFilter }
  /** Fraying Sanity: "the number of cards put into their graveyard from anywhere this turn". */
  | { kind: 'to_graveyard_this_turn'; player: Ref }
  | { kind: 'spells_cast_this_turn'; player?: Ref; /** Call Forth the Tempest: their total mana value (`other`: but this spell's). */ totalMv?: true; other?: true; filter?: ObjectFilter; /** Thrasta: "each other spell cast this turn" — by anyone. */ anyone?: true; /** Delightful Discovery: "each spell your opponents have cast this turn". */ opponents?: true }
  /** Rowdy Research: "for each creature that attacked this turn" — anyone's (`mine`: "you attacked with"). */
  | { kind: 'attackers_this_turn'; mine?: true }
  /** The Balrog, Durin's Bane: "for each permanent sacrificed this turn" — by anyone. */
  | { kind: 'sacrificed_this_turn'; types?: string[]; /** Sawblade Skinripper: "the permanents you sacrificed this turn". */ mine?: true }
  /** Eris, Roar of the Storm: "for each different mana value among instant and sorcery cards in your graveyard". */
  | { kind: 'distinct_mana_values'; filter: ObjectFilter }
  /** Golden Ratio: "for each different power among creatures you control" (on the battlefield). */
  | { kind: 'distinct_powers'; filter: ObjectFilter }
  /** Littjara Kinseekers: "three or more creatures that share a creature type" — the most of them with one type in common. */
  | { kind: 'most_sharing_type'; filter: ObjectFilter }
  /** Fists of Flame: "for each card you've drawn this turn" */
  | { kind: 'drawn_this_turn'; who?: 'opponents'; /** Thought Sponge: the most any one of them drew. */ max?: true }
  /** Bronze Cudgels: "the number of times this ability has resolved this turn" (this time included). */
  | { kind: 'ability_resolutions' }
  /** Ancient Excavation: "for each card drawn this way" — what this resolution drew for you. */
  /** The cards this resolution made anyone draw (Communal Brewing: each other player who drew; Laquatus's Creativity). */
  | { kind: 'drawn_this_way' }
  /** Thalisse, Reverent Medium: "the number of tokens you created this turn". */
  | { kind: 'tokens_created_this_turn' }
  /** Myr Battlesphere: "you may tap X untapped Myr you control" — how many were tapped. */
  | { kind: 'tapped_this_way' }
  /** "the number of cards discarded this way"; `max`: "the greatest number of cards a player discarded this way" (Windfall). */
  | { kind: 'discarded_this_way'; max?: true; filter?: ObjectFilter; /** Fanatic of the Harrowing: "If you discarded a card this way" — yours only. */ mine?: true }
  /** "for each creature destroyed this way", "the number of cards exiled this way": what this resolution moved (CR 608.2h). */
  // Combustible Gearhulk: `stat` — "the total mana value of those cards" rather than how many.
  | { kind: 'moved_this_way'; how: 'destroyed' | 'exiled' | 'sacrificed' | 'milled' | 'graveyard' | 'returned' | 'discarded' | 'library' | /** Chrome Courier: "put … into your hand this way" — from anywhere but the battlefield. */ 'hand'; types?: string[]; notTypes?: string[]; subtypes?: string[]; other?: true; token?: boolean; stat?: 'mana_value' | 'power' | 'toughness'; yours?: true; /** Deadly Tempest: what that player controlled. */ controlledBy?: Ref }
  /** "You gain life equal to the damage dealt this way": what this resolution's damage effects dealt. */
  | { kind: 'damage_this_way' }
  /** CR 120.10: "the amount of excess damage dealt to that creature this way". */
  | { kind: 'excess_this_way' }
  /** "for each creature that died this turn", "the number of Zubera that died this turn" (as they last existed). */
  | { kind: 'died_this_turn'; types?: string[]; subtypes?: string[]; notSubtypes?: string[]; nontoken?: true; controller?: 'you' | 'opponent'; /** Caller of the Claw: "put into your graveyard from the battlefield" — owned by you. */ owner?: 'you' }
  | { kind: 'left_this_turn'; types?: string[]; controller?: 'you' | 'opponent' }
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
  | { kind: 'life_this_turn'; who: 'you' | 'opponents' | 'an_opponent' | 'a_player'; stat?: 'gained' | 'lost' | 'damage' | 'noncombat_damage'; player?: Ref }
  /** "for each opponent you attacked with a creature this combat" (melee, CR 702.121a). */
  | { kind: 'opponents_attacked'; thisTurn?: true }
  /** "for each color of mana spent to cast it" (sunburst, converge, CR 702.44a). */
  | { kind: 'colors_spent' }
  /** "the sacrificed creature's power", "the discarded card's mana value" — as it was when the cost was paid. */
  | { kind: 'total_power'; filter: ObjectFilter; stat?: 'mana_value' | 'toughness' }
  | { kind: 'commander_colors' }
  | { kind: 'cost_lki'; cost: 'sacrificed' | 'discarded' | 'exiled'; stat: 'power' | 'toughness' | 'mana_value' }
  /** `half`: "half X, rounded down", "half their life, rounded up" — the count is halved, then scaled (times, plus). */
) & { times?: number; plus?: number; half?: 'up' | 'down'; /** "a third of their life, rounded up" — `half` divides by this instead. */ divisor?: 3; /** Valiant Changeling: "This effect can't reduce the amount of mana this spell costs by more than {5}." */ atMost?: number };

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
  /** Banefire: "the damage can't be prevented" — the spell's own damage, while it's on the stack (CR 615.12). */
  'damage_unpreventable',
  /** Ancient Adamantoise: "Damage isn't removed from this creature during cleanup steps." (CR 514.2) */
  'damage_not_removed',
  // Airtight Alibi: "can't become suspected" (CR 701.60).
  'cant_be_suspected',
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
  /** Teferi, Master of Time: "You may activate loyalty abilities of Teferi on any player's turn any time you could cast an
   * instant." (CR 606.3: an effect may change when.) */
  'loyalty_instant',
  /** Pilot tokens: "This token saddles Mounts and crews Vehicles as though its power were 2 greater." (CR 702.122a, 702.171a) */
  'crews_plus_2',
  /** Incinerate: "A creature dealt damage this way can't be regenerated this turn." (CR 701.19c) */
  'cant_be_regenerated',
  /** Ophidian: "this creature assigns no combat damage this turn" (CR 510.1). */
  'assigns_no_combat_damage',
  /** Melira's Keepers: "This creature can't have counters put on it."; Melira: "… -1/-1 counters …"; Blightbeetle: "… +1/+1 …". */
  'no_counters', 'no_minus_counters', 'no_plus_counters',
  /** Bound by Moonsilver: "Enchanted creature can't … transform." (CR 701.27) */
  'cant_transform',
] as const;
export type RuleFlag = (typeof RULE_FLAGS)[number];

// --- Core node shapes ---------------------------------------------------------

export interface AddManaEffect extends EffectNode {
  /** Brigid, Doun's Mind: "Add X {G} or X {W}" — all of one of the options (not a mix, as with "{B} or {G} for each"). */
  allOne?: true;
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
  /** Gond Gate: only lands like these ("a Gate you control could produce"). */
  couldProduceFilter?: ObjectFilter;
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
  /** Opal Palace: "If you spend this mana to cast your commander, it enters with a number of additional +1/+1 counters on it equal to the number of times it's been cast from the command zone this game." */
  spentCommanderCounters?: true;
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
  /** Powerstone: "This mana can't be spent to cast a nonartifact spell." — costs that are neither spells nor abilities too. */
  other?: true;
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
  /** Vigor: "Put a +1/+1 counter on that creature for each 1 damage prevented this way." — right after (CR 615.5). */
  then?: EffectNode[];
  /** Only combat damage, or only noncombat damage. */
  damage?: 'combat' | 'noncombat';
  toYou?: true;
  toSelf?: true;
  /** Permanents (matched with the source's controller as "you"). */
  to?: ObjectFilter;
  bySelf?: true;
  /** Statecraft: "dealt to and dealt by creatures you control" — damage from such a source (either side suffices). */
  by?: ObjectFilter;
  /** Defang: "damage that would be dealt by enchanted creature" — what the holder is attached to. */
  byAttached?: true;
  /** The Mindskinner: "damage to an opponent" — a player, not their permanents. */
  toOpponents?: true;
  /** Panther Habit: "If equipped creature would be dealt damage" — what this is attached to. */
  toAttached?: true;
  /** "If a source you control would deal damage", "If a creature would deal combat damage" (CR 615.1a). */
  from?: ObjectFilter;
  /** Nine Lives: "If a source would deal damage to you, prevent that damage and …" — the additional effect for each source. */
  eachSource?: true;
  /** "during your turn" (CR 611.3a: checked continuously). */
  condition?: ConditionNode;
  /** Gisela: "prevent half that damage, rounded up" — not all of it. */
  half?: 'up';
  /** Orbs of Warding: "prevent 1 of that damage" — that much of it. */
  amount?: number;
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
  /** Spectral Grasp: "can't block creatures you control" — "you" being the controller of what gave it this. */
  cantBlockOf?: ObjectFilter;
  /** "can't be blocked by more than one creature" */
  maxBlockers?: number;
  /** "can't be blocked except by three or more creatures" */
  minBlockers?: number;
  /** "must be blocked if able" (one) / "All creatures able to block ~ do so" (all) */
  mustBeBlocked?: 'one' | 'all';
  /** "can't attack unless defending player controls an Island" (CR 508.1c) */
  attackOnlyIfDefenderControls?: ObjectFilter;
  /** Scrapdiver Serpent: "can't be blocked as long as defending player controls an artifact" (as landwalk, CR 702.14c). */
  unblockableIfDefenderControls?: ObjectFilter;
  /** CR 509.1a: "can block an additional creature each combat" (1); "can block any number of creatures" (99). */
  extraBlocks?: number;
  /** Shiny Impetus: "Enchanted creature … is goaded" — by the static ability's controller, while it applies (CR 701.15). */
  goaded?: true;
  /** Set by the engine: the object whose ability this is, for "~'s power" in the filters (Champion of Lambholt). */
  from?: string;
  /** Promise of Loyalty: "can't attack you or planeswalkers you control" — the effect's controller (set as it resolves). */
  cantAttackYou?: true;
  cantAttackPlayer?: string;
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
  /** Sakashima of a Thousand Faces: "except it has Sakashima's other abilities" — the engine fills in `abilities`. */
  keepOtherAbilities?: true;
  abilities?: AbilityNode[];
  /**
   * Spark Double: "it enters with an additional +1/+1 counter on it if it's a creature" — not a copiable value but a
   * replacement effect as it enters (CR 614.1c), checked against what it copied.
   */
  /** Altered Ego: "X additional +1/+1 counters" — the X paid for it. Undercover Operative: `ifControlled`, "if you control that creature". */
  entersWith?: { counter: string; amount: number | 'X'; ifType?: string; ifControlled?: true }[];
  /**
   * Machine God's Effigy: "it's an artifact" — its card types become these (CR 205.1a), and subtypes that don't go with
   * them are gone (CR 205.3d). Imposter Mech: "it's a Vehicle artifact … and it loses all other card types".
   */
  setTypes?: string[];
  /** Jace, Mirror Mage: "its starting loyalty is 1". */
  loyalty?: number;
}

export interface ContinuousEffectNode extends EffectNode {
  type: 'continuous';
  affected: Ref;
  /** Shalai: "You, planeswalkers you control, and other creatures you control have hexproof." — its controller too. */
  /** 'protection': Serra's Emissary's "You and creatures you control have protection from …" (its protection keyword). */
  alsoPlayer?: 'hexproof' | 'shroud' | 'protection';
  /** Wonder, Anger: "As long as this card is in your graveyard …" — it works only from its owner's graveyard. */
  fromGraveyard?: true;
  /** Witness Protection: "… named Legitimate Businessperson" — its name. */
  setName?: string;
  /** Layer 7c: "gets +1/+1", "gets +1/+1 for each other Zombie you control". */
  power?: Amount;
  toughness?: Amount;
  /**
   * Layer 7a (characteristic-defining, CR 604.3: "~'s power and toughness are each equal to …") or
   * 7b ("has base power and toughness 1/1"): power and toughness set to a value.
   */
  setPower?: Amount;
  /** PuPu UFO: "base power becomes …" — only its base power is set (layer 7b). */
  powerOnly?: true;
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
  /** `supertypes`: On Serra's Wings: "Enchanted creature is legendary" (CR 205.4). */
  addTypes?: { types: string[]; subtypes: string[]; supertypes?: string[]; chosenType?: true; allCreatureTypes?: true; elsewhere?: true };
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
  /** reveal: Temple of the Dragon Queen — "… or you control a Dragon": no reveal needed then. */
  unlessControl?: ObjectFilter;
  /** copy: "You may have ~ enter as a copy of any creature on the battlefield" (CR 707.5, CR 614.1c). */
  /** counter: "You may have ~ enter with an additional +1/+1 counter on it" (riot, unleash; `elseHaste` for riot). */
  /** read_ahead: "As this Saga enters, choose a number between one and this Saga's final chapter number" (CR 702.155b). */
  /** card_name: "As ~ enters, choose a nonland card name" (CR 201.3; `filter` says what kind of card). */
  /** card_type: "As ~ enters, choose artifact, creature, enchantment, instant, or sorcery" (`options`; all card types if absent). */
  /** player: "As ~ enters, choose a player" (`opponent`: "choose an opponent"). */
  /** discard_or_leave: Mox Diamond's "If ~ would enter, you may discard a land card instead. … If you don't, put it into its owner's graveyard." */
  /** sacrifice_or_leave: Lake of the Dead's "If this land would enter, sacrifice a Swamp instead. …" (`amount` of `filter`). */
  /** word: the Sieges' "As this enchantment enters, choose Khans or Dragons." (`options`; abilities gated by `chosen_word`). */
  /** land_type: Multiversal Passage's "choose a basic land type" (`chosen.landType`; "is the chosen type" adds it). */
  /** number: Talion's "choose a number between 1 and 10" (`options`; `chosen.number`). */
  /** tribute: CR 702.104a — an opponent the controller chooses may put `amount` +1/+1 counters on it (`tributePaid`). */
  /** counter_kind: Boot Nipper — "enters with your choice of a deathtouch counter or a lifelink counter on it" (`options`). */
  choice: 'pay_life' | 'reveal' | 'color' | 'creature_type' | 'copy' | 'counter' | 'devour' | 'read_ahead' | 'card_name' | 'card_type' | 'player' | 'discard_or_leave' | 'sacrifice_or_leave' | 'word' | 'land_type' | 'number' | 'tribute' | 'counter_kind';
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
  /** `others_turns`: Dosan the Falling Leaf — during turns other than the caster's own. */
  during?: 'your_turn' | 'combat' | 'others_turns';
  /** Only spells cast from these zones. */
  fromZones?: ('graveyard' | 'library' | 'exile' | 'command')[];
  /** "can't cast more than one spell each turn" */
  maxPerTurn?: number;
  /** Grand Abolisher: "… or activate abilities of artifacts, creatures, or enchantments" (mana abilities too, unless `nonMana`). */
  /** The Immortal Sun: `loyalty` — only planeswalkers' loyalty abilities (CR 606). */
  activate?: { filter?: ObjectFilter; nonMana?: true; loyalty?: true };
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
  /** CR 509.1d: Archangel of Tithes' "creatures can't block unless their controller pays {1} for each of those creatures". */
  blocks?: true;
  /** Brainwash: "Enchanted creature can't attack unless its controller pays {3}"; Phyrexian Marauder: "This creature can't
   * attack unless you pay {1} for each +1/+1 counter on it." — only that creature, whoever it attacks. */
  subject?: 'self' | 'attached';
  /** Oppressive Rays: "can't attack or block unless …" — the same cost to block. */
  alsoBlocks?: true;
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
  /** Brush Off: "{1}{U} less" — generic mana changed along with the colored symbols (`colors`). */
  generic?: number;
  change: 'less' | 'more';
  condition?: ConditionNode;
  /** "This spell costs {2} less to cast if it targets a tapped creature" (CR 601.2f: targets come first). */
  ifTargets?: ObjectFilter;
  /** Monastery Siege: "… that target you or a permanent you control" — targeting this effect's controller counts too. */
  ifTargetsYou?: true;
  /** Emet-Selch: only spells cast from these zones ("from your graveyard"); `notFromHand`: "from anywhere other than your hand". */
  castFrom?: ('graveyard' | 'exile')[];
  notFromHand?: true;
  /** Conduit of Ruin: "The first creature spell you cast each turn costs {2} less to cast." */
  firstEachTurn?: true;
  /** Alisaie Leveilleur: "The second spell you cast each turn" (with `firstEachTurn`). */
  nthEachTurn?: number;
  /** Defense Grid: "except during its controller's turn". */
  exceptCastersTurn?: true;
  /** Morophon: "cost {W}{U}{B}{R}{G} less to cast" — one of each of these colors (`amount` each); `coloredOnly`: "This effect
   * reduces only the amount of colored mana you pay." */
  colors?: Color[];
  coloredOnly?: true;
  /** Torgaar: "This spell costs {2} less to cast for each creature sacrificed this way" (`amount` each). */
  perSacrificed?: true;
  /** March of Swirling Mist: "for each card exiled this way" — the cards exiled for its "any number" additional cost. */
  perExiled?: true;
  /** Eminence (The Ur-Dragon): it works from the command zone as well as the battlefield. */
  eminence?: true;
}

/**
 * CR 614.1b: "All damage that would be dealt to you is dealt to enchanted creature instead." (Pariah, Pariah's Shield,
 * Palisade Giant's "you and other permanents you control", Treacherous Link's "… to enchanted creature is dealt to its
 * controller instead", Veteran Bodyguard's "by unblocked creatures").
 */
export interface RedirectDamageNode extends EffectNode {
  type: 'redirect_damage';
  /** Damage to the source's controller. */
  fromYou?: true;
  /** Damage to these permanents (from the source's point of view). */
  fromObjects?: ObjectFilter;
  /** Damage to what the source is attached to. */
  fromAttached?: true;
  /** Where it goes: the source, what it's attached to, or the controller of what it's attached to. */
  to: 'self' | 'attached' | 'attached_controller';
  combat?: true;
  unblocked?: true;
  condition?: ConditionNode;
}

/**
 * Defiler of Vigor: "As an additional cost to cast green permanent spells, you may pay 2 life. Those spells cost {G} less to
 * cast if you paid life this way." — one {G} of each such spell may be paid with 2 life, like a Phyrexian symbol (CR 107.4f).
 */
export interface PhyrexianGrantNode extends EffectNode {
  type: 'phyrexian_grant';
  filter: ObjectFilter;
  color: Color;
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
  /** Nissa's Chosen: "put it on the bottom of its owner's library instead" — there, not exile. */
  libraryBottom?: true;
  /** The Darkness Crystal: "instead exile it and you gain 2 life". */
  gainLife?: number;
  /** Kalitas, Traitor of Ghet: "instead exile that card and create a 2/2 black Zombie creature token" — for the source's controller. */
  createToken?: FaceDef;
}

/**
 * CR 614.1a: replacement effects that change how much happens — "If you would gain life, you gain twice
 * that much life instead", token and counter doublers, "it deals double that damage instead".
 */
export interface QuantityReplacementNode extends EffectNode {
  type: 'replace_quantity';
  /** `mill`: The Water Crystal — "If an opponent would mill one or more cards, they mill that many cards plus four instead." */
  /** `copies`: Twinning Staff — "If you would copy a spell one or more times, instead copy it that many times plus an additional time." */
  event: 'gain_life' | 'tokens' | 'counters' | 'damage' | 'mill' | 'lose_life' | 'proliferate' | 'copies';
  /** copies: "You may choose new targets for the additional copy." */
  newTargetsForExtra?: true;
  /** gain_life: Phial of Galadriel — "If you would gain life while you have 5 or less life, …". */
  lifeAtMost?: number;
  /** Bloodletter of Aclazotz: only during its controller's turn. */
  yourTurn?: true;
  /** 'extra' (tokens): "those tokens plus an additional Food token are created instead" (Peregrin Took, Xorn); 'half':
   * "half that many …, rounded down" (Vorinclex, Monstrous Raider). */
  /** 'swap' (tokens): Divine Visitation — "that many 4/4 white Angel creature tokens … are created instead" (`extra.token`). */
  op: 'double' | 'triple' | 'plus' | 'extra' | 'half' | 'swap';
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
  /** counters: also counters put on players — 'you': on the putter themself (Lae'zel: "or on yourself"); 'any': any player
   * (Vorinclex, Monstrous Raider: "on a permanent or player"). */
  players?: 'you' | 'any';
  /** counters: only counters on players (Winding Constrictor: "If you would get one or more counters"). */
  onlyPlayers?: true;
  /** counters: "If an effect would put one or more counters …" (Doubling Season) — not counters put on as a cost. */
  effectOnly?: true;
  /** damage: only to opponents and their permanents; only noncombat damage. */
  toOpponents?: true;
  /** Sawhorn Nemesis: "to the chosen player or a permanent they control" (chosen as the source entered). */
  toChosen?: true;
  /** Curse of Bloodletting: only damage to the player this Aura enchants. */
  toEnchantedPlayer?: true;
  /** Goldnight Castigator: damage dealt to you, or to this permanent. */
  toYou?: true;
  toSelf?: true;
  /** Fiendish Duo: "would deal damage to an opponent" — players only, not their permanents. */
  toPlayersOnly?: true;
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
  /** Absolute Virtue: "You have protection from each of your opponents." (CR 702.16b–e, with `quality`) */
  'protection',
  /** Dracogenesis: "You may cast Dragon spells without paying their mana costs." (with a filter; from any zone). */
  'free_cast',
  /** Worship, Angel's Grace: "damage that would reduce your life total to less than 1 reduces it to 1 instead." (CR 614.1a) */
  'damage_floor',
  /** Everybody Lives!: "Players can't lose life this turn." (CR 119.7) */
  'cant_lose_life',
  /** Melira, Sylvok Outcast: "You can't get poison counters." (CR 122.1f) */
  'no_poison',
  /** K'rrik, Son of Yawgmoth: "For each {B} in a cost, you may pay 2 life rather than pay that mana." (CR 107.4f) */
  'black_as_phyrexian',
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
  /** Kruphix, God of Horizons: "If you would lose unspent mana, that mana becomes colorless instead." — of its `colors[0]`. */
  'mana_becomes',
  /** Birgi, God of Storytelling: "Creatures you control can boast twice during each of your turns rather than once." */
  'boast_twice',
  /** Leonin Shikari: "You may activate equip abilities any time you could cast an instant." (Forge Anew: during your turn, a condition.) */
  'equip_instant',
  /** Forge Anew: "You may pay {0} rather than pay the equip cost of the first equip ability you activate during each of your turns." */
  'first_equip_free',
  /** Bruenor Battlehammer: "… the first equip ability you activate each turn." */
  'first_equip_free_each_turn',
  /** Oath of Teferi: "You may activate the loyalty abilities of planeswalkers you control twice each turn rather than only once." */
  'loyalty_twice',
  /** Ashiok, Dream Render: "Spells and abilities your opponents control can't cause their controller to search their library." */
  'cant_search_own_library',
  /** CR 502.3: Winter Orb: "Players can't untap more than one land during their untap steps." — at most `amount` of the permanents its `filter` names (any without one). */
  'untap_limit',
  /** Abyssal Persecutor: "You can't win the game and your opponents can't lose the game." (CR 104.3a) */
  'cant_win_opponents_cant_lose',
  /** Tainted Remedy, Plague Drone: "If an opponent would gain life, that player loses that much life instead." (CR 614.1a) */
  'gain_becomes_loss',
  /** Archon of Coronation: "damage doesn't cause you to lose life" (CR 120.3a; the damage is still dealt). */
  'damage_no_life_loss',
  /** Mindlock Orb, Stranglehold: "Players can't search libraries." (CR 701.23) */
  'cant_search',
  /** Aggressive Mining: "You can't play lands." (CR 305.2) */
  'cant_play_lands',
  /** Maralen of the Mornsong: "Players can't draw cards." (CR 121.2) */
  'cant_draw',
  /** Stasis: "Players skip their untap steps." (CR 614.10) */
  'skip_untap',
  /** Eon Hub: "Players skip their upkeep steps." (CR 614.10) */
  'skip_upkeep',
  /** Telepathy: "Your opponents play with their hands revealed." — everyone sees those hands. */
  'hand_revealed',
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
  /** protection: what from (CR 702.16a's quality words: "each of your opponents"). */
  quality?: string;
  /** free_cast: Darksteel Monolith, As Foretold — "Once each turn, you may pay {0} rather than pay the mana cost …";
   * `fromZone`: "… for a colorless spell you cast from your hand" (Charred Foyer: "… from exile"). */
  oncePerTurn?: true;
  fromZone?: 'hand' | 'exile';
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
    'put_from_milled', 'grant_play', 'grant_graveyard_cast', 'return_chosen', 'add_counters', 'modify', 'create_token', 'scry', 'surveil', 'mill', 'discard', 'regenerate', 'attach',
    'sacrifice', 'may', 'transform', 'incubate', 'reveal_top_card', 'spell_enter_counters', 'choose_number', 'skip_next', 'monstrosity', 'may_pay', 'unless_pays', 'search', 'sacrifice_choice', 'if', 'may_do',
    'delayed', 'gain_control', 'exchange_control', 'exchange_life', 'exchange_life_stat', 'player_counters_lost', 'choose_object', 'exile_if_dies', 'prevent', 'explore', 'become_monarch', 'get_counters', 'skip_untap',
    'proliferate', 'connive', 'amass', 'exile_top', 'class_level', 'exile_on_leave', 'unless_does',
    'players_do', 'emblem', 'copy_spell', 'manifest', 'grant_rebound', 'radiation', 'cast_free', 'play_free', 'play_exiled', 'cast_among_free', 'cast_copy_of', 'look_sort', 'name_and_dig', 'tainted_pact', 'repeat_may', 'hideaway', 'put_lki_counters', 'cascade', 'ripple', 'discover', 'suspend_tick', 'madness_cast',
    'remove_counters', 'choose_opponent', 'opponents_may', 'become_renowned', 'day_night', 'become_saddled', 'fight', 'fight_distinct', 'scroll_rack', 'plot', 'move_chosen', 'choose_from_hand', 'bolster', 'reorder_top', 'dig', 'increase_speed', 'shuffle', 'populate', 'flip_coin', 'look_at_hand', 'tap_or_untap', 'extra_turn', 'choose_value', 'goad', 'suspect', 'solve', 'soulbond_pair', 'game_result', 'process', 'kinship', 'reveal_choose',
    'become_prepared', 'become_unprepared', 'end_turn', 'reveal_random', 'shuffle_zones', 'extra_land', 'clash', 'piles', 'mana_trigger_this_turn', 'look_at_top', 'put_counters', 'ninjutsu', 'move_counters', 'myriad', 'encore', 'miracle_cast',
    'harness', 'ring_tempts', 'venture', 'take_initiative', 'reveal_until', 'give_gift', 'become_copy', 'extra_combat', 'phase_out', 'phase_out_proliferated', 'return_from_each_graveyard', 'chain_copy', 'lock_untap', 'unlock', 'must_block', 'unattach', 'remove_from_combat', 'prevent_chosen_source', 'cant_block_attacker', 'untap_chosen', 'craft_return', 'damage_unpreventable', 'roll_die', 'vote', 'repeat', 'prohibit_casting', 'retarget', 'player_effect', 'choose_one', 'blight', 'forage', 'reflexive', 'next_spell', 'double_counters', 'swap_graveyard', 'sylvan_library', 'cast_from_hand', 'reveal_top', 'wheel', 'each_deals', 'keep_choose', 'turn_trigger', 'cast_paid', 'reanimate_attach', 'sacrifice_linked', 'delayed_leave', 'airbend', 'tempting_offer',
  ],
  conditions: [
    'greatest_power', 'kicked', 'cast_by_you', 'self_tapped', 'your_turn', 'count', 'life', 'hand', 'graveyard', 'this_turn', 'spells_last_turn',
    'counters', 'is', 'has_attached', 'monstrous', 'harnessed', 'and', 'opponents', 'monarch', 'class_level', 'paid', 'arrived_since_upkeep', 'renowned', 'day_night', 'saddled', 'max_speed', 'solved', 'paired', 'to_graveyard_this_turn', 'city_blessing', 'compare_stats', 'won_flip', 'before_attackers', 'step', 'prepared', 'won_clash', 'ring_bearer', 'chose_other_ring_bearer', 'completed_dungeon', 'initiative',
    'top_card', 'poison', 'different_powers', 'total_power', 'entered_this_turn', 'or', 'amount', 'combat_damage_by', 'discarded_this_turn', 'votes', 'opponent_has_more', 'attacked_with', 'was_type', 'was_attacking', 'had_keyword', 'sacrificed_this_turn', 'not', 'early_turn', 'distinct_names', 'unique_name', 'greatest_mv', 'first_combat', 'cast_in_main_phase', 'cast_off_sorcery_timing', 'chosen_word', 'most_of', 'lki_was', 'cast_named_before', 'same_name', 'ability_resolutions', 'attacking_you', 'left_graveyard', 'controlled_it', 'spent_colors', 'attack_power', 'activated_times', 'tribute_paid',
  ],
  statics: [
    'enters_tapped', 'enters_with_counters', 'continuous', 'additional_cost', 'additional_cost_choice', 'additional_mana', 'top_permission', 'graveyard_to_exile', 'player_rule', 'as_enters', 'deck_rule',
    'cost_modifier', 'replace_quantity', 'exile_instead', 'cast_option', 'resolve_to_hand', 'rebound', 'enters_day', 'as_enters', 'per_target_cost', 'enters_prepared', 'graveyard_to_library', 'exert_option', 'begin_on_battlefield', 'dungeon_entry', 'gift_spell', 'cast_restriction', 'cast_prohibition', 'attack_tax', 'enter_tapped_others', 'enter_counters_others', 'uncounterable', 'draw_replacement', 'trigger_extra', 'prevent_damage', 'token_one_of_each', 'grant_escape', 'grant_retrace', 'target_life_tax', 'ability_cost_reduction', 'mana_multiplier', 'combat_limit', 'spell_keyword', 'enter_untapped_others', 'unpreventable', 'search_control', 'search_exile', 'redirect_damage', 'graveyard_cast', 'phyrexian_grant', 'cant_enter', 'enter_exile_uncast', 'as_transforms', 'flash_if', 'special_action_discount', 'exile_play', 'opening_reveal',
  ],
  triggers: [
    'enters', 'dies', 'leaves', 'attacks', 'blocks', 'becomes_blocked', 'deals_combat_damage', 'phase', 'cast', 'gain_life', 'draw', 'damage_prevented',
    'becomes_target', 'deals_damage', 'dealt_damage', 'player_dealt_damage', 'lose_life', 'chapter', 'becomes_level',
    'player_attacked', 'turned_face_up', 'last_counter_removed', 'day_night_changed', 'either', 'becomes_tapped', 'state', 'activate', 'exerted', 'clashed', 'put_into_graveyard',
    'you_attack', 'unblocked', 'combat_damage_batch', 'leave_graveyard', 'discard', 'scry', 'counters_put', 'sacrificed',
    'becomes_monstrous', 'ring_tempted', 'room', 'dungeon_completed', 'crime', 'expend', 'transforms', 'unlock_door', 'fully_unlocked', 'die_rolled', 'reflexive', 'mana_spent', 'tapped_for_mana', 'land_played', 'searched', 'counters_spell', 'proliferated', 'coin_flipped', 'unattached', 'milled', 'became_monarch', 'counters_removed',
  ],
  costs: ['exert_self', 'sacrifice_self', 'pay_life', 'discard_self', 'sacrifice', 'discard', 'exile_self', 'pay_energy', 'crew', 'exile_cards', 'remove_counters_self', 'station', 'return_unblocked', 'tap_creatures', 'craft', 'collect_evidence', 'return_permanents', 'reveal_from_hand', 'behold', 'blight', 'forage', 'exile_self_hand', 'discard_hand', 'exile_self_battlefield', 'put_counters_self', 'mill', 'return_self', 'remove_counters', 'process'],
  /** Counted amounts (AmountExpr kinds). */
  amounts: ['count', 'cards', 'stat', 'life', 'counters', 'players', 'devotion', 'x', 'event', 'cast_before', 'commander_casts', 'kicks', 'party', 'life_lost', 'opponents_attacked', 'colors_spent', 'cost_lki', 'paid_times', 'domain', 'card_types', 'blockers', 'die_result', 'votes', 'greatest', 'discarded_this_way', 'spells_cast_this_turn', 'colors_among', 'commander_colors', 'total_power', 'moved_this_way', 'died_this_turn', 'damage_this_way', 'life_this_turn', 'excess_this_way', 'mana_spent', 'sum', 'max', 'unspent_mana', 'attackers_this_turn', 'sacrificed_this_turn', 'distinct_mana_values', 'drawn_this_turn', 'tokens_created_this_turn', 'tapped_this_way', 'counters_among', 'counters_removed', 'attacks_this_turn', 'convoked', 'sacrificed_to_cast', 'discover_shortfall', 'source_damage_this_turn', 'entered_this_turn', 'discarded_this_turn', 'to_graveyard_this_turn', 'distinct_names', 'flips_won', 'speed', 'drawn_this_way', 'left_this_turn', 'creature_types_among', 'distinct_powers', 'most_sharing_type', 'ability_resolutions'],
  /** Keyword abilities (CR 702) the engine applies. Others are recorded but resolved by players. */
  keywords: [
    'flying', 'first_strike', 'double_strike', 'deathtouch', 'defender', 'flash', 'haste', 'hexproof', 'hexproof_from',
    // Vines of Vastwood, Canopy Cover: "can't be the target of spells or abilities your opponents control" — `you` is the
    // granting effect's controller.
    'untargetable_by_opponents',
    // Shanna, Sisay's Legacy: "can't be the target of abilities your opponents control" (see KeywordInstance.by).
    'untargetable',
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
    // CR 702.150a: compleated — two fewer loyalty counters for each Phyrexian symbol paid with life (in the engine's entering).
    'compleated',
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
  const modes = face.abilities.flatMap((a) => (a.kind === 'static' ? [] : (a.modes?.options ?? []).filter((m) => m.manual).map((m) => `• ${m.text}`)));
  // A token the card makes with text that wasn't compiled (CR 111.4): those abilities of the token wouldn't work.
  const tokens: string[] = [];
  const walk = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const token = k === 'token' && x && typeof x === 'object' ? (x as { name?: string; unparsed?: string[] }) : null;
      if (token) for (const u of token.unparsed ?? []) tokens.push(`${token.name ?? 'Token'}: ${u}`);
      else walk(x);
    }
  };
  walk(face.abilities);
  walk(face.keywords);
  return [...modes, ...tokens];
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
