import type { PlayerRule } from '@mtg/schema';
import type { AbilityNode, Amount, AsEntersNode, ManaSpend, ObjectFilter, CardDef, Color, CombatRules, ConditionNode, EffectNode, KeywordInstance, RuleFlag, TargetSpec, TriggeredAbility } from '@mtg/schema';
import type { TurnLog } from './conditions.js';

export type PlayerId = string;
export type ObjectId = string;

/** CR 400.1: the zones. Libraries, hands and graveyards belong to a player; the rest are shared. */
export type ZoneName = 'library' | 'hand' | 'graveyard' | 'battlefield' | 'stack' | 'exile' | 'command';
export const PLAYER_ZONES = ['library', 'hand', 'graveyard'] as const;
export type PlayerZone = (typeof PLAYER_ZONES)[number];

/** CR 500.1: five phases; steps listed in order. */
export type Step =
  | 'untap'
  | 'upkeep'
  | 'draw'
  | 'main1'
  | 'beginning_of_combat'
  | 'declare_attackers'
  | 'declare_blockers'
  | 'combat_damage'
  | 'end_of_combat'
  | 'main2'
  | 'end'
  | 'cleanup';

export const STEPS: readonly Step[] = [
  'untap',
  'upkeep',
  'draw',
  'main1',
  'beginning_of_combat',
  'declare_attackers',
  'declare_blockers',
  'combat_damage',
  'end_of_combat',
  'main2',
  'end',
  'cleanup',
];

export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
/** Several mana colors at once, one letter each ("GGU"). */
export type ManaMix = string;
export type ManaPool = Record<ManaColor, number>;

export interface GameConfig {
  format: 'commander' | 'constructed';
  startingLife: number;
  startingHandSize: number;
  maxHandSize: number;
  /** First mulligan doesn't reduce hand size (multiplayer). */
  freeMulligan: boolean;
  seed: number;
}

export interface RestrictedMana {
  color: ManaColor;
  amount: number;
  /** What it can be spent on (CR 106.6); anything, if absent. */
  spend?: ManaSpend;
  /** Mana that isn't lost as steps and phases end, until then (CR 500.5). */
  keep?: 'end_of_turn' | 'end_of_combat';
  /** What made it ("a creature spell of the chosen type" is the type chosen for that permanent). */
  source?: ObjectRef;
  /** "When that mana is spent to cast …" (Path of Ancestry). */
  onSpent?: TriggeredAbility;
  /** "If any of that mana is spent on a creature spell, it gains haste until end of turn." (Arena of Glory) */
  haste?: { filter: ObjectFilter; eot?: true };
  /** Opal Palace: spent to cast your commander, it enters with a +1/+1 counter for each time it's been cast from the command zone. */
  commanderCounters?: true;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  life: number;
  poison: number;
  /** CR 122.1: other counters a player can have — energy (CR 107.14), experience, rad. */
  counters?: Record<string, number>;
  /** CR 614.10: "skips their next turn / untap step / draw step / combat phase" — how many are still to be skipped. */
  skipNext?: { turn?: number; untap?: number; draw?: number; combat?: number; combatThisTurn?: number };
  pool: ManaPool;
  /** CR 106.6: mana that can be spent only on certain things; it empties with the pool (CR 500.5). */
  restricted?: RestrictedMana[];
  /** CR 309.3: the dungeon card this player owns in the command zone, and the room their venture marker is in. */
  dungeon?: { card: string; room: string };
  /** CR 309.7: names of the dungeons this player has completed. */
  completed?: string[];
  /** CR 701.54c: how many times the Ring has tempted this player (their emblem named The Ring). */
  ringTempted?: number;
  landsPlayedThisTurn: number;
  /** "You may play an additional land this turn." (CR 305.2) */
  extraLands?: { turn: number; n: number };
  /** Set when the player attempted to draw from an empty library since the last SBA check. */
  drewFromEmptyLibrary: boolean;
  /** How many turns this player has begun ("if it's your first, second, or third turn of the game"). */
  turnsBegun?: number;
  /** Laboratory Maniac: "you win the game instead" — the game ends as state-based actions are next checked (CR 104.2b). */
  wonByEffect?: boolean;
  lost: boolean;
  mulligans: number;
  keptHand: boolean;
  /** Clock values at the beginning of this player's last two upkeeps (CR 702.30a echo). */
  upkeeps?: number[];
  /** CR 702.179: speed, once a player has any (start your engines!); the turn it last increased. */
  speed?: number;
  speedTurn?: number;
  /** CR 702.131c: the city's blessing (ascend), for the rest of the game. */
  cityBlessing?: true;
}

/** What paid costs were, for "the sacrificed creature's power" (CR 608.2h: as it last existed). */
/** CR 608.2h: what a sacrificed or discarded object was, as it last existed ("the sacrificed creature's power",
 * "if the discarded card wasn't a land card"). */
export interface LKIStats {
  power: number;
  toughness: number;
  mana_value: number;
  types?: string[];
  subtypes?: string[];
  supertypes?: string[];
  colors?: string[];
  token?: true;
}

export interface CostLKI {
  sacrificed?: LKIStats[];
  discarded?: LKIStats[];
  /** Food Chain: "Exile a creature you control" — what was exiled, as it last existed on the battlefield. */
  exiled?: LKIStats[];
  /** The creature tapped for a station ability. */
  tapped?: LKIStats[];
  /** What the creature returned for ninjutsu or sneak was attacking (CR 702.49c, 702.190b). */
  attackTarget?: AttackTarget;
}

export interface GameObject {
  /** Ojer Pakpatiq: "it gains rebound" — this incarnation of the spell (CR 702.88a). */
  reboundGranted?: number;
  id: ObjectId;
  /** Key into GameState.cards. */
  card: string;
  owner: PlayerId;
  controller: PlayerId;
  zone: ZoneName;
  /** Number of zone changes; an object that changes zones is a new object (CR 400.7). */
  zcc: number;
  /** Index of the face that is up / being cast. */
  face: number;
  tapped: boolean;
  /** True until its controller has controlled it continuously since their most recent turn began. */
  sick: boolean;
  damage: number;
  counters: Record<string, number>;
  token?: true;
  /** Designated as its owner's commander (CR 903.3). Survives zone changes. */
  commander?: true;
  /** Dealt damage by a deathtouch source since state-based actions were last checked (CR 704.5h). */
  deathtouched?: true;
  /** Loyalty abilities activated this turn (once-per-turn limit). */
  loyaltyActivatedTurn?: number;
  /** Oath of Teferi: how many loyalty abilities of it were activated in `loyaltyActivatedTurn`. */
  loyaltyActivations?: number;
  /** CR 613.7d: set when it enters a zone; orders continuous effects from its static abilities. */
  timestamp: number;
  /** CR 613.7: when each keyword counter (CR 122.1b) was first put on it, for effects that came before. */
  counterStamps?: Record<string, number>;
  /** The object an Aura or Equipment is attached to (CR 701.3). */
  attachedTo?: ObjectRef;
  /** CR 114.1: an emblem in the command zone (not a card or a permanent). */
  emblem?: true;
  /** CR 701.15: the players who goaded it (until each one's next turn). */
  goadedBy?: PlayerId[];
  /** The last turn it was dealt damage ("creature that was dealt damage this turn"). */
  damagedTurn?: number;
  /** CR 702.171b: saddled this turn. */
  saddledTurn?: number;
  /** CR 702.112b: it became renowned. */
  renowned?: true;
  /** CR 719.3b: a Case that became solved. */
  solved?: true;
  /** CR 702.95b: the creature it's paired with (soulbond), as that object. */
  pairedWith?: { id: ObjectId; zcc: number };
  /** CR 701.60a: suspected (the timestamp it became so: its menace and "can't block" are layer 6 abilities, CR 701.60c). */
  suspected?: number;
  /** CR 702.177a: abilities activated "only once" (by index). */
  activatedOnce?: Record<number, true>;
  /** CR 702.143a: foretold (exiled face down from hand) on this turn. */
  foretold?: number;
  /** CR 406.3a: exiled face down; only this player may look at it (hideaway, CR 702.75a) — '' for no one (Necropotence). */
  hiddenFor?: PlayerId;
  /** CR 702.170a: plotted on this turn. */
  plotted?: number;
  /** CR 702.62a: suspended (in exile with time counters). */
  suspended?: true;
  /** CR 708: face down, and how it got that way (its own card is still there to turn face up). */
  faceDown?: 'morph' | 'disguise' | 'manifest' | 'cloak';
  /** When it came under its controller's control (a clock value; CR 702.30a echo). */
  arrived?: number;
  /** CR 707.2: the card (and face) whose copiable values this permanent has, if it's a copy. */
  copyOf?: { card: string; face: number };
  /** CR 611.2a: what it was a copy of before an "until end of turn" copy effect (restored at cleanup). */
  copyRevert?: ({ card: string; face: number } | null)[];
  /** CR 303.4: the player an Aura with "enchant player" is attached to. */
  attachedToPlayer?: PlayerId;
  /** CR 701.19a: regeneration shields until end of turn. */
  regenShields?: number;
  /** "Activate only once each turn": ability index → turn it was last activated. */
  activatedTurn?: Record<number, number>;
  /** "This ability triggers only once each turn": ability index → turn it last triggered. */
  triggeredTurn?: Record<number, number>;
  /** CR 603.2h: "Do this only once each turn." — the turn its controller took that action, by "zcc:ability text" (a new object, CR 400.7, starts over). */
  doneOnce?: Record<string, number>;
  /** CR 107.3m: the X paid for the spell it was, for its enters abilities. */
  x?: number;
  /** CR 709.5c: a Room's unlocked designations — [left half, right half]. */
  unlocked?: [boolean, boolean];
  /** "It doesn't untap during its controller's untap step for as long as ~ remains tapped." */
  /** "… doesn't untap … for as long as ~ remains tapped" (or `while` "you control ~", "~ remains on the battlefield"). */
  untapLocks?: (ObjectRef & { while?: 'controlled' | 'present'; controller?: PlayerId })[];
  /** CR 509.1c: "blocks ~ this turn if able" (an attacker) or "blocks this turn if able" (none) — for that turn. */
  mustBlock?: { attacker?: ObjectRef; turn: number }[];
  /** "Target creature can't block ~ this turn": the attackers it can't block, for that turn. */
  cantBlockThis?: { attacker: ObjectRef; turn: number }[];
  /** CR 702.26: phased out (treated as though it doesn't exist), directly or along with what it's attached to. */
  phasedOut?: 'directly' | 'indirectly';
  /** CR 701.54a: this is that player's Ring-bearer (until another creature is, or another player controls it). */
  ringBearer?: PlayerId;
  /** CR 701.37b: monstrous until it leaves the battlefield. */
  monstrous?: true;
  /** CR 701.64b: harnessed (until it leaves the battlefield). */
  harnessed?: true;
  /** CR 702.34a: cast with flashback — exiled instead of going anywhere else when it leaves the stack. 'graveyard': only
   * instead of a graveyard ("If that spell would be put into a graveyard, exile it instead"). */
  exileOnLeave?: true | 'graveyard';
  /** How it was cast, kept as the spell becomes a permanent ("if it was kicked", "if you cast it"). */
  /**
   * How it was cast. `before`: how many spells had been cast this turn before it (storm, CR 702.40a).
   * A copy of a spell wasn't cast (CR 707.10) but keeps the choices made for the original, like kicker.
   */
  /** `giftTo`: the opponent promised the gift (CR 702.174a). */
  /** hasteUntil: the permanent it becomes has haste through this turn (Arena of Glory's mana; MAX for good). */
  cast?: { by: PlayerId; from: ZoneName; kicked?: true; kicks?: number; colors?: number; before?: number; copy?: true; paid?: string[]; suspended?: true; giftTo?: PlayerId; uncounterable?: true; mainPhase?: true; manaSpent?: number; hasteUntil?: number; enterCounters?: Record<string, number>; phyrexianLife?: number; offSorceryTiming?: true; convoked?: ObjectRef[]; sacrificed?: number; spent?: Partial<Record<'W' | 'U' | 'B' | 'R' | 'G' | 'C', number>> };
  /** CR 707.10: a copy of a spell (it ceases to exist off the stack, CR 704.5e). */
  spellCopy?: true;
  /** CR 722.3a: a permanent with a prepare spell that is prepared. */
  prepared?: true;
  /** CR 702.103b: cast bestowed — an Aura with enchant creature, not a creature, until it ceases to be bestowed. */
  bestowed?: true;
  /** Necromancy: "it becomes an Aura with "enchant creature put onto the battlefield with Necromancy"" (until it leaves). */
  becameAura?: true;
  /** CR 702.102: a fused split spell — both halves cast together (on the stack only). */
  fused?: true;
  /** CR 718.3b: cast prototyped — it has the inset mana cost, power and toughness (and that cost's colors). */
  prototyped?: true;
  /** CR 701.43a: exerted — it won't untap during its controller's next untap step. */
  exerted?: true;
  /** Encore: "attacks that opponent this turn if able" (CR 702.141a). */
  attacksPlayer?: { player: PlayerId; turn: number };
  /** Activations this turn of abilities with a per-turn limit, by ability index. */
  activations?: Record<number, { turn: number; n: number }>;
  /** CR 722.3c: the copy of a prepare spell in exile, castable while this permanent stays prepared. */
  prepareOf?: ObjectRef;
  /** CR 110.2: the player it entered the battlefield under; control effects (layer 2) apply on top. */
  baseController?: PlayerId;
  /** "If that creature would die this turn, exile it instead" — the turn it applies. */
  exileIfDiesTurn?: number;
  /** "If it would leave the battlefield, exile it instead of putting it anywhere else" (unearth, CR 702.84a). */
  exileWhenLeaves?: true;
  /** CR 716.2: a Class's level (1 if it has none, CR 716.2d). */
  classLevel?: number;
  /** "It doesn't untap during its controller's next untap step": how many untap steps it skips. */
  skipUntap?: number;
  /** Combat Celebrant: the turn it was last exerted ("if this creature hasn't been exerted this turn"). */
  exertedTurn?: number;
  /** CR 607.2a: the permanent whose ability exiled this card (for "the exiled card"). */
  exiledBy?: ObjectRef;
  /** CR 614.12: what was chosen as it entered ("As ~ enters, choose a color"). */
  chosen?: { color?: Color; creatureType?: string; cardName?: string; cardType?: string; player?: PlayerId; word?: string; landType?: string; number?: number };
}

/** A reference that goes stale when the object changes zones. */
export interface ObjectRef {
  id: ObjectId;
  zcc: number;
}

/** CR 506.3: only a player, a planeswalker, or a battle can be attacked. Battles arrive later. */
export type AttackTarget = { kind: 'player'; player: PlayerId } | { kind: 'planeswalker'; object: ObjectId };

export type DamageRecipient = { kind: 'player'; player: PlayerId } | { kind: 'permanent'; object: ObjectId };

export interface DamageAssignment {
  to: DamageRecipient;
  amount: number;
}

export interface AttackerState {
  zcc: number;
  target: AttackTarget;
  /** CR 509.1h: stays blocked even if its blockers leave combat. */
  blocked: boolean;
  blockers: ObjectRef[];
}

export interface CombatState {
  attackers: Record<ObjectId, AttackerState>;
  /** Blocker id → the attacker it blocks. */
  blockers: Record<ObjectId, { zcc: number; blocking: ObjectId; alsoBlocking?: ObjectId[] }>;
  /** CR 510.1: damage assignments still to be announced (defending players after the active player), and those made. */
  damageQueue?: { player: PlayerId; choices: DamageChoice[] }[];
  assigned?: Record<ObjectId, DamageAssignment[]>;
  attackersDeclared: boolean;
  /** Kytheon: the creatures declared as attackers this combat (CR 508.1). */
  declared?: { id: ObjectId; zcc: number }[];
  /** Pack tactics: the attackers' total power as they were declared. */
  declaredPower?: number;
  /** Defending players still to declare blockers, in APNAP order (CR 802.4). */
  toDeclareBlockers: PlayerId[];
  /** Creatures that had first strike or double strike when a first-strike damage step began (CR 510.4). */
  firstStrikers: ObjectId[] | null;
  /** CR 509: blockers have been declared (the blockers_done event was sent). */
  blockersDone?: true;
  /** Which damage step is current: the extra first-strike step or the regular one. */
  damageStep: 'first' | 'regular' | null;
}

export interface DamageChoice {
  attacker: ObjectId;
  power: number;
  /** Blockers that can be assigned damage. */
  blockers: ObjectId[];
  /** With trample: the attacked player or planeswalker, which can take damage past lethal. */
  trampleTarget: DamageRecipient | null;
  /** "as though it weren't blocked" (CR 510.1c): all of it may go to what it's attacking instead. */
  unblockedTarget?: DamageRecipient;
  suggested: DamageAssignment[];
}

/** A target as a player picks it. */
/** `ability`: an activated or triggered ability on the stack, by its stack id (CR 113.1c). */
export type Target = { kind: 'player'; player: PlayerId } | { kind: 'object'; object: ObjectId } | { kind: 'ability'; entry: string };

/** A chosen target as stored: an object target goes stale if the object changes zones (CR 608.2b). */
export type TargetRef = { kind: 'player'; player: PlayerId } | { kind: 'object'; id: ObjectId; zcc: number } | { kind: 'ability'; entry: string };

/** What the engine runs for a spell or ability: target specs and effects, with modes already chosen. */
export interface CompiledProgram {
  specs: TargetSpec[];
  effects: EffectNode[];
  /** A chosen mode the compiler couldn't read: players resolve it by hand. */
  manual?: true;
}

/** What a trigger event was about, for "that creature" / "that player" (CR 603.10). */
export interface TriggerInfo {
  /** A state trigger (CR 603.8) — at most one of it waiting or on the stack. */
  state?: true;
  object?: ObjectRef;
  player?: PlayerId;
  /** A stack entry the trigger is about (an ability that targeted something, for ward). */
  entry?: string;
  /** A "becomes the target" trigger: the permanent that became a target ("that creature"). */
  targeted?: ObjectRef;
  /** CR 603.10a: the object as it last existed on the battlefield. */
  lki?: { counters: Record<string, number> };
  /** How much happened ("that much life", "that many +1/+1 counters"): damage dealt, life gained or lost. */
  amount?: number;
  /** A cast trigger: the mana spent to cast the spell (CR 601.2h), as it was cast — if it's countered, still known. */
  manaSpent?: number;
  /** A cast trigger: the spell's mana value on the stack (X included, CR 202.3e) — if it's countered, still known. */
  mv?: number;
  /** Zaxara: a cast trigger's "X" — the value of X chosen for that spell (CR 107.3), still known if it's countered. */
  x?: number;
  /** CR 400.7f: a trigger on the enchanted permanent leaving — the Aura can be found in its owner's graveyard. */
  auraFind?: true;
  /** The Skullspore Nexus: the total power of the creatures that died together (as they last existed, CR 603.10a). */
  power?: number;
  /** Tokens the original ability created, for a delayed trigger ("sacrifice it at the next end step"). */
  created?: ObjectRef[];
  /** What the original effect put onto the battlefield, for a delayed trigger ("Exile those creatures …"). */
  movedOnto?: ObjectRef[];
  /** CR 603.12: what the resolution that created a reflexive ability rolled, and what it sacrificed (as it last existed). */
  dieResult?: number;
  lkiThisWay?: CostLKI;
}

interface StackBase {
  controller: PlayerId;
  /** CR 603.4: an intervening "if", checked again as it resolves. */
  condition?: ConditionNode;
  /** Absent when the players resolve it by hand. */
  program?: CompiledProgram;
  /** Chosen targets, one list per target spec. */
  targets: TargetRef[][];
  x: number;
  /** What the costs paid for it sacrificed or discarded. */
  costLKI?: CostLKI;
  /** CR 601.2d: how its divided damage is split, one amount per target chosen (in order). */
  division?: number[];
}

export type StackEntry =
  | (StackBase & { kind: 'spell'; object: ObjectId })
  | (StackBase & {
      kind: 'ability';
      id: string;
      source: ObjectRef;
      sourceName: string;
      text: string;
      /** True for abilities the engine can't run. */
      manual?: true;
      trigger?: TriggerInfo;
    });

/** A continuous effect from a resolved spell or ability (CR 611.2), locked to the objects it affected (CR 611.2c). */
export interface ContinuousEffect {
  id: string;
  timestamp: number;
  source: ObjectRef;
  controller: PlayerId;
  objects: ObjectRef[];
  power?: number;
  toughness?: number;
  keywords?: KeywordInstance[];
  rules?: RuleFlag[];
  combat?: CombatRules;
  /** Layer 6: keywords it loses ("loses flying until end of turn"). */
  loseKeywords?: string[];
  /** "can't have or gain hexproof": stripped whatever grants it. */
  cantHave?: string[];
  /** Layer 4: card types and subtypes it becomes; added to its own if `retainTypes` (CR 205.1b). */
  types?: string[];
  subtypes?: string[];
  retainTypes?: boolean;
  /** Layer 5: the colors it becomes. */
  colors?: Color[];
  /** Layer 5: "in addition to its other colors" — colors it gets as well. */
  addColors?: Color[];
  /** Layer 4: its creature types become these ("becomes a Bird"). */
  creatureTypes?: string[];
  /** Layer 4 (CR 305.7): its land types become these; it loses its rules-text abilities. */
  landTypes?: string[];
  /** Layer 6: "loses all abilities". */
  loseAbilities?: true;
  /** Layer 7b: power and toughness set to these values. */
  setPower?: number;
  setToughness?: number;
  /** Layer 7b: a granted "This creature's power and toughness are each equal to …" (Druid Class) — counted continuously
   * for the object; granted, it isn't a characteristic-defining ability (CR 604.3a), so it applies in 7b (CR 613.4b). */
  livePT?: { power: Amount; toughness: Amount };
  /** Layer 2 (CR 613.1b): this player controls the objects. */
  control?: PlayerId;
  /** Layer 7d (CR 613.4d): power and toughness switched. */
  switchPT?: true;
  /** CR 611.2a: "until end of turn", or for the rest of the game when no duration is stated. */
  until: 'eot' | 'game';
  /** CR 611.2b: "for as long as ~ remains tapped" — it ends once that object isn't tapped (or is gone). */
  whileTapped?: ObjectRef;
  /** Sower of Temptation: "for as long as ~ remains on the battlefield"; `player`: "for as long as you control ~". */
  whilePresent?: ObjectRef & { player?: PlayerId };
  /** Promise of Loyalty: "for as long as it has a vow counter on it" — each object for as long as it has one (CR 611.2b). */
  whileCounter?: string;
  /** "until your next turn": it ends as this player's next turn begins. */
  untilTurnOf?: PlayerId;
  /** "until the end of your next turn": it ends in the cleanup step of this turn. */
  throughTurn?: number;
}

/** CR 603.7: a delayed triggered ability waiting for its moment ("at the beginning of the next end step"). */
export interface DelayedTrigger {
  id: string;
  controller: PlayerId;
  source: ObjectRef;
  sourceName: string;
  text: string;
  /** CR 511.2: "at end of combat" is the end of combat step. */
  step: 'end' | 'upkeep' | 'end_of_combat' | 'main' | 'main1' | 'beginning_of_combat' | 'cleanup';
  createdTurn: number;
  createdStep: Step;
  effects: EffectNode[];
  /** CR 603.7c: it affects the same objects the original ability did. */
  targets: TargetRef[][];
  info?: TriggerInfo;
  /** "at the beginning of your next upkeep" (rebound): only on its controller's turn. */
  whose?: 'you';
  /** Phytotitan: "at the beginning of their next upkeep" — only on that player's turn. */
  whosePlayer?: PlayerId;
  /** Final Fortune: "At the beginning of that turn's end step" — the extra turn's, not this one's. */
  laterTurn?: true;
  /** "When you next cast an instant or sorcery spell this turn": fires on that event instead of a step. */
  on?: { who: 'you'; filter: ObjectFilter };
  /** Earthbend (CR 701.66a): "When that land dies or is put into exile" — this permanent leaving for those zones. */
  leaves?: ObjectRef;
  /** Ugin, the Ineffable: "When that token leaves the battlefield" — for any zone. */
  leavesAnyZone?: true;
}

/** CR 615: a prevention effect from a resolved spell or ability, this turn only. */
export interface PreventionShield {
  id: string;
  turn: number;
  /** Damage to this player or object; absent means any. */
  to?: TargetRef;
  /** Damage from this object; absent means any source. */
  by?: TargetRef;
  /** "all", or how much is left of "the next N damage" (CR 615.7). */
  amount: number | 'all';
  combat?: true;
  /** "The next time … would deal damage": used up by the first damage it prevents (CR 615.7). */
  once?: true;
  /** Obscuring Haze: "by creatures your opponents control" — whichever match as the damage would be dealt. */
  byFilter?: ObjectFilter;
  /** "to creatures you control" — likewise for permanents dealt damage. */
  toFilter?: ObjectFilter;
  /** Who "you" is for those filters. */
  controller?: PlayerId;
  /** Morningtide's Light: "Until your next turn, prevent all damage …" — it lasts until that player's next turn begins. */
  untilTurnOf?: PlayerId;
  /**
   * CR 615.5: "For each 1 damage prevented this way, …" (Inkshield), "If damage is prevented this way, ~ deals that much
   * damage to that source's controller" (Deflecting Palm) — done right after, with the amount prevented.
   */
  then?: PreventionFollowUp;
}

/** What a prevention effect does after it prevents damage (CR 615.5): its effects, who controls them, what made them. */
export interface PreventionFollowUp {
  effects: EffectNode[];
  controller: PlayerId;
  source?: ObjectRef;
  /** Brace for Impact: "put a +1/+1 counter on that creature" — the targets of the spell that made the shield. */
  targets?: TargetRef[][];
  /** Vigor: "that creature" is the permanent the damage would have been dealt to (else the source of the damage). */
  about?: 'recipient';
}

/** A triggered ability waiting to be put on the stack (CR 603.3). */
export interface PendingTrigger {
  id: string;
  controller: PlayerId;
  source: ObjectRef;
  sourceName: string;
  /** The ability itself (printed, or defined by a keyword). */
  ability: TriggeredAbility;
  info: TriggerInfo;
  /** Targets fixed in advance (a delayed trigger affects what its creator did, CR 603.7c). */
  boundTargets?: TargetRef[][];
}

/** A spell or ability partway through resolving, waiting on a player's choice. */
export interface Resolution {
  /** The stack entry being resolved (it may have left the stack, e.g. a spell that exiles itself). */
  entry: StackEntry;
  effects: EffectNode[];
  index: number;
  /** Scratch space for the current effect (cleared as each effect finishes). */
  memo: Record<string, unknown>;
  /** Targets still legal as it began to resolve (CR 608.2b). */
  targets: TargetRef[][];
  /** Controllers of targeted objects as resolution began, for "its controller" after it moves (CR 608.2h). */
  lki: Record<ObjectId, PlayerId>;
  /** CR 400.7j: objects this resolution moved to a public zone, by their new zone-change count — it can still find them. */
  found?: Record<ObjectId, number>;
  /** What the latest "create … token" effect created ("the token", "sacrifice it"). */
  created?: ObjectRef[];
  /** What the latest effect putting cards onto the battlefield put there ("They gain haste"). */
  movedOnto?: ObjectRef[];
  /** Permanents this resolution's proliferate put counters on (Ripples of Potential). */
  proliferated?: ObjectRef[];
  /** How many times this ability has resolved this turn, counting this time ("if this is the second time …"). */
  abilityCount?: number;
  /** Cosmium Confluence: "Put three +1/+1 counters on a Cave you control. It becomes …" — the one chosen. */
  chosenObject?: ObjectRef;
  /** "An opponent draws a card": the opponent chosen as this resolution needed one. */
  chosenOpponent?: PlayerId;
  /** CR 706.2: the result of the latest die roll this resolution made ("equal to the result"). */
  dieResult?: number;
  /** CR 608.2h: what this resolution sacrificed, as it last existed ("the sacrificed creature's power"). */
  lkiThisWay?: CostLKI;
  /** CR 701.38: the votes cast as this resolves, by option (or by object id, for a vote for objects). */
  votes?: Record<string, number>;
  /** CR 701.38: the objects with the most votes or tied for most votes. */
  voted?: ObjectRef[];
  /** Counters this resolution's remove-counters effects removed ("for each charge counter removed this way"). */
  countersRemoved?: number;
  /** Cards each player discarded as this resolved ("the greatest number of cards a player discarded this way"). */
  discarded?: Record<PlayerId, number>;
  /** Cards each player drew as this resolved (Cut a Deal: "for each opponent who drew a card this way"). */
  drew?: Record<PlayerId, number>;
  /** "the color of your choice", "the creature type of your choice" — chosen as this resolves. */
  chosen?: { color?: Color; colors?: Color[]; creatureType?: string; landType?: string };
  /** Patriarch's Bidding: the creature types each player chose as this resolved ("of a type chosen this way"). */
  chosenTypes?: string[];
  /** Life lost to this resolution's effects ("the total life lost this way", CR 702.101a). */
  lifeLost?: number;
  /** Myr Battlesphere: how many permanents "you may tap X untapped Myr" tapped. */
  tappedThisWay?: number;
  /** Damage this resolution's effects dealt ("You gain life equal to the damage dealt this way"). */
  damageDealt?: number;
  /** Hit the Mother Lode: the mana value of the card discovered (CR 701.57a). */
  discoveredMv?: number;
  /** CR 120.10: excess damage this resolution dealt to permanents ("the amount of excess damage dealt this way"). */
  excess?: number;
  /** What this resolution moved, by the effect that moved it ("for each creature destroyed this way"). */
  /** `controller`: who controlled it as it moved ("its controller creates a 2/2 green Boar creature token"). */
  moves?: { id: ObjectId; effect: string; from: ZoneName; to: ZoneName; types: string[]; subtypes?: string[]; controller: PlayerId; token?: true }[];
  /** Fangs of Kalonia, Spectacular Showdown: the permanents this resolution put counters on ("each creature that had a +1/+1
   * counter put on it this way"). */
  countersPut?: { id: ObjectId; zcc: number; counter: string }[];
  /** CR 705: the result of this resolution's coin flip. */
  flipWon?: boolean;
  /** Ral Zarek: "for each coin that comes up heads" — the flips won (and lost) as this resolves (CR 705.2). */
  flipsWon?: number;
  flipsLost?: number;
  /** CR 701.30d: "If you win" after "Clash with an opponent". */
  clashWon?: boolean;
}

/** A target prompt: the printed phrase and who or what can be chosen. */
export interface TargetPrompt {
  text: string;
  count: number;
  upTo: boolean;
  /** With `upTo`: the fewest that may be chosen. */
  min?: number;
  /** "from a single graveyard": every chosen object has the same owner. */
  sameOwner?: true;
  /** "For each opponent, … target … that player controls": each chosen object belongs to a different player. */
  perPlayer?: true;
  /** "… and up to one target creature that player controls": controlled by the player chosen for prompt N (or by the controller of the permanent chosen for it). */
  controlledByTarget?: number;
  /** Fiery Annihilation: "target Equipment attached to that creature" — only what's attached to that earlier target. */
  attachedToTarget?: number;
  candidates: Target[];
}

export type PendingChoice =
  | { kind: 'mulligan'; player: PlayerId }
  | { kind: 'bottom_cards'; player: PlayerId; count: number }
  /** CR 103.6a: cards in the opening hand that may begin the game on the battlefield (leylines). */
  /** `exileFor`: Gemstone Caverns — candidates that need a card from the hand exiled if chosen (CR 103.6a). */
  | { kind: 'opening_battlefield'; player: PlayerId; candidates: ObjectId[]; exileFor?: ObjectId[] }
  | { kind: 'discard_to_hand_size'; player: PlayerId; count: number }
  /** CR 502.3: permanents its controller may choose not to untap ("You may choose not to untap ~ during your untap step"). */
  | { kind: 'keep_tapped'; player: PlayerId; candidates: ObjectId[] }
  /** CR 502.3: Winter Orb — which `n` of these the active player untaps (`keep`, `chosen`: what's been chosen so far this step). */
  | { kind: 'untap_limit'; player: PlayerId; candidates: ObjectId[]; n: number; keep: ObjectId[]; chosen: ObjectId[][] }
  /** CR 702.52a: the active player may dredge instead of drawing in their draw step. */
  | { kind: 'dredge'; player: PlayerId; candidates: ObjectId[] }
  | { kind: 'legend_rule'; player: PlayerId; name: string; objects: ObjectId[] }
  | { kind: 'manual_resolution'; player: PlayerId; text: string; sourceName: string }
  /** `exertable`: attackers that may be exerted as they attack (CR 701.43d). */
  /** `enlisters`: attackers that may enlist, and `enlistable` the creatures they could tap (CR 702.154a). */
  | { kind: 'declare_attackers'; player: PlayerId; attackers: ObjectId[]; targets: AttackTarget[]; exertable?: ObjectId[]; enlisters?: ObjectId[]; enlistable?: ObjectId[] }
  | { kind: 'declare_blockers'; player: PlayerId; blockers: ObjectId[]; attackers: ObjectId[] }
  | { kind: 'assign_combat_damage'; player: PlayerId; choices: DamageChoice[] }
  /** CR 603.3c / 603.3d: modes and targets for a triggered ability as it goes on the stack. */
  | {
      kind: 'trigger_targets';
      player: PlayerId;
      trigger: string;
      sourceName: string;
      text: string;
      prompts: TargetPrompt[];
      /** used: modes that can't be chosen again ("choose one that hasn't been chosen this turn"). */
      modes?: { min: number; max: number; repeat?: true; used?: number[]; options: { text: string; prompts: TargetPrompt[] }[] };
    }
  /** reorder: "put them back in any order" — nothing goes to the bottom. */
  | { kind: 'scry'; player: PlayerId; objects: ObjectId[]; reorder?: true }
  | { kind: 'surveil'; player: PlayerId; objects: ObjectId[] }
  | { kind: 'discard'; player: PlayerId; count: number }
  | { kind: 'may'; player: PlayerId; text: string; sourceName: string }
  /** A choice among named options as something resolves ("Choose a creature type."). */
  | { kind: 'choose_option'; player: PlayerId; options: string[]; text: string; sourceName: string }
  /** CR 608.2g: cast this card now without paying its mana cost? (cascade, discover, rebound, "you may cast it …") */
  | { kind: 'cast_free'; player: PlayerId; object: ObjectId; sourceName: string; text: string }
  /** CR 707.10c: the copy's controller may choose new targets for it (or keep the current ones). */
  /** `object`: the copy — a spell's object, or the stack id of a copied ability (`ability` set). */
  /** mustChange: "change the target" — to another legal one, if there is one (CR 115.7a). */
  | { kind: 'copy_targets'; player: PlayerId; object: ObjectId; ability?: true; sourceName: string; text: string; prompts: TargetPrompt[]; current: Target[][]; mustChange?: true }
  /** CR 118.12: an optional cost paid as a spell or ability resolves ("you may pay {2}", "unless … pays {3}"). */
  /** x: the cost has {X} ("you may pay {X}"), the payer choosing it (no more than `max`, "where X is less than or equal to …"). */
  | { kind: 'pay'; player: PlayerId; cost: string; text: string; sourceName: string; x?: { max?: number } }
  /** CR 701.23a: the player looks through their library for cards matching the description. */
  /** sameLandType: the cards found must share a land type (Myriad Landscape). */
  | { kind: 'search'; player: PlayerId; candidates: ObjectId[]; count: number; mustFind: boolean; text: string; sameLandType?: true; totalMV?: { max: number; of: Record<ObjectId, number> }; distinctNames?: true }
  /** CR 701.21a: the player chooses permanents they control to sacrifice. */
  | { kind: 'sacrifice'; player: PlayerId; candidates: ObjectId[]; count: number }
  /** CR 701.34a: any number of permanents and players that have counters. */
  | { kind: 'proliferate'; player: PlayerId; objects: ObjectId[]; players: PlayerId[] }
  /** A choice of one or more objects ("choose an Army creature you control"). */
  /** revealed: cards every player sees while the choice is made (a revealed hand, CR 701.20a). */
  | {
      kind: 'choose_objects';
      player: PlayerId;
      candidates: ObjectId[];
      min: number;
      max: number;
      text: string;
      revealed?: ObjectId[];
      /** Other cards the chooser looks at (the top of their library). */
      seen?: ObjectId[];
      /** The answer's order matters. */
      ordered?: true;
      /** Sludge Titan: each chosen card stands for a different kind — the kinds each candidate can stand for. */
      kinds?: Record<ObjectId, number[]>;
      /** "… with total mana value N or less" (Lively Dirge): the chosen cards' mana values add up to `max` or less. */
      totalMV?: { max: number; of: Record<ObjectId, number> };
      /** Eerie Ultimatum: "… with different names". */
      distinctNames?: true;
    }
  /**
   * CR 614.12: a choice made as a permanent enters. pay_life / reveal: decline and it enters tapped
   * (reveal lists the cards that qualify); color / creature_type: pick one of `options`;
   * copy: one of `candidates` to enter as a copy of, or none (CR 707.5).
   */
  | {
      kind: 'as_enters';
      player: PlayerId;
      object: ObjectId;
      sourceName: string;
      text: string;
      choice: AsEntersNode['choice'];
      amount?: number;
      candidates?: ObjectId[];
      options?: string[];
    };

export type ChoiceAnswer =
  | { kind: 'mulligan'; keep: boolean }
  | { kind: 'bottom_cards'; objects: ObjectId[] }
  /** `exile`: a card from the hand for each chosen card that needs one (Gemstone Caverns), in order. */
  | { kind: 'opening_battlefield'; objects: ObjectId[]; exile?: ObjectId[] }
  | { kind: 'discard_to_hand_size'; objects: ObjectId[] }
  | { kind: 'keep_tapped'; objects: ObjectId[] }
  | { kind: 'untap_limit'; objects: ObjectId[] }
  | { kind: 'dredge'; object: ObjectId | null }
  | { kind: 'legend_rule'; keep: ObjectId }
  | { kind: 'manual_resolution'; done: true }
  | { kind: 'declare_attackers'; attacks: { attacker: ObjectId; target: AttackTarget }[]; exert?: ObjectId[]; enlist?: { attacker: ObjectId; tap: ObjectId }[] }
  | { kind: 'declare_blockers'; blocks: { blocker: ObjectId; attacker: ObjectId }[] }
  | { kind: 'assign_combat_damage'; assignments: Record<ObjectId, DamageAssignment[]> }
  | { kind: 'trigger_targets'; modes?: number[]; targets: Target[][]; divide?: number[] }
  | { kind: 'copy_targets'; targets?: Target[][] }
  | { kind: 'cast_free'; cast: boolean; targets?: Target[][]; modes?: number[] }
  /** CR 701.22a: cards to keep on top (first = top) and to put on the bottom. */
  | { kind: 'scry'; top: ObjectId[]; bottom: ObjectId[] }
  /** CR 701.25a: cards to keep on top (first = top) and to put into the graveyard. */
  | { kind: 'surveil'; top: ObjectId[]; graveyard: ObjectId[] }
  | { kind: 'discard'; objects: ObjectId[] }
  | { kind: 'may'; yes: boolean }
  | { kind: 'choose_option'; choice: string }
  | { kind: 'pay'; pay: boolean; x?: number }
  | { kind: 'search'; objects: ObjectId[] }
  | { kind: 'sacrifice'; objects: ObjectId[] }
  | { kind: 'proliferate'; objects: ObjectId[]; players: PlayerId[] }
  | { kind: 'choose_objects'; objects: ObjectId[] }
  /** pay_life: pay or not; reveal: the card revealed, or none; color / creature_type: the one chosen. */
  | { kind: 'as_enters'; pay?: boolean; reveal?: ObjectId | null; choice?: string; copy?: ObjectId | null; sacrifice?: ObjectId[] };

export type ManualOp =
  | { kind: 'move'; object: ObjectId; to: ZoneName; position?: 'top' | 'bottom' }
  | { kind: 'life'; target: PlayerId; delta: number }
  | { kind: 'tap'; object: ObjectId; tapped: boolean }
  | { kind: 'counters'; object: ObjectId; counter: string; delta: number }
  | { kind: 'draw'; count: number };

/** Choices made while paying costs that need them (CR 601.2h): what to sacrifice, what to discard. */
export interface CostChoices {
  sacrifice?: ObjectId[];
  discard?: ObjectId[];
  /** CR 702.122a: the creatures tapped to crew a Vehicle. */
  crew?: ObjectId[];
  /** Cards exiled to pay a cost ("Exile five other cards from your graveyard", escape). */
  exile?: ObjectId[];
  /** CR 107.4f: how each Phyrexian mana symbol is paid, in order — with mana or with 2 life (by default: mana when it can). */
  phyrexian?: ('life' | 'mana')[];
  /** CR 702.51a: creatures tapped to help cast a spell with convoke. */
  convoke?: ObjectId[];
  /** CR 702.66a: cards exiled from your graveyard for a spell with delve. */
  delve?: ObjectId[];
  /** CR 702.126a: artifacts tapped for a spell with improvise. */
  improvise?: ObjectId[];
  /** CR 702.174a: the opponent chosen as the gift cost is paid (the next opponent in turn order by default). */
  giftTo?: PlayerId;
  /** Ninjutsu, sneak: the unblocked attacking creature returned to its owner's hand (CR 702.49a, 702.190a). */
  returned?: ObjectId[];
  /** "Remove any number of storage counters from ~": how many (it's X for the ability). */
  counters?: number;
  /** CR 702.47a: cards revealed from your hand to splice onto the spell, in the order their text happens. */
  splice?: ObjectId[];
  /** "Reveal a Dragon card from your hand", "behold a Dragon" (CR 701.4a): the card or permanent. */
  reveal?: ObjectId[];
  /** CR 701.68a: the creature you control that gets the -1/-1 counters when you blight. */
  blighted?: ObjectId[];
  /** CR 701.61a: forage by sacrificing a Food (in `sacrifice`) rather than exiling three cards (in `exile`). */
  forageFood?: boolean;
  /** Forge Anew, Bruenor Battlehammer: pay {0} rather than this equip ability's cost (the first equip ability this turn). */
  freeEquip?: boolean;
  /** CR 701.67a: artifacts and creatures tapped to pay a waterbend cost's generic mana. */
  waterbend?: ObjectId[];
  /** "Remove a counter from a permanent you control": which counters, from which permanents. */
  removed?: { object: ObjectId; counter: string; n: number }[];
}

export type Action =
  | { type: 'pass'; player: PlayerId }
  | { type: 'choose'; player: PlayerId; answer: ChoiceAnswer }
  | { type: 'play_land'; player: PlayerId; object: ObjectId; face?: number }
  /** CR 702.37e / 116.2b: turn a face-down permanent you control face up by paying its cost (a special action). */
  | { type: 'turn_face_up'; player: PlayerId; object: ObjectId; autoTap?: boolean }
  /** CR 709.5e: pay a locked door's mana cost to unlock it (a special action). */
  | { type: 'unlock'; player: PlayerId; object: ObjectId; half: 0 | 1; autoTap?: boolean }
  /** Special actions that exile a card from hand to cast later: foretell (CR 702.143a), plot (CR 702.170a), suspend (CR 702.62a). */
  | { type: 'foretell' | 'plot' | 'suspend'; player: PlayerId; object: ObjectId; autoTap?: boolean }
  /** `choice`: which option or color — or, for "any combination of colors", the mix ("GGU"). */
  /** `bonus`: for "whenever … is tapped for mana, its controller adds an additional one mana of any color" (Fertile Ground), each such trigger's color (or option). */
  | { type: 'activate_mana'; player: PlayerId; object: ObjectId; ability: number; choice?: number | ManaColor | ManaMix; costs?: CostChoices; bonus?: (number | ManaColor)[] }
  | {
      type: 'cast';
      player: PlayerId;
      object: ObjectId;
      face?: number;
      x?: number;
      autoTap?: boolean;
      /** CR 702.33a: pay the kicker cost too. */
      /** Kicked (CR 702.33a), or how many times for multikicker (CR 702.33c). */
      kicked?: boolean | number;
      /** CR 118.9: an alternative cost to cast it with, by id ("evoke", "dash", "escape", "alt"). */
      alt?: string;
      /** CR 601.2f: optional additional costs paid, by id ("buyback", "entwine"). */
      extras?: string[];
      /** One list per target the spell asks for (CR 601.2c). */
      targets?: Target[][];
      /** Chosen modes of a modal spell, by index (CR 700.2a). */
      modes?: number[];
      /** What to sacrifice or discard for additional costs (CR 601.2f). */
      costs?: CostChoices;
      /** CR 601.2d: how to divide its damage among the targets (default: evenly). */
      divide?: number[];
    }
  | {
      type: 'activate';
      player: PlayerId;
      object: ObjectId;
      /** Index into activatedAbilities() for that permanent. */
      ability: number;
      x?: number;
      autoTap?: boolean;
      targets?: Target[][];
      modes?: number[];
      costs?: CostChoices;
      divide?: number[];
    }
  | { type: 'activate_manual'; player: PlayerId; object: ObjectId; line: number; autoTap?: boolean }
  | { type: 'manual'; player: PlayerId; op: ManualOp }
  | { type: 'concede'; player: PlayerId };

export type GameEvent =
  | { type: 'game_started'; order: PlayerId[] }
  | { type: 'shuffled'; player: PlayerId }
  /** nth: which card this is that the player drew this turn. */
  /** `firstInDrawStep`: the first card the active player draws in their draw step (CR 504.1). */
  | { type: 'drew'; player: PlayerId; object: ObjectId; nth?: number; revealed?: true; firstInDrawStep?: true }
  | { type: 'mulligan'; player: PlayerId; count: number }
  | { type: 'kept'; player: PlayerId; bottomed: number }
  | { type: 'turn_began'; turn: number; player: PlayerId }
  | { type: 'step'; step: Step }
  | { type: 'priority'; player: PlayerId }
  | { type: 'passed'; player: PlayerId }
  /** `controller` is who controlled it just before it moved (for "a creature you control dies", CR 603.10a). */
  | {
      type: 'moved';
      object: ObjectId;
      from: ZoneName;
      to: ZoneName;
      controller: PlayerId;
      card: string;
      face: number;
      token?: true;
      /** Counters it had, when it left the battlefield (CR 603.10a look-back). */
      counters?: Record<string, number>;
      /** Kodama of the East Tree: the permanent whose ability put it onto the battlefield. */
      by?: ObjectRef;
    }
  | { type: 'control_changed'; object: ObjectId; controller: PlayerId }
  | { type: 'prevented'; source: ObjectId; amount: number; to?: DamageRecipient }
  | { type: 'created'; object: ObjectId; controller: PlayerId }
  | { type: 'attached'; object: ObjectId; to: ObjectId; player?: true }
  /** Grafted Exoskeleton: "Whenever this Equipment becomes unattached from a permanent" — what it was attached to. */
  | { type: 'unattached'; object: ObjectId; from: ObjectId; fromZcc: number }
  | { type: 'became_copy'; object: ObjectId; of: ObjectId }
  | { type: 'copied'; object: ObjectId; of: ObjectId; controller: PlayerId }
  /** CR 722.3: a permanent became prepared or unprepared. */
  | { type: 'prepared'; object: ObjectId; prepared: boolean }
  | { type: 'turned_face_up'; object: ObjectId }
  /** CR 731.1a: day became night or night became day (or it first became one). */
  | { type: 'day_night'; to: 'day' | 'night'; from?: 'day' | 'night' }
  /** CR 702.179: a player's speed changed; CR 702.131: a player got the city's blessing. */
  | { type: 'speed'; player: PlayerId; speed: number }
  | { type: 'coin_flip'; player: PlayerId; won: boolean }
  /** CR 701.43: a creature was exerted as it attacked. */
  | { type: 'exerted'; object: ObjectId; player: PlayerId }
  /** CR 701.30: a player clashed (and whether they won). */
  | { type: 'clashed'; player: PlayerId; won: boolean }
  | { type: 'goaded'; object: ObjectId; by: PlayerId }
  | { type: 'city_blessing'; player: PlayerId }
  /** CR 701.9a: discarded; `madness`: exiled instead (CR 702.35a). */
  | { type: 'discarded'; object: ObjectId; player: PlayerId; madness?: true }
  | { type: 'triggered'; source: ObjectId; text: string; controller: PlayerId }
  /** `by`: who controls the spell or ability that countered it. */
  | { type: 'countered'; object: ObjectId; by?: PlayerId }
  /** CR 608.2b: every target was illegal, so it didn't resolve. */
  | { type: 'fizzled'; entry: StackEntry }
  | { type: 'regenerated'; object: ObjectId }
  /** A spell (object) or ability (entry) was put on the stack targeting this object. */
  /** `first`: the first time this turn that player targeted it (set as the turn log records it). */
  | { type: 'became_target'; object: ObjectId; spell?: ObjectId; entry?: string; controller: PlayerId; first?: true }
  | { type: 'transformed'; object: ObjectId; face: number }
  | { type: 'scried'; player: PlayerId; top: number; bottom: number }
  /** CR 701.61a */
  | { type: 'foraged'; player: PlayerId }
  | { type: 'surveilled'; player: PlayerId; top: number; graveyard: number }
  /** CR 701.20a: cards shown to every player. */
  | { type: 'revealed'; player: PlayerId; objects: ObjectId[] }
  /** CR 614.12: a choice made as a permanent entered. */
  | { type: 'chosen'; object: ObjectId; choice: string }
  | { type: 'player_counters'; player: PlayerId; counter: string; delta: number; by?: PlayerId }
  | { type: 'class_level'; object: ObjectId; level: number }
  /** CR 725.3: a player became the monarch. */
  | { type: 'monarch'; player: PlayerId }
  /** CR 701.44b: a permanent explored. */
  | { type: 'explored'; object: ObjectId; land: boolean }
  | { type: 'tapped'; object: ObjectId; tapped: boolean }
  | { type: 'mana_added'; player: PlayerId; mana: ManaColor[] }
  | { type: 'land_played'; player: PlayerId; object: ObjectId; from?: ZoneName }
  /** CR 701.23: a player searched a library (`owner`'s). */
  | { type: 'searched'; player: PlayerId; owner: PlayerId }
  | { type: 'proliferated'; player: PlayerId }
  /** `nth`: which spell this is for its caster this turn (1 = their first). */
  | { type: 'cast'; player: PlayerId; object: ObjectId; nth?: number; manaBefore?: number; manaSpent?: number }
  /** CR 700.13: a player committed a crime (a spell or ability of theirs targets an opponent or what they have). */
  | { type: 'crime'; player: PlayerId }
  /** CR 701.21a: a permanent was sacrificed (by its controller). */
  | { type: 'sacrificed'; object: ObjectId; player: PlayerId; exploitedBy?: ObjectId }
  /** CR 701.17a: cards a player milled at once (Mirelurk Queen, Glowing One). */
  | { type: 'milled'; player: PlayerId; objects: ObjectId[] }
  /** CR 701.37a: a permanent became monstrous; `amount` is its N (CR 701.37c). */
  | { type: 'became_monstrous'; object: ObjectId; amount: number }
  /** CR 701.54a: the Ring tempted a player, who chose `object` (if they had a creature) as their Ring-bearer. */
  | { type: 'ring_tempted'; player: PlayerId; object?: ObjectId }
  /** CR 309.4c: a player moved their venture marker into a room (the room ability triggers). */
  | { type: 'room_entered'; player: PlayerId; card: string; room: string }
  /** CR 309.7 */
  | { type: 'dungeon_completed'; player: PlayerId; card: string }
  /** CR 726.3: a player took the initiative. */
  | { type: 'initiative'; player: PlayerId }
  /** CR 702.26: a permanent phased out or in. */
  | { type: 'phased'; object: ObjectId; out: boolean }
  /** CR 701.38: a player voted. */
  | { type: 'voted'; player: PlayerId; choice: string; object?: ObjectId }
  /** CR 706: a player rolled a die (its result after modifiers). */
  | { type: 'die_rolled'; player: PlayerId; sides: number; result: number }
  /** CR 701.59: a player collected evidence. */
  | { type: 'evidence_collected'; player: PlayerId }
  /** CR 709.5h–i: a Room half was unlocked (`full`: now both are). */
  | { type: 'unlocked'; object: ObjectId; half: 0 | 1; player: PlayerId; full: boolean }
  /** CR 509.1: every defending player has declared blockers (or had none to declare). */
  | { type: 'blockers_done' }
  /** `entry`: the ability on the stack; `loyalty`: a loyalty ability (CR 606). Mana abilities don't use the stack and aren't reported. */
  | { type: 'ability_activated'; player: PlayerId; source: ObjectId; text: string; entry: string; loyalty?: true }
  | { type: 'resolved'; entry: StackEntry }
  /** `firstGain`: the first time this player gained life this turn (set as the turn log records it). */
  | { type: 'life'; player: PlayerId; delta: number; life: number; firstGain?: true; firstLoss?: true }
  /** `by`: the player who put them on ("Whenever you put one or more +1/+1 counters on …"). */
  | { type: 'counters'; object: ObjectId; counter: string; delta: number; by?: PlayerId }
  | { type: 'manual'; player: PlayerId; op: ManualOp }
  | { type: 'attacks_declared'; attacks: { attacker: ObjectId; target: AttackTarget }[] }
  | { type: 'blocks_declared'; player: PlayerId; blocks: { blocker: ObjectId; attacker: ObjectId }[] }
  | { type: 'damage'; source: ObjectId; /** CR 400.7: the object it was as it dealt the damage. */ sourceZcc?: number; to: DamageRecipient; amount: number; combat: boolean }
  | { type: 'player_lost'; player: PlayerId; reason: string }
  | { type: 'game_over'; winner: PlayerId | null };

export interface GameState {
  /** "Choose one that hasn't been chosen": the modes each object's ability had chosen (keyed by object, zcc and text). */
  modesChosen?: Record<string, { turn: number; modes: number[] }>;
  /** High Tide: triggered mana abilities a resolved spell set up for the rest of this turn. */
  manaTriggers?: { controller: PlayerId; ability: TriggeredAbility; turn: number }[];
  /**
   * CR 603.7: "Whenever that creature deals combat damage to a player this turn, …" — triggered abilities a resolved spell
   * or ability created for the rest of the turn. `targets`: the creator's targets, which the ability refers to.
   */
  turnTriggers?: { id: string; controller: PlayerId; source: ObjectRef; sourceName: string; ability: TriggeredAbility; turn: number; targets?: TargetRef[][] }[];
  config: GameConfig;
  /** Definitions of every card in this game, so a game is self-contained and replayable. */
  cards: Record<string, CardDef>;
  players: Record<PlayerId, PlayerState>;
  /** Seating / turn order. */
  order: PlayerId[];
  objects: Record<ObjectId, GameObject>;
  zones: {
    library: Record<PlayerId, ObjectId[]>; // index 0 is the top
    hand: Record<PlayerId, ObjectId[]>;
    graveyard: Record<PlayerId, ObjectId[]>; // last is the top
    battlefield: ObjectId[];
    exile: ObjectId[];
    command: ObjectId[];
  };
  /** Last entry is the top of the stack. */
  stack: StackEntry[];
  turn: number;
  active: PlayerId;
  firstPlayer: PlayerId;
  step: Step;
  priority: PlayerId | null;
  /** Players who have passed in succession since the last action (CR 117.4). */
  passed: PlayerId[];
  pending: PendingChoice | null;
  /** True once the opening-hand process has finished. */
  started: boolean;
  /** Progress of the London mulligan (CR 103.5) while hands are being decided. */
  /** `actions`: players still to take opening-hand actions (CR 103.6), in turn order. */
  opening: { undecided: PlayerId[]; mulligans: PlayerId[]; bottoms: { player: PlayerId; count: number }[]; actions?: PlayerId[] } | null;
  /** A cleanup step in which SBAs happened gets another cleanup step. */
  extraCleanup: boolean;
  /** CR 723.1: a resolving "End the turn." — done once the spell or ability has finished resolving. */
  endTurn?: true;
  /** Present during the combat phase. */
  combat: CombatState | null;
  /** Combat damage dealt to each player by each commander (CR 903.10a). */
  commanderDamage: Record<PlayerId, Record<ObjectId, number>>;
  /** How many times each player has cast each commander from the command zone (CR 903.8). */
  commanderCasts: Record<ObjectId, number>;
  /** Continuous effects from resolved spells and abilities (CR 611.2). */
  effects: ContinuousEffect[];
  /** Triggered abilities waiting to go on the stack (CR 603.3). */
  triggers: PendingTrigger[];
  /** The spell or ability that is resolving, when it stopped for a choice. */
  resolving: Resolution | null;
  /** CR 613.7: the timestamp clock. */
  clock: number;
  /** Delayed triggered abilities (CR 603.7). */
  delayed: DelayedTrigger[];
  /** Prevention shields (CR 615). */
  prevention: PreventionShield[];
  /** CR 615.12: "Damage can't be prevented this turn" — the turn it applies to. */
  unpreventableTurn?: number;
  /** "The next spell you cast this turn can't be countered" / "costs {1} less to cast" — used up by that spell. */
  nextSpell?: { id: string; player: PlayerId; turn: number; filter: ObjectFilter; source: ObjectRef; uncounterable?: true; reduce?: number; keyword?: string; flash?: true }[];
  /** Rules changes for players that last a while: "you gain protection from everything until your next turn". */
  /** `filter`: a rule for some spells only (Teferi, Time Raveler: "you may cast sorcery spells as though they had flash"). */
  playerEffects?: { player: PlayerId; rule: PlayerRule; lastTurn: number; filter?: ObjectFilter; amount?: number; timestamp?: number }[];
  /** CR 101.2: "Target player can't cast spells this turn", "Until your next turn, your opponents can't cast …". */
  castBans?: { players: PlayerId[]; filter?: ObjectFilter; controller: PlayerId; lastTurn: number; fromZones?: string[] }[];
  /** CR 610.3: objects exiled "until ~ leaves the battlefield", and the permanent they wait on. */
  /** `monarch`: Palace Jailer's "until an opponent becomes the monarch" (the monarch when it was exiled, then as it changes). */
  exiledUntil?: { source: ObjectRef; object: ObjectRef; monarch?: { controller: PlayerId; was: PlayerId | null } }[];
  /** Animate Dead: the creature an Aura put onto the battlefield — the only thing it can enchant now, and what it sacrifices (CR 607.2). */
  reanimated?: { aura: ObjectRef; creature: ObjectRef }[];
  /** CR 608.2h: power and toughness of permanents as they last existed on the battlefield, by object. */
  lastKnown?: Record<ObjectId, { zcc: number; controller?: PlayerId; power: number; toughness: number; counters?: Record<string, number>; modified?: boolean; types?: string[]; subtypes?: string[]; keywords?: string[]; enchantedPlayer?: PlayerId; attachedTo?: ObjectRef; copyOf?: { card: string; face: number }; granted?: AbilityNode[]; faceDown?: GameObject['faceDown']; chosen?: GameObject['chosen'] }>;
  /** Cards a player may play or cast from where they are (impulse draw: "you may play that card this turn"). */
  /** `firstTurn`: "During your next turn, you may play that card" starts later. */
  /** `free`: "… without paying its mana cost" (Dauthi Voidwalker). */
  /** `cost`: airbend (CR 701.65a) — "by paying {2} rather than paying its mana cost". */
  /** anyColor: "… and you may spend mana as though it were mana of any color to cast that spell" (CR 609.4b); 'type': "… of any type". */
  /** exileOnLeave: "If that spell would be put into a graveyard, exile it instead." (Dire Fleet Daredevil; CR 614.1a). */
  mayPlay?: { object: ObjectRef; player: PlayerId; mode: 'play' | 'cast'; lastTurn: number; firstTurn?: number; untilEndStep?: true; free?: true; cost?: string; anyColor?: true | 'type'; exileOnLeave?: true }[];
  /** Chainer, Nightmare Adept: "You may cast a creature spell from your graveyard this turn." — one spell, this turn. */
  graveyardGrants?: { player: PlayerId; filter: ObjectFilter; turn: number; key: string }[];
  /** CR 725: the player who is the monarch, once someone has become it. */
  monarch?: PlayerId | null;
  /** CR 614.12: permanents that just entered and still need their "as ~ enters" choice made. */
  asEnters?: { object: ObjectId; zcc: number; node: AsEntersNode }[];
  /** CR 500.7: extra turns to take, the most recently created first. */
  extraTurns?: PlayerId[];
  /** CR 731.1: the game's day/night designation, once it has one. */
  dayNight?: 'day' | 'night';
  /** Events whose triggers wait for a copy choice (CR 707.5). */
  heldEvents?: GameEvent[];
  /** What happened this turn, and how many spells each player cast last turn. */
  turnLog: TurnLog;
  /** Approach of the Second Sun: the names of the spells each player has cast this game (CR 601.2i), in order. */
  castNames?: Record<PlayerId, string[]>;
  /** CR 726.1: the player who has the initiative. */
  initiative?: PlayerId;
  /** CR 702.26b: phased-out permanents — still on the battlefield, but not in its list (they're treated as though they don't exist). */
  phasedOut?: ObjectId[];
  /** CR 500.8: additional combat phases to come after the current phase (each maybe followed by a main phase). */
  extraPhases?: { main: boolean; begin?: { effects: EffectNode[]; controller: PlayerId; source: ObjectRef; sourceName: string } }[];
  /** The phases being added now: whether a main phase follows this combat, and the step the turn goes back to. */
  inExtra?: { main: boolean; then: Step; mainNow?: true };
  lastTurnSpells: Record<PlayerId, number>;
  winner: PlayerId | null;
  over: boolean;
  rng: number;
  nextId: number;
}

export type ApplyResult = { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: string };

export class RulesError extends Error {}
