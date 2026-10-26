import type { GameObject, GameState, PlayerId } from './types.js';

/**
 * Permissions to play cards from somewhere other than the hand ("Until the end of your next turn,
 * you may play that card"). CR 601.3 / CR 305.1: casting or playing from another zone needs an
 * effect that allows it. A permission ends with its duration, or when the card changes zones (CR 400.7).
 */
export function mayPlayFrom(g: GameState, player: PlayerId, o: GameObject, what: 'land' | 'spell'): boolean {
  return (g.mayPlay ?? []).some(
    (p) => p.player === player && p.object.id === o.id && p.object.zcc === o.zcc && p.lastTurn >= g.turn && (what === 'spell' || p.mode === 'play'),
  );
}

/** Cards in exile a player may play right now. */
export function playableFromExile(g: GameState, player: PlayerId): string[] {
  return g.zones.exile.filter((id) => {
    const o = g.objects[id]!;
    return mayPlayFrom(g, player, o, 'spell') || mayPlayFrom(g, player, o, 'land');
  });
}

/** Drops permissions that have run out or whose card has moved. */
export function prunePermissions(g: GameState): void {
  if (!g.mayPlay?.length) return;
  g.mayPlay = g.mayPlay.filter((p) => p.lastTurn >= g.turn && g.objects[p.object.id]?.zcc === p.object.zcc);
}
