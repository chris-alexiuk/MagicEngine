import type { AbilityNode, CastOptionNode, ConditionNode, KeywordInstance, SpellAbility } from '@mtg/schema';
import { keywordSupported, shortName, stripReminder } from '@mtg/schema';
import { Binder, type GrammarEnv } from './grammar/binder.js';
import { parseFilter } from './grammar/nouns.js';
import { parseCost } from './grammar/lines.js';
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
  /** Quoted ability texts set aside from the line being parsed (QUOTED_n). */
  quotes?: string[];
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

      // CR 702.178a: "Max speed — [Ability]" means "As long as your speed is 4, this object has '[Ability].'"
      // CR 721.2a: "{N+} | [abilities]" means "As long as this permanent has N or more charge counters on it, it has [abilities]."
      const maxSpeed = /^Max speed — (.+)$/.exec(line);
      const stationSymbol = /^(\d+)\+ \| (.+)$/.exec(line);
      if (maxSpeed || stationSymbol) {
        const speedGate: ConditionNode = maxSpeed ? { type: 'max_speed' } : { type: 'counters', of: { ref: 'self' }, counter: 'charge', min: Number(stationSymbol![1]) };
        const rest = maxSpeed ? maxSpeed[1]! : stationSymbol![2]!;
        const inner = this.keywords.parseLine(rest);
        if (inner) {
          for (const kw of inner) {
            const abilities = this.expandKeyword(kw, env);
            if (abilities) kw.abilities = abilities;
          }
          if (!inner.every(keywordSupported)) result.manualKeywords.push(line);
          else result.abilities.push({ kind: 'static', text: line, gate: speedGate, effect: { type: 'continuous', affected: { ref: 'self' }, keywords: inner } });
          continue;
        }
        const node = this.parseBlock([rest], env, line);
        if (node) {
          node.gate = speedGate;
          result.abilities.push(node);
        } else result.unparsed.push(line);
        continue;
      }
      // CR 702.177a: "Exhaust — [Cost]: [Effect]" means "[Cost]: [Effect]. Activate only once."
      const exhaust = /^Exhaust — (.+)$/.exec(line);
      if (exhaust) {
        const node = this.parseBlock([exhaust[1]!], env, line);
        if (node?.kind === 'activated') {
          node.oncePerGame = true;
          if (gate) node.gate = gate;
          result.abilities.push(node);
        } else result.unparsed.push(line);
        continue;
      }
      // A flavor word before a keyword line ("Diana — Equip {2}", CR 207.2c-style): just the keyword.
      const flavored = /^[A-Z][A-Za-z'’ ]{0,30} — (.+)$/.exec(line);
      const kws = this.keywords.parseLine(line) ?? (flavored && !/^Choose\b/.test(line) ? this.keywords.parseLine(flavored[1]!) : null);
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
      if (/\bchoose (?:one|two|three|one or both|one or more|any number|up to one|up to two) —$/i.test(line) || /^Choose (?:one|two)\. If .+ instead\.$/.test(line)) {
        while (i + 1 < lines.length && lines[i + 1]!.startsWith('• ')) block.push(lines[++i]!);
      }

      const node = this.parseBlock(block, env);
      if (node && gate) node.gate = gate;
      if (node) result.abilities.push(node);
      else result.unparsed.push(...block);
    }
    for (const kw of result.keywords) {
      if (kw.abilities?.length) continue;
      // CR 702.82a: "Devour N" — "As this object enters, you may sacrifice any number of creatures. This permanent
      // enters with N +1/+1 counters on it for each creature sacrificed this way."
      if (kw.id === 'devour' && kw.n !== undefined) {
        kw.abilities = [{ kind: 'static', text: `Devour ${kw.n}`, effect: { type: 'as_enters', choice: 'devour', amount: kw.n } }];
      }
      // CR 702.133a: "Jump-start" — cast from the graveyard by discarding a card as well; exiled as it leaves the stack.
      if (kw.id === 'jump_start') {
        kw.abilities = [{
          kind: 'static',
          text: 'Jump-start',
          effect: { type: 'cast_option', id: 'jump_start', kind: 'alternative', cost: { other: [{ type: 'discard', amount: 1 }] }, zone: 'graveyard', withManaCost: true, exileOnLeave: true } as CastOptionNode,
        }];
      }
      // CR 702.6a with a quality: "Equip legendary creature {1}", "Equip Knight {1}" — "Attach to target [quality] you control."
      const qualified = kw.id === 'equip' && kw.cost ? /^([a-z][a-z ]*?|[A-Z][a-z]+) ((?:\{[^}]+\})+)$/.exec(kw.cost) : null;
      if (qualified) {
        const quality = /creature$/.test(qualified[1]!) ? qualified[1]! : `${qualified[1]} creature`;
        const node = this.parseBlock([`${qualified[2]}: Attach ~ to target ${quality} you control. Activate only as a sorcery.`], env, `Equip ${kw.cost}`);
        if (node?.kind === 'activated') kw.abilities = [node];
      }
      // CR 702.34a with other costs: "Flashback—{1}{G}, Pay 3 life."
      if (kw.id === 'flashback' && kw.cost && !/^(\{[^}]+\})+$/.test(kw.cost)) {
        const cost = parseCost(kw.cost.replace(/\.$/, ''), false, new Binder(env as GrammarEnv));
        if (cost && !cost.tap && !cost.untap && cost.loyalty === undefined) {
          kw.abilities = [{ kind: 'static', text: `Flashback—${kw.cost}`, effect: { type: 'cast_option', id: 'flashback', kind: 'alternative', cost, zone: 'graveyard', exileOnLeave: true } as CastOptionNode }];
        }
      }
      if (kw.abilities?.length) result.manualKeywords = result.manualKeywords.filter((l) => !l.toLowerCase().startsWith(kw.id.replace(/_/g, '-')) && !l.toLowerCase().startsWith(kw.id.replace(/_/g, ' ')));
    }
    // CR 702.113a: "Awaken N—[cost]" — cast for [cost], the spell also puts N +1/+1 counters on target land you control,
    // which becomes a 0/0 Elemental creature with haste that's still a land.
    for (const kw of result.keywords) {
      if (kw.id !== 'awaken' || kw.n === undefined || !kw.cost || !/^(\{[^}]+\})+$/.test(kw.cost) || kw.abilities?.length) continue;
      const spells = result.abilities.filter((a) => a.kind === 'spell');
      if (spells.length !== 1 || result.unparsed.length) continue;
      const counters = kw.n === 1 ? 'a +1/+1 counter' : `${kw.n} +1/+1 counters`;
      const awakened = this.parse(`${spells[0]!.text} Put ${counters} on target land you control. That land becomes a 0/0 Elemental creature with haste. It's still a land.`, ctx);
      const spell = awakened.abilities.find((a): a is SpellAbility => a.kind === 'spell');
      if (!spell || awakened.unparsed.length || awakened.abilities.length !== 1) continue;
      kw.abilities = [{ kind: 'static', text: `Awaken ${kw.n}—${kw.cost}`, effect: { type: 'cast_option', id: 'awaken', kind: 'alternative', cost: { mana: kw.cost }, spell } as CastOptionNode }];
      result.manualKeywords = result.manualKeywords.filter((l) => !/^Awaken\b/.test(l));
    }
    for (const kw of result.keywords) {
      if (kw.abilities?.length) continue;
      // CR 702.116a: "Myriad" — whenever this creature attacks, token copies attacking each other opponent.
      if (kw.id === 'myriad') {
        kw.abilities = [{ kind: 'triggered', text: 'Myriad', trigger: { type: 'attacks', subject: { ref: 'self' } }, effects: [{ type: 'myriad' }] }];
        result.manualKeywords = result.manualKeywords.filter((l) => l !== 'Myriad');
      }
      // CR 702.141a: "Encore [cost]" — "[Cost], Exile this card from your graveyard: For each opponent, create a token
      // that's a copy of this card that attacks that opponent this turn if able. The tokens gain haste. Sacrifice them at
      // the beginning of the next end step. Activate only as a sorcery."
      if (kw.id === 'encore' && kw.cost && /^(\{[^}]+\})+$/.test(kw.cost)) {
        kw.abilities = [{ kind: 'activated', text: `Encore ${kw.cost}`, zone: 'graveyard', timing: 'sorcery', cost: { mana: kw.cost, other: [{ type: 'exile_self' }] }, effects: [{ type: 'encore' }] }];
        result.manualKeywords = result.manualKeywords.filter((l) => !/^Encore\b/.test(l));
      }
    }
    // CR 702.49a: "Ninjutsu [cost]" — "[Cost], Reveal this card from your hand, Return an unblocked attacking creature you
    // control to its owner's hand: Put this card onto the battlefield from your hand tapped and attacking."
    for (const kw of result.keywords) {
      if (kw.id !== 'ninjutsu' || !kw.cost || !/^(\{[^}]+\})+$/.test(kw.cost) || kw.abilities?.length) continue;
      kw.abilities = [{ kind: 'activated', text: `Ninjutsu ${kw.cost}`, zone: 'hand', cost: { mana: kw.cost, other: [{ type: 'return_unblocked' }] }, effects: [{ type: 'ninjutsu' }] }];
      result.manualKeywords = result.manualKeywords.filter((l) => !/^Ninjutsu\b/.test(l));
    }
    // CR 702.184a: "Station" — "Tap another untapped creature you control: Put a number of charge counters on this
    // permanent equal to the tapped creature's power. Activate only as a sorcery."
    for (const kw of result.keywords) {
      if (kw.id !== 'station' || kw.abilities?.length) continue;
      kw.abilities = [{
        kind: 'activated',
        text: 'Station',
        cost: { other: [{ type: 'station' }] },
        timing: 'sorcery',
        effects: [{ type: 'add_counters', what: { ref: 'self' }, counter: 'charge', amount: { kind: 'cost_lki', cost: 'tapped', stat: 'power' } }],
      }];
      result.manualKeywords = result.manualKeywords.filter((l) => l !== 'Station');
      // CR 721.2b: a power/toughness box in a striation — "It's an artifact creature at 8+." (in the reminder text).
      const at = /It's an artifact creature at (\d+)\+/.exec(text);
      if (at) {
        result.abilities.push({
          kind: 'static',
          text: `${at[1]}+ | (artifact creature)`,
          gate: { type: 'counters', of: { ref: 'self' }, counter: 'charge', min: Number(at[1]) },
          effect: { type: 'continuous', affected: { ref: 'self' }, addTypes: { types: ['Creature'], subtypes: [] } },
        });
      }
    }
    // CR 702.165a: "Backup N" — "When this creature enters, put N +1/+1 counters on target creature. If that's
    // another creature, it also gains the non-backup abilities of this creature printed below this one until end of turn."
    for (const kw of result.keywords) {
      if (kw.id !== 'backup' || kw.n === undefined || kw.abilities?.length) continue;
      const at = lines.findIndex((l) => /^Backup \d+$/i.test(l.trim()) && Number(/\d+/.exec(l)![0]) === kw.n);
      if (at < 0) continue;
      const below = lines.slice(at + 1).filter((l) => l !== '' && !/^Backup \d+$/i.test(l.trim()));
      const granted = below.length ? this.parse(below.join('\n'), ctx) : { keywords: [], abilities: [], unparsed: [], manualKeywords: [] };
      if (granted.unparsed.length || granted.manualKeywords.length) continue;
      const target = { ref: 'target' as const, index: 0 };
      const gain = granted.keywords.length || granted.abilities.length
        ? [{
            type: 'if',
            cond: { type: 'is', of: target, filter: { other: true } },
            effects: [{ type: 'modify', what: target, keywords: [...granted.keywords, ...(granted.abilities.length ? [{ id: 'ability', text: 'backup', abilities: granted.abilities }] : [])], until: 'eot' }],
          }]
        : [];
      kw.abilities = [{
        kind: 'triggered',
        text: `Backup ${kw.n}`,
        trigger: { type: 'enters', subject: { ref: 'self' } },
        targets: [{ what: 'object', filter: { types: ['Creature'] }, text: 'target creature' }],
        effects: [{ type: 'add_counters', what: target, counter: '+1/+1', amount: kw.n }, ...gain],
      }];
      result.manualKeywords = result.manualKeywords.filter((l) => !/^Backup \d+$/i.test(l.trim()));
    }
    // CR 702.96a–b: "Overload [cost]" — cast for that cost, the spell's "target"s read "each".
    for (const kw of result.keywords) {
      if (kw.id !== 'overload' || !kw.cost || !/^(\{[^}]+\})+$/.test(kw.cost) || kw.abilities?.length) continue;
      const spells = result.abilities.filter((a) => a.kind === 'spell');
      if (spells.length !== 1 || result.unparsed.length) continue;
      const text = spells[0]!.text.replace(/\btarget\b/g, 'each').replace(/\bTarget\b/g, 'Each');
      const overloaded = this.parse(text, ctx);
      const spell = overloaded.abilities.find((a): a is SpellAbility => a.kind === 'spell');
      if (!spell || overloaded.unparsed.length || overloaded.abilities.length !== 1 || spell.targets?.length) continue;
      kw.abilities = [{ kind: 'static', text: `Overload ${kw.cost}`, effect: { type: 'cast_option', id: 'overload', kind: 'alternative', cost: { mana: kw.cost }, spell } as CastOptionNode }];
      result.manualKeywords = result.manualKeywords.filter((l) => !/^Overload\b/.test(l));
    }
    return result;
  }

  /** One ability's lines (a modal block has several) through the grammar rules. */
  private parseBlock(block: string[], env: ParseContext, original = block.join('\n')): AbilityNode | null {
    // Quoted abilities are set aside as QUOTED_n, so sentence and list splitting don't look inside
    // them and the card's name inside them isn't taken for "~" (see grammar/quoted.ts).
    const quotes: string[] = [];
    // A sentence that ends with the quote has its period inside it ('have "{T}: Add {G}."'): keep one outside.
    const masked = block.map((l) =>
      l.replace(/"([^"]*)"|“([^”]*)”/g, (_m, a: string | undefined, b: string | undefined, at: number, all: string) => {
        let inner = (a ?? b)!;
        const after = all.slice(at + _m.length);
        const ends = inner.endsWith('.') && (after === '' || /^\s+[A-Z]/.test(after));
        // 'has "Whenever this creature attacks, untap target creature," and is a Cleric' — the comma is the outer sentence's.
        const comma = inner.endsWith(',');
        if (comma) inner = `${inner.slice(0, -1)}.`;
        return `QUOTED_${quotes.push(inner) - 1}${ends ? '.' : comma ? ',' : ''}`;
      }),
    );
    const normalised = masked
      .map((l, n) => normaliseSelf(n === 0 ? stripAbilityWord(l) : l, env).replace(/[‘’]/g, "'"))
      .join('\n');
    const ctx = quotes.length ? { ...env, quotes } : env;
    for (const rule of this.rules) {
      const node = rule.parse(normalised, original, ctx);
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
    // Awaken's second sentence is conditional as a whole; it's compiled with the spell instead (see parse()).
    if (kw.id === 'awaken') return null;
    const def = EXTRA_DEFINITIONS[kw.id] ?? KEYWORD_DEFINITIONS[kw.id] ?? KEYWORD_DEFINITIONS[`${kw.id}_for`];
    if (!def) return null;
    const printed = keywordText(def.pattern, kw);
    if (printed === null) return null;
    const out: AbilityNode[] = [];
    for (const sentence of def.meaning) {
      // The CR quotes granted abilities with ‘…’; card text uses "…".
      const text = keywordText(sentence, kw)?.replace(/‘([^’']*)['’]/g, '"$1"') ?? null;
      const node = text === null ? null : this.parseBlock([text], env, printed);
      if (!node) return null;
      if (def.zone && node.kind === 'activated') node.zone = def.zone;
      // "Evoke [cost]": the option is named after its keyword, for "if its evoke cost was paid".
      if (node.kind === 'static' && node.effect.type === 'cast_option') node.effect.id = kw.id;
      out.push(node);
    }
    return out;
  }
}

/**
 * Keywords whose CR definition is one of several in a rule: CR 702.124j "Partner with [name]" — the deck
 * rule does nothing in a game; the other ability is this trigger.
 */
const EXTRA_DEFINITIONS: Record<string, { rule: string; pattern: string; meaning: string[]; zone?: 'hand' | 'graveyard' }> = {
  casualty: {
    rule: '702.153a',
    pattern: 'Casualty N',
    meaning: [
      'As an additional cost to cast this spell, you may sacrifice a creature with power N or greater.',
      'When you cast this spell, if a casualty cost was paid for it, copy it. If the spell has any targets, you may choose new targets for the copy.',
    ],
  },
  partner_with: {
    rule: '702.124j',
    pattern: 'Partner with [text]',
    meaning: ['When this permanent enters, target player may search their library for a card named [text], reveal it, put it into their hand, then shuffle.'],
  },
};

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
    // "you may pay [cost] for each age counter" with "Pay 1 life" (cumulative upkeep).
    .replace(/\bpay \[cost\]/g, (m) => {
      const life = kw.cost ? /^[Pp]ay (\d+) life$/.exec(kw.cost) : null;
      return life ? `pay ${life[1]} life` : m;
    })
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
  'creature|land|artifact|enchantment|planeswalker|battle|spell|card|permanent|aura|equipment|vehicle|token|saga|class|case|room|siege|spacecraft|planet';

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
