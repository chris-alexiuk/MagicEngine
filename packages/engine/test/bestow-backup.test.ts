import { describe, expect, it } from 'vitest';
import { hasKeyword, hasType, power, toughness, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{1}', ...extra });

const CARDS = [
  card('Siren Lite', 'Enchantment Creature — Siren', 'Bestow {2}{U}\nFlying\nEnchanted creature gets +1/+1 and has flying.', { mana_cost: '{1}{U}', power: '1', toughness: '1' }),
  card('Grizzly', 'Creature — Bear', '', { power: '2', toughness: '2' }),
  card('Murder Lite', 'Instant', 'Destroy target creature.'),
  card('Backer', 'Creature — Human', 'Backup 1\nFlying', { mana_cost: '{2}', power: '1', toughness: '1' }),
  card('Ping Lite', 'Instant', 'This spell deals 1 damage to any target.\nReplicate {1}', { mana_cost: '{R}' }),
  card('Squaddie', 'Creature — Soldier', 'Squad {1}', { mana_cost: '{1}', power: '1', toughness: '1' }),
];

function setup(): GameState {
  const g = toStep(start({ extra: CARDS }), 'main1');
  g.players.alice!.pool = { W: 0, U: 5, B: 5, R: 5, G: 0, C: 10 };
  g.players.bob!.pool = { W: 0, U: 0, B: 5, R: 0, G: 0, C: 5 };
  return g;
}
function settle(g: GameState): GameState {
  for (let i = 0; i < 40 && (g.stack.length || g.pending); i++) {
    const p = g.pending;
    if (p?.kind === 'copy_targets') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'copy_targets' } });
    else if (p) break;
    else g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
}
const obj = (object: string) => ({ kind: 'object' as const, object });
function priorityTo(g: GameState, player: string): GameState {
  while (g.priority && g.priority !== player) g = act(g, { type: 'pass', player: g.priority });
  return g;
}

describe('CR 702.103: bestow', () => {
  it('cast bestowed, it’s an Aura on the creature; when that creature dies, it becomes a creature', () => {
    let g = setup();
    const bear = give(g, 'alice', 'Grizzly', 'battlefield');
    const siren = give(g, 'alice', 'Siren Lite', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: siren, alt: 'bestow', targets: [[obj(bear)]] });
    expect(hasType(g, g.objects[siren]!, 'Creature')).toBe(false);
    g = settle(g);
    expect(g.objects[siren]!.attachedTo?.id).toBe(bear);
    expect([power(g, g.objects[bear]!), toughness(g, g.objects[bear]!)]).toEqual([3, 3]);
    expect(hasKeyword(g, g.objects[bear]!, 'flying')).toBe(true);
    expect(hasType(g, g.objects[siren]!, 'Creature')).toBe(false);
    g = priorityTo(g, 'bob');
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Murder Lite', 'hand'), targets: [[obj(bear)]] }));
    expect(g.objects[bear]!.zone).toBe('graveyard');
    expect(g.objects[siren]!.zone).toBe('battlefield');
    expect(hasType(g, g.objects[siren]!, 'Creature')).toBe(true);
    expect(g.objects[siren]!.attachedTo).toBeUndefined();
    expect([power(g, g.objects[siren]!), toughness(g, g.objects[siren]!)]).toEqual([1, 1]);
  });

  it('CR 702.103e: if the target is gone as it resolves, it enters as an enchantment creature', () => {
    let g = setup();
    const bear = give(g, 'alice', 'Grizzly', 'battlefield');
    const siren = give(g, 'alice', 'Siren Lite', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: siren, alt: 'bestow', targets: [[obj(bear)]] });
    g = priorityTo(g, 'bob');
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Murder Lite', 'hand'), targets: [[obj(bear)]] });
    g = settle(g);
    expect(g.objects[siren]!.zone).toBe('battlefield');
    expect(hasType(g, g.objects[siren]!, 'Creature')).toBe(true);
  });
});

describe('backup, replicate, squad', () => {
  it('CR 702.165a: backup — counters on another creature, which gains the abilities below until end of turn', () => {
    let g = setup();
    const bear = give(g, 'alice', 'Grizzly', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Backer', 'hand') });
    g = settle(g);
    if (g.pending?.kind === 'trigger_targets') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[obj(bear)]] } }));
    expect(g.objects[bear]!.counters['+1/+1']).toBe(1);
    expect(hasKeyword(g, g.objects[bear]!, 'flying')).toBe(true);
    g = toStep(g, 'main1', 'bob');
    expect(hasKeyword(g, g.objects[bear]!, 'flying')).toBe(false);
  });

  it('CR 702.56a: replicate — a copy for each time it was paid', () => {
    let g = setup();
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ping Lite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]], extras: ['replicate', 'replicate'] });
    g = settle(g);
    expect(g.players.bob!.life).toBe(17);
  });

  it('CR 702.157a: squad — a token copy for each time it was paid', () => {
    let g = setup();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Squaddie', 'hand'), extras: ['squad', 'squad'] }));
    const squad = g.zones.battlefield.filter((id) => g.objects[id]!.card === 'Squaddie');
    expect(squad).toHaveLength(3);
    expect(squad.filter((id) => g.objects[id]!.token)).toHaveLength(2);
  });
});
