import type { CardDef } from '@mtg/schema';
import { faceDownDef, faceDownKey } from './face-down.js';
import { playerRule } from './player-rules.js';
import type { GameObject, GameState, ObjectId, PendingChoice, PlayerId } from './types.js';

/**
 * What one player is allowed to see. The server sends each client only its own
 * view, so hidden information never leaves the server.
 *
 * Hidden: every library's contents, other players' hands, and the deck lists
 * behind them. Visible: everything public plus the viewer's own hand.
 */
export interface PlayerView extends Omit<GameState, 'objects' | 'zones' | 'cards' | 'pending' | 'rng' | 'opening'> {
  viewer: PlayerId;
  objects: Record<ObjectId, GameObject>;
  cards: Record<string, CardDef>;
  zones: {
    library: Record<PlayerId, number>;
    hand: Record<PlayerId, ObjectId[] | number>;
    graveyard: Record<PlayerId, ObjectId[]>;
    battlefield: ObjectId[];
    exile: ObjectId[];
    command: ObjectId[];
  };
  /** The viewer's own pending choice in full; someone else's only as who and what kind. */
  pending: PendingChoice | { kind: PendingChoice['kind']; player: PlayerId; hidden: true } | null;
}

export function viewFor(g: GameState, viewer: PlayerId): PlayerView {
  const visible = new Set<ObjectId>();
  const hand: Record<PlayerId, ObjectId[] | number> = {};
  const library: Record<PlayerId, number> = {};

  for (const p of g.order) {
    library[p] = g.zones.library[p]?.length ?? 0;
    const h = g.zones.hand[p] ?? [];
    // Telepathy: a hand played revealed is seen by everyone.
    if (p === viewer || playerRule(g, p, 'hand_revealed')) {
      hand[p] = [...h];
      h.forEach((id) => visible.add(id));
    } else hand[p] = h.length;
    (g.zones.graveyard[p] ?? []).forEach((id) => visible.add(id));
  }
  for (const id of [...g.zones.battlefield, ...g.zones.exile, ...g.zones.command]) visible.add(id);
  for (const e of g.stack) if (e.kind === 'spell') visible.add(e.object);
  // CR 701.22a / CR 701.25a: a player who scries or surveils looks at those cards.
  if (g.pending && g.pending.player === viewer && (g.pending.kind === 'scry' || g.pending.kind === 'surveil')) {
    for (const id of g.pending.objects) visible.add(id);
  }
  // CR 401.5: "You may look at the top card of your library any time." / "Play with the top card of your library revealed."
  for (const p of g.order) {
    const top = g.zones.library[p]?.[0];
    if (top && ((p === viewer && playerRule(g, p, 'look_at_top')) || playerRule(g, p, 'top_revealed'))) visible.add(top);
  }
  // A revealed hand (CR 701.20a), and cards a player chooses among.
  if (g.pending?.kind === 'choose_objects') {
    for (const id of g.pending.revealed ?? []) visible.add(id);
    if (g.pending.player === viewer) for (const id of [...g.pending.candidates, ...(g.pending.seen ?? [])]) visible.add(id);
  }
  // CR 903.9: the commander its owner may move to the command zone (a commander is known to everyone anyway).
  if (g.pending?.kind === 'commander_zone') visible.add(g.pending.object);
  // CR 701.23a: a player searching their library looks at all of it.
  if (g.pending?.kind === 'search' && g.pending.player === viewer) {
    for (const id of g.zones.library[viewer] ?? []) visible.add(id);
  }

  const objects: Record<ObjectId, GameObject> = {};
  const cards: Record<string, CardDef> = {};
  for (const id of visible) {
    const o = g.objects[id];
    if (!o) continue;
    const hidden = o.hiddenFor !== undefined && o.zone === 'exile' && o.hiddenFor !== viewer;
    if (hidden || (((o.faceDown && (o.zone === 'battlefield' || o.zone === 'stack')) || (o.foretold !== undefined && o.zone === 'exile')) && (o.zone === 'exile' ? o.owner : o.controller) !== viewer)) {
      // CR 708.5: others see only a face-down card.
      const key = faceDownKey(o);
      objects[id] = { ...structuredClone(o), card: key, face: 0 };
      delete objects[id]!.copyOf;
      delete objects[id]!.cast;
      cards[key] = faceDownDef(key)!;
      continue;
    }
    objects[id] = structuredClone(o);
    cards[o.card] = g.cards[o.card]!;
    // A copy's characteristics come from the card it copies (CR 707.2).
    if (o.copyOf && g.cards[o.copyOf.card]) cards[o.copyOf.card] = g.cards[o.copyOf.card]!;
  }

  const pending: PlayerView['pending'] = !g.pending
    ? null
    : g.pending.player === viewer
      ? structuredClone(g.pending)
      : { kind: g.pending.kind, player: g.pending.player, hidden: true };

  const { objects: _o, zones: _z, cards: _c, pending: _p, rng: _r, opening: _op, ...rest } = g;
  return {
    ...structuredClone(rest),
    viewer,
    objects,
    cards,
    zones: {
      library,
      hand,
      graveyard: structuredClone(g.zones.graveyard),
      battlefield: [...g.zones.battlefield],
      exile: [...g.zones.exile],
      command: [...g.zones.command],
    },
    pending,
  };
}
