import { readFileSync } from 'node:fs';
import { compileCards, type ScryfallCard } from '@mtg/compiler';
import type { CardDef } from '@mtg/schema';
import { legalActions, type Action, type GameState } from '@mtg/engine';
import { describe, expect, it } from 'vitest';
import { clickOutcome, dragAction } from './click';
import { asYou } from './log';
import { advance, DEFAULT_STOPS, dummiesOf, dummySeat, meaningful, newGame, replay, shouldAutoPass, step, type Ctx, type GameSetup } from './session';

const fixture = JSON.parse(readFileSync(new URL('../../../../packages/compiler/test/fixtures/scryfall-sample.json', import.meta.url), 'utf8')) as ScryfallCard[];
const cards: Record<string, CardDef> = Object.fromEntries(compileCards(fixture).db.cards.map((c) => [c.name, c]));
const deck = (main: string[]) => [...main, ...Array.from({ length: 100 - main.length }, (_, i) => (i % 2 ? 'Forest' : 'Island'))];

const solo: GameSetup = {
  seed: 11,
  firstPlayer: 'p1',
  mode: 'solo',
  seats: [{ id: 'p1', name: 'You', deckName: 'Kinnan', commanders: ['Kinnan, Bonder Prodigy'], cards: deck(['Kinnan, Bonder Prodigy', ...Array(30).fill('Grizzly Bears'), ...Array(10).fill('Llanowar Elves')]) }, dummySeat('p2', 'Island')],
};
const ctx = (setup: GameSetup): Ctx => ({ stops: { p1: DEFAULT_STOPS, p2: DEFAULT_STOPS }, passUntil: null, dummies: dummiesOf(setup) });

/** A solo game after both opening hands are kept, with every action taken so far. */
function soloStart(): { g: GameState; actions: Action[] } {
  const c = ctx(solo);
  const first = advance(newGame(solo, cards).state, c);
  let g = first.state;
  const actions = first.steps.map((s) => s.action);
  while (g.pending?.kind === 'mulligan') {
    const r = step(g, { type: 'choose', player: g.pending.player, answer: { kind: 'mulligan', keep: true } }, c);
    if (!r.ok) throw new Error(r.error);
    actions.push(...r.applied.steps.map((s) => s.action));
    g = r.applied.state;
  }
  return { g, actions };
}

describe('solo playtest against the practice dummy', () => {
  it('the dummy keeps, never acts, and its choices are answered through the engine', () => {
    let { g, actions } = soloStart();
    const c = ctx(solo);
    expect(g.priority).toBe('p1');
    // You play a land each turn and pass; the dummy's turns go by on their own.
    for (let i = 0; i < 400 && g.turn < 9 && !g.over; i++) {
      let a: Action;
      if (g.pending) {
        expect(g.pending.player).toBe('p1');
        const p = g.pending;
        a = p.kind === 'declare_attackers' ? { type: 'choose', player: 'p1', answer: { kind: 'declare_attackers', attacks: [] } } : p.kind === 'discard_to_hand_size' ? { type: 'choose', player: 'p1', answer: { kind: 'discard_to_hand_size', objects: g.zones.hand.p1!.slice(0, p.count) } } : (() => { throw new Error(`unexpected ${p.kind}`); })();
      } else {
        expect(g.priority).toBe('p1');
        a = legalActions(g, 'p1').find((x) => x.type === 'play_land') ?? { type: 'pass', player: 'p1' };
      }
      const r = step(g, a, c);
      if (!r.ok) throw new Error(r.error);
      actions.push(...r.applied.steps.map((s) => s.action));
      g = r.applied.state;
    }
    expect(g.turn).toBeGreaterThanOrEqual(9);
    const dummyActions = actions.filter((a) => a.player === 'p2');
    expect(dummyActions.length).toBeGreaterThan(10);
    // It only passes and answers what it's asked: keep, and discard down to seven at cleanup.
    expect(dummyActions.every((a) => a.type === 'pass' || a.type === 'choose')).toBe(true);
    expect(dummyActions.some((a) => a.type === 'choose' && a.answer.kind === 'discard_to_hand_size')).toBe(true);
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.controller === 'p2')).toEqual([]);
    // A saved solo game replays to the same state.
    const back = replay({ setup: solo, actions }, cards, () => {});
    expect(back && JSON.stringify(back.zones)).toBe(JSON.stringify(g.zones));
  });

  it('undo: replaying the actions before a decision gives back the state before it', () => {
    let { g, actions } = soloStart();
    const before = g;
    const mark = actions.length;
    const land = legalActions(g, 'p1').find((a) => a.type === 'play_land')!;
    const r = step(g, land, ctx(solo));
    if (!r.ok) throw new Error(r.error);
    actions = [...actions, ...r.applied.steps.map((s) => s.action)];
    g = r.applied.state;
    expect(g.zones.battlefield.length).toBe(before.zones.battlefield.length + 1);
    const undone = replay({ setup: solo, actions: actions.slice(0, mark) }, cards, () => {});
    expect(undone && JSON.stringify({ zones: undone.zones, players: undone.players, step: undone.step })).toBe(JSON.stringify({ zones: before.zones, players: before.players, step: before.step }));
  });
});

describe('auto-pass, like a digital client', () => {
  it('stops at your main phase when you have something to do, and skips it when all you could do is make mana', () => {
    let { g } = soloStart();
    expect(g.step).toBe('main1');
    // A land to play: a stop.
    expect(shouldAutoPass(g, 'p1', DEFAULT_STOPS, null)).toBe(false);
    const land = legalActions(g, 'p1').find((a) => a.type === 'play_land')!;
    const r = step(g, land, { ...ctx(solo), stops: { p1: { ...DEFAULT_STOPS }, p2: DEFAULT_STOPS } });
    if (!r.ok) throw new Error(r.error);
    g = r.applied.state;
    // With one land and nothing castable for one mana, the rest of the turn was passed for you.
    if (!legalActions(r.applied.steps[0]!.after, 'p1').some(meaningful)) expect(r.applied.state.turn > 1 || r.applied.state.step !== 'main1').toBe(true);
    // Every stop is skipped once there's nothing but mana to make.
    const s0 = r.applied.steps[0]!.after;
    expect(shouldAutoPass(s0, 'p1', DEFAULT_STOPS, null)).toBe(!legalActions(s0, 'p1').some(meaningful));
    expect(shouldAutoPass(s0, 'p1', { ...DEFAULT_STOPS, skipIfNothing: false }, null)).toBe(false);
  });

  it('"pass until end of turn" lasts that turn only, and the dummy always passes', () => {
    const { g } = soloStart();
    expect(shouldAutoPass(g, 'p1', DEFAULT_STOPS, { player: 'p1', turn: g.turn })).toBe(true);
    expect(shouldAutoPass(g, 'p1', DEFAULT_STOPS, { player: 'p1', turn: g.turn - 1 })).toBe(false);
    expect(shouldAutoPass({ ...g, priority: 'p2' }, 'p2', DEFAULT_STOPS, null, true)).toBe(true);
  });
});

describe('clicking a card', () => {
  const play: Action = { type: 'play_land', player: 'p1', object: 'o1' };
  const cast: Action = { type: 'cast', player: 'p1', object: 'o1', autoTap: true };
  const mana: Action = { type: 'activate_mana', player: 'p1', object: 'o2', ability: 0 };

  it('does the one thing it can do, opens a menu when there are several, and does nothing when there are none', () => {
    expect(clickOutcome([play], [])).toEqual({ kind: 'act', action: play });
    expect(clickOutcome([mana], [])).toEqual({ kind: 'act', action: mana });
    expect(clickOutcome([cast, { ...cast, alt: 'evoke' }], [])).toEqual({ kind: 'menu' });
    expect(clickOutcome([cast], [{ ...cast, kicked: true }])).toEqual({ kind: 'menu' });
    // A spell with X always asks how much.
    expect(clickOutcome([], [{ ...cast, x: 3 }])).toEqual({ kind: 'menu' });
    expect(clickOutcome([], [])).toEqual({ kind: 'none' });
  });

  it('with the actions the engine lists: a land in hand plays, the commander casts', () => {
    const { g } = soloStart();
    const land = g.zones.hand.p1!.find((id) => g.cards[g.objects[id]!.card]!.faces[0]!.types.includes('Land'))!;
    const listed = legalActions(g, 'p1').filter((a) => 'object' in a && a.object === land);
    expect(clickOutcome(listed, [])).toEqual({ kind: 'act', action: { type: 'play_land', player: 'p1', object: land } });
    expect(dragAction(listed)).toEqual({ type: 'play_land', player: 'p1', object: land });
    expect(dragAction([cast, play])).toEqual(play);
    expect(dragAction([mana])).toBeNull();
  });

  it('a solo log reads in the second person', () => {
    expect(asYou('You draws a card.')).toBe('You draw a card.');
    expect(asYou('You casts Grizzly Bears.')).toBe('You cast Grizzly Bears.');
    expect(asYou('You searches your library.')).toBe('You search your library.');
    expect(asYou('You has no cards left.')).toBe('You have no cards left.');
    expect(asYou('You draw Llanowar Elves.')).toBe('You draw Llanowar Elves.');
    expect(asYou('Ann attacks You.')).toBe('Ann attacks You.');
    expect(asYou('You keeps their hand.')).toBe('You keep your hand.');
    expect(asYou('You searches their library.')).toBe('You search your library.');
    expect(asYou('You wins')).toBe('You win');
    expect(asYou('You’s graveyard')).toBe('Your graveyard');
    expect(asYou('Ann shuffles their library.')).toBe('Ann shuffles their library.');
  });
});

describe('fitting cards to a seat', () => {
  const row = (n: number, tapped = false) => Array.from({ length: n }, () => ({ tapped }));
  it('uses the largest size at which the lanes fit, and smaller cards when there are more of them', async () => {
    const { fitCardWidth, itemWidth, RATIO } = await import('./fit');
    const few = fitCardWidth([row(3), row(4)], { width: 900, height: 360, max: 140 });
    const many = fitCardWidth([row(12), row(14)], { width: 900, height: 360, max: 140 });
    expect(few).toBeGreaterThan(many);
    expect(few).toBeLessThanOrEqual(140);
    // Everything fits in the height it was given.
    expect(2 * (many * RATIO + 14) + 10).toBeLessThanOrEqual(360);
    // A tapped card is as wide as an untapped one is tall: room is kept for it.
    expect(itemWidth({ tapped: true }, 70)).toBeCloseTo(70 * RATIO);
    expect(fitCardWidth([row(8, true)], { width: 700, height: 400 })).toBeLessThan(fitCardWidth([row(8)], { width: 700, height: 400 }));
    // Lands drawn smaller let the creatures be bigger.
    const lands = Array.from({ length: 10 }, () => ({ tapped: false, scale: 0.85 }));
    expect(fitCardWidth([row(4), lands], { width: 800, height: 330 })).toBeGreaterThanOrEqual(fitCardWidth([row(4), row(10)], { width: 800, height: 330 }));
  });
});
