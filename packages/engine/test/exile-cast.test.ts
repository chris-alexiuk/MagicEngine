import { describe, expect, it } from 'vitest';
import { hasKeyword, legalActions, viewFor, type GameState } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, ...extra });

const CARDS = [
  card('Foretold Bolt', 'Instant', 'Foretold Bolt deals 3 damage to any target.\nForetell {R}', { mana_cost: '{2}{R}' }),
  card('Plotted Draw', 'Sorcery', 'Draw two cards.\nPlot {1}{U}', { mana_cost: '{3}{U}' }),
  card('Suspended Beast', 'Creature — Beast', 'Suspend 2—{G}', { mana_cost: '{5}{G}{G}', power: '7', toughness: '7' }),
  card('Mad Rager', 'Creature — Vampire', 'Madness {1}{B}', { mana_cost: '{3}{B}', power: '3', toughness: '3' }),
  card('Loot', 'Sorcery', 'Draw a card, then discard a card.', { mana_cost: '{U}' }),
];
const bob = { kind: 'player' as const, player: 'bob' };

function setup(): GameState {
  return toStep(start({ extra: CARDS }), 'main1');
}

describe('CR 702.143a: foretell', () => {
  it('pay {2} to exile it face down; cast it on a later turn for its foretell cost', () => {
    let g = setup();
    g.players.alice!.pool.C = 2;
    const bolt = give(g, 'alice', 'Foretold Bolt', 'hand');
    expect(legalActions(g, 'alice').some((a) => a.type === 'foretell' && a.object === bolt)).toBe(true);
    g = act(g, { type: 'foretell', player: 'alice', object: bolt });
    expect(g.objects[bolt]).toMatchObject({ zone: 'exile', foretold: g.turn });
    expect(viewFor(g, 'bob').objects[bolt]!.card).toBe('face-down');
    expect(viewFor(g, 'alice').objects[bolt]!.card).toBe('Foretold Bolt');
    g.players.alice!.pool.R = 1;
    expect(illegal(g, { type: 'cast', player: 'alice', object: bolt, alt: 'foretell', targets: [[bob]] })).toMatch(/hand|exile/);
    g = toStep(g, 'main1', 'bob');
    g.players.alice!.pool.R = 1;
    g = passRound(act(g, { type: 'pass', player: 'bob' }) as GameState);
    g = toStep(g, 'end', 'bob');
    g.players.alice!.pool.R = 1;
    g = act(g, { type: 'pass', player: 'bob' });
    g = passRound(act(g, { type: 'cast', player: 'alice', object: bolt, alt: 'foretell', targets: [[bob]] }));
    expect(g.players.bob!.life).toBe(17);
  });
});

describe('CR 702.170a: plot', () => {
  it('pay the plot cost to exile it; on a later turn cast it free as a sorcery', () => {
    let g = setup();
    g.players.alice!.pool.U = 2;
    const draw = give(g, 'alice', 'Plotted Draw', 'hand');
    g = act(g, { type: 'plot', player: 'alice', object: draw, autoTap: true });
    expect(g.objects[draw]).toMatchObject({ zone: 'exile', plotted: g.turn });
    expect(illegal(g, { type: 'cast', player: 'alice', object: draw, alt: 'plot' })).toBeTruthy();
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    const hand = g.zones.hand.alice!.length;
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === draw && a.alt === 'plot')).toBe(true);
    g = passRound(act(g, { type: 'cast', player: 'alice', object: draw, alt: 'plot' }));
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
  });
});

describe('CR 702.62a: suspend', () => {
  it('exile with time counters; one comes off each upkeep; with the last, cast it free — with haste', () => {
    let g = setup();
    g.players.alice!.pool.G = 1;
    const beast = give(g, 'alice', 'Suspended Beast', 'hand');
    g = act(g, { type: 'suspend', player: 'alice', object: beast });
    expect(g.objects[beast]).toMatchObject({ zone: 'exile', suspended: true, counters: { time: 2 } });
    g = toStep(g, 'upkeep', 'bob');
    expect(g.objects[beast]!.counters.time).toBe(2);
    g = passRound(toStep(g, 'upkeep', 'alice'));
    expect(g.objects[beast]!.counters.time).toBe(1);
    g = toStep(g, 'upkeep', 'bob');
    g = passRound(toStep(g, 'upkeep', 'alice'));
    expect(g.pending).toMatchObject({ kind: 'cast_free', object: beast });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: true } });
    g = passRound(g);
    expect(g.objects[beast]!.zone).toBe('battlefield');
    expect(hasKeyword(g, g.objects[beast]!, 'haste')).toBe(true);
  });
});

describe('CR 702.35a: madness', () => {
  it('discarded, it’s exiled instead; its owner may cast it for its madness cost, or it goes to the graveyard', () => {
    let g = toStep(start({ extra: CARDS, decks: { alice: Array.from({ length: 40 }, () => 'Forest'), bob: Array.from({ length: 40 }, () => 'Forest') } }), 'main1');
    for (const c of CARDS) g.cards[c.name] = c;
    // Only the Rager in hand, so the discard is forced.
    for (const id of [...g.zones.hand.alice!]) g.zones.library.alice!.push(...g.zones.hand.alice!.splice(g.zones.hand.alice!.indexOf(id), 1)), (g.objects[id]!.zone = 'library');
    const rager = give(g, 'alice', 'Mad Rager', 'hand');
    g.players.alice!.pool.U = 1;
    g.players.alice!.pool.B = 2;
    g = passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Loot', 'hand') }));
    if (g.pending?.kind === 'discard') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: [rager] } });
    expect(g.objects[rager]!.zone).toBe('exile');
    g = passRound(g); // the madness trigger
    expect(g.pending).toMatchObject({ kind: 'cast_free', object: rager });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'cast_free', cast: true } });
    g = passRound(g);
    expect(g.objects[rager]!.zone).toBe('battlefield');
  });
});
