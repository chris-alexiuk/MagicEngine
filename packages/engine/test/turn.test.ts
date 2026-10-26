import { describe, expect, it } from 'vitest';
import type { Step } from '../src/index.js';
import { act, actWithEvents, give, illegal, makeCard, start, toStep } from './helpers.js';

describe('turn structure', () => {
  it('CR 500.1 / CR 508.8: steps run in order, skipping blockers and damage when nobody attacks', () => {
    let g = start();
    const seen: Step[] = [g.step];
    for (let i = 0; i < 20 && !(g.active === 'bob' && g.step === 'upkeep'); i++) {
      g = act(g, { type: 'pass', player: g.priority! });
      if (seen.at(-1) !== g.step) seen.push(g.step);
    }
    expect(seen).toEqual(['upkeep', 'draw', 'main1', 'beginning_of_combat', 'declare_attackers', 'end_of_combat', 'main2', 'end', 'upkeep']);
  });

  it('CR 117.3a / CR 117.3d: the active player gets priority first, then it passes in turn order', () => {
    let g = start({ players: 3 });
    expect(g.priority).toBe('alice');
    g = act(g, { type: 'pass', player: 'alice' });
    expect(g.priority).toBe('bob');
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.priority).toBe('carol');
    expect(illegal(g, { type: 'pass', player: 'alice' })).toMatch(/priority/);
  });

  it('CR 500.2: a step ends only when every player passes in succession with an empty stack', () => {
    let g = start();
    expect(g.step).toBe('upkeep');
    g = act(g, { type: 'pass', player: 'alice' });
    expect(g.step).toBe('upkeep');
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.step).toBe('draw');
  });

  it('CR 117.4: an action between passes restarts the round', () => {
    let g = start();
    g = toStep(g, 'main1');
    const forest = g.zones.hand.alice![0]!;
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.step).toBe('beginning_of_combat');
    g = toStep(g, 'main2');
    g = act(g, { type: 'play_land', player: 'alice', object: forest });
    g = act(g, { type: 'pass', player: 'alice' });
    expect(g.step).toBe('main2');
    expect(g.priority).toBe('bob');
  });

  it('CR 502.3: the active player untaps their permanents during their untap step, not others', () => {
    let g = start();
    const aliceLand = give(g, 'alice', 'Forest', 'battlefield');
    const bobLand = give(g, 'bob', 'Forest', 'battlefield');
    g.objects[aliceLand]!.tapped = true;
    g.objects[bobLand]!.tapped = true;
    g = toStep(g, 'upkeep', 'bob');
    expect(g.objects[bobLand]!.tapped).toBe(false);
    expect(g.objects[aliceLand]!.tapped).toBe(true);
  });

  it('CR 504.1: the active player draws in their draw step', () => {
    let g = start();
    g = toStep(g, 'upkeep', 'bob');
    const before = g.zones.hand.bob!.length;
    const { state, events } = actWithEvents(act(g, { type: 'pass', player: 'bob' }), { type: 'pass', player: 'alice' });
    expect(state.step).toBe('draw');
    expect(state.zones.hand.bob).toHaveLength(before + 1);
    expect(events.find((e) => e.type === 'drew')).toMatchObject({ player: 'bob' });
  });

  it('CR 500.5: unspent mana empties as a step ends', () => {
    let g = start();
    const land = give(g, 'alice', 'Forest', 'battlefield');
    g = toStep(g, 'main1');
    g = act(g, { type: 'activate_mana', player: 'alice', object: land, ability: 0 });
    expect(g.players.alice!.pool.G).toBe(1);
    g = act(g, { type: 'pass', player: 'alice' });
    expect(g.players.alice!.pool.G).toBe(1); // still main1: Bob has priority
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.step).toBe('beginning_of_combat');
    expect(g.players.alice!.pool.G).toBe(0);
  });

  it('CR 514.1: the active player discards down to seven in their cleanup step', () => {
    let g = start();
    for (let i = 0; i < 3; i++) give(g, 'alice', 'Grizzly Bears', 'hand');
    g = toStep(g, 'end');
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.step).toBe('cleanup');
    expect(g.pending).toEqual({ kind: 'discard_to_hand_size', player: 'alice', count: 3 });
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'discard_to_hand_size', objects: [] } })).toMatch(/exactly 3/);
    const discard = g.zones.hand.alice!.slice(0, 3);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard_to_hand_size', objects: discard } });
    expect(g.zones.hand.alice).toHaveLength(7);
    expect(g.zones.graveyard.alice).toEqual(discard);
    expect(g.active).toBe('bob');
  });

  it('CR 514.2: damage wears off in the cleanup step', () => {
    let g = start();
    const bears = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g.objects[bears]!.damage = 1;
    g = toStep(g, 'upkeep', 'bob');
    expect(g.objects[bears]!.damage).toBe(0);
  });

  it('CR 302.6 / CR 702.10c: a creature taps for mana only after a full turn under your control, unless it has haste', () => {
    const hasty = makeCard({ name: 'Hasty Elf', type_line: 'Creature — Elf', mana_cost: '{G}', oracle_text: 'Haste\n{T}: Add {G}.' });
    let g = start({ extra: [hasty] });
    g = toStep(g, 'main1');
    const elves = give(g, 'alice', 'Llanowar Elves', 'battlefield', { sick: true });
    const fast = give(g, 'alice', 'Hasty Elf', 'battlefield', { sick: true });
    expect(illegal(g, { type: 'activate_mana', player: 'alice', object: elves, ability: 0 })).toMatch(/since your turn began/);
    g = act(g, { type: 'activate_mana', player: 'alice', object: fast, ability: 0 });
    g = toStep(toStep(g, 'main1', 'bob'), 'main1', 'alice');
    expect(g.turn).toBe(3);
    g = act(g, { type: 'activate_mana', player: 'alice', object: elves, ability: 0 });
    expect(g.players.alice!.pool.G).toBe(1);
  });
});
