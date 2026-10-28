import type { AbilityNode, ContinuousEffectNode, KeywordInstance } from '@mtg/schema';
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
 * copy's), so any kind of ability is fine. Otherwise it's granted by a continuous effect: triggered and
 * activated abilities, and static abilities that only change the object itself (see grantableStatic).
 */
export function parseQuotedAbility(item: string, b: Binder, printed: boolean): KeywordInstance | null {
  const quoted = quotedText(item, b);
  if (!quoted || !b.env.parseAbilities) return null;
  // 'has "Equipped creature gets +2/+0" and equip {2}' — a quote inside a list has no period of its own.
  // Urza's Saga: a quote inside a quote ("… token with 'This token gets +1/+1 for each artifact you control.'") is a
  // quoted ability one level down.
  // Chandra, Torch of Defiance: an emblem "with 'Whenever you cast a spell, this emblem deals 5 damage to any target.'" — itself
  // (read as the object that has the ability, like "this creature").
  const text = (/[.:]['’]?$/.test(quoted) ? quoted : `${quoted}.`).replace(/(^|\s)'([^']+?[.,])'(?=\s|$|[.,])/g, '$1"$2"').replace(/\bthis emblem\b/g, 'this creature');
  const names = [b.env.cardName, b.env.faceName].filter((n) => n && n.length > 1);
  if (names.some((n) => text.includes(n)) || SOURCE_WORDS.test(text)) return null;
  const r = b.env.parseAbilities(text, '\u0001', 'Creature');
  if (r.unparsed.length || r.manualKeywords.length) return null;
  // 'have "Ward—Pay 2 life."': a quoted keyword is that keyword.
  if (r.keywords.length === 1 && !r.abilities.length) return r.keywords[0]!;
  if (r.keywords.length || !r.abilities.length) return null;
  // Granted: triggered and activated abilities, and static abilities about the object itself with no
  // condition ("This creature can't block.") — the engine applies those with the grant (layer 6).
  if (!printed && !r.abilities.every((a) => a.kind === 'triggered' || a.kind === 'activated' || grantableStatic(a))) return null;
  return { id: 'ability', text, abilities: r.abilities };
}

/** A static ability that only changes the object that has it: rule flags, keywords, combat rules, +N/+N. */
export function grantableStatic(a: AbilityNode): boolean {
  // Caduceus, Staff of Hermes: has "Prevent all damage that would be dealt to this creature." (CR 615.1a)
  if (a.kind === 'static' && !a.gate && a.effect.type === 'prevent_damage') {
    const e = a.effect as unknown as Record<string, unknown>;
    return Boolean(e.toSelf) && Object.keys(e).every((k) => ['type', 'toSelf', 'damage'].includes(k));
  }
  if (a.kind !== 'static' || a.gate || a.effect.type !== 'continuous') return false;
  const e = a.effect as ContinuousEffectNode;
  if (e.affected.ref !== 'self' || e.condition) return false;
  const keys = Object.keys(e).filter((k) => !['type', 'affected', 'rules', 'keywords', 'combat', 'power', 'toughness'].includes(k));
  return keys.length === 0 && (e.power === undefined || typeof e.power === 'number') && (e.toughness === undefined || typeof e.toughness === 'number');
}

/**
 * Druid Class: a granted "This creature's power and toughness are each equal to the number of lands you control." — its
 * amounts, for the effect that grants it to set power and toughness continuously (granted, it isn't a characteristic-defining
 * ability, CR 604.3a: it applies in layer 7b, CR 613.4b). Null for any other quote.
 */
export function quotedLivePT(item: string, b: Binder): { power: unknown; toughness: unknown } | null {
  const quoted = quotedText(item, b);
  if (!quoted || !b.env.parseAbilities || !/^This creature's power and toughness are each equal to [^."]+\.?$/.test(quoted)) return null;
  const r = b.env.parseAbilities(/\.$/.test(quoted) ? quoted : `${quoted}.`, '\u0001', 'Creature');
  const a = r.abilities[0];
  if (r.unparsed.length || r.keywords.length || r.abilities.length !== 1 || a?.kind !== 'static' || a.gate || a.effect.type !== 'continuous') return null;
  const e = a.effect as ContinuousEffectNode;
  const keys = Object.keys(e).filter((k) => !['type', 'affected', 'setLayer', 'setPower', 'setToughness', 'text'].includes(k));
  if (keys.length || e.affected.ref !== 'self' || e.setPower === undefined || e.setToughness === undefined) return null;
  return { power: e.setPower, toughness: e.setToughness };
}
