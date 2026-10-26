import { describe, expect, it } from 'vitest';
import { legalActions, power, type GameState } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{G}', ...extra });
const creature = (name: string, text: string, pt = '2') => card(name, 'Creature — Beast', text, { power: pt, toughness: pt });

const CARDS = [
  creature('Thirsty Beast', 'Bloodthirst 2'),
  creature('Fading Beast', 'Vanishing 2', '3'),
  creature('Famed Beast', 'Renown 1'),
  creature('Teacher', 'Mentor', '3'),
  creature('Tired Beast', 'Exhaust — {1}: Put two +1/+1 counters on this creature.'),
  card('Quick Shot', 'Instant', 'Split second\nQuick Shot deals 1 damage to any target.', { mana_cost: '{R}' }),
  card('Zap', 'Instant', 'Zap deals 2 damage to any target.', { mana_cost: '{R}' }),
];
const bob = { kind: 'player' as const, player: 'bob' };

function setup(): GameState {
  return toStep(start({ extra: CARDS }), 'main1');
}
const castIt = (g: GameState, name: string, extra: Record<string, unknown> = {}) => {
  g.players.alice!.pool.G += 1;
  g.players.alice!.pool.R += 1;
  return passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), ...extra }));
};

describe('more keywords from their CR 702 definitions', () => {
  it('bloodthirst (CR 702.54a): counters only if an opponent was dealt damage this turn', () => {
    let g = setup();
    g = castIt(g, 'Thirsty Beast');
    const first = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Thirsty Beast')!;
    expect(g.objects[first]!.counters['+1/+1'] ?? 0).toBe(0);
    g = castIt(g, 'Zap', { targets: [[bob]] });
    g = castIt(g, 'Thirsty Beast');
    const second = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Thirsty Beast' && id !== first)!;
    expect(g.objects[second]!.counters['+1/+1']).toBe(2);
  });

  it('vanishing (CR 702.63a): enters with time counters, loses one each upkeep, sacrificed with the last', () => {
    let g = setup();
    g = castIt(g, 'Fading Beast');
    const beast = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Fading Beast')!;
    expect(g.objects[beast]!.counters.time).toBe(2);
    g = passRound(toStep(toStep(g, 'upkeep', 'bob'), 'upkeep', 'alice'));
    expect(g.objects[beast]!.counters.time).toBe(1);
    g = passRound(toStep(toStep(g, 'upkeep', 'bob'), 'upkeep', 'alice'));
    while (g.stack.length) g = passRound(g);
    expect(g.objects[beast]!.zone).toBe('graveyard');
  });

  it('renown (CR 702.112a): counters the first time it deals combat damage to a player', () => {
    let g = setup();
    const famed = give(g, 'alice', 'Famed Beast', 'battlefield');
    for (let turn = 0; turn < 2; turn++) {
      g = passRound(toStep(g, 'beginning_of_combat', 'alice'));
      g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: famed, target: bob }] } });
      g = toStep(g, 'end', 'alice');
      g = toStep(g, 'main1', 'bob');
    }
    expect(g.objects[famed]!.counters['+1/+1']).toBe(1);
    expect(g.objects[famed]!.renowned).toBe(true);
  });

  it('mentor (CR 702.134a): only an attacking creature with less power', () => {
    let g = setup();
    const teacher = give(g, 'alice', 'Teacher', 'battlefield');
    const small = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = passRound(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [teacher, small].map((attacker) => ({ attacker, target: bob })) } });
    if (g.pending?.kind === 'trigger_targets') {
      expect(g.pending.prompts[0]!.candidates).toEqual([{ kind: 'object', object: small }]);
      g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: small }]] } });
    }
    g = passRound(g);
    expect(power(g, g.objects[small]!)).toBe(3);
  });

  it('exhaust (CR 702.177a): activate only once', () => {
    let g = setup();
    const tired = give(g, 'alice', 'Tired Beast', 'battlefield');
    g.players.alice!.pool.C = 2;
    g = passRound(act(g, { type: 'activate', player: 'alice', object: tired, ability: 0 }));
    expect(g.objects[tired]!.counters['+1/+1']).toBe(2);
    expect(illegal(g, { type: 'activate', player: 'alice', object: tired, ability: 0 })).toMatch(/only once/);
  });

  it('split second (CR 702.61a): no spells or non-mana abilities in response', () => {
    let g = setup();
    g.players.alice!.pool.R = 1;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Quick Shot', 'hand'), targets: [[bob]] });
    g = act(g, { type: 'pass', player: 'alice' });
    g.players.bob!.pool.R = 1;
    const zap = give(g, 'bob', 'Zap', 'hand');
    expect(illegal(g, { type: 'cast', player: 'bob', object: zap, targets: [[{ kind: 'player', player: 'alice' }]] })).toMatch(/split second/);
    expect(legalActions(g, 'bob').some((a) => a.type === 'cast')).toBe(false);
  });
});
