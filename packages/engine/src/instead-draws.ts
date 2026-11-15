/**
 * The replacement effects on a player drawing a card (CR 614.1a): each sort is a rule here, and `drawCard` (zones.ts)
 * puts every draw to them through instead.ts. (Dredge is asked before the draw: dredge.ts.)
 *
 * CR 616.1: the player who would draw orders them. Nobody is asked — it is the order that serves that player best:
 * winning the game before anything else, then the most cards for themself, then the fewest for whoever draws in
 * their place.
 */
import type { Draw, Replacement, Rules } from './instead.js';
import { says, statics } from './instead-moves.js';
import type { PlayerId } from './types.js';
import { zoneList } from './zones.js';

export const DRAW_RULES: Rules<Draw> = {
  /**
   * Notion Thief: "If an opponent would draw a card except the first one they draw in each of their draw steps, instead
   * that player skips that draw and you draw a card."
   */
  stolen(g, h) {
    if (h.first || h.wins) return [];
    const out: Replacement<Draw>[] = [];
    for (const s of statics(g, 'draw_replacement')) {
      const thief = s.source.controller;
      if (!s.node.steal || thief === h.player || g.players[thief]?.lost) continue;
      out.push({ key: s.key, label: says(g, s.source, s.text), apply: (d) => ({ ...d, player: thief, first: false }) });
    }
    return out;
  },

  /**
   * Thought Reflection: "If you would draw a card, draw two cards instead."; Alhammarret's Archive: "… except the first
   * one you draw in each of your draw steps"; Phial of Galadriel: "… while you have no cards in hand" (its condition).
   */
  doubled(g, h) {
    if (h.wins) return [];
    const out: Replacement<Draw>[] = [];
    for (const s of statics(g, 'draw_replacement')) {
      const e = s.node;
      if (e.emptyWin || e.steal || s.source.controller !== h.player) continue;
      if (e.exceptFirst && h.first) continue;
      out.push({ key: s.key, label: says(g, s.source, s.text), apply: (d) => ({ ...d, n: d.n * 2 }) });
    }
    return out;
  },

  /** Laboratory Maniac: "If you would draw a card while your library has no cards in it, you win the game instead." */
  wins(g, h) {
    if (h.wins || zoneList(g, 'library', h.player).length > 0) return [];
    const out: Replacement<Draw>[] = [];
    for (const s of statics(g, 'draw_replacement')) {
      if (s.node.emptyWin && s.source.controller === h.player) out.push({ key: s.key, label: says(g, s.source, s.text), apply: (d) => ({ ...d, n: 0, wins: true }) });
    }
    return out;
  },
};

/** Which of two outcomes the player who was to draw likes better (CR 616.1: theirs is the choice of order). */
export function drawerPrefers(player: PlayerId): (a: Draw | null, b: Draw | null) => number {
  const worth = (d: Draw | null): number => (!d ? 0 : d.wins && d.player === player ? Infinity : d.player === player ? d.n : -d.n);
  return (a, b) => {
    const x = worth(a);
    const y = worth(b);
    return x === y ? 0 : x > y ? 1 : -1;
  };
}
