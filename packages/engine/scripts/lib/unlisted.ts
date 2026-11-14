/**
 * The other half of "offered = accepted": actions the engine would take that legalActions() never listed.
 *
 * The fuzz games already check that everything listed is accepted. This looks the other way. For the player with
 * priority it goes through everything they could conceivably do with each object there is — play it, cast each face
 * for its mana cost or one of its other costs, activate each ability, each special action — and, for the ones the list
 * doesn't have, puts the plain action to apply() with choices picked at random from what the engine's own prompts
 * offer. One that is accepted is a gap: something a player may do and the table would never let them click, or
 * something nobody may do that the engine would take from a client that sent it. Other players' cards and permanents
 * are tried like the player's own: a permission may open them, and nothing else may.
 *
 * Deliberately not tried, because the list leaves them to a client by design: kicker and multikicker, more than one
 * optional cost at once, splice, and lines resolved by hand.
 */
import {
  activatedAbilities,
  apply,
  choiceModes,
  choicePrompts,
  manaAbilities,
  type Action,
  type GameState,
  type ManaColor,
  type PlayerId,
} from '../../src/index.js';
import { castOptionsFor } from '../../src/actions.js';
import type { Bot } from './bot.js';

export interface Unlisted {
  /** What it is, without the choices: "cast face 0 escape", "ability 1". */
  key: string;
  card: string;
  zone: string;
  /** The action the engine accepted. */
  action: Action;
}

type Casting = Extract<Action, { type: 'cast' }>;

/** An action without its choices: what kind of thing is done with which object. */
export function keyOf(a: Action): string {
  switch (a.type) {
    case 'cast':
      return `cast:${a.object}:${a.face ?? 0}:${a.alt ?? ''}:${(a.extras ?? []).join('+')}`;
    case 'play_land':
      return `land:${a.object}:${a.face ?? 0}`;
    case 'activate':
      return `ability:${a.object}:${a.ability}`;
    case 'activate_mana':
      return `mana:${a.object}:${a.ability}`;
    case 'unlock':
      return `unlock:${a.object}:${a.half}`;
    case 'turn_face_up':
    case 'foretell':
    case 'plot':
    case 'suspend':
      return `${a.type}:${a.object}`;
    default:
      return a.type;
  }
}

const COLORS: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

/** Everything the player could conceivably do right now that isn't in `listed`, and that the engine accepts all the same. */
export function unlistedActions(g: GameState, player: PlayerId, listed: readonly Action[], bot: Bot, tries = 3): Unlisted[] {
  if (g.over || g.pending || g.priority !== player) return [];
  const have = new Set(listed.map(keyOf));
  const out: Unlisted[] = [];
  const accepted = (a: Action): boolean => {
    try {
      return apply(g, a).ok;
    } catch {
      // A crash on an action nobody listed is the forward check's business when it is listed; here it only means "no".
      return false;
    }
  };
  const found = (a: Action): void => {
    const o = g.objects[(a as { object: string }).object];
    out.push({ key: keyOf(a).replace(/^(\w+):[^:]+/, '$1'), card: o ? (g.cards[o.card]?.name ?? o.card) : '', zone: o?.zone ?? '', action: a });
  };
  /** A cast or activation with modes, targets and costs drawn from what the engine's prompts offer for it. */
  const withChoices = (a: Extract<Action, { type: 'cast' | 'activate' }>): Action | null => {
    try {
      const menu = choiceModes(g, a);
      let modes: number[] | undefined;
      if (menu) {
        const free = bot.shuffle(menu.options.map((_, i) => i).filter((i) => !menu.used.includes(i)));
        modes = free.slice(0, Math.max(1, menu.min)).sort((x, y) => x - y);
      }
      const prompts = choicePrompts(g, a, modes);
      const chosen = { ...a, ...(modes ? { modes } : {}), ...(prompts.length ? { targets: bot.samplePrompts(prompts) } : {}) };
      return bot.randomiseCosts(g, chosen);
    } catch {
      return null;
    }
  };
  const tryChoosing = (a: Extract<Action, { type: 'cast' | 'activate' }>): void => {
    if (have.has(keyOf(a))) return;
    for (let i = 0; i < tries; i++) {
      const v = withChoices(a);
      if (!v) return;
      if (accepted(v)) return found(v);
    }
  };
  const tryPlain = (a: Action): void => {
    if (!have.has(keyOf(a)) && accepted(a)) found(a);
  };

  const each = (zone: Record<PlayerId, string[]>, take = (ids: string[]) => ids) => g.order.flatMap((p) => take(zone[p] ?? []));
  const cards = [...each(g.zones.hand), ...each(g.zones.graveyard), ...g.zones.exile, ...g.zones.command, ...each(g.zones.library, (ids) => ids.slice(0, 1))];
  for (const id of cards) {
    const o = g.objects[id]!;
    const def = g.cards[o.card];
    if (!def || o.emblem) continue;
    def.faces.forEach((face, i) => {
      const at = i ? { face: i } : {};
      tryPlain({ type: 'play_land', player, object: id, ...at });
      const base: Casting = { type: 'cast', player, object: id, autoTap: true, ...at };
      tryChoosing(base);
      if (i) return;
      for (const opt of castOptionsFor(g, player, o, face)) tryChoosing(opt.kind === 'alternative' ? { ...base, alt: opt.id } : { ...base, extras: [opt.id] });
    });
    if (o.zone === 'hand') for (const type of ['foretell', 'plot', 'suspend'] as const) tryPlain({ type, player, object: id, autoTap: true });
    activatedAbilities(g, o).forEach((_, ability) => tryChoosing({ type: 'activate', player, object: id, ability, autoTap: true }));
    manaAbilities(g, o).forEach((_, ability) => tryPlain({ type: 'activate_mana', player, object: id, ability, autoTap: true }));
  }
  for (const id of g.zones.battlefield) {
    const o = g.objects[id]!;
    activatedAbilities(g, o).forEach((_, ability) => tryChoosing({ type: 'activate', player, object: id, ability, autoTap: true }));
    manaAbilities(g, o).forEach((_, ability) => {
      const a: Extract<Action, { type: 'activate_mana' }> = { type: 'activate_mana', player, object: id, ability, autoTap: true };
      if (have.has(keyOf(a))) return;
      // Whichever mana it can add: named by color, by option, or not at all.
      for (const choice of [undefined, ...COLORS, 0, 1]) {
        const v = bot.randomiseCosts(g, choice === undefined ? a : { ...a, choice });
        if (accepted(v)) return found(v);
      }
    });
    if (o.faceDown) tryPlain({ type: 'turn_face_up', player, object: id, autoTap: true });
    if (o.unlocked) for (const half of [0, 1] as const) tryPlain({ type: 'unlock', player, object: id, half, autoTap: true });
  }
  return out;
}
