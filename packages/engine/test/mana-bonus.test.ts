import { describe, expect, it } from 'vitest';
import { apply, legalActions } from '../src/index.js';
import type { Action, GameEvent, GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

// Mana added on top of a tap (CR 106.12a: Kinnan's "one mana of any type that permanent produced") when the tap is
// made for the player: it counts toward what they can pay, it has no spending restriction of its own (CR 106.6 is about
// the mana an ability says it restricts), and where there's a choice of type it's the type the cost needs.
const CARDS = [
  makeCard({ name: 'Kinnan, Bonder Prodigy', type_line: 'Legendary Creature — Human Druid', mana_cost: '{G}{U}', cmc: 2, power: '2', toughness: '2', oracle_text: 'Whenever you tap a nonland permanent for mana, add one mana of any type that permanent produced.\n{5}{G}{U}: Look at the top five cards of your library. You may put a non-Human creature card from among them onto the battlefield. Put the rest on the bottom of your library in a random order.' }),
  makeCard({ name: 'Shang-Chi, Master of Kung Fu', type_line: 'Legendary Creature — Human Warrior Hero', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle_text: 'You may activate abilities of creatures you control as though those creatures had haste.\n{T}: Add two mana of any one color. Spend this mana only to activate abilities of creature sources.' }),
  makeCard({ name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', mana_cost: '{G}', cmc: 1, power: '1', toughness: '1', oracle_text: '{T}: Add {G}.' }),
  makeCard({ name: 'Lord of Atlantis', type_line: 'Creature — Merfolk', mana_cost: '{U}{U}', cmc: 2, power: '2', toughness: '2', oracle_text: 'Other Merfolk get +1/+1 and have islandwalk.' }),
  makeCard({ name: 'Simic Signet', type_line: 'Artifact', mana_cost: '{2}', cmc: 2, oracle_text: '{1}, {T}: Add {G}{U}.' }),
  makeCard({ name: "Mirari's Wake", type_line: 'Enchantment', mana_cost: '{3}{G}{W}', cmc: 5, oracle_text: 'Creatures you control get +1/+1.\nWhenever you tap a land for mana, add one mana of any type that land produced.' }),
];
const main = () => toStep(start({ extra: CARDS }), 'main1', 'alice');
const of = (g: GameState, id: string) => legalActions(g, 'alice').filter((a) => 'object' in a && a.object === id);
const pool = (g: GameState) => Object.fromEntries(Object.entries(g.players.alice!.pool).filter(([, n]) => n > 0));
const restricted = (g: GameState) => (g.players.alice!.restricted ?? []).map((r) => `${r.color}${r.amount}`).join(' ');
const tapped = (g: GameState) => Object.values(g.objects).filter((o) => o.zone === 'battlefield' && o.tapped).map((o) => o.card).sort();
const greenFrom = (g: GameState, id: string) => of(g, id).find((a) => a.type === 'activate_mana' && a.choice === 'G')!;

describe('Shang-Chi, Master of Kung Fu with Kinnan', () => {
  it('tapped for green: two green for creatures’ abilities, and one more green from Kinnan with no restriction', () => {
    const g0 = main();
    const kinnan = give(g0, 'alice', 'Kinnan, Bonder Prodigy', 'battlefield', { sick: false });
    const shang = give(g0, 'alice', 'Shang-Chi, Master of Kung Fu', 'battlefield', { sick: false });
    const r = apply(g0, greenFrom(g0, shang));
    if (!r.ok) throw new Error(r.error);
    expect(pool(r.state)).toEqual({ G: 1 });
    expect(restricted(r.state)).toBe('G1 G1');
    // The events say what made which mana (the table shows it).
    const mana = r.events.filter((e): e is Extract<GameEvent, { type: 'mana_added' }> => e.type === 'mana_added');
    expect(mana).toEqual([
      { type: 'mana_added', player: 'alice', mana: ['G', 'G'], source: shang, spend: { abilities: { types: ['Creature'] } } },
      { type: 'mana_added', player: 'alice', mana: ['G'], source: kinnan, triggered: true },
    ]);
  });

  it('the three mana and four lands pay for Kinnan’s {5}{G}{U}; with three lands it isn’t offered', () => {
    for (const lands of [3, 4]) {
      const g = main();
      const kinnan = give(g, 'alice', 'Kinnan, Bonder Prodigy', 'battlefield', { sick: false });
      give(g, 'alice', 'Shang-Chi, Master of Kung Fu', 'battlefield', { sick: false });
      for (let i = 0; i < lands; i++) give(g, 'alice', i % 2 ? 'Island' : 'Forest', 'battlefield');
      const ways = of(g, kinnan).filter((a) => a.type === 'activate');
      expect(ways).toHaveLength(lands === 4 ? 1 : 0);
      if (lands < 4) continue;
      const after = act(g, ways[0]!);
      expect(after.stack).toHaveLength(1);
      expect(tapped(after)).toEqual(['Forest', 'Forest', 'Island', 'Island', 'Shang-Chi, Master of Kung Fu']);
      expect([pool(after), restricted(after)]).toEqual([{}, '']);
    }
  });

  it('the mana Kinnan adds casts a spell, though Shang-Chi’s own can’t', () => {
    const g = main();
    give(g, 'alice', 'Kinnan, Bonder Prodigy', 'battlefield', { sick: false });
    const shang = give(g, 'alice', 'Shang-Chi, Master of Kung Fu', 'battlefield', { sick: false });
    const elves = give(g, 'alice', 'Llanowar Elves', 'hand');
    const cast = of(g, elves).find((a) => a.type === 'cast');
    expect(cast).toMatchObject({ type: 'cast', autoTap: true });
    const after = act(g, cast!);
    expect(after.objects[shang]!.tapped).toBe(true);
    expect(after.stack).toHaveLength(1);
    // Shang-Chi's two green are still there for a creature's ability.
    expect([pool(after), restricted(after)]).toEqual([{}, 'G1 G1']);
  });

  it('without Kinnan there is nothing to cast it with, and Shang-Chi isn’t tapped for nothing', () => {
    const g = main();
    const shang = give(g, 'alice', 'Shang-Chi, Master of Kung Fu', 'battlefield', { sick: false });
    const elves = give(g, 'alice', 'Llanowar Elves', 'hand');
    expect(of(g, elves)).toEqual([]);
    // A trigger that doesn't see Shang-Chi (Mirari's Wake is about lands) changes nothing.
    give(g, 'alice', "Mirari's Wake", 'battlefield');
    expect(of(g, elves)).toEqual([]);
    expect(g.objects[shang]!.tapped).toBe(false);
  });

  it('a land that can pay is tapped before Shang-Chi is', () => {
    const g = main();
    give(g, 'alice', 'Kinnan, Bonder Prodigy', 'battlefield', { sick: false });
    const shang = give(g, 'alice', 'Shang-Chi, Master of Kung Fu', 'battlefield', { sick: false });
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    const elves = give(g, 'alice', 'Llanowar Elves', 'hand');
    const after = act(g, of(g, elves).find((a) => a.type === 'cast')!);
    expect([after.objects[forest]!.tapped, after.objects[shang]!.tapped]).toEqual([true, false]);
  });
});

describe('the type of the mana added on top, when a cost is paid for the player', () => {
  it('Kinnan with a Signet and a land pays {U}{U}: the extra mana is blue', () => {
    const g = main();
    give(g, 'alice', 'Kinnan, Bonder Prodigy', 'battlefield', { sick: false });
    give(g, 'alice', 'Simic Signet', 'battlefield');
    give(g, 'alice', 'Forest', 'battlefield');
    const lord = give(g, 'alice', 'Lord of Atlantis', 'hand');
    const cast = of(g, lord).find((a) => a.type === 'cast');
    expect(cast).toMatchObject({ type: 'cast', autoTap: true });
    const after = act(g, cast!);
    expect(after.stack).toHaveLength(1);
    expect(tapped(after)).toEqual(['Forest', 'Simic Signet']);
    // The Forest's green paid the Signet's {1}; the Signet made {G}{U} and Kinnan a second blue. One green is left.
    expect(pool(after)).toEqual({ G: 1 });
  });

  it('Mirari’s Wake with a land that makes two colours: the extra mana is the colour still needed', () => {
    const g = toStep(start({ extra: [...CARDS, makeCard({ name: 'Simic Growth Chamber', type_line: 'Land', mana_cost: '', cmc: 0, oracle_text: '{T}: Add {G}{U}.' })] }), 'main1', 'alice');
    give(g, 'alice', "Mirari's Wake", 'battlefield');
    give(g, 'alice', 'Simic Growth Chamber', 'battlefield');
    const lord = give(g, 'alice', 'Lord of Atlantis', 'hand');
    const cast = of(g, lord).find((a) => a.type === 'cast');
    expect(cast).toBeTruthy();
    expect(pool(act(g, cast!))).toEqual({ G: 1 });
  });
});

describe('cards a player looks at are shown to them even when there is nothing to take (CR 701.20e)', () => {
  const dig = (top: string[]) => {
    let g = main();
    const kinnan = give(g, 'alice', 'Kinnan, Bonder Prodigy', 'battlefield', { sick: false });
    for (let i = 0; i < 7; i++) give(g, 'alice', i % 2 ? 'Island' : 'Forest', 'battlefield');
    // The top five, in order.
    const lib = g.zones.library.alice!;
    const tops = top.map((name) => give(g, 'alice', name, 'library'));
    lib.splice(0, lib.length, ...tops, ...lib.filter((id) => !tops.includes(id)));
    g = act(g, of(g, kinnan).find((a) => a.type === 'activate')!);
    while (g.stack.length && !g.pending) g = act(g, { type: 'pass', player: g.priority! });
    return { g, tops };
  };

  it('Kinnan’s ability with five lands on top: the five are shown, with nothing to choose, then go to the bottom', () => {
    const { g, tops } = dig(['Forest', 'Island', 'Forest', 'Island', 'Forest']);
    expect(g.pending).toMatchObject({ kind: 'choose_objects', player: 'alice', candidates: [], min: 0, max: 0, seen: tops });
    const after = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [] } });
    expect(after.pending).toBeNull();
    expect(after.stack).toHaveLength(0);
    expect([...after.zones.library.alice!.slice(-5)].sort()).toEqual([...tops].sort());
  });

  it('with a creature among them it asks as before, and a Human isn’t a choice', () => {
    const { g, tops } = dig(['Forest', 'Llanowar Elves', 'Shang-Chi, Master of Kung Fu', 'Island', 'Forest']);
    expect(g.pending).toMatchObject({ kind: 'choose_objects', candidates: [tops[1]], min: 0, max: 1, seen: tops });
  });
});

describe('a mana ability whose mana depends on a condition is tapped for the player like any other', () => {
  const MORE = [
    makeCard({ name: 'Incubation Druid', type_line: 'Creature — Elf Druid', mana_cost: '{1}{G}', cmc: 2, power: '0', toughness: '2', oracle_text: '{T}: Add one mana of any type that a land you control could produce. If this creature has a +1/+1 counter on it, add three mana of that type instead.\n{3}{G}{G}: Adapt 3. (If this creature has no +1/+1 counters on it, put three +1/+1 counters on it.)' }),
    makeCard({ name: 'Centaur Courser', type_line: 'Creature — Centaur Warrior', mana_cost: '{2}{G}', cmc: 3, power: '3', toughness: '3', oracle_text: '' }),
    makeCard({ name: "Urza's Tower", type_line: "Land — Urza's Tower", mana_cost: '', cmc: 0, oracle_text: "{T}: Add {C}. If you control an Urza's Mine and an Urza's Power-Plant, add {C}{C}{C} instead." }),
    makeCard({ name: "Urza's Mine", type_line: "Land — Urza's Mine", mana_cost: '', cmc: 0, oracle_text: "{T}: Add {C}. If you control an Urza's Power-Plant and an Urza's Tower, add {C}{C} instead." }),
    makeCard({ name: "Urza's Power Plant", type_line: "Land — Urza's Power-Plant", mana_cost: '', cmc: 0, oracle_text: "{T}: Add {C}. If you control an Urza's Mine and an Urza's Tower, add {C}{C} instead." }),
    makeCard({ name: 'Platinum Angel', type_line: 'Artifact Creature — Angel', mana_cost: '{7}', cmc: 7, power: '4', toughness: '4', oracle_text: "Flying\nYou can't lose the game and your opponents can't win the game." }),
    makeCard({ name: 'Gemstone Caverns', type_line: 'Legendary Land', mana_cost: '', cmc: 0, oracle_text: "If Gemstone Caverns is in your opening hand and you're not the starting player, you may begin the game with Gemstone Caverns on the battlefield with a luck counter on it. If you do, exile a card from your hand.\n{T}: Add {C}. If Gemstone Caverns has a luck counter on it, instead add one mana of any color." }),
  ];
  const table = () => toStep(start({ extra: [...CARDS, ...MORE] }), 'main1', 'alice');

  it('Incubation Druid and a Forest cast a two-mana spell; with a +1/+1 counter the Druid alone casts a three-mana one', () => {
    const g = table();
    const druid = give(g, 'alice', 'Incubation Druid', 'battlefield', { sick: false });
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    const two = give(g, 'alice', 'Shang-Chi, Master of Kung Fu', 'hand');
    const three = give(g, 'alice', 'Centaur Courser', 'hand');
    const after = act(g, of(g, two).find((a) => a.type === 'cast')!);
    expect([after.objects[druid]!.tapped, after.objects[forest]!.tapped]).toEqual([true, true]);
    // Three mana isn't there without the counter…
    expect(of(g, three)).toEqual([]);
    // …and with it, the Druid's three green pay for the Courser, and the Forest stays untapped.
    g.objects[druid]!.counters['+1/+1'] = 1;
    const cast = of(g, three).find((a) => a.type === 'cast');
    expect(cast).toBeTruthy();
    const then = act(g, cast!);
    expect([then.objects[druid]!.tapped, then.objects[forest]!.tapped]).toEqual([true, false]);
    expect(pool(then)).toEqual({});
  });

  it('the three Urza lands together make seven', () => {
    const g = table();
    for (const name of ["Urza's Tower", "Urza's Mine", "Urza's Power Plant"]) give(g, 'alice', name, 'battlefield');
    const angel = give(g, 'alice', 'Platinum Angel', 'hand');
    const cast = of(g, angel).find((a) => a.type === 'cast');
    expect(cast).toBeTruthy();
    expect(pool(act(g, cast!))).toEqual({});
    // Two of them make one each: not enough.
    const h = table();
    for (const name of ["Urza's Tower", "Urza's Mine"]) give(h, 'alice', name, 'battlefield');
    expect(of(h, give(h, 'alice', 'Platinum Angel', 'hand'))).toEqual([]);
  });

  // The ways to tap it are the ways of what it would add now (CR 605.3b: it resolves as it's activated). Listed as
  // "{C}" whatever its counters, the Caverns with a luck counter couldn't be tapped at all: the engine asked for a color.
  const ways = (g: GameState, id: string) => of(g, id).flatMap((a) => (a.type === 'activate_mana' ? [a.choice ?? '-'] : []));

  it('Gemstone Caverns: {C} without its luck counter, one mana of any color with it', () => {
    const g = table();
    const caverns = give(g, 'alice', 'Gemstone Caverns', 'battlefield');
    const elves = give(g, 'alice', 'Llanowar Elves', 'hand');
    expect(ways(g, caverns)).toEqual(['-']);
    expect(pool(act(g, of(g, caverns)[0]!))).toEqual({ C: 1 });
    // Colorless doesn't pay for {G}.
    expect(of(g, elves)).toEqual([]);
    g.objects[caverns]!.counters.luck = 1;
    expect(ways(g, caverns)).toEqual(['W', 'U', 'B', 'R', 'G']);
    for (const a of of(g, caverns)) expect(pool(act(g, a))).toEqual({ [(a as Extract<Action, { type: 'activate_mana' }>).choice as string]: 1 });
    // And it's tapped for the player, for the color the spell needs.
    const cast = of(g, elves).find((a) => a.type === 'cast');
    expect(cast).toBeTruthy();
    const after = act(g, cast!);
    expect(after.objects[caverns]!.tapped).toBe(true);
    expect(pool(after)).toEqual({});
  });

  it('CR 106.7: "any type that a land you control could produce" counts what such a land would add now', () => {
    const g = table();
    const druid = give(g, 'alice', 'Incubation Druid', 'battlefield', { sick: false });
    // No lands: nothing it could add.
    expect(ways(g, druid)).toEqual([]);
    const caverns = give(g, 'alice', 'Gemstone Caverns', 'battlefield');
    expect(ways(g, druid)).toEqual(['C']);
    g.objects[caverns]!.counters.luck = 1;
    expect(ways(g, druid)).toEqual(['W', 'U', 'B', 'R', 'G']);
    // An Urza's Tower on its own makes {C}; the Druid can too.
    const h = table();
    const other = give(h, 'alice', 'Incubation Druid', 'battlefield', { sick: false });
    give(h, 'alice', "Urza's Tower", 'battlefield');
    expect(ways(h, other)).toEqual(['C']);
  });
});
