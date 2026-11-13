import { describe, expect, it } from 'vitest';
import { apply, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

// Paying automatically with mana the quick planner can't count from an ability's text: counted amounts (Bloom Tender),
// abilities with a cost of their own (a Signet, a filter land, a Treasure), and mana added when a permanent is tapped
// for mana (Kinnan). A spell payable only with these is listed as castable, and casting it pays with them.
const CARDS = [
  makeCard({ name: 'Kinnan, Bonder Prodigy', type_line: 'Legendary Creature — Human Druid', mana_cost: '{G}{U}', cmc: 2, power: '2', toughness: '2', oracle_text: 'Whenever you tap a nonland permanent for mana, add one mana of any type that permanent produced.\n{5}{G}{U}: Look at the top five cards of your library. You may put a non-Human creature card from among them onto the battlefield. Put the rest on the bottom of your library in a random order.' }),
  makeCard({ name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', mana_cost: '{G}', cmc: 1, power: '1', toughness: '1', oracle_text: '{T}: Add {G}.' }),
  makeCard({ name: 'Bloom Tender', type_line: 'Creature — Elf Druid', mana_cost: '{1}{G}', cmc: 2, power: '1', toughness: '1', oracle_text: 'Vivid — {T}: For each color among permanents you control, add one mana of that color.' }),
  makeCard({ name: 'Blue Bird', type_line: 'Creature — Bird', mana_cost: '{U}', cmc: 1, power: '1', toughness: '1', oracle_text: 'Flying' }),
  makeCard({ name: 'Simic Signet', type_line: 'Artifact', mana_cost: '{2}', cmc: 2, oracle_text: '{1}, {T}: Add {G}{U}.' }),
  makeCard({ name: 'Mystic Gate', type_line: 'Land', mana_cost: '', cmc: 0, oracle_text: '{T}: Add {C}.\n{W/U}, {T}: Add {W}{W}, {W}{U}, or {U}{U}.' }),
  makeCard({ name: 'Treasure Trove', type_line: 'Artifact', mana_cost: '{1}', cmc: 1, oracle_text: '{T}, Sacrifice this artifact: Add one mana of any color.' }),
  makeCard({ name: 'Gilded Lotus', type_line: 'Artifact', mana_cost: '{5}', cmc: 5, oracle_text: '{T}: Add three mana of any one color.' }),
  makeCard({ name: 'Lord of Atlantis', type_line: 'Creature — Merfolk', mana_cost: '{U}{U}', cmc: 2, power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Farhaven Elf', type_line: 'Creature — Elf Druid', mana_cost: '{2}{G}', cmc: 3, power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Big Thing', type_line: 'Creature — Beast', mana_cost: '{3}{G}', cmc: 4, power: '4', toughness: '4', oracle_text: '' }),
  makeCard({ name: 'Bauble', type_line: 'Artifact', mana_cost: '{2}', cmc: 2, oracle_text: '' }),
];
const main = () => toStep(start({ extra: CARDS }), 'main1', 'alice');
const castable = (g: GameState, id: string) => legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === id);
const tapped = (g: GameState, id: string) => Boolean(g.objects[id]?.tapped);
const floating = (g: GameState) => Object.values(g.players.alice!.pool).reduce((a, b) => a + b, 0);

describe('auto-tap with mana that has to be tried, not counted', () => {
  it('Kinnan: two mana creatures pay for a four-mana spell', () => {
    let g = main();
    give(g, 'alice', 'Kinnan, Bonder Prodigy', 'battlefield', { sick: false });
    const elves = [give(g, 'alice', 'Llanowar Elves', 'battlefield', { sick: false }), give(g, 'alice', 'Llanowar Elves', 'battlefield', { sick: false })];
    const big = give(g, 'alice', 'Big Thing', 'hand');
    expect(castable(g, big)).toBe(true);
    g = act(g, { type: 'cast', player: 'alice', object: big, autoTap: true });
    expect(elves.map((e) => tapped(g, e))).toEqual([true, true]);
    expect(floating(g)).toBe(0);
  });

  it('Kinnan: nothing more is tapped than the spell needs', () => {
    let g = main();
    give(g, 'alice', 'Kinnan, Bonder Prodigy', 'battlefield', { sick: false });
    const elves = [0, 1, 2].map(() => give(g, 'alice', 'Llanowar Elves', 'battlefield', { sick: false }));
    const big = give(g, 'alice', 'Big Thing', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: big, autoTap: true });
    expect(elves.filter((e) => tapped(g, e))).toHaveLength(2);
  });

  it('Bloom Tender: a mana for each color among your permanents', () => {
    let g = main();
    const tender = give(g, 'alice', 'Bloom Tender', 'battlefield', { sick: false });
    give(g, 'alice', 'Blue Bird', 'battlefield');
    const lord = give(g, 'alice', 'Lord of Atlantis', 'hand');
    const elf = give(g, 'alice', 'Farhaven Elf', 'hand');
    // Green and blue: {G}{U} — not {U}{U}, and not three mana.
    expect(castable(g, lord)).toBe(false);
    expect(castable(g, elf)).toBe(false);
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    expect(castable(g, elf)).toBe(true);
    g = act(g, { type: 'cast', player: 'alice', object: elf, autoTap: true });
    expect([tapped(g, tender), tapped(g, forest)]).toEqual([true, true]);
    expect(floating(g)).toBe(0);
  });

  it('a Signet: one mana in, two out', () => {
    let g = main();
    const signet = give(g, 'alice', 'Simic Signet', 'battlefield');
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    const lord = give(g, 'alice', 'Lord of Atlantis', 'hand');
    const elf = give(g, 'alice', 'Farhaven Elf', 'hand');
    // A Forest and a Signet make {G}{U}: not {U}{U}, and not three mana.
    expect(castable(g, lord)).toBe(false);
    expect(castable(g, elf)).toBe(false);
    const bauble = give(g, 'alice', 'Bauble', 'hand');
    expect(castable(g, bauble)).toBe(true);
    g = act(g, { type: 'cast', player: 'alice', object: bauble, autoTap: true });
    expect([tapped(g, signet), tapped(g, forest)]).toEqual([true, true]);
    expect(floating(g)).toBe(0);
  });

  it('a filter land turns the other land’s mana into the colors needed', () => {
    let g = main();
    give(g, 'alice', 'Mystic Gate', 'battlefield');
    // An Island is the blue mana the Gate's ability is paid with.
    const island = give(g, 'alice', 'Island', 'battlefield');
    const lord = give(g, 'alice', 'Lord of Atlantis', 'hand');
    expect(castable(g, lord)).toBe(true);
    g = act(g, { type: 'cast', player: 'alice', object: lord, autoTap: true });
    expect(tapped(g, island)).toBe(true);
    expect(g.stack).toHaveLength(1);
    expect(floating(g)).toBe(0);
  });

  it('a Treasure is spent only when nothing else will do', () => {
    let g = main();
    const trove = give(g, 'alice', 'Treasure Trove', 'battlefield');
    const forests = [give(g, 'alice', 'Forest', 'battlefield'), give(g, 'alice', 'Forest', 'battlefield')];
    const bauble = give(g, 'alice', 'Bauble', 'hand');
    const elf = give(g, 'alice', 'Farhaven Elf', 'hand');
    // Two lands pay for the Bauble: the Treasure stays.
    const paid = apply(g, { type: 'cast', player: 'alice', object: bauble, autoTap: true });
    expect(paid.ok && paid.state.objects[trove]?.zone).toBe('battlefield');
    // Three mana needs it.
    expect(castable(g, elf)).toBe(true);
    g = act(g, { type: 'cast', player: 'alice', object: elf, autoTap: true });
    expect(g.objects[trove]?.zone).not.toBe('battlefield');
    expect(forests.map((f) => tapped(g, f))).toEqual([true, true]);
  });

  it('generic mana comes from the lands before a Gilded Lotus', () => {
    let g = main();
    const lotus = give(g, 'alice', 'Gilded Lotus', 'battlefield');
    const forests = [give(g, 'alice', 'Forest', 'battlefield'), give(g, 'alice', 'Forest', 'battlefield')];
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bauble', 'hand'), autoTap: true });
    expect([tapped(g, lotus), ...forests.map((f) => tapped(g, f))]).toEqual([false, true, true]);
  });

  it('generic mana from an any-color source is a color the hand can use', () => {
    let g = main();
    give(g, 'alice', 'Gilded Lotus', 'battlefield');
    give(g, 'alice', 'Lord of Atlantis', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bauble', 'hand'), autoTap: true });
    // Three mana for {2}: the one left over is blue, for the Lord still in hand — not white.
    expect(g.players.alice!.pool).toMatchObject({ U: 1, W: 0 });
  });

  it('what can’t be paid even with everything isn’t offered', () => {
    const g = main();
    give(g, 'alice', 'Kinnan, Bonder Prodigy', 'battlefield', { sick: false });
    give(g, 'alice', 'Llanowar Elves', 'battlefield', { sick: false });
    give(g, 'alice', 'Treasure Trove', 'battlefield');
    // {G}{G} from the Elves and Kinnan, one more from the Treasure: three, not four.
    expect(castable(g, give(g, 'alice', 'Big Thing', 'hand'))).toBe(false);
    expect(castable(g, give(g, 'alice', 'Farhaven Elf', 'hand'))).toBe(true);
  });
});
