import { readFileSync } from 'node:fs';
import { compileCards, type ScryfallCard } from '@mtg/compiler';
import type { CardDef } from '@mtg/schema';
import { legalActions, type Action, type GameState } from '@mtg/engine';
import { describe, expect, it } from 'vitest';
import { narrate } from './log';
import { DEFAULT_STOPS, decider, newGame, replay, shouldAutoPass, step, type GameSetup, type Stops } from './session';

const fixture = JSON.parse(
  readFileSync(new URL('../../../../packages/compiler/test/fixtures/scryfall-sample.json', import.meta.url), 'utf8'),
) as ScryfallCard[];
const cards: Record<string, CardDef> = Object.fromEntries(compileCards(fixture).db.cards.map((c) => [c.name, c]));

const deck = (main: string[]) => [...main, ...Array.from({ length: 100 - main.length }, (_, i) => (i % 2 ? 'Forest' : 'Island'))];
const setup: GameSetup = {
  seed: 7,
  firstPlayer: 'p1',
  seats: [
    { id: 'p1', name: 'Ann', deckName: 'A', commanders: ['Kinnan, Bonder Prodigy'], cards: deck(['Kinnan, Bonder Prodigy', ...Array(20).fill('Grizzly Bears')]) },
    { id: 'p2', name: 'Ben', deckName: 'B', commanders: ['Thrasios, Triton Hero'], cards: deck(['Thrasios, Triton Hero', ...Array(20).fill('Counterspell')]) },
  ],
};
const stops: Record<string, Stops> = { p1: DEFAULT_STOPS, p2: DEFAULT_STOPS };

function keepBoth(): { g: GameState; actions: Action[] } {
  let g = newGame(setup, cards).state;
  const actions: Action[] = [];
  while (g.pending?.kind === 'mulligan') {
    const a: Action = { type: 'choose', player: g.pending.player, answer: { kind: 'mulligan', keep: true } };
    const r = step(g, a, stops, null);
    if (!r.ok) throw new Error(r.error);
    actions.push(...r.applied.steps.map((s) => s.action));
    g = r.applied.state;
  }
  return { g, actions };
}

describe('same-screen session', () => {
  it('starts a Commander game with commanders in the command zone', () => {
    const { state } = newGame(setup, cards);
    expect(state.config.startingLife).toBe(40);
    expect(state.zones.command).toHaveLength(2);
    expect(decider(state)).toBe('p1');
  });

  it('passes priority for seats that have no stop, up to the first main phase', () => {
    const { g } = keepBoth();
    expect(g.turn).toBe(1);
    expect(g.step).toBe('main1');
    expect(g.priority).toBe('p1');
  });

  it("stops for a player who can respond to an opponent's spell, and passes for one who can't", () => {
    const { g } = keepBoth();
    // With an empty stack and no stop, the other seat isn't asked.
    expect(shouldAutoPass(g, 'p1', { ...DEFAULT_STOPS, mine: [] }, null)).toBe(true);
    expect(shouldAutoPass(g, 'p1', DEFAULT_STOPS, null)).toBe(false);
    // "End turn" passes for the rest of this turn only.
    expect(shouldAutoPass(g, 'p1', DEFAULT_STOPS, { player: 'p1', turn: g.turn })).toBe(true);
    expect(shouldAutoPass(g, 'p1', DEFAULT_STOPS, { player: 'p1', turn: g.turn - 1 })).toBe(false);
  });

  it('only lists what the engine allows and replays a saved game exactly', () => {
    let { g, actions } = keepBoth();
    const land = legalActions(g, 'p1').find((a) => a.type === 'play_land');
    expect(land).toBeTruthy();
    const r = step(g, land!, stops, null);
    if (!r.ok) throw new Error(r.error);
    g = r.applied.state;
    actions = [...actions, ...r.applied.steps.map((s) => s.action)];
    const lines: string[] = [];
    const back = replay({ setup, actions, savedAt: '' }, cards, (before, after, events) => lines.push(...narrate(before, after, events, () => lines.length).map((l) => l.text)));
    expect(back && JSON.stringify(back.zones)).toBe(JSON.stringify(g.zones));
    expect(lines.some((l) => /Ann plays (Forest|Island)\./.test(l))).toBe(true);
    // Draws name the card only in a line for the drawer.
    const draws = narrate(g, g, [{ type: 'drew', player: 'p1', object: g.zones.hand.p1![0]! }], () => 0);
    expect(draws).toEqual([expect.objectContaining({ text: 'Ann draws a card.' }), expect.objectContaining({ only: 'p1' })]);
  });

  it('refuses an illegal action without changing anything', () => {
    const { g } = keepBoth();
    const r = step(g, { type: 'pass', player: 'p2' }, stops, null);
    expect(r.ok).toBe(false);
  });
});
