import { parseEffectText } from './grammar/effects.js';
import type { AbilityNode, CastOptionNode, ConditionNode, KeywordInstance, SpellAbility } from '@mtg/schema';
import { keywordSupported, shortName, stripReminder, SUBTYPES } from '@mtg/schema';
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
    // CR 309.4: a dungeon's rooms, topmost first — "Room — Effect. (Leads to: A, B)", each a room ability (CR 309.4c).
    if (/^Dungeon\b/.test(ctx.typeLine)) {
      for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        if (/^You can't enter this dungeon unless you /.test(line)) {
          result.abilities.push({ kind: 'static', text: line, effect: { type: 'dungeon_entry' } });
          continue;
        }
        const room = /^(.+?) — (.+?)(?: \(Leads to: ([^)]+)\))?$/.exec(line);
        const node = room ? this.parseBlock([`When you move your venture marker into this room, ${room[2]!.replace(/^\w/, (ch) => ch.toLowerCase())}`], env) : null;
        if (!room) {
          result.unparsed.push(line);
          continue;
        }
        const trigger = { type: 'room', room: room[1]!, leadsTo: room[3] ? room[3].split(/, (?:or )?| or /) : [] };
        if (node?.kind === 'triggered') {
          node.text = line;
          node.trigger = trigger;
          result.abilities.push(node);
        } else {
          // The room still exists (the marker can move through it); its ability is resolved by hand.
          result.abilities.push({ kind: 'triggered', text: line, trigger, effects: [], manual: true });
          result.unparsed.push(line);
        }
      }
      return result;
    }
    const lines = text.split('\n').map(stripReminder);
    // Cabal Ritual: "Add {B}{B}{B}." then "Threshold — Add {B}{B}{B}{B}{B} instead if …" — on an instant or sorcery
    // the second line replaces the first (CR 608.2c), so they're read as one.
    if (/\b(?:Instant|Sorcery)\b/.test(ctx.typeLine)) {
      for (let i = 1; i < lines.length; i++) {
        const next = stripAbilityWord(lines[i]!);
        // Stubborn Denial: "Ferocious — If you control a creature with power 4 or greater, counter that spell instead.";
        // Temur Battle Rage: "Ferocious — That creature also gains trample …" — about what the line before did.
        const wordless = next !== lines[i];
        // Dispatch: "Metalcraft — If you control three or more artifacts, exile that creature." — the target of the line before.
        const refersBack = /\b(?:that|those) (?:creature|creatures|spell|permanent|player|card|land)\b|\bthe same (?:target|creature)\b/i.test(next);
        const joins = /^[A-Z][^.]* instead if [^.]+\.$/.test(next) || /^If (?![^,]* would )[^.]+, [^.]+ instead\.$/.test(next) || (wordless && refersBack && /^(?:If|That|Those)\b[^.]*\.$/.test(next));
        const plain = (l: string | undefined) => Boolean(l) && /\.$/.test(l!) && !/^[•+]/.test(l!) && !/^(?:As an additional cost|This spell|Cast this spell|~ can't be countered)/.test(l!);
        if (joins && plain(lines[i - 1])) {
          // Code of Constraint: "Target creature gets -4/-0 …. / Draw a card. / Addendum — If …, tap that creature …" — back
          // to the line that has the target.
          let j = i - 1;
          if (refersBack && !/\btarget\b/i.test(lines[j]!)) {
            let k = j - 1;
            while (k >= 0 && plain(lines[k]) && !/\btarget\b/i.test(lines[k]!)) k--;
            if (k >= 0 && plain(lines[k])) j = k;
          }
          lines.splice(j, i - j + 1, [...lines.slice(j, i), next].join(' '));
          i = j;
        }
      }
    }
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
      // CR 702.47a: "Splice onto Arcane {1}{R}" (a keyword with a quality and a cost).
      const splice = /^Splice onto (Arcane|instant or sorcery) ((?:\{[^}]+\})+)$/.exec(line);
      if (splice) {
        result.keywords.push({ id: 'splice', text: splice[1]!, cost: splice[2]! });
        continue;
      }
      // CR 702.177a: "Exhaust — [Cost]: [Effect]" means "[Cost]: [Effect]. Activate only once."
      // CR 702.193a: "Power-up — [Cost]: [Effect]" also costs less by its mana cost the turn it entered.
      const exhaust = /^(Exhaust|Power-up) — (.+)$/.exec(line);
      if (exhaust) {
        const node = this.parseBlock([exhaust[2]!], env, line);
        if (node?.kind === 'activated') {
          node.oncePerGame = true;
          if (exhaust[1] === 'Power-up') node.powerUp = true;
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

      // "You may cast this spell as though it had flash." — that's flash (CR 702.8a).
      if (line === 'You may cast this spell as though it had flash.' || line === 'You may cast ~ as though it had flash.') {
        result.keywords.push({ id: 'flash' });
        continue;
      }
      // CR 702.174: "Gift a card" — an optional additional cost (choose an opponent), and what they get: first, as an
      // instant or sorcery resolves (CR 702.174j), or "When this permanent enters, if its gift cost was paid, …".
      const gift = /^Gift (a card|a Food|a Treasure|a tapped Fish|an Octopus|an extra turn)$/.exec(line);
      if (gift) {
        const what: Record<string, string> = {
          'a card': 'Draw a card.',
          'a Food': 'Create a Food token.',
          'a Treasure': 'Create a Treasure token.',
          'a tapped Fish': 'Create a tapped 1/1 blue Fish creature token.',
          'an Octopus': 'Create an 8/8 blue Octopus creature token.',
          'an extra turn': 'Take an extra turn after this one.',
        };
        const effects = parseEffectText(what[gift[1]!]!, new Binder(env as GrammarEnv));
        if (!effects) {
          result.unparsed.push(line);
          continue;
        }
        result.abilities.push({ kind: 'static', text: line, effect: { type: 'cast_option', id: 'gift', kind: 'additional', cost: {}, chooseOpponent: true } });
        if (/\b(?:Instant|Sorcery)\b/.test(ctx.typeLine)) result.abilities.push({ kind: 'static', text: line, effect: { type: 'gift_spell', effects } });
        else {
          result.abilities.push({
            kind: 'triggered',
            text: line,
            trigger: { type: 'enters', subject: { ref: 'self' } },
            condition: { type: 'paid', cost: 'gift' },
            effects: [{ type: 'give_gift', effects }],
          });
        }
        continue;
      }
      // CR 702.172a: "Spree" — choose one or more modes, paying each one's "+ {cost} —" as an additional cost;
      // CR 702.183a: "Tiered" — choose one, paying its "• Name — {cost} —".
      if (line === 'Spree' || line === 'Tiered') {
        const raw: string[] = [line];
        const bullets: string[] = [];
        const costs: string[] = [];
        const spree = line === 'Spree';
        while (i + 1 < lines.length) {
          const m = spree ? /^\+ ((?:\{[^}]+\})+) — (.+)$/.exec(lines[i + 1]!) : /^• [^—]+ — ((?:\{[^}]+\})+) — (.+)$/.exec(lines[i + 1]!);
          if (!m) break;
          raw.push(lines[++i]!);
          costs.push(m[1]!);
          bullets.push(`• ${m[2]}`);
        }
        const node = bullets.length ? this.parseBlock([spree ? 'Choose one or more —' : 'Choose one —', ...bullets], env, raw.join('\n')) : null;
        if (node && node.kind === 'spell' && node.modes && node.modes.options.length === costs.length) {
          node.modes.options.forEach((o, k) => {
            if (costs[k] !== '{0}') o.cost = costs[k];
          });
          result.abilities.push(node);
        } else result.unparsed.push(...raw);
        continue;
      }
      // CR 700.2: a modal header ("Choose one —", "When ~ enters, choose one —") and its bullets form one ability.
      const block = [line];
      if (
        /\bchoose (?:one|two|three|four|five|one or both|one or more|any number|up to one|up to two) —$/i.test(line) ||
        /^Choose (?:one|two)\. If .+ instead\.$/.test(line) ||
        /\b[Cc]hoose (?:one|two|three|four|five)\. You may choose the same mode more than once\.$/.test(line)
      ) {
        while (i + 1 < lines.length && lines[i + 1]!.startsWith('• ')) block.push(lines[++i]!);
      }
      // CR 706.3b: a die roll and its results table are one ability.
      if (/\b[Rr]oll (?:a|two) d\d+(?: and ignore the lower roll)?\.$/.test(line)) {
        while (i + 1 < lines.length && /^\d+(?:—\d+|\+)? \| /.test(lines[i + 1]!)) block.push(lines[++i]!);
      }

      const node = this.parseBlock(block, env);
      if (node && gate) node.gate = gate;
      if (node) result.abilities.push(node);
      else result.unparsed.push(...block);
    }
    for (const kw of result.keywords) {
      // CR 702.110a: "When this creature enters, you may sacrifice a creature" — marked so "exploits a creature" can see it.
      if (kw.id === 'exploit') {
        kw.abilities = [{
          kind: 'triggered',
          text: 'Exploit',
          trigger: { type: 'enters', subject: { ref: 'self' } },
          effects: [{ type: 'may', effects: [{ type: 'sacrifice_choice', who: { ref: 'you' }, filter: { types: ['Creature'] }, amount: 1, exploit: true }] }],
        }];
      }
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
      // CR 702.194a: "Teamwork N" — "As an additional cost to cast this spell, you may tap any number of creatures you
      // control with total power N or more."
      // CR 702.167a: "Craft with [materials] [cost]" — "[Cost], Exile this permanent, Exile [materials] from among
      // permanents you control and/or cards in your graveyard: Return this card to the battlefield transformed under its
      // owner's control. Activate only as a sorcery."
      const craft = kw.id === 'craft' ? /^with (an? |one or more )?(artifact|creature|land|enchantment|artifacts|creatures|lands) ((?:\{[^}]+\})+)$/.exec(kw.cost ?? '') : null;
      if (craft) {
        const TYPES: Record<string, string> = { artifact: 'Artifact', creature: 'Creature', land: 'Land', enchantment: 'Enchantment' };
        const type = TYPES[craft[2]!.replace(/s$/, '')]!;
        kw.abilities = [{
          kind: 'activated',
          text: `Craft with ${craft[1] ?? ''}${craft[2]} ${craft[3]}`,
          cost: { mana: craft[3]!, other: [{ type: 'craft', filter: { types: [type] }, amount: 1, ...(craft[1] === 'one or more ' ? { anyNumber: true } : {}) }] },
          effects: [{ type: 'craft_return' }],
          timing: 'sorcery',
        }];
        result.manualKeywords = result.manualKeywords.filter((l) => !/^Craft\b/.test(l));
      }
      if (kw.id === 'teamwork' && kw.n !== undefined) {
        kw.abilities = [{ kind: 'static', text: `Teamwork ${kw.n}`, effect: { type: 'cast_option', id: 'teamwork', kind: 'additional', cost: { other: [{ type: 'crew', power: kw.n }] } } }];
        result.manualKeywords = result.manualKeywords.filter((l) => !/^Teamwork\b/.test(l));
      }
      // CR 702.191a: "Increment" — "Whenever you cast a spell, if … the amount of mana spent to cast that spell is greater
      // than this creature's power or this creature's toughness, put a +1/+1 counter on this creature."
      if (kw.id === 'increment') {
        kw.abilities = [{
          kind: 'triggered',
          text: 'Increment',
          trigger: { type: 'cast', who: 'you', filter: {}, increment: true },
          effects: [{ type: 'add_counters', counter: '+1/+1', amount: 1, what: { ref: 'self' } }],
        }];
        result.manualKeywords = result.manualKeywords.filter((l) => l !== 'Increment');
      }
      // CR 702.116a: "Myriad" — whenever this creature attacks, token copies attacking each other opponent.
      // CR 702.189a: "Whenever this creature attacks, add N {R}. Until end of combat, you don't lose this mana as steps and phases end."
      if (kw.id === 'firebending' && kw.n !== undefined) {
        kw.abilities = [{
          kind: 'triggered',
          text: `Firebending ${kw.n}`,
          trigger: { type: 'attacks', subject: { ref: 'self' } },
          effects: [{ type: 'add_mana', options: [Array.from({ length: kw.n }, () => 'R')], keep: 'end_of_combat' }],
        }];
        result.manualKeywords = result.manualKeywords.filter((l) => !/^Firebending\b/.test(l));
      }
      // CR 702.75a: "Hideaway N" — "When this permanent enters, look at the top N cards of your library. Exile one of
      // them face down and put the rest on the bottom of your library in a random order."
      if (kw.id === 'hideaway' && kw.n !== undefined) {
        kw.abilities = [{ kind: 'triggered', text: `Hideaway ${kw.n}`, trigger: { type: 'enters', subject: { ref: 'self' } }, effects: [{ type: 'hideaway', amount: kw.n }] }];
        result.manualKeywords = result.manualKeywords.filter((l) => !/^Hideaway\b/.test(l));
      }
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
        // Urza's Saga: '… with 'This token gets +1/+1 for each artifact you control.'"' — a quote inside ends it too.
        const ends = /\.['’]?$/.test(inner) && (after === '' || /^\s+[A-Z]/.test(after));
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
  // CR 702.151a: two activated abilities, quoted in one sentence of the rule.
  reconfigure: {
    rule: '702.151a',
    pattern: 'Reconfigure [cost]',
    meaning: [
      '[cost]: Attach this permanent to another target creature you control. Activate only as a sorcery.',
      '[cost]: Unattach this permanent. Activate only if this permanent is attached to a creature and only as a sorcery.',
    ],
  },
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

const TITLES = new Set(['The', 'Lord', 'Lady', 'Captain', 'King', 'Queen', 'General', 'Sir', 'Saint', 'Mother', 'Father', 'Doctor', 'Professor', 'Agent', 'Ambassador', 'Prince', 'Princess', 'Grand', 'High', 'Old', 'Young', 'Great', 'Elder', 'Master', 'Commander', 'Baron', 'Count', 'Duke', 'Sister', 'Brother', 'Uncle', 'Aunt', 'Mister', 'Miss', 'Admiral', 'Chief', 'Emperor', 'Empress']);
function firstName(name: string): string | undefined {
  if (name.includes(',') || name.includes(' // ')) return undefined;
  const m = /^([A-Z][\p{L}'’-]{2,}) (?:of |the |[A-Z])/u.exec(name);
  const w = m?.[1];
  if (!w || TITLES.has(w) || /['’]s$/.test(w)) return undefined;
  // A creature type or card type word is more likely the type than the card ("Goblin …").
  if ((SUBTYPES.creature as readonly string[]).includes(w) || TYPE_NOUNS[w.toLowerCase()]) return undefined;
  return w;
}

export function normaliseSelf(line: string, ctx: ParseContext): string {
  let out = line;
  // A legendary card may call itself by the first word of its name: "Barrowin of Clan Undurr" → "Barrowin",
  // "Acererak the Archlich" → "Acererak", "Ajani Vengeant" → "Ajani" (not a title or a type word).
  const legendary = /\bLegendary\b/.test(ctx.typeLine);
  const ofName = legendary ? firstName(ctx.faceName) : undefined;
  // "Rosie Cotton of South Lane" → "Rosie Cotton".
  const beforeOf = legendary && !ctx.faceName.includes(',') ? /^([A-Z][\p{L}'’-]+ [A-Z][\p{L}'’-]+) of [A-Z]/u.exec(ctx.faceName)?.[1] : undefined;
  const names = new Set([ctx.faceName, ctx.cardName, shortName(ctx.faceName), ...(ofName ? [ofName] : []), ...(beforeOf ? [beforeOf] : [])].filter((n) => n.length > 1));
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
