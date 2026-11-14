import { describe, expect, it } from 'vitest';
import { legalActions, manaAbilities, type Action, type GameState } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

// What the list offers and what apply() accepts are one set. The fuzz games check it both ways: everything listed is
// accepted, and (scripts/lib/unlisted.ts) nothing unlisted is. These are the cases the second check found the first
// time it ran.

const listed = (g: GameState, object: string) => legalActions(g, 'alice').filter((a) => (a as { object?: string }).object === object);

// CR 113.6: an object's abilities work only while it is a permanent, unless they say otherwise. A basic land's mana
// ability (CR 305.6) is no exception — but the engine gave a Forest card "{T}: Add {G}" in every zone, and accepted an
// activation of it from the hand: the card was "tapped" there and the mana added. No table offered it; a client that
// sent the action would have had it.
describe('CR 113.6: a land card in a hand has no mana ability', () => {
  it('a Forest in hand: no ability, and tapping it for mana is refused', () => {
    const g = toStep(start(), 'main1', 'alice');
    const forest = g.zones.hand.alice!.find((id) => g.objects[id]!.card === 'Forest')!;
    expect(manaAbilities(g, g.objects[forest]!)).toEqual([]);
    expect(illegal(g, { type: 'activate_mana', player: 'alice', object: forest, ability: 0 })).toBe('Forest has no such mana ability.');
    expect(listed(g, forest).map((a) => a.type)).toEqual(['play_land']);
  });

  it('on the battlefield it has it, as ever', () => {
    let g = toStep(start(), 'main1', 'alice');
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    expect(manaAbilities(g, g.objects[forest]!)).toHaveLength(1);
    g = act(g, { type: 'activate_mana', player: 'alice', object: forest, ability: 0 });
    expect(g.players.alice!.pool.G).toBe(1);
  });

  it('nor in a graveyard', () => {
    const g = toStep(start(), 'main1', 'alice');
    const forest = give(g, 'alice', 'Forest', 'graveyard');
    expect(manaAbilities(g, g.objects[forest]!)).toEqual([]);
    expect(listed(g, forest)).toEqual([]);
  });
});

// An ability that says where it works from does work from there: Simian Spirit Guide's from the hand (CR 605.1a), and
// Jack-o'-Lantern's "{1}, Exile this card from your graveyard: Add one mana of any color." from the graveyard, which
// nothing listed and the engine refused ("You don't control that permanent").
describe('a mana ability that works from a graveyard', () => {
  const lantern = makeCard({ name: 'Test Lantern', type_line: 'Artifact', mana_cost: '{1}', oracle_text: '{1}, {T}, Sacrifice this artifact: Draw a card.\n{1}, Exile this card from your graveyard: Add one mana of any color.' });

  it('the card is read in full, its second ability as one for the graveyard', () => {
    expect(lantern.automation).toBe('full');
    expect(lantern.faces[0]!.abilities.map((a) => (a.kind === 'activated' ? [Boolean(a.mana), a.zone] : []))).toEqual([[false, undefined], [true, 'graveyard']]);
  });

  it('is listed there, once for each color, and adds the mana as the card is exiled', () => {
    let g = toStep(start({ extra: [lantern] }), 'main1', 'alice');
    const id = give(g, 'alice', 'Test Lantern', 'graveyard');
    g.players.alice!.pool.C = 1;
    const ways = listed(g, id).filter((a): a is Extract<Action, { type: 'activate_mana' }> => a.type === 'activate_mana');
    expect(ways.map((a) => a.choice)).toEqual(['W', 'U', 'B', 'R', 'G']);
    g = act(g, ways[3]!);
    expect(g.objects[id]!.zone).toBe('exile');
    expect(g.players.alice!.pool).toMatchObject({ R: 1, C: 0 });
  });

  it('on the battlefield only its first ability is its own', () => {
    const g = toStep(start({ extra: [lantern] }), 'main1', 'alice');
    const id = give(g, 'alice', 'Test Lantern', 'battlefield');
    expect(manaAbilities(g, g.objects[id]!)).toEqual([]);
  });
});

// CR 702.172a: spree — "Choose one or more additional costs." The list filled in the first mode and, where that one
// couldn't be paid for, left the spell out, though a cheaper mode could have been.
describe('spree: the list offers a mode that can be paid for', () => {
  const surprise = makeCard({
    name: 'Test Surprise',
    type_line: 'Instant',
    mana_cost: '{G}',
    oracle_text: 'Spree (Choose one or more additional costs.)\n+ {4} — You gain 10 life.\n+ {1} — You gain 2 life.',
  });

  it('with two mana: the {1} mode', () => {
    let g = toStep(start({ extra: [surprise] }), 'main1', 'alice');
    const id = give(g, 'alice', 'Test Surprise', 'hand');
    Object.assign(g.players.alice!.pool, { G: 1, C: 1 });
    const [a] = listed(g, id);
    expect(a).toMatchObject({ type: 'cast', modes: [1] });
    g = passRound(act(g, a!));
    expect(g.players.alice!.life).toBe(22);
  });

  it('with five: the first mode, as before', () => {
    const g = toStep(start({ extra: [surprise] }), 'main1', 'alice');
    const id = give(g, 'alice', 'Test Surprise', 'hand');
    Object.assign(g.players.alice!.pool, { G: 1, C: 4 });
    expect(listed(g, id)[0]).toMatchObject({ type: 'cast', modes: [0] });
  });

  it('with one: not at all (a mode has to be chosen)', () => {
    const g = toStep(start({ extra: [surprise] }), 'main1', 'alice');
    const id = give(g, 'alice', 'Test Surprise', 'hand');
    g.players.alice!.pool.G = 1;
    expect(listed(g, id)).toEqual([]);
  });
});

// What a spell costs can depend on what it targets (CR 601.2f). The list's default targets — as many as allowed, the
// first candidates — are then not the only ones worth trying.
describe('targets that change the cost', () => {
  const call = makeCard({ name: 'Test Call', type_line: 'Instant', mana_cost: '{2}{W}', oracle_text: 'Strive — This spell costs {1}{W} more to cast for each target beyond the first.\nChoose any number of target opponents. Each of those players loses 1 life.' });
  const blowout = makeCard({ name: 'Test Blowout', type_line: 'Sorcery', mana_cost: '{2}{U}', oracle_text: "This spell costs {2} less to cast if it targets a permanent with mana value 1.\nReturn target creature an opponent controls to its owner's hand." });
  const bear = makeCard({ name: 'Test Cub', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle_text: '' });
  const mouse = makeCard({ name: 'Test Mouse', type_line: 'Creature — Mouse', mana_cost: '{W}', cmc: 1, power: '1', toughness: '1', oracle_text: '' });

  it('strive: with mana for one target among three opponents, one target', () => {
    const g = toStep(start({ players: 4, extra: [call] }), 'main1', 'alice');
    const id = give(g, 'alice', 'Test Call', 'hand');
    Object.assign(g.players.alice!.pool, { W: 1, C: 2 });
    expect(listed(g, id)).toEqual([{ type: 'cast', player: 'alice', object: id, autoTap: true, targets: [[{ kind: 'player', player: 'bob' }]] }]);
    // With mana for two: two.
    Object.assign(g.players.alice!.pool, { W: 2, C: 3 });
    expect((listed(g, id)[0] as Extract<Action, { type: 'cast' }>).targets![0]).toHaveLength(2);
  });

  it('"costs {2} less if it targets a permanent with mana value 1": with one mana, that one', () => {
    const g = toStep(start({ extra: [blowout, bear, mouse] }), 'main1', 'alice');
    const id = give(g, 'alice', 'Test Blowout', 'hand');
    give(g, 'bob', 'Test Cub', 'battlefield');
    const small = give(g, 'bob', 'Test Mouse', 'battlefield');
    g.players.alice!.pool.U = 1;
    expect(listed(g, id)).toEqual([{ type: 'cast', player: 'alice', object: id, autoTap: true, targets: [[{ kind: 'object', object: small }]] }]);
  });
});

// CR 106.5: "If an ability would produce one or more mana of an undefined type, it produces no mana instead." Mox Amber
// with no legendary creature or planeswalker can still be tapped; it adds nothing. The engine took the activation; the
// list had no entry for it, having no color to list it under.
describe('CR 106.5: a mana ability with no mana to add right now', () => {
  const amber = makeCard({ name: 'Test Amber', type_line: 'Legendary Artifact', mana_cost: '{0}', oracle_text: '{T}: Add one mana of any color among legendary creatures and planeswalkers you control.' });
  const legend = makeCard({ name: 'Test Legend', type_line: 'Legendary Creature — Human', mana_cost: '{R}{G}', power: '2', toughness: '2', oracle_text: '' });
  const mana = (g: GameState, id: string) => listed(g, id).filter((a): a is Extract<Action, { type: 'activate_mana' }> => a.type === 'activate_mana');

  it('is listed once, without a color, and taps for nothing', () => {
    let g = toStep(start({ extra: [amber, legend] }), 'main1', 'alice');
    const id = give(g, 'alice', 'Test Amber', 'battlefield');
    expect(mana(g, id).map((a) => a.choice)).toEqual([undefined]);
    // A color it can't make is still refused.
    expect(illegal(g, { type: 'activate_mana', player: 'alice', object: id, ability: 0, choice: 'W' })).toBeTruthy();
    g = act(g, mana(g, id)[0]!);
    expect(g.objects[id]!.tapped).toBe(true);
    expect(Object.values(g.players.alice!.pool).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('with a legendary creature, once for each of its colors', () => {
    let g = toStep(start({ extra: [amber, legend] }), 'main1', 'alice');
    const id = give(g, 'alice', 'Test Amber', 'battlefield');
    give(g, 'alice', 'Test Legend', 'battlefield');
    expect(mana(g, id).map((a) => a.choice)).toEqual(['R', 'G']);
    expect(illegal(g, { type: 'activate_mana', player: 'alice', object: id, ability: 0 })).toBeTruthy();
    g = act(g, mana(g, id)[1]!);
    expect(g.players.alice!.pool.G).toBe(1);
  });
});

// "As an additional cost to cast this spell, you may sacrifice any number of nonland permanents. This spell costs {1}
// less to cast for each permanent sacrificed this way." The list's default for an optional cost is to pay nothing of
// it; where the mana wasn't there without the discount, the spell was left out, though the engine would cast it.
describe('an optional cost that makes the spell cheaper: the list takes as few as bring it within reach', () => {
  const viper = makeCard({ name: 'Test Viper', type_line: 'Creature — Snake', mana_cost: '{5}{G}', power: '6', toughness: '6', oracle_text: 'As an additional cost to cast this spell, you may sacrifice any number of nonland permanents. This spell costs {1} less to cast for each permanent sacrificed this way.' });
  const table = (lands: number, bears: number) => {
    const g = toStep(start({ extra: [viper] }), 'main1', 'alice');
    for (let i = 0; i < lands; i++) give(g, 'alice', 'Forest', 'battlefield');
    const others = Array.from({ length: bears }, () => give(g, 'alice', 'Grizzly Bears', 'battlefield'));
    return { g, others, id: give(g, 'alice', 'Test Viper', 'hand') };
  };
  const sacrificed = (g: GameState, id: string) => listed(g, id).map((a) => (a.type === 'cast' ? (a.costs?.sacrifice ?? []) : null));

  it('with the mana for all of it: nothing is sacrificed', () => {
    const { g, id } = table(6, 2);
    expect(sacrificed(g, id)).toEqual([[]]);
  });

  it('one mana short: one permanent; two short: two', () => {
    const one = table(5, 2);
    expect(sacrificed(one.g, one.id)).toEqual([[one.others[0]]]);
    const two = table(4, 2);
    expect(sacrificed(two.g, two.id)).toEqual([two.others]);
    const g = act(two.g, listed(two.g, two.id)[0]!);
    expect(two.others.map((o) => g.objects[o]!.zone)).toEqual(['graveyard', 'graveyard']);
    expect(g.stack).toHaveLength(1);
  });

  it('out of reach even so: not listed', () => {
    const { g, id } = table(3, 2);
    expect(listed(g, id)).toEqual([]);
  });
});

// CR 118.9: an alternative cost applies wherever the card is cast from, unless it says where — evoke on a card an
// effect lets you cast from exile, but not warp, which is for "this card from your hand" (CR 702.185a). The list
// offered other costs only for cards in the hand; the engine took them from anywhere, warp included.
describe('an alternative cost on a card cast from exile by permission', () => {
  const evoker = makeCard({ name: 'Test Evoker', type_line: 'Creature — Elemental', mana_cost: '{4}{G}', power: '4', toughness: '4', oracle_text: 'Evoke {G}' });
  const exiled = (free: boolean) => {
    const g = toStep(start({ extra: [evoker] }), 'main1', 'alice');
    const id = give(g, 'alice', 'Test Evoker', 'exile');
    expect(listed(g, id)).toEqual([]);
    (g.mayPlay ??= []).push({ object: { id, zcc: g.objects[id]!.zcc }, player: 'alice', mode: 'play', lastTurn: g.turn, ...(free ? { free: true as const } : {}) });
    g.players.alice!.pool.G = 1;
    return { g, id };
  };

  it('evoke is offered there and taken', () => {
    const { g, id } = exiled(false);
    expect(listed(g, id).map((a) => (a.type === 'cast' ? a.alt : a.type))).toEqual(['evoke']);
    const after = act(g, listed(g, id)[0]!);
    expect(after.objects[id]!.zone).toBe('stack');
    expect(after.players.alice!.pool.G).toBe(0);
  });

  // CR 118.9a: "without paying its mana cost" is the one alternative cost that spell can have.
  it('not when the permission is to cast it without paying its mana cost', () => {
    const { g, id } = exiled(true);
    expect(listed(g, id).map((a) => (a.type === 'cast' ? a.alt : a.type))).toEqual([undefined]);
    expect(illegal(g, { type: 'cast', player: 'alice', object: id, alt: 'evoke' })).toBe('Test Evoker can be cast from there only the way the effect that lets you says.');
    expect(act(g, listed(g, id)[0]!).players.alice!.pool.G).toBe(1);
  });
});

// Flashback is an alternative cost (CR 702.34a), so no other applies with it (CR 118.9a) — the engine took an overload
// cost for a spell cast from the graveyard with a flashback it had been given. Additional costs are another matter
// (CR 118.8): they are paid with flashback as without. A spell with a required choice of them ("discard a card or pay
// {5}") wasn't listed with flashback at all, and an optional one (buyback) wasn't offered.
describe('flashback and a spell’s other costs', () => {
  const cards = [
    makeCard({ name: 'Test Flames', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each instant and sorcery card in your graveyard gains flashback until end of turn. The flashback cost is equal to its mana cost.' }),
    makeCard({ name: 'Test Storm', type_line: 'Instant', mana_cost: '{3}{R}', oracle_text: "Destroy target artifact you don't control.\nOverload {R}" }),
    makeCard({ name: 'Test Axe', type_line: 'Instant', mana_cost: '{R}', oracle_text: 'As an additional cost to cast this spell, discard a card or pay {5}.\nTest Axe deals 5 damage to target creature.' }),
    makeCard({ name: 'Test Buyer', type_line: 'Instant', mana_cost: '{R}', oracle_text: 'Buyback {2}\nYou gain 1 life.' }),
    makeCard({ name: 'Test Rock', type_line: 'Artifact', mana_cost: '{1}', oracle_text: '' }),
  ];
  const table = () => {
    let g = toStep(start({ extra: cards }), 'main1', 'alice');
    const ids = { storm: give(g, 'alice', 'Test Storm', 'graveyard'), axe: give(g, 'alice', 'Test Axe', 'graveyard'), buyer: give(g, 'alice', 'Test Buyer', 'graveyard'), bear: give(g, 'bob', 'Grizzly Bears', 'battlefield') };
    give(g, 'bob', 'Test Rock', 'battlefield');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Test Flames', 'hand') }));
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 9, G: 0, C: 0 };
    return { g, ...ids };
  };
  const ways = (g: GameState, id: string) => listed(g, id).map((a) => (a.type === 'cast' ? [a.alt ?? '-', (a.extras ?? []).join('+') || '-'].join(' ') : a.type));

  it('no other alternative cost with flashback', () => {
    const { g, storm } = table();
    expect(ways(g, storm)).toEqual(['- -']);
    expect(illegal(g, { type: 'cast', player: 'alice', object: storm, alt: 'overload' })).toBe('Test Storm is cast with flashback: no other cost can replace its mana cost.');
  });

  it('a required choice of additional costs: listed once for each', () => {
    const { g, axe, bear } = table();
    expect(ways(g, axe)).toEqual(['- choice1', '- choice2']);
    const paid = act(g, listed(g, axe)[1]!);
    expect(paid.players.alice!.pool.R).toBe(3);
    expect(passRound(paid).objects[bear]!.zone).toBe('graveyard');
    expect(passRound(paid).objects[axe]!.zone).toBe('exile');
  });

  it('an optional additional cost is offered; the card is exiled all the same', () => {
    const { g, buyer } = table();
    expect(ways(g, buyer)).toEqual(['- -', '- buyback']);
    const after = passRound(act(g, listed(g, buyer)[1]!));
    expect(after.players.alice!.life).toBe(21);
    expect(after.objects[buyer]!.zone).toBe('exile');
  });
});

// CR 107.3b: X is chosen only where the cost paid has an X in it. With {X} in its mana cost and another cost paid
// instead — evoke, "without paying its mana cost" — X is 0. The list offered those casts without an X, rightly; the
// engine took one with X = 10 all the same, and the Dragon arrived with ten counters for nothing.
describe('CR 107.3b: no X with a cost that has none', () => {
  const cards = [
    makeCard({ name: 'Test Dracogenesis', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'You may cast Dragon spells without paying their mana costs.' }),
    makeCard({ name: 'Test Hydra Dragon', type_line: 'Creature — Dragon', mana_cost: '{X}{R}', power: '0', toughness: '0', oracle_text: 'Test Hydra Dragon enters with X +1/+1 counters on it.\nEvoke {G}' }),
  ];
  const table = () => {
    const g = toStep(start({ extra: cards }), 'main1', 'alice');
    give(g, 'alice', 'Test Dracogenesis', 'battlefield');
    g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 3, G: 1, C: 0 };
    return { g, id: give(g, 'alice', 'Test Hydra Dragon', 'hand') };
  };

  it('for its mana cost it is listed with a range of X; for evoke or for nothing, with none', () => {
    const { g, id } = table();
    expect(listed(g, id).map((a) => (a.type === 'cast' ? [a.alt ?? '-', a.x, a.xMax] : a.type))).toEqual([['-', 0, 3], ['evoke', undefined, undefined], ['free', undefined, undefined]]);
  });

  it('a cast for one of those naming an X is refused', () => {
    const { g, id } = table();
    for (const alt of ['evoke', 'free']) expect(illegal(g, { type: 'cast', player: 'alice', object: id, alt, x: 10 })).toBe('There is no X to choose when Test Hydra Dragon is cast this way.');
    const paid = passRound(act(g, { type: 'cast', player: 'alice', object: id, x: 2 }));
    expect(paid.objects[id]!.counters['+1/+1']).toBe(2);
    expect(paid.players.alice!.pool.R).toBe(0);
  });

  it('nor does a spell with no X take one', () => {
    const { g } = table();
    const bears = give(g, 'alice', 'Grizzly Bears', 'hand');
    g.players.alice!.pool.G = 2;
    expect(illegal(g, { type: 'cast', player: 'alice', object: bears, x: 5 })).toBe('There is no X to choose when Grizzly Bears is cast this way.');
  });
});

// "You may cast this spell as though it had flash if it targets a permanent you control": whether it can be cast at
// this moment hangs on the target. The list tried the first target there was — an opponent's permanent, as it happened
// — found the cast refused, and offered nothing; the engine took the cast with a target of the caster's own.
describe('a spell that can be cast now only with a certain target is offered with one', () => {
  const photo = makeCard({ name: 'Test Photography', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "You may cast this spell as though it had flash if it targets a permanent you control.\nCreate a token that's a copy of target permanent." });

  it("on an opponent's turn: listed with the caster's own permanent, though an opponent's comes first", () => {
    let g = toStep(start({ extra: [photo] }), 'main1', 'bob');
    for (let i = 0; i < 14; i++) give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const mine = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    const spell = give(g, 'alice', 'Test Photography', 'hand');
    g = act(g, { type: 'pass', player: 'bob' });
    const offered = listed(g, spell);
    expect(offered).toHaveLength(1);
    expect((offered[0] as Extract<Action, { type: 'cast' }>).targets).toEqual([[{ kind: 'object', object: mine }]]);
    g = passRound(act(g, offered[0]!));
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice')).toHaveLength(1);
  });

  it("with nothing of the caster's own to target it isn't offered then, and isn't taken", () => {
    let g = toStep(start({ extra: [photo] }), 'main1', 'bob');
    const theirs = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const spell = give(g, 'alice', 'Test Photography', 'hand');
    g = act(g, { type: 'pass', player: 'bob' });
    expect(listed(g, spell)).toEqual([]);
    expect(illegal(g, { type: 'cast', player: 'alice', object: spell, targets: [[{ kind: 'object', object: theirs }]] })).toMatch(/can be cast at instant speed only if it targets/);
  });
});
