/**
 * The replacement effects on a permanent about to be destroyed (CR 701.8, 614.1a): each sort is a rule here, and
 * `destroy` (permanents.ts) puts every destruction to them through instead.ts.
 *
 *   shield_counter   CR 122.1c: "… instead remove a shield counter from it"
 *   regenerated      CR 701.19a: a regeneration shield — "instead remove all damage marked on it and tap it"
 *   umbra_armor      CR 702.89a: "… instead remove all damage marked on it and destroy this Aura" — one for each Aura
 *
 * Each of them is all that happens instead: once one has applied, the permanent isn't about to be destroyed, and the
 * others have nothing to replace. So where several apply, its controller chooses which (CR 616.1), and is asked — a
 * shield counter or a regeneration shield that is gone at end of turn anyway, this Umbra or that one.
 *
 * A permanent with indestructible can't be destroyed (CR 702.12b), so nothing replaces that: it isn't put to these.
 */
import { chars } from './characteristics.js';
import type { Destroy, Replacement, Rules } from './instead.js';
import { destroy, removeFromCombat, removeShield } from './permanents.js';
import type { GameEvent, GameObject, GameState } from './types.js';
import { faceOf, nameOf, setTapped } from './zones.js';

/** The destruction, replaced: what is done instead. */
const saved = (h: Destroy, by: string, run: (g: GameState, o: GameObject, events: GameEvent[]) => void): Destroy => ({ ...h, saved: by, also: [...h.also, { key: by, run }] });

export const DESTROY_RULES: Rules<Destroy> = {
  /** CR 122.1c: "If a permanent with a shield counter on it would be dealt damage or destroyed, instead remove a shield counter from it." */
  shield_counter(_g, h) {
    const o = h.object;
    if (h.saved || (o.counters.shield ?? 0) <= 0) return [];
    return [{ key: `shield_counter:${o.id}`, label: 'Its shield counter: remove it instead', apply: (d) => saved(d, 'shield', (_game, it, events) => void removeShield(it, events)) }];
  },

  /**
   * CR 701.19a: "The next time that permanent would be destroyed this turn, instead remove all damage marked on it and
   * its controller taps it. If it's an attacking or blocking creature, remove it from combat." CR 701.19c: not if it
   * can't be regenerated.
   */
  regenerated(g, h) {
    const o = h.object;
    if (h.saved || h.noRegen || (o.regenShields ?? 0) <= 0 || chars(g, o).rules.has('cant_be_regenerated')) return [];
    return [
      {
        key: `regenerated:${o.id}`,
        label: 'Regeneration: remove all damage from it and tap it instead',
        apply: (d) =>
          saved(d, 'regenerated', (game, it, events) => {
            it.regenShields = (it.regenShields ?? 1) - 1;
            it.damage = 0;
            delete it.deathtouched;
            setTapped(game, it.id, true, events);
            removeFromCombat(game, it.id);
            events.push({ type: 'regenerated', object: it.id });
          }),
      },
    ];
  },

  /**
   * CR 702.89a: umbra armor — "If enchanted permanent would be destroyed, instead remove all damage marked on it and
   * destroy this Aura." With two such Auras on it, one of them.
   */
  umbra_armor(g, h) {
    const o = h.object;
    if (h.saved) return [];
    const out: Replacement<Destroy>[] = [];
    for (const id of g.zones.battlefield) {
      const aura = g.objects[id]!;
      if (aura.attachedTo?.id !== o.id || aura.attachedTo.zcc !== o.zcc || !faceOf(g, aura).keywords.some((k) => k.id === 'umbra_armor' || k.id === 'totem_armor')) continue;
      out.push({
        key: `umbra_armor:${aura.id}:${aura.zcc}`,
        label: `${nameOf(g, aura)}: umbra armor — remove all damage from it and destroy this Aura instead`,
        apply: (d) =>
          saved(d, `umbra:${aura.id}`, (game, it, events) => {
            it.damage = 0;
            delete it.deathtouched;
            destroy(game, aura, events);
          }),
      });
    }
    return out;
  },
};

/** What is about to happen to the permanent, for its controller choosing between the effects on it. */
export function destroyQuestion(g: GameState, h: Destroy): { text: string; sourceName: string } {
  const name = h.object.faceDown ? 'A face-down permanent' : nameOf(g, h.object);
  return { text: `${name} would be destroyed, and more than one effect replaces that. Which applies?`, sourceName: name };
}
