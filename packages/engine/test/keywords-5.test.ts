import { describe, expect, it } from 'vitest';
import { legalActions, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{1}', ...extra });

const CARDS = [
  card('Fader', 'Creature — Beast', 'Fading 1', { power: '3', toughness: '3' }),
  card('Retracer', 'Instant', 'You gain 3 life.\nRetrace', { mana_cost: '{G}' }),
  card('Transmuter', 'Creature — Human', 'Transmute {1}', { mana_cost: '{2}', cmc: 2, power: '1', toughness: '1' }),
  card('Two Drop', 'Creature — Bear', '', { mana_cost: '{2}', cmc: 2, power: '2', toughness: '2' }),
  card('Ager', 'Creature — Spirit', 'Cumulative upkeep—Pay 1 life.', { power: '2', toughness: '2' }),
  card('Land Looter', 'Artifact', '{T}, Discard a land card: Draw a card.'),
  card('Downdraft Lite', 'Instant', "Target creature's owner puts it on their choice of the top or bottom of their library."),
  card('Dread Lite', 'Creature — Horror', "When this creature is put into a graveyard from anywhere, shuffle it into its owner's library.", { power: '6', toughness: '6' }),
  card('Murder Lite', 'Instant', 'Destroy target creature.'),
  card('Grizzly', 'Creature — Bear', '', { power: '2', toughness: '2' }),
];

function setup(): GameState {
  const g = toStep(start({ extra: CARDS }), 'main1');
  g.players.alice!.pool = { W: 0, U: 0, B: 5, R: 5, G: 5, C: 5 };
  return g;
}
function settle(g: GameState): GameState {
  for (let i = 0; i < 40 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const obj = (object: string) => ({ kind: 'object' as const, object });
/** Alice's next upkeep, with its triggers waiting to resolve. */
function nextUpkeep(g: GameState): GameState {
  g = toStep(g, 'upkeep', 'bob');
  g = toStep(g, 'draw', 'bob');
  for (let i = 0; i < 400 && !(g.active === 'alice' && g.step === 'upkeep'); i++) {
    if (g.pending?.kind === 'declare_attackers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_attackers', attacks: [] } });
    else if (g.pending?.kind === 'discard_to_hand_size') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'discard_to_hand_size', objects: g.zones.hand[g.pending.player]!.slice(0, g.pending.count) } });
    else g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
}

describe('keywords: fading, retrace, transmute, cumulative upkeep', () => {
  it('CR 702.32a: fading — a counter each upkeep; when there’s none to remove, sacrifice it', () => {
    let g = setup();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Fader', 'hand') }));
    const fader = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Fader')!;
    expect(g.objects[fader]!.counters.fade).toBe(1);
    g = settle(nextUpkeep(g));
    expect(g.objects[fader]!.zone).toBe('battlefield');
    expect(g.objects[fader]!.counters.fade).toBeUndefined();
    g = settle(nextUpkeep(g));
    expect(g.objects[fader]!.zone).toBe('graveyard');
  });

  it('CR 702.81a: retrace — cast from the graveyard by discarding a land card, paying the mana cost too', () => {
    let g = setup();
    const spell = give(g, 'alice', 'Retracer', 'graveyard');
    const forest = give(g, 'alice', 'Forest', 'hand');
    const cast = legalActions(g, 'alice').find((a) => a.type === 'cast' && a.object === spell);
    expect(cast).toMatchObject({ alt: 'retrace' });
    g = settle(act(g, { ...cast!, costs: { discard: [forest] } } as never));
    expect(g.players.alice!.life).toBe(23);
    expect(g.objects[forest]!.zone).toBe('graveyard');
    expect(g.players.alice!.pool.G).toBe(4);
  });

  it('CR 702.53a: transmute — search for a card with the same mana value', () => {
    let g = setup();
    const t = give(g, 'alice', 'Transmuter', 'hand');
    const bear = give(g, 'alice', 'Two Drop', 'library');
    g = act(g, { type: 'activate', player: 'alice', object: t, ability: 0 });
    g = settle(g);
    expect(g.pending?.kind).toBe('search');
    const candidates = (g.pending as { candidates: string[] }).candidates;
    expect(candidates).toContain(bear);
    expect(candidates.every((id) => g.cards[g.objects[id]!.card]!.cmc === 2)).toBe(true);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [bear] } }));
    expect(g.objects[bear]!.zone).toBe('hand');
  });

  it('cumulative upkeep paid in life', () => {
    let g = setup();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ager', 'hand') }));
    g = nextUpkeep(g);
    for (let i = 0; i < 10 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'pay') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true } });
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.players.alice!.life).toBe(19);
    const ager = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Ager');
    expect(ager).toBeDefined();
  });
});

describe('costs and library placement', () => {
  it('“Discard a land card” as a cost', () => {
    let g = setup();
    const looter = give(g, 'alice', 'Land Looter', 'battlefield');
    // Only a nonland card in hand.
    for (const id of g.zones.hand.alice!) g.objects[id]!.zone = 'library';
    g.zones.library.alice!.push(...g.zones.hand.alice!);
    g.zones.hand.alice = [];
    const bear = give(g, 'alice', 'Grizzly', 'hand');
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === looter)).toBe(false);
    expect(() => act(g, { type: 'activate', player: 'alice', object: looter, ability: 0, costs: { discard: [bear] } })).toThrow(/discard/);
    const forest = give(g, 'alice', 'Forest', 'hand');
    g = settle(act(g, { type: 'activate', player: 'alice', object: looter, ability: 0, costs: { discard: [forest] } }));
    expect(g.objects[forest]!.zone).toBe('graveyard');
  });

  it('“… puts it on their choice of the top or bottom of their library” — the owner chooses', () => {
    let g = setup();
    const bear = give(g, 'bob', 'Grizzly', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Downdraft Lite', 'hand'), targets: [[obj(bear)]] }));
    expect(g.pending).toMatchObject({ kind: 'choose_option', player: 'bob', options: ['top', 'bottom'] });
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'choose_option', choice: 'bottom' } }));
    expect(g.zones.library.bob!.at(-1)).toBe(bear);
  });

  it('“When ~ is put into a graveyard from anywhere, shuffle it into its owner’s library.”', () => {
    let g = setup();
    const dread = give(g, 'alice', 'Dread Lite', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder Lite', 'hand'), targets: [[obj(dread)]] }));
    expect(g.objects[dread]!.zone).toBe('library');
  });
});
