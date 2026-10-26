import type { AbilityNode, AsEntersNode, ObjectFilter, CardDef, Color, CombatRules, ConditionNode, EffectNode, KeywordInstance, RuleFlag, TargetSpec, TriggeredAbility } from '@mtg/schema';
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

export interface PlayerState {
  id: PlayerId;
  name: string;
  life: number;
  poison: number;
  /** CR 122.1: other counters a player can have — energy (CR 107.14), experience, rad. */
  counters?: Record<string, number>;
  pool: ManaPool;
  landsPlayedThisTurn: number;
  /** Set when the player attempted to draw from an empty library since the last SBA check. */
  drewFromEmptyLibrary: boolean;
  lost: boolean;
  mulligans: number;
  keptHand: boolean;
}

export interface GameObject {
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
  /** CR 613.7d: set when it enters a zone; orders continuous effects from its static abilities. */
  timestamp: number;
  /** The object an Aura or Equipment is attached to (CR 701.3). */
  attachedTo?: ObjectRef;
  /** CR 114.1: an emblem in the command zone (not a card or a permanent). */
  emblem?: true;
  /** CR 707.2: the card (and face) whose copiable values this permanent has, if it's a copy. */
  copyOf?: { card: string; face: number };
  /** CR 303.4: the player an Aura with "enchant player" is attached to. */
  attachedToPlayer?: PlayerId;
  /** CR 701.19a: regeneration shields until end of turn. */
  regenShields?: number;
  /** "Activate only once each turn": ability index → turn it was last activated. */
  activatedTurn?: Record<number, number>;
  /** "This ability triggers only once each turn": ability index → turn it last triggered. */
  triggeredTurn?: Record<number, number>;
  /** CR 107.3m: the X paid for the spell it was, for its enters abilities. */
  x?: number;
  /** CR 701.37b: monstrous until it leaves the battlefield. */
  monstrous?: true;
  /** CR 702.34a: cast with flashback — exiled instead of going anywhere else when it leaves the stack. */
  exileOnLeave?: true;
  /** How it was cast, kept as the spell becomes a permanent ("if it was kicked", "if you cast it"). */
  /**
   * How it was cast. `before`: how many spells had been cast this turn before it (storm, CR 702.40a).
   * A copy of a spell wasn't cast (CR 707.10) but keeps the choices made for the original, like kicker.
   */
  cast?: { by: PlayerId; from: ZoneName; kicked?: true; before?: number; copy?: true; paid?: string[] };
  /** CR 707.10: a copy of a spell (it ceases to exist off the stack, CR 704.5e). */
  spellCopy?: true;
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
  /** CR 607.2a: the permanent whose ability exiled this card (for "the exiled card"). */
  exiledBy?: ObjectRef;
  /** CR 614.12: what was chosen as it entered ("As ~ enters, choose a color"). */
  chosen?: { color?: Color; creatureType?: string };
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
  blockers: Record<ObjectId, { zcc: number; blocking: ObjectId }>;
  attackersDeclared: boolean;
  /** Defending players still to declare blockers, in APNAP order (CR 802.4). */
  toDeclareBlockers: PlayerId[];
  /** Creatures that had first strike or double strike when a first-strike damage step began (CR 510.4). */
  firstStrikers: ObjectId[] | null;
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
  suggested: DamageAssignment[];
}

/** A target as a player picks it. */
export type Target = { kind: 'player'; player: PlayerId } | { kind: 'object'; object: ObjectId };

/** A chosen target as stored: an object target goes stale if the object changes zones (CR 608.2b). */
export type TargetRef = { kind: 'player'; player: PlayerId } | { kind: 'object'; id: ObjectId; zcc: number };

/** What the engine runs for a spell or ability: target specs and effects, with modes already chosen. */
export interface CompiledProgram {
  specs: TargetSpec[];
  effects: EffectNode[];
  /** A chosen mode the compiler couldn't read: players resolve it by hand. */
  manual?: true;
}

/** What a trigger event was about, for "that creature" / "that player" (CR 603.10). */
export interface TriggerInfo {
  object?: ObjectRef;
  player?: PlayerId;
  /** A stack entry the trigger is about (an ability that targeted something, for ward). */
  entry?: string;
  /** CR 603.10a: the object as it last existed on the battlefield. */
  lki?: { counters: Record<string, number> };
  /** How much happened ("that much life", "that many +1/+1 counters"): damage dealt, life gained or lost. */
  amount?: number;
  /** Tokens the original ability created, for a delayed trigger ("sacrifice it at the next end step"). */
  created?: ObjectRef[];
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
  /** Layer 4: card types and subtypes it becomes; added to its own if `retainTypes` (CR 205.1b). */
  types?: string[];
  subtypes?: string[];
  retainTypes?: boolean;
  /** Layer 5: the colors it becomes. */
  colors?: Color[];
  /** Layer 7b: power and toughness set to these values. */
  setPower?: number;
  setToughness?: number;
  /** Layer 2 (CR 613.1b): this player controls the objects. */
  control?: PlayerId;
  /** CR 611.2a: "until end of turn", or for the rest of the game when no duration is stated. */
  until: 'eot' | 'game';
}

/** CR 603.7: a delayed triggered ability waiting for its moment ("at the beginning of the next end step"). */
export interface DelayedTrigger {
  id: string;
  controller: PlayerId;
  source: ObjectRef;
  sourceName: string;
  text: string;
  step: 'end' | 'upkeep';
  createdTurn: number;
  createdStep: Step;
  effects: EffectNode[];
  /** CR 603.7c: it affects the same objects the original ability did. */
  targets: TargetRef[][];
  info?: TriggerInfo;
  /** "When you next cast an instant or sorcery spell this turn": fires on that event instead of a step. */
  on?: { who: 'you'; filter: ObjectFilter };
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
}

/** A target prompt: the printed phrase and who or what can be chosen. */
export interface TargetPrompt {
  text: string;
  count: number;
  upTo: boolean;
  candidates: Target[];
}

export type PendingChoice =
  | { kind: 'mulligan'; player: PlayerId }
  | { kind: 'bottom_cards'; player: PlayerId; count: number }
  | { kind: 'discard_to_hand_size'; player: PlayerId; count: number }
  | { kind: 'legend_rule'; player: PlayerId; name: string; objects: ObjectId[] }
  | { kind: 'manual_resolution'; player: PlayerId; text: string; sourceName: string }
  | { kind: 'declare_attackers'; player: PlayerId; attackers: ObjectId[]; targets: AttackTarget[] }
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
      modes?: { min: number; max: number; options: { text: string; prompts: TargetPrompt[] }[] };
    }
  | { kind: 'scry'; player: PlayerId; objects: ObjectId[] }
  | { kind: 'surveil'; player: PlayerId; objects: ObjectId[] }
  | { kind: 'discard'; player: PlayerId; count: number }
  | { kind: 'may'; player: PlayerId; text: string; sourceName: string }
  /** CR 707.10c: the copy's controller may choose new targets for it (or keep the current ones). */
  | { kind: 'copy_targets'; player: PlayerId; object: ObjectId; sourceName: string; text: string; prompts: TargetPrompt[]; current: Target[][] }
  /** CR 118.12: an optional cost paid as a spell or ability resolves ("you may pay {2}", "unless … pays {3}"). */
  | { kind: 'pay'; player: PlayerId; cost: string; text: string; sourceName: string }
  /** CR 701.23a: the player looks through their library for cards matching the description. */
  | { kind: 'search'; player: PlayerId; candidates: ObjectId[]; count: number; mustFind: boolean; text: string }
  /** CR 701.21a: the player chooses permanents they control to sacrifice. */
  | { kind: 'sacrifice'; player: PlayerId; candidates: ObjectId[]; count: number }
  /** CR 701.34a: any number of permanents and players that have counters. */
  | { kind: 'proliferate'; player: PlayerId; objects: ObjectId[]; players: PlayerId[] }
  /** A choice of one or more objects ("choose an Army creature you control"). */
  | { kind: 'choose_objects'; player: PlayerId; candidates: ObjectId[]; min: number; max: number; text: string }
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
  | { kind: 'discard_to_hand_size'; objects: ObjectId[] }
  | { kind: 'legend_rule'; keep: ObjectId }
  | { kind: 'manual_resolution'; done: true }
  | { kind: 'declare_attackers'; attacks: { attacker: ObjectId; target: AttackTarget }[] }
  | { kind: 'declare_blockers'; blocks: { blocker: ObjectId; attacker: ObjectId }[] }
  | { kind: 'assign_combat_damage'; assignments: Record<ObjectId, DamageAssignment[]> }
  | { kind: 'trigger_targets'; modes?: number[]; targets: Target[][] }
  | { kind: 'copy_targets'; targets?: Target[][] }
  /** CR 701.22a: cards to keep on top (first = top) and to put on the bottom. */
  | { kind: 'scry'; top: ObjectId[]; bottom: ObjectId[] }
  /** CR 701.25a: cards to keep on top (first = top) and to put into the graveyard. */
  | { kind: 'surveil'; top: ObjectId[]; graveyard: ObjectId[] }
  | { kind: 'discard'; objects: ObjectId[] }
  | { kind: 'may'; yes: boolean }
  | { kind: 'pay'; pay: boolean }
  | { kind: 'search'; objects: ObjectId[] }
  | { kind: 'sacrifice'; objects: ObjectId[] }
  | { kind: 'proliferate'; objects: ObjectId[]; players: PlayerId[] }
  | { kind: 'choose_objects'; objects: ObjectId[] }
  /** pay_life: pay or not; reveal: the card revealed, or none; color / creature_type: the one chosen. */
  | { kind: 'as_enters'; pay?: boolean; reveal?: ObjectId | null; choice?: string; copy?: ObjectId | null };

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
}

export type Action =
  | { type: 'pass'; player: PlayerId }
  | { type: 'choose'; player: PlayerId; answer: ChoiceAnswer }
  | { type: 'play_land'; player: PlayerId; object: ObjectId; face?: number }
  | { type: 'activate_mana'; player: PlayerId; object: ObjectId; ability: number; choice?: number | ManaColor; costs?: CostChoices }
  | {
      type: 'cast';
      player: PlayerId;
      object: ObjectId;
      face?: number;
      x?: number;
      autoTap?: boolean;
      /** CR 702.33a: pay the kicker cost too. */
      kicked?: boolean;
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
    }
  | { type: 'activate_manual'; player: PlayerId; object: ObjectId; line: number; autoTap?: boolean }
  | { type: 'manual'; player: PlayerId; op: ManualOp }
  | { type: 'concede'; player: PlayerId };

export type GameEvent =
  | { type: 'game_started'; order: PlayerId[] }
  | { type: 'shuffled'; player: PlayerId }
  | { type: 'drew'; player: PlayerId; object: ObjectId }
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
    }
  | { type: 'control_changed'; object: ObjectId; controller: PlayerId }
  | { type: 'prevented'; source: ObjectId; amount: number }
  | { type: 'created'; object: ObjectId; controller: PlayerId }
  | { type: 'attached'; object: ObjectId; to: ObjectId; player?: true }
  | { type: 'became_copy'; object: ObjectId; of: ObjectId }
  | { type: 'copied'; object: ObjectId; of: ObjectId; controller: PlayerId }
  | { type: 'triggered'; source: ObjectId; text: string; controller: PlayerId }
  | { type: 'countered'; object: ObjectId }
  /** CR 608.2b: every target was illegal, so it didn't resolve. */
  | { type: 'fizzled'; entry: StackEntry }
  | { type: 'regenerated'; object: ObjectId }
  /** A spell (object) or ability (entry) was put on the stack targeting this object. */
  | { type: 'became_target'; object: ObjectId; spell?: ObjectId; entry?: string; controller: PlayerId }
  | { type: 'transformed'; object: ObjectId; face: number }
  | { type: 'scried'; player: PlayerId; top: number; bottom: number }
  | { type: 'surveilled'; player: PlayerId; top: number; graveyard: number }
  /** CR 701.20a: cards shown to every player. */
  | { type: 'revealed'; player: PlayerId; objects: ObjectId[] }
  /** CR 614.12: a choice made as a permanent entered. */
  | { type: 'chosen'; object: ObjectId; choice: string }
  | { type: 'player_counters'; player: PlayerId; counter: string; delta: number }
  | { type: 'class_level'; object: ObjectId; level: number }
  /** CR 725.3: a player became the monarch. */
  | { type: 'monarch'; player: PlayerId }
  /** CR 701.44b: a permanent explored. */
  | { type: 'explored'; object: ObjectId; land: boolean }
  | { type: 'tapped'; object: ObjectId; tapped: boolean }
  | { type: 'mana_added'; player: PlayerId; mana: ManaColor[] }
  | { type: 'land_played'; player: PlayerId; object: ObjectId }
  | { type: 'cast'; player: PlayerId; object: ObjectId }
  | { type: 'ability_activated'; player: PlayerId; source: ObjectId; text: string }
  | { type: 'resolved'; entry: StackEntry }
  | { type: 'life'; player: PlayerId; delta: number; life: number }
  | { type: 'counters'; object: ObjectId; counter: string; delta: number }
  | { type: 'manual'; player: PlayerId; op: ManualOp }
  | { type: 'attacks_declared'; attacks: { attacker: ObjectId; target: AttackTarget }[] }
  | { type: 'blocks_declared'; player: PlayerId; blocks: { blocker: ObjectId; attacker: ObjectId }[] }
  | { type: 'damage'; source: ObjectId; to: DamageRecipient; amount: number; combat: boolean }
  | { type: 'player_lost'; player: PlayerId; reason: string }
  | { type: 'game_over'; winner: PlayerId | null };

export interface GameState {
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
  opening: { undecided: PlayerId[]; mulligans: PlayerId[]; bottoms: { player: PlayerId; count: number }[] } | null;
  /** A cleanup step in which SBAs happened gets another cleanup step. */
  extraCleanup: boolean;
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
  /** CR 610.3: objects exiled "until ~ leaves the battlefield", and the permanent they wait on. */
  exiledUntil?: { source: ObjectRef; object: ObjectRef }[];
  /** CR 608.2h: power and toughness of permanents as they last existed on the battlefield, by object. */
  lastKnown?: Record<ObjectId, { zcc: number; power: number; toughness: number; enchantedPlayer?: PlayerId; copyOf?: { card: string; face: number }; granted?: AbilityNode[] }>;
  /** Cards a player may play or cast from where they are (impulse draw: "you may play that card this turn"). */
  mayPlay?: { object: ObjectRef; player: PlayerId; mode: 'play' | 'cast'; lastTurn: number }[];
  /** CR 725: the player who is the monarch, once someone has become it. */
  monarch?: PlayerId | null;
  /** CR 614.12: permanents that just entered and still need their "as ~ enters" choice made. */
  asEnters?: { object: ObjectId; zcc: number; node: AsEntersNode }[];
  /** Events whose triggers wait for a copy choice (CR 707.5). */
  heldEvents?: GameEvent[];
  /** What happened this turn, and how many spells each player cast last turn. */
  turnLog: TurnLog;
  lastTurnSpells: Record<PlayerId, number>;
  winner: PlayerId | null;
  over: boolean;
  rng: number;
  nextId: number;
}

export type ApplyResult = { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: string };

export class RulesError extends Error {}
