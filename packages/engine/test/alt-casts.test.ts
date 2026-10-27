import { describe, expect, it } from 'vitest';
import { hasKeyword, legalActions, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{1}', ...extra });

const CARDS = [
  card('Blitzer', 'Creature — Goblin', 'Blitz {R}', { mana_cost: '{3}{R}', power: '2', toughness: '2' }),
  card('Warper', 'Creature — Construct', 'Warp {R}', { mana_cost: '{4}{R}', power: '3', toughness: '3' }),
  card('Shatter Storm', 'Instant', "Destroy target artifact you don't control.\nOverload {3}{R}", { mana_cost: '{R}' }),
  card('Rock', 'Artifact', ''),
  makeCard({
    name: 'Commit Lite // Memory Lite',
    layout: 'split',
    type_line: 'Instant // Sorcery',
    oracle_text: '',
    mana_cost: '{1}{U} // {1}{U}',
    card_faces: [
      { object: 'card_face', name: 'Commit Lite', type_line: 'Instant', mana_cost: '{1}{U}', oracle_text: 'Draw a card.' },
      { object: 'card_face', name: 'Memory Lite', type_line: 'Sorcery', mana_cost: '{1}{U}', oracle_text: 'Aftermath\nYou gain 4 life.' },
    ],
  } as never),
  makeCard({
    name: 'Haunted Lite // Ghost Lite',
    layout: 'transform',
    type_line: 'Creature — Human // Creature — Spirit',
    oracle_text: '',
    mana_cost: '{1}{W}',
    card_faces: [
      { object: 'card_face', name: 'Haunted Lite', type_line: 'Creature — Human', mana_cost: '{1}{W}', power: '2', toughness: '2', oracle_text: 'Disturb {1}{W}' },
      { object: 'card_face', name: 'Ghost Lite', type_line: 'Creature — Spirit', mana_cost: '', power: '1', toughness: '1', oracle_text: "Flying\nIf Ghost Lite would be put into a graveyard from anywhere, exile it instead." },
    ],
  } as never),
];

function setup(): GameState {
  const g = toStep(start({ extra: CARDS }), 'main1');
  g.players.alice!.pool = { W: 5, U: 5, B: 0, R: 5, G: 0, C: 5 };
  return g;
}
function settle(g: GameState): GameState {
  for (let i = 0; i < 40 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const find = (g: GameState, name: string) => g.zones.battlefield.find((id) => g.objects[id]!.card === name);

describe('alternative ways to cast', () => {
  it('CR 702.152a: blitz — haste, sacrificed at the next end step, and a card when it dies', () => {
    let g = setup();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Blitzer', 'hand'), alt: 'blitz' }));
    const blitzer = find(g, 'Blitzer')!;
    expect(hasKeyword(g, g.objects[blitzer]!, 'haste')).toBe(true);
    const hand = g.zones.hand.alice!.length;
    g = toStep(g, 'end');
    g = settle(g);
    expect(g.objects[blitzer]!.zone).toBe('graveyard');
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('CR 702.185a: warp — exiled at the next end step; castable from exile on a later turn', () => {
    let g = setup();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Warper', 'hand'), alt: 'warp' }));
    const warper = find(g, 'Warper')!;
    g = settle(toStep(g, 'end'));
    expect(g.objects[warper]!.zone).toBe('exile');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === warper)).toBe(false);
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 5, G: 0, C: 5 };
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === warper)).toBe(true);
  });

  it('CR 702.96b: overload — “target” becomes “each”', () => {
    let g = setup();
    const rocks = [give(g, 'bob', 'Rock', 'battlefield'), give(g, 'bob', 'Rock', 'battlefield')];
    const mine = give(g, 'alice', 'Rock', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Shatter Storm', 'hand'), alt: 'overload' }));
    expect(rocks.map((id) => g.objects[id]!.zone)).toEqual(['graveyard', 'graveyard']);
    expect(g.objects[mine]!.zone).toBe('battlefield');
  });

  it('CR 702.127a: aftermath — that half only from the graveyard, then exiled', () => {
    let g = setup();
    const split = give(g, 'alice', 'Commit Lite // Memory Lite', 'hand');
    expect(() => act(g, { type: 'cast', player: 'alice', object: split, face: 1 })).toThrow(/graveyard/);
    g = settle(act(g, { type: 'cast', player: 'alice', object: split }));
    expect(g.objects[split]!.zone).toBe('graveyard');
    const cast = legalActions(g, 'alice').find((a) => a.type === 'cast' && a.object === split);
    expect(cast).toMatchObject({ face: 1 });
    g = settle(act(g, cast!));
    expect(g.players.alice!.life).toBe(24);
    expect(g.objects[split]!.zone).toBe('exile');
  });

  it('CR 702.146a: disturb — cast transformed from the graveyard', () => {
    let g = setup();
    const card = give(g, 'alice', 'Haunted Lite // Ghost Lite', 'graveyard');
    const cast = legalActions(g, 'alice').find((a) => a.type === 'cast' && a.object === card);
    expect(cast).toMatchObject({ alt: 'disturb' });
    g = settle(act(g, cast!));
    expect(g.objects[card]!.zone).toBe('battlefield');
    expect(g.objects[card]!.face).toBe(1);
    expect(hasKeyword(g, g.objects[card]!, 'flying')).toBe(true);
  });
});
