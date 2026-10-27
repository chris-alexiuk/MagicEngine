import { describe, expect, it } from 'vitest';
import { hasType, power, type GameState } from '../src/index.js';
import { faceOf } from '../src/zones.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Mirror Lite', type_line: 'Artifact', oracle_text: '{0}: This artifact becomes a copy of target creature until end of turn.', mana_cost: '{0}' }),
  makeCard({ name: 'Plasm Lite', type_line: 'Creature — Shapeshifter', oracle_text: 'At the beginning of your upkeep, you may have this creature become a copy of another target creature, except it has this ability.', mana_cost: '{0}', power: '0', toughness: '1' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', oracle_text: '', mana_cost: '{3}', cmc: 3, power: '4', toughness: '4' }),
];
const settle = (g: GameState) => {
  for (let i = 0; i < 30 && (g.stack.length || g.pending); i++) {
    const p = g.pending;
    if (p?.kind === 'may') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'may', yes: true } });
    else if (p) break;
    else g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
};

describe('CR 707.2: becoming a copy', () => {
  it('“becomes a copy of target creature until end of turn” — and back at cleanup (CR 514.2)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const m = give(g, 'alice', 'Mirror Lite', 'battlefield');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: m, ability: 0, targets: [[{ kind: 'object', object: ogre }]] }));
    expect(hasType(g, g.objects[m]!, 'Creature')).toBe(true);
    expect(power(g, g.objects[m]!)).toBe(4);
    g = toStep(g, 'upkeep', 'bob');
    expect(hasType(g, g.objects[m]!, 'Creature')).toBe(false);
    expect(faceOf(g, g.objects[m]!).name).toBe('Mirror Lite');
  });

  it('“except it has this ability” — the copy keeps the ability that made it', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const p = give(g, 'alice', 'Plasm Lite', 'battlefield');
    give(g, 'bob', 'Ogre', 'battlefield');
    g = toStep(g, 'upkeep', 'bob');
    g = toStep(g, 'upkeep', 'alice');
    g = settle(g);
    expect(power(g, g.objects[p]!)).toBe(4);
    expect(faceOf(g, g.objects[p]!).name).toBe('Ogre');
    expect(faceOf(g, g.objects[p]!).abilities.some((a) => a.kind === 'triggered' && /become a copy/.test(a.text))).toBe(true);
  });
});
