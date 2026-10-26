import type { AbilityNode, ConditionNode, KeywordInstance } from '@mtg/schema';
import { keywordSupported, shortName, stripReminder } from '@mtg/schema';
import { Binder, type GrammarEnv } from './grammar/binder.js';
import { parseFilter } from './grammar/nouns.js';
import { capitalise, subtypeOf, TYPE_NOUNS } from './grammar/words.js';
import { KEYWORD_DEFINITIONS } from './keyword-definitions.js';
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
  /** Keyword lines with a keyword the engine doesn't apply yet (schema keywordSupported). */
  manualKeywords: string[];
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
    const result: ParseResult = { keywords: [], abilities: [], unparsed: [], manualKeywords: [] };
    const lines = text.split('\n').map(stripReminder);
    // Abilities below a class level bar (CR 716.2a) or a level symbol (CR 711.2a) exist only at that level.
    let gate: ConditionNode | undefined;
    const isClass = /\bClass\b/.test(ctx.typeLine);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line === '') continue; // pure reminder text, e.g. a basic land's "({T}: Add {G}.)"

      // CR 716.2a: "[Cost]: Level N" — "This Class's level becomes N. Activate only if this Class is level N-1
      // and only as a sorcery." What follows is the level N ability.
      const level = isClass ? /^((?:\{[^}]+\})+): Level (\d+)$/.exec(line) : null;
      if (level) {
        const n = Number(level[2]);
        result.abilities.push({
          kind: 'activated',
          text: line,
          cost: { mana: level[1]! },
          effects: [{ type: 'class_level', level: n }],
          timing: 'sorcery',
          activateIf: { type: 'class_level', exactly: n - 1 },
        });
        gate = { type: 'class_level', min: n };
        continue;
      }
      // CR 711.2a/b: "LEVEL 1-3" / "LEVEL 4+", then that striation's P/T and abilities.
      const striation = /^LEVEL (\d+)(?:-(\d+)|\+)$/.exec(line);
      if (striation) {
        gate = { type: 'counters', of: { ref: 'self' }, counter: 'level', min: Number(striation[1]), ...(striation[2] ? { max: Number(striation[2]) } : {}) };
        continue;
      }
      const pt = gate?.counter === 'level' ? /^(\d+)\/(\d+)$/.exec(line) : null;
      if (pt) {
        result.abilities.push({
          kind: 'static',
          text: line,
          gate,
          effect: { type: 'continuous', affected: { ref: 'self' }, setPower: Number(pt[1]), setToughness: Number(pt[2]), setLayer: '7b' },
        });
        continue;
      }

      const kws = this.keywords.parseLine(line);
      if (kws && gate) {
        // A keyword at a level: "it has [abilities]" while the level holds (granted, layer 6).
        for (const kw of kws) {
          const abilities = this.expandKeyword(kw, env);
          if (abilities) kw.abilities = abilities;
        }
        if (!kws.every(keywordSupported)) result.manualKeywords.push(line);
        else result.abilities.push({ kind: 'static', text: line, gate, effect: { type: 'continuous', affected: { ref: 'self' }, keywords: kws } });
        continue;
      }
      if (kws) {
        for (const kw of kws) {
          // CR 702.5a / CR 303.4a: what an Aura can enchant is also what the Aura spell targets.
          if (kw.id === 'enchant' && kw.text) {
            if (kw.text === 'player' || kw.text === 'opponent') kw.player = kw.text === 'player' ? 'any' : 'opponent';
            else {
              const pf = parseFilter(kw.text, new Binder(env as GrammarEnv));
              if (pf && !pf.plural) kw.filter = pf.filter;
            }
          }
          const abilities = this.expandKeyword(kw, env);
          if (abilities) kw.abilities = abilities;
        }
        result.keywords.push(...kws);
        if (!kws.every(keywordSupported)) result.manualKeywords.push(line);
        continue;
      }

      // CR 700.2: a modal header ("Choose one —", "When ~ enters, choose one —") and its bullets form one ability.
      const block = [line];
      if (/\bchoose (?:one|two|three|one or both|one or more|any number) —$/i.test(line) || /^Choose (?:one|two)\. If .+ instead\.$/.test(line)) {
        while (i + 1 < lines.length && lines[i + 1]!.startsWith('• ')) block.push(lines[++i]!);
      }

      const node = this.parseBlock(block, env);
      if (node && gate) node.gate = gate;
      if (node) result.abilities.push(node);
      else result.unparsed.push(...block);
    }
    return result;
  }

  /** One ability's lines (a modal block has several) through the grammar rules. */
  private parseBlock(block: string[], env: ParseContext, original = block.join('\n')): AbilityNode | null {
    const normalised = block
      .map((l, n) => normaliseSelf(n === 0 ? stripAbilityWord(l) : l, env).replace(/[‘’]/g, "'"))
      .join('\n');
    for (const rule of this.rules) {
      const node = rule.parse(normalised, original, env);
      if (node) return node;
    }
    return null;
  }

  /**
   * A keyword's abilities, compiled from its definition in CR 702 (e.g. prowess, 702.108a)
   * with the same grammar as card text. Null when any part of the definition doesn't parse.
   */
  expandKeyword(kw: KeywordInstance, env: ParseContext): AbilityNode[] | null {
    // The CR names some keywords with their connecting word ("Affinity for [text]", CR 702.41a).
    const def = KEYWORD_DEFINITIONS[kw.id] ?? KEYWORD_DEFINITIONS[`${kw.id}_for`];
    if (!def) return null;
    const printed = keywordText(def.pattern, kw);
    if (printed === null) return null;
    const out: AbilityNode[] = [];
    for (const sentence of def.meaning) {
      const text = keywordText(sentence, kw);
      const node = text === null ? null : this.parseBlock([text], env, printed);
      if (!node) return null;
      if (def.zone && node.kind === 'activated') node.zone = def.zone;
      out.push(node);
    }
    return out;
  }
}

/** Fills a definition's parameters ("N", "[cost]", "[type]", "[quality]") from a keyword instance. */
/**
 * "pays [cost]" with a cost that isn't mana reads as a verb: "pays 3 life", "pays {2} and 2 life",
 * "discards a card", "sacrifices a creature" (ward, CR 702.21a).
 */
function paysCost(cost: string): string | null {
  if (/^(\{[^}]+\})+$/.test(cost)) return `pays ${cost}`;
  const life = /^(?:((?:\{[^}]+\})+), )?[Pp]ay (\d+) life$/.exec(cost);
  if (life) return life[1] ? `pays ${life[1]} and ${life[2]} life` : `pays ${life[2]} life`;
  const verb = /^(Discard|Sacrifice) (an? .+|one .+|two .+)$/.exec(cost);
  if (verb && !/at random/.test(cost)) return `${verb[1]!.toLowerCase()}s ${verb[2]}`;
  return null;
}

function keywordText(template: string, kw: KeywordInstance): string | null {
  let ok = true;
  const out = template
    .replace(/pays \[cost\]/g, () => (kw.cost ? (paysCost(kw.cost) ?? ((ok = false), '')) : ((ok = false), '')))
    .replace(/\[(cost|Cost)\]/g, () => kw.cost ?? ((ok = false), ''))
    .replace(/\[(type|Type)\]/g, (_m, t: string) => {
      if (!kw.text) return ((ok = false), '');
      // "plains" → "Plains" (a subtype), "basic land" stays as it is.
      const words = kw.text.split(' ').map((w) => (subtypeOf(capitalise(w)) ? capitalise(w) : w)).join(' ');
      return t === 'Type' ? capitalise(words) : words;
    })
    .replace(/\[quality\]/g, () => kw.text ?? ((ok = false), ''))
    // "for each [text]" reads the plural keyword text ("Affinity for artifacts") as one: "for each artifact".
    .replace(/for each \[text\]/g, () => (kw.text ? `for each ${singular(kw.text)}` : ((ok = false), '')))
    .replace(/\[text\]/g, () => kw.text ?? ((ok = false), ''))
    .replace(/\bN\b/g, () => (kw.n !== undefined ? String(kw.n) : kw.text === 'X' ? 'X' : ((ok = false), '')));
  return ok ? out : null;
}

/** "artifacts" → "artifact", "Plains" → "Plains", "Equipment" → "Equipment" (the last word only). */
function singular(text: string): string {
  const words = text.split(' ');
  const last = words[words.length - 1]!;
  const type = TYPE_NOUNS[last.toLowerCase()];
  const sub = subtypeOf(capitalise(last));
  words[words.length - 1] = type ? type.toLowerCase() : sub ?? last.replace(/s$/, '');
  return words.join(' ');
}

export { stripReminder };

/** "Landfall — Whenever…" → "Whenever…". Ability words have no rules meaning (CR 207.2c). */
export function stripAbilityWord(line: string): string {
  const m = /^([A-Z][A-Za-z' ]*?(?: \d+)?) — (.+)$/.exec(line);
  if (!m) return line;
  // "Choose one —" is a modal spell, not an ability word; "II —" is a Saga's chapter symbol (CR 714.2).
  if (/^Choose\b/.test(m[1]!) || /^[IVX]+(?:, [IVX]+)*$/.test(m[1]!)) return line;
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
