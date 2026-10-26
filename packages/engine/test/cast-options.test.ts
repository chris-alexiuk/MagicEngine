import { describe, expect, it } from 'vitest';
import { hasKeyword, legalActions, type GameState } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, ...extra });

const CARDS = [
  card('Mulldrifter Lite', 'Creature — Fish', 'Flying\nWhen this creature enters, draw two cards.\nEvoke {2}{U}', { mana_cost: '{4}{U}', power: '2', toughness: '2' }),
  card('Dash Goblin', 'Creature — Goblin', 'Dash {R}', { mana_cost: '{3}{R}', power: '3', toughness: '2' }),
  card('Buyback Bolt', 'Instant', 'Buyback {3}\nBuyback Bolt deals 1 damage to any target.', { mana_cost: '{R}' }),
  card('Escape Titan', 'Creature — Giant', 'Escape—{R}{R}, Exile two other cards from your graveyard.', { mana_cost: '{3}{R}', power: '4', toughness: '4' }),
  card('Twin Choice', 'Sorcery', 'Choose one —\n• You gain 3 life.\n• Draw a card.\nEntwine {2}', { mana_cost: '{1}' }),
  card('Cheap Trick', 'Sorcery', 'You may pay {R} rather than pay this spell\'s mana cost.\nCheap Trick deals 2 damage to any target.', { mana_cost: '{5}{R}' }),
];

const bob = { kind: 'player' as const, player: 'bob' };

function setup(): GameState {
  const g = toStep(start({ extra: CARDS }), 'main1');
  g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  return g;
}

describe('CR 118.9: alternative costs', () => {
  it('evoke (CR 702.74a): cast for the evoke cost, it enters, its enters ability triggers, and it’s sacrificed', () => {
    let g = setup();
    g.players.alice!.pool.U = 3;
    const fish = give(g, 'alice', 'Mulldrifter Lite', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: fish })).toMatch(/mana/);
    const hand = g.zones.hand.alice!.length;
    g = passRound(act(g, { type: 'cast', player: 'alice', object: fish, alt: 'evoke' }));
    // Both triggers are on the stack; resolve them.
    while (g.stack.length) g = passRound(g);
    expect(g.objects[fish]!.zone).toBe('graveyard');
    expect(g.zones.hand.alice!.length).toBe(hand - 1 + 2);
  });

  it('dash (CR 702.109a): haste, then back to its owner’s hand at the next end step', () => {
    let g = setup();
    g.players.alice!.pool.R = 1;
    const gob = give(g, 'alice', 'Dash Goblin', 'hand');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: gob, alt: 'dash' }));
    g = passRound(g); // the delayed-return setup trigger
    expect(g.objects[gob]!.zone).toBe('battlefield');
    expect(hasKeyword(g, g.objects[gob]!, 'haste')).toBe(true);
    g = passRound(toStep(g, 'end'));
    expect(g.objects[gob]!.zone).toBe('hand');
  });

  it('a plain alternative cost (“You may pay {R} rather than pay this spell’s mana cost”) is offered as a legal action', () => {
    let g = setup();
    g.players.alice!.pool.R = 1;
    const trick = give(g, 'alice', 'Cheap Trick', 'hand');
    const options = legalActions(g, 'alice').filter((a) => a.type === 'cast' && a.object === trick);
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ alt: 'alt' });
    g = passRound(act(g, { type: 'cast', player: 'alice', object: trick, alt: 'alt', targets: [[bob]] }));
    expect(g.players.bob!.life).toBe(18);
  });

  it('escape (CR 702.138a): from the graveyard, exiling other cards', () => {
    let g = setup();
    g.players.alice!.pool.R = 2;
    const titan = give(g, 'alice', 'Escape Titan', 'graveyard');
    const a = give(g, 'alice', 'Grizzly Bears', 'graveyard');
    const b = give(g, 'alice', 'Grizzly Bears', 'graveyard');
    const options = legalActions(g, 'alice').filter((x) => x.type === 'cast' && x.object === titan);
    expect(options).toHaveLength(1);
    g = passRound(act(g, options[0]!));
    expect(g.objects[titan]!.zone).toBe('battlefield');
    expect([g.objects[a]!.zone, g.objects[b]!.zone]).toEqual(['exile', 'exile']);
  });
});

describe('CR 601.2f: optional additional costs', () => {
  it('buyback (CR 702.27a): it returns to its owner’s hand as it resolves', () => {
    let g = setup();
    g.players.alice!.pool.R = 4;
    const bolt = give(g, 'alice', 'Buyback Bolt', 'hand');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: bolt, extras: ['buyback'], autoTap: true, targets: [[bob]] }));
    expect(g.players.bob!.life).toBe(19);
    expect(g.objects[bolt]!.zone).toBe('hand');
    g.players.alice!.pool.R = 1;
    g = passRound(act(g, { type: 'cast', player: 'alice', object: bolt, targets: [[bob]] }));
    expect(g.objects[bolt]!.zone).toBe('graveyard');
  });

  it('entwine (CR 702.42a): every mode, for the extra cost', () => {
    let g = setup();
    g.players.alice!.pool.C = 3;
    const hand = g.zones.hand.alice!.length;
    const spell = give(g, 'alice', 'Twin Choice', 'hand');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: spell, extras: ['entwine'] }));
    expect(g.players.alice!.life).toBe(23);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });
});
