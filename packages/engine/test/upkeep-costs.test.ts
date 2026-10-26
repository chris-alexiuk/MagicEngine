import { describe, expect, it } from 'vitest';
import { legalActions, type GameState } from '../src/index.js';
import { act, give, makeCard, passRound, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, ...extra });

const CARDS = [
  card('Mystic Remora Lite', 'Enchantment', 'Cumulative upkeep {1}', { mana_cost: '{U}' }),
  card('Echo Beast', 'Creature — Beast', 'Echo {2}{G}', { mana_cost: '{2}{G}', power: '4', toughness: '4' }),
  card('Convoke Wave', 'Sorcery', 'Convoke\nYou gain 5 life.', { mana_cost: '{3}{G}' }),
  card('Delve Draw', 'Instant', 'Delve\nDraw two cards.', { mana_cost: '{4}{U}' }),
  card('Improvise Bolt', 'Instant', 'Improvise\nImprovise Bolt deals 3 damage to any target.', { mana_cost: '{2}{R}' }),
  card('Green Elf', 'Creature — Elf', '', { mana_cost: '{G}', power: '1', toughness: '1', colors: ['G'] }),
  card('Trinket', 'Artifact', '', { mana_cost: '{1}' }),
];

function setup(): GameState {
  return toStep(start({ extra: CARDS }), 'main1');
}

describe('CR 702.24a: cumulative upkeep', () => {
  it('an age counter each upkeep, then pay for each one or sacrifice it', () => {
    let g = setup();
    const remora = give(g, 'alice', 'Mystic Remora Lite', 'battlefield');
    g = toStep(g, 'upkeep', 'bob');
    g = toStep(g, 'upkeep', 'alice');
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'pay', player: 'alice', cost: '{1}' });
    g.players.alice!.pool.C = 1;
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true } });
    expect(g.objects[remora]!.counters.age).toBe(1);
    g = toStep(g, 'upkeep', 'bob');
    g = toStep(g, 'upkeep', 'alice');
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'pay', cost: '{1}{1}' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: false } });
    expect(g.objects[remora]!.zone).toBe('graveyard');
  });
});

describe('CR 702.30a: echo', () => {
  it('pay the echo cost in the first upkeep after it arrives, not later', () => {
    let g = setup();
    const beast = give(g, 'alice', 'Echo Beast', 'battlefield');
    g = toStep(g, 'upkeep', 'bob');
    g = toStep(g, 'upkeep', 'alice');
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'pay', player: 'alice', cost: '{2}{G}' });
    g.players.alice!.pool.G = 3;
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true } });
    expect(g.objects[beast]!.zone).toBe('battlefield');
    g = toStep(g, 'upkeep', 'bob');
    g = toStep(g, 'draw', 'alice');
    expect(g.objects[beast]!.zone).toBe('battlefield');
  });

  it('declining sacrifices it', () => {
    let g = setup();
    const beast = give(g, 'alice', 'Echo Beast', 'battlefield');
    g = toStep(g, 'upkeep', 'bob');
    g = toStep(g, 'upkeep', 'alice');
    g = passRound(g);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: false } });
    expect(g.objects[beast]!.zone).toBe('graveyard');
  });
});

describe('paying with permanents and cards (CR 702.51a, 702.66a, 702.126a)', () => {
  it('convoke: creatures pay a colored or generic mana each', () => {
    let g = setup();
    const elves = [0, 1, 2, 3].map(() => give(g, 'alice', 'Green Elf', 'battlefield'));
    const wave = give(g, 'alice', 'Convoke Wave', 'hand');
    const options = legalActions(g, 'alice').filter((a) => a.type === 'cast' && a.object === wave);
    expect(options).toHaveLength(1);
    g = passRound(act(g, options[0]!));
    expect(g.players.alice!.life).toBe(25);
    expect(elves.every((id) => g.objects[id]!.tapped)).toBe(true);
  });

  it('delve: cards exiled from the graveyard pay generic mana', () => {
    let g = setup();
    g.players.alice!.pool.U = 1;
    const cards = [0, 1, 2, 3].map(() => give(g, 'alice', 'Green Elf', 'graveyard'));
    const draw = give(g, 'alice', 'Delve Draw', 'hand');
    const hand = g.zones.hand.alice!.length;
    g = passRound(act(g, { type: 'cast', player: 'alice', object: draw, costs: { delve: cards } }));
    expect(cards.every((id) => g.objects[id]!.zone === 'exile')).toBe(true);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('improvise: artifacts pay generic mana, not colored', () => {
    let g = setup();
    g.players.alice!.pool.R = 1;
    const trinkets = [0, 1].map(() => give(g, 'alice', 'Trinket', 'battlefield'));
    const bolt = give(g, 'alice', 'Improvise Bolt', 'hand');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: bolt, costs: { improvise: trinkets }, targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.players.bob!.life).toBe(17);
  });
});
