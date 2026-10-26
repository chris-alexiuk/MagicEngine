import type { AddManaEffect, ConditionNode, EffectNode, FaceDef, KeywordInstance, ObjectFilter, Ref, RuleFlag, TriggerNode } from '@mtg/schema';
import { CORE_NODES } from '@mtg/schema';
import { hasKeyword, hasRule, matchesFilter } from './characteristics.js';
import { dealDamage } from './combat.js';
import { evalCondition } from './conditions.js';
import { applyControlEffects } from './control.js';
import { MANA_COLORS } from './mana.js';
import { payDuringResolution } from './payment.js';
import { attach, createToken, destroy, sacrifice } from './permanents.js';
import { installPlugin, type EffectContext, type EffectResult, type MechanicPlugin, type TriggerCheck } from './registry.js';
import { amountOf, refObjects, refPlayers, refRecipients } from './resolve.js';
import { shuffleInPlace } from './rng.js';
import { RulesError, type ChoiceAnswer, type GameObject, type ManaColor, type PlayerId, type TargetRef, type TriggerInfo } from './types.js';
import { drawCard, moveObject, nameOf, setTapped, zoneList } from './zones.js';

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

/** Splits "+1/+1" counters from others and fires the event. */
function addCounters(ctx: EffectContext, o: GameObject, counter: string, n: number): void {
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
      mana = Array.from({ length: effect.anyColor }, () => color);
    } else if (effect.options) {
      const index = typeof ctx.choice === 'number' ? ctx.choice : effect.options.length === 1 ? 0 : -1;
      const option = effect.options[index];
      if (!option) return false;
      mana = option as ManaColor[];
    }
    if (!mana) return false;
    const pool = ctx.g.players[ctx.controller]!.pool;
    for (const c of mana) pool[c]++;
    ctx.events.push({ type: 'mana_added', player: ctx.controller, mana });
    return true;
  },

  deal_damage(node, ctx) {
    const source = ctx.source;
    if (!source) return true;
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
        moveObject(ctx.g, o.id, 'battlefield', ctx.events, { controller, ...(counters ? { counters } : {}) });
        if (node.tapped) setTapped(ctx.g, o.id, true, ctx.events);
      } else {
        // CR 701.13a: exile moves it to the exile zone from wherever it is.
        if (o.zone === 'stack' && o.id !== ctx.source?.id) continue;
        moveObject(ctx.g, o.id, to, ctx.events);
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
      ...(typeof node.power === 'number' ? { power: node.power, toughness: Number(node.toughness ?? 0) } : {}),
      ...(Array.isArray(node.keywords) ? { keywords: node.keywords as KeywordInstance[] } : {}),
      ...(Array.isArray(node.rules) ? { rules: node.rules as RuleFlag[] } : {}),
      // CR 611.2a: lasts as long as stated — "until end of turn" ends in the cleanup step (CR 514.2).
      until: 'eot',
    });
    return true;
  },

  create_token(node, ctx) {
    const n = amountOf(ctx, node.amount);
    const face = node.token as FaceDef;
    const players = node.who ? refPlayers(ctx, ref(node, 'who')) : [ctx.controller];
    const attachTo = node.attachTo ? refObjects(ctx, ref(node, 'attachTo'))[0] : undefined;
    if (node.attachTo && !attachTo) return true; // nothing to attach it to: it isn't created
    for (const p of players) {
      for (let i = 0; i < n; i++) {
        const t = createToken(ctx.g, face, p, ctx.events, { tapped: Boolean(node.tapped) });
        if (attachTo) attach(ctx.g, t, attachTo, ctx.events);
      }
    }
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
    const n = amountOf(ctx, node.amount);
    const players = refPlayers(ctx, ref(node, 'who'));
    const done = (ctx.memo.done as PlayerId[] | undefined) ?? [];
    const answer = answerOf(ctx, 'discard');
    if (answer) {
      const p = ctx.memo.asking as PlayerId;
      const hand = zoneList(ctx.g, 'hand', p);
      if (answer.objects.length !== Math.min(n, hand.length) || new Set(answer.objects).size !== answer.objects.length || !answer.objects.every((id) => hand.includes(id))) {
        throw new RulesError(`Choose ${Math.min(n, hand.length)} card(s) from your hand to discard.`);
      }
      for (const id of answer.objects) moveObject(ctx.g, id, 'graveyard', ctx.events);
      done.push(p);
    }
    for (const p of players) {
      if (done.includes(p)) continue;
      const hand = zoneList(ctx.g, 'hand', p);
      if (hand.length <= n) {
        for (const id of [...hand]) moveObject(ctx.g, id, 'graveyard', ctx.events);
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
    for (const o of refObjects(ctx, ref(node, 'what'))) sacrifice(ctx.g, o, ctx.controller, ctx.events);
    return true;
  },

  transform(node, ctx) {
    for (const o of refObjects(ctx, ref(node, 'what'))) {
      const def = ctx.g.cards[o.card];
      // CR 701.27c / CR 712.9: only double-faced permanents (not meld cards) transform.
      if (o.zone !== 'battlefield' || !def || def.layout !== 'transform' || def.faces.length !== 2) continue;
      const next = o.face === 0 ? 1 : 0;
      // CR 701.27d: not into an instant or sorcery face.
      if (def.faces[next]!.types.some((t) => t === 'Instant' || t === 'Sorcery')) continue;
      // CR 701.27a: turn it over so its other face is up. It's the same object (no zone change).
      o.face = next;
      ctx.events.push({ type: 'transformed', object: o.id, face: next });
    }
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

  may_pay(node, ctx) {
    // CR 118.12: "You may pay {2}. If you do, …" — the payment is a cost paid on resolution.
    const answer = answerOf(ctx, 'pay');
    const cost = String(node.cost);
    if (!answer) {
      const text = `pay ${cost}: ${describeEffects(node.effects as EffectNode[])}`;
      return { ask: { kind: 'pay', player: ctx.controller, cost, text, sourceName: sourceName(ctx) } };
    }
    if (!answer.pay) return { expand: [] };
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
    payDuringResolution(ctx.g, payer, cost, ctx.events);
    return { expand: [] };
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

  may_do(node, ctx) {
    // CR 118.12: "You may [do something]. If you do, [effect]." — only if it can actually be done.
    const answer = answerOf(ctx, 'may');
    const first = node.effects as EffectNode[];
    if (!first.every((e) => feasible(e, ctx))) return true;
    if (!answer) return { ask: { kind: 'may', player: ctx.controller, text: describeEffects([...first, ...(node.then as EffectNode[])]), sourceName: sourceName(ctx) } };
    return { expand: answer.yes ? [...first, ...(node.then as EffectNode[])] : [] };
  },

  delayed(node, ctx) {
    // CR 603.7: creates a delayed triggered ability; CR 603.7e: same source and controller.
    const g = ctx.g;
    const source = ctx.source;
    g.delayed.push({
      id: `d${g.nextId++}`,
      controller: ctx.controller,
      source: source ? { id: source.id, zcc: ctx.sourceZcc ?? source.zcc } : { id: '', zcc: 0 },
      sourceName: sourceName(ctx),
      text: `${describeEffects(node.effects as EffectNode[])} (delayed)`,
      step: node.step === 'upkeep' ? 'upkeep' : 'end',
      createdTurn: g.turn,
      createdStep: g.step,
      effects: node.effects as EffectNode[],
      targets: ctx.targets,
      ...(ctx.trigger ? { info: ctx.trigger } : {}),
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
    // CR 603.5: an optional effect — the controller chooses as it resolves.
    const answer = answerOf(ctx, 'may');
    if (!answer) {
      const text = describeEffects(node.effects as EffectNode[]);
      return { ask: { kind: 'may', player: ctx.controller, text, sourceName: sourceName(ctx) } };
    }
    return { expand: answer.yes ? (node.effects as EffectNode[]) : [] };
  },
};

/** Whether an optional action in "You may [do X]. If you do, …" can be done at all. */
function feasible(e: EffectNode, ctx: EffectContext): boolean {
  const g = ctx.g;
  if (e.type === 'sacrifice_choice' && refPlayers(ctx, ref(e, 'who')).includes(ctx.controller)) {
    const filter = (e.filter ?? {}) as ObjectFilter;
    const n = g.zones.battlefield.filter((id) => {
      const o = g.objects[id]!;
      return o.controller === ctx.controller && matchesFilter(g, o, filter, { controller: ctx.controller, source: ctx.source ?? null });
    }).length;
    return n >= amountOf(ctx, e.amount);
  }
  if (e.type === 'discard') return zoneList(g, 'hand', ctx.controller).length >= amountOf(ctx, e.amount);
  if (e.type === 'sacrifice') return refObjects(ctx, ref(e, 'what')).some((o) => o.zone === 'battlefield' && o.controller === ctx.controller);
  return true;
}

function gainLife(ctx: EffectContext, p: PlayerId, n: number): void {
  if (n <= 0) return;
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
    if (e.type !== 'damage' || !e.combat || e.to.kind !== 'player' || check.sourceLeft) return [];
    const o = check.g.objects[e.source];
    return o && subjectMatches(check, t.subject as Ref, o, { anyZone: true }) ? [{ object: refTo(o), player: e.to.player }] : [];
  },
  // CR 603.2b: "at the beginning of" a step triggers as the step begins.
  phase(t, check) {
    const e = check.event;
    if (e.type !== 'step' || e.step !== t.step || check.sourceLeft) return [];
    const active = check.g.active;
    if (t.whose === 'you' && active !== check.controller) return [];
    if (t.whose === 'opponent' && active === check.controller) return [];
    return [{ player: active }];
  },
  gain_life(t, check) {
    const e = check.event;
    if (e.type !== 'life' || e.delta <= 0 || check.sourceLeft || e.player !== check.controller) return [];
    return [{ player: e.player }];
  },
  draw(t, check) {
    const e = check.event;
    if (e.type !== 'drew' || check.sourceLeft || e.player !== check.controller) return [];
    return [{ player: e.player }];
  },
  cast(t, check) {
    const e = check.event;
    if (e.type !== 'cast' || check.sourceLeft) return [];
    if (t.who === 'you' && e.player !== check.controller) return [];
    if (t.who === 'opponent' && e.player === check.controller) return [];
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
  // "exile it instead" in moveObject.
  statics: ['continuous', 'additional_cost', 'graveyard_to_exile'],
  enterReplacements: {
    // CR 614.1d / 614.12: "[This permanent] enters tapped" is a replacement effect on how it enters.
    enters_tapped(_node, o) {
      o.tapped = true;
    },
    // CR 614.1c: "[This permanent] enters with N counters" — it's given them as it enters (CR 122.6).
    enters_with_counters(node, o) {
      // CR 107.3m: X is the X paid for the spell that became this permanent.
      const n = node.amount === 'X' ? (o.x ?? 0) : typeof node.amount === 'number' ? node.amount : 0;
      if (n > 0) o.counters[String(node.counter)] = (o.counters[String(node.counter)] ?? 0) + n;
    },
  },
};

installPlugin(corePlugin);

/** Every core node tag the compiler can emit, for the invariant test. */
export const CORE_NODE_TYPES = CORE_NODES;
