import type { AmountExpr, ConditionNode, ObjectFilter, Ref } from '@mtg/schema';
import { chars, matchesFilter, power, toughness } from './characteristics.js';
import type { EffectContext } from './registry.js';
import { amountOf, refObjects, refPlayers } from './resolve.js';
import type { GameEvent, GameObject, GameState, LKIStats, ObjectId, PlayerId } from './types.js';
import { faceOf, livePlayers, manaValueOf, nameOf, zoneList } from './zones.js';
import { isRingBearer } from './ring.js';

/** Condition tags the engine evaluates (schema CORE_NODES.conditions). */
export const CONDITION_TYPES: readonly string[] = [
  'greatest_power', 'kicked', 'cast_by_you', 'self_tapped', 'your_turn', 'count', 'life', 'hand', 'graveyard', 'this_turn', 'spells_last_turn',
  'counters', 'is', 'has_attached', 'monstrous', 'harnessed', 'and', 'opponents', 'monarch', 'class_level', 'paid', 'arrived_since_upkeep', 'renowned', 'day_night', 'saddled', 'max_speed', 'city_blessing', 'compare_stats', 'won_flip', 'before_attackers', 'step', 'prepared', 'won_clash', 'ring_bearer', 'chose_other_ring_bearer', 'completed_dungeon', 'initiative',
  'poison', 'different_powers', 'total_power', 'entered_this_turn', 'or', 'amount', 'combat_damage_by', 'discarded_this_turn', 'votes', 'opponent_has_more', 'attacked_with', 'was_type', 'was_attacking', 'had_keyword', 'sacrificed_this_turn', 'not', 'early_turn', 'distinct_names', 'unique_name', 'greatest_mv', 'first_combat', 'cast_in_main_phase', 'cast_off_sorcery_timing', 'chosen_word', 'most_of', 'lki_was', 'cast_named_before', 'same_name', 'ability_resolutions', 'attacking_you',
];

/** What happened this turn, for conditions like "if a creature died this turn". */
export interface TurnLog {
  creatureDied: boolean;
  attacked: PlayerId[];
  gainedLife: PlayerId[];
  lostLife: PlayerId[];
  /** How much life each player gained / lost this turn (Haliya: "if you've gained 3 or more life this turn"). */
  lifeGained?: Record<PlayerId, number>;
  lifeLost?: Record<PlayerId, number>;
  /** Combat phases begun this turn (Genji Glove: "if it's the first combat phase of the turn"). */
  combatPhases?: number;
  /** Damage dealt to each player this turn (Spinerock Knoll). */
  damageTaken?: Record<PlayerId, number>;
  /** Chandra's Incinerator: the noncombat part of it. */
  noncombatDamageTaken?: Record<PlayerId, number>;
  spellsCast: Record<PlayerId, number>;
  /** The spells cast this turn, by whom ("can't cast more than one noncreature spell each turn"). */
  castSpells?: { player: PlayerId; id: ObjectId; zcc?: number; from?: string; mv?: number }[];
  /** Forge Anew: the players who activated an equip ability this turn. */
  equipped?: PlayerId[];
  noncreatureCast: PlayerId[];
  /** Active players who have drawn in this turn's draw step ("except the first one you draw in each of your draw steps"). */
  drawStepDrew?: PlayerId[];
  /** Cards the active player has actually drawn in this turn's draw step (Orcish Bowmasters). */
  drawStepCards?: number;
  /** What died this turn, as it last existed ("for each creature that died this turn"). */
  died?: { controller: PlayerId; types: string[]; subtypes: string[]; token: boolean }[];
  /** CR 700.11: how many times each player descended this turn. */
  descended?: Record<PlayerId, number>;
  /** Players dealt damage this turn (CR 702.54a bloodthirst). */
  damagedPlayers: PlayerId[];
  /** Cards each player has drawn this turn. */
  drawn?: Record<PlayerId, number>;
  /** Which cards ("cards in your hand drawn this turn", Sylvan Library). */
  drawnIds?: Record<PlayerId, ObjectId[]>;
  /** Players who created a token this turn. */
  createdToken?: PlayerId[];
  /** Thalisse: how many tokens each player created this turn. */
  tokensCreated?: Partial<Record<PlayerId, number>>;
  /** Players who controlled a permanent that left the battlefield this turn (revolt). */
  left?: PlayerId[];
  /** A nonland permanent left the battlefield this turn (void). */
  nonlandLeft?: boolean;
  /** Permanents that entered the battlefield this turn, by controller (celebration). */
  entered?: Record<PlayerId, ObjectId[]>;
  /** Elanor Gardner: what each player sacrificed this turn, as it last existed. */
  sacrificedBy?: Record<PlayerId, { types: string[]; subtypes: string[] }[]>;
  /** What each of them was as it entered — for a token that has since left and ceased to exist (CR 704.5d). */
  enteredAs?: Record<ObjectId, { types: string[]; subtypes: string[]; supertypes: string[]; token?: true }>;
  /** CR 702.185c: a spell was warped this turn. */
  warped?: boolean;
  /** Who has targeted each object this turn (valiant: "for the first time each turn"). */
  targeted?: Record<ObjectId, PlayerId[]>;
  /** CR 700.13: players who committed a crime this turn. */
  crimes?: PlayerId[];
  /** CR 700.14: mana each player has spent to cast spells this turn. */
  manaSpent?: Record<PlayerId, number>;
  /** The sources that dealt damage to each permanent this turn. */
  damagedBy?: Record<ObjectId, ObjectId[]>;
  /** Each card or token put into a graveyard this turn, in order (with its card types then). */
  toGraveyard?: { event: GameEvent; types: string[]; owner: PlayerId; token: boolean }[];
  /** Danny Pink: the first counters event this turn for each object, keyed "id:zcc". */
  firstCounters?: Record<string, GameEvent>;
  /** Damage dealt this turn by each source, keyed "id:zcc". */
  dealtDamage?: Record<string, number>;
  /** How many times each creature has been declared as an attacker this turn. */
  attacks?: Record<ObjectId, number>;
  /** The object each attacking creature was as it attacked (CR 400.7: "that attacked this turn"). */
  attackedAs?: Record<ObjectId, number>;
  /** Lurrus: the "once during each of your turns" graveyard permissions used this turn (source id:zcc). */
  graveyardCasts?: string[];
  /** Alliance-style "if this is the second time this ability has resolved this turn": resolutions so far, by ability (source id:zcc:text). */
  abilityResolutions?: Record<string, number>;
  /** Port Razer: the players each creature (as this object) attacked this turn. */
  attackedPlayers?: Record<ObjectId, { zcc: number; players: PlayerId[] }>;
  /** Cards discarded this turn, as the objects they became (mayhem). */
  discarded?: { id: ObjectId; zcc: number }[];
  /** Players who activated a loyalty ability this turn (The Chain Veil). */
  loyaltyActivated?: PlayerId[];
  /** Sources that dealt combat damage to a player this turn, as they were then (prowl, freerunning). */
  combatDamagers?: { player: PlayerId; controller: PlayerId; types: string[]; subtypes: string[]; commander: boolean; legendary?: boolean; source?: ObjectId; zcc?: number }[];
}

export function newTurnLog(): TurnLog {
  return { creatureDied: false, attacked: [], gainedLife: [], lostLife: [], spellsCast: {}, noncreatureCast: [], damagedPlayers: [], drawn: {} };
}

/** Records the events of one batch in the turn log. */
/** How far into each event list the turn log has recorded (the rest happened during the resolution still under way). */
export const loggedUpTo = new WeakMap<GameEvent[], number>();

export function logTurnEvents(g: GameState, events: GameEvent[]): void {
  const log = g.turnLog;
  for (const e of events) {
    switch (e.type) {
      case 'sacrificed': {
        const lk = g.lastKnown?.[e.object];
        const o = g.objects[e.object];
        const face = o ? g.cards[o.card]?.faces[o.face ?? 0] : undefined;
        ((log.sacrificedBy ??= {})[e.player] ??= []).push({ types: [...(lk?.types ?? face?.types ?? [])], subtypes: [...(lk?.subtypes ?? face?.subtypes ?? [])] });
        break;
      }
      case 'ability_activated':
        if (e.loyalty && !(log.loyaltyActivated ??= []).includes(e.player)) log.loyaltyActivated.push(e.player);
        break;
      case 'moved': {
        const types = g.cards[e.card]?.faces[e.face]?.types ?? [];
        // CR 700.11: "descended this turn" — a permanent card put into that player's graveyard from anywhere (tokens aren't cards).
        if (e.to === 'graveyard' && !g.objects[e.object]?.token && ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'].some((t) => types.includes(t))) {
          const owner = g.objects[e.object]?.owner;
          if (owner) (log.descended ??= {})[owner] = (log.descended[owner] ?? 0) + 1;
        }
        // Crawling Sensation: "for the first time each turn" — each card put into a graveyard, in order.
        if (e.to === 'graveyard' && g.objects[e.object]) (log.toGraveyard ??= []).push({ event: e, types: [...types], owner: g.objects[e.object]!.owner, token: Boolean(g.objects[e.object]!.token) });
        if (e.from === 'battlefield' && e.to === 'graveyard') {
          // CR 700.4: it died — as it last existed on the battlefield.
          const lk = g.lastKnown?.[e.object];
          const was = lk?.types ?? types;
          if (was.includes('Creature') || types.includes('Creature')) log.creatureDied = true;
          (log.died ??= []).push({ controller: e.controller, types: [...was], subtypes: [...(lk?.subtypes ?? [])], token: Boolean(g.objects[e.object]?.token) });
        }
        if (e.from === 'battlefield') {
          if (!(log.left ??= []).includes(e.controller)) log.left.push(e.controller);
          if (!types.includes('Land')) log.nonlandLeft = true;
        }
        if (e.to === 'battlefield') {
          const o = g.objects[e.object];
          if (o) ((log.entered ??= {})[o.controller] ??= []).push(o.id);
          if (o) recordEnteredAs(g, log, o);
        }
        break;
      }
      case 'created': {
        const o = g.objects[e.object];
        if (o) ((log.entered ??= {})[o.controller] ??= []).push(o.id);
        if (o) recordEnteredAs(g, log, o);
        // "if you created a token this turn" (Idol of Oblivion)
        if (!(log.createdToken ??= []).includes(e.controller)) log.createdToken.push(e.controller);
        (log.tokensCreated ??= {})[e.controller] = (log.tokensCreated[e.controller] ?? 0) + 1;
        break;
      }
      case 'became_target': {
        const by = ((log.targeted ??= {})[e.object] ??= []);
        if (!by.includes(e.controller)) {
          by.push(e.controller);
          e.first = true;
        }
        break;
      }
      case 'attacks_declared':
        if (e.attacks.length && !log.attacked.includes(g.active)) log.attacked.push(g.active);
        for (const a of e.attacks) (log.attacks ??= {})[a.attacker] = ((log.attacks ??= {})[a.attacker] ?? 0) + 1;
        for (const a of e.attacks) if (g.objects[a.attacker]) (log.attackedAs ??= {})[a.attacker] = g.objects[a.attacker]!.zcc;
        for (const a of e.attacks) {
          const o = g.objects[a.attacker];
          if (!o || a.target.kind !== 'player') continue;
          const rec = (log.attackedPlayers ??= {})[a.attacker];
          if (rec && rec.zcc === o.zcc) {
            if (!rec.players.includes(a.target.player)) rec.players.push(a.target.player);
          } else log.attackedPlayers[a.attacker] = { zcc: o.zcc, players: [a.target.player] };
        }
        break;
      case 'life':
        if (e.delta > 0 && !log.gainedLife.includes(e.player)) {
          log.gainedLife.push(e.player);
          e.firstGain = true;
        }
        if (e.delta < 0 && !log.lostLife.includes(e.player)) {
          log.lostLife.push(e.player);
          e.firstLoss = true;
        }
        if (e.delta > 0) (log.lifeGained ??= {})[e.player] = (log.lifeGained[e.player] ?? 0) + e.delta;
        if (e.delta < 0) (log.lifeLost ??= {})[e.player] = (log.lifeLost[e.player] ?? 0) - e.delta;
        break;
      case 'counters': {
        const o = g.objects[e.object];
        if (o && e.delta > 0) (log.firstCounters ??= {})[`${o.id}:${o.zcc}`] ??= e;
        break;
      }
      case 'damage':
        if (e.to.kind === 'player' && !log.damagedPlayers.includes(e.to.player)) log.damagedPlayers.push(e.to.player);
        if (e.to.kind === 'player') (log.damageTaken ??= {})[e.to.player] = (log.damageTaken[e.to.player] ?? 0) + e.amount;
        if (e.to.kind === 'player' && !e.combat) (log.noncombatDamageTaken ??= {})[e.to.player] = (log.noncombatDamageTaken[e.to.player] ?? 0) + e.amount;
        if (e.to.kind === 'player' && e.combat && g.objects[e.source]) {
          const s = g.objects[e.source]!;
          const c = chars(g, s);
          (log.combatDamagers ??= []).push({ player: e.to.player, controller: s.controller, types: [...c.types], subtypes: [...c.subtypes], commander: Boolean(s.commander), ...(c.supertypes.includes('Legendary') ? { legendary: true } : {}), source: s.id, zcc: s.zcc });
        }
        if (e.to.kind === 'permanent') {
          const by = ((log.damagedBy ??= {})[e.to.object] ??= []);
          if (!by.includes(e.source)) by.push(e.source);
        }
        if (g.objects[e.source]) {
          const key = `${e.source}:${e.sourceZcc ?? g.objects[e.source]!.zcc}`;
          (log.dealtDamage ??= {})[key] = (log.dealtDamage[key] ?? 0) + e.amount;
        }
        break;
      case 'crime':
        if (!(log.crimes ??= []).includes(e.player)) log.crimes.push(e.player);
        break;
      case 'discarded': {
        const o = g.objects[e.object];
        if (o) (log.discarded ??= []).push({ id: o.id, zcc: o.zcc });
        break;
      }
      case 'cast': {
        log.spellsCast[e.player] = (log.spellsCast[e.player] ?? 0) + 1;
        const o = g.objects[e.object];
        // Call Forth the Tempest: its mana value as it was cast (CR 202.3e: X counts on the stack).
        (log.castSpells ??= []).push({ player: e.player, id: e.object, ...(o ? { zcc: o.zcc, mv: manaValueOf(g, o), ...(o.cast?.from ? { from: o.cast.from } : {}) } : {}) });
        if (o) ((g.castNames ??= {})[e.player] ??= []).push(nameOf(g, o));
        const face = o ? g.cards[o.card]?.faces[o.face] : undefined;
        if (face && !face.types.includes('Creature') && !log.noncreatureCast.includes(e.player)) log.noncreatureCast.push(e.player);
        if (o?.cast?.paid?.includes('warp')) log.warped = true;
        break;
      }
    }
  }
}

const cmp = (v: number, c: ConditionNode) =>
  (c.min === undefined || v >= Number(c.min)) &&
  (c.max === undefined || v <= Number(c.max)) &&
  (c.op === undefined || (c.op === 'ge' ? v >= Number(c.n) : c.op === 'le' ? v <= Number(c.n) : c.op === 'gt' ? v > Number(c.n) : c.op === 'lt' ? v < Number(c.n) : v === Number(c.n)));

/** Whether a condition is true now, for the spell or ability in `ctx`. */
export function evalCondition(cond: ConditionNode, ctx: EffectContext): boolean {
  const { g, controller } = ctx;
  const source = ctx.source;
  switch (cond.type) {
    case 'kicked':
      // CR 702.33d: the spell (or the permanent it became) was kicked.
      return Boolean(source?.cast?.kicked);
    // Necromancy: "If you cast it any time a sorcery couldn't have been cast" (CR 307.5).
    case 'most_of': {
      // Battle Angels of Tyr: more than each other player (still in the game, CR 800.4a).
      const [p] = refPlayers(ctx, cond.of as Ref);
      if (!p) return false;
      const value = (q: PlayerId) => (cond.what === 'hand' ? zoneList(g, 'hand', q).length : cond.what === 'lands' ? g.zones.battlefield.filter((id) => g.objects[id]!.controller === q && chars(g, g.objects[id]!).types.includes('Land')).length : g.players[q]!.life);
      const v = value(p);
      return livePlayers(g).filter((q) => q !== p).every((q) => v > value(q));
    }
    case 'chosen_word':
      // The Sieges: "• Khans — …" — while "Khans" is what was chosen as it entered (CR 614.12).
      return source?.chosen?.word === cond.word;
    case 'cast_off_sorcery_timing':
      return Boolean(source?.cast?.offSorceryTiming && !source.cast.copy && source.cast.by === controller);
    case 'cast_in_main_phase':
      // Addendum: "If you cast this spell during your main phase" — a copy wasn't cast (CR 707.10).
      return Boolean(source?.cast?.mainPhase && !source.cast.copy && source.cast.by === controller);
    case 'arrived_since_upkeep': {
      // CR 702.30a: it came under your control after your previous upkeep began (or you've had none).
      const upkeeps = g.players[controller]?.upkeeps ?? [];
      const previous = upkeeps.length >= 2 ? upkeeps[upkeeps.length - 2]! : -1;
      return Boolean(source && source.zone === 'battlefield' && (source.arrived ?? source.timestamp) > previous);
    }
    case 'completed_dungeon': {
      // "if you've completed a dungeon", "if you haven't completed Tomb of Annihilation" (CR 309.7)
      const done = g.players[controller]?.completed ?? [];
      return (cond.name ? done.includes(String(cond.name)) : done.length > 0) !== Boolean(cond.not);
    }
    case 'initiative':
      // CR 726.1: "if you have the initiative"
      return (g.initiative === controller) !== Boolean(cond.not);
    case 'ring_bearer': {
      // CR 701.54e: "if ~ is your Ring-bearer"; "if you don't control a Ring-bearer".
      const yes = cond.any
        ? g.zones.battlefield.some((id) => g.objects[id]!.controller === controller && isRingBearer(g.objects[id]!))
        : Boolean(source && isRingBearer(source) && source.controller === controller);
      return yes !== Boolean(cond.not);
    }
    case 'chose_other_ring_bearer':
      // "if you chose a creature other than ~ as your Ring-bearer"
      return Boolean(ctx.trigger?.object && ctx.trigger.object.id !== source?.id);
    case 'won_clash':
      // CR 701.30d: "If you win" — the clash this spell or ability just made.
      return Boolean(ctx.resolution?.clashWon) !== Boolean(cond.not);
    case 'won_flip':
      // CR 705.2
      // Goblin Bomb: "you may flip a coin. … If you lose the flip, …" — not when no coin was flipped.
      return cond.not ? ctx.resolution?.flipWon === false : ctx.resolution?.flipWon === true;
    case 'before_attackers':
      // CR 602.5b: "Activate only during your turn, before attackers are declared."
      return g.active === controller && ['untap', 'upkeep', 'draw', 'main1', 'beginning_of_combat'].includes(g.step) && !g.combat?.attackersDeclared;
    case 'step': {
      if (cond.yours && g.active !== controller) return false;
      if (cond.combat) return ['beginning_of_combat', 'declare_attackers', 'declare_blockers', 'combat_damage', 'end_of_combat'].includes(g.step);
      // Moraug: "if it's your main phase" — either one (CR 505.1).
      if (cond.main) return g.step === 'main1' || g.step === 'main2';
      return g.step === cond.step;
    }
    case 'max_speed':
      // CR 702.179e: speed 4.
      return ((g.players[controller]?.speed ?? 0) >= 4) !== Boolean(cond.not);
    case 'city_blessing':
      return Boolean(g.players[controller]?.cityBlessing);
    // The Enduring cycle: "if it was a creature" — as it last existed on the battlefield (CR 603.10a).
    // "If the discarded card wasn't a land card", "If the sacrificed creature was a Human" (CR 608.2h): as a cost was
    // paid, or as this effect sacrificed or discarded it.
    case 'lki_was': {
      const what = cond.what as 'discarded' | 'sacrificed';
      const list = ctx.resolution?.entry.costLKI?.[what] ?? ctx.resolution?.lkiThisWay?.[what] ?? ctx.trigger?.lkiThisWay?.[what] ?? [];
      if (!list.length) return false;
      const f = cond.filter as ObjectFilter;
      const fits = (s: LKIStats) =>
        (!f.types || f.types.some((t) => s.types?.includes(t))) &&
        (!f.subtypes || f.subtypes.some((t) => s.subtypes?.includes(t))) &&
        (!f.supertypes || f.supertypes.every((t) => s.supertypes?.includes(t))) &&
        (!f.colors || f.colors.some((c) => s.colors?.includes(c))) &&
        (!f.multicolored || (s.colors?.length ?? 0) > 1);
      return list.some(fits) !== Boolean(cond.not);
    }
    // Approach of the Second Sun: "you've cast another spell named ~ this game" — this one and at least one more.
    case 'cast_named_before': {
      const name = source ? nameOf(g, source) : '';
      return (g.castNames?.[controller] ?? []).filter((n) => n === name).length >= 2;
    }
    case 'had_keyword': {
      // Wilhelt, the Rotcleaver: "Whenever another Zombie you control dies, if it didn't have decayed" — as it last existed.
      const r = ctx.trigger?.object;
      const last = r ? g.lastKnown?.[r.id] : undefined;
      return Boolean(last && (last.zcc === r!.zcc || last.zcc === r!.zcc - 1) && last.keywords?.includes(String(cond.keyword)));
    }
    case 'was_attacking': {
      // Zurgo Stormrender: "if it was attacking" — the creature that left, as it last existed on the battlefield.
      const r = ctx.trigger?.object;
      const a = r ? g.combat?.attackers[r.id] : undefined;
      const last = r ? g.lastKnown?.[r.id] : undefined;
      const zcc = r && last && (last.zcc === r.zcc || last.zcc === r.zcc - 1) ? last.zcc : r?.zcc;
      return Boolean(a && a.zcc === zcc);
    }
    case 'was_type': {
      const r = ctx.trigger?.object;
      const last = r ? g.lastKnown?.[r.id] : undefined;
      return Boolean(last && (last.zcc === r!.zcc || last.zcc === r!.zcc - 1) && (cond.subtype ? last.subtypes?.includes(String(cond.subtype)) : last.types?.includes(String(cond.cardType))));
    }
    // Minas Tirith: "if you attacked with two or more creatures this turn"
    // Firemane Commando: "if none of those creatures attacked you" — the creatures attacking you (not your planeswalkers).
    case 'attacking_you': {
      const n = Object.values(g.combat?.attackers ?? {}).filter((a) => a.target.kind === 'player' && a.target.player === controller).length;
      return cmp(n, cond);
    }
    case 'attacked_with': {
      // Kytheon, Hero of Akros: "if Kytheon and at least two other creatures attacked this combat".
      if (cond.withSelf) {
        const declared = g.combat?.declared ?? [];
        const self = source && declared.some((d) => d.id === source.id && d.zcc === (ctx.sourceZcc ?? source.zcc));
        return Boolean(self) && declared.filter((d) => d.id !== source!.id).length >= Number(cond.n ?? 1);
      }
      const n = Object.keys(g.turnLog.attacks ?? {}).filter((id) => g.objects[id]?.controller === controller).length;
      return n >= Number(cond.n ?? 1);
    }
    case 'opponent_has_more': {
      // Land Tax: "if an opponent controls more lands than you"
      const count = (p: PlayerId) => g.zones.battlefield.filter((id) => g.objects[id]!.controller === p && matchesFilter(g, g.objects[id]!, cond.filter as ObjectFilter, { controller: p, source: source ?? null })).length;
      const mine = count(controller);
      // Archaeomancer's Map: "that player" — the one the trigger is about.
      const others = cond.player ? refPlayers(ctx, cond.player as Ref) : livePlayers(g);
      return others.some((p) => p !== controller && count(p) > mine);
    }
    case 'votes': {
      // CR 701.38: "If sickness gets more votes", "If psychosis gets more votes or the vote is tied"
      const tally = ctx.resolution?.votes ?? {};
      const mine = tally[String(cond.option)] ?? 0;
      const others = Object.entries(tally).filter(([k]) => k !== cond.option).map(([, v]) => v);
      const best = Math.max(0, ...others);
      return cond.orTied ? mine >= best : mine > best;
    }
    case 'discarded_this_turn':
      // CR 702.187b (mayhem): "As long as you discarded this card this turn" — it's still the card that was discarded.
      return Boolean(source && (g.turnLog.discarded ?? []).some((d) => d.id === source.id && d.zcc === source.zcc));
    case 'combat_damage_by': {
      // CR 702.76a (prowl): "a source you controlled that had any of this spell's creature types";
      // CR 702.173a (freerunning): "an Assassin creature or a commander under your control".
      // Blitzball: "if an opponent was dealt combat damage by a legendary creature this turn" — anyone's creature.
      if (cond.toOpponent) return (g.turnLog.combatDamagers ?? []).some((d) => d.player !== controller && d.types.includes('Creature') && (!cond.legendary || d.legendary));
      const mine = (g.turnLog.combatDamagers ?? []).filter((d) => d.controller === controller);
      if (cond.sharesType) {
        const f = source ? faceOf(g, source) : null;
        const kinds = f && (f.types.includes('Creature') || f.types.includes('Kindred') || f.types.includes('Tribal')) ? f.subtypes : [];
        return mine.some((d) => d.subtypes.some((s) => kinds.includes(s)));
      }
      return mine.some((d) => (cond.subtype !== undefined && d.types.includes('Creature') && d.subtypes.includes(String(cond.subtype))) || (cond.orCommander && d.commander));
    }
    case 'amount':
      // "if X is 5 or more" (ravenous, CR 702.156a); Thassa's Oracle: "if X is greater than or equal to the number of
      // cards in your library" — two counts.
      return cmp(amountOf(ctx, cond.amount), typeof cond.n === 'object' && cond.n ? { ...cond, n: amountOf(ctx, cond.n as AmountExpr) } : cond);
    case 'compare_stats': {
      // CR 702.100a (evolve): either stat greater.
      const [a] = refObjects(ctx, cond.of as never);
      const [b] = refObjects(ctx, cond.than as never);
      if (!a || !b) return false;
      return (cond.stats as string[]).some((s) => (s === 'power' ? power(g, a) > power(g, b) : toughness(g, a) > toughness(g, b)));
    }
    case 'day_night':
      // CR 731: "if it's night"
      return cond.is === 'neither' ? !g.dayNight : g.dayNight === cond.is;
    case 'prepared':
      // CR 722.3a: "if this creature isn't prepared"
      return Boolean(source && source.zone === 'battlefield' && source.prepared) !== Boolean(cond.not);
    case 'saddled':
      // CR 702.171b: saddled until end of turn (or until it leaves).
      return Boolean(source && source.zone === 'battlefield' && source.saddledTurn === g.turn);
    case 'renowned':
      // CR 702.112b
      return Boolean(source?.renowned && source.zone === 'battlefield') !== Boolean(cond.not);
    case 'paid':
      // "if its evoke cost was paid" — the spell, or the permanent it became (CR 601.2f).
      return Boolean(source?.cast?.paid?.includes(String(cond.cost))) !== Boolean(cond.not);
    case 'cast_by_you': {
      // "if you cast it" — the spell or permanent itself, or what "it" names.
      const o = cond.of ? refObjects(ctx, cond.of as never)[0] : source;
      return !o?.cast?.copy && o?.cast !== undefined && (cond.anyone || o.cast.by === controller) && (!cond.fromHand || o.cast.from === 'hand') && (!cond.from || o.cast.from === cond.from);
    }
    case 'self_tapped':
      return Boolean(source && source.zone === 'battlefield' && source.tapped === cond.tapped);
    case 'your_turn': {
      // Tataru Taru: "if it isn't that player's turn" — whose turn it is, for another player.
      const whose = cond.who ? refPlayers(ctx, cond.who as Ref)[0] : controller;
      return (whose !== undefined && g.active === whose) === Boolean(cond.value);
    }
    case 'count': {
      // "three or more creatures are attacking": everyone's (who 'all').
      const players =
        cond.who === 'you' ? [controller] : cond.who === 'all' ? livePlayers(g) : livePlayers(g).filter((p) => p !== controller);
      const counts = players.map(
        (p) =>
          g.zones.battlefield.filter((id) => {
            const o = g.objects[id]!;
            return o.controller === p && matchesFilter(g, o, cond.filter as ObjectFilter, { controller: p, source: source ?? null });
          }).length,
      );
      // "your opponents control" — all of theirs together.
      if (cond.who === 'opponents_total' || cond.who === 'all') return cmp(counts.reduce((a, b) => a + b, 0), cond);
      // "an opponent controls" — any of them; "each opponent controls" — all of them.
      return cond.who === 'any_opponent' ? counts.some((n) => cmp(n, cond)) : counts.length > 0 && counts.every((n) => cmp(n, cond));
    }
    case 'life':
      // "an opponent has 10 or less life"
      if (cond.who === 'any_opponent') return livePlayers(g).some((p) => p !== controller && cmp(g.players[p]!.life, cond));
      if (cond.who === 'any_player') return livePlayers(g).some((p) => cmp(g.players[p]!.life, cond));
      if (cond.who === 'each_player') return livePlayers(g).every((p) => cmp(g.players[p]!.life, cond));
      // Cosmos Elixir: "if your life total is greater than your starting life total" (CR 103.4).
      // Scourge of the Throne: "if it's attacking the player with the most life or tied for most life" (CR 702.105a's test).
      if (cond.attackingMost) {
        const a = source ? g.combat?.attackers[source.id] : undefined;
        if (!a || a.zcc !== source!.zcc || a.target.kind !== 'player') return false;
        const p = a.target.player;
        return livePlayers(g).every((q) => g.players[q]!.life <= g.players[p]!.life);
      }
      // Guild Artisan: "if no opponent has more life than that player".
      if (cond.mostAmongOpponents) {
        const p = refPlayers(ctx, cond.of as Ref)[0];
        return p !== undefined && livePlayers(g).every((q) => q === controller || g.players[q]!.life <= g.players[p]!.life);
      }
      // Preacher of the Schism: "you have the most life or are tied for most life".
      if (cond.most) return livePlayers(g).every((p) => g.players[controller]!.life >= g.players[p]!.life);
      // Righteous Valkyrie: "if you have at least 7 life more than your starting life total" (`plus`).
      if (cond.starting) return cmp(g.players[controller]!.life, { ...cond, n: g.config.startingLife + Number(cond.plus ?? 0) });
      return cmp(g.players[controller]!.life, cond);
    case 'hand': {
      // Temple of the Dead: "if a player has one or fewer cards in hand".
      if (cond.any) return livePlayers(g).some((p) => (cond.any === 'player' || p !== controller) && cmp(zoneList(g, 'hand', p).length, cond));
      // Ghirapur Orrery: "if that player has no cards in hand".
      const whose = cond.who ? (refPlayers(ctx, cond.who as Ref)[0] ?? controller) : controller;
      const mine = zoneList(g, 'hand', whose).length;
      if (cond.than) {
        // "more cards in hand than each opponent" / "than an opponent"
        const theirs = livePlayers(g).filter((p) => p !== controller).map((p) => zoneList(g, 'hand', p).length);
        const beats = (n: number) => (cond.op === 'gt' ? mine > n : mine < n);
        return cond.than === 'each_opponent' ? theirs.every(beats) : theirs.some(beats);
      }
      return cmp(mine, cond);
    }
    // Mechanized Production: "you control eight or more artifacts with the same name as one another"
    case 'same_name': {
      const counts = new Map<string, number>();
      for (const id of g.zones.battlefield) {
        const o = g.objects[id]!;
        if (o.controller !== controller || !matchesFilter(g, o, (cond.filter ?? {}) as ObjectFilter, { controller, source: source ?? null })) continue;
        const name = nameOf(g, o);
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      return Math.max(0, ...counts.values()) >= Number(cond.min ?? 1);
    }
    case 'graveyard': {
      // "an opponent has eight or more cards in their graveyard"
      if (cond.who === 'any_opponent') return livePlayers(g).some((p) => p !== controller && cmp(zoneList(g, 'graveyard', p).length, cond));
      // Visions of Beyond: "a graveyard has twenty or more cards in it".
      if (cond.who === 'any_player') return g.order.some((p) => cmp(zoneList(g, 'graveyard', p).length, cond));
      const cards = zoneList(g, 'graveyard', controller).map((id) => g.objects[id]!);
      // Delirium: "four or more card types among cards in your graveyard" (CR 300.1's card types).
      // Matzalantli: "four or more permanent types among cards in your graveyard" (CR 110.4).
      const permanentTypes = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'];
      if (cond.cardTypes) return cmp(new Set(cards.flatMap((o) => faceOf(g, o).types).filter((t) => !cond.permanentTypes || permanentTypes.includes(t))).size, cond);
      // Descend: "four or more permanent cards in your graveyard"
      if (cond.filter) return cmp(cards.filter((o) => matchesFilter(g, o, cond.filter as ObjectFilter, { controller, anyZone: true })).length, cond);
      return cmp(cards.length, cond);
    }
    case 'poison': {
      // Corrupted: "an opponent has three or more poison counters"
      const players = cond.who === 'any_opponent' ? livePlayers(g).filter((p) => p !== controller) : [controller];
      return players.some((p) => cmp(g.players[p]!.poison, cond));
    }
    case 'different_powers': {
      // Coven: "three or more creatures with different powers"
      const powers = g.zones.battlefield.map((id) => g.objects[id]!).filter((o) => o.controller === controller && chars(g, o).types.includes('Creature')).map((o) => power(g, o));
      return cmp(new Set(powers).size, cond);
    }
    case 'total_power': {
      // Formidable: "creatures you control have total power 8 or greater"
      const stat = cond.stat === 'toughness' ? toughness : power;
      const total = g.zones.battlefield.map((id) => g.objects[id]!).filter((o) => o.controller === controller && chars(g, o).types.includes('Creature')).reduce((n, o) => n + Math.max(0, stat(g, o)), 0);
      return cmp(total, cond);
    }
    case 'sacrificed_this_turn': {
      // Elanor Gardner: "if you sacrificed a Food this turn"; Havengul Laboratory: "three or more Clues".
      const f = (cond.filter ?? {}) as ObjectFilter;
      const n = (g.turnLog.sacrificedBy?.[controller] ?? []).filter((s) => (!f.types || f.types.some((t) => s.types.includes(t))) && (!f.subtypes || f.subtypes.some((t) => s.subtypes.includes(t)))).length;
      return cmp(n, cond);
    }
    case 'entered_this_turn':
      // Celebration: "two or more nonland permanents entered the battlefield under your control this turn"
      return cmp(enteredThisTurn(g, controller, (cond.filter ?? {}) as ObjectFilter), cond);
    case 'or':
      return (cond.any as ConditionNode[]).some((c) => evalCondition(c, ctx));
    // Field of the Dead: "you control seven or more lands with different names" (CR 201.2)
    // Guardian Project: "if it doesn't have the same name as another creature you control or a creature card in your
    // graveyard" (a face-down creature has no name, CR 708.2).
    case 'first_combat':
      return (g.turnLog.combatPhases ?? 0) <= 1;
    // Omnath, Locus of Creation: "if this is the first time this ability has resolved this turn" — counting this resolution
    // (and copies of the ability, which are the same ability). Rose Room Treasurer: "the first or second time" (max).
    case 'ability_resolutions': {
      const n = g.resolving?.abilityCount ?? 0;
      return cond.max !== undefined ? n <= (cond.max as number) : n === (cond.n as number);
    }
    // Padeem: "if you control the artifact with the greatest mana value or tied for the greatest mana value"
    case 'greatest_power': {
      // "the creature with the greatest power or tied for the greatest power"
      const all = g.zones.battlefield.map((id) => g.objects[id]!).filter((o) => matchesFilter(g, o, cond.filter as ObjectFilter, { controller, source: source ?? null }));
      if (!all.length) return false;
      const stat = (o: GameObject) => (cond.stat === 'toughness' ? toughness(g, o) : power(g, o));
      const most = Math.max(...all.map(stat));
      return all.some((o) => o.controller === controller && stat(o) === most);
    }
    case 'greatest_mv': {
      const all = g.zones.battlefield.map((id) => g.objects[id]!).filter((o) => matchesFilter(g, o, cond.filter as ObjectFilter, { controller, source: source ?? null }));
      if (!all.length) return false;
      const most = Math.max(...all.map((o) => manaValueOf(g, o)));
      return all.some((o) => o.controller === controller && manaValueOf(g, o) === most);
    }
    case 'unique_name': {
      const [o] = refObjects(ctx, cond.of as Ref);
      if (!o) return false;
      const name = nameOf(g, o);
      const others = [
        ...g.zones.battlefield.map((id) => g.objects[id]!).filter((x) => x.id !== o.id && x.controller === controller && !x.faceDown && chars(g, x).types.includes('Creature')),
        ...zoneList(g, 'graveyard', controller).map((id) => g.objects[id]!).filter((x) => faceOf(g, x).types.includes('Creature')),
      ];
      return !others.some((x) => nameOf(g, x) === name);
    }
    case 'distinct_names': {
      const names = new Set(
        g.zones.battlefield
          .map((id) => g.objects[id]!)
          .filter((o) => o.controller === controller && !o.faceDown && matchesFilter(g, o, cond.filter as ObjectFilter, { controller, source: source ?? null }))
          .map((o) => nameOf(g, o)),
      );
      return cmp(names.size, cond);
    }
    // Starting Town: "it's your first, second, or third turn of the game"
    case 'early_turn':
      return g.active === ctx.controller && (g.players[ctx.controller]!.turnsBegun ?? 0) <= Number(cond.max);
    // "~ can't attack or block unless you control seven or more lands"
    case 'not':
      return !evalCondition(cond.cond as ConditionNode, ctx);
    case 'this_turn': {
      const log = g.turnLog;
      switch (cond.event) {
        case 'creature_died':
          return log.creatureDied;
        case 'opponent_damaged':
          return (log.damagedPlayers ?? []).some((p) => p !== controller);
        case 'you_attacked':
          return log.attacked.includes(controller);
        case 'you_gained_life':
          return log.gainedLife.includes(controller);
        case 'you_activated_loyalty':
          return Boolean(log.loyaltyActivated?.includes(controller));
        case 'opponent_gained_life':
          return log.gainedLife.some((p) => p !== controller);
        case 'you_created_token':
          return (log.createdToken ?? []).includes(controller);
        case 'opponent_cast':
          // "If an opponent cast a blue spell this turn" — any one opponent.
          return livePlayers(g).some(
            (p) =>
              p !== controller &&
              (log.castSpells ?? []).filter((c) => c.player === p && g.objects[c.id] && (!cond.filter || matchesFilter(g, g.objects[c.id]!, cond.filter as ObjectFilter, { controller, source: source ?? null, anyZone: true }))).length >= Number(cond.min ?? 1),
          );
        case 'opponent_drew':
          return Object.entries(log.drawn ?? {}).some(([p, n]) => p !== controller && n >= Number(cond.min ?? 1));
        case 'opponent_lost_life':
          return log.lostLife.some((p) => p !== controller);
        case 'you_cast_noncreature':
          return log.noncreatureCast.includes(controller);
        case 'you_cast_spell':
          // Surge (CR 702.117a): "if you … have cast another spell this turn".
          return (log.spellsCast[controller] ?? 0) > 0;
        // Lyse Hext: "if you've cast two or more noncreature spells this turn"
        case 'you_cast':
          return (log.castSpells ?? []).filter((c) => c.player === controller && g.objects[c.id] && (!cond.filter || matchesFilter(g, g.objects[c.id]!, cond.filter as ObjectFilter, { controller, source: source ?? null, anyZone: true }))).length >= Number(cond.min ?? 1);
        case 'you_lost_life':
          return log.lostLife.includes(controller);
        case 'you_played_land':
          return (g.players[controller]?.landsPlayedThisTurn ?? 0) > 0;
        // Sentinel Sarah Lyons: "an artifact entered the battlefield under your control this turn"
        case 'entered_yours':
          return (log.entered?.[controller] ?? []).some((id) => {
            const o = g.objects[id];
            const types = (cond.filter as ObjectFilter | undefined)?.types ?? [];
            if (!o) return false;
            const have = o.zone === 'battlefield' ? chars(g, o).types : faceOf(g, o).types;
            return !types.length || types.some((t) => have.includes(t));
          });
        case 'your_permanent_left':
          // Revolt: "if a permanent you controlled left the battlefield this turn"
          return (log.left ?? []).includes(controller);
        case 'nonland_left':
          return Boolean(log.nonlandLeft);
        case 'warped':
          return Boolean(log.warped);
        case 'you_committed_crime':
          return (log.crimes ?? []).includes(controller);
        // CR 700.11
        case 'you_descended':
          return (log.descended?.[controller] ?? 0) > 0;
        // Denethor: "if a creature died under your control this turn"
        case 'your_creature_died':
          return (log.died ?? []).some((d) => d.controller === controller && d.types.includes('Creature'));
        default:
          return false;
      }
    }
    case 'spells_last_turn': {
      const counts = Object.values(g.lastTurnSpells);
      if (cond.max !== undefined) return counts.reduce((a, b) => a + b, 0) <= Number(cond.max);
      return counts.some((n) => n >= Number(cond.perPlayerMin));
    }
    case 'counters': {
      // "if it had no -1/-1 counters on it" asks about the object as it last existed on the battlefield (CR 603.10a).
      const of = cond.of as { ref: string };
      const lki = of.ref === 'trigger_object' ? ctx.trigger?.lki : undefined;
      const counters = lki?.counters ?? refObjects(ctx, cond.of as never)[0]?.counters ?? {};
      // No kind named: "a counter on it" — any kind.
      const n = cond.counter === undefined ? Object.values(counters).reduce((a, b) => a + b, 0) : (counters[String(cond.counter)] ?? 0);
      return cmp(n, cond);
    }
    case 'is': {
      // "~ is attacking", "enchanted creature is blue", "equipped creature is a Human".
      const [o] = refObjects(ctx, cond.of as never);
      // "Counter target spell if it's blue": the object wherever it is.
      // "if its toughness was less than 1": as it last existed on the battlefield — a token that died has ceased to
      // exist (CR 704.5d), so only what was remembered of it.
      if (!o && cond.was && (cond.of as Ref).ref === 'trigger_object' && ctx.trigger?.object) {
        const lk = g.lastKnown?.[ctx.trigger.object.id];
        const f = cond.filter as ObjectFilter;
        const ok = (v: number, c?: { op: string; n: unknown }) => !c || (c.op === 'lt' ? v < Number(c.n) : c.op === 'gt' ? v > Number(c.n) : c.op === 'le' ? v <= Number(c.n) : c.op === 'ge' ? v >= Number(c.n) : v === Number(c.n));
        return Boolean(lk && Object.keys(f).every((k) => k === 'power' || k === 'toughness') && ok(lk.power, f.power) && ok(lk.toughness, f.toughness));
      }
      return Boolean(o && matchesFilter(g, o, cond.filter as ObjectFilter, { controller, source: source ?? null, anyZone: o.zone !== 'battlefield', ...(cond.was ? { lookBack: true } : {}) }));
    }
    case 'has_attached': {
      // "~ is equipped" (CR 301.5) / "~ is enchanted" (CR 303.4): an Equipment or Aura is attached to it.
      if (!source || source.zone !== 'battlefield') return false;
      return g.zones.battlefield.some((id) => {
        const a = g.objects[id]!;
        return a.attachedTo?.id === source.id && a.attachedTo.zcc === source.zcc && faceOf(g, a).subtypes.includes(String(cond.subtype));
      });
    }
    case 'monstrous':
      // CR 701.37b
      return Boolean(source?.monstrous && source.zone === 'battlefield');
    case 'harnessed':
      // CR 702.186b: "∞ — [Ability]" — as long as this permanent is harnessed (CR 701.64b).
      return Boolean(source?.harnessed && source.zone === 'battlefield');
    case 'class_level': {
      // CR 716.2d: a permanent with no level is level 1.
      const level = source?.classLevel ?? 1;
      return cond.exactly !== undefined ? level === Number(cond.exactly) : level >= Number(cond.min ?? 1);
    }
    case 'monarch':
      // CR 725: "if you're the monarch" / "if there is no monarch".
      return cond.none ? !g.monarch : cond.opponent ? Boolean(g.monarch) && g.monarch !== controller : g.monarch === controller;
    case 'opponents':
      // CR 102.3: in multiplayer games, every other player is an opponent.
      return cmp(livePlayers(g).filter((p) => p !== controller).length, cond);
    case 'and':
      return (cond.all as ConditionNode[]).every((c) => evalCondition(c, ctx));
    default:
      return false;
  }
}

function recordEnteredAs(g: GameState, log: TurnLog, o: GameObject): void {
  const c = chars(g, o);
  (log.enteredAs ??= {})[o.id] = { types: [...c.types], subtypes: [...c.subtypes], supertypes: [...c.supertypes], ...(o.token ? { token: true as const } : {}) };
}

/**
 * How many permanents matching a filter entered the battlefield under a player's control this turn (celebration, Hobgoblin
 * Bandit Lord) — counting a token that has since left the battlefield as it was when it entered.
 */
export function enteredThisTurn(g: GameState, controller: PlayerId, f: ObjectFilter): number {
  const ids = g.turnLog.entered?.[controller] ?? [];
  return ids.filter((id) => {
    const o = g.objects[id];
    if (o) return matchesFilter(g, o, f, { controller, anyZone: true });
    const was = g.turnLog.enteredAs?.[id];
    const simple = Object.keys(f).every((k) => ['types', 'subtypes', 'supertypes', 'token', 'notTypes'].includes(k));
    if (!was || !simple) return false;
    return (
      (!f.types || f.types.some((t) => was.types.includes(t))) &&
      (!f.subtypes || f.subtypes.some((t) => was.subtypes.includes(t))) &&
      (!f.supertypes || f.supertypes.every((t) => was.supertypes.includes(t))) &&
      (!f.notTypes || !f.notTypes.some((t) => was.types.includes(t))) &&
      (f.token === undefined || Boolean(was.token) === Boolean(f.token))
    );
  }).length;
}
