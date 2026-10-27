import type { CastProhibitionNode, FaceDef, ObjectFilter, StaticAbility } from '@mtg/schema';
import { matchesFilter, objectAbilities, staticConditionHolds } from './characteristics.js';
import type { GameObject, GameState, PlayerId } from './types.js';
import { abilitySources, nameOf } from './zones.js';

const COMBAT_STEPS = ['beginning_of_combat', 'declare_attackers', 'declare_blockers', 'combat_damage', 'end_of_combat'];

/** Who a "can't cast" static applies to, from its source's point of view. */
function bans(g: GameState, e: CastProhibitionNode, source: GameObject, player: PlayerId): boolean {
  switch (e.who) {
    case 'you':
      return player === source.controller;
    case 'opponents':
      return player !== source.controller;
    case 'each':
      return true;
    case 'enchanted_player':
      return source.attachedToPlayer === player;
    case 'enchanted_controller': {
      const to = source.attachedTo ? g.objects[source.attachedTo.id] : undefined;
      return Boolean(to && to.zcc === source.attachedTo!.zcc && to.controller === player);
    }
    default:
      return false;
  }
}

/**
 * CR 101.2: when a rule or effect allows something and another effect says it can't happen, the "can't" wins —
 * statics ("Your opponents can't cast spells during your turn") and effects that last a while ("Target player
 * can't cast spells this turn"). The reason the spell can't be cast, or null.
 */
export function castProhibition(g: GameState, player: PlayerId, face: FaceDef, spell: GameObject): string | null {
  const matches = (filter: ObjectFilter | undefined, controller: PlayerId, source: GameObject | null, o: GameObject = spell) =>
    !filter || matchesFilter(g, o, filter, { controller, source, anyZone: true });
  for (const ban of g.castBans ?? []) {
    if (ban.lastTurn < g.turn || !ban.players.includes(player)) continue;
    if (matches(ban.filter, ban.controller, null)) return `${face.name} can't be cast: ${g.players[player]?.name ?? player} can't cast ${ban.filter ? 'spells like it' : 'spells'} now.`;
  }
  for (const id of abilitySources(g)) {
    const source = g.objects[id]!;
    for (const a of objectAbilities(g, source)) {
      if (a.kind !== 'static' || (a as StaticAbility).effect.type !== 'cast_prohibition') continue;
      const e = (a as StaticAbility).effect as CastProhibitionNode;
      if (!bans(g, e, source, player) || !staticConditionHolds(g, e, source)) continue;
      if (e.during === 'your_turn' && g.active !== source.controller) continue;
      if (e.during === 'combat' && !COMBAT_STEPS.includes(g.step)) continue;
      if (e.fromZones && !(e.fromZones as string[]).includes(spell.zone)) continue;
      if (!matches(e.filter, source.controller, source)) continue;
      if (e.maxPerTurn !== undefined) {
        const cast = (g.turnLog.castSpells ?? []).filter((c) => c.player === player && g.objects[c.id] && matches(e.filter, source.controller, source, g.objects[c.id]!)).length;
        if (cast < e.maxPerTurn) continue;
      }
      return `${face.name} can't be cast (${nameOf(g, source)}).`;
    }
  }
  return null;
}
