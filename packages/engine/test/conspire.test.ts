import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Plot Bolt', type_line: 'Instant', mana_cost: '{R}', colors: ['R'], oracle_text: 'Conspire (As you cast this spell, you may tap two untapped creatures you control that share a color with it. When you do, copy it and you may choose a new target for the copy.)\nPlot Bolt deals 2 damage to any target.' }),
  makeCard({ name: 'Red Bear', type_line: 'Creature — Bear', mana_cost: '{R}', colors: ['R'], power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Green Bear', type_line: 'Creature — Bear', mana_cost: '{G}', colors: ['G'], power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Relic', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}, Tap an untapped creature you control: Add one mana of any color.' }),
];

describe('CR 702.78: conspire; "Tap an untapped creature you control" costs', () => {
  it('tapping two creatures that share a color copies the spell', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const bolt = give(g, 'alice', 'Plot Bolt', 'hand');
    const r1 = give(g, 'alice', 'Red Bear', 'battlefield');
    const r2 = give(g, 'alice', 'Red Bear', 'battlefield');
    const gr = give(g, 'alice', 'Green Bear', 'battlefield');
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 };
    const target = [[{ kind: 'player' as const, player: 'bob' }]];
    expect(() => act(g, { type: 'cast', player: 'alice', object: bolt, targets: target, extras: ['conspire'], costs: { crew: [r1, gr] } })).toThrow(/untapped/);
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === bolt && a.extras?.includes('conspire'))).toBe(true);
    g = act(g, { type: 'cast', player: 'alice', object: bolt, targets: target, extras: ['conspire'], costs: { crew: [r1, r2] } });
    expect(g.objects[r1]!.tapped && g.objects[r2]!.tapped).toBe(true);
    for (let i = 0; i < 12 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'copy_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'copy_targets', targets: null } as never });
      else if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: false } });
      else if (g.pending) throw new Error(`unexpected ${g.pending.kind}`);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.players.bob!.life).toBe(16);
  });

  it('a mana ability with "Tap an untapped creature you control" in its cost', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const relic = give(g, 'alice', 'Relic', 'battlefield');
    const bear = give(g, 'alice', 'Green Bear', 'battlefield');
    expect(() => act(g, { type: 'activate_mana', player: 'alice', object: relic, ability: 0, choice: 'U' })).toThrow();
    g = act(g, { type: 'activate_mana', player: 'alice', object: relic, ability: 0, choice: 'U', costs: { crew: [bear] } });
    expect(g.objects[bear]!.tapped).toBe(true);
    expect(g.players.alice!.pool.U).toBe(1);
  });
});
