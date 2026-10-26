import { describe, expect, it } from 'vitest';
import { chars, hasKeyword, matchesFilter, power, type GameState } from '../src/index.js';
import { nameOf } from '../src/zones.js';
import { act, give, makeCard, passRound, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{3}{U}', ...extra });

const CARDS = [
  card('Clone', 'Creature — Shapeshifter', 'You may have this creature enter as a copy of any creature on the battlefield.', { power: '0', toughness: '0' }),
  card('Spirit Clone', 'Creature — Shapeshifter', "You may have this creature enter as a copy of any creature on the battlefield, except it's a Spirit in addition to its other types and it has flying.", { power: '0', toughness: '0' }),
  card('Grave Double', 'Creature — Shapeshifter', 'You may have this creature enter as a copy of any creature card in a graveyard.', { power: '0', toughness: '0' }),
  card('Sky Angel', 'Creature — Angel', 'Flying\nVigilance', { mana_cost: '{3}{W}{W}', cmc: 5, power: '4', toughness: '4' }),
  card('Healer Beast', 'Creature — Beast', 'When this creature enters, you gain 3 life.', { mana_cost: '{2}{G}', power: '2', toughness: '2' }),
  card('Dying Wish', 'Creature — Spirit', 'When this creature dies, draw two cards.', { mana_cost: '{1}{B}', power: '1', toughness: '1' }),
  card('Old King', 'Legendary Creature — Human Noble', '', { mana_cost: '{2}{W}', power: '2', toughness: '2' }),
  card('Twin Maker', 'Creature — Goblin Shaman', "{T}: Create a token that's a copy of target nonlegendary creature you control, except it has haste. Sacrifice it at the beginning of the next end step.", { mana_cost: '{2}{R}{R}', power: '2', toughness: '2' }),
  card('Royal Mirror', 'Artifact', "{T}: Create a token that's a copy of target creature you control, except it isn't legendary.", { mana_cost: '{3}' }),
  card('Sand Guard', 'Creature — Human Warrior', 'Embalm {W}', { mana_cost: '{1}{W}', cmc: 2, power: '2', toughness: '2', colors: ['W'] }),
];

function setup(): GameState {
  return toStep(start({ extra: CARDS }), 'main1');
}

function castClone(g: GameState, name = 'Clone'): { g: GameState; id: string } {
  const id = give(g, 'alice', name, 'hand');
  g.players.alice!.pool.U = 4;
  g = passRound(act(g, { type: 'cast', player: 'alice', object: id }));
  return { g, id };
}

describe('CR 707.5: entering as a copy', () => {
  it('Clone asks what to copy and becomes it (name, P/T, abilities); it’s still Clone elsewhere', () => {
    let g = setup();
    const angel = give(g, 'bob', 'Sky Angel', 'battlefield');
    const r = castClone(g);
    g = r.g;
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'copy', player: 'alice', candidates: [angel] });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', copy: angel } });
    const clone = g.objects[r.id]!;
    expect(nameOf(g, clone)).toBe('Sky Angel');
    expect(chars(g, clone)).toMatchObject({ power: 4, toughness: 4, subtypes: ['Angel'] });
    expect(hasKeyword(g, clone, 'flying')).toBe(true);
    // CR 202.3 / 707.2: it has the copied mana cost.
    expect(matchesFilter(g, clone, { manaValue: { op: 'eq', n: 5 } }, { controller: 'alice' })).toBe(true);
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: r.id, to: 'graveyard' } });
    expect(nameOf(g, g.objects[r.id]!)).toBe('Clone');
  });

  it('declining leaves a 0/0 that dies (CR 704.5f)', () => {
    let g = setup();
    give(g, 'bob', 'Sky Angel', 'battlefield');
    const r = castClone(g);
    g = act(r.g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', copy: null } });
    expect(g.objects[r.id]!.zone).toBe('graveyard');
  });

  it('CR 707.5: the copied creature’s “when this enters” ability triggers', () => {
    let g = setup();
    const healer = give(g, 'bob', 'Healer Beast', 'battlefield');
    const r = castClone(g);
    g = act(r.g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', copy: healer } });
    g = passRound(g);
    expect(g.players.alice!.life).toBe(23);
  });

  it('CR 603.10a: a Clone that dies as a copy has the copied “when this dies” ability', () => {
    let g = setup();
    const wish = give(g, 'bob', 'Dying Wish', 'battlefield');
    const r = castClone(g);
    g = act(r.g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', copy: wish } });
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: r.id, to: 'graveyard' } });
    g = passRound(g);
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
  });

  it('CR 707.2: a copy of a copy copies what the first one copied; exceptions are copiable (CR 707.9b)', () => {
    let g = setup();
    const angel = give(g, 'bob', 'Sky Angel', 'battlefield');
    let r = castClone(g, 'Spirit Clone');
    g = act(r.g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', copy: angel } });
    expect(chars(g, g.objects[r.id]!).subtypes).toEqual(['Angel', 'Spirit']);
    r = castClone(g);
    g = act(r.g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', copy: g.zones.battlefield.find((id) => g.objects[id]!.card === 'Spirit Clone')! } });
    expect(nameOf(g, g.objects[r.id]!)).toBe('Sky Angel');
    expect(chars(g, g.objects[r.id]!).subtypes).toEqual(['Angel', 'Spirit']);
  });
});

describe('copying a card in a graveyard', () => {
  it('“enter as a copy of any creature card in a graveyard”', () => {
    let g = setup();
    const dead = give(g, 'bob', 'Sky Angel', 'graveyard');
    const r = castClone(g, 'Grave Double');
    expect(r.g.pending).toMatchObject({ kind: 'as_enters', candidates: [dead] });
    g = act(r.g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', copy: dead } });
    expect(chars(g, g.objects[r.id]!)).toMatchObject({ name: 'Sky Angel', power: 4 });
    expect(g.objects[dead]!.zone).toBe('graveyard');
  });
});

describe('tokens that are copies', () => {
  it('“create a token that’s a copy of target creature, except it has haste”, sacrificed at end of turn', () => {
    let g = setup();
    const maker = give(g, 'alice', 'Twin Maker', 'battlefield');
    const healer = give(g, 'alice', 'Healer Beast', 'battlefield');
    g = passRound(act(g, { type: 'activate', player: 'alice', object: maker, ability: 0, targets: [[{ kind: 'object', object: healer }]] }));
    g = passRound(g); // the copy's enters trigger
    const token = g.zones.battlefield.map((id) => g.objects[id]!).find((o) => o.token)!;
    expect(nameOf(g, token)).toBe('Healer Beast');
    expect(hasKeyword(g, token, 'haste')).toBe(true);
    expect(power(g, token)).toBe(2);
    expect(g.players.alice!.life).toBe(23);
    g = passRound(toStep(g, 'end'));
    expect(g.objects[token.id]).toBeUndefined();
  });

  it('“except it isn’t legendary”: no legend rule', () => {
    let g = setup();
    const mirror = give(g, 'alice', 'Royal Mirror', 'battlefield');
    const king = give(g, 'alice', 'Old King', 'battlefield');
    g = passRound(act(g, { type: 'activate', player: 'alice', object: mirror, ability: 0, targets: [[{ kind: 'object', object: king }]] }));
    expect(g.pending).toBeNull();
    const kings = g.zones.battlefield.filter((id) => nameOf(g, g.objects[id]!) === 'Old King');
    expect(kings).toHaveLength(2);
  });

  it('CR 702.128a embalm: a white Zombie token copy with no mana cost', () => {
    let g = setup();
    const guard = give(g, 'alice', 'Sand Guard', 'graveyard');
    g.players.alice!.pool.W = 1;
    g = passRound(act(g, { type: 'activate', player: 'alice', object: guard, ability: 0 }));
    expect(g.objects[guard]!.zone).toBe('exile');
    const token = g.zones.battlefield.map((id) => g.objects[id]!).find((o) => o.token)!;
    expect(chars(g, token)).toMatchObject({ name: 'Sand Guard', colors: ['W'], subtypes: ['Human', 'Warrior', 'Zombie'], power: 2 });
    expect(matchesFilter(g, token, { manaValue: { op: 'eq', n: 0 } }, { controller: 'alice' })).toBe(true);
  });
});
