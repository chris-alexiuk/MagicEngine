import type { ConditionNode, ContinuousEffectNode, ObjectFilter, PlayerRule, PlayerRuleNode, StaticAbility } from '@mtg/schema';
import { splitQualities } from '@mtg/schema';
import { evalCondition } from './conditions.js';
import { bindQualityKeywords, matchesFilter, objectAbilities, sourceHasQuality, staticConditionHolds } from './characteristics.js';
import type { GameObject, GameState, PlayerId } from './types.js';
import { faceOf, abilitySources } from './zones.js';

/** Whom a player rule applies to, from its source's point of view (Grievous Wound: "Enchanted player can't gain life"). */
function rulesFor(who: string, source: GameObject, player: PlayerId): boolean {
  if (who === 'each') return true;
  if (who === 'enchanted') return source.attachedToPlayer === player;
  return who === 'you' ? player === source.controller : player !== source.controller;
}

/**
 * Static abilities that change the rules for players rather than objects:
 * "You have no maximum hand size" (CR 402.2), "You may play an additional land on each
 * of your turns" (CR 305.2), "Skip your draw step" (CR 614.10).
 * Returns how many apply to `player` (for extra lands, the total number of extra lands).
 */
/**
 * CR 702.8a: whether this player may cast this card as though it had flash — "You may cast spells as though they had
 * flash", or only some ("You may cast Aura and Equipment spells as though they had flash", Sigarda's Aid).
 */
export function flashPermission(g: GameState, player: PlayerId, card: GameObject): boolean {
  // Bard's Company: "You may cast this spell as though it had flash if you control a Human." (its own ability, CR 113.6e)
  for (const a of faceOf(g, card).abilities) {
    if (a.kind !== 'static' || a.effect.type !== 'flash_if') continue;
    const e = a.effect as unknown as { condition?: ConditionNode; ifTargets?: unknown };
    if (!e.ifTargets && e.condition && evalCondition(e.condition, { g, controller: player, source: card, events: [], targets: [], x: 0, memo: {} })) return true;
  }
  // Quicken: "The next sorcery spell you cast this turn can be cast as though it had flash."
  for (const n of g.nextSpell ?? []) {
    if (n.flash && n.player === player && n.turn === g.turn && matchesFilter(g, card, n.filter, { controller: player, anyZone: true })) return true;
  }
  for (const e of g.playerEffects ?? []) {
    if (e.player !== player || e.rule !== 'flash' || e.lastTurn < g.turn) continue;
    if (!e.filter || matchesFilter(g, card, e.filter, { controller: player, anyZone: true })) return true;
  }
  for (const id of abilitySources(g)) {
    const source = g.objects[id]!;
    for (const a of objectAbilities(g, source)) {
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'player_rule') continue;
      const e = (a as StaticAbility).effect as PlayerRuleNode;
      if (e.rule !== 'flash') continue;
      const applies = rulesFor(e.who, source, player);
      if (!applies || !staticConditionHolds(g, e, source)) continue;
      if (!e.filter || matchesFilter(g, card, e.filter, { controller: player, source, anyZone: true })) return true;
    }
  }
  return false;
}

/**
 * CR 609.4b: whether this player may spend mana as though it were mana of any color on this payment — "You may spend
 * mana as though it were mana of any color" (Chromatic Orrery), or only to cast some spells (Oath of Nissa).
 */
export function spendAnyColor(g: GameState, player: PlayerId, spell?: GameObject): boolean {
  for (const id of abilitySources(g)) {
    const source = g.objects[id]!;
    for (const a of objectAbilities(g, source)) {
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'player_rule') continue;
      const e = (a as StaticAbility).effect as PlayerRuleNode;
      if (e.rule !== 'spend_any_color') continue;
      const applies = rulesFor(e.who, source, player);
      if (!applies || !staticConditionHolds(g, e, source)) continue;
      if (!e.filter || (spell && matchesFilter(g, spell, e.filter, { controller: player, source, anyZone: true }))) return true;
    }
  }
  return false;
}

/** CR 500.5: the colors of unspent mana this player doesn't lose as steps and phases end ("red mana"; all of it). */
export function keptManaColors(g: GameState, player: PlayerId): Set<string> {
  const out = new Set<string>();
  for (const id of abilitySources(g)) {
    const source = g.objects[id]!;
    for (const a of objectAbilities(g, source)) {
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'player_rule') continue;
      const e = (a as StaticAbility).effect as PlayerRuleNode & { colors?: string[] };
      if (e.rule !== 'keep_mana') continue;
      const applies = rulesFor(e.who, source, player);
      if (!applies || !staticConditionHolds(g, e, source)) continue;
      for (const c of e.colors ?? ['W', 'U', 'B', 'R', 'G', 'C']) out.add(c);
    }
  }
  return out;
}

/** CR 614.1a: Kruphix: "If you would lose unspent mana, that mana becomes colorless instead." — the color it becomes. */
export function manaBecomes(g: GameState, player: PlayerId): string | undefined {
  for (const id of abilitySources(g)) {
    const source = g.objects[id]!;
    for (const a of objectAbilities(g, source)) {
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'player_rule') continue;
      const e = (a as StaticAbility).effect as PlayerRuleNode & { colors?: string[] };
      if (e.rule !== 'mana_becomes' || !rulesFor(e.who, source, player) || !staticConditionHolds(g, e, source)) continue;
      return e.colors?.[0];
    }
  }
  return undefined;
}

export function playerRule(g: GameState, player: PlayerId, rule: PlayerRule): number {
  let n = 0;
  // "Until your next turn, … you gain protection from everything" — from an effect, not a static ability.
  for (const e of g.playerEffects ?? []) if (e.player === player && e.rule === rule && e.lastTurn >= g.turn && !e.filter) n++;
  for (const id of abilitySources(g)) {
    const source = g.objects[id]!;
    for (const a of objectAbilities(g, source)) {
      // Shalai: "You, planeswalkers you control, and other creatures you control have hexproof."
      if (a.kind === 'static' && a.effect.type === 'continuous') {
        const c = a.effect as ContinuousEffectNode;
        if (c.alsoPlayer === rule && player === source.controller && staticConditionHolds(g, c, source)) n++;
        continue;
      }
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'player_rule') continue;
      const e = (a as StaticAbility).effect as PlayerRuleNode;
      // A rule for some spells only ("Aura and Equipment spells … flash") is checked per spell (flashPermission).
      if (e.rule !== rule || e.filter) continue;
      const applies = rulesFor(e.who, source, player);
      if (!applies || !staticConditionHolds(g, e, source)) continue;
      n += e.amount ?? 1;
    }
  }
  return n;
}

/**
 * CR 502.3: Winter Orb: "Players can't untap more than one land during their untap steps." — the limits on this player's
 * untap step, the ones for some permanents first (so a narrower limit is chosen for before a broader one).
 */
export function untapLimits(g: GameState, player: PlayerId): { n: number; filter?: ObjectFilter; source: GameObject }[] {
  const out: { n: number; filter?: ObjectFilter; source: GameObject }[] = [];
  for (const id of abilitySources(g)) {
    const source = g.objects[id]!;
    for (const a of objectAbilities(g, source)) {
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'player_rule') continue;
      const e = (a as StaticAbility).effect as PlayerRuleNode;
      if (e.rule !== 'untap_limit' || !rulesFor(e.who, source, player) || !staticConditionHolds(g, e, source)) continue;
      out.push({ n: e.amount ?? 1, ...(e.filter ? { filter: e.filter } : {}), source });
    }
  }
  return out.sort((a, b) => (a.filter ? 0 : 1) - (b.filter ? 0 : 1) || a.n - b.n);
}

/**
 * Whether a rule lets this player do something with this card: a rule for every card, or one for cards like it
 * (Titania, Nature's Force: "You may play Forests from your graveyard").
 */
export function ruleAllows(g: GameState, player: PlayerId, rule: PlayerRule, card: GameObject): boolean {
  if (playerRule(g, player, rule) > 0) return true;
  for (const id of abilitySources(g)) {
    const source = g.objects[id]!;
    for (const a of objectAbilities(g, source)) {
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'player_rule') continue;
      const e = (a as StaticAbility).effect as PlayerRuleNode;
      if (e.rule !== rule || !e.filter || e.oncePerTurn || !rulesFor(e.who, source, player) || !staticConditionHolds(g, e, source)) continue;
      if (matchesFilter(g, card, e.filter, { controller: player, source, anyZone: true })) return true;
    }
  }
  return false;
}

/**
 * Darksteel Monolith, As Foretold: "Once each turn, you may pay {0} rather than pay the mana cost for a … spell you cast" —
 * the permission this card could use now (its source's id and zone-change count), if one hasn't been used this turn.
 */
export function onceFreeCastKey(g: GameState, player: PlayerId, card: GameObject): string | null {
  for (const id of abilitySources(g)) {
    const source = g.objects[id]!;
    for (const a of objectAbilities(g, source)) {
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'player_rule') continue;
      const e = (a as StaticAbility).effect as PlayerRuleNode;
      if (e.rule !== 'free_cast' || !e.oncePerTurn || !rulesFor(e.who, source, player) || !staticConditionHolds(g, e, source)) continue;
      const key = `${source.id}:${source.zcc}`;
      if ((g.turnLog.freeOnce ?? []).includes(key)) continue;
      if (e.fromZone && card.zone !== e.fromZone) continue;
      if (!e.filter || matchesFilter(g, card, e.filter, { controller: player, source, anyZone: true })) return key;
    }
  }
  return null;
}

/**
 * CR 402.2: a player's maximum hand size — seven, changed by static abilities in timestamp order ("Your maximum hand
 * size is twenty", "Each opponent's maximum hand size is reduced by seven"); null when they have none.
 */
export function maxHandSize(g: GameState, player: PlayerId): number | null {
  if (playerRule(g, player, 'no_max_hand_size')) return null;
  const changes: { t: number; set?: number; delta?: number }[] = [];
  for (const id of abilitySources(g)) {
    const source = g.objects[id]!;
    for (const a of objectAbilities(g, source)) {
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'player_rule') continue;
      const e = (a as StaticAbility).effect as PlayerRuleNode;
      if (e.rule !== 'max_hand_size' && e.rule !== 'hand_size_delta') continue;
      const applies = rulesFor(e.who, source, player);
      if (!applies || !staticConditionHolds(g, e, source)) continue;
      changes.push({ t: source.timestamp, ...(e.rule === 'max_hand_size' ? { set: e.amount ?? 7 } : { delta: e.amount ?? 0 }) });
    }
  }
  for (const e of g.playerEffects ?? []) {
    if (e.player === player && e.rule === 'hand_size_delta' && e.lastTurn >= g.turn) changes.push({ t: e.timestamp ?? 0, delta: e.amount ?? 0 });
  }
  let n = g.config.maxHandSize;
  for (const c of changes.sort((a, b) => a.t - b.t)) n = c.set !== undefined ? c.set : n + (c.delta ?? 0);
  return Math.max(0, n);
}

/** CR 704.5j: 'The "legend rule" doesn't apply to permanents you control' (Mirror Box) — for this permanent. */
export function legendRuleExempt(g: GameState, o: GameObject): boolean {
  for (const id of abilitySources(g)) {
    const source = g.objects[id]!;
    for (const a of objectAbilities(g, source)) {
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'player_rule') continue;
      const e = (a as StaticAbility).effect as PlayerRuleNode;
      if (e.rule !== 'no_legend_rule') continue;
      const applies = rulesFor(e.who, source, o.controller);
      if (!applies || !staticConditionHolds(g, e, source)) continue;
      if (!e.filter || matchesFilter(g, o, e.filter, { controller: source.controller, source })) return true;
    }
  }
  return false;
}

/** CR 305.2: one land a turn, plus any extra land plays. */
export function landsAllowed(g: GameState, player: PlayerId): number {
  const extra = g.players[player]?.extraLands;
  return 1 + playerRule(g, player, 'extra_lands') + (extra?.turn === g.turn ? extra.n : 0);
}

/**
 * CR 702.16b–e: whether a player has protection from `source` — protection from everything (Teferi's Protection), or
 * from a quality: Serra's Emissary's "You and creatures you control have protection from the chosen card type",
 * Absolute Virtue's "You have protection from each of your opponents".
 */
export function playerProtectedFrom(g: GameState, player: PlayerId, source: GameObject): boolean {
  if (playerRule(g, player, 'protection_everything')) return true;
  for (const id of abilitySources(g)) {
    const holder = g.objects[id]!;
    for (const a of objectAbilities(g, holder)) {
      if (a.kind !== 'static') continue;
      const e = (a as StaticAbility).effect;
      let text: string | undefined;
      if (e.type === 'continuous') {
        const c = e as ContinuousEffectNode;
        if (c.alsoPlayer !== 'protection' || player !== holder.controller || !staticConditionHolds(g, c, holder)) continue;
        const bound = bindQualityKeywords((c.keywords ?? []).filter((k) => k.id === 'protection'), { you: holder.controller, grantedBy: holder.id, ...(holder.chosen?.color ? { color: holder.chosen.color } : {}), ...(holder.chosen?.creatureType ? { creatureType: holder.chosen.creatureType } : {}), ...(holder.chosen?.cardType ? { chosenCardType: holder.chosen.cardType } : {}) });
        text = bound.map((k) => k.text).filter(Boolean).join(' and from ');
      } else if (e.type === 'player_rule') {
        const r = e as PlayerRuleNode;
        if (r.rule !== 'protection' || !r.quality || !rulesFor(r.who, holder, player) || !staticConditionHolds(g, r, holder)) continue;
        text = r.quality;
      }
      if (text && splitQualities(text).some((q) => sourceHasQuality(g, holder, source, q, player))) return true;
    }
  }
  return false;
}
