import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import type { Action, GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

// Making mana by hand, the way a player clicks for it: a mana ability with a mana cost of its own pays that cost from
// other sources (CR 605.3a), and mana added "of any type that permanent produced" is the player's choice of type.
const CARDS = [
  makeCard({ name: 'Kinnan, Bonder Prodigy', type_line: 'Legendary Creature — Human Druid', mana_cost: '{G}{U}', cmc: 2, power: '2', toughness: '2', oracle_text: 'Whenever you tap a nonland permanent for mana, add one mana of any type that permanent produced.\n{5}{G}{U}: Look at the top five cards of your library. You may put a non-Human creature card from among them onto the battlefield. Put the rest on the bottom of your library in a random order.' }),
  makeCard({ name: 'Simic Signet', type_line: 'Artifact', mana_cost: '{2}', cmc: 2, oracle_text: '{1}, {T}: Add {G}{U}.' }),
  makeCard({ name: 'Sol Ring', type_line: 'Artifact', mana_cost: '{1}', cmc: 1, oracle_text: '{T}: Add {C}{C}.' }),
  makeCard({ name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', mana_cost: '{G}', cmc: 1, power: '1', toughness: '1', oracle_text: '{T}: Add {G}.' }),
  makeCard({ name: 'Birds of Paradise', type_line: 'Creature — Bird', mana_cost: '{G}', cmc: 1, power: '0', toughness: '1', oracle_text: 'Flying\n{T}: Add one mana of any color.' }),
  makeCard({ name: 'Simic Growth Chamber', type_line: 'Land', mana_cost: '', cmc: 0, oracle_text: '{T}: Add {G}{U}.' }),
  makeCard({ name: "Mirari's Wake", type_line: 'Enchantment', mana_cost: '{3}{G}{W}', cmc: 5, oracle_text: 'Creatures you control get +1/+1.\nWhenever you tap a land for mana, add one mana of any type that land produced.' }),
];
const main = () => toStep(start({ extra: CARDS }), 'main1', 'alice');
const manaOf = (g: GameState, id: string) => legalActions(g, 'alice').filter((a): a is Extract<Action, { type: 'activate_mana' }> => a.type === 'activate_mana' && a.object === id);
const pool = (g: GameState) => Object.fromEntries(Object.entries(g.players.alice!.pool).filter(([, n]) => n > 0));

describe('a mana ability with a mana cost', () => {
  it('a Signet with nothing floating is offered, and pays its {1} from a land', () => {
    let g = main();
    const signet = give(g, 'alice', 'Simic Signet', 'battlefield');
    // Nothing to pay with: not offered.
    expect(manaOf(g, signet)).toEqual([]);
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    const [a] = manaOf(g, signet);
    expect(a).toEqual({ type: 'activate_mana', player: 'alice', object: signet, ability: 0, autoTap: true });
    g = act(g, a!);
    expect([g.objects[forest]!.tapped, g.objects[signet]!.tapped]).toEqual([true, true]);
    expect(pool(g)).toEqual({ G: 1, U: 1 });
  });

  it('with the mana floating already, nothing else is tapped', () => {
    let g = main();
    const signet = give(g, 'alice', 'Simic Signet', 'battlefield');
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    g.players.alice!.pool.R = 1;
    const [a] = manaOf(g, signet);
    expect(a!.autoTap).toBeUndefined();
    g = act(g, a!);
    expect(g.objects[forest]!.tapped).toBe(false);
    expect(pool(g)).toEqual({ G: 1, U: 1 });
  });

  it('a Signet can’t pay for itself, and the engine refuses when nothing can', () => {
    const g = main();
    const signet = give(g, 'alice', 'Simic Signet', 'battlefield');
    illegal(g, { type: 'activate_mana', player: 'alice', object: signet, ability: 0, autoTap: true });
  });

  it('two Signets and one land: each can be clicked, the second pays with the first’s mana', () => {
    let g = main();
    const a1 = give(g, 'alice', 'Simic Signet', 'battlefield');
    const a2 = give(g, 'alice', 'Simic Signet', 'battlefield');
    give(g, 'alice', 'Forest', 'battlefield');
    g = act(g, manaOf(g, a1)[0]!);
    expect(pool(g)).toEqual({ G: 1, U: 1 });
    g = act(g, manaOf(g, a2)[0]!);
    expect(Object.values(pool(g)).reduce((n, x) => n + x, 0)).toBe(3);
  });
});

describe('mana of any type that permanent produced', () => {
  it('Kinnan with a permanent that makes one type: one more of it, nothing to choose', () => {
    let g = main();
    give(g, 'alice', 'Kinnan, Bonder Prodigy', 'battlefield', { sick: false });
    const ring = give(g, 'alice', 'Sol Ring', 'battlefield');
    const elves = give(g, 'alice', 'Llanowar Elves', 'battlefield', { sick: false });
    expect(manaOf(g, ring)).toHaveLength(1);
    expect(manaOf(g, ring)[0]!.bonus).toBeUndefined();
    g = act(g, manaOf(g, ring)[0]!);
    g = act(g, manaOf(g, elves)[0]!);
    expect(pool(g)).toEqual({ C: 3, G: 2 });
  });

  it('Kinnan with Birds: the extra mana is of the colour the Birds made', () => {
    let g = main();
    give(g, 'alice', 'Kinnan, Bonder Prodigy', 'battlefield', { sick: false });
    const birds = give(g, 'alice', 'Birds of Paradise', 'battlefield', { sick: false });
    const red = manaOf(g, birds).find((a) => a.choice === 'R')!;
    expect(red.bonus).toBeUndefined();
    g = act(g, red);
    expect(pool(g)).toEqual({ R: 2 });
  });

  it('Kinnan with a Signet: the player chooses green or blue for the extra mana', () => {
    const g0 = main();
    give(g0, 'alice', 'Kinnan, Bonder Prodigy', 'battlefield', { sick: false });
    const signet = give(g0, 'alice', 'Simic Signet', 'battlefield');
    give(g0, 'alice', 'Forest', 'battlefield');
    const ways = manaOf(g0, signet);
    expect(ways.map((a) => a.bonus)).toEqual([['G'], ['U']]);
    expect(pool(act(g0, ways[0]!))).toEqual({ G: 2, U: 1 });
    expect(pool(act(g0, ways[1]!))).toEqual({ G: 1, U: 2 });
    // Not named (tapped automatically): the first type it made. A type it didn't make is no choice at all.
    expect(pool(act(g0, { ...ways[0]!, bonus: [] }))).toEqual({ G: 2, U: 1 });
    expect(pool(act(g0, { ...ways[0]!, bonus: ['R'] }))).toEqual({ G: 2, U: 1 });
  });

  it('Kinnan doesn’t see lands; Mirari’s Wake does, with the same choice', () => {
    let g = main();
    give(g, 'alice', 'Kinnan, Bonder Prodigy', 'battlefield', { sick: false });
    const chamber = give(g, 'alice', 'Simic Growth Chamber', 'battlefield');
    expect(manaOf(g, chamber).map((a) => a.bonus)).toEqual([undefined]);
    give(g, 'alice', "Mirari's Wake", 'battlefield');
    const ways = manaOf(g, chamber);
    expect(ways.map((a) => a.bonus)).toEqual([['G'], ['U']]);
    g = act(g, ways[1]!);
    expect(pool(g)).toEqual({ G: 1, U: 2 });
  });
});
