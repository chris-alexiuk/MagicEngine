import { describe, expect, it } from 'vitest';
import { chars, power, toughness, type GameState, type Target } from '../src/index.js';
import { act, give, makeCard, passRound, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{G}', ...extra });
const creature = (name: string, oracle_text: string, pt = '2', extra: Record<string, unknown> = {}) =>
  card(name, 'Creature — Beast', oracle_text, { power: pt, toughness: pt, ...extra });

const CARDS = [
  card('Collective Insight', 'Sorcery', 'Draw a card for each creature you control.'),
  card('Overrun Lite', 'Instant', 'Target creature gets +1/+1 until end of turn for each creature you control.'),
  card('Mind Bleed', 'Sorcery', 'Target creature gets -X/-X until end of turn, where X is the number of Forests you control.'),
  card('Heavy Strike', 'Instant', 'Destroy target creature. You gain life equal to its toughness.'),
  creature('Pack Leader', 'This creature gets +1/+1 for each other creature you control.'),
  creature('Lhurgoyf', "This creature's power and toughness are each equal to the number of creature cards in your graveyard.", '*', { power: '*', toughness: '*' }),
  creature('Spiteful Beast', 'When this creature dies, it deals damage equal to its power to any target.', '3'),
  card('Gray Merchant', 'Creature — Zombie', 'When this creature enters, each opponent loses X life, where X is your devotion to black. You gain life equal to the life lost this way.', {
    mana_cost: '{3}{B}{B}',
    power: '2',
    toughness: '4',
  }),
  card('Devotee', 'Creature — Zombie', 'When this creature enters, each opponent loses X life, where X is your devotion to black.', { mana_cost: '{B}{B}', power: '1', toughness: '1' }),
  card('Giant Growth', 'Instant', 'Target creature gets +3/+3 until end of turn.'),
];

function setup(): GameState {
  const g = toStep(start({ extra: CARDS }), 'main1');
  for (let i = 0; i < 5; i++) give(g, 'alice', 'Forest', 'battlefield');
  return g;
}
const obj = (object: string): Target => ({ kind: 'object', object });
const cast = (g: GameState, name: string, extra: Record<string, unknown> = {}) =>
  passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), autoTap: true, ...extra }));

describe('counted amounts (CR 608.2h)', () => {
  it('“draw a card for each creature you control”', () => {
    let g = setup();
    for (let i = 0; i < 3; i++) give(g, 'alice', 'Grizzly Bears', 'battlefield');
    give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = cast(g, 'Collective Insight');
    expect(g.zones.hand.alice!.length).toBe(hand + 3);
  });

  it('a one-shot pump is counted once, as it resolves', () => {
    let g = setup();
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = cast(g, 'Overrun Lite', { targets: [[obj(bears)]] });
    expect(power(g, g.objects[bears]!)).toBe(4);
    give(g, 'alice', 'Grizzly Bears', 'battlefield');
    expect(power(g, g.objects[bears]!)).toBe(4); // locked in
  });

  it('“-X/-X, where X is the number of Forests you control”', () => {
    let g = setup();
    const theirs = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = cast(g, 'Mind Bleed', { targets: [[obj(theirs)]] });
    expect(g.objects[theirs]!.zone).toBe('graveyard');
  });

  it('CR 608.2h: “its toughness” after it was destroyed is its last known toughness', () => {
    let g = setup();
    const theirs = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = cast(g, 'Giant Growth', { targets: [[obj(theirs)]] });
    g = cast(g, 'Heavy Strike', { targets: [[obj(theirs)]] });
    expect(g.objects[theirs]!.zone).toBe('graveyard');
    expect(g.players.alice!.life).toBe(25);
  });

  it('“When ~ dies, it deals damage equal to its power” uses its power as it last existed', () => {
    let g = setup();
    const beast = give(g, 'alice', 'Spiteful Beast', 'battlefield');
    g = cast(g, 'Giant Growth', { targets: [[obj(beast)]] });
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: beast, to: 'graveyard' } });
    expect(g.pending).toMatchObject({ kind: 'trigger_targets' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } });
    g = passRound(g);
    expect(g.players.bob!.life).toBe(14);
  });

  it('CR 700.5: devotion counts colored mana symbols among permanents you control', () => {
    let g = setup();
    give(g, 'alice', 'Devotee', 'battlefield'); // {B}{B}
    g.players.alice!.pool.B = 2;
    g = passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Devotee', 'hand') }));
    g = passRound(g);
    // Both Devotees count: four black symbols.
    expect(g.players.bob!.life).toBe(16);
  });
});

describe('P/T that counts (layers 7a and 7c)', () => {
  it('CR 611.3a: “+1/+1 for each other creature you control” changes as creatures come and go', () => {
    const g = setup();
    const leader = give(g, 'alice', 'Pack Leader', 'battlefield');
    expect(power(g, g.objects[leader]!)).toBe(2);
    give(g, 'alice', 'Grizzly Bears', 'battlefield');
    give(g, 'alice', 'Pack Leader', 'battlefield');
    expect(chars(g, g.objects[leader]!)).toMatchObject({ power: 4, toughness: 4 });
  });

  it('CR 604.3: a characteristic-defining P/T works on the battlefield and in other zones', () => {
    const g = setup();
    const goyf = give(g, 'alice', 'Lhurgoyf', 'battlefield');
    expect(toughness(g, g.objects[goyf]!)).toBe(0);
    give(g, 'alice', 'Grizzly Bears', 'graveyard');
    give(g, 'alice', 'Grizzly Bears', 'graveyard');
    expect(chars(g, g.objects[goyf]!)).toMatchObject({ power: 2, toughness: 2 });
    const inHand = give(g, 'alice', 'Lhurgoyf', 'hand');
    expect(power(g, g.objects[inHand]!)).toBe(2);
  });
});
