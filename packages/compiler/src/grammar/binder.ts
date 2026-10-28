import type { Ref, TargetSpec } from '@mtg/schema';
import type { KeywordRegistry } from '../keywords.js';

/** What every grammar function needs to know about the card being compiled. */
export interface GrammarEnv {
  cardName: string;
  faceName: string;
  typeLine: string;
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
  /** Antecedent for "that player". */
  player: Ref | null = null;
  /** Other phrases with a fixed meaning in this ability ("the blocking creature"). */
  named: Record<string, Ref> = {};
  /** Set when the text moves this object out of a zone ("return ~ from your graveyard"): the ability works there (CR 113.6m). */
  selfZone: 'graveyard' | 'hand' | null = null;
  /** "it" is this object even though it has left the battlefield ("When ~ dies, it deals damage …"). */
  itIsSource = false;
  /** "Whenever a Dragon you control enters, it deals …": "it" is a permanent on the battlefield that can be a source. */
  itOnField = false;
  /** The trigger event has an amount, so "that much" / "that many" means it. */
  eventAmount = false;
  /** What the last "deals N damage to …" dealt damage to ("a creature dealt damage this way"). */
  damaged: Ref | null = null;
  /** CR 701.38: the options of the vote this ability holds ("If sickness gets more votes"). */
  votes: string[] = [];
  /** Set when the text uses something the engine can't do (the line stays unread). */
  unsupported = false;
  /** The ability mills cards, so "from among them" can mean the milled cards. */
  milled = false;

  constructor(readonly env: GrammarEnv) {}

  clone(): Binder {
    const b = new Binder(this.env);
    b.targets = this.targets.map((t) => ({ ...t }));
    b.it = this.it;
    b.player = this.player;
    b.named = this.named;
    b.selfZone = this.selfZone;
    b.itIsSource = this.itIsSource;
    b.itOnField = this.itOnField;
    b.eventAmount = this.eventAmount;
    b.damaged = this.damaged;
    b.votes = this.votes;
    b.unsupported = this.unsupported;
    b.milled = this.milled;
    return b;
  }

  adopt(other: Binder): void {
    this.targets = other.targets;
    this.it = other.it;
    this.player = other.player;
    this.named = other.named;
    this.selfZone = other.selfZone;
    this.itIsSource = other.itIsSource;
    this.itOnField = other.itOnField;
    this.eventAmount = other.eventAmount;
    this.damaged = other.damaged;
    this.votes = other.votes;
    this.unsupported = other.unsupported;
    this.milled = other.milled;
  }

  addTarget(spec: TargetSpec): Ref {
    // "target spell with mana value X or less, where X is …": the engine can't check X as targets are chosen yet.
    if ((spec.filter as { manaValue?: { n?: unknown } } | undefined)?.manaValue?.n === 'X') this.unsupported = true;
    this.targets.push(spec);
    return { ref: 'target', index: this.targets.length - 1 };
  }
}

/** Runs `fn` on a copy of the binder and keeps its changes only if it succeeds. */
export function attempt<T>(b: Binder, fn: (b: Binder) => T | null): T | null {
  const copy = b.clone();
  const out = fn(copy);
  if (out !== null) b.adopt(copy);
  return out;
}
