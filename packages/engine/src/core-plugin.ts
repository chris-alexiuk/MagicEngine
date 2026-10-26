import type { AbilityNode, AddManaEffect, AsEntersNode, Color, CombatRules, ConditionNode, CopyExcept, EffectNode, FaceDef, KeywordInstance, ObjectFilter, Ref, RuleFlag, TriggerNode } from '@mtg/schema';
import { CORE_NODES } from '@mtg/schema';
import { queueAsEnters } from './as-enters.js';
import { playerRule } from './player-rules.js';
import { replaceQuantity } from './quantities.js';
import { chars, hasKeyword, hasRule, matchesFilter, power } from './characteristics.js';
import { dealDamage } from './combat.js';
import { evalCondition } from './conditions.js';
import { applyControlEffects } from './control.js';
import { anyColorChoices, MANA_COLORS, manaOption } from './mana.js';
import { payDuringResolution } from './payment.js';
import { attach, createEmblem, createToken, createTokenCopy, destroy, sacrifice } from './permanents.js';
import { copiable, withExceptions } from './copies.js';
import { copySpell } from './spell-copies.js';
import { dayNightCard, setDayNight } from './day-night.js';
import { ensureFaceDownDefs } from './face-down.js';
import { chooseTargets, targetPrompts } from './targets.js';
import { announceTargets } from './triggers.js';
import { installPlugin, type EffectContext, type EffectResult, type MechanicPlugin, type TriggerCheck } from './registry.js';
import { amountOf, refObjects, refPlayers, refRecipients } from './resolve.js';
import { shuffleInPlace } from './rng.js';
import { RulesError, type ChoiceAnswer, type GameObject, type GameState, type ManaColor, type ObjectRef, type PlayerId, type Target, type TargetRef, type TriggerInfo } from './types.js';
import { battlefieldZcc, discardCard, drawCard, faceOf, livePlayers, manaValueOf, moveObject, nameOf, nextPlayer, setTapped, zoneList } from './zones.js';
import { castableCard, castDuringResolution } from './actions.js';

/**
 * Handlers for the core AST nodes (schema CORE_NODES). Each effect reads its
 * parameters from the node and its subjects through refObjects / refPlayers.
 */

const ref = (node: EffectNode, key: string) => node[key] as Ref;

function answerOf<K extends ChoiceAnswer['kind']>(ctx: EffectContext, kind: K): Extract<ChoiceAnswer, { kind: K }> | null {
  return ctx.answer?.kind === kind ? (ctx.answer as Extract<ChoiceAnswer, { kind: K }>) : null;
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

/** Splits "+1/+1" counters from others and fires the event. */
function addCounters(ctx: EffectContext, o: GameObject, counter: string, n: number): void {
  // CR 614.1a: "that many plus one +1/+1 counters are put on it instead", counter doublers.
  n = replaceQuantity(ctx.g, 'counters', n, { player: ctx.controller, object: o, counter });
  if (n <= 0) return;
  o.counters[counter] = (o.counters[counter] ?? 0) + n;
  ctx.events.push({ type: 'counters', object: o.id, counter, delta: n });
}

const effects: Record<string, (node: EffectNode, ctx: EffectContext) => EffectResult> = {
  // CR 106.4: added mana goes into the player's mana pool.
  add_mana(node, ctx) {
    const effect = node as AddManaEffect;
    let mana: ManaColor[] | undefined;
    if (effect.anyColor) {
      const color = typeof ctx.choice === 'string' ? ctx.choice : undefined;
      if (!color || color === 'C' || !MANA_COLORS.includes(color)) return false;
      // CR 903.4f: only a color in the commander's color identity.
      if (effect.identity && !anyColorChoices(ctx.g, ctx.controller, true).includes(color)) return false;
      mana = Array.from({ length: effect.anyColor }, () => color);
    } else if (effect.options) {
      const index = typeof ctx.choice === 'number' ? ctx.choice : effect.options.length === 1 ? 0 : -1;
      const option = effect.options[index];
      if (!option) return false;
      mana = manaOption(option, ctx.source) ?? undefined;
    }
    if (!mana) return false;
    const pool = ctx.g.players[ctx.controller]!.pool;
    for (const c of mana) pool[c]++;
    ctx.events.push({ type: 'mana_added', player: ctx.controller, mana });
    return true;
  },

  deal_damage(node, ctx) {
    // "Target creature you control deals damage equal to its power to …": that creature is the source.
    const source = node.from ? refObjects(ctx, ref(node, 'from'))[0] : ctx.source;
    if (!source) return true;
    if (node.from && source.zone !== 'battlefield') return true;
    const n = amountOf(ctx, node.amount);
    let dealt = 0;
    for (const to of refRecipients(ctx, ref(node, 'to'))) dealt += dealDamage(ctx.g, source, to, n, false, ctx.events);
    // CR 702.15b: lifelink — the source's controller gains that much life.
    if (dealt > 0 && hasKeyword(ctx.g, source, 'lifelink')) gainLife(ctx, source.controller, dealt);
    return true;
  },

  draw(node, ctx) {
    // CR 121.2: several cards are drawn one at a time.
    const n = amountOf(ctx, node.amount);
    for (const p of refPlayers(ctx, ref(node, 'who'))) for (let i = 0; i < n; i++) drawCard(ctx.g, p, ctx.events);
    return true;
  },

  gain_life(node, ctx) {
    for (const p of refPlayers(ctx, ref(node, 'who'))) gainLife(ctx, p, amountOf(ctx, node.amount));
    return true;
  },

  lose_life(node, ctx) {
    // CR 119.3: the life total is adjusted.
    const n = amountOf(ctx, node.amount);
    for (const p of refPlayers(ctx, ref(node, 'who'))) {
      const ps = ctx.g.players[p]!;
      ps.life -= n;
      ctx.events.push({ type: 'life', player: p, delta: -n, life: ps.life });
    }
    return true;
  },

  destroy(node, ctx) {
    for (const o of refObjects(ctx, ref(node, 'what'))) destroy(ctx.g, o, ctx.events, { noRegen: Boolean(node.noRegen) });
    return true;
  },

  move(node, ctx) {
    const to = node.to as 'hand' | 'library' | 'battlefield' | 'exile' | 'graveyard';
    for (const o of refObjects(ctx, ref(node, 'what'))) {
      if (to === 'library') {
        moveObject(ctx.g, o.id, 'library', ctx.events, { position: node.position === 'bottom' ? 'bottom' : 'top' });
      } else if (to === 'battlefield') {
        // Unless it says otherwise, a permanent is put onto the battlefield under its owner's control.
        const controller = node.under === 'you' ? ctx.controller : o.owner;
        if (o.zone === 'stack' || o.zone === 'battlefield') continue;
        const counters = node.counters as Record<string, number> | undefined;
        // CR 712.14a: "transformed" — a double-faced card enters with its back face up (others don't move at all).
        const dfc = (ctx.g.cards[o.card]?.faces.length ?? 0) > 1 && ['transform', 'modal_dfc', 'meld'].includes(ctx.g.cards[o.card]!.layout);
        if (node.transformed && !dfc) continue;
        moveObject(ctx.g, o.id, 'battlefield', ctx.events, { controller, ...(counters ? { counters } : {}), ...(node.transformed ? { face: 1 } : {}) });
        if (node.tapped) setTapped(ctx.g, o.id, true, ctx.events);
      } else if (node.until === 'source_leaves') {
        // CR 610.3a: if the source has already left the battlefield, the object doesn't move at all.
        const src = ctx.source;
        if (!src || src.zone !== 'battlefield' || (ctx.sourceZcc !== undefined && src.zcc !== ctx.sourceZcc)) continue;
        if (o.zone !== 'battlefield') continue;
        moveObject(ctx.g, o.id, 'exile', ctx.events);
        (ctx.g.exiledUntil ??= []).push({ source: { id: src.id, zcc: src.zcc }, object: { id: o.id, zcc: o.zcc } });
      } else {
        // CR 701.13a: exile moves it to the exile zone from wherever it is.
        if (o.zone === 'stack' && o.id !== ctx.source?.id) continue;
        moveObject(ctx.g, o.id, to, ctx.events);
        // CR 607.2a: remember what exiled it, for the source's linked "the exiled card" ability.
        const src = ctx.source;
        if (to === 'exile' && src && src.id !== o.id) o.exiledBy = { id: src.id, zcc: battlefieldZcc(ctx.g, src) };
      }
    }
    return true;
  },

  counter(node, ctx) {
    // An ability the trigger was about ("counter that spell or ability", ward): it's removed from the stack (CR 701.6a).
    const entry = ref(node, 'what').ref === 'trigger_object' ? ctx.trigger?.entry : undefined;
    if (entry) {
      const before = ctx.g.stack.length;
      ctx.g.stack = ctx.g.stack.filter((e) => !(e.kind === 'ability' && e.id === entry));
      if (ctx.g.stack.length < before) ctx.events.push({ type: 'countered', object: entry });
    }
    for (const o of refObjects(ctx, ref(node, 'what'))) {
      if (o.zone !== 'stack') continue;
      // CR 101.2 / "can't be countered": the spell stays on the stack.
      if (hasRule(ctx.g, o, 'cant_be_countered')) continue;
      // CR 701.6a: it's removed from the stack and put into its owner's graveyard.
      moveObject(ctx.g, o.id, 'graveyard', ctx.events);
      ctx.events.push({ type: 'countered', object: o.id });
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

  add_counters(node, ctx) {
    // CR 122.6: counters are put on permanents (CR 122.1a for +1/+1 counters).
    const n = amountOf(ctx, node.amount);
    for (const o of refObjects(ctx, ref(node, 'what'))) if (o.zone === 'battlefield') addCounters(ctx, o, String(node.counter), n);
    return true;
  },

  modify(node, ctx) {
    // CR 611.2c: the affected set is determined now and doesn't change later.
    const objects = refObjects(ctx, ref(node, 'what')).filter((o) => o.zone === 'battlefield');
    if (!objects.length) return true;
    const g = ctx.g;
    g.effects.push({
      id: `e${g.nextId++}`,
      timestamp: ++g.clock,
      source: ctx.source ? { id: ctx.source.id, zcc: ctx.source.zcc } : { id: '', zcc: 0 },
      controller: ctx.controller,
      objects: objects.map((o) => ({ id: o.id, zcc: o.zcc })),
      // CR 608.2h: a counted amount ("+1/+1 for each creature you control") is counted once, now.
      ...(node.power !== undefined ? { power: amountOf(ctx, node.power), toughness: amountOf(ctx, node.toughness ?? 0) } : {}),
      ...(Array.isArray(node.keywords) ? { keywords: node.keywords as KeywordInstance[] } : {}),
      ...(Array.isArray(node.rules) ? { rules: node.rules as RuleFlag[] } : {}),
      ...(node.combat ? { combat: node.combat as CombatRules } : {}),
      // "becomes a 3/3 green Elemental creature" (layers 4, 5 and 7b).
      ...(Array.isArray(node.types) ? { types: node.types as string[], subtypes: (node.subtypes as string[]) ?? [], retainTypes: Boolean(node.retainTypes) } : {}),
      ...(Array.isArray(node.colors) ? { colors: node.colors as Color[] } : {}),
      ...(node.setPower !== undefined ? { setPower: amountOf(ctx, node.setPower), setToughness: amountOf(ctx, node.setToughness ?? 0) } : {}),
      // CR 611.2a: lasts as long as stated — "until end of turn" ends in the cleanup step (CR 514.2); otherwise indefinitely.
      until: node.until === 'game' ? 'game' : 'eot',
    });
    return true;
  },

  create_token(node, ctx) {
    const n = amountOf(ctx, node.amount);
    const face = node.token as FaceDef | undefined;
    const players = node.who ? refPlayers(ctx, ref(node, 'who')) : [ctx.controller];
    const attachTo = node.attachTo ? refObjects(ctx, ref(node, 'attachTo'))[0] : undefined;
    if (node.attachTo && !attachTo) return true; // nothing to attach it to: it isn't created
    // CR 707.2: "a token that's a copy of …" — of the object's copiable values, with this effect's exceptions.
    // "this card" still means the card after a cost moved it (embalm exiles it from the graveyard).
    const original = node.copyOf ? (ref(node, 'copyOf').ref === 'self' ? ctx.source : refObjects(ctx, ref(node, 'copyOf'))[0]) : undefined;
    if (node.copyOf && !original) return true;
    const copy = original ? withExceptions(ctx.g, copiable(original), node.except as CopyExcept | undefined) : undefined;
    const created: ObjectRef[] = [];
    for (const p of players) {
      // CR 614.1a: token doublers ("twice that many of those tokens are created instead").
      const count = replaceQuantity(ctx.g, 'tokens', n, { player: p });
      for (let i = 0; i < count; i++) {
        const opts = { tapped: Boolean(node.tapped) };
        const t = copy ? createTokenCopy(ctx.g, copy, p, ctx.events, opts) : createToken(ctx.g, face!, p, ctx.events, opts);
        if (attachTo) attach(ctx.g, t, attachTo, ctx.events);
        created.push({ id: t.id, zcc: t.zcc });
      }
    }
    if (ctx.resolution) ctx.resolution.created = created;
    return true;
  },

  scry(node, ctx) {
    // CR 701.22a: look at the top N, put any number on the bottom and the rest on top, in any order.
    return lookAtTop(ctx, amountOf(ctx, node.amount), 'scry');
  },

  surveil(node, ctx) {
    // CR 701.25a: like scry, but into the graveyard.
    return lookAtTop(ctx, amountOf(ctx, node.amount), 'surveil');
  },

  mill(node, ctx) {
    // CR 701.17a: the top N cards go into the graveyard.
    const n = amountOf(ctx, node.amount);
    for (const p of refPlayers(ctx, ref(node, 'who'))) {
      for (const id of zoneList(ctx.g, 'library', p).slice(0, n)) moveObject(ctx.g, id, 'graveyard', ctx.events);
    }
    return true;
  },

  discard(node, ctx) {
    // CR 701.9a: the player chooses (in APNAP order, CR 101.4), then the cards go to the graveyard.
    const players = refPlayers(ctx, ref(node, 'who'));
    if (node.all) {
      // "discards their hand": nothing to choose.
      for (const p of players) for (const id of [...zoneList(ctx.g, 'hand', p)]) discardCard(ctx.g, id, ctx.events);
      return true;
    }
    const n = amountOf(ctx, node.amount);
    const done = (ctx.memo.done as PlayerId[] | undefined) ?? [];
    const answer = answerOf(ctx, 'discard');
    if (answer) {
      const p = ctx.memo.asking as PlayerId;
      const hand = zoneList(ctx.g, 'hand', p);
      if (answer.objects.length !== Math.min(n, hand.length) || new Set(answer.objects).size !== answer.objects.length || !answer.objects.every((id) => hand.includes(id))) {
        throw new RulesError(`Choose ${Math.min(n, hand.length)} card(s) from your hand to discard.`);
      }
      for (const id of answer.objects) discardCard(ctx.g, id, ctx.events);
      done.push(p);
    }
    for (const p of players) {
      if (done.includes(p)) continue;
      const hand = zoneList(ctx.g, 'hand', p);
      if (hand.length <= n) {
        for (const id of [...hand]) discardCard(ctx.g, id, ctx.events);
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

  attach(node, ctx) {
    const what = refObjects(ctx, ref(node, 'what'))[0];
    const to = refObjects(ctx, ref(node, 'to'))[0];
    if (what && to) attach(ctx.g, what, to, ctx.events);
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
    const counter = String(node.counter);
    for (const o of refObjects(ctx, ref(node, 'what'))) {
      const have = o.counters[counter] ?? 0;
      const n = Math.min(have, amountOf(ctx, node.amount));
      if (n <= 0) continue;
      o.counters[counter] = have - n;
      if (!o.counters[counter]) delete o.counters[counter];
      ctx.events.push({ type: 'counters', object: o.id, counter, delta: -n });
    }
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
      addCounters(ctx, o, '+1/+1', amountOf(ctx, node.amount));
      o.monstrous = true;
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
    const play = node.play as { mode: 'play' | 'cast'; until: 'eot' | 'next_turn' } | undefined;
    for (const p of refPlayers(ctx, ref(node, 'who'))) {
      for (const id of zoneList(g, 'library', p).slice(0, n)) {
        moveObject(g, id, 'exile', ctx.events);
        const o = g.objects[id]!;
        if (play) (g.mayPlay ??= []).push({ object: { id, zcc: o.zcc }, player: ctx.controller, mode: play.mode, lastTurn: lastTurnOf(g, ctx.controller, play.until) });
      }
    }
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

  proliferate(_node, ctx) {
    // CR 701.34a: choose any number of permanents and/or players with counters; each gets one more of each kind.
    const g = ctx.g;
    const objects = g.zones.battlefield.filter((id) => Object.values(g.objects[id]!.counters).some((n) => n > 0));
    const players = livePlayers(g).filter((p) => g.players[p]!.poison > 0 || Object.values(g.players[p]!.counters ?? {}).some((n) => n > 0));
    const answer = answerOf(ctx, 'proliferate');
    if (!answer) {
      if (!objects.length && !players.length) return true;
      return { ask: { kind: 'proliferate', player: ctx.controller, objects, players } };
    }
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
    const memo = ctx.memo as { drew?: boolean; who?: PlayerId; conniver?: { id: string; zcc: number } };
    const answer = answerOf(ctx, 'discard');
    if (!memo.drew) {
      const [o] = refObjects(ctx, ref(node, 'what'));
      // CR 701.50b: if it's gone, its last known controller still connives.
      const who = o?.controller ?? ctx.controller;
      memo.drew = true;
      memo.who = who;
      if (o) memo.conniver = { id: o.id, zcc: o.zcc };
      drawCard(ctx.g, who, ctx.events);
    }
    const who = memo.who!;
    const hand = zoneList(ctx.g, 'hand', who);
    let discarded: string | undefined;
    if (answer) {
      if (answer.objects.length !== 1 || !hand.includes(answer.objects[0]!)) throw new RulesError('Choose one card from your hand to discard.');
      discarded = answer.objects[0]!;
    } else if (hand.length > 1) {
      return { ask: { kind: 'discard', player: who, count: 1 } };
    } else discarded = hand[0];
    if (!discarded) return true;
    const card = ctx.g.objects[discarded]!;
    const nonland = !ctx.g.cards[card.card]!.faces[card.face]!.types.includes('Land');
    discardCard(ctx.g, discarded, ctx.events);
    const c = memo.conniver && ctx.g.objects[memo.conniver.id];
    if (nonland && c && c.zcc === memo.conniver!.zcc && c.zone === 'battlefield') addCounters(ctx, c, '+1/+1', 1);
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
    const cost = String(node.cost).repeat(Math.max(0, n));
    const otherwise = (node.else as EffectNode[] | undefined) ?? [];
    if (!cost) return { expand: node.effects as EffectNode[] };
    if (!answer) {
      const text = `pay ${cost}: ${describeEffects(node.effects as EffectNode[])}${otherwise.length ? `, or else ${describeEffects(otherwise)}` : ''}`;
      return { ask: { kind: 'pay', player: ctx.controller, cost, text, sourceName: sourceName(ctx) } };
    }
    if (!answer.pay) return { expand: otherwise };
    payDuringResolution(ctx.g, ctx.controller, cost, ctx.events);
    return { expand: node.effects as EffectNode[] };
  },

  unless_pays(node, ctx) {
    // CR 118.12a: "[Do something] unless [a player] pays [cost]" — that player chooses whether to pay.
    const payer = refPlayers(ctx, ref(node, 'payer'))[0];
    const cost = String(node.cost);
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
      ps.life -= life;
      ctx.events.push({ type: 'life', player: payer, delta: -life, life: ps.life });
    }
    return { expand: [] };
  },

  unless_does(node, ctx) {
    // "… unless that player discards a card": they choose whether to (only if they can).
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
    const player = ctx.controller;
    const library = zoneList(g, 'library', player);
    const filter = { ...(node.filter as ObjectFilter), zone: 'library' as const };
    const candidates = library.filter((id) => matchesFilter(g, g.objects[id]!, filter, { controller: player }));
    const count = amountOf(ctx, node.amount);
    // CR 701.23b: with a stated quality the player may find fewer; CR 701.23d: "a card" must be found if possible.
    const quality = Object.keys(filter).some((k) => k !== 'zone' && k !== 'owner');
    const mustFind = !quality && !node.upTo;
    const answer = answerOf(ctx, 'search');
    if (!answer) {
      if (library.length === 0) return true;
      return { ask: { kind: 'search', player, candidates, count, mustFind, text: describeSearch(node) } };
    }
    const chosen = answer.objects;
    const need = mustFind ? Math.min(count, candidates.length) : 0;
    if (chosen.length > count || chosen.length < need || new Set(chosen).size !== chosen.length || !chosen.every((id) => candidates.includes(id))) {
      throw new RulesError(mustFind ? `Choose ${need} card(s).` : `Choose up to ${count} matching card(s).`);
    }
    const to = node.to as 'hand' | 'battlefield' | 'graveyard' | 'library';
    if (to !== 'library') {
      for (const id of chosen) {
        moveObject(g, id, to, ctx.events, to === 'battlefield' ? { controller: player } : {});
        if (to === 'battlefield' && node.tapped) setTapped(g, id, true, ctx.events);
      }
    }
    // CR 701.24a: then the library is shuffled.
    const rest = zoneList(g, 'library', player);
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
    const filter = (node.filter ?? {}) as ObjectFilter;
    const players = refPlayers(ctx, ref(node, 'who'));
    const done = (ctx.memo.done as PlayerId[] | undefined) ?? [];
    const candidatesOf = (p: PlayerId) =>
      g.zones.battlefield.filter((id) => g.objects[id]!.controller === p && matchesFilter(g, g.objects[id]!, filter, { controller: p, source: ctx.source ?? null }));
    const answer = answerOf(ctx, 'sacrifice');
    if (answer) {
      const p = ctx.memo.asking as PlayerId;
      const candidates = candidatesOf(p);
      if (answer.objects.length !== Math.min(n, candidates.length) || new Set(answer.objects).size !== answer.objects.length || !answer.objects.every((id) => candidates.includes(id))) {
        throw new RulesError(`Choose ${Math.min(n, candidates.length)} permanent(s) to sacrifice.`);
      }
      for (const id of answer.objects) sacrifice(g, g.objects[id]!, p, ctx.events);
      done.push(p);
    }
    for (const p of players) {
      if (done.includes(p)) continue;
      const candidates = candidatesOf(p);
      if (candidates.length <= n) {
        for (const id of candidates) sacrifice(g, g.objects[id]!, p, ctx.events);
        done.push(p);
        continue;
      }
      ctx.memo.done = done;
      ctx.memo.asking = p;
      return { ask: { kind: 'sacrifice', player: p, candidates, count: n } };
    }
    return true;
  },

  if(node, ctx) {
    // "If [condition], [effect]. Otherwise, [effect]." — checked as this instruction is followed (CR 608.2c).
    const yes = evalCondition(node.cond as ConditionNode, ctx);
    return { expand: ((yes ? node.effects : node.else) as EffectNode[] | undefined) ?? [] };
  },

  // CR 707.10: "copy target instant or sorcery spell", "copy that spell", storm's "copy it for each …".
  copy_spell(node, ctx) {
    const g = ctx.g;
    if (!ctx.memo.made) {
      const n = amountOf(ctx, node.amount ?? 1);
      const what = ref(node, 'what');
      const spells = what.ref === 'self' ? (ctx.source?.zone === 'stack' ? [ctx.source] : []) : refObjects(ctx, what).filter((o) => o.zone === 'stack');
      const made: string[] = [];
      for (const spell of spells) {
        const entry = g.stack.find((s) => s.kind === 'spell' && s.object === spell.id);
        if (entry?.kind !== 'spell') continue;
        for (let i = 0; i < n; i++) made.push(copySpell(g, entry, ctx.controller, ctx.events));
      }
      ctx.memo.made = made;
      ctx.memo.index = 0;
    }
    const made = ctx.memo.made as string[];
    const entryOf = (id: string) => g.stack.find((s): s is Extract<typeof s, { kind: 'spell' }> => s.kind === 'spell' && s.object === id);
    const answer = answerOf(ctx, 'copy_targets');
    if (answer) {
      const id = made[ctx.memo.index as number]!;
      const entry = entryOf(id);
      // CR 707.10c: new targets must be legal; keeping them needn't be.
      if (entry?.program && answer.targets) entry.targets = chooseTargets(g, ctx.controller, entry.program.specs, answer.targets, g.objects[id] ?? null);
      ctx.memo.index = (ctx.memo.index as number) + 1;
    }
    if (node.newTargets) {
      for (; (ctx.memo.index as number) < made.length; ctx.memo.index = (ctx.memo.index as number) + 1) {
        const id = made[ctx.memo.index as number]!;
        const entry = entryOf(id);
        if (!entry?.program?.specs.length) continue;
        const current = entry.targets.map((list) => list.map((t): Target => (t.kind === 'player' ? { kind: 'player', player: t.player } : { kind: 'object', object: t.id })));
        return {
          ask: { kind: 'copy_targets', player: ctx.controller, object: id, sourceName: sourceName(ctx), text: nameOf(g, g.objects[id]!), prompts: targetPrompts(g, ctx.controller, entry.program.specs, g.objects[id]!), current },
        };
      }
    }
    for (const id of made) {
      const entry = entryOf(id);
      if (entry) announceTargets(entry, ctx.events);
    }
    return true;
  },

  // CR 701.40a / 701.58a: manifest or cloak the top card(s) of your library.
  manifest(node, ctx) {
    const n = amountOf(ctx, node.amount ?? 1);
    ensureFaceDownDefs(ctx.g);
    for (const id of zoneList(ctx.g, 'library', ctx.controller).slice(0, n)) {
      moveObject(ctx.g, id, 'battlefield', ctx.events, { controller: ctx.controller, faceDown: node.cloak ? 'cloak' : 'manifest' });
    }
    return true;
  },

  // CR 608.2g: "You may cast it without paying its mana cost."
  cast_free(node, ctx) {
    const o = refObjects(ctx, ref(node, 'what'))[0];
    if (!o || o.zone === 'stack' || o.zone === 'battlefield' || !castableCard(ctx.g, o)) return true;
    return offerFreeCast(ctx, o.id) ?? true;
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

  // CR 702.85a: cascade.
  cascade(node, ctx) {
    return revealUntilCast(ctx, (o, g) => manaValueOf(g, o) < (ctx.source ? manaValueOf(g, ctx.source) : 0), 'bottom');
  },

  // CR 701.57a: discover N — like cascade, but with mana value N or less, and to hand if not cast.
  discover(node, ctx) {
    const n = Number(node.n ?? 0);
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
    if (!answer) return { ask: { kind: 'may', player: chooser, text: describeEffects([...first, ...then]), sourceName: sourceName(ctx) } };
    return { expand: answer.yes ? [...first, ...then] : otherwise };
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
      step: node.step === 'upkeep' ? 'upkeep' : 'end',
      createdTurn: g.turn,
      createdStep: g.step,
      effects: node.effects as EffectNode[],
      targets: ctx.targets,
      ...(ctx.trigger || ctx.resolution?.created ? { info: { ...ctx.trigger, ...(ctx.resolution?.created ? { created: ctx.resolution.created } : {}) } } : {}),
      ...(node.on ? { on: node.on as { who: 'you'; filter: ObjectFilter } } : {}),
    });
    return true;
  },

  gain_control(node, ctx) {
    // Layer 2 (CR 613.1b): locked to the objects it affected (CR 611.2c).
    const objects = refObjects(ctx, ref(node, 'what')).filter((o) => o.zone === 'battlefield');
    if (!objects.length) return true;
    const g = ctx.g;
    g.effects.push({
      id: `e${g.nextId++}`,
      timestamp: ++g.clock,
      source: ctx.source ? { id: ctx.source.id, zcc: ctx.source.zcc } : { id: '', zcc: 0 },
      controller: ctx.controller,
      objects: objects.map((o) => ({ id: o.id, zcc: o.zcc })),
      control: ctx.controller,
      until: node.until === 'eot' ? 'eot' : 'game',
    });
    applyControlEffects(g, ctx.events);
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

  may(node, ctx) {
    // CR 603.5: an optional effect — the controller (or the player it names) chooses as it resolves.
    const answer = answerOf(ctx, 'may');
    const chooser = chooserOf(node, ctx);
    if (!chooser) return true;
    if (!answer) {
      const text = describeEffects(node.effects as EffectNode[]);
      return { ask: { kind: 'may', player: chooser, text, sourceName: sourceName(ctx) } };
    }
    return { expand: answer.yes ? (node.effects as EffectNode[]) : [] };
  },
};

/** Who decides an optional effect: its controller, or the one player it names ("that player may …"). */
function chooserOf(node: EffectNode, ctx: EffectContext): PlayerId | null {
  if (!node.who) return ctx.controller;
  return refPlayers(ctx, node.who as Ref)[0] ?? null;
}

/**
 * Asks whether to cast a card for free now; on "yes" casts it (CR 608.2g). Returns the prompt, or null once
 * answered (or if there's nothing to ask).
 */
function offerFreeCast(ctx: EffectContext, id: string): EffectResult | null {
  const g = ctx.g;
  const answer = answerOf(ctx, 'cast_free');
  if (!answer) {
    return { ask: { kind: 'cast_free', player: ctx.controller, object: id, sourceName: sourceName(ctx), text: `Cast ${nameOf(g, g.objects[id]!)} without paying its mana cost?` } };
  }
  ctx.memo.castFree = answer.cast;
  if (answer.cast) castDuringResolution(g, ctx.controller, id, answer.targets, answer.modes, ctx.events);
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
function feasible(e: EffectNode, ctx: EffectContext, chooser: PlayerId = ctx.controller): boolean {
  const g = ctx.g;
  if (e.type === 'sacrifice_choice' && refPlayers(ctx, ref(e, 'who')).includes(chooser)) {
    const filter = (e.filter ?? {}) as ObjectFilter;
    const n = g.zones.battlefield.filter((id) => {
      const o = g.objects[id]!;
      return o.controller === chooser && matchesFilter(g, o, filter, { controller: ctx.controller, source: ctx.source ?? null });
    }).length;
    return n >= amountOf(ctx, e.amount);
  }
  if (e.type === 'discard') return e.all ? zoneList(g, 'hand', chooser).length > 0 : zoneList(g, 'hand', chooser).length >= amountOf(ctx, e.amount);
  if (e.type === 'sacrifice') return refObjects(ctx, ref(e, 'what')).some((o) => o.zone === 'battlefield' && o.controller === chooser);
  return true;
}

function gainLife(ctx: EffectContext, p: PlayerId, n: number): void {
  // "Players can't gain life."
  if (n <= 0 || playerRule(ctx.g, p, 'cant_gain_life')) return;
  // CR 614.1a: "If you would gain life, you gain twice that much life instead."
  n = replaceQuantity(ctx.g, 'gain_life', n, { player: p });
  const ps = ctx.g.players[p]!;
  ps.life += n;
  ctx.events.push({ type: 'life', player: p, delta: n, life: ps.life });
}

function lookAtTop(ctx: EffectContext, n: number, kind: 'scry' | 'surveil'): EffectResult {
  const library = zoneList(ctx.g, 'library', ctx.controller);
  const looked = library.slice(0, n);
  if (!looked.length) return true;
  const answer = ctx.answer?.kind === kind ? ctx.answer : null;
  if (!answer) return { ask: { kind, player: ctx.controller, objects: looked } };
  const top = answer.top;
  const away = answer.kind === 'scry' ? answer.bottom : answer.graveyard;
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

function describeSearch(node: EffectNode): string {
  const to = { hand: 'into your hand', battlefield: 'onto the battlefield', graveyard: 'into your graveyard', library: 'on top' }[String(node.to)];
  return `search your library for ${node.upTo ? 'up to ' : ''}${node.amount} card(s), put ${to}`;
}

// ---------------------------------------------------------------------------
// Trigger matchers (CR 603.2)
// ---------------------------------------------------------------------------

/** Does `o` satisfy a trigger's subject ("~" or "a creature you control")? */
function subjectMatches(check: TriggerCheck, subject: Ref, o: GameObject, opts: { lastController?: PlayerId; anyZone?: boolean } = {}): boolean {
  if (subject.ref === 'self') return o.id === check.source.id;
  // "enchanted creature", "equipped creature"
  if (subject.ref === 'attached') return check.source.attachedTo?.id === o.id && check.source.attachedTo.zcc === o.zcc;
  if (subject.ref !== 'all') return false;
  const filter: ObjectFilter = { ...subject.filter };
  return matchesFilter(check.g, o, filter, {
    controller: check.controller,
    source: check.source,
    ...(opts.anyZone ? { anyZone: true } : {}),
    ...(opts.lastController ? { lastController: opts.lastController } : {}),
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
    if (!o || o.zone !== 'battlefield') return [];
    return subjectMatches(check, t.subject as Ref, o) ? [{ object: refTo(o) }] : [];
  },
  // CR 700.4: "dies" means put into a graveyard from the battlefield. CR 603.10a: these look back in time.
  dies(t, check) {
    const e = check.event;
    if (e.type !== 'moved' || e.from !== 'battlefield' || e.to !== 'graveyard') return [];
    const o = check.g.objects[e.object];
    if (!o) return [];
    const lki = { counters: e.counters ?? {} };
    return subjectMatches(check, t.subject as Ref, o, { anyZone: true, lastController: e.controller }) ? [{ object: refTo(o), lki }] : [];
  },
  // CR 603.6c: leaves-the-battlefield abilities.
  leaves(t, check) {
    const e = check.event;
    if (e.type !== 'moved' || e.from !== 'battlefield') return [];
    const o = check.g.objects[e.object];
    if (!o) return [];
    const lki = { counters: e.counters ?? {} };
    return subjectMatches(check, t.subject as Ref, o, { anyZone: true, lastController: e.controller }) ? [{ object: refTo(o), lki }] : [];
  },
  attacks(t, check) {
    const e = check.event;
    if (e.type !== 'attacks_declared' || check.sourceLeft) return [];
    // CR 506.5 / CR 702.83b: "attacks alone" — the only creature declared as an attacker.
    if (t.alone && e.attacks.length !== 1) return [];
    return e.attacks.flatMap(({ attacker, target }) => {
      const o = check.g.objects[attacker];
      if (!o || !subjectMatches(check, t.subject as Ref, o)) return [];
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
    const out = new Map<string, TriggerInfo>();
    for (const { blocker, attacker } of e.blocks) {
      const o = check.g.objects[blocker];
      if (o && subjectMatches(check, t.subject as Ref, o)) out.set(o.id, { object: refTo(o) });
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
      if (t.by) {
        if (matchesFilter(check.g, b, t.by as ObjectFilter, { controller: check.controller, source: check.source })) each.push({ object: refTo(b) });
      } else once.set(a.id, { object: refTo(a) });
    }
    return t.by ? each : [...once.values()];
  },
  // "Whenever ~ becomes the target of a spell or ability an opponent controls" (ward, CR 702.21a).
  becomes_target(t, check) {
    const e = check.event;
    if (e.type !== 'became_target' || check.sourceLeft) return [];
    if (t.by === 'opponent' && e.controller === check.controller) return [];
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
    if (e.type !== 'damage' || !e.combat || e.to.kind !== 'player' || check.sourceLeft) return [];
    if (t.to === 'enchanted' && e.to.player !== check.source.attachedToPlayer) return [];
    const o = check.g.objects[e.source];
    return o && subjectMatches(check, t.subject as Ref, o, { anyZone: true }) ? [{ object: refTo(o), player: e.to.player, amount: e.amount }] : [];
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
    return (t.chapters as number[]).some((n) => before < n && after >= n) ? [{ object: refTo(check.source) }] : [];
  },
  // "Whenever ~ deals damage" / "deals combat damage": once for everything it dealt at the same time.
  deals_damage(t, check) {
    const e = check.event;
    if (e.type !== 'damage' || (t.combat && !e.combat) || check.sourceLeft) return [];
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
    const together = (check.batch ?? [e]).filter((x): x is typeof e => x.type === 'damage' && x.to.kind === 'permanent' && x.to.object === to);
    if (together[0] !== e) return [];
    const o = check.g.objects[to];
    const amount = together.reduce((n, x) => n + x.amount, 0);
    return o && subjectMatches(check, t.subject as Ref, o, { anyZone: true }) ? [{ object: refTo(o), amount }] : [];
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
    return [{ player: e.player, amount: -e.delta }];
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
    return [{ player: e.player, amount: e.delta }];
  },
  draw(t, check) {
    const e = check.event;
    if (e.type !== 'drew' || check.sourceLeft) return [];
    if (e.player !== (t.who === 'enchanted' ? check.source.attachedToPlayer : check.controller)) return [];
    // "Whenever you draw your second card each turn"
    if (t.nth && e.nth !== t.nth) return [];
    return [{ player: e.player }];
  },
  cast(t, check) {
    const e = check.event;
    if (e.type !== 'cast' || check.sourceLeft) return [];
    // "When you cast this spell" (it triggers from the stack).
    if (t.self) return e.object === check.source.id ? [{ object: refTo(check.source), player: e.player }] : [];
    if (t.who === 'you' && e.player !== check.controller) return [];
    if (t.who === 'opponent' && e.player === check.controller) return [];
    if (t.who === 'enchanted' && e.player !== check.source.attachedToPlayer) return [];
    const spell = check.g.objects[e.object];
    if (!spell) return [];
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
  statics: ['continuous', 'additional_cost', 'graveyard_to_exile', 'player_rule', 'as_enters', 'deck_rule', 'cost_modifier', 'replace_quantity', 'exile_instead', 'cast_option', 'resolve_to_hand', 'rebound'],
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
    enters_with_counters(node, o, g) {
      // "If an opponent was dealt damage this turn, …" (bloodthirst), "If ~ was kicked, …".
      if (node.condition && !evalCondition(node.condition as ConditionNode, { g, controller: o.controller, source: o, events: [], targets: [], x: 0, memo: {} })) return;
      // CR 107.3m: X is the X paid for the spell that became this permanent.
      const per = node.amount === 'X' ? (o.x ?? 0) : typeof node.amount === 'number' ? node.amount : 0;
      // CR 702.33c: "… a +1/+1 counter on it for each time it was kicked"
      const base = node.perKick ? per * (o.cast?.kicks ?? (o.cast?.kicked ? 1 : 0)) : per;
      // Counters it enters with are put on it too (CR 122.6), so counter replacements apply.
      const n = replaceQuantity(g, 'counters', base, { player: o.controller, object: o, counter: String(node.counter) });
      if (n > 0) o.counters[String(node.counter)] = (o.counters[String(node.counter)] ?? 0) + n;
    },
  },
};

installPlugin(corePlugin);

/** Every core node tag the compiler can emit, for the invariant test. */
export const CORE_NODE_TYPES = CORE_NODES;
