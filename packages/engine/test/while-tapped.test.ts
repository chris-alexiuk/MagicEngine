import { describe, expect, it } from 'vitest';
import { power, toughness, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Skeleton Lite', type_line: 'Artifact', oracle_text: '{0}, {T}: Target creature gets +0/+3 for as long as this artifact remains tapped.\nYou may choose not to untap this artifact during your untap step.', mana_cost: '{0}' }),
  makeCard({ name: 'Sea Lord', type_line: 'Creature — Merfolk', oracle_text: '{T}: Gain control of target creature for as long as this creature remains tapped.\nYou may choose not to untap this creature during your untap step.', mana_cost: '{0}', power: '1', toughness: '1' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', oracle_text: '', mana_cost: '{0}', power: '2', toughness: '2' }),
  makeCard({ name: 'Leech Lite', type_line: 'Creature — Leech', oracle_text: "You may choose not to untap this creature during your untap step.\n{T}: Tap target creature. It doesn't untap during its controller's untap step for as long as this creature remains tapped.", mana_cost: '{0}', power: '1', toughness: '1' }),
];
const settle = (g: GameState) => {
  while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
  return g;
};
function toUntapChoice(g: GameState): GameState {
  g = toStep(g, 'upkeep', 'bob');
  for (let i = 0; i < 60 && g.pending?.kind !== 'keep_tapped'; i++) {
    if (g.pending?.kind === 'declare_attackers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_attackers', attacks: [] } });
    else if (g.pending?.kind === 'discard_to_hand_size') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'discard_to_hand_size', objects: g.zones.hand[g.pending.player]!.slice(0, g.pending.count) } });
    else g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
}

describe('CR 611.2b: "for as long as ~ remains tapped"; CR 502.3: "You may choose not to untap ~"', () => {
  it('the effect lasts while it stays tapped, and ends when it untaps', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const s = give(g, 'alice', 'Skeleton Lite', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: s, ability: 0, targets: [[{ kind: 'object', object: bear }]] }));
    expect(toughness(g, g.objects[bear]!)).toBe(5);
    g = toUntapChoice(g);
    expect(g.pending).toMatchObject({ kind: 'keep_tapped', player: 'alice', candidates: [s] });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'keep_tapped', objects: [s] } });
    expect(g.objects[s]!.tapped).toBe(true);
    expect(g.effects.some((e) => e.whileTapped?.id === s)).toBe(true);
    g = toUntapChoice(g);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'keep_tapped', objects: [] } });
    expect(g.objects[s]!.tapped).toBe(false);
    expect(g.effects.some((e) => e.whileTapped?.id === s)).toBe(false);
    expect(power(g, g.objects[bear]!)).toBe(2);
    expect(toughness(g, g.objects[bear]!)).toBe(2);
  });

  it('control for as long as it remains tapped', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const lord = give(g, 'alice', 'Sea Lord', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: lord, ability: 0, targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[bear]!.controller).toBe('alice');
    g = toUntapChoice(g);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'keep_tapped', objects: [] } });
    expect(g.objects[bear]!.controller).toBe('bob');
  });

  it('“It doesn’t untap during its controller’s untap step for as long as ~ remains tapped.”', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const leech = give(g, 'alice', 'Leech Lite', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: leech, ability: 0, targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[bear]!.tapped).toBe(true);
    g = toStep(g, 'upkeep', 'bob');
    expect(g.objects[bear]!.tapped).toBe(true);
    g = toUntapChoice(g);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'keep_tapped', objects: [] } });
    g = toStep(g, 'upkeep', 'bob');
    expect(g.objects[bear]!.tapped).toBe(false);
  });
});
