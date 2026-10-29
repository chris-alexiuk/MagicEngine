import { describe, expect, it } from 'vitest';
import { legalActions, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{1}', ...extra });

const CARDS = [
  card('Ninja Lite', 'Creature — Human Ninja', 'Ninjutsu {U}', { mana_cost: '{3}{U}', power: '3', toughness: '3' }),
  card('Sneaker Lite', 'Creature — Turtle', 'Sneak {G}', { mana_cost: '{4}{G}', power: '4', toughness: '4' }),
  card('Scout', 'Creature — Human', '', { power: '1', toughness: '1' }),
  card('Yuriko Lite', 'Legendary Creature — Human Ninja', 'Commander ninjutsu {U}{B}', { mana_cost: '{2}{U}{B}', power: '1', toughness: '3' }),
];

function setup(): GameState {
  return toStep(start({ extra: CARDS }), 'main1');
}
/** Alice attacks Bob with `attacker`; Bob doesn't block; it's the declare blockers step with Alice to act. */
function unblocked(g: GameState, attacker: string): GameState {
  g = toStep(g, 'beginning_of_combat');
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker, target: { kind: 'player', player: 'bob' } }] } });
  while (g.step !== 'declare_blockers' || g.pending) {
    if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks: [] } });
    else g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
}
function damage(g: GameState): GameState {
  while (g.step !== 'end_of_combat' && g.step !== 'main2') g = act(g, { type: 'pass', player: g.priority! });
  return g;
}

describe('CR 702.49: ninjutsu, CR 702.190: sneak', () => {
  it('ninjutsu swaps an unblocked attacker for the ninja, tapped and attacking', () => {
    let g = setup();
    const scout = give(g, 'alice', 'Scout', 'battlefield');
    const ninja = give(g, 'alice', 'Ninja Lite', 'hand');
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === ninja)).toBe(false);
    g = unblocked(g, scout);
    g.players.alice!.pool = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 };
    const ability = legalActions(g, 'alice').find((a) => a.type === 'activate' && a.object === ninja);
    expect(ability).toMatchObject({ costs: { returned: [scout] } });
    g = act(g, ability!);
    expect(g.objects[scout]!.zone).toBe('hand');
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.objects[ninja]!.zone).toBe('battlefield');
    expect(g.objects[ninja]!.tapped).toBe(true);
    expect(g.combat!.attackers[ninja]).toMatchObject({ target: { kind: 'player', player: 'bob' }, blocked: false });
    g = damage(g);
    expect(g.players.bob!.life).toBe(17);
  });

  it('commander ninjutsu works from the command zone (CR 702.49d), with no commander tax', () => {
    let g = toStep(start({ format: 'commander', extra: CARDS, decks: { alice: [...Array(98).fill('Scout'), 'Yuriko Lite'], bob: Array(99).fill('Scout') }, commanders: { alice: ['Yuriko Lite'] } }), 'main1', 'alice');
    const yuriko = Object.values(g.objects).find((o) => o.commander && o.owner === 'alice')!.id;
    expect(g.objects[yuriko]!.zone).toBe('command');
    const scout = give(g, 'alice', 'Scout', 'battlefield');
    g = unblocked(g, scout);
    g.players.alice!.pool = { W: 0, U: 1, B: 1, R: 0, G: 0, C: 0 };
    const ability = legalActions(g, 'alice').find((a) => a.type === 'activate' && a.object === yuriko);
    expect(ability).toMatchObject({ costs: { returned: [scout] } });
    g = act(g, ability!);
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    expect([g.objects[yuriko]!.zone, g.objects[yuriko]!.tapped, g.commanderCasts[yuriko] ?? 0]).toEqual(['battlefield', true, 0]);
    expect(g.combat!.attackers[yuriko]).toMatchObject({ target: { kind: 'player', player: 'bob' } });
  });

  it('sneak casts the creature in the declare blockers step; it enters tapped and attacking', () => {
    let g = setup();
    const scout = give(g, 'alice', 'Scout', 'battlefield');
    const turtle = give(g, 'alice', 'Sneaker Lite', 'hand');
    g = unblocked(g, scout);
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 };
    const cast = legalActions(g, 'alice').find((a) => a.type === 'cast' && a.object === turtle);
    expect(cast).toMatchObject({ alt: 'sneak', costs: { returned: [scout] } });
    g = act(g, cast!);
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.objects[turtle]!.tapped).toBe(true);
    expect(g.combat!.attackers[turtle]).toBeDefined();
    g = damage(g);
    expect(g.players.bob!.life).toBe(16);
  });
});
