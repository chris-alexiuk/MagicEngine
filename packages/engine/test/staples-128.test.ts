import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Pact', type_line: 'Instant', mana_cost: '{0}', oracle_text: "You gain 1 life. At the beginning of your next upkeep, pay {1}{G}. If you don't, you lose the game." }),
  makeCard({ name: 'Drain', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Counter target spell. At the beginning of your next main phase, add an amount of {C} equal to that spell's mana value." }),
  makeCard({ name: 'Big Spell', type_line: 'Sorcery', mana_cost: '{3}{G}', cmc: 4, oracle_text: 'You gain 5 life.' }),
  makeCard({ name: 'Beacon', type_line: 'Land', mana_cost: '', oracle_text: '{T}, Sacrifice this land: Put your commander into your hand from the command zone.' }),
  makeCard({ name: 'Shift', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Exile target creature. Its controller manifests the top card of their library.' }),
  makeCard({ name: 'Mind Rot', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target player discards two cards at random.' }),
  makeCard({ name: 'Clique', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Put target creature card from an opponent's graveyard onto the battlefield under your control. It gains haste. At the beginning of your next end step, exile it." }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Legend', type_line: 'Legendary Creature — Elf', mana_cost: '{G}', power: '1', toughness: '1', oracle_text: '' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 30 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}

describe('staples (slice 128)', () => {
  it('the pacts: "At the beginning of your next upkeep, pay {1}{G}. If you don\'t, you lose the game."', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Pact', 'hand') }));
    expect(g.delayed).toHaveLength(1);
    // Not on Bob's turn.
    g = toStep(g, 'draw', 'bob');
    expect(g.delayed).toHaveLength(1);
    g = toStep(g, 'upkeep', 'alice');
    for (let i = 0; i < 10 && !g.pending && g.stack.length; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.pending).toMatchObject({ kind: 'pay', player: 'alice', cost: '{1}{G}' });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: false } }));
    expect(g.players.alice!.lost).toBe(true);
  });

  it('Mana Drain: {C} equal to the countered spell\'s mana value, at your next main phase', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    g.players.bob!.pool.G = 4;
    const big = give(g, 'bob', 'Big Spell', 'hand');
    g = act(g, { type: 'cast', player: 'bob', object: big });
    g = act(g, { type: 'pass', player: 'bob' });
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Drain', 'hand'), targets: [[{ kind: 'object', object: big }]] }));
    expect(g.objects[big]!.zone).toBe('graveyard');
    expect(g.players.alice!.pool.C).toBe(0);
    g = toStep(g, 'main1', 'alice');
    g = settle(g);
    expect(g.players.alice!.pool.C).toBe(4);
  });

  it('Command Beacon: the commander from the command zone to your hand', () => {
    let g = toStep(start({ format: 'commander', extra: CARDS, decks: { alice: [...Array(97).fill('Bear'), 'Legend', 'Beacon'], bob: Array(99).fill('Bear') }, commanders: { alice: ['Legend'] } }), 'main1', 'alice');
    const beacon = give(g, 'alice', 'Beacon', 'battlefield');
    const cmdr = Object.values(g.objects).find((o) => o.commander && o.owner === 'alice')!;
    expect(cmdr.zone).toBe('command');
    g = settle(act(g, { type: 'activate', player: 'alice', object: beacon, ability: 0 }));
    expect(g.objects[cmdr.id]!.zone).toBe('hand');
  });

  it('Reality Shift: its controller manifests', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Shift', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[bear]!.zone).toBe('exile');
    const down = g.zones.battlefield.map((id) => g.objects[id]!).filter((o) => o.faceDown === 'manifest');
    expect(down.map((o) => o.controller)).toEqual(['bob']);
  });

  it('"discards two cards at random": no choice', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const before = g.zones.hand.bob!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mind Rot', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.pending).toBeNull();
    expect(g.zones.hand.bob!.length).toBe(before - 2);
  });

  it('a delayed "exile it" follows the target it put onto the battlefield (CR 603.7c)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'graveyard');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Clique', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    g = settle(toStep(g, 'end', 'alice'));
    expect(g.objects[bear]!.zone).toBe('exile');
  });
});
