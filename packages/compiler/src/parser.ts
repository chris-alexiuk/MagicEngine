import type { AbilityNode, KeywordInstance } from '@mtg/schema';
import { shortName, stripReminder } from '@mtg/schema';
import { Binder, type GrammarEnv } from './grammar/binder.js';
import { parseFilter } from './grammar/nouns.js';
import { KeywordRegistry } from './keywords.js';
import { CORE_RULES } from './rules/index.js';

/**
 * Oracle text → AST, one paragraph (line) at a time.
 *
 * Each line goes through:
 *   1. reminder-text removal ("(…)")
 *   2. keyword-line detection (KeywordRegistry)
 *   3. grammar rules, tried in order until one returns a node
 * Anything left over is recorded as unparsed and resolved by players in game.
 *
 * Grammar rules see a normalised line where every self-reference
 * ("Kinnan", "Llanowar Elves", "this creature") is replaced with "~".
 */

export interface ParseContext {
  /** Full card name and face name; both are used to spot self-references. */
  cardName: string;
  faceName: string;
  typeLine: string;
  /** Filled in by the registry for grammar rules that need to recognise keywords. */
  keywords?: KeywordRegistry;
  /** Filled in by the registry: compiles another ability text (a token's, say). */
  parseAbilities?: (text: string, name: string, typeLine: string) => ParseResult;
}

export interface GrammarRule {
  id: string;
  /** `line` is normalised (self-references → "~"); `original` is the reminder-free source line. */
  parse(line: string, original: string, ctx: ParseContext): AbilityNode | null;
}

export interface ParseResult {
  keywords: KeywordInstance[];
  abilities: AbilityNode[];
  unparsed: string[];
}

export class ParserRegistry {
  readonly keywords: KeywordRegistry;
  private readonly rules: GrammarRule[] = [];

  constructor(opts: { keywords?: KeywordRegistry; rules?: GrammarRule[] } = {}) {
    this.keywords = opts.keywords ?? new KeywordRegistry();
    for (const rule of opts.rules ?? CORE_RULES) this.addRule(rule);
  }

  addRule(rule: GrammarRule): void {
    if (this.rules.some((r) => r.id === rule.id)) throw new Error(`duplicate grammar rule id: ${rule.id}`);
    this.rules.push(rule);
  }

  get ruleIds(): string[] {
    return this.rules.map((r) => r.id);
  }

  parse(text: string, ctx: ParseContext): ParseResult {
    const env: ParseContext = {
      ...ctx,
      keywords: this.keywords,
      parseAbilities: (t, name, typeLine) => this.parse(t, { cardName: name, faceName: name, typeLine }),
    };
    const result: ParseResult = { keywords: [], abilities: [], unparsed: [] };
    const lines = text.split('\n').map(stripReminder);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line === '') continue; // pure reminder text, e.g. a basic land's "({T}: Add {G}.)"

      const kws = this.keywords.parseLine(line);
      if (kws) {
        for (const kw of kws) {
          // CR 702.5a / CR 303.4a: what an Aura can enchant is also what the Aura spell targets.
          if (kw.id === 'enchant' && kw.text) {
            const pf = parseFilter(kw.text, new Binder(env as GrammarEnv));
            if (pf && !pf.plural) kw.filter = pf.filter;
          }
        }
        result.keywords.push(...kws);
        continue;
      }

      // CR 700.2: a modal header ("Choose one —", "When ~ enters, choose one —") and its bullets form one ability.
      const block = [line];
      if (/\bchoose (?:one|two|three|one or both|one or more|any number) —$/i.test(line)) {
        while (i + 1 < lines.length && lines[i + 1]!.startsWith('• ')) block.push(lines[++i]!);
      }

      const normalised = block
        .map((l, n) => normaliseSelf(n === 0 ? stripAbilityWord(l) : l, env).replace(/[‘’]/g, "'"))
        .join('\n');
      const original = block.join('\n');
      let node: AbilityNode | null = null;
      for (const rule of this.rules) {
        node = rule.parse(normalised, original, env);
        if (node) break;
      }
      if (node) result.abilities.push(node);
      else result.unparsed.push(...block);
    }
    return result;
  }
}

export { stripReminder };

/** "Landfall — Whenever…" → "Whenever…". Ability words have no rules meaning (CR 207.2c). */
export function stripAbilityWord(line: string): string {
  const m = /^([A-Z][A-Za-z' ]*?(?: \d+)?) — (.+)$/.exec(line);
  if (!m) return line;
  // "Choose one —" is a modal spell, not an ability word.
  if (/^Choose\b/.test(m[1]!)) return line;
  return m[2]!;
}

const SELF_NOUNS =
  'creature|land|artifact|enchantment|planeswalker|battle|spell|card|permanent|aura|equipment|vehicle|token|saga|class|case|room|siege';

export function normaliseSelf(line: string, ctx: ParseContext): string {
  let out = line;
  const names = new Set([ctx.faceName, ctx.cardName, shortName(ctx.faceName)].filter((n) => n.length > 1));
  // Longest first so "Kinnan, Bonder Prodigy" is replaced before "Kinnan".
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`(?<![\\w'])${escapeRegExp(name)}(?![\\w])`, 'g'), '~');
  }
  // "this creature", "this Aura", "this Equipment" (the subtype words are capitalised).
  out = out.replace(new RegExp(`\\b[Tt]his (?:${SELF_NOUNS})\\b`, 'gi'), '~');
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Shared default registry; plugins can construct their own and add rules/keywords. */
export const defaultRegistry = new ParserRegistry();
