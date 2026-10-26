import type {
  AbilityNode,
  ActivatedAbility,
  Cost,
  EffectNode,
  ModeChoice,
  Program,
  Ref,
  RuleFlag,
  SpellAbility,
  StaticAbility,
  TriggerNode,
  TriggeredAbility,
} from '@mtg/schema';
import type { GrammarRule } from '../parser.js';
import { parseManaProduction } from '../rules/mana.js';
import { attempt, Binder, type GrammarEnv } from './binder.js';
import { parseEffectText, splitSentences } from './effects.js';
import { parseFilter, parseKeywordList, parseObjectRef } from './nouns.js';
import { parseAmount, parsePT } from './words.js';

/** The grammar rules need the keyword registry; the parser passes it in the context. */
function envOf(ctx: Parameters<GrammarRule['parse']>[2]): GrammarEnv | null {
  return ctx.keywords ? (ctx as GrammarEnv) : null;
}

// ---------------------------------------------------------------------------
// Programs: effect text, possibly modal
// ---------------------------------------------------------------------------

const MODAL_HEADER = /^choose (one|two|three|one or both|one or more|any number) —$/i;

function modeCount(word: string, options: number): { min: number; max: number } {
  switch (word.toLowerCase()) {
    case 'one': return { min: 1, max: 1 };
    case 'two': return { min: 2, max: 2 };
    case 'three': return { min: 3, max: 3 };
    case 'one or both': return { min: 1, max: 2 };
    case 'one or more': return { min: 1, max: options };
    default: return { min: 0, max: options }; // "any number"
  }
}

/**
 * Effect text → program. "Choose one —\n• A.\n• B." becomes a modal program whose
 * modes keep their own targets (CR 700.2c).
 */
export function parseProgram(text: string, b: Binder): Program | null {
  const [head, ...bullets] = text.split('\n');
  const modal = MODAL_HEADER.exec(head!.trim());
  if (modal) {
    if (bullets.length < 2 || !bullets.every((l) => l.startsWith('• '))) return null;
    const options: ModeChoice['options'] = [];
    for (const bullet of bullets) {
      const mb = b.clone();
      mb.targets = [];
      const effects = parseEffectText(bullet.slice(2), mb);
      if (!effects) return null;
      options.push({ text: bullet.slice(2), ...(mb.targets.length ? { targets: mb.targets } : {}), effects });
    }
    const { min, max } = modeCount(modal[1]!, options.length);
    if (min > options.length) return null;
    return { effects: [], modes: { min, max, options } };
  }
  if (bullets.length) return null;
  const effects = parseEffectText(head!, b);
  if (!effects) return null;
  return { ...(b.targets.length ? { targets: b.targets } : {}), effects };
}

// ---------------------------------------------------------------------------
// Spells: instants and sorceries
// ---------------------------------------------------------------------------

/** CR 113.3a: a spell ability is followed as an instruction while an instant or sorcery resolves. */
export const spellRule: GrammarRule = {
  id: 'spell',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    if (!env || !/\b(?:Instant|Sorcery)\b/.test(ctx.typeLine)) return null;
    const b = new Binder(env);
    b.it = { ref: 'self' };
    const program = parseProgram(line, b);
    if (!program) return null;
    const node: SpellAbility = { kind: 'spell', text: original, ...program };
    return node;
  },
};

// ---------------------------------------------------------------------------
// Activated abilities
// ---------------------------------------------------------------------------

const MANA_RUN = /^(?:\{(?:\d+|[WUBRGCSX]|[WUBRG2]\/[WUBRGP])\})+$/;

/** "{2}, {T}, Sacrifice ~" → cost. Null for costs the engine can't pay yet. */
export function parseCost(text: string, planeswalker: boolean): Cost | null {
  const cost: Cost = {};
  let mana = '';
  const loyalty = /^([+−-]?)(\d+)$/.exec(text.trim());
  if (loyalty && planeswalker) {
    // CR 606.4: the loyalty symbol's number is the cost.
    cost.loyalty = (loyalty[1] === '+' || loyalty[1] === '' ? 1 : -1) * Number(loyalty[2]);
    return cost;
  }
  for (const item of text.split(/,\s*/)) {
    if (item === '{T}') cost.tap = true;
    else if (item === '{Q}') cost.untap = true;
    else if (MANA_RUN.test(item)) mana += item;
    else if (/^[Ss]acrifice ~$/.test(item)) (cost.other ??= []).push({ type: 'sacrifice_self' });
    else {
      const life = /^[Pp]ay (\d+) life$/.exec(item);
      if (!life) return null;
      (cost.other ??= []).push({ type: 'pay_life', amount: Number(life[1]) });
    }
  }
  if (mana) cost.mana = mana;
  return cost;
}

const ACTIVATION_LIMITS: [RegExp, (a: ActivatedAbility) => void][] = [
  [/ Activate only as a sorcery\.$/, (a) => (a.timing = 'sorcery')],
  [/ Activate only once each turn\.$/, (a) => (a.oncePerTurn = true)],
];

/** "[Cost]: [Effect]." (CR 602.1). Mana abilities are handled by the mana rule. */
export const activatedRule: GrammarRule = {
  id: 'activated',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    const colon = line.indexOf(': ');
    if (!env || colon < 0) return null;
    const cost = parseCost(line.slice(0, colon), /\bPlaneswalker\b/.test(ctx.typeLine));
    if (!cost) return null;
    let effectText = line.slice(colon + 2);
    const node: ActivatedAbility = { kind: 'activated', text: original, cost, effects: [] };
    for (let changed = true; changed; ) {
      changed = false;
      for (const [re, set] of ACTIVATION_LIMITS) {
        if (re.test(effectText)) {
          effectText = effectText.replace(re, '');
          set(node);
          changed = true;
        }
      }
    }
    // CR 605.1a: mana abilities produce mana and have no targets; loyalty abilities never are.
    if (cost.loyalty === undefined) {
      const mana = /^Add (.+?)\.(?: (.+))?$/.exec(effectText);
      const effect = mana && parseManaProduction(mana[1]!);
      if (mana && effect) {
        if (node.timing) return null;
        // "{T}: Add {R} or {W}. ~ deals 1 damage to you." — extra untargeted effects (CR 605.1a allows them).
        const b = new Binder(env);
        b.it = { ref: 'self' };
        const rest = mana[2] ? parseEffectText(mana[2], b) : [];
        if (!rest || b.targets.length) return null;
        return { ...node, effects: [effect, ...rest], mana: true };
      }
    }
    const b = new Binder(env);
    b.it = { ref: 'self' };
    const program = parseProgram(effectText, b);
    if (!program) return null;
    return { ...node, ...program };
  },
};

// ---------------------------------------------------------------------------
// Triggered abilities (CR 603.1: "[When/Whenever/At] [trigger event], [effect].")
// ---------------------------------------------------------------------------

interface ParsedTrigger {
  trigger: TriggerNode;
  /** What "it" means in the effect. */
  it: Ref | null;
  player: Ref | null;
}

const STEP_WORDS: Record<string, string> = {
  upkeep: 'upkeep',
  'draw step': 'draw',
  'precombat main phase': 'main1',
  'end step': 'end',
  combat: 'beginning_of_combat',
};

function parseTrigger(word: string, text: string, b: Binder): ParsedTrigger | null {
  const t = text.trim();
  if (word === 'At') {
    const m = /^the beginning of (?:(your|each|each opponent's|each player's|the) )?(upkeep|draw step|precombat main phase|end step|combat)( on your turn)?$/.exec(t);
    if (!m) return null;
    if (m[2] === 'combat' ? (m[3] ? m[1] !== undefined : m[1] !== 'each') : !m[1] || m[3]) return null;
    const whose = m[1] === 'your' || m[3] ? 'you' : m[1] === "each opponent's" ? 'opponent' : 'each';
    return { trigger: { type: 'phase', step: STEP_WORDS[m[2]!]!, whose }, it: { ref: 'self' }, player: null };
  }

  const self = /^~ (enters(?: the battlefield)?|dies|is put into a graveyard from the battlefield|leaves the battlefield|attacks|blocks|deals combat damage to a player)$/.exec(t);
  if (self) {
    const type = eventType(self[1]!);
    const leaves = type === 'dies' || type === 'leaves';
    return {
      trigger: { type, subject: { ref: 'self' }, ...(type === 'deals_combat_damage' ? { to: 'player' } : {}) },
      // After a zone change "it" is the new object in the graveyard or wherever it went (CR 603.10a looks back to find it).
      it: leaves ? { ref: 'trigger_object' } : { ref: 'self' },
      player: type === 'deals_combat_damage' ? { ref: 'trigger_player' } : null,
    };
  }

  const other = /^(?:a|an|another|one of your) (.+?) (enters(?: the battlefield)?(?: under your control)?|dies|is put into a graveyard from the battlefield|leaves the battlefield|attacks|blocks|deals combat damage to a player)$/.exec(t);
  if (other) {
    const pf = parseFilter(other[1]!, b);
    if (!pf || pf.plural) return null;
    if (/^another /.test(t)) pf.filter.other = true;
    if (/under your control$/.test(other[2]!)) {
      if (pf.filter.controller) return null;
      pf.filter.controller = 'you';
    }
    const type = eventType(other[2]!.replace(/ under your control$/, ''));
    return {
      trigger: { type, subject: { ref: 'all', filter: pf.filter }, ...(type === 'deals_combat_damage' ? { to: 'player' } : {}) },
      it: { ref: 'trigger_object' },
      player: type === 'deals_combat_damage' ? { ref: 'trigger_player' } : null,
    };
  }

  const life = /^(you) gain life$/.exec(t);
  if (life) return { trigger: { type: 'gain_life', who: 'you' }, it: { ref: 'self' }, player: { ref: 'you' } };
  const draw = /^(you) draw a card$/.exec(t);
  if (draw) return { trigger: { type: 'draw', who: 'you' }, it: { ref: 'self' }, player: { ref: 'you' } };

  const cast = /^(you|an opponent|a player) casts? (?:a|an) (.+)$/.exec(t);
  if (cast) {
    const spell = cast[2] === 'spell' ? { filter: {}, plural: false } : parseFilter(cast[2]!, b);
    if (!spell || spell.plural || (cast[2] !== 'spell' && spell.filter.zone !== 'stack')) return null;
    delete spell.filter.zone;
    const who = cast[1] === 'you' ? 'you' : cast[1] === 'an opponent' ? 'opponent' : 'any';
    // "that player" is whoever cast the spell.
    return { trigger: { type: 'cast', who, filter: spell.filter }, it: { ref: 'trigger_object' }, player: { ref: 'trigger_player' } };
  }
  return null;
}

function eventType(verb: string): string {
  if (verb.startsWith('enters')) return 'enters';
  if (verb === 'dies' || verb === 'is put into a graveyard from the battlefield') return 'dies';
  if (verb === 'leaves the battlefield') return 'leaves';
  if (verb === 'attacks') return 'attacks';
  if (verb === 'blocks') return 'blocks';
  return 'deals_combat_damage';
}

export const triggeredRule: GrammarRule = {
  id: 'triggered',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    const m = /^(When|Whenever|At) (.+)$/s.exec(line);
    if (!env || !m) return null;
    const body = m[2]!;
    // Try each ", " as the boundary between the trigger condition and the effect.
    for (const comma of body.matchAll(/, /g)) {
      const r = attempt(new Binder(env), (b) => {
        const trig = parseTrigger(m[1]!, body.slice(0, comma.index), b);
        if (!trig) return null;
        b.it = trig.it;
        b.player = trig.player;
        let effectText = body.slice(comma.index! + 2);
        if (/^(?:if|unless) /i.test(effectText)) return null; // CR 603.4 intervening "if" — not yet
        let oncePerTurn = false;
        if (/ This ability triggers only once each turn\.$/.test(effectText)) {
          effectText = effectText.replace(/ This ability triggers only once each turn\.$/, '');
          oncePerTurn = true;
        }
        effectText = effectText.replace(/^\w/, (c) => c.toUpperCase());
        const program = parseProgram(effectText, b);
        return program ? { trig, program, oncePerTurn } : null;
      });
      if (r) {
        const node: TriggeredAbility = { kind: 'triggered', text: original, trigger: r.trig.trigger, ...r.program };
        if (r.oncePerTurn) node.oncePerTurn = true;
        return node;
      }
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// Static abilities
// ---------------------------------------------------------------------------

const STATIC_FLAGS: Record<string, RuleFlag[]> = {
  "can't block": ['cant_block'],
  "can't attack": ['cant_attack'],
  "can't attack or block": ['cant_attack', 'cant_block'],
  "can't be blocked": ['cant_be_blocked'],
  'attacks each combat if able': ['attacks_each_combat'],
  'attack each combat if able': ['attacks_each_combat'],
  "can't be countered": ['cant_be_countered'],
  "doesn't untap during your untap step": ['doesnt_untap'],
  "doesn't untap during its controller's untap step": ['doesnt_untap'],
};

/** "Creatures you control get +1/+1.", "Equipped creature has flying.", "~ can't block." (CR 611.3) */
export const continuousRule: GrammarRule = {
  id: 'continuous',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    if (!env || !line.endsWith('.') || /["“”]/.test(line)) return null;
    const body = line.slice(0, -1);
    const b = new Binder(env);
    // Subject, then a predicate.
    const m = /^(.+?) (gets? .+|ha(?:s|ve) .+|can't .+|attacks? each combat if able|doesn't untap during .+)$/.exec(body);
    if (!m) return null;
    const subject = parseObjectRef(m[1]!, b, 'static');
    if (!subject) return null;
    const effect: EffectNode = { type: 'continuous', affected: subject.ref };
    const flags = STATIC_FLAGS[m[2]!];
    if (flags) {
      // A spell's "can't be countered" works on the stack; other flags are about permanents.
      if (flags.includes('cant_be_countered') && subject.ref.ref !== 'self') return null;
      effect.rules = flags;
    } else {
      for (const part of m[2]!.split(/ and (?=ha(?:s|ve) |gets? )/)) {
        const get = /^gets? (\S+)$/.exec(part);
        const has = /^ha(?:s|ve) (.+)$/.exec(part);
        if (get && effect.power === undefined) {
          const pt = parsePT(get[1]!);
          if (!pt) return null;
          effect.power = pt.power;
          effect.toughness = pt.toughness;
        } else if (has && !effect.keywords) {
          const kws = parseKeywordList(has[1]!, b);
          if (!kws) return null;
          effect.keywords = kws;
        } else return null;
      }
    }
    const node: StaticAbility = { kind: 'static', text: original, effect };
    return node;
  },
};

/** "~ enters with two +1/+1 counters on it." — CR 614.1c: a replacement effect on how it enters. */
export const entersWithCountersRule: GrammarRule = {
  id: 'enters_with_counters',
  parse(line, original) {
    const m = /^~ enters(?: the battlefield)? with (\S+) (\S+) counters? on it\.$/.exec(line);
    const amount = m && parseAmount(m[1]!);
    // X is the value paid as it was cast (CR 107.3m).
    if (!m || amount === null || amount === undefined) return null;
    const node: StaticAbility = {
      kind: 'static',
      text: original,
      effect: { type: 'enters_with_counters', counter: m[2]!.replace(/−/g, '-'), amount },
    };
    return node;
  },
};

export const GRAMMAR_RULES: GrammarRule[] = [entersWithCountersRule, continuousRule, triggeredRule, activatedRule, spellRule];

export { splitSentences };
export type { AbilityNode };
