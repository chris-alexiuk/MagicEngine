import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Swine', type_line: 'Sorcery', mana_cost: '{X}{U}{U}', cmc: 2, colors: ['U'], color_identity: ['U'], oracle_text: 'Exile X target creatures. For each creature exiled this way, its controller creates a 2/2 green Boar creature token.' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Tapper', type_line: 'Creature — Human', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{X}, {T}: Tap X target creatures.' }),
  makeCard({ name: 'Terrasymbiosis', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever you put one or more +1/+1 counters on a creature you control, you may draw that many cards. Do this only once each turn.' }),
  makeCard({ name: 'Growth', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Put two +1/+1 counters on target creature.' }),
  makeCard({ name: 'Lantern', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}: Target player loses 3 life unless they sacrifice a nonland permanent of their choice or discard a card.' }),
  makeCard({ name: 'Taxes', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each opponent loses 3 life unless that player sacrifices a nonland permanent of their choice or discards a card.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const boars = (g: GameState, p: string) => g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === p);

describe('staples (slice 159)', () => {
  it('Curse of the Swine: exactly X targets, a Boar for each exiled creature’s controller', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const a = give(g, 'bob', 'Bear', 'battlefield');
    const b = give(g, 'bob', 'Bear', 'battlefield');
    const c = give(g, 'alice', 'Bear', 'battlefield');
    const swine = give(g, 'alice', 'Swine', 'hand');
    g.players.alice!.pool.U = 2;
    g.players.alice!.pool.C = 3;
    // X is 3: three targets, no fewer.
    expect(illegal(g, { type: 'cast', player: 'alice', object: swine, x: 3, targets: [[{ kind: 'object', object: a }, { kind: 'object', object: b }]] })).toMatch(/Choose 3/);
    g = settle(act(g, { type: 'cast', player: 'alice', object: swine, x: 3, targets: [[a, b, c].map((object) => ({ kind: 'object' as const, object }))] }));
    for (const id of [a, b, c]) expect(g.objects[id]!.zone).toBe('exile');
    expect(boars(g, 'bob')).toHaveLength(2);
    expect(boars(g, 'alice')).toHaveLength(1);
  });

  it('X = 0 takes no targets', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'bob', 'Bear', 'battlefield');
    g.players.alice!.pool.U = 2;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Swine', 'hand'), x: 0, targets: [[]] }));
    expect(boars(g, 'bob')).toHaveLength(0);
  });

  it('an activated ability with X targets', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const tapper = give(g, 'alice', 'Tapper', 'battlefield');
    const a = give(g, 'bob', 'Bear', 'battlefield');
    const b = give(g, 'bob', 'Bear', 'battlefield');
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'activate', player: 'alice', object: tapper, ability: 0, x: 2, targets: [[{ kind: 'object', object: a }, { kind: 'object', object: b }]] }));
    expect(g.objects[a]!.tapped).toBe(true);
    expect(g.objects[b]!.tapped).toBe(true);
  });

  it('Terrasymbiosis: "Do this only once each turn" — only after the draw was taken (CR 603.2h)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Terrasymbiosis', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    const grow = () => {
      g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Growth', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    };
    // Declined: it triggers again.
    grow();
    expect(g.pending?.kind).toBe('may');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: false } }));
    grow();
    expect(g.pending?.kind).toBe('may');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
    // Taken: not again this turn.
    grow();
    expect(g.pending).toBeFalsy();
    expect(g.stack).toHaveLength(0);
  });

  it("Tergrid's Lantern: lose 3 life unless they sacrifice a nonland permanent or discard", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lantern = give(g, 'alice', 'Lantern', 'battlefield');
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'activate', player: 'alice', object: lantern, ability: 0, targets: [[{ kind: 'player', player: 'bob' }]] }));
    // Bob has cards in hand but no nonland permanent: discard, or neither.
    expect(g.pending?.kind).toBe('choose_option');
    const options = (g.pending as { options: string[] }).options;
    expect(options).toHaveLength(2);
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'choose_option', choice: options[1]! } }));
    expect(g.players.bob!.life).toBe(life - 3);
  });

  it('each opponent, on their own (APNAP)', () => {
    let g = start({ extra: CARDS, players: 3 });
    g = toStep(g, 'main1', 'alice');
    give(g, 'bob', 'Bear', 'battlefield');
    const bobLife = g.players.bob!.life;
    const carolLife = g.players.carol!.life;
    const bobHand = g.zones.hand.bob!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Taxes', 'hand') }));
    expect(g.pending?.player).toBe('bob');
    let options = (g.pending as { options: string[] }).options;
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'choose_option', choice: options.find((o) => /iscard/.test(o))! } });
    expect(g.pending?.player).toBe('carol');
    options = (g.pending as { options: string[] }).options;
    g = act(g, { type: 'choose', player: 'carol', answer: { kind: 'choose_option', choice: options.at(-1)! } });
    for (let i = 0; i < 5 && g.pending; i++) {
      if (g.pending.kind === 'discard') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'discard', objects: g.zones.hand[g.pending.player]!.slice(0, 1) } });
    }
    g = settle(g);
    expect(g.zones.hand.bob!.length).toBe(bobHand - 1);
    expect(g.players.bob!.life).toBe(bobLife);
    expect(g.players.carol!.life).toBe(carolLife - 3);
  });
});
