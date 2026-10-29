import { parseEffectText } from './grammar/effects.js';
import type { AbilityNode, CastOptionNode, ConditionNode, KeywordInstance, ObjectFilter, SpellAbility } from '@mtg/schema';
import { keywordSupported, shortName, stripReminder, SUBTYPES } from '@mtg/schema';
import { Binder, type GrammarEnv } from './grammar/binder.js';
import { parseFilter } from './grammar/nouns.js';
import { parseCondition } from './grammar/conditions.js';
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
  /** The face's mana cost: "{X}" in it means X is announced as the spell is cast (CR 107.3a). */
  manaCost?: string;
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
    // CR 702.148a: cleave — the text with its square-bracketed words, and (cast for the cleave cost) without them.
    const cleaved = /^Cleave (?:\{[^}]+\})+/m.test(text) && /\[[^\]]+\]/.test(text) ? text.replace(/ ?\[[^\]]+\]/g, '') : undefined;
    if (cleaved !== undefined) text = text.replace(/\[([^\]]+)\]/g, '$1');
    // Battle Angels of Tyr: "Flying, myriad" — a keyword line is read once each of its keywords is (myriad's ability is
    // attached below).
    const lineKeywords = new Map<string, KeywordInstance[]>();
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
    // Traxos: "Traxos enters tapped and doesn't untap during your untap step."; Sphere of the Suns: "This artifact enters
    // tapped and with three charge counters on it." — two static abilities in one sentence, read as two lines.
    const lines = text
      .split('\n')
      .map(stripReminder)
      .flatMap((l) => {
        // Thunderfoot Baloth: "Lieutenant — As long as you control your commander, this creature gets +2/+2 and other
        // creatures you control get +2/+2 and have trample." — two static abilities under one condition.
        const names = [ctx.faceName, ctx.faceName.split(',')[0]!].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
        const pair = new RegExp(`^((?:[A-Z][\\w' ]+ — )?As long as [^,]+, )((?:this creature|${names}) gets? [+-]\\d+\\/[+-]\\d+) and ((?:other )?creatures you control (?:get|have) [^"]+)\\.$`).exec(l);
        if (pair) return [`${pair[1]}${pair[2]}.`, `${pair[1]}${pair[3]}.`];
        // Rakdos, Lord of Riots: "You can't cast Rakdos unless an opponent lost life this turn." — cast it only if that holds.
        const castUnless = new RegExp(`^You can't cast (?:~|this spell|${names}) unless (.+)\\.$`).exec(l);
        if (castUnless) return [`Cast this spell only if ${castUnless[1]}.`];
        // Nighthowler, Eidolon of Countless Battles (bestow): "This creature and enchanted creature each get +X/+X, where X is …"
        const andEnchanted = /^(?:This creature|~) and enchanted creature each get (.+)\.$/.exec(l);
        if (andEnchanted) {
          // Eidolon of Countless Battles: "+1/+1 for each creature you control and +1/+1 for each Aura you control" — the two
          // counts added.
          const each = andEnchanted[1]!.replace(/^(\+\d+\/\+\d+) for each (.+?) and \1 for each (.+)$/, '$1 for each $2 and each $3');
          return [`This creature gets ${each}.`, `Enchanted creature gets ${each}.`];
        }
        // Tidal Barracuda: "Any player may cast spells as though they had flash."
        if (l === 'Any player may cast spells as though they had flash.') return ['Players may cast spells as though they had flash.'];
        // Vizier of the Menagerie: "You can spend mana of any type to cast creature spells." — as though any color.
        const anyType = /^You can spend mana of any type to cast (.+) spells\.$/.exec(l);
        if (anyType) return [`You may spend mana as though it were mana of any color to cast ${anyType[1]} spells.`];
        // Dion, Bahamut's Dominant: "During your turn, Dion and other Knights you control have flying."; Yuna: "Yuna and
        // enchantment creatures you control have …" — the card, and the others (once each).
        const selfAndOthers = new RegExp(`^((?:[A-Z][\\w' ]+ — )?(?:During your turn, )?)(?:~|this creature|${names}) and (?:other )?(.+? you control) have (.+)\\.$`).exec(l);
        if (selfAndOthers && !/\bget\b/.test(selfAndOthers[3]!)) {
          const lead = selfAndOthers[1]!;
          return [`${lead}${lead ? '~' : '~'} has ${selfAndOthers[3]}.`, `${lead}${lead ? 'other' : 'Other'} ${selfAndOthers[2]} have ${selfAndOthers[3]}.`];
        }
        // Mycosynth Golem: "Artifact creature spells you cast have affinity for artifacts." — CR 702.41a: each costs {1} less
        // for each artifact you control (Pearl-Ear: "affinity for Auras").
        const affinity = /^((?:[A-Z][a-z]+(?: and [a-z]+| [a-z]+)* )?[Ss]pells you cast) have affinity for (artifacts|Auras|Equipment|enchantments|creatures)\.$/.exec(l);
        if (affinity) return [`${affinity[1]} cost {1} less to cast for each ${affinity[2] === 'Equipment' ? 'Equipment' : affinity[2]!.replace(/s$/, '')} you control.`];
        // Thryx, the Sudden Storm: "Spells you cast with mana value 5 or greater cost {1} less to cast and can't be countered."
        const costAndUncounterable = /^(.*\b[Ss]pells you cast\b.*?) cost (\{\d+\}) less to cast and can't be countered\.$/.exec(l);
        if (costAndUncounterable) return [`${costAndUncounterable[1]} cost ${costAndUncounterable[2]} less to cast.`, `${costAndUncounterable[1]} can't be countered.`];
        // "gets +1/+1 for each creature you control and +1/+1 for each Aura you control" — the two counts added.
        const twoEach = /^(.+? gets? )(\+\d+\/\+\d+) for each (.+?) and (\+\d+\/\+\d+) for each (.+?)\.$/.exec(l);
        if (twoEach && twoEach[2] === twoEach[4]) return [`${twoEach[1]}${twoEach[2]} for each ${twoEach[3]} and each ${twoEach[5]}.`];
        // Khalni Heart Expedition: "Remove three quest counters from this enchantment and sacrifice it: …" — both costs.
        const removeAndSac = /^(Remove (?:a|an|\w+) \S+ counters? from (?:this \w+|~)) and sacrifice it: (.+)$/.exec(l);
        if (removeAndSac) return [`${removeAndSac[1]}, Sacrifice ~: ${removeAndSac[2]}`];
        // Jace Reawakened: "You can't cast Jace Reawakened during your first, second, or third turns of the game."
        if (new RegExp(`^You can't cast (?:~|this spell|${names}) during your first, second, or third turns of the game\\.$`).test(l)) return ["Cast this spell only if it isn't your first, second, or third turn of the game."];
        // Aettir and Priwen: "… has base power and toughness X/X, where X is your life total." — each equal to that.
        const baseX = /^(.+ ha(?:s|ve) base power and toughness) X\/X, where X is (.+)\.$/.exec(l);
        if (baseX) return [`${baseX[1]} each equal to ${baseX[2]}.`];
        // Multiversal Passage: "As this land enters, choose a basic land type. Then you may pay 2 life. If you don't, it enters
        // tapped." — two replacement effects as it enters, in that order (CR 614.12).
        const thenPay = /^(As (?:this land|~) enters), (choose a basic land type)\. Then (you may pay \d+ life\. If you don't, it enters tapped\.)$/.exec(l);
        if (thenPay) return [`${thenPay[1]}, ${thenPay[2]}.`, `${thenPay[1]}, ${thenPay[3]}`];
        // "This land is the chosen type." — a land with no land types of its own just has that one (CR 305.7 has nothing to replace).
        if (/^(?:This land|~) is the chosen type\.$/.test(l) && /^Land$/.test(ctx.typeLine.trim())) return [l.replace(/\.$/, ' in addition to its other types.')];
        const both = /^(.+?) enters tapped and (doesn't untap during your untap step|with .+ counters? on it)\.$/.exec(l);
        if (!both) return [l];
        return [`${both[1]} enters tapped.`, both[2]!.startsWith('with') ? `${both[1]} enters ${both[2]}.` : `${both[1]} ${both[2]}.`];
      });
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
        // Demonic Counsel: "Delirium — If there are four or more card types …, instead search your library for any card, …".
        const joins =
          /^[A-Z][^.]* instead if [^.]+\.$/.test(next) ||
          /^If (?![^,]* would )[^.]+, [^.]+ instead\.$/.test(next) ||
          /^If (?![^,]* would )[^,]+, instead [^.]+\.$/.test(next) ||
          (wordless && refersBack && /^(?:If|That|Those)\b[^.]*\.$/.test(next));
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
    let wordOptions: string[] | undefined;
    const isClass = /\bClass\b/.test(ctx.typeLine);
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]!;
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

      // Torgaar, Famine Incarnate: "As an additional cost to cast this spell, you may sacrifice any number of creatures. This
      // spell costs {2} less to cast for each creature sacrificed this way."; Plumb the Forbidden: "… you may sacrifice one or
      // more creatures. When you do, copy this spell for each creature sacrificed this way." — as many as you choose.
      const sacAny = /^As an additional cost to cast (?:this spell|~), you may sacrifice (?:any number of|one or more) (.+?)\. (?:(?:This spell|~) costs \{(\d+)\} less to cast for each (?:[a-z]+) sacrificed this way|When you do, (copy (?:this spell|~) for each [a-z]+ sacrificed this way))\.$/.exec(line);
      if (sacAny) {
        const base = this.parseBlock([`As an additional cost to cast this spell, sacrifice X ${sacAny[1]}.`], env, line);
        const cost = base?.kind === 'static' && base.effect.type === 'additional_cost' ? (base.effect as unknown as { cost: { type: string; amount?: unknown } }).cost : null;
        if (cost?.type === 'sacrifice' && cost.amount === 'X') {
          cost.amount = 'any';
          result.abilities.push(base!);
          if (sacAny[2]) {
            result.abilities.push({ kind: 'static', text: line, effect: { type: 'cost_modifier', self: true, change: 'less', amount: Number(sacAny[2]), perSacrificed: true } } as AbilityNode);
          } else {
            result.abilities.push({
              kind: 'triggered',
              text: line,
              trigger: { type: 'cast', who: 'you', self: true },
              condition: { type: 'amount', amount: { kind: 'sacrificed_to_cast', of: { ref: 'self' } }, op: 'ge', n: 1 },
              effects: [{ type: 'copy_spell', what: { ref: 'self' }, amount: { kind: 'sacrificed_to_cast', of: { ref: 'self' } } }],
              zone: 'stack',
            } as AbilityNode);
          }
          continue;
        }
      }
      // March of Swirling Mist: "As an additional cost to cast this spell, you may exile any number of blue cards from your hand.
      // This spell costs {2} less to cast for each card exiled this way." — as many as you choose (CR 601.2b, 601.2f).
      const exileAny = /^As an additional cost to cast (?:this spell|~), you may exile any number of (.+?) cards from your hand\. (?:This spell|~) costs \{(\d+)\} less to cast for each card exiled this way\.$/.exec(line);
      if (exileAny) {
        const one = /^[aeiou]/i.test(exileAny[1]!) ? 'an' : 'a';
        const base = this.parseBlock([`As an additional cost to cast this spell, exile ${one} ${exileAny[1]} card from your hand.`], env, line);
        const cost = base?.kind === 'static' && base.effect.type === 'additional_cost' ? (base.effect as unknown as { cost: { type: string; amount?: unknown; from?: string } }).cost : null;
        if (cost?.type === 'exile_cards' && cost.from === 'hand' && cost.amount === 1) {
          cost.amount = 'any';
          result.abilities.push(base!, { kind: 'static', text: line, effect: { type: 'cost_modifier', self: true, change: 'less', amount: Number(exileAny[2]), perExiled: true } } as AbilityNode);
        } else result.unparsed.push(line);
        continue;
      }
      // Necromancy: "You may cast this spell as though it had flash. If you cast it any time a sorcery couldn't have been cast,
      // the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step." — flash, and (as
      // the permanent it became) a delayed trigger for the next cleanup step (CR 514.3a).
      if (/^You may cast (?:this spell|~) as though it had flash\. If you cast it any time a sorcery couldn't have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step\.$/.test(line)) {
        result.keywords.push({ id: 'flash' } as KeywordInstance);
        result.abilities.push({
          kind: 'triggered',
          text: line,
          trigger: { type: 'enters', subject: { ref: 'self' } },
          condition: { type: 'cast_off_sorcery_timing' },
          effects: [{ type: 'delayed', step: 'cleanup', effects: [{ type: 'sacrifice', what: { ref: 'self' } }] }],
        } as AbilityNode);
        continue;
      }
      // Necromancy: "When this enchantment enters, if it's on the battlefield, it becomes an Aura with "enchant creature put onto
      // the battlefield with Necromancy." Put target creature card from a graveyard onto the battlefield under your control and
      // attach this enchantment to it. When this enchantment leaves the battlefield, that creature's controller sacrifices it."
      const becomesAura = /^When (?:this enchantment|~) enters, if it's on the battlefield, it becomes an Aura with "enchant creature put onto the battlefield with (?:~|this enchantment|[^"]+)\.?" Put target creature card from a graveyard onto the battlefield under your control and attach (?:this enchantment|~) to it\. When (?:this enchantment|~) leaves the battlefield, that creature's controller sacrifices it\.$/.exec(line);
      if (becomesAura) {
        result.abilities.push(
          {
            kind: 'triggered',
            text: line,
            trigger: { type: 'enters', subject: { ref: 'self' } },
            targets: [{ what: 'object', filter: { zone: 'graveyard', types: ['Creature'] }, text: 'target creature card from a graveyard' }],
            effects: [{ type: 'reanimate_attach', what: { ref: 'target', index: 0 }, becomeAura: true }],
          } as AbilityNode,
          {
            kind: 'triggered',
            text: "When this enchantment leaves the battlefield, that creature's controller sacrifices it.",
            trigger: { type: 'leaves', subject: { ref: 'self' } },
            effects: [{ type: 'sacrifice_linked' }],
          } as AbilityNode,
        );
        continue;
      }
      // Animate Dead: "… attach this Aura to it. When this Aura leaves the battlefield, that creature's controller sacrifices
      // it." — two triggered abilities in one paragraph, the second linked to the first (CR 607.2): it sacrifices the
      // creature the first put onto the battlefield.
      const linked = /^(When .+ attach this Aura to it\.) When this Aura leaves the battlefield, that creature's controller sacrifices it\.$/.exec(line);
      if (linked) {
        const first = this.parseBlock([linked[1]!], env);
        if (first?.kind === 'triggered' && first.effects.some((e) => e.type === 'reanimate_attach')) {
          result.abilities.push(first, {
            kind: 'triggered',
            text: "When this Aura leaves the battlefield, that creature's controller sacrifices it.",
            trigger: { type: 'leaves', subject: { ref: 'self' } },
            effects: [{ type: 'sacrifice_linked' }],
          } as AbilityNode);
        } else result.unparsed.push(line);
        continue;
      }
      // Maelstrom Nexus: "The first spell you cast each turn has cascade."; Wild-Magic Sorcerer: "The first spell you cast from
      // exile each turn has cascade."; Thrumming Stone-like grants: "Spells you cast have cascade." — layer 6 on spells (CR
      // 613.1f), so the cast trigger is there as it's cast (CR 702.85a).
      // Imoti, Celebrant of Bounty: "Spells you cast with mana value 6 or greater have cascade."
      // Wildsear, Scouring Maw: "Enchantment spells you cast from your hand have cascade."
      const fromHand = / from your hand have (?:cascade|storm)\.$/.test(line) ? line.replace(/ from your hand have /, ' have ') : line;
      // The First Sliver: "Sliver spells you cast have cascade." — a card type or a subtype.
      const kind = /^([A-Z][a-z]+) spells you cast (?:have|with)/.exec(fromHand)?.[1];
      const kindFilter = kind ? parseFilter(`${['Enchantment', 'Artifact', 'Creature', 'Instant', 'Sorcery', 'Planeswalker'].includes(kind) ? kind.toLowerCase() : kind} spells`, new Binder(env as GrammarEnv)) : null;
      const spellGrant = /^(?:The first spell you cast( from exile)? each turn has|((?:Instant and sorcery )?)Spells you cast(?: with mana value (\d+) or greater)? have) (cascade|storm)\.$/i.exec(kind ? fromHand.replace(/^\w+ spells/, 'Spells') : fromHand);
      if (spellGrant) {
        const kws = this.keywords.parseLine(spellGrant[4]!);
        if (kws?.length === 1) {
          const abilities = this.expandKeyword(kws[0]!, env);
          if (abilities) kws[0]!.abilities = abilities;
        }
        if (kws?.length === 1 && keywordSupported(kws[0]!)) {
          const filter: ObjectFilter = { controller: 'you', zone: 'stack', ...(spellGrant[2] ? { types: ['Instant', 'Sorcery'] } : {}), ...(kindFilter ? (({ zone: _z, ...f }) => f)(kindFilter.filter) : {}), ...(fromHand !== line ? { castFromZone: 'hand' as const } : {}), ...(spellGrant[3] ? { manaValue: { op: 'ge', n: Number(spellGrant[3]) } } : {}), ...(/^The first/i.test(line) ? { firstCastThisTurn: spellGrant[1] ? { fromZone: 'exile' as const } : {} } : {}) };
          result.abilities.push({ kind: 'static', text: line, effect: { type: 'continuous', affected: { ref: 'all', filter }, keywords: kws } } as AbilityNode);
        } else result.unparsed.push(line);
        continue;
      }
      // Sephiroth, One-Winged Angel: "Super Nova — As this creature transforms into Sephiroth, One-Winged Angel, you get an
      // emblem with "…"" — done as it transforms (not a trigger, CR 701.27).
      const asTransforms = /^(?:[A-Z][\w' ]+ — )?As (?:this creature|this permanent|~) transforms into ([^,]+(?:, [^,]+)?), (you get an emblem with .+)$/.exec(line);
      if (asTransforms && (asTransforms[1] === '~' || asTransforms[1] === ctx.faceName || asTransforms[1] === ctx.faceName.split(',')[0])) {
        const node = this.parseBlock([`When this creature transforms into ~, ${asTransforms[2]}`], env, line);
        if (node?.kind === 'triggered' && node.effects.length && node.effects.every((e) => e.type === 'emblem') && !node.targets?.length) {
          result.abilities.push({ kind: 'static', text: line, effect: { type: 'as_transforms', effects: node.effects } } as AbilityNode);
        } else result.unparsed.push(line);
        continue;
      }
      // Ulamog, the Defiler: "Ulamog has annihilator X, where X is the number of +1/+1 counters on it." — CR 702.86a's
      // trigger, with that many permanents.
      const annihilatorX = /^(.+?) has annihilator X, where X is the number of (\S+) counters on it\.$/.exec(line);
      const selfName = (n: string) => n === '~' || n === 'This creature' || n === ctx.faceName || n === ctx.faceName.split(',')[0];
      // CR 604.3: Mistform Ultimus: "~ is every creature type (even if this card isn't on the battlefield)." — the same
      // characteristic-defining ability as changeling (CR 702.73a), in every zone.
      const everyType = /^(.+?) is every creature type\.$/.exec(line);
      if (everyType && selfName(everyType[1]!)) {
        result.keywords.push({ id: 'changeling' });
        continue;
      }
      if (annihilatorX && selfName(annihilatorX[1]!)) {
        const node = this.parseBlock(['Whenever ~ attacks, defending player sacrifices two permanents of their choice.'], env, line);
        const sac = node?.kind === 'triggered' && node.effects.length === 1 && node.effects[0]!.type === 'sacrifice_choice' ? node.effects[0]! : null;
        if (node && sac) {
          sac.amount = { kind: 'counters', of: { ref: 'self' }, counter: annihilatorX[2]! };
          result.abilities.push(node);
        } else result.unparsed.push(line);
        continue;
      }
      // The Sieges, Mirrodin Besieged: "As this enchantment enters, choose Khans or Dragons." then "• Khans — [ability]" and
      // "• Dragons — [ability]" — each ability is the permanent's only while that word is the one chosen (CR 614.12).
      const words = /^As (?:this enchantment|this permanent|~) enters, choose ([A-Z][A-Za-z]+) or ([A-Z][A-Za-z]+)\.$/.exec(line);
      if (words && lines.slice(i + 1).some((l) => l.startsWith(`• ${words[1]} — `) || l.startsWith(`• ${words[2]} — `))) {
        wordOptions = [words[1]!, words[2]!];
        result.abilities.push({ kind: 'static', text: line, effect: { type: 'as_enters', choice: 'word', options: wordOptions } } as AbilityNode);
        continue;
      }
      const wordBullet = wordOptions ? /^• ([A-Z][A-Za-z]+) — (.+)$/.exec(line) : null;
      if (wordBullet && wordOptions!.includes(wordBullet[1]!)) {
        const wordGate: ConditionNode = { type: 'chosen_word', word: wordBullet[1]! };
        const inner = this.keywords.parseLine(wordBullet[2]!);
        if (inner) {
          for (const kw of inner) {
            const abilities = this.expandKeyword(kw, env);
            if (abilities) kw.abilities = abilities;
          }
          if (!inner.every(keywordSupported)) result.manualKeywords.push(line);
          else result.abilities.push({ kind: 'static', text: line, gate: wordGate, effect: { type: 'continuous', affected: { ref: 'self' }, keywords: inner } });
          continue;
        }
        const node = this.parseBlock([wordBullet[2]!], env, line);
        if (node) {
          node.gate = wordGate;
          result.abilities.push(node);
        } else result.unparsed.push(line);
        continue;
      }
      // CR 719.3c: "To solve — [condition]" means "At the beginning of your end step, if this Case is not solved and
      // [condition], it becomes solved."
      const toSolve = /^To solve — (.+?)\.?$/.exec(line);
      if (toSolve) {
        const cond = parseCondition(toSolve[1]!.replace(/^\w/, (c) => c.toLowerCase()), new Binder(env as GrammarEnv));
        if (cond) result.abilities.push({ kind: 'triggered', text: line, trigger: { type: 'phase', step: 'end', whose: 'you' }, condition: { type: 'and', all: [{ type: 'solved', not: true }, cond] }, effects: [{ type: 'solve' }] } as AbilityNode);
        else result.unparsed.push(line);
        continue;
      }
      // CR 702.169a: "Solved — [ability]" means "As long as this Case is solved, [ability]."
      const solvedLine = /^Solved — (.+)$/.exec(line);
      if (solvedLine) {
        const node = this.parseBlock([solvedLine[1]!], env, line);
        if (node) {
          node.gate = { type: 'solved' };
          result.abilities.push(node);
        } else result.unparsed.push(line);
        continue;
      }
      // CR 702.178a: "Max speed — [Ability]" means "As long as your speed is 4, this object has '[Ability].'"
      // CR 721.2a: "{N+} | [abilities]" means "As long as this permanent has N or more charge counters on it, it has [abilities]."
      // CR 702.186b: "∞ — [Ability]" means "As long as this permanent is harnessed, it has [ability]."
      const maxSpeed = /^Max speed — (.+)$/.exec(line) ?? /^∞ — (.+)$/.exec(line);
      const stationSymbol = /^(\d+)\+ \| (.+)$/.exec(line);
      if (maxSpeed || stationSymbol) {
        const speedGate: ConditionNode = maxSpeed ? (line.startsWith('∞') ? { type: 'harnessed' } : { type: 'max_speed' }) : { type: 'counters', of: { ref: 'self' }, counter: 'charge', min: Number(stationSymbol![1]) };
        // CR 721.2a: the lines after a striation's first are in its box too (Hearthhull, the Worldseed: "8+ | Flying,
        // vigilance" then "Whenever you sacrifice a land, …").
        if (stationSymbol) gate = speedGate;
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
        if (!kws.every(keywordSupported)) {
          result.manualKeywords.push(line);
          lineKeywords.set(line, kws);
        }
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
      // Aetheric Amplifier: "{4}, {T}: Choose one. Activate only as a sorcery." — the restriction is the ability's, read
      // after the modes.
      const limited = /^([^:]+: )Choose (one|two)\. (Activate only as a sorcery\.|Activate only once each turn\.)$/.exec(line);
      let tail = '';
      if (limited && lines[i + 1]?.startsWith('• ')) {
        line = `${limited[1]}Choose ${limited[2]} —`;
        tail = ` ${limited[3]}`;
      }
      const block = [line];
      if (
        /\bchoose (?:one|two|three|four|five|one or both|one or more|any number|up to one|up to two) —$/i.test(line) ||
        /\bchoose one that hasn['’]t been chosen(?: this turn)?(?: —|\.)$/i.test(line) ||
        /^Choose (?:one|two)\. If .+ instead\.$/.test(line) ||
        /\b[Cc]hoose (?:one|two|three|four|five)\. You may choose the same mode more than once\.$/.test(line)
      ) {
        while (i + 1 < lines.length && lines[i + 1]!.startsWith('• ')) block.push(lines[++i]!);
        if (tail) block[block.length - 1] += tail;
      }
      // CR 706.3b: a die roll and its results table are one ability.
      if (/\b[Rr]oll (?:a|two) d\d+(?: and ignore the lower roll)?\.$/.test(line)) {
        while (i + 1 < lines.length && /^\d+(?:—\d+|\+)? \| /.test(lines[i + 1]!)) block.push(lines[++i]!);
      }

      let node = this.parseBlock(block, env);
      // Elenda, Saint of Dusk: "As long as …, Elenda gets +1/+1 and has menace. Elenda gets an additional +5/+5 as long as …"
      // — two static abilities on one line, each naming what it's about (no pronoun reaching back to the other).
      if (!node && !gate && block.length === 1 && !/\b(?:Instant|Sorcery)\b/.test(ctx.typeLine) && !/:/.test(line) && !/^(?:When|Whenever|At) /.test(line) && !/"/.test(line)) {
        const parts = line.match(/[^.]+\./g)?.map((x) => x.trim()) ?? [];
        const pronoun = /\b(?:it|its|it's|they|them|their|that creature|those creatures)\b/i;
        if (parts.length > 1 && parts.join(' ') === line.trim() && parts.slice(1).every((p) => !pronoun.test(p))) {
          const each = parts.map((p) => this.parseBlock([p], env, p));
          if (each.every((n) => n?.kind === 'static')) {
            for (const n of each) result.abilities.push(n!);
            continue;
          }
        }
      }
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
    // CR 702.49d: "Commander ninjutsu [cost]" — the same, from the hand or the command zone (it isn't cast: no commander tax).
    for (const kw of result.keywords) {
      if (kw.id !== 'commander_ninjutsu' || !kw.cost || !/^(\{[^}]+\})+$/.test(kw.cost) || kw.abilities?.length) continue;
      kw.abilities = (['hand', 'command'] as const).map((zone) => ({ kind: 'activated' as const, text: `Commander ninjutsu ${kw.cost}`, zone, cost: { mana: kw.cost, other: [{ type: 'return_unblocked' }] }, effects: [{ type: 'ninjutsu' }] }));
      result.manualKeywords = result.manualKeywords.filter((l) => !/^Commander ninjutsu\b/.test(l));
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
    // CR 702.148a: "Cleave [cost]" — cast for that cost, the spell is its text without the bracketed words.
    for (const kw of result.keywords) {
      if (kw.id !== 'cleave' || !kw.cost || !/^(\{[^}]+\})+$/.test(kw.cost) || kw.abilities?.length || cleaved === undefined) continue;
      if (!result.abilities.some((a) => a.kind === 'spell') || result.unparsed.length) continue;
      const without = this.parse(cleaved, ctx);
      // Lunar Rejection: "Return target creature to its owner's hand. / Draw a card." — one spell, its lines in order.
      const parts = without.abilities.filter((a): a is SpellAbility => a.kind === 'spell');
      if (!parts.length || without.unparsed.length || parts.slice(1).some((p) => p.targets?.length || p.modes) || (parts.length > 1 && parts[0]!.modes)) continue;
      const spell: SpellAbility = parts.length === 1 ? parts[0]! : { ...parts[0]!, text: parts.map((p) => p.text).join('\n'), effects: parts.flatMap((p) => p.effects) };
      kw.abilities = [{ kind: 'static', text: `Cleave ${kw.cost}`, effect: { type: 'cast_option', id: 'cleave', kind: 'alternative', cost: { mana: kw.cost }, spell } as CastOptionNode }];
      result.manualKeywords = result.manualKeywords.filter((l) => !/^Cleave\b/.test(l));
    }
    result.manualKeywords = result.manualKeywords.filter((l) => !lineKeywords.get(l)?.every(keywordSupported));
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
      // Saw in Half: "… half that creature's toughness. Round up each time." — the rounding belongs to the exception.
      .map((l) => l.replace(/(half that creature's toughness)\. Round up each time\./, '$1, rounded up.'))
      // Elenda, Saint of Dusk: "~ gets an additional +5/+5 as long as …" — more of the same, added on.
      .map((l) => l.replace(/\b(gets?) an additional ([+-]\d+\/[+-]\d+)/g, '$1 $2'))
      .join('\n');
    const ctx = quotes.length ? { ...env, quotes } : env;
    for (const rule of this.rules) {
      const node = rule.parse(normalised, original, ctx);
      if (node && !exiledCostMissing(node)) return node;
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
  // CR 702.176a, in words the grammar reads ("this permanent's impending cost" is "its impending cost").
  impending: {
    rule: '702.176a',
    pattern: 'Impending N—[cost]',
    meaning: [
      "You may choose to pay [cost] rather than pay this spell's mana cost.",
      'If its impending cost was paid, it enters with N time counters on it.',
      "As long as its impending cost was paid and this creature has a time counter on it, this creature isn't a creature.",
      'At the beginning of your end step, if its impending cost was paid and this creature has a time counter on it, remove a time counter from this creature.',
    ],
  },
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
  // Flavor words too: "10,000 Needles —", "Brand-new Sky —", "Exterminate! —".
  const m = /^((?:\d[\d,]* )?[A-Z][A-Za-z'’\-! ]{0,40}?(?: \d+)?) — (.+)$/.exec(line);
  if (!m) return line;
  // "Choose one —" is a modal spell, not an ability word; "II —" is a Saga's chapter symbol (CR 714.2); exhaust and
  // power-up are keywords (CR 702.177a, 702.193a).
  if (/^Choose\b/.test(m[1]!) || /^[IVX]+(?:, [IVX]+)*$/.test(m[1]!) || /^(?:Exhaust|Power-up)$/.test(m[1]!)) return line;
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
  // "Rosie Cotton of South Lane" → "Rosie Cotton"; "Tor Wauki the Younger" → "Tor Wauki".
  const beforeOf = legendary && !ctx.faceName.includes(',') ? /^([A-Z][\p{L}'’-]+ [A-Z][\p{L}'’-]+) (?:of|the) [A-Z]/u.exec(ctx.faceName)?.[1] : undefined;
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

/** Food Chain: "the exiled creature's mana value" is about an exile cost — an ability without one can't read it. */
function exiledCostMissing(node: AbilityNode): boolean {
  if (!JSON.stringify(node).includes('"cost":"exiled"')) return false;
  return !(node.kind === 'activated' && node.cost.other?.some((c) => c.type === 'exile_cards' && c.from === 'battlefield'));
}
