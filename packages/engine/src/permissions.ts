import type { Cost, EffectNode, ObjectFilter } from '@mtg/schema';
import { matchesFilter, objectAbilities, staticConditionHolds } from './characteristics.js';
import type { GameObject, GameState, PlayerId } from './types.js';
import { abilitySources, faceOf } from './zones.js';

/**
 * Permissions to play cards from somewhere other than the hand ("Until the end of your next turn,
 * you may play that card"). CR 601.3 / CR 305.1: casting or playing from another zone needs an
 * effect that allows it. A permission ends with its duration, or when the card changes zones (CR 400.7).
 */
import { preparedSource } from './prepare.js';

/**
 * A play permission's window: through `lastTurn` (from `firstTurn`); "until your next end step" ends as that end step
 * begins.
 */
export function permissionLive(g: GameState, p: { lastTurn: number; firstTurn?: number; untilEndStep?: true }): boolean {
  if (p.lastTurn < g.turn || (p.firstTurn ?? 0) > g.turn) return false;
  return !(p.untilEndStep && p.lastTurn === g.turn && (g.step === 'end' || g.step === 'cleanup'));
}

/**
 * Lurrus of the Dream-Den: "Once during each of your turns, you may cast a permanent spell with mana value 2 or less from
 * your graveyard."; Karador, Gisa and Geralf, Rivaz — a static permission of a permanent the player controls. The key of
 * the permission that allows casting this card (source id:zcc), or null.
 */
export function graveyardPermission(g: GameState, player: PlayerId, o: GameObject): string | null {
  if (o.zone !== 'graveyard' || o.owner !== player) return null;
  // Exploration Broodship: a permission with a cost of its own ("by sacrificing a land") is used only when no free one is.
  return graveyardPermissionPass(g, player, o, false) ?? graveyardPermissionPass(g, player, o, true);
}

/** Exploration Broodship: the costs a graveyard permission adds ("by sacrificing a land in addition to paying its other costs"). */
export function graveyardPermissionCosts(g: GameState, key: string | null): EffectNode[] {
  const [id, zcc] = (key ?? '').split(':');
  const src = id ? g.objects[id] : undefined;
  if (!src || String(src.zcc) !== zcc) return [];
  for (const a of objectAbilities(g, src)) {
    if (a.kind === 'static' && a.effect.type === 'graveyard_cast' && a.effect.cost) return ((a.effect.cost as Cost).other ?? []) as EffectNode[];
  }
  return [];
}

/** Kess, Dissident Mage: "If a spell cast this way would be put into your graveyard, exile it instead." */
export function graveyardPermissionExiles(g: GameState, key: string | null): boolean {
  const [id, zcc] = (key ?? '').split(':');
  const src = id ? g.objects[id] : undefined;
  if (!src || String(src.zcc) !== zcc) return false;
  return objectAbilities(g, src).some((a) => a.kind === 'static' && a.effect.type === 'graveyard_cast' && Boolean(a.effect.exileOnLeave));
}

function graveyardPermissionPass(g: GameState, player: PlayerId, o: GameObject, withCost: boolean): string | null {
  for (const id of abilitySources(g)) {
    const src = g.objects[id];
    if (!src || src.zone !== 'battlefield' || src.controller !== player) continue;
    for (const a of objectAbilities(g, src)) {
      if (a.kind !== 'static' || a.effect.type !== 'graveyard_cast') continue;
      if (Boolean(a.effect.cost) !== withCost) continue;
      if (!staticConditionHolds(g, a.effect as never, src)) continue;
      // Muldrotha, the Gravetide: "During each of your turns, you may … cast a permanent spell of each permanent type from
      // your graveyard." — one for each type this card has that hasn't been used (a creature last: it's the one most wanted).
      if (a.effect.eachType) {
        if (g.active !== player) continue;
        const types = faceOf(g, o).types;
        const slot = ['Artifact', 'Battle', 'Enchantment', 'Planeswalker', 'Creature'].find((t) => types.includes(t) && !(g.turnLog.graveyardCasts ?? []).includes(`${src.id}:${src.zcc}:${t}`));
        if (slot) return `${src.id}:${src.zcc}:${slot}`;
        continue;
      }
      const key = `${src.id}:${src.zcc}`;
      if (a.effect.oncePerTurn && (g.active !== player || (g.turnLog.graveyardCasts ?? []).includes(key))) continue;
      const filter = a.effect.filter as ObjectFilter | undefined;
      if (filter && !matchesFilter(g, o, filter, { controller: player, source: src, anyZone: true })) continue;
      return key;
    }
  }
  // Chainer, Nightmare Adept: "You may cast a creature spell from your graveyard this turn." — once.
  for (const grant of g.graveyardGrants ?? []) {
    if (grant.player !== player || grant.turn !== g.turn || (g.turnLog.graveyardCasts ?? []).includes(grant.key)) continue;
    if (matchesFilter(g, o, grant.filter, { controller: player, source: null, anyZone: true })) return grant.key;
  }
  return null;
}

/** Muldrotha, the Gravetide: "During each of your turns, you may play a land … from your graveyard." — once each turn. */
export function graveyardLandPermission(g: GameState, player: PlayerId, o: GameObject): string | null {
  if (o.zone !== 'graveyard' || o.owner !== player || g.active !== player || !faceOf(g, o).types.includes('Land')) return null;
  for (const id of abilitySources(g)) {
    const src = g.objects[id];
    if (!src || src.zone !== 'battlefield' || src.controller !== player) continue;
    for (const a of objectAbilities(g, src)) {
      if (a.kind !== 'static' || a.effect.type !== 'graveyard_cast' || !a.effect.lands) continue;
      const key = `${src.id}:${src.zcc}:Land`;
      if (!(g.turnLog.graveyardCasts ?? []).includes(key)) return key;
    }
  }
  return null;
}

/** Whether any permanent a player controls has a graveyard permission (most games: none). */
function hasGraveyardPermissions(g: GameState, player: PlayerId): boolean {
  if ((g.graveyardGrants ?? []).some((p) => p.player === player && p.turn === g.turn)) return true;
  return abilitySources(g).some((id) => {
    const src = g.objects[id];
    return src?.zone === 'battlefield' && src.controller === player && objectAbilities(g, src).some((a) => a.kind === 'static' && a.effect.type === 'graveyard_cast');
  });
}

/** A permission from an effect (g.mayPlay) to play this card. */
function effectPermission(g: GameState, player: PlayerId, o: GameObject, what: 'land' | 'spell'): boolean {
  return (g.mayPlay ?? []).some(
    (p) => p.player === player && p.object.id === o.id && p.object.zcc === o.zcc && permissionLive(g, p) && (what === 'spell' || p.mode === 'play'),
  );
}

/** The static graveyard permission a cast of this card uses — none when an effect lets it be cast anyway. */
export function graveyardPermissionUsed(g: GameState, player: PlayerId, o: GameObject): string | null {
  return o.zone === 'graveyard' && !effectPermission(g, player, o, 'spell') ? graveyardPermission(g, player, o) : null;
}

export function mayPlayFrom(g: GameState, player: PlayerId, o: GameObject, what: 'land' | 'spell'): boolean {
  if (o.zone === 'library') return fromTop(g, player, o, what);
  if (o.zone === 'graveyard' && what === 'spell' && graveyardPermission(g, player, o)) return true;
  // Misthollow Griffin: "You may cast this card from exile." — its own permission, its mana cost paid.
  if (o.zone === 'exile' && what === 'spell' && o.owner === player && !o.faceDown && castableFromExileItself(g, o)) return true;
  if (o.zone === 'exile' && o.exiledBy && exiledWithPermission(g, player, o, what)) return true;
  return (g.mayPlay ?? []).some(
    (p) => p.player === player && p.object.id === o.id && p.object.zcc === o.zcc && permissionLive(g, p) && (what === 'spell' || p.mode === 'play'),
  );
}

/**
 * Nightveil Specter: "You may play lands and cast spells from among cards exiled with this creature." — a static ability of
 * the permanent that exiled the card, for its controller (CR 607.2a: the cards exiled with that object, as that object).
 */
function exiledWithPermission(g: GameState, player: PlayerId, o: GameObject, what: 'land' | 'spell'): boolean {
  const src = g.objects[o.exiledBy!.id];
  if (!src || src.zone !== 'battlefield' || src.controller !== player) return false;
  return objectAbilities(g, src).some((a) => {
    if (a.kind !== 'static' || a.effect.type !== 'exile_play') return false;
    if (what === 'land' ? !a.effect.lands : !a.effect.spells) return false;
    return staticConditionHolds(g, a.effect as never, src) && matchesFilter(g, o, { zone: 'exile', exiledWithSource: true }, { controller: player, source: src, anyZone: true });
  });
}

function castableFromExileItself(g: GameState, o: GameObject): boolean {
  return (g.cards[o.card]?.faces[0]?.abilities ?? []).some((a) => {
    if (a.kind !== 'static' || a.effect.type !== 'cast_option') return false;
    const e = a.effect as { zone?: string; alsoExile?: true; withManaCost?: true; condition?: unknown };
    return Boolean(e.withManaCost && !e.condition && (e.zone === 'exile' || e.alsoExile));
  });
}

/** Dauthi Voidwalker: a permission to play this card "without paying its mana cost". */
export function freePermission(g: GameState, player: PlayerId, o: GameObject): boolean {
  return (g.mayPlay ?? []).some((p) => p.free && p.player === player && p.object.id === o.id && p.object.zcc === o.zcc && permissionLive(g, p));
}

/** CR 609.4b: "… and you may spend mana as though it were mana of any color to cast that spell" — on this card's permission. */
export function anyColorPermission(g: GameState, player: PlayerId, o: GameObject): false | 'color' | 'type' {
  const live = (g.mayPlay ?? []).filter((p) => p.anyColor && p.player === player && p.object.id === o.id && p.object.zcc === o.zcc && permissionLive(g, p));
  return live.some((p) => p.anyColor === 'type') ? 'type' : live.length ? 'color' : false;
}

/** Dire Fleet Daredevil: "If that spell would be put into a graveyard, exile it instead." — on the permission it was cast with. */
export function exileOnLeavePermission(g: GameState, player: PlayerId, o: GameObject): boolean {
  return (g.mayPlay ?? []).some((p) => p.exileOnLeave && p.player === player && p.object.id === o.id && p.object.zcc === o.zcc && permissionLive(g, p));
}

/** Airbend (CR 701.65a): a permission to cast this card by paying another cost rather than its mana cost. */
export function permissionCost(g: GameState, player: PlayerId, o: GameObject): string | undefined {
  return (g.mayPlay ?? []).find((p) => p.cost !== undefined && p.player === player && p.object.id === o.id && p.object.zcc === o.zcc && permissionLive(g, p))?.cost;
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
      // "As long as ~ is attached to a creature, …" (The Reality Chip).
      if (!staticConditionHolds(g, a.effect as never, src)) continue;
      // Crystal Skull: "You may play historic lands …" — only those.
      if (what === 'land' && a.effect.lands && (!a.effect.landFilter || matchesFilter(g, o, a.effect.landFilter as ObjectFilter, { controller: player, source: src, anyZone: true }))) return true;
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
      if (a.kind !== 'static' || a.effect.type !== 'top_permission' || !staticConditionHolds(g, a.effect as never, src)) continue;
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
  // Lurrus: cards a static ability lets this player cast from their graveyard.
  const statics = hasGraveyardPermissions(g, player) ? (g.zones.graveyard[player] ?? []).filter((id) => graveyardPermission(g, player, g.objects[id]!)) : [];
  return [...new Set([...(g.mayPlay ?? []).filter((p) => p.player === player).map((p) => p.object.id), ...statics])].filter((id) => {
    const o = g.objects[id];
    return o?.zone === 'graveyard' && (mayPlayFrom(g, player, o, 'spell') || mayPlayFrom(g, player, o, 'land'));
  });
}

/** Drops permissions that have run out or whose card has moved. */
export function prunePermissions(g: GameState): void {
  if (!g.mayPlay?.length) return;
  g.mayPlay = g.mayPlay.filter((p) => p.lastTurn >= g.turn && !(p.untilEndStep && p.lastTurn === g.turn && (g.step === 'end' || g.step === 'cleanup')) && g.objects[p.object.id]?.zcc === p.object.zcc);
}
