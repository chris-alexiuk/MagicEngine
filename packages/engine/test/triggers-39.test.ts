import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{1}', cmc: 1, ...extra });
const bear = (name: string, oracle_text = '') => card(name, 'Creature — Bear', oracle_text, { power: '2', toughness: '2' });

const CARDS = [
  bear('Grizzly'),
  bear('Rallier', 'Whenever you attack with two or more creatures, you gain 3 life.'),
  card('Cycler', 'Creature — Beast', 'Cycling {1}\nWhen you cycle this card, you gain 2 life.', { power: '3', toughness: '3' }),
  card('Cycle Watcher', 'Enchantment', 'Whenever a player cycles a card, you gain 1 life.'),
  card('Discard Watcher', 'Enchantment', 'Whenever you discard one or more cards, you gain 1 life.'),
  card('Second Spell', 'Enchantment', 'Whenever you cast your second spell each turn, you gain 2 life.'),
  card('Gain One', 'Instant', 'You gain 1 life.', { mana_cost: '{0}', cmc: 0 }),
  bear('Sneaker', 'Whenever this creature attacks and isn’t blocked, defending player loses 2 life.'),
  card('Raid Boss', 'Enchantment', 'Whenever one or more creatures you control deal combat damage to a player, you gain 1 life.'),
  card('Clue Lite', 'Artifact — Clue', '{0}, Sacrifice this artifact: Draw a card.'),
  card('Clue Watcher', 'Enchantment', 'Whenever you sacrifice a Clue, you gain 1 life.'),
  card('Investigator', 'Sorcery', 'Investigate.', { mana_cost: '{0}', cmc: 0 }),
  card('Seer', 'Enchantment', 'Whenever you scry, you gain 1 life.'),
  card('Peek', 'Sorcery', 'Scry 2.', { mana_cost: '{0}', cmc: 0 }),
  bear('Grower', 'Whenever one or more +1/+1 counters are put on this creature, you gain that much life.'),
  card('Feed', 'Sorcery', 'Put two +1/+1 counters on target creature.', { mana_cost: '{0}', cmc: 0 }),
  card('Grave Watcher', 'Enchantment', 'Whenever one or more cards leave your graveyard, you gain 1 life.'),
  card('Raise', 'Sorcery', 'Return target creature card from your graveyard to your hand.', { mana_cost: '{0}', cmc: 0 }),
  bear('Waker', 'Whenever this creature becomes untapped, you gain 1 life.'),
  bear('Biter', 'Whenever this creature deals damage to an opponent, that player discards a card.'),
  bear('Fader', 'At end of combat, sacrifice this creature.'),
];

function setup(players = 2): GameState {
  const g = toStep(start({ extra: CARDS, players }), 'main1');
  g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 10 };
  return g;
}
function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && (g.stack.length || g.pending); i++) {
    const p = g.pending;
    if (p?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'declare_blockers', blocks: [] } });
    else if (p?.kind === 'scry') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'scry', top: p.objects, bottom: [] } });
    else if (p?.kind === 'discard') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'discard', objects: g.zones.hand[p.player]!.slice(0, 1) } as never });
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
const attack = (g: GameState, ...ids: string[]) =>
  act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: ids.map((attacker) => ({ attacker, target: { kind: 'player', player: 'bob' } })) } });
const cast = (g: GameState, name: string, extra: Record<string, unknown> = {}) => act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), ...extra } as never);
const life = (g: GameState) => g.players.alice!.life;

describe('slice 39 triggers: attacking', () => {
  it('CR 508.3d: “Whenever you attack with two or more creatures”', () => {
    let g = setup();
    const r = give(g, 'alice', 'Rallier', 'battlefield');
    const b = give(g, 'alice', 'Grizzly', 'battlefield');
    g = settle(attack(toAttack(g), r));
    expect(life(g)).toBe(20);
    g = setup();
    const r2 = give(g, 'alice', 'Rallier', 'battlefield');
    const b2 = give(g, 'alice', 'Grizzly', 'battlefield');
    g = settle(attack(toAttack(g), r2, b2));
    expect(life(g)).toBe(23);
    expect(b).toBeTruthy();
  });

  it('CR 509.3g: “attacks and isn’t blocked” — even when the defender had no creatures to block with', () => {
    let g = setup();
    const s = give(g, 'alice', 'Sneaker', 'battlefield');
    g = settle(attack(toAttack(g), s));
    // 2 combat damage plus 2 life lost.
    g = toStep(g, 'main2');
    expect(g.players.bob!.life).toBe(16);
  });

  it('CR 509.3g: no trigger when it’s blocked', () => {
    let g = setup();
    const s = give(g, 'alice', 'Sneaker', 'battlefield');
    const blocker = give(g, 'bob', 'Grizzly', 'battlefield');
    g = attack(toAttack(g), s);
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    expect(g.pending).toMatchObject({ kind: 'declare_blockers', player: 'bob' });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker, attacker: s }] } });
    g = toStep(g, 'main2');
    expect(g.players.bob!.life).toBe(20);
  });

  it('“Whenever one or more creatures you control deal combat damage to a player” triggers once', () => {
    let g = setup();
    give(g, 'alice', 'Raid Boss', 'battlefield');
    const a = give(g, 'alice', 'Grizzly', 'battlefield');
    const b = give(g, 'alice', 'Grizzly', 'battlefield');
    g = settle(attack(toAttack(g), a, b));
    g = toStep(g, 'main2');
    expect(g.players.bob!.life).toBe(16);
    expect(life(g)).toBe(21);
  });

  it('“deals damage to an opponent, that player discards a card”; “At end of combat, sacrifice ~”', () => {
    let g = setup();
    const biter = give(g, 'alice', 'Biter', 'battlefield');
    const fader = give(g, 'alice', 'Fader', 'battlefield');
    const hand = g.zones.hand.bob!.length;
    g = settle(attack(toAttack(g), biter, fader));
    while (g.step !== 'main2') g = settle(act(g, { type: 'pass', player: g.priority! }));
    expect(g.zones.hand.bob!.length).toBe(hand - 1);
    expect(g.objects[fader]!.zone).toBe('graveyard');
  });
});

describe('slice 39 triggers: cycling, discard, spells', () => {
  it('CR 702.29c: “When you cycle this card” triggers from the graveyard; CR 702.29d: cycling is a discard', () => {
    let g = setup();
    give(g, 'alice', 'Cycle Watcher', 'battlefield');
    give(g, 'alice', 'Discard Watcher', 'battlefield');
    const c = give(g, 'alice', 'Cycler', 'hand');
    g = settle(act(g, { type: 'activate', player: 'alice', object: c, ability: 0 }));
    expect(g.objects[c]!.zone).toBe('graveyard');
    expect(life(g)).toBe(24);
  });

  it('“Whenever you cast your second spell each turn”', () => {
    let g = setup();
    give(g, 'alice', 'Second Spell', 'battlefield');
    g = settle(cast(g, 'Gain One'));
    expect(life(g)).toBe(21);
    g = settle(cast(g, 'Gain One'));
    expect(life(g)).toBe(24);
    g = settle(cast(g, 'Gain One'));
    expect(life(g)).toBe(25);
  });

  it('CR 701.21a: “Whenever you sacrifice a Clue” — a Clue token too', () => {
    let g = setup();
    give(g, 'alice', 'Clue Watcher', 'battlefield');
    const clue = give(g, 'alice', 'Clue Lite', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: clue, ability: 0 }));
    expect(life(g)).toBe(21);
    g = settle(cast(g, 'Investigator'));
    const token = g.zones.battlefield.find((id) => g.objects[id]!.token)!;
    expect(token).toBeTruthy();
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 };
    g = settle(act(g, { type: 'activate', player: 'alice', object: token, ability: 0 }));
    expect(life(g)).toBe(22);
  });

  it('CR 701.22: “Whenever you scry”', () => {
    let g = setup();
    give(g, 'alice', 'Seer', 'battlefield');
    g = settle(cast(g, 'Peek'));
    expect(life(g)).toBe(21);
  });
});

describe('slice 39 triggers: counters, graveyards, untapping', () => {
  it('“Whenever one or more +1/+1 counters are put on ~, you gain that much life”', () => {
    let g = setup();
    const grower = give(g, 'alice', 'Grower', 'battlefield');
    g = settle(cast(g, 'Feed', { targets: [[{ kind: 'object', object: grower }]] }));
    expect(life(g)).toBe(22);
  });

  it('“Whenever one or more cards leave your graveyard”', () => {
    let g = setup();
    give(g, 'alice', 'Grave Watcher', 'battlefield');
    const dead = give(g, 'alice', 'Grizzly', 'graveyard');
    g = settle(cast(g, 'Raise', { targets: [[{ kind: 'object', object: dead }]] }));
    expect(g.objects[dead]!.zone).toBe('hand');
    expect(life(g)).toBe(21);
  });

  it('“Whenever ~ becomes untapped” — in the untap step', () => {
    let g = setup();
    const w = give(g, 'alice', 'Waker', 'battlefield');
    g.objects[w]!.tapped = true;
    g = toStep(g, 'upkeep', 'bob');
    g = settle(toStep(g, 'upkeep', 'alice'));
    expect(g.objects[w]!.tapped).toBe(false);
    expect(life(g)).toBe(21);
  });
});
