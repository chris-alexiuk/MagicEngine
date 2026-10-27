import { describe, expect, it } from 'vitest';
import { hasKeyword, power, type GameState } from '../src/index.js';
import { act, give, makeCard, passRound, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{R}', ...extra });
const creature = (name: string, text: string, pt = '2/2', type = 'Creature — Human') =>
  card(name, type, text, { power: pt.split('/')[0], toughness: pt.split('/')[1] });

const CARDS = [
  creature('Racer', 'Start your engines!\nMax speed — This creature gets +2/+2.'),
  creature('Fabricator', 'Fabricate 2', '1/1', 'Artifact Creature — Construct'),
  creature('Rioter', 'Riot'),
  creature('Extorter', 'Extort', '1/1'),
  creature('Dethroner', 'Dethrone'),
  creature('Mobilizer', 'Mobilize 2'),
  creature('Evolver', 'Evolve', '1/1'),
  creature('Ascender', "Ascend\nThis creature gets +2/+2 as long as you have the city's blessing."),
  creature('Prism', 'Converge — This creature enters with a +1/+1 counter on it for each color of mana spent to cast it.', '0/0'),
  card('Zap', 'Instant', 'Zap deals 1 damage to any target.'),
  card('Signal', 'Instant', 'Draw a card.', { mana_cost: '{1}' }),
];
const bob = { kind: 'player' as const, player: 'bob' };

function setup(): GameState {
  return toStep(start({ extra: CARDS }), 'main1');
}
const settle = (g: GameState) => {
  while (g.stack.length && !g.pending) g = passRound(g);
  return g;
};
const cast = (g: GameState, name: string, extra: Record<string, unknown> = {}) => {
  g.players.alice!.pool.R += 1;
  g.players.alice!.pool.C += 1;
  return passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), ...extra }));
};
const attackWith = (g: GameState, ids: string[]) => {
  g = passRound(toStep(g, 'beginning_of_combat'));
  return act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: ids.map((attacker) => ({ attacker, target: bob })) } });
};

describe('CR 702.179: start your engines!, speed and max speed', () => {
  it('speed starts at 1 and rises once a turn when an opponent loses life on your turn; max speed at 4', () => {
    let g = setup();
    const racer = give(g, 'alice', 'Racer', 'battlefield');
    g = settle(cast(g, 'Zap', { targets: [[bob]] }));
    // Speed 1 from the keyword, then 2 from Bob's life loss.
    expect(g.players.alice!.speed).toBe(2);
    g = settle(cast(g, 'Zap', { targets: [[bob]] }));
    expect(g.players.alice!.speed).toBe(2); // only once each turn
    expect(power(g, g.objects[racer]!)).toBe(2);
    for (let turn = 0; turn < 2; turn++) {
      g = toStep(toStep(g, 'main1', 'bob'), 'main1', 'alice');
      g = settle(cast(g, 'Zap', { targets: [[bob]] }));
    }
    expect(g.players.alice!.speed).toBe(4);
    expect(power(g, g.objects[racer]!)).toBe(4);
  });
});

describe('more keywords from CR 702 (slice 21)', () => {
  it('fabricate (CR 702.123a): counters, or else Servos', () => {
    let g = cast(setup(), 'Fabricator');
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'may' });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: false } }));
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token).length).toBe(2);
  });

  it('riot (CR 702.136a): an extra counter, or haste', () => {
    let g = cast(setup(), 'Rioter');
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'counter' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', pay: false } });
    const rioter = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Rioter')!;
    expect(hasKeyword(g, g.objects[rioter]!, 'haste')).toBe(true);
    g = cast(g, 'Rioter');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', pay: true } });
    const second = g.zones.battlefield.filter((id) => g.objects[id]!.card === 'Rioter')[1]!;
    expect(g.objects[second]!.counters['+1/+1']).toBe(1);
    expect(hasKeyword(g, g.objects[second]!, 'haste')).toBe(false);
  });

  it('extort (CR 702.101a): each opponent loses 1, you gain what was lost', () => {
    let g = setup();
    give(g, 'alice', 'Extorter', 'battlefield');
    g.players.alice!.pool.W = 1;
    g = cast(g, 'Signal');
    expect(g.pending).toMatchObject({ kind: 'pay', cost: '{W/B}' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true } });
    g = settle(g);
    expect(g.players.bob!.life).toBe(19);
    expect(g.players.alice!.life).toBe(21);
  });

  it('dethrone (CR 702.105a) and mobilize (CR 702.181a)', () => {
    let g = setup();
    const d = give(g, 'alice', 'Dethroner', 'battlefield');
    const m = give(g, 'alice', 'Mobilizer', 'battlefield');
    g = settle(attackWith(g, [d, m]));
    // Tied for most life: a counter.
    expect(g.objects[d]!.counters['+1/+1']).toBe(1);
    const warriors = g.zones.battlefield.filter((id) => g.objects[id]!.token);
    expect(warriors).toHaveLength(2);
    for (const w of warriors) {
      expect(g.objects[w]!.tapped).toBe(true);
      expect(g.combat?.attackers[w]?.target).toEqual(bob);
    }
    g = toStep(g, 'end');
    g = settle(g);
    expect(warriors.every((w) => g.objects[w]?.zone !== 'battlefield')).toBe(true);
  });

  it('evolve (CR 702.100a): a bigger creature entering adds a counter', () => {
    let g = setup();
    const evolver = give(g, 'alice', 'Evolver', 'battlefield');
    g = settle(cast(g, 'Rioter'));
    if (g.pending?.kind === 'as_enters') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', pay: true } }));
    expect(g.objects[evolver]!.counters['+1/+1']).toBe(1);
  });

  it('ascend (CR 702.131b): ten permanents give the city’s blessing for good', () => {
    let g = setup();
    const a = give(g, 'alice', 'Ascender', 'battlefield');
    for (let i = 0; i < 8; i++) give(g, 'alice', 'Forest', 'battlefield');
    g = cast(g, 'Signal');
    expect(g.players.alice!.cityBlessing).toBeUndefined();
    give(g, 'alice', 'Forest', 'battlefield');
    g = settle(cast(g, 'Signal'));
    expect(g.players.alice!.cityBlessing).toBe(true);
    expect(power(g, g.objects[a]!)).toBe(4);
  });

  it('converge: a counter for each color of mana spent', () => {
    let g = setup();
    g.players.alice!.pool.W = 1;
    g.players.alice!.pool.G = 1;
    const prism = makeCard({ name: 'Prism2', type_line: 'Creature — Golem', oracle_text: 'Converge — This creature enters with a +1/+1 counter on it for each color of mana spent to cast it.', mana_cost: '{2}', power: '0', toughness: '0' });
    g.cards[prism.name] = prism;
    g = passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Prism2', 'hand') }));
    const p = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Prism2')!;
    expect(g.objects[p]!.counters['+1/+1']).toBe(2);
  });
});
