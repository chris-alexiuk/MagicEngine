import { dredgeOptions, drawOrDredge } from './dredge.js';
import { hasReadAhead } from './sagas.js';
import { unlockHalf } from './rooms.js';
import { phaseOut } from './phasing.js';
import { completeDungeon, currentRoom, dungeonChoices, enterDungeon, moveToRoom } from './dungeons.js';
import type { AbilityNode, AddManaEffect, Amount, AmountExpr, AsEntersNode, Color, CombatRules, ConditionNode, CopyExcept, EffectNode, FaceDef, KeywordInstance, ObjectFilter, PlayerRule, Ref, RuleFlag, TriggerNode, TriggeredAbility } from '@mtg/schema';
import { CARD_TYPE_PLURALS, CORE_NODES, readQuality, splitQualities, SUBTYPES } from '@mtg/schema';
import { queueAsEnters } from './as-enters.js';
import { landsAllowed, playerRule } from './player-rules.js';
import { extraTokens, lifeLoss, replaceQuantity } from './quantities.js';
import { bindQualityKeywords, chars, lkiStats, hasKeyword, hasRule, hasType, matchesFilter, power, toughness, objectAbilities, colorsAmong } from './characteristics.js';
import { damageBeforeExcess, dealDamage } from './combat.js';
import { evalCondition } from './conditions.js';
import { applyControlEffects } from './control.js';
import { anyColorChoices, MANA_COLORS, manaOption } from './mana.js';
import { blight, blightCandidates, foodCandidates, payDuringResolution } from './payment.js';
import { removeFromCombat, attach, createEmblem, createToken, createTokenCopy, destroy, sacrifice, sacrifice as sacrificeObject } from './permanents.js';
import { copiable, withExceptions } from './copies.js';
import { copyAbility, copySpell } from './spell-copies.js';
import { becomePrepared, unprepare } from './prepare.js';
import { dayNightCard, setDayNight } from './day-night.js';
import { ensureFaceDownDefs } from './face-down.js';
import { chooseTargets, targetPrompts } from './targets.js';
import { announceTargets } from './triggers.js';
import { installPlugin, matchTrigger, runEffect, type EffectContext, type EffectResult, type MechanicPlugin, type TriggerCheck } from './registry.js';
import { amountOf, apnap, bindFilter, movedThisWay, PERMANENT_CARD_TYPES, refEntries, refObjects, refPlayers, refRecipients } from './resolve.js';
import { nextRandom, shuffleInPlace } from './rng.js';
import { RulesError, type AttackTarget, type ChoiceAnswer, type DamageRecipient, type GameEvent, type GameObject, type GameState, type ManaColor, type ObjectId, type ObjectRef, type PlayerId, type StackEntry, type Target, type TargetRef, type TriggerInfo } from './types.js';
import { cantLose, playerLoses } from './flow.js';
import { battlefieldZcc, discardCard, drawCard, faceOf, livePlayers, manaValueOf, moveObject, nameOf, nextPlayer, setTapped, zoneList, abilitySources } from './zones.js';
import { castableCard, castDuringResolution } from './actions.js';

/**
 * Handlers for the core AST nodes (schema CORE_NODES). Each effect reads its
 * parameters from the node and its subjects through refObjects / refPlayers.
 */

const ref = (node: EffectNode, key: string) => node[key] as Ref;

function answerOf<K extends ChoiceAnswer['kind']>(ctx: EffectContext, kind: K): Extract<ChoiceAnswer, { kind: K }> | null {
  return ctx.answer?.kind === kind ? (ctx.answer as Extract<ChoiceAnswer, { kind: K }>) : null;
}

/**
 * An effect's amount for each of the players it's for: the same for all, or — when the amount names "each_player"
 * ("each opponent loses life equal to the life that player lost this turn") — counted for each one in turn.
 */
function perPlayerAmounts(ctx: EffectContext, amount: unknown, players: readonly PlayerId[], once?: number): number[] {
  if (!JSON.stringify(amount ?? null).includes('"each_player"')) {
    const n = once ?? amountOf(ctx, amount);
    return players.map(() => n);
  }
  return players.map((p) => Math.max(0, amountOf({ ...ctx, eachPlayer: p }, amount)));
}

function sourceName(ctx: EffectContext): string {
  return ctx.source ? nameOf(ctx.g, ctx.source) : 'an ability';
}

/** The last turn a "this turn" / "until the end of your next turn" permission lasts through. */
function lastTurnOf(g: GameState, player: PlayerId, until: 'eot' | 'next_turn'): number {
  if (until === 'eot') return g.turn;
  // The player's next turn: count turns in order from the next one (extra turns aside).
  let turn = g.turn + 1;
  let p = nextPlayer(g, g.active);
  for (let i = 0; i < g.order.length && p !== player; i++) {
    p = nextPlayer(g, p);
    turn++;
  }
  return turn;
}

/**
 * Opposition Agent: an opponent's permanent that controls this player while they search (`chooser`) and has what they
 * find exiled for its controller (`exiler`).
 */
function searchHijack(g: GameState, player: PlayerId): { chooser?: PlayerId; exiler?: PlayerId } {
  const out: { chooser?: PlayerId; exiler?: PlayerId } = {};
  for (const id of abilitySources(g)) {
    const src = g.objects[id];
    if (!src || src.zone !== 'battlefield' || src.controller === player) continue;
    for (const a of objectAbilities(g, src)) {
      if (a.kind !== 'static') continue;
      if (a.effect.type === 'search_control') out.chooser ??= src.controller;
      if (a.effect.type === 'search_exile') out.exiler ??= src.controller;
    }
  }
  return out;
}

/** "Until your next end step": this turn's, if it's your turn and that step is still to come; else your next turn's. */
function nextEndStepTurn(g: GameState, player: PlayerId): number {
  const before = g.active === player && g.step !== 'end' && g.step !== 'cleanup';
  return before ? g.turn : lastTurnOf(g, player, 'next_turn');
}

/** Discards a card, remembering what it was (Hellhole Rats: "equal to that card's mana value", CR 608.2h). */
function discardRecorded(ctx: EffectContext, id: string): void {
  const o = ctx.g.objects[id];
  if (o && ctx.resolution) {
    const lki = (ctx.resolution.lkiThisWay ??= {});
    lki.discarded = [...(lki.discarded ?? []), lkiStats(ctx.g, o)];
  }
  discardCard(ctx.g, id, ctx.events);
}

/** Splits "+1/+1" counters from others and fires the event. */
function addCounters(ctx: EffectContext, o: GameObject, counter: string, n: number): void {
  // CR 614.1a: "that many plus one +1/+1 counters are put on it instead", counter doublers.
  n = replaceQuantity(ctx.g, 'counters', n, { player: ctx.controller, object: o, counter });
  if (n <= 0) return;
  o.counters[counter] = (o.counters[counter] ?? 0) + n;
  ctx.events.push({ type: 'counters', object: o.id, counter, delta: n, by: ctx.controller });
}

const effects: Record<string, (node: EffectNode, ctx: EffectContext) => EffectResult> = {
  // CR 106.4: added mana goes into the player's mana pool.
  add_mana(node, ctx) {
    const effect = node as AddManaEffect;
    let mana: ManaColor[] | undefined;
    let choice = ctx.choice;
    // Bloom Tender: "For each color among permanents you control, add one mana of that color."
    if (effect.eachColor && effect.colorsAmong) {
      const colors = colorsAmong(ctx.g, ctx.controller, effect.colorsAmong, ctx.source ?? null) as ManaColor[];
      if (!colors.length) return true;
      const ps = ctx.g.players[ctx.controller]!;
      for (const c of colors) ps.pool[c]++;
      ctx.events.push({ type: 'mana_added', player: ctx.controller, mana: colors });
      return true;
    }
    // Selvala: "Add X mana in any combination of colors" — a mana ability is told the mix ("GGU"); on the stack, each mana
    // is chosen in turn.
    if (effect.combination) {
      const n = Math.max(0, amountOf(ctx, effect.combination.amount));
      if (!n) return true;
      const allowed = effect.combination.colors as ManaColor[];
      const memo = ctx.memo as { mix?: ManaColor[] };
      let mix: ManaColor[] | undefined;
      if (typeof choice === 'string') {
        mix = [...choice] as ManaColor[];
        if (mix.length !== n || !mix.every((c) => allowed.includes(c))) return false;
      } else {
        memo.mix ??= [];
        const answer = answerOf(ctx, 'choose_option');
        if (answer) {
          if (!allowed.includes(answer.choice as ManaColor)) throw new RulesError('Choose one of the colors.');
          memo.mix.push(answer.choice as ManaColor);
        }
        if (memo.mix.length < n) return { ask: { kind: 'choose_option', player: ctx.controller, options: [...allowed], text: `Choose the color of mana ${memo.mix.length + 1} of ${n}.`, sourceName: sourceName(ctx) } };
        mix = memo.mix;
      }
      const ps = ctx.g.players[ctx.controller]!;
      if (effect.spend || effect.keep) {
        for (const c of mix) (ps.restricted ??= []).push({ color: c, amount: 1, ...(effect.spend ? { spend: effect.spend } : {}), ...(effect.keep ? { keep: effect.keep } : {}) });
      } else for (const c of mix) ps.pool[c]++;
      ctx.events.push({ type: 'mana_added', player: ctx.controller, mana: [...mix] });
      return true;
    }
    // Culling Ritual: "Add {B} or {G} for each …" — the controller chooses how many of each.
    if (effect.times !== undefined && effect.options && effect.options.length === 2 && effect.options.every((o) => o.length === 1) && choice === undefined) {
      const n = Math.max(0, amountOf(ctx, effect.times));
      if (!n) return true;
      const [a, b2] = effect.options.map((o) => manaOption(o, ctx.source)?.[0]);
      if (!a || !b2) return false;
      const mixes = Array.from({ length: n + 1 }, (_, k) => [...Array<ManaColor>(n - k).fill(a), ...Array<ManaColor>(k).fill(b2)]);
      const labels = mixes.map((m) => m.map((c) => `{${c}}`).join(''));
      const answer = answerOf(ctx, 'choose_option');
      if (!answer) return { ask: { kind: 'choose_option', player: ctx.controller, options: labels, text: 'Choose which mana to add.', sourceName: sourceName(ctx) } };
      const i = labels.indexOf(answer.choice);
      if (i < 0) throw new RulesError('Choose one of the options.');
      const ps = ctx.g.players[ctx.controller]!;
      for (const c of mixes[i]!) ps.pool[c]++;
      ctx.events.push({ type: 'mana_added', player: ctx.controller, mana: mixes[i]! });
      return true;
    }
    // As a spell or a non-mana ability resolves, its controller chooses which mana (a mana ability is told up front).
    const many = effect.anyColor || (effect.options?.length ?? 0) > 1;
    if (many && choice === undefined) {
      const labels = effect.anyColor
        ? anyColorChoices(ctx.g, ctx.controller, effect.identity, effect, ctx.source)
        : effect.options!.map((opt) => opt.map((s) => `{${s === 'chosen' ? ctx.source?.chosen?.color ?? '?' : s}}`).join(''));
      if (!labels.length) return true;
      const answer = answerOf(ctx, 'choose_option');
      if (!answer) return { ask: { kind: 'choose_option', player: ctx.controller, options: labels, text: 'Choose which mana to add.', sourceName: sourceName(ctx) } };
      const i = labels.indexOf(answer.choice);
      if (i < 0) throw new RulesError('Choose one of the options.');
      choice = effect.anyColor ? (labels[i] as ManaColor) : i;
    }
    if (effect.anyColor) {
      const color = typeof choice === 'string' && (MANA_COLORS as readonly string[]).includes(choice) ? (choice as ManaColor) : undefined;
      if (!color || (color === 'C' && !effect.anyType)) return false;
      // CR 106.7: only a type those lands could produce.
      if ((effect.couldProduce || effect.colorsAmong || effect.exiledColors) && !anyColorChoices(ctx.g, ctx.controller, undefined, effect, ctx.source).includes(color)) return false;
      // CR 903.4f: only a color in the commander's color identity.
      if (effect.identity && !anyColorChoices(ctx.g, ctx.controller, true).includes(color)) return false;
      mana = Array.from({ length: effect.anyColor }, () => color);
    } else if (effect.options) {
      const index = typeof choice === 'number' ? choice : effect.options.length === 1 ? 0 : -1;
      const option = effect.options[index];
      if (!option) return false;
      mana = manaOption(option, ctx.source) ?? undefined;
    }
    if (!mana) return false;
    // "Add {G} for each Elf you control"
    if (effect.times !== undefined) {
      // Nykthos: "your devotion to that color" — the color just chosen.
      const t = effect.times;
      const times = typeof t === 'object' && t.kind === 'devotion' && t.manaColor ? { ...t, colors: mana[0] && mana[0] !== 'C' ? [mana[0] as Color] : [] } : t;
      const n = Math.max(0, amountOf(ctx, times));
      mana = Array.from({ length: n }, () => mana!).flat();
      if (!mana.length) return true;
    }
    const ps = ctx.g.players[ctx.controller]!;
    // CR 106.6: "Spend this mana only to …" — kept apart from the rest of the pool.
    const onSpent = effect.abilities?.find((a): a is TriggeredAbility => a.kind === 'triggered' && a.trigger.type === 'mana_spent');
    if (effect.spend || effect.keep || onSpent || effect.spentHaste) {
      // "a creature spell of the chosen type": remember which permanent's choice that is (and whose mana it was).
      const source = ctx.source && (onSpent || effect.spentHaste || JSON.stringify(effect.spend ?? {}).includes('"chosen')) ? { source: { id: ctx.source.id, zcc: ctx.source.zcc } } : {};
      for (const c of mana) (ps.restricted ??= []).push({ color: c, amount: 1, ...(effect.spend ? { spend: effect.spend } : {}), ...(effect.keep ? { keep: effect.keep } : {}), ...source, ...(onSpent ? { onSpent } : {}), ...(effect.spentHaste ? { haste: effect.spentHaste } : {}) });
    } else for (const c of mana) ps.pool[c]++;
    ctx.events.push({ type: 'mana_added', player: ctx.controller, mana });
    return true;
  },

  deal_damage(node, ctx) {
    // "Target creature you control deals damage equal to its power to …": that creature is the source.
    const source = node.from ? refObjects(ctx, ref(node, 'from'))[0] : ctx.source;
    if (!source) return true;
    if (node.from && source.zone !== 'battlefield') return true;
    // CR 107.1b: "X damage, where X is … minus 4" — a negative amount is no damage.
    const nAll = Math.max(0, amountOf(ctx, node.amount));
    let dealt = 0;
    if (node.divided) {
      // CR 601.2d: as divided when it was cast; a target that's no longer legal doesn't get its share.
      const index = (node.to as { index?: number }).index ?? 0;
      const original = ctx.resolution?.entry.targets[index] ?? [];
      const division = ctx.resolution?.entry.division ?? [];
      const legal = ctx.targets[index] ?? [];
      original.forEach((t, i) => {
        const still = legal.some((l) => (l.kind === 'player' ? t.kind === 'player' && l.player === t.player : t.kind === 'object' && l.kind === 'object' && l.id === t.id && l.zcc === t.zcc));
        if (!still || t.kind === 'ability') return;
        const to = t.kind === 'player' ? { kind: 'player' as const, player: t.player } : { kind: 'permanent' as const, object: t.id };
        if (t.kind === 'object' && ctx.g.objects[t.id]?.zone !== 'battlefield') return;
        dealt += dealDamage(ctx.g, source, to, division[i] ?? 0, false, ctx.events);
      });
      if (dealt > 0 && hasKeyword(ctx.g, source, 'lifelink')) gainLife(ctx, source.controller, dealt);
      return true;
    }
    // Price of Progress: "deals damage to each player equal to twice the number of nonbasic lands that player controls" —
    // counted for each of them (Ref 'each_player').
    const perPlayer = JSON.stringify(node.amount ?? null).includes('"each_player"');
    for (const to of refRecipients(ctx, ref(node, 'to'))) {
      const o = to.kind === 'permanent' ? ctx.g.objects[to.object] : undefined;
      const n = perPlayer ? Math.max(0, amountOf({ ...ctx, eachPlayer: to.kind === 'player' ? to.player : o?.controller }, node.amount)) : nAll;
      const before = o && o.zone === 'battlefield' ? damageBeforeExcess(ctx.g, source, o) : Infinity;
      // Ram Through: "If the creature you control has trample, excess damage is dealt to that creature's controller
      // instead." (CR 120.4a: the damage event is modified first)
      if (o && node.excessToController && hasKeyword(ctx.g, source, 'trample') && n > before) {
        dealt += dealDamage(ctx.g, source, to, before, false, ctx.events);
        dealt += dealDamage(ctx.g, source, { kind: 'player', player: o.controller }, n - before, false, ctx.events);
        continue;
      }
      const d = dealDamage(ctx.g, source, to, n, false, ctx.events);
      dealt += d;
      // CR 120.10: "the amount of excess damage dealt to that creature this way".
      if (ctx.resolution && d > before) ctx.resolution.excess = (ctx.resolution.excess ?? 0) + (d - before);
    }
    if (ctx.resolution) ctx.resolution.damageDealt = (ctx.resolution.damageDealt ?? 0) + dealt;
    // CR 702.15b: lifelink — the source's controller gains that much life.
    if (dealt > 0 && hasKeyword(ctx.g, source, 'lifelink')) gainLife(ctx, source.controller, dealt);
    return true;
  },

  each_deals(node, ctx) {
    // "Each creature deals 1 damage to its controller": each is the source of its own damage (CR 120.3), dealt at the
    // same time — so how much each deals is known before any is dealt.
    const plan = refObjects(ctx, ref(node, 'from'))
      .filter((o) => o.zone === 'battlefield')
      .map((o) => ({ o, n: node.stat === 'power' ? Math.max(0, power(ctx.g, o)) : amountOf(ctx, node.amount) }));
    for (const { o, n } of plan) {
      if (n <= 0) continue;
      const to: DamageRecipient[] = node.to === 'itself' ? [{ kind: 'permanent', object: o.id }] : node.to === 'controller' ? [{ kind: 'player', player: o.controller }] : refRecipients(ctx, ref(node, 'to'));
      let dealt = 0;
      for (const t of to) dealt += dealDamage(ctx.g, o, t, n, false, ctx.events);
      if (ctx.resolution) ctx.resolution.damageDealt = (ctx.resolution.damageDealt ?? 0) + dealt;
      // CR 702.15b: lifelink — the source's controller gains that much life.
      if (dealt > 0 && hasKeyword(ctx.g, o, 'lifelink')) gainLife(ctx, o.controller, dealt);
    }
    return true;
  },

  draw(node, ctx) {
    // CR 121.2: several cards are drawn one at a time; CR 702.52a: each may be replaced by a dredge.
    const memo = ctx.memo as { n?: number; players?: PlayerId[]; done?: number; before?: Record<PlayerId, number> };
    memo.players ??= refPlayers(ctx, ref(node, 'who'));
    memo.before ??= { ...(ctx.g.turnLog.drawn ?? {}) };
    // "may draw up to two cards": the player says how many first.
    if (memo.n === undefined && node.upTo) {
      const most = amountOf(ctx, node.amount);
      const p = memo.players[0];
      const said = answerOf(ctx, 'choose_option');
      if (!p || most <= 0) return true;
      if (!said) return { ask: { kind: 'choose_option', player: p, options: Array.from({ length: most + 1 }, (_, i) => String(i)), text: `Draw up to ${most} cards: how many?`, sourceName: sourceName(ctx) } };
      const n = Number(said.choice);
      if (!Number.isInteger(n) || n < 0 || n > most) throw new RulesError(`Choose a number from 0 to ${most}.`);
      memo.n = n;
      memo.players = [p];
    }
    memo.n ??= amountOf(ctx, node.amount);
    // "Each player draws cards equal to …(their)…": counted for each of them (Ref 'each_player').
    const counts = (memo as { counts?: number[] }).counts ??= perPlayerAmounts(ctx, node.amount, memo.players, memo.n);
    const total = counts.reduce((a, b) => a + b, 0);
    const whose = (k: number) => {
      let i = 0;
      while (k >= counts[i]!) k -= counts[i++]!;
      return memo.players![i]!;
    };
    let answer = answerOf(ctx, 'choose_objects');
    for (let k = memo.done ?? 0; k < total; k++) {
      const p = whose(k);
      const options = dredgeOptions(ctx.g, p);
      if (options.length && !answer) {
        memo.done = k;
        return { ask: { kind: 'choose_objects', player: p, candidates: options, min: 0, max: 1, text: 'Dredge a card instead of drawing? (Choose none to draw.)' } };
      }
      const chosen = answer?.objects[0] ?? null;
      if (chosen !== null && !options.includes(chosen)) throw new RulesError('Choose a card with dredge, or none.');
      answer = null;
      drawOrDredge(ctx.g, p, options.length ? chosen : null, ctx.events);
    }
    // "for each opponent who drew a card this way" (CR 121.2: one that couldn't didn't).
    if (ctx.resolution) {
      const drew = (ctx.resolution.drew ??= {});
      for (const p of new Set(memo.players)) {
        const n = (ctx.g.turnLog.drawn?.[p] ?? 0) - (memo.before[p] ?? 0);
        if (n > 0) drew[p] = (drew[p] ?? 0) + n;
      }
    }
    return true;
  },

  gain_life(node, ctx) {
    const players = refPlayers(ctx, ref(node, 'who'));
    const n = perPlayerAmounts(ctx, node.amount, players);
    players.forEach((p, i) => gainLife(ctx, p, n[i]!));
    return true;
  },

  // Myr Battlesphere: "you may tap X untapped Myr you control" — any number of them; X is how many.
  tap_choice(node, ctx) {
    const g = ctx.g;
    const filter = bindFilter(ctx, (node.filter ?? {}) as ObjectFilter);
    const candidates = g.zones.battlefield.filter((id) => {
      const o = g.objects[id]!;
      return o.controller === ctx.controller && !o.tapped && matchesFilter(g, o, filter, { controller: ctx.controller, source: ctx.source ?? null });
    });
    let chosen: string[] = [];
    if (candidates.length) {
      const answer = answerOf(ctx, 'choose_objects');
      if (!answer) return { ask: { kind: 'choose_objects', player: ctx.controller, candidates, min: 0, max: candidates.length, text: 'Choose any number of them to tap.' } };
      if (new Set(answer.objects).size !== answer.objects.length || !answer.objects.every((id) => candidates.includes(id))) throw new RulesError('Choose untapped permanents among those.');
      chosen = answer.objects;
    }
    for (const id of chosen) setTapped(g, id, true, ctx.events);
    if (ctx.resolution) ctx.resolution.tappedThisWay = chosen.length;
    return true;
  },

  // Etali, Primal Conqueror: "each player exiles cards from the top of their library until they exile a nonland card" —
  // "the nonland cards exiled this way" are the ones that stopped it.
  exile_until(node, ctx) {
    const g = ctx.g;
    const filter = (node.filter ?? {}) as ObjectFilter;
    const hits: ObjectRef[] = [];
    const players = refPlayers(ctx, ref(node, 'who'));
    for (const p of apnap(g).filter((x) => players.includes(x))) {
      for (const id of [...zoneList(g, 'library', p)]) {
        moveObject(g, id, 'exile', ctx.events);
        const o = g.objects[id]!;
        if (matchesFilter(g, o, filter, { controller: ctx.controller, source: ctx.source ?? null, anyZone: true })) {
          hits.push(refTo(o));
          break;
        }
      }
    }
    if (ctx.resolution) ctx.resolution.created = hits;
    return true;
  },

  // CR 119.5: "Your life total becomes 10", "… half your starting life total, rounded up" (The Endstone) — the player
  // gains or loses the necessary amount of life.
  set_life(node, ctx) {
    const players = refPlayers(ctx, ref(node, 'who'));
    const start = ctx.g.config.startingLife;
    const value = node.value === 'starting' ? start : node.value === 'half_starting_up' ? Math.ceil(start / 2) : node.value === 'half_starting_down' ? Math.floor(start / 2) : undefined;
    // Beacon of Immortality: "Double target player's life total." (CR 701.10d)
    const each = node.value === 'double' ? players.map((p) => ctx.g.players[p]!.life * 2) : value === undefined ? perPlayerAmounts(ctx, node.amount, players) : players.map(() => value);
    const out: EffectNode[] = [];
    for (const [i, p] of players.entries()) {
      const delta = each[i]! - ctx.g.players[p]!.life;
      if (delta > 0) out.push({ type: 'gain_life', amount: delta, who: { ref: 'you' }, asPlayer: p });
      else if (delta < 0) out.push({ type: 'lose_life', amount: -delta, who: { ref: 'you' }, asPlayer: p });
    }
    return out.length ? { expand: out } : true;
  },

  lose_life(node, ctx) {
    // CR 119.3: the life total is adjusted.
    const players = refPlayers(ctx, ref(node, 'who'));
    const each = perPlayerAmounts(ctx, node.amount, players);
    for (const [i, p] of players.entries()) {
      const n = each[i]!;
      const ps = ctx.g.players[p]!;
      // CR 119.8: "your life total can't change" — no life is lost.
      if (n > 0 && playerRule(ctx.g, p, 'life_cant_change')) continue;
      const lost = lifeLoss(ctx.g, p, n);
      ps.life -= lost;
      ctx.events.push({ type: 'life', player: p, delta: -lost, life: ps.life });
      if (ctx.resolution && lost > 0) ctx.resolution.lifeLost = (ctx.resolution.lifeLost ?? 0) + lost;
    }
    return true;
  },

  destroy(node, ctx) {
    for (const o of refObjects(ctx, ref(node, 'what'))) destroy(ctx.g, o, ctx.events, { noRegen: Boolean(node.noRegen) });
    return true;
  },

  move(node, ctx) {
    const to = node.to as 'hand' | 'library' | 'battlefield' | 'exile' | 'graveyard';
    // "Target creature's owner puts it on their choice of the top or bottom of their library."
    if (to === 'library' && node.position === 'choice') {
      const [o] = refObjects(ctx, ref(node, 'what'));
      if (!o || o.zone === 'stack') return true;
      const answer = answerOf(ctx, 'choose_option');
      if (!answer) return { ask: { kind: 'choose_option', player: o.owner, options: ['top', 'bottom'], text: `Put ${nameOf(ctx.g, o)} on the top or the bottom of your library?`, sourceName: sourceName(ctx) } };
      if (answer.choice !== 'top' && answer.choice !== 'bottom') throw new RulesError('Choose top or bottom.');
      moveObject(ctx.g, o.id, 'library', ctx.events, { position: answer.choice });
      return true;
    }
    // "Shuffle ~ into its owner's library" (CR 701.24a): put there, then the library is shuffled.
    if (to === 'library' && node.position === 'shuffle') {
      const owners = new Set<PlayerId>();
      for (const o of refObjects(ctx, ref(node, 'what'))) {
        if (o.zone === 'stack' && o.id !== ctx.source?.id) continue;
        moveObject(ctx.g, o.id, 'library', ctx.events);
        owners.add(o.owner);
      }
      for (const p of owners) {
        shuffleInPlace(ctx.g, zoneList(ctx.g, 'library', p));
        ctx.events.push({ type: 'shuffled', player: p });
      }
      return true;
    }
    // Endurance: "puts all the cards from their graveyard on the bottom of their library in a random order".
    if (to === 'library' && node.position === 'bottom_random') {
      const ids = refObjects(ctx, ref(node, 'what')).filter((o) => o.zone !== 'stack').map((o) => o.id);
      shuffleInPlace(ctx.g, ids);
      for (const id of ids) moveObject(ctx.g, id, 'library', ctx.events, { position: 'bottom' });
      return true;
    }
    for (const o of refObjects(ctx, ref(node, 'what'))) {
      if (to === 'library') {
        moveObject(ctx.g, o.id, 'library', ctx.events, { position: node.position === 'bottom' ? 'bottom' : typeof node.position === 'number' ? node.position : 'top' });
      } else if (to === 'battlefield') {
        // Unless it says otherwise, a permanent is put onto the battlefield under its owner's control.
        const controller = node.under === 'you' ? ctx.controller : o.owner;
        if (o.zone === 'stack' || o.zone === 'battlefield') continue;
        const counters = node.counters as Record<string, number> | undefined;
        // CR 712.14a: "transformed" — a double-faced card enters with its back face up (others don't move at all).
        const dfc = (ctx.g.cards[o.card]?.faces.length ?? 0) > 1 && ['transform', 'modal_dfc', 'meld'].includes(ctx.g.cards[o.card]!.layout);
        if (node.transformed && !dfc) continue;
        moveObject(ctx.g, o.id, 'battlefield', ctx.events, { controller, ...(counters ? { counters } : {}), ...(node.transformed ? { face: 1 } : {}), ...(node.tapped ? { tapped: true } : {}) });
      } else if (node.until === 'source_leaves') {
        // CR 610.3a: if the source has already left the battlefield, the object doesn't move at all.
        const src = ctx.source;
        if (!src || src.zone !== 'battlefield' || (ctx.sourceZcc !== undefined && src.zcc !== ctx.sourceZcc)) continue;
        if (o.zone !== 'battlefield') continue;
        moveObject(ctx.g, o.id, 'exile', ctx.events);
        (ctx.g.exiledUntil ??= []).push({ source: { id: src.id, zcc: src.zcc }, object: { id: o.id, zcc: o.zcc } });
      } else {
        // CR 701.13a: exile moves it to the exile zone from wherever it is. A spell on the stack moves only when it's
        // the source or what the effect targets ("Return target spell to its owner's hand", Venser, Narset's Reversal).
        if (o.zone === 'stack' && o.id !== ctx.source?.id && (node.what as Ref | undefined)?.ref !== 'target') continue;
        moveObject(ctx.g, o.id, to, ctx.events);
        // CR 702.185a: "Its owner may cast this card after the current turn has ended for as long as it remains exiled."
        if (node.warp && o.zone === 'exile') (ctx.g.mayPlay ??= []).push({ object: { id: o.id, zcc: o.zcc }, player: o.owner, mode: 'cast', firstTurn: ctx.g.turn + 1, lastTurn: Number.MAX_SAFE_INTEGER });
        // CR 607.2a: remember what exiled it, for the source's linked "the exiled card" ability.
        const src = ctx.source;
        if (to === 'exile' && src && src.id !== o.id) o.exiledBy = { id: src.id, zcc: battlefieldZcc(ctx.g, src) };
      }
    }
    return true;
  },

  counter(node, ctx) {
    // An ability ("counter target activated ability", ward's "counter that spell or ability"): it's removed
    // from the stack (CR 701.6a).
    for (const entry of refEntries(ctx, ref(node, 'what'))) {
      if (entry.kind !== 'ability') continue;
      // Spider-Punk: "Spells and abilities can't be countered."
      if (abilitiesUncounterable(ctx.g)) continue;
      ctx.g.stack = ctx.g.stack.filter((e) => !(e.kind === 'ability' && e.id === entry.id));
      ctx.events.push({ type: 'countered', object: entry.id });
    }
    for (const o of refObjects(ctx, ref(node, 'what'))) {
      if (o.zone !== 'stack') continue;
      // CR 101.2 / "can't be countered": the spell stays on the stack — its own ability, or "Creature spells you
      // control can't be countered" (Rhythm of the Wild).
      if (hasRule(ctx.g, o, 'cant_be_countered') || uncounterable(ctx.g, o)) continue;
      // CR 701.6a: it's removed from the stack and put into its owner's graveyard — or exiled, if the counterspell says so;
      // Memory Lapse, Remand, Spell Crumple: on top of / into / on the bottom of its owner's library or hand.
      const to = node.to as 'library_top' | 'library_bottom' | 'hand' | undefined;
      if (to === 'hand') moveObject(ctx.g, o.id, 'hand', ctx.events);
      else if (to) moveObject(ctx.g, o.id, 'library', ctx.events, { position: to === 'library_top' ? 'top' : 'bottom' });
      else moveObject(ctx.g, o.id, node.exile ? 'exile' : 'graveyard', ctx.events);
      ctx.events.push({ type: 'countered', object: o.id, by: ctx.controller });
    }
    return true;
  },

  tap(node, ctx) {
    // CR 701.26a
    for (const o of refObjects(ctx, ref(node, 'what'))) if (o.zone === 'battlefield') setTapped(ctx.g, o.id, true, ctx.events);
    return true;
  },

  untap(node, ctx) {
    // CR 701.26b
    for (const o of refObjects(ctx, ref(node, 'what'))) if (o.zone === 'battlefield') setTapped(ctx.g, o.id, false, ctx.events);
    return true;
  },

  // CR 702.167a (craft): "Return this card to the battlefield transformed under its owner's control." — the card the
  // cost exiled (it's a new object there, CR 400.7).
  craft_return(_node, ctx) {
    const entry = ctx.resolution?.entry;
    const r = entry?.kind === 'ability' ? entry.source : undefined;
    const o = r ? ctx.g.objects[r.id] : undefined;
    const def = o ? ctx.g.cards[o.card] : undefined;
    if (!o || o.zone !== 'exile' || o.zcc !== r!.zcc + 1 || def?.layout !== 'transform' || def.faces.length !== 2) return true;
    moveObject(ctx.g, o.id, 'battlefield', ctx.events, { controller: o.owner, face: 1 });
    return true;
  },

  // CR 701.38a: "Starting with you, each player votes for sickness or psychosis." — in turn order from you;
  // CR 701.38b: or for objects ("votes for a nonland permanent you don't control"). Secret council: each
  // player votes without seeing the others' votes, then they're revealed.
  vote(node, ctx) {
    const g = ctx.g;
    const NO_VOTE = "Don't vote";
    const memo = ctx.memo as { ballots?: { player: PlayerId; optional: boolean }[]; next?: number; candidates?: ObjectId[]; hidden?: GameEvent[] };
    const among = node.among as ObjectFilter | undefined;
    const options = (node.options as string[] | undefined) ?? [];
    if (!memo.ballots) {
      const live = livePlayers(g);
      memo.ballots = [];
      for (let p: PlayerId | undefined = ctx.controller, i = 0; p && i < g.order.length; p = nextPlayer(g, p), i++) {
        if (!live.includes(p)) continue;
        // CR 701.38d: a player's additional votes happen when that player would otherwise vote.
        memo.ballots.push({ player: p, optional: false });
        for (let n = playerRule(g, p, 'extra_vote'); n > 0; n--) memo.ballots.push({ player: p, optional: false });
        for (let n = playerRule(g, p, 'may_extra_vote'); n > 0; n--) memo.ballots.push({ player: p, optional: true });
      }
      memo.next = 0;
      memo.hidden = [];
      if (among) {
        memo.candidates = refObjects(ctx, { ref: 'all', filter: among }).map((o) => o.id);
        if (!memo.candidates.length) memo.ballots = [];
      }
      if (ctx.resolution) {
        ctx.resolution.votes = Object.fromEntries(options.map((o) => [o, 0]));
        ctx.resolution.voted = [];
      }
    }
    const ballot = memo.ballots[memo.next!];
    const tally = (choice: string) => {
      if (ctx.resolution) ctx.resolution.votes![choice] = (ctx.resolution.votes![choice] ?? 0) + 1;
      const event: GameEvent = { type: 'voted', player: ballot!.player, choice: among ? nameOf(g, g.objects[choice]!) : choice, ...(among ? { object: choice } : {}) };
      (node.secret ? memo.hidden! : ctx.events).push(event);
    };
    if (ballot && among) {
      const answer = answerOf(ctx, 'choose_objects');
      if (answer) {
        const picked = answer.objects;
        if (picked.length > 1 || (!picked.length && !ballot.optional) || picked.some((id) => !memo.candidates!.includes(id))) throw new RulesError('Vote for one of them.');
        if (picked.length) tally(picked[0]!);
        memo.next!++;
      }
    } else if (ballot) {
      const answer = answerOf(ctx, 'choose_option');
      if (answer) {
        if (!options.includes(answer.choice) && !(ballot.optional && answer.choice === NO_VOTE)) throw new RulesError('Vote for one of the options.');
        if (answer.choice !== NO_VOTE) tally(answer.choice);
        memo.next!++;
      }
    }
    const now = memo.ballots[memo.next!];
    if (now) {
      const extra = memo.next! > 0 && memo.ballots[memo.next! - 1]!.player === now.player ? ' (an additional vote)' : '';
      if (among) {
        return { ask: { kind: 'choose_objects', player: now.player, candidates: memo.candidates!, min: now.optional ? 0 : 1, max: 1, text: `Vote for one${extra}.` } };
      }
      return { ask: { kind: 'choose_option', player: now.player, options: now.optional ? [...options, NO_VOTE] : options, text: `Vote for ${options.join(' or ')}${extra}.`, sourceName: sourceName(ctx) } };
    }
    ctx.events.push(...memo.hidden!);
    memo.hidden = [];
    if (among && ctx.resolution) {
      const counts = ctx.resolution.votes!;
      const most = Math.max(0, ...Object.values(counts));
      ctx.resolution.voted = most > 0 ? Object.keys(counts).filter((id) => counts[id] === most && g.objects[id]).map((id) => ({ id, zcc: g.objects[id]!.zcc })) : [];
    }
    return true;
  },

  // "Create a Food token or a Treasure token." — the controller picks one as it resolves.
  choose_one(node, ctx) {
    const labels = node.labels as string[];
    const options = node.options as EffectNode[][];
    const answer = answerOf(ctx, 'choose_option');
    if (!answer) return { ask: { kind: 'choose_option', player: ctx.controller, options: labels, text: `Choose: ${labels.join(' or ')}.`, sourceName: sourceName(ctx) } };
    const i = labels.indexOf(answer.choice);
    if (i < 0) throw new RulesError('Choose one of the options.');
    return { expand: options[i]! };
  },

  // "you gain protection from everything until your next turn" (The One Ring), "your life total can't change" (CR 119.8).
  player_effect(node, ctx) {
    const g = ctx.g;
    const lastTurn = node.until === 'your_next_turn' ? lastTurnOf(g, ctx.controller, 'next_turn') - 1 : node.until === 'game' ? Number.MAX_SAFE_INTEGER : g.turn;
    const players = refPlayers(ctx, ref(node, 'who'));
    const filter = node.filter ? { filter: node.filter as ObjectFilter } : {};
    g.playerEffects = [...(g.playerEffects ?? []).filter((e) => e.lastTurn >= g.turn), ...players.map((player) => ({ player, rule: node.rule as PlayerRule, lastTurn, ...filter }))];
    return true;
  },

  // CR 101.2: "Target player can't cast spells this turn", "Until your next turn, your opponents can't cast
  // noncreature spells" — the players are fixed as it resolves (CR 611.2c).
  prohibit_casting(node, ctx) {
    const g = ctx.g;
    const players = refPlayers(ctx, ref(node, 'who'));
    if (!players.length) return true;
    const lastTurn = node.until === 'your_next_turn' ? lastTurnOf(g, ctx.controller, 'next_turn') - 1 : g.turn;
    g.castBans = [
      ...(g.castBans ?? []).filter((b) => b.lastTurn >= g.turn),
      { players, controller: ctx.controller, lastTurn, ...(node.filter ? { filter: node.filter as ObjectFilter } : {}), ...(node.fromZones ? { fromZones: node.fromZones as string[] } : {}) },
    ];
    return true;
  },

  // "For each time vote, take an extra turn after this one." — the effects, that many times.
  repeat(node, ctx) {
    const n = Math.max(0, amountOf(ctx, node.times));
    const effects = node.effects as EffectNode[];
    return n ? { expand: Array.from({ length: n }, () => effects).flat() } : true;
  },

  // CR 706: "Roll a d20." — with a results table (CR 706.3a), or for "equal to the result" afterward (CR 706.4).
  // "Roll two d20 and ignore the lower roll" (CR 706.6: the ignored roll never happened).
  roll_die(node, ctx) {
    const g = ctx.g;
    const memo = ctx.memo as { result?: number };
    if (memo.result === undefined) {
      const sides = Number(node.sides);
      const rolls = Array.from({ length: Number(node.count ?? 1) }, () => 1 + Math.floor(nextRandom(g) * sides));
      const kept = node.ignoreLower ? [Math.max(...rolls)] : rolls;
      for (const r of kept) ctx.events.push({ type: 'die_rolled', player: ctx.controller, sides, result: r });
      memo.result = kept.reduce((a, b) => a + b, 0);
      if (ctx.resolution) ctx.resolution.dieResult = memo.result;
    }
    const result = memo.result;
    const row = ((node.table ?? []) as { min: number; max: number; effects: EffectNode[] }[]).find((r) => result >= r.min && result <= r.max);
    return row ? { expand: row.effects } : true;
  },

  // CR 615.12: "Damage can't be prevented this turn."
  damage_unpreventable(_node, ctx) {
    ctx.g.unpreventableTurn = ctx.g.turn;
    return true;
  },

  // "Untap up to two lands." — chosen as it resolves (no targets).
  untap_chosen(node, ctx) {
    const g = ctx.g;
    const n = amountOf(ctx, node.amount ?? 1);
    const candidates = g.zones.battlefield.filter((id) => g.objects[id]!.tapped && matchesFilter(g, g.objects[id]!, node.filter as ObjectFilter, { controller: ctx.controller, source: ctx.source ?? null }));
    if (!candidates.length || n <= 0) return true;
    const answer = answerOf(ctx, 'choose_objects');
    if (!answer) return { ask: { kind: 'choose_objects', player: ctx.controller, candidates, min: 0, max: Math.min(n, candidates.length), text: `Untap up to ${n}.` } };
    if (answer.objects.length > n || new Set(answer.objects).size !== answer.objects.length || !answer.objects.every((id) => candidates.includes(id))) throw new RulesError(`Choose up to ${n} to untap.`);
    for (const id of answer.objects) setTapped(g, id, false, ctx.events);
    return true;
  },

  add_counters(node, ctx) {
    // CR 122.6: counters are put on permanents (CR 122.1a for +1/+1 counters).
    if (node.divided) {
      // CR 601.2d: "Distribute three +1/+1 counters among one, two, or three target creatures" — as divided
      // when it was put on the stack; a target that's no longer legal doesn't get its share.
      const index = (node.what as { index?: number }).index ?? 0;
      const original = ctx.resolution?.entry.targets[index] ?? [];
      const division = ctx.resolution?.entry.division ?? [];
      const legal = ctx.targets[index] ?? [];
      original.forEach((t, i) => {
        if (t.kind !== 'object' || !legal.some((l) => l.kind === 'object' && l.id === t.id && l.zcc === t.zcc)) return;
        const o = ctx.g.objects[t.id];
        if (o?.zone === 'battlefield') addCounters(ctx, o, String(node.counter), division[i] ?? 0);
      });
      return true;
    }
    const n = amountOf(ctx, node.amount);
    // "Put a +1/+1 counter on a creature you control": one chosen as it resolves (none if there's none).
    if (node.choose) {
      const g = ctx.g;
      const candidates = g.zones.battlefield.filter((id) => matchesFilter(g, g.objects[id]!, node.choose as ObjectFilter, { controller: ctx.controller, source: ctx.source ?? null }));
      if (!candidates.length) return true;
      const answer = answerOf(ctx, 'choose_objects');
      if (!answer) return { ask: { kind: 'choose_objects', player: ctx.controller, candidates, min: 1, max: 1, text: `Choose one to put ${n === 1 ? 'a counter' : `${n} counters`} on.`, sourceName: sourceName(ctx) } };
      if (answer.objects.length !== 1 || !candidates.includes(answer.objects[0]!)) throw new RulesError('Choose one of them.');
      const chosen = g.objects[answer.objects[0]!]!;
      addCounters(ctx, chosen, String(node.counter), n);
      if (ctx.resolution) ctx.resolution.chosenObject = { id: chosen.id, zcc: chosen.zcc };
      return true;
    }
    for (const o of refObjects(ctx, ref(node, 'what'))) if (o.zone === 'battlefield') addCounters(ctx, o, String(node.counter), n);
    return true;
  },

  modify(node, ctx) {
    // CR 611.2c: the affected set is determined now and doesn't change later.
    // "… card in your graveyard gains flashback until end of turn" works on cards in graveyards.
    const flashback = Array.isArray(node.keywords) && (node.keywords as KeywordInstance[]).every((k) => k.id === 'flashback');
    // "Target spell or permanent becomes white" (Purelace): a spell's color, while it's on the stack.
    const spellColor = Array.isArray(node.colors) && node.power === undefined && node.types === undefined && node.keywords === undefined;
    // Rivaz of the Claw: "Whenever you cast a Dragon creature spell …, it gains …" — a spell, and the permanent it becomes
    // (CR 400.7a).
    const permanentSpell = (o: GameObject) => o.zone === 'stack' && PERMANENT_CARD_TYPES.some((t) => chars(ctx.g, o).types.includes(t));
    const objects = refObjects(ctx, ref(node, 'what')).filter((o) => o.zone === 'battlefield' || (flashback && o.zone === 'graveyard') || (spellColor && o.zone === 'stack') || permanentSpell(o));
    if (!objects.length) return true;
    const g = ctx.g;
    const chosen = ctx.resolution?.chosen ?? {};
    // CR 702.16a: "gains protection from the color of your choice" — chosen now; "from the chosen color" — as chosen
    // before (by this spell, or as its source entered: Floating Shield remembers it as it's sacrificed).
    let keywords = Array.isArray(node.keywords) ? (node.keywords as KeywordInstance[]) : undefined;
    if (keywords?.some((k) => (k.id === 'protection' || k.id === 'hexproof_from') && k.text)) {
      const src = ctx.source;
      const lk = src && !src.chosen ? g.lastKnown?.[src.id] : undefined;
      const before = src?.chosen ?? (lk && lk.zcc + 1 === src!.zcc ? lk.chosen : undefined);
      let color: Color | 'colorless' | undefined = chosen.color ?? before?.color;
      const choice = keywords.flatMap((k) => ((k.id === 'protection' || k.id === 'hexproof_from') && k.text ? splitQualities(k.text).map(readQuality) : [])).find((r) => r?.kind === 'choice');
      if (choice?.kind === 'choice') {
        const chooser = choice.chooser === 'its_controller' ? objects[0]!.controller : ctx.controller;
        const options = [...(choice.colorless ? ['colorless'] : []), 'W', 'U', 'B', 'R', 'G'];
        const answer = answerOf(ctx, 'choose_option');
        if (!answer) return { ask: { kind: 'choose_option', player: chooser, options, text: 'Choose a color (protection).', sourceName: sourceName(ctx) } };
        if (!options.includes(answer.choice)) throw new RulesError('Choose one of the options.');
        color = answer.choice as Color | 'colorless';
      }
      // Pippin: "protection from the card type of your choice".
      let cardType: string | undefined;
      if (keywords.some((k) => k.id === 'protection' && k.text && splitQualities(k.text).some((q) => readQuality(q)?.kind === 'type_choice'))) {
        const answer = answerOf(ctx, 'choose_option');
        if (!answer) return { ask: { kind: 'choose_option', player: ctx.controller, options: [...CARD_TYPE_PLURALS], text: 'Choose a card type (protection).', sourceName: sourceName(ctx) } };
        if (!CARD_TYPE_PLURALS.includes(answer.choice)) throw new RulesError('Choose one of the options.');
        cardType = answer.choice;
      }
      const creatureType = chosen.creatureType ?? before?.creatureType;
      keywords = bindQualityKeywords(keywords, { you: ctx.controller, ...(src ? { grantedBy: src.id } : {}), ...(color ? { color } : {}), ...(creatureType ? { creatureType } : {}), ...(cardType ? { cardType } : {}) });
    }
    // CR 701.10a / 701.10c: "double its power and toughness" — it gets +X/+Y, where X and Y are its power and toughness now.
    if (node.double) {
      for (const o of objects) {
        const p = power(g, o);
        const t = node.double === 'both' ? toughness(g, o) : 0;
        g.effects.push({
          id: `e${g.nextId++}`, timestamp: ++g.clock,
          source: ctx.source ? { id: ctx.source.id, zcc: ctx.source.zcc } : { id: '', zcc: 0 },
          controller: ctx.controller, objects: [{ id: o.id, zcc: o.zcc }], power: p, toughness: t,
          until: node.until === 'game' ? 'game' : 'eot',
        });
      }
      return true;
    }
    g.effects.push({
      id: `e${g.nextId++}`,
      timestamp: ++g.clock,
      source: ctx.source ? { id: ctx.source.id, zcc: ctx.source.zcc } : { id: '', zcc: 0 },
      controller: ctx.controller,
      objects: objects.map((o) => ({ id: o.id, zcc: o.zcc })),
      // CR 608.2h: a counted amount ("+1/+1 for each creature you control") is counted once, now.
      ...(node.power !== undefined ? { power: amountOf(ctx, node.power), toughness: amountOf(ctx, node.toughness ?? 0) } : {}),
      ...(keywords ? { keywords } : {}),
      ...(Array.isArray(node.loseKeywords) ? { loseKeywords: node.loseKeywords as string[] } : {}),
      ...(Array.isArray(node.cantHave) ? { cantHave: node.cantHave as string[] } : {}),
      ...(Array.isArray(node.rules) ? { rules: node.rules as RuleFlag[] } : {}),
      ...(node.combat ? { combat: node.combat as CombatRules } : {}),
      // "becomes a 3/3 green Elemental creature" (layers 4, 5 and 7b).
      ...(Array.isArray(node.types) ? { types: node.types as string[], subtypes: (node.subtypes as string[]) ?? [], retainTypes: Boolean(node.retainTypes) } : {}),
      // Mirror Entity: "… and gain all creature types" (layer 4).
      ...(node.allCreatureTypes ? { types: [], subtypes: [...SUBTYPES.creature], retainTypes: true } : {}),
      // "the color of your choice", "the creature type of your choice" — chosen earlier as this resolved.
      ...(Array.isArray(node.colors) ? { colors: (node.colors as string[]).flatMap((c) => (c === 'chosen' ? (chosen.color ? [chosen.color] : []) : [c as Color])) } : {}),
      ...(Array.isArray(node.creatureTypes) ? { creatureTypes: (node.creatureTypes as string[]).flatMap((t) => (t === 'chosen' ? (chosen.creatureType ? [chosen.creatureType] : []) : [t])) } : {}),
      ...(Array.isArray(node.landTypes) ? { landTypes: (node.landTypes as string[]).flatMap((t) => (t === 'chosen' ? (chosen.landType ? [chosen.landType] : []) : [t])) } : {}),
      ...(node.loseAbilities ? { loseAbilities: true as const } : {}),
      ...(node.setPower !== undefined ? { setPower: amountOf(ctx, node.setPower), setToughness: amountOf(ctx, node.setToughness ?? 0) } : {}),
      ...(node.switchPT ? { switchPT: true as const } : {}),
      // CR 611.2a: lasts as long as stated — "until end of turn" ends in the cleanup step (CR 514.2); otherwise indefinitely.
      until: node.until === 'game' || node.until === 'source_tapped' || node.until === 'your_next_turn' ? 'game' : 'eot',
      ...(node.until === 'source_tapped' && ctx.source ? { whileTapped: { id: ctx.source.id, zcc: ctx.source.zcc } } : {}),
      ...(node.until === 'your_next_turn' ? { untilTurnOf: ctx.controller } : {}),
    });
    return true;
  },

  // "It doesn't untap during its controller's untap step for as long as ~ remains tapped."
  lock_untap(node, ctx) {
    if (!ctx.source) return true;
    const kind = node.while === 'controlled' || node.while === 'present' ? node.while : undefined;
    for (const o of refObjects(ctx, ref(node, 'what'))) {
      if (o.zone === 'battlefield') (o.untapLocks ??= []).push({ id: ctx.source.id, zcc: ctx.source.zcc, ...(kind ? { while: kind, controller: ctx.controller } : {}) });
    }
    return true;
  },

  create_token(node, ctx) {
    const n = amountOf(ctx, node.amount);
    // CR 107.3: "an X/X … token" — X is worked out as the effect resolves, and the token is made that size.
    const sized = node.size !== undefined ? Math.max(0, amountOf(ctx, node.size)) : null;
    const face = sized !== null && node.token ? { ...(node.token as FaceDef), power: String(sized), toughness: String(sized) } : (node.token as FaceDef | undefined);
    // Adeline: "for each opponent, create a 1/1 white Human creature token that's tapped and attacking that player or a
    // planeswalker they control" (CR 508.4) — for each opponent in turn, attacking them or one of their planeswalkers.
    if (node.attackingEach && face) {
      const g = ctx.g;
      const memo = ctx.memo as { i?: number; created?: ObjectRef[] };
      const opponents = livePlayers(g).filter((p) => p !== ctx.controller);
      memo.created ??= [];
      let answer = answerOf(ctx, 'choose_option');
      for (let i = memo.i ?? 0; i < opponents.length; i++) {
        const q = opponents[i]!;
        let at: AttackTarget = { kind: 'player', player: q };
        const walkers = node.orPlaneswalker && g.combat?.attackersDeclared ? g.zones.battlefield.filter((id) => g.objects[id]!.controller === q && hasType(g, g.objects[id]!, 'Planeswalker')) : [];
        if (walkers.length) {
          const options = [g.players[q]!.name ?? q, ...walkers.map((id) => `${nameOf(g, g.objects[id]!)} (${id})`)];
          if (!answer) {
            memo.i = i;
            return { ask: { kind: 'choose_option', player: ctx.controller, options, text: `The token attacks ${g.players[q]!.name ?? q} or one of their planeswalkers:`, sourceName: sourceName(ctx) } };
          }
          const k = options.indexOf(answer.choice);
          if (k < 0) throw new RulesError('Choose that player or one of their planeswalkers.');
          answer = null;
          if (k > 0) at = { kind: 'planeswalker', object: walkers[k - 1]! };
        }
        const count = replaceQuantity(g, 'tokens', n, { player: ctx.controller, made: { types: face.types, subtypes: face.subtypes } });
        for (let j = 0; j < count; j++) {
          const t = createToken(g, face, ctx.controller, ctx.events, { tapped: true });
          enterAttacking(g, t, ctx.source, at);
          memo.created.push({ id: t.id, zcc: t.zcc });
        }
        memo.i = i + 1;
      }
      if (ctx.resolution) ctx.resolution.created = memo.created;
      return true;
    }
    // Curse of the Swine: "For each creature exiled this way, its controller creates a 2/2 green Boar creature token."
    const perMoved = node.forEachMoved ? movedThisWay(ctx, node.forEachMoved as { how: string; types?: string[] }).map((m) => m.controller) : null;
    const players = perMoved ?? (node.who ? refPlayers(ctx, ref(node, 'who')) : [ctx.controller]);
    const attachTo = node.attachTo ? refObjects(ctx, ref(node, 'attachTo'))[0] : undefined;
    if (node.attachTo && !attachTo) return true; // nothing to attach it to: it isn't created
    // CR 707.2: "a token that's a copy of …" — of the object's copiable values, with this effect's exceptions.
    // "this card" still means the card after a cost moved it (embalm exiles it from the graveyard).
    // Second Harvest: "For each token you control, create a token that's a copy of that permanent." — one of each.
    const originals = node.copyOf ? (ref(node, 'copyOf').ref === 'self' ? (ctx.source ? [ctx.source] : []) : refObjects(ctx, ref(node, 'copyOf'))) : [undefined];
    // Saw in Half: "except their base power is half that creature's power …, rounded up" — as it last existed (CR 608.2h).
    let except = node.except as CopyExcept | undefined;
    if (except?.halfStats && node.copyOf) {
      const of = ref(node, 'copyOf');
      const half = (stat: 'power' | 'toughness') => Math.max(0, amountOf(ctx, { kind: 'stat', stat, of, half: 'up' } as AmountExpr));
      const { halfStats: _h, ...rest } = except;
      except = { ...rest, power: half('power'), toughness: half('toughness') };
    }
    const copies = (node.copyEach ? originals : originals.slice(0, 1)).map((original) => (original ? withExceptions(ctx.g, copiable(original), except) : undefined));
    if (!copies.length) return true;
    const created: ObjectRef[] = [];
    for (const copy of copies) for (const p of players) {
      // CR 614.1a: token doublers ("twice that many of those tokens are created instead").
      const copiedFace = copy ? ctx.g.cards[copy.card]?.faces[copy.face] : undefined;
      const madeFace = copiedFace ?? face;
      const count = replaceQuantity(ctx.g, 'tokens', n, { player: p, ...(madeFace ? { made: { types: madeFace.types, subtypes: madeFace.subtypes } } : {}) });
      // Academy Manufactor: "If you would create a Clue, Food, or Treasure token, instead create one of each."
      const each = copy ? null : oneOfEach(ctx.g, face!, p);
      const kinds = each ? each.faces.flatMap((f) => Array.from({ length: count * each.times }, () => f)) : Array.from({ length: count }, () => face);
      for (const kind of kinds) {
        const opts = { tapped: Boolean(node.tapped) };
        const t = copy ? createTokenCopy(ctx.g, copy, p, ctx.events, opts) : createToken(ctx.g, kind!, p, ctx.events, opts);
        if (attachTo) attach(ctx.g, t, attachTo, ctx.events);
        // Soaring Lightbringer: "… tapped and attacking that player" (CR 508.4).
        const at = node.attackingPlayer ? refPlayers(ctx, node.attackingPlayer as Ref)[0] : undefined;
        if (node.attacking) enterAttacking(ctx.g, t, ctx.source, at ? { kind: 'player', player: at } : undefined);
        created.push({ id: t.id, zcc: t.zcc });
      }
      // Peregrin Took, Xorn: "those tokens plus an additional Food token" (CR 614.1a; doubled too, CR 616.1).
      const copied = copy ? ctx.g.cards[copy.card]?.faces[copy.face] : undefined;
      const made = { types: (copied ?? face)?.types ?? [], subtypes: (copied ?? face)?.subtypes ?? [] };
      for (const x of extraTokens(ctx.g, p, made, count)) {
        const more = replaceQuantity(ctx.g, 'tokens', x.count, { player: p, made: { types: x.token.types, subtypes: x.token.subtypes } });
        for (let i = 0; i < more; i++) createToken(ctx.g, x.token, p, ctx.events, {});
      }
    }
    if (ctx.resolution) ctx.resolution.created = created;
    return true;
  },

  scry(node, ctx) {
    // Kozilek's Command: "Target player scries X" — done by that player.
    if (node.who) {
      const [p] = refPlayers(ctx, ref(node, 'who'));
      if (p === undefined) return true;
      return { expand: [{ type: 'scry', amount: amountOf(ctx, node.amount), asPlayer: p }] };
    }
    // CR 701.22a: look at the top N, put any number on the bottom and the rest on top, in any order.
    return lookAtTop(ctx, amountOf(ctx, node.amount), 'scry');
  },

  surveil(node, ctx) {
    // CR 701.25a: like scry, but into the graveyard.
    return lookAtTop(ctx, amountOf(ctx, node.amount), 'surveil');
  },

  mill(node, ctx) {
    // CR 701.17a: the top N cards go into the graveyard.
    const players = refPlayers(ctx, ref(node, 'who'));
    const each = perPlayerAmounts(ctx, node.amount, players);
    for (const [i, p] of players.entries()) {
      // The Water Crystal: "they mill that many cards plus four instead" (CR 614.1a).
      const k = replaceQuantity(ctx.g, 'mill', each[i]!, { player: p });
      for (const id of zoneList(ctx.g, 'library', p).slice(0, k)) moveObject(ctx.g, id, 'graveyard', ctx.events);
    }
    return true;
  },

  discard(node, ctx) {
    // CR 701.9a: the player chooses (in APNAP order, CR 101.4), then the cards go to the graveyard.
    const players = refPlayers(ctx, ref(node, 'who'));
    if (node.all) {
      // "discards their hand": nothing to choose.
      for (const p of players) {
        const hand = [...zoneList(ctx.g, 'hand', p)];
        for (const id of hand) discardRecorded(ctx, id);
        if (ctx.resolution) (ctx.resolution.discarded ??= {})[p] = (ctx.resolution.discarded[p] ?? 0) + hand.length;
      }
      return true;
    }
    const n = amountOf(ctx, node.amount);
    // CR 701.9b: "discard a card at random" — nobody chooses.
    if (node.random) {
      for (const p of players) {
        const hand = [...zoneList(ctx.g, 'hand', p)];
        const picked: string[] = [];
        while (picked.length < n && hand.length) picked.push(hand.splice(Math.floor(nextRandom(ctx.g) * hand.length), 1)[0]!);
        for (const id of picked) discardRecorded(ctx, id);
        if (ctx.resolution) (ctx.resolution.discarded ??= {})[p] = (ctx.resolution.discarded[p] ?? 0) + picked.length;
      }
      return true;
    }
    // Thirst for Knowledge: "discard an artifact card" — one of those (each player in turn, CR 101.4).
    if (node.filter) {
      const filter = node.filter as ObjectFilter;
      const memo = ctx.memo as { i?: number };
      memo.i ??= 0;
      let picked = answerOf(ctx, 'choose_objects');
      for (; memo.i < players.length; memo.i++) {
        const p = players[memo.i]!;
        const fits = zoneList(ctx.g, 'hand', p).filter((id) => matchesFilter(ctx.g, ctx.g.objects[id]!, filter, { controller: p, source: ctx.source ?? null, anyZone: true }));
        const k = Math.min(n, fits.length);
        let chosen = fits;
        if (fits.length > k) {
          if (!picked) return { ask: { kind: 'choose_objects', player: p, candidates: fits, min: k, max: k, text: `Discard ${k} of these cards.` } };
          if (picked.objects.length !== k || new Set(picked.objects).size !== k || !picked.objects.every((id) => fits.includes(id))) throw new RulesError(`Choose ${k} of those cards to discard.`);
          chosen = picked.objects;
          picked = null;
        }
        for (const id of [...chosen]) discardRecorded(ctx, id);
        if (ctx.resolution) (ctx.resolution.discarded ??= {})[p] = (ctx.resolution.discarded[p] ?? 0) + chosen.length;
      }
      return true;
    }
    const done = (ctx.memo.done as PlayerId[] | undefined) ?? [];
    const answer = answerOf(ctx, 'discard');
    if (answer) {
      const p = ctx.memo.asking as PlayerId;
      const hand = zoneList(ctx.g, 'hand', p);
      if (answer.objects.length !== Math.min(n, hand.length) || new Set(answer.objects).size !== answer.objects.length || !answer.objects.every((id) => hand.includes(id))) {
        throw new RulesError(`Choose ${Math.min(n, hand.length)} card(s) from your hand to discard.`);
      }
      for (const id of answer.objects) discardRecorded(ctx, id);
      if (ctx.resolution) (ctx.resolution.discarded ??= {})[p] = (ctx.resolution.discarded[p] ?? 0) + answer.objects.length;
      done.push(p);
    }
    for (const p of players) {
      if (done.includes(p)) continue;
      const hand = zoneList(ctx.g, 'hand', p);
      if (hand.length <= n) {
        for (const id of [...hand]) discardRecorded(ctx, id);
        done.push(p);
        continue;
      }
      ctx.memo.done = done;
      ctx.memo.asking = p;
      return { ask: { kind: 'discard', player: p, count: n } };
    }
    return true;
  },

  regenerate(node, ctx) {
    // CR 701.19a: a shield that replaces the next destruction this turn.
    for (const o of refObjects(ctx, ref(node, 'what'))) if (o.zone === 'battlefield') o.regenShields = (o.regenShields ?? 0) + 1;
    return true;
  },

  // High Tide: "Until end of turn, whenever a player taps an Island for mana, …" — a triggered mana ability for the turn.
  turn_trigger(node, ctx) {
    // CR 603.7: a triggered ability that lasts for the rest of the turn.
    const ability = node.ability as TriggeredAbility;
    const src = ctx.source;
    if (!src) return true;
    const json = JSON.stringify(ability);
    const bind = (json.includes('"ref":"target"') || json.includes('"to":"target"')) && !ability.targets?.length;
    (ctx.g.turnTriggers ??= []).push({
      id: `tt${ctx.g.nextId++}`,
      controller: ctx.controller,
      source: { id: src.id, zcc: src.zcc },
      sourceName: sourceName(ctx),
      ability,
      turn: ctx.g.turn,
      ...(bind ? { targets: ctx.targets.map((list) => [...list]) } : {}),
    });
    return true;
  },

  mana_trigger_this_turn(node, ctx) {
    (ctx.g.manaTriggers ??= []).push({ controller: ctx.controller, ability: node.ability as TriggeredAbility, turn: ctx.g.turn });
    ctx.g.manaTriggers = ctx.g.manaTriggers.filter((f) => f.turn === ctx.g.turn);
    return true;
  },

  attach(node, ctx) {
    const what = refObjects(ctx, ref(node, 'what'))[0];
    const to = refObjects(ctx, ref(node, 'to'))[0];
    if (what && to) attach(ctx.g, what, to, ctx.events);
    return true;
  },

  // CR 506.4: "Remove target attacking creature from combat." (A blocked creature stays blocked.)
  remove_from_combat(node, ctx) {
    for (const o of refObjects(ctx, ref(node, 'what'))) if (o.zone === 'battlefield') removeFromCombat(ctx.g, o.id);
    return true;
  },

  // CR 702.151a (reconfigure): "Unattach this permanent."
  unattach(node, ctx) {
    for (const o of refObjects(ctx, ref(node, 'what'))) {
      if (o.zone !== 'battlefield' || !o.attachedTo) continue;
      delete o.attachedTo;
      o.timestamp = ++ctx.g.clock;
    }
    return true;
  },

  sacrifice(node, ctx) {
    // "its controller sacrifices it": whoever controls it now (CR 701.21a: only a permanent you control).
    for (const o of refObjects(ctx, ref(node, 'what'))) sacrifice(ctx.g, o, node.byController ? o.controller : ctx.controller, ctx.events);
    return true;
  },

  transform(node, ctx) {
    for (const o of refObjects(ctx, ref(node, 'what'))) {
      const def = ctx.g.cards[o.card];
      // CR 701.27c / CR 712.9: only double-faced permanents (not meld cards) transform.
      if (o.zone !== 'battlefield' || !def || def.layout !== 'transform' || def.faces.length !== 2) continue;
      // CR 702.145b/e: "This permanent can't transform except due to its daybound ability."
      if (dayNightCard(ctx.g, o)) continue;
      const next = o.face === 0 ? 1 : 0;
      // CR 701.27d: not into an instant or sorcery face.
      if (def.faces[next]!.types.some((t) => t === 'Instant' || t === 'Sorcery')) continue;
      // CR 701.27a: turn it over so its other face is up. It's the same object (no zone change).
      o.face = next;
      ctx.events.push({ type: 'transformed', object: o.id, face: next });
    }
    return true;
  },

  // CR 701.14a: each creature deals damage equal to its power to the other.
  fight(node, ctx) {
    const g = ctx.g;
    const [a] = refObjects(ctx, ref(node, 'a'));
    const [d] = refObjects(ctx, ref(node, 'b'));
    // CR 701.14b: if either isn't a creature on the battlefield (or is an illegal target), neither fights.
    const ok = (o: GameObject | undefined): o is GameObject => Boolean(o && o.zone === 'battlefield' && chars(g, o).types.includes('Creature'));
    if (!ok(a) || !ok(d)) return true;
    const pa = Math.max(0, power(g, a));
    const pd = Math.max(0, power(g, d));
    // CR 701.14d: not combat damage. CR 701.14c: a creature that fights itself deals twice its power to itself.
    for (const [from, to, n] of [[a, d, pa], [d, a, pd]] as const) {
      const dealt = dealDamage(g, from, { kind: 'permanent', object: to.id }, n, false, ctx.events);
      if (dealt > 0 && hasKeyword(g, from, 'lifelink')) gainLife(ctx, from.controller, dealt);
    }
    return true;
  },

  // CR 701.20a: "Target opponent reveals their hand. You choose a nonland card from it. That player discards that card."
  choose_from_hand(node, ctx) {
    const g = ctx.g;
    const n = amountOf(ctx, node.amount ?? 1);
    const [p] = refPlayers(ctx, ref(node, 'who'));
    if (!p) return true;
    const hand = zoneList(g, 'hand', p);
    const filter = liveFilter(ctx, { ...(node.filter as ObjectFilter), zone: 'hand' as const });
    const candidates = hand.filter((id) => matchesFilter(g, g.objects[id]!, filter, { controller: ctx.controller, source: ctx.source ?? null }));
    const answer = answerOf(ctx, 'choose_objects');
    let chosen: string[];
    if (answer) {
      const need = node.optional ? 0 : Math.min(n, candidates.length);
      if (answer.objects.length < need || answer.objects.length > n || new Set(answer.objects).size !== answer.objects.length || !answer.objects.every((id) => candidates.includes(id))) {
        throw new RulesError(`Choose ${need === n ? n : `up to ${n}`} card(s) from that hand.`);
      }
      chosen = answer.objects;
    } else {
      if (node.revealHand) ctx.events.push({ type: 'revealed', player: p, objects: [...hand] });
      if (!candidates.length) return true;
      if (candidates.length > n || node.optional) {
        return {
          ask: {
            kind: 'choose_objects',
            player: ctx.controller,
            candidates,
            min: node.optional ? 0 : n,
            max: Math.min(n, candidates.length),
            text: node.then === 'library_top' ? `Put ${n === 1 ? 'a card' : `${n} cards`} from your hand on top of your library (the first one on top).` : `Choose ${n === 1 ? 'a card' : n >= 99 ? 'any number of cards' : `${node.optional ? 'up to ' : ''}${n} cards`} from ${p === ctx.controller ? 'your' : `${p}'s`} hand.`,
            ...(node.then === 'library_top' ? { ordered: true as const } : {}),
            ...(node.revealHand ? { revealed: [...hand] } : {}),
          },
        };
      }
      chosen = candidates;
    }
    // "put two cards from your hand on top of your library in any order": the first chosen ends up on top.
    if (node.then === 'library_top') {
      for (const id of [...chosen].reverse()) moveObject(g, id, 'library', ctx.events, { position: 'top' });
      return true;
    }
    for (const id of chosen) {
      if (node.then === 'exile') {
        moveObject(g, id, 'exile', ctx.events);
        // Imprint (Chrome Mox): "the exiled card" is the one this ability exiled (CR 607.2a).
        const src = ctx.source;
        if (src && src.id !== id && g.objects[id]!.zone === 'exile') g.objects[id]!.exiledBy = { id: src.id, zcc: battlefieldZcc(g, src) };
      }
      else if (node.then === 'battlefield') {
        moveObject(g, id, 'battlefield', ctx.events, { controller: ctx.controller, ...(node.tapped ? { tapped: true } : {}) });
        // Kaalia of the Vast: "tapped and attacking that opponent" (CR 508.4: it attacks what the source attacks).
        const at = node.attacking === 'that_player' && ctx.trigger?.player ? { kind: 'player' as const, player: ctx.trigger.player } : undefined;
        if (node.attacking && g.objects[id]?.zone === 'battlefield') enterAttacking(g, g.objects[id]!, ctx.source ?? undefined, at);
      }
      else discardCard(g, id, ctx.events);
    }
    // Through the Breach: "That creature gains haste." — the permanent put onto the battlefield this way.
    if (node.then === 'battlefield' && ctx.resolution) {
      ctx.resolution.created = chosen.filter((id) => g.objects[id]?.zone === 'battlefield').map((id) => ({ id, zcc: g.objects[id]!.zcc }));
    }
    return true;
  },

  // "Look at the top N cards of your library. Put K of them into your hand and the rest …"
  dig(node, ctx) {
    const g = ctx.g;
    const memo = ctx.memo as { looked?: string[]; chosen?: string[] };
    // "If you didn't put a card into your hand this way, draw a card."
    const done = (): EffectResult => (node.ifNone && !memo.chosen?.length ? { expand: node.ifNone as EffectNode[] } : true);
    // Chaos Warp: "… reveals the top card of their library" — another player's library, and they put it onto the battlefield.
    const who = node.who ? refPlayers(ctx, ref(node, 'who'))[0] : ctx.controller;
    if (!who) return true;
    const library = zoneList(g, 'library', who);
    const looked = (memo.looked ??= library.slice(0, amountOf(ctx, node.amount))).filter((id) => g.objects[id]?.zone === 'library');
    if (!looked.length) return done();
    const take = amountOf(ctx, node.take ?? 1);
    const answer = answerOf(ctx, 'choose_objects');
    if (!memo.chosen) {
      const filter = node.filter ? liveFilter(ctx, { ...(node.filter as ObjectFilter), zone: 'library' as const }) : null;
      const candidates = filter ? looked.filter((id) => matchesFilter(g, g.objects[id]!, filter, { controller: ctx.controller, source: ctx.source ?? null })) : looked;
      const max = Math.min(take, candidates.length);
      const min = node.optional || node.upTo ? 0 : max;
      if (answer) {
        if (answer.objects.length < min || answer.objects.length > max || new Set(answer.objects).size !== answer.objects.length || !answer.objects.every((id) => candidates.includes(id))) {
          throw new RulesError(min === max ? `Choose ${max} of those cards.` : `Choose up to ${max} of those cards.`);
        }
        memo.chosen = answer.objects;
      } else if (min === max && (max === 0 || candidates.length === max)) {
        memo.chosen = candidates.slice(0, max);
      } else {
        return { ask: { kind: 'choose_objects', player: who, candidates, min, max, text: `Choose ${min === max ? max : `up to ${max}`} of the top ${looked.length} cards.`, seen: looked } };
      }
      // The chosen cards go where the text says.
      const chosen = memo.chosen;
      if (node.reveal && (chosen.length || node.who)) ctx.events.push({ type: 'revealed', player: who, objects: [...(node.who ? looked : chosen)] });
      const to = String(node.to);
      if (to === 'top') {
        // Kept on top, in the order chosen; the rest of the library follows.
        const others = library.filter((id) => !chosen.includes(id));
        library.length = 0;
        library.push(...chosen, ...others);
      } else {
        for (const id of chosen) moveObject(g, id, to as 'hand' | 'battlefield' | 'graveyard', ctx.events, to === 'battlefield' ? { controller: who, ...(node.tapped ? { tapped: true } : {}) } : {});
      }
      const rest = looked.filter((id) => !chosen.includes(id) && g.objects[id]!.zone === 'library');
      if (node.rest === 'graveyard' || node.rest === 'hand') {
        for (const id of rest) moveObject(g, id, node.rest, ctx.events);
        return done();
      }
      // Famished Worldsire: "…, then shuffle." — the rest stay in the library, which is shuffled (CR 701.24a).
      if (node.rest === 'shuffle') {
        shuffleInPlace(g, library);
        ctx.events.push({ type: 'shuffled', player: who });
        return done();
      }
      if (node.rest === 'top' || rest.length < 2 || node.order === 'random') {
        if (node.order === 'random') shuffleInPlace(g, rest);
        if (node.rest !== 'top') for (const id of rest) moveObject(g, id, 'library', ctx.events, { position: 'bottom' });
        return done();
      }
      // "on the bottom of your library in any order": the player orders them.
      return { ask: { kind: 'choose_objects', player: ctx.controller, candidates: rest, min: rest.length, max: rest.length, text: 'Order these cards for the bottom of your library (first chosen goes on top of the others).', ordered: true } };
    }
    // The order for the bottom.
    const rest = looked.filter((id) => !memo.chosen!.includes(id) && g.objects[id]!.zone === 'library');
    const order = answer?.objects ?? rest;
    if (order.length !== rest.length || !order.every((id) => rest.includes(id)) || new Set(order).size !== order.length) throw new RulesError('Put each of those cards in order.');
    for (const id of order) moveObject(g, id, 'library', ctx.events, { position: 'bottom' });
    return done();
  },

  // CR 701.39a: "Bolster N" — a creature you control with the least toughness gets N +1/+1 counters.
  bolster(node, ctx) {
    const g = ctx.g;
    const mine = g.zones.battlefield.map((id) => g.objects[id]!).filter((o) => o.controller === ctx.controller && chars(g, o).types.includes('Creature'));
    if (!mine.length) return true;
    const least = Math.min(...mine.map((o) => toughness(g, o)));
    const tied = mine.filter((o) => toughness(g, o) === least).map((o) => o.id);
    const answer = answerOf(ctx, 'choose_objects');
    let pick = tied[0]!;
    if (answer) {
      if (answer.objects.length !== 1 || !tied.includes(answer.objects[0]!)) throw new RulesError('Choose a creature you control with the least toughness.');
      pick = answer.objects[0]!;
    } else if (tied.length > 1) {
      return { ask: { kind: 'choose_objects', player: ctx.controller, candidates: tied, min: 1, max: 1, text: 'Choose a creature with the least toughness to bolster.' } };
    }
    addCounters(ctx, g.objects[pick]!, '+1/+1', amountOf(ctx, node.amount));
    return true;
  },

  // CR 603.12: a reflexive triggered ability ("When you do, …") triggers as the action is taken; it's put on the
  // stack the next time a player would receive priority, with its own targets (CR 603.3).
  reflexive(node, ctx) {
    const g = ctx.g;
    const ability = (node.abilities as TriggeredAbility[])[0]!;
    const source = ctx.source;
    g.triggers.push({
      id: `t${g.nextId++}`,
      controller: ctx.controller,
      source: source ? { id: source.id, zcc: source.zcc } : { id: '', zcc: 0 },
      sourceName: sourceName(ctx),
      ability,
      info: {
        ...(ctx.trigger ?? {}),
        ...(ctx.resolution?.dieResult !== undefined ? { dieResult: ctx.resolution.dieResult } : {}),
        ...(ctx.resolution?.lkiThisWay ? { lkiThisWay: ctx.resolution.lkiThisWay } : {}),
        ...(ctx.resolution?.created ? { created: ctx.resolution.created } : {}),
      },
    });
    return true;
  },

  // Sylvan Library: "you may draw two additional cards. If you do, choose two cards in your hand drawn this turn. For
  // each of those cards, pay 4 life or put the card on top of your library."
  sylvan_library(_node, ctx) {
    const g = ctx.g;
    const p = ctx.controller;
    const memo = ctx.memo as { stage?: 'choose' | 'pay'; chosen?: ObjectId[]; i?: number; asked?: number };
    if (!memo.stage) {
      const answer = answerOf(ctx, 'may');
      if (!answer) return { ask: { kind: 'may', player: p, text: 'Draw two additional cards?', sourceName: sourceName(ctx) } };
      if (!answer.yes) return true;
      drawCard(g, p, ctx.events);
      drawCard(g, p, ctx.events);
      memo.stage = 'choose';
    }
    if (memo.stage === 'choose') {
      const drawn = [...new Set(g.turnLog.drawnIds?.[p] ?? [])].filter((id) => g.objects[id]?.zone === 'hand' && g.objects[id]!.owner === p);
      const n = Math.min(2, drawn.length);
      if (!n) return true;
      if (drawn.length > n) {
        const answer = answerOf(ctx, 'choose_objects');
        if (!answer) return { ask: { kind: 'choose_objects', player: p, candidates: drawn, min: n, max: n, text: 'Choose two cards in your hand drawn this turn.' } };
        if (answer.objects.length !== n || new Set(answer.objects).size !== n || !answer.objects.every((id) => drawn.includes(id))) throw new RulesError('Choose two cards you drew this turn.');
        memo.chosen = answer.objects;
      } else memo.chosen = drawn;
      memo.stage = 'pay';
      memo.i = 0;
    }
    const OPTIONS = ['Pay 4 life', 'Put it on top of your library'];
    while ((memo.i ?? 0) < (memo.chosen?.length ?? 0)) {
      const id = memo.chosen![memo.i!]!;
      const ps = g.players[p]!;
      // CR 119.4: life can be paid only if the player has that much (and their life total can change).
      const canPay = ps.life >= 4 && !playerRule(g, p, 'life_cant_change');
      let pay = false;
      if (canPay) {
        const answer = memo.asked === memo.i ? answerOf(ctx, 'choose_option') : null;
        if (!answer) {
          memo.asked = memo.i;
          return { ask: { kind: 'choose_option', player: p, options: OPTIONS, text: `${nameOf(g, g.objects[id]!)}: pay 4 life, or put it on top of your library?`, sourceName: sourceName(ctx) } };
        }
        if (!OPTIONS.includes(answer.choice)) throw new RulesError('Choose one of the options.');
        pay = answer.choice === OPTIONS[0];
      }
      if (pay) {
        const lost = lifeLoss(g, p, 4);
        ps.life -= lost;
        ctx.events.push({ type: 'life', player: p, delta: -lost, life: ps.life });
      } else if (g.objects[id]?.zone === 'hand') moveObject(g, id, 'library', ctx.events, { position: 'top' });
      memo.i = (memo.i ?? 0) + 1;
    }
    return true;
  },

  // Living Death: each player exiles their creature cards from their graveyard, sacrifices their creatures, then puts the
  // exiled cards onto the battlefield (each step at the same time for everyone, CR 101.4).
  swap_graveyard(node, ctx) {
    const g = ctx.g;
    const type = String(node.cardType);
    const exiled: string[] = [];
    for (const p of livePlayers(g)) {
      for (const id of [...zoneList(g, 'graveyard', p)]) {
        if (!faceOf(g, g.objects[id]!).types.includes(type)) continue;
        moveObject(g, id, 'exile', ctx.events);
        exiled.push(id);
      }
    }
    for (const id of [...g.zones.battlefield]) {
      const o = g.objects[id]!;
      if (hasType(g, o, type)) sacrifice(g, o, o.controller, ctx.events);
    }
    for (const id of exiled) {
      const o = g.objects[id]!;
      if (o.zone === 'exile') moveObject(g, id, 'battlefield', ctx.events, { controller: o.owner });
    }
    return true;
  },

  // CR 701.10e: "double the number of +1/+1 counters on it" — put that many more on it.
  double_counters(node, ctx) {
    for (const o of refObjects(ctx, ref(node, 'what'))) {
      if (o.zone !== 'battlefield') continue;
      const kinds = node.counter === 'each' ? Object.keys(o.counters) : [String(node.counter)];
      for (const k of kinds) {
        const n = o.counters[k] ?? 0;
        if (n > 0) addCounters(ctx, o, k, n);
      }
    }
    return true;
  },

  // Mistrise Village: "The next spell you cast this turn can't be countered."; "… costs {1} less to cast".
  next_spell(node, ctx) {
    const g = ctx.g;
    const reduce = node.reduce !== undefined ? Math.max(0, amountOf(ctx, node.reduce)) : undefined;
    const source = ctx.source ? { id: ctx.source.id, zcc: ctx.source.zcc } : { id: '', zcc: 0 };
    (g.nextSpell ??= []).push({
      id: `n${g.nextId++}`, player: ctx.controller, turn: g.turn, filter: (node.filter ?? {}) as ObjectFilter, source,
      ...(node.uncounterable ? { uncounterable: true as const } : {}), ...(reduce !== undefined ? { reduce } : {}),
      ...(node.keyword ? { keyword: String(node.keyword) } : {}),
    });
    return true;
  },

  // CR 701.68a: "blight N" — each player puts N -1/-1 counters on a creature they control (CR 701.68b: none, nothing).
  blight(node, ctx) {
    const g = ctx.g;
    const n = amountOf(ctx, node.amount);
    const done = (ctx.memo.done as PlayerId[] | undefined) ?? [];
    const answer = answerOf(ctx, 'choose_objects');
    if (answer && ctx.memo.asking) {
      const p = ctx.memo.asking as PlayerId;
      const pick = answer.objects[0];
      if (answer.objects.length !== 1 || !blightCandidates(g, p).includes(pick!)) throw new RulesError('Choose a creature you control.');
      blight(g, p, g.objects[pick!]!, n, ctx.events);
      done.push(p);
      delete ctx.memo.asking;
    }
    for (const p of refPlayers(ctx, ref(node, 'who'))) {
      if (done.includes(p)) continue;
      const mine = blightCandidates(g, p);
      if (mine.length <= 1) {
        if (mine[0]) blight(g, p, g.objects[mine[0]]!, n, ctx.events);
        done.push(p);
        continue;
      }
      ctx.memo.done = done;
      ctx.memo.asking = p;
      return { ask: { kind: 'choose_objects', player: p, candidates: mine, min: 1, max: 1, text: `Choose a creature you control to put ${n} -1/-1 counter${n === 1 ? '' : 's'} on.` } };
    }
    return true;
  },

  // CR 701.61a: "Exile three cards from your graveyard or sacrifice a Food."
  forage(_node, ctx) {
    const g = ctx.g;
    const p = ctx.controller;
    const foods = foodCandidates(g, p);
    const yard = zoneList(g, 'graveyard', p);
    if (!foods.length && yard.length < 3) return true;
    const WAYS = ['Sacrifice a Food', 'Exile three cards from your graveyard'];
    let way = ctx.memo.way as string | undefined;
    if (!way) {
      const answer = answerOf(ctx, 'choose_option');
      if (foods.length && yard.length >= 3 && !answer) return { ask: { kind: 'choose_option', player: p, options: WAYS, text: 'Forage how?', sourceName: sourceName(ctx) } };
      way = answer ? answer.choice : foods.length ? WAYS[0]! : WAYS[1]!;
      if (!WAYS.includes(way)) throw new RulesError('Choose one of the options.');
      ctx.memo.way = way;
    }
    const answer = answerOf(ctx, 'choose_objects');
    if (way === WAYS[0]) {
      let food = foods.length === 1 ? foods[0] : undefined;
      if (answer) {
        if (answer.objects.length !== 1 || !foods.includes(answer.objects[0]!)) throw new RulesError('Choose a Food you control.');
        food = answer.objects[0];
      }
      if (!food) return { ask: { kind: 'choose_objects', player: p, candidates: foods, min: 1, max: 1, text: 'Choose a Food to sacrifice.' } };
      sacrifice(g, g.objects[food]!, p, ctx.events);
    } else {
      let cards = yard.length === 3 ? yard : undefined;
      if (answer) {
        if (answer.objects.length !== 3 || new Set(answer.objects).size !== 3 || !answer.objects.every((id) => yard.includes(id))) throw new RulesError('Choose three cards in your graveyard.');
        cards = answer.objects;
      }
      if (!cards) return { ask: { kind: 'choose_objects', player: p, candidates: yard, min: 3, max: 3, text: 'Choose three cards in your graveyard to exile.' } };
      for (const id of cards) moveObject(g, id, 'exile', ctx.events);
    }
    ctx.events.push({ type: 'foraged', player: p });
    return true;
  },

  // "Look at the top four cards of your library, then put them back in any order."
  reorder_top(node, ctx) {
    return lookAtTop(ctx, amountOf(ctx, node.amount), 'scry', true);
  },

  // "Return a land you control to its owner's hand." — chosen as it resolves (CR 608.2d).
  move_chosen(node, ctx) {
    const g = ctx.g;
    const n = amountOf(ctx, node.amount ?? 1);
    const candidates = () => g.zones.battlefield.filter((id) => matchesFilter(g, g.objects[id]!, node.filter as ObjectFilter, { controller: ctx.controller, source: ctx.source ?? null }));
    const answer = answerOf(ctx, 'choose_objects');
    let chosen: string[];
    if (answer) {
      const list = candidates();
      if (answer.objects.length !== Math.min(n, list.length) || new Set(answer.objects).size !== answer.objects.length || !answer.objects.every((id) => list.includes(id))) {
        throw new RulesError(`Choose ${Math.min(n, list.length)} permanent(s).`);
      }
      chosen = answer.objects;
    } else {
      const list = candidates();
      if (list.length > n) return { ask: { kind: 'choose_objects', player: ctx.controller, candidates: list, min: n, max: n, text: `Choose ${n === 1 ? 'a permanent' : `${n} permanents`} to return to ${n === 1 ? 'its' : 'their'} owner's hand.` } };
      chosen = list;
    }
    for (const id of chosen) moveObject(g, id, 'hand', ctx.events);
    return true;
  },

  // CR 701.15a: goaded until the goading player's next turn; CR 701.15d: once per player.
  goad(node, ctx) {
    for (const o of refObjects(ctx, ref(node, 'what'))) {
      if (o.zone !== 'battlefield' || !chars(ctx.g, o).types.includes('Creature')) continue;
      if (!(o.goadedBy ??= []).includes(ctx.controller)) o.goadedBy.push(ctx.controller);
      // Kardur: "… attack each combat if able and attack a player other than you if able" — the same requirements, but
      // nothing was goaded ("whenever you goad" doesn't trigger).
      if (!node.quiet) ctx.events.push({ type: 'goaded', object: o.id, by: ctx.controller });
    }
    return true;
  },

  // CR 104.2a / 104.3a: a player wins (everyone else loses) or loses the game.
  game_result(node, ctx) {
    for (const p of refPlayers(ctx, ref(node, 'who'))) {
      // "You can't lose the game" / "your opponents can't win the game" (Platinum Angel).
      if (node.result === 'lose') {
        if (!cantLose(ctx.g, p)) playerLoses(ctx.g, p, 'an effect says so', ctx.events);
      } else if (!livePlayers(ctx.g).some((q) => q !== p && playerRule(ctx.g, q, 'opponents_cant_win'))) {
        for (const q of livePlayers(ctx.g)) if (q !== p && !cantLose(ctx.g, q)) playerLoses(ctx.g, q, `${p} won the game`, ctx.events);
      }
    }
    return true;
  },

  // CR 500.7: "Take an extra turn after this one."
  extra_turn(node, ctx) {
    // CR 500.7: the most recently created extra turn is taken first (two at once: one after the other).
    const n = Number(node.count ?? 1);
    for (const p of refPlayers(ctx, ref(node, 'who'))) for (let i = 0; i < n; i++) (ctx.g.extraTurns ??= []).unshift(p);
    return true;
  },

  // "Choose a creature type." / "Choose a color." — remembered for "the chosen type" (on the spell or permanent).
  choose_value(node, ctx) {
    const answer = answerOf(ctx, 'choose_option');
    const options = node.choice === 'color' ? ['W', 'U', 'B', 'R', 'G'] : node.choice === 'land_type' ? ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] : [...SUBTYPES.creature];
    const text = node.choice === 'color' ? 'Choose a color.' : node.choice === 'land_type' ? 'Choose a basic land type.' : 'Choose a creature type.';
    if (!answer) return { ask: { kind: 'choose_option', player: ctx.controller, options, text, sourceName: sourceName(ctx) } };
    if (!options.includes(answer.choice)) throw new RulesError('Choose one of the options.');
    // "… of your choice": remembered for this resolution only.
    if (node.scope === 'resolution') {
      if (ctx.resolution) {
        const key = node.choice === 'color' ? 'color' : node.choice === 'land_type' ? 'landType' : 'creatureType';
        ctx.resolution.chosen = { ...ctx.resolution.chosen, [key]: answer.choice };
      }
      return true;
    }
    const s = ctx.source;
    if (s) s.chosen = { ...s.chosen, ...(node.choice === 'color' ? { color: answer.choice as Color } : { creatureType: answer.choice }) };
    ctx.events.push({ type: 'chosen', object: s?.id ?? '', choice: answer.choice });
    return true;
  },

  // CR 701.24a: shuffle a library.
  shuffle(node, ctx) {
    for (const p of node.who ? refPlayers(ctx, ref(node, 'who')) : [ctx.controller]) {
      shuffleInPlace(ctx.g, zoneList(ctx.g, 'library', p));
      ctx.events.push({ type: 'shuffled', player: p });
    }
    return true;
  },

  // CR 722.3a–b: "~ becomes prepared", "Target creature becomes unprepared."
  become_prepared(node, ctx) {
    for (const o of refObjects(ctx, ref(node, 'what'))) becomePrepared(ctx.g, o, ctx.events);
    return true;
  },
  become_unprepared(node, ctx) {
    for (const o of refObjects(ctx, ref(node, 'what'))) unprepare(ctx.g, o, ctx.events);
    return true;
  },

  // CR 701.24a: "Each player shuffles their hand and graveyard into their library", "Shuffle your graveyard into your library."
  shuffle_zones(node, ctx) {
    const zones = (node.zones as ('hand' | 'graveyard')[] | undefined) ?? ['graveyard'];
    for (const p of node.who ? refPlayers(ctx, ref(node, 'who')) : [ctx.controller]) {
      for (const z of zones) for (const id of [...zoneList(ctx.g, z, p)]) moveObject(ctx.g, id, 'library', ctx.events);
      shuffleInPlace(ctx.g, zoneList(ctx.g, 'library', p));
      ctx.events.push({ type: 'shuffled', player: p });
    }
    return true;
  },

  // "When this creature dies, put its counters on target creature you control." — the counters it had as it
  // left the battlefield (CR 603.10a).
  put_counters(node, ctx) {
    const counters = ctx.trigger?.lki?.counters ?? {};
    for (const o of refObjects(ctx, ref(node, 'what'))) {
      if (o.zone !== 'battlefield') continue;
      for (const [k, n] of Object.entries(counters)) if (n > 0) addCounters(ctx, o, k, n);
    }
    return true;
  },

  // CR 702.49a/c: "Put this card onto the battlefield from your hand tapped and attacking" — attacking what the
  // returned creature was attacking.
  ninjutsu(_node, ctx) {
    const g = ctx.g;
    const o = ctx.source;
    if (!o || o.zone !== 'hand' || (ctx.sourceZcc !== undefined && o.zcc !== ctx.sourceZcc)) return true;
    moveObject(g, o.id, 'battlefield', ctx.events, { controller: ctx.controller, tapped: true });
    const target = ctx.resolution?.entry.costLKI?.attackTarget;
    if (g.combat && target && chars(g, o).types.includes('Creature')) g.combat.attackers[o.id] = { zcc: o.zcc, target: { ...target }, blocked: false, blockers: [] };
    return true;
  },

  // CR 702.58a (graft): "move a +1/+1 counter from this permanent onto that creature" (CR 122.5).
  // The Ozolith: "put those counters on ~" — the counters the object had as it last existed (CR 603.10a).
  put_lki_counters(node, ctx) {
    const [to] = refObjects(ctx, ref(node, 'to')).filter((o) => o.zone === 'battlefield');
    if (!to) return true;
    for (const [counter, n] of Object.entries(ctx.trigger?.lki?.counters ?? {})) if (n > 0) addCounters(ctx, to, counter, n);
    return true;
  },

  move_counters(node, ctx) {
    const [from] = refObjects(ctx, ref(node, 'from'));
    // "move all counters from ~ onto target creature" — every kind.
    if (node.counter === 'all') {
      if (!from || from.zone !== 'battlefield') return true;
      const [to] = refObjects(ctx, ref(node, 'to')).filter((o) => o.zone === 'battlefield' && o.id !== from.id);
      if (!to) return true;
      for (const [counter, n] of Object.entries({ ...from.counters })) {
        if (!(n > 0)) continue;
        delete from.counters[counter];
        ctx.events.push({ type: 'counters', object: from.id, counter, delta: -n });
        addCounters(ctx, to, counter, n);
      }
      return true;
    }
    let counter = String(node.counter);
    // Nesting Grounds: "Move a counter from …" — of whichever kind it has, the controller's choice.
    if (counter === 'any') {
      if (!from || from.zone !== 'battlefield') return true;
      const kinds = Object.keys(from.counters).filter((k) => (from.counters[k] ?? 0) > 0);
      if (!kinds.length) return true;
      if (kinds.length === 1) counter = kinds[0]!;
      else {
        const answer = answerOf(ctx, 'choose_option');
        if (!answer) return { ask: { kind: 'choose_option', player: ctx.controller, options: kinds, text: 'Choose a kind of counter to move.', sourceName: sourceName(ctx) } };
        if (!kinds.includes(answer.choice)) throw new RulesError('Choose a kind of counter it has.');
        counter = answer.choice;
      }
    }
    if (!from || from.zone !== 'battlefield' || !(from.counters[counter] ?? 0)) return true;
    const to = refObjects(ctx, ref(node, 'to')).filter((o) => o.zone === 'battlefield' && o.id !== from.id);
    if (!to.length) return true;
    // Forgotten Ancient: "move any number of +1/+1 counters from this creature onto other creatures" — one at a time
    // until its controller stops (or it has none left).
    if (node.distribute) {
      for (let answer = answerOf(ctx, 'choose_objects'); ; answer = null) {
        if (!(from.counters[counter] ?? 0)) return true;
        if (!answer) {
          return { ask: { kind: 'choose_objects', player: ctx.controller, candidates: to.map((o) => o.id), min: 0, max: 1, text: `Move a ${counter} counter from ${nameOf(ctx.g, from)} onto which creature? (Choose none to stop.)`, sourceName: sourceName(ctx) } };
        }
        if (!answer.objects.length) return true;
        const onto = to.find((o) => o.id === answer!.objects[0]);
        if (answer.objects.length !== 1 || !onto) throw new RulesError('Choose one of those creatures, or none.');
        from.counters[counter] = from.counters[counter]! - 1;
        if (!from.counters[counter]) delete from.counters[counter];
        ctx.events.push({ type: 'counters', object: from.id, counter, delta: -1 });
        addCounters(ctx, onto, counter, 1);
      }
    }
    const n = Math.min(from.counters[counter]!, amountOf(ctx, node.amount ?? 1));
    from.counters[counter] = from.counters[counter]! - n;
    if (!from.counters[counter]) delete from.counters[counter];
    ctx.events.push({ type: 'counters', object: from.id, counter, delta: -n });
    addCounters(ctx, to[0]!, counter, n);
    return true;
  },

  // CR 702.116a: myriad — for each opponent other than defending player, a token copy tapped and attacking that
  // player; the tokens are exiled at end of combat. (The bots and the engine always create them.)
  myriad(_node, ctx) {
    const g = ctx.g;
    const src = ctx.source;
    const defending = ctx.trigger?.player;
    if (!src || !g.combat) return true;
    const made: ObjectRef[] = [];
    for (const p of livePlayers(g)) {
      if (p === ctx.controller || p === defending) continue;
      const t = createTokenCopy(g, copiable(src), ctx.controller, ctx.events, { tapped: true });
      g.combat.attackers[t.id] = { zcc: t.zcc, target: { kind: 'player', player: p }, blocked: false, blockers: [] };
      made.push({ id: t.id, zcc: t.zcc });
    }
    if (!made.length || !ctx.resolution) return true;
    ctx.resolution.created = made;
    return { expand: [{ type: 'delayed', step: 'end_of_combat', effects: [{ type: 'move', what: { ref: 'created' }, to: 'exile' }] }] };
  },

  // CR 702.141a: encore — for each opponent, a token copy that attacks that opponent this turn if able. The tokens
  // gain haste. Sacrifice them at the beginning of the next end step.
  encore(_node, ctx) {
    const g = ctx.g;
    const src = ctx.source;
    if (!src) return true;
    const made: ObjectRef[] = [];
    for (const p of livePlayers(g)) {
      if (p === ctx.controller) continue;
      const t = createTokenCopy(g, copiable(src), ctx.controller, ctx.events, {});
      t.attacksPlayer = { player: p, turn: g.turn };
      g.effects.push({ id: `e${g.nextId++}`, timestamp: ++g.clock, source: { id: t.id, zcc: t.zcc }, controller: ctx.controller, objects: [{ id: t.id, zcc: t.zcc }], keywords: [{ id: 'haste' }], until: 'eot' });
      made.push({ id: t.id, zcc: t.zcc });
    }
    if (!made.length || !ctx.resolution) return true;
    ctx.resolution.created = made;
    return { expand: [{ type: 'delayed', step: 'end', effects: [{ type: 'sacrifice', what: { ref: 'created' } }] }] };
  },

  // CR 702.94a: miracle — "When you reveal this card this way, you may cast it by paying [cost]."
  miracle_cast(_node, ctx) {
    const o = refObjects(ctx, { ref: 'self' })[0];
    if (!o || o.zone !== 'hand') return true;
    const answer = answerOf(ctx, 'cast_free');
    if (!answer) return { ask: { kind: 'cast_free', player: ctx.controller, object: o.id, sourceName: sourceName(ctx), text: `Cast ${nameOf(ctx.g, o)} for its miracle cost?` } };
    if (answer.cast) castDuringResolution(ctx.g, ctx.controller, o.id, answer.targets, answer.modes, ctx.events, { alt: 'miracle' });
    return true;
  },

  // CR 305.2: "You may play an additional land this turn."
  extra_land(node, ctx) {
    for (const p of node.who ? refPlayers(ctx, ref(node, 'who')) : [ctx.controller]) {
      const ps = ctx.g.players[p]!;
      const n = typeof node.amount === 'number' ? node.amount : 1;
      ps.extraLands = { turn: ctx.g.turn, n: (ps.extraLands?.turn === ctx.g.turn ? ps.extraLands.n : 0) + n };
    }
    return true;
  },

  // CR 701.30a: "Populate" — choose a creature token you control and create a token that's a copy of it.
  populate(_node, ctx) {
    const g = ctx.g;
    const tokens = g.zones.battlefield.filter((id) => {
      const o = g.objects[id]!;
      return o.token && o.controller === ctx.controller && chars(g, o).types.includes('Creature');
    });
    if (!tokens.length) return true;
    const answer = answerOf(ctx, 'choose_objects');
    let pick = tokens[0]!;
    if (answer) {
      if (answer.objects.length !== 1 || !tokens.includes(answer.objects[0]!)) throw new RulesError('Choose a creature token you control.');
      pick = answer.objects[0]!;
    } else if (tokens.length > 1) {
      return { ask: { kind: 'choose_objects', player: ctx.controller, candidates: tokens, min: 1, max: 1, text: 'Choose a creature token to copy.' } };
    }
    const t = createTokenCopy(g, copiable(g.objects[pick]!), ctx.controller, ctx.events, {});
    if (ctx.resolution) ctx.resolution.created = [{ id: t.id, zcc: t.zcc }];
    return true;
  },

  // CR 701.30b: "Clash with an opponent" — choose an opponent; you and that opponent each clash: reveal the top
  // card (CR 701.30a), then in APNAP order each decides whether it goes to the bottom (CR 701.30c).
  // CR 700.3: Fact or Fiction — the revealed cards are separated into two piles (either may be empty, CR 700.3a); one
  // player separates, the other chooses a pile. The chosen pile goes into the hand, the other into the graveyard (or to
  // the bottom of the library in any order: Jace, Architect of Thought).
  piles(node, ctx) {
    const g = ctx.g;
    const memo = ctx.memo as { cards?: ObjectId[]; opponent?: PlayerId; first?: ObjectId[]; picked?: ObjectId[] };
    const me = ctx.controller;
    if (!memo.cards) {
      memo.cards = zoneList(g, 'library', me).slice(0, Math.max(0, amountOf(ctx, node.amount)));
      if (memo.cards.length) ctx.events.push({ type: 'revealed', player: me, objects: [...memo.cards] });
    }
    const cards = memo.cards.filter((id) => g.objects[id]?.zone === 'library');
    if (!cards.length) return true;
    // Each answer is used once: the opponent, then the piles, then the pile, then the order for the bottom.
    let used = false;
    if (!memo.opponent) {
      const opponents = livePlayers(g).filter((p) => p !== me);
      if (!opponents.length) return true;
      const answer = answerOf(ctx, 'choose_option');
      if (answer) {
        const p = opponents.find((x) => x === answer.choice || g.players[x]!.name === answer.choice);
        if (!p) throw new RulesError('Choose an opponent.');
        memo.opponent = p;
        used = true;
      } else if (opponents.length === 1) memo.opponent = opponents[0]!;
      else return { ask: { kind: 'choose_option', player: me, options: opponents.map((p) => g.players[p]!.name), text: `Choose an opponent to ${node.separator === 'opponent' ? 'separate the cards into two piles' : 'choose a pile'}.`, sourceName: sourceName(ctx) } };
    }
    const separator = node.separator === 'opponent' ? memo.opponent : me;
    const chooser = node.chooser === 'opponent' ? memo.opponent : me;
    if (!memo.first) {
      const answer = used ? null : answerOf(ctx, 'choose_objects');
      if (!answer) return { ask: { kind: 'choose_objects', player: separator, candidates: cards, min: 0, max: cards.length, text: 'Separate these cards into two piles: choose the cards in one pile (the rest are the other).', revealed: cards } };
      if (new Set(answer.objects).size !== answer.objects.length || !answer.objects.every((id) => cards.includes(id))) throw new RulesError('Choose cards from among the revealed cards.');
      memo.first = answer.objects;
      used = true;
    }
    const first = memo.first.filter((id) => cards.includes(id));
    const second = cards.filter((id) => !first.includes(id));
    const label = (n: number, pile: ObjectId[]) => `Pile ${n}: ${pile.length ? pile.map((id) => nameOf(g, g.objects[id]!)).join(', ') : '(empty)'}`;
    if (!memo.picked) {
      const options = [label(1, first), label(2, second)];
      const answer = used ? null : answerOf(ctx, 'choose_option');
      if (!answer) return { ask: { kind: 'choose_option', player: chooser, options, text: 'Choose a pile to put into the hand.', sourceName: sourceName(ctx) } };
      const n = answer.choice === options[0] || answer.choice === '1' ? 1 : answer.choice === options[1] || answer.choice === '2' ? 2 : 0;
      if (!n) throw new RulesError('Choose one of the two piles.');
      memo.picked = n === 1 ? first : second;
      used = true;
      for (const id of memo.picked) moveObject(g, id, 'hand', ctx.events);
      const rest = cards.filter((id) => !memo.picked!.includes(id));
      if (node.other === 'graveyard' || rest.length < 2) {
        for (const id of rest) moveObject(g, id, node.other === 'graveyard' ? 'graveyard' : 'library', ctx.events, node.other === 'graveyard' ? {} : { position: 'bottom' });
        return true;
      }
      return { ask: { kind: 'choose_objects', player: me, candidates: rest, min: rest.length, max: rest.length, text: 'Order these cards for the bottom of your library (first chosen goes on top of the others).', ordered: true } };
    }
    const rest = cards.filter((id) => !memo.picked!.includes(id));
    const order = (used ? null : answerOf(ctx, 'choose_objects'))?.objects ?? rest;
    if (order.length !== rest.length || !order.every((id) => rest.includes(id)) || new Set(order).size !== order.length) throw new RulesError('Put each of those cards in order.');
    for (const id of order) moveObject(g, id, 'library', ctx.events, { position: 'bottom' });
    return true;
  },

  clash(_node, ctx) {
    const g = ctx.g;
    const memo = ctx.memo as { opponent?: PlayerId; cards?: Record<PlayerId, string | null>; order?: PlayerId[]; asked?: number; bottom?: PlayerId[] };
    if (!memo.opponent) {
      const opponents = livePlayers(g).filter((p) => p !== ctx.controller);
      if (!opponents.length) return true;
      const answer = answerOf(ctx, 'choose_option');
      if (answer) {
        const p = opponents.find((x) => x === answer.choice || g.players[x]!.name === answer.choice);
        if (!p) throw new RulesError('Choose an opponent to clash with.');
        memo.opponent = p;
      } else if (opponents.length === 1) memo.opponent = opponents[0]!;
      else return { ask: { kind: 'choose_option', player: ctx.controller, options: opponents.map((p) => g.players[p]!.name), text: 'Choose an opponent to clash with.', sourceName: sourceName(ctx) } };
    }
    if (!memo.cards) {
      const clashers = apnap(g).filter((p) => p === ctx.controller || p === memo.opponent);
      memo.order = clashers;
      memo.cards = Object.fromEntries(clashers.map((p) => [p, zoneList(g, 'library', p)[0] ?? null]));
      for (const p of clashers) if (memo.cards[p]) ctx.events.push({ type: 'revealed', player: p, objects: [memo.cards[p]!] });
      memo.asked = 0;
      memo.bottom = [];
    } else {
      // The answer to the last "put it on the bottom?" question.
      const answer = answerOf(ctx, 'may');
      const p = memo.order![memo.asked!]!;
      if (answer?.yes) memo.bottom!.push(p);
      memo.asked!++;
    }
    for (; memo.asked! < memo.order!.length; memo.asked!++) {
      const p = memo.order![memo.asked!]!;
      const card = memo.cards[p];
      if (!card) continue;
      return { ask: { kind: 'may', player: p, text: `Put ${nameOf(g, g.objects[card]!)} on the bottom of your library? (Otherwise it stays on top.)`, sourceName: sourceName(ctx) } };
    }
    // CR 701.30c: the cards move at the same time; CR 701.30d: the higher mana value wins.
    const mv = (p: PlayerId) => (memo.cards![p] ? manaValueOf(g, g.objects[memo.cards![p]!]!) : -1);
    for (const p of memo.bottom!) moveObject(g, memo.cards[p]!, 'library', ctx.events, { position: 'bottom' });
    for (const p of memo.order!) {
      const won = memo.cards[p] !== null && memo.order!.every((q) => q === p || mv(p) > mv(q));
      if (p === ctx.controller && ctx.resolution) ctx.resolution.clashWon = won;
      ctx.events.push({ type: 'clashed', player: p, won });
    }
    return true;
  },

  // CR 705.1: flip a coin; "if you win the flip" checks the result (CR 705.2).
  flip_coin(_node, ctx) {
    const won = nextRandom(ctx.g) < 0.5;
    if (ctx.resolution) ctx.resolution.flipWon = won;
    ctx.events.push({ type: 'coin_flip', player: ctx.controller, won });
    return true;
  },

  // "Look at target opponent's hand." — its controller looks (CR 701.20a reveals it to everyone).
  // Mishra's Bauble: "Look at the top card of target player's library." — only the controller sees it.
  look_at_top(node, ctx) {
    const [p] = refPlayers(ctx, ref(node, 'who'));
    if (!p || answerOf(ctx, 'choose_objects')) return true;
    const top = zoneList(ctx.g, 'library', p).slice(0, amountOf(ctx, node.amount));
    if (!top.length) return true;
    return { ask: { kind: 'choose_objects', player: ctx.controller, candidates: [], min: 0, max: 0, text: `Looking at the top of ${ctx.g.players[p]!.name}'s library.`, seen: top } };
  },

  look_at_hand(node, ctx) {
    const [p] = refPlayers(ctx, ref(node, 'who'));
    if (!p || answerOf(ctx, 'choose_objects')) return true;
    const hand = [...zoneList(ctx.g, 'hand', p)];
    if (node.reveal) ctx.events.push({ type: 'revealed', player: p, objects: hand });
    if (!hand.length) return true;
    return { ask: { kind: 'choose_objects', player: ctx.controller, candidates: [], min: 0, max: 0, text: `${node.reveal ? 'Revealed' : 'Looking at'}: ${p}'s hand.`, seen: hand, ...(node.reveal ? { revealed: hand } : {}) } };
  },

  // "You may tap or untap target creature."
  tap_or_untap(node, ctx) {
    const [o] = refObjects(ctx, ref(node, 'what'));
    if (!o || o.zone !== 'battlefield') return true;
    const answer = answerOf(ctx, 'may');
    if (!answer) return { ask: { kind: 'may', player: ctx.controller, text: `Tap ${nameOf(ctx.g, o)}? (No: untap it${node.optional ? ', or leave it' : ''}.)`, sourceName: sourceName(ctx) } };
    setTapped(ctx.g, o.id, answer.yes, ctx.events);
    return true;
  },

  // CR 702.179d: "your speed increases by 1" (to at most 4).
  increase_speed(_node, ctx) {
    const ps = ctx.g.players[ctx.controller]!;
    const speed = Math.min(4, (ps.speed ?? 0) + 1);
    if (speed !== ps.speed) {
      ps.speed = speed;
      ctx.events.push({ type: 'speed', player: ctx.controller, speed });
    }
    return true;
  },

  // CR 731.1: "It becomes night." / "it becomes day"
  day_night(node, ctx) {
    setDayNight(ctx.g, node.to === 'night' ? 'night' : 'day', ctx.events);
    return true;
  },

  // CR 702.171a: "This permanent becomes saddled until end of turn."
  become_saddled(node, ctx) {
    // CR 702.171b: only permanents can become saddled.
    for (const o of refObjects(ctx, node.what ? ref(node, 'what') : { ref: 'self' })) if (o.zone === 'battlefield') o.saddledTurn = ctx.g.turn;
    return true;
  },

  // "Remove a time counter from it."
  remove_counters(node, ctx) {
    // "Remove up to three counters from target permanent": of any kinds, the controller choosing which (CR 122.8).
    if (node.counter === undefined) {
      const objects = refObjects(ctx, ref(node, 'what')).filter((o) => o.zone === 'battlefield');
      if (node.amount === 'all') {
        for (const o of objects)
          for (const [counter, have] of Object.entries(o.counters)) {
            if (!have) continue;
            delete o.counters[counter];
            ctx.events.push({ type: 'counters', object: o.id, counter, delta: -have });
          }
        return true;
      }
      const memo = ctx.memo as { index?: number; left?: number; asked?: string };
      memo.index ??= 0;
      const answer = answerOf(ctx, 'choose_option');
      for (; memo.index < objects.length; memo.index++, memo.left = undefined) {
        const o: GameObject = objects[memo.index]!;
        memo.left ??= Math.max(0, amountOf(ctx, node.amount));
        if (answer && memo.asked === o.id) {
          memo.asked = undefined;
          if (answer.choice === 'Done') continue;
          if (!o.counters[answer.choice]) throw new RulesError('Choose a kind of counter it has.');
          o.counters[answer.choice]!--;
          if (!o.counters[answer.choice]) delete o.counters[answer.choice];
          ctx.events.push({ type: 'counters', object: o.id, counter: answer.choice, delta: -1 });
          memo.left--;
        }
        const kinds: string[] = Object.keys(o.counters).filter((k) => (o.counters[k] ?? 0) > 0);
        if (memo.left <= 0 || !kinds.length) continue;
        // Only one kind and no choice of how many: remove them.
        if (kinds.length === 1 && !node.upTo) {
          const k = kinds[0]!;
          const n = Math.min(memo.left, o.counters[k]!);
          o.counters[k]! -= n;
          if (!o.counters[k]) delete o.counters[k];
          ctx.events.push({ type: 'counters', object: o.id, counter: k, delta: -n });
          continue;
        }
        memo.asked = o.id;
        const options = node.upTo ? [...kinds, 'Done'] : kinds;
        return { ask: { kind: 'choose_option', player: ctx.controller, options, text: `Remove a counter from ${nameOf(ctx.g, o)} (${memo.left} left).`, sourceName: sourceName(ctx) } };
      }
      return true;
    }
    const counter = String(node.counter);
    for (const o of refObjects(ctx, ref(node, 'what'))) {
      const have = o.counters[counter] ?? 0;
      // "Remove a fade counter from it. If you can't, sacrifice it." (CR 702.32a)
      if (node.ifCant && have < amountOf(ctx, node.amount)) return { expand: node.ifCant as EffectNode[] };
      const n = Math.min(have, amountOf(ctx, node.amount));
      if (n <= 0) continue;
      o.counters[counter] = have - n;
      if (!o.counters[counter]) delete o.counters[counter];
      ctx.events.push({ type: 'counters', object: o.id, counter, delta: -n });
    }
    return true;
  },

  // Braids, Arisen Nightmare: "each opponent may sacrifice a permanent of their choice that shares a card type with it. For
  // each opponent who doesn't, that player loses 2 life and you draw a card." — each opponent in turn order (CR 101.4)
  // decides; then those who do, do it, and the rest are punished.
  opponents_may(node, ctx) {
    const g = ctx.g;
    // Will of the Jeskai: "Each player may …" — you too.
    const opponents = apnap(g).filter((p) => (node.everyone || p !== ctx.controller) && livePlayers(g).includes(p));
    const memo = ctx.memo as { i?: number; asking?: PlayerId; out?: EffectNode[] };
    memo.i ??= 0;
    memo.out ??= [];
    const theirs = node.effects as EffectNode[];
    // Show and Tell: "Each player may put an artifact, creature, enchantment, or land card from their hand onto the
    // battlefield." — each chooses in turn, seeing the earlier choices, then they all go at once (CR 101.4).
    const put = theirs.length === 1 && theirs[0]!.type === 'choose_from_hand' && theirs[0]!.then === 'battlefield' ? theirs[0]! : null;
    if (put) {
      const picks = ((memo as { picks?: [PlayerId, ObjectId[]][] }).picks ??= []);
      let answer = answerOf(ctx, 'choose_objects');
      for (; memo.i < opponents.length; memo.i++) {
        const p = opponents[memo.i]!;
        const pctx = { ...ctx, controller: p };
        const n = amountOf(pctx, put.amount ?? 1);
        const filter = liveFilter(pctx, { ...((put.filter ?? {}) as ObjectFilter), zone: 'hand' as const });
        const candidates = zoneList(g, 'hand', p).filter((id) => matchesFilter(g, g.objects[id]!, filter, { controller: p, source: ctx.source ?? null }));
        if (!candidates.length) continue;
        if (answer && memo.asking === p) {
          const chosen = answer.objects;
          if (chosen.length > n || new Set(chosen).size !== chosen.length || !chosen.every((id) => candidates.includes(id))) throw new RulesError(`Choose up to ${n >= 99 ? 'any number of' : n} of those cards.`);
          picks.push([p, chosen]);
          memo.asking = undefined;
          answer = null;
          continue;
        }
        memo.asking = p;
        return { ask: { kind: 'choose_objects', player: p, candidates, min: 0, max: Math.min(n, candidates.length), text: `You may put ${n === 1 ? 'a card' : 'any number of cards'} from your hand onto the battlefield.`, sourceName: sourceName(ctx) } };
      }
      for (const [p, ids] of picks) for (const id of ids) if (g.objects[id]?.zone === 'hand') moveObject(g, id, 'battlefield', ctx.events, { controller: p, ...(put.tapped ? { tapped: true } : {}) });
      return true;
    }
    const doIt = (p: PlayerId) => theirs.map((e) => ({ ...structuredClone(e), asPlayer: p }));
    const declined = (p: PlayerId) => ((node.declined as EffectNode[] | undefined) ?? []).map((e) => ({ ...structuredClone(e), eachPlayer: p }));
    const answer = answerOf(ctx, 'may');
    if (answer && memo.asking) {
      memo.out.push(...(answer.yes ? doIt(memo.asking) : declined(memo.asking)));
      memo.asking = undefined;
      memo.i++;
    }
    for (; memo.i < opponents.length; memo.i++) {
      const p = opponents[memo.i]!;
      if (!theirs.every((e) => feasible(e, { ...ctx, controller: p }, p))) {
        memo.out.push(...declined(p));
        continue;
      }
      memo.asking = p;
      return { ask: { kind: 'may', player: p, text: describeEffects(theirs), sourceName: sourceName(ctx) } };
    }
    return { expand: memo.out };
  },

  // Baleful Mastery: "an opponent draws a card" — the controller chooses one of their opponents as it resolves.
  choose_opponent(node, ctx) {
    const g = ctx.g;
    const opponents = livePlayers(g).filter((p) => p !== ctx.controller);
    if (!opponents.length || !ctx.resolution) return true;
    const answer = answerOf(ctx, 'choose_option');
    if (opponents.length === 1) ctx.resolution.chosenOpponent = opponents[0]!;
    else if (answer) {
      const p = opponents.find((x) => g.players[x]!.name === answer.choice || x === answer.choice);
      if (!p) throw new RulesError('Choose an opponent.');
      ctx.resolution.chosenOpponent = p;
    } else return { ask: { kind: 'choose_option', player: ctx.controller, options: opponents.map((p) => g.players[p]!.name), text: 'Choose an opponent.', sourceName: sourceName(ctx) } };
    return true;
  },

  // CR 702.112a: "it becomes renowned".
  become_renowned(node, ctx) {
    for (const o of refObjects(ctx, { ref: 'self' })) if (o.zone === 'battlefield') o.renowned = true;
    return true;
  },

  monstrosity(node, ctx) {
    // CR 701.37a: if it isn't monstrous, put N +1/+1 counters on it and it becomes monstrous.
    for (const o of refObjects(ctx, { ref: 'self' })) {
      if (o.zone !== 'battlefield' || o.monstrous) continue;
      const n = amountOf(ctx, node.amount);
      addCounters(ctx, o, '+1/+1', n);
      o.monstrous = true;
      ctx.events.push({ type: 'became_monstrous', object: o.id, amount: n });
    }
    return true;
  },

  explore(node, ctx) {
    // CR 701.44a: reveal the top card of your library. A land goes into your hand; otherwise put a
    // +1/+1 counter on the permanent, then you may put the card into your graveyard.
    const memo = ctx.memo as { card?: string; explorer?: string };
    const answer = answerOf(ctx, 'may');
    if (answer && memo.card) {
      const card = ctx.g.objects[memo.card];
      if (answer.yes && card?.zone === 'library') moveObject(ctx.g, card.id, 'graveyard', ctx.events);
      return true;
    }
    const [o] = refObjects(ctx, ref(node, 'what'));
    if (!o) return true;
    const player = o.controller;
    const top = zoneList(ctx.g, 'library', player)[0];
    if (!top) {
      // CR 701.44b: it still explores, with nothing revealed (and so not a land).
      if (o.zone === 'battlefield') addCounters(ctx, o, '+1/+1', 1);
      ctx.events.push({ type: 'explored', object: o.id, land: false });
      return true;
    }
    ctx.events.push({ type: 'revealed', player, objects: [top] });
    const land = ctx.g.cards[ctx.g.objects[top]!.card]!.faces[0]!.types.includes('Land');
    ctx.events.push({ type: 'explored', object: o.id, land });
    if (land) {
      moveObject(ctx.g, top, 'hand', ctx.events);
      return true;
    }
    if (o.zone === 'battlefield') addCounters(ctx, o, '+1/+1', 1);
    memo.card = top;
    return { ask: { kind: 'may', player, text: `put ${nameOf(ctx.g, ctx.g.objects[top]!)} into your graveyard`, sourceName: sourceName(ctx) } };
  },

  get_counters(node, ctx) {
    // CR 122.1: counters on a player ("you get {E}{E}").
    const n = amountOf(ctx, node.amount);
    for (const p of refPlayers(ctx, ref(node, 'who'))) {
      const ps = ctx.g.players[p]!;
      // CR 122.1f / 104.3d: poison counters (ten or more and the player loses).
      if (node.counter === 'poison') {
        ps.poison += n;
        ctx.events.push({ type: 'player_counters', player: p, counter: 'poison', delta: n });
        continue;
      }
      const counters = (ps.counters ??= {});
      counters[String(node.counter)] = (counters[String(node.counter)] ?? 0) + n;
      ctx.events.push({ type: 'player_counters', player: p, counter: String(node.counter), delta: n });
    }
    return true;
  },

  exile_top(node, ctx) {
    // "Exile the top card of your library. Until the end of your next turn, you may play that card."
    const g = ctx.g;
    const n = amountOf(ctx, node.amount);
    const play = node.play as { mode: 'play' | 'cast'; until: 'eot' | 'next_turn' | 'during_next_turn' | 'exiled' | 'next_end_step'; free?: true; anyColor?: true | 'type' } | undefined;
    const exiled: { id: string; zcc: number }[] = [];
    for (const p of refPlayers(ctx, ref(node, 'who'))) {
      for (const id of zoneList(g, 'library', p).slice(0, n)) {
        moveObject(g, id, 'exile', ctx.events);
        const o = g.objects[id]!;
        // "Exile the top card of your library face down." — no one may look at it (CR 406.3a).
        if (node.faceDown) o.hiddenFor = '';
        // CR 607.2a: "cards exiled with ~" — linked to the object whose ability exiled them.
        const src = ctx.source;
        if (src && src.id !== id && src.zone !== 'stack') o.exiledBy = { id: src.id, zcc: battlefieldZcc(g, src) };
        exiled.push({ id, zcc: o.zcc });
        if (play) {
          // "During your next turn, you may play that card." — that turn only.
          // "for as long as it remains exiled": until it leaves (the permission follows this object, CR 400.7).
          const lastTurn = play.until === 'exiled' ? Number.MAX_SAFE_INTEGER : play.until === 'next_end_step' ? nextEndStepTurn(g, ctx.controller) : lastTurnOf(g, ctx.controller, play.until === 'eot' ? 'eot' : 'next_turn');
          (g.mayPlay ??= []).push({ object: { id, zcc: o.zcc }, player: ctx.controller, mode: play.mode, lastTurn, ...(play.until === 'during_next_turn' ? { firstTurn: lastTurn } : {}), ...(play.until === 'next_end_step' ? { untilEndStep: true as const } : {}), ...(play.free ? { free: true as const } : {}), ...(play.anyColor ? { anyColor: play.anyColor } : {}) });
        }
      }
    }
    // "that card", "those cards" in what follows.
    if (ctx.resolution) ctx.resolution.created = exiled;
    return true;
  },

  exile_on_leave(node, ctx) {
    // CR 614.1a: a replacement on this object only (it ends when the object changes zones, CR 400.7).
    for (const o of refObjects(ctx, ref(node, 'what'))) if (o.zone === 'battlefield') o.exileWhenLeaves = true;
    return true;
  },

  class_level(node, ctx) {
    // CR 716.2a: "This Class's level becomes N."
    const o = refObjects(ctx, { ref: 'self' })[0];
    if (!o || o.zone !== 'battlefield') return true;
    o.classLevel = Number(node.level);
    ctx.events.push({ type: 'class_level', object: o.id, level: o.classLevel });
    return true;
  },

  skip_untap(node, ctx) {
    // "doesn't untap during its controller's next untap step" (CR 502.3 lets effects stop the untap).
    for (const o of refObjects(ctx, ref(node, 'what'))) if (o.zone === 'battlefield') o.skipUntap = (o.skipUntap ?? 0) + 1;
    return true;
  },

  proliferate(node, ctx) {
    // CR 701.34a: choose any number of permanents and/or players with counters; each gets one more of each kind.
    const g = ctx.g;
    // Tekuthal, Inquiry Dominus: "If you would proliferate, proliferate twice instead." (CR 614.1a; each once, CR 614.5)
    if (!node.replaced) {
      const k = abilitySources(g).filter((id) => g.objects[id]!.controller === ctx.controller && objectAbilities(g, g.objects[id]!).some((a) => a.kind === 'static' && a.effect.type === 'replace_quantity' && a.effect.event === 'proliferate')).length;
      if (k) return { expand: Array.from({ length: 2 ** k }, () => ({ type: 'proliferate', replaced: true })) };
    }
    const objects = g.zones.battlefield.filter((id) => Object.values(g.objects[id]!.counters).some((n) => n > 0));
    const players = livePlayers(g).filter((p) => g.players[p]!.poison > 0 || Object.values(g.players[p]!.counters ?? {}).some((n) => n > 0));
    const answer = answerOf(ctx, 'proliferate');
    // Ezuri, Stalker of Spheres: "Whenever you proliferate" — even choosing nothing (CR 701.34a).
    if (!answer && !objects.length && !players.length) {
      ctx.events.push({ type: 'proliferated', player: ctx.controller });
      return true;
    }
    if (!answer) return { ask: { kind: 'proliferate', player: ctx.controller, objects, players } };
    ctx.events.push({ type: 'proliferated', player: ctx.controller });
    if (!answer.objects.every((id) => objects.includes(id)) || !answer.players.every((p) => players.includes(p))) {
      throw new RulesError('Choose only permanents and players that have counters.');
    }
    for (const id of new Set(answer.objects)) {
      const o = g.objects[id]!;
      for (const [counter, n] of Object.entries(o.counters)) if (n > 0) addCounters(ctx, o, counter, 1);
    }
    for (const p of new Set(answer.players)) {
      const ps = g.players[p]!;
      if (ps.poison > 0) ps.poison++;
      for (const [counter, n] of Object.entries(ps.counters ?? {})) {
        if (n <= 0) continue;
        ps.counters![counter] = n + 1;
        ctx.events.push({ type: 'player_counters', player: p, counter, delta: 1 });
      }
    }
    return true;
  },

  connive(node, ctx) {
    // CR 701.50a: draw a card, then discard a card; if it was a nonland card, put a +1/+1 counter on the conniver.
    const memo = ctx.memo as { drew?: boolean; who?: PlayerId; n?: number; conniver?: { id: string; zcc: number } };
    const answer = answerOf(ctx, 'discard');
    if (!memo.drew) {
      // CR 701.50d: "connives N" — draw N, discard N; CR 701.50e: connive 0 is nothing.
      const n = node.amount !== undefined ? Math.max(0, amountOf(ctx, node.amount)) : 1;
      if (n === 0) return true;
      const [o] = refObjects(ctx, ref(node, 'what'));
      // CR 701.50b: if it's gone, its last known controller still connives.
      const who = o?.controller ?? ctx.controller;
      memo.drew = true;
      memo.who = who;
      memo.n = n;
      if (o) memo.conniver = { id: o.id, zcc: o.zcc };
      for (let i = 0; i < n; i++) drawCard(ctx.g, who, ctx.events);
    }
    const who = memo.who!;
    const n = memo.n ?? 1;
    const hand = zoneList(ctx.g, 'hand', who);
    const count = Math.min(n, hand.length);
    let discarded: string[];
    if (answer) {
      if (answer.objects.length !== count || new Set(answer.objects).size !== count || !answer.objects.every((id) => hand.includes(id))) throw new RulesError(count === 1 ? 'Choose one card from your hand to discard.' : `Choose ${count} cards from your hand to discard.`);
      discarded = answer.objects;
    } else if (hand.length > count) {
      return { ask: { kind: 'discard', player: who, count } };
    } else discarded = [...hand];
    if (!discarded.length) return true;
    let nonland = 0;
    for (const id of discarded) {
      const card = ctx.g.objects[id]!;
      if (!ctx.g.cards[card.card]!.faces[card.face]!.types.includes('Land')) nonland++;
      discardCard(ctx.g, id, ctx.events);
    }
    const c = memo.conniver && ctx.g.objects[memo.conniver.id];
    if (nonland && c && c.zcc === memo.conniver!.zcc && c.zone === 'battlefield') addCounters(ctx, c, '+1/+1', nonland);
    return true;
  },

  amass(node, ctx) {
    // CR 701.47a: create a 0/0 black [subtype] Army if you control no Army; then N +1/+1 counters on an Army you control.
    const g = ctx.g;
    const subtype = String(node.subtype ?? 'Army');
    const armies = () => g.zones.battlefield.filter((id) => g.objects[id]!.controller === ctx.controller && chars(g, g.objects[id]!).subtypes.includes('Army'));
    const answer = answerOf(ctx, 'choose_objects');
    let army: string | undefined;
    if (answer) {
      army = answer.objects[0];
      if (!army || !armies().includes(army)) throw new RulesError('Choose an Army creature you control.');
    } else {
      if (!armies().length) {
        const face: FaceDef = {
          name: `${subtype} Army`, manaCost: '', typeLine: `Creature — ${subtype} Army`, supertypes: [], types: ['Creature'],
          subtypes: [...new Set([subtype, 'Army'])], oracle: '', colors: ['B'], keywords: [], abilities: [], unparsed: [], power: '0', toughness: '0',
        };
        createToken(g, face, ctx.controller, ctx.events);
      }
      const list = armies();
      if (list.length > 1) return { ask: { kind: 'choose_objects', player: ctx.controller, candidates: list, min: 1, max: 1, text: 'Choose an Army creature you control.' } };
      army = list[0];
    }
    if (army) addCounters(ctx, g.objects[army]!, '+1/+1', amountOf(ctx, node.amount));
    return true;
  },

  // CR 701.49: venture into the dungeon (CR 701.49d: "venture into Undercity" brings in only Undercity).
  venture(node, ctx) {
    const g = ctx.g;
    const p = ctx.controller;
    const answer = answerOf(ctx, 'choose_option');
    const room = currentRoom(g, p);
    const start = (): EffectResult => {
      // CR 309.2a / 701.49a: bring a dungeon into the command zone, the marker on its topmost room.
      const options = dungeonChoices(g, Boolean(node.undercity));
      if (!options.length) return true;
      let card = options[0]!;
      if (options.length > 1) {
        const names = options.map((k) => g.cards[k]!.name);
        if (!answer) return { ask: { kind: 'choose_option', player: p, options: names, text: 'Choose a dungeon to venture into.', sourceName: sourceName(ctx) } };
        const i = names.indexOf(answer.choice);
        if (i < 0) throw new RulesError('Choose one of the dungeons.');
        card = options[i]!;
      }
      enterDungeon(g, p, card, ctx.events);
      return true;
    };
    if (!room) return start();
    // CR 701.49c: from the bottommost room, the dungeon is completed and a new one begins.
    if (!room.leadsTo.length) {
      completeDungeon(g, p, ctx.events);
      return start();
    }
    // CR 701.49b: follow an arrow to an adjacent room (choosing, if there are several).
    if (room.leadsTo.length === 1) {
      moveToRoom(g, p, room.leadsTo[0]!, ctx.events);
      return true;
    }
    if (!answer) return { ask: { kind: 'choose_option', player: p, options: room.leadsTo, text: `Venture from ${room.name}: choose the next room.`, sourceName: sourceName(ctx) } };
    if (!room.leadsTo.includes(answer.choice)) throw new RulesError('Choose one of the rooms.');
    moveToRoom(g, p, answer.choice, ctx.events);
    return true;
  },

  // CR 726.3: "You take the initiative" (whoever had it stops having it).
  take_initiative(node, ctx) {
    for (const p of refPlayers(ctx, ref(node, 'who'))) {
      ctx.g.initiative = p;
      ctx.events.push({ type: 'initiative', player: p });
    }
    return true;
  },

  // CR 509.1b: "Target creature can't block ~ this turn."
  cant_block_attacker(node, ctx) {
    const attacker = refObjects(ctx, ref(node, 'attacker'))[0];
    if (!attacker) return true;
    for (const o of refObjects(ctx, ref(node, 'what'))) {
      if (o.zone === 'battlefield') (o.cantBlockThis ??= []).push({ attacker: { id: attacker.id, zcc: attacker.zcc }, turn: ctx.g.turn });
    }
    return true;
  },

  // CR 509.1c: "Target creature blocks ~ this turn if able", "… blocks this turn if able".
  must_block(node, ctx) {
    const attacker = node.attacker ? refObjects(ctx, ref(node, 'attacker'))[0] : undefined;
    if (node.attacker && !attacker) return true;
    for (const o of refObjects(ctx, ref(node, 'what'))) {
      if (o.zone !== 'battlefield') continue;
      (o.mustBlock ??= []).push({ ...(attacker ? { attacker: { id: attacker.id, zcc: attacker.zcc } } : {}), turn: ctx.g.turn });
    }
    return true;
  },

  // CR 709.5f: "Unlock a locked door of target Room you control" — the first locked one.
  unlock(node, ctx) {
    for (const o of refObjects(ctx, ref(node, 'what'))) {
      if (o.zone !== 'battlefield' || !o.unlocked) continue;
      const half = o.unlocked[0] ? 1 : 0;
      if (!o.unlocked[half]) unlockHalf(ctx.g, o, half, ctx.events);
    }
    return true;
  },

  // CR 702.26: "Target creature phases out." (It phases in during its controller's next untap step.)
  phase_out(node, ctx) {
    for (const o of refObjects(ctx, ref(node, 'what'))) if (o.zone === 'battlefield' && !o.phasedOut) phaseOut(ctx.g, o, ctx.events);
    return true;
  },

  // CR 500.8: "After this phase, there is an additional combat phase [followed by an additional main phase]."
  extra_combat(node, ctx) {
    (ctx.g.extraPhases ??= []).push({ main: Boolean(node.main) });
    return true;
  },

  // CR 707.2 / 613.2a: "~ becomes a copy of target creature [until end of turn][, except …]" — layer 1.
  become_copy(node, ctx) {
    const g = ctx.g;
    const of = refObjects(ctx, ref(node, 'of'))[0];
    if (!of) return true;
    const except = { ...((node.except ?? {}) as CopyExcept) };
    if (except.keepThisAbility) {
      delete except.keepThisAbility;
      const entry = ctx.resolution?.entry;
      const text = entry?.kind === 'ability' ? entry.text : undefined;
      const ability = ctx.source && text ? faceOf(g, ctx.source).abilities.find((a) => a.text === text) : undefined;
      if (ability) except.abilities = [structuredClone(ability)];
    }
    const to = withExceptions(g, copiable(of), except);
    for (const o of refObjects(ctx, ref(node, 'what'))) {
      if (o.zone !== 'battlefield') continue;
      if (node.until === 'eot') (o.copyRevert ??= []).push(o.copyOf ? { ...o.copyOf } : null);
      o.copyOf = { ...to };
    }
    return true;
  },

  // CR 702.174: the promised opponent gets the gift ("Gift a card": they draw a card; "Gift a Food": they create a Food).
  give_gift(node, ctx) {
    const to = ctx.source?.cast?.giftTo;
    if (!to || !livePlayers(ctx.g).includes(to)) return true;
    for (const effect of (node.effects ?? []) as EffectNode[]) {
      const r = runEffect(effect, { ...ctx, controller: to, memo: {} });
      if (r !== true) return false;
    }
    return true;
  },

  // CR 701.54a: "The Ring tempts you" — choose a creature you control as your Ring-bearer (getting the emblem first).
  ring_tempts(node, ctx) {
    const g = ctx.g;
    const p = ctx.controller;
    const creatures = g.zones.battlefield.filter((id) => g.objects[id]!.controller === p && hasType(g, g.objects[id]!, 'Creature'));
    let chosen = creatures[0];
    if (creatures.length > 1) {
      const answer = answerOf(ctx, 'choose_objects');
      if (!answer) return { ask: { kind: 'choose_objects', player: p, candidates: creatures, min: 1, max: 1, text: 'The Ring tempts you: choose your Ring-bearer.' } };
      if (answer.objects.length !== 1 || !creatures.includes(answer.objects[0]!)) throw new RulesError('Choose one creature you control.');
      chosen = answer.objects[0];
    }
    const ps = g.players[p]!;
    ps.ringTempted = (ps.ringTempted ?? 0) + 1;
    for (const o of Object.values(g.objects)) if (o.ringBearer === p && o.id !== chosen) delete o.ringBearer;
    if (chosen) g.objects[chosen]!.ringBearer = p;
    ctx.events.push({ type: 'ring_tempted', player: p, ...(chosen ? { object: chosen } : {}) });
    return true;
  },

  become_monarch(node, ctx) {
    // CR 725.3: only one player is the monarch; the current one stops being it.
    for (const p of refPlayers(ctx, ref(node, 'who'))) {
      if (ctx.g.monarch === p) continue;
      ctx.g.monarch = p;
      ctx.events.push({ type: 'monarch', player: p });
    }
    return true;
  },

  may_pay(node, ctx) {
    // CR 118.12: "You may pay {2}. If you do, …" — the payment is a cost paid on resolution.
    // "You may pay {1} for each age counter on it. If you don't, sacrifice it." (CR 702.24a).
    const answer = answerOf(ctx, 'pay');
    const n = node.times ? (ctx.memo.times as number | undefined) ?? amountOf(ctx, node.times) : 1;
    ctx.memo.times = n;
    // Primordial Ooze: "you may pay {X}, where X is the number of +1/+1 counters on it" — counted as it resolves.
    const fixedX = node.xIs !== undefined ? ((ctx.memo.xIs as number | undefined) ?? Math.max(0, amountOf(ctx, node.xIs as Amount))) : undefined;
    if (fixedX !== undefined) ctx.memo.xIs = fixedX;
    const cost = String(node.cost ?? '').replace(/\{X\}/g, fixedX !== undefined ? `{${fixedX}}` : '{X}').repeat(Math.max(0, n));
    // "Cumulative upkeep—Pay 1 life": life for each age counter (CR 119.4). Mask of Griselbrand: "you may pay X life, where
    // X is its power"; Necrodominance: "you may pay any amount of life" (`lifeX`: X chosen as it's paid).
    const lifeX = Boolean(node.lifeX);
    const chosenLife = lifeX && fixedX === undefined;
    let life = lifeX ? (fixedX ?? 0) : Number(node.life ?? 0) * Math.max(0, n);
    const otherwise = fixedX !== undefined ? bindX((node.else as EffectNode[] | undefined) ?? [], fixedX) : ((node.else as EffectNode[] | undefined) ?? []);
    if (!cost && !life && !chosenLife) return { expand: lifeX ? bindX(node.effects as EffectNode[], 0) : (node.effects as EffectNode[]) };
    // Dance of the Dead: "that player may pay {1}{B}" — someone other than the ability's controller.
    const payer = node.payer ? refPlayers(ctx, ref(node, 'payer'))[0] : ctx.controller;
    if (!payer) return { expand: otherwise };
    // "You may pay {X}. If you do, draw X cards." — the payer chooses X as they pay (CR 107.1c); "where X is less than or
    // equal to the amount of life you gained" bounds it.
    const hasX = cost.includes('{X}') || chosenLife;
    const maxX = chosenLife ? ctx.g.players[payer]!.life : hasX && node.maxX !== undefined ? Math.max(0, amountOf(ctx, node.maxX as Amount)) : undefined;
    if (!answer) {
      const price = [cost, chosenLife ? 'X life' : life ? `${life} life` : ''].filter(Boolean).join(' and ');
      const text = `pay ${price}: ${describeEffects(node.effects as EffectNode[])}${otherwise.length ? `, or else ${describeEffects(otherwise)}` : ''}`;
      return { ask: { kind: 'pay', player: payer, cost, text, sourceName: sourceName(ctx), ...(hasX ? { x: maxX !== undefined ? { max: Math.max(0, maxX) } : {} } : {}) } };
    }
    if (!answer.pay) return { expand: otherwise };
    const x = hasX ? (answer.x ?? 0) : 0;
    if (chosenLife) life = x;
    if (!Number.isInteger(x) || x < 0) throw new RulesError('X must be a whole number, 0 or more.');
    if (maxX !== undefined && x > maxX) throw new RulesError(`X can’t be greater than ${maxX}.`);
    const ps = ctx.g.players[payer]!;
    if (life && ps.life < life) throw new RulesError(`You don’t have ${life} life to pay.`);
    if (cost) payDuringResolution(ctx.g, payer, cost, ctx.events, x);
    if (life) {
      const lost = lifeLoss(ctx.g, payer, life);
      ps.life -= lost;
      ctx.events.push({ type: 'life', player: payer, delta: -lost, life: ps.life });
    }
    return { expand: hasX || fixedX !== undefined ? bindX(node.effects as EffectNode[], fixedX ?? x) : (node.effects as EffectNode[]) };
  },


  unless_pays(node, ctx) {
    // CR 118.12a: "[Do something] unless [a player] pays [cost]" — that player chooses whether to pay.
    const payer = refPlayers(ctx, ref(node, 'payer'))[0];
    // "{X}, where X is this creature's power": counted now.
    // Volatile Stormdrake: "an amount of {E} equal to its mana value".
    const cost = node.costX !== undefined ? `{${Math.max(0, amountOf(ctx, node.costX))}}` : node.costEnergy !== undefined ? '{E}'.repeat(Math.max(0, amountOf(ctx, node.costEnergy))) : String(node.cost);
    if (!payer) return { expand: node.effects as EffectNode[] };
    const answer = answerOf(ctx, 'pay');
    if (!answer) {
      const text = `pay ${cost}, or else: ${describeEffects(node.effects as EffectNode[])}`;
      return { ask: { kind: 'pay', player: payer, cost, text, sourceName: sourceName(ctx) } };
    }
    if (!answer.pay) return { expand: node.effects as EffectNode[] };
    // CR 119.4: life can be paid only if the life total is at least that much.
    const life = Number(node.life ?? 0);
    if (life && ctx.g.players[payer]!.life < life) throw new RulesError(`You don’t have ${life} life to pay.`);
    if (cost) payDuringResolution(ctx.g, payer, cost, ctx.events);
    if (life) {
      const ps = ctx.g.players[payer]!;
      const lost = lifeLoss(ctx.g, payer, life);
      ps.life -= lost;
      ctx.events.push({ type: 'life', player: payer, delta: -lost, life: ps.life });
    }
    return { expand: [] };
  },

  unless_does(node, ctx) {
    // "… unless that player discards a card": they choose whether to (only if they can).
    // Tergrid's Lantern: "… unless they sacrifice a nonland permanent of their choice or discard a card" — one of them.
    // Torment of Scarabs-style "each opponent loses 3 life unless that player …" (`perPlayer`): each of them, in APNAP
    // order (CR 101.4), the actions and the punishment being theirs (`asPlayer`).
    if (node.perPlayer || node.actions) {
      const players = node.perPlayer ? apnap(ctx.g).filter((p) => refPlayers(ctx, ref(node, 'perPlayer')).includes(p)) : refPlayers(ctx, ref(node, 'payer')).slice(0, 1);
      const actions = (node.actions as EffectNode[][] | undefined) ?? [node.action as EffectNode[]];
      const memo = ctx.memo as { i?: number; picks?: number[] };
      memo.i ??= 0;
      memo.picks ??= [];
      const as = (p: PlayerId, list: EffectNode[]) => (node.perPlayer ? list.map((e) => ({ ...structuredClone(e), asPlayer: p })) : list);
      let answer = answerOf(ctx, 'choose_option');
      for (; memo.i < players.length; memo.i++) {
        const p = players[memo.i]!;
        const able = actions.map((a, k) => (a.every((e) => feasible(e, { ...ctx, controller: node.perPlayer ? p : ctx.controller }, p)) ? k : -1)).filter((k) => k >= 0);
        if (!able.length) {
          memo.picks.push(-1);
          continue;
        }
        const labels = [...able.map((k) => describeEffects(actions[k]!)), `Neither: ${describeEffects(node.effects as EffectNode[])}`];
        if (answer && memo.picks.length === memo.i) {
          const at = labels.indexOf(answer.choice);
          if (at < 0) throw new RulesError('Choose one of the options.');
          memo.picks.push(at < able.length ? able[at]! : -1);
          // That answer was this player's.
          answer = null;
          continue;
        }
        return { ask: { kind: 'choose_option', player: p, options: labels, text: `${describeEffects(node.effects as EffectNode[])} unless you do one of these.`, sourceName: sourceName(ctx) } };
      }
      return { expand: players.flatMap((p, i) => (memo.picks![i]! >= 0 ? as(p, actions[memo.picks![i]!]!) : as(p, node.effects as EffectNode[]))) };
    }
    const payer = refPlayers(ctx, ref(node, 'payer'))[0];
    const action = node.action as EffectNode[];
    if (!payer || !action.every((e) => feasible(e, { ...ctx, controller: payer }))) return { expand: node.effects as EffectNode[] };
    const answer = answerOf(ctx, 'pay');
    if (!answer) {
      const text = `${describeEffects(action)}, or else: ${describeEffects(node.effects as EffectNode[])}`;
      return { ask: { kind: 'pay', player: payer, cost: describeEffects(action), text, sourceName: sourceName(ctx) } };
    }
    return { expand: answer.pay ? action : (node.effects as EffectNode[]) };
  },

  search(node, ctx) {
    // CR 701.23a: look through the library for cards matching the description.
    const g = ctx.g;
    // Field of Ruin: "Each player searches their library for a basic land card, …" — each in turn (APNAP, CR 101.4).
    if (node.who && (ref(node, 'who') as { ref: string }).ref === 'players') {
      const players = refPlayers(ctx, ref(node, 'who'));
      const order = apnap(g).filter((p) => players.includes(p));
      return { expand: order.map((p) => ({ ...structuredClone(node), who: { ref: 'you' }, asPlayer: p })) };
    }
    // "Target player may search their library …": that player searches.
    const player = node.who ? refPlayers(ctx, ref(node, 'who'))[0] : ctx.controller;
    if (!player) return true;
    // "Search target opponent's library for …": you search theirs.
    const owner = node.library ? refPlayers(ctx, ref(node, 'library'))[0] : player;
    if (!owner) return true;
    const library = zoneList(g, 'library', owner);
    // "with mana value X or less": the spell's X, or what the text says X is (Eldritch Evolution).
    const anyOf = node.filters ? { anyOf: (node.filters as ObjectFilter[]).map((f) => ({ ...f })) } : {};
    const filter = liveFilter(ctx, { ...(node.filter as ObjectFilter), ...anyOf, zone: 'library' as const });
    // "Search your library and/or graveyard": cards in those zones too.
    const zones = ((node.zones as string[] | undefined) ?? ['library']) as ('library' | 'graveyard' | 'hand')[];
    // Aven Mindcensor: "If an opponent would search a library, that player searches the top four cards of that library
    // instead." (CR 701.23a, 614.1a)
    const searchable = (z: string) => (z === 'library' && playerRule(g, player, 'search_top_four') ? zoneList(g, 'library', owner).slice(0, 4) : zoneList(g, z as 'library', owner));
    const candidates = zones.flatMap((z) => searchable(z).filter((id) => matchesFilter(g, g.objects[id]!, { ...filter, zone: z }, { controller: player, source: ctx.source ?? null })));
    const count = amountOf(ctx, node.amount);
    // CR 701.23b: with a stated quality the player may find fewer; CR 701.23d: "a card" must be found if possible.
    const quality = Object.keys(filter).some((k) => k !== 'zone' && k !== 'owner');
    const mustFind = !quality && !node.upTo;
    const memo = ctx.memo as { found?: ObjectId[] };
    const split = node.split as { to: 'battlefield'; tapped?: true } | undefined;
    // Opposition Agent: "You control your opponents while they're searching their libraries. While an opponent is
    // searching their library, they exile each card they find." (CR 722: controlling another player.)
    const hijack = owner === player ? searchHijack(g, player) : {};
    let chosen: ObjectId[];
    if (memo.found) chosen = memo.found;
    else {
      const answer = answerOf(ctx, 'search');
      if (!answer) {
        if (library.length === 0 && zones.length === 1) {
          ctx.events.push({ type: 'searched', player, owner });
          return true;
        }
        return { ask: { kind: 'search', player: hijack.chooser ?? player, candidates, count, mustFind, text: describeSearch(node, count), ...(node.sameLandType ? { sameLandType: true as const } : {}) } };
      }
      if (zones.includes('library')) ctx.events.push({ type: 'searched', player, owner });
      chosen = answer.objects;
      // Krosan Verge: "a Forest card and a Plains card" — one card for each description.
      const filters = node.filters as ObjectFilter[] | undefined;
      if (filters) {
        const fits = (ids: ObjectId[], fs: ObjectFilter[]): boolean =>
          !ids.length || fs.some((f, i) => matchesFilter(g, g.objects[ids[0]!]!, { ...liveFilter(ctx, f), zone: 'library' }, { controller: player, source: ctx.source ?? null }) && fits(ids.slice(1), fs.filter((_, j) => j !== i)));
        if (chosen.length > filters.length || new Set(chosen).size !== chosen.length || !chosen.every((id) => candidates.includes(id)) || !fits(chosen, filters)) {
          throw new RulesError('Choose at most one card for each description.');
        }
      }
      const need = filters ? 0 : mustFind ? Math.min(count, candidates.length) : 0;
      if (chosen.length > count || chosen.length < need || new Set(chosen).size !== chosen.length || !chosen.every((id) => candidates.includes(id))) {
        throw new RulesError(mustFind ? `Choose ${need} card(s).` : `Choose up to ${count} matching card(s).`);
      }
      // Myriad Landscape: "up to two basic land cards that share a land type".
      if (node.sameLandType && chosen.length > 1) {
        const types = (id: ObjectId) => chars(g, g.objects[id]!).subtypes;
        const common = types(chosen[0]!).filter((t) => chosen.every((id) => types(id).includes(t)));
        if (!common.length) throw new RulesError('The cards must share a land type.');
      }
      // Opposition Agent: what they find is exiled, and its controller may play it (spending mana as though any color).
      if (hijack.exiler) {
        for (const id of chosen) {
          if (g.objects[id]?.zone !== 'library') continue;
          moveObject(g, id, 'exile', ctx.events);
          const o = g.objects[id]!;
          (g.mayPlay ??= []).push({ object: { id, zcc: o.zcc }, player: hijack.exiler, mode: 'play', lastTurn: Number.MAX_SAFE_INTEGER, anyColor: true });
        }
        chosen = chosen.filter((id) => g.objects[id]?.zone !== 'exile');
        if (!chosen.length) {
          shuffleInPlace(g, zoneList(g, 'library', owner));
          ctx.events.push({ type: 'shuffled', player });
          return true;
        }
      }
      // Cultivate: revealed, then the player picks which one goes onto the battlefield.
      if (split && chosen.length) ctx.events.push({ type: 'revealed', player, objects: [...chosen] });
      if (split && chosen.length > 1) {
        memo.found = chosen;
        return { ask: { kind: 'choose_objects', player, candidates: chosen, min: 1, max: 1, text: `Choose the card to put onto the battlefield${split.tapped ? ' tapped' : ''} (the other goes into your hand).` } };
      }
    }
    if (split) {
      const pickAnswer = memo.found ? answerOf(ctx, 'choose_objects') : null;
      if (memo.found && (!pickAnswer || pickAnswer.objects.length !== 1 || !chosen.includes(pickAnswer.objects[0]!))) throw new RulesError('Choose one of the revealed cards.');
      const first = pickAnswer?.objects[0] ?? chosen[0];
      for (const id of chosen) {
        if (id === first) moveObject(g, id, 'battlefield', ctx.events, { controller: player, ...(split.tapped ? { tapped: true } : {}) });
        else moveObject(g, id, 'hand', ctx.events);
      }
      shuffleInPlace(g, zoneList(g, 'library', owner));
      ctx.events.push({ type: 'shuffled', player });
      return true;
    }
    const to = node.to as 'hand' | 'battlefield' | 'graveyard' | 'library' | 'exile';
    if (to !== 'library') {
      for (const id of chosen) {
        // Archdruid's Charm: "Put it onto the battlefield tapped if it's a land card. Otherwise, put it into your hand."
        if (node.landsTo === 'battlefield' && hasType(g, g.objects[id]!, 'Land')) moveObject(g, id, 'battlefield', ctx.events, { controller: player, ...(node.landsTapped ? { tapped: true } : {}) });
        else moveObject(g, id, to, ctx.events, to === 'battlefield' ? { controller: player, ...(node.tapped ? { tapped: true } : {}), ...(node.counters ? { counters: node.counters as Record<string, number> } : {}) } : {});
      }
      // Fabled Passage: "… put it onto the battlefield tapped, then shuffle. Then if …, untap that land." — what was found.
      if (ctx.resolution && chosen.length) ctx.resolution.created = chosen.map((id) => ({ id, zcc: g.objects[id]!.zcc }));
    }
    // CR 701.24a: then the library is shuffled.
    const rest = zoneList(g, 'library', owner);
    if (to === 'library') rest.splice(0, rest.length, ...rest.filter((id) => !chosen.includes(id)));
    shuffleInPlace(g, rest);
    if (to === 'library') rest.unshift(...chosen);
    ctx.events.push({ type: 'shuffled', player });
    return true;
  },

  sacrifice_choice(node, ctx) {
    // CR 701.21a: each player (in APNAP order, CR 101.4) chooses permanents they control and sacrifices them.
    const g = ctx.g;
    const n = amountOf(ctx, node.amount);
    const filter = bindFilter(ctx, (node.filter ?? {}) as ObjectFilter);
    const players = refPlayers(ctx, ref(node, 'who'));
    const done = (ctx.memo.done as PlayerId[] | undefined) ?? [];
    const matching = (p: PlayerId) =>
      g.zones.battlefield.filter((id) => g.objects[id]!.controller === p && matchesFilter(g, g.objects[id]!, filter, { controller: p, source: ctx.source ?? null }));
    // Soul Shatter: "… with the greatest mana value among creatures and planeswalkers they control" (ties: their choice).
    const statOf = (id: ObjectId) => (node.greatest === 'power' ? power(g, g.objects[id]!) : manaValueOf(g, g.objects[id]!));
    const candidatesOf = (p: PlayerId) => {
      const all = matching(p);
      if (!node.greatest || !all.length) return all;
      const most = Math.max(...all.map(statOf));
      return all.filter((id) => statOf(id) === most);
    };
    const answer = answerOf(ctx, 'sacrifice');
    // CR 608.2h: "the sacrificed creature's power" — as it was when it was sacrificed.
    const sacrifice = (o: GameObject, p: PlayerId) => {
      if (ctx.resolution) {
        const lki = (ctx.resolution.lkiThisWay ??= {});
        lki.sacrificed = [...(lki.sacrificed ?? []), lkiStats(g, o)];
      }
      sacrificeObject(g, o, p, ctx.events, node.exploit ? ctx.source?.id : undefined);
    };
    // Scapeshift: "Sacrifice any number of lands."
    if (node.anyNumber) {
      const [p] = players;
      if (!p) return true;
      const candidates = candidatesOf(p);
      const pick = answerOf(ctx, 'choose_objects');
      if (!pick) {
        if (!candidates.length) return true;
        return { ask: { kind: 'choose_objects', player: p, candidates, min: 0, max: candidates.length, text: 'Choose any number of permanents to sacrifice.' } };
      }
      if (new Set(pick.objects).size !== pick.objects.length || !pick.objects.every((id) => candidates.includes(id))) throw new RulesError('Choose among those permanents.');
      for (const id of pick.objects) sacrifice(g.objects[id]!, p);
      return true;
    }
    if (answer) {
      const p = ctx.memo.asking as PlayerId;
      const candidates = candidatesOf(p);
      if (answer.objects.length !== Math.min(n, candidates.length) || new Set(answer.objects).size !== answer.objects.length || !answer.objects.every((id) => candidates.includes(id))) {
        throw new RulesError(`Choose ${Math.min(n, candidates.length)} permanent(s) to sacrifice.`);
      }
      for (const id of answer.objects) sacrifice(g.objects[id]!, p);
      done.push(p);
    }
    for (const p of players) {
      if (done.includes(p)) continue;
      const candidates = candidatesOf(p);
      if (candidates.length <= n) {
        if (!candidates.length) ctx.memo.couldnt = [...((ctx.memo.couldnt as PlayerId[] | undefined) ?? []), p];
        for (const id of candidates) sacrifice(g.objects[id]!, p);
        done.push(p);
        continue;
      }
      ctx.memo.done = done;
      ctx.memo.asking = p;
      return { ask: { kind: 'sacrifice', player: p, candidates, count: n } };
    }
    // Plaguecrafter: "Each player who can't discards a card." — each player who had nothing to sacrifice.
    const couldnt = (ctx.memo.couldnt as PlayerId[] | undefined) ?? [];
    if (node.cant && couldnt.length) return { expand: couldnt.flatMap((p) => (node.cant as EffectNode[]).map((e) => ({ ...structuredClone(e), asPlayer: p }))) };
    return true;
  },

  keep_choose(node, ctx) {
    // Cataclysm, Liliana's −9, Planetary Annihilation: each player chooses permanents they control to keep — one of each
    // listed type (a permanent with more than one of them may be chosen for each), or a number of them — then sacrifices
    // the rest, all at once. In APNAP order, each seeing the choices before theirs (CR 101.4).
    const g = ctx.g;
    const order = apnap(g);
    const players = refPlayers(ctx, ref(node, 'who')).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const pool = (node.pool ?? {}) as ObjectFilter;
    const slots = (node.slots as ObjectFilter[] | undefined) ?? null;
    const memo = ctx.memo as { kept?: Record<PlayerId, ObjectId[]>; p?: number; slot?: number };
    memo.kept ??= {};
    memo.p ??= 0;
    memo.slot ??= 0;
    // Mount Doom: "Choose up to two creatures, then destroy the rest." — any of them, chosen by you.
    const mine = (p: PlayerId) =>
      g.zones.battlefield.filter((id) => (node.anyController || g.objects[id]!.controller === p) && matchesFilter(g, g.objects[id]!, pool, { controller: p, source: ctx.source ?? null }));
    let answer = answerOf(ctx, 'choose_objects');
    for (; memo.p < players.length; memo.p++, memo.slot = 0) {
      const p = players[memo.p]!;
      const kept = (memo.kept[p] ??= []);
      if (slots) {
        for (; memo.slot < slots.length; memo.slot++) {
          const slot = slots[memo.slot]!;
          const candidates = mine(p).filter((id) => matchesFilter(g, g.objects[id]!, slot, { controller: p, source: ctx.source ?? null }));
          if (candidates.length <= 1) {
            kept.push(...candidates);
            continue;
          }
          if (!answer) {
            const what = (slot.types ?? ['permanent']).join(' or ').toLowerCase();
            return { ask: { kind: 'choose_objects', player: p, candidates, min: 1, max: 1, text: `Choose ${/^[aeiou]/.test(what) ? 'an' : 'a'} ${what} to keep (the rest are sacrificed).`, sourceName: sourceName(ctx) } };
          }
          if (answer.objects.length !== 1 || !candidates.includes(answer.objects[0]!)) throw new RulesError('Choose one of those permanents to keep.');
          kept.push(answer.objects[0]!);
          answer = null;
        }
      } else {
        const all = mine(p);
        const n = Math.min(amountOf(ctx, node.count ?? 1), all.length);
        if (all.length <= n && !node.upTo) {
          kept.push(...all);
          continue;
        }
        if (!answer) return { ask: { kind: 'choose_objects', player: p, candidates: all, min: node.upTo ? 0 : n, max: n, text: `Choose ${node.upTo ? 'up to ' : ''}${n} to keep (the rest are ${node.destroy ? 'destroyed' : 'sacrificed'}).`, sourceName: sourceName(ctx) } };
        if (answer.objects.length > n || answer.objects.length < (node.upTo ? 0 : n) || new Set(answer.objects).size !== answer.objects.length || !answer.objects.every((id) => all.includes(id))) {
          throw new RulesError(`Choose ${node.upTo ? 'up to ' : ''}${n} of those permanents to keep.`);
        }
        kept.push(...answer.objects);
        answer = null;
      }
    }
    // Divine Reckoning, Mount Doom: "… destroy the rest" (all at once, CR 608.2c).
    if (node.destroy) {
      const keptAll = new Set(Object.values(memo.kept).flat());
      for (const id of new Set(players.flatMap((p) => mine(p)))) if (!keptAll.has(id)) destroy(g, g.objects[id]!, ctx.events);
      return true;
    }
    for (const p of players) for (const id of mine(p)) if (!memo.kept[p]!.includes(id)) sacrificeObject(g, g.objects[id]!, p, ctx.events);
    return true;
  },

  if(node, ctx) {
    // "If [condition], [effect]. Otherwise, [effect]." — checked as this instruction is followed (CR 608.2c).
    const yes = evalCondition(node.cond as ConditionNode, ctx);
    return { expand: ((yes ? node.effects : node.else) as EffectNode[] | undefined) ?? [] };
  },

  // CR 707.10: "copy target instant or sorcery spell", "copy that spell", storm's "copy it for each …",
  // "copy target activated or triggered ability you control", "copy that ability".
  copy_spell(node, ctx) {
    const g = ctx.g;
    if (!ctx.memo.made) {
      const n = amountOf(ctx, node.amount ?? 1);
      const made: string[] = [];
      for (const entry of refEntries(ctx, ref(node, 'what'))) {
        for (let i = 0; i < n; i++) made.push(entry.kind === 'spell' ? copySpell(g, entry, ctx.controller, ctx.events) : copyAbility(g, entry, ctx.controller, ctx.events));
      }
      ctx.memo.made = made;
      ctx.memo.index = 0;
    }
    const made = ctx.memo.made as string[];
    // A copied spell is known by its object, a copied ability by its stack id.
    const entryOf = (id: string) => g.stack.find((s) => (s.kind === 'spell' ? s.object === id : s.id === id));
    // The object targets are checked against: the spell, or the ability's source (CR 707.10b).
    const sourceObj = (entry: StackEntry) => (entry.kind === 'spell' ? g.objects[entry.object] : g.objects[entry.source.id]) ?? null;
    const answer = answerOf(ctx, 'copy_targets');
    if (answer) {
      const id = made[ctx.memo.index as number]!;
      const entry = entryOf(id);
      // CR 707.10c: new targets must be legal; keeping them needn't be.
      if (entry?.program && answer.targets) {
        // CR 115.5: an ability on the stack can't target itself.
        if (answer.targets.some((list) => list.some((t) => t.kind === 'ability' && t.entry === id))) throw new RulesError('A copy can’t target itself.');
        entry.targets = chooseTargets(g, ctx.controller, entry.program.specs, answer.targets, sourceObj(entry), entry.x ?? 0);
      }
      ctx.memo.index = (ctx.memo.index as number) + 1;
    }
    if (node.newTargets) {
      for (; (ctx.memo.index as number) < made.length; ctx.memo.index = (ctx.memo.index as number) + 1) {
        const id = made[ctx.memo.index as number]!;
        const entry = entryOf(id);
        if (!entry?.program?.specs.length) continue;
        const current = entry.targets.map((list) =>
          list.map((t): Target => (t.kind === 'player' || t.kind === 'ability' ? t : { kind: 'object', object: t.id })),
        );
        const prompts = targetPrompts(g, ctx.controller, entry.program.specs, sourceObj(entry)).map((p) => ({
          ...p,
          candidates: p.candidates.filter((t) => !(t.kind === 'ability' && t.entry === id)),
        }));
        const text = entry.kind === 'spell' ? nameOf(g, g.objects[id]!) : `${entry.sourceName}: ${entry.text}`;
        return {
          ask: { kind: 'copy_targets', player: ctx.controller, object: id, ...(entry.kind === 'ability' ? { ability: true as const } : {}), sourceName: sourceName(ctx), text, prompts, current },
        };
      }
    }
    for (const id of made) {
      const entry = entryOf(id);
      if (entry) announceTargets(entry, ctx.events);
    }
    return true;
  },

  // CR 115.7d: "You may choose new targets for target spell or ability" — legal targets for it, chosen by this
  // ability's controller; keeping a target is allowed.
  retarget(node, ctx) {
    const g = ctx.g;
    const entry = refEntries(ctx, ref(node, 'what'))[0];
    if (!entry?.program?.specs.length) return true;
    const id = entry.kind === 'spell' ? entry.object : entry.id;
    const source = (entry.kind === 'spell' ? g.objects[entry.object] : g.objects[entry.source.id]) ?? null;
    const answer = answerOf(ctx, 'copy_targets');
    // CR 115.7a: "change the target" — to another legal target if there is one; otherwise it stays.
    const current0 = entry.targets.flat()[0];
    // Hydroelectric Specimen: "… to this creature" — only if it's a legal target for that spell; otherwise it stays.
    // Spellskite: "Change a target of target spell or ability to this creature" — one of its targets (CR 115.7c), chosen
    // among those it could legally be changed from.
    if (node.toSelf) {
      const me = ctx.source;
      if (!me || me.zone !== 'battlefield') return true;
      const asked = entry.targets.map((list) => list.map((t): Target => (t.kind === 'player' || t.kind === 'ability' ? t : { kind: 'object', object: t.id })));
      const options: { i: number; j: number; targets: TargetRef[][] }[] = [];
      asked.forEach((list, i) =>
        list.forEach((t, j) => {
          if (t.kind === 'object' && t.object === me.id) return;
          if (!node.oneOf && (i > 0 || j > 0)) return;
          const changed = asked.map((l, k) => (k === i ? l.map((x, m) => (m === j ? ({ kind: 'object', object: me.id } as Target) : x)) : l));
          try {
            options.push({ i, j, targets: chooseTargets(g, entry.controller, entry.program!.specs, changed, source, entry.x ?? 0) });
          } catch (err) {
            if (!(err instanceof RulesError)) throw err;
          }
        }),
      );
      if (!options.length) return true;
      let pick = options[0]!;
      if (options.length > 1) {
        const said = answerOf(ctx, 'choose_option');
        const labels = options.map((o, k) => {
          const t = asked[o.i]![o.j]!;
          return `${k + 1}. ${t.kind === 'player' ? (g.players[t.player]?.name ?? t.player) : t.kind === 'ability' ? 'an ability' : nameOf(g, g.objects[t.object]!)}`;
        });
        if (!said) return { ask: { kind: 'choose_option', player: ctx.controller, options: labels, text: `Choose which target to change to ${nameOf(g, me)}.`, sourceName: sourceName(ctx) } };
        const k = labels.indexOf(said.choice);
        if (k < 0) throw new RulesError('Choose one of its targets.');
        pick = options[k]!;
      }
      entry.targets = pick.targets;
      announceTargets(entry, ctx.events);
      return true;
    }
    const sameAs = (t: Target | undefined) => Boolean(t && current0 && (t.kind === 'player' ? current0.kind === 'player' && current0.player === t.player : t.kind === 'ability' ? current0.kind === 'ability' && current0.entry === t.entry : current0.kind === 'object' && current0.id === t.object));
    if (answer) {
      if (node.change && answer.targets && sameAs(answer.targets.flat()[0])) throw new RulesError('Choose a different target.');
      if (answer.targets) {
        if (answer.targets.some((list) => list.some((t) => (t.kind === 'ability' && t.entry === id) || (t.kind === 'object' && t.object === id)))) throw new RulesError('A spell or ability can’t target itself.');
        entry.targets = chooseTargets(g, entry.controller, entry.program.specs, answer.targets, source, entry.x ?? 0);
        announceTargets(entry, ctx.events);
      }
      return true;
    }
    const current = entry.targets.map((list) => list.map((t): Target => (t.kind === 'player' || t.kind === 'ability' ? t : { kind: 'object', object: t.id })));
    const prompts = targetPrompts(g, entry.controller, entry.program.specs, source).map((p) => ({
      ...p,
      candidates: p.candidates.filter((t) => !(t.kind === 'ability' && t.entry === id) && !(t.kind === 'object' && t.object === id)),
    }));
    const text = entry.kind === 'spell' ? nameOf(g, g.objects[entry.object]!) : `${entry.sourceName}: ${entry.text}`;
    if (node.change) {
      // Nothing else it could target: it stays as it is.
      const others = prompts[0]?.candidates.filter((t) => !sameAs(t)) ?? [];
      if (prompts.length !== 1 || !others.length) return true;
      prompts[0] = { ...prompts[0]!, candidates: others };
    }
    return { ask: { kind: 'copy_targets', player: ctx.controller, object: id, ...(entry.kind === 'ability' ? { ability: true as const } : {}), sourceName: sourceName(ctx), text, prompts, current, ...(node.change ? { mustChange: true as const } : {}) } };
  },

  // CR 701.40a / 701.58a: manifest or cloak the top card(s) of your library.
  // CR 701.62a: "manifest dread" — look at the top two, manifest one, put the other into your graveyard.
  manifest(node, ctx) {
    const g = ctx.g;
    ensureFaceDownDefs(g);
    // Reality Shift: "Its controller manifests the top card of their library."
    const manifester = node.who ? refPlayers(ctx, node.who as Ref)[0] : ctx.controller;
    if (!manifester) return true;
    let chosen: string[];
    let rest: string[] = [];
    if (node.dread) {
      const memo = ctx.memo as { looked?: string[] };
      const looked = (memo.looked ??= zoneList(g, 'library', ctx.controller).slice(0, 2)).filter((id) => g.objects[id]?.zone === 'library');
      const answer = answerOf(ctx, 'choose_objects');
      if (looked.length < 2) chosen = looked;
      else if (!answer) return { ask: { kind: 'choose_objects', player: ctx.controller, candidates: looked, min: 1, max: 1, text: 'Choose a card to manifest (the other goes into your graveyard).', seen: looked } };
      else {
        if (answer.objects.length !== 1 || !looked.includes(answer.objects[0]!)) throw new RulesError('Choose one of those two cards.');
        chosen = answer.objects;
      }
      rest = looked.filter((id) => !chosen.includes(id));
    } else chosen = zoneList(g, 'library', manifester).slice(0, amountOf(ctx, node.amount ?? 1));
    const made: { id: string; zcc: number }[] = [];
    for (const id of chosen) {
      moveObject(g, id, 'battlefield', ctx.events, { controller: manifester, faceDown: node.cloak ? 'cloak' : 'manifest' });
      if (g.objects[id]?.zone === 'battlefield') made.push({ id, zcc: g.objects[id]!.zcc });
    }
    for (const id of rest) moveObject(g, id, 'graveyard', ctx.events);
    // "then put three +1/+1 counters on that creature" — the manifested permanent.
    if (ctx.resolution) ctx.resolution.created = made;
    return true;
  },

  // CR 702.75a: "Hideaway N" — look at the top N cards of your library, exile one of them face down, and put the rest on
  // the bottom of your library in a random order. The exiled card is linked to this permanent (CR 607.2a).
  hideaway(node, ctx) {
    const g = ctx.g;
    const memo = ctx.memo as { looked?: string[] };
    const looked = (memo.looked ??= zoneList(g, 'library', ctx.controller).slice(0, amountOf(ctx, node.amount))).filter((id) => g.objects[id]?.zone === 'library');
    if (!looked.length) return true;
    let chosen = looked[0]!;
    if (looked.length > 1) {
      const answer = answerOf(ctx, 'choose_objects');
      if (!answer) return { ask: { kind: 'choose_objects', player: ctx.controller, candidates: looked, min: 1, max: 1, text: `Choose a card to exile face down (hideaway). The rest go on the bottom of your library in a random order.`, seen: looked } };
      if (answer.objects.length !== 1 || !looked.includes(answer.objects[0]!)) throw new RulesError('Choose one of those cards.');
      chosen = answer.objects[0]!;
    }
    moveObject(g, chosen, 'exile', ctx.events);
    const o = g.objects[chosen]!;
    o.hiddenFor = ctx.controller;
    const src = ctx.source;
    if (src && src.id !== chosen) o.exiledBy = { id: src.id, zcc: battlefieldZcc(g, src) };
    const rest = looked.filter((id) => id !== chosen && g.objects[id]!.zone === 'library');
    shuffleInPlace(g, rest);
    for (const id of rest) moveObject(g, id, 'library', ctx.events, { position: 'bottom' });
    return true;
  },

  // Hideaway: "You may play the exiled card without paying its mana cost" — a land is played (CR 305.3: only on your
  // turn, and it uses a land play, CR 305.2); a spell is cast as this resolves (CR 608.2g).
  play_free(node, ctx) {
    const g = ctx.g;
    const o = refObjects(ctx, ref(node, 'what'))[0];
    if (!o || o.zone === 'stack' || o.zone === 'battlefield') return true;
    if (castableCard(g, o)) return offerFreeCast(ctx, o.id) ?? true;
    const ps = g.players[ctx.controller]!;
    if (g.active !== ctx.controller || ps.landsPlayedThisTurn >= landsAllowed(g, ctx.controller)) return true;
    const answer = answerOf(ctx, 'may');
    if (!answer) return { ask: { kind: 'may', player: ctx.controller, text: `Play ${nameOf(g, o)}?`, sourceName: sourceName(ctx) } };
    if (!answer.yes) return true;
    ps.landsPlayedThisTurn++;
    const from = o.zone;
    moveObject(g, o.id, 'battlefield', ctx.events, { controller: ctx.controller });
    ctx.events.push({ type: 'land_played', player: ctx.controller, object: o.id, from });
    return true;
  },

  // Ad Nauseam: do it, then the player may do it again, as many times as they like.
  repeat_may(node, ctx) {
    const effects = node.effects as EffectNode[];
    const again: EffectNode = { type: 'repeat_may', effects, ask: true };
    if (!node.ask) return { expand: [...structuredClone(effects), again] };
    const answer = answerOf(ctx, 'may');
    if (!answer) return { ask: { kind: 'may', player: ctx.controller, text: 'Repeat the process?', sourceName: sourceName(ctx) } };
    return answer.yes ? { expand: [...structuredClone(effects), again] } : true;
  },

  // Demonic Consultation: name a card, exile six, then reveal until that name; it goes to hand, the rest are exiled.
  name_and_dig(node, ctx) {
    const g = ctx.g;
    const answer = answerOf(ctx, 'choose_option');
    const other = 'Another card name (none of the cards in this game)';
    if (!answer) {
      const names = new Set<string>();
      for (const def of Object.values(g.cards)) {
        const face = def.faces[0];
        if (!face || def.layout === 'token') continue;
        names.add(def.faces.length > 1 && (def.layout === 'split' || def.layout === 'adventure') ? def.name : face.name);
      }
      return { ask: { kind: 'choose_option', player: ctx.controller, options: [...[...names].sort(), other], text: 'Choose a card name.', sourceName: sourceName(ctx) } };
    }
    const name = answer.choice;
    const library = zoneList(g, 'library', ctx.controller);
    for (const id of library.slice(0, Number(node.exileFirst ?? 0))) moveObject(g, id, 'exile', ctx.events);
    const revealed: string[] = [];
    let found: string | null = null;
    for (const id of [...zoneList(g, 'library', ctx.controller)]) {
      revealed.push(id);
      const def = g.cards[g.objects[id]!.card]!;
      if (name !== other && (def.name === name || def.faces.some((f) => f.name === name))) {
        found = id;
        break;
      }
    }
    ctx.events.push({ type: 'revealed', player: ctx.controller, objects: [...revealed] });
    for (const id of revealed) moveObject(g, id, id === found ? 'hand' : 'exile', ctx.events);
    return true;
  },

  // Tainted Pact: exile the top card; it may go to your hand unless its name repeats; again until one does or a name repeats.
  tainted_pact(_node, ctx) {
    const g = ctx.g;
    const memo = ctx.memo as { names?: string[]; current?: string };
    memo.names ??= [];
    let answer = answerOf(ctx, 'may');
    for (;;) {
      if (memo.current) {
        if (!answer) return { ask: { kind: 'may', player: ctx.controller, text: `Put ${nameOf(g, g.objects[memo.current]!)} into your hand?`, sourceName: sourceName(ctx) } };
        const take = answer.yes;
        answer = null;
        if (take) {
          moveObject(g, memo.current, 'hand', ctx.events);
          return true;
        }
        delete memo.current;
      }
      const top = zoneList(g, 'library', ctx.controller)[0];
      if (!top) return true;
      moveObject(g, top, 'exile', ctx.events);
      const name = nameOf(g, g.objects[top]!);
      if (memo.names.includes(name)) return true;
      memo.names.push(name);
      memo.current = top;
    }
  },

  // Expressive Iteration: the cards looked at go one to each place in turn — into the hand, on the bottom, into exile (with a
  // permission to play it this turn).
  look_sort(node, ctx) {
    const g = ctx.g;
    const memo = ctx.memo as { looked?: string[]; slot?: number; done?: string[] };
    const looked = (memo.looked ??= zoneList(g, 'library', ctx.controller).slice(0, amountOf(ctx, node.amount))).filter((id) => g.objects[id]?.zone === 'library');
    const slots = node.slots as ('hand' | 'bottom' | 'exile_play')[];
    let answer = answerOf(ctx, 'choose_objects');
    for (let i = memo.slot ?? 0; i < slots.length; i++) {
      const left = looked.filter((id) => g.objects[id]!.zone === 'library' && !(memo.done ?? []).includes(id));
      if (!left.length) break;
      let id = left[0]!;
      if (left.length > 1) {
        if (!answer) {
          memo.slot = i;
          const where = slots[i] === 'hand' ? 'into your hand' : slots[i] === 'bottom' ? 'on the bottom of your library' : 'into exile (you may play it this turn)';
          return { ask: { kind: 'choose_objects', player: ctx.controller, candidates: left, min: 1, max: 1, text: `Choose a card to put ${where}.`, seen: left } };
        }
        if (answer.objects.length !== 1 || !left.includes(answer.objects[0]!)) throw new RulesError('Choose one of those cards.');
        id = answer.objects[0]!;
        answer = null;
      }
      (memo.done ??= []).push(id);
      if (slots[i] === 'hand') moveObject(g, id, 'hand', ctx.events);
      else if (slots[i] === 'bottom') moveObject(g, id, 'library', ctx.events, { position: 'bottom' });
      else {
        moveObject(g, id, 'exile', ctx.events);
        const o = g.objects[id]!;
        (g.mayPlay ??= []).push({ object: { id, zcc: o.zcc }, player: ctx.controller, mode: 'play', lastTurn: g.turn });
      }
      memo.slot = i + 1;
    }
    return true;
  },

  // Isochron Scepter (CR 707.12): a copy of the card is created and cast without paying its mana cost; one that isn't
  // cast ceases to exist, so it's made only once the player says yes.
  cast_copy_of(node, ctx) {
    const g = ctx.g;
    const [o] = refObjects(ctx, ref(node, 'what'));
    if (!o || !castableCard(g, o)) return true;
    const answer = answerOf(ctx, 'cast_free');
    if (!answer) return { ask: { kind: 'cast_free', player: ctx.controller, object: o.id, sourceName: sourceName(ctx), text: `Copy ${nameOf(g, o)} and cast the copy without paying its mana cost?` } };
    if (!answer.cast) return true;
    const id = `o${g.nextId++}`;
    g.objects[id] = { id, card: o.card, owner: ctx.controller, controller: ctx.controller, zone: o.zone, zcc: 0, face: o.face, tapped: false, sick: false, damage: 0, counters: {}, timestamp: ++g.clock, spellCopy: true };
    zoneList(g, o.zone, ctx.controller).push(id);
    castDuringResolution(g, ctx.controller, id, answer.targets, answer.modes, ctx.events, {});
    return true;
  },

  // Etali, Primal Storm: "you may cast any number of spells from among those cards without paying their mana costs" —
  // the player picks which, in the order they're cast (CR 608.2g), then each is cast as this resolves.
  cast_among_free(node, ctx) {
    const g = ctx.g;
    const memo = ctx.memo as { order?: string[]; i?: number };
    if (!memo.order) {
      const candidates = refObjects(ctx, ref(node, 'what')).filter((o) => o.zone === 'exile' && castableCard(g, o)).map((o) => o.id);
      if (!candidates.length) return true;
      const answer = answerOf(ctx, 'choose_objects');
      if (!answer) return { ask: { kind: 'choose_objects', player: ctx.controller, candidates, min: 0, max: candidates.length, ordered: true, text: 'Choose the spells to cast without paying their mana costs, in the order you cast them.' } };
      if (new Set(answer.objects).size !== answer.objects.length || !answer.objects.every((id) => candidates.includes(id))) throw new RulesError('Choose among those cards.');
      memo.order = answer.objects;
      memo.i = 0;
    }
    let answer = answerOf(ctx, 'cast_free');
    for (let i = memo.i ?? 0; i < memo.order.length; i++) {
      const o = g.objects[memo.order[i]!]!;
      if (o.zone !== 'exile') continue;
      if (!answer) {
        memo.i = i;
        return { ask: { kind: 'cast_free', player: ctx.controller, object: o.id, sourceName: sourceName(ctx), text: `Cast ${nameOf(g, o)} without paying its mana cost?` } };
      }
      if (answer.cast) castDuringResolution(g, ctx.controller, o.id, answer.targets, answer.modes, ctx.events, {});
      answer = null;
      memo.i = i + 1;
    }
    return true;
  },

  // Takenuma: "return a creature or planeswalker card from your graveyard to your hand" — chosen as it resolves.
  return_chosen(node, ctx) {
    const g = ctx.g;
    // Black Sun's Twilight: "a creature card with mana value X or less" — the X paid.
    const filter = bindFilter(ctx, (node.filter ?? {}) as ObjectFilter);
    const candidates = zoneList(g, 'graveyard', ctx.controller).filter((id) => matchesFilter(g, g.objects[id]!, filter, { controller: ctx.controller, source: ctx.source ?? null, anyZone: true }));
    if (!candidates.length) return true;
    const max = Math.min(amountOf(ctx, node.amount ?? 1), candidates.length);
    const min = node.optional ? 0 : max;
    const where = node.to === 'hand' ? 'to your hand' : node.to === 'exile' ? 'into exile' : 'to the battlefield';
    let chosen: string[];
    if (candidates.length === max && min === max) chosen = candidates;
    else {
      const answer = answerOf(ctx, 'choose_objects');
      if (!answer) return { ask: { kind: 'choose_objects', player: ctx.controller, candidates, min, max, text: `Choose ${min === max ? max : `up to ${max}`} card(s) in your graveyard to ${node.to === 'exile' ? 'exile' : `return ${where}`}.` } };
      if (answer.objects.length < min || answer.objects.length > max || new Set(answer.objects).size !== answer.objects.length || !answer.objects.every((id) => candidates.includes(id))) {
        throw new RulesError(`Choose ${min === max ? max : `up to ${max}`} of those cards.`);
      }
      chosen = answer.objects;
    }
    const moved: ObjectRef[] = [];
    for (const id of chosen) {
      if (node.to === 'hand' || node.to === 'exile') moveObject(g, id, node.to, ctx.events);
      else moveObject(g, id, 'battlefield', ctx.events, { controller: ctx.controller, ...(node.tapped ? { tapped: true } : {}) });
      moved.push({ id, zcc: g.objects[id]!.zcc });
    }
    if (ctx.resolution) ctx.resolution.created = moved;
    return true;
  },

  // Emry, Lurker of the Loch: "You may cast that card this turn." (CR 601.3: an effect lets it be cast from there.)
  // Hurl Through Hell: "Until the end of your next turn, you may cast that card"; "for as long as it remains exiled" — until
  // it leaves (CR 400.7); "… and you may spend mana as though it were mana of any color to cast that spell" (CR 609.4b).
  grant_play(node, ctx) {
    const g = ctx.g;
    const lastTurn = node.until === 'exiled' ? Number.MAX_SAFE_INTEGER : node.until === 'next_turn' ? lastTurnOf(g, ctx.controller, 'next_turn') : g.turn;
    for (const o of refObjects(ctx, ref(node, 'what'))) {
      if (o.zone === 'battlefield' || o.zone === 'stack') continue;
      if (node.until === 'exiled' && o.zone !== 'exile') continue;
      (g.mayPlay ??= []).push({ object: { id: o.id, zcc: o.zcc }, player: ctx.controller, mode: node.mode === 'play' ? 'play' : 'cast', lastTurn, ...(node.anyColor ? { anyColor: node.anyColor === 'type' ? ('type' as const) : (true as const) } : {}) });
    }
    return true;
  },

  // Six: "Mill three cards. You may put a land card from among them into your hand." — from the cards this resolution
  // milled that are still in a graveyard (CR 400.7: one that moved on is a new object).
  put_from_milled(node, ctx) {
    const g = ctx.g;
    const filter = node.filter as ObjectFilter;
    // Sludge Titan: "a creature card and/or a land card" — each chosen card stands for a different one of these.
    const each = node.each as ObjectFilter[] | undefined;
    const fctx = { controller: ctx.controller, source: ctx.source ?? null, anyZone: true };
    const fits = (id: string, f: ObjectFilter) => matchesFilter(g, g.objects[id]!, f, fctx);
    const assignable = (ids: string[], used: boolean[] = []): boolean =>
      !ids.length || (each ?? []).some((f, i) => !used[i] && fits(ids[0]!, f) && assignable(ids.slice(1), Object.assign([...used], { [i]: true })));
    const candidates = movedThisWay(ctx, { how: 'milled' })
      .map((m) => m.id)
      .filter((id) => g.objects[id]?.zone === 'graveyard' && (each ? each.some((f) => fits(id, f)) : fits(id, filter)));
    if (!candidates.length) return true;
    const max = Math.min(amountOf(ctx, node.amount), candidates.length);
    const min = node.optional ? 0 : max;
    const where = node.to === 'hand' ? 'into your hand' : 'onto the battlefield';
    let chosen = candidates.length === 1 && min === 1 ? [candidates[0]!] : null;
    if (!chosen) {
      const answer = answerOf(ctx, 'choose_objects');
      const kinds = each ? Object.fromEntries(candidates.map((id) => [id, each.flatMap((f, i) => (fits(id, f) ? [i] : []))])) : undefined;
      if (!answer) return { ask: { kind: 'choose_objects', player: ctx.controller, candidates, min, max, text: `Choose ${min === max ? max : `up to ${max}`} of the milled cards to put ${where}.`, seen: candidates, ...(kinds ? { kinds } : {}) } };
      if (answer.objects.length < min || answer.objects.length > max || new Set(answer.objects).size !== answer.objects.length || !answer.objects.every((id) => candidates.includes(id))) {
        throw new RulesError(`Choose ${min === max ? max : `up to ${max}`} of those cards.`);
      }
      if (each && !assignable(answer.objects)) throw new RulesError('Choose at most one card of each kind.');
      chosen = answer.objects;
    }
    const moved: ObjectRef[] = [];
    for (const id of chosen) {
      if (node.to === 'hand') moveObject(g, id, 'hand', ctx.events);
      else moveObject(g, id, 'battlefield', ctx.events, { controller: ctx.controller, ...(node.tapped ? { tapped: true } : {}) });
      moved.push({ id, zcc: g.objects[id]!.zcc });
    }
    // "it", "that card" in what follows.
    if (ctx.resolution) ctx.resolution.created = moved;
    return true;
  },

  // Dauthi Voidwalker: "Choose an exiled card an opponent owns with a void counter on it. You may play it this turn without
  // paying its mana cost."
  play_exiled(node, ctx) {
    const g = ctx.g;
    const filter = node.filter as ObjectFilter;
    const candidates = g.zones.exile.filter((id) => matchesFilter(g, g.objects[id]!, filter, { controller: ctx.controller, source: ctx.source ?? null, anyZone: true }));
    if (!candidates.length) return true;
    let chosen = candidates[0]!;
    if (candidates.length > 1) {
      const answer = answerOf(ctx, 'choose_objects');
      if (!answer) return { ask: { kind: 'choose_objects', player: ctx.controller, candidates, min: 1, max: 1, text: 'Choose an exiled card. You may play it this turn without paying its mana cost.' } };
      if (answer.objects.length !== 1 || !candidates.includes(answer.objects[0]!)) throw new RulesError('Choose one of those cards.');
      chosen = answer.objects[0]!;
    }
    const o = g.objects[chosen]!;
    (g.mayPlay ??= []).push({ object: { id: o.id, zcc: o.zcc }, player: ctx.controller, mode: 'play', lastTurn: g.turn, ...(node.free ? { free: true as const } : {}) });
    return true;
  },

  // CR 608.2g: "You may cast it without paying its mana cost."
  cast_free(node, ctx) {
    const o = refObjects(ctx, ref(node, 'what'))[0];
    if (!o || o.zone === 'stack' || o.zone === 'battlefield' || !castableCard(ctx.g, o)) return true;
    // "If that spell would be put into your graveyard, exile it instead."
    if (node.exileOnLeave) ctx.memo.exileOnLeave = true;
    return offerFreeCast(ctx, o.id) ?? true;
  },

  // "Discard all the cards in your hand, then draw that many cards" (Tolarian Winds), "discard up to two cards, then
  // draw that many cards" (Tersa), Flux, Dark Deal ("minus one"): each player discards (in APNAP order, CR 101.4), then
  // each draws as many as they discarded.
  wheel(node, ctx) {
    const g = ctx.g;
    const memo = ctx.memo as { players?: PlayerId[]; i?: number; counts?: number[] };
    memo.players ??= refPlayers(ctx, ref(node, 'who'));
    memo.counts ??= [];
    let answer = answerOf(ctx, 'choose_objects');
    for (let i = memo.i ?? 0; i < memo.players.length; i++) {
      const p = memo.players[i]!;
      const hand = [...zoneList(g, 'hand', p)];
      let chosen: ObjectId[];
      if (node.mode === 'all') chosen = hand;
      else {
        const max = node.mode === 'up_to' ? Math.min(Number(node.upTo), hand.length) : hand.length;
        if (!answer) {
          memo.i = i;
          if (!max) {
            memo.counts.push(0);
            continue;
          }
          return { ask: { kind: 'choose_objects', player: p, candidates: hand, min: 0, max, text: `${node.to === 'bottom' ? 'Put' : 'Discard'} ${node.mode === 'up_to' ? `up to ${max}` : 'any number of'} cards${node.to === 'bottom' ? ' on the bottom of your library' : ''}, then draw that many.` } };
        }
        chosen = answer.objects;
        if (chosen.length > max || new Set(chosen).size !== chosen.length || !chosen.every((id) => hand.includes(id))) throw new RulesError(`Choose up to ${max} cards in your hand.`);
        answer = null;
      }
      for (const id of chosen) {
        if (node.to === 'bottom') moveObject(g, id, 'library', ctx.events, { position: 'bottom' });
        else if (node.to === 'shuffle') moveObject(g, id, 'library', ctx.events);
        else discardCard(g, id, ctx.events);
      }
      // Winds of Change: the cards go into the library, then it's shuffled (CR 701.24a).
      if (node.to === 'shuffle') {
        shuffleInPlace(g, zoneList(g, 'library', p));
        ctx.events.push({ type: 'shuffled', player: p });
      }
      memo.counts.push(chosen.length);
      memo.i = i + 1;
    }
    const delta = Number(node.delta ?? 0);
    return { expand: memo.players.flatMap((p, i) => (memo.counts![i]! + delta > 0 ? [{ type: 'draw', amount: memo.counts![i]! + delta, who: { ref: 'you' }, asPlayer: p }] : [])) };
  },

  // Dark Confidant: "reveal the top card of your library and put that card into your hand. You lose life equal to its
  // mana value." (CR 701.20a)
  reveal_top(node, ctx) {
    const g = ctx.g;
    const top = zoneList(g, 'library', ctx.controller)[0];
    if (!top) return true;
    const o = g.objects[top]!;
    const mv = manaValueOf(g, o);
    ctx.events.push({ type: 'revealed', player: ctx.controller, objects: [top] });
    moveObject(g, top, 'hand', ctx.events);
    // "that card" in what follows (Yuriko, Twilight Prophet).
    if (ctx.resolution) ctx.resolution.created = [{ id: top, zcc: o.zcc }];
    if (!node.life || mv <= 0) return true;
    return { expand: [{ type: node.life === 'gain' ? 'gain_life' : 'lose_life', amount: mv, who: { ref: 'you' } }] };
  },

  // Rishkar's Expertise: "You may cast a spell with mana value 5 or less from your hand without paying its mana cost."
  // CR 608.2g: cast as this resolves, timing ignored.
  cast_from_hand(node, ctx) {
    const g = ctx.g;
    // Electrodominance: "with mana value X or less" — the spell's X.
    const filter = liveFilter(ctx, { ...((node.filter ?? {}) as ObjectFilter), zone: 'hand' as const });
    let picked = ctx.memo.picked as string | undefined;
    if (!picked) {
      const candidates = zoneList(g, 'hand', ctx.controller).filter((id) => castableCard(g, g.objects[id]!) && matchesFilter(g, g.objects[id]!, filter, { controller: ctx.controller, source: ctx.source ?? null }));
      if (!candidates.length) return true;
      const answer = answerOf(ctx, 'choose_objects');
      if (!answer) return { ask: { kind: 'choose_objects', player: ctx.controller, candidates, min: 0, max: 1, text: 'Choose a card to cast without paying its mana cost (or none).' } };
      const id = answer.objects[0];
      if (answer.objects.length > 1 || (id !== undefined && !candidates.includes(id))) throw new RulesError('Choose one of those cards, or none.');
      if (id === undefined) return true;
      ctx.memo.picked = picked = id;
      return offerFreeCast(ctx, picked) ?? true;
    }
    return offerFreeCast(ctx, picked) ?? true;
  },

  // CR 702.62a: remove a time counter; when the last is removed, it may be cast without paying its mana cost.
  suspend_tick(node, ctx) {
    const o = refObjects(ctx, { ref: 'self' })[0];
    if (!o || o.zone !== 'exile') return true;
    if (!ctx.memo.ticked) {
      ctx.memo.ticked = true;
      const n = o.counters.time ?? 0;
      if (n <= 0) return true;
      o.counters.time = n - 1;
      ctx.events.push({ type: 'counters', object: o.id, counter: 'time', delta: -1 });
      if (n - 1 > 0) return true;
    }
    if (!castableCard(ctx.g, o)) return true;
    const answer = answerOf(ctx, 'cast_free');
    if (!answer) return { ask: { kind: 'cast_free', player: ctx.controller, object: o.id, sourceName: sourceName(ctx), text: `Cast ${nameOf(ctx.g, o)} without paying its mana cost?` } };
    // "If you don't, it remains exiled." A creature spell cast this way gains haste.
    if (answer.cast) castDuringResolution(ctx.g, ctx.controller, o.id, answer.targets, answer.modes, ctx.events, { suspended: true });
    return true;
  },

  // CR 702.35a: "its owner may cast it by paying [cost] rather than paying its mana cost. If that player doesn't, they put this card into their graveyard."
  madness_cast(node, ctx) {
    const o = refObjects(ctx, { ref: 'self' })[0];
    if (!o || o.zone !== 'exile') return true;
    const answer = answerOf(ctx, 'cast_free');
    if (!answer) return { ask: { kind: 'cast_free', player: ctx.controller, object: o.id, sourceName: sourceName(ctx), text: `Cast ${nameOf(ctx.g, o)} for its madness cost?` } };
    if (answer.cast) castDuringResolution(ctx.g, ctx.controller, o.id, answer.targets, answer.modes, ctx.events, { alt: 'madness' });
    else moveObject(ctx.g, o.id, 'graveyard', ctx.events);
    return true;
  },

  // Chandra, Torch of Defiance: "You may cast that card. If you don't, …" — cast now, paying its costs (CR 608.2g).
  // Animate Dead: "When this Aura enters, if it's on the battlefield, it loses "enchant creature card in a graveyard" and
  // gains "enchant creature put onto the battlefield with this Aura." Return enchanted creature card to the battlefield
  // under your control and attach this Aura to it."
  reanimate_attach(node, ctx) {
    const g = ctx.g;
    const aura = ctx.source;
    if (!aura || aura.zone !== 'battlefield' || (ctx.sourceZcc !== undefined && aura.zcc !== ctx.sourceZcc)) return true;
    const r = aura.attachedTo;
    const card = r ? g.objects[r.id] : undefined;
    // The card left its graveyard: nothing returns, and the Aura (attached to nothing) goes (CR 704.5m).
    if (!card || card.zcc !== r!.zcc || card.zone !== 'graveyard') return true;
    moveObject(g, card.id, 'battlefield', ctx.events, { controller: ctx.controller, ...(node.tapped ? { tapped: true } : {}) });
    const back = g.objects[card.id]!;
    if (back.zone !== 'battlefield') return true;
    (g.reanimated ??= []).push({ aura: { id: aura.id, zcc: aura.zcc }, creature: { id: back.id, zcc: back.zcc } });
    aura.attachedTo = { id: back.id, zcc: back.zcc };
    aura.timestamp = ++g.clock;
    ctx.events.push({ type: 'attached', object: aura.id, to: back.id });
    return true;
  },

  // "When this Aura leaves the battlefield, that creature's controller sacrifices it." — the one it put onto the battlefield.
  sacrifice_linked(_node, ctx) {
    const g = ctx.g;
    const src = ctx.source;
    if (!src) return true;
    // A leaves-the-battlefield trigger knows the object the Aura became; the link is to the one on the battlefield.
    const zcc = ctx.sourceZcc ?? src.zcc;
    const link = g.reanimated?.find((l) => l.aura.id === src.id && (l.aura.zcc === zcc || l.aura.zcc === zcc - 1));
    if (!link) return true;
    g.reanimated = g.reanimated!.filter((l) => l !== link);
    const o = g.objects[link.creature.id];
    if (o && o.zone === 'battlefield' && o.zcc === link.creature.zcc) sacrifice(g, o, o.controller, ctx.events);
    return true;
  },

  cast_paid(node, ctx) {
    const o = refObjects(ctx, ref(node, 'what'))[0];
    const otherwise = { expand: (node.else as EffectNode[] | undefined) ?? [] };
    if (!o || !castableCard(ctx.g, o)) return otherwise;
    const answer = answerOf(ctx, 'cast_free');
    if (!answer) return { ask: { kind: 'cast_free', player: ctx.controller, object: o.id, sourceName: sourceName(ctx), text: `Cast ${nameOf(ctx.g, o)}, paying its costs?` } };
    if (!answer.cast) return otherwise;
    castDuringResolution(ctx.g, ctx.controller, o.id, answer.targets, answer.modes, ctx.events, { pay: true });
    return true;
  },

  // CR 702.85a: cascade.
  cascade(node, ctx) {
    return revealUntilCast(ctx, (o, g) => manaValueOf(g, o) < (ctx.source ? manaValueOf(g, ctx.source) : 0), 'bottom');
  },

  // "Reveal cards from the top of your library until you reveal a creature card. Put that card into your hand and the
  // rest on the bottom of your library in a random order." — and "Exile cards … until you exile …" (CR 701.20a).
  reveal_until(node, ctx) {
    const g = ctx.g;
    const memo = ctx.memo as { seen?: string[]; hit?: string | null };
    if (!memo.seen) {
      const filter = liveFilter(ctx, { ...((node.filter ?? {}) as ObjectFilter), zone: 'library' as const });
      const seen: string[] = [];
      let hit: string | null = null;
      for (const id of zoneList(g, 'library', ctx.controller)) {
        seen.push(id);
        if (matchesFilter(g, g.objects[id]!, filter, { controller: ctx.controller, source: ctx.source ?? null })) {
          hit = id;
          break;
        }
      }
      memo.seen = seen;
      memo.hit = hit;
      if (node.exile) for (const id of seen) moveObject(g, id, 'exile', ctx.events);
      else if (seen.length) ctx.events.push({ type: 'revealed', player: ctx.controller, objects: [...seen] });
    }
    const hit = memo.hit;
    const where = (id: string) => g.objects[id]?.zone;
    const from = node.exile ? 'exile' : 'library';
    if (hit && where(hit) === from) {
      const to = String(node.to);
      if (to === 'cast') {
        // "You may cast that card without paying its mana cost."
        if (ctx.memo.castFree === undefined) {
          const asked = castableCard(g, g.objects[hit]!) ? offerFreeCast(ctx, hit) : null;
          if (asked) return asked;
        }
      } else if (node.optional && ctx.memo.put === undefined) {
        const answer = answerOf(ctx, 'may');
        if (!answer) return { ask: { kind: 'may', player: ctx.controller, text: `Put ${nameOf(g, g.objects[hit]!)} ${to === 'battlefield' ? 'onto the battlefield' : 'into your hand'}?`, sourceName: sourceName(ctx) } };
        ctx.memo.put = answer.yes;
      }
      if (to !== 'cast' && (!node.optional || ctx.memo.put)) {
        if (to === 'battlefield') moveObject(g, hit, 'battlefield', ctx.events, { controller: ctx.controller, ...(node.tapped ? { tapped: true } : {}) });
        else moveObject(g, hit, to === 'graveyard' ? 'graveyard' : 'hand', ctx.events);
      }
    }
    // The rest: on the bottom in a random order, into the graveyard, or shuffled in.
    const rest = memo.seen!.filter((id) => where(id) === from);
    const r = String(node.rest ?? 'bottom');
    if (r === 'graveyard') {
      for (const id of rest) moveObject(g, id, 'graveyard', ctx.events);
    } else if (r === 'exile') {
      if (from !== 'exile') for (const id of rest) moveObject(g, id, 'exile', ctx.events);
    } else if (r === 'shuffle') {
      if (from === 'exile') for (const id of rest) moveObject(g, id, 'library', ctx.events);
      shuffleInPlace(g, zoneList(g, 'library', ctx.controller));
      ctx.events.push({ type: 'shuffled', player: ctx.controller });
    } else {
      shuffleInPlace(g, rest);
      for (const id of rest) moveObject(g, id, 'library', ctx.events, { position: 'bottom' });
    }
    return true;
  },

  // CR 701.57a: discover N — like cascade, but with mana value N or less, and to hand if not cast.
  discover(node, ctx) {
    // Monstrous Vortex: "discover X, where X is that spell's mana value" — counted once, as it starts.
    const n = (ctx.memo.discoverN as number | undefined) ?? (typeof node.n === 'number' ? node.n : amountOf(ctx, node.n as Amount));
    ctx.memo.discoverN = n;
    return revealUntilCast(ctx, (o, g) => manaValueOf(g, o) <= n, 'hand');
  },

  // CR 114.1: "You get an emblem with "…"".
  emblem(node, ctx) {
    const face: FaceDef = {
      name: `${sourceName(ctx)} emblem`,
      manaCost: '',
      typeLine: 'Emblem',
      supertypes: [],
      types: [],
      subtypes: [],
      oracle: String(node.text ?? ''),
      colors: [],
      keywords: [],
      abilities: structuredClone(node.abilities as AbilityNode[]),
      unparsed: [],
    };
    const o = createEmblem(ctx.g, face, ctx.controller);
    ctx.events.push({ type: 'created', object: o.id, controller: ctx.controller });
    return true;
  },

  // "Each opponent attacking that player does the same": the same effects, done by each of them as "you".
  players_do(node, ctx) {
    const players = refPlayers(ctx, ref(node, 'players'));
    return { expand: players.flatMap((p) => (node.effects as EffectNode[]).map((e) => ({ ...structuredClone(e), asPlayer: p }))) };
  },

  may_do(node, ctx) {
    // CR 118.12: "You may [do something]. If you do, [effect]." — only if it can actually be done.
    // "That player may …. If they don't, …": another player chooses; declining (or being unable) runs `else`.
    const answer = answerOf(ctx, 'may');
    const first = node.effects as EffectNode[];
    const then = (node.then as EffectNode[] | undefined) ?? [];
    const otherwise = (node.else as EffectNode[] | undefined) ?? [];
    const chooser = chooserOf(node, ctx);
    if (!chooser || !first.every((e) => feasible(e, ctx, chooser))) return otherwise.length ? { expand: otherwise } : true;
    // CR 603.12: "Sacrifice it. When you do, …" — not optional; what follows happens only if it could be done.
    if (node.mandatory) return { expand: [...first, ...then] };
    if (!answer) return { ask: { kind: 'may', player: chooser, text: describeEffects([...first, ...then]), sourceName: sourceName(ctx) } };
    // Cultivator Colossus: "If you do, draw a card and repeat this process."
    return { expand: answer.yes ? [...first, ...then, ...(node.repeat ? [structuredClone(node)] : [])] : otherwise };
  },

  delayed(node, ctx) {
    // CR 603.7: creates a delayed triggered ability; CR 603.7e: same source and controller.
    const g = ctx.g;
    const source = ctx.source;
    g.delayed.push({
      id: `d${g.nextId++}`,
      controller: ctx.controller,
      // CR 400.7j: if this effect just moved its source (unearth's return), "it" is the object it became.
      source: source ? { id: source.id, zcc: ctx.resolution?.found?.[source.id] === source.zcc ? source.zcc : (ctx.sourceZcc ?? source.zcc) } : { id: '', zcc: 0 },
      sourceName: sourceName(ctx),
      text: `${describeEffects(node.effects as EffectNode[])} (delayed)`,
      step: node.step === 'upkeep' || node.step === 'end_of_combat' || node.step === 'main' || node.step === 'main1' ? node.step : 'end',
      ...(node.whose === 'you' ? { whose: 'you' as const } : {}),
      ...(node.laterTurn ? { laterTurn: true as const } : {}),
      createdTurn: g.turn,
      createdStep: g.step,
      effects: freezeTargetAmounts(node.effects as EffectNode[], ctx),
      // CR 603.7c / 400.7: a target this resolution moved ("put it onto the battlefield … exile it at the beginning of
      // the next end step") is followed to the object it became.
      targets: ctx.targets.map((list) => list.map((t) => (t.kind === 'object' && ctx.resolution?.found?.[t.id] !== undefined ? { ...t, zcc: ctx.resolution.found[t.id]! } : t))),
      ...(ctx.trigger || ctx.resolution?.created ? { info: { ...ctx.trigger, ...(ctx.resolution?.created ? { created: ctx.resolution.created } : {}) } } : {}),
      ...(node.on ? { on: node.on as { who: 'you'; filter: ObjectFilter } } : {}),
    });
    return true;
  },

  // CR 701.65a: airbend — exile them; for as long as each card remains exiled, its owner may cast it by paying {2}
  // rather than paying its mana cost.
  airbend(node, ctx) {
    const g = ctx.g;
    for (const o of refObjects(ctx, ref(node, 'what'))) {
      if (o.zone !== 'battlefield' && o.zone !== 'stack') continue;
      const token = o.token || o.spellCopy;
      moveObject(g, o.id, 'exile', ctx.events);
      const now = g.objects[o.id];
      // A token or a copy of a spell ceases to exist (CR 111.7, 707.10a): nothing to cast.
      if (!now || now.zone !== 'exile' || token) continue;
      (g.mayPlay ??= []).push({ object: { id: now.id, zcc: now.zcc }, player: now.owner, mode: 'cast', lastTurn: Number.MAX_SAFE_INTEGER, cost: '{2}' });
    }
    return true;
  },

  // Earthbend (CR 701.66a): "When that land dies or is put into exile, return it to the battlefield tapped under your
  // control." — a delayed triggered ability watching that permanent (CR 603.7).
  delayed_leave(node, ctx) {
    const g = ctx.g;
    for (const o of refObjects(ctx, ref(node, 'what'))) {
      if (o.zone !== 'battlefield') continue;
      g.delayed.push({
        id: `d${g.nextId++}`,
        controller: ctx.controller,
        source: ctx.source ? { id: ctx.source.id, zcc: ctx.sourceZcc ?? ctx.source.zcc } : { id: '', zcc: 0 },
        sourceName: sourceName(ctx),
        text: `When ${nameOf(g, o)} dies or is put into exile, return it to the battlefield tapped under your control.`,
        step: 'end',
        createdTurn: g.turn,
        createdStep: g.step,
        effects: node.effects as EffectNode[],
        targets: [],
        leaves: { id: o.id, zcc: o.zcc },
      });
    }
    return true;
  },

  gain_control(node, ctx) {
    // Layer 2 (CR 613.1b): locked to the objects it affected (CR 611.2c).
    const objects = refObjects(ctx, ref(node, 'what')).filter((o) => o.zone === 'battlefield');
    if (!objects.length) return true;
    const g = ctx.g;
    // Homeward Path: "Each player gains control of all creatures they own."
    if (node.toOwners) {
      for (const p of new Set(objects.map((o) => o.owner))) {
        g.effects.push({
          id: `e${g.nextId++}`,
          timestamp: ++g.clock,
          source: ctx.source ? { id: ctx.source.id, zcc: ctx.source.zcc } : { id: '', zcc: 0 },
          controller: ctx.controller,
          objects: objects.filter((o) => o.owner === p).map((o) => ({ id: o.id, zcc: o.zcc })),
          control: p,
          until: 'game',
        });
      }
      applyControlEffects(g, ctx.events);
      return true;
    }
    // Wishclaw Talisman: "An opponent gains control of this artifact" — one the controller chooses; "Target opponent …".
    let to: PlayerId | undefined = ctx.controller;
    if (node.to) to = refPlayers(ctx, ref(node, 'to'))[0];
    if (node.toOpponent) {
      const opponents = livePlayers(g).filter((p) => p !== ctx.controller);
      to = opponents[0];
      if (opponents.length > 1) {
        const answer = answerOf(ctx, 'choose_option');
        if (!answer) return { ask: { kind: 'choose_option', player: ctx.controller, options: opponents, text: `Choose an opponent to gain control of ${objects.map((o) => nameOf(g, o)).join(', ')}.`, sourceName: sourceName(ctx) } };
        if (!opponents.includes(answer.choice)) throw new RulesError('Choose an opponent.');
        to = answer.choice;
      }
    }
    if (!to) return true;
    g.effects.push({
      id: `e${g.nextId++}`,
      timestamp: ++g.clock,
      source: ctx.source ? { id: ctx.source.id, zcc: ctx.source.zcc } : { id: '', zcc: 0 },
      controller: ctx.controller,
      objects: objects.map((o) => ({ id: o.id, zcc: o.zcc })),
      control: to,
      until: node.until === 'eot' ? 'eot' : 'game',
      ...(node.until === 'source_tapped' && ctx.source ? { whileTapped: { id: ctx.source.id, zcc: ctx.source.zcc } } : {}),
      // Treasure Nabber: "until the end of your next turn" — it ends with that turn's cleanup (CR 514.2).
      ...(node.until === 'end_of_your_next_turn' ? { throughTurn: lastTurnOf(g, ctx.controller, 'next_turn') } : {}),
    });
    applyControlEffects(g, ctx.events);
    return true;
  },

  exchange_control(node, ctx) {
    // CR 701.12a-b: both permanents still there and controlled by different players, or nothing happens. Each player
    // gains control of the other's permanent at once (layer 2, CR 613.1b), indefinitely.
    const pair = exchangePair(ctx, node);
    if (!pair) return true;
    const g = ctx.g;
    const [a, b] = pair;
    const timestamp = ++g.clock;
    const source = ctx.source ? { id: ctx.source.id, zcc: ctx.source.zcc } : { id: '', zcc: 0 };
    for (const [o, to] of [[a, b.controller], [b, a.controller]] as const) {
      g.effects.push({ id: `e${g.nextId++}`, timestamp, source, controller: ctx.controller, objects: [{ id: o.id, zcc: o.zcc }], control: to, until: 'game' });
    }
    applyControlEffects(g, ctx.events);
    return true;
  },

  // Final Showdown: "Choose a creature you control." — "it" is then that one (none if there's none).
  choose_object(node, ctx) {
    const g = ctx.g;
    const filter = liveFilter(ctx, (node.filter ?? {}) as ObjectFilter);
    const candidates = g.zones.battlefield.filter((id) => matchesFilter(g, g.objects[id]!, filter, { controller: ctx.controller, source: ctx.source ?? null }));
    if (!candidates.length || !ctx.resolution) return true;
    let pick = candidates.length === 1 ? candidates[0] : undefined;
    if (!pick) {
      const answer = answerOf(ctx, 'choose_objects');
      if (!answer) return { ask: { kind: 'choose_objects', player: ctx.controller, candidates, min: 1, max: 1, text: 'Choose one.', sourceName: sourceName(ctx) } };
      if (answer.objects.length !== 1 || !candidates.includes(answer.objects[0]!)) throw new RulesError('Choose one of them.');
      pick = answer.objects[0]!;
    }
    const o = g.objects[pick]!;
    ctx.resolution.chosenObject = { id: o.id, zcc: o.zcc };
    return true;
  },

  // Final Act: "Each opponent loses all counters." (CR 122.1)
  player_counters_lost(node, ctx) {
    for (const p of refPlayers(ctx, ref(node, 'who'))) {
      const ps = ctx.g.players[p]!;
      if (ps.poison) ctx.events.push({ type: 'player_counters', player: p, counter: 'poison', delta: -ps.poison });
      for (const [counter, n] of Object.entries(ps.counters ?? {})) if (n) ctx.events.push({ type: 'player_counters', player: p, counter, delta: -n });
      ps.poison = 0;
      ps.counters = {};
    }
    return true;
  },

  exchange_life(node, ctx) {
    // CR 701.12c: each player gains or loses the life needed to reach the other's previous total. CR 701.12a: if one of
    // them can't (a player who can't gain life can't get the higher total), no part of the exchange happens.
    const plan = lifeExchange(ctx, node);
    if (!plan) return true;
    const out: EffectNode[] = [];
    for (const [p, to] of plan) {
      const delta = to - ctx.g.players[p]!.life;
      if (delta > 0) out.push({ type: 'gain_life', amount: delta, who: { ref: 'you' }, asPlayer: p });
      else if (delta < 0) out.push({ type: 'lose_life', amount: -delta, who: { ref: 'you' }, asPlayer: p });
    }
    return out.length ? { expand: out } : true;
  },

  exchange_life_stat(node, ctx) {
    // CR 701.12g: "Exchange your life total with this creature's toughness." — the life total becomes the toughness, and
    // a layer 7b effect sets the toughness to the old life total (CR 613.4b).
    const g = ctx.g;
    const [p] = refPlayers(ctx, ref(node, 'who'));
    const [o] = refObjects(ctx, ref(node, 'what')).filter((x) => x.zone === 'battlefield');
    if (p === undefined || !o || !chars(g, o).types.includes('Creature')) return true;
    const stat = node.stat === 'power' ? 'power' : 'toughness';
    const value = stat === 'power' ? power(g, o) : toughness(g, o);
    const life = g.players[p]!.life;
    if (!lifeCanBecome(g, p, value)) return true;
    g.effects.push({
      id: `e${g.nextId++}`,
      timestamp: ++g.clock,
      source: ctx.source ? { id: ctx.source.id, zcc: ctx.source.zcc } : { id: '', zcc: 0 },
      controller: ctx.controller,
      objects: [{ id: o.id, zcc: o.zcc }],
      ...(stat === 'power' ? { setPower: life } : { setToughness: life }),
      until: 'game',
    });
    const delta = value - life;
    if (delta > 0) return { expand: [{ type: 'gain_life', amount: delta, who: { ref: 'you' }, asPlayer: p }] };
    if (delta < 0) return { expand: [{ type: 'lose_life', amount: -delta, who: { ref: 'you' }, asPlayer: p }] };
    return true;
  },

  exile_if_dies(node, ctx) {
    // CR 614.1a: a replacement effect for this turn.
    for (const o of refObjects(ctx, ref(node, 'what'))) if (o.zone === 'battlefield') o.exileIfDiesTurn = ctx.g.turn;
    return true;
  },

  prevent(node, ctx) {
    // CR 615.1a / CR 615.7: prevention effects, as shields that last this turn.
    const g = ctx.g;
    const lock = (r: Ref | undefined) => {
      if (!r) return [undefined];
      return refRecipients(ctx, r).map((x): TargetRef => (x.kind === 'player' ? x : { kind: 'object', id: x.object, zcc: g.objects[x.object]!.zcc }));
    };
    const amount = node.amount === 'all' ? 'all' : amountOf(ctx, node.amount);
    // Obscuring Haze: "by creatures your opponents control" — whatever matches when the damage would be dealt (CR 615).
    const byRef = node.by as Ref | undefined;
    const toRef = node.to as Ref | undefined;
    const filtered = amount === 'all' && (byRef?.ref === 'all' || toRef?.ref === 'all') && (!byRef || byRef.ref === 'all') && (!toRef || toRef.ref === 'all');
    if (filtered) {
      g.prevention.push({
        id: `p${g.nextId++}`,
        turn: g.turn,
        amount,
        controller: ctx.controller,
        ...(byRef?.ref === 'all' ? { byFilter: byRef.filter } : {}),
        ...(toRef?.ref === 'all' ? { toFilter: toRef.filter } : {}),
        ...(node.combat ? { combat: true as const } : {}),
      });
      return true;
    }
    for (const to of lock(node.to as Ref | undefined)) {
      for (const by of lock(node.by as Ref | undefined)) {
        g.prevention.push({
          id: `p${g.nextId++}`,
          turn: g.turn,
          amount,
          ...(to ? { to } : {}),
          ...(by ? { by } : {}),
          ...(node.combat ? { combat: true as const } : {}),
        });
      }
    }
    return true;
  },

  // CR 615 / Circle of Protection: "The next time a red source of your choice would deal damage to you this turn,
  // prevent that damage." — the source is chosen as it resolves (CR 609.7a).
  prevent_chosen_source(node, ctx) {
    const g = ctx.g;
    const filter = (node.filter ?? {}) as ObjectFilter;
    const sources = [...g.zones.battlefield, ...g.stack.flatMap((e) => (e.kind === 'spell' ? [e.object] : []))].filter((id) =>
      matchesFilter(g, g.objects[id]!, { ...filter, zone: undefined }, { controller: ctx.controller, source: ctx.source ?? null, anyZone: true }),
    );
    if (!sources.length) return true;
    const answer = answerOf(ctx, 'choose_objects');
    if (!answer) return { ask: { kind: 'choose_objects', player: ctx.controller, candidates: sources, min: 1, max: 1, text: 'Choose a source.' } };
    const chosen = answer.objects[0];
    if (answer.objects.length !== 1 || !chosen || !sources.includes(chosen)) throw new RulesError('Choose one of those sources.');
    g.prevention.push({ id: `p${g.nextId++}`, turn: g.turn, amount: 'all', once: true, to: { kind: 'player', player: ctx.controller }, by: { kind: 'object', id: chosen, zcc: g.objects[chosen]!.zcc } });
    return true;
  },

  // Tempting offer (CR 207.2c): "Each opponent may [do it too]. For each opponent who does, [you do it again]." Each
  // opponent who can, in turn order (CR 101.4), chooses; those who accept do it as though they were you, then you do it
  // once for each of them.
  tempting_offer(node, ctx) {
    const g = ctx.g;
    const theirs = node.theirs as EffectNode[];
    const opponents = apnap(g).filter((p) => refPlayers(ctx, { ref: 'players', who: 'opponents' } as Ref).includes(p));
    const memo = ctx.memo as { i?: number; yes?: PlayerId[] };
    memo.i ??= 0;
    memo.yes ??= [];
    let answer = answerOf(ctx, 'may');
    for (; memo.i < opponents.length; memo.i++) {
      const p = opponents[memo.i]!;
      if (!theirs.every((e) => feasible(e, { ...ctx, controller: p }, p))) continue;
      if (!answer) return { ask: { kind: 'may', player: p, text: `Tempting offer: ${describeEffects(theirs)}?`, sourceName: sourceName(ctx) } };
      if (answer.yes) memo.yes.push(p);
      answer = null;
    }
    const as = (p: PlayerId) => theirs.map((e) => ({ ...structuredClone(e), asPlayer: p }));
    return { expand: [...memo.yes.flatMap(as), ...memo.yes.flatMap(() => structuredClone(node.mine as EffectNode[]))] };
  },

  may(node, ctx) {
    // CR 603.5: an optional effect — the controller (or the player it names) chooses as it resolves.
    const answer = answerOf(ctx, 'may');
    const chooser = chooserOf(node, ctx);
    if (!chooser) return true;
    if (!answer) {
      const text = describeEffects(node.effects as EffectNode[]);
      return { ask: { kind: 'may', player: chooser, text, sourceName: sourceName(ctx) } };
    }
    // CR 603.2h: "Do this only once each turn." — taken now, so it won't trigger again this turn.
    if (answer.yes && node.doOnce && ctx.source && ctx.resolution?.entry.kind === 'ability') (ctx.source.doneOnce ??= {})[`${ctx.source.zcc}:${ctx.resolution.entry.text}`] = ctx.g.turn;
    return { expand: answer.yes ? (node.effects as EffectNode[]) : [] };
  },
};

/**
 * CR 608.2h: "that spell's mana value" in a delayed ability is worked out as it's created — by the time it triggers,
 * the countered spell is just a card in a graveyard.
 */
function freezeTargetAmounts(list: EffectNode[], ctx: EffectContext): EffectNode[] {
  const fix = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(fix);
    if (!v || typeof v !== 'object') return v;
    const o = v as Record<string, unknown>;
    if (typeof o.kind === 'string' && !['spell', 'activated', 'triggered', 'static'].includes(o.kind) && JSON.stringify(o).includes('"ref":"target"')) {
      return amountOf(ctx, o as unknown as Amount);
    }
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, fix(x)]));
  };
  return fix(list) as EffectNode[];
}

/**
 * "You may pay {X}. If you do, draw X cards." / "When you do, … X damage …": the X paid, in what follows (and in a
 * reflexive ability's effects and targets). A token's "X/X" follows its `size`.
 */
function bindX(list: EffectNode[], x: number): EffectNode[] {
  const fix = (v: unknown, key?: string): unknown => {
    if (v === 'X') return x;
    if (Array.isArray(v)) return v.map((e) => fix(e));
    if (!v || typeof v !== 'object' || key === 'token') return v;
    const e = v as { kind?: unknown; times?: number; plus?: number; half?: 'up' | 'down' };
    if (e.kind === 'x') return (e.half ? (e.half === 'up' ? Math.ceil(x / 2) : Math.floor(x / 2)) : x) * (e.times ?? 1) + (e.plus ?? 0);
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, e]) => [k, k === 'text' ? e : fix(e, k)]));
  };
  return fix(list) as EffectNode[];
}

/** Who decides an optional effect: its controller, or the one player it names ("that player may …"). */
function chooserOf(node: EffectNode, ctx: EffectContext): PlayerId | null {
  if (!node.who) return ctx.controller;
  return refPlayers(ctx, node.who as Ref)[0] ?? null;
}

/**
 * Asks whether to cast a card for free now; on "yes" casts it (CR 608.2g). Returns the prompt, or null once
 * answered (or if there's nothing to ask).
 */
/**
 * A filter with its numbers worked out as the effect resolves: "with mana value X or less" (the spell's X), or what the
 * text says X is ("where X is the sacrificed creature's mana value", CR 107.3a).
 */
function liveFilter(ctx: EffectContext, f0: ObjectFilter): ObjectFilter {
  // Heirloom Blade: "a creature card that shares a creature type with it"
  const f = bindFilter(ctx, f0);
  const n = f.manaValue?.n;
  if (n === 'X') return { ...f, manaValue: { ...f.manaValue!, n: ctx.x } };
  if (n !== undefined && typeof n === 'object') return { ...f, manaValue: { ...f.manaValue!, n: amountOf(ctx, n) } };
  return f;
}

function offerFreeCast(ctx: EffectContext, id: string): EffectResult | null {
  const g = ctx.g;
  const answer = answerOf(ctx, 'cast_free');
  if (!answer) {
    return { ask: { kind: 'cast_free', player: ctx.controller, object: id, sourceName: sourceName(ctx), text: `Cast ${nameOf(g, g.objects[id]!)} without paying its mana cost?` } };
  }
  ctx.memo.castFree = answer.cast;
  if (answer.cast) castDuringResolution(g, ctx.controller, id, answer.targets, answer.modes, ctx.events, ctx.memo.exileOnLeave ? { exileOnLeave: true } : {});
  return null;
}

/** Cascade and discover: exile from the top until a nonland card that qualifies, offer to cast it, then tidy up. */
function revealUntilCast(ctx: EffectContext, qualifies: (o: GameObject, g: GameState) => boolean, rest: 'bottom' | 'hand'): EffectResult {
  const g = ctx.g;
  if (!ctx.memo.exiled) {
    const exiled: string[] = [];
    let hit: string | null = null;
    for (const id of [...zoneList(g, 'library', ctx.controller)]) {
      moveObject(g, id, 'exile', ctx.events);
      exiled.push(id);
      const o = g.objects[id]!;
      if (!faceOf(g, o).types.includes('Land') && qualifies(o, g)) {
        hit = id;
        break;
      }
    }
    ctx.memo.exiled = exiled;
    ctx.memo.hit = hit;
  }
  const hit = ctx.memo.hit as string | null;
  if (hit && g.objects[hit]?.zone === 'exile' && ctx.memo.castFree === undefined) {
    const asked = offerFreeCast(ctx, hit);
    if (asked) return asked;
  }
  // Discover: "If you don't, put that card into your hand." (CR 701.57a)
  if (rest === 'hand' && hit && g.objects[hit]?.zone === 'exile') moveObject(g, hit, 'hand', ctx.events);
  // The rest go on the bottom in a random order.
  const left = (ctx.memo.exiled as string[]).filter((id) => g.objects[id]?.zone === 'exile');
  shuffleInPlace(g, left);
  for (const id of left) moveObject(g, id, 'library', ctx.events, { position: 'bottom' });
  return true;
}

/** Whether an optional action in "You may [do X]. If you do, …" can be done at all by `chooser`. */
/** CR 701.12a-b: the two permanents an exchange of control swaps — both on the battlefield, under different players. */
function exchangePair(ctx: EffectContext, node: EffectNode): [GameObject, GameObject] | null {
  const refs = (Array.isArray(node.what) ? node.what : [node.what]) as Ref[];
  const objects = [...new Set(refs.flatMap((r) => refObjects(ctx, r)))].filter((o) => o.zone === 'battlefield');
  if (objects.length !== 2) return null;
  const [a, b] = objects as [GameObject, GameObject];
  return a.controller !== b.controller ? [a, b] : null;
}

/** CR 119.7-8: whether a player's life total can change to `to` (can't gain life, life total can't change). */
function lifeCanBecome(g: GameState, p: PlayerId, to: number): boolean {
  const life = g.players[p]!.life;
  if (to === life) return true;
  if (playerRule(g, p, 'life_cant_change')) return false;
  return to < life || !playerRule(g, p, 'cant_gain_life');
}

/** CR 701.12c: each player and the life total they're to end with — or null if the exchange can't be completed. */
function lifeExchange(ctx: EffectContext, node: EffectNode): [PlayerId, number][] | null {
  const refs = (Array.isArray(node.who) ? node.who : [node.who]) as Ref[];
  const players = [...new Set(refs.flatMap((r) => refPlayers(ctx, r)))].filter((p) => !ctx.g.players[p]!.lost);
  if (players.length !== 2) return null;
  const [a, b] = players as [PlayerId, PlayerId];
  const plan: [PlayerId, number][] = [[a, ctx.g.players[b]!.life], [b, ctx.g.players[a]!.life]];
  return plan.every(([p, to]) => lifeCanBecome(ctx.g, p, to)) ? plan : null;
}

function feasible(e: EffectNode, ctx: EffectContext, chooser: PlayerId = ctx.controller): boolean {
  const g = ctx.g;
  // "Exchange control of this creature and target creature an opponent controls. If you do, …" (CR 701.12a).
  if (e.type === 'exchange_control') return exchangePair(ctx, e) !== null;
  if (e.type === 'exchange_life') return lifeExchange(ctx, e) !== null;
  // Cultivator Colossus: "you may put a land card from your hand onto the battlefield tapped. If you do, …"
  if (e.type === 'choose_from_hand' && refPlayers(ctx, ref(e, 'who')).includes(chooser)) {
    const filter = liveFilter(ctx, { ...((e.filter ?? {}) as ObjectFilter), zone: 'hand' as const });
    return zoneList(g, 'hand', chooser).some((id) => matchesFilter(g, g.objects[id]!, filter, { controller: ctx.controller, source: ctx.source ?? null }));
  }
  if (e.type === 'sacrifice_choice' && refPlayers(ctx, ref(e, 'who')).includes(chooser)) {
    const filter = bindFilter(ctx, (e.filter ?? {}) as ObjectFilter);
    const n = g.zones.battlefield.filter((id) => {
      const o = g.objects[id]!;
      return o.controller === chooser && matchesFilter(g, o, filter, { controller: ctx.controller, source: ctx.source ?? null });
    }).length;
    return n >= amountOf(ctx, e.amount);
  }
  if (e.type === 'discard') {
    const hand = zoneList(g, 'hand', chooser).filter((id) => !e.filter || matchesFilter(g, g.objects[id]!, e.filter as ObjectFilter, { controller: chooser, source: ctx.source ?? null, anyZone: true }));
    return e.all ? hand.length > 0 : hand.length >= amountOf(ctx, e.amount);
  }
  if (e.type === 'sacrifice') return refObjects(ctx, ref(e, 'what')).some((o) => o.zone === 'battlefield' && o.controller === chooser);
  // Coral Atoll: "unless you return an untapped Island you control to its owner's hand".
  if (e.type === 'move_chosen') return g.zones.battlefield.filter((id) => matchesFilter(g, g.objects[id]!, (e.filter ?? {}) as ObjectFilter, { controller: chooser, source: ctx.source ?? null })).length >= amountOf(ctx, e.amount ?? 1);
  // CR 701.68b, 701.61a
  if (e.type === 'blight') return blightCandidates(g, chooser).length > 0;
  if (e.type === 'forage') return foodCandidates(g, chooser).length > 0 || zoneList(g, 'graveyard', chooser).length >= 3;
  // Tempt with Immortality: "return a creature card from your graveyard to the battlefield" — only with one there.
  if (e.type === 'return_chosen') return zoneList(g, 'graveyard', chooser).some((id) => matchesFilter(g, g.objects[id]!, bindFilter(ctx, (e.filter ?? {}) as ObjectFilter), { controller: chooser, source: ctx.source ?? null, anyZone: true }));
  // Leatherhead: "you may remove a counter from her. When you do, …" — only with a counter there to remove.
  if (e.type === 'remove_counters' && e.amount !== 'all') {
    const n = Math.max(1, amountOf(ctx, e.amount));
    return refObjects(ctx, ref(e, 'what')).some((o) =>
      e.counter === undefined ? Object.values(o.counters).reduce((a: number, b) => a + (b ?? 0), 0) >= n : (o.counters[String(e.counter)] ?? 0) >= n,
    );
  }
  return true;
}

/** Spider-Punk: "Spells and abilities can't be countered." */
function abilitiesUncounterable(g: GameState): boolean {
  return abilitySources(g).some((id) => objectAbilities(g, g.objects[id]!).some((a) => a.kind === 'static' && a.effect.type === 'uncounterable' && Boolean(a.effect.abilitiesToo)));
}

/** "Creature spells you control can't be countered." */
function uncounterable(g: GameState, spell: GameObject): boolean {
  // Cast with mana that said "that spell can't be countered".
  if (spell.cast?.uncounterable) return true;
  // Veil of Summer: "Spells you control can't be countered this turn."
  if ((g.playerEffects ?? []).some((e) => e.player === spell.controller && e.rule === 'spells_uncounterable' && e.lastTurn >= g.turn && (!e.filter || matchesFilter(g, spell, e.filter, { controller: spell.controller, anyZone: true })))) return true;
  for (const id of abilitySources(g)) {
    const src = g.objects[id]!;
    for (const a of objectAbilities(g, src)) {
      if (a.kind !== 'static' || a.effect.type !== 'uncounterable') continue;
      // "Spells you control can't be countered" — unless it's everyone's ("Spells can't be countered").
      if (src.controller !== spell.controller && !a.effect.anyone) continue;
      if (matchesFilter(g, spell, { ...((a.effect.filter ?? {}) as ObjectFilter), zone: 'stack' }, { controller: src.controller, source: src })) return true;
    }
  }
  return false;
}

function gainLife(ctx: EffectContext, p: PlayerId, n: number): void {
  // "Players can't gain life."
  if (n <= 0 || playerRule(ctx.g, p, 'cant_gain_life') || playerRule(ctx.g, p, 'life_cant_change')) return;
  // CR 614.1a: "If you would gain life, you gain twice that much life instead."
  n = replaceQuantity(ctx.g, 'gain_life', n, { player: p });
  const ps = ctx.g.players[p]!;
  ps.life += n;
  ctx.events.push({ type: 'life', player: p, delta: n, life: ps.life });
}

/**
 * CR 508.4: a creature put onto the battlefield attacking — it attacks what its source is attacking,
 * or else the next defending player (the controller's choice in the rules; the engine picks for now).
 * CR 506.3b: only under an attacking player's control, and only once attackers have been declared.
 */
/**
 * Academy Manufactor (CR 614.1a, 616.1): each one turns a Clue, Food or Treasure token into one of each, so with k of
 * them every such token becomes 3^(k-1) of each kind.
 */
function oneOfEach(g: GameState, face: FaceDef, player: PlayerId): { faces: FaceDef[]; times: number } | null {
  if (!face.subtypes.some((t) => t === 'Clue' || t === 'Food' || t === 'Treasure')) return null;
  let faces: FaceDef[] | null = null;
  let k = 0;
  for (const id of abilitySources(g)) {
    const o = g.objects[id]!;
    if (o.controller !== player) continue;
    for (const a of objectAbilities(g, o)) {
      if (a.kind !== 'static' || a.effect.type !== 'token_one_of_each') continue;
      faces ??= a.effect.tokens as FaceDef[];
      k++;
    }
  }
  return faces && k ? { faces, times: 3 ** (k - 1) } : null;
}

function enterAttacking(g: GameState, o: GameObject, source: GameObject | undefined, at?: AttackTarget): void {
  const c = g.combat;
  if (!c || !c.attackersDeclared || o.controller !== g.active || !chars(g, o).types.includes('Creature')) return;
  const fromSource = source ? c.attackers[source.id] : undefined;
  const target = at ?? fromSource?.target ?? (() => {
    const p = livePlayers(g).find((x) => x !== o.controller);
    return p ? { kind: 'player' as const, player: p } : undefined;
  })();
  if (!target) return;
  // CR 508.4d: during or after the declare blockers step, it's unblocked.
  c.attackers[o.id] = { zcc: o.zcc, target, blocked: false, blockers: [] };
}

function lookAtTop(ctx: EffectContext, n: number, kind: 'scry' | 'surveil', reorder = false): EffectResult {
  const library = zoneList(ctx.g, 'library', ctx.controller);
  const looked = library.slice(0, n);
  if (!looked.length) return true;
  const answer = ctx.answer?.kind === kind ? ctx.answer : null;
  if (!answer) return { ask: kind === 'scry' ? { kind, player: ctx.controller, objects: looked, ...(reorder ? { reorder: true } : {}) } : { kind, player: ctx.controller, objects: looked } };
  const top = answer.top;
  const away = answer.kind === 'scry' ? answer.bottom : answer.graveyard;
  // Only putting them back, in any order: none go to the bottom.
  if (reorder && away.length) throw new RulesError('Put them all back on top, in any order.');
  if (reorder) {
    if (top.length !== looked.length || new Set(top).size !== top.length || !top.every((id) => looked.includes(id))) throw new RulesError(`Put the ${looked.length} card(s) back on top.`);
    library.splice(0, looked.length, ...top);
    return true;
  }
  const all = [...top, ...away];
  if (all.length !== looked.length || new Set(all).size !== all.length || !all.every((id) => looked.includes(id))) {
    throw new RulesError(`Put each of the ${looked.length} card(s) somewhere.`);
  }
  // Take them all off the top, then put the kept ones back on top in the chosen order.
  library.splice(0, looked.length);
  library.unshift(...top);
  if (answer.kind === 'scry') library.push(...away);
  else for (const id of away) moveObject(ctx.g, id, 'graveyard', ctx.events);
  ctx.events.push(
    answer.kind === 'scry'
      ? { type: 'scried', player: ctx.controller, top: top.length, bottom: away.length }
      : { type: 'surveilled', player: ctx.controller, top: top.length, graveyard: away.length },
  );
  return true;
}

function describeEffects(list: EffectNode[]): string {
  return list.map((e) => e.type.replace(/_/g, ' ')).join(', ');
}

function describeSearch(node: EffectNode, count: number): string {
  const to = { hand: 'into your hand', battlefield: 'onto the battlefield', graveyard: 'into your graveyard', library: 'on top', exile: 'into exile' }[String(node.to)];
  return `search your library for ${count >= 999 ? 'any number of' : `${node.upTo ? 'up to ' : ''}${count}`} card(s), put ${to}`;
}

// ---------------------------------------------------------------------------
// Trigger matchers (CR 603.2)
// ---------------------------------------------------------------------------

/** Does `o` satisfy a trigger's subject ("~" or "a creature you control")? */
function subjectMatches(check: TriggerCheck, subject: Ref, o: GameObject, opts: { lastController?: PlayerId; anyZone?: boolean; lookBack?: boolean } = {}): boolean {
  if (subject.ref === 'self') return o.id === check.source.id;
  // Hunter's Insight: "Whenever that creature deals combat damage … this turn" — the object its creator targeted.
  if (subject.ref === 'target') {
    const t = check.targets?.[subject.index]?.[0];
    return Boolean(t && t.kind === 'object' && t.id === o.id && (t.zcc === o.zcc || t.zcc === battlefieldZcc(check.g, o)));
  }
  // "enchanted creature", "equipped creature" — as it was attached when the event happened: "When enchanted
  // creature dies" looks back at the creature that left (CR 603.10a), even if the Aura left with it.
  if (subject.ref === 'attached') {
    const last = check.g.lastKnown?.[check.source.id];
    const at = check.source.attachedTo ?? (check.sourceLeft && last && last.zcc === check.source.zcc - 1 ? last.attachedTo : undefined);
    return Boolean(at && at.id === o.id && (at.zcc === o.zcc || at.zcc === battlefieldZcc(check.g, o)));
  }
  if (subject.ref !== 'all') return false;
  const filter: ObjectFilter = { ...subject.filter };
  return matchesFilter(check.g, o, filter, {
    controller: check.controller,
    source: check.source,
    ...(opts.anyZone ? { anyZone: true } : {}),
    ...(opts.lastController ? { lastController: opts.lastController } : {}),
    ...(opts.lookBack ? { lookBack: true } : {}),
  });
}

const refTo = (o: GameObject) => ({ id: o.id, zcc: o.zcc });

const triggers: Record<string, (t: TriggerNode, check: TriggerCheck) => TriggerInfo[]> = {
  // CR 603.6a: enters-the-battlefield abilities.
  enters(t, check) {
    const e = check.event;
    if (check.sourceLeft) return [];
    const id = e.type === 'created' ? e.object : e.type === 'moved' && e.to === 'battlefield' ? e.object : null;
    const o = id ? check.g.objects[id] : undefined;
    if (!o || o.zone !== 'battlefield' || !subjectMatches(check, t.subject as Ref, o)) return [];
    // "When ~ enters untapped"; Amulet of Vigor: "Whenever a permanent you control enters tapped"
    if (t.untapped && o.tapped) return [];
    if (t.tapped && !o.tapped) return [];
    // "Whenever one or more tokens you control enter": once for the batch.
    if (t.batch) {
      const all = (check.batch ?? [e]).filter((x) => {
        const xid = x.type === 'created' ? x.object : x.type === 'moved' && x.to === 'battlefield' ? x.object : null;
        const xo = xid ? check.g.objects[xid] : undefined;
        return Boolean(xo && xo.zone === 'battlefield' && subjectMatches(check, t.subject as Ref, xo));
      });
      // "that much": how many of them entered together; Kambal: "for each of them" — which.
      const created = all.flatMap((x) => {
        const xid = x.type === 'created' ? x.object : x.type === 'moved' ? x.object : null;
        const xo = xid ? check.g.objects[xid] : undefined;
        return xo ? [refTo(xo)] : [];
      });
      return all[0] === e ? [{ amount: all.length, created }] : [];
    }
    return [{ object: refTo(o), player: o.controller }];
  },
  // CR 700.4: "dies" means put into a graveyard from the battlefield. CR 603.10a: these look back in time.
  dies(t, check) {
    const e = check.event;
    if (e.type !== 'moved' || e.from !== 'battlefield' || e.to !== 'graveyard') return [];
    const o = check.g.objects[e.object];
    if (!o) return [];
    const lki = { counters: e.counters ?? {} };
    if (!subjectMatches(check, t.subject as Ref, o, { anyZone: true, lastController: e.controller, lookBack: true })) return [];
    // "Whenever one or more other creatures die": once for the creatures that died at the same time.
    if (t.batch) {
      const first = (check.batch ?? [e]).find((x) => {
        if (x.type !== 'moved' || x.from !== 'battlefield' || x.to !== 'graveyard') return false;
        const xo = check.g.objects[x.object];
        return Boolean(xo && subjectMatches(check, t.subject as Ref, xo, { anyZone: true, lastController: x.controller, lookBack: true }));
      });
      return first === e ? [{}] : [];
    }
    // "Whenever a creature an opponent controls dies, that player loses 2 life": who controlled it (CR 603.10a).
    return [{ object: refTo(o), lki, player: e.controller }];
  },
  // CR 603.6c: leaves-the-battlefield abilities.
  leaves(t, check) {
    const e = check.event;
    // Kaya's Ghostform: "When enchanted permanent dies or is put into exile" — only to those zones.
    // Dour Port-Mage: "… leave the battlefield without dying" — anywhere but a graveyard (CR 700.4).
    const fits = (x: GameEvent) =>
      x.type === 'moved' && x.from === 'battlefield' && (!Array.isArray(t.toZones) || (t.toZones as string[]).includes(x.to)) && !(t.withoutDying && x.to === 'graveyard');
    if (!fits(e) || e.type !== 'moved') return [];
    const o = check.g.objects[e.object];
    if (!o) return [];
    const lki = { counters: e.counters ?? {} };
    if (!subjectMatches(check, t.subject as Ref, o, { anyZone: true, lastController: e.controller, lookBack: true })) return [];
    // "Whenever one or more other creatures you control leave the battlefield": once for those that left together.
    if (t.batch) {
      const first = (check.batch ?? [e]).find((x) => {
        if (!fits(x) || x.type !== 'moved') return false;
        const xo = check.g.objects[x.object];
        return Boolean(xo && subjectMatches(check, t.subject as Ref, xo, { anyZone: true, lastController: x.controller, lookBack: true }));
      });
      return first === e ? [{}] : [];
    }
    return [{ object: refTo(o), lki, player: e.controller }];
  },
  attacks(t, check) {
    const e = check.event;
    if (e.type !== 'attacks_declared' || check.sourceLeft) return [];
    // CR 506.5 / CR 702.83b: "attacks alone" — the only creature declared as an attacker.
    if (t.alone && e.attacks.length !== 1) return [];
    return e.attacks.flatMap(({ attacker, target }) => {
      const o = check.g.objects[attacker];
      if (!o || !subjectMatches(check, t.subject as Ref, o)) return [];
      // Guild Artisan: "Whenever this creature attacks a player".
      if (t.defender === 'player' && target.kind !== 'player') return [];
      // CR 702.105a (dethrone): attacking the player with the most life or tied for most life.
      if (t.defender === 'most_life') {
        if (target.kind !== 'player') return [];
        const most = Math.max(...livePlayers(check.g).map((p) => check.g.players[p]!.life));
        if (check.g.players[target.player]!.life < most) return [];
      }
      // CR 702.149a (training): with at least one other attacker with greater power.
      if (t.withGreaterPower && !e.attacks.some((x) => x.attacker !== o.id && check.g.objects[x.attacker] && power(check.g, check.g.objects[x.attacker]!) > power(check.g, o))) return [];
      // "Whenever ~ and at least two other creatures attack"
      if (typeof t.withOthers === 'number' && e.attacks.length < t.withOthers + 1) return [];
      // "Whenever a creature attacks you or a planeswalker you control"
      if (t.defender === 'you' && (target.kind === 'player' ? target.player !== check.controller : check.g.objects[target.object]?.controller !== check.controller)) return [];
      // "Whenever a creature attacks you"
      if (t.defender === 'you_only' && (target.kind !== 'player' || target.player !== check.controller)) return [];
      // "Whenever ~ attacks for the first time each turn"
      if (t.firstTime && (check.g.turnLog.attacks?.[o.id] ?? 0) !== 1) return [];
      // CR 702.171b: "attacks while saddled" — saddled this turn, before it attacked.
      if (t.saddled && o.saddledTurn !== check.g.turn) return [];
      // "Whenever a creature attacks enchanted player"
      if (t.defender === 'enchanted' && (target.kind !== 'player' || target.player !== check.source.attachedToPlayer)) return [];
      const player = target.kind === 'player' ? target.player : check.g.objects[target.object]?.controller;
      return [{ object: refTo(o), ...(player ? { player } : {}) }];
    });
  },
  // CR 509.3a: "whenever [a creature] blocks" triggers once per combat for that creature.
  blocks(t, check) {
    const e = check.event;
    if (e.type !== 'blocks_declared' || check.sourceLeft) return [];
    // "blocks or becomes blocked by a creature": once for each creature on the other side, about that creature.
    if (t.orBlocked && t.other) {
      const each: TriggerInfo[] = [];
      const fits = (id: string) => Boolean(check.g.objects[id] && matchesFilter(check.g, check.g.objects[id]!, t.other as ObjectFilter, { controller: check.controller, source: check.source }));
      for (const { blocker, attacker } of e.blocks) {
        const b = check.g.objects[blocker];
        const a = check.g.objects[attacker];
        if (!a || !b) continue;
        if (subjectMatches(check, t.subject as Ref, b) && fits(attacker)) each.push({ object: refTo(a) });
        if (subjectMatches(check, t.subject as Ref, a) && fits(blocker)) each.push({ object: refTo(b), player: b.controller });
      }
      return each;
    }
    const out = new Map<string, TriggerInfo>();
    for (const { blocker, attacker } of e.blocks) {
      const o = check.g.objects[blocker];
      // "Whenever ~ blocks a creature with flying"
      const blockedOk = !t.blocked || Boolean(check.g.objects[attacker] && matchesFilter(check.g, check.g.objects[attacker]!, t.blocked as ObjectFilter, { controller: check.controller, source: check.source }));
      // With a kind of blocked creature, the trigger is about that creature ("destroy that creature").
      if (o && blockedOk && subjectMatches(check, t.subject as Ref, o)) out.set(o.id, { object: refTo(t.blocked ? check.g.objects[attacker]! : o) });
      // "blocks or becomes blocked" (bushido, CR 702.45a).
      const a = check.g.objects[attacker];
      if (t.orBlocked && a && subjectMatches(check, t.subject as Ref, a)) out.set(a.id, { object: refTo(a) });
    }
    return [...out.values()];
  },
  // CR 509.3c: "becomes blocked" triggers once per combat; CR 509.3d: "becomes blocked by a creature" once per blocker.
  becomes_blocked(t, check) {
    const e = check.event;
    if (e.type !== 'blocks_declared' || check.sourceLeft) return [];
    const once = new Map<string, TriggerInfo>();
    const each: TriggerInfo[] = [];
    for (const { blocker, attacker } of e.blocks) {
      const a = check.g.objects[attacker];
      const b = check.g.objects[blocker];
      if (!a || !b || !subjectMatches(check, t.subject as Ref, a)) continue;
      // "defending player": the blocking creature's controller (CR 506.2).
      if (t.by) {
        if (matchesFilter(check.g, b, t.by as ObjectFilter, { controller: check.controller, source: check.source })) each.push({ object: refTo(b), player: b.controller });
      } else once.set(a.id, { object: refTo(a), player: b.controller });
    }
    return t.by ? each : [...once.values()];
  },
  // "Whenever ~ becomes the target of a spell or ability an opponent controls" (ward, CR 702.21a).
  becomes_target(t, check) {
    const e = check.event;
    if (e.type !== 'became_target' || check.sourceLeft) return [];
    if (t.by === 'opponent' && e.controller === check.controller) return [];
    if (t.by === 'you' && e.controller !== check.controller) return [];
    if (t.targetedBy === 'spell' && !e.spell) return [];
    if (t.targetedBy === 'ability' && !e.entry) return [];
    // Valiant: "for the first time each turn"
    if (t.first && !e.first) return [];
    const o = check.g.objects[e.object];
    if (!o || !subjectMatches(check, t.subject as Ref, o)) return [];
    const spell = e.spell ? check.g.objects[e.spell] : undefined;
    return [{ player: e.controller, ...(spell ? { object: refTo(spell) } : {}), ...(e.entry ? { entry: e.entry } : {}) }];
  },
  deals_combat_damage(t, check) {
    const e = check.event;
    // "Whenever ~ deals combat damage to a creature" — the creature is the trigger's object.
    if (t.to === 'creature') {
      if (e.type !== 'damage' || !e.combat || e.to.kind !== 'permanent' || check.sourceLeft) return [];
      const src = check.g.objects[e.source];
      const hit = check.g.objects[e.to.object];
      if (!src || !hit || !subjectMatches(check, t.subject as Ref, src, { anyZone: true })) return [];
      return chars(check.g, hit).types.includes('Creature') ? [{ object: refTo(hit), amount: e.amount }] : [];
    }
    // "deals combat damage to a player or planeswalker" / "… or battle": that player is the permanent's controller.
    if ((t.to === 'player_or_planeswalker' || t.to === 'player_or_battle') && e.type === 'damage' && e.combat && e.to.kind === 'permanent' && !check.sourceLeft) {
      const src = check.g.objects[e.source];
      const hit = check.g.objects[e.to.object];
      if (!src || !hit || !subjectMatches(check, t.subject as Ref, src, { anyZone: true })) return [];
      return chars(check.g, hit).types.includes(t.to === 'player_or_battle' ? 'Battle' : 'Planeswalker') ? [{ object: refTo(src), player: hit.controller, amount: e.amount }] : [];
    }
    if (e.type !== 'damage' || !e.combat || e.to.kind !== 'player' || check.sourceLeft) return [];
    if (t.to === 'enchanted' && e.to.player !== check.source.attachedToPlayer) return [];
    // Great Train Heist: "… deals combat damage to that player this turn" — the player its creator targeted.
    const hitPlayer = e.to.player;
    if (t.to === 'target' && !check.targets?.[Number(t.index ?? 0)]?.some((x) => x.kind === 'player' && x.player === hitPlayer)) return [];
    // "Whenever a creature deals combat damage to one of your opponents"
    if (t.to === 'opponent' && e.to.player === check.controller) return [];
    const o = check.g.objects[e.source];
    return o && subjectMatches(check, t.subject as Ref, o, { anyZone: true }) ? [{ object: refTo(o), player: e.to.player, amount: e.amount }] : [];
  },
  // CR 603.8: a state trigger, checked whenever triggers are; it won't trigger again while it's waiting or on the stack.
  state(t, check) {
    if (check.sourceLeft || check.event !== check.batch?.[0]) return [];
    const ctx = { g: check.g, controller: check.controller, source: check.source, events: [], targets: [], x: 0, memo: {} };
    if (!evalCondition(t.condition as ConditionNode, ctx)) return [];
    const src = check.source;
    const waiting = check.g.triggers.some((x) => x.source.id === src.id && x.ability.trigger === t) ||
      check.g.stack.some((x) => x.kind === 'ability' && x.source.id === src.id && x.trigger?.state === true);
    return waiting ? [] : [{ state: true }];
  },
  // "When ~ enters or attacks": either event (once per event, CR 603.2c).
  either(t, check) {
    return ((t.of as TriggerNode[] | undefined) ?? []).flatMap((sub) => matchTrigger(sub, check));
  },
  // "Whenever ~ becomes tapped" (CR 701.26a).
  becomes_tapped(t, check) {
    const e = check.event;
    // "becomes tapped", or "becomes untapped" with `untapped`.
    if (e.type !== 'tapped' || e.tapped === Boolean(t.untapped) || check.sourceLeft) return [];
    const o = check.g.objects[e.object];
    return o && subjectMatches(check, t.subject as Ref, o) ? [{ object: refTo(o), player: o.controller }] : [];
  },
  // CR 731.1a: "Whenever day becomes night or night becomes day" (not when it first becomes one).
  day_night_changed(t, check) {
    const e = check.event;
    return e.type === 'day_night' && e.from && !check.sourceLeft ? [{}] : [];
  },
  // CR 702.63a: "When the last time counter is removed from ~".
  last_counter_removed(t, check) {
    const e = check.event;
    if (e.type !== 'counters' || e.delta >= 0 || e.object !== check.source.id || e.counter !== t.counter || check.sourceLeft) return [];
    return (check.source.counters[String(t.counter)] ?? 0) === 0 ? [{ object: refTo(check.source) }] : [];
  },
  // "When ~ is turned face up" (CR 708.8: it doesn't enter again).
  turned_face_up(t, check) {
    const e = check.event;
    if (e.type !== 'turned_face_up' || check.sourceLeft) return [];
    const o = check.g.objects[e.object];
    return o && subjectMatches(check, t.subject as Ref, o) ? [{ object: refTo(o) }] : [];
  },
  // CR 716.2a: "When this Class becomes level 2"
  becomes_level(t, check) {
    const e = check.event;
    if (e.type !== 'class_level' || e.object !== check.source.id || e.level !== Number(t.level) || check.sourceLeft) return [];
    return [{ object: refTo(check.source) }];
  },
  // CR 714.2b: a chapter ability triggers as the lore count goes from below N to at least N.
  chapter(t, check) {
    const e = check.event;
    if (e.type !== 'counters' || e.counter !== 'lore' || e.delta <= 0 || e.object !== check.source.id || check.sourceLeft) return [];
    const after = check.source.counters.lore ?? 0;
    const before = after - e.delta;
    // CR 702.155a: with read ahead, the turn it entered only the chapter matching its exact count triggers.
    const exact = hasReadAhead(check.g, check.source) && Boolean(check.g.turnLog.entered?.[check.source.controller]?.includes(check.source.id));
    return (t.chapters as number[]).some((n) => before < n && after >= n && (!exact || after === n)) ? [{ object: refTo(check.source) }] : [];
  },
  // "Whenever ~ deals damage" / "deals combat damage": once for everything it dealt at the same time.
  deals_damage(t, check) {
    const e = check.event;
    if (e.type !== 'damage' || (t.combat && !e.combat) || (t.noncombat && e.combat) || check.sourceLeft) return [];
    // "Whenever ~ deals damage to a creature": once for each creature, which is the trigger's object.
    if (t.to === 'creature') {
      if (e.to.kind !== 'permanent') return [];
      const src = check.g.objects[e.source];
      const hit = check.g.objects[e.to.object];
      if (!src || !hit || !subjectMatches(check, t.subject as Ref, src, { anyZone: true }) || !chars(check.g, hit).types.includes('Creature')) return [];
      return [{ object: refTo(hit), amount: e.amount }];
    }
    // "Whenever ~ deals damage to a player" / "to an opponent": once for each player dealt damage; No Mercy: "to you".
    if (t.to === 'player' || t.to === 'opponent' || t.to === 'you') {
      if (e.to.kind !== 'player' || (t.to === 'opponent' && e.to.player === check.controller) || (t.to === 'you' && e.to.player !== check.controller)) return [];
      const to = e.to.player;
      const hits = (check.batch ?? [e]).filter((x): x is typeof e => x.type === 'damage' && x.source === e.source && x.combat === e.combat && x.to.kind === 'player' && x.to.player === to);
      if (hits[0] !== e) return [];
      const src = check.g.objects[e.source];
      return src && subjectMatches(check, t.subject as Ref, src, { anyZone: true }) ? [{ object: refTo(src), player: to, amount: hits.reduce((n, x) => n + x.amount, 0) }] : [];
    }
    const together = (check.batch ?? [e]).filter((x): x is typeof e => x.type === 'damage' && x.source === e.source && x.combat === e.combat);
    if (together[0] !== e) return [];
    const o = check.g.objects[e.source];
    const amount = together.reduce((n, x) => n + x.amount, 0);
    return o && subjectMatches(check, t.subject as Ref, o, { anyZone: true }) ? [{ object: refTo(o), amount }] : [];
  },
  // "Whenever ~ is dealt damage": once per batch, for all of it.
  dealt_damage(t, check) {
    const e = check.event;
    if (e.type !== 'damage' || e.to.kind !== 'permanent' || check.sourceLeft) return [];
    const to = e.to.object;
    // "Whenever a source deals damage to ~": once for each source, "that source's controller" its controller.
    const together = (check.batch ?? [e]).filter((x): x is typeof e => x.type === 'damage' && x.to.kind === 'permanent' && x.to.object === to && (!t.perSource || x.source === e.source));
    if (together[0] !== e) return [];
    const o = check.g.objects[to];
    const amount = together.reduce((n, x) => n + x.amount, 0);
    const src = check.g.objects[e.source];
    const by = t.perSource && src ? { player: src.controller } : {};
    return o && subjectMatches(check, t.subject as Ref, o, { anyZone: true }) ? [{ object: refTo(o), amount, ...by }] : [];
  },
  // "Whenever you're dealt damage"
  player_dealt_damage(t, check) {
    const e = check.event;
    if (e.type !== 'damage' || e.to.kind !== 'player' || check.sourceLeft) return [];
    if (e.to.player !== (t.who === 'enchanted' ? check.source.attachedToPlayer : check.controller)) return [];
    const player = e.to.player;
    const together = (check.batch ?? [e]).filter((x): x is typeof e => x.type === 'damage' && x.to.kind === 'player' && x.to.player === player);
    if (together[0] !== e) return [];
    return [{ player, amount: together.reduce((n, x) => n + x.amount, 0) }];
  },
  // "Whenever an opponent loses life" / "Whenever you lose life"
  lose_life(t, check) {
    const e = check.event;
    if (e.type !== 'life' || e.delta >= 0 || check.sourceLeft) return [];
    if (t.who === 'you' ? e.player !== check.controller : e.player === check.controller) return [];
    // Valgavoth: "for the first time during each of their turns" — the first loss this turn, on that player's turn.
    if (t.first && !e.firstLoss) return [];
    if (t.theirTurn && check.g.active !== e.player) return [];
    return [{ player: e.player, amount: -e.delta }];
  },
  // Baral: "Whenever a spell or ability you control counters a spell" (CR 701.6a).
  counters_spell(t, check) {
    const e = check.event;
    if (e.type !== 'countered' || !e.by || check.sourceLeft) return [];
    if (t.who === 'you' ? e.by !== check.controller : t.who === 'opponent' ? e.by === check.controller : false) return [];
    return [{ player: e.by }];
  },
  // CR 603.2b: "at the beginning of" a step triggers as the step begins.
  phase(t, check) {
    const e = check.event;
    if (e.type !== 'step' || e.step !== t.step || check.sourceLeft) return [];
    const active = check.g.active;
    if (t.whose === 'you' && active !== check.controller) return [];
    if (t.whose === 'opponent' && active === check.controller) return [];
    // Curses: "At the beginning of enchanted player's upkeep"
    if (t.whose === 'enchanted' && active !== check.source.attachedToPlayer) return [];
    // Black Vise: "At the beginning of the chosen player's upkeep"
    if (t.whose === 'chosen' && active !== check.source.chosen?.player) return [];
    // "At the beginning of the upkeep of enchanted creature's controller"
    if (t.whose === 'attached_controller') {
      const r = check.source.attachedTo;
      const host = r ? check.g.objects[r.id] : undefined;
      if (!host || host.zcc !== r!.zcc || host.controller !== active) return [];
    }
    return [{ player: active }];
  },
  // CR 506.3: "Whenever enchanted player is attacked" — once per combat, as attackers are declared.
  player_attacked(t, check) {
    const e = check.event;
    if (e.type !== 'attacks_declared' || check.sourceLeft) return [];
    const defender = check.source.attachedToPlayer;
    if (!defender || !e.attacks.some(({ target }) => target.kind === 'player' && target.player === defender)) return [];
    if (t.by === 'you' && check.g.active !== check.controller) return [];
    return [{ player: check.g.active }];
  },
  gain_life(t, check) {
    const e = check.event;
    if (e.type !== 'life' || e.delta <= 0 || check.sourceLeft || e.player !== check.controller) return [];
    // "Whenever you gain life for the first time each turn"
    if (t.first && !e.firstGain) return [];
    return [{ player: e.player, amount: e.delta }];
  },
  draw(t, check) {
    const e = check.event;
    if (e.type !== 'drew' || check.sourceLeft) return [];
    // "Whenever an opponent draws a card"
    if (t.who === 'any' ? false : t.who === 'opponent' ? e.player === check.controller : e.player !== (t.who === 'enchanted' ? check.source.attachedToPlayer : check.controller)) return [];
    // "Whenever you draw your second card each turn"
    if (t.nth && e.nth !== t.nth) return [];
    // Orcish Bowmasters: "except the first one they draw in each of their draw steps"
    if (t.exceptFirstInDrawStep && e.firstInDrawStep) return [];
    return [{ player: e.player }];
  },
  // CR 508.3d: "Whenever you attack" (with N or more creatures) — once as you declare attackers;
  // CR 508.3e: "Whenever you attack a player" — once for each player attacked.
  you_attack(t, check) {
    const e = check.event;
    if (e.type !== 'attacks_declared' || check.sourceLeft || !e.attacks.length) return [];
    // Mangara, Trouble in Pairs: an opponent attacks you (and/or your planeswalkers) with N or more creatures.
    if (t.opponent) {
      const g = check.g;
      if (g.active === check.controller) return [];
      const atYou = e.attacks.filter(({ target }) => (target.kind === 'player' ? target.player === check.controller : t.atYou === 'or_planeswalkers' && g.objects[target.object]?.controller === check.controller));
      return atYou.length >= Number(t.min ?? 1) ? [{ player: g.active }] : [];
    }
    if (!t.anyone && check.g.active !== check.controller) return [];
    // Firemane Commando: "Whenever another player attacks …".
    if (t.other && check.g.active === check.controller) return [];
    // General Kreat: "Whenever one or more Goblins you control attack" — only those count.
    const attacks = t.filter ? e.attacks.filter(({ attacker }) => check.g.objects[attacker] && matchesFilter(check.g, check.g.objects[attacker]!, t.filter as ObjectFilter, { controller: check.controller, source: check.source ?? null })) : e.attacks;
    if (!attacks.length) return [];
    // CR 508.3e: "Whenever you attack a player [with one or more …]", "two or more creatures you control attack a
    // player" — once for each player attacked by enough of the matching creatures.
    if (t.perPlayer) {
      const count = new Map<PlayerId, number>();
      for (const { target } of attacks) if (target.kind === 'player') count.set(target.player, (count.get(target.player) ?? 0) + 1);
      return [...count].filter(([, n]) => n >= Number(t.min ?? 1)).map(([player]) => ({ player }));
    }
    if (typeof t.min === 'number' && attacks.length < t.min) return [];
    // "Whenever a player attacks …": that player is the attacker.
    return t.anyone ? [{ player: check.g.active }] : [{}];
  },
  // CR 509.3g: "Whenever ~ attacks and isn't blocked" — once blockers have been declared.
  unblocked(t, check) {
    const e = check.event;
    const c = check.g.combat;
    if (e.type !== 'blockers_done' || check.sourceLeft || !c) return [];
    const hits = Object.entries(c.attackers).flatMap(([id, a]) => {
      const o = check.g.objects[id];
      if (!o || o.zcc !== a.zcc || a.blocked || !subjectMatches(check, t.subject as Ref, o)) return [];
      // Coveted Jewel: "… attack you and aren't blocked" — "that player" is the one attacking.
      if (t.you) return a.target.kind === 'player' && a.target.player === check.controller ? [{ object: refTo(o), player: o.controller }] : [];
      const player = a.target.kind === 'player' ? a.target.player : check.g.objects[a.target.object]?.controller;
      return [{ object: refTo(o), ...(player ? { player } : {}) }];
    });
    if (t.batch) return hits.length ? [{ player: hits[0]!.player }] : [];
    return hits;
  },
  // "Whenever one or more creatures you control deal combat damage to a player": once for each player dealt damage.
  combat_damage_batch(t, check) {
    const e = check.event;
    if (e.type !== 'damage' || !e.combat || e.to.kind !== 'player' || check.sourceLeft) return [];
    const to = e.to.player;
    if (t.opponent && to === check.controller) return [];
    const matches = (x: GameEvent) => {
      // Contaminant Grafter: "to one or more players" — damage to any player.
      if (x.type !== 'damage' || !x.combat || x.to.kind !== 'player' || (!t.anyPlayers && x.to.player !== to)) return false;
      const src = check.g.objects[x.source];
      return Boolean(src && matchesFilter(check.g, src, t.filter as ObjectFilter, { controller: check.controller, source: check.source, anyZone: true }));
    };
    const batch = (check.batch ?? [e]).filter(matches);
    if (batch[0] !== e) return [];
    if (t.anyPlayers) return [{}];
    return [{ player: to, amount: batch.reduce((n, x) => n + (x.type === 'damage' ? x.amount : 0), 0) }];
  },
  // "Whenever one or more cards leave your graveyard": once per batch.
  leave_graveyard(t, check) {
    const e = check.event;
    // Laelia: "… put into exile from your library and/or your graveyard" — `from` those zones, `to` exile.
    const from = (t.from as string[] | undefined) ?? ['graveyard'];
    const left = (x: GameEvent): x is Extract<GameEvent, { type: 'moved' }> => x.type === 'moved' && from.includes(x.from) && (!t.to || x.to === t.to);
    if (!left(e) || check.sourceLeft) return [];
    const mine = (x: GameEvent) => {
      if (x.type !== 'moved' || !left(x)) return false;
      const o = check.g.objects[x.object];
      return Boolean(o && o.owner === check.controller && (!t.filter || matchesFilter(check.g, o, t.filter as ObjectFilter, { controller: check.controller, anyZone: true })));
    };
    // "Whenever a creature card leaves your graveyard": each card.
    if (t.each) return mine(e) ? [{ object: { id: e.object, zcc: check.g.objects[e.object]!.zcc } }] : [];
    const batch = (check.batch ?? [e]).filter(mine);
    return batch[0] === e ? [{}] : [];
  },
  // CR 701.9: "Whenever you discard a card", "Whenever an opponent discards a card", "… one or more cards" (once per
  // batch). CR 702.29d: "cycles or discards" triggers once when a card is cycled (cycling discards it).
  discard(t, check) {
    const e = check.event;
    if (e.type !== 'discarded' || check.sourceLeft || (t.other && e.object === check.source.id)) return [];
    if (t.who === 'you' && e.player !== check.controller) return [];
    if (t.who === 'opponent' && e.player === check.controller) return [];
    const ok = (id: ObjectId) => {
      const x = check.g.objects[id];
      return !t.filter || Boolean(x && matchesFilter(check.g, x, t.filter as ObjectFilter, { controller: check.controller, anyZone: true }));
    };
    if (!ok(e.object)) return [];
    if (t.batch) {
      const together = (check.batch ?? [e]).filter((x) => x.type === 'discarded' && x.player === e.player && ok(x.object));
      if (together[0] !== e) return [];
      // Magmakin Artillerist: "Whenever you discard one or more cards, … deals that much damage" — how many.
      const cards = together.flatMap((x) => (x.type === 'discarded' && check.g.objects[x.object] ? [refTo(check.g.objects[x.object]!)] : []));
      return [{ player: e.player, amount: together.length, created: cards }];
    }
    const o = check.g.objects[e.object];
    return [{ player: e.player, ...(o ? { object: refTo(o) } : {}) }];
  },
  // CR 706: "Whenever you roll one or more dice", "Whenever you roll a die"
  die_rolled(t, check) {
    const e = check.event;
    if (e.type !== 'die_rolled' || check.sourceLeft || (t.who === 'you' && e.player !== check.controller)) return [];
    return [{ player: e.player }];
  },
  // CR 709.5h: "When you unlock this door" — the door the ability is printed on (rooms.ts tags it).
  unlock_door(t, check) {
    const e = check.event;
    return e.type === 'unlocked' && e.object === check.source.id && e.half === t.door && !check.sourceLeft ? [{ object: refTo(check.source) }] : [];
  },
  // CR 709.5i: "Whenever you fully unlock a Room", "When you fully unlock this Room"
  fully_unlocked(t, check) {
    const e = check.event;
    if (e.type !== 'unlocked' || !e.full || e.player !== check.controller || check.sourceLeft) return [];
    if (t.self && e.object !== check.source.id) return [];
    const o = check.g.objects[e.object];
    return o ? [{ object: refTo(o) }] : [];
  },
  // CR 701.27e: "When this creature transforms into [this face]" — the ability is on the face it became.
  transforms(t, check) {
    const e = check.event;
    return e.type === 'transformed' && e.object === check.source.id && !check.sourceLeft ? [{ object: refTo(check.source) }] : [];
  },
  // CR 700.13: "Whenever you commit a crime"
  crime(t, check) {
    const e = check.event;
    if (e.type !== 'crime' || check.sourceLeft) return [];
    // "Whenever an opponent commits a crime"
    if (t.who === 'opponent') return e.player !== check.controller ? [{ player: e.player }] : [];
    return e.player === check.controller ? [{ player: e.player }] : [];
  },
  // CR 700.14: "Whenever you expend 4" — the mana you've spent on spells this turn reaches 4.
  expend(t, check) {
    const e = check.event;
    if (e.type !== 'cast' || e.player !== check.controller || check.sourceLeft || e.manaBefore === undefined) return [];
    const n = Number(t.n);
    return e.manaBefore < n && e.manaBefore + (e.manaSpent ?? 0) >= n ? [{ player: e.player }] : [];
  },
  // CR 309.7: "Whenever you complete a dungeon"
  dungeon_completed(t, check) {
    const e = check.event;
    return e.type === 'dungeon_completed' && e.player === check.controller && !check.sourceLeft ? [{ player: e.player }] : [];
  },
  // CR 309.4c: room abilities are put on the stack by the dungeon's own trigger handling (dungeons.ts).
  room() {
    return [];
  },
  // CR 701.54d: "Whenever the Ring tempts you"; "Whenever you choose a creature as your Ring-bearer".
  ring_tempted(t, check) {
    const e = check.event;
    if (e.type !== 'ring_tempted' || e.player !== check.controller || check.sourceLeft) return [];
    if (t.chose && !e.object) return [];
    const o = e.object ? check.g.objects[e.object] : undefined;
    return [{ player: e.player, ...(o ? { object: refTo(o) } : {}) }];
  },
  // CR 701.37: "When ~ becomes monstrous" — X is the N it became monstrous with (CR 701.37c).
  becomes_monstrous(t, check) {
    const e = check.event;
    if (e.type !== 'became_monstrous' || e.object !== check.source.id || check.sourceLeft) return [];
    return [{ object: refTo(check.source), amount: e.amount }];
  },
  // CR 603.12: reflexive abilities are created by the effect that names them, never by an event.
  reflexive() {
    return [];
  },
  // "When that mana is spent to cast …": put in place by the payment (see cast).
  mana_spent() {
    return [];
  },
  // CR 605.1b: triggered mana abilities resolve with the mana ability that tapped the permanent (see runManaAbility).
  tapped_for_mana() {
    return [];
  },
  // "Whenever you scry", "Whenever you scry or surveil" (CR 701.22, 701.25).
  scry(t, check) {
    const e = check.event;
    if (check.sourceLeft || (e.type !== 'scried' && e.type !== 'surveilled' && e.type !== 'foraged')) return [];
    if (e.player !== check.controller || !(t.kinds as string[]).includes(e.type === 'scried' ? 'scry' : e.type === 'foraged' ? 'forage' : 'surveil')) return [];
    return [{ player: e.player }];
  },
  // "Whenever one or more +1/+1 counters are put on ~": once per batch, with how many.
  counters_put(t, check) {
    const e = check.event;
    // Generous Patron: "one or more counters" — of any kind.
    if (e.type !== 'counters' || e.delta <= 0 || check.sourceLeft || (t.counter !== undefined && e.counter !== t.counter)) return [];
    // "Whenever you put one or more +1/+1 counters on …"
    if (t.byYou && e.by !== check.controller) return [];
    const o = check.g.objects[e.object];
    if (!o || !subjectMatches(check, t.subject as Ref, o)) return [];
    const together = (check.batch ?? [e]).filter(
      (x) => x.type === 'counters' && x.delta > 0 && x.object === e.object && (t.counter === undefined || x.counter === e.counter) && (!t.byYou || x.by === check.controller),
    );
    if (together[0] !== e) return [];
    const amount = together.reduce((n, x) => n + (x.type === 'counters' ? x.delta : 0), 0);
    // Midnight Clock: "When the twelfth hour counter is put on this artifact" — these counters took it to that many.
    if (typeof t.reaches === 'number') {
      const after = o.counters[e.counter] ?? 0;
      if (!(after - amount < t.reaches && after >= t.reaches)) return [];
    }
    // Fathom Mage: "Whenever a +1/+1 counter is put on this creature" — once for each counter.
    if (t.each) return Array.from({ length: amount }, () => ({ object: refTo(o), amount: 1 }));
    return [{ object: refTo(o), amount }];
  },
  // "Whenever you sacrifice a Clue", "Whenever you sacrifice another permanent" (CR 701.21a).
  sacrificed(t, check) {
    const e = check.event;
    if (e.type !== 'sacrificed') return [];
    // "Whenever a player sacrifices a permanent" / "an opponent"; otherwise you.
    if (t.who === 'opponent' ? e.player === check.controller : t.who !== 'any' && e.player !== check.controller) return [];
    const o = check.g.objects[e.object];
    if (!o) return [];
    // "another": not this permanent (which may itself have been sacrificed); "When you sacrifice ~".
    if (t.other && o.id === check.source.id) return [];
    if (t.self && o.id !== check.source.id) return [];
    // CR 702.110b: "When ~ exploits a creature" — sacrificed as its exploit ability resolved.
    if (t.exploit && e.exploitedBy !== check.source.id) return [];
    if (t.filter && !matchesFilter(check.g, o, t.filter as ObjectFilter, { controller: check.controller, anyZone: true, lastController: e.player })) return [];
    // "Whenever you sacrifice one or more Foods": once for those sacrificed at the same time (CR 603.2c).
    if (t.batch) {
      const first = (check.batch ?? [e]).find((x) => {
        if (x.type !== 'sacrificed') return false;
        if (t.who === 'opponent' ? x.player === check.controller : t.who !== 'any' && x.player !== check.controller) return false;
        const xo = check.g.objects[x.object];
        if (!xo || (t.other && xo.id === check.source.id)) return false;
        return !t.filter || matchesFilter(check.g, xo, t.filter as ObjectFilter, { controller: check.controller, anyZone: true, lastController: x.player });
      });
      return first === e ? [{}] : [];
    }
    return [{ object: refTo(o), player: e.player }];
  },
  // CR 701.43d: "When you do" (linked to "You may exert ~ as it attacks"), "Whenever you exert a creature".
  exerted(t, check) {
    const e = check.event;
    if (e.type !== 'exerted' || check.sourceLeft) return [];
    const o = check.g.objects[e.object];
    return o && subjectMatches(check, t.subject as Ref, o) ? [{ object: refTo(o), player: e.player }] : [];
  },
  // "When ~ is put into a graveyard from anywhere, shuffle it into its owner's library." (works in the graveyard)
  // CR 305.1: "Whenever you play a land", "Whenever an opponent plays a land" (Burgeoning) — playing it, not putting it
  // onto the battlefield.
  // Archivist of Oghma: "Whenever an opponent searches their library"
  // Ezuri, Stalker of Spheres: "Whenever you proliferate" (CR 701.34).
  proliferated(t, check) {
    const e = check.event;
    if (e.type !== 'proliferated' || check.sourceLeft || e.player !== check.controller) return [];
    return [{ player: e.player }];
  },
  searched(t, check) {
    const e = check.event;
    if (e.type !== 'searched' || check.sourceLeft || e.owner !== e.player) return [];
    if (t.who === 'opponent' && e.player === check.controller) return [];
    return [{ player: e.player }];
  },
  land_played(t, check) {
    const e = check.event;
    if (e.type !== 'land_played' || check.sourceLeft || (t.other && e.object === check.source.id)) return [];
    if (t.who === 'you' ? e.player !== check.controller : t.who === 'opponent' ? e.player === check.controller : false) return [];
    // Pia Nalaar, Consul of Revival: "Whenever you play a land from exile"; Shanid: "… a legendary land".
    if (t.from && e.from !== t.from) return [];
    const o = check.g.objects[e.object];
    if (t.filter && (!o || !matchesFilter(check.g, o, t.filter as ObjectFilter, { controller: check.controller, anyZone: true }))) return [];
    return [{ ...(o ? { object: refTo(o) } : {}), player: e.player }];
  },
  put_into_graveyard(t, check) {
    const e = check.event;
    // Syr Konrad: "Whenever a creature card is put into a graveyard from anywhere [other than the battlefield]"
    if ((t.subject as Ref | undefined)?.ref === 'all') {
      if (e.type !== 'moved' || e.to !== 'graveyard' || check.sourceLeft || (t.notFromBattlefield && e.from === 'battlefield') || (t.fromZone && e.from !== t.fromZone)) return [];
      const o = check.g.objects[e.object];
      const filter = (t.subject as { filter: ObjectFilter }).filter;
      if (!o || o.zone !== 'graveyard' || !matchesFilter(check.g, o, filter, { controller: check.controller, anyZone: true })) return [];
      // The Gitrog Monster: "one or more land cards" — once for the cards put there at the same time; Hedge Shredder's
      // "them" are those cards.
      if (t.batch) {
        const matching = (check.batch ?? [e]).filter((x) => {
          if (x.type !== 'moved' || x.to !== 'graveyard' || (t.notFromBattlefield && x.from === 'battlefield') || (t.fromZone && x.from !== t.fromZone)) return false;
          const xo = check.g.objects[x.object];
          return Boolean(xo && xo.zone === 'graveyard' && matchesFilter(check.g, xo, filter, { controller: check.controller, anyZone: true }));
        });
        if (matching[0] !== e) return [];
        return [t.fromZone ? { created: matching.flatMap((x) => (x.type === 'moved' && check.g.objects[x.object] ? [refTo(check.g.objects[x.object]!)] : [])) } : {}];
      }
      return [{ object: refTo(o) }];
    }
    if (e.type !== 'moved' || e.to !== 'graveyard' || e.object !== check.source.id || check.source.zone !== 'graveyard') return [];
    return [{ object: refTo(check.source) }];
  },
  // CR 701.30: "Whenever you clash", "Whenever you win a clash".
  clashed(t, check) {
    const e = check.event;
    if (e.type !== 'clashed' || check.sourceLeft || e.player !== check.controller) return [];
    if (t.won && !e.won) return [];
    return [{ player: e.player }];
  },
  // CR 602.2: "Whenever you activate an ability that isn't a mana ability", "Whenever an opponent activates a
  // loyalty ability", "Whenever an ability of equipped creature is activated". The ability is what it's about.
  activate(t, check) {
    const e = check.event;
    if (e.type !== 'ability_activated' || check.sourceLeft || !e.entry) return [];
    if (t.who === 'you' && e.player !== check.controller) return [];
    if (t.who === 'opponent' && e.player === check.controller) return [];
    if (t.loyalty && !e.loyalty) return [];
    // A keyword ability: "an exhaust ability" (its text starts with the keyword); CR 702.29f: typecycling is cycling.
    const text = e.text.toLowerCase();
    if (typeof t.keyword === 'string' && (t.keyword === 'cycling' ? !/^[a-z -]*cycling\b/.test(text) : !text.startsWith(t.keyword))) return [];
    // CR 702.29c: "When you cycle this card" — it triggers from wherever the card went.
    if (t.self && e.source !== check.source.id) return [];
    if (t.other && e.source === check.source.id) return [];
    if (t.subject) {
      const src = check.g.objects[e.source];
      // Harsh Mentor and a fetch land: a source sacrificed to pay the cost is looked at as it last was (CR 603.10a-style).
      const last = src && src.zone !== 'battlefield' ? check.g.lastKnown?.[src.id] : undefined;
      const lookBack = Boolean(last && last.zcc === src!.zcc - 1);
      if (!src || !subjectMatches(check, t.subject as Ref, src, lookBack ? { lookBack: true, anyZone: true } : {})) return [];
    }
    return [{ player: e.player, entry: e.entry }];
  },
  cast(t, check) {
    const e = check.event;
    // CR 707.10: "Whenever you cast or copy an instant or sorcery spell" — a copy put on the stack counts too.
    if (e.type === 'copied' && t.orCopy && !check.sourceLeft) {
      const copy = check.g.objects[e.object];
      if (!copy || copy.zone !== 'stack' || e.controller !== check.controller) return [];
      const filter = { ...(t.filter as ObjectFilter), zone: 'stack' as const };
      return matchesFilter(check.g, copy, filter, { controller: check.controller, source: check.source }) ? [{ object: refTo(copy), player: e.controller }] : [];
    }
    if (e.type !== 'cast' || check.sourceLeft) return [];
    // "Whenever you cast your second spell each turn"; "… their first noncreature spell each turn" counts only those.
    if (typeof t.nth === 'number' && t.nthOfKind) {
      const filter = { ...(t.filter as ObjectFilter) };
      const ctxF = { controller: check.controller, source: check.source, anyZone: true };
      const before = (check.g.turnLog.castSpells ?? []).filter((c) => c.player === e.player && c.id !== e.object && check.g.objects[c.id] && matchesFilter(check.g, check.g.objects[c.id]!, filter, ctxF)).length;
      if (before !== t.nth - 1) return [];
    } else if (typeof t.nth === 'number' && e.nth !== t.nth) return [];
    // CR 702.191a (increment): more mana spent on it than this creature's power or toughness.
    if (t.increment) {
      const src = check.source;
      if (src.zone !== 'battlefield' || !chars(check.g, src).types.includes('Creature')) return [];
      if ((e.manaSpent ?? 0) <= Math.min(power(check.g, src), toughness(check.g, src))) return [];
    }
    // "… during an opponent's turn"
    if (t.opponentsTurn && check.g.active === e.player) return [];
    // Boromir: "if no mana was spent to cast it"
    if (t.noManaSpent && (e.manaSpent ?? 0) > 0) return [];
    // "… from your hand", "… from exile", "… from anywhere other than your hand"
    const from = check.g.objects[e.object]?.cast?.from;
    if (typeof t.from === 'string' && from !== t.from) return [];
    if (typeof t.notFrom === 'string' && from === t.notFrom) return [];
    // "When you cast this spell" (it triggers from the stack).
    if (t.self) return e.object === check.source.id ? [{ object: refTo(check.source), player: e.player }] : [];
    if (t.who === 'you' && e.player !== check.controller) return [];
    if (t.who === 'opponent' && e.player === check.controller) return [];
    if (t.who === 'enchanted' && e.player !== check.source.attachedToPlayer) return [];
    // Sewer Nemesis: "Whenever the chosen player casts a spell"
    if (t.who === 'chosen' && e.player !== check.source.chosen?.player) return [];
    const spell = check.g.objects[e.object];
    if (!spell) return [];
    // Heroic: "a spell that targets ~"
    if (t.targetsSource) {
      const entry = check.g.stack.find((s) => s.kind === 'spell' && s.object === e.object);
      const src = check.source;
      if (!entry || !entry.targets.some((list) => list.some((x) => x.kind === 'object' && x.id === src.id && x.zcc === src.zcc))) return [];
    }
    // "Whenever you cast a kicked spell" (CR 702.33d)
    if (t.kicked && !spell.cast?.kicked) return [];
    // "… a spell that targets a creature you control" — as it was cast (CR 601.2c).
    if (t.targets) {
      const entry = check.g.stack.find((s) => s.kind === 'spell' && s.object === e.object);
      const hit = entry?.targets.some((list) =>
        list.some((x) => {
          if (x.kind !== 'object') return false;
          const o = check.g.objects[x.id];
          return Boolean(o && o.zcc === x.zcc && matchesFilter(check.g, o, t.targets as ObjectFilter, { controller: check.controller, source: check.source }));
        }),
      );
      if (!hit) return [];
    }
    const filter = { ...(t.filter as ObjectFilter), zone: 'stack' as const };
    return matchesFilter(check.g, spell, filter, { controller: check.controller, source: check.source }) ? [{ object: refTo(spell), player: e.player }] : [];
  },
};

export const corePlugin: MechanicPlugin = {
  id: 'core',
  effects,
  triggers,
  // Applied elsewhere: continuous effects in characteristics, additional costs when casting,
  // "exile it instead" in moveObject, rules for players in player-rules.ts, cost changes in costs.ts.
  // Deck-construction rules (CR 113.6n) do nothing during a game.
  statics: ['continuous', 'additional_cost', 'additional_cost_choice', 'top_permission', 'graveyard_to_exile', 'player_rule', 'as_enters', 'deck_rule', 'cost_modifier', 'replace_quantity', 'exile_instead', 'cast_option', 'resolve_to_hand', 'rebound', 'per_target_cost', 'graveyard_to_library', 'exert_option', 'begin_on_battlefield', 'dungeon_entry', 'gift_spell', 'cast_restriction', 'cast_prohibition', 'attack_tax', 'enter_tapped_others', 'enter_counters_others', 'uncounterable', 'draw_replacement', 'trigger_extra', 'prevent_damage', 'token_one_of_each', 'grant_escape', 'grant_retrace', 'target_life_tax', 'ability_cost_reduction', 'mana_multiplier', 'combat_limit', 'spell_keyword', 'enter_untapped_others', 'unpreventable', 'search_control', 'search_exile', 'graveyard_cast'],
  enterReplacements: {
    // CR 614.1d / 614.12: "[This permanent] enters tapped" is a replacement effect on how it enters.
    enters_tapped(node, o, g) {
      if (node.unless) {
        // CR 614.12: checked as it would enter — it isn't on the battlefield yet for "you control two or more other lands".
        const i = g.zones.battlefield.indexOf(o.id);
        if (i >= 0) g.zones.battlefield.splice(i, 1);
        try {
          if (evalCondition(node.unless as ConditionNode, { g, controller: o.controller, source: o, events: [], targets: [], x: 0, memo: {} })) return;
        } finally {
          if (i >= 0) g.zones.battlefield.splice(i, 0, o.id);
        }
      }
      o.tapped = true;
    },
    // CR 614.12: "As ~ enters, …" — the choice is asked for before anyone gets priority.
    as_enters(node, o, g) {
      // A permanent that already entered as a copy doesn't choose again from the copied ability.
      if ((node as AsEntersNode).choice === 'copy' && o.copyOf) return;
      queueAsEnters(g, o, node as AsEntersNode);
    },
    // CR 614.1c: "[This permanent] enters with N counters" — it's given them as it enters (CR 122.6).
    // "If it's neither day nor night, it becomes day as ~ enters."
    enters_day(_node, _o, g) {
      if (!g.dayNight) g.dayNight = 'day';
    },
    // CR 722.3a: "This creature enters prepared."
    enters_prepared(_node, o, g) {
      becomePrepared(g, o, []);
    },
    enters_with_counters(node, o, g) {
      // "If an opponent was dealt damage this turn, …" (bloodthirst), "If ~ was kicked, …".
      if (node.condition && !evalCondition(node.condition as ConditionNode, { g, controller: o.controller, source: o, events: [], targets: [], x: 0, memo: {} })) return;
      // "This land enters tapped with two charge counters on it."
      if (node.tapped) o.tapped = true;
      // CR 107.3m: X is the X paid for the spell that became this permanent.
      const per = node.amount === 'X' ? (o.x ?? 0) : typeof node.amount === 'number' ? node.amount : 0;
      // Converge: "… for each color of mana spent to cast it"
      if (node.perColor) {
        const n = replaceQuantity(g, 'counters', per * (o.cast?.colors ?? 0), { player: o.controller, object: o, counter: String(node.counter) });
        if (n > 0) o.counters[String(node.counter)] = (o.counters[String(node.counter)] ?? 0) + n;
        return;
      }
      // CR 702.33c: "… a +1/+1 counter on it for each time it was kicked"; Diregraf Colossus: "… for each Zombie card in
      // your graveyard" (counted as it enters, CR 614.1c).
      // It isn't on the battlefield yet as this is worked out (CR 614.1c), so it doesn't count itself.
      const perEach = node.perEach as AmountExpr | undefined;
      const counted = perEach?.kind === 'count' ? { ...perEach, filter: { ...perEach.filter, other: true } } : perEach;
      const each = counted ? Math.max(0, amountOf({ g, controller: o.controller, source: o, events: [], targets: [], x: 0, memo: {} }, counted as Amount)) : 1;
      const base = (node.perKick ? per * (o.cast?.kicks ?? (o.cast?.kicked ? 1 : 0)) : per) * each;
      // Counters it enters with are put on it too (CR 122.6), so counter replacements apply.
      const n = replaceQuantity(g, 'counters', base, { player: o.controller, object: o, counter: String(node.counter) });
      if (n > 0) o.counters[String(node.counter)] = (o.counters[String(node.counter)] ?? 0) + n;
    },
  },
};

installPlugin(corePlugin);

/** Every core node tag the compiler can emit, for the invariant test. */
export const CORE_NODE_TYPES = CORE_NODES;
