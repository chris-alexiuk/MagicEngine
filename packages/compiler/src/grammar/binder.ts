import type { AmountExpr, Ref, TargetSpec } from '@mtg/schema';
import type { KeywordRegistry } from '../keywords.js';

/** What every grammar function needs to know about the card being compiled. */
export interface GrammarEnv {
  cardName: string;
  faceName: string;
  typeLine: string;
  /** The face's mana cost, when known ("{X}" in it: X is announced as the spell is cast). */
  manaCost?: string;
  keywords: KeywordRegistry;
  /** Quoted ability texts set aside from the line being parsed, by QUOTED_n index (see quoted.ts). */
  quotes?: string[];
  /** Parses a quoted or predefined ability text (used for tokens' abilities). */
  parseAbilities?: (text: string, name: string, typeLine: string) => import('../parser.js').ParseResult;
}

/**
 * Collects the targets one ability declares and tracks what pronouns refer to.
 * "Destroy target creature. Its controller gains 3 life." — "its" is the target;
 * "When ~ dies, return it to its owner's hand." — "it" is the dying object.
 *
 * Parsing is speculative: callers try a template on a clone and keep it only on success.
 */
export class Binder {
  targets: TargetSpec[] = [];
  /** Antecedent for "it", "that creature", "them". */
  it: Ref | null = null;
  /**
   * The last antecedent other than the source, kept when the text names the source ("sacrifice this enchantment. If you
   * do, destroy that creature") — "that creature" is that one, not the source.
   */
  other: Ref | null = null;
  /** Antecedent for "that player". */
  player: Ref | null = null;
  /** Other phrases with a fixed meaning in this ability ("the blocking creature"). */
  named: Record<string, Ref> = {};
  /** Set when the text moves this object out of a zone ("return ~ from your graveyard"): the ability works there (CR 113.6m). */
  selfZone: 'graveyard' | 'hand' | 'command' | null = null;
  /** "it" is this object even though it has left the battlefield ("When ~ dies, it deals damage …"). */
  itIsSource = false;
  /** "Whenever a Dragon you control enters, it deals …": "it" is a permanent on the battlefield that can be a source. */
  itOnField = false;
  /** The trigger event has an amount, so "that much" / "that many" means it. */
  eventAmount = false;
  /** "Whenever one or more creatures die": "the total power of those creatures" is the batch's (as they last existed). */
  batchPower = false;
  /** What the last "deals N damage to …" dealt damage to ("a creature dealt damage this way"). */
  damaged: Ref | null = null;
  /** CR 701.38: the options of the vote this ability holds ("If sickness gets more votes"). */
  votes: string[] = [];
  /** Set when the text uses something the engine can't do (the line stays unread). */
  unsupported = false;
  /** X is announced for this ability (a spell or activated ability with X in its cost), so a target can be "with mana value X". */
  xAllowed = false;
  /** The ability mills cards, so "from among them" can mean the milled cards. */
  milled = false;
  /** Peer into the Abyss: "… half the number of cards in their library … Round up each time." — how "half" rounds. */
  halfDir: 'up' | 'down' | null = null;
  /** The Ten Rings: "if you have fewer than ten cards in hand, draw cards equal to the difference" — what "the difference" is. */
  difference: AmountExpr | null = null;
  /** Skrelv: "Choose a color. … creatures of that color" — a color was chosen as this resolves. */
  choseColor = false;
  /** Tail Swipe: "Choose target creature you control and target creature you don't control. … those creatures fight each other." */
  fightPair: [Ref, Ref] | null = null;

  constructor(readonly env: GrammarEnv) {}

  clone(): Binder {
    const b = new Binder(this.env);
    b.targets = this.targets.map((t) => ({ ...t }));
    b.it = this.it;
    b.other = this.other;
    b.player = this.player;
    b.named = this.named;
    b.selfZone = this.selfZone;
    b.itIsSource = this.itIsSource;
    b.itOnField = this.itOnField;
    b.eventAmount = this.eventAmount;
    b.batchPower = this.batchPower;
    b.damaged = this.damaged;
    b.votes = this.votes;
    b.unsupported = this.unsupported;
    b.xAllowed = this.xAllowed;
    b.milled = this.milled;
    b.halfDir = this.halfDir;
    b.difference = this.difference;
    b.choseColor = this.choseColor;
    b.fightPair = this.fightPair;
    return b;
  }

  adopt(other: Binder): void {
    this.targets = other.targets;
    this.it = other.it;
    this.other = other.other;
    this.player = other.player;
    this.named = other.named;
    this.selfZone = other.selfZone;
    this.itIsSource = other.itIsSource;
    this.itOnField = other.itOnField;
    this.eventAmount = other.eventAmount;
    this.batchPower = other.batchPower;
    this.damaged = other.damaged;
    this.votes = other.votes;
    this.unsupported = other.unsupported;
    this.xAllowed = other.xAllowed;
    this.milled = other.milled;
    this.halfDir = other.halfDir;
    this.difference = other.difference;
    this.choseColor = other.choseColor;
    this.fightPair = other.fightPair;
  }

  addTarget(spec: TargetSpec): Ref {
    // "target creature with mana value X or less": X is the one announced (CR 601.2b comes before 601.2c) — parseProgram
    // keeps it only for a spell or an activated ability with X in its cost; "…, where X is …" binds it (bindTargetsX).
    // A counted amount ("with mana value less than or equal to the number of Plains you control", "… Alesha's power") is
    // counted as the target is checked — only one that doesn't depend on the event or the resolution.
    const f = (spec.filter ?? {}) as Record<string, { n?: unknown } | undefined>;
    const counted = (['power', 'toughness', 'manaValue'] as const).map((k) => f[k]?.n).filter((n) => typeof n === 'object');
    if (counted.some((n) => !targetCountable(n))) this.unsupported = true;
    this.targets.push(spec);
    return { ref: 'target', index: this.targets.length - 1 };
  }
}

/**
 * Spellstutter Sprite: "counter target spell with mana value X or less, where X is the number of Faeries you control" —
 * X in the targets added since `from` is that count, if it's one the engine can work out as targets are chosen.
 */
export function bindTargetsX(b: Binder, from: number, expr: unknown): void {
  for (const spec of b.targets.slice(from)) {
    // Rot Hulk: "return up to X target Zombie cards …, where X is the number of opponents you have" — how many.
    if (spec.countX && spec.upTo && (targetCountable(expr) || ['players', 'kicks', 'colors_among'].includes((expr as { kind?: string }).kind ?? ''))) {
      delete spec.countX;
      spec.countAmount = expr as never;
    }
    const f = spec.filter as Record<string, { op: string; n: unknown } | undefined> | undefined;
    if (!f) continue;
    for (const k of ['manaValue', 'power', 'toughness']) {
      if (f[k]?.n !== 'X') continue;
      if (!targetCountable(expr)) b.unsupported = true;
      spec.filter = { ...spec.filter, [k]: { ...f[k]!, n: expr } } as never;
    }
  }
}

/** A counted amount the engine can work out as a target is checked: about the source or the game, not the event. */
function targetCountable(n: unknown): boolean {
  const e = n as { kind?: string; of?: { ref?: string } };
  const json = JSON.stringify(n);
  // Scrap Trawler: "with lesser mana value" than the object the trigger is about — known as targets are chosen.
  if (e.kind === 'stat' && e.of?.ref === 'trigger_object' && json === JSON.stringify({ kind: 'stat', stat: (n as { stat: string }).stat, of: { ref: 'trigger_object' } })) return true;
  if (/"ref":"(?!self"|you")/.test(json)) return false;
  // Celestine: "where X is the amount of life you gained this turn" — the game's state, known as targets are chosen.
  const STATE = ['count', 'counters_among', 'cards', 'life_this_turn', 'devotion', 'domain', 'party', 'drawn_this_turn', 'spells_cast_this_turn', 'died_this_turn', 'tokens_created_this_turn'];
  return STATE.includes(e.kind ?? '') || ((e.kind === 'stat' || e.kind === 'counters') && e.of?.ref === 'self');
}

/** Runs `fn` on a copy of the binder and keeps its changes only if it succeeds. */
export function attempt<T>(b: Binder, fn: (b: Binder) => T | null): T | null {
  const copy = b.clone();
  const out = fn(copy);
  if (out !== null) b.adopt(copy);
  return out;
}
