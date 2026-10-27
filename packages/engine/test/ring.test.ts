import { describe, expect, it } from 'vitest';
import { blockDeclarationProblem, chars, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{0}', cmc: 0, ...extra });

const CARDS = [
  card('Tempt', 'Sorcery', 'The Ring tempts you.'),
  card('Hobbit', 'Creature — Halfling', '', { power: '1', toughness: '1' }),
  card('Ogre', 'Creature — Ogre', '', { power: '4', toughness: '4' }),
  card('Watcher', 'Creature — Elf', 'Whenever the Ring tempts you, if you chose a creature other than this creature as your Ring-bearer, you gain 2 life.', { power: '1', toughness: '1' }),
];

function settle(g: GameState, bearer?: string): GameState {
  for (let i = 0; i < 40 && (g.stack.length || g.pending); i++) {
    const p = g.pending;
    if (p?.kind === 'choose_objects') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'choose_objects', objects: [bearer ?? p.candidates[0]!] } });
    else if (p?.kind === 'discard') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'discard', objects: g.zones.hand[p.player]!.slice(0, p.count) } });
    else if (p?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'declare_blockers', blocks: [] } });
    else if (p) break;
    else g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
}
const tempt = (g: GameState, bearer?: string) => settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Tempt', 'hand') }), bearer);

describe('CR 701.54: the Ring tempts you', () => {
  it('your Ring-bearer is legendary and can’t be blocked by creatures with greater power', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const hobbit = give(g, 'alice', 'Hobbit', 'battlefield');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    g = tempt(g);
    expect(g.objects[hobbit]!.ringBearer).toBe('alice');
    expect(g.players.alice!.ringTempted).toBe(1);
    expect(chars(g, g.objects[hobbit]!).supertypes).toContain('Legendary');
    g = toStep(g, 'beginning_of_combat');
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: hobbit, target: { kind: 'player', player: 'bob' } }] } });
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    expect(blockDeclarationProblem(g, 'bob', [{ blocker: ogre, attacker: hobbit }])).toMatch(/Ring-bearer/);
  });

  it('choosing another creature moves the designation; a second temptation adds the looting trigger', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const hobbit = give(g, 'alice', 'Hobbit', 'battlefield');
    const watcher = give(g, 'alice', 'Watcher', 'battlefield');
    g = tempt(g, watcher);
    expect(g.players.alice!.life).toBe(20);
    g = tempt(g, hobbit);
    expect(g.objects[watcher]!.ringBearer).toBeUndefined();
    expect(g.objects[hobbit]!.ringBearer).toBe('alice');
    // "if you chose a creature other than this creature"
    expect(g.players.alice!.life).toBe(22);
    const hand = g.zones.hand.alice!.length;
    g = toStep(g, 'beginning_of_combat');
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: hobbit, target: { kind: 'player', player: 'bob' } }] } }));
    expect(g.zones.hand.alice!.length).toBe(hand);
    expect(g.zones.graveyard.alice!.length).toBeGreaterThan(0);
  });

  it('four temptations: combat damage to a player makes each opponent lose 3 life', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    for (let i = 0; i < 4; i++) g = tempt(g);
    g = toStep(g, 'beginning_of_combat');
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: ogre, target: { kind: 'player', player: 'bob' } }] } }));
    while (g.step !== 'main2') g = settle(act(g, { type: 'pass', player: g.priority! }));
    expect(g.players.bob!.life).toBe(13);
  });
});
