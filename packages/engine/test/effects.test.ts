import { describe, expect, it } from 'vitest';
import type { SpellAbility } from '@mtg/schema';
import { power, toughness, type GameState, type Target } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, string> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{G}', ...extra });
const bear = (name: string, oracle_text: string, pt = '2') => card(name, 'Creature — Bear', oracle_text, { power: pt, toughness: pt });

const CARDS = [
  card('Divination', 'Sorcery', 'Draw two cards.'),
  card('Healing Salve', 'Instant', 'You gain 3 life.'),
  card('Final Wrath', 'Sorcery', "Destroy all creatures. They can't be regenerated."),
  card('Shatter Wave', 'Sorcery', 'Destroy all creatures.'),
  card('Shock', 'Instant', 'Shock deals 2 damage to any target.'),
  bear('Regen Troll', '{G}: Regenerate this creature.'),
  bear('Sturdy Bear', 'Indestructible'),
  bear('Lifelink Bear', 'Lifelink'),
  card('Raise Dead', 'Sorcery', 'Return target creature card from your graveyard to your hand.'),
  card('Revive', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.'),
  card('Treasure Hunt', 'Sorcery', 'Create two Treasure tokens.'),
  card('Muster', 'Sorcery', 'Create two 1/1 white Soldier creature tokens with vigilance.'),
  card('Opt', 'Instant', 'Scry 1. Draw a card.'),
  card('Peek', 'Instant', 'Surveil 2.'),
  card('Mind Rot', 'Sorcery', 'Target player discards two cards.'),
  card('Glimpse', 'Sorcery', 'Target player mills three cards.'),
  card('Giant Growth', 'Instant', 'Target creature gets +3/+3 until end of turn.'),
  card('Rally', 'Instant', 'Creatures you control get +1/+1 and gain trample until end of turn.'),
  card('Bolster', 'Sorcery', 'Put two +1/+1 counters on target creature.'),
  card('Second Thoughts', 'Instant', 'Exile target creature. Its controller gains 2 life.'),
];

const shock = (g: GameState) => g.cards.Shock!.faces[0]!.abilities[0] as SpellAbility;

function setup(lands = 6): GameState {
  const g = toStep(start({ extra: CARDS }), 'main1');
  for (let i = 0; i < lands; i++) give(g, 'alice', 'Forest', 'battlefield');
  return g;
}
const obj = (object: string): Target => ({ kind: 'object', object });
const player = (p: string): Target => ({ kind: 'player', player: p });
/** Casts a spell from Alice's hand and lets everyone pass so it resolves. */
function castAndResolve(g: GameState, name: string, targets?: Target[][]): GameState {
  const id = give(g, 'alice', name, 'hand');
  const next = act(g, { type: 'cast', player: 'alice', object: id, autoTap: true, ...(targets ? { targets } : {}) });
  return passRound(next);
}

describe('one-shot effects', () => {
  it('CR 121.2 / CR 119.3: drawing cards one at a time and gaining life', () => {
    let g = setup();
    const hand = g.zones.hand.alice!.length;
    g = castAndResolve(g, 'Divination');
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
    g = castAndResolve(g, 'Healing Salve');
    expect(g.players.alice!.life).toBe(23);
  });

  it('CR 701.8a / CR 702.12b: destroy moves to the graveyard, except indestructible permanents', () => {
    let g = setup();
    const a = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const b = give(g, 'bob', 'Sturdy Bear', 'battlefield');
    g = castAndResolve(g, 'Shatter Wave');
    expect(g.objects[a]!.zone).toBe('graveyard');
    expect(g.objects[b]!.zone).toBe('battlefield');
  });

  it('CR 701.19a: a regeneration shield replaces destruction — taps, removes damage, removes from combat', () => {
    let g = setup();
    const troll = give(g, 'alice', 'Regen Troll', 'battlefield');
    g = act(g, { type: 'activate', player: 'alice', object: troll, ability: 0, autoTap: true });
    g = passRound(g);
    expect(g.objects[troll]!.regenShields).toBe(1);
    g = castAndResolve(g, 'Shock', [[obj(troll)]]);
    expect(g.objects[troll]).toMatchObject({ zone: 'battlefield', tapped: true, damage: 0, regenShields: 0 });
    // "They can't be regenerated" ignores shields.
    g = act(g, { type: 'activate', player: 'alice', object: troll, ability: 0, autoTap: true });
    g = passRound(g);
    g = castAndResolve(g, 'Final Wrath');
    expect(g.objects[troll]!.zone).toBe('graveyard');
  });

  it('CR 514.2: regeneration shields end in the cleanup step', () => {
    let g = setup();
    const troll = give(g, 'alice', 'Regen Troll', 'battlefield');
    g = act(g, { type: 'activate', player: 'alice', object: troll, ability: 0, autoTap: true });
    g = passRound(g);
    g = toStep(g, 'upkeep', 'bob');
    expect(g.objects[troll]!.regenShields).toBeUndefined();
  });

  it('CR 702.15b: damage from a lifelink source gains its controller that much life, outside combat too', () => {
    let g = setup();
    const lifelink = give(g, 'alice', 'Lifelink Bear', 'battlefield');
    g.cards['Lifelink Bear'] = {
      ...g.cards['Lifelink Bear']!,
      faces: [
        {
          ...g.cards['Lifelink Bear']!.faces[0]!,
          // "{0}: This creature deals 2 damage to any target."
          abilities: [{ kind: 'activated', text: 'test', cost: {}, ...(({ kind: _k, text: _t, ...program }) => program)(shock(g)) }],
        },
      ],
    };
    g = act(g, { type: 'activate', player: 'alice', object: lifelink, ability: 0, targets: [[player('bob')]] });
    g = passRound(g);
    expect(g.players.bob!.life).toBe(18);
    expect(g.players.alice!.life).toBe(22);
  });

  it('returns cards from the graveyard to hand or to the battlefield', () => {
    let g = setup();
    const dead = give(g, 'alice', 'Grizzly Bears', 'graveyard');
    const theirs = give(g, 'bob', 'Grizzly Bears', 'graveyard');
    const id = give(g, 'alice', 'Raise Dead', 'hand');
    // "from your graveyard": Bob's card isn't a legal target.
    expect(illegal(g, { type: 'cast', player: 'alice', object: id, autoTap: true, targets: [[obj(theirs)]] })).toMatch(/legal target/);
    g = act(g, { type: 'cast', player: 'alice', object: id, autoTap: true, targets: [[obj(dead)]] });
    g = passRound(g);
    expect(g.objects[dead]!.zone).toBe('hand');
    const dead2 = give(g, 'alice', 'Grizzly Bears', 'graveyard');
    g = castAndResolve(g, 'Revive', [[obj(dead2)]]);
    expect(g.objects[dead2]).toMatchObject({ zone: 'battlefield', controller: 'alice', sick: true });
  });

  it('CR 608.2h: "its controller" still means who controlled it, after it left', () => {
    let g = setup();
    const bears = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = castAndResolve(g, 'Second Thoughts', [[obj(bears)]]);
    expect(g.objects[bears]!.zone).toBe('exile');
    expect(g.players.bob!.life).toBe(22);
  });

  it('CR 122.6: putting +1/+1 counters on a creature', () => {
    let g = setup();
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = castAndResolve(g, 'Bolster', [[obj(bears)]]);
    expect(g.objects[bears]!.counters['+1/+1']).toBe(2);
    expect(power(g, g.objects[bears]!)).toBe(4);
  });
});

describe('tokens (CR 111)', () => {
  it('CR 111.10a / CR 704.5d: a Treasure is sacrificed for mana and then ceases to exist', () => {
    let g = setup(1);
    g = castAndResolve(g, 'Treasure Hunt');
    const treasures = g.zones.battlefield.filter((id) => g.objects[id]!.token);
    expect(treasures).toHaveLength(2);
    expect(g.cards[g.objects[treasures[0]!]!.card]!.faces[0]).toMatchObject({ name: 'Treasure', types: ['Artifact'], subtypes: ['Treasure'] });
    g = act(g, { type: 'activate_mana', player: 'alice', object: treasures[0]!, ability: 0, choice: 'U' });
    expect(g.players.alice!.pool.U).toBe(1);
    expect(g.objects[treasures[0]!]).toBeUndefined();
  });

  it('CR 111.4: creature tokens get their name from their subtypes, and have summoning sickness', () => {
    let g = setup();
    g = castAndResolve(g, 'Muster');
    const soldiers = g.zones.battlefield.filter((id) => g.objects[id]!.token).map((id) => g.objects[id]!);
    expect(soldiers).toHaveLength(2);
    const face = g.cards[soldiers[0]!.card]!.faces[0]!;
    expect(face).toMatchObject({ name: 'Soldier Token', power: '1', toughness: '1', colors: ['W'], keywords: [{ id: 'vigilance' }] });
    expect(soldiers[0]!.sick).toBe(true);
  });
});

describe('looking at and moving library cards', () => {
  it('CR 701.22a: scry — the player sees the cards and picks top or bottom', () => {
    let g = setup();
    const top = g.zones.library.alice![0]!;
    const id = give(g, 'alice', 'Opt', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: id, autoTap: true });
    g = passRound(g);
    expect(g.pending).toEqual({ kind: 'scry', player: 'alice', objects: [top] });
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'scry', top: [], bottom: [] } })).toMatch(/Put each/);
    const second = g.zones.library.alice![1]!;
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'scry', top: [], bottom: [top] } });
    // Then "Draw a card." draws what was second.
    expect(g.zones.library.alice!.at(-1)).toBe(top);
    expect(g.zones.hand.alice).toContain(second);
    expect(g.objects[id]!.zone).toBe('graveyard');
  });

  it('CR 701.25a: surveil puts any number into the graveyard', () => {
    let g = setup();
    const [a, b] = g.zones.library.alice!;
    g = castAndResolve(g, 'Peek');
    expect(g.pending).toMatchObject({ kind: 'surveil', objects: [a, b] });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'surveil', top: [b!], graveyard: [a!] } });
    expect(g.objects[a!]!.zone).toBe('graveyard');
    expect(g.zones.library.alice![0]).toBe(b);
  });

  it('CR 701.9a: the discarding player chooses which cards', () => {
    let g = setup();
    g = castAndResolve(g, 'Mind Rot', [[player('bob')]]);
    expect(g.pending).toMatchObject({ kind: 'discard', player: 'bob', count: 2 });
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: [] } })).toMatch(/no choice/);
    const pick = g.zones.hand.bob!.slice(0, 2);
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'discard', objects: pick } });
    expect(pick.map((id) => g.objects[id]!.zone)).toEqual(['graveyard', 'graveyard']);
    expect(g.priority).toBe('alice');
  });

  it('CR 701.9a: with no more cards than required, they’re all discarded without asking', () => {
    let g = setup();
    for (const id of [...g.zones.hand.bob!].slice(1)) g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: id, to: 'library' } });
    g = castAndResolve(g, 'Mind Rot', [[player('bob')]]);
    expect(g.pending).toBeNull();
    expect(g.zones.hand.bob).toEqual([]);
  });

  it('CR 701.17a: mill puts the top cards into the graveyard', () => {
    let g = setup();
    const top3 = g.zones.library.bob!.slice(0, 3);
    g = castAndResolve(g, 'Glimpse', [[player('bob')]]);
    expect(top3.map((id) => g.objects[id]!.zone)).toEqual(['graveyard', 'graveyard', 'graveyard']);
  });
});

describe('effects that last until end of turn', () => {
  it('CR 611.2a / CR 514.2: a pump lasts until the cleanup step', () => {
    let g = setup();
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = castAndResolve(g, 'Giant Growth', [[obj(bears)]]);
    expect([power(g, g.objects[bears]!), toughness(g, g.objects[bears]!)]).toEqual([5, 5]);
    g = toStep(g, 'upkeep', 'bob');
    expect([power(g, g.objects[bears]!), toughness(g, g.objects[bears]!)]).toEqual([2, 2]);
    expect(g.effects).toEqual([]);
  });

  it('CR 611.2c: the affected creatures are locked in as the effect is created', () => {
    let g = setup();
    const before = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = castAndResolve(g, 'Rally');
    const after = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    expect(power(g, g.objects[before]!)).toBe(3);
    expect(power(g, g.objects[after]!)).toBe(2);
    expect(g.effects[0]).toMatchObject({ keywords: [{ id: 'trample' }], until: 'eot' });
  });
});
