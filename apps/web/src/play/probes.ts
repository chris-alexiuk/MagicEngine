import { apply, defaultChoiceAtX, type Action, type GameState, type PlayerId } from '@mtg/engine';

/** A listed action that stands for a range of X (the engine gives the least X and `xMax`, the most that can be paid for). */
export function hasXRange(a: Action): a is Extract<Action, { type: 'cast' | 'activate' }> & { xMax: number } {
  return (a.type === 'cast' || a.type === 'activate') && a.xMax !== undefined;
}

/**
 * What the UI adds to legalActions(): one action for each X in the range the engine lists for an X spell or ability, and
 * kicked casts. Each one offered here is an action apply() has just accepted on a copy of the state (or the listed one
 * itself), so the engine still decides what's legal; the UI only asks for the number.
 */
export function extraCasts(g: GameState, player: PlayerId, id: string, listed: Action[]): Action[] {
  const o = g.objects[id];
  const def = o ? g.cards[o.card] : undefined;
  if (!o || !def || o.owner !== player) return [];
  const out: Action[] = [];
  const ok = (a: Action) => {
    try {
      return apply(g, a).ok;
    } catch {
      return false;
    }
  };

  for (const a of listed) {
    if (!hasXRange(a) || a.object !== id) continue;
    const { xMax, ...rest } = a;
    const least = a.x ?? 0;
    for (let x = least; x <= xMax; x++) {
      if (x === least) {
        out.push({ ...rest, x } as Action);
        continue;
      }
      // Another X can need other targets ("destroy X target artifacts", "with mana value X"): the engine's default
      // choice for that number — and only what it then accepts (there may not be that many to target).
      const { targets: _t, modes: _m, ...bare } = rest;
      const choice = defaultChoiceAtX(g, a, x);
      const v = { ...bare, x, ...(choice ?? {}) } as Action;
      if (choice && ok(v)) out.push(v);
    }
  }

  for (const a of listed) {
    if (a.type !== 'cast' || a.object !== id || a.kicked || hasXRange(a)) continue;
    const f = def.faces[a.face ?? 0];
    const kicker = f?.keywords.find((k) => k.id === 'kicker' || k.id === 'multikicker');
    if (!kicker) continue;
    if (kicker.id === 'kicker' && kicker.cost?.includes(' and/or ')) {
      // "Kicker {1}{U} and/or {B}": either kicker, or both (CR 702.33c).
      for (const which of [[0], [1], [0, 1]]) {
        const k: Action = { ...a, kicked: which };
        if (ok(k)) out.push(k);
      }
    } else if (kicker.id === 'kicker') {
      const k: Action = { ...a, kicked: true };
      if (ok(k)) out.push(k);
    } else {
      for (let n = 1; n <= 8; n++) {
        const k: Action = { ...a, kicked: n };
        if (!ok(k)) break;
        out.push(k);
      }
    }
  }
  return out;
}
