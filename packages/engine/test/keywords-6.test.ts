import { describe, expect, it } from 'vitest';
import { hasType, legalActions, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{1}', ...extra });

const CARDS = [
  card('Casualty Bolt', 'Instant', 'This spell deals 1 damage to any target.\nCasualty 2', { mana_cost: '{R}' }),
  card('Grafter', 'Creature — Plant', 'Graft 2', { power: '0', toughness: '0' }),
  card('Devourer', 'Creature — Dragon', 'Devour 2', { power: '1', toughness: '1' }),
  card('Umbra Lite', 'Enchantment — Aura', 'Enchant creature\nUmbra armor'),
  card('Jumper', 'Instant', 'You gain 2 life.\nJump-start', { mana_cost: '{W}' }),
  card('Surger', 'Sorcery', 'Draw two cards.\nSurge {U}', { mana_cost: '{5}{U}' }),
  card('Waker', 'Sorcery', 'You gain 1 life.\nAwaken 2—{2}{G}', { mana_cost: '{G}' }),
  card('Crown Blade', 'Artifact — Equipment', 'Equipped creature gets +1/+1.\nEquip legendary creature {1}'),
  card('Lifeback', 'Sorcery', 'You gain 5 life.\nFlashback—{1}, Pay 3 life.'),
  card('Grizzly', 'Creature — Bear', '', { power: '2', toughness: '2' }),
  card('Hero', 'Legendary Creature — Human', '', { power: '2', toughness: '2' }),
  card('Murder Lite', 'Instant', 'Destroy target creature.'),
  card('Shock Lite', 'Instant', 'This spell deals 1 damage to any target.', { mana_cost: '{R}' }),
];

function setup(): GameState {
  const g = toStep(start({ extra: CARDS }), 'main1');
  g.players.alice!.pool = { W: 5, U: 5, B: 5, R: 5, G: 5, C: 10 };
  return g;
}
function settle(g: GameState): GameState {
  for (let i = 0; i < 40 && (g.stack.length || g.pending); i++) {
    const p = g.pending;
    if (p?.kind === 'copy_targets') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'copy_targets' } });
    else if (p?.kind === 'may') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'may', yes: true } });
    else if (p) break;
    else g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
}
const obj = (object: string) => ({ kind: 'object' as const, object });
const bob = { kind: 'player' as const, player: 'bob' };
const cast = (g: GameState, name: string, extra: Record<string, unknown> = {}) => act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), ...extra } as never);

describe('keyword batch: casualty, graft, devour, umbra armor', () => {
  it('CR 702.153a: casualty — sacrifice a creature with enough power and the spell is copied', () => {
    let g = setup();
    const bear = give(g, 'alice', 'Grizzly', 'battlefield');
    g = settle(cast(g, 'Casualty Bolt', { targets: [[bob]], extras: ['casualty'], costs: { sacrifice: [bear] } }));
    expect(g.objects[bear]!.zone).toBe('graveyard');
    expect(g.players.bob!.life).toBe(18);
  });

  it('CR 702.58a: graft — enters with counters, may move one onto another creature that enters', () => {
    let g = setup();
    g = settle(cast(g, 'Grafter'));
    const grafter = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Grafter')!;
    expect(g.objects[grafter]!.counters['+1/+1']).toBe(2);
    g = settle(cast(g, 'Grizzly'));
    const bear = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Grizzly')!;
    expect(g.objects[grafter]!.counters['+1/+1']).toBe(1);
    expect(g.objects[bear]!.counters['+1/+1']).toBe(1);
  });

  it('CR 702.82a: devour — sacrifice creatures as it enters for counters', () => {
    let g = setup();
    const a = give(g, 'alice', 'Grizzly', 'battlefield');
    const b = give(g, 'alice', 'Grizzly', 'battlefield');
    g = cast(g, 'Devourer');
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'devour' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', sacrifice: [a, b] } });
    const dragon = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Devourer')!;
    expect(g.objects[dragon]!.counters['+1/+1']).toBe(4);
    expect([g.objects[a]!.zone, g.objects[b]!.zone]).toEqual(['graveyard', 'graveyard']);
  });

  it('CR 702.89a: umbra armor — the Aura is destroyed instead, and the damage is removed', () => {
    let g = setup();
    const bear = give(g, 'alice', 'Grizzly', 'battlefield');
    const umbra = give(g, 'alice', 'Umbra Lite', 'battlefield');
    g.objects[umbra]!.attachedTo = { id: bear, zcc: g.objects[bear]!.zcc };
    g.objects[bear]!.damage = 1;
    g = settle(cast(g, 'Murder Lite', { targets: [[obj(bear)]] }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.objects[bear]!.damage).toBe(0);
    expect(g.objects[umbra]!.zone).toBe('graveyard');
  });
});

describe('keyword batch: jump-start, surge, awaken, equip with a quality, flashback with life', () => {
  it('CR 702.133a: jump-start — from the graveyard, discarding a card; then exiled', () => {
    let g = setup();
    const j = give(g, 'alice', 'Jumper', 'graveyard');
    const fodder = give(g, 'alice', 'Grizzly', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: j, alt: 'jump_start', costs: { discard: [fodder] } }));
    expect(g.players.alice!.life).toBe(22);
    expect(g.objects[j]!.zone).toBe('exile');
    expect(g.objects[fodder]!.zone).toBe('graveyard');
  });

  it('CR 702.117a: surge — only after you’ve cast another spell this turn', () => {
    let g = setup();
    const s = give(g, 'alice', 'Surger', 'hand');
    expect(() => act(g, { type: 'cast', player: 'alice', object: s, alt: 'surge' })).toThrow(/for that cost/);
    g = settle(cast(g, 'Shock Lite', { targets: [[bob]] }));
    g.players.alice!.pool = { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 };
    g = settle(act(g, { type: 'cast', player: 'alice', object: s, alt: 'surge' }));
    expect(g.objects[s]!.zone).toBe('graveyard');
  });

  it('CR 702.113a: awaken — a land you control becomes a 0/0 Elemental with counters', () => {
    let g = setup();
    const land = give(g, 'alice', 'Forest', 'battlefield');
    g = settle(cast(g, 'Waker', { alt: 'awaken', targets: [[obj(land)]] }));
    expect(g.players.alice!.life).toBe(21);
    expect(hasType(g, g.objects[land]!, 'Creature')).toBe(true);
    expect(hasType(g, g.objects[land]!, 'Land')).toBe(true);
    expect(g.objects[land]!.counters['+1/+1']).toBe(2);
  });

  it('“Equip legendary creature {1}” attaches only to a legendary creature', () => {
    let g = setup();
    const blade = give(g, 'alice', 'Crown Blade', 'battlefield');
    const bear = give(g, 'alice', 'Grizzly', 'battlefield');
    const hero = give(g, 'alice', 'Hero', 'battlefield');
    expect(() => act(g, { type: 'activate', player: 'alice', object: blade, ability: 0, targets: [[obj(bear)]] })).toThrow(/legal target/);
    g = settle(act(g, { type: 'activate', player: 'alice', object: blade, ability: 0, targets: [[obj(hero)]] }));
    expect(g.objects[blade]!.attachedTo?.id).toBe(hero);
  });

  it('“Flashback—{1}, Pay 3 life.”', () => {
    let g = setup();
    const fb = give(g, 'alice', 'Lifeback', 'graveyard');
    const offer = legalActions(g, 'alice').find((a) => a.type === 'cast' && a.object === fb);
    expect(offer).toMatchObject({ alt: 'flashback' });
    g = settle(act(g, offer!));
    expect(g.players.alice!.life).toBe(22);
    expect(g.objects[fb]!.zone).toBe('exile');
  });
});
