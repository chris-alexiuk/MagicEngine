import type {
  AbilityNode,
  ActivatedAbility,
  Amount,
  ConditionNode,
  AsEntersNode,
  Color,
  ContinuousEffectNode,
  Cost,
  CostModifierNode,
  QuantityReplacementNode,
  ExileInsteadNode,
  ObjectFilter,
  PlayerRule,
  PlayerRuleNode,
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
import { bindX, parseCount, parseForEach, scaleBy } from './amounts.js';
import { parseCombatRule } from './combat.js';
import { conditionSubject, parseCondition } from './conditions.js';
import { parseCopyCandidates, parseCopyExcept } from './copies.js';
import { parseEffectText, splitSentences } from './effects.js';
import { parseFilter, parseKeywordList, parseObjectRef } from './nouns.js';
import { COLOR_WORDS, parseAmount, parsePT } from './words.js';

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
  // "Choose one. If you control a commander as you cast this spell, you may choose both instead."
  const bonus = /^Choose (one|two)\. If (.+?) as you cast ~, you may choose (both|any number|three) instead\.$/.exec(head!.trim());
  if (bonus) {
    const cond = parseCondition(bonus[2]!, b);
    const inner = cond && parseProgram([`Choose ${bonus[1]} —`, ...bullets].join('\n'), b);
    if (!cond || !inner?.modes) return null;
    const max = bonus[3] === 'both' ? 2 : bonus[3] === 'three' ? 3 : inner.modes.options.length;
    return { ...inner, modes: { ...inner.modes, bonus: { condition: cond, max } } };
  }
  const modal = MODAL_HEADER.exec(head!.trim());
  if (modal) {
    if (bullets.length < 2 || !bullets.every((l) => l.startsWith('• '))) return null;
    const options: ModeChoice['options'] = [];
    for (const bullet of bullets) {
      const mb = b.clone();
      mb.targets = [];
      const effects = parseEffectText(bullet.slice(2), mb);
      // A mode the grammar can't read stays manual; the others still run (CR 700.2).
      if (!effects) options.push({ text: bullet.slice(2), effects: [], manual: true });
      else options.push({ text: bullet.slice(2), ...(mb.targets.length ? { targets: mb.targets } : {}), effects });
    }
    if (options.every((o) => o.manual)) return null;
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

/** "Sacrifice a creature", "Sacrifice another artifact", "Discard a card" — costs where the player picks what. */
export function choiceCost(item: string, b: Binder | null): EffectNode | null {
  const sac = /^[Ss]acrifice (a|an|one|two|three|another) (.+)$/.exec(item);
  if (sac && b) {
    const pf = parseFilter(sac[2]!, b);
    const amount = sac[1] === 'another' ? 1 : parseAmount(sac[1]!);
    if (!pf || typeof amount !== 'number' || pf.plural !== amount > 1) return null;
    if (sac[1] === 'another') pf.filter.other = true;
    return { type: 'sacrifice', filter: pf.filter, amount };
  }
  const discard = /^[Dd]iscard (a|one|two|three) cards?$/.exec(item);
  if (discard) return { type: 'discard', amount: parseAmount(discard[1]!) };
  return null;
}

/** "{2}, {T}, Sacrifice ~" → cost. Null for costs the engine can't pay yet. */
export function parseCost(text: string, planeswalker: boolean, b: Binder | null = null): Cost | null {
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
    else if (/^[Dd]iscard ~$/.test(item)) (cost.other ??= []).push({ type: 'discard_self' });
    else if (/^[Ee]xile ~ from your graveyard$/.test(item)) (cost.other ??= []).push({ type: 'exile_self' });
    // CR 702.122a (crew): "Tap any number of other untapped creatures you control with total power N or greater".
    else if (/^[Tt]ap any number of (?:other )?untapped creatures you control with total power (\d+) or greater$/.test(item)) {
      (cost.other ??= []).push({ type: 'crew', power: Number(/power (\d+)/.exec(item)![1]) });
    }
    // CR 107.14: "Pay {E}{E}" removes energy counters from you.
    else if (/^[Pp]ay (?:\{E\})+$/.test(item)) (cost.other ??= []).push({ type: 'pay_energy', amount: (item.length - 4) / 3 });
    else if (choiceCost(item, b)) (cost.other ??= []).push(choiceCost(item, b)!);
    else {
      const life = /^[Pp]ay (\d+) life$/.exec(item);
      if (!life) return null;
      (cost.other ??= []).push({ type: 'pay_life', amount: Number(life[1]) });
    }
  }
  if (mana) cost.mana = mana;
  return cost;
}

/** Effects that never stop for a player's choice (for the extra effects of mana abilities). */
const NO_CHOICE = new Set(['gain_life', 'lose_life', 'deal_damage', 'draw', 'mill', 'add_counters', 'tap', 'untap', 'create_token', 'add_mana', 'skip_untap']);
const noChoices = (e: EffectNode): boolean =>
  e.type === 'if' ? [...((e.effects as EffectNode[]) ?? []), ...((e.else as EffectNode[]) ?? [])].every(noChoices) : NO_CHOICE.has(e.type);

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
    const cost = parseCost(line.slice(0, colon), /\bPlaneswalker\b/.test(ctx.typeLine), new Binder(env));
    if (!cost) return null;
    let effectText = line.slice(colon + 2);
    const node: ActivatedAbility = { kind: 'activated', text: original, cost, effects: [] };
    // A cost of discarding this card means it's activated from the hand (channel, cycling);
    // exiling it from your graveyard, from the graveyard (CR 113.6m).
    if (cost.other?.some((c) => c.type === 'discard_self')) node.zone = 'hand';
    if (cost.other?.some((c) => c.type === 'exile_self')) node.zone = 'graveyard';
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
        // A mana ability resolves at once (CR 605.3b), so its other effects can't stop to ask anything.
        if (!rest || b.targets.length || !rest.every(noChoices)) return null;
        return { ...node, effects: [effect, ...rest], mana: true };
      }
    }
    const b = new Binder(env);
    b.it = { ref: 'self' };
    const program = parseProgram(effectText, b);
    if (!program) return null;
    if (b.selfZone) {
      // "{2}{B}: Return ~ from your graveyard to your hand."
      if (node.zone && node.zone !== b.selfZone) return null;
      node.zone = b.selfZone;
    }
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
    // Curses: "At the beginning of enchanted player's upkeep" — "that player" is the enchanted player.
    const cursed = /^the beginning of enchanted player's (upkeep|draw step|end step)$/.exec(t);
    if (cursed) return { trigger: { type: 'phase', step: STEP_WORDS[cursed[1]!]!, whose: 'enchanted' }, it: { ref: 'self' }, player: { ref: 'enchanted_player' } };
    const m = /^the beginning of (?:(your|each|each opponent's|each player's|the) )?(upkeep|draw step|precombat main phase|end step|combat)( on your turn)?$/.exec(t);
    if (!m) return null;
    if (m[2] === 'combat' ? (m[3] ? m[1] !== undefined : m[1] !== 'each') : !m[1] || m[3]) return null;
    const whose = m[1] === 'your' || m[3] ? 'you' : m[1] === "each opponent's" ? 'opponent' : 'each';
    return { trigger: { type: 'phase', step: STEP_WORDS[m[2]!]!, whose }, it: { ref: 'self' }, player: null };
  }

  // CR 716.2a: "When this Class becomes level 2"
  const level = /^~ becomes level (\d+)$/.exec(t);
  if (level) return { trigger: { type: 'becomes_level', level: Number(level[1]) }, it: { ref: 'self' }, player: null };
  // CR 702.21a (ward): "becomes the target of a spell or ability an opponent controls".
  const targeted = /^~ becomes the target of a spell or ability(?: an opponent controls)?$/.exec(t);
  if (targeted) {
    return {
      trigger: { type: 'becomes_target', subject: { ref: 'self' }, ...(/opponent/.test(t) ? { by: 'opponent' } : {}) },
      it: { ref: 'trigger_object' },
      player: { ref: 'trigger_player' },
    };
  }
  // CR 509.3c: "blocks or becomes blocked", "becomes blocked", "becomes blocked by a creature without flanking".
  const blocked = /^~ (blocks or becomes blocked|becomes blocked)(?: by (?:a|an) (.+))?$/.exec(t);
  if (blocked) {
    const by = blocked[2] ? parseFilter(blocked[2], b) : null;
    if (blocked[2] && (!by || by.plural)) return null;
    if (by) b.named['the blocking creature'] = { ref: 'trigger_object' };
    const trigger: TriggerNode =
      blocked[1] === 'becomes blocked'
        ? { type: 'becomes_blocked', subject: { ref: 'self' }, ...(by ? { by: by.filter } : {}) }
        : { type: 'blocks', subject: { ref: 'self' }, orBlocked: true };
    return { trigger, it: { ref: 'self' }, player: null };
  }

  // "Whenever ~ deals damage", "deals combat damage", "is dealt damage" — with an amount ("that much").
  const damage = /^(~|enchanted creature|equipped creature) (deals damage|deals combat damage|is dealt damage)$/.exec(t);
  if (damage) {
    const subject: Ref = damage[1] === '~' ? { ref: 'self' } : { ref: 'attached' };
    const trigger: TriggerNode =
      damage[2] === 'is dealt damage' ? { type: 'dealt_damage', subject } : { type: 'deals_damage', subject, ...(damage[2] === 'deals combat damage' ? { combat: true } : {}) };
    b.eventAmount = true;
    return { trigger, it: subject, player: null };
  }
  const attachedHits = /^(enchanted|equipped) creature deals combat damage to a player$/.exec(t);
  if (attachedHits) {
    b.eventAmount = true;
    return { trigger: { type: 'deals_combat_damage', subject: { ref: 'attached' }, to: 'player' }, it: { ref: 'attached' }, player: { ref: 'trigger_player' } };
  }
  // "Whenever enchanted player is attacked" / "a player attacks enchanted player with one or more creatures"
  // ("that player" is the enchanted player; "that attacking player" the one attacking).
  if (t === 'enchanted player is attacked') {
    return { trigger: { type: 'player_attacked', who: 'enchanted' }, it: { ref: 'self' }, player: { ref: 'enchanted_player' } };
  }
  if (/^a player attacks enchanted player with one or more creatures$|^you attack enchanted player with one or more creatures$/.test(t)) {
    b.named['that attacking player'] = { ref: 'trigger_player' };
    return {
      trigger: { type: 'player_attacked', who: 'enchanted', ...(t.startsWith('you ') ? { by: 'you' } : {}) },
      it: { ref: 'self' },
      player: { ref: 'trigger_player' },
    };
  }
  const attacksCursed = /^(?:a|an) (.+?) attacks enchanted player$/.exec(t);
  if (attacksCursed) {
    const pf = parseFilter(attacksCursed[1]!, b);
    if (!pf || pf.plural) return null;
    return { trigger: { type: 'attacks', subject: { ref: 'all', filter: pf.filter }, defender: 'enchanted' }, it: { ref: 'trigger_object' }, player: { ref: 'enchanted_player' } };
  }
  const hitsCursed = /^(?:a|an) (.+?) deals combat damage to enchanted player$/.exec(t);
  if (hitsCursed) {
    const pf = parseFilter(hitsCursed[1]!, b);
    if (!pf || pf.plural) return null;
    b.eventAmount = true;
    return { trigger: { type: 'deals_combat_damage', subject: { ref: 'all', filter: pf.filter }, to: 'enchanted' }, it: { ref: 'trigger_object' }, player: { ref: 'trigger_player' } };
  }
  if (/^you're dealt damage$|^you are dealt damage$|^enchanted player is dealt damage$/.test(t)) {
    b.eventAmount = true;
    const cursed = t.startsWith('enchanted');
    return { trigger: { type: 'player_dealt_damage', who: cursed ? 'enchanted' : 'you' }, it: { ref: 'self' }, player: cursed ? { ref: 'enchanted_player' } : { ref: 'you' } };
  }
  const loses = /^(an opponent|you) loses? life$/.exec(t);
  if (loses) {
    b.eventAmount = true;
    return { trigger: { type: 'lose_life', who: loses[1] === 'you' ? 'you' : 'opponent' }, it: { ref: 'self' }, player: { ref: 'trigger_player' } };
  }

  const self = /^~ (enters(?: the battlefield)?|dies|is put into a graveyard from the battlefield|leaves the battlefield|attacks|blocks|deals combat damage to a player)$/.exec(t);
  if (self) {
    const type = eventType(self[1]!);
    if (type === 'deals_combat_damage') b.eventAmount = true;
    const leaves = type === 'dies' || type === 'leaves';
    // CR 506.2: for an attacking creature, "defending player" is the player it's attacking.
    if (type === 'attacks') b.named['defending player'] = { ref: 'trigger_player' };
    return {
      trigger: { type, subject: { ref: 'self' }, ...(type === 'deals_combat_damage' ? { to: 'player' } : {}) },
      // After a zone change "it" is the new object in the graveyard or wherever it went (CR 603.10a looks back to find it).
      it: leaves ? { ref: 'trigger_object' } : { ref: 'self' },
      player: type === 'deals_combat_damage' ? { ref: 'trigger_player' } : null,
    };
  }

  const other = /^(?:a|an|another|one of your) (.+?) (enters(?: the battlefield)?(?: under your control)?|dies|is put into a graveyard from the battlefield|leaves the battlefield|attacks alone|attacks|blocks|deals combat damage to a player)$/.exec(t);
  if (other) {
    const pf = parseFilter(other[1]!, b);
    if (!pf || pf.plural) return null;
    if (/^another /.test(t)) pf.filter.other = true;
    if (/under your control$/.test(other[2]!)) {
      if (pf.filter.controller) return null;
      pf.filter.controller = 'you';
    }
    const type = eventType(other[2]!.replace(/ under your control$/, '').replace(/ alone$/, ''));
    return {
      trigger: {
        type,
        subject: { ref: 'all', filter: pf.filter },
        ...(type === 'deals_combat_damage' ? { to: 'player' } : {}),
        // CR 702.83b: it's the only creature declared as an attacker.
        ...(/ alone$/.test(other[2]!) ? { alone: true } : {}),
      },
      it: { ref: 'trigger_object' },
      // "Whenever a creature enchanted player controls enters, that player …"
      player: type === 'deals_combat_damage' ? { ref: 'trigger_player' } : pf.filter.controller === 'enchanted' ? { ref: 'enchanted_player' } : null,
    };
  }

  const life = /^(you) gain life$/.exec(t);
  if (life) {
    b.eventAmount = true;
    return { trigger: { type: 'gain_life', who: 'you' }, it: { ref: 'self' }, player: { ref: 'you' } };
  }
  const draw = /^(you draw|enchanted player draws) a card$/.exec(t);
  if (draw) {
    const cursed = draw[1] !== 'you draw';
    return { trigger: { type: 'draw', who: cursed ? 'enchanted' : 'you' }, it: { ref: 'self' }, player: cursed ? { ref: 'enchanted_player' } : { ref: 'you' } };
  }

  const cast = /^(you|an opponent|a player|enchanted player) casts? (?:a|an) (.+)$/.exec(t);
  if (cast) {
    const spell = cast[2] === 'spell' ? { filter: {}, plural: false } : parseFilter(cast[2]!, b);
    if (!spell || spell.plural || (cast[2] !== 'spell' && spell.filter.zone !== 'stack')) return null;
    delete spell.filter.zone;
    const who = cast[1] === 'you' ? 'you' : cast[1] === 'an opponent' ? 'opponent' : cast[1] === 'enchanted player' ? 'enchanted' : 'any';
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
        // CR 113.6m: "When ~ dies, return ~ from your graveyard…" — the trigger put it there; it's the card that died.
        const selfLeaves = (trig.trigger.type === 'dies' || trig.trigger.type === 'leaves') && (trig.trigger.subject as Ref).ref === 'self';
        if (selfLeaves) {
          b.named['~ from your graveyard'] = { ref: 'trigger_object' };
          b.itIsSource = true;
        }
        let effectText = body.slice(comma.index! + 2);
        // CR 603.4: "When …, if [condition], [effect]."
        let condition: ConditionNode | null = null;
        const iff = /^if ([^,]+), (.+)$/s.exec(effectText);
        if (iff) {
          condition = parseCondition(iff[1]!, b);
          if (!condition) return null;
          effectText = iff[2]!;
        }
        if (/^unless /i.test(effectText)) return null;
        let oncePerTurn = false;
        if (/ This ability triggers only once each turn\.$/.test(effectText)) {
          effectText = effectText.replace(/ This ability triggers only once each turn\.$/, '');
          oncePerTurn = true;
        }
        effectText = effectText.replace(/^\w/, (c) => c.toUpperCase());
        const program = parseProgram(effectText, b);
        return program ? { trig, program, oncePerTurn, condition, zone: b.selfZone } : null;
      });
      if (r) {
        const node: TriggeredAbility = { kind: 'triggered', text: original, trigger: r.trig.trigger, ...r.program };
        if (r.oncePerTurn) node.oncePerTurn = true;
        if (r.zone) node.zone = r.zone;
        if (r.condition) node.condition = r.condition;
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
  "can attack as though it didn't have defender": ['can_attack_with_defender'],
  "can attack as though they didn't have defender": ['can_attack_with_defender'],
};

/** "Creatures you control get +1/+1.", "Equipped creature has flying.", "~ can't block." (CR 611.3) */
export const continuousRule: GrammarRule = {
  id: 'continuous',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    if (!env || !line.endsWith('.') || /["“”]/.test(line)) return null;
    const b = new Binder(env);
    // Conditions in front: "During your turn, …", "As long as [condition], …" (CR 611.3a: checked continuously).
    const conds: ConditionNode[] = [];
    let rest = line.slice(0, -1);
    for (;;) {
      const during = /^During (your turn|turns other than yours), (.+)$/i.exec(rest);
      if (during) {
        conds.push({ type: 'your_turn', value: during[1]!.toLowerCase() === 'your turn' });
        rest = during[2]!;
        continue;
      }
      // "~ gets +2/+2 as long as there are seven or more cards in your graveyard." (the condition last)
      const trailing = /^(.+?) as long as (.+)$/.exec(rest);
      if (trailing && !/^As long as /i.test(rest)) {
        const cond = attempt(b, (b) => parseCondition(trailing[2]!, b));
        if (!cond) return null;
        conds.push(cond);
        rest = trailing[1]!;
        break;
      }
      const asLong = /^As long as (.+)$/i.exec(rest);
      if (!asLong) break;
      const tail = asLong[1]!;
      let found = false;
      for (let i = tail.indexOf(', '); i >= 0 && !found; i = tail.indexOf(', ', i + 1)) {
        const cond = attempt(b, (b) => parseCondition(tail.slice(0, i), b));
        if (cond) {
          conds.push(cond);
          b.it = conditionSubject(cond) ?? b.it;
          rest = tail.slice(i + 2);
          found = true;
        }
      }
      if (!found) return null;
    }
    const effect: ContinuousEffectNode | PlayerRuleNode | null = parseContinuous(rest, b) ?? parsePlayerRule(rest);
    if (!effect) return null;
    if (conds.length) effect.condition = conds.length === 1 ? conds[0]! : { type: 'and', all: conds };
    const node: StaticAbility = { kind: 'static', text: original, effect };
    return node;
  },
};

/** Rules changes for players: hand size (CR 402.2), extra land plays (CR 305.2), skipping a step (CR 614.10). */
function parsePlayerRule(body: string): PlayerRuleNode | null {
  const who = (w: string): PlayerRuleNode['who'] | null =>
    w === 'You' || w === 'you' ? 'you' : /^(?:each player|players)$/i.test(w) ? 'each' : /^(?:each opponent|your opponents)$/i.test(w) ? 'opponents' : null;
  const subject = /^(You|Players|Each player|Each opponent|Your opponents) (.+)$/.exec(body);
  const simple: Record<string, PlayerRule> = {
    'have hexproof': 'hexproof',
    'has hexproof': 'hexproof',
    'have shroud': 'shroud',
    'has shroud': 'shroud',
    "can't gain life": 'cant_gain_life',
    "don't lose the game for having 0 or less life": 'no_lose_for_life',
    "can't lose the game": 'cant_lose',
    'may cast spells as though they had flash': 'flash',
  };
  if (subject && simple[subject[2]!] && who(subject[1]!)) return { type: 'player_rule', who: who(subject[1]!)!, rule: simple[subject[2]!]! };
  const hand = /^(You|Players|Each player|Each opponent|Your opponents) ha(?:s|ve) no maximum hand size$/.exec(body);
  if (hand) return { type: 'player_rule', who: who(hand[1]!)!, rule: 'no_max_hand_size' };
  const land = /^(You|Each player) may play (an|two|three) additional lands? on each of (?:your|their) turns$/.exec(body);
  if (land) return { type: 'player_rule', who: who(land[1]!)!, rule: 'extra_lands', amount: land[2] === 'an' ? 1 : (parseAmount(land[2]!) as number) };
  if (/^Skip your draw step$/.test(body)) return { type: 'player_rule', who: 'you', rule: 'skip_draw' };
  // CR 401.5: looking at, or playing with, the top card of your library revealed.
  if (/^You may look at the top card of your library (?:any time|at any time)$/.test(body)) return { type: 'player_rule', who: 'you', rule: 'look_at_top' };
  if (/^Play with the top card of your library revealed$/.test(body)) return { type: 'player_rule', who: 'you', rule: 'top_revealed' };
  return null;
}

/** The effect part of a static ability: "Creatures you control get +1/+1", "it has first strike". */
function parseContinuous(body: string, b: Binder): ContinuousEffectNode | null {
  // "Creatures you control get +X/+X, where X is …" (CR 107.3a)
  const where = /^(.+), where X is (.+)$/.exec(body);
  if (where) {
    const expr = parseCount(where[2]!, b);
    const inner = expr && parseContinuous(where[1]!, b);
    return inner && expr ? (bindX([inner], expr)[0] as ContinuousEffectNode) : null;
  }
  // Layer 2 (CR 613.1b): "You control enchanted creature." (Control Magic).
  const control = /^You control (enchanted (?:creature|permanent|artifact|land|planeswalker))$/.exec(body);
  if (control) return { type: 'continuous', affected: { ref: 'attached' }, control: 'you' };
  // Layer 7a (CR 604.3): "~'s power and toughness are each equal to the number of creatures you control."
  const cda = /^~'s (power and toughness are each|power is|toughness is) equal to (.+?)(?: and its toughness is equal to (.+))?$/.exec(body);
  if (cda) {
    const first = parseCount(cda[2]!, b);
    if (!first) return null;
    const effect: ContinuousEffectNode = { type: 'continuous', affected: { ref: 'self' }, setLayer: '7a' };
    if (cda[1] !== 'toughness is') effect.setPower = first;
    if (cda[1] !== 'power is') effect.setToughness = first;
    if (cda[3]) {
      if (cda[1] !== 'power is') return null;
      const second = parseCount(cda[3], b);
      if (!second) return null;
      effect.setToughness = second;
    }
    return effect;
  }
  // Layer 7b: "Enchanted creature has base power and toughness 1/1."
  const base = /^(.+?) ha(?:s|ve) base power and toughness (\d+)\/(\d+)$/.exec(body);
  if (base) {
    const subject = parseObjectRef(base[1]!, b, 'static');
    return subject ? { type: 'continuous', affected: subject.ref, setPower: Number(base[2]), setToughness: Number(base[3]), setLayer: '7b' } : null;
  }
  // CR 509.1c: "All creatures able to block ~ do so." (lure)
  const lure = /^All creatures able to block (.+) do so$/.exec(body);
  if (lure) {
    const subject = parseObjectRef(lure[1]!, b, 'static');
    return subject && !subject.plural ? { type: 'continuous', affected: subject.ref, combat: { mustBeBlocked: 'all' } } : null;
  }
  // Subject, then a predicate.
  const m = /^(.+?) (gets? .+|ha(?:s|ve) .+|can't .+|can block only .+|must be blocked if able|can attack as though (?:it|they) didn't have defender|attacks? each combat if able|doesn't untap during .+)$/.exec(body);
  if (!m) return null;
  const subject = parseObjectRef(m[1]!, b, 'static');
  if (!subject) return null;
  const effect: ContinuousEffectNode = { type: 'continuous', affected: subject.ref };
  // "gets +2/+0 and has menace", "has hexproof and can't be blocked", "gets -1/-1 and can't block".
  for (const part of m[2]!.split(/ and (?=ha(?:s|ve) |gets? |can't |can attack |can block |must be |attacks? each |doesn't )/)) {
    const get = /^gets? (\S+(?: for each .+)?)$/.exec(part);
    const has = /^ha(?:s|ve) (.+)$/.exec(part);
    const flags = STATIC_FLAGS[part];
    const combat = flags ? null : parseCombatRule(part, b);
    if (combat) {
      effect.combat = { ...effect.combat, ...combat };
    } else if (flags) {
      // A spell's "can't be countered" works on the stack; other flags are about permanents.
      if (flags.includes('cant_be_countered') && subject.ref.ref !== 'self') return null;
      effect.rules = [...(effect.rules ?? []), ...flags];
    } else if (get && effect.power === undefined) {
      // "gets +1/+1 for each other Zombie you control" (counted continuously, CR 611.3a)
      const each = /^(\S+) for each (.+)$/.exec(get[1]!);
      const pt = parsePT(each ? each[1]! : get[1]!);
      if (!pt) return null;
      effect.power = pt.power;
      effect.toughness = pt.toughness;
      if (each) {
        const expr = parseForEach(each[2]!, b);
        // "Other Elves get +1/+1 for each other Elf": "other" would mean other than each affected one — not modelled.
        if (expr?.kind === 'count' && expr.filter.other && subject.ref.ref !== 'self') return null;
        const scaled = expr && scaleBy([{ type: 'x', power: pt.power, toughness: pt.toughness }], expr);
        if (!scaled) return null;
        effect.power = scaled[0]!.power as Amount;
        effect.toughness = scaled[0]!.toughness as Amount;
      }
    } else if (has && !effect.keywords) {
      const kws = parseKeywordList(has[1]!, b);
      if (!kws) return null;
      effect.keywords = kws;
    } else return null;
  }
  return effect;
}

/**
 * Deck-construction rules (CR 113.6n): "~ can be your commander." (CR 903.3a), "A deck can have any
 * number of cards named ~." They work before the game begins, so in a game there's nothing to do.
 */
export const deckRule: GrammarRule = {
  id: 'deck_rule',
  parse(line, original) {
    const m =
      /^~ can be your commander\.$/.exec(line) ??
      /^A deck can have (?:any number of|up to \w+) cards named ~\.$/.exec(line);
    if (!m) return null;
    const node: StaticAbility = { kind: 'static', text: original, effect: { type: 'deck_rule' } };
    return node;
  },
};

/**
 * CR 601.2f: "Creature spells you cast cost {1} less to cast.", "Spells your opponents cast cost {1} more
 * to cast.", "This spell costs {2} less to cast if you control a Wizard.", "… for each artifact you control."
 */
export const costModifierRule: GrammarRule = {
  id: 'cost_modifier',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    if (!env || !line.endsWith('.')) return null;
    const b = new Binder(env);
    const body = line.slice(0, -1);
    const amountOf = (sym: string): { amount: Amount; color?: Color } | null => {
      const m = /^\{(\d+|X|[WUBRG])\}$/.exec(sym);
      if (!m) return null;
      if (/^\d+$/.test(m[1]!)) return { amount: Number(m[1]) };
      if (m[1] === 'X') return { amount: 'X' };
      return { amount: 1, color: m[1] as Color };
    };
    const own = /^(?:~|This spell) costs (\{[^}]+\}) (less|more) to cast(?: for each (.+?)| if (.+?)|, where X is (.+?))?$/.exec(body);
    if (own) {
      const a = amountOf(own[1]!);
      if (!a) return null;
      const node: CostModifierNode = { type: 'cost_modifier', self: true, change: own[2] as 'less' | 'more', ...a };
      if (own[3]) {
        const each = parseForEach(own[3], b);
        if (!each || a.amount === 'X') return null;
        node.amount = { ...each, times: (each.times ?? 1) * (a.amount as number) };
      } else if (own[4]) {
        const cond = parseCondition(own[4], b);
        if (!cond) return null;
        node.condition = cond;
      } else if (own[5]) {
        const x = parseCount(own[5], b);
        if (!x || a.amount !== 'X') return null;
        node.amount = x;
      } else if (a.amount === 'X') return null;
      const ability: StaticAbility = { kind: 'static', text: original, effect: node };
      return ability;
    }
    const others = /^(.*?)\b(?:spells?) (?:(you|your opponents|each opponent) casts? )?costs? (\{[^}]+\}) (less|more) to cast$/i.exec(body);
    if (others) {
      const a = amountOf(others[3]!);
      if (!a || a.amount === 'X') return null;
      const adjectives = others[1]!.trim().replace(/ and /g, ' or ');
      let filter: ObjectFilter = {};
      if (adjectives && !/^Spells?$/i.test(adjectives)) {
        const pf = parseFilter(`${adjectives.replace(/^\w/, (c) => c.toLowerCase())} spells`, b);
        if (!pf) return null;
        const { zone: _z, ...rest } = pf.filter;
        filter = rest;
      }
      const who = !others[2] ? 'each' : others[2] === 'you' ? 'you' : 'opponents';
      const node: CostModifierNode = { type: 'cost_modifier', who, filter, change: others[4]!.toLowerCase() as 'less' | 'more', ...a };
      const ability: StaticAbility = { kind: 'static', text: original, effect: node };
      return ability;
    }
    return null;
  },
};

/** "twice that many", "that many plus one", "double that damage", "triple that damage". */
function quantityOp(text: string): { op: 'double' | 'triple' | 'plus'; n?: number } | null {
  if (/^(?:twice that (?:many|much)|double that)/.test(text)) return { op: 'double' };
  if (/^triple that/.test(text)) return { op: 'triple' };
  const plus = /^that (?:many|much)(?: \w+)? plus (\w+)/.exec(text);
  const n = plus ? parseAmount(plus[1]!) : null;
  return typeof n === 'number' ? { op: 'plus', n } : null;
}

/**
 * CR 614.1a: replacement effects that change an amount — life gained, tokens created, counters put on
 * something, damage dealt ("If you would gain life, you gain twice that much life instead.").
 */
export const quantityReplacementRule: GrammarRule = {
  id: 'replace_quantity',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    if (!env) return null;
    const b = new Binder(env);
    const make = (node: Omit<QuantityReplacementNode, 'type'>): StaticAbility => ({ kind: 'static', text: original, effect: { type: 'replace_quantity', ...node } });
    const life = /^If you would gain life, you gain (.+?) instead\.$/.exec(line);
    if (life) {
      const op = quantityOp(life[1]!);
      return op && /\blife\b/.test(life[1]!) ? make({ event: 'gain_life', who: 'you', ...op }) : null;
    }
    const tokens =
      /^If (?:one or more|an effect would create one or more) tokens would be created under your control, (.+?) of those tokens are created instead\.$/.exec(line) ??
      /^If an effect would create one or more tokens under your control, it creates (.+?) of those tokens instead\.$/.exec(line) ??
      /^If you would create one or more tokens, create (.+?) of those tokens instead\.$/.exec(line);
    if (tokens) {
      const op = quantityOp(tokens[1]!);
      return op ? make({ event: 'tokens', who: 'you', ...op }) : null;
    }
    const counters = /^If one or more (\S+) counters would be put on (.+?), (.+?) \S+ counters are put on (?:it|that \w+) instead\.$/.exec(line);
    if (counters) {
      const op = quantityOp(counters[3]!);
      const pf = parseFilter(counters[2]!.replace(/^(?:a|an) /, ''), b);
      return op && pf && !pf.plural ? make({ event: 'counters', counter: counters[1]!, filter: pf.filter, ...op }) : null;
    }
    const put = /^If you would put one or more (?:(\S+) )?counters on (.+?), put (.+?) (?:of each of those kinds of counters|\S+ counters) on (?:that \w+(?: or \w+)?|it) instead\.$/.exec(line);
    if (put) {
      const op = quantityOp(put[3]!);
      const target = put[2]!.replace(/^(?:a|an) /, '');
      const pf = target === 'permanent or player' ? { filter: {}, plural: false } : parseFilter(target, b);
      return op && pf && !pf.plural ? make({ event: 'counters', who: 'you', ...(put[1] ? { counter: put[1] } : {}), filter: pf.filter, ...op }) : null;
    }
    const damage = /^If (a|another) (.*?)source( you control)? would deal (noncombat )?damage to (a permanent or player|an opponent or a permanent an opponent controls|any target), it deals (.+?) (?:to that (?:permanent or player|player or permanent) )?instead\.$/.exec(line);
    if (damage) {
      const op = quantityOp(damage[6]!);
      if (!op) return null;
      const filter: ObjectFilter = {};
      const adjective = damage[2]!.trim();
      if (adjective) {
        const color = COLOR_WORDS[adjective];
        if (!color) return null;
        filter.colors = [color];
      }
      if (damage[1] === 'another') filter.other = true;
      if (damage[3]) filter.controller = 'you';
      return make({
        event: 'damage',
        filter,
        ...op,
        ...(damage[4] ? { noncombat: true as const } : {}),
        ...(damage[5]!.startsWith('an opponent') ? { toOpponents: true as const } : {}),
      });
    }
    return null;
  },
};

/** CR 614.1a: "If a creature an opponent controls would die, exile it instead.", Rest in Peace. */
export const exileInsteadRule: GrammarRule = {
  id: 'exile_instead',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    if (!env) return null;
    const make = (node: Omit<ExileInsteadNode, 'type'>): StaticAbility => ({ kind: 'static', text: original, effect: { type: 'exile_instead', ...node } });
    const dies = /^If (?:a|an|another) (.+?) would die, exile it instead\.$/.exec(line);
    if (dies) {
      const pf = parseFilter(dies[1]!, new Binder(env));
      if (!pf || pf.plural) return null;
      if (/^another /.test(line.slice(3))) pf.filter.other = true;
      return make({ dies: true, filter: pf.filter });
    }
    const gy = /^If a (card|card or token|nontoken creature) would be put into (your|a|an opponent's) graveyard from anywhere, exile it instead\.$/.exec(line);
    if (gy) {
      const owner = gy[2] === 'your' ? 'you' : gy[2] === 'a' ? 'each' : 'opponents';
      return make({ owner, ...(gy[1] === 'nontoken creature' ? { filter: { types: ['Creature'], token: false } } : {}) });
    }
    return null;
  },
};

/** Static replacement effects about this object (CR 614.1a): "If ~ would be put into a graveyard from anywhere, exile it instead." */
export const selfReplacementRule: GrammarRule = {
  id: 'self_replacement',
  parse(line, original) {
    if (!/^If ~ would be put into a graveyard from anywhere, exile it instead\.$/.test(line)) return null;
    const node: StaticAbility = { kind: 'static', text: original, effect: { type: 'graveyard_to_exile' } };
    return node;
  },
};

/** "This land enters tapped unless you control a Plains or an Island." (CR 614.1d, checked as it enters, CR 614.12) */
export const entersTappedUnlessRule: GrammarRule = {
  id: 'enters_tapped_unless',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    const m = /^~ enters(?: the battlefield)? tapped unless (.+)\.$/.exec(line);
    if (!env || !m) return null;
    const unless = parseCondition(m[1]!, new Binder(env));
    if (!unless) return null;
    const node: StaticAbility = { kind: 'static', text: original, effect: { type: 'enters_tapped', unless } };
    return node;
  },
};

/**
 * "As ~ enters, you may pay 2 life. If you don't, it enters tapped." and other choices made
 * as a permanent enters (CR 614.12): reveal a card, choose a color, choose a creature type.
 */
export const asEntersRule: GrammarRule = {
  id: 'as_enters',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    const m = /^(~ enters tapped\. )?As (?:~|it) enters, (.+)\.$/.exec(line);
    if (!env || !m) return null;
    const what = m[2]!;
    const orTapped = / If you don't, (?:it|~) enters tapped$/;
    let node: AsEntersNode | null = null;
    const pay = /^you may pay (\d+) life\.( If you don't, (?:it|~) enters tapped)$/.exec(what);
    if (pay) node = { type: 'as_enters', choice: 'pay_life', amount: Number(pay[1]) };
    const reveal = /^you may reveal (?:a|an) (.+?) from your hand\.( If you don't, (?:it|~) enters tapped)$/.exec(what);
    if (reveal) {
      const pf = parseFilter(`${reveal[1]!.replace(/ or an? /g, ' or ')} in your hand`, new Binder(env));
      if (!pf || pf.plural) return null;
      node = { type: 'as_enters', choice: 'reveal', filter: pf.filter };
    }
    const color = /^choose a color(?: other than (\w+))?$/.exec(what);
    if (color) {
      node = { type: 'as_enters', choice: 'color' };
      if (color[1]) {
        const c = COLOR_WORDS[color[1]];
        if (!c) return null;
        node.except = c;
      }
    }
    if (what === 'choose a creature type') node = { type: 'as_enters', choice: 'creature_type' };
    if (!node || (orTapped.test(what) !== (node.choice === 'pay_life' || node.choice === 'reveal'))) return null;
    if (m[1]) {
      if (node.choice === 'pay_life' || node.choice === 'reveal') return null;
      node.tapped = true;
    }
    const ability: StaticAbility = { kind: 'static', text: original, effect: node };
    return ability;
  },
};

/**
 * CR 707.5 / CR 614.1c: "You may have ~ enter as a copy of any creature on the battlefield[, except …]."
 * The choice is made as it enters (CR 614.12), like the other "as ~ enters" choices.
 */
export const entersAsCopyRule: GrammarRule = {
  id: 'enters_as_copy',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    const m = /^You may have ~ enter(?: the battlefield)? as a copy of (.+?)(?:, except (.+))?\.$/.exec(line);
    if (!env || !m) return null;
    const b = new Binder(env);
    const filter = parseCopyCandidates(m[1]!, b);
    const except = m[2] ? parseCopyExcept(m[2], b) : undefined;
    if (!filter || except === null) return null;
    const node: AsEntersNode = { type: 'as_enters', choice: 'copy', filter, ...(except ? { copyExcept: except } : {}) };
    const ability: StaticAbility = { kind: 'static', text: original, effect: node };
    return ability;
  },
};

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7 };

/**
 * CR 714.2b: a Saga's chapter ability "II — [Effect]" means "When one or more lore counters are put onto
 * this Saga, if the number of lore counters on it was less than 2 and became at least 2, [effect]."
 * CR 714.2c: "I, II — [Effect]" is both.
 */
export const chapterRule: GrammarRule = {
  id: 'chapter',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    const m = /^((?:I|II|III|IV|V|VI|VII)(?:, (?:I|II|III|IV|V|VI|VII))*) — (.+)$/s.exec(line);
    if (!env || !m || !/\bSaga\b/.test(ctx.typeLine)) return null;
    const chapters = m[1]!.split(', ').map((r) => ROMAN[r]!);
    const b = new Binder(env);
    b.it = { ref: 'self' };
    const program = parseProgram(m[2]!.replace(/^\w/, (c) => c.toUpperCase()), b);
    if (!program) return null;
    const node: TriggeredAbility = { kind: 'triggered', text: original, trigger: { type: 'chapter', chapters }, ...program };
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

/** "As an additional cost to cast this spell, sacrifice a creature." — CR 601.2f / CR 118.8. */
export const additionalCostRule: GrammarRule = {
  id: 'additional_cost',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    const m = /^As an additional cost to cast ~, (.+)\.$/.exec(line);
    if (!env || !m) return null;
    const cost = choiceCost(m[1]!.replace(/^\w/, (c) => c.toUpperCase()), new Binder(env));
    if (!cost) return null;
    const node: StaticAbility = { kind: 'static', text: original, effect: { type: 'additional_cost', cost } };
    return node;
  },
};

export const GRAMMAR_RULES: GrammarRule[] = [
  chapterRule,
  entersWithCountersRule,
  entersTappedUnlessRule,
  asEntersRule,
  entersAsCopyRule,
  deckRule,
  costModifierRule,
  quantityReplacementRule,
  exileInsteadRule,
  selfReplacementRule,
  additionalCostRule,
  continuousRule,
  triggeredRule,
  activatedRule,
  spellRule,
];

export { splitSentences };
export type { AbilityNode };
