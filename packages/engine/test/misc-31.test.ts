import { describe, expect, it } from 'vitest';
import { legalActions, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{1}', ...extra });

const CARDS = [
  card('Leyline Lite', 'Enchantment', 'If this card is in your opening hand, you may begin the game with it on the battlefield.', { mana_cost: '{2}{G}{G}' }),
  card('Public Well', 'Artifact', '{1}: You gain 1 life. Any player may activate this ability.'),
  card('Firebreather Lite', 'Creature — Shapeshifter', '{R}: This creature gets +1/+0 until end of turn. Activate no more than twice each turn.', { power: '1', toughness: '1' }),
  card('Drone Lite', 'Artifact Creature — Drone', 'This creature enters with two +1/+1 counters on it.\nWhen this creature dies, put its counters on target creature you control.', { power: '0', toughness: '0' }),
  card('Grizzly', 'Creature — Bear', '', { power: '2', toughness: '2' }),
  card('Murder Lite', 'Instant', 'Destroy target creature.'),
  card('Relay Lite', 'Sorcery', 'Exile the top card of your library. During your next turn, you may play that card.'),
];

function setup(): GameState {
  const g = toStep(start({ extra: CARDS }), 'main1');
  g.players.alice!.pool = { W: 0, U: 0, B: 5, R: 5, G: 5, C: 5 };
  g.players.bob!.pool = { W: 0, U: 0, B: 5, R: 5, G: 5, C: 5 };
  return g;
}
function settle(g: GameState): GameState {
  for (let i = 0; i < 40 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}

describe('CR 103.6a: beginning the game with a card on the battlefield', () => {
  it('after mulligans, in turn order, each player may put their leylines onto the battlefield', () => {
    let g = start({ extra: CARDS, mulligan: true, decks: { alice: Array.from({ length: 40 }, () => 'Leyline Lite'), bob: Array.from({ length: 40 }, () => 'Forest') } });
    while (g.pending?.kind === 'mulligan') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'mulligan', keep: true } });
    expect(g.pending).toMatchObject({ kind: 'opening_battlefield', player: 'alice' });
    const picks = (g.pending as { candidates: string[] }).candidates.slice(0, 2);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'opening_battlefield', objects: picks } });
    expect(g.started).toBe(true);
    expect(picks.every((id) => g.objects[id]!.zone === 'battlefield')).toBe(true);
    expect(g.zones.hand.alice).toHaveLength(5);
  });
});

describe('activation rules', () => {
  it('CR 602.2: “Any player may activate this ability” — the activator controls it', () => {
    let g = setup();
    const well = give(g, 'alice', 'Public Well', 'battlefield');
    g = act(g, { type: 'pass', player: 'alice' });
    expect(legalActions(g, 'bob').some((a) => a.type === 'activate' && a.object === well)).toBe(true);
    g = settle(act(g, { type: 'activate', player: 'bob', object: well, ability: 0 }));
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([20, 21]);
  });

  it('“Activate no more than twice each turn.”', () => {
    let g = setup();
    const fb = give(g, 'alice', 'Firebreather Lite', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: fb, ability: 0 }));
    g = settle(act(g, { type: 'activate', player: 'alice', object: fb, ability: 0 }));
    expect(() => act(g, { type: 'activate', player: 'alice', object: fb, ability: 0 })).toThrow(/2 times/);
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === fb)).toBe(false);
  });
});

describe('more effects', () => {
  it('“When this creature dies, put its counters on target creature you control.”', () => {
    let g = setup();
    const bear = give(g, 'alice', 'Grizzly', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Drone Lite', 'hand') }));
    const drone = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Drone Lite')!;
    expect(g.objects[drone]!.counters['+1/+1']).toBe(2);
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder Lite', 'hand'), targets: [[{ kind: 'object', object: drone }]] });
    g = settle(g);
    if (g.pending?.kind === 'trigger_targets') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: bear }]] } }));
    expect(g.objects[bear]!.counters['+1/+1']).toBe(2);
  });

  it('“During your next turn, you may play that card.” — not this turn, but next turn', () => {
    let g = setup();
    const top = g.zones.library.alice![0]!;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Relay Lite', 'hand') }));
    expect(g.objects[top]!.zone).toBe('exile');
    expect(legalActions(g, 'alice').some((a) => a.type === 'play_land' && a.object === top)).toBe(false);
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    expect(legalActions(g, 'alice').some((a) => a.type === 'play_land' && a.object === top)).toBe(true);
  });
});
