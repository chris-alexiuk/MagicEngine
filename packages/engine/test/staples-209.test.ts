import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const answerAll = (g: GameState): GameState => {
  for (let i = 0; i < 12 && g.pending; i++) {
    const p = g.pending as { kind: string; player: string; candidates?: string[]; options?: { id: string }[] };
    const answer = p.kind === 'may' ? { kind: 'may', yes: true } : { kind: p.kind === 'search' ? 'search' : 'choose_objects', objects: (p.candidates ?? []).slice(0, 1) };
    g = act(g, { type: 'choose', player: p.player, answer } as never);
    for (let j = 0; j < 20 && g.stack.length && !g.pending; j++) g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
};

const CARDS = [
  makeCard({ name: 'Season Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Choose up to five {P} worth of modes. You may choose the same mode more than once.\n{P} — You gain 1 life.\n{P}{P} — Draw a card.\n{P}{P}{P} — Target player loses 3 life.' }),
  makeCard({ name: 'Jumper Lite', type_line: 'Creature — Rabbit Mercenary', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Vigilance\nWhen this creature enters, if an opponent controls more lands than you, you may search your library for a Plains card and put it onto the battlefield tapped. Then if an opponent controls more lands than you, repeat this process once. If you search your library this way, shuffle.' }),
  makeCard({ name: 'Plains', type_line: 'Basic Land — Plains', mana_cost: '', oracle_text: '({T}: Add {W}.)' }),
  makeCard({ name: 'Commandeer Lite', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Gain control of target noncreature spell. You may choose new targets for it.' }),
  makeCard({ name: 'Insight Lite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw two cards.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const main = () => toStep(start({ extra: CARDS }), 'main1', 'alice');
const cast = (g: GameState, modes: number[], targets: unknown[][] = []) => ({ type: 'cast', player: 'alice', object: give(g, 'alice', 'Season Lite', 'hand'), modes, targets }) as never;

describe('slice 284: pawprint modes (CR 700.2i)', () => {
  it('modes add up to no more than five {P}; the same mode may be chosen again, each time with its own targets', () => {
    let g = main();
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, cast(g, [0, 0, 1])));
    expect([g.players.alice!.life, g.zones.hand.alice!.length]).toEqual([22, hand + 1]);
    expect(illegal(g, cast(g, [2, 2], [[{ kind: 'player', player: 'bob' }], [{ kind: 'player', player: 'bob' }]]))).toMatch(/5 \{P\}/);
    expect(illegal(g, cast(g, [0, 0, 0, 0, 0, 0]))).toBeTruthy();
    g = settle(act(g, cast(g, [1, 2], [[{ kind: 'player', player: 'bob' }]])));
    expect(g.players.bob!.life).toBe(17);
    g = settle(act(g, cast(g, [0, 0, 0, 0, 0])));
    expect(g.players.alice!.life).toBe(27);
  });
  it('Claim Jumper: a second Plains only if an opponent still controls more lands', () => {
    for (const [theirs, expected] of [[3, 3], [2, 2]] as const) {
      let g = main();
      for (let i = 0; i < theirs; i++) give(g, 'bob', 'Plains', 'battlefield');
      give(g, 'alice', 'Plains', 'battlefield');
      for (let i = 0; i < 3; i++) give(g, 'alice', 'Plains', 'library');
      g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Jumper Lite', 'hand') } as never);
      g = answerAll(settle(g));
      g = answerAll(settle(g));
      const mine = g.zones.battlefield.filter((id) => g.objects[id]!.controller === 'alice' && g.cards[g.objects[id]!.card]!.name === 'Plains').length;
      expect(mine).toBe(expected);
    }
  });
  it('Commandeer: the spell resolves for its new controller', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const insight = give(g, 'bob', 'Insight Lite', 'hand');
    g = act(g, { type: 'cast', player: 'bob', object: insight } as never);
    g = act(g, { type: 'pass', player: 'bob' });
    const [mine, theirs] = [g.zones.hand.alice!.length, g.zones.hand.bob!.length];
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Commandeer Lite', 'hand'), targets: [[{ kind: 'object', object: insight }]] } as never);
    for (let i = 0; i < 20 && (g.stack.length || g.pending); i++) {
      if (g.pending) g = act(g, { type: 'choose', player: (g.pending as { player: string }).player, answer: { kind: 'may', yes: false } } as never);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect([g.zones.hand.alice!.length, g.zones.hand.bob!.length]).toEqual([mine + 2, theirs]);
  });
});
