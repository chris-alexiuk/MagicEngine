import { describe, expect, it } from 'vitest';
import { legalActions, power, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{1}', ...extra });

const CARDS = [
  card('Myriad Lite', 'Creature — Elemental', 'Myriad', { power: '2', toughness: '2' }),
  card('Encore Lite', 'Creature — Pirate', 'Encore {2}', { power: '2', toughness: '2' }),
  card('Miracle Lite', 'Sorcery', 'You gain 5 life.\nMiracle {W}', { mana_cost: '{5}{W}', cmc: 6 }),
  card('Emerge Lite', 'Creature — Eldrazi', 'Emerge {4}', { mana_cost: '{6}', cmc: 6, power: '5', toughness: '5' }),
  card('Enlister', 'Creature — Soldier', 'Enlist', { power: '2', toughness: '2' }),
  card('Grizzly', 'Creature — Bear', '', { power: '2', toughness: '2', mana_cost: '{3}', cmc: 3 }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && (g.stack.length || g.pending); i++) {
    const p = g.pending;
    if (p?.kind === 'cast_free') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'cast_free', cast: true } });
    else if (p?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'declare_blockers', blocks: [] } });
    else if (p) break;
    else g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
}
function toAttack(g: GameState): GameState {
  g = toStep(g, 'beginning_of_combat');
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return g;
}

describe('keyword batch: myriad, encore, miracle, emerge, enlist', () => {
  it('CR 702.116a: myriad — copies attack each other opponent and are exiled at end of combat', () => {
    let g = toStep(start({ extra: CARDS, players: 4 }), 'main1');
    const m = give(g, 'alice', 'Myriad Lite', 'battlefield');
    g = toAttack(g);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: m, target: { kind: 'player', player: 'bob' } }] } });
    g = settle(g);
    const tokens = Object.keys(g.combat!.attackers).filter((id) => g.objects[id]!.token);
    expect(tokens.map((id) => (g.combat!.attackers[id]!.target as { player: string }).player).sort()).toEqual(['carol', 'dave']);
    while (g.step !== 'main2') {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks: [] } });
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(tokens.every((id) => !g.objects[id])).toBe(true);
    expect([g.players.bob!.life, g.players.carol!.life, g.players.dave!.life]).toEqual([18, 18, 18]);
  });

  it('CR 702.141a: encore — token copies with haste that must attack, sacrificed at the end step', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 };
    const e = give(g, 'alice', 'Encore Lite', 'graveyard');
    g = settle(act(g, { type: 'activate', player: 'alice', object: e, ability: 0 }));
    expect(g.objects[e]!.zone).toBe('exile');
    const token = g.zones.battlefield.find((id) => g.objects[id]!.token)!;
    g = toAttack(g);
    expect(() => act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [] } })).toThrow(/if able/);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: token, target: { kind: 'player', player: 'bob' } }] } });
    g = settle(toStep(settle(g), 'end'));
    expect(g.objects[token]).toBeUndefined();
  });

  it('CR 702.94a: miracle — the first card drawn this turn may be cast for its miracle cost', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && (a as { alt?: string }).alt === 'miracle')).toBe(false);
    give(g, 'alice', 'Miracle Lite', 'library');
    const lib = g.zones.library.alice!;
    lib.unshift(lib.pop()!);
    g = toStep(g, 'upkeep', 'bob');
    g = toStep(g, 'draw', 'alice');
    // The miracle trigger is waiting; there's mana for it now.
    expect(g.stack.some((e) => e.kind === 'ability' && e.text === 'Miracle')).toBe(true);
    g.players.alice!.pool = { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 };
    g = settle(g);
    expect(g.players.alice!.life).toBe(25);
  });

  it('CR 702.119a: emerge — sacrifice a creature and its mana value comes off the cost', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const bear = give(g, 'alice', 'Grizzly', 'battlefield');
    const eldrazi = give(g, 'alice', 'Emerge Lite', 'hand');
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 };
    const offer = legalActions(g, 'alice').find((a) => a.type === 'cast' && a.object === eldrazi && (a as { alt?: string }).alt === 'emerge');
    expect(offer).toMatchObject({ costs: { sacrifice: [bear] } });
    g = settle(act(g, offer!));
    expect(g.zones.battlefield.some((id) => g.objects[id]!.card === 'Emerge Lite')).toBe(true);
    expect(g.objects[bear]!.zone).toBe('graveyard');
  });

  it('CR 702.154a: enlist — tap a creature that isn’t attacking; the attacker gets +X/+0', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const en = give(g, 'alice', 'Enlister', 'battlefield');
    const bear = give(g, 'alice', 'Grizzly', 'battlefield');
    g = toAttack(g);
    expect(g.pending).toMatchObject({ kind: 'declare_attackers', enlisters: [en] });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: en, target: { kind: 'player', player: 'bob' } }], enlist: [{ attacker: en, tap: bear }] } });
    g = settle(g);
    expect(g.objects[bear]!.tapped).toBe(true);
    expect(power(g, g.objects[en]!)).toBe(4);
  });
});
