import { describe, expect, it } from 'vitest';
import { power, viewFor, type GameState } from '../src/index.js';
import { act, give, makeCard, passRound, start, toStep } from './helpers.js';

const make = (name: string, type_line: string, oracle_text: string, pt?: string) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{G}', ...(pt ? { power: pt, toughness: pt } : {}) });

const CARDS = [
  make('Growth-Chamber Guardian', 'Creature — Crab Mutant', '{1}: Adapt 2.', '2'),
  make('Merfolk Branchwalker', 'Creature — Merfolk Scout', 'When this creature enters, it explores.', '2'),
  make('Palace Jailer Cub', 'Creature — Human Soldier', 'When this creature enters, you become the monarch.', '2'),
  make('Regal Ambition', 'Sorcery', 'Target player becomes the monarch.'),
  make('Courtly Seer', 'Creature — Human Wizard', 'As long as you’re the monarch, this creature gets +2/+2.', '1'),
  make('Banishing Light', 'Enchantment', 'When this enchantment enters, exile target nonland permanent an opponent controls until this enchantment leaves the battlefield.'),
  make('Fiend Hunter', 'Creature — Human Cleric', 'When this creature enters, you may exile another target creature.\nWhen this creature leaves the battlefield, return the exiled card to the battlefield under its owner’s control.', '1'),
  make('Vizier of the Top', 'Creature — Human Wizard', 'You may look at the top card of your library any time.', '1'),
];

function setup(): GameState {
  const g = toStep(start({ extra: CARDS }), 'main1');
  for (let i = 0; i < 4; i++) give(g, 'alice', 'Forest', 'battlefield');
  return g;
}

describe('keyword actions', () => {
  it('CR 701.46a: adapt only puts counters on it if it has no +1/+1 counters', () => {
    let g = setup();
    const crab = give(g, 'alice', 'Growth-Chamber Guardian', 'battlefield');
    g = passRound(act(g, { type: 'activate', player: 'alice', object: crab, ability: 0, autoTap: true }));
    expect(g.objects[crab]!.counters['+1/+1']).toBe(2);
    g = passRound(act(g, { type: 'activate', player: 'alice', object: crab, ability: 0, autoTap: true }));
    expect(g.objects[crab]!.counters['+1/+1']).toBe(2);
  });

  it('CR 701.44a: explore — a land goes to hand', () => {
    let g = setup();
    const top = give(g, 'alice', 'Forest', 'library');
    g.zones.library.alice = [top, ...g.zones.library.alice!.filter((id) => id !== top)];
    const merfolk = give(g, 'alice', 'Merfolk Branchwalker', 'hand');
    g = passRound(passRound(act(g, { type: 'cast', player: 'alice', object: merfolk, autoTap: true })));
    expect(g.objects[top]!.zone).toBe('hand');
    expect(g.objects[merfolk]!.counters['+1/+1'] ?? 0).toBe(0);
  });

  it('CR 701.44a: explore — a nonland: a +1/+1 counter, then maybe the graveyard', () => {
    let g = setup();
    const top = give(g, 'alice', 'Grizzly Bears', 'library');
    g.zones.library.alice = [top, ...g.zones.library.alice!.filter((id) => id !== top)];
    const merfolk = give(g, 'alice', 'Merfolk Branchwalker', 'hand');
    g = passRound(passRound(act(g, { type: 'cast', player: 'alice', object: merfolk, autoTap: true })));
    expect(g.pending).toMatchObject({ kind: 'may', player: 'alice' });
    expect(power(g, g.objects[merfolk]!)).toBe(3);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    expect(g.objects[top]!.zone).toBe('graveyard');
  });
});

describe('the monarch (CR 725)', () => {
  it('becoming the monarch, the end-step draw, and “as long as you’re the monarch”', () => {
    let g = setup();
    const seer = give(g, 'alice', 'Courtly Seer', 'battlefield');
    expect(power(g, g.objects[seer]!)).toBe(1);
    g = passRound(passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Palace Jailer Cub', 'hand'), autoTap: true })));
    expect(g.monarch).toBe('alice');
    expect(power(g, g.objects[seer]!)).toBe(3);
    g = toStep(g, 'end');
    expect(g.stack).toMatchObject([{ kind: 'ability', sourceName: 'The monarch', controller: 'alice' }]);
    const hand = g.zones.hand.alice!.length;
    g = passRound(g);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
    // Not on someone else's end step.
    g = toStep(g, 'end', 'bob');
    expect(g.stack).toEqual([]);
  });

  it('CR 725.2: combat damage to the monarch makes the attacker’s controller the monarch', () => {
    let g = setup();
    g.monarch = 'bob';
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = passRound(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: bears, target: { kind: 'player', player: 'bob' } }] } });
    g = toStep(g, 'combat_damage');
    expect(g.stack).toMatchObject([{ kind: 'ability', sourceName: 'The monarch', controller: 'alice' }]);
    g = passRound(g);
    expect(g.monarch).toBe('alice');
  });

  it('CR 725.3: only one monarch at a time', () => {
    let g = setup();
    g = passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Regal Ambition', 'hand'), autoTap: true, targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.monarch).toBe('bob');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Regal Ambition', 'hand'), autoTap: true, targets: [[{ kind: 'player', player: 'alice' }]] }));
    expect(g.monarch).toBe('alice');
  });
});

describe('CR 401.5: seeing the top card of a library', () => {
  it('“You may look at the top card of your library any time.”', () => {
    const g = setup();
    const top = g.zones.library.alice![0]!;
    expect(viewFor(g, 'alice').objects[top]).toBeUndefined();
    give(g, 'alice', 'Vizier of the Top', 'battlefield');
    expect(viewFor(g, 'alice').objects[top]).toBeDefined();
    expect(viewFor(g, 'bob').objects[top]).toBeUndefined();
  });
});

describe('CR 610.3: exile until ~ leaves the battlefield', () => {
  it('the card comes back when the enchantment leaves, under its owner’s control', () => {
    let g = setup();
    const theirs = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const light = give(g, 'alice', 'Banishing Light', 'hand');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: light, autoTap: true }));
    g = passRound(g);
    expect(g.objects[theirs]!.zone).toBe('exile');
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: light, to: 'graveyard' } });
    expect(g.objects[theirs]).toMatchObject({ zone: 'battlefield', controller: 'bob' });
    expect(g.exiledUntil).toEqual([]);
  });

  it('CR 610.3a: if it leaves before the ability resolves, nothing is exiled', () => {
    let g = setup();
    const theirs = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const light = give(g, 'alice', 'Banishing Light', 'hand');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: light, autoTap: true }));
    expect(g.stack).toMatchObject([{ kind: 'ability', sourceName: 'Banishing Light' }]);
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: light, to: 'graveyard' } });
    g = passRound(g);
    expect(g.objects[theirs]!.zone).toBe('battlefield');
  });
});

describe('CR 607.2a: linked abilities — “the exiled card”', () => {
  it('Fiend Hunter returns what it exiled when it leaves', () => {
    let g = setup();
    const theirs = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const hunter = give(g, 'alice', 'Fiend Hunter', 'hand');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: hunter, autoTap: true }));
    // The only other creature is the target (chosen automatically).
    expect(g.stack).toMatchObject([{ kind: 'ability', sourceName: 'Fiend Hunter', targets: [[{ id: theirs }]] }]);
    g = passRound(g);
    if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    expect(g.objects[theirs]!.zone).toBe('exile');
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: hunter, to: 'graveyard' } });
    g = passRound(g);
    expect(g.objects[theirs]).toMatchObject({ zone: 'battlefield', controller: 'bob' });
  });

  it('if it leaves before its enters ability resolves, the creature stays exiled', () => {
    let g = setup();
    const theirs = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const hunter = give(g, 'alice', 'Fiend Hunter', 'hand');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: hunter, autoTap: true }));
    // In response, the Hunter leaves; its leaves ability resolves first, with nothing to return.
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: hunter, to: 'graveyard' } });
    g = passRound(g);
    g = passRound(g);
    if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    expect(g.objects[theirs]!.zone).toBe('exile');
  });
});
