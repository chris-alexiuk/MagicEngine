import { describe, expect, it } from 'vitest';
import { power, toughness, type GameState } from '../src/index.js';
import { act, give, makeCard, passRound, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{B}', ...extra });

const CARDS = [
  card('Time Walk', 'Sorcery', 'Take an extra turn after this one.', { mana_cost: '{U}' }),
  card('About Face', 'Instant', "Switch target creature's power and toughness until end of turn.", { mana_cost: '{R}' }),
  card('Blood Rite', 'Sorcery', "As an additional cost to cast this spell, sacrifice a creature.\nYou gain life equal to the sacrificed creature's toughness."),
  card('Finisher', 'Instant', 'Destroy target creature that was dealt damage this turn.'),
  card('Zap', 'Instant', 'Zap deals 1 damage to any target.', { mana_cost: '{R}' }),
  card('Tribal Call', 'Sorcery', 'Choose a creature type. Creatures of the chosen type get +1/+1 until end of turn.', { mana_cost: '{G}' }),
  card('Acquire', 'Sorcery', "Search target opponent's library for an artifact card and put that card onto the battlefield under your control. Then that player shuffles.", { mana_cost: '{U}' }),
  card('Trinket', 'Artifact', '', { mana_cost: '{1}' }),
];
const bob = { kind: 'player' as const, player: 'bob' };
const obj = (object: string) => ({ kind: 'object' as const, object });

function setup(): GameState {
  return toStep(start({ extra: CARDS }), 'main1');
}
const settle = (g: GameState) => {
  while (g.stack.length && !g.pending) g = passRound(g);
  return g;
};
const cast = (g: GameState, name: string, extra: Record<string, unknown> = {}) => {
  for (const c of ['W', 'U', 'B', 'R', 'G'] as const) g.players.alice!.pool[c] += 1;
  return passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), ...extra }));
};

describe('slice 24', () => {
  it('CR 500.7: an extra turn', () => {
    let g = settle(cast(setup(), 'Time Walk'));
    const turn = g.turn;
    g = toStep(g, 'upkeep');
    expect(g.turn).toBe(turn + 1);
    expect(g.active).toBe('alice');
    g = toStep(g, 'upkeep', 'bob');
    expect(g.turn).toBe(turn + 2);
  });

  it('CR 613.4d: switching power and toughness (after counters)', () => {
    let g = setup();
    const c = makeCard({ name: 'Wall', type_line: 'Creature — Wall', oracle_text: '', mana_cost: '{1}', power: '0', toughness: '4' });
    g.cards[c.name] = c;
    const wall = give(g, 'alice', 'Wall', 'battlefield');
    g.objects[wall]!.counters['+1/+1'] = 1;
    g = settle(cast(g, 'About Face', { targets: [[obj(wall)]] }));
    expect(power(g, g.objects[wall]!)).toBe(5);
    expect(toughness(g, g.objects[wall]!)).toBe(1);
  });

  it('“the sacrificed creature’s toughness” — as it was (CR 608.2h)', () => {
    let g = setup();
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g.objects[bears]!.counters['+1/+1'] = 2;
    g = settle(cast(g, 'Blood Rite', { costs: { sacrifice: [bears] } }));
    expect(g.players.alice!.life).toBe(24);
  });

  it('“target creature that was dealt damage this turn”', () => {
    let g = setup();
    const bears = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const fin = give(g, 'alice', 'Finisher', 'hand');
    g.players.alice!.pool.B = 1;
    expect(() => act(g, { type: 'cast', player: 'alice', object: fin, targets: [[obj(bears)]] })).toThrow();
    g = settle(cast(g, 'Zap', { targets: [[obj(bears)]] }));
    g.players.alice!.pool.B = 1;
    g = settle(passRound(act(g, { type: 'cast', player: 'alice', object: fin, targets: [[obj(bears)]] })));
    expect(g.objects[bears]!.zone).toBe('graveyard');
  });

  it('“Choose a creature type.” as it resolves, then “the chosen type”', () => {
    let g = setup();
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = cast(g, 'Tribal Call');
    expect(g.pending).toMatchObject({ kind: 'choose_option' });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: 'Bear' } }));
    expect(power(g, g.objects[bears]!)).toBe(3);
  });

  it('“Search target opponent’s library for an artifact card …” — you search theirs', () => {
    let g = setup();
    const trinket = give(g, 'bob', 'Trinket', 'library');
    g = cast(g, 'Acquire', { targets: [[bob]] });
    expect(g.pending).toMatchObject({ kind: 'search', player: 'alice' });
    if (g.pending?.kind === 'search') expect(g.pending.candidates).toContain(trinket);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [trinket] } }));
    expect(g.objects[trinket]).toMatchObject({ zone: 'battlefield', controller: 'alice' });
  });
});
