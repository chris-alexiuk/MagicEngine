import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, passRound, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{R}', ...extra });

const CARDS = [
  card('Zap', 'Instant', 'Zap deals 2 damage to any target.'),
  card('Twincast Lite', 'Instant', 'Copy target instant or sorcery spell. You may choose new targets for the copy.', { mana_cost: '{U}' }),
  card('Echo Caster', 'Creature — Human Wizard', 'Whenever you cast an instant or sorcery spell, copy that spell.', { power: '1', toughness: '1' }),
  card('Grapeshot Lite', 'Sorcery', 'Grapeshot Lite deals 1 damage to any target.\nStorm'),
  card('Titan Lite', 'Creature — Eldrazi', 'When you cast this spell, draw two cards.', { mana_cost: '{3}', power: '5', toughness: '5' }),
  card('Doublecast Lite', 'Sorcery', 'When you next cast an instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.', { mana_cost: '{R}' }),
  card('Copy Bear', 'Instant', 'Copy target creature spell.', { mana_cost: '{U}' }),
];

const bob = { kind: 'player' as const, player: 'bob' };
const alice = { kind: 'player' as const, player: 'alice' };

function setup(): GameState {
  const g = toStep(start({ extra: CARDS }), 'main1');
  g.players.alice!.pool = { W: 0, U: 5, B: 0, R: 5, G: 5, C: 5 };
  return g;
}
const castOf = (g: GameState, name: string, targets?: unknown[][]) =>
  act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), ...(targets ? { targets } : {}) } as never);

describe('CR 707.10: copying spells', () => {
  it('“copy target instant or sorcery spell”, keeping the targets — the copy isn’t a card and is gone afterwards', () => {
    let g = setup();
    g = castOf(g, 'Zap', [[bob]]);
    const zap = g.stack[0]!;
    g = castOf(g, 'Twincast Lite', [[{ kind: 'object', object: zap.kind === 'spell' ? zap.object : '' }]]);
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'copy_targets', player: 'alice' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'copy_targets' } });
    expect(g.stack).toHaveLength(2);
    g = passRound(g); // the copy
    expect(g.players.bob!.life).toBe(18);
    g = passRound(g); // the original
    expect(g.players.bob!.life).toBe(16);
    const zaps = Object.values(g.objects).filter((o) => o.card === 'Zap' && o.zone !== 'library');
    expect(zaps).toHaveLength(1);
    expect(zaps[0]!.zone).toBe('graveyard');
  });

  it('CR 707.10c: new targets for the copy', () => {
    let g = setup();
    g = castOf(g, 'Zap', [[bob]]);
    const zap = g.stack[0]!;
    g = passRound(castOf(g, 'Twincast Lite', [[{ kind: 'object', object: zap.kind === 'spell' ? zap.object : '' }]]));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'copy_targets', targets: [[alice]] } });
    g = passRound(passRound(g));
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([18, 18]);
  });

  it('“Whenever you cast an instant or sorcery spell, copy that spell.”', () => {
    let g = setup();
    give(g, 'alice', 'Echo Caster', 'battlefield');
    g = passRound(castOf(g, 'Zap', [[bob]])); // the trigger resolves, the copy goes on the stack
    g = passRound(passRound(g));
    expect(g.players.bob!.life).toBe(16);
  });

  it('CR 608.3f: a copy of a creature spell becomes a token', () => {
    let g = setup();
    g = castOf(g, 'Grizzly Bears');
    const bears = g.stack[0]!;
    g = passRound(castOf(g, 'Copy Bear', [[{ kind: 'object', object: bears.kind === 'spell' ? bears.object : '' }]]));
    g = passRound(passRound(g));
    const all = g.zones.battlefield.map((id) => g.objects[id]!).filter((o) => o.card === 'Grizzly Bears');
    expect(all.map((o) => Boolean(o.token)).sort()).toEqual([false, true]);
  });
});

describe('triggers on casting this spell', () => {
  it('“When you cast this spell” triggers from the stack and resolves first', () => {
    let g = setup();
    const hand = g.zones.hand.alice!.length;
    g = castOf(g, 'Titan Lite');
    expect(g.stack).toHaveLength(2);
    g = passRound(g);
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
    expect(g.stack).toHaveLength(1);
  });

  it('CR 702.40a: storm copies it for each spell cast before it this turn', () => {
    let g = setup();
    g = passRound(castOf(g, 'Zap', [[bob]]));
    g = passRound(castOf(g, 'Zap', [[bob]]));
    expect(g.players.bob!.life).toBe(16);
    g = castOf(g, 'Grapeshot Lite', [[bob]]);
    g = passRound(g); // storm resolves: two copies, keeping their targets
    while (g.pending?.kind === 'copy_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'copy_targets' } });
    for (let i = 0; i < 3 && g.stack.length; i++) g = passRound(g);
    expect(g.players.bob!.life).toBe(13);
  });
});

describe('CR 603.7: “When you next cast an instant or sorcery spell this turn, copy that spell.”', () => {
  it('copies the next one only, and only this turn', () => {
    let g = setup();
    g = passRound(castOf(g, 'Doublecast Lite'));
    expect(g.delayed).toHaveLength(1);
    g = castOf(g, 'Zap', [[bob]]);
    g = passRound(g); // the delayed trigger: copy, keep targets
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'copy_targets' } });
    g = passRound(passRound(g));
    expect(g.players.bob!.life).toBe(16);
    expect(g.delayed).toHaveLength(0);
    g = passRound(castOf(g, 'Zap', [[bob]]));
    expect(g.players.bob!.life).toBe(14);
  });
});
