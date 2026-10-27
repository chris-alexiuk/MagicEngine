import { describe, expect, it } from 'vitest';
import { power, toughness, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Rampager', type_line: 'Creature — Beast', oracle_text: 'Rampage 2', mana_cost: '{0}', power: '3', toughness: '3' }),
  makeCard({ name: 'Afflicter', type_line: 'Creature — Zombie', oracle_text: 'Afflict 3', mana_cost: '{0}', power: '2', toughness: '2' }),
  makeCard({ name: 'Ingester', type_line: 'Creature — Eldrazi', oracle_text: 'Ingest', mana_cost: '{0}', power: '2', toughness: '2' }),
  makeCard({ name: 'Ravener', type_line: 'Creature — Dinosaur', oracle_text: 'Ravenous (This creature enters with X +1/+1 counters on it. If X is 5 or more, draw a card when it enters.)', mana_cost: '{X}', power: '0', toughness: '0' }),
  makeCard({ name: 'Sneak', type_line: 'Creature — Human Rogue', oracle_text: '', mana_cost: '{0}', power: '1', toughness: '1' }),
  makeCard({ name: 'Rogue Plan', type_line: 'Kindred Sorcery — Rogue', oracle_text: 'Prowl {0}\nDraw a card.', mana_cost: '{5}{B}' }),
  makeCard({ name: 'Provoker', type_line: 'Creature — Beast', oracle_text: 'Provoke', mana_cost: '{0}', power: '3', toughness: '3' }),
  makeCard({ name: 'Brute', type_line: 'Creature — Ogre', oracle_text: 'This creature blocks each combat if able.', mana_cost: '{0}', power: '1', toughness: '1' }),
  makeCard({ name: 'Thorny', type_line: 'Creature — Elemental', oracle_text: "You may have this creature assign its combat damage as though it weren't blocked.", mana_cost: '{0}', power: '5', toughness: '5' }),
  makeCard({ name: 'Taunter', type_line: 'Creature — Goblin', oracle_text: "{0}: Target creature can't block this creature this turn.", mana_cost: '{0}', power: '2', toughness: '2' }),
  makeCard({ name: 'Wall', type_line: 'Creature — Wall', oracle_text: '', mana_cost: '{0}', power: '0', toughness: '4' }),
];

function attack(g: GameState, attackers: string[]): GameState {
  g = toStep(g, 'beginning_of_combat');
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: attackers.map((attacker) => ({ attacker, target: { kind: 'player' as const, player: 'bob' } })) } });
  while (!g.pending && g.priority && g.step === 'declare_attackers') g = act(g, { type: 'pass', player: g.priority });
  return g;
}
const settle = (g: GameState) => {
  while (g.stack.length && !g.pending) g = act(g, { type: 'pass', player: g.priority! });
  return g;
};

describe('combat keywords from their CR 702 definitions', () => {
  it('CR 702.23a rampage: +N/+N for each creature blocking it beyond the first', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const r = give(g, 'alice', 'Rampager', 'battlefield');
    const walls = [give(g, 'bob', 'Wall', 'battlefield'), give(g, 'bob', 'Wall', 'battlefield'), give(g, 'bob', 'Wall', 'battlefield')];
    g = attack(g, [r]);
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: walls.map((blocker) => ({ blocker, attacker: r })) } }));
    expect([power(g, g.objects[r]!), toughness(g, g.objects[r]!)]).toEqual([7, 7]);
  });

  it('CR 702.130a afflict: defending player loses N life when it becomes blocked', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const a = give(g, 'alice', 'Afflicter', 'battlefield');
    const w = give(g, 'bob', 'Wall', 'battlefield');
    g = attack(g, [a]);
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: w, attacker: a }] } }));
    expect(g.players.bob!.life).toBe(life - 3);
    expect(g.players.alice!.life).toBe(20);
  });

  it('CR 702.115a ingest: that player exiles the top card of their library', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const i = give(g, 'alice', 'Ingester', 'battlefield');
    const top = g.zones.library.bob![0]!;
    g = attack(g, [i]);
    if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } });
    for (let n = 0; n < 12 && g.objects[top]!.zone === 'library' && !g.pending; n++) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.objects[top]!.zone).toBe('exile');
  });

  it('CR 702.156a ravenous: X counters; draws when X is 5 or more (CR 107.3m: the trigger sees the X paid)', () => {
    for (const [x, draws] of [[5, 1], [4, 0]] as const) {
      let g = toStep(start({ extra: CARDS }), 'main1');
      const r = give(g, 'alice', 'Ravener', 'hand');
      g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: x };
      const hand = g.zones.hand.alice!.length;
      g = act(g, { type: 'cast', player: 'alice', object: r, x });
      for (let n = 0; n < 6 && g.stack.length; n++) g = act(g, { type: 'pass', player: g.priority! });
      expect(g.objects[r]!.counters['+1/+1']).toBe(x);
      expect(g.zones.hand.alice!.length).toBe(hand - 1 + draws);
    }
  });

  it('CR 702.76a prowl: the alternative cost after a creature sharing a type dealt combat damage to a player', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const plan = give(g, 'alice', 'Rogue Plan', 'hand');
    const sneak = give(g, 'alice', 'Sneak', 'battlefield');
    expect(() => act(g, { type: 'cast', player: 'alice', object: plan, alt: 'prowl' })).toThrow();
    g = attack(g, [sneak]);
    if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } });
    g = toStep(g, 'main2');
    expect([g.active, g.priority, g.players.bob!.life]).toEqual(['alice', 'alice', 19]);
    expect(() => act(g, { type: 'cast', player: 'alice', object: plan, alt: 'prowl' })).not.toThrow();
  });

  it('CR 702.39a provoke: untap target creature defending player controls; it must block if able', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const p = give(g, 'alice', 'Provoker', 'battlefield');
    const w = give(g, 'bob', 'Wall', 'battlefield');
    const other = give(g, 'bob', 'Wall', 'battlefield');
    g.objects[w]!.tapped = true;
    g = attack(g, [p]);
    // The trigger: "you may" with a target.
    for (let n = 0; n < 8 && g.step === 'declare_attackers'; n++) {
      if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: w }]] } });
      else if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
      else if (g.pending) throw new Error(`unexpected ${g.pending.kind}`);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.objects[w]!.tapped).toBe(false);
    expect(g.pending?.kind).toBe('declare_blockers');
    expect(() => act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } })).toThrow(/must block/);
    expect(() => act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: other, attacker: p }] } })).toThrow(/must block/);
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: w, attacker: p }] } });
  });

  it('"blocks each combat if able"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const r = give(g, 'alice', 'Rampager', 'battlefield');
    const brute = give(g, 'bob', 'Brute', 'battlefield');
    g = attack(g, [r]);
    expect(() => act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } })).toThrow(/must block/);
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: brute, attacker: r }] } });
  });

  it('CR 510.1c: "assign its combat damage as though it weren\'t blocked"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const t = give(g, 'alice', 'Thorny', 'battlefield');
    const w = give(g, 'bob', 'Wall', 'battlefield');
    g = attack(g, [t]);
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: w, attacker: t }] } });
    for (let n = 0; n < 6 && g.pending?.kind !== 'assign_combat_damage'; n++) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.pending).toMatchObject({ kind: 'assign_combat_damage', choices: [{ attacker: t, unblockedTarget: { kind: 'player', player: 'bob' } }] });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'assign_combat_damage', assignments: { [t]: [{ to: { kind: 'player', player: 'bob' }, amount: 5 }] } } });
    expect(g.players.bob!.life).toBe(15);
    expect(g.objects[w]!.damage).toBe(0);
  });

  it('"Target creature can\'t block this creature this turn"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const t = give(g, 'alice', 'Taunter', 'battlefield');
    const w = give(g, 'bob', 'Wall', 'battlefield');
    g = act(g, { type: 'activate', player: 'alice', object: t, ability: 0, targets: [[{ kind: 'object', object: w }]] });
    while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
    g = attack(g, [t]);
    expect(() => act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: w, attacker: t }] } })).toThrow(/can’t block/);
  });
});
