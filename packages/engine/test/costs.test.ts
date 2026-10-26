import { describe, expect, it } from 'vitest';
import { power, type GameState, type Target } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{G}', ...extra });

const CARDS = [
  card('Mana Leak', 'Instant', 'Counter target spell unless its controller pays {3}.'),
  card('Upkeep Bear', 'Creature — Bear', 'At the beginning of your upkeep, sacrifice this creature unless you pay {1}.', { power: '3', toughness: '3' }),
  card('Paying Elf', 'Creature — Elf', 'When this creature enters, you may pay {2}. If you do, draw a card.', { power: '1', toughness: '1' }),
  card('Rampant Growth', 'Sorcery', 'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.'),
  card('Demonic Tutor', 'Sorcery', 'Search your library for a card, put it into your hand, then shuffle.'),
  card('Verdant Field', 'Land', '{T}, Pay 1 life, Sacrifice this land: Search your library for a Forest or Island card, put it onto the battlefield, then shuffle.', { mana_cost: '' }),
  card('Pain Grove', 'Land', '{T}: Add {C}.\n{T}: Add {G} or {W}. This land deals 1 damage to you.', { mana_cost: '' }),
  card('Seething Song', 'Instant', 'Add {R}{R}{R}{R}{R}.'),
  card('Hydra', 'Creature — Hydra', 'This creature enters with X +1/+1 counters on it.', { mana_cost: '{X}{G}', power: '0', toughness: '0' }),
  card('Monster', 'Creature — Beast', '{G}: Monstrosity 2.', { power: '2', toughness: '2' }),
  card('Pridemate', 'Creature — Cat', 'Whenever you gain life, put a +1/+1 counter on this creature.', { power: '2', toughness: '2' }),
  card('Healing Salve', 'Instant', 'You gain 3 life.'),
  card('Flash Bear', 'Creature — Bear', 'Flash', { power: '2', toughness: '2' }),
  card('Edict', 'Sorcery', 'Each opponent sacrifices a creature.'),
  card('Altar', 'Artifact', 'Sacrifice a creature: Add {C}{C}.'),
  card('Seer', 'Creature — Vampire', 'Sacrifice another creature: Scry 1.', { power: '1', toughness: '1' }),
  card('Costly Insight', 'Sorcery', 'As an additional cost to cast this spell, sacrifice a creature.\nDraw two cards.'),
  card('Mad Insight', 'Sorcery', 'As an additional cost to cast this spell, discard a card.\nDraw two cards.'),
  card('Eldrazi', 'Creature — Eldrazi', 'Annihilator 1', { power: '4', toughness: '4' }),
  makeCard({
    name: 'Daybreak Ranger // Nightfall Predator',
    layout: 'transform',
    type_line: 'Creature — Human Werewolf // Creature — Werewolf',
    oracle_text: '',
    mana_cost: '{G}',
    card_faces: [
      { object: 'card_face', name: 'Daybreak Ranger', type_line: 'Creature — Human Werewolf', oracle_text: '{1}: Transform this creature.', mana_cost: '{G}', power: '2', toughness: '2' },
      { object: 'card_face', name: 'Nightfall Predator', type_line: 'Creature — Werewolf', oracle_text: '', mana_cost: '', power: '4', toughness: '4' },
    ],
  } as never),
];

function setup(lands = 4): GameState {
  const g = toStep(start({ extra: CARDS }), 'main1');
  for (let i = 0; i < lands; i++) give(g, 'alice', 'Forest', 'battlefield');
  return g;
}
const obj = (object: string): Target => ({ kind: 'object', object });

describe('paying as it resolves (CR 118.12)', () => {
  function leak(bobPays: boolean) {
    let g = setup(1);
    for (let i = 0; i < 4; i++) give(g, 'bob', 'Forest', 'battlefield');
    const leakId = give(g, 'alice', 'Mana Leak', 'hand');
    const bear = give(g, 'bob', 'Flash Bear', 'hand');
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'cast', player: 'bob', object: bear, autoTap: true });
    g = act(g, { type: 'pass', player: 'bob' });
    g = act(g, { type: 'cast', player: 'alice', object: leakId, autoTap: true, targets: [[obj(bear)]] });
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'pay', player: 'bob', cost: '{3}' });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'pay', pay: bobPays } });
    return { g, bear };
  }

  it('CR 118.12a: "counter unless its controller pays" — paying keeps the spell', () => {
    const { g, bear } = leak(true);
    expect(g.objects[bear]!.zone).toBe('stack');
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.controller === 'bob' && g.objects[id]!.tapped)).toHaveLength(4);
  });

  it('CR 118.12a: declining means it’s countered', () => {
    const { g, bear } = leak(false);
    expect(g.objects[bear]!.zone).toBe('graveyard');
  });

  it('a player can’t agree to pay what they can’t afford', () => {
    let g = setup(1);
    give(g, 'alice', 'Upkeep Bear', 'battlefield');
    g = toStep(g, 'upkeep', 'alice');
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'pay', player: 'alice', cost: '{1}' });
    // Forests untapped this turn: paying works.
    const paid = act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true } });
    expect(paid.zones.battlefield.some((id) => paid.cards[paid.objects[id]!.card]!.name === 'Upkeep Bear')).toBe(true);
    for (const id of g.zones.battlefield) g.objects[id]!.tapped = true;
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true } })).toMatch(/enough/);
    const declined = act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: false } });
    expect(declined.zones.graveyard.alice!.some((id) => declined.cards[declined.objects[id]!.card]!.name === 'Upkeep Bear')).toBe(true);
  });

  it('CR 118.12: "you may pay {2}. If you do, …"', () => {
    let g = setup(3);
    const elf = give(g, 'alice', 'Paying Elf', 'hand');
    g = passRound(passRound(act(g, { type: 'cast', player: 'alice', object: elf, autoTap: true })));
    expect(g.pending).toMatchObject({ kind: 'pay', player: 'alice', cost: '{2}' });
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true } });
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });
});

describe('searching libraries (CR 701.23)', () => {
  it('CR 701.23a / CR 701.24a: find a basic land, put it onto the battlefield tapped, shuffle', () => {
    let g = setup();
    const before = [...g.zones.library.alice!];
    const spell = give(g, 'alice', 'Rampant Growth', 'hand');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: spell, autoTap: true }));
    expect(g.pending).toMatchObject({ kind: 'search', player: 'alice', count: 1, mustFind: false });
    const p = g.pending as Extract<typeof g.pending, { kind: 'search' }>;
    // Only the basic lands qualify (the decks also hold one copy of each test card).
    expect(p.candidates).toEqual(before.filter((id) => g.objects[id]!.card === 'Forest'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [p.candidates[3]!] } });
    expect(g.objects[p.candidates[3]!]).toMatchObject({ zone: 'battlefield', tapped: true });
    expect(g.zones.library.alice!.length).toBe(before.length - 1);
  });

  it('CR 701.23b: a search for a quality may come up empty; CR 701.23d: "a card" must be found', () => {
    let g = setup();
    const tutor = give(g, 'alice', 'Demonic Tutor', 'hand');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: tutor, autoTap: true }));
    expect(g.pending).toMatchObject({ kind: 'search', mustFind: true });
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [] } })).toMatch(/Choose 1/);
    const pick = g.zones.library.alice![5]!;
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [pick] } });
    expect(g.objects[pick]!.zone).toBe('hand');
  });

  it('a fetchland: pay life, sacrifice, search', () => {
    let g = setup(0);
    const fetch = give(g, 'alice', 'Verdant Field', 'battlefield');
    g = act(g, { type: 'activate', player: 'alice', object: fetch, ability: 0 });
    expect(g.players.alice!.life).toBe(19);
    expect(g.objects[fetch]!.zone).toBe('graveyard');
    g = passRound(g);
    const p = g.pending as Extract<typeof g.pending, { kind: 'search' }>;
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [p.candidates[0]!] } });
    expect(g.objects[p.candidates[0]!]).toMatchObject({ zone: 'battlefield', tapped: false });
  });
});

describe('mana and keyword actions', () => {
  it('CR 605.1a: a painland’s colored ability deals damage to you', () => {
    let g = setup(0);
    const grove = give(g, 'alice', 'Pain Grove', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: grove, ability: 1, choice: 1 });
    expect(g.players.alice!.pool.W).toBe(1);
    expect(g.players.alice!.life).toBe(19);
  });

  it('CR 106.4: a ritual adds mana as it resolves', () => {
    let g = setup(1);
    g = passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Seething Song', 'hand'), autoTap: true }));
    expect(g.players.alice!.pool.R).toBe(5);
  });

  it('CR 107.3m: "enters with X counters" uses the X paid', () => {
    let g = setup(4);
    const hydra = give(g, 'alice', 'Hydra', 'hand');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: hydra, autoTap: true, x: 3 }));
    expect(g.objects[hydra]).toMatchObject({ zone: 'battlefield', counters: { '+1/+1': 3 } });
  });

  it('CR 701.37a: monstrosity happens only once', () => {
    let g = setup();
    const m = give(g, 'alice', 'Monster', 'battlefield');
    g = passRound(act(g, { type: 'activate', player: 'alice', object: m, ability: 0, autoTap: true }));
    g = passRound(act(g, { type: 'activate', player: 'alice', object: m, ability: 0, autoTap: true }));
    expect(g.objects[m]!.counters['+1/+1']).toBe(2);
    expect(g.objects[m]!.monstrous).toBe(true);
  });

  it('CR 701.27a: transforming turns a double-faced permanent over — same object', () => {
    let g = setup();
    const ranger = give(g, 'alice', 'Daybreak Ranger // Nightfall Predator', 'battlefield');
    const zcc = g.objects[ranger]!.zcc;
    g = passRound(act(g, { type: 'activate', player: 'alice', object: ranger, ability: 0, autoTap: true }));
    expect(g.objects[ranger]).toMatchObject({ face: 1, zcc });
    expect(power(g, g.objects[ranger]!)).toBe(4);
  });

  it('"whenever you gain life" triggers', () => {
    let g = setup();
    const cat = give(g, 'alice', 'Pridemate', 'battlefield');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Healing Salve', 'hand'), autoTap: true }));
    g = passRound(g);
    expect(g.objects[cat]!.counters['+1/+1']).toBe(1);
  });
});

describe('sacrifice and discard choices (CR 701.21, CR 601.2f)', () => {
  it('CR 701.21a: each opponent chooses what to sacrifice; with one choice there’s nothing to ask', () => {
    let g = setup();
    const [a, b] = [give(g, 'bob', 'Grizzly Bears', 'battlefield'), give(g, 'bob', 'Flash Bear', 'battlefield')];
    g = passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Edict', 'hand'), autoTap: true }));
    expect(g.pending).toMatchObject({ kind: 'sacrifice', player: 'bob', count: 1, candidates: [a, b] });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'sacrifice', objects: [b] } });
    expect([g.objects[a]!.zone, g.objects[b]!.zone]).toEqual(['battlefield', 'graveyard']);
    g = passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Edict', 'hand'), autoTap: true }));
    expect(g.pending).toBeNull();
    expect(g.objects[a]!.zone).toBe('graveyard');
  });

  it('a mana ability that costs a sacrifice', () => {
    let g = setup(0);
    const altar = give(g, 'alice', 'Altar', 'battlefield');
    const bear = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    expect(illegal(g, { type: 'activate_mana', player: 'alice', object: altar, ability: 0 })).toMatch(/Choose 1 permanent/);
    g = act(g, { type: 'activate_mana', player: 'alice', object: altar, ability: 0, costs: { sacrifice: [bear] } });
    expect(g.players.alice!.pool.C).toBe(2);
    expect(g.objects[bear]!.zone).toBe('graveyard');
  });

  it('“Sacrifice another creature” can’t sacrifice the source', () => {
    const g = setup(0);
    const seer = give(g, 'alice', 'Seer', 'battlefield');
    expect(illegal(g, { type: 'activate', player: 'alice', object: seer, ability: 0, costs: { sacrifice: [seer] } })).toMatch(/Choose 1/);
    const bear = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    act(g, { type: 'activate', player: 'alice', object: seer, ability: 0, costs: { sacrifice: [bear] } });
  });

  it('CR 601.2f: an additional cost to cast — sacrifice or discard — is paid with the spell', () => {
    let g = setup();
    const bear = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    const spell = give(g, 'alice', 'Costly Insight', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: spell, autoTap: true })).toMatch(/sacrifice/);
    g = act(g, { type: 'cast', player: 'alice', object: spell, autoTap: true, costs: { sacrifice: [bear] } });
    expect(g.objects[bear]!.zone).toBe('graveyard');
    g = passRound(g);
    const mad = give(g, 'alice', 'Mad Insight', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: mad, autoTap: true, costs: { discard: [mad] } })).toMatch(/discard/);
  });

  it('CR 702.86a: annihilator — the defending player sacrifices permanents', () => {
    let g = setup();
    const eldrazi = give(g, 'alice', 'Eldrazi', 'battlefield');
    const theirs = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    give(g, 'bob', 'Forest', 'battlefield');
    g = passRound(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: eldrazi, target: { kind: 'player', player: 'bob' } }] } });
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'sacrifice', player: 'bob', count: 1 });
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'sacrifice', objects: [theirs] } });
    expect(g.objects[theirs]!.zone).toBe('graveyard');
  });
});

describe('CR 601.2f: cost increases and reductions', () => {
  const mk = (name: string, type_line: string, oracle_text: string, mana_cost: string, pt?: string) =>
    makeCard({ name, type_line, oracle_text, mana_cost, ...(pt ? { power: pt, toughness: pt } : {}) });
  const EXTRA = [
    mk('Goblin Electromancer', 'Creature — Goblin Wizard', 'Instant and sorcery spells you cast cost {1} less to cast.', '{R}', '2'),
    mk('Thalia Lite', 'Creature — Human Soldier', 'Noncreature spells cost {1} more to cast.', '{W}', '2'),
    mk('Frogmite Lite', 'Artifact Creature — Frog', 'This spell costs {1} less to cast for each artifact you control.', '{4}', '2'),
    mk('Big Sorcery', 'Sorcery', 'Draw two cards.', '{2}{G}'),
    mk('Clockwork', 'Artifact', '', '{1}'),
  ];
  const setup = (forests: number) => {
    const g = toStep(start({ extra: EXTRA }), 'main1');
    for (let i = 0; i < forests; i++) give(g, 'alice', 'Forest', 'battlefield');
    return g;
  };
  const castIt = (g: GameState, name: string) => act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), autoTap: true });

  it('a reduction from a permanent you control', () => {
    const g = setup(2);
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Big Sorcery', 'hand'), autoTap: true })).toMatch(/enough/);
    give(g, 'alice', 'Goblin Electromancer', 'battlefield');
    castIt(g, 'Big Sorcery');
  });

  it('an increase for everyone, and reductions can’t go below the colored part', () => {
    const g = setup(3);
    give(g, 'bob', 'Thalia Lite', 'battlefield');
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Big Sorcery', 'hand'), autoTap: true })).toMatch(/enough/);
    give(g, 'alice', 'Goblin Electromancer', 'battlefield');
    castIt(g, 'Big Sorcery'); // +1 −1
  });

  it('“This spell costs {1} less to cast for each artifact you control” (CR 113.6e)', () => {
    const g = setup(1);
    for (let i = 0; i < 3; i++) give(g, 'alice', 'Clockwork', 'battlefield');
    const r = castIt(g, 'Frogmite Lite');
    expect(r.zones.battlefield.filter((id) => r.objects[id]!.tapped)).toHaveLength(1);
    for (let i = 0; i < 2; i++) give(g, 'alice', 'Clockwork', 'battlefield');
    // Five artifacts: it costs {0} (never less).
    const free = castIt(g, 'Frogmite Lite');
    expect(free.zones.battlefield.filter((id) => free.objects[id]!.tapped)).toHaveLength(0);
  });
});

describe('CR 107.14: energy', () => {
  const mk = (name: string, oracle_text: string) => makeCard({ name, type_line: 'Creature — Construct', oracle_text, mana_cost: '{G}', power: '1', toughness: '1' });
  const EXTRA = [
    mk('Energy Cell', 'When this creature enters, you get {E}{E}.'),
    mk('Energy Drinker', '{T}, Pay {E}{E}: Draw a card.'),
    mk('Charged Striker', 'Whenever this creature attacks, you may pay {E}. If you do, put a +1/+1 counter on it.'),
  ];
  it('getting energy, and paying it as a cost', () => {
    let g = toStep(start({ extra: EXTRA }), 'main1');
    give(g, 'alice', 'Forest', 'battlefield');
    const drinker = give(g, 'alice', 'Energy Drinker', 'battlefield');
    expect(illegal(g, { type: 'activate', player: 'alice', object: drinker, ability: 0 })).toMatch(/energy/);
    g = passRound(passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Energy Cell', 'hand'), autoTap: true })));
    expect(g.players.alice!.counters).toEqual({ energy: 2 });
    const hand = g.zones.hand.alice!.length;
    g = passRound(act(g, { type: 'activate', player: 'alice', object: drinker, ability: 0 }));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
    expect(g.players.alice!.counters).toEqual({ energy: 0 });
  });

  it('“you may pay {E}. If you do, …”', () => {
    let g = toStep(start({ extra: EXTRA }), 'main1');
    const striker = give(g, 'alice', 'Charged Striker', 'battlefield');
    g.players.alice!.counters = { energy: 1 };
    g = passRound(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: striker, target: { kind: 'player', player: 'bob' } }] } });
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'pay', cost: '{E}' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true } });
    expect(g.objects[striker]!.counters['+1/+1']).toBe(1);
    expect(g.players.alice!.counters!.energy).toBe(0);
  });
});
