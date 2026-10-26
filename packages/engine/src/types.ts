import type { CardDef } from '@mtg/schema';

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
  /** Loyalty abilities activated this turn (once-per-turn limit). */
  loyaltyActivatedTurn?: number;
}

/** A reference that goes stale when the object changes zones. */
export interface ObjectRef {
  id: ObjectId;
  zcc: number;
}

export type StackEntry =
  | { kind: 'spell'; object: ObjectId; controller: PlayerId; x: number }
  | { kind: 'ability'; id: string; source: ObjectRef; sourceName: string; controller: PlayerId; text: string; manual: true };

export type PendingChoice =
  | { kind: 'mulligan'; player: PlayerId }
  | { kind: 'bottom_cards'; player: PlayerId; count: number }
  | { kind: 'discard_to_hand_size'; player: PlayerId; count: number }
  | { kind: 'legend_rule'; player: PlayerId; name: string; objects: ObjectId[] }
  | { kind: 'manual_resolution'; player: PlayerId; text: string; sourceName: string };

export type ChoiceAnswer =
  | { kind: 'mulligan'; keep: boolean }
  | { kind: 'bottom_cards'; objects: ObjectId[] }
  | { kind: 'discard_to_hand_size'; objects: ObjectId[] }
  | { kind: 'legend_rule'; keep: ObjectId }
  | { kind: 'manual_resolution'; done: true };

export type ManualOp =
  | { kind: 'move'; object: ObjectId; to: ZoneName; position?: 'top' | 'bottom' }
  | { kind: 'life'; target: PlayerId; delta: number }
  | { kind: 'tap'; object: ObjectId; tapped: boolean }
  | { kind: 'counters'; object: ObjectId; counter: string; delta: number }
  | { kind: 'draw'; count: number };

export type Action =
  | { type: 'pass'; player: PlayerId }
  | { type: 'choose'; player: PlayerId; answer: ChoiceAnswer }
  | { type: 'play_land'; player: PlayerId; object: ObjectId; face?: number }
  | { type: 'activate_mana'; player: PlayerId; object: ObjectId; ability: number; choice?: number | ManaColor }
  | { type: 'cast'; player: PlayerId; object: ObjectId; face?: number; x?: number; autoTap?: boolean }
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
  | { type: 'moved'; object: ObjectId; from: ZoneName; to: ZoneName }
  | { type: 'tapped'; object: ObjectId; tapped: boolean }
  | { type: 'mana_added'; player: PlayerId; mana: ManaColor[] }
  | { type: 'land_played'; player: PlayerId; object: ObjectId }
  | { type: 'cast'; player: PlayerId; object: ObjectId }
  | { type: 'ability_activated'; player: PlayerId; source: ObjectId; text: string }
  | { type: 'resolved'; entry: StackEntry }
  | { type: 'life'; player: PlayerId; delta: number; life: number }
  | { type: 'counters'; object: ObjectId; counter: string; delta: number }
  | { type: 'manual'; player: PlayerId; op: ManualOp }
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
  winner: PlayerId | null;
  over: boolean;
  rng: number;
  nextId: number;
}

export type ApplyResult = { ok: true; state: GameState; events: GameEvent[] } | { ok: false; error: string };

export class RulesError extends Error {}
