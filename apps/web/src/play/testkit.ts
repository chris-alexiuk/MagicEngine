import { readFileSync } from 'node:fs';
import { compileCards, type ScryfallCard } from '@mtg/compiler';
import type { CardDef } from '@mtg/schema';
import { apply, type Action, type GameState } from '@mtg/engine';
import { dummyAnswer } from './dummy';
import { dummySeat, newGame, type GameSetup } from './session';

/**
 * For the table's tests: cards compiled from their text, and a solo game brought to a position with the engine's own
 * actions (manual moves included), the way a saved game would reach it.
 */

/** The compiler's sample set. */
export const fixture = JSON.parse(readFileSync(new URL('../../../../packages/compiler/test/fixtures/scryfall-sample.json', import.meta.url), 'utf8')) as ScryfallCard[];

let n = 0;
/** A card as Scryfall would give it, from its text. */
export const card = (name: string, type_line: string, mana_cost: string, oracle_text: string, pt?: [string, string]): ScryfallCard =>
  ({ object: 'card', id: `x${++n}`, oracle_id: `ox${n}`, name, layout: 'normal', lang: 'en', set: 'tst', set_type: 'expansion', rarity: 'rare', games: ['paper'], digital: false, keywords: [], mana_cost, type_line, oracle_text, colors: [], color_identity: [], cmc: 2, legalities: { commander: 'legal' }, ...(pt ? { power: pt[0], toughness: pt[1] } : {}) }) as unknown as ScryfallCard;

/** The sample set with these cards added (one of the same name replaces the sample's). */
export function compiled(extra: ScryfallCard[]): Record<string, CardDef> {
  const names = new Set(extra.map((c) => c.name));
  return Object.fromEntries(compileCards([...fixture.filter((c) => !names.has(c.name)), ...extra]).db.cards.map((c) => [c.name, c]));
}

/** A solo playtest: Kinnan in the command zone, these cards in the deck, the rest Forests and Islands. */
export function soloSetup(main: string[], seed = 5): GameSetup {
  if (!main.includes('Kinnan, Bonder Prodigy')) main = ['Kinnan, Bonder Prodigy', ...main];
  return {
    seed,
    firstPlayer: 'p1',
    mode: 'solo',
    seats: [{ id: 'p1', name: 'You', deckName: 'Kinnan', commanders: ['Kinnan, Bonder Prodigy'], cards: [...main, ...Array.from({ length: 100 - main.length }, (_, i) => (i % 2 ? 'Forest' : 'Island'))] }, dummySeat('p2', 'Island')],
  };
}

export interface Scene {
  readonly g: GameState;
  /** A permanent of that name on the battlefield. */
  id: (name: string) => string;
  /** A card of that name in the player's hand. */
  inHand: (name: string) => string;
  /** Applies an action (it must be legal). */
  run: (a: Action) => ReturnType<typeof apply> & { ok: true };
}

/** A solo game with these cards put onto the battlefield and into hand, at the player's main phase of that turn. */
export function scene(setup: GameSetup, cards: Record<string, CardDef>, battlefield: string[], hand: string[] = [], myTurn = 2): Scene {
  let g = newGame(setup, cards).state;
  const run = (a: Action) => {
    const r = apply(g, a);
    if (!r.ok) throw new Error(`${JSON.stringify(a)}: ${r.error}`);
    g = r.state;
    return r;
  };
  const taken = new Set<string>();
  const until = (turn: number) => {
    for (let i = 0; i < 3000; i++) {
      if (!g.pending && g.active === 'p1' && g.step === 'main1' && g.priority === 'p1' && g.players.p1!.turnsBegun === turn && !g.stack.length) return;
      const p = g.pending;
      if (p?.player === 'p2') run({ type: 'choose', player: 'p2', answer: dummyAnswer(g)!.answer });
      else if (p?.kind === 'mulligan') run({ type: 'choose', player: 'p1', answer: { kind: 'mulligan', keep: true } });
      else if (p?.kind === 'declare_attackers') run({ type: 'choose', player: 'p1', answer: { kind: 'declare_attackers', attacks: [] } });
      else if (p?.kind === 'discard_to_hand_size') run({ type: 'choose', player: 'p1', answer: { kind: 'discard_to_hand_size', objects: g.zones.hand.p1!.filter((x) => !taken.has(x)).slice(0, p.count) } });
      else if (p) throw new Error(`unexpected ${p.kind}`);
      else run({ type: 'pass', player: g.priority! });
    }
    throw new Error('never got there');
  };
  until(1);
  const move = (name: string, to: 'battlefield' | 'hand') => {
    const o = Object.values(g.objects).find((x) => x.owner === 'p1' && x.card === name && ['command', 'library'].includes(x.zone) && !taken.has(x.id));
    if (!o) throw new Error(`no ${name}`);
    taken.add(o.id);
    run({ type: 'manual', player: 'p1', op: { kind: 'move', object: o.id, to } });
  };
  for (const name of battlefield) move(name, 'battlefield');
  for (const name of hand) move(name, 'hand');
  until(myTurn);
  return {
    get g() {
      return g;
    },
    id: (name) => Object.values(g.objects).find((x) => x.card === name && x.zone === 'battlefield')!.id,
    inHand: (name) => Object.values(g.objects).find((x) => x.card === name && x.zone === 'hand' && x.owner === 'p1')!.id,
    run: run as never,
  };
}
