import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{0}', cmc: 0, ...extra });

const CARDS = [
  card('Seek Beast', 'Sorcery', 'Reveal cards from the top of your library until you reveal a creature card. Put that card into your hand and the rest on the bottom of your library in a random order.'),
  card('Call Beast', 'Sorcery', 'Reveal cards from the top of your library until you reveal a creature card. Put that card onto the battlefield tapped and the rest on the bottom of your library in a random order.'),
  card('Dissipate Lite', 'Instant', "Counter target spell. If that spell would be put into its owner's graveyard, exile it instead."),
  card('Bear', 'Creature — Bear', '', { power: '2', toughness: '2', mana_cost: '{1}', cmc: 1 }),
  card('Flamer', 'Creature — Human', 'Firebending 2', { power: '1', toughness: '1' }),
  card('Keeper', 'Creature — Elf', "{T}: Add {G}. Until end of turn, you don't lose this mana as steps and phases end.", { power: '1', toughness: '1' }),
];

const settle = (g: GameState) => {
  for (let i = 0; i < 40 && (g.stack.length || g.pending); i++) {
    const p = g.pending;
    if (p?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'declare_blockers', blocks: [] } });
    else if (p) break;
    else g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
};
const cast = (g: GameState, name: string, extra: Record<string, unknown> = {}) => settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), ...extra } as never));

function stack(g: GameState, names: string[]): string[] {
  const ids = names.map((n) => give(g, 'alice', n, 'library'));
  const lib = g.zones.library.alice!;
  for (const id of ids) lib.splice(lib.indexOf(id), 1);
  lib.unshift(...ids);
  return ids;
}

describe('reveal until, exile instead, kept mana', () => {
  it('reveals until a creature card: into your hand, the rest on the bottom', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const [f1, f2, bear] = stack(g, ['Seek Beast', 'Dissipate Lite', 'Bear']);
    g = cast(g, 'Seek Beast');
    expect(g.objects[bear!]!.zone).toBe('hand');
    const lib = g.zones.library.alice!;
    expect(lib.slice(-2).sort()).toEqual([f1, f2].sort());
  });

  it('… or onto the battlefield tapped', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const [, bear] = stack(g, ['Seek Beast', 'Bear']);
    g = cast(g, 'Call Beast');
    expect(g.objects[bear!]!.zone).toBe('battlefield');
    expect(g.objects[bear!]!.tapped).toBe(true);
  });

  it('“If that spell would be put into its owner’s graveyard, exile it instead.”', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const bear = give(g, 'alice', 'Bear', 'hand');
    g.players.alice!.pool.C = 1;
    g = act(g, { type: 'cast', player: 'alice', object: bear });
    g = act(g, { type: 'pass', player: 'alice' });
    const d = give(g, 'bob', 'Dissipate Lite', 'hand');
    g = act(g, { type: 'cast', player: 'bob', object: d, targets: [[{ kind: 'object', object: bear }]] });
    g = settle(g);
    expect(g.objects[bear]!.zone).toBe('exile');
  });

  it('CR 702.189a: firebending — red mana that lasts until end of combat', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const f = give(g, 'alice', 'Flamer', 'battlefield');
    g = toStep(g, 'beginning_of_combat');
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: f, target: { kind: 'player', player: 'bob' } }] } }));
    expect(g.players.alice!.restricted).toMatchObject([{ color: 'R', keep: 'end_of_combat' }, { color: 'R', keep: 'end_of_combat' }]);
    g = toStep(g, 'end_of_combat');
    expect(g.players.alice!.restricted?.length).toBe(2);
    g = toStep(g, 'main2');
    expect(g.players.alice!.restricted).toBeUndefined();
  });

  it('“Until end of turn, you don’t lose this mana as steps and phases end.”', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const k = give(g, 'alice', 'Keeper', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: k, ability: 0 });
    g = toStep(g, 'main2');
    expect(g.players.alice!.restricted).toMatchObject([{ color: 'G', keep: 'end_of_turn' }]);
    // It still pays for things.
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bear', 'hand') }));
    expect(g.players.alice!.restricted).toEqual([]);
    g.objects[k]!.tapped = false;
    g = act(g, { type: 'activate_mana', player: 'alice', object: k, ability: 0 });
    g = toStep(g, 'upkeep', 'bob');
    expect(g.players.alice!.restricted).toBeUndefined();
  });
});
