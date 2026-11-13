import { readFileSync } from 'node:fs';
import { compileCards, type ScryfallCard } from '@mtg/compiler';
import type { CardDef } from '@mtg/schema';
import { apply, legalActions, type Action, type GameState } from '@mtg/engine';
import { describe, expect, it } from 'vitest';
import { narrate } from './log';
import { DEFAULT_STOPS, decider, newGame, passUntilDone, peekPass, replay, shouldAutoPass, step, type Ctx, type GameSetup, type PassUntil, type Stops } from './session';

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
const ctx: Ctx = { stops, passUntil: null, dummies: new Set() };

function keepBoth(): { g: GameState; actions: Action[] } {
  let g = newGame(setup, cards).state;
  const actions: Action[] = [];
  while (g.pending?.kind === 'mulligan') {
    const a: Action = { type: 'choose', player: g.pending.player, answer: { kind: 'mulligan', keep: true } };
    const r = step(g, a, ctx);
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
    const r = step(g, land!, ctx);
    if (!r.ok) throw new Error(r.error);
    g = r.applied.state;
    actions = [...actions, ...r.applied.steps.map((s) => s.action)];
    const lines: string[] = [];
    const back = replay({ setup, actions }, cards, (before, after, events) => lines.push(...narrate(before, after, events, () => lines.length).map((l) => l.text)));
    expect(back && JSON.stringify(back.zones)).toBe(JSON.stringify(g.zones));
    expect(lines.some((l) => /Ann plays (Forest|Island)\./.test(l))).toBe(true);
    // Draws name the card only in a line for the drawer.
    const draws = narrate(g, g, [{ type: 'drew', player: 'p1', object: g.zones.hand.p1![0]! }], () => 0);
    expect(draws).toEqual([expect.objectContaining({ text: 'Ann draws a card.' }), expect.objectContaining({ only: 'p1' })]);
  });

  it('casts the commander from the command zone, and again with {2} tax after it returns there', () => {
    let { g } = keepBoth();
    const kinnan = g.zones.command.find((id) => g.objects[id]!.card === 'Kinnan, Bonder Prodigy')!;
    const run = (a: Action) => {
      const r = step(g, a, ctx);
      if (!r.ok) throw new Error(`${JSON.stringify(a)}: ${r.error}`);
      g = r.applied.state;
    };
    const castKinnan = () => legalActions(g, 'p1').find((a) => a.type === 'cast' && a.object === kinnan);
    // Each of Ann's turns: play a land; Ben just passes. Stop once Kinnan is castable.
    const untilCastable = () => {
      for (let i = 0; i < 400 && !castKinnan(); i++) {
        if (g.pending) {
          const p = g.pending;
          if (p.kind === 'declare_attackers') run({ type: 'choose', player: p.player, answer: { kind: 'declare_attackers', attacks: [] } });
          else if (p.kind === 'discard_to_hand_size') run({ type: 'choose', player: p.player, answer: { kind: 'discard_to_hand_size', objects: g.zones.hand[p.player]!.slice(0, p.count) } });
          else throw new Error(`unexpected ${p.kind}`);
          continue;
        }
        const land = g.priority === 'p1' ? legalActions(g, 'p1').find((a) => a.type === 'play_land') : undefined;
        run(land ?? { type: 'pass', player: g.priority! });
      }
      return castKinnan();
    };
    const first = untilCastable();
    expect(first).toEqual({ type: 'cast', player: 'p1', object: kinnan, autoTap: true });
    run(first!);
    while (g.stack.length) run({ type: 'pass', player: g.priority! });
    expect(g.objects[kinnan]!.zone).toBe('battlefield');
    // It dies (by hand here); Ann moves it back to the command zone.
    const died = apply(g, { type: 'manual', player: g.priority!, op: { kind: 'move', object: kinnan, to: 'graveyard' } });
    if (!died.ok) throw new Error(died.error);
    g = died.state;
    expect(g.pending).toEqual({ kind: 'commander_zone', player: 'p1', object: kinnan, zone: 'graveyard' });
    run({ type: 'choose', player: 'p1', answer: { kind: 'commander_zone', move: true } });
    expect(g.objects[kinnan]!.zone).toBe('command');
    const lands = () => g.zones.battlefield.filter((id) => g.objects[id]!.controller === 'p1').length;
    const second = untilCastable();
    // {G}{U} plus {2} of commander tax: four lands.
    expect(lands()).toBeGreaterThanOrEqual(4);
    run(second!);
    expect(g.commanderCasts[kinnan]).toBe(2);
  });

  it('"to the end step" passes through the rest of the turn and stops there, where the seat usually wouldn\'t', () => {
    const { g } = keepBoth();
    // With the usual stops, passing from the first main phase of turn 1 runs to the second, then on to the next turn.
    const until: PassUntil = { player: 'p1', turn: g.turn, step: 'end' };
    const r = step(g, { type: 'pass', player: 'p1' }, { ...ctx, passUntil: until });
    if (!r.ok) throw new Error(r.error);
    const end = r.applied.state;
    expect([end.turn, end.step, end.priority, end.stack.length]).toEqual([g.turn, 'end', 'p1', 0]);
    // It's done once reached: the next pass is an ordinary one (here, on to Ben's turn).
    expect(passUntilDone(end, until)).toBe(true);
    expect(passUntilDone(g, until)).toBe(false);
    expect(shouldAutoPass(end, 'p1', DEFAULT_STOPS, until)).toBe(false);
    expect(peekPass(end, 'p1', ctx)).toEqual({ kind: 'end' });
  });

  it('ending the turn before combat attacks with nothing rather than asking', () => {
    let { g } = keepBoth();
    const run = (a: Action, c: Ctx = ctx) => {
      const r = step(g, a, c);
      if (!r.ok) throw new Error(`${JSON.stringify(a)}: ${r.error}`);
      g = r.applied.state;
    };
    // Ann gets a creature that could attack onto the battlefield, then comes back round to her next turn.
    const bears = g.zones.hand.p1!.find((id) => g.objects[id]!.card === 'Grizzly Bears') ?? g.zones.library.p1!.find((id) => g.objects[id]!.card === 'Grizzly Bears')!;
    run({ type: 'manual', player: 'p1', op: { kind: 'move', object: bears, to: 'battlefield' } });
    run({ type: 'pass', player: 'p1' }, { ...ctx, passUntil: { player: 'p1', turn: g.turn } });
    expect(g.active).toBe('p2');
    run({ type: 'pass', player: 'p2' }, { ...ctx, passUntil: { player: 'p2', turn: g.turn } });
    // Ben drew to eight on the draw: he discards down at cleanup.
    if (g.pending?.kind === 'discard_to_hand_size') run({ type: 'choose', player: 'p2', answer: { kind: 'discard_to_hand_size', objects: g.zones.hand.p2!.slice(0, g.pending.count) } });
    expect([g.active, g.step, g.priority]).toEqual(['p1', 'main1', 'p1']);
    // An ordinary pass from the main phase stops to ask what attacks…
    const asked = step(g, { type: 'pass', player: 'p1' }, ctx);
    expect(asked.ok && asked.applied.state.pending?.kind).toBe('declare_attackers');
    // …"to the end step" doesn't: nothing attacks, and Ann is in her end step.
    run({ type: 'pass', player: 'p1' }, { ...ctx, passUntil: { player: 'p1', turn: g.turn, step: 'end' } });
    expect([g.step, g.priority, g.pending]).toEqual(['end', 'p1', null]);
    expect(g.objects[bears]!.tapped).toBe(false);
  });

  it('"to the end step" works on another player\'s turn too', () => {
    let { g } = keepBoth();
    // Ann ends her turn; Ben's begins, and Ben stops in his first main phase.
    const endTurn = step(g, { type: 'pass', player: 'p1' }, { ...ctx, passUntil: { player: 'p1', turn: g.turn } });
    if (!endTurn.ok) throw new Error(endTurn.error);
    g = endTurn.applied.state;
    expect([g.active, g.step, g.priority]).toEqual(['p2', 'main1', 'p2']);
    // Ann asks to be stopped at Ben's end step; Ben passes through his turn.
    const until: PassUntil = { player: 'p1', turn: g.turn, step: 'end' };
    for (let i = 0; i < 12 && !(g.step === 'end' && g.priority === 'p1'); i++) {
      if (g.pending?.kind === 'declare_attackers') {
        const r = step(g, { type: 'choose', player: 'p2', answer: { kind: 'declare_attackers', attacks: [] } }, { ...ctx, passUntil: until });
        if (!r.ok) throw new Error(r.error);
        g = r.applied.state;
        continue;
      }
      const r = step(g, { type: 'pass', player: g.priority! }, { ...ctx, passUntil: until });
      if (!r.ok) throw new Error(r.error);
      g = r.applied.state;
    }
    expect([g.active, g.step, g.priority]).toEqual(['p2', 'end', 'p1']);
  });

  it('refuses an illegal action without changing anything', () => {
    const { g } = keepBoth();
    const r = step(g, { type: 'pass', player: 'p2' }, ctx);
    expect(r.ok).toBe(false);
  });
});
