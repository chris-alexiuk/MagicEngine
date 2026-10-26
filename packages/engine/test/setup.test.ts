import { describe, expect, it } from 'vitest';
import { apply, createGame } from '../src/index.js';
import { act, CARDS, illegal, start, toStep } from './helpers.js';

const forests = Array.from({ length: 40 }, () => 'Forest');

describe('starting the game', () => {
  it('CR 103.4: each player starts at 20 life', () => {
    const g = start();
    expect(Object.values(g.players).map((p) => p.life)).toEqual([20, 20]);
  });

  it('CR 903.7: in Commander each player starts at 40 life', () => {
    const g = start({ format: 'commander', players: 4 });
    expect(Object.values(g.players).map((p) => p.life)).toEqual([40, 40, 40, 40]);
  });

  it('CR 103.5: each player draws seven cards and decides on a mulligan, starting player first', () => {
    const g = start({ mulligan: true });
    expect(g.zones.hand.alice).toHaveLength(7);
    expect(g.zones.hand.bob).toHaveLength(7);
    expect(g.zones.library.alice).toHaveLength(33);
    expect(g.pending).toEqual({ kind: 'mulligan', player: 'alice' });
  });

  it('CR 103.1: the starting player is chosen deterministically from the seed when not given', () => {
    const make = (seed: number) =>
      createGame({
        players: [
          { id: 'a', name: 'A', deck: forests },
          { id: 'b', name: 'B', deck: forests },
        ],
        cards: CARDS,
        seed,
      }).state.firstPlayer;
    expect(make(7)).toBe(make(7));
    const firsts = new Set(Array.from({ length: 20 }, (_, i) => make(i)));
    expect(firsts).toEqual(new Set(['a', 'b']));
  });

  it('CR 103.3: libraries are shuffled', () => {
    const deck = [...Array.from({ length: 20 }, () => 'Forest'), ...Array.from({ length: 20 }, () => 'Island')];
    const g = start({ mulligan: true, decks: { alice: deck, bob: deck } });
    const top = (p: string) => [...g.zones.hand[p]!, ...g.zones.library[p]!].map((id) => g.objects[id]!.card);
    expect(top('alice')).not.toEqual(deck);
  });
});

describe('London mulligan', () => {
  it('CR 103.5: a mulligan shuffles the hand back, draws seven, then puts one on the bottom', () => {
    let g = start({ mulligan: true });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'mulligan', keep: false } });
    // Everyone declares before mulligans happen.
    expect(g.pending).toEqual({ kind: 'mulligan', player: 'bob' });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'mulligan', keep: true } });
    expect(g.pending).toEqual({ kind: 'bottom_cards', player: 'alice', count: 1 });
    expect(g.zones.hand.alice).toHaveLength(7);
    const card = g.zones.hand.alice![0]!;
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'bottom_cards', objects: [card] } });
    expect(g.zones.hand.alice).toHaveLength(6);
    expect(g.zones.library.alice!.at(-1)).toBe(card);
    // The process repeats for players who mulliganed.
    expect(g.pending).toEqual({ kind: 'mulligan', player: 'alice' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'mulligan', keep: true } });
    expect(g.started).toBe(true);
    expect(g.players.alice!.mulligans).toBe(1);
  });

  it('CR 103.5c: in a multiplayer game the first mulligan is free', () => {
    let g = start({ mulligan: true, players: 3 });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'mulligan', keep: false } });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'mulligan', keep: true } });
    g = act(g, { type: 'choose', player: 'carol', answer: { kind: 'mulligan', keep: true } });
    // No bottom_cards step: straight back to Alice's decision with seven cards.
    expect(g.pending).toEqual({ kind: 'mulligan', player: 'alice' });
    expect(g.zones.hand.alice).toHaveLength(7);
  });

  it('CR 103.5: a player cannot mulligan to zero cards', () => {
    let g = start({ mulligan: true });
    for (let i = 0; i < 6; i++) {
      g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'mulligan', keep: false } });
      if (g.pending?.player === 'bob') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'mulligan', keep: true } });
      const p = g.pending!;
      if (p.kind === 'bottom_cards') {
        g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'bottom_cards', objects: g.zones.hand.alice!.slice(0, p.count) } });
      }
    }
    expect(g.zones.hand.alice).toHaveLength(1);
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'mulligan', keep: false } })).toMatch(/zero/);
  });

  it('only the deciding player can answer', () => {
    const g = start({ mulligan: true });
    expect(apply(g, { type: 'choose', player: 'bob', answer: { kind: 'mulligan', keep: true } }).ok).toBe(false);
  });
});

describe('first turn', () => {
  it('CR 103.8a: in a two-player game the starting player skips their first draw', () => {
    let g = start();
    expect(g.active).toBe('alice');
    g = toStep(g, 'main1');
    expect(g.zones.hand.alice).toHaveLength(7);
    g = toStep(g, 'main1', 'bob');
    expect(g.zones.hand.bob).toHaveLength(8);
  });

  it('CR 103.8c: in other multiplayer games nobody skips their first draw', () => {
    let g = start({ players: 3 });
    g = toStep(g, 'main1');
    expect(g.zones.hand.alice).toHaveLength(8);
  });

  it('replays identically from the same seed and actions', () => {
    const run = () => {
      let g = start({ seed: 99 });
      g = toStep(g, 'main1', 'bob');
      return g;
    };
    expect(run()).toEqual(run());
  });
});
