import type { Amount, AmountExpr, EffectNode, ObjectFilter, Ref } from '@mtg/schema';
import { chars, colorsAmong, creatureTypesOf, filterZones, hasType, matchesFilter, power, toughness } from './characteristics.js';
import { runEffect, type EffectContext } from './registry.js';
import { isLegalTarget } from './targets.js';
import type { ChoiceAnswer, DamageRecipient, GameEvent, GameObject, GameState, ObjectId, PlayerId, Resolution, StackEntry, TargetRef } from './types.js';
import { battlefieldZcc, faceOf, livePlayers, manaValueOf, nameOf, nextPlayer, zoneList } from './zones.js';

// ---------------------------------------------------------------------------
// References: who and what an effect acts on
// ---------------------------------------------------------------------------

/** Players in APNAP order (CR 101.4), starting with the active player. */
export function apnap(g: GameState): PlayerId[] {
  const live = livePlayers(g);
  const out: PlayerId[] = [];
  let p = g.active;
  for (let i = 0; i < g.order.length; i++) {
    if (live.includes(p) && !out.includes(p)) out.push(p);
    p = nextPlayer(g, p);
  }
  return out;
}

/** CR 400.7j: this resolution moved it to a public zone, so its other parts can find the new object. */
const foundNow = (ctx: EffectContext, o: GameObject) => ctx.resolution?.found?.[o.id] === o.zcc;

function sourceOf(ctx: EffectContext): GameObject | null {
  const s = ctx.source;
  if (!s) return null;
  // CR 400.7: once it has changed zones it's a new object that "~" no longer refers to (unless 400.7j finds it).
  return ctx.sourceZcc === undefined || s.zcc === ctx.sourceZcc || foundNow(ctx, s) ? s : null;
}

function targetObjects(ctx: EffectContext, index: number): GameObject[] {
  return (ctx.targets[index] ?? []).flatMap((t) => {
    if (t.kind !== 'object') return [];
    const o = ctx.g.objects[t.id];
    return o && (o.zcc === t.zcc || foundNow(ctx, o)) ? [o] : [];
  });
}

/**
 * The spells and abilities on the stack a reference means: "target activated ability", "that ability"
 * (what a trigger was about), "that spell", "target spell".
 */
export function refEntries(ctx: EffectContext, ref: Ref): StackEntry[] {
  const { g } = ctx;
  const spellEntry = (id: string, zcc?: number) =>
    g.stack.filter((s) => s.kind === 'spell' && s.object === id && (zcc === undefined || g.objects[id]?.zcc === zcc));
  const abilityEntry = (id: string) => g.stack.filter((s) => s.kind === 'ability' && s.id === id);
  switch (ref.ref) {
    case 'target':
      return (ctx.targets[ref.index] ?? []).flatMap((t) => (t.kind === 'ability' ? abilityEntry(t.entry) : t.kind === 'object' ? spellEntry(t.id, t.zcc) : []));
    case 'trigger_object': {
      if (ctx.trigger?.entry) return abilityEntry(ctx.trigger.entry);
      const r = ctx.trigger?.object;
      return r ? spellEntry(r.id, r.zcc) : [];
    }
    case 'self':
      return ctx.source?.zone === 'stack' ? spellEntry(ctx.source.id) : [];
    default:
      return [];
  }
}

/** The objects a reference means right now (CR 608.2h). */
export function refObjects(ctx: EffectContext, ref: Ref): GameObject[] {
  const { g } = ctx;
  switch (ref.ref) {
    case 'self': {
      const s = sourceOf(ctx);
      return s ? [s] : [];
    }
    case 'target':
      return targetObjects(ctx, ref.index);
    case 'trigger_object': {
      const r = ctx.trigger?.object;
      const o = r ? g.objects[r.id] : undefined;
      return o && r && (o.zcc === r.zcc || foundNow(ctx, o)) ? [o] : [];
    }
    case 'chosen_object': {
      const r = ctx.resolution?.chosenObject;
      const o = r ? g.objects[r.id] : undefined;
      return o && o.zcc === r!.zcc ? [o] : [];
    }
    case 'affected':
      return ctx.affected ? [ctx.affected] : [];
    case 'attached': {
      const s = sourceOf(ctx);
      const r = s?.attachedTo;
      const o = r ? g.objects[r.id] : undefined;
      return o && r && o.zcc === r.zcc ? [o] : [];
    }
    case 'all': {
      const ids = filterZones(ref.filter).flatMap((zone) =>
        zone === 'battlefield'
          ? g.zones.battlefield
          : zone === 'stack'
            ? g.stack.flatMap((e) => (e.kind === 'spell' ? [e.object] : []))
            : zone === 'exile' || zone === 'command'
              ? g.zones[zone]
              : g.order.flatMap((p) => g.zones[zone][p] ?? []),
      );
      // "all creatures target player controls"
      const owners = ref.filter.controlledBy ? refPlayers(ctx, ref.filter.controlledBy as Ref) : null;
      // "all cards from target player's graveyard"
      const ownedBy = ref.filter.ownedBy ? refPlayers(ctx, ref.filter.ownedBy as Ref) : null;
      const filter = bindFilter(ctx, ref.filter);
      return ids
        .map((id) => g.objects[id]!)
        .filter((o) => o && (!owners || owners.includes(o.controller)) && (!ownedBy || ownedBy.includes(o.owner)) && matchesFilter(g, o, filter, { controller: ctx.controller, source: ctx.source ?? null }));
    }
    case 'created': {
      // "the token", "sacrifice it at the beginning of the next end step"
      const made = ctx.resolution?.created ?? ctx.trigger?.created ?? [];
      return made.flatMap((r) => {
        const o = g.objects[r.id];
        return o && o.zcc === r.zcc ? [o] : [];
      });
    }
    case 'voted': {
      // CR 701.38: "each permanent with the most votes or tied for most votes"
      return (ctx.resolution?.voted ?? []).flatMap((r) => {
        const o = g.objects[r.id];
        return o && o.zcc === r.zcc ? [o] : [];
      });
    }
    case 'sacrificed_this_way':
      // What this resolution sacrificed, where it is now ("… sacrifices a creature. Return it to the battlefield").
      return movedThisWay(ctx, { how: 'sacrificed' }).flatMap((m) => (g.objects[m.id] ? [g.objects[m.id]!] : []));
    case 'exiled_with': {
      // CR 607.2a: cards in exile that this object's linked ability put there.
      const s = ctx.source;
      if (!s) return [];
      const zcc = battlefieldZcc(g, s);
      return g.zones.exile.map((id) => g.objects[id]!).filter((o) => o.exiledBy?.id === s.id && o.exiledBy.zcc === zcc);
    }
    default:
      return [];
  }
}

/** The players a reference means. */
export function refPlayers(ctx: EffectContext, ref: Ref): PlayerId[] {
  const { g } = ctx;
  const live = livePlayers(g);
  switch (ref.ref) {
    case 'you':
      return live.includes(ctx.controller) ? [ctx.controller] : [];
    case 'each_player':
      return ctx.eachPlayer && live.includes(ctx.eachPlayer) ? [ctx.eachPlayer] : [];
    case 'players': {
      const not = ref.except ? refPlayers(ctx, ref.except) : [];
      const all = apnap(g).filter((p) => (ref.who === 'each' || p !== ctx.controller) && !not.includes(p) && (!ref.lostLife || (g.turnLog.lifeLost?.[p] ?? 0) > 0));
      if (!ref.attacking) return all;
      // "each opponent attacking that player": controls a creature attacking them (CR 506.2).
      const defenders = refPlayers(ctx, ref.attacking);
      const attackers = Object.entries(g.combat?.attackers ?? {}).flatMap(([id, a]) =>
        a.target.kind === 'player' && defenders.includes(a.target.player) && g.objects[id] ? [g.objects[id]!.controller] : [],
      );
      return all.filter((p) => attackers.includes(p));
    }
    case 'target':
      return (ctx.targets[ref.index] ?? []).flatMap((t) => (t.kind === 'player' && live.includes(t.player) ? [t.player] : []));
    case 'trigger_player':
      return ctx.trigger?.player && live.includes(ctx.trigger.player) ? [ctx.trigger.player] : [];
    case 'chosen_player': {
      // "the chosen player": chosen as the source entered (as it last existed, if it has left).
      const s = ctx.source;
      const p = s?.chosen?.player ?? (s ? g.lastKnown?.[s.id]?.chosen?.player : undefined);
      return p && live.includes(p) ? [p] : [];
    }
    case 'chosen_opponent': {
      const p = ctx.resolution?.chosenOpponent;
      return p && live.includes(p) ? [p] : [];
    }
    case 'enchanted_player': {
      // CR 303.4: the player the source Aura is attached to (as it last existed, if it has left).
      const s = ctx.source;
      const p = s?.attachedToPlayer ?? (s ? g.lastKnown?.[s.id]?.enchantedPlayer : undefined);
      return p && live.includes(p) ? [p] : [];
    }
    case 'controller_of':
    case 'owner_of': {
      const out: PlayerId[] = [];
      const of = ref.of;
      // CR 608.2h: an object that has left uses its last known information.
      // Orcish Mine: "destroy enchanted land and this Aura deals 2 damage to that land's controller" — the Aura still
      // remembers what it was attached to after the land has gone.
      const attachedTo = of.ref === 'attached' ? sourceOf(ctx)?.attachedTo : undefined;
      const objects =
        of.ref === 'target'
          ? (ctx.targets[of.index] ?? []).flatMap((t) => (t.kind === 'object' ? [t] : []))
          : attachedTo
            ? [{ kind: 'object' as const, id: attachedTo.id, zcc: attachedTo.zcc }]
            : refObjects(ctx, of).map((o) => ({ kind: 'object' as const, id: o.id, zcc: o.zcc }));
      for (const t of objects) {
        const o = g.objects[t.id];
        if (!o) continue;
        const p = ref.ref === 'owner_of' ? o.owner : o.zcc === t.zcc ? o.controller : (ctx.resolution?.lki[o.id] ?? o.owner);
        if (live.includes(p) && !out.includes(p)) out.push(p);
      }
      return out;
    }
    default:
      return [];
  }
}

/** Damage and similar effects can point at players and objects alike ("any target"). */
export function refRecipients(ctx: EffectContext, ref: Ref): DamageRecipient[] {
  if (ref.ref === 'target') {
    return (ctx.targets[ref.index] ?? []).flatMap((t): DamageRecipient[] => {
      if (t.kind === 'player') return livePlayers(ctx.g).includes(t.player) ? [{ kind: 'player' as const, player: t.player }] : [];
      if (t.kind === 'ability') return [];
      const o = ctx.g.objects[t.id];
      return o && o.zcc === t.zcc && o.zone === 'battlefield' ? [{ kind: 'permanent' as const, object: o.id }] : [];
    });
  }
  const players = refPlayers(ctx, ref).map((p) => ({ kind: 'player' as const, player: p }));
  const objects = refObjects(ctx, ref)
    .filter((o) => o.zone === 'battlefield')
    .map((o) => ({ kind: 'permanent' as const, object: o.id }));
  return [...players, ...objects];
}

/** Amount kinds the engine counts (schema CORE_NODES.amounts). */
export const AMOUNT_KINDS: readonly string[] = ['count', 'cards', 'stat', 'life', 'counters', 'players', 'devotion', 'x', 'event', 'cast_before', 'commander_casts', 'kicks', 'party', 'life_lost', 'opponents_attacked', 'colors_spent', 'cost_lki', 'paid_times', 'domain', 'card_types', 'blockers', 'die_result', 'votes', 'greatest', 'discarded_this_way', 'spells_cast_this_turn', 'colors_among', 'commander_colors', 'total_power', 'moved_this_way', 'died_this_turn', 'damage_this_way', 'life_this_turn', 'excess_this_way', 'mana_spent', 'sum', 'drawn_this_turn'];

/** The objects a reference meant, with the zone-change count it meant them at (for last-known information). */
function refRefs(ctx: EffectContext, ref: Ref): { id: ObjectId; zcc: number }[] {
  if (ref.ref === 'target') return (ctx.targets[ref.index] ?? []).flatMap((t) => (t.kind === 'object' ? [{ id: t.id, zcc: t.zcc }] : []));
  if (ref.ref === 'trigger_object') return ctx.trigger?.object ? [ctx.trigger.object] : [];
  if (ref.ref === 'self' && ctx.source) return [{ id: ctx.source.id, zcc: ctx.sourceZcc ?? ctx.source.zcc }];
  return refObjects(ctx, ref).map((o) => ({ id: o.id, zcc: o.zcc }));
}

/** CR 608.2h: an object's power/toughness now, or as it last existed on the battlefield. */
function statOf(ctx: EffectContext, ref: Ref, stat: 'power' | 'toughness' | 'mana_value'): number {
  const { g } = ctx;
  const [r] = refRefs(ctx, ref);
  if (!r) return 0;
  const o = g.objects[r.id];
  if (stat === 'mana_value') return o ? manaValueOf(g, o) : 0;
  if (o && o.zcc === r.zcc && o.zone === 'battlefield') return chars(g, o)[stat];
  const last = g.lastKnown?.[r.id];
  // A leaves-the-battlefield trigger points at the new object; the one just before it was on the battlefield.
  if (last && (last.zcc === r.zcc || (ref.ref === 'trigger_object' && last.zcc === r.zcc - 1))) return last[stat];
  return o ? chars(g, o)[stat] : 0;
}

/** CR 700.5: mana symbols of those colors among the mana costs of permanents you control (hybrid counts). */
function devotion(ctx: EffectContext, colors: string[]): number {
  let n = 0;
  for (const id of ctx.g.zones.battlefield) {
    const o = ctx.g.objects[id]!;
    if (o.controller !== ctx.controller) continue;
    for (const m of (faceOf(ctx.g, o).manaCost ?? '').matchAll(/\{([^}]+)\}/g)) {
      if (m[1]!.split('/').some((c) => colors.includes(c))) n++;
    }
  }
  return n;
}

function count(ctx: EffectContext, e: AmountExpr): number {
  const { g } = ctx;
  const source = ctx.source ?? null;
  switch (e.kind) {
    case 'count': {
      // "for each creature target player controls"
      const owners = e.filter.controlledBy ? refPlayers(ctx, e.filter.controlledBy as Ref) : null;
      const filter = bindFilter(ctx, e.filter);
      const matching = g.zones.battlefield.filter((id) => (!owners || owners.includes(g.objects[id]!.controller)) && matchesFilter(g, g.objects[id]!, filter, { controller: ctx.controller, source }));
      if (e.most) return Math.max(0, ...livePlayers(g).filter((p) => p !== ctx.controller).map((p) => matching.filter((id) => g.objects[id]!.controller === p).length));
      return matching.length;
    }
    case 'cards': {
      const players = e.player ? refPlayers(ctx, e.player) : e.who === 'you' ? [ctx.controller] : livePlayers(g).filter((p) => e.who === 'each' || p !== ctx.controller);
      const zone = e.zone;
      if (e.least && zone !== 'exile') return Math.min(...players.map((p) => (g.zones[zone][p] ?? []).length));
      const ids = zone === 'exile' ? g.zones.exile : players.flatMap((p) => g.zones[zone][p] ?? []);
      return ids.filter((id) => {
        const o = g.objects[id]!;
        return e.zone !== 'exile' || players.includes(o.owner) ? !e.filter || matchesFilter(g, o, e.filter, { controller: ctx.controller, source, anyZone: true }) : false;
      }).length;
    }
    case 'stat':
      return statOf(ctx, e.of, e.stat);
    case 'mana_spent':
      return refObjects(ctx, e.of)[0]?.cast?.manaSpent ?? 0;
    case 'sum':
      return e.parts.reduce((n, p) => n + amountOf(ctx, p), 0);
    case 'life':
      return g.players[refPlayers(ctx, e.who)[0] ?? '']?.life ?? 0;
    case 'counters': {
      // "the number of experience counters you have": counters on a player (CR 122.1).
      if (e.of.ref === 'you') {
        const pc = g.players[ctx.controller]?.counters ?? {};
        return e.counter ? (pc[e.counter] ?? 0) : Object.values(pc).reduce((a, b) => a + (b ?? 0), 0);
      }
      const [o] = refObjects(ctx, e.of);
      // CR 608.2h: "Sacrifice this creature: … for each counter on this creature" — as it last existed on the battlefield.
      let counters = o?.counters;
      // Destroyed or died just now (the resolution or trigger still finds it, CR 400.7j): as it was on the battlefield.
      if (o && o.zone !== 'battlefield' && !Object.keys(o.counters).length) {
        const lk = g.lastKnown?.[o.id];
        if (lk && lk.zcc + 1 === o.zcc) counters = lk.counters ?? {};
      }
      // Cleopatra: "Whenever a legendary creature with counters on it dies, draw a card for each counter on it" (CR 603.10a).
      if (!o && e.of.ref === 'trigger_object' && ctx.trigger?.lki) counters = ctx.trigger.lki.counters;
      if (!o && !counters) {
        const was = e.of.ref === 'self' && ctx.source ? { id: ctx.source.id, zcc: ctx.sourceZcc } : e.of.ref === 'target' ? (ctx.targets[e.of.index] ?? []).map((t) => (t.kind === 'object' ? { id: t.id, zcc: t.zcc } : null))[0] : null;
        const lk = was ? g.lastKnown?.[was.id] : undefined;
        if (lk && (was!.zcc === undefined || lk.zcc === was!.zcc)) counters = lk.counters;
      }
      counters ??= {};
      return e.counter ? (counters[e.counter] ?? 0) : Object.values(counters).reduce((a, b) => a + b, 0);
    }
    case 'players': {
      // Smuggler's Share: "… who had two or more lands enter the battlefield under their control this turn".
      const lands = (p: PlayerId) => (g.turnLog.entered?.[p] ?? []).filter((id) => g.objects[id] && (g.objects[id]!.zone === 'battlefield' ? hasType(g, g.objects[id]!, 'Land') : faceOf(g, g.objects[id]!).types.includes('Land'))).length;
      return livePlayers(g).filter(
        (p) =>
          (e.who === 'each' || p !== ctx.controller) &&
          (!e.lostLife || (g.turnLog.lifeLost?.[p] ?? 0) > 0) &&
          (e.drew === undefined || (g.turnLog.drawn?.[p] ?? 0) >= e.drew) &&
          (e.landsEntered === undefined || lands(p) >= e.landsEntered) &&
          (!e.drewThisWay || (ctx.resolution?.drew?.[p] ?? 0) > 0) &&
          // Tymna the Weaver: "the number of opponents that were dealt combat damage this turn"
          (!e.combatDamaged || (g.turnLog.combatDamagers ?? []).some((d) => d.player === p)),
      ).length;
    }
    case 'devotion':
      return devotion(ctx, e.colors);
    case 'domain': {
      // CR 305.6: basic land types among lands you control.
      const types = new Set<string>();
      for (const id of g.zones.battlefield) {
        const o = g.objects[id]!;
        if (o.controller !== ctx.controller) continue;
        const c = chars(g, o);
        if (c.types.includes('Land')) for (const t of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']) if (c.subtypes.includes(t)) types.add(t);
      }
      return types.size;
    }
    case 'colors_among':
      // Faeburrow Elder: "for each color among permanents you control"
      return colorsAmong(g, ctx.controller, e.filter, source).length;
    case 'spells_cast_this_turn':
      // Aetherflux Reservoir: including the one that triggered it.
      return g.turnLog.spellsCast[ctx.controller] ?? 0;
    case 'drawn_this_turn':
      return g.turnLog.drawn?.[ctx.controller] ?? 0;
    case 'damage_this_way':
      return ctx.resolution?.damageDealt ?? 0;
    case 'excess_this_way':
      return ctx.resolution?.excess ?? 0;
    case 'died_this_turn':
      // "for each creature that died this turn" — creatures by default, as they last existed (CR 700.4).
      return (g.turnLog.died ?? []).filter(
        (d) =>
          (e.types ?? ['Creature']).some((t) => d.types.includes(t)) &&
          (!e.subtypes || e.subtypes.some((t) => d.subtypes.includes(t))) &&
          !(e.nontoken && d.token) &&
          (!e.controller || (e.controller === 'you' ? d.controller === ctx.controller : d.controller !== ctx.controller)),
      ).length;
    case 'moved_this_way': {
      const moved = movedThisWay(ctx, e);
      // Combustible Gearhulk: "the total mana value of those cards".
      if (e.stat === 'mana_value') return moved.reduce((n, m) => n + (g.objects[m.id] ? manaValueOf(g, g.objects[m.id]!) : 0), 0);
      return moved.length;
    }
    // Haliya: "the life you've gained this turn"; Neheb: "the life your opponents have lost this turn".
    case 'life_this_turn': {
      const log = e.stat === 'lost' ? g.turnLog.lifeLost : e.stat === 'damage' ? g.turnLog.damageTaken : g.turnLog.lifeGained;
      // Archfiend of Despair: "the life that player lost this turn".
      const players = e.player ? refPlayers(ctx, e.player) : e.who === 'you' ? [ctx.controller] : e.who === 'a_player' ? [...g.order] : g.order.filter((p) => p !== ctx.controller);
      const each = players.map((p) => log?.[p] ?? 0);
      return e.who === 'an_opponent' || e.who === 'a_player' ? Math.max(0, ...each) : each.reduce((n, v) => n + v, 0);
    }
    case 'discarded_this_way': {
      // Windfall: "the greatest number of cards a player discarded this way"
      const counts = Object.values(ctx.resolution?.discarded ?? {});
      return e.max ? Math.max(0, ...counts) : counts.reduce((a, b) => a + b, 0);
    }
    case 'greatest': {
      // "the greatest power among creatures you control" — 0 when there are none.
      const zone = e.filter.zone ?? 'battlefield';
      const ids =
        zone === 'battlefield'
          ? g.zones.battlefield
          : zone === 'exile' || zone === 'command'
            ? g.zones[zone]
            : zone === 'stack'
              ? []
              : (e.filter.owner === 'you' ? [ctx.controller] : g.order).flatMap((p) => g.zones[zone][p] ?? []);
      let best = 0;
      for (const id of ids) {
        const o = g.objects[id]!;
        if (!matchesFilter(g, o, e.filter, { controller: ctx.controller, source, anyZone: zone !== 'battlefield' })) continue;
        const v = e.stat === 'power' ? power(g, o) : e.stat === 'toughness' ? toughness(g, o) : manaValueOf(g, o);
        if (v > best) best = v;
      }
      return best;
    }
    case 'votes':
      // CR 701.38: "for each death vote"
      return ctx.resolution?.votes?.[e.option] ?? 0;
    case 'die_result':
      // CR 706.2: the result of the roll this resolution made.
      return ctx.resolution?.dieResult ?? ctx.trigger?.dieResult ?? 0;
    case 'blockers': {
      // CR 702.23a: "for each creature blocking it beyond the first"
      const [o] = refObjects(ctx, e.of);
      const blocking = o && g.combat ? Object.entries(g.combat.blockers).filter(([id, bl]) => g.objects[id]?.zcc === bl.zcc && (bl.blocking === o.id || bl.alsoBlocking?.includes(o.id))).length : 0;
      return Math.max(0, blocking - (e.beyond ?? 0));
    }
    case 'card_types': {
      // "the number of card types among cards in your graveyard" / "in all graveyards" / "in your opponents' graveyards"
      const whose = e.whose === 'all' ? g.order : e.whose === 'opponents' ? g.order.filter((p) => p !== ctx.controller) : [ctx.controller];
      return new Set(whose.flatMap((p) => zoneList(g, 'graveyard', p)).flatMap((id) => faceOf(g, g.objects[id]!).types)).size;
    }
    case 'x':
      return ctx.x;
    case 'event':
      // "that much", "that many": how much the trigger event was.
      return ctx.trigger?.amount ?? 0;
    case 'party': {
      // CR 700.8: up to one each of Cleric, Rogue, Warrior and Wizard — the biggest such group.
      const roles = ['Cleric', 'Rogue', 'Warrior', 'Wizard'];
      const creatures = g.zones.battlefield
        .map((id) => g.objects[id]!)
        .filter((o) => o.controller === ctx.controller && chars(g, o).types.includes('Creature'))
        .map((o) => roles.filter((r) => chars(g, o).subtypes.includes(r)))
        .filter((rs) => rs.length);
      const best = (i: number, used: Set<string>): number =>
        i >= creatures.length ? 0 : Math.max(best(i + 1, used), ...creatures[i]!.filter((r) => !used.has(r)).map((r) => 1 + best(i + 1, new Set([...used, r]))));
      return Math.min(4, best(0, new Set()));
    }
    case 'life_lost':
      // CR 702.101a: the life lost so far as this resolves.
      return ctx.resolution?.lifeLost ?? 0;
    case 'opponents_attacked': {
      // CR 702.121a: opponents (not planeswalkers or battles) you attacked with a creature this combat.
      const attacked = new Set<string>();
      for (const [id, a] of Object.entries(g.combat?.attackers ?? {})) {
        if (g.objects[id]?.controller === ctx.controller && a.target.kind === 'player' && a.target.player !== ctx.controller) attacked.add(a.target.player);
      }
      return attacked.size;
    }
    case 'cost_lki': {
      // CR 608.2h: "the sacrificed creature's power" — as it was when it was sacrificed.
      // A cost first; else what this resolution (or the one that created this reflexive ability) sacrificed.
      const lki = ctx.resolution?.entry.costLKI?.[e.cost] ?? ctx.resolution?.lkiThisWay?.[e.cost] ?? ctx.trigger?.lkiThisWay?.[e.cost];
      return lki?.reduce((n, x) => n + x[e.stat], 0) ?? 0;
    }
    case 'colors_spent':
      // CR 702.44a: colors of mana spent to cast it.
      return ctx.source?.cast?.colors ?? 0;
    case 'paid_times':
      // "for each time its replicate cost was paid" (CR 702.56a), "… its squad cost was paid" (CR 702.157a)
      return (ctx.source?.cast?.paid ?? []).filter((p) => p === e.cost).length;
    case 'kicks':
      // CR 702.33c: how many times the spell (or the permanent it became) was kicked.
      return ctx.source?.cast?.kicks ?? (ctx.source?.cast?.kicked ? 1 : 0);
    case 'total_power': {
      // Ghalta: "the total power of creatures you control"
      let n = 0;
      for (const id of g.zones.battlefield) {
        const o = g.objects[id]!;
        // Excalibur, Metalwork Colossus: "the total mana value of …".
        // Towering Titan: "the total toughness of other creatures you control".
        if (matchesFilter(g, o, e.filter, { controller: ctx.controller, source: ctx.source ?? null })) n += e.stat === 'mana_value' ? manaValueOf(g, o) : e.stat === 'toughness' ? Math.max(0, toughness(g, o)) : Math.max(0, power(g, o));
      }
      return n;
    }
    case 'commander_colors': {
      // War Room: "the number of colors in your commanders' color identity" (CR 903.4).
      const colors = new Set<string>();
      for (const o of Object.values(g.objects)) if (o.commander && o.owner === ctx.controller && !o.spellCopy) for (const c of g.cards[o.card]?.colorIdentity ?? []) colors.add(c);
      return colors.size;
    }
    case 'commander_casts':
      return Object.entries(g.commanderCasts).reduce((n, [id, k]) => n + (g.objects[id]?.owner === ctx.controller ? k : 0), 0);
    case 'cast_before': {
      // Counted as it was cast, so spells cast in response don't add to it (CR 702.40a).
      const o = e.of.ref === 'self' ? ctx.source : refObjects(ctx, e.of)[0];
      // Thousand-Year Storm: "each other instant and sorcery spell you've cast before it this turn".
      if (e.filter || e.yours) {
        const ref = e.of.ref === 'trigger_object' ? ctx.trigger?.object : o ? { id: o.id } : undefined;
        const cast = (g.turnLog.castSpells ?? []).filter((c) => !e.yours || c.player === ctx.controller);
        const at = ref ? cast.findIndex((c) => c.id === ref.id) : -1;
        if (at < 0) return 0;
        return cast.slice(0, at).filter((c) => !e.filter || (g.objects[c.id] && matchesFilter(g, g.objects[c.id]!, e.filter as ObjectFilter, { controller: ctx.controller, source: null, anyZone: true }))).length;
      }
      return o?.cast?.before ?? 0;
    }
    default:
      return 0;
  }
}

/**
 * Binds a filter's references to objects as an effect applies: "that shares a creature type with it" becomes those
 * creature types, "other than it" that object (CR 608.2h).
 */
export const PERMANENT_CARD_TYPES = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'];

export function bindFilter(ctx: EffectContext, f: ObjectFilter): ObjectFilter {
  // Fell the Mighty: "with power greater than target creature's power" — counted as the effect applies (CR 608.2h);
  // Day of Black Sun: "each creature with mana value X or less" — the X paid.
  const counted = (['power', 'toughness', 'manaValue'] as const).filter((k) => f[k] && (typeof f[k]!.n === 'object' || f[k]!.n === 'X'));
  if (counted.length) {
    const out: ObjectFilter = { ...f };
    for (const k of counted) out[k] = { ...f[k]!, n: f[k]!.n === 'X' ? ctx.x : amountOf(ctx, f[k]!.n) };
    return bindFilter(ctx, out);
  }
  if (f.sharesCardTypeWithSacrificed) {
    // Braids: the card types of the permanent sacrificed first in this resolution, as it last existed (CR 608.2h).
    const was = ctx.resolution?.lkiThisWay?.sacrificed?.[0]?.types ?? [];
    const { sharesCardTypeWithSacrificed: _s, ...rest } = f;
    const types = PERMANENT_CARD_TYPES.filter((t) => was.includes(t));
    return bindFilter(ctx, { ...rest, types: rest.types ? rest.types.filter((t) => types.includes(t)) : types });
  }
  if (!f.sharesCreatureTypeWith && !f.otherThan && !f.sameNameAs) return f;
  const out: ObjectFilter = { ...f };
  if (f.sameNameAs) {
    const [o] = refObjects(ctx, f.sameNameAs as Ref);
    out.sameName = o ? nameOf(ctx.g, o) : '\u0000';
  }
  if (f.sharesCreatureTypeWith) {
    const [o] = refObjects(ctx, f.sharesCreatureTypeWith as Ref);
    out.sharesCreatureTypes = o ? [...creatureTypesOf(chars(ctx.g, o))] : [];
  }
  if (f.otherThan) out.notObject = refObjects(ctx, f.otherThan as Ref)[0]?.id ?? '';
  return out;
}

/** "for each creature destroyed this way": what this resolution's destroy / exile / sacrifice / mill effects moved. */
export function movedThisWay(ctx: EffectContext, e: { how: string; types?: string[]; notTypes?: string[]; token?: boolean }): NonNullable<Resolution['moves']> {
  const how = e.how;
  return (ctx.resolution?.moves ?? []).filter((m) => {
    const right =
      how === 'destroyed'
        ? m.effect === 'destroy' && m.from === 'battlefield'
        : how === 'exiled'
          ? m.to === 'exile'
          : how === 'sacrificed'
            ? /^sacrifice/.test(m.effect) && m.from === 'battlefield'
            : how === 'graveyard'
              ? m.to === 'graveyard'
              : m.effect === 'mill' && m.from === 'library';
    return right && (!e.types || e.types.some((t) => m.types.includes(t))) && !(e.notTypes ?? []).some((t) => m.types.includes(t)) && (e.token === undefined || Boolean(m.token) === e.token);
  });
}

export function amountOf(ctx: EffectContext, a: Amount | unknown): number {
  if (a === 'X') return ctx.x;
  if (typeof a === 'number') return a;
  if (a && typeof a === 'object' && 'kind' in a) {
    const e = a as AmountExpr;
    // "half X, rounded down", "half their life, rounded up" — the count is halved; "-X, where X is half …" then negates it.
    const base = count(ctx, e);
    const n = e.half ? (e.half === 'up' ? Math.ceil(base / 2) : Math.floor(base / 2)) : base;
    return n * (e.times ?? 1) + (e.plus ?? 0);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function contextFor(g: GameState, entry: StackEntry, r: Resolution, events: GameEvent[], answer?: ChoiceAnswer, node?: EffectNode): EffectContext {
  const sourceId = entry.kind === 'spell' ? entry.object : entry.source.id;
  const source = g.objects[sourceId];
  const ctx: EffectContext = {
    g,
    // An effect done by another player as if they were "you" ("does the same").
    controller: (node?.asPlayer as PlayerId | undefined) ?? entry.controller,
    events,
    targets: r.targets,
    x: entry.x,
    memo: r.memo,
    resolution: r,
  };
  if (source) ctx.source = source;
  if (entry.kind === 'ability') {
    ctx.sourceZcc = entry.source.zcc;
    if (entry.trigger) ctx.trigger = entry.trigger;
  } else if (source) ctx.sourceZcc = source.zcc;
  if (answer) ctx.answer = answer;
  // Braids: "For each opponent who doesn't, that player loses 2 life" — that opponent.
  if (node?.eachPlayer) ctx.eachPlayer = node.eachPlayer as PlayerId;
  return ctx;
}

/**
 * CR 608.2b: as it starts to resolve, a spell or ability rechecks its targets.
 * Returns the targets still legal, or null if it had targets and none are legal.
 */
export function recheckTargets(g: GameState, entry: StackEntry): TargetRef[][] | null {
  const program = entry.program!;
  // Nothing targeted: keep any objects it was bound to (a delayed trigger, CR 603.7c).
  if (program.specs.length === 0) return entry.targets;
  const sourceId = entry.kind === 'spell' ? entry.object : entry.source.id;
  const source = g.objects[sourceId] ?? null;
  let chosen = 0;
  let legal = 0;
  const out = program.specs.map((spec, i) =>
    (entry.targets[i] ?? []).filter((t) => {
      chosen++;
      const ok = isLegalTarget(g, entry.controller, spec, t, source);
      if (ok) legal++;
      return ok;
    }),
  );
  return chosen > 0 && legal === 0 ? null : out;
}

export function startResolution(g: GameState, entry: StackEntry, targets: TargetRef[][]): void {
  const lki: Record<ObjectId, PlayerId> = {};
  for (const list of targets) for (const t of list) if (t.kind === 'object' && g.objects[t.id]) lki[t.id] = g.objects[t.id]!.controller;
  // "that land's controller" after the enchanted land is destroyed mid-resolution.
  const src = entry.kind === 'spell' ? g.objects[entry.object] : g.objects[entry.source.id];
  const att = src?.attachedTo ? g.objects[src.attachedTo.id] : undefined;
  if (att && att.zcc === src!.attachedTo!.zcc && lki[att.id] === undefined) lki[att.id] = att.controller;
  g.resolving = { entry, effects: structuredClone(entry.program!.effects), index: 0, memo: {}, targets, lki };
}

/**
 * Runs the resolving entry's effects in order (CR 608.2c) until it finishes or an effect
 * needs a player's choice. Returns true when every effect has been carried out.
 */
export function runResolution(g: GameState, events: GameEvent[], answer?: ChoiceAnswer): boolean {
  const r = g.resolving!;
  const entry = r.entry;
  let pendingAnswer = answer;
  while (r.index < r.effects.length) {
    const node = r.effects[r.index]!;
    const result = runEffect(node, contextFor(g, entry, r, events, pendingAnswer, node));
    pendingAnswer = undefined;
    if (typeof result === 'object' && 'ask' in result) {
      g.pending = result.ask;
      return false;
    }
    if (typeof result === 'object' && 'expand' in result) {
      // What an effect done "as" another player expands into is done by them too.
      const as = node.asPlayer;
      const each = node.eachPlayer;
      const expanded = as ? result.expand.map((e) => (e.asPlayer ? e : { ...e, asPlayer: as })) : result.expand;
      r.effects.splice(r.index, 1, ...(each ? expanded.map((e) => (e.eachPlayer ? e : { ...e, eachPlayer: each })) : expanded));
      r.memo = {};
      continue;
    }
    r.index++;
    r.memo = {};
    if (g.over) break;
  }
  g.resolving = null;
  return true;
}
