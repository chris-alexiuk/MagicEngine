/**
 * The replacement effects on an object changing zones (CR 614.1a): each sort is one rule here, and `moveObject`
 * (zones.ts) puts every move to them through instead.ts. A rule finds the effects of its sort that apply to the move
 * as it stands and says what each makes of it; which goes first when several apply is not its business.
 */
import type { ConditionNode, ExileInsteadNode, ObjectFilter } from '@mtg/schema';
import { abilitiesOf, chars, matchesFilter, objectAbilities, staticConditionHolds } from './characteristics.js';
import type { Also, Move, Replacement, Rules } from './instead.js';
import { createTokens } from './permanents.js';
import { applyLifeGain } from './quantities.js';
import { shuffleInPlace } from './rng.js';
import type { GameObject, GameState, PlayerId, ZoneName } from './types.js';
import { abilitySources, battlefieldZcc, faceOf, nameOf, zoneList } from './zones.js';

/** The move, going somewhere else. */
function elsewhere(h: Move, to: ZoneName, position?: 'top' | 'bottom', also: Also[] = []): Move {
  const { position: _was, ...rest } = h;
  return { ...rest, to, ...(position ? { position } : {}), also: [...h.also, ...also] };
}

const dies = (h: Move): boolean => h.from === 'battlefield' && h.to === 'graveyard';

/** Whether the object's printed abilities (or its keywords') include a static ability with this tag. */
function printedStatic(g: GameState, o: GameObject, tag: string): { text: string } | undefined {
  const face = faceOf(g, o);
  return [...face.abilities, ...face.keywords.flatMap((k) => k.abilities ?? [])].find((a) => a.kind === 'static' && a.effect.type === tag);
}

/** CR 702.35a: madness with a cost that can be paid (a card with "madness—[no cost]" isn't exiled to be cast). */
const hasMadness = (g: GameState, o: GameObject): boolean => faceOf(g, o).keywords.some((k) => k.id === 'madness' && k.cost && /^(\{[^}]+\})+$/.test(k.cost));

/** What a rule's effect is called when a player chooses between several: the card, and its words. */
export const says = (g: GameState, source: GameObject, text: string): string => `${nameOf(g, source)}: ${text.length > 260 ? `${text.slice(0, 257)}…` : text}`;

/**
 * Each static ability with this tag among everything whose abilities work now — and whose condition, if it has one, holds
 * ("… while you have no cards in hand") — with its place (for a key of its own).
 */
export function* statics(g: GameState, tag: string): Generator<{ source: GameObject; node: Record<string, unknown>; text: string; key: string }> {
  for (const id of abilitySources(g)) {
    const source = g.objects[id]!;
    for (const [i, a] of objectAbilities(g, source).entries()) {
      if (a.kind === 'static' && a.effect.type === tag && staticConditionHolds(g, a.effect as { condition?: ConditionNode }, source)) yield { source, node: a.effect, text: a.text, key: `${tag}:${source.id}:${source.zcc}:${i}` };
    }
  }
}

/** CR 614.1a: what an "exile it instead" effect of another permanent (or one the object was given) makes of a move to a graveyard. */
function exileInstead(g: GameState, h: Move, node: ExileInsteadNode, source: GameObject, key: string, text: string): Replacement<Move> {
  const label = says(g, source, text);
  // Nissa's Chosen: "put it on the bottom of its owner's library instead"; Gravebane Zombie: on top.
  if (node.libraryBottom || node.libraryTop) return { key, label, apply: (m) => elsewhere(m, 'library', node.libraryTop ? 'top' : 'bottom') };
  const you = source.controller;
  const also: Also[] = [];
  // Dauthi Voidwalker: "instead exile it with a void counter on it".
  if (node.withCounter) {
    const counter = node.withCounter;
    also.push({ key: `counter:${counter}`, run: (_g, o) => void (o.counters[counter] = 1) });
  }
  // The Darkness Crystal: "… instead exile it and you gain 2 life." — exiled with it (CR 607.2a). Which permanent a card
  // was exiled with is something only a permanent that says "exiled with" tells apart.
  const linked = JSON.stringify(faceOf(g, source)).includes('exiledWith');
  also.push({ key: linked ? `with:${source.id}` : '', run: (game, o) => void (o.exiledBy = { id: source.id, zcc: battlefieldZcc(game, source) }) });
  if (node.gainLife) {
    const n = node.gainLife;
    also.push({ key: `life:${you}:${n}`, run: (game, _o, events) => void applyLifeGain(game, you, n, events) });
  }
  // Kalitas, Traitor of Ghet: "… and create a 2/2 black Zombie creature token" — its controller's.
  if (node.createToken) {
    const made = node.createToken;
    also.push({
      key: `token:${you}:${made.name}`,
      run: (game, _o, events) => void createTokens(game, you, made, 1, events),
    });
  }
  return { key, label, apply: (m) => elsewhere(m, 'exile', undefined, also) };
}

/**
 * The rules, by name. (Their order is the order effects are offered in, and the one taken where nobody chooses.)
 */
export const MOVE_RULES: Rules<Move> = {
  /**
   * CR 702.35a: madness — "If a player would discard this card, that player discards it, but exiles it instead of
   * putting it into their graveyard."
   */
  madness(g, h) {
    const o = h.object;
    if (!h.discard || h.to !== 'graveyard' || !hasMadness(g, o)) return [];
    return [{ key: `madness:${o.id}:${o.zcc}`, label: `${nameOf(g, o)}: madness — exile it instead`, apply: (m) => elsewhere(m, 'exile', undefined, [{ key: MADNESS, run: () => {} }]) }];
  },

  /** Containment Priest: "If a nontoken creature would enter and it wasn't cast, exile it instead." */
  enters_uncast(g, h) {
    const o = h.object;
    if (h.to !== 'battlefield' || h.from === 'battlefield' || h.from === 'stack' || o.token) return [];
    const out: Replacement<Move>[] = [];
    for (const s of statics(g, 'enter_exile_uncast')) {
      const filter = s.node.filter as ObjectFilter | undefined;
      if (filter && !matchesFilter(g, o, filter, { controller: s.source.controller, source: s.source, anyZone: true })) continue;
      out.push({ key: s.key, label: says(g, s.source, s.text), apply: (m) => elsewhere(m, 'exile') });
    }
    return out;
  },

  /**
   * CR 702.34a: flashback — "exile it instead of putting it anywhere else any time it would leave the stack"; a spell
   * cast with leave to ("If that spell would be put into a graveyard, exile it instead"): only a graveyard.
   */
  leaves_the_stack(_g, h) {
    const o = h.object;
    if (h.from !== 'stack' || h.to === 'exile' || !(o.exileOnLeave === true || (o.exileOnLeave === 'graveyard' && h.to === 'graveyard'))) return [];
    return [{ key: `leaves_the_stack:${o.id}:${o.zcc}`, label: 'The way it was cast: exile it instead', apply: (m) => elsewhere(m, 'exile') }];
  },

  /** CR 702.84a: unearth and its like — "If it would leave the battlefield, exile it instead of putting it anywhere else." */
  leaves_the_battlefield(_g, h) {
    const o = h.object;
    if (h.from !== 'battlefield' || h.to === 'exile' || h.to === 'battlefield' || !o.exileWhenLeaves) return [];
    return [{ key: `leaves_the_battlefield:${o.id}:${o.zcc}`, label: 'The effect that put it there: exile it instead', apply: (m) => elsewhere(m, 'exile') }];
  },

  /** "If that creature would die this turn, exile it instead." — an effect on this one. */
  dies_this_turn(g, h) {
    const o = h.object;
    if (!dies(h) || o.exileIfDiesTurn !== g.turn) return [];
    return [{ key: `dies_this_turn:${o.id}:${o.zcc}`, label: 'An effect on it this turn: exile it instead', apply: (m) => elsewhere(m, 'exile') }];
  },

  /** Malicious Malfunction: "If a creature would die this turn, exile it instead." — any of them. */
  creatures_die_this_turn(g, h) {
    if (!dies(h) || g.exileDyingTurn !== g.turn || !chars(g, h.object).types.includes('Creature')) return [];
    return [{ key: 'creatures_die_this_turn', label: 'An effect this turn: exile it instead', apply: (m) => elsewhere(m, 'exile') }];
  },

  /** "If ~ would be put into a graveyard from anywhere, exile it instead." — its own. */
  own_exile(g, h) {
    const o = h.object;
    const own = h.to === 'graveyard' ? printedStatic(g, o, 'graveyard_to_exile') : undefined;
    return own ? [{ key: `own_exile:${o.id}:${o.zcc}`, label: says(g, o, own.text), apply: (m) => elsewhere(m, 'exile') }] : [];
  },

  /** Another permanent's "… would die / be put into a graveyard, exile it instead" (Rest in Peace, Leyline of the Void, Kalitas). */
  exile_instead(g, h) {
    const o = h.object;
    if (h.to !== 'graveyard') return [];
    const out: Replacement<Move>[] = [];
    // Can't Stay Away: it gains "If this creature would die, exile it instead." — a granted ability of its own.
    if (h.from === 'battlefield' && o.zone === 'battlefield' && chars(g, o).keywords.some((k) => k.id === 'ability')) {
      for (const [i, a] of abilitiesOf(g, o).entries()) {
        if (a.kind !== 'static' || a.effect.type !== 'exile_instead') continue;
        const e = a.effect as ExileInsteadNode;
        if (e.dies && e.filter?.isSource) out.push(exileInstead(g, h, e, o, `exile_instead:own:${o.id}:${o.zcc}:${i}`, a.text));
      }
    }
    for (const s of statics(g, 'exile_instead')) {
      const e = s.node as unknown as ExileInsteadNode;
      if (e.dies && h.from !== 'battlefield') continue;
      if (e.owner === 'you' ? o.owner !== s.source.controller : e.owner === 'opponents' ? o.owner === s.source.controller : false) continue;
      if (e.filter && !matchesFilter(g, o, e.filter, { controller: s.source.controller, source: s.source, anyZone: true })) continue;
      out.push(exileInstead(g, h, e, s.source, s.key, s.text));
    }
    return out;
  },

  /** "If ~ would be put into a graveyard from anywhere, reveal ~ and shuffle it into its owner's library instead." — its own. */
  own_shuffle(g, h) {
    const o = h.object;
    const own = h.to === 'graveyard' ? printedStatic(g, o, 'graveyard_to_library') : undefined;
    if (!own) return [];
    const shuffle: Also = {
      key: 'shuffled',
      late: true,
      run: (game, it, events) => {
        events.push({ type: 'revealed', player: it.owner, objects: [it.id] });
        shuffleInPlace(game, zoneList(game, 'library', it.owner));
        events.push({ type: 'shuffled', player: it.owner });
      },
    };
    return [{ key: `own_shuffle:${o.id}:${o.zcc}`, label: says(g, o, own.text), apply: (m) => elsewhere(m, 'library', undefined, [shuffle]) }];
  },

  /**
   * CR 903.9b: "If a commander would be put into its owner's hand or library from anywhere, its owner may put it into
   * the command zone instead." It "may apply more than once to the same event" (an exception to CR 614.5): once for
   * each place the move would take it. (A commander put into a graveyard or into exile goes there, and may go on from
   * there: CR 903.9a, a state-based action — flow.ts.)
   */
  commander(g, h) {
    const o = h.object;
    if (!o.commander || o.token || !(h.to === 'hand' || h.to === 'library') || h.from === h.to || h.from === 'command' || g.players[o.owner]?.lost) return [];
    const name = o.faceDown && h.from === 'battlefield' ? 'A face-down permanent' : nameOf(g, o);
    return [
      {
        key: `commander:${o.id}:${o.zcc}:${h.to}`,
        label: 'Put it into the command zone instead',
        may: { ask: `${name} would be put into its owner's ${h.to}. Put it into the command zone instead?`, no: `Let it go to its owner's ${h.to}`, by: o.owner },
        apply: (m) => elsewhere(m, 'command'),
      },
    ];
  },
};

/** The mark a move carries when madness exiled the card: its owner may cast it (CR 702.35a). */
export const MADNESS = 'madness';

/** CR 616.1: the controller of the affected object chooses — its owner where it has none. */
export const moveChooser = (h: Move): PlayerId => (h.from === 'battlefield' || h.from === 'stack' ? h.object.controller : h.object.owner);

/** What is about to happen to the card, for the player choosing between the effects on it. */
export function moveQuestion(g: GameState, h: Move): { text: string; sourceName: string } {
  const o = h.object;
  const name = o.faceDown && h.from === 'battlefield' ? 'A face-down permanent' : nameOf(g, o);
  const would =
    h.discard ? 'be discarded' : dies(h) ? 'die' : h.to === 'graveyard' ? 'be put into a graveyard' : h.to === 'battlefield' ? 'enter the battlefield' : h.from === 'stack' ? 'leave the stack' : h.from === 'battlefield' ? 'leave the battlefield' : `be put into ${h.to === 'exile' ? 'exile' : `its owner's ${h.to}`}`;
  return { text: `${name} would ${would}, and more than one effect replaces that. Which applies first?`, sourceName: name };
}
