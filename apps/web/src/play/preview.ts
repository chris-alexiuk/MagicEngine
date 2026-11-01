import { apply, choiceModes, choicePrompts, viewFor, type Action, type GameState, type PlayerId, type PlayerView } from '@mtg/engine';

/**
 * Which of the player's permanents autotap would tap to pay for this action — found by applying it to a copy of the
 * state (with the first modes and targets the engine offers, if it needs any), so it's exactly what the engine does.
 */
export function previewTaps(g: GameState, a: Action): string[] {
  if (a.type !== 'cast' && a.type !== 'activate' && a.type !== 'turn_face_up' && a.type !== 'unlock') return [];
  try {
    let full: Action = a;
    if (a.type === 'cast' || a.type === 'activate') {
      const menu = choiceModes(g, a);
      const modes = menu && !a.modes ? Array.from({ length: Math.max(1, menu.min) }, (_, i) => i).filter((i) => i < menu.options.length) : a.modes;
      const prompts = choicePrompts(g, a, modes);
      const targets = prompts.map((pr) => pr.candidates.slice(0, pr.upTo ? (pr.min ?? 0) : pr.count));
      full = { ...a, ...(modes ? { modes } : {}), ...(prompts.length && !a.targets ? { targets } : {}) };
    }
    const r = apply(g, full);
    if (!r.ok) return [];
    return g.zones.battlefield.filter((id) => {
      const o = g.objects[id]!;
      return o.controller === a.player && !o.tapped && r.state.objects[id]?.tapped;
    });
  } catch {
    return [];
  }
}

/** A player's view with every hand face up (one person playing every seat). Libraries stay hidden. */
export function openView(g: GameState, seat: PlayerId): PlayerView {
  const v = viewFor(g, seat);
  for (const p of g.order) {
    if (p === seat) continue;
    const ids = g.zones.hand[p] ?? [];
    v.zones.hand[p] = [...ids];
    for (const id of ids) {
      const o = g.objects[id];
      if (!o) continue;
      v.objects[id] = o;
      v.cards[o.card] = g.cards[o.card]!;
    }
  }
  return v;
}
