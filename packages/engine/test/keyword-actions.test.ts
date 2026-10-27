import { describe, expect, it } from 'vitest';
import { chars, legalActions, power, viewFor, type GameState } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

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
  make('Spread the Growth', 'Sorcery', 'Proliferate.'),
  make('Sly Rogue', 'Creature — Human Rogue', 'When this creature enters, it connives.', '1'),
  make('Orc Muster', 'Sorcery', 'Amass Orcs 2.'),
  make('Frost Breath Lite', 'Instant', "Tap target creature. It doesn't untap during its controller's next untap step."),
  make('Lifelinked Spirit', 'Creature — Spirit', 'Whenever this creature deals damage, you gain that much life.', '3'),
  make('Spiked Hydra', 'Creature — Hydra', 'Whenever this creature is dealt damage, put that many +1/+1 counters on it.', '4'),
  make('Light Up the Stage Lite', 'Sorcery', 'Exile the top two cards of your library. Until the end of your next turn, you may play those cards.'),
  make('Act on Impulse Lite', 'Sorcery', 'Exile the top card of your library. You may play that card this turn.'),
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

describe('more keyword actions', () => {
  it('CR 701.34a: proliferate adds one of each kind of counter to what you choose', () => {
    let g = setup();
    const mine = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g.objects[mine]!.counters['+1/+1'] = 1;
    const theirs = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g.objects[theirs]!.counters['+1/+1'] = 1;
    g.players.bob!.poison = 3;
    g = passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Spread the Growth', 'hand'), autoTap: true }));
    expect(g.pending).toMatchObject({ kind: 'proliferate', objects: expect.arrayContaining([mine, theirs]), players: ['bob'] });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'proliferate', objects: [mine], players: ['bob'] } });
    expect(g.objects[mine]!.counters['+1/+1']).toBe(2);
    expect(g.objects[theirs]!.counters['+1/+1']).toBe(1);
    expect(g.players.bob!.poison).toBe(4);
  });

  it('CR 701.50a: connive — draw, discard, and a counter for a nonland', () => {
    let g = setup();
    const rogue = give(g, 'alice', 'Sly Rogue', 'hand');
    g = passRound(passRound(act(g, { type: 'cast', player: 'alice', object: rogue, autoTap: true })));
    expect(g.pending).toMatchObject({ kind: 'discard', player: 'alice', count: 1 });
    const bears = give(g, 'alice', 'Grizzly Bears', 'hand');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: [bears] } });
    expect(g.objects[bears]!.zone).toBe('graveyard');
    expect(g.objects[rogue]!.counters['+1/+1']).toBe(1);
  });

  it('CR 701.47a: amass makes an Army if you have none, then grows it', () => {
    let g = setup();
    g = passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Orc Muster', 'hand'), autoTap: true }));
    const army = g.zones.battlefield.find((id) => g.objects[id]!.token)!;
    expect(chars(g, g.objects[army]!)).toMatchObject({ subtypes: ['Orc', 'Army'], power: 2, toughness: 2 });
    g = passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Orc Muster', 'hand'), autoTap: true }));
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token)).toHaveLength(1);
    expect(g.objects[army]!.counters['+1/+1']).toBe(4);
  });

  it('“It doesn’t untap during its controller’s next untap step.”', () => {
    let g = setup();
    const theirs = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Frost Breath Lite', 'hand'), autoTap: true, targets: [[{ kind: 'object', object: theirs }]] }));
    expect(g.objects[theirs]!.tapped).toBe(true);
    g = toStep(g, 'upkeep', 'bob');
    expect(g.objects[theirs]!.tapped).toBe(true);
    g = toStep(toStep(g, 'upkeep', 'alice'), 'upkeep', 'bob');
    expect(g.objects[theirs]!.tapped).toBe(false);
  });
});

describe('“that much” from the trigger event', () => {
  it('“Whenever ~ deals damage, you gain that much life” (once for simultaneous damage)', () => {
    let g = setup();
    const spirit = give(g, 'alice', 'Lifelinked Spirit', 'battlefield');
    g = passRound(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: spirit, target: { kind: 'player', player: 'bob' } }] } });
    g = toStep(g, 'combat_damage');
    expect(g.stack).toHaveLength(1);
    g = passRound(g);
    expect(g.players.alice!.life).toBe(23);
  });

  it('“Whenever ~ is dealt damage, put that many +1/+1 counters on it”', () => {
    let g = setup();
    const hydra = give(g, 'alice', 'Spiked Hydra', 'battlefield');
    g.players.alice!.pool.R = 1;
    g = passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Lightning Bolt', 'hand'), targets: [[{ kind: 'object', object: hydra }]] }));
    g = passRound(g);
    expect(g.objects[hydra]!.counters['+1/+1']).toBe(3);
  });
});

describe('impulse draw: playing cards from exile', () => {
  it('“you may play that card this turn” — a land from exile counts as the land play', () => {
    let g = setup();
    const top = give(g, 'alice', 'Forest', 'library');
    g.zones.library.alice = [top, ...g.zones.library.alice!.filter((id) => id !== top)];
    g = passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Act on Impulse Lite', 'hand'), autoTap: true }));
    expect(g.objects[top]!.zone).toBe('exile');
    expect(legalActions(g, 'alice')).toContainEqual({ type: 'play_land', player: 'alice', object: top });
    g = act(g, { type: 'play_land', player: 'alice', object: top });
    expect(g.objects[top]!.zone).toBe('battlefield');
  });

  it('“until the end of your next turn” — and then it’s gone', () => {
    let g = setup();
    const top = give(g, 'alice', 'Grizzly Bears', 'library');
    g.zones.library.alice = [top, ...g.zones.library.alice!.filter((id) => id !== top)];
    g = passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Light Up the Stage Lite', 'hand'), autoTap: true }));
    expect(g.objects[top]!.zone).toBe('exile');
    // Still playable on Alice's next turn.
    g = toStep(toStep(g, 'upkeep', 'bob'), 'main1', 'alice');
    expect(legalActions(g, 'alice')).toContainEqual(expect.objectContaining({ type: 'cast', object: top }));
    g = toStep(toStep(g, 'upkeep', 'bob'), 'main1', 'alice');
    expect(illegal(g, { type: 'cast', player: 'alice', object: top, autoTap: true })).toMatch(/hand/);
  });
});

describe('Sagas (CR 714)', () => {
  const saga = makeCard({
    name: 'Tale of Plenty',
    type_line: 'Enchantment — Saga',
    oracle_text: '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI, II — Draw a card.\nIII — You gain 3 life.',
    mana_cost: '{G}',
  });
  const flip = makeCard({
    name: 'Moth Story // Moth',
    layout: 'transform',
    type_line: 'Enchantment — Saga // Enchantment Creature — Insect',
    oracle_text: '',
    mana_cost: '{G}',
    card_faces: [
      { object: 'card_face', name: 'Moth Story', type_line: 'Enchantment — Saga', mana_cost: '{G}', oracle_text: '(As this Saga enters and after your draw step, add a lore counter.)\nI — You gain 1 life.\nII — Exile this Saga, then return it to the battlefield transformed under your control.' },
      { object: 'card_face', name: 'Moth', type_line: 'Enchantment Creature — Insect', mana_cost: '', power: '3', toughness: '3', oracle_text: 'Flying' },
    ],
  } as never);

  it('chapters trigger as lore counters arrive, and it’s sacrificed after the last', () => {
    let g = toStep(start({ extra: [saga, flip] }), 'main1');
    give(g, 'alice', 'Forest', 'battlefield');
    const tale = give(g, 'alice', 'Tale of Plenty', 'hand');
    const hand = g.zones.hand.alice!.length;
    g = passRound(passRound(act(g, { type: 'cast', player: 'alice', object: tale, autoTap: true })));
    expect(g.objects[tale]!.counters.lore).toBe(1);
    expect(g.zones.hand.alice!.length).toBe(hand); // drew one (chapter I), cast one
    g = toStep(toStep(g, 'upkeep', 'bob'), 'main1', 'alice');
    expect(g.objects[tale]!.counters.lore).toBe(2);
    expect(g.stack).toMatchObject([{ kind: 'ability', sourceName: 'Tale of Plenty' }]);
    g = passRound(g);
    g = toStep(toStep(g, 'upkeep', 'bob'), 'main1', 'alice');
    expect(g.objects[tale]!.zone).toBe('battlefield'); // chapter III is on the stack
    g = passRound(g);
    expect(g.players.alice!.life).toBe(23);
    expect(g.objects[tale]!.zone).toBe('graveyard');
  });

  it('CR 702.155: read ahead — start on a chosen chapter; skipped chapters don’t trigger', () => {
    const ahead = makeCard({
      name: 'Tale Ahead',
      type_line: 'Enchantment — Saga',
      oracle_text: 'Read ahead (Choose a chapter and start with that many lore counters. Add one after your draw step. Skipped chapters don\'t trigger.)\nI — You gain 1 life.\nII — You gain 2 life.\nIII — You gain 3 life.',
      mana_cost: '{0}',
    });
    let g = toStep(start({ extra: [ahead] }), 'main1');
    const t = give(g, 'alice', 'Tale Ahead', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: t });
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'read_ahead', options: ['1', '2', '3'] });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', choice: '2' } });
    expect(g.objects[t]!.counters.lore).toBe(2);
    g = passRound(g);
    expect(g.players.alice!.life).toBe(22); // only chapter II
    g = toStep(toStep(g, 'upkeep', 'bob'), 'main1', 'alice');
    g = passRound(g);
    expect(g.players.alice!.life).toBe(25);
  });

  it('CR 400.7j / CR 712.14a: “Exile this Saga, then return it to the battlefield transformed”', () => {
    let g = toStep(start({ extra: [saga, flip] }), 'main1');
    const story = give(g, 'alice', 'Moth Story // Moth', 'battlefield');
    g.objects[story]!.counters.lore = 1;
    g = toStep(toStep(g, 'upkeep', 'bob'), 'main1', 'alice');
    g = passRound(g);
    expect(g.objects[story]).toMatchObject({ zone: 'battlefield', face: 1 });
    expect(chars(g, g.objects[story]!)).toMatchObject({ name: 'Moth', power: 3 });
  });
});
