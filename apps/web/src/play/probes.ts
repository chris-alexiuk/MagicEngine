import { apply, defaultCastChoice, type Action, type GameState, type PlayerId } from '@mtg/engine';

/**
 * Casts legalActions() leaves to the UI: spells with {X} in their cost (it can't list every X) and kicked casts. Each
 * one offered here is an action apply() has just accepted on a copy of the state, so the engine still decides what's
 * legal; the UI only asks for the number.
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

  const face = def.faces[0]!;
  const castable = o.zone === 'hand' || (o.zone === 'command' && o.commander);
  if (castable && /\{X\}/.test(face.manaCost) && !listed.some((a) => a.type === 'cast' && a.object === id)) {
    const base = defaultCastChoice(g, player, id);
    if (base) {
      // Costs only grow with X: stop at the first X that can't be paid once one could.
      let found = false;
      for (let x = 0; x <= 40; x++) {
        const a: Action = { type: 'cast', player, object: id, autoTap: true, x, ...base };
        if (ok(a)) {
          out.push(a);
          found = true;
        } else if (found || x >= 2) break;
      }
    }
  }

  for (const a of listed) {
    if (a.type !== 'cast' || a.object !== id || a.kicked) continue;
    const f = def.faces[a.face ?? 0];
    const kicker = f?.keywords.find((k) => k.id === 'kicker' || k.id === 'multikicker');
    if (!kicker) continue;
    if (kicker.id === 'kicker') {
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
