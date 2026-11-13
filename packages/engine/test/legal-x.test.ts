import { describe, expect, it } from 'vitest';
import { apply, legalActions } from '../src/index.js';
import type { Action, GameState } from '../src/index.js';
import { give, makeCard, start, toStep } from './helpers.js';

// CR 601.2b: the value of X is announced as a spell is cast. The legal listing offers an X spell once — with the least X
// it can be cast with now — and says how much X can be paid for, so a client (or the fuzzer) can ask for a number.
const CARDS = [
  makeCard({ name: 'Blaze', type_line: 'Sorcery', mana_cost: '{X}{R}', cmc: 1, oracle_text: 'Blaze deals X damage to any target.' }),
  makeCard({ name: 'Curse of the Swine', type_line: 'Sorcery', mana_cost: '{X}{U}{U}', cmc: 2, oracle_text: 'Exile X target creatures. For each creature exiled this way, its controller creates a 2/2 green Boar creature token.' }),
  makeCard({ name: 'Repeal', type_line: 'Instant', mana_cost: '{X}{U}', cmc: 1, oracle_text: "Return target nonland permanent with mana value X to its owner's hand.\nDraw a card." }),
  makeCard({ name: 'Mirror Entity', type_line: 'Creature — Shapeshifter', mana_cost: '{2}{W}', cmc: 3, power: '1', toughness: '1', oracle_text: 'Changeling\n{X}: Until end of turn, creatures you control have base power and toughness X/X and gain all creature types.' }),
  makeCard({ name: 'Goblin Electromancer', type_line: 'Creature — Goblin Wizard', mana_cost: '{U}{R}', cmc: 2, power: '2', toughness: '2', oracle_text: 'Instant and sorcery spells you cast cost {1} less to cast.' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{1}{R}', cmc: 2, power: '2', toughness: '2', oracle_text: '' }),
];
const main = () => toStep(start({ extra: CARDS }), 'main1', 'alice');
const listed = (g: GameState, id: string) => legalActions(g, 'alice').filter((a) => (a.type === 'cast' || a.type === 'activate') && a.object === id) as Extract<Action, { type: 'cast' | 'activate' }>[];

describe('X in the legal listing', () => {
  it('an X spell is listed once, with the least X and the most that can be paid for', () => {
    const g = main();
    const blaze = give(g, 'alice', 'Blaze', 'hand');
    expect(listed(g, blaze)).toEqual([]);
    g.players.alice!.pool.R = 4;
    const [a] = listed(g, blaze);
    expect([a?.x, a?.xMax]).toEqual([0, 3]);
    expect(apply(g, { ...a!, x: 3 }).ok).toBe(true);
    expect(apply(g, { ...a!, x: 4 }).ok).toBe(false);
  });

  it('a cost reduction comes off the X part too (CR 601.2f)', () => {
    const g = main();
    give(g, 'alice', 'Goblin Electromancer', 'battlefield');
    const blaze = give(g, 'alice', 'Blaze', 'hand');
    g.players.alice!.pool.R = 4;
    const [a] = listed(g, blaze);
    expect([a?.x, a?.xMax]).toEqual([0, 4]);
    expect(apply(g, { ...a!, x: 4 }).ok).toBe(true);
    expect(apply(g, { ...a!, x: 5 }).ok).toBe(false);
  });

  it('"X target creatures": listed with no targets at X = 0; more X needs that many targets', () => {
    const g = main();
    const curse = give(g, 'alice', 'Curse of the Swine', 'hand');
    const ogres = [give(g, 'bob', 'Ogre', 'battlefield'), give(g, 'bob', 'Ogre', 'battlefield')];
    g.players.alice!.pool.U = 5;
    const [a] = listed(g, curse);
    expect([a?.x, a?.xMax]).toEqual([0, 3]);
    expect(apply(g, a!).ok).toBe(true);
    expect(apply(g, { ...a!, x: 2, targets: [ogres.map((object) => ({ kind: 'object' as const, object }))] }).ok).toBe(true);
    expect(apply(g, { ...a!, x: 3, targets: [ogres.map((object) => ({ kind: 'object' as const, object }))] }).ok).toBe(false);
  });

  it('"with mana value X": listed with the least X that has a legal target', () => {
    const g = main();
    const repeal = give(g, 'alice', 'Repeal', 'hand');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    g.players.alice!.pool.U = 2;
    // {X}{U} with two mana: X = 1 at most, and nothing has mana value 0 or 1.
    expect(listed(g, repeal)).toEqual([]);
    g.players.alice!.pool.U = 4;
    const [a] = listed(g, repeal);
    expect([a?.x, a?.xMax, a?.targets]).toEqual([2, 3, [[{ kind: 'object', object: ogre }]]]);
    expect(apply(g, a!).ok).toBe(true);
  });

  it('an ability with {X} in its cost is listed the same way', () => {
    const g = main();
    const entity = give(g, 'alice', 'Mirror Entity', 'battlefield');
    g.players.alice!.pool.W = 3;
    const [a] = listed(g, entity);
    expect([a?.x, a?.xMax]).toEqual([0, 3]);
    expect(apply(g, { ...a!, x: 3 }).ok).toBe(true);
    expect(apply(g, { ...a!, x: 4 }).ok).toBe(false);
  });

  it('everything listed is accepted as listed', () => {
    const g = main();
    for (const name of ['Blaze', 'Curse of the Swine', 'Repeal']) give(g, 'alice', name, 'hand');
    give(g, 'alice', 'Mirror Entity', 'battlefield');
    give(g, 'bob', 'Ogre', 'battlefield');
    g.players.alice!.pool.R = 2;
    g.players.alice!.pool.U = 3;
    for (const a of legalActions(g, 'alice')) expect([a.type, apply(g, a).ok]).toEqual([a.type, true]);
  });
});
