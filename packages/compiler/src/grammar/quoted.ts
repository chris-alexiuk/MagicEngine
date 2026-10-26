import type { KeywordInstance } from '@mtg/schema';
import type { Binder } from './binder.js';

/**
 * Quoted abilities (CR 113.1a: an object's abilities are defined by its rules text or by the
 * effect that created it): Creatures you control have "{T}: Add {G}.", a token "with "When this
 * token dies, …"", "gains "…" until end of turn".
 *
 * Before a line is parsed, each quoted text is set aside as QUOTED_n (so splitting sentences and
 * lists doesn't look inside it); here it's compiled like card text for the object that will have
 * it. Granted abilities ride along as a keyword instance with id "ability" and the compiled
 * abilities, the same way keywords defined in CR 702 do.
 */

const QUOTED = /^QUOTED_(\d+)$/;

/** Words inside the quotes that name the card granting the ability rather than the one that has it. */
const SOURCE_WORDS = /\bthis (?:equipment|aura|vehicle|saga|class|case|room|siege|spell|card|enchantment)\b/i;

export function isQuoted(item: string): boolean {
  return QUOTED.test(item.trim());
}

/** The text a QUOTED_n placeholder stands for. */
export function quotedText(item: string, b: Binder): string | null {
  const m = QUOTED.exec(item.trim());
  return m ? (b.env.quotes?.[Number(m[1])] ?? null) : null;
}

/**
 * Compiles a quoted ability. `printed`: it becomes part of the object's own text (a token's, a
 * copy's), so any kind of ability is fine. Otherwise it's granted by a continuous effect, and
 * only triggered and activated abilities are allowed (granted static abilities aren't applied yet).
 */
export function parseQuotedAbility(item: string, b: Binder, printed: boolean): KeywordInstance | null {
  const text = quotedText(item, b);
  if (!text || !b.env.parseAbilities) return null;
  const names = [b.env.cardName, b.env.faceName].filter((n) => n && n.length > 1);
  if (names.some((n) => text.includes(n)) || SOURCE_WORDS.test(text)) return null;
  const r = b.env.parseAbilities(text, '\u0001', 'Creature');
  if (r.unparsed.length || r.manualKeywords.length || r.keywords.length || !r.abilities.length) return null;
  if (!printed && r.abilities.some((a) => a.kind !== 'triggered' && a.kind !== 'activated')) return null;
  return { id: 'ability', text, abilities: r.abilities };
}
