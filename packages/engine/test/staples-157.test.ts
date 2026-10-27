import { describe, expect, it } from 'vitest';
import { chars } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Animosity', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever a creature you control attacks, it gets +1/+0 until end of turn for each other attacking creature that shares a creature type with it.' }),
  makeCard({ name: 'Elf A', type_line: 'Creature — Elf Warrior', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Elf B', type_line: 'Creature — Elf Druid', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Goblin', type_line: 'Creature — Goblin', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Shifter', type_line: 'Creature — Shapeshifter', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Changeling' }),
  makeCard({ name: 'Masterwork', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Equipped creature gets +1/+1 for each other creature you control that shares a creature type with it.\nEquip {2}' }),
  makeCard({ name: 'Echoes', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever a creature enters, you may add an amount of {C} equal to the number of creatures you control that share a creature type with it.' }),
  makeCard({ name: 'Exemplar', type_line: 'Creature — Angel', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Whenever you put one or more +1/+1 counters on this creature, draw a card. This ability triggers only once each turn.' }),
  makeCard({ name: 'Growth', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Put a +1/+1 counter on target creature.' }),
  makeCard({ name: 'Vigor', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'If one or more tokens would be created, twice that many of those tokens are created instead.' }),
  makeCard({ name: 'Soldier Call', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Create a 1/1 white Soldier creature token.' }),
  makeCard({ name: 'Millikin', type_line: 'Artifact Creature — Construct', mana_cost: '{0}', power: '0', toughness: '1', oracle_text: '{T}, Mill a card: Add {C}.' }),
  makeCard({ name: 'Hydra', type_line: 'Creature — Hydra', mana_cost: '{0}', power: '0', toughness: '0', oracle_text: 'This creature enters with two +1/+1 counters on it.' }),
  makeCard({ name: 'Counter Watcher', type_line: 'Creature — Human', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Whenever one or more +1/+1 counters are put on a creature you control, you gain 1 life.' }),
  makeCard({ name: 'Elf Hero', type_line: 'Creature — Elf Bard', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Whenever you cast a spell that shares a creature type with this creature, you gain 1 life.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}

describe('staples (slice 157)', () => {
  it('Shared Animosity counts other attackers that share a creature type (changeling shares all)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Animosity', 'battlefield');
    const a = give(g, 'alice', 'Elf A', 'battlefield');
    const b = give(g, 'alice', 'Elf B', 'battlefield');
    const goblin = give(g, 'alice', 'Goblin', 'battlefield');
    const shifter = give(g, 'alice', 'Shifter', 'battlefield');
    g = toStep(g, 'beginning_of_combat');
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    const at = { kind: 'player' as const, player: 'bob' };
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [a, b, goblin, shifter].map((attacker) => ({ attacker, target: at })) } });
    for (let i = 0; i < 40 && (g.stack.length || g.triggers.length) && g.step === 'declare_attackers'; i++) {
      if (g.pending) break;
      g = act(g, { type: 'pass', player: g.priority! });
    }
    // Elf A: Elf B and the Shifter; the Goblin: the Shifter; the Shifter: all three.
    expect(chars(g, g.objects[a]!).power).toBe(3);
    expect(chars(g, g.objects[goblin]!).power).toBe(2);
    expect(chars(g, g.objects[shifter]!).power).toBe(4);
  });

  it('Stoneforge Masterwork counts the others that share a type with the equipped creature', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const a = give(g, 'alice', 'Elf A', 'battlefield');
    give(g, 'alice', 'Elf B', 'battlefield');
    give(g, 'alice', 'Goblin', 'battlefield');
    const work = give(g, 'alice', 'Masterwork', 'battlefield');
    g.objects[work]!.attachedTo = { id: a, zcc: g.objects[a]!.zcc };
    g.clock++;
    expect(chars(g, g.objects[a]!).power).toBe(2);
  });

  it('Mana Echoes counts the entering creature too', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Echoes', 'battlefield');
    give(g, 'alice', 'Elf A', 'battlefield');
    give(g, 'alice', 'Goblin', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Elf B', 'hand') }));
    if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    expect(g.players.alice!.pool.C).toBe(2);
  });

  it('Exemplar of Light: counters you put on it draw once a turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ex = give(g, 'alice', 'Exemplar', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Growth', 'hand'), targets: [[{ kind: 'object', object: ex }]] }));
    g = settle(g);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Growth', 'hand'), targets: [[{ kind: 'object', object: ex }]] }));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
    // An opponent's counters don't count.
    g = toStep(g, 'main1', 'bob');
    const hand2 = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Growth', 'hand'), targets: [[{ kind: 'object', object: ex }]] }));
    expect(g.zones.hand.alice!.length).toBe(hand2);
  });

  it('Counters a creature enters with are put on it (CR 122.6)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Counter Watcher', 'battlefield');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Hydra', 'hand') }));
    g = settle(g);
    expect(g.players.alice!.life).toBe(life + 1);
  });

  it("Primal Vigor doubles everyone's tokens", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Vigor', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Soldier Call', 'hand') }));
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice')).toHaveLength(2);
    g = toStep(g, 'main1', 'bob');
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Soldier Call', 'hand') }));
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'bob')).toHaveLength(2);
  });

  it('Millikin: mill a card as a cost', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const m = give(g, 'alice', 'Millikin', 'battlefield');
    const top = g.zones.library.alice![0]!;
    g = act(g, { type: 'activate_mana', player: 'alice', object: m, ability: 0 });
    expect(g.players.alice!.pool.C).toBe(1);
    expect(g.objects[top]!.zone).toBe('graveyard');
  });

  it('A spell that shares a creature type with this creature (no binding needed for the source)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Elf Hero', 'battlefield');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Elf A', 'hand') }));
    expect(g.players.alice!.life).toBe(life + 1);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Goblin', 'hand') }));
    expect(g.players.alice!.life).toBe(life + 1);
  });
});
