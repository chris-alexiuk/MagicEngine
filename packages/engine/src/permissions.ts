import type { ObjectFilter } from '@mtg/schema';
import { matchesFilter, objectAbilities } from './characteristics.js';
import type { GameObject, GameState, PlayerId } from './types.js';
import { abilitySources } from './zones.js';

/**
 * Permissions to play cards from somewhere other than the hand ("Until the end of your next turn,
 * you may play that card"). CR 601.3 / CR 305.1: casting or playing from another zone needs an
 * effect that allows it. A permission ends with its duration, or when the card changes zones (CR 400.7).
 */
import { preparedSource } from './prepare.js';

export function mayPlayFrom(g: GameState, player: PlayerId, o: GameObject, what: 'land' | 'spell'): boolean {
  if (o.zone === 'library') return fromTop(g, player, o, what);
  return (g.mayPlay ?? []).some(
    (p) => p.player === player && p.object.id === o.id && p.object.zcc === o.zcc && p.lastTurn >= g.turn && (p.firstTurn ?? 0) <= g.turn && (what === 'spell' || p.mode === 'play'),
  );
}

/** Dauthi Voidwalker: a permission to play this card "without paying its mana cost". */
export function freePermission(g: GameState, player: PlayerId, o: GameObject): boolean {
  return (g.mayPlay ?? []).some((p) => p.free && p.player === player && p.object.id === o.id && p.object.zcc === o.zcc && p.lastTurn >= g.turn && (p.firstTurn ?? 0) <= g.turn);
}

/** Airbend (CR 701.65a): a permission to cast this card by paying another cost rather than its mana cost. */
export function permissionCost(g: GameState, player: PlayerId, o: GameObject): string | undefined {
  return (g.mayPlay ?? []).find((p) => p.cost !== undefined && p.player === player && p.object.id === o.id && p.object.zcc === o.zcc && p.lastTurn >= g.turn && (p.firstTurn ?? 0) <= g.turn)?.cost;
}

/**
 * "You may play lands from the top of your library", "You may cast creature spells from the top of your library":
 * the top card, from a static ability of a permanent the player controls.
 */
function fromTop(g: GameState, player: PlayerId, o: GameObject, what: 'land' | 'spell'): boolean {
  const lib = g.zones.library[player] ?? [];
  if (o.owner !== player || lib[0] !== o.id) return false;
  for (const id of abilitySources(g)) {
    const src = g.objects[id];
    if (!src || src.zone !== 'battlefield' || src.controller !== player) continue;
    for (const a of objectAbilities(g, src)) {
      if (a.kind !== 'static' || a.effect.type !== 'top_permission') continue;
      if (what === 'land' && a.effect.lands) return true;
      const spells = a.effect.spells as ObjectFilter | undefined;
      if (what === 'spell' && spells && matchesFilter(g, o, spells, { controller: player, source: src, anyZone: true })) return true;
    }
  }
  return false;
}

/**
 * Bolas's Citadel: "If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost." —
 * true when the only permissions that let this player cast the top card are ones like that (CR 118.9).
 */
export function topLifeOnly(g: GameState, player: PlayerId, o: GameObject): boolean {
  const lib = g.zones.library[player] ?? [];
  if (o.zone !== 'library' || o.owner !== player || lib[0] !== o.id) return false;
  let life = false;
  for (const id of abilitySources(g)) {
    const src = g.objects[id];
    if (!src || src.zone !== 'battlefield' || src.controller !== player) continue;
    for (const a of objectAbilities(g, src)) {
      if (a.kind !== 'static' || a.effect.type !== 'top_permission') continue;
      const spells = a.effect.spells as ObjectFilter | undefined;
      if (!spells || !matchesFilter(g, o, spells, { controller: player, source: src, anyZone: true })) continue;
      if (!a.effect.lifeCost) return false;
      life = true;
    }
  }
  return life;
}

/** The top card of a player's library, if they may play it now. */
export function playableFromTop(g: GameState, player: PlayerId): string[] {
  const top = g.zones.library[player]?.[0];
  const o = top ? g.objects[top] : undefined;
  return o && (fromTop(g, player, o, 'land') || fromTop(g, player, o, 'spell')) ? [o.id] : [];
}

/** Cards in exile a player may play right now. */
export function playableFromExile(g: GameState, player: PlayerId): string[] {
  return g.zones.exile.filter((id) => {
    const o = g.objects[id]!;
    // CR 722.3c: a prepared permanent's spell copy.
    if (o.prepareOf) return Boolean(preparedSource(g, o, player));
    return mayPlayFrom(g, player, o, 'spell') || mayPlayFrom(g, player, o, 'land');
  });
}

/** Cards in graveyards a player may play right now ("Choose target artifact card in your graveyard. You may cast that card this turn."). */
export function playableFromGraveyard(g: GameState, player: PlayerId): string[] {
  return [...new Set((g.mayPlay ?? []).filter((p) => p.player === player).map((p) => p.object.id))].filter((id) => {
    const o = g.objects[id];
    return o?.zone === 'graveyard' && (mayPlayFrom(g, player, o, 'spell') || mayPlayFrom(g, player, o, 'land'));
  });
}

/** Drops permissions that have run out or whose card has moved. */
export function prunePermissions(g: GameState): void {
  if (!g.mayPlay?.length) return;
  g.mayPlay = g.mayPlay.filter((p) => p.lastTurn >= g.turn && g.objects[p.object.id]?.zcc === p.object.zcc);
}
