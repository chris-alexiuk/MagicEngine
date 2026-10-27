import { describe, expect, it } from 'vitest';
import { legalActions, power, toughness, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const prep = (name: string, spell: string, creatureText: string, spellText: string, spellType = 'Sorcery') =>
  makeCard({
    name: `${name} // ${spell}`,
    layout: 'prepare',
    type_line: `Creature — Human Warlock // ${spellType}`,
    oracle_text: '',
    mana_cost: '{1}{G}',
    card_faces: [
      { object: 'card_face', name, type_line: 'Creature — Human Warlock', mana_cost: '{1}{G}', power: '2', toughness: '2', oracle_text: creatureText },
      { object: 'card_face', name: spell, type_line: spellType, mana_cost: '{G}', oracle_text: spellText },
    ],
  } as never);

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{1}', ...extra });

const CARDS = [
  prep('Eager Eater', 'Have a Bite', "This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)", 'Put a +1/+1 counter on target creature. You gain 1 life.'),
  prep('Patient Sage', 'Quick Study', '{T}: This creature becomes prepared.', 'Draw a card.', 'Instant'),
  card('Twister Lite', 'Sorcery', 'Each player shuffles their hand and graveyard into their library, then draws seven cards.'),
  card('Dissipate Lite', 'Instant', "Counter target spell. If that spell is countered this way, exile it instead of putting it into its owner's graveyard."),
  card('Lesson Lite', 'Sorcery', 'Learn.'),
  card('Explore Lite', 'Sorcery', 'You may play an additional land this turn.'),
  card('Shrink Lite', 'Instant', 'Target creature has base power and toughness 1/1 until end of turn.'),
  card('Chaos Lite', 'Instant', 'The owner of target permanent shuffles it into their library.'),
  card('Grizzly', 'Creature — Bear', '', { power: '2', toughness: '2' }),
  card('Tomekeeper Lite', 'Artifact', '{T}: Target creature becomes prepared.'),
];

function setup(): GameState {
  const g = toStep(start({ extra: CARDS }), 'main1');
  g.players.alice!.pool = { W: 0, U: 5, B: 0, R: 0, G: 10, C: 10 };
  g.players.bob!.pool = { W: 0, U: 5, B: 0, R: 0, G: 5, C: 10 };
  return g;
}
function priorityTo(g: GameState, player: string): GameState {
  while (g.priority && g.priority !== player) g = act(g, { type: 'pass', player: g.priority });
  return g;
}
/** Passes priority one player at a time until the stack is empty. */
function settle(g: GameState): GameState {
  for (let i = 0; i < 40 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const exileCopies = (g: GameState) => g.zones.exile.filter((id) => g.objects[id]!.prepareOf);

describe('CR 722: preparation cards', () => {
  it('CR 722.3c: “enters prepared” makes a copy of its spell in exile; casting it unprepares the permanent', () => {
    let g = setup();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Eager Eater // Have a Bite', 'hand') }));
    const eater = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Eager Eater // Have a Bite')!;
    expect(g.objects[eater]!.prepared).toBe(true);
    const [copy] = exileCopies(g);
    expect(copy).toBeDefined();
    const casts = legalActions(g, 'alice').filter((a) => a.type === 'cast' && a.object === copy);
    expect(casts).toHaveLength(1);
    g = act(g, { type: 'cast', player: 'alice', object: copy!, targets: [[{ kind: 'object', object: eater }]] });
    expect(g.objects[eater]!.prepared).toBeUndefined();
    expect(g.objects[copy!]!.zone).toBe('stack');
    g = settle(g);
    expect(g.objects[eater]!.counters['+1/+1']).toBe(1);
    expect(g.players.alice!.life).toBe(21);
    // A copy of a card off the stack ceases to exist (CR 707.10a).
    expect(g.objects[copy!]).toBeUndefined();
  });

  it('“becomes prepared” only once; the copy goes away when the permanent leaves', () => {
    let g = setup();
    const sage = give(g, 'alice', 'Patient Sage // Quick Study', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: sage, ability: 0 }));
    expect(g.objects[sage]!.prepared).toBe(true);
    expect(exileCopies(g)).toHaveLength(1);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Chaos Lite', 'hand'), targets: [[{ kind: 'object', object: sage }]] }));
    expect(g.objects[sage]!.zone).toBe('library');
    expect(exileCopies(g)).toHaveLength(0);
  });

  it('a permanent without a prepare spell can’t become prepared (CR 722.3a)', () => {
    let g = setup();
    const bear = give(g, 'alice', 'Grizzly', 'battlefield');
    const tome = give(g, 'alice', 'Tomekeeper Lite', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: tome, ability: 0, targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[bear]!.prepared).toBeUndefined();
    expect(exileCopies(g)).toHaveLength(0);
  });
});

describe('shuffling into libraries, counterspells that exile, learn, extra lands', () => {
  it('CR 701.24a: “Each player shuffles their hand and graveyard into their library, then draws seven cards.”', () => {
    let g = setup();
    give(g, 'alice', 'Grizzly', 'graveyard');
    give(g, 'bob', 'Grizzly', 'graveyard');
    const before = { alice: g.zones.library.alice!.length + g.zones.hand.alice!.length + 1, bob: g.zones.library.bob!.length + g.zones.hand.bob!.length + 1 };
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Twister Lite', 'hand') }));
    expect(g.zones.hand.alice).toHaveLength(7);
    expect(g.zones.hand.bob).toHaveLength(7);
    expect(g.zones.graveyard.bob).toHaveLength(0);
    expect(g.zones.library.alice!.length + 7).toBe(before.alice);
    expect(g.zones.library.bob!.length + 7).toBe(before.bob);
  });

  it('“If that spell is countered this way, exile it instead”', () => {
    let g = setup();
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Grizzly', 'hand') });
    const bear = g.stack[0]!.kind === 'spell' ? g.stack[0]!.object : '';
    g = priorityTo(g, 'bob');
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Dissipate Lite', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[bear]!.zone).toBe('exile');
  });

  it('CR 701.48a: learn — discard a card to draw one', () => {
    let g = setup();
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Lesson Lite', 'hand') });
    g = settle(g);
    expect(g.pending?.kind).toBe('may');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    if (g.pending?.kind === 'discard') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: [g.zones.hand.alice![0]!] } });
    g = settle(g);
    expect(g.zones.hand.alice).toHaveLength(hand);
    expect(g.zones.graveyard.alice!.length).toBe(2);
  });

  it('CR 305.2: “You may play an additional land this turn.”', () => {
    let g = setup();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Explore Lite', 'hand') }));
    g = act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Forest', 'hand') });
    g = act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Forest', 'hand') });
    expect(() => act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Forest', 'hand') })).toThrow(/already played/);
  });

  it('layer 7b: “has base power and toughness 1/1 until end of turn” — counters still apply', () => {
    let g = setup();
    const bear = give(g, 'alice', 'Grizzly', 'battlefield');
    g.objects[bear]!.counters['+1/+1'] = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Shrink Lite', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    expect([power(g, g.objects[bear]!), toughness(g, g.objects[bear]!)]).toEqual([2, 2]);
  });
});
