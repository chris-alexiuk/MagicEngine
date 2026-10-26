import { planAutoTap } from './autotap.js';
import { canUseTapAbilities, manaAbilities } from './characteristics.js';
import { parseManaCost } from './mana.js';
import type { Action, GameState, PlayerId } from './types.js';
import { faceOf, zoneList } from './zones.js';

/**
 * Actions the player could take right now, for driving a UI. Casts are listed
 * when the cost can be met from the pool plus automatic tapping. Choices and
 * manual moves aren't listed; the pending choice and the UI cover those.
 */
export function legalActions(g: GameState, player: PlayerId): Action[] {
  if (g.over || g.pending || g.priority !== player) return [];
  const out: Action[] = [{ type: 'pass', player }];
  const mainPhaseEmptyStack = g.active === player && (g.step === 'main1' || g.step === 'main2') && g.stack.length === 0;

  for (const id of zoneList(g, 'hand', player)) {
    const o = g.objects[id]!;
    const def = g.cards[o.card]!;
    def.faces.forEach((face, faceIndex) => {
      if (faceIndex > 0 && !['split', 'modal_dfc', 'adventure'].includes(def.layout)) return;
      if (face.types.includes('Land')) {
        if (mainPhaseEmptyStack && g.players[player]!.landsPlayedThisTurn < 1 && (faceIndex === 0 || def.layout === 'modal_dfc')) {
          out.push({ type: 'play_land', player, object: id, ...(faceIndex ? { face: faceIndex } : {}) });
        }
        return;
      }
      const instantSpeed = face.types.includes('Instant') || face.keywords.some((k) => k.id === 'flash');
      if (!instantSpeed && !mainPhaseEmptyStack) return;
      const cost = parseManaCost(face.manaCost);
      if (cost.unsupported.length || cost.x > 0) return; // X spells need a value; the UI asks for one
      if (planAutoTap(g, player, cost)) {
        out.push({ type: 'cast', player, object: id, autoTap: true, ...(faceIndex ? { face: faceIndex } : {}) });
      }
    });
  }

  for (const id of g.zones.battlefield) {
    const o = g.objects[id]!;
    if (o.controller !== player) continue;
    manaAbilities(g, o).forEach((ab, ability) => {
      if (ab.cost.tap && (o.tapped || !canUseTapAbilities(g, o))) return;
      if (ab.cost.mana) return;
      out.push({ type: 'activate_mana', player, object: id, ability });
    });
    faceOf(g, o).unparsed.forEach((line, i) => {
      if (line.includes(': ')) out.push({ type: 'activate_manual', player, object: id, line: i, autoTap: true });
    });
  }
  return out;
}
