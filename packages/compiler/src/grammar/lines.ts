import type {
  AttackTaxNode,
  CastProhibitionNode,
  CastOptionNode,
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
  TriggerExtraNode,
  AddManaEffect,
  ExileInsteadNode,
  FaceDef,
  ManaSpend,
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
  StaticPreventionNode,
  TriggerNode,
  TriggeredAbility,
} from '@mtg/schema';
import type { GrammarRule } from '../parser.js';
import { combinationColors, parseManaProduction } from '../rules/mana.js';
import { attempt, Binder, type GrammarEnv } from './binder.js';
import { bindX, parseCount, parseForEach, scaleBy } from './amounts.js';
import { parseCombatRule } from './combat.js';
import { conditionSubject, parseCondition } from './conditions.js';
import { parseCopyCandidates, parseCopyExcept } from './copies.js';
import { parseCastBan, parseEffectText, parseManaSpend, splitSentences } from './effects.js';
import { parseFilter, parseKeywordList, parseObjectRef } from './nouns.js';
import { COLOR_WORDS, isSubtype, NUMBER_WORDS, parseAmount, parsePT, subtypeOf, TYPE_NOUNS } from './words.js';

/** The grammar rules need the keyword registry; the parser passes it in the context. */
function envOf(ctx: Parameters<GrammarRule['parse']>[2]): GrammarEnv | null {
  return ctx.keywords ? (ctx as GrammarEnv) : null;
}

// ---------------------------------------------------------------------------
// Programs: effect text, possibly modal
// ---------------------------------------------------------------------------

const MODAL_HEADER = /^choose (one|two|three|four|five|one or both|one or more|any number|up to one|up to two) —$/i;

function modeCount(word: string, options: number): { min: number; max: number } {
  switch (word.toLowerCase()) {
    case 'one': return { min: 1, max: 1 };
    case 'two': return { min: 2, max: 2 };
    case 'three': return { min: 3, max: 3 };
    case 'four': return { min: 4, max: 4 };
    case 'five': return { min: 5, max: 5 };
    case 'one or both': return { min: 1, max: 2 };
    case 'one or more': return { min: 1, max: options };
    // CR 700.2: "choose up to one —" allows choosing none.
    case 'up to one': return { min: 0, max: 1 };
    case 'up to two': return { min: 0, max: 2 };
    default: return { min: 0, max: options }; // "any number"
  }
}

/**
 * Effect text → program. "Choose one —\n• A.\n• B." becomes a modal program whose
 * modes keep their own targets (CR 700.2c).
 */
export function parseProgram(text: string, b: Binder): Program | null {
  const program = parseProgramText(text, b);
  return program && !b.unsupported && !countsEachTarget(program, b) ? program : null;
}

/**
 * Singularity Rupture: "any number of target players each mill half their library" — each of them counts their own;
 * a count of "their" cards with several target players would add them up, so such text is left to players.
 */
function countsEachTarget(program: Program, b: Binder): boolean {
  const many = b.targets.flatMap((t, i) => (t.what === 'player' && (t.count ?? 1) > 1 ? [i] : []));
  if (!many.length) return false;
  const json = JSON.stringify(program.effects);
  return many.some((i) => json.includes(`"player":{"ref":"target","index":${i}}`));
}

function parseProgramText(text: string, b: Binder): Program | null {
  const [head, ...bullets] = text.split('\n');
  // "Choose one. If you control a commander as you cast this spell, you may choose both instead."
  const bonus =
    /^Choose (one|two)\. If (.+?) as you cast ~, you may choose (both|any number|three) instead\.$/.exec(head!.trim()) ??
    // CR 702.194b: "Choose one. If this spell was cast using teamwork, choose both instead."
    /^Choose (one|two)\. If ~ (was cast using teamwork), choose (both|any number|three) instead\.$/.exec(head!.trim());
  if (bonus) {
    const cond = bonus[2] === 'was cast using teamwork' ? ({ type: 'paid', cost: 'teamwork' } as ConditionNode) : parseCondition(bonus[2]!, b);
    const inner = cond && parseProgram([`Choose ${bonus[1]} —`, ...bullets].join('\n'), b);
    if (!cond || !inner?.modes) return null;
    const max = bonus[3] === 'both' ? 2 : bonus[3] === 'three' ? 3 : inner.modes.options.length;
    return { ...inner, modes: { ...inner.modes, bonus: { condition: cond, max } } };
  }
  // CR 706.3: a die roll and its results table ("1—9 | Draw a card.", "20 | …"), all one ability (CR 706.3b).
  const ROW = /^(\d+)(?:—(\d+)|(\+))? \| (.+)$/;
  if (bullets.length && bullets.every((l) => ROW.test(l))) {
    const top = parseProgram(head!, b);
    const roll = top?.effects[top.effects.length - 1];
    if (!top || top.modes || roll?.type !== 'roll_die') return null;
    const table: { min: number; max: number; effects: EffectNode[] }[] = [];
    for (const row of bullets) {
      const m = ROW.exec(row)!;
      const effects = parseEffectText(m[4]!, b);
      if (!effects) return null;
      table.push({ min: Number(m[1]), max: m[3] ? 999 : Number(m[2] ?? m[1]), effects });
    }
    roll.table = table;
    return { ...(b.targets.length ? { targets: b.targets } : {}), effects: top.effects };
  }
  // CR 700.2d: "Choose three. You may choose the same mode more than once."
  const repeat = /^Choose (one|two|three|four|five)\. You may choose the same mode more than once\.$/.exec(head!.trim());
  if (repeat) {
    // With repeats, there can be more choices than modes ("Choose three" of two).
    const inner = parseProgram(['Choose one —', ...bullets].join('\n'), b);
    const n = modeCount(repeat[1]!, 99).min;
    return inner?.modes ? { ...inner, modes: { ...inner.modes, min: n, max: n, repeat: true } } : null;
  }
  const modal = MODAL_HEADER.exec(head!.trim());
  if (modal) {
    if (bullets.length < 2 || !bullets.every((l) => l.startsWith('• '))) return null;
    const options: ModeChoice['options'] = [];
    for (const bullet of bullets) {
      const mb = b.clone();
      mb.targets = [];
      // A mode's name ("• Sell Contraband — Create a Treasure token.") has no rules meaning.
      const effects = mb.unsupported ? null : parseEffectText(bullet.slice(2).replace(/^[A-Z][\w' ,!-]{1,40} — (?=[A-Z])/, ''), mb);
      // A mode the grammar can't read stays manual; the others still run (CR 700.2).
      if (!effects || mb.unsupported) options.push({ text: bullet.slice(2), effects: [], manual: true });
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
    const variant = variantOf(line, env);
    if (variant === null) return null;
    const program = parseProgram(variant ? variant.base : line, b);
    if (!program) return null;
    if (variant) {
      if (program.modes || variant.program.modes || unfindable(variant.program)) return null;
      program.variant = { condition: variant.condition, ...(variant.program.targets ? { targets: variant.program.targets } : {}), effects: variant.program.effects };
    }
    // "X target creatures" with X the announced X only (CR 601.2b), not an X the text works out.
    if (hasCountX(program) && /\bX is\b|\bthat many target/.test(line)) return null;
    if (unfindable(program)) return null;
    const node: SpellAbility = { kind: 'spell', text: original, ...program };
    return node;
  },
};

/**
 * CR 601.2c: "If this spell was kicked, exile target nonland permanent instead." (Tear Asunder), "If the gift was promised,
 * instead return target nonland permanent …", "If this spell was kicked, it also deals 4 damage to target player" — the
 * targets depend on it, so they're chosen knowing whether it's kicked: the text without that sentence, and the text as
 * it reads when it holds ("instead": that sentence in place of the one before; otherwise added). Undefined when the line
 * isn't this shape; null when it is but a reading fails.
 */
function variantOf(line: string, env: GrammarEnv): { base: string; condition: ConditionNode; program: Program } | null | undefined {
  const sentences = splitSentences(line);
  if (!sentences || sentences.length < 2) return undefined;
  const IF = /^If (?:this spell|~) was kicked, |^If the gift was promised, |^If you cast (?:this spell|~) during your main phase, /;
  const k = sentences.findIndex((s, i) => i > 0 && IF.test(s) && /\btarget\b/.test(s) && !/\bwould\b/.test(s));
  if (k < 0) return undefined;
  const s = sentences[k]!;
  const head = /^If [^,]+/.exec(s)![0];
  const condition = (/gift/.test(head) ? { type: 'paid', cost: 'gift' } : /main phase/.test(head) ? { type: 'cast_in_main_phase' } : { type: 'kicked' }) as ConditionNode;
  let clause = s.replace(IF, '');
  const instead = /^instead /.test(clause) || / instead$/.test(clause);
  clause = clause.replace(/^instead /, '').replace(/ instead$/, '');
  // "it also deals 4 damage to …": the spell does, as in the sentence before.
  clause = clause.replace(/^it (?:also )?deals /, '~ deals ').replace(/^(\S.*?) also /, '$1 ');
  const sentence = clause.replace(/^\w/, (c) => c.toUpperCase());
  const base = sentences.filter((_, i) => i !== k);
  const changed = instead ? sentences.flatMap((x, i) => (i === k - 1 ? [] : i === k ? [sentence] : [x])) : sentences.map((x, i) => (i === k ? sentence : x));
  const vb = new Binder(env);
  vb.it = { ref: 'self' };
  const program = parseProgram(`${changed.join('. ')}.`, vb);
  return program ? { base: `${base.join('. ')}.`, condition, program } : null;
}

/** A discarded card is known only by what it was ("that card's mana value"), not as an object to act on. */
const unfindable = (program: object): boolean => JSON.stringify(program).includes('"ref":"discarded_this_way"');

/** Whether a program has a target count that is "X" (TargetSpec.countX). */
const hasCountX = (program: object): boolean => JSON.stringify(program).includes('"countX":true');

/**
 * Whether an effect uses an X nothing defines (CR 107.3): "draw X cards" with no "where X is …". A spell or an
 * activated ability has X announced; a triggered ability has only the X its permanent entered with (CR 107.3m).
 * Granted abilities and token definitions have X of their own.
 */
function hasFreeX(v: unknown): boolean {
  if (v === 'X') return true;
  if (!v || typeof v !== 'object') return false;
  if (Array.isArray(v)) return v.some(hasFreeX);
  if ((v as { kind?: unknown }).kind === 'x') return true;
  return Object.entries(v).some(([k, x]) => k !== 'token' && k !== 'abilities' && k !== 'grant' && hasFreeX(x));
}

// ---------------------------------------------------------------------------
// Activated abilities
// ---------------------------------------------------------------------------

const MANA_RUN = /^(?:\{(?:\d+|[WUBRGCSX]|[WUBRG2]\/[WUBRGP])\})+$/;

/** "Sacrifice a creature", "Sacrifice another artifact", "Discard a card" — costs where the player picks what. */
export function choiceCost(item: string, b: Binder | null): EffectNode | null {
  // Chatterfang: "Sacrifice X Squirrels" — as many as the X announced.
  const sacX = /^[Ss]acrifice X (.+)$/.exec(item);
  if (sacX && b) {
    const pf = parseFilter(sacX[1]!, b);
    if (!pf || !pf.plural || pf.filter.zone) return null;
    return { type: 'sacrifice', filter: pf.filter, amount: 'X' };
  }
  const sac = /^[Ss]acrifice (a|an|one|two|three|four|five|six|seven|eight|nine|ten|another) (other )?(.+)$/.exec(item);
  if (sac && b) {
    // Mondrak: "Sacrifice two other artifacts and/or creatures"
    const pf = parseFilter(sac[3]!.replace(/ and\/or /g, ' or '), b);
    const amount = sac[1] === 'another' ? 1 : parseAmount(sac[1]!);
    if (!pf || typeof amount !== 'number' || pf.plural !== amount > 1) return null;
    if (sac[1] === 'another' || sac[2]) pf.filter.other = true;
    return { type: 'sacrifice', filter: pf.filter, amount };
  }
  const discard = /^[Dd]iscard (a|one|two|three) cards?$/.exec(item);
  if (discard) return { type: 'discard', amount: parseAmount(discard[1]!) };
  // CR 701.59a: "Collect evidence 6"
  const evidence = /^[Cc]ollect evidence (\d+)$/.exec(item);
  if (evidence) return { type: 'collect_evidence', amount: Number(evidence[1]) };
  // "As an additional cost to cast this spell, discard X cards." / "pay X life" — X as the spell is cast.
  if (/^[Dd]iscard X cards$/.test(item)) return { type: 'discard', amount: 'X' };
  if (/^[Pp]ay X life$/.test(item)) return { type: 'pay_life', amount: 'X' };
  const discardSome = /^[Dd]iscard (a|an|one|two|three) (.+? cards?)$/.exec(item);
  if (discardSome && b) {
    const amount = parseAmount(discardSome[1]!.replace(/^an$/, 'a'));
    const pf = parseFilter(`${discardSome[2]} in your hand`, b);
    if (!pf || typeof amount !== 'number' || pf.plural !== amount > 1) return null;
    const { zone: _z, owner: _o, ...filter } = pf.filter;
    return { type: 'discard', amount, filter };
  }
  // "Tap an untapped creature you control", "tap two untapped creatures you control that each share a color with it"
  const tap = /^[Tt]ap (a|an|one|two|three|four|five) untapped (.+?)( that each share a color with (?:it|~))?$/.exec(item);
  if (tap && b) {
    const amount = parseAmount(tap[1]!.replace(/^an$/, 'a'));
    const pf = parseFilter(tap[2]!, b);
    if (!pf || typeof amount !== 'number' || pf.plural !== amount > 1 || pf.filter.controller !== 'you' || pf.filter.zone) return null;
    if (tap[3]) pf.filter.sharesColorWithSource = true;
    return { type: 'tap_creatures', amount, filter: pf.filter };
  }
  // War Room: "Pay life equal to the number of colors in your commanders' color identity"
  const lifeEqual = /^[Pp]ay life equal to (.+)$/.exec(item);
  if (lifeEqual && b) {
    const n = parseCount(lifeEqual[1]!, b);
    return n ? { type: 'pay_life', amount: n } : null;
  }
  // "As an additional cost to cast this spell, pay 3 life." (CR 119.4)
  const life = /^[Pp]ay (\d+) life$/.exec(item);
  if (life) return { type: 'pay_life', amount: Number(life[1]) };
  // Force of Will: "exile a blue card from your hand", "exile two green cards from your hand".
  const exileHand = /^[Ee]xile (a|an|one|two|three) (.+?) from your hand$/.exec(item);
  if (exileHand && b) {
    const amount = parseAmount(exileHand[1]!.replace(/^an$/, 'a'));
    const pf = parseFilter(`${exileHand[2]} in your hand`, b);
    if (!pf || typeof amount !== 'number' || pf.plural !== amount > 1) return null;
    const { zone: _z, owner: _o, ...filter } = pf.filter;
    return { type: 'exile_cards', amount, from: 'hand', ...(Object.keys(filter).length ? { filter } : {}) };
  }
  // CR 701.68a: "Blight 2"; "put a -1/-1 counter on a creature you control" is the same. CR 701.61a: "Forage".
  const blightCost = /^[Bb]light (\d+)$/.exec(item) ?? /^[Pp]ut (a|one|two|three) -1\/-1 counters? on a creature you control$/.exec(item);
  if (blightCost) {
    const amount = parseAmount(blightCost[1]!);
    return typeof amount === 'number' ? { type: 'blight', amount } : null;
  }
  if (/^[Ff]orage$/.test(item)) return { type: 'forage' };
  // "Reveal a Pirate card from your hand"; CR 701.4a: "behold a Dragon".
  const reveal = /^[Rr]eveal (a|an) (.+? card) from your hand$/.exec(item);
  if (reveal && b) {
    const pf = parseFilter(`${reveal[2]} in your hand`, b);
    if (!pf || pf.plural) return null;
    const { zone: _z, owner: _o, ...filter } = pf.filter;
    return { type: 'reveal_from_hand', amount: 1, filter };
  }
  const behold = /^[Bb]ehold (a|an) (.+)$/.exec(item);
  if (behold && b) {
    const pf = parseFilter(behold[2]!, b);
    if (!pf || pf.plural || pf.filter.zone || pf.filter.controller) return null;
    return { type: 'behold', amount: 1, filter: pf.filter };
  }
  // "Return an Island you control to its owner's hand", "return two Islands you control to their owner's hand"
  const ret = /^[Rr]eturn (a|an|one|two|three) (.+?) you control to (?:its|their) owners?'s? hands?$/.exec(item);
  if (ret && b) {
    const amount = parseAmount(ret[1]!.replace(/^an$/, 'a'));
    const pf = parseFilter(`${ret[2]} you control`, b);
    if (!pf || typeof amount !== 'number' || pf.plural !== amount > 1 || pf.filter.zone) return null;
    return { type: 'return_permanents', amount, filter: pf.filter };
  }
  // "Exile a creature card from your graveyard", "Exile two cards from your graveyard" (CR 118.3).
  const exile = /^[Ee]xile (a|an|one|two|three|four|five) (.+?) from your graveyard$/.exec(item);
  if (exile && b) {
    const amount = parseAmount(exile[1]!);
    if (typeof amount !== 'number') return null;
    if (/^(?:other )?cards?$/.test(exile[2]!)) return { type: 'exile_cards', amount, other: true };
    const pf = parseFilter(`${exile[2]} in your graveyard`, b);
    if (!pf || pf.plural !== amount > 1) return null;
    const { zone: _z, owner: _o, ...filter } = pf.filter;
    return { type: 'exile_cards', amount, other: true, filter };
  }
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
  // "−X: …" — X announced as it's activated (CR 107.3, 606.4).
  const loyaltyX = /^([+−-])X$/.exec(text.trim());
  if (loyaltyX && planeswalker) return { loyalty: 0, loyaltyX: loyaltyX[1] === '+' ? 1 : -1 };
  for (const item of text.split(/,\s*/)) {
    // CR 701.67a: "Waterbend {3}" — mana, each generic of which may be paid by tapping an artifact or creature.
    const waterbend = /^[Ww]aterbend ((?:\{\d+\})+)$/.exec(item);
    if (waterbend) {
      if (cost.waterbend) return null;
      mana += waterbend[1]!;
      cost.waterbend = [...waterbend[1]!.matchAll(/\{(\d+)\}/g)].reduce((n, m) => n + Number(m[1]), 0);
      continue;
    }
    if (item === '{T}') cost.tap = true;
    else if (item === '{Q}') cost.untap = true;
    else if (MANA_RUN.test(item)) mana += item;
    else if (/^[Ss]acrifice ~$/.test(item)) (cost.other ??= []).push({ type: 'sacrifice_self' });
    else if (/^[Dd]iscard ~$/.test(item)) (cost.other ??= []).push({ type: 'discard_self' });
    else if (/^[Ee]xile ~ from your graveyard$/.test(item)) (cost.other ??= []).push({ type: 'exile_self' });
    // Simian Spirit Guide: "Exile this card from your hand: Add {R}." (CR 605.1a: from the hand)
    else if (/^[Ee]xile ~ from your hand$/.test(item)) (cost.other ??= []).push({ type: 'exile_self_hand' });
    // Devoted Druid: "Put a -1/-1 counter on this creature"; Mazemind Tome: "Put a page counter on this artifact".
    else if (/^[Pp]ut (a|an|one|two) (\S+) counters? on ~$/.test(item)) {
      const m = /^[Pp]ut (\S+) (\S+) counters? on ~$/.exec(item)!;
      (cost.other ??= []).push({ type: 'put_counters_self', counter: m[2]!.replace(/−/g, '-'), amount: parseAmount(m[1]!.replace(/^an$/, 'a')) ?? 1 });
    }
    // Millikin: "Mill a card" (CR 701.17b).
    else if (/^[Mm]ill (a card|two cards|three cards)$/.test(item)) (cost.other ??= []).push({ type: 'mill', amount: { 'a card': 1, 'two cards': 2, 'three cards': 3 }[/^[Mm]ill (.+)$/.exec(item)![1]!]! });
    // Relic of Progenitus, Plaza of Heroes: "Exile this artifact", "Exile this land" (CR 118.3).
    else if (/^[Ee]xile ~$/.test(item)) (cost.other ??= []).push({ type: 'exile_self_battlefield' });
    // Lion's Eye Diamond: "Discard your hand" (CR 701.9b).
    else if (/^[Dd]iscard your hand$/.test(item)) (cost.other ??= []).push({ type: 'discard_hand' });
    // "Remove a +1/+1 counter from ~", "Remove three spore counters from ~" (CR 118.3).
    else if (/^[Rr]emove (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) (\S+) counters? from ~$/.test(item)) {
      const m = /^[Rr]emove (\S+) (\S+) counters? from ~$/.exec(item)!;
      const amount = parseAmount(m[1]!);
      if (typeof amount !== 'number') return null;
      (cost.other ??= []).push({ type: 'remove_counters_self', counter: m[2]!.replace(/−/g, '-'), amount });
    }
    // Storage lands: "Remove any number of storage counters from ~" (the number is X for the ability).
    else if (/^[Rr]emove any number of (\S+) counters from ~$/.test(item)) {
      (cost.other ??= []).push({ type: 'remove_counters_self', counter: /^[Rr]emove any number of (\S+)/.exec(item)![1]!, amount: 'X' });
    }
    // Escape's "Exile five other cards from your graveyard" (CR 702.138a).
    else if (/^[Ee]xile (\w+) other cards? from your graveyard$/.test(item) && typeof parseAmount(/^[Ee]xile (\w+)/.exec(item)![1]!) === 'number') {
      (cost.other ??= []).push({ type: 'exile_cards', amount: parseAmount(/^[Ee]xile (\w+)/.exec(item)![1]!) as number, other: true });
    }
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
  e.type === 'if'
    ? [...((e.effects as EffectNode[]) ?? []), ...((e.else as EffectNode[]) ?? [])].every(noChoices)
    : NO_CHOICE.has(e.type) || (e.type === 'sacrifice' && (e.what as Ref | undefined)?.ref === 'self');

const andIf = (a: ActivatedAbility, c: ConditionNode) => (a.activateIf = a.activateIf ? { type: 'and', all: [a.activateIf, c] } : c);
const ACTIVATION_LIMITS: [RegExp, (a: ActivatedAbility) => void][] = [
  // CR 602.5b: timing restrictions on activating.
  [/ Activate only during your turn, before attackers are declared\.$/, (a) => andIf(a, { type: 'before_attackers' })],
  // Vivi Ornitier: "Activate only during your turn and only once each turn."
  [/ Activate only during your turn and only once each turn\.$/, (a) => (andIf(a, { type: 'your_turn', value: true }), (a.oncePerTurn = true))],
  [/ Activate only during your turn\.$/, (a) => andIf(a, { type: 'your_turn', value: true })],
  [/ Activate only during your upkeep\.$/, (a) => andIf(a, { type: 'step', step: 'upkeep', yours: true })],
  [/ Activate only during combat\.$/, (a) => andIf(a, { type: 'step', combat: true })],
  [/ (?:Activate|Transmute|Transfigure) only as a sorcery\.$/, (a) => (a.timing = 'sorcery')],
  // Lion's Eye Diamond: matters only for a mana ability (CR 605.3a) — any other ability is activated at instant speed anyway.
  [/ Activate only as an instant\.$/, (a) => (a.timing = 'instant')],
  // CR 702.151a (reconfigure)
  [/ Activate only if ~ is attached to a creature and only as a sorcery\.$/, (a) => ((a.timing = 'sorcery'), andIf(a, { type: 'is', of: { ref: 'self' }, filter: { attached: true } }))],
  [/ Activate only once each turn\.$/, (a) => (a.oncePerTurn = true)],
  [/ Activate no more than twice each turn\.$/, (a) => (a.maxPerTurn = 2)],
  [/ Activate no more than three times each turn\.$/, (a) => (a.maxPerTurn = 3)],
  // CR 602.2
  [/ Any player may activate this ability\.$/, (a) => (a.anyPlayer = true)],
  // CR 702.177a (exhaust)
  [/ Activate only once\.$/, (a) => (a.oncePerGame = true)],
  // Throne of Eldraine: "Spend only mana of the chosen color to activate this ability."
  [/ Spend only mana of the chosen color to activate this ability\.$/, (a) => (a.payOnly = 'chosen')],
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
    if (cost.other?.some((c) => c.type === 'exile_self_hand')) node.zone = 'hand';
    for (let changed = true; changed; ) {
      changed = false;
      for (const [re, set] of ACTIVATION_LIMITS) {
        if (re.test(effectText)) {
          effectText = effectText.replace(re, '');
          set(node);
          changed = true;
        }
      }
      // "This ability costs {1} less to activate for each legendary creature you control." (channel lands)
      const reduce = / This ability costs \{(\d+)\} less to activate (?:for each ([^.]+?)|if ([^.]+?)|(during your turn))\.$/.exec(effectText);
      if (reduce) {
        const rb = new Binder(env);
        const per = reduce[2] ? parseForEach(reduce[2], rb) : undefined;
        const condition = reduce[3] ? parseCondition(reduce[3], rb) : undefined;
        if ((reduce[2] && !per) || (reduce[3] && !condition) || node.costReduction) return null;
        node.costReduction = { amount: Number(reduce[1]), ...(per ? { per } : {}), ...(condition ? { condition } : {}), ...(reduce[4] ? { yourTurn: true as const } : {}) };
        effectText = effectText.slice(0, reduce.index) + (effectText.endsWith('.') && !effectText.slice(0, reduce.index).endsWith('.') ? '.' : '');
        changed = true;
      }
      // "Activate only if you control an Island." (CR 602.5b); Temple of Civilization: "Activate only if you attacked with
      // three or more creatures this turn and only as a sorcery."
      const onlyIf = / Activate only if ([^.]+?)( and only as a sorcery)?\.$/.exec(effectText);
      if (onlyIf) {
        const cond = parseCondition(onlyIf[1]!, new Binder(env));
        if (!cond) return null;
        andIf(node, cond);
        if (onlyIf[2]) node.timing = 'sorcery';
        effectText = effectText.slice(0, onlyIf.index);
        changed = true;
      }
    }
    // CR 605.1a: mana abilities produce mana and have no targets; loyalty abilities never are.
    // Bloom Tender: "For each color among permanents you control, add one mana of that color."
    const eachColor = cost.loyalty === undefined ? /^For each color among (.+?), add one mana of that color\.$/.exec(effectText) : null;
    if (eachColor) {
      const pf = parseFilter(eachColor[1]!, new Binder(env));
      if (!pf || !pf.plural || pf.filter.zone || node.timing || node.maxPerTurn || node.oncePerGame) return null;
      return { ...node, effects: [{ type: 'add_mana', colorsAmong: pf.filter, eachColor: true }], mana: true };
    }
    // Chrome Mox: "Add one mana of any of the exiled card's colors."
    if (cost.loyalty === undefined && /^Add one mana of any of the exiled card's colors\.$/.test(effectText)) {
      if (node.timing || node.maxPerTurn || node.oncePerGame) return null;
      return { ...node, effects: [{ type: 'add_mana', anyColor: 1, exiledColors: true }], mana: true };
    }
    // Mox Amber: "Add one mana of any color among legendary creatures and planeswalkers you control."
    const among = cost.loyalty === undefined ? /^Add one mana of any color among (.+?)\.$/.exec(effectText) : null;
    if (among) {
      const pf = parseFilter(among[1]!.replace(/, and /, ', or ').replace(/ and /, ' or '), new Binder(env));
      if (!pf || !pf.plural || pf.filter.zone || node.timing || node.maxPerTurn || node.oncePerGame) return null;
      return { ...node, effects: [{ type: 'add_mana', anyColor: 1, colorsAmong: pf.filter }], mana: true };
    }
    // Nykthos, Three Tree City: "Choose a color. Add an amount of mana of that color equal to your devotion to that color."
    // Astral Cornucopia: "Choose a color. Add one mana of that color for each charge counter on this artifact."
    const chooseAdd = cost.loyalty === undefined ? /^Choose a color\. Add an amount of mana of that color equal to (.+)\.$/.exec(effectText) ?? /^Choose a color\. Add one mana of that color for (each .+)\.$/.exec(effectText) : null;
    if (chooseAdd) {
      const cb = new Binder(env);
      const each = /^each (.+)$/.exec(chooseAdd[1]!);
      const times = chooseAdd[1] === 'your devotion to that color' ? { kind: 'devotion' as const, colors: [], manaColor: true as const } : each ? parseForEach(each[1]!, cb) : parseCount(chooseAdd[1]!, cb);
      if (!times || cb.targets.length) return null;
      return { ...node, effects: [{ type: 'add_mana', anyColor: 1, times }], mana: true };
    }
    if (cost.loyalty === undefined) {
      const mana = /^Add (.+?)\.(?: (.+))?$/.exec(effectText);
      // "Add {G} for each Elf you control", "Add an amount of {G} equal to ~'s power"; storage lands' "for each storage
      // counter removed this way" (X, the number removed).
      // Castle Garenbrig: "Add six {G}."
      const many = mana ? /^(two|three|four|five|six|seven|eight|nine|ten) (\{[WUBRGC]\})$/.exec(mana[1]!) : null;
      if (mana && many) mana[1] = many[2]!.repeat(parseAmount(many[1]!) as number);
      const xAny = mana ? /^X mana of any one color, where X is (.+)$/.exec(mana[1]!) : null;
      if (xAny && mana) mana[1] = `an amount of ANY equal to ${xAny[1]}`;
      // Selvala, Axebane Guardian: "Add X mana in any combination of colors, where X is …" (Vivi: "… of {U} and/or {R}").
      const xCombo = mana ? /^X mana in any combination of (.+?), where X is (.+)$/.exec(mana[1]!) : null;
      if (xCombo && mana) {
        const colors = combinationColors(xCombo[1]!);
        const cb = new Binder(env);
        const amount = colors ? parseCount(xCombo[2]!, cb) : null;
        if (!colors || !amount || cb.targets.length || mana[2] || node.timing || node.maxPerTurn || node.oncePerGame) return null;
        return { ...node, effects: [{ type: 'add_mana', combination: { amount, colors } }], mana: true };
      }
      const scaled = mana ? /^(?:((?:\{[WUBRGC]\})+) for each (.+)|an amount of (\{[WUBRGC]\}|ANY) equal to (.+))$/.exec(mana[1]!) : null;
      const removedThisWay = scaled?.[2] && /^\S+ counter removed this way$/.test(scaled[2]) && cost.other?.some((c) => c.amount === 'X');
      const times = scaled ? (removedThisWay ? { kind: 'x' as const } : scaled[2] ? parseForEach(scaled[2], new Binder(env)) : parseCount(scaled[4]!, new Binder(env))) : null;
      const unit = scaled ? (scaled[3] === 'ANY' ? parseManaProduction('one mana of any color') : parseManaProduction(scaled[1] ?? scaled[3]!)) : null;
      const effect = scaled ? (times && unit ? { ...unit, times } : null) : mana && parseManaProduction(mana[1]!);
      // CR 106.6: "Spend this mana only to cast creature spells."
      const spendOnly = mana?.[2] ? /^Spend this mana only ([^.]+)\.(?: (.+))?$/.exec(mana[2]) : null;
      if (mana && effect && spendOnly) {
        const spend = parseManaSpend(spendOnly[1]!, new Binder(env));
        if (!spend) return null;
        effect.spend = spend;
        mana[2] = spendOnly[2]!;
      }
      // Path of Ancestry: "When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1."
      const spentWhen = mana?.[2] ? /^When that mana is spent to cast (.+?), (.+)\.$/.exec(mana[2]) : null;
      if (mana && effect && spentWhen) {
        const sb = new Binder(env);
        const pf = parseFilter(spentWhen[1]!.replace(/^(?:a|an) /, ''), sb);
        const then = pf && pf.filter.zone === 'stack' ? parseEffectText(`${spentWhen[2]!.replace(/^\w/, (c) => c.toUpperCase())}.`, sb) : null;
        if (!pf || !then || sb.targets.length) return null;
        const { zone: _z, ...filter } = pf.filter;
        effect.abilities = [{ kind: 'triggered', text: mana[2]!, trigger: { type: 'mana_spent', filter }, effects: then }];
        mana[2] = '';
      }
      // CR 500.5: "Until end of turn, you don't lose this mana as steps and phases end."
      const keep = mana?.[2] ? /^Until end of turn, you don't lose this mana as steps and phases end\.(?: (.+))?$/.exec(mana[2]) : null;
      if (mana && effect && keep) {
        effect.keep = 'end_of_turn';
        mana[2] = keep[1]!;
      }
      // Urza's Tower: "{T}: Add {C}. If you control an Urza's Mine and an Urza's Power-Plant, add {C}{C}{C} instead."
      // Incubation Druid: "If this creature has a +1/+1 counter on it, add three mana of that type instead."
      // Gemstone Caverns: "If ~ has a luck counter on it, instead add one mana of any color."
      const insteadMana = mana && effect && mana[2] ? (/^If (.+?), add ((?:\{[WUBRGC]\})+|(?:two|three) mana of that (?:type|color)) instead\.$/.exec(mana[2]) ?? /^If (.+?), instead add ((?:\{[WUBRGC]\})+|one mana of any color)\.$/.exec(mana[2])) : null;
      if (mana && effect && insteadMana) {
        const cond = parseCondition(insteadMana[1]!, new Binder(env));
        const many = /^(two|three) mana of that/.exec(insteadMana[2]!);
        const alt = cond ? (many ? (effect.anyColor === 1 ? { ...effect, anyColor: parseAmount(many[1]!) as number } : null) : parseManaProduction(insteadMana[2]!)) : null;
        if (!cond || !alt || node.timing || node.maxPerTurn || node.oncePerGame) return null;
        return { ...node, effects: [{ type: 'if', cond, effects: [alt], else: [effect] }], mana: true };
      }
      if (mana && effect) {
        // Mana abilities with timing restrictions ("Activate only as a sorcery") aren't modelled yet ("only as an
        // instant" is: only with priority); conditions ("Activate only if you control a Swamp") are checked as
        // they're activated (CR 602.5b).
        if (node.timing === 'sorcery' || node.maxPerTurn || node.oncePerGame) return null;
        // "{T}: Add {R} or {W}. ~ deals 1 damage to you." — extra untargeted effects (CR 605.1a allows them).
        const b = new Binder(env);
        b.it = { ref: 'self' };
        const rest = mana[2] ? parseEffectText(mana[2], b) : [];
        // A mana ability resolves at once (CR 605.3b), so its other effects can't stop to ask anything.
        if (!rest || b.targets.length || !rest.every(noChoices)) return null;
        return { ...node, effects: [effect, ...rest], mana: true };
      }
    }
    // "Remove any number of … counters" is X only for mana abilities so far; "Sacrifice X Squirrels" is announced (CR 107.3a).
    if (cost.other?.some((c) => c.amount === 'X' && c.type !== 'sacrifice')) return null;
    const b = new Binder(env);
    b.it = { ref: 'self' };
    // Shadowheart: "Sacrifice another creature: Draw X cards, where X is that creature's power." — the one sacrificed
    // (its power as it was, CR 608.2h).
    const sacCost = cost.other?.find((c) => c.type === 'sacrifice' && c.amount === 1 && ((c.filter as ObjectFilter | undefined)?.types ?? []).includes('Creature'));
    if (sacCost) b.other = { ref: 'sacrificed_this_way' };
    const program = parseProgram(effectText, b);
    if (!program) return null;
    // Only its stats are known (cost_lki); anything else about it isn't something the ability can find.
    if (sacCost && JSON.stringify(program).includes('"sacrificed_this_way"')) return null;
    if (unfindable(program)) return null;
    if (b.selfZone) {
      // "{2}{B}: Return ~ from your graveyard to your hand."
      if (node.zone && node.zone !== b.selfZone) return null;
      node.zone = b.selfZone;
    }
    // "{X}, {T}: Tap X target creatures." — X paid in the cost; not "up to X target …, where X is …".
    if (hasCountX(program) && !(node.cost.mana?.includes('{X}') || node.cost.other?.some((c) => c.amount === 'X'))) return null;
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
  // CR 505.1: the first main phase (the 2025 name for the precombat main phase).
  'first main phase': 'main1',
  'end step': 'end',
  combat: 'beginning_of_combat',
  // CR 505.1: the second (postcombat) main phase.
  'second main phase': 'main2',
  'postcombat main phase': 'main2',
};

function parseTrigger(word: string, text: string, b: Binder): ParsedTrigger | null {
  const t = text.trim();
  // A "this turn" ability about what its creator targeted (Hunter's Insight: "Whenever that creature deals combat damage
  // … this turn"): read as the source's own event, about that object instead.
  const outer = /^TARGETREF(\d+) (.+)$/.exec(t);
  if (outer) {
    const r = parseTrigger(word, `~ ${outer[2]}`, b);
    if (!r) return null;
    const target: Ref = { ref: 'target', index: Number(outer[1]) };
    const swap = <T>(x: T): T => JSON.parse(JSON.stringify(x).split('{"ref":"self"}').join(JSON.stringify(target))) as T;
    return { trigger: swap(r.trigger), it: r.it?.ref === 'self' ? target : r.it, player: r.player };
  }
  if (word === 'At') {
    // Curses: "At the beginning of enchanted player's upkeep" — "that player" is the enchanted player.
    // Tenuous Truce: "At the beginning of enchanted opponent's end step".
    const cursed = /^the beginning of enchanted (?:player|opponent)'s (upkeep|draw step|end step)$/.exec(t);
    if (cursed) return { trigger: { type: 'phase', step: STEP_WORDS[cursed[1]!]!, whose: 'enchanted' }, it: { ref: 'self' }, player: { ref: 'enchanted_player' } };
    // Black Vise: "At the beginning of the chosen player's upkeep" — "that player" is the chosen player.
    const chosenStep = /^the beginning of the chosen player's (upkeep|draw step|end step)$/.exec(t);
    if (chosenStep) return { trigger: { type: 'phase', step: STEP_WORDS[chosenStep[1]!]!, whose: 'chosen' }, it: { ref: 'self' }, player: { ref: 'chosen_player' } };
    // CR 511.1: "At end of combat"
    if (t === 'end of combat') return { trigger: { type: 'phase', step: 'end_of_combat', whose: 'each' }, it: { ref: 'self' }, player: null };
    if (t === "the beginning of the upkeep of enchanted creature's controller") {
      // Apathy, Unstable Mutation: "… untap that creature", "put a -1/-1 counter on that creature" — the enchanted creature.
      b.named['that creature'] = { ref: 'attached' };
      // Paralyze: "untap the creature".
      b.named['the creature'] = { ref: 'attached' };
      return { trigger: { type: 'phase', step: 'upkeep', whose: 'attached_controller' }, it: { ref: 'self' }, player: { ref: 'trigger_player' } };
    }
    if (t === 'the beginning of each of your postcombat main phases' || t === 'the beginning of each of your second main phases') {
      return { trigger: { type: 'phase', step: 'main2', whose: 'you' }, it: { ref: 'self' }, player: null };
    }
    const m = /^the beginning of (?:(your|each|each opponent's|each player's|the) )?(upkeep|draw step|precombat main phase|first main phase|second main phase|postcombat main phase|end step|combat)( on your turn| on each opponent's turn)?$/.exec(t);
    if (!m) return null;
    if (m[2] === 'combat' ? (m[3] ? m[1] !== undefined : m[1] !== 'each') : !m[1] || m[3]) return null;
    const whose = m[3] === " on each opponent's turn" ? 'opponent' : m[1] === 'your' || m[3] ? 'you' : m[1] === "each opponent's" ? 'opponent' : 'each';
    // "At the beginning of each player's upkeep, that player …": the player whose turn it is.
    return { trigger: { type: 'phase', step: STEP_WORDS[m[2]!]!, whose }, it: { ref: 'self' }, player: whose === 'you' ? null : { ref: 'trigger_player' } };
  }

  // Baral: "Whenever a spell or ability you control counters a spell" (CR 701.6a).
  if (t === 'a spell or ability you control counters a spell') return { trigger: { type: 'counters_spell', who: 'you' }, it: null, player: null };
  // CR 731.1a: "Whenever day becomes night or night becomes day"
  if (t === 'day becomes night or night becomes day') return { trigger: { type: 'day_night_changed' }, it: { ref: 'self' }, player: null };
  // CR 702.63a (vanishing): "When the last time counter is removed from ~"
  const lastCounter = /^the last (\S+) counter is removed from ~$/.exec(t);
  if (lastCounter) return { trigger: { type: 'last_counter_removed', counter: lastCounter[1]! }, it: { ref: 'self' }, player: null };
  // CR 702.37 / 708: "When ~ is turned face up"
  if (t === '~ is turned face up') return { trigger: { type: 'turned_face_up', subject: { ref: 'self' } }, it: { ref: 'self' }, player: null };
  // CR 716.2a: "When this Class becomes level 2"
  const level = /^~ becomes level (\d+)$/.exec(t);
  if (level) return { trigger: { type: 'becomes_level', level: Number(level[1]) }, it: { ref: 'self' }, player: null };
  // CR 702.21a (ward): "becomes the target of a spell or ability an opponent controls".
  const targeted = /^~ becomes the target of (a spell or ability|a spell|an ability)(?: (an opponent|you) controls?)?( for the first time each turn)?$/.exec(t);
  if (targeted) {
    // Goldspan Dragon: "becomes the target of a spell" — not an ability.
    const of = targeted[1] === 'a spell' ? { targetedBy: 'spell' } : targeted[1] === 'an ability' ? { targetedBy: 'ability' } : {};
    return {
      trigger: { type: 'becomes_target', subject: { ref: 'self' }, ...of, ...(targeted[2] ? { by: targeted[2] === 'you' ? 'you' : 'opponent' } : {}), ...(targeted[3] ? { first: true } : {}) },
      it: { ref: 'trigger_object' },
      player: { ref: 'trigger_player' },
    };
  }
  // "Whenever ~ blocks a creature with flying" — the creature it blocks is of that kind.
  const blocksA = /^~ blocks (?:a|an) (.+)$/.exec(t);
  if (blocksA) {
    const pf = parseFilter(blocksA[1]!, b);
    if (!pf || pf.plural) return null;
    // "that creature" is the one it blocks (the trigger's object).
    b.named['that creature'] = { ref: 'trigger_object' };
    return { trigger: { type: 'blocks', subject: { ref: 'self' }, blocked: pf.filter }, it: { ref: 'self' }, player: null };
  }
  // CR 509.3c: "blocks or becomes blocked", "becomes blocked", "becomes blocked by a creature without flanking".
  const blocked = /^~ (blocks or becomes blocked|becomes blocked)(?: by (?:a|an) (.+))?$/.exec(t);
  if (blocked) {
    const by = blocked[2] ? parseFilter(blocked[2], b) : null;
    if (blocked[2] && (!by || by.plural)) return null;
    // "Whenever ~ becomes blocked by a creature, destroy that creature." — the blocker (CR 509.3d: one trigger each).
    if (by) {
      b.named['the blocking creature'] = { ref: 'trigger_object' };
      if (blocked[1] === 'becomes blocked') b.named['that creature'] = b.named['the creature'] = { ref: 'trigger_object' };
    }
    // CR 506.2: the defending player is the one whose creatures block it.
    if (blocked[1] === 'becomes blocked') b.named['defending player'] = { ref: 'trigger_player' };
    // Engulfing Slagwurm: "Whenever ~ blocks or becomes blocked by a creature, destroy that creature." — once for each
    // creature it blocks or is blocked by, about that creature (CR 509.3c–d).
    if (by && blocked[1] === 'blocks or becomes blocked') b.named['that creature'] = b.named['the creature'] = { ref: 'trigger_object' };
    const trigger: TriggerNode =
      blocked[1] === 'becomes blocked'
        ? { type: 'becomes_blocked', subject: { ref: 'self' }, ...(by ? { by: by.filter } : {}) }
        : { type: 'blocks', subject: { ref: 'self' }, orBlocked: true, ...(by ? { other: by.filter } : {}) };
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
  // "Whenever ~ deals damage to a player", "… to an opponent": "that player" is the player dealt damage.
  const damageTo = /^(~|enchanted creature|equipped creature) deals (combat )?damage to (a player|an opponent|a creature)$/.exec(t);
  if (damageTo && !(damageTo[2] && damageTo[3] !== 'an opponent')) {
    const subject: Ref = damageTo[1] === '~' ? { ref: 'self' } : { ref: 'attached' };
    b.eventAmount = true;
    // "Whenever ~ deals damage to a creature" — "that creature" is the creature dealt damage.
    if (damageTo[3] === 'a creature') {
      b.named['that creature'] = { ref: 'trigger_object' };
      return { trigger: { type: 'deals_damage', subject, to: 'creature' }, it: subject, player: null };
    }
    return {
      trigger: { type: 'deals_damage', subject, to: damageTo[3] === 'a player' ? 'player' : 'opponent', ...(damageTo[2] ? { combat: true } : {}) },
      it: subject,
      player: { ref: 'trigger_player' },
    };
  }
  // No Mercy, Mikaeus: "Whenever a creature deals damage to you" — once for each source.
  const hitsYou = /^(?:a|an) (.+?) deals (combat )?damage to you$/.exec(t);
  if (hitsYou) {
    const pf = parseFilter(hitsYou[1]!, b);
    if (pf && !pf.plural && !pf.filter.zone) {
      b.eventAmount = true;
      const subject: Ref = { ref: 'all', filter: pf.filter };
      return { trigger: { type: 'deals_damage', subject, to: 'you', ...(hitsYou[2] ? { combat: true } : {}) }, it: { ref: 'trigger_object' }, player: null };
    }
  }
  // "Whenever ~ deals combat damage to a player or planeswalker" / "… or battle"
  const hitsOr = /^(~|enchanted creature|equipped creature) deals combat damage to a player or (planeswalker|battle)$/.exec(t);
  if (hitsOr) {
    const subject: Ref = hitsOr[1] === '~' ? { ref: 'self' } : { ref: 'attached' };
    b.eventAmount = true;
    return { trigger: { type: 'deals_combat_damage', subject, to: `player_or_${hitsOr[2]}` }, it: subject, player: { ref: 'trigger_player' } };
  }
  // "Whenever a source deals damage to ~"
  // Once for each source (Phyrexian Obliterator: "that source's controller sacrifices that many permanents").
  if (t === 'a source deals damage to ~') {
    b.eventAmount = true;
    b.named["that source's controller"] = { ref: 'trigger_player' };
    return { trigger: { type: 'dealt_damage', subject: { ref: 'self' }, perSource: true }, it: { ref: 'self' }, player: null };
  }
  // CR 701.37: "When ~ becomes monstrous"; CR 702.110b: "When ~ exploits a creature"; "When you sacrifice ~".
  if (t === '~ becomes monstrous') {
    b.eventAmount = true;
    return { trigger: { type: 'becomes_monstrous' }, it: { ref: 'self' }, player: null };
  }
  if (t === '~ exploits a creature') return { trigger: { type: 'sacrificed', exploit: true, filter: { types: ['Creature'] } }, it: { ref: 'self' }, player: null };
  if (t === 'you sacrifice ~') return { trigger: { type: 'sacrificed', self: true }, it: { ref: 'trigger_object' }, player: null };
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

  // CR 702.105a (dethrone): "Whenever ~ attacks the player with the most life or tied for most life"
  if (t === '~ attacks the player with the most life or tied for most life') {
    b.named['defending player'] = { ref: 'trigger_player' };
    return { trigger: { type: 'attacks', subject: { ref: 'self' }, defender: 'most_life' }, it: { ref: 'self' }, player: null };
  }
  // CR 702.149a (training): "Whenever ~ and at least one other creature with power greater than ~'s power attack"
  if (t === "~ and at least one other creature with power greater than ~'s power attack") {
    return { trigger: { type: 'attacks', subject: { ref: 'self' }, withGreaterPower: true }, it: { ref: 'self' }, player: null };
  }
  // "Whenever ~ and at least two other creatures attack"
  const withOthers = /^~ and at least (\w+) other creatures? attack$/.exec(t);
  if (withOthers) {
    const n = NUMBER_WORDS[withOthers[1]!];
    if (!n) return null;
    b.named['defending player'] = { ref: 'trigger_player' };
    return { trigger: { type: 'attacks', subject: { ref: 'self' }, withOthers: n }, it: { ref: 'self' }, player: null };
  }
  // "Whenever a creature attacks you or a planeswalker you control"
  const attacksYou = /^(?:a|an) (.+?) attacks you or a planeswalker you control$/.exec(t);
  if (attacksYou) {
    const pf = parseFilter(attacksYou[1]!, b);
    if (!pf || pf.plural) return null;
    b.named['that creature'] = { ref: 'trigger_object' };
    return { trigger: { type: 'attacks', subject: { ref: 'all', filter: pf.filter }, defender: 'you' }, it: { ref: 'trigger_object' }, player: null };
  }
  // Aurelia, the Law Above: "Whenever a player attacks with three or more creatures" — anyone (CR 508.3d).
  const playerAttacks = /^a player attacks with (\w+) or more creatures$/.exec(t);
  if (playerAttacks) {
    const min = NUMBER_WORDS[playerAttacks[1]!];
    if (!min) return null;
    return { trigger: { type: 'you_attack', anyone: true, min }, it: { ref: 'self' }, player: { ref: 'trigger_player' } };
  }
  // CR 508.3d: "Whenever you attack", "… with two or more creatures", "Whenever one or more creatures you control attack".
  const youAttack = /^(?:you attack|one or more creatures you control attack)(?: with (\w+) or more creatures)?$/.exec(t);
  if (youAttack) {
    const min = youAttack[1] ? (NUMBER_WORDS[youAttack[1]] ?? Number(youAttack[1])) : undefined;
    if (youAttack[1] && !min) return null;
    // Champions from Beyond: "Whenever you attack with eight or more creatures, those creatures get +4/+4" — the attackers.
    b.named['those creatures'] = { ref: 'all', filter: { types: ['Creature'], controller: 'you', combat: 'attacking' } };
    return { trigger: { type: 'you_attack', ...(min ? { min } : {}) }, it: { ref: 'self' }, player: null };
  }
  // Trouble in Pairs: "Whenever an opponent attacks you with two or more creatures"; Mangara: "Whenever an opponent
  // attacks with creatures, if two or more of those creatures are attacking you and/or planeswalkers you control".
  const oppAttacks =
    /^an opponent attacks you with (\w+) or more creatures$/.exec(t) ??
    /^an opponent attacks with creatures, if (\w+) or more of those creatures are attacking you(?: and\/or| or) (planeswalkers you control)$/.exec(t);
  if (oppAttacks) {
    const min = NUMBER_WORDS[oppAttacks[1]!] ?? Number(oppAttacks[1]);
    if (!min) return null;
    return { trigger: { type: 'you_attack', opponent: true, atYou: oppAttacks[2] ? 'or_planeswalkers' : 'you', min }, it: { ref: 'self' }, player: { ref: 'trigger_player' } };
  }
  // Duelist's Heritage: "Whenever one or more creatures attack" — whoever attacks (once per declaration, CR 508.3d).
  if (t === 'one or more creatures attack') return { trigger: { type: 'you_attack', anyone: true }, it: { ref: 'self' }, player: null };
  // CR 508.3e: "Whenever you attack a player" — "that player" is the one attacked.
  if (t === 'you attack a player') return { trigger: { type: 'you_attack', perPlayer: true }, it: { ref: 'self' }, player: { ref: 'trigger_player' } };
  // CR 509.3g: "Whenever ~ attacks and isn't blocked"
  const unblocked = /^(~|(?:enchanted|equipped) creature|(?:a|an) (.+?)) attacks and isn't blocked$/.exec(t);
  if (unblocked) {
    let subject: Ref = unblocked[1] === '~' ? { ref: 'self' } : { ref: 'attached' };
    if (unblocked[2]) {
      const pf = parseFilter(unblocked[2], b);
      if (!pf || pf.plural) return null;
      subject = { ref: 'all', filter: pf.filter };
    }
    b.named['defending player'] = { ref: 'trigger_player' };
    return { trigger: { type: 'unblocked', subject }, it: subject.ref === 'all' ? { ref: 'trigger_object' } : subject, player: null };
  }
  // "Whenever one or more creatures you control deal combat damage to a player": once for each player.
  // Kutzil: "one or more creatures you control each with power greater than its base power deals combat damage …"
  const batchHits = /^one or more (.+?) deal combat damage to (a player|an opponent|one of your opponents)$/.exec(t) ?? /^one or more (.+? each with .+?) deals combat damage to (a player|an opponent|one of your opponents)$/.exec(t);
  if (batchHits) {
    const pf = parseFilter(batchHits[1]!, b);
    if (!pf || !pf.plural) return null;
    b.eventAmount = true;
    return { trigger: { type: 'combat_damage_batch', filter: pf.filter, ...(batchHits[2] !== 'a player' ? { opponent: true } : {}) }, it: { ref: 'self' }, player: { ref: 'trigger_player' } };
  }
  // "Whenever ~ attacks for the first time each turn" (with additional combat phases, CR 500.8)
  if (t === '~ attacks for the first time each turn') {
    b.named['defending player'] = { ref: 'trigger_player' };
    return { trigger: { type: 'attacks', subject: { ref: 'self' }, firstTime: true }, it: { ref: 'self' }, player: null };
  }
  // CR 702.171b: "Whenever ~ attacks while saddled" — it's saddled as it attacks.
  if (t === '~ attacks while saddled') {
    b.named['defending player'] = { ref: 'trigger_player' };
    return { trigger: { type: 'attacks', subject: { ref: 'self' }, saddled: true }, it: { ref: 'self' }, player: null };
  }
  // Kaya's Ghostform: "When enchanted permanent dies or is put into exile" — it leaves for one of those zones.
  const attachedGone = /^(~|(?:enchanted|equipped) (?:creature|permanent|artifact|land)) (dies or is put into exile|is put into exile)$/.exec(t);
  if (attachedGone) {
    const subject: Ref = attachedGone[1] === '~' ? { ref: 'self' } : { ref: 'attached' };
    const toZones = attachedGone[2] === 'is put into exile' ? ['exile'] : ['graveyard', 'exile'];
    return { trigger: { type: 'leaves', subject, toZones }, it: { ref: 'trigger_object' }, player: null };
  }
  // "Whenever equipped creature attacks", "When enchanted creature dies" (CR 603.10a: it looks back).
  const attachedEvent = /^(?:enchanted|equipped) (?:creature|land|permanent|artifact) (dies|is put into a graveyard|leaves the battlefield|attacks alone|attacks|blocks)$/.exec(t);
  if (attachedEvent) {
    const type = eventType(attachedEvent[1] === 'is put into a graveyard' ? 'dies' : attachedEvent[1]!);
    if (type === 'attacks') b.named['defending player'] = { ref: 'trigger_player' };
    const leaves = type === 'dies' || type === 'leaves';
    const alone = attachedEvent[1] === 'attacks alone' ? { alone: true } : {};
    return { trigger: { type, subject: { ref: 'attached' }, ...alone }, it: leaves ? { ref: 'trigger_object' } : { ref: 'attached' }, player: null };
  }
  // Forbidden Orchard: "Whenever you tap ~ for mana" — an ordinary triggered ability when it doesn't add mana (CR 605.1b).
  if (t === 'you tap ~ for mana') return { trigger: { type: 'tapped_for_mana', subject: { ref: 'self' } }, it: { ref: 'self' }, player: null };
  // Mystic Sanctuary: "When ~ enters untapped" — only if it isn't tapped as it enters.
  if (t === '~ enters untapped') return { trigger: { type: 'enters', subject: { ref: 'self' }, untapped: true }, it: { ref: 'self' }, player: null };
  // Archivist of Oghma: "Whenever an opponent searches their library" (CR 701.23)
  const searches = /^(an opponent|a player) searches their library$/.exec(t);
  if (searches) return { trigger: { type: 'searched', who: searches[1] === 'an opponent' ? 'opponent' : 'any' }, it: null, player: { ref: 'trigger_player' } };
  // Burgeoning: "Whenever an opponent plays a land", Fastbond-style "Whenever you play a land"
  // City of Traitors: "When you play another land" (any land played, other than this one).
  const plays = /^(you|an opponent|a player) plays? (a|another) land$/.exec(t);
  if (plays && (word === 'Whenever' || plays[2] === 'another')) {
    const who = plays[1] === 'you' ? 'you' : plays[1] === 'an opponent' ? 'opponent' : 'any';
    return { trigger: { type: 'land_played', who, ...(plays[2] === 'another' ? { other: true } : {}) }, it: { ref: 'trigger_object' }, player: who === 'you' ? { ref: 'you' } : { ref: 'trigger_player' } };
  }
  // Mirkwood Bats: "Whenever you create or sacrifice a token"; "Whenever you create a token", "… one or more creature
  // tokens" — tokens are created on the battlefield (CR 111.1), so as they enter under your control.
  const createOrSac = /^you create or sacrifice a token$/.test(t);
  const create = createOrSac ? null : /^you create (a|an|one or more) (?:(.+?) )?tokens?$/.exec(t);
  if ((create || createOrSac) && word === 'Whenever') {
    let filter: ObjectFilter = { token: true, controller: 'you' };
    if (create?.[2]) {
      const pf = parseFilter(`${create[2]} tokens`, b);
      if (!pf || !pf.plural || pf.filter.zone) return null;
      filter = { ...pf.filter, token: true, controller: 'you' };
    }
    const enters = { type: 'enters', subject: { ref: 'all', filter }, ...(create?.[1] === 'one or more' ? { batch: true } : {}) } as TriggerNode;
    if (!createOrSac) return { trigger: enters, it: { ref: 'trigger_object' }, player: null };
    const sac = parseTrigger(word, 'you sacrifice a token', b);
    if (!sac) return null;
    return { trigger: { type: 'either', of: [enters, sac.trigger] }, it: null, player: null };
  }
  // Amulet of Vigor: "Whenever a permanent you control enters tapped"; Charismatic Conqueror: "… enters untapped"
  const entersTapped = /^(.+) enters (tapped|untapped)$/.exec(t);
  if (entersTapped && entersTapped[1] !== '~') {
    const one = parseTrigger(word, `${entersTapped[1]} enters`, b);
    if (one && one.trigger.type === 'enters' && !one.trigger.batch) return { ...one, trigger: { ...one.trigger, [entersTapped[2]!]: true } };
  }
  const self = /^~ (enters(?: the battlefield)?|dies|is put into (?:a|your) graveyard from the battlefield|leaves the battlefield|attacks alone|attacks|blocks|deals combat damage to a player)$/.exec(t);
  if (self) {
    const type = eventType(self[1]!);
    if (type === 'deals_combat_damage') b.eventAmount = true;
    const leaves = type === 'dies' || type === 'leaves';
    // CR 506.2: for an attacking creature, "defending player" is the player it's attacking.
    if (type === 'attacks') b.named['defending player'] = { ref: 'trigger_player' };
    return {
      trigger: { type, subject: { ref: 'self' }, ...(type === 'deals_combat_damage' ? { to: 'player' } : {}), ...(self[1] === 'attacks alone' ? { alone: true } : {}) },
      // After a zone change "it" is the new object in the graveyard or wherever it went (CR 603.10a looks back to find it).
      it: leaves ? { ref: 'trigger_object' } : { ref: 'self' },
      player: type === 'deals_combat_damage' ? { ref: 'trigger_player' } : null,
    };
  }

  // CR 603.8: a state trigger — "When you control no Islands, sacrifice ~."
  // Dark Depths: "When Dark Depths has no ice counters on it, …"
  if (word === 'When' && (/^you control no /.test(t) || /^~ has no \S+ counters on it$/.test(t))) {
    const cond = parseCondition(t, b);
    if (cond) return { trigger: { type: 'state', condition: cond }, it: { ref: 'self' }, player: null };
  }
  // Eerie (before the "~ or another …" subjects): "Whenever an enchantment you control enters and whenever you fully unlock a Room"
  const eerie = /^(.+?) and whenever you fully unlock a Room$/.exec(t);
  if (eerie) {
    const one = parseTrigger(word, eerie[1]!, b);
    if (!one) return null;
    return { trigger: { type: 'either', of: [one.trigger, { type: 'fully_unlocked' }] }, it: { ref: 'trigger_object' }, player: one.player };
  }
  // "When ~ enters or attacks", "Whenever ~ attacks or blocks", "When ~ enters or dies",
  // "When ~ enters and whenever it attacks": one ability with two trigger events (CR 603.2).
  const either = /^(~|enchanted creature|equipped creature) (enters|attacks|blocks|dies) (?:or|and whenever (?:it|~)) (attacks|blocks|dies|leaves the battlefield|is turned face up|is put into a graveyard from the battlefield|transforms into ~|becomes the target of a spell(?: or ability)?(?: an opponent controls)?)$/.exec(t);
  if (either && either[2] !== either[3]) {
    const one = parseTrigger(word, `${either[1]} ${either[2]}`, b);
    const two = one ? parseTrigger(word, `${either[1]} ${either[3]}`, b) : null;
    if (!one || !two) return null;
    // "It" is the object either event was about — the source itself (CR 603.10a looks back for "dies").
    return { trigger: { type: 'either', of: [one.trigger, two.trigger] }, it: { ref: 'trigger_object' }, player: one.player ?? two.player };
  }
  // Up the Beanstalk: "When this enchantment enters and whenever you cast a spell with mana value 5 or greater" — two
  // unrelated events (CR 603.2), so there's no "it" or "that player" to speak of.
  const andWhenever = /^~ enters and whenever (.+)$/.exec(t);
  if (andWhenever && !/^(?:it|~) /.test(andWhenever[1]!)) {
    const one = parseTrigger(word, '~ enters', b);
    const two = one ? parseTrigger('Whenever', andWhenever[1]!, b) : null;
    if (!one || !two) return null;
    return { trigger: { type: 'either', of: [one.trigger, two.trigger] }, it: null, player: null };
  }
  // Kindred Discovery: "Whenever a creature you control of the chosen type enters or attacks"
  const eitherAny = /^((?:a|an|another) .+?) (enters|attacks) or (attacks|dies)$/.exec(t);
  if (eitherAny && eitherAny[2] !== eitherAny[3]) {
    const one = parseTrigger(word, `${eitherAny[1]} ${eitherAny[2]}`, b);
    const two = one ? parseTrigger(word, `${eitherAny[1]} ${eitherAny[3]}`, b) : null;
    if (!one || !two) return null;
    return { trigger: { type: 'either', of: [one.trigger, two.trigger] }, it: { ref: 'trigger_object' }, player: one.player ?? two.player };
  }
  // "Whenever ~ becomes tapped", "Whenever enchanted land becomes tapped", "Whenever a creature you control becomes tapped"
  const tapped = /^(~|enchanted (?:creature|land|permanent|artifact)|(?:a|an|another) (.+?)) becomes (un)?tapped$/.exec(t);
  if (tapped) {
    let subject: Ref;
    if (tapped[1] === '~') subject = { ref: 'self' };
    else if (/^enchanted /.test(tapped[1]!)) subject = { ref: 'attached' };
    else {
      const pf = parseFilter(tapped[2]!, b);
      if (!pf || pf.plural) return null;
      if (/^another /.test(tapped[1]!)) pf.filter.other = true;
      subject = { ref: 'all', filter: pf.filter };
    }
    return { trigger: { type: 'becomes_tapped', subject, ...(tapped[3] ? { untapped: true } : {}) }, it: subject.ref === 'all' ? { ref: 'trigger_object' } : subject, player: null };
  }
  // "Whenever ~ or another Ally you control enters": the source itself, or another such object.
  const orSelf = /^~ or (?:another|other) (.+)$/.exec(t);
  if (orSelf) {
    const inner = parseTrigger(word, `another ${orSelf[1]}`, b);
    const subject = inner?.trigger.subject as Ref | undefined;
    if (!inner || subject?.ref !== 'all') return null;
    const { other: _o, ...filter } = subject.filter;
    inner.trigger.subject = { ref: 'all', filter: { ...filter, orSource: true } };
    return inner;
  }
  // "Whenever ~ deals combat damage to a creature" — "that creature" is the creature dealt damage.
  const hitsCreature = /^~ deals combat damage to a creature$/.exec(t);
  if (hitsCreature) {
    b.eventAmount = true;
    b.named['that creature'] = { ref: 'trigger_object' };
    return { trigger: { type: 'deals_combat_damage', subject: { ref: 'self' }, to: 'creature' }, it: { ref: 'self' }, player: null };
  }
  // "Whenever a creature you control becomes blocked", "Whenever a permanent you control is turned face up"
  const otherEvent = /^(?:a|an|another) (.+?) (becomes blocked|is turned face up)$/.exec(t);
  if (otherEvent) {
    const pf = parseFilter(otherEvent[1]!, b);
    if (!pf || pf.plural) return null;
    if (/^another /.test(t)) pf.filter.other = true;
    const subject: Ref = { ref: 'all', filter: pf.filter };
    return { trigger: { type: otherEvent[2] === 'becomes blocked' ? 'becomes_blocked' : 'turned_face_up', subject }, it: { ref: 'trigger_object' }, player: null };
  }
  // "Whenever one or more tokens you control enter": once for the batch.
  const batchEnter = /^one or more (other )?(.+?) enter(?: the battlefield)?( under your control)?$/.exec(t);
  if (batchEnter) {
    const pf = parseFilter(batchEnter[2]!, b);
    if (!pf || !pf.plural) return null;
    // "Whenever one or more other creatures you control with power 2 or less enter" (Welcoming Vampire)
    if (batchEnter[1]) pf.filter.other = true;
    if (batchEnter[3]) {
      if (pf.filter.controller) return null;
      pf.filter.controller = 'you';
    }
    // Ingenious Artillerist: "… deals that much damage" — how many entered.
    b.eventAmount = true;
    return { trigger: { type: 'enters', subject: { ref: 'all', filter: pf.filter }, batch: true }, it: { ref: 'self' }, player: null };
  }
  const other = /^(?:a|an|another|one of your) (.+?) (enters(?: the battlefield)?(?: under your control)?|dies|is put into (?:a|your) graveyard from the battlefield|leaves the battlefield|attacks alone|attacks you|attacks|blocks|deals combat damage to (?:a player|an opponent|one of your opponents))$/.exec(t);
  if (other) {
    const pf = parseFilter(other[1]!, b);
    if (!pf || pf.plural) return null;
    if (/^another /.test(t)) pf.filter.other = true;
    if (/under your control$/.test(other[2]!)) {
      if (pf.filter.controller) return null;
      pf.filter.controller = 'you';
    }
    // "is put into your graveyard from the battlefield": a card you own.
    if (/your graveyard/.test(other[2]!)) {
      if (pf.filter.owner) return null;
      pf.filter.owner = 'you';
    }
    const type = eventType(other[2]!.replace(/ under your control$/, '').replace(/ alone$/, '').replace(/ you$/, '').replace(/ to (?:an opponent|one of your opponents)$/, ' to a player'));
    if (type === 'attacks' && / you$/.test(other[2]!)) b.named['that creature'] = { ref: 'trigger_object' };
    // Old Gnawbone: "Whenever a creature you control deals combat damage to a player, create that many Treasure tokens."
    if (type === 'deals_combat_damage') b.eventAmount = true;
    return {
      trigger: {
        type,
        subject: { ref: 'all', filter: pf.filter },
        ...(type === 'deals_combat_damage' ? { to: / to a player$/.test(other[2]!) ? 'player' : 'opponent' } : {}),
        ...(/ you$/.test(other[2]!) ? { defender: 'you_only' } : {}),
        // CR 702.83b: it's the only creature declared as an attacker.
        ...(/ alone$/.test(other[2]!) ? { alone: true } : {}),
      },
      it: { ref: 'trigger_object' },
      // "Whenever a creature enchanted player controls enters, that player …"; "Whenever a creature an opponent
      // controls dies, that player loses 2 life" (who controlled it).
      player:
        type === 'deals_combat_damage'
          ? { ref: 'trigger_player' }
          : pf.filter.controller === 'enchanted'
            ? { ref: 'enchanted_player' }
            : pf.filter.controller === 'opponent' && (type === 'dies' || type === 'leaves' || type === 'enters')
              ? { ref: 'trigger_player' }
              : null,
    };
  }

  // Trouble in Pairs: "Whenever an opponent attacks you with two or more creatures, draws their second card each turn, or
  // casts their second spell each turn" — one player, any of the events (CR 603.2).
  const playerEvents = word === 'Whenever' ? /^(an opponent|a player|you) ([a-z][^,]+), ([a-z][^,]+),? or ([a-z][^,]+)$/.exec(t) : null;
  if (playerEvents) {
    const parsed = playerEvents.slice(2).map((p) => parseTrigger('Whenever', `${playerEvents[1]} ${p}`, b.clone()));
    if (parsed.every(Boolean) && new Set(parsed.map((p) => JSON.stringify(p!.player))).size === 1) {
      return { trigger: { type: 'either', of: parsed.map((p) => p!.trigger) }, it: null, player: parsed[0]!.player };
    }
  }
  // Syr Konrad: "Whenever another creature dies, or a creature card is put into a graveyard from anywhere other than the
  // battlefield, or a creature card leaves your graveyard" — any of the events (CR 603.2).
  if (word === 'Whenever' && / or (?:a|an|another|one) /.test(t) && t.includes(', or ')) {
    const parts = t.split(/,? or (?=(?:a|an|another|one or more) )/);
    if (parts.length >= 3) {
      const parsed = parts.map((p) => parseTrigger('Whenever', p.replace(/,$/, ''), b.clone()));
      if (parsed.every(Boolean)) return { trigger: { type: 'either', of: parsed.map((p) => p!.trigger) }, it: { ref: 'trigger_object' }, player: null };
    }
  }
  // "Whenever a creature card is put into a graveyard from anywhere other than the battlefield" (Syr Konrad)
  // The Gitrog Monster: "Whenever one or more land cards are put into your graveyard from anywhere" — once per batch.
  const intoYardBatch = /^one or more ((?:.+? )?cards) are put into (your|a|an opponent's) graveyard from anywhere( other than the battlefield)?$/.exec(t);
  if (intoYardBatch) {
    const pf = parseFilter(`${intoYardBatch[1]} in a graveyard`, b);
    if (pf && pf.plural && pf.filter.zone === 'graveyard') {
      const { zone: _z, ...filter } = pf.filter;
      filter.token = false;
      if (intoYardBatch[2] !== 'a') filter.owner = intoYardBatch[2] === 'your' ? 'you' : 'opponent';
      return { trigger: { type: 'put_into_graveyard', subject: { ref: 'all', filter }, batch: true, ...(intoYardBatch[3] ? { notFromBattlefield: true } : {}) }, it: null, player: null };
    }
  }
  // Bloodchief Ascension: "Whenever a card is put into an opponent's graveyard from anywhere" — "that player" is its owner.
  const intoYard = /^(a|an) ((?:.+? )?card) is put into (a|your|an opponent's) graveyard from anywhere( other than the battlefield)?$/.exec(t);
  if (intoYard) {
    const pf = parseFilter(`${intoYard[2]} in a graveyard`, b);
    if (pf && !pf.plural && pf.filter.zone === 'graveyard') {
      const { zone: _z, ...filter } = pf.filter;
      // A card: not a token (CR 108.2a).
      filter.token = false;
      if (intoYard[3] !== 'a') filter.owner = intoYard[3] === 'your' ? 'you' : 'opponent';
      return {
        trigger: { type: 'put_into_graveyard', subject: { ref: 'all', filter }, ...(intoYard[4] ? { notFromBattlefield: true } : {}) },
        it: { ref: 'trigger_object' },
        player: { ref: 'owner_of', of: { ref: 'trigger_object' } },
      };
    }
  }
  // "Whenever a creature card leaves your graveyard" — once for each card.
  const leavesOne = /^(a|an) (.+? card) leaves your graveyard$/.exec(t);
  if (leavesOne) {
    const pf = parseFilter(`${leavesOne[2]} in your graveyard`, b);
    if (pf && !pf.plural && pf.filter.zone === 'graveyard') {
      const { zone: _z, owner: _o, ...filter } = pf.filter;
      return { trigger: { type: 'leave_graveyard', filter, each: true }, it: { ref: 'trigger_object' }, player: null };
    }
  }
  // "Whenever one or more cards leave your graveyard", "… creature cards …"
  const leaveGy = /^one or more (cards|.+? cards) leave your graveyard$/.exec(t);
  if (leaveGy) {
    let filter: ObjectFilter | undefined;
    if (leaveGy[1] !== 'cards') {
      const pf = parseFilter(`${leaveGy[1]} in your graveyard`, b);
      if (!pf || !pf.plural || pf.filter.zone !== 'graveyard') return null;
      const { zone: _z, owner: _o, ...rest } = pf.filter;
      filter = rest;
    }
    return { trigger: { type: 'leave_graveyard', ...(filter ? { filter } : {}) }, it: { ref: 'self' }, player: null };
  }
  // CR 701.9 / 702.29d: "Whenever you discard a card", "an opponent discards a card", "you cycle or discard a card",
  // "you discard one or more cards", "you discard a creature card".
  // Archfiend of Ifnir: "Whenever you cycle or discard another card" — cycling is discarding (CR 702.29a): one event.
  const discard = /^(you|an opponent|a player) (?:cycles? or )?discards? (a card|another card|one or more cards|(?:a|an) (.+?) card|one or more (.+?) cards)$/.exec(t);
  if (discard) {
    const kind = discard[3] ?? discard[4];
    let filter: ObjectFilter | undefined;
    if (kind) {
      const pf = parseFilter(`${kind} card in your hand`, b);
      if (!pf || pf.filter.zone !== 'hand') return null;
      const { zone: _z, owner: _o, ...rest } = pf.filter;
      filter = rest;
    }
    const batch = /^one or more/.test(discard[2]!);
    if (!batch) b.named['that card'] = { ref: 'trigger_object' };
    return {
      trigger: { type: 'discard', who: discard[1] === 'you' ? 'you' : discard[1] === 'an opponent' ? 'opponent' : 'any', ...(batch ? { batch: true } : {}), ...(filter ? { filter } : {}), ...(discard[2] === 'another card' ? { other: true } : {}) },
      it: batch ? { ref: 'self' } : { ref: 'trigger_object' },
      player: { ref: 'trigger_player' },
    };
  }
  // CR 702.29c: "When you cycle ~" — when it's discarded to pay a cycling cost; it triggers from the graveyard.
  if (t === 'you cycle ~' || t === 'you cycle this card') {
    b.selfZone = 'graveyard';
    return { trigger: { type: 'activate', who: 'you', keyword: 'cycling', self: true }, it: { ref: 'self' }, player: null };
  }
  // "Whenever you cycle a card", "Whenever a player cycles a card", "Whenever you cycle another card"
  const cycles = /^(you|a player|an opponent) cycles? (a|another) card$/.exec(t);
  if (cycles) {
    const who = cycles[1] === 'you' ? 'you' : cycles[1] === 'an opponent' ? 'opponent' : 'any';
    return { trigger: { type: 'activate', who, keyword: 'cycling', ...(cycles[2] === 'another' ? { other: true } : {}) }, it: { ref: 'self' }, player: { ref: 'trigger_player' } };
  }
  // CR 701.22 / 701.25: "Whenever you scry", "Whenever you surveil", "Whenever you scry or surveil"
  const scry = /^you (scry|surveil|scry or surveil|forage)$/.exec(t);
  if (scry) return { trigger: { type: 'scry', kinds: scry[1]!.split(' or ') }, it: { ref: 'self' }, player: null };
  // "Whenever one or more +1/+1 counters are put on ~": "that many" is how many.
  // Exemplar of Light: "Whenever you put one or more +1/+1 counters on this creature" — counters you put on (CR 122.6).
  const youPut = /^you put one or more ([+-]\d+\/[+-]\d+|\w+) counters on (~|(?:a|an|another) (.+?))$/.exec(t);
  const countersOn = /^one or more ([+-]\d+\/[+-]\d+|\w+) counters are put on (~|(?:a|an|another) (.+?))$/.exec(t) ?? youPut;
  if (countersOn) {
    let subject: Ref = { ref: 'self' };
    if (countersOn[3]) {
      const pf = parseFilter(countersOn[3], b);
      if (!pf || pf.plural) return null;
      if (/^another /.test(countersOn[2]!)) pf.filter.other = true;
      subject = { ref: 'all', filter: pf.filter };
    }
    b.eventAmount = true;
    return { trigger: { type: 'counters_put', counter: countersOn[1]!, subject, ...(youPut ? { byYou: true } : {}) }, it: subject.ref === 'self' ? subject : { ref: 'trigger_object' }, player: null };
  }
  // Fathom Mage: "Whenever a +1/+1 counter is put on this creature" — once for each counter.
  const aCounter = /^an? ([+-]\d+\/[+-]\d+|\w+) counter is put on ~$/.exec(t);
  if (aCounter) return { trigger: { type: 'counters_put', counter: aCounter[1]!, subject: { ref: 'self' }, each: true }, it: { ref: 'self' }, player: null };
  // Midnight Clock: "When the twelfth hour counter is put on this artifact" — as its count of them reaches twelve.
  const nthCounter = /^the (first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth) ([+-]\d+\/[+-]\d+|\w+) counter is put on ~$/.exec(t);
  if (nthCounter) {
    const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
    return { trigger: { type: 'counters_put', counter: nthCounter[2]!, subject: { ref: 'self' }, reaches: ORD.indexOf(nthCounter[1]!) + 1 }, it: { ref: 'self' }, player: null };
  }
  // CR 701.21a: "Whenever you sacrifice a Clue", "… another permanent", "… a creature"
  // Mayhem Devil: "Whenever a player sacrifices a permanent"
  const sacrificed = /^(you|a player|an opponent) sacrifices? (a|an|another) (.+)$/.exec(t);
  if (sacrificed) {
    const pf = parseFilter(sacrificed[3]!, b);
    if (!pf || pf.plural || (pf.filter.controller && pf.filter.controller !== 'you')) return null;
    if (sacrificed[1] !== 'you' && pf.filter.controller) return null;
    const { controller: _c, ...filter } = pf.filter;
    b.named['that creature'] = { ref: 'trigger_object' };
    b.named['that permanent'] = { ref: 'trigger_object' };
    const who = sacrificed[1] === 'you' ? {} : { who: sacrificed[1] === 'a player' ? 'any' : 'opponent' };
    return { trigger: { type: 'sacrificed', filter, ...who, ...(sacrificed[2] === 'another' ? { other: true } : {}) }, it: { ref: 'trigger_object' }, player: sacrificed[1] === 'you' ? null : { ref: 'trigger_player' } };
  }
  const life = /^(you) gain life( for the first time each turn)?$/.exec(t);
  if (life) {
    b.eventAmount = true;
    return { trigger: { type: 'gain_life', who: 'you', ...(life[2] ? { first: true } : {}) }, it: { ref: 'self' }, player: { ref: 'you' } };
  }
  // "Whenever you draw your second card each turn"
  const nth = /^(you|an opponent) draws? (?:your|their) (first|second|third) card each turn$/.exec(t);
  if (nth) {
    const opp = nth[1] !== 'you';
    return { trigger: { type: 'draw', who: opp ? 'opponent' : 'you', nth: ['first', 'second', 'third'].indexOf(nth[2]!) + 1 }, it: { ref: 'self' }, player: opp ? { ref: 'trigger_player' } : { ref: 'you' } };
  }
  if (t === 'an opponent draws a card') return { trigger: { type: 'draw', who: 'opponent' }, it: { ref: 'self' }, player: { ref: 'trigger_player' } };
  // Orcish Bowmasters: "whenever an opponent draws a card except the first one they draw in each of their draw steps"
  const exceptFirst = /^(you draw|an opponent draws) a card except the first one (?:you|they) draw in each of (?:your|their) draw steps$/.exec(t);
  if (exceptFirst) {
    const opp = exceptFirst[1] !== 'you draw';
    return { trigger: { type: 'draw', who: opp ? 'opponent' : 'you', exceptFirstInDrawStep: true }, it: { ref: 'self' }, player: opp ? { ref: 'trigger_player' } : { ref: 'you' } };
  }
  const draw = /^(you draw|enchanted player draws) a card$/.exec(t);
  if (draw) {
    const cursed = draw[1] !== 'you draw';
    return { trigger: { type: 'draw', who: cursed ? 'enchanted' : 'you' }, it: { ref: 'self' }, player: cursed ? { ref: 'enchanted_player' } : { ref: 'you' } };
  }

  // CR 602.2: "Whenever you activate an ability that isn't a mana ability", "Whenever an opponent activates a
  // loyalty ability", "Whenever you activate an ability of an artifact or creature that isn't a mana ability".
  // Mana abilities don't use the stack (CR 605.3b): only triggers that leave them out are supported.
  const activate =
    /^(you|an opponent|a player) activates? (?:an? )?(?:(loyalty|exhaust|boast|outlast|embalm or eternalize|eternalize or embalm) )?ability(?: of (.+?))?( that isn't a mana ability)?$/.exec(t) ??
    /^()an ability of ((?:equipped|enchanted) creature)( that isn't a mana ability)? is activated$/.exec(t);
  if (activate) {
    const passive = activate.length === 4;
    const [who, kind, of, nonMana] = passive ? ['a player', undefined, activate[2], activate[3]] : [activate[1]!, activate[2], activate[3], activate[4]];
    // A planeswalker's abilities are loyalty abilities, never mana abilities (CR 606.3, 605.1a).
    if (!kind && !nonMana && !/^(?:a|an) (?:\w+ )?planeswalker$/.test(of ?? '')) return null;
    const trigger: TriggerNode = { type: 'activate', who: who === 'you' ? 'you' : who === 'an opponent' ? 'opponent' : 'any' };
    if (kind === 'loyalty') trigger.loyalty = true;
    else if (kind) {
      if (/embalm|eternalize/.test(kind)) return null;
      trigger.keyword = kind;
    }
    if (of) {
      const subject = /^(?:enchanted|equipped) (?:creature|planeswalker|permanent|artifact)$/.test(of)
        ? { ref: 'attached' as const }
        : (() => {
            const pf = parseFilter(of.replace(/ on the battlefield$/, '').replace(/^(?:a|an) /, ''), b);
            return pf && !pf.plural ? { ref: 'all' as const, filter: pf.filter } : null;
          })();
      if (!subject) return null;
      trigger.subject = subject;
    }
    b.named['that ability'] = { ref: 'trigger_object' };
    return { trigger, it: { ref: 'trigger_object' }, player: { ref: 'trigger_player' } };
  }
  // "When ~ is put into a graveyard from anywhere" — it triggers once it's there (CR 603.6c-style, from the graveyard).
  if (t === '~ is put into a graveyard from anywhere') {
    b.selfZone = 'graveyard';
    return { trigger: { type: 'put_into_graveyard', subject: { ref: 'self' } }, it: { ref: 'self' }, player: null };
  }
  // CR 309.4c: a room ability's trigger (the dungeon parser fills in the room).
  if (t === 'you move your venture marker into this room' || t === 'you move your venture marker into ~') return { trigger: { type: 'room' }, it: { ref: 'self' }, player: null };
  // Soulherder: "Whenever a creature is exiled from the battlefield" (CR 603.6c: it leaves for exile).
  const exiledFrom = /^(a|an|another) (.+?) is exiled from the battlefield$/.exec(t);
  if (exiledFrom) {
    const pf = parseFilter(exiledFrom[2]!, b);
    if (!pf || pf.plural || pf.filter.zone) return null;
    if (exiledFrom[1] === 'another') pf.filter.other = true;
    return { trigger: { type: 'leaves', subject: { ref: 'all', filter: pf.filter }, toZones: ['exile'] }, it: { ref: 'trigger_object' }, player: null };
  }
  // Dour Port-Mage: "Whenever one or more other creatures you control leave the battlefield without dying" (once per
  // batch); "Whenever another creature you control leaves the battlefield without dying".
  const manyLeave = /^(?:one or more (other )?(.+?) leave|(another|a|an) (.+?) leaves) the battlefield( without dying)?$/.exec(t);
  if (manyLeave) {
    const batch = manyLeave[2] !== undefined;
    const pf = parseFilter(batch ? manyLeave[2]! : manyLeave[4]!, b);
    if (!pf || pf.plural !== batch || pf.filter.zone) return null;
    if (manyLeave[1] || manyLeave[3] === 'another') pf.filter.other = true;
    if (!batch && !manyLeave[5]) return null;
    return {
      trigger: { type: 'leaves', subject: { ref: 'all', filter: pf.filter }, ...(batch ? { batch: true } : {}), ...(manyLeave[5] ? { withoutDying: true } : {}) },
      it: batch ? { ref: 'self' } : { ref: 'trigger_object' },
      player: null,
    };
  }
  // "Whenever one or more other creatures die", "Whenever one or more creatures you control die" (once per batch).
  const manyDie = /^one or more (other )?(.+?) die$/.exec(t);
  if (manyDie) {
    const pf = parseFilter(manyDie[2]!, b);
    if (!pf || !pf.plural || pf.filter.zone) return null;
    if (manyDie[1]) pf.filter.other = true;
    return { trigger: { type: 'dies', subject: { ref: 'all', filter: pf.filter }, batch: true }, it: { ref: 'self' }, player: null };
  }
  // CR 706: "Whenever you roll one or more dice", "Whenever you roll a die"
  if (t === 'you roll one or more dice' || t === 'you roll a die') return { trigger: { type: 'die_rolled', who: 'you' }, it: null, player: { ref: 'trigger_player' } };
  // CR 709.5h–i: "When you unlock this door", "Whenever you fully unlock a Room", "When you fully unlock ~"
  if (t === 'you unlock this door' || t === 'you unlock ~') return { trigger: { type: 'unlock_door' }, it: { ref: 'self' }, player: null };
  if (t === 'you fully unlock a Room') return { trigger: { type: 'fully_unlocked' }, it: { ref: 'trigger_object' }, player: null };
  if (t === 'you fully unlock ~' || t === 'you fully unlock this Room') return { trigger: { type: 'fully_unlocked', self: true }, it: { ref: 'self' }, player: null };
  // CR 701.27e: "When this creature transforms into ~", "Whenever ~ transforms"
  if (t === '~ transforms into ~' || t === '~ transforms') return { trigger: { type: 'transforms' }, it: { ref: 'self' }, player: null };
  // CR 700.13: "Whenever you commit a crime"; CR 700.14: "Whenever you expend 4"
  if (t === 'you commit a crime') return { trigger: { type: 'crime' }, it: { ref: 'self' }, player: null };
  const expend = /^you expend (\d+)$/.exec(t);
  if (expend) return { trigger: { type: 'expend', n: Number(expend[1]) }, it: { ref: 'self' }, player: null };
  // CR 309.7: "Whenever you complete a dungeon"
  if (t === 'you complete a dungeon') return { trigger: { type: 'dungeon_completed' }, it: { ref: 'self' }, player: null };
  // CR 701.54d: "Whenever the Ring tempts you"; "Whenever you choose a creature as your Ring-bearer".
  if (t === 'the Ring tempts you') return { trigger: { type: 'ring_tempted' }, it: { ref: 'self' }, player: null };
  if (t === 'you choose a creature as your Ring-bearer') {
    b.named['that creature'] = { ref: 'trigger_object' };
    return { trigger: { type: 'ring_tempted', chose: true }, it: { ref: 'trigger_object' }, player: null };
  }
  // CR 701.43: "Whenever you exert a creature"; CR 701.30: "Whenever you clash", "Whenever you win a clash".
  if (t === 'you exert a creature') {
    return { trigger: { type: 'exerted', subject: { ref: 'all', filter: { types: ['Creature'], controller: 'you' } } }, it: { ref: 'trigger_object' }, player: null };
  }
  if (t === 'you clash' || t === 'you win a clash') return { trigger: { type: 'clashed', ...(t === 'you win a clash' ? { won: true } : {}) }, it: { ref: 'self' }, player: null };
  // "When you cast this spell": it triggers from the stack (storm, CR 702.40a).
  if (t === 'you cast ~') return { trigger: { type: 'cast', who: 'you', self: true }, it: { ref: 'self' }, player: { ref: 'you' } };
  // Heroic: "Whenever you cast a spell that targets ~" (CR 601.2c: the targets are chosen as it's cast).
  const heroic = /^you cast a spell that targets ~$/.exec(t);
  if (heroic) return { trigger: { type: 'cast', who: 'you', filter: {}, targetsSource: true }, it: { ref: 'self' }, player: { ref: 'you' } };
  // "Whenever you cast your second spell each turn", "… your first spell during each opponent's turn"
  const nthSpell = /^(you|an opponent|a player) casts? (?:your|their) (first|second|third) spell (each turn|during each opponent's turn|during each of your opponents' turns)$/.exec(t);
  if (nthSpell) {
    const who = nthSpell[1] === 'you' ? 'you' : nthSpell[1] === 'an opponent' ? 'opponent' : 'any';
    const nth = ['first', 'second', 'third'].indexOf(nthSpell[2]!) + 1;
    return {
      trigger: { type: 'cast', who, filter: {}, nth, ...(nthSpell[3] !== 'each turn' ? { opponentsTurn: true } : {}) },
      it: { ref: 'trigger_object' },
      player: { ref: 'trigger_player' },
    };
  }
  // Esper Sentinel: "Whenever an opponent casts their first noncreature spell each turn"
  const nthKind = /^(you|an opponent|a player) casts? (?:your|their) (first|second|third) (.+?) spell each turn$/.exec(t);
  if (nthKind) {
    const pf = parseFilter(`${nthKind[3]} spell`, b);
    if (!pf || pf.plural) return null;
    const { zone: _z, ...filter } = pf.filter;
    const who = nthKind[1] === 'you' ? 'you' : nthKind[1] === 'an opponent' ? 'opponent' : 'any';
    return {
      trigger: { type: 'cast', who, filter, nth: ['first', 'second', 'third'].indexOf(nthKind[2]!) + 1, nthOfKind: true },
      it: { ref: 'trigger_object' },
      player: { ref: 'trigger_player' },
    };
  }
  const cast = /^(you|an opponent|a player|enchanted player|the chosen player) (casts?|cast or copy|casts or copies) (?:a|an) (.+)$/.exec(t);
  if (cast) {
    let what = cast[3]!;
    const extra: Record<string, unknown> = {};
    // Where it was cast from, and when.
    // Ghostly Pilferer: "Whenever an opponent casts a spell from anywhere other than their hand"
    const from = / from (anywhere other than (?:your|their) hand|your hand|their hand|exile|your graveyard|their graveyard|a graveyard)$/.exec(what);
    if (from) {
      what = what.slice(0, from.index);
      if (/^anywhere other than/.test(from[1]!)) extra.notFrom = 'hand';
      else extra.from = /hand$/.test(from[1]!) ? 'hand' : from[1] === 'exile' ? 'exile' : 'graveyard';
    }
    // "Whenever you cast a kicked spell"
    if (/^kicked /.test(what)) {
      what = what.slice('kicked '.length);
      extra.kicked = true;
    }
    // "… an instant or sorcery spell that targets a creature" — as it's cast.
    const targets = / that targets (?:a|an) (.+)$/.exec(what);
    if (targets) {
      const pf = parseFilter(targets[1]!, b);
      if (!pf || pf.plural) return null;
      extra.targets = pf.filter;
      what = what.slice(0, targets.index);
    }
    if (/ during an opponent's turn$/.test(what)) {
      what = what.replace(/ during an opponent's turn$/, '');
      extra.opponentsTurn = true;
    }
    if (/or cop/.test(cast[2]!)) extra.orCopy = true;
    const spell = what === 'spell' ? { filter: {}, plural: false } : parseFilter(what, b);
    if (!spell || spell.plural || (what !== 'spell' && spell.filter.zone !== 'stack')) return null;
    delete spell.filter.zone;
    const who = cast[1] === 'you' ? 'you' : cast[1] === 'an opponent' ? 'opponent' : cast[1] === 'enchanted player' ? 'enchanted' : cast[1] === 'the chosen player' ? 'chosen' : 'any';
    // "that player" is whoever cast the spell.
    return { trigger: { type: 'cast', who, filter: spell.filter, ...extra }, it: { ref: 'trigger_object' }, player: { ref: 'trigger_player' } };
  }
  return null;
}

function eventType(verb: string): string {
  if (verb.startsWith('enters')) return 'enters';
  if (verb === 'dies' || /^is put into (?:a|your) graveyard from the battlefield$/.test(verb)) return 'dies';
  if (verb === 'leaves the battlefield') return 'leaves';
  if (verb === 'attacks' || verb === 'attacks alone') return 'attacks';
  if (verb === 'blocks') return 'blocks';
  return 'deals_combat_damage';
}

export const triggeredRule: GrammarRule = {
  id: 'triggered',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    const m = /^(When|Whenever|At) (.+)$/s.exec(
      // "Whenever you activate an ability, if it isn't a mana ability, …": mana abilities never trigger these (CR 605.3b).
      line
        .replace(/^(Whenever .+? activates? an ability(?: of [^,]+?)?), if it isn't a mana ability, /, (_m, head: string) => `${head} that isn't a mana ability, `)
        .replace(/^Whenever an ability of ((?:equipped|enchanted) creature) is activated, if it isn't a mana ability, /, "Whenever an ability of $1 that isn't a mana ability is activated, "),
    );
    if (!env || !m) return null;
    const body = m[2]!;
    // Try each ", " as the boundary between the trigger condition and the effect.
    for (const comma of body.matchAll(/, /g)) {
      const r = attempt(new Binder(env), (b) => {
        const trig = parseTrigger(m[1]!, body.slice(0, comma.index), b);
        if (!trig) return null;
        b.it = trig.it;
        b.player = trig.player;
        // Dragon Tempest: "Whenever a Dragon you control enters, it deals X damage to any target" — that Dragon deals it.
        // Saskia: "Whenever a creature you control deals combat damage to a player, it deals that much damage to …"
        if (['enters', 'attacks', 'blocks', 'deals_combat_damage'].includes(trig.trigger.type) && (trig.trigger.subject as Ref | undefined)?.ref === 'all') b.itOnField = true;
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
        // Boromir: "Whenever an opponent casts a spell, if no mana was spent to cast it, counter that spell." — the mana
        // spent can't change, so it's checked with the cast (CR 603.4).
        if (iff && iff[1] === 'no mana was spent to cast it' && trig.trigger.type === 'cast') {
          trig.trigger = { ...trig.trigger, noManaSpent: true };
          effectText = iff[2]!;
        } else if (iff && iff[1] === "you're the defending player" && trig.trigger.type === 'attacks' && !trig.trigger.defender) {
          // Kazuul: "Whenever a creature an opponent controls attacks, if you're the defending player" — it attacks you or a
          // planeswalker you control (CR 506.2); that can't change before it resolves.
          trig.trigger = { ...trig.trigger, defender: 'you' };
          effectText = iff[2]!;
        } else if (iff) {
          condition = parseCondition(iff[1]!, b);
          // "Whenever another creature enters, if ~ has a counter on it, … onto that creature": the event's object
          // stays "that creature" after a condition about ~.
          if (trig.it?.ref === 'trigger_object') b.it = trig.it;
          if (!condition) return null;
          // Howl of the Hunt: "When this Aura enters, if enchanted creature is a Wolf or Werewolf, untap that creature." —
          // "that creature" is the one the condition is about.
          if (/^(?:enchanted|equipped) creature is /.test(iff[1]!) && condition.type === 'is') b.named['that creature'] = (condition as unknown as { of: Ref }).of;
          effectText = iff[2]!;
        }
        if (/^unless /i.test(effectText)) return null;
        let oncePerTurn = false;
        if (/ This ability triggers only once each turn\.$/.test(effectText)) {
          effectText = effectText.replace(/ This ability triggers only once each turn\.$/, '');
          oncePerTurn = true;
        }
        // CR 603.2h: "you may draw that many cards. Do this only once each turn." — it triggers only if you haven't taken
        // that action this turn (here, after an optional action).
        let doOnce = false;
        if (/^you may [^.]+\. Do this only once each turn\.$/.test(effectText)) {
          effectText = effectText.replace(/ Do this only once each turn\.$/, '');
          doOnce = true;
        }
        effectText = effectText.replace(/^\w/, (c) => c.toUpperCase());
        const program = parseProgram(effectText, b);
        // A triggered ability doesn't work from the hand ("put ~ from your hand onto the battlefield" is unread).
        if (b.selfZone === 'hand') return null;
        if (program && doOnce) {
          const first = program.effects?.[0];
          if (program.effects?.length !== 1 || first?.type !== 'may') return null;
          first.doOnce = true;
        }
        return program ? { trig, program, oncePerTurn, doOnce, condition, zone: b.selfZone as 'graveyard' | null } : null;
      });
      if (r) {
        // A triggered ability has no X announced for "X target …" (CR 601.2b).
        if (hasCountX(r.program)) return null;
        if (unfindable(r.program)) return null;
        const node: TriggeredAbility = { kind: 'triggered', text: original, trigger: r.trig.trigger, ...r.program };
        if (r.oncePerTurn) node.oncePerTurn = true;
        if (r.doOnce) node.doOnce = true;
        if (r.zone) node.zone = r.zone;
        if (node.trigger.type === 'cast' && node.trigger.self) {
          if (node.zone) return null;
          node.zone = 'stack';
        }
        if (r.condition) node.condition = r.condition;
        // CR 701.37c: in "When ~ becomes monstrous", X is the N it became monstrous with.
        if (node.trigger.type === 'becomes_monstrous' && node.effects) node.effects = bindX(node.effects, { kind: 'event' });
        // CR 107.3m: otherwise X is the X this permanent entered with, which only its own "enters" trigger sees.
        const ownEnters = node.trigger.type === 'enters' && (node.trigger as { subject?: { ref?: string } }).subject?.ref === 'self';
        // CR 107.3i: "When you cast this spell" sees the spell's own X (Hydroid Krasis).
        const ownCast = node.trigger.type === 'cast' && Boolean((node.trigger as { self?: boolean }).self);
        // Shark Typhoon: "When you cycle this card, create an X/X …" — the X paid for cycling it.
        const ownCycle = node.trigger.type === 'activate' && Boolean((node.trigger as { self?: boolean }).self) && (node.trigger as { keyword?: string }).keyword === 'cycling';
        if (!ownEnters && !ownCast && !ownCycle && hasFreeX([node.effects, node.modes, node.condition])) return null;
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
  // Doran, the Siege Tower (CR 510.1a)
  'assigns combat damage equal to its toughness rather than its power': ['damage_by_toughness'],
  "can't attack": ['cant_attack'],
  // CR 506.5
  "can't attack alone": ['cant_attack_alone'],
  "can't block alone": ['cant_block_alone'],
  "can't attack or block alone": ['cant_attack_alone', 'cant_block_alone'],
  "can't attack or block": ['cant_attack', 'cant_block'],
  // CR 602.5: Arrest
  "can't attack or block, and its activated abilities can't be activated": ['cant_attack', 'cant_block', 'cant_activate'],
  "can't block, and its activated abilities can't be activated": ['cant_block', 'cant_activate'],
  "can't be blocked": ['cant_be_blocked'],
  'attacks each combat if able': ['attacks_each_combat'],
  'attack each combat if able': ['attacks_each_combat'],
  // CR 509.1c
  'blocks each combat if able': ['blocks_each_combat'],
  'block each combat if able': ['blocks_each_combat'],
  'attacks or blocks each combat if able': ['attacks_each_combat', 'blocks_each_combat'],
  'attack or block each combat if able': ['attacks_each_combat', 'blocks_each_combat'],
  "can't be countered": ['cant_be_countered'],
  "doesn't untap during your untap step": ['doesnt_untap'],
  "doesn't untap during its controller's untap step": ['doesnt_untap'],
  // Back to Basics, Meekstone: "Nonbasic lands don't untap during their controllers' untap steps."
  "don't untap during their controllers' untap steps": ['doesnt_untap'],
  "don't untap during your untap step": ['doesnt_untap'],
  "can attack as though it didn't have defender": ['can_attack_with_defender'],
  "can attack as though they didn't have defender": ['can_attack_with_defender'],
  // CR 602.5 (after the rewrite in parseContinuous): "its activated abilities can't be activated [unless they're mana abilities]"
  "can't have its abilities activated": ['cant_activate'],
  "can't have their abilities activated": ['cant_activate'],
  "can't have its non-mana abilities activated": ['cant_activate_nonmana'],
  "can't have their non-mana abilities activated": ['cant_activate_nonmana'],
};

/** "Creatures you control get +1/+1.", "Equipped creature has flying.", "~ can't block." (CR 611.3) */
export const continuousRule: GrammarRule = {
  id: 'continuous',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    // CR 704.5j: 'The "legend rule" doesn't apply to permanents you control.' (Mirror Box, Sakashima), "… to Slivers you
    // control", 'The "legend rule" doesn't apply.' (Mirror Gallery).
    // (The quoted words are set aside as QUOTED_n.)
    const legend = env ? /^The QUOTED_(\d+) doesn't apply(?: to (.+?) you control)?\.$/.exec(line) : null;
    if (legend && (ctx as { quotes?: string[] }).quotes?.[Number(legend[1])] === 'legend rule') {
      legend.splice(1, 1);
      const pf = legend[1] && legend[1] !== 'permanents' ? parseFilter(legend[1], new Binder(env!)) : null;
      if (legend[1] && legend[1] !== 'permanents' && (!pf || !pf.plural || pf.filter.zone)) return null;
      const effect: PlayerRuleNode = { type: 'player_rule', who: legend[1] ? 'you' : 'each', rule: 'no_legend_rule', ...(pf ? { filter: pf.filter } : {}) };
      return { kind: 'static', text: original, effect } as AbilityNode;
    }
    if (!env || !line.endsWith('.') || /["“”]/.test(line)) return null;
    const b = new Binder(env);
    // Conditions in front: "During your turn, …", "As long as [condition], …" (CR 611.3a: checked continuously).
    const conds: ConditionNode[] = [];
    let rest = line.slice(0, -1);
    // "Creatures with power less than ~'s power can't block it." — the same as "~ can't be blocked by …".
    const cantBlockIt = /^(Creatures .+?) can't block (?:it|~)$/.exec(rest);
    if (cantBlockIt) rest = `~ can't be blocked by ${cantBlockIt[1]!.replace(/^C/, 'c')}`;
    // Champion of Lambholt: "Creatures with power less than this creature's power can't block creatures you control."
    const cantBlockYours = /^(Creatures .+?) can't block creatures you control$/.exec(rest);
    if (cantBlockYours) rest = `Creatures you control can't be blocked by ${cantBlockYours[1]!.replace(/^C/, 'c').replace(/\bthis creature's\b/, "~'s")}`;
    // Void Winnower: "Your opponents can't block with creatures with even mana values."
    const blockWith = /^Your opponents can't block with (creatures .+)$/.exec(rest);
    if (blockWith) rest = `${blockWith[1]!.replace(/^creatures/, 'Creatures your opponents control')} can't block`;
    rest = rest.replace(/^(~ doesn't untap during (?:your|its controller's) untap step) if (.+)$/, '$1 as long as $2');
    // Razorkin Needlehead: "This creature has first strike during your turn." — the same as "During your turn, …".
    // (Cast prohibitions keep their own "during your turn" reading.)
    if (!/can't (?:cast|activate)/.test(rest)) rest = rest.replace(/^(.+?) during (your turn|turns other than yours)$/, 'During $2, $1');
    // Topiary Stomper: "This creature can't attack or block unless you control seven or more lands." (CR 611.3a)
    // ("… unless defending player controls an Island" is checked per attack, elsewhere.)
    const unless = /^(~ can't (?:attack|block|attack or block)) unless (?!defending player)(.+)$/.exec(rest);
    const unlessCond = unless ? attempt(b, (b) => parseCondition(unless[2]!, b)) : null;
    if (unless && unlessCond) {
      conds.push({ type: 'not', cond: unlessCond });
      rest = unless[1]!;
    }
    // Wonder: "As long as this card is in your graveyard and you control an Island, creatures you control have flying."
    const inYard = /^As long as (?:this card|~) is in your graveyard(?: and (.+?))?, (.+)$/.exec(rest);
    let fromGraveyard = false;
    if (inYard) {
      if (inYard[1]) {
        const cond = attempt(b, (b) => parseCondition(inYard[1]!, b));
        if (!cond) return null;
        conds.push(cond);
      }
      rest = inYard[2]!;
      fromGraveyard = true;
    }
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
        const cond = attempt(b, (b) => {
          // "~ has first strike as long as it's attacking": "it" is the subject.
          const it = b.it;
          if (/^~ /.test(trailing[1]!)) b.it = { ref: 'self' };
          const c = parseCondition(trailing[2]!, b);
          b.it = it;
          return c;
        });
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
    const effect: ContinuousEffectNode | PlayerRuleNode | CastProhibitionNode | AttackTaxNode | EffectNode | null =
      parseContinuous(rest, b) ?? parsePlayerRule(rest) ?? parseFlashFor(rest, b) ?? parseCastProhibition(rest, b) ?? parseAttackTax(rest, b) ?? parseOthersEnterTapped(rest, b);
    if (!effect) return null;
    if (fromGraveyard) {
      if (effect.type !== 'continuous') return null;
      effect.fromGraveyard = true;
    }
    if (conds.length) effect.condition = conds.length === 1 ? conds[0]! : { type: 'and', all: conds };
    const node: StaticAbility = { kind: 'static', text: original, effect };
    return node;
  },
};

/** Rules changes for players: hand size (CR 402.2), extra land plays (CR 305.2), skipping a step (CR 614.10). */
/** CR 614.1d: "Creatures your opponents control enter tapped.", "Artifacts and creatures your opponents control enter tapped." */
function parseOthersEnterTapped(body: string, b: Binder): EffectNode | null {
  // Rhythm of the Wild: "Creature spells you control can't be countered." (CR 101.2)
  // Lier, Prowling Pyromancer: "Spells can't be countered." — anyone's.
  if (/^Spells can't be countered$/.test(body)) return { type: 'uncounterable', filter: {}, anyone: true };
  const uncounterable = /^(.*?)\bspells you (?:control|cast) can't be countered$/i.exec(body);
  if (uncounterable) {
    const words = uncounterable[1]!.trim();
    if (!words) return { type: 'uncounterable', filter: {} };
    const pf = parseFilter(`${words.replace(/ and /g, ' or ').replace(/^\w/, (c) => c.toLowerCase())} spells`, b);
    if (!pf) return null;
    const { zone: _z, ...filter } = pf.filter;
    return { type: 'uncounterable', filter };
  }
  // Metallic Mimic: "Each other creature you control of the chosen type enters with an additional +1/+1 counter on it."
  const extra = /^Each (other )?(.+?) enters with an additional (\S+) counter on it$/.exec(body);
  if (extra) {
    const pf = parseFilter(extra[2]!, b);
    if (!pf || pf.plural || pf.filter.zone) return null;
    return { type: 'enter_counters_others', filter: { ...pf.filter, ...(extra[1] ? { other: true } : {}) }, counter: extra[3]!, amount: 1 };
  }
  // Giada: "Each other Angel you control enters with an additional +1/+1 counter on it for each Angel you already control";
  // Arwen: "… enters with a number of additional +1/+1 counters on it equal to Arwen's toughness".
  const extraMany =
    /^Each (other )?(.+?) enters with an additional (\S+) counter on it for each (.+?) you already control$/.exec(body) ??
    /^Each (other )?(.+?) enters with a number of additional (\S+) counters on it equal to (.+)$/.exec(body);
  if (extraMany) {
    const pf = parseFilter(extraMany[2]!, b);
    if (!pf || pf.plural || pf.filter.zone) return null;
    const already = /for each/.test(body);
    const amount = already ? parseForEach(`${extraMany[4]} you control`, b) : parseCount(extraMany[4]!, b);
    if (!amount || amount.kind === 'x') return null;
    return { type: 'enter_counters_others', filter: { ...pf.filter, ...(extraMany[1] ? { other: true } : {}) }, counter: extraMany[3]!, amount, ...(already ? { notEntering: true } : {}) };
  }
  // Spelunking: "Lands you control enter untapped." — the controller orders replacement effects (CR 616.1), so it wins.
  const untapped = /^(.+?) you control enter untapped$/.exec(body);
  if (untapped) {
    const pf = parseFilter(`${untapped[1]!.replace(/^\w/, (c) => c.toLowerCase())} you control`, b);
    if (!pf || !pf.plural || pf.filter.zone) return null;
    return { type: 'enter_untapped_others', filter: pf.filter };
  }
  const m = /^(.+?) enter(?: the battlefield)? tapped$/.exec(body);
  if (!m || /^(?:~|It|This)\b/.test(m[1]!)) return null;
  const pf = parseFilter(m[1]!.replace(/, and /, ', or ').replace(/^(\w+) and (\w+)/, '$1 or $2').replace(/^\w/, (c) => c.toLowerCase()), b);
  if (!pf || !pf.plural || pf.filter.zone) return null;
  return { type: 'enter_tapped_others', filter: pf.filter };
}

/** CR 508.1g: "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you." */
function parseAttackTax(body: string, b: Binder): AttackTaxNode | null {
  const m = /^(.*?creatures) can't attack you( or planeswalkers you control)? unless their controller pays ((?:\{(?:\d+|[WUBRGCX])\})+) for each (?:creature they control that's attacking you|of those creatures)(?:, where X is (.+))?$/i.exec(body);
  if (!m || /X/.test(m[3]!) !== Boolean(m[4])) return null;
  const x = m[4] ? parseCount(m[4], b) : undefined;
  if (x === null || (x && m[3] !== '{X}')) return null;
  const pf = parseFilter(m[1]!.replace(/^\w/, (c) => c.toLowerCase()), b);
  if (!pf || !pf.plural || pf.filter.zone || pf.filter.controller) return null;
  const { types, ...rest } = pf.filter;
  if (types && (types.length !== 1 || types[0] !== 'Creature')) return null;
  return { type: 'attack_tax', cost: m[3]!, ...(x ? { x } : {}), ...(m[2] ? { planeswalkers: true } : {}), ...(Object.keys(rest).length ? { filter: rest } : {}) };
}

/** CR 101.2: "Your opponents can't cast spells during your turn.", "Each player can't cast more than one spell each turn." */
function parseCastProhibition(body: string, b: Binder): CastProhibitionNode | null {
  // After a condition ("During your turn, your opponents can't …") the subject starts lower-case.
  body = body.replace(/^\w/, (c) => c.toUpperCase());
  const passive = /^(Spells .+|.+ spells) can't be cast$/.exec(body);
  if (passive) {
    const ban = parseCastBan(passive[1]!.replace(/^S/, 's'), b);
    return ban && !ban.maxPerTurn ? { type: 'cast_prohibition', who: 'each', ...ban } : null;
  }
  const m = /^(You|Your opponents|Each opponent|Opponents|Players|Each player|Enchanted player|Enchanted creature's controller) can't ((?:cast|activate) .+)$/.exec(body);
  if (!m) return null;
  const WHO: Record<string, CastProhibitionNode['who']> = {
    You: 'you',
    'Your opponents': 'opponents',
    'Each opponent': 'opponents',
    Opponents: 'opponents',
    Players: 'each',
    'Each player': 'each',
    'Enchanted player': 'enchanted_player',
    "Enchanted creature's controller": 'enchanted_controller',
  };
  // Grand Abolisher: "… can't cast spells or activate abilities of artifacts, creatures, or enchantments".
  const act = /^(?:(.+?) or )?activate (?:activated )?abilities(?: of (.+?))?( that aren't mana abilities)?$/.exec(m[2]!.replace(/^activate /, ' activate ').trim().replace(/^cast /, ''));
  if (act) {
    const spells = act[1] ? parseCastBan(act[1], b) : null;
    if (act[1] && (!spells || spells.maxPerTurn)) return null;
    let filter: ObjectFilter | undefined;
    if (act[2]) {
      const pf = parseFilter(act[2].replace(/, and /, ', or ').replace(/^(\w+) and (\w+)$/, '$1 or $2'), b);
      if (!pf || !pf.plural || pf.filter.zone) return null;
      filter = pf.filter;
    }
    return {
      type: 'cast_prohibition',
      who: WHO[m[1]!]!,
      ...(spells ?? {}),
      ...(act[1] ? {} : { activateOnly: true as const }),
      activate: { ...(filter ? { filter } : {}), ...(act[3] ? { nonMana: true as const } : {}) },
    };
  }
  const ban = parseCastBan(m[2]!.replace(/^cast /, ''), b);
  return ban ? { type: 'cast_prohibition', who: WHO[m[1]!]!, ...ban } : null;
}

/** Sigarda's Aid, Shimmer Myr: "You may cast Aura and Equipment spells as though they had flash." (CR 702.8a) */
function parseFlashFor(body: string, b: Binder): PlayerRuleNode | null {
  const m = /^You may cast (.+?) spells as though they had flash$/.exec(body);
  if (!m) return null;
  const pf = parseFilter(`${m[1]!.replace(/ and /g, ' or ')} spells`, b);
  if (!pf || !pf.plural) return null;
  const { zone: _z, ...filter } = pf.filter;
  return Object.keys(filter).length ? { type: 'player_rule', who: 'you', rule: 'flash', filter } : null;
}

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
    'may cast spells from your hand without paying their mana costs': 'free_from_hand',
  };
  if (subject && simple[subject[2]!] && who(subject[1]!)) return { type: 'player_rule', who: who(subject[1]!)!, rule: simple[subject[2]!]! };
  // Platinum Angel: "You can't lose the game and your opponents can't win the game." (CR 104.3a: conceding still works.)
  if (body === "You can't lose the game and your opponents can't win the game") return { type: 'player_rule', who: 'you', rule: 'opponents_cant_win' };
  // Narset, Parter of Veils
  const oneDraw = /^(Each opponent|Each player|You) can't draw more than one card each turn$/.exec(body);
  if (oneDraw) return { type: 'player_rule', who: who(oneDraw[1]!)!, rule: 'max_one_draw' };
  const hand = /^(You|Players|Each player|Each opponent|Your opponents) ha(?:s|ve) no maximum hand size$/.exec(body);
  if (hand) return { type: 'player_rule', who: who(hand[1]!)!, rule: 'no_max_hand_size' };
  // CR 402.2: "Your maximum hand size is twenty", "Each opponent's maximum hand size is reduced by seven".
  const handSize = /^(Your|Each player's|Each opponent's) maximum hand size is (?:(reduced|increased) by )?(\w+)$/.exec(body);
  if (handSize) {
    const n = parseAmount(handSize[3]!);
    const whose = handSize[1] === 'Your' ? 'you' : handSize[1] === "Each player's" ? 'each' : 'opponents';
    if (typeof n !== 'number') return null;
    return handSize[2]
      ? { type: 'player_rule', who: whose, rule: 'hand_size_delta', amount: handSize[2] === 'reduced' ? -n : n }
      : { type: 'player_rule', who: whose, rule: 'max_hand_size', amount: n };
  }
  const land = /^(You|Each player) may play (an|two|three) additional lands? on each of (?:your|their) turns$/.exec(body);
  if (land) return { type: 'player_rule', who: who(land[1]!)!, rule: 'extra_lands', amount: land[2] === 'an' ? 1 : (parseAmount(land[2]!) as number) };
  // "You may play lands from your graveyard." (CR 305.1 allows it when an effect does)
  if (/^You may play lands from your graveyard$/.test(body)) return { type: 'player_rule', who: 'you', rule: 'lands_from_graveyard' };
  if (/^Skip your draw step$/.test(body)) return { type: 'player_rule', who: 'you', rule: 'skip_draw' };
  // Aven Mindcensor (CR 614.1a).
  if (/^If an opponent would search a library, that player searches the top four cards of that library instead$/.test(body)) return { type: 'player_rule', who: 'opponents', rule: 'search_top_four' };
  // Trouble in Pairs (CR 614.10: skipping is a replacement).
  const skipExtra = /^If (an opponent|a player|you) would begin an extra turn, (?:that player skips|you skip) that turn instead$/.exec(body);
  if (skipExtra) return { type: 'player_rule', who: skipExtra[1] === 'an opponent' ? 'opponents' : skipExtra[1] === 'you' ? 'you' : 'each', rule: 'skip_extra_turns' };
  // CR 401.5: looking at, or playing with, the top card of your library revealed.
  if (/^You may look at the top card of your library (?:any time|at any time)$/.test(body)) return { type: 'player_rule', who: 'you', rule: 'look_at_top' };
  if (body === 'You may activate abilities of creatures you control as though those creatures had haste') return { type: 'player_rule', who: 'you', rule: 'abilities_haste' };
  // Teferi, Time Raveler; Dosan the Falling Leaf: "Players can cast spells only during their own turns" is different.
  const sorceryOnly = /^(Each opponent|Your opponents|Each player|Players) can cast spells only any time (?:they|he or she) could cast a sorcery$/.exec(body);
  if (sorceryOnly) return { type: 'player_rule', who: /opponent/i.test(sorceryOnly[1]!) ? 'opponents' : 'each', rule: 'sorcery_timing' };
  if (/^Play with the top card of your library revealed$/.test(body)) return { type: 'player_rule', who: 'you', rule: 'top_revealed' };
  // CR 701.38d: "While voting, you get an additional vote." / "While voting, you may vote an additional time."
  if (/^While voting, you get an additional vote$/.test(body)) return { type: 'player_rule', who: 'you', rule: 'extra_vote' };
  // Seedborn Muse (CR 502.3 lets an effect untap permanents in another player's untap step).
  if (/^Untap all permanents you control during each other player's untap step$/.test(body)) return { type: 'player_rule', who: 'you', rule: 'untap_during_others' };
  if (/^While voting, you may vote an additional time$/.test(body)) return { type: 'player_rule', who: 'you', rule: 'may_extra_vote' };
  return null;
}

/** The effect part of a static ability: "Creatures you control get +1/+1", "it has first strike". */
function parseContinuous(body: string, b: Binder): ContinuousEffectNode | null {
  // Shalai: "You, planeswalkers you control, and other creatures you control have hexproof." — the player too.
  const youToo = /^You, (.+), and (.+?) have (hexproof|shroud)$/.exec(body) ?? /^You and (.+?)() have (hexproof|shroud)$/.exec(body);
  if (youToo) {
    const inner = parseContinuous(`${youToo[1]}${youToo[2] ? ` and ${youToo[2]}` : ''} have ${youToo[3]}`, b);
    return inner && !inner.condition ? { ...inner, alsoPlayer: youToo[3] as 'hexproof' | 'shroud' } : null;
  }
  // Bender's Waterskin, Unwinding Clock: "Untap this artifact / all artifacts you control during each other player's untap step."
  const untapOthers = /^Untap (~|all (.+?)) during each other player's untap step$/.exec(body);
  // (Seedborn Muse's "all permanents you control" is a rule for the player.)
  if (untapOthers && untapOthers[2] !== 'permanents you control') {
    if (untapOthers[1] === '~') return { type: 'continuous', affected: { ref: 'self' }, rules: ['untap_during_others'] };
    const pf = parseFilter(untapOthers[2]!, b);
    return pf && pf.plural && !pf.filter.zone ? { type: 'continuous', affected: { ref: 'all', filter: pf.filter }, rules: ['untap_during_others'] } : null;
  }
  // CR 602.5: "Enchanted creature's activated abilities can't be activated", "Activated abilities of artifacts your
  // opponents control can't be activated", "… and its activated abilities can't be activated unless they're mana abilities".
  const lock = (mana: string | undefined, their: boolean) => `can't have ${their ? 'their' : 'its'} ${mana ? 'non-mana ' : ''}abilities activated`;
  body = body
    // Dryad of the Ilysian Grove: "Lands you control are every basic land type in addition to their other types."
    .replace(/ (are|is) every basic land type in addition to (their|its) other types$/, ' $1 Plains Island Swamp Mountain Forest in addition to $2 other types')
    .replace(/^Activated abilities of sources /, 'Activated abilities of permanents ')
    .replace(/^Activated abilities of (.+?) can't be activated( unless they're mana abilities)?$/, (_m, what: string, mana?: string) => `${what.replace(/, and /, ', or ').replace(/^(\w+) and (\w+)$/, '$1 or $2').replace(/^\w/, (c) => c.toUpperCase())} ${lock(mana, true)}`)
    .replace(/^(.+?)'s activated abilities can't be activated( unless they're mana abilities)?$/, (_m, what: string, mana?: string) => `${what} ${lock(mana, false)}`)
    .replace(/,? and its activated abilities can't be activated( unless they're mana abilities)?$/, (_m, mana?: string) => ` and ${lock(mana, false)}`);
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
  const m = /^(.+?) (gets? .+|ha(?:s|ve) .+|can't .+|can block only .+|can block (?:an additional|\w+ additional|any number of) creatures?(?: each combat)?|must be blocked if able|can attack as though (?:it|they) didn't have defender|attacks? each combat if able|(?:attacks? or )?blocks? each combat if able|attack or block each combat if able|doesn't untap during .+|don't untap during .+|loses? all abilities.*|loses? (?!all abilities)[a-z ,]+(?: and can't have(?: or gain)? [a-z ,]+)?|(?:is|are) (?:an? )?(?:(?:white|blue|black|red|green|colorless)(?: and | ))*(?:[A-Z][\w’'-]* )*(?:(?:artifact|enchantment) )*creature with base power and toughness \d+\/\d+.*|is an? (?:colorless )?(?:(?:Plains|Island|Swamp|Mountain|Forest) )?land(?: with .+| and .+)?|is (?:white|blue|black|red|green|colorless)|(?:is|are) all colors|is an? (?:Plains|Island|Swamp|Mountain|Forest)|are (?:Plains|Islands|Swamps|Mountains|Forests)|(?:is|are) .+ in addition to (?:its|their) other (?:land )?types.*|isn't a creature|aren't creatures|assigns combat damage equal to its toughness rather than its power)$/.exec(body);
  if (!m) return null;
  const subject = parseObjectRef(m[1]!, b, 'static');
  if (!subject) return null;
  const effect: ContinuousEffectNode = { type: 'continuous', affected: subject.ref };
  // "gets +2/+0 and has menace", "has hexproof and can't be blocked", "gets -1/-1 and can't block".
  // "gets +1/+0, has "…," and is a Wizard in addition to its other types": a list of predicates.
  // Brotherhood Regalia: "has ward {2}, is an Assassin in addition to its other types, and can't be blocked"
  // Darksteel Mutation: "…, and it loses all other abilities, card types, and creature types"; Imprisoned in the Moon: "is a
  // colorless land with "{T}: Add {C}" and loses all other card types and abilities".
  const normalized = m[2]!
    .replace(/, and it loses /, ' and loses ')
    .replace(/^(is an? (?:colorless )?land) with (QUOTED_\d+)(?= and |$)/, '$1 and has $2');
  const predicates = normalized.replace(/, (?=(?:and )?(?:ha(?:s|ve) |gets? |is |are |can't ))/g, ' and ').replace(/ and and /g, ' and ');
  let loseOthers = false;
  for (const part of predicates.split(/ and (?=ha(?:s|ve) |gets? |can't |can attack |can block |must be |attacks? each |blocks? each |doesn't |is |are |loses? )/)) {
    // "loses all other abilities, card types, and creature types" / "… card types and abilities" — with the types this
    // effect sets (layer 4 replaces them) and the abilities it grants (layer 6, in this effect's own order).
    if (/^loses all other (?:abilities, card types, and creature types|card types and abilities)$/.test(part) && !effect.loseAbilities) {
      effect.loseAbilities = true;
      loseOthers = true;
      continue;
    }
    // Archetype of Endurance: "… lose hexproof and can't have or gain hexproof".
    // (Not Arrest's "can't have its abilities activated" — a rule flag.)
    const cantHave = /^can't have(?: or gain)? (?!(?:its|their) )([a-z ,]+)$/.exec(part);
    if (cantHave && !effect.cantHave) {
      const kws = parseKeywordList(cantHave[1]!.replace(/ or /g, ' and '), b);
      if (!kws || kws.some((k) => k.text || k.cost || k.n !== undefined)) return null;
      effect.cantHave = kws.map((k) => k.id);
      continue;
    }
    const get = /^gets? (\S+(?: for each .+)?)$/.exec(part);
    // CR 205.1b: "is a Wizard in addition to its other types", "are Equipment in addition to their other types"
    const also = /^(?:is|are) (?:a |an )?(.+?) in addition to (?:its|their) other (?:land )?types$/.exec(part);
    if (also && !effect.addTypes && also[1] === 'the chosen type') {
      effect.addTypes = { types: [], subtypes: [], chosenType: true };
      continue;
    }
    if (also && !effect.addTypes) {
      const types: string[] = [];
      const subtypes: string[] = [];
      for (const w of also[1]!.split(' ')) {
        const t = TYPE_NOUNS[w.toLowerCase()];
        // "are Forest lands in addition to their other types" — the plural with a plural subject.
        if (t && (t.toLowerCase() === w.toLowerCase() || (/s$/.test(w) && t.toLowerCase() === w.toLowerCase().slice(0, -1)))) types.push(t);
        else if (subtypeOf(w) === w || subtypeOf(w.replace(/s$/, '')) === w.replace(/s$/, '')) subtypes.push(subtypeOf(w) === w ? w : w.replace(/s$/, ''));
        else return null;
      }
      effect.addTypes = { types, subtypes };
      continue;
    }
    // Layer 4: "isn't a creature" (the Theros Gods, under their condition).
    if (/^(?:isn't a creature|aren't creatures)$/.test(part) && !effect.loseTypes) {
      effect.loseTypes = ['Creature'];
      continue;
    }
    // CR 613.1f: "loses all abilities" (layer 6).
    if (/^loses? all abilities$/.test(part)) {
      effect.loseAbilities = true;
      continue;
    }
    // Layer 6: "Creatures your opponents control lose trample" (keywords only).
    const loseKw = /^loses? ([a-z ,]+)$/.exec(part);
    if (loseKw && !effect.loseKeywords) {
      const kws = parseKeywordList(loseKw[1]!, b);
      if (!kws || kws.some((k) => k.text || k.cost || k.n !== undefined)) return null;
      effect.loseKeywords = kws.map((k) => k.id);
      continue;
    }
    // Layer 7b: "has base power and toughness 1/1"
    const basePT = /^ha(?:s|ve) base power and toughness (\d+)\/(\d+)$/.exec(part);
    if (basePT && effect.setPower === undefined) {
      effect.setPower = Number(basePT[1]);
      effect.setToughness = Number(basePT[2]);
      effect.setLayer = '7b';
      continue;
    }
    // Layers 4, 5, 7b: "is a blue Frog creature with base power and toughness 1/1"
    // Darksteel Mutation: "is an Insect artifact creature with base power and toughness 0/1"; "a green and white Elk creature".
    const isA = /^(?:is|are) (?:an? )?((?:(?:white|blue|black|red|green|colorless)(?: and | ))*)((?:[A-Z][\w’'-]* )*)((?:artifact |enchantment )*)creature with base power and toughness (\d+)\/(\d+)$/.exec(part);
    if (isA && !effect.setTypes) {
      const colors = isA[1]!.trim() ? isA[1]!.trim().split(/ and | /).filter((w) => w !== 'colorless').map((w) => COLOR_WORDS[w]!) : null;
      const subtypes = isA[2]!.trim() ? isA[2]!.trim().split(' ') : [];
      if (subtypes.some((w) => subtypeOf(w) !== w)) return null;
      const more = isA[3]!.trim() ? isA[3]!.trim().split(' ').map((w) => TYPE_NOUNS[w]!) : [];
      effect.setTypes = { types: [...more, 'Creature'], subtypes };
      if (colors) effect.colors = colors as Color[];
      effect.setPower = Number(isA[4]);
      effect.setToughness = Number(isA[5]);
      effect.setLayer = '7b';
      continue;
    }
    // Imprisoned in the Moon: "is a colorless land" (layers 4 and 5; its subtypes go with its other types).
    // Song of the Dryads: "is a colorless Forest land" — only a Forest land, with a Forest's mana ability and not its
    // own (CR 305.7).
    const isLandType = /^is an? (colorless )?(?:(Plains|Island|Swamp|Mountain|Forest) )?land$/.exec(part);
    if (isLandType && !effect.setTypes) {
      effect.setTypes = { types: ['Land'], subtypes: [] };
      if (isLandType[1]) effect.colors = [];
      if (isLandType[2]) effect.landTypes = [isLandType[2]];
      continue;
    }
    // Layer 5: "is blue"; layer 4 (CR 305.7): "Enchanted land is an Island"
    // Leyline of the Guildpact: "Each nonland permanent you control is all colors." (CR 105.2)
    if (/^(?:is|are) all colors$/.test(part) && !effect.colors) {
      effect.colors = ['W', 'U', 'B', 'R', 'G'];
      continue;
    }
    const isColor = /^is (white|blue|black|red|green|colorless)$/.exec(part);
    if (isColor && !effect.colors) {
      effect.colors = isColor[1] === 'colorless' ? [] : [COLOR_WORDS[isColor[1]!]! as Color];
      continue;
    }
    // Blood Moon: "Nonbasic lands are Mountains." (CR 305.7)
    const isLand = /^is an? (Plains|Island|Swamp|Mountain|Forest)$/.exec(part) ?? /^are (Plains|Island|Swamp|Mountain|Forest)s?$/.exec(part);
    if (isLand && !effect.landTypes) {
      effect.landTypes = [isLand[1]!];
      continue;
    }
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
        // Coat of Arms: "Each creature gets +1/+1 for each other creature … that shares at least one creature type with
        // it" — "it" is each creature in turn.
        const saved = b.it;
        if (subject.ref.ref === 'all') b.it = { ref: 'affected' };
        const expr = parseForEach(each[2]!, b);
        b.it = saved;
        // "Other Elves get +1/+1 for each other Elf": "other" would mean other than each affected one — not modelled.
        if (expr?.kind === 'count' && expr.filter.other && subject.ref.ref !== 'self') return null;
        const scaled = expr && scaleBy([{ type: 'x', power: pt.power, toughness: pt.toughness }], expr);
        if (!scaled) return null;
        effect.power = scaled[0]!.power as Amount;
        effect.toughness = scaled[0]!.toughness as Amount;
      }
    } else if (has && !effect.keywords) {
      const kws = parseKeywordList(has[1]!, b, false, true);
      if (!kws) return null;
      effect.keywords = kws;
    } else return null;
  }
  // "all other card types" only makes sense with the types the effect sets.
  if (loseOthers && !effect.setTypes) return null;
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
/** CR 510.1c: "You may have ~ assign its combat damage as though it weren't blocked." */
export const asUnblockedRule: GrammarRule = {
  id: 'assign_as_unblocked',
  parse(line, original) {
    if (!/^You may have ~ assign its combat damage as though it weren't blocked\.$/.test(line)) return null;
    return { kind: 'static', text: original, effect: { type: 'continuous', affected: { ref: 'self' }, rules: ['assign_as_unblocked'] } };
  },
};

/** CR 502.3: "You may choose not to untap ~ during your untap step." */
export const optionalUntapRule: GrammarRule = {
  id: 'optional_untap',
  parse(line, original) {
    if (!/^You may choose not to untap ~ during your untap step\.$/.test(line)) return null;
    return { kind: 'static', text: original, effect: { type: 'continuous', affected: { ref: 'self' }, rules: ['may_not_untap'] } };
  },
};

/** CR 601.3: "Cast this spell only during combat.", "… only during the declare attackers step and only if you've been attacked this step." */
export const castRestrictionRule: GrammarRule = {
  id: 'cast_restriction',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    const m = /^Cast (?:this spell|~) only (.+)\.$/.exec(line);
    if (!env || !m) return null;
    const DURING: Record<string, string> = {
      'during combat': 'combat',
      'during the declare attackers step': 'declare_attackers',
      'during the declare blockers step': 'declare_blockers',
      'during combat before blockers are declared': 'before_blockers',
      'during combat after blockers are declared': 'after_blockers',
      'before the combat damage step': 'before_damage',
      'after combat': 'after_combat',
      'before combat or during combat before blockers are declared': 'before_combat',
      'during your upkeep': 'upkeep',
    };
    let rest = m[1]!;
    const effect: Record<string, unknown> = { type: 'cast_restriction' };
    if (/ and only if you've been attacked this step$/.test(rest)) {
      effect.attacked = true;
      rest = rest.replace(/ and only if you've been attacked this step$/, '');
    }
    const turn = / on (?:an opponent's|your) turn$/.exec(rest);
    if (turn) {
      effect.whose = /opponent/.test(turn[0]) ? 'opponent' : 'your';
      rest = rest.slice(0, turn.index);
    }
    if (rest === "during an opponent's turn") effect.whose = 'opponent';
    else if (rest === 'during your turn') effect.whose = 'your';
    else if (DURING[rest]) effect.during = DURING[rest];
    else {
      const iff = /^if (.+)$/.exec(rest);
      const cond = iff ? parseCondition(iff[1]!, new Binder(env)) : null;
      if (!cond) return null;
      effect.condition = cond;
    }
    return { kind: 'static', text: original, effect: effect as never };
  },
};

/**
 * "Artifact spells you cast have convoke.", "Nonartifact spells you cast have improvise.", "Noncreature spells you cast from
 * exile have convoke." — they help pay as such a spell is cast (CR 702.51a, 702.126a, 702.66a).
 */
export const spellKeywordRule: GrammarRule = {
  id: 'spell_keyword',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    const m = /^(?:(.+?) )?[Ss]pells you cast( from exile| from your hand)? have (convoke|improvise|delve)\.$/.exec(line);
    if (!env || !m) return null;
    let filter: ObjectFilter = {};
    if (m[1]) {
      const first = m[1].split(' ')[0]!;
      const words = isSubtype(first) ? m[1] : m[1].replace(/^\w/, (c) => c.toLowerCase());
      const pf = parseFilter(`${words.replace(/ and /g, ' or ')} spells`, new Binder(env));
      if (!pf || (pf.filter.zone && pf.filter.zone !== 'stack')) return null;
      const { zone: _z, ...rest } = pf.filter;
      filter = rest;
    }
    const from = m[2] ? (m[2] === ' from exile' ? 'exile' : 'hand') : undefined;
    return { kind: 'static', text: original, effect: { type: 'spell_keyword', keyword: m[3]!, filter, ...(from ? { from } : {}) } };
  },
};

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
      // "if it targets a tapped creature", "if it targets an attacking creature"
      const targets = own[4] ? /^it targets (?:a|an) (.+)$/.exec(own[4]) : null;
      if (targets) {
        const pf = parseFilter(targets[1]!, b);
        if (!pf || pf.plural || a.amount === 'X') return null;
        node.ifTargets = pf.filter;
        return { kind: 'static', text: original, effect: node };
      }
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
    // Herald's Horn, Urza's Incubator: "Creature spells you cast of the chosen type cost {1} less to cast."
    // Goblin Anarchomancer: "Each spell you cast that's red or green costs {1} less to cast."
    const thats = /^Each (?:(.+?) )?spell you cast that's (.+?) costs (\{\d+\}) (less|more) to cast$/.exec(body);
    if (thats) {
      const a = amountOf(thats[3]!);
      const pf = a ? parseFilter(`${thats[1] ? `${thats[1]} ` : ''}${thats[2]} spells`, b) : null;
      if (!a || !pf || pf.filter.zone !== 'stack') return null;
      const { zone: _z, ...filter } = pf.filter;
      return { kind: 'static', text: original, effect: { type: 'cost_modifier', who: 'you', filter, change: thats[4] as 'less' | 'more', ...a } as CostModifierNode };
    }
    // Herald's Horn, Goreclaw: "Creature spells you cast of the chosen type / with power 4 or greater cost {1} less to cast."
    const others = /^(.*?)\b(?:spells?) (?:(you|your opponents|each opponent) casts? )?((?:of the chosen type|with power \d+ or greater|with mana value \d+ or greater) )?costs? (\{[^}]+\}) (less|more) to cast$/i.exec(body);
    if (others) {
      const suffix = others[3] ? ` ${others[3].trim()}` : '';
      others.splice(3, 1);
      const chosenType = false;
      const a = amountOf(others[3]!);
      if (!a || a.amount === 'X') return null;
      const adjectives = others[1]!.trim().replace(/ and /g, ' or ');
      let filter: ObjectFilter = {};
      if ((adjectives && !/^Spells?$/i.test(adjectives)) || suffix) {
        // "Aura and Equipment spells": a subtype keeps its capital.
        const first = adjectives.split(' ')[0]!;
        const words = isSubtype(first) ? adjectives : adjectives.replace(/^\w/, (c) => c.toLowerCase());
        const pf = parseFilter(`${adjectives && !/^Spells?$/i.test(adjectives) ? `${words} ` : ''}spells${suffix}`, b);
        if (!pf) return null;
        const { zone: _z, ...rest } = pf.filter;
        filter = rest;
      }
      if (chosenType) filter.chosenType = true;
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
  if (/^(?:triple that|three times that (?:many|much))/.test(text)) return { op: 'triple' };
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
    // The Water Crystal: "If an opponent would mill one or more cards, they mill that many cards plus four instead."
    const mill = /^If (an opponent|a player|you) would mill one or more cards, (?:they|that player|you) mill (.+?) instead\.$/.exec(line);
    if (mill) {
      const op = quantityOp(mill[2]!);
      return op ? make({ event: 'mill', who: mill[1] === 'you' ? 'you' : mill[1] === 'a player' ? 'each' : 'opponents', ...op }) : null;
    }
    // Tekuthal, Inquiry Dominus: "If you would proliferate, proliferate twice instead."
    if (/^If you would proliferate, proliferate twice instead\.$/.test(line)) return make({ event: 'proliferate', who: 'you', op: 'double' });
    // Bloodletter of Aclazotz: "If an opponent would lose life during your turn, they lose twice that much life instead."
    const lose = /^If (an opponent|a player) would lose life( during your turn)?, (?:they|that player) loses? (.+?) instead\.$/.exec(line);
    if (lose) {
      const op = quantityOp(lose[3]!);
      return op && /\blife\b/.test(lose[3]!) ? make({ event: 'lose_life', who: lose[1] === 'a player' ? 'each' : 'opponents', ...op, ...(lose[2] ? { yourTurn: true } : {}) }) : null;
    }
    const life = /^If you would gain life, you gain (.+?) instead\.$/.exec(line);
    if (life) {
      const op = quantityOp(life[1]!);
      return op && /\blife\b/.test(life[1]!) ? make({ event: 'gain_life', who: 'you', ...op }) : null;
    }
    // Peregrin Took, Xorn, Chatterfang: "… those tokens plus an additional Food token are created instead."
    const plusToken =
      /^If one or more (?:(.+?) )?tokens would be created under your control, those tokens plus (an additional|that many|an?) (.+?) (?:are created|is created) instead\.$/.exec(line) ??
      /^If you would create one or more (?:(.+?) )?tokens, instead create those tokens plus (an additional|that many|an?) (.+?)\.$/.exec(line);
    if (plusToken) {
      const made = parseEffectText(`Create ${plusToken[2] === 'that many' ? 'a' : 'a'} ${plusToken[3]!.replace(/tokens$/, 'token')}.`.replace(/ a ([AEIOU])/, ' an $1'), new Binder(env));
      const token = made?.length === 1 && made[0]!.type === 'create_token' && made[0]!.amount === 1 ? (made[0]!.token as FaceDef | undefined) : undefined;
      if (!token) return null;
      let tokenFilter: ObjectFilter | undefined;
      if (plusToken[1]) {
        const pf = parseFilter(`${plusToken[1]} tokens`, b);
        if (!pf || !pf.plural) return null;
        const { token: _t, ...f } = pf.filter;
        tokenFilter = f;
      }
      return make({ event: 'tokens', who: 'you', op: 'extra', extra: { token, ...(plusToken[2] === 'that many' ? { thatMany: true as const } : {}) }, ...(tokenFilter ? { tokenFilter } : {}) });
    }
    // Teferi's Ageless Insight: "If you would draw a card except the first one you draw in each of your draw steps, draw
    // two cards instead."; Thought Reflection: "If you would draw a card, draw two cards instead."
    const drawTwo = /^If you would draw a card( except the first one you draw in each of your draw steps)?, draw two cards instead\.$/.exec(line);
    if (drawTwo) return { kind: 'static', text: original, effect: { type: 'draw_replacement', ...(drawTwo[1] ? { exceptFirst: true } : {}) } };
    // Notion Thief: "If an opponent would draw a card except the first one they draw in each of their draw steps, instead that
    // player skips that draw and you draw a card."
    if (/^If an opponent would draw a card except the first one they draw in each of their draw steps, instead that player skips that draw and you draw a card\.$/.test(line)) {
      return { kind: 'static', text: original, effect: { type: 'draw_replacement', exceptFirst: true, steal: true } };
    }
    // Laboratory Maniac, Jace, Wielder of Mysteries
    if (/^If you would draw a card while your library has no cards in it, you win the game instead\.$/.test(line)) return { kind: 'static', text: original, effect: { type: 'draw_replacement', emptyWin: true } };
    // Doubling Season: "If an effect would put one or more counters on a permanent you control, it puts twice that many
    // of those counters on that permanent instead."
    const effectPuts = /^If an effect would put one or more (?:(\S+) )?counters on (.+?), it puts (.+?) of those counters on (?:that \w+|it) instead\.$/.exec(line);
    if (effectPuts) {
      const op = quantityOp(effectPuts[3]!);
      const pf = parseFilter(effectPuts[2]!.replace(/^(?:a|an) /, ''), b);
      return op && pf && !pf.plural ? make({ event: 'counters', ...(effectPuts[1] ? { counter: effectPuts[1] } : {}), filter: pf.filter, ...op }) : null;
    }
    // Ojer Taq: "If one or more creature tokens would be created under your control, three times that many of those tokens
    // are created instead."
    const someTokens = /^If one or more (artifact|creature|Treasure|Food|Clue) tokens would be created under your control, (.+?) of those tokens are created instead\.$/.exec(line);
    if (someTokens) {
      const op = quantityOp(someTokens[2]!);
      const word = someTokens[1]!;
      const tokenFilter: ObjectFilter = /^[a-z]/.test(word) ? { types: [word.replace(/^\w/, (c) => c.toUpperCase())] } : { subtypes: [word] };
      return op ? make({ event: 'tokens', who: 'you', ...op, tokenFilter }) : null;
    }
    const tokens =
      /^If (?:one or more|an effect would create one or more) tokens would be created under your control, (.+?) of those tokens are created instead\.$/.exec(line) ??
      /^If an effect would create one or more tokens under your control, it creates (.+?) of those tokens instead\.$/.exec(line) ??
      /^If you would create one or more tokens, create (.+?) of those tokens instead\.$/.exec(line);
    if (tokens) {
      const op = quantityOp(tokens[1]!);
      return op ? make({ event: 'tokens', who: 'you', ...op }) : null;
    }
    // Academy Manufactor: "If you would create a Clue, Food, or Treasure token, instead create one of each."
    if (/^If you would create a Clue, Food, or Treasure token, instead create one of each\.$/.test(line)) {
      const faces = ['Clue', 'Food', 'Treasure'].map((kind) => {
        const made = parseEffectText(`Create a ${kind} token.`, new Binder(env));
        return made?.length === 1 && made[0]!.type === 'create_token' ? (made[0]!.token as FaceDef | undefined) : undefined;
      });
      if (faces.some((f) => !f)) return null;
      return { kind: 'static', text: original, effect: { type: 'token_one_of_each', tokens: faces } };
    }
    // Primal Vigor: "If one or more tokens would be created, twice that many of those tokens are created instead." — anyone's.
    const anyTokens = /^If one or more tokens would be created, (.+?) of those tokens are created instead\.$/.exec(line);
    if (anyTokens) {
      const op = quantityOp(anyTokens[1]!);
      return op ? make({ event: 'tokens', who: 'each', ...op }) : null;
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
    // Gratuitous Violence: "If a creature you control would deal damage …"
    // Gisela, Blade of Goldnight: "… that source deals double that damage to that player or permanent instead."
    const damage = /^If (a|another) (.*?)(?:source|(creature))( you control)? would deal (noncombat )?damage to (a permanent or player|an opponent or a permanent an opponent controls|the chosen player or a permanent they control|any target), (?:it|that source) deals (.+?) (?:to that (?:permanent or player|player or permanent) )?instead\.$/.exec(line);
    if (damage) {
      const creature = Boolean(damage.splice(3, 1)[0]);
      const op = quantityOp(damage[6]!);
      if (!op) return null;
      const filter: ObjectFilter = creature ? { types: ['Creature'] } : {};
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
        // Sawhorn Nemesis: "… to the chosen player or a permanent they control"
        ...(damage[5]!.startsWith('the chosen player') ? { toChosen: true as const } : {}),
      });
    }
    return null;
  },
};

/**
 * CR 615.1a: static prevention — "Prevent all combat damage that would be dealt to attacking creatures you control."
 * (Dolmen Gate), "Prevent all damage that would be dealt to you." (Glacial Chasm), "Prevent all noncombat damage that
 * would be dealt to you and other permanents you control." (The Wanderer), "… to and dealt by this creature" (Fog Bank).
 */
export const staticPreventionRule: GrammarRule = {
  id: 'static_prevention',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    if (!env || /\b(?:Instant|Sorcery)\b/.test(env.typeLine)) return null;
    // Gisela, Blade of Goldnight: "If a source would deal damage to you or a permanent you control, prevent half that
    // damage, rounded up."
    const half = /^If a source would deal damage to (you or a permanent you control|you|a permanent you control), prevent half that damage, rounded up\.$/.exec(line);
    if (half) {
      const node: StaticPreventionNode = { type: 'prevent_damage', half: 'up', ...(half[1]!.startsWith('you') ? { toYou: true as const } : {}), ...(half[1]!.includes('permanent') ? { to: { controller: 'you' } } : {}) };
      return { kind: 'static', text: original, effect: node } as StaticAbility;
    }
    const m = /^Prevent all (combat |noncombat )?damage that would be dealt (to and dealt by|to) (.+?)( during your turn)?\.$/.exec(line);
    if (!m) return null;
    const b = new Binder(env);
    const node: StaticPreventionNode = { type: 'prevent_damage' };
    if (m[1]) node.damage = m[1].trim() as 'combat' | 'noncombat';
    if (m[4]) node.condition = { type: 'your_turn', value: true };
    const self = (t: string) => t === '~' || /^this (?:creature|permanent|artifact|enchantment|land)$/.test(t);
    if (m[2] === 'to and dealt by') {
      if (!self(m[3]!)) return null;
      node.toSelf = true;
      node.bySelf = true;
    } else {
      // "you and other permanents you control", "you and creatures you control", "attacking creatures you control"
      for (const part of m[3]!.split(/,? and /)) {
        if (part === 'you') node.toYou = true;
        else if (self(part)) node.toSelf = true;
        else {
          const other = /^other /.test(part);
          const pf = node.to ? null : parseFilter(part.replace(/^other /, ''), b);
          if (!pf || !pf.plural) return null;
          node.to = { ...pf.filter, ...(other ? { other: true as const } : {}) };
        }
      }
    }
    return { kind: 'static', text: original, effect: node };
  },
};

/** CR 614.1a: "If a creature an opponent controls would die, exile it instead.", Rest in Peace. */
export const exileInsteadRule: GrammarRule = {
  id: 'exile_instead',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    if (!env) return null;
    const make = (node: Omit<ExileInsteadNode, 'type'>): StaticAbility => ({ kind: 'static', text: original, effect: { type: 'exile_instead', ...node } });
    const dies = /^If (?:a|an|another) (.+?) would die, exile it instead\.$/.exec(line) ?? /^If (?:a|an|another) (.+?) would die, instead exile it and you gain (\w+) life\.$/.exec(line);
    if (dies) {
      const pf = parseFilter(dies[1]!, new Binder(env));
      if (!pf || pf.plural) return null;
      if (/^another /.test(line.slice(3))) pf.filter.other = true;
      const life = dies[2] ? parseAmount(dies[2]) : null;
      if (dies[2] && typeof life !== 'number') return null;
      return make({ dies: true, filter: pf.filter, ...(typeof life === 'number' ? { gainLife: life } : {}) });
    }
    const gy =
      /^If a (card|card or token|nontoken creature) would be put into (your|a|an opponent's) graveyard from anywhere, exile it instead\.$/.exec(line) ??
      /^If a (card) would be put into (your|a|an opponent's) graveyard from anywhere, instead exile it with an? (\S+) counter on it\.$/.exec(line);
    if (gy) {
      const owner = gy[2] === 'your' ? 'you' : gy[2] === 'a' ? 'each' : 'opponents';
      return make({ owner, ...(gy[1] === 'nontoken creature' ? { filter: { types: ['Creature'], token: false } } : {}), ...(gy[3] ? { withCounter: gy[3] } : {}) });
    }
    return null;
  },
};

/** Static replacement effects about this object (CR 614.1a): "If ~ would be put into a graveyard from anywhere, exile it instead." */
export const selfReplacementRule: GrammarRule = {
  id: 'self_replacement',
  parse(line, original) {
    if (/^If ~ would be put into a graveyard from anywhere, reveal ~ and shuffle it into its owner's library instead\.$/.test(line)) {
      return { kind: 'static', text: original, effect: { type: 'graveyard_to_library' } } satisfies StaticAbility;
    }
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
    // True-Name Nemesis: "choose a player"; Black Vise: "choose an opponent" — "the chosen player" later.
    if (what === 'choose a player') node = { type: 'as_enters', choice: 'player' };
    if (what === 'choose an opponent') node = { type: 'as_enters', choice: 'player', opponent: true };
    // Banner of Kinship: "choose a creature type. This artifact enters with a fellowship counter on it for each creature you
    // control of the chosen type." — counted once the type is chosen, as it enters (CR 614.12, 122.6).
    const typeThenCounters = /^choose a creature type\. ~ enters with an? (\S+) counter on it for each (.+)$/.exec(what);
    if (typeThenCounters) {
      const pf = parseFilter(typeThenCounters[2]!, new Binder(env));
      if (!pf || pf.filter.zone) return null;
      node = { type: 'as_enters', choice: 'creature_type', thenCounters: { counter: typeThenCounters[1]!, filter: pf.filter } };
    }
    // Cloud Key: "choose artifact, creature, enchantment, instant, or sorcery"; "choose a card type" (CR 205.2a).
    const cardTypes = /^choose (?:a card type|((?:(?:artifact|battle|creature|enchantment|instant|land|planeswalker|sorcery|kindred), )+or (?:artifact|battle|creature|enchantment|instant|land|planeswalker|sorcery|kindred)))$/.exec(what);
    if (cardTypes) {
      node = { type: 'as_enters', choice: 'card_type' };
      if (cardTypes[1]) node.options = cardTypes[1].split(/, (?:or )?/).map((w) => w.replace(/^\w/, (c) => c.toUpperCase()));
    }
    // CR 201.3: "choose a card name", "choose a nonland card name", "choose a creature card name"
    const name = /^choose a (nonland |creature |artifact |noncreature )?card name$/.exec(what);
    if (name) {
      const kind = name[1]?.trim();
      node = { type: 'as_enters', choice: 'card_name' };
      if (kind === 'nonland') node.filter = { notTypes: ['Land'] };
      else if (kind === 'noncreature') node.filter = { notTypes: ['Creature'] };
      else if (kind) node.filter = { types: [kind === 'creature' ? 'Creature' : 'Artifact'] };
    }
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
/**
 * Animate Dead, Dance of the Dead: "When ~ enters, if it's on the battlefield, it loses "enchant creature card in a
 * graveyard" and gains "enchant creature put onto the battlefield with ~." Return enchanted creature card to the
 * battlefield under your control and attach ~ to it." (The quoted words are set aside as QUOTED_n.)
 */
export const reanimateAuraRule: GrammarRule = {
  id: 'reanimate_aura',
  parse(line, original, ctx) {
    const m = /^When ~ enters, if it's on the battlefield, it loses QUOTED_(\d+) and gains QUOTED_(\d+)\. (?:Return enchanted creature card to the battlefield|Put enchanted creature card onto the battlefield( tapped)?) under your control and attach ~ to it\.$/.exec(line);
    const quotes = (ctx as { quotes?: string[] }).quotes;
    if (!m || !quotes) return null;
    if (quotes[Number(m[1])] !== 'enchant creature card in a graveyard' || !/^enchant creature put onto the battlefield with (?:this Aura|.+)\.?$/.test(quotes[Number(m[2])] ?? '')) return null;
    return { kind: 'triggered', text: original, trigger: { type: 'enters', subject: { ref: 'self' } }, effects: [{ type: 'reanimate_attach', ...(m[3] ? { tapped: true } : {}) }] } as TriggeredAbility;
  },
};

export const entersAsCopyRule: GrammarRule = {
  id: 'enters_as_copy',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    // Vesuva: "You may have this land enter tapped as a copy of any land on the battlefield."
    // Cursed Mirror: "As this artifact enters, you may have it become a copy of any creature on the battlefield until end of
    // turn, except it has haste."
    const enter = /^You may have ~ enter( tapped)?(?: the battlefield)? as a copy of (.+?)(?:, except (.+))?\.$/.exec(line);
    const become = /^As ~ enters, you may have it become a copy of (.+?) until end of turn(?:, except (.+))?\.$/.exec(line);
    const m = enter ? { tapped: enter[1], what: enter[2], except: enter[3] } : become ? { tapped: undefined, what: become[1], except: become[2] } : null;
    if (!env || !m) return null;
    const b = new Binder(env);
    const filter = parseCopyCandidates(m.what!, b);
    const except = m.except ? parseCopyExcept(m.except, b) : undefined;
    if (!filter || except === null) return null;
    const until = become ? { copyUntil: 'eot' as const } : {};
    const node: AsEntersNode = { type: 'as_enters', choice: 'copy', filter, ...(except ? { copyExcept: except } : {}), ...(m.tapped ? { copyTapped: true } : {}), ...until };
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
  parse(line, original, ctx) {
    // CR 702.138c: "~ escapes with a +1/+1 counter on it" — if it escaped, it enters with the counter.
    const escapes = /^~ escapes with (\S+) (\S+) counters? on it\.$/.exec(line);
    if (escapes) {
      const n = parseAmount(escapes[1]!);
      if (typeof n !== 'number') return null;
      const node: StaticAbility = { kind: 'static', text: original, effect: { type: 'enters_with_counters', counter: escapes[2]!.replace(/−/g, '-'), amount: n, condition: { type: 'paid', cost: 'escape' } } };
      return node;
    }
    const m = /^(?:If (.+?), (?:~|it)|~) enters(?: the battlefield)?( tapped)? with (\S+) (\S+) counters? on it( for each time it was kicked| for each color of mana spent to cast it)?(?: if (.+?))?\.$/.exec(line);
    const tapped = Boolean(m?.[2]);
    if (m) m.splice(2, 1);
    const amount = m && parseAmount(m[2]!);
    // X is the value paid as it was cast (CR 107.3m).
    if (!m || amount === null || amount === undefined) return null;
    // CR 702.54a (bloodthirst): "If an opponent was dealt damage this turn, …"; "If ~ was kicked, …";
    // raid's "… if you attacked this turn".
    const env = envOf(ctx);
    const condText = m[1] ?? m[5];
    if (m[1] && m[5]) return null;
    const condition = condText ? (env ? parseCondition(condText, new Binder(env)) : null) : undefined;
    if (condition === null) return null;
    const node: StaticAbility = {
      kind: 'static',
      text: original,
      effect: {
        type: 'enters_with_counters',
        counter: m[3]!.replace(/−/g, '-'),
        amount,
        ...(condition ? { condition } : {}),
        // CR 702.33c (multikicker); converge
        ...(m[4] === ' for each time it was kicked' ? { perKick: true } : m[4] ? { perColor: true } : {}),
        ...(tapped ? { tapped: true } : {}),
      },
    };
    return node;
  },
};

/** "As an additional cost to cast this spell, sacrifice a creature." — CR 601.2f / CR 118.8. */
/**
 * CR 118.9 / CR 601.2b: "You may cast this card by paying [cost] rather than paying its mana cost"
 * (evoke, dash), "…from your graveyard…" (escape), "You may pay [cost] rather than pay this spell's
 * mana cost [if …]" (spectacle, and plain alternative costs), "You may pay an additional [cost] as you
 * cast this spell" (buyback), entwine.
 */
export const castOptionRule: GrammarRule = {
  id: 'cast_option',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    if (!env || !line.endsWith('.')) return null;
    const t = line.slice(0, -1);
    const b = new Binder(env);
    const make = (kind: CastOptionNode['kind'], costText: string, extra: Partial<CastOptionNode> = {}): StaticAbility | null => {
      const cost = parseCost(costText.replace(/^an? /, ''), false, b);
      if (!cost || cost.tap || cost.untap || cost.loyalty !== undefined) return null;
      return { kind: 'static', text: original, effect: { type: 'cast_option', id: 'alt', kind, cost, ...extra } as CastOptionNode };
    };
    // CR 702.81a (retrace): from the graveyard, discarding a land card as well as paying its mana cost.
    const retrace = /^You may cast ~ from your graveyard by discarding (a|an) (.+?) as an additional cost to cast it$/.exec(t);
    if (retrace) {
      const choice = choiceCost(`Discard ${retrace[1]} ${retrace[2]}`, b);
      if (!choice) return null;
      return { kind: 'static', text: original, effect: { type: 'cast_option', id: 'alt', kind: 'alternative', cost: { other: [choice] }, zone: 'graveyard', withManaCost: true } as CastOptionNode };
    }
    // Gravecrawler: "You may cast this card from your graveyard [as long as you control a Zombie]"; Rona: "… by discarding
    // two cards in addition to paying its other costs" — a permission, with the mana cost still paid (CR 601.2a).
    const fromYard = /^You may cast ~ from your graveyard(?:,? (?:as long as|if) (.+?)| by (.+?) in addition to paying its other costs)?$/.exec(t);
    if (fromYard) {
      const condition = fromYard[1] ? parseCondition(fromYard[1], b) : undefined;
      if (fromYard[1] && !condition) return null;
      let cost: Cost = {};
      if (fromYard[2]) {
        const items = fromYard[2].split(/,? and |, /).map((x) => {
          const pay = /^paying ((?:\{[^}]+\})+)$/.exec(x);
          return pay ? pay[1]! : x.replace(/^paying /, 'pay ').replace(/^discarding /, 'discard ').replace(/^sacrificing /, 'sacrifice ').replace(/^exiling /, 'exile ').replace(/^\w/, (c) => c.toUpperCase());
        });
        const parsed = parseCost(items.join(', '), false, b);
        if (!parsed || parsed.tap || parsed.untap || parsed.loyalty !== undefined || parsed.mana) return null;
        cost = parsed;
      }
      return { kind: 'static', text: original, effect: { type: 'cast_option', id: 'alt', kind: 'alternative', cost, zone: 'graveyard', withManaCost: true, ...(condition ? { condition } : {}) } as CastOptionNode };
    }
    // "As long as you discarded this card this turn, you may cast it from your graveyard by paying …" (mayhem).
    const byPaying = /^(?:As long as (.+?), )?[Yy]ou may cast (?:~|it)( transformed)?( from your graveyard| from your hand)? by paying (.+?) rather than (?:paying )?its mana cost$/.exec(t);
    if (byPaying) {
      const condition = byPaying[1] ? parseCondition(byPaying[1], b) : undefined;
      if (byPaying[1] && !condition) return null;
      return make('alternative', byPaying[4]!, { ...(byPaying[3] === ' from your graveyard' ? { zone: 'graveyard' } : {}), ...(byPaying[2] ? { transformed: true } : {}), ...(condition ? { condition } : {}) });
    }
    const ratherThan = /^(?:If (.+?), )?[Yy]ou may (?:choose to )?pay (.+?) rather than pay ~'s mana cost(?: as you cast ~)?(?: if (.+))?$/.exec(t);
    if (ratherThan) {
      const when = ratherThan[1] ?? ratherThan[3];
      const condition = when ? parseCondition(when, b) : undefined;
      if (when && !condition) return null;
      const plain = attempt(b, () => make('alternative', ratherThan[2]!, condition ? { condition } : {}));
      if (plain) return plain;
    }
    // "You may exile a blue card from your hand rather than pay this spell's mana cost", "You may pay 1 life and
    // exile a black card from your hand …", "If you control a Swamp, you may sacrifice a creature …" (CR 118.9).
    const instead = /^(?:If (.+?), )?[Yy]ou may (.+?) rather than pay ~'s mana cost$/.exec(t);
    if (instead) {
      const condition = instead[1] ? parseCondition(instead[1], b) : undefined;
      if (instead[1] && !condition) return null;
      const items = instead[2]!.split(' and ').map((x) => {
        const pay = /^pay ((?:\{[^}]+\})+)$/.exec(x);
        return pay ? pay[1]! : x.replace(/^\w/, (c) => c.toUpperCase());
      });
      const cost = parseCost(items.join(', '), false, b);
      if (!cost || cost.tap || cost.untap || cost.loyalty !== undefined) return null;
      return { kind: 'static', text: original, effect: { type: 'cast_option', id: 'alt', kind: 'alternative', cost, ...(condition ? { condition } : {}) } as CastOptionNode };
    }
    const additional = /^You may pay an additional (.+?) as you cast ~$/.exec(t);
    if (additional) return make('additional', additional[1]!);
    // Replicate, squad: "As an additional cost to cast this spell, you may pay [cost] any number of times."
    const anyTimes = /^As an additional cost to cast ~, you may pay (.+?) any number of times$/.exec(t);
    if (anyTimes) return make('additional', anyTimes[1]!, { repeatable: true });
    // CR 702.166a (bargain): "As an additional cost to cast this spell, you may sacrifice an artifact, enchantment, or token."
    const mayAdditional = /^As an additional cost to cast ~, you may (sacrifice .+|discard .+|tap .+|collect evidence \d+|blight \d+)$/.exec(t);
    if (mayAdditional) {
      const choice = choiceCost(mayAdditional[1]!.replace(/^\w/, (x) => x.toUpperCase()), b);
      if (!choice) return null;
      // "If evidence was collected, …" (CR 701.59c) names it.
      const id = choice.type === 'collect_evidence' ? 'collect_evidence' : 'alt';
      return { kind: 'static', text: original, effect: { type: 'cast_option', id, kind: 'additional', cost: { other: [choice] } } as CastOptionNode };
    }
    // CR 702.42a: "You may choose all modes of this spell instead of just the number specified. If you do, you pay an additional [cost]."
    const entwine = /^You may choose all modes of ~ instead of just the number specified\. If you do, you pay an additional (.+)$/.exec(t);
    if (entwine) return make('additional', entwine[1]!, { allModes: true });
    return null;
  },
};

/** CR 702.160a: "Prototype {1}{R} — 2/2" — an alternative cost with an inset mana cost, power and toughness (CR 718). */
export const prototypeRule: GrammarRule = {
  id: 'prototype',
  parse(line, original) {
    const m = /^Prototype ((?:\{[^}]+\})+) — (\d+|\*)\/(\d+|\*)$/.exec(line);
    if (!m) return null;
    return { kind: 'static', text: original, effect: { type: 'cast_option', id: 'prototype', kind: 'alternative', cost: { mana: m[1]! }, prototype: { power: m[2]!, toughness: m[3]! } } as CastOptionNode };
  },
};

/** CR 702.27a (buyback): "If the buyback cost was paid, put this spell into its owner's hand instead of into that player's graveyard as it resolves." */
export const resolveToHandRule: GrammarRule = {
  id: 'resolve_to_hand',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    const m = /^If (.+?), put ~ into its owner's hand instead of into that player's graveyard as it resolves\.$/.exec(line);
    if (!env || !m) return null;
    const condition = parseCondition(m[1]!, new Binder(env));
    if (!condition) return null;
    const node: StaticAbility = { kind: 'static', text: original, effect: { type: 'resolve_to_hand', condition } };
    return node;
  },
};

/**
 * CR 702.109a (dash): "If this spell's dash cost was paid, return the permanent this spell becomes to its
 * owner's hand at the beginning of the next end step" — read as a trigger on entering.
 */
export const returnIfPaidRule: GrammarRule = {
  id: 'return_if_paid',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    const m =
      /^If (.+?), (return the permanent ~ becomes to its owner's hand|sacrifice the permanent ~ becomes|exile the permanent ~ becomes) at the beginning of the next end step\.( Its owner may cast ~ after the current turn has ended for as long as it remains exiled\.)?$/.exec(line);
    if (!env || !m) return null;
    const condition = parseCondition(m[1]!, new Binder(env));
    if (!condition) return null;
    const verb = m[2]!.split(' ')[0];
    // CR 702.109a (dash), 702.152a (blitz), 702.185a (warp)
    const effect: EffectNode =
      verb === 'return'
        ? { type: 'move', what: { ref: 'self' }, to: 'hand' }
        : verb === 'sacrifice'
          ? { type: 'sacrifice', what: { ref: 'self' } }
          : { type: 'move', what: { ref: 'self' }, to: 'exile', ...(m[3] ? { warp: true } : {}) };
    if (verb === 'exile' && !m[3]) return null;
    const node: TriggeredAbility = {
      kind: 'triggered',
      text: original,
      trigger: { type: 'enters', subject: { ref: 'self' } },
      condition,
      effects: [{ type: 'delayed', step: 'end', effects: [effect] }],
    };
    return node;
  },
};

/**
 * CR 702.88a (rebound): "If this spell was cast from your hand, instead of putting it into your graveyard
 * as it resolves, exile it and, at the beginning of your next upkeep, you may cast this card from exile
 * without paying its mana cost."
 */
export const reboundRule: GrammarRule = {
  id: 'rebound',
  parse(line, original) {
    if (line !== "If ~ was cast from your hand, instead of putting it into your graveyard as it resolves, exile it and, at the beginning of your next upkeep, you may cast ~ from exile without paying its mana cost.") return null;
    const node: StaticAbility = { kind: 'static', text: original, effect: { type: 'rebound' } };
    return node;
  },
};

/**
 * CR 702.136a (riot): "You may have this permanent enter with an additional +1/+1 counter on it. If you
 * don't, it gains haste." CR 702.98a (unleash): the first sentence alone.
 */
export const enterWithCounterRule: GrammarRule = {
  id: 'enter_with_counter',
  parse(line, original) {
    const m = /^You may have ~ enter with an additional \+1\/\+1 counter on it\.( If you don't, it gains haste\.)?$/.exec(line);
    if (!m) return null;
    const node: StaticAbility = { kind: 'static', text: original, effect: { type: 'as_enters', choice: 'counter', ...(m[1] ? { elseHaste: true } : {}) } };
    return node;
  },
};

/** Strive: "This spell costs {2}{W} more to cast for each target beyond the first." (CR 601.2f) */
export const perTargetCostRule: GrammarRule = {
  id: 'per_target_cost',
  parse(line, original) {
    const m = /^~ costs ((?:\{[^}]+\})+) more to cast for each target beyond the first\.$/.exec(line);
    if (!m) return null;
    const node: StaticAbility = { kind: 'static', text: original, effect: { type: 'per_target_cost', cost: m[1]! } };
    return node;
  },
};

/** CR 731: "If it's neither day nor night, it becomes day as ~ enters." */
/**
 * CR 701.43d: "You may exert ~ as it attacks. When you do, …" — an optional cost to attack and the trigger linked
 * to it; alone, just the option ("Exerted creatures don't untap", with the rest elsewhere on the card).
 */
export const exertRule: GrammarRule = {
  id: 'exert',
  parse(line, original, ctx) {
    const m = /^You may exert ~ as it attacks\.(?: When you do, (.+))?$/s.exec(line);
    if (!m) return null;
    if (!m[1]) return { kind: 'static', text: original, effect: { type: 'exert_option' } } satisfies StaticAbility;
    const env = envOf(ctx);
    if (!env) return null;
    const r = attempt(new Binder(env), (b) => {
      b.it = { ref: 'self' };
      return parseProgram(m[1]!.replace(/^\w/, (x) => x.toUpperCase()), b);
    });
    if (!r) return null;
    return { kind: 'triggered', text: original, trigger: { type: 'exerted', subject: { ref: 'self' }, option: true }, ...r } satisfies TriggeredAbility;
  },
};

/** CR 103.6a: "If this card is in your opening hand, you may begin the game with it on the battlefield." (leylines) */
export const openingHandRule: GrammarRule = {
  id: 'opening_hand',
  parse(line, original) {
    // Gemstone Caverns: "If this card is in your opening hand and you're not the starting player, you may begin the game with
    // ~ on the battlefield with a luck counter on it. If you do, exile a card from your hand." (CR 103.6a)
    const caverns = /^If (?:~|this card) is in your opening hand and you're not the starting player, you may begin the game with (?:it|~) on the battlefield with a (\S+) counter on it\. If you do, exile a card from your hand\.$/.exec(line);
    if (caverns) return { kind: 'static', text: original, effect: { type: 'begin_on_battlefield', notStarting: true, counter: caverns[1]!, exileFromHand: 1 } } satisfies StaticAbility;
    if (!/^If (?:~|this card) is in your opening hand, you may begin the game with (?:it|~) on the battlefield\.$/.test(line)) return null;
    return { kind: 'static', text: original, effect: { type: 'begin_on_battlefield' } } satisfies StaticAbility;
  },
};

/** CR 722.3a: "This creature enters prepared." */
export const entersPreparedRule: GrammarRule = {
  id: 'enters_prepared',
  parse(line, original) {
    if (line !== '~ enters prepared.') return null;
    return { kind: 'static', text: original, effect: { type: 'enters_prepared' } } satisfies StaticAbility;
  },
};

export const entersDayRule: GrammarRule = {
  id: 'enters_day',
  parse(line, original) {
    if (line !== "If it's neither day nor night, it becomes day as ~ enters.") return null;
    const node: StaticAbility = { kind: 'static', text: original, effect: { type: 'enters_day' } };
    return node;
  },
};

/**
 * CR 605.1b / 106.12a: triggered mana abilities — "Whenever enchanted land is tapped for mana, its controller adds an
 * additional {G}" (Wild Growth), "Whenever you tap a Swamp for mana, add an additional {B}" (Crypt Ghast),
 * "Whenever a Forest is tapped for mana, its controller adds an additional {G}", "… add one mana of any type that
 * land produced" (Mirari's Wake). They resolve at once, as the mana ability does.
 */
/** Silent Arbiter: "No more than one creature can attack each combat."; Crawlspace: "No more than two creatures can attack you each combat." */
export const combatLimitRule: GrammarRule = {
  id: 'combat_limit',
  parse(line, original) {
    const m = /^No more than (one|two|three) creatures? can (attack|block)( you)? each combat\.$/.exec(line);
    if (!m || (m[3] && m[2] === 'block')) return null;
    const amount = { one: 1, two: 2, three: 3 }[m[1] as 'one' | 'two' | 'three'];
    return { kind: 'static', text: original, effect: { type: 'combat_limit', what: m[2], amount, ...(m[3] ? { you: true } : {}) } } as StaticAbility;
  },
};

/** CR 106.12b: Mana Reflection, Nyxbloom Ancient — "If you tap a permanent for mana, it produces three times as much of that mana instead." */
export const manaMultiplierRule: GrammarRule = {
  id: 'mana_multiplier',
  parse(line, original) {
    const m = /^If you tap a permanent for mana, it produces (twice|three times) as much of that mana instead\.$/.exec(line);
    return m ? ({ kind: 'static', text: original, effect: { type: 'mana_multiplier', factor: m[1] === 'twice' ? 2 : 3 } } as StaticAbility) : null;
  },
};

export const manaTriggerRule: GrammarRule = {
  id: 'mana_trigger',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    if (!env) return null;
    // High Tide: "Until end of turn, whenever a player taps an Island for mana, that player adds an additional {U}." — a
    // spell that sets up a triggered mana ability for the rest of the turn.
    const thisTurn = /^Until end of turn, (whenever .+)$/.exec(line);
    if (thisTurn) {
      const inner = this.parse(thisTurn[1]!.replace(/^w/, 'W'), thisTurn[1]!, ctx) as TriggeredAbility | null;
      return inner ? ({ kind: 'spell', text: original, effects: [{ type: 'mana_trigger_this_turn', ability: inner }] } as AbilityNode) : null;
    }
    const enchanted = /^Whenever enchanted (?:land|Forest|Plains|Island|Swamp|Mountain) is tapped for mana, its controller adds (?:an additional )?(.+)\.$/.exec(line);
    // Forsaken Monument: "Whenever you tap a permanent for {C}, add an additional {C}."
    const yours = /^Whenever you tap (?:a|an) (.+?) for (?:mana|\{([WUBRGC])\}), add (?:an additional )?(.+)\.$/.exec(line);
    const anyone =
      /^Whenever (?:a|an) (.+?) is tapped for mana, its controller adds (?:an additional )?(.+)\.$/.exec(line) ??
      /^Whenever a player taps (?:a|an) (.+?) for mana, that player adds (?:an additional )?(.+)\.$/.exec(line);
    // Caged Sun: "Whenever a land's ability causes you to add one or more mana of the chosen color, add an additional one
    // mana of that color." (CR 106.12a)
    if (/^Whenever a land's ability causes you to add one or more mana of the chosen color, add an additional one mana of that color\.$/.test(line)) {
      return { kind: 'triggered', text: original, trigger: { type: 'tapped_for_mana', subject: { ref: 'all', filter: { types: ['Land'], controller: 'you' } }, producedColor: 'chosen' }, effects: [{ type: 'add_mana', options: [['chosen']] }] } as TriggeredAbility;
    }
    // Gauntlet of Power: "Whenever a basic land is tapped for mana of the chosen color, its controller adds an additional one
    // mana of that color."
    const ofChosen = /^Whenever a (basic land|land) is tapped for mana of the chosen color, its controller adds an additional one mana of that color\.$/.exec(line);
    if (ofChosen) {
      const pf = parseFilter(ofChosen[1]!, new Binder(env));
      if (!pf) return null;
      return { kind: 'triggered', text: original, trigger: { type: 'tapped_for_mana', subject: { ref: 'all', filter: pf.filter }, its: true, producedColor: 'chosen' }, effects: [{ type: 'add_mana', options: [['chosen']] }] } as TriggeredAbility;
    }
    const m = enchanted ?? yours ?? anyone;
    if (!m) return null;
    const producedColor = yours?.[2];
    const manaText = enchanted ? enchanted[1]! : yours ? yours[3]! : m[2]!;
    let subject: Ref = { ref: 'attached' };
    if (!enchanted) {
      const pf = parseFilter(`${m[1]!}${yours ? ' you control' : ''}`, new Binder(env));
      if (!pf || pf.plural || pf.filter.zone) return null;
      subject = { ref: 'all', filter: pf.filter };
    }
    let effect: AddManaEffect | null = null;
    if (/^one mana of any type that (?:land|permanent|creature) produced$/.test(manaText)) effect = { type: 'add_mana', produced: true };
    else if (manaText === 'one mana of the chosen color') effect = { type: 'add_mana', options: [['chosen']] };
    else if (MANA_RUN.test(manaText) && !/[X\/]/.test(manaText)) effect = parseManaProduction(manaText) as AddManaEffect | null;
    // Fertile Ground: "one mana of any color"; Market Festival: "two mana in any combination of colors" (chosen as the
    // mana ability resolves, CR 605.3b).
    else if (/^(?:one mana of any color|two mana in any combination of colors)$/.test(manaText)) effect = parseManaProduction(manaText) as AddManaEffect | null;
    if (!effect) return null;
    return { kind: 'triggered', text: original, trigger: { type: 'tapped_for_mana', subject, ...(yours ? {} : { its: true }), ...(producedColor ? { producedColor } : {}) }, effects: [effect] } as TriggeredAbility;
  },
};

/**
 * CR 401.? / 601.3: "You may play lands from the top of your library" (Oracle of Mul Daya), "You may cast creature spells
 * from the top of your library" (Eladamri), "You may play lands and cast spells from the top of your library".
 */
export const topPermissionRule: GrammarRule = {
  id: 'top_permission',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    // Bolas's Citadel: "… If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost."
    const m = /^You may (?:(play lands)(?: and )?)?(?:cast (.+?))? from the top of your library\.( If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost\.)?$/.exec(line);
    if (!env || !m || (!m[1] && !m[2]) || (m[3] && !m[2])) return null;
    const effect: EffectNode = { type: 'top_permission', ...(m[1] ? { lands: true } : {}), ...(m[3] ? { lifeCost: true } : {}) };
    if (m[2]) {
      let phrase = m[2];
      // "Angel spells and Human spells", "instant and sorcery spells"
      const two = /^(\w+) spells and (\w+) spells$/.exec(phrase);
      if (two) phrase = `${two[1]} or ${two[2]} spells`;
      phrase = phrase.replace(/^(\w+) and (\w+) spells/, '$1 or $2 spells');
      if (phrase === 'spells') effect.spells = {};
      else {
        const first = phrase.split(' ')[0]!;
        const pf = parseFilter(isSubtype(first) ? phrase : phrase.replace(/^\w/, (c) => c.toLowerCase()), new Binder(env));
        if (!pf || !pf.plural || pf.filter.zone !== 'stack') return null;
        const { zone: _z, ...filter } = pf.filter;
        effect.spells = filter;
      }
    }
    return { kind: 'static', text: original, effect } as StaticAbility;
  },
};

/**
 * Training Grounds, Zirda: "Activated abilities of creatures you control cost {2} less to activate. This effect can't
 * reduce the mana in that cost to less than one mana." (CR 601.2f)
 */
export const abilityCostReductionRule: GrammarRule = {
  id: 'ability_cost_reduction',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    const zirda = /^Abilities you activate that aren't mana abilities cost \{(\d+)\} less to activate\. This effect can't reduce the mana in that cost to less than one mana\.$/.exec(line);
    if (zirda) return { kind: 'static', text: original, effect: { type: 'ability_cost_reduction', byYou: true, amount: Number(zirda[1]), minOne: true } } as StaticAbility;
    const m = /^Activated abilities of (.+?) cost \{(\d+)\} less to activate\.( This effect can't reduce the mana in that cost to less than one mana\.)?$/.exec(line);
    if (!env || !m || !m[3]) return null;
    const pf = parseFilter(m[1]!.replace(/ and /g, ' or '), new Binder(env));
    if (!pf || !pf.plural || pf.filter.zone) return null;
    return { kind: 'static', text: original, effect: { type: 'ability_cost_reduction', filter: pf.filter, amount: Number(m[2]), minOne: true } } as StaticAbility;
  },
};

/** Terror of the Peaks: "Spells your opponents cast that target this creature cost an additional 3 life to cast." */
export const targetLifeTaxRule: GrammarRule = {
  id: 'target_life_tax',
  parse(line, original) {
    const m = /^Spells your opponents cast that target (?:~|this creature|this permanent) cost an additional (\w+) life to cast\.$/.exec(line);
    const n = m ? parseAmount(m[1]!) : null;
    return typeof n === 'number' ? ({ kind: 'static', text: original, effect: { type: 'target_life_tax', life: n } } as StaticAbility) : null;
  },
};

/**
 * Underworld Breach: "Each nonland card in your graveyard has escape. The escape cost is equal to the card's mana cost
 * plus exile three other cards from your graveyard." (CR 702.138a)
 */
export const grantedEscapeRule: GrammarRule = {
  id: 'granted_escape',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    const m = /^Each (.+?) in your graveyard has escape\. The escape cost is equal to (?:the card's|its) mana cost plus exile (\w+) other cards from your graveyard\.$/.exec(line);
    if (!env || !m) return null;
    const n = parseAmount(m[2]!);
    const pf = parseFilter(`${m[1]} in your graveyard`, new Binder(env));
    if (typeof n !== 'number' || !pf || pf.plural) return null;
    const { zone: _z, owner: _o, ...filter } = pf.filter;
    return { kind: 'static', text: original, effect: { type: 'grant_escape', filter, exile: n } } as StaticAbility;
  },
};

/** Six: "During your turn, nonland permanent cards in your graveyard have retrace." (CR 702.81a) */
export const grantedRetraceRule: GrammarRule = {
  id: 'granted_retrace',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    const m = /^(During your turn, )?(?:Each )?(.+?) in your graveyard (?:has|have) retrace\.$/.exec(line);
    if (!env || !m) return null;
    const pf = parseFilter(`${m[2]} in your graveyard`, new Binder(env));
    if (!pf) return null;
    const { zone: _z, owner: _o, ...filter } = pf.filter;
    return { kind: 'static', text: original, effect: { type: 'grant_retrace', filter, ...(m[1] ? { yourTurn: true } : {}) } } as StaticAbility;
  },
};

/** Lier, Disciple of the Drowned: "Each instant and sorcery card in your graveyard has flashback. The flashback cost is equal to that card's mana cost." */
export const grantedFlashbackRule: GrammarRule = {
  id: 'granted_flashback',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    const m = /^(.+?) (?:has|have) flashback\. The flashback cost is equal to (?:its|that card's|their) mana cost\.$/.exec(line);
    if (!env || !m) return null;
    const what = parseObjectRef(m[1]!.replace(/^\w/, (c) => c.toLowerCase()), new Binder(env));
    if (!what || what.ref.ref !== 'all' || (what.ref.filter as ObjectFilter | undefined)?.zone !== 'graveyard') return null;
    return { kind: 'static', text: original, effect: { type: 'continuous', affected: what.ref, keywords: [{ id: 'flashback', costIsManaCost: true }] } } as StaticAbility;
  },
};

export const additionalCostRule: GrammarRule = {
  id: 'additional_cost',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    const m = /^As an additional cost to cast ~, (.+)\.$/.exec(line);
    if (!env || !m) return null;
    const b = new Binder(env);
    const cost = choiceCost(m[1]!.replace(/^\w/, (c) => c.toUpperCase()), b);
    if (cost) return { kind: 'static', text: original, effect: { type: 'additional_cost', cost } } as StaticAbility;
    // "sacrifice a creature or pay {3}", "sacrifice a creature, discard a card, or pay 4 life" (CR 118.8): one of them.
    const part = (s: string): Cost | null => {
      const mana = /^pay ((?:\{[^}]+\})+)$/.exec(s);
      if (mana) return MANA_RUN.test(mana[1]!) ? { mana: mana[1]! } : null;
      const c = choiceCost(s.replace(/^\w/, (x) => x.toUpperCase()), b);
      return c ? { other: [c] } : null;
    };
    const text = m[1]!;
    // Every way of cutting it at ", " / " or " / ", or " into parts that each read as a cost ("sacrifice an artifact or creature" stays whole).
    const cuts = (s: string): Cost[] | null => {
      const one = part(s);
      if (one) return [one];
      const re = /,? or |, /g;
      for (let hit = re.exec(s); hit; hit = re.exec(s)) {
        const head = part(s.slice(0, hit.index));
        if (!head) continue;
        const rest = cuts(s.slice(hit.index + hit[0].length));
        if (rest) return [head, ...rest];
      }
      return null;
    };
    if (!/ or /.test(text)) return null;
    const options = cuts(text);
    if (!options || options.length < 2) return null;
    return { kind: 'static', text: original, effect: { type: 'additional_cost_choice', options } } as StaticAbility;
  },
};

/**
 * CR 603.2d: "If an artifact or creature entering causes a triggered ability of a permanent you control to trigger, that
 * ability triggers an additional time." (Panharmonicon, Teysa Karlov, Isshin, Veyran); "If a triggered ability of a Shaman
 * or another Wizard you control triggers, that ability triggers an additional time." (Harmonic Prodigy, Roaming Throne);
 * and "Creatures entering don't cause abilities to trigger." (Torpor Orb, Hushbringer, Elesh Norn's second line).
 */
export const triggerExtraRule: GrammarRule = {
  id: 'trigger_extra',
  parse(line, original, ctx) {
    const env = envOf(ctx);
    if (!env) return null;
    const b = new Binder(env);
    const make = (node: Omit<TriggerExtraNode, 'type'>): StaticAbility => ({ kind: 'static', text: original, effect: { type: 'trigger_extra', ...node } });
    // "another Elemental you control", "a Shaman or another Wizard you control"
    const filterOf = (text: string, plural = false): ObjectFilter | null => {
      let other = false;
      const t = text
        .replace(/^another /, () => ((other = true), 'a '))
        .replace(/^(an? \w+) or another (\w+)/, (_m, a: string, w: string) => ((other = true), `${a} or ${w}`))
        .replace(/^(\w+s) and (\w+s)$/, '$1 or $2');
      const pf = parseFilter(t.replace(/^a ([aeiouAEIOU])/, 'an $1'), b);
      if (!pf || pf.plural !== plural || pf.filter.zone) return null;
      return { ...pf.filter, ...(other ? { other: true } : {}) };
    };
    type Cause = NonNullable<TriggerExtraNode['cause']>;
    const causeOf = (text: string): Cause | null => {
      if (text === 'you casting or copying an instant or sorcery spell') return { event: 'cast_copy', filter: { types: ['Instant', 'Sorcery'] } };
      if (text === 'a player drawing a card') return { event: 'draw' };
      if (text === 'you gaining life') return { event: 'gain_life' };
      const m = /^(.+?) (entering(?: or leaving)?(?: the battlefield)?|dying|attacking|dealing combat damage to a player)$/.exec(text);
      if (!m) return null;
      const filter = filterOf(m[1]!);
      if (!filter) return null;
      const event: Cause['event'] = /^entering or leaving/.test(m[2]!) ? 'enters_or_leaves' : m[2]!.startsWith('entering') ? 'enters' : m[2] === 'dying' ? 'dies' : m[2] === 'attacking' ? 'attacks' : 'combat_damage_player';
      return { event, ...(Object.keys(filter).length ? { filter } : {}) };
    };
    const caused = /^If (.+?) causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time\.$/.exec(line);
    if (caused) {
      const cause = causeOf(caused[1]!);
      return cause ? make({ cause, source: { controller: 'you' }, permanent: true }) : null;
    }
    const of = /^If a triggered ability of (.+?) triggers, (?:it|that ability) triggers an additional time\.$/.exec(line);
    if (of) {
      if (of[1] === 'equipped creature') return make({ sourceAttached: true, permanent: true });
      if (of[1] === 'a permanent you control') return make({ source: { controller: 'you' }, permanent: true });
      const source = filterOf(of[1]!);
      return source ? make({ source, permanent: true }) : null;
    }
    // Torpor Orb, Hushbringer ("entering or dying"), Elesh Norn ("… abilities of permanents your opponents control …").
    const none = /^(.+?) entering(?: the battlefield)?( or dying)? don't cause abilities( of permanents your opponents control)? to trigger\.$/.exec(line);
    if (none) {
      const filter = filterOf(none[1]!, true);
      if (!filter) return null;
      const cause: Cause = { event: none[2] ? 'enters_or_dies' : 'enters', ...(Object.keys(filter).length ? { filter } : {}) };
      return make({ cause, none: true, ...(none[3] ? { source: { controller: 'opponent' }, permanent: true } : {}) });
    }
    return null;
  },
};

export const GRAMMAR_RULES: GrammarRule[] = [
  topPermissionRule,
  manaTriggerRule,
  manaMultiplierRule,
  combatLimitRule,
  grantedFlashbackRule,
  grantedEscapeRule,
  grantedRetraceRule,
  targetLifeTaxRule,
  abilityCostReductionRule,
  chapterRule,
  entersWithCountersRule,
  entersTappedUnlessRule,
  asEntersRule,
  entersAsCopyRule,
  reanimateAuraRule,
  deckRule,
  optionalUntapRule,
  prototypeRule,
  asUnblockedRule,
  castRestrictionRule,
  spellKeywordRule,
  costModifierRule,
  quantityReplacementRule,
  triggerExtraRule,
  staticPreventionRule,
  exileInsteadRule,
  selfReplacementRule,
  castOptionRule,
  reboundRule,
  entersDayRule,
  entersPreparedRule,
  exertRule,
  openingHandRule,
  enterWithCounterRule,
  perTargetCostRule,
  resolveToHandRule,
  returnIfPaidRule,
  additionalCostRule,
  continuousRule,
  triggeredRule,
  activatedRule,
  spellRule,
];

export { splitSentences };
export type { AbilityNode };
