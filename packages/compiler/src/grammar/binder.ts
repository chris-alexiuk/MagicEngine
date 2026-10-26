import type { Ref, TargetSpec } from '@mtg/schema';
import type { KeywordRegistry } from '../keywords.js';

/** What every grammar function needs to know about the card being compiled. */
export interface GrammarEnv {
  cardName: string;
  faceName: string;
  typeLine: string;
  keywords: KeywordRegistry;
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

  constructor(readonly env: GrammarEnv) {}

  clone(): Binder {
    const b = new Binder(this.env);
    b.targets = this.targets.map((t) => ({ ...t }));
    b.it = this.it;
    b.player = this.player;
    b.named = this.named;
    return b;
  }

  adopt(other: Binder): void {
    this.targets = other.targets;
    this.it = other.it;
    this.player = other.player;
    this.named = other.named;
  }

  addTarget(spec: TargetSpec): Ref {
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
