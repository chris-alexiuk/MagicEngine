import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{1}', cmc: 1, ...extra });
const bear = (name: string, oracle_text = '', extra: Record<string, unknown> = {}) => card(name, 'Creature — Bear', oracle_text, { power: '2', toughness: '2', ...extra });

const CARDS = [
  bear('Grizzly'),
  bear('Exploiter', 'Exploit\nWhen this creature exploits a creature, you gain 3 life.'),
  bear('Monster', '{0}: Monstrosity 2.\nWhen this creature becomes monstrous, you gain X life.'),
  card('Token Watcher', 'Enchantment', 'Whenever one or more tokens you control enter, you gain 1 life.'),
  card('Two Soldiers', 'Sorcery', 'Create two 1/1 white Soldier creature tokens.', { mana_cost: '{0}', cmc: 0 }),
  card('First Gain', 'Enchantment', 'Whenever you gain life for the first time each turn, draw a card.'),
  card('Gain One', 'Instant', 'You gain 1 life.', { mana_cost: '{0}', cmc: 0 }),
  card('Kick Watcher', 'Enchantment', 'Whenever you cast a kicked spell, you gain 2 life.'),
  card('Kicky', 'Sorcery', 'Kicker {1}\nDraw a card.', { mana_cost: '{0}', cmc: 0 }),
  card('Self Sac', 'Artifact', '{0}, Sacrifice this artifact: Draw a card.\nWhen you sacrifice this artifact, you gain 2 life.'),
  card('Wall Watcher', 'Enchantment', 'Whenever a creature attacks you, you gain 1 life.'),
  bear('Brawler', 'Whenever this creature deals damage to a creature, you gain 1 life.'),
  card('Guardian Angel', 'Enchantment', 'Whenever you cast a spell that targets a creature you control, you gain 1 life.'),
  card('Pump', 'Instant', 'Target creature gets +1/+1 until end of turn.', { mana_cost: '{0}', cmc: 0 }),
];

function setup(): GameState {
  const g = toStep(start({ extra: CARDS }), 'main1');
  g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 10 };
  return g;
}
function settle(g: GameState, opts: { sacrifice?: string[] } = {}): GameState {
  for (let i = 0; i < 60 && (g.stack.length || g.pending); i++) {
    const p = g.pending;
    if (p?.kind === 'may') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'may', yes: true } });
    else if (p?.kind === 'sacrifice') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'sacrifice', objects: opts.sacrifice ?? p.candidates.slice(0, p.count) } });
    else if (p?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'declare_blockers', blocks: [] } });
    else if (p) break;
    else g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
}
const cast = (g: GameState, name: string, extra: Record<string, unknown> = {}) => act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), ...extra } as never);
const life = (g: GameState, p = 'alice') => g.players[p]!.life;
function toAttack(g: GameState): GameState {
  g = toStep(g, 'beginning_of_combat');
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return g;
}

describe('slice 40 triggers', () => {
  it('CR 702.110b: “When ~ exploits a creature” — another creature, or itself', () => {
    let g = setup();
    const bear = give(g, 'alice', 'Grizzly', 'battlefield');
    g = settle(cast(g, 'Exploiter'), { sacrifice: [bear] });
    expect(g.objects[bear]!.zone).toBe('graveyard');
    expect(life(g)).toBe(23);
    g = setup();
    g = cast(g, 'Exploiter');
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    const self = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Exploiter')!;
    g = settle(g, { sacrifice: [self] });
    expect(g.objects[self]!.zone).toBe('graveyard');
    expect(life(g)).toBe(23);
  });

  it('CR 701.37c: “When ~ becomes monstrous, you gain X life”', () => {
    let g = setup();
    const m = give(g, 'alice', 'Monster', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: m, ability: 0 }));
    expect(g.objects[m]!.counters['+1/+1']).toBe(2);
    expect(life(g)).toBe(22);
  });

  it('“Whenever one or more tokens you control enter” triggers once for the batch', () => {
    let g = setup();
    give(g, 'alice', 'Token Watcher', 'battlefield');
    g = settle(cast(g, 'Two Soldiers'));
    expect(life(g)).toBe(21);
  });

  it('“Whenever you gain life for the first time each turn”', () => {
    let g = setup();
    give(g, 'alice', 'First Gain', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = settle(cast(g, 'Gain One'));
    g = settle(cast(g, 'Gain One'));
    expect(life(g)).toBe(22);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('“Whenever you cast a kicked spell”', () => {
    let g = setup();
    give(g, 'alice', 'Kick Watcher', 'battlefield');
    g = settle(cast(g, 'Kicky'));
    expect(life(g)).toBe(20);
    g = settle(cast(g, 'Kicky', { kicked: true }));
    expect(life(g)).toBe(22);
  });

  it('CR 603.10a: “When you sacrifice ~” looks back', () => {
    let g = setup();
    const a = give(g, 'alice', 'Self Sac', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: a, ability: 0 }));
    expect(life(g)).toBe(22);
  });

  it('“Whenever a creature attacks you”; “Whenever ~ deals damage to a creature”', () => {
    let g = setup();
    give(g, 'bob', 'Wall Watcher', 'battlefield');
    const brawler = give(g, 'alice', 'Brawler', 'battlefield');
    const other = give(g, 'alice', 'Grizzly', 'battlefield');
    const blocker = give(g, 'bob', 'Grizzly', 'battlefield');
    g = act(toAttack(g), { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [brawler, other].map((attacker) => ({ attacker, target: { kind: 'player' as const, player: 'bob' } })) } });
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    expect(life(g, 'bob')).toBe(22);
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker, attacker: brawler }] } });
    g = toStep(g, 'main2');
    expect(life(g)).toBe(21);
  });

  it('“Whenever you cast a spell that targets a creature you control”', () => {
    let g = setup();
    give(g, 'alice', 'Guardian Angel', 'battlefield');
    const mine = give(g, 'alice', 'Grizzly', 'battlefield');
    const theirs = give(g, 'bob', 'Grizzly', 'battlefield');
    g = settle(cast(g, 'Pump', { targets: [[{ kind: 'object', object: theirs }]] }));
    expect(life(g)).toBe(20);
    g = settle(cast(g, 'Pump', { targets: [[{ kind: 'object', object: mine }]] }));
    expect(life(g)).toBe(21);
  });
});
