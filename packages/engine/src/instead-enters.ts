/**
 * The replacement effects on how a permanent enters the battlefield (CR 614.1c, 614.1d, 614.12): its own ("This land
 * enters tapped", "… enters with two +1/+1 counters on it", "As ~ enters, choose a color"), a keyword it was given, and
 * other permanents' ("Creatures your opponents control enter tapped", "Each other creature you control of the chosen
 * type enters with an additional +1/+1 counter on it", "Lands you control enter untapped"). Each sort is a rule here;
 * `onEnterBattlefield` (registry.ts) puts every entering permanent to them through instead.ts.
 *
 * CR 616.1: its controller chooses the order. Nobody is asked — it is the order that has it enter untapped where one
 * does ("enters tapped", then "Lands you control enter untapped").
 */
import type { AmountExpr, ConditionNode, ObjectFilter } from '@mtg/schema';
import { chars, matchesFilter, objectAbilities, staticConditionHolds } from './characteristics.js';
import type { Enter, Replacement, Rules } from './instead.js';
import { enterReplacementFor, type EnterChange } from './registry.js';
import { amountOf } from './resolve.js';
import type { GameObject, GameState } from './types.js';
import { abilitySources } from './zones.js';

/** The entering, with what one effect makes of it. */
function changed(h: Enter, change: EnterChange): Enter {
  const counters = { ...h.counters };
  for (const [counter, n] of Object.entries(change.counters ?? {})) counters[counter] = (counters[counter] ?? 0) + n;
  return { ...h, tapped: change.tapped ?? h.tapped, counters, also: [...h.also, ...(change.also ?? [])] };
}

/** Each static ability with this tag on another permanent whose condition holds and whose filter the entering one meets. */
function* others(g: GameState, o: GameObject, tag: string, sameController = false): Generator<{ source: GameObject; node: Record<string, unknown>; text: string; key: string }> {
  for (const id of abilitySources(g)) {
    if (id === o.id) continue;
    const source = g.objects[id];
    if (!source || source.zone !== 'battlefield' || (sameController && source.controller !== o.controller)) continue;
    for (const [i, a] of objectAbilities(g, source).entries()) {
      if (a.kind !== 'static' || a.effect.type !== tag) continue;
      if (!staticConditionHolds(g, a.effect as { condition?: ConditionNode }, source)) continue;
      if (!matchesFilter(g, o, (a.effect.filter ?? {}) as ObjectFilter, { controller: source.controller, source, anyZone: true })) continue;
      yield { source, node: a.effect, text: a.text, key: `${tag}:${source.id}:${source.zcc}:${i}` };
    }
  }
}

export const ENTER_RULES: Rules<Enter> = {
  /** Its own static abilities about how it enters, each read by the handler registered for it. */
  own(g, h) {
    const o = h.object;
    const at = o.copyOf ?? o;
    const def = g.cards[at.card];
    const face = def?.faces[at.face] ?? def?.faces[0];
    const abilities = face ? [...face.abilities, ...face.keywords.flatMap((k) => k.abilities ?? [])] : [];
    const out: Replacement<Enter>[] = [];
    abilities.forEach((ability, i) => {
      if (ability.kind !== 'static') return;
      const change = enterReplacementFor(ability.effect.type)?.(ability.effect, o, g);
      if (change) out.push({ key: `own:${i}`, label: ability.text, apply: (e) => changed(e, change) });
    });
    return out;
  },

  /** CR 614.12: a keyword another permanent gives it ("Nontoken creatures you control have riot") applies as it enters. */
  granted(g, h) {
    const o = h.object;
    const at = o.copyOf ?? o;
    const def = g.cards[at.card];
    const face = def?.faces[at.face] ?? def?.faces[0];
    const printed = new Set(face?.keywords.map((k) => k.id) ?? []);
    const out: Replacement<Enter>[] = [];
    chars(g, o).keywords.forEach((k, i) => {
      if (printed.has(k.id)) return;
      (k.abilities ?? []).forEach((a, j) => {
        if (a.kind !== 'static' || a.effect.type !== 'as_enters') return;
        const change = enterReplacementFor('as_enters')?.(a.effect, o, g);
        if (change) out.push({ key: `granted:${i}:${j}`, label: a.text, apply: (e) => changed(e, change) });
      });
    });
    return out;
  },

  /** CR 614.1d: "Creatures your opponents control enter tapped." */
  tapped_by_others(g, h) {
    return [...others(g, h.object, 'enter_tapped_others')].map((s) => ({ key: s.key, label: s.text, apply: (e) => changed(e, { tapped: true }) }));
  },

  /** Metallic Mimic: "Each other creature you control of the chosen type enters with an additional +1/+1 counter on it." */
  counters_by_others(g, h) {
    const o = h.object;
    return [...others(g, o, 'enter_counters_others')].map((s) => {
      const effect = s.node;
      // Giada: "for each Angel you already control" — not counting the one entering; Arwen: "equal to Arwen's toughness".
      let n = Number(effect.amount ?? 1);
      if (effect.amount && typeof effect.amount === 'object') {
        const a = effect.amount as AmountExpr;
        const counted = effect.notEntering && a.kind === 'count' ? { ...a, filter: { ...a.filter, notObject: o.id } } : a;
        n = Math.max(0, amountOf({ g, controller: s.source.controller, source: s.source, events: [], targets: [], x: 0, memo: {} }, counted));
      }
      // Master Biomancer: "and as a Mutant in addition to its other types" — for as long as it's this object (CR 614.1c).
      const asSubtypes = effect.asSubtypes as string[] | undefined;
      const src = s.source;
      const change: EnterChange = {
        counters: { [String(effect.counter)]: n },
        ...(asSubtypes?.length
          ? {
              also: [
                {
                  key: '',
                  run: (game, it) => {
                    game.effects.push({ id: `e${game.nextId++}`, timestamp: ++game.clock, source: { id: src.id, zcc: src.zcc }, controller: src.controller, objects: [{ id: it.id, zcc: it.zcc }], types: [], subtypes: asSubtypes, retainTypes: true, until: 'game' });
                  },
                },
              ],
            }
          : {}),
      };
      return { key: s.key, label: s.text, apply: (e: Enter) => changed(e, change) };
    });
  },

  /** Spelunking: "Lands you control enter untapped." — even one that would enter tapped. */
  untapped_by_others(g, h) {
    return [...others(g, h.object, 'enter_untapped_others', true)].map((s) => ({ key: s.key, label: s.text, apply: (e) => changed(e, { tapped: false }) }));
  },
};

/** CR 616.1: the entering permanent's controller orders the effects — taken to be so that it enters untapped if it can. */
export const untappedIfItCan = (a: Enter | null, b: Enter | null): number => Number(b?.tapped ?? true) - Number(a?.tapped ?? true);
