import { describe, expect, it } from 'vitest';
import { legalActions, manaAbilities, parseManaCost, payFromPool } from '../src/index.js';
import { anyColorChoices, emptyPool } from '../src/mana.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

describe('playing lands', () => {
  it('CR 305.1 / CR 116.3: play a land in your main phase and keep priority', () => {
    let g = toStep(start(), 'main1');
    const forest = g.zones.hand.alice![0]!;
    g = act(g, { type: 'play_land', player: 'alice', object: forest });
    expect(g.objects[forest]!.zone).toBe('battlefield');
    expect(g.priority).toBe('alice');
  });

  it('CR 305.1: not outside your main phase or on someone else’s turn', () => {
    let g = start();
    const forest = g.zones.hand.alice![0]!;
    expect(illegal(g, { type: 'play_land', player: 'alice', object: forest })).toMatch(/main phase/);
    g = toStep(g, 'main1', 'bob');
    const bobsForest = g.zones.hand.bob![0]!;
    g = act(g, { type: 'pass', player: 'bob' });
    expect(illegal(g, { type: 'play_land', player: 'alice', object: forest })).toMatch(/your own turn/);
    expect(g.objects[bobsForest]!.zone).toBe('hand');
  });

  it('CR 305.2: one land per turn', () => {
    let g = toStep(start(), 'main1');
    const [a, b] = g.zones.hand.alice!;
    g = act(g, { type: 'play_land', player: 'alice', object: a! });
    expect(illegal(g, { type: 'play_land', player: 'alice', object: b! })).toMatch(/already played a land/);
  });

  it('CR 305.9: a land can’t be cast', () => {
    const g = toStep(start(), 'main1');
    expect(illegal(g, { type: 'cast', player: 'alice', object: g.zones.hand.alice![0]! })).toMatch(/Play it instead/);
  });

  it('CR 614.1d: a land that "enters tapped" does', () => {
    let g = toStep(start(), 'main1');
    const falls = give(g, 'alice', 'Thornwood Falls', 'hand');
    g = act(g, { type: 'play_land', player: 'alice', object: falls });
    expect(g.objects[falls]!.tapped).toBe(true);
  });

  it('CR 712.12: a modal double-faced card can be played as its land face', () => {
    let g = toStep(start(), 'main1');
    const valakut = give(g, 'alice', 'Valakut Awakening // Valakut Stoneforge', 'hand');
    expect(illegal(g, { type: 'play_land', player: 'alice', object: valakut })).toMatch(/isn’t a land/);
    g = act(g, { type: 'play_land', player: 'alice', object: valakut, face: 1 });
    expect(g.objects[valakut]).toMatchObject({ zone: 'battlefield', face: 1 });
    // CR 614.12: "As Valakut Stoneforge enters, you may pay 3 life. If you don't, it enters tapped."
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'pay_life', amount: 3 });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', pay: true } });
    expect(g.players.alice!.life).toBe(17);
    g = act(g, { type: 'activate_mana', player: 'alice', object: valakut, ability: 0 });
    expect(g.players.alice!.pool.R).toBe(1);
  });
});

describe('mana abilities', () => {
  it('CR 305.6: basic land types grant intrinsic mana abilities', () => {
    const g = start();
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    const pool = give(g, 'alice', 'Breeding Pool', 'battlefield');
    expect(manaAbilities(g, g.objects[forest]!).map((a) => a.text)).toEqual(['{T}: Add {G}.']);
    expect(manaAbilities(g, g.objects[pool]!).map((a) => a.text)).toEqual(['{T}: Add {G}.', '{T}: Add {U}.']);
  });

  it('CR 605.3b: a mana ability resolves immediately without using the stack', () => {
    let g = toStep(start(), 'main1');
    const elves = give(g, 'alice', 'Llanowar Elves', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: elves, ability: 0 });
    expect(g.stack).toEqual([]);
    expect(g.players.alice!.pool.G).toBe(1);
    expect(g.objects[elves]!.tapped).toBe(true);
  });

  it('CR 605.1a: a mana ability can do other things too, conditions included', () => {
    const tom = makeCard({ name: 'Mutant Druid', type_line: 'Creature — Mutant', oracle_text: '{T}: Add {G}. If you control another Mutant, you gain 1 life.', mana_cost: '{G}', power: '1', toughness: '1' });
    let g = toStep(start({ extra: [tom] }), 'main1');
    const a = give(g, 'alice', 'Mutant Druid', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: a, ability: 0 });
    expect(g.players.alice).toMatchObject({ life: 20, pool: { G: 1 } });
    const b = give(g, 'alice', 'Mutant Druid', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: b, ability: 0 });
    expect(g.players.alice).toMatchObject({ life: 21, pool: { G: 2 } });
  });

  it('CR 118.3: a tapped permanent can’t be tapped again to pay a cost', () => {
    let g = toStep(start(), 'main1');
    const forest = give(g, 'alice', 'Forest', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: forest, ability: 0 });
    expect(illegal(g, { type: 'activate_mana', player: 'alice', object: forest, ability: 0 })).toMatch(/already tapped/);
  });

  it('CR 602.2: only the controller can activate a permanent’s abilities', () => {
    const g = toStep(start(), 'main1');
    const bobs = give(g, 'bob', 'Forest', 'battlefield');
    expect(illegal(g, { type: 'activate_mana', player: 'alice', object: bobs, ability: 0 })).toMatch(/don’t control/);
  });

  it('CR 106.4: choices pick the mana added — any color, or one of several options', () => {
    let g = toStep(start(), 'main1');
    const birds = give(g, 'alice', 'Birds of Paradise', 'battlefield');
    const falls = give(g, 'alice', 'Thornwood Falls', 'battlefield');
    const ring = give(g, 'alice', 'Sol Ring', 'battlefield');
    expect(illegal(g, { type: 'activate_mana', player: 'alice', object: birds, ability: 0 })).toMatch(/Choose/);
    g = act(g, { type: 'activate_mana', player: 'alice', object: birds, ability: 0, choice: 'B' });
    g = act(g, { type: 'activate_mana', player: 'alice', object: falls, ability: 0, choice: 1 });
    g = act(g, { type: 'activate_mana', player: 'alice', object: ring, ability: 0 });
    expect(g.players.alice!.pool).toMatchObject({ B: 1, U: 1, C: 2 });
  });
});

describe('paying mana costs', () => {
  const pool = (p: Partial<ReturnType<typeof emptyPool>>) => ({ ...emptyPool(), ...p });

  it('CR 107.4b: generic mana is paid with any type', () => {
    expect(payFromPool(pool({ G: 3 }), parseManaCost('{2}{G}'))).toEqual(emptyPool());
    expect(payFromPool(pool({ G: 2 }), parseManaCost('{2}{G}'))).toBeNull();
  });

  it('CR 107.4e: hybrid symbols are paid with either half', () => {
    expect(payFromPool(pool({ U: 1 }), parseManaCost('{G/U}'))).toEqual(emptyPool());
    expect(payFromPool(pool({ R: 2 }), parseManaCost('{2/W}'))).toEqual(emptyPool());
    expect(payFromPool(pool({ R: 1 }), parseManaCost('{G/U}'))).toBeNull();
  });

  it('{C} needs colorless mana specifically; {X} uses the announced value', () => {
    expect(payFromPool(pool({ G: 1 }), parseManaCost('{C}'))).toBeNull();
    expect(payFromPool(pool({ R: 4 }), parseManaCost('{X}{R}'), 3)).toEqual(emptyPool());
  });

  it('flags symbols that need player decisions not supported yet', () => {
    expect(parseManaCost('{S}').unsupported).toEqual(['S']);
  });

  it('CR 107.4f: Phyrexian symbols, one color or two', () => {
    const cost = parseManaCost('{1}{G/P}{W/U/P}');
    expect([cost.unsupported, cost.phyrexian]).toEqual([[], [['G'], ['W', 'U']]]);
    // Not paid with life, they're paid with mana.
    expect(payFromPool(pool({ G: 1, U: 1, R: 1 }), cost)).toEqual(emptyPool());
    expect(payFromPool(pool({ G: 1, R: 2 }), cost)).toBeNull();
  });
});

describe('Commander mana and modes (CR 903.4)', () => {
  const tower = makeCard({ name: 'Command Tower Lite', type_line: 'Land', oracle_text: "{T}: Add one mana of any color in your commander's color identity." });
  const will = makeCard({
    name: 'Commander Will',
    type_line: 'Instant',
    mana_cost: '{G}',
    oracle_text: 'Choose one. If you control a commander as you cast this spell, you may choose both instead.\n• You gain 2 life.\n• Draw a card.',
  });
  const deck = [...Array.from({ length: 40 }, () => 'Forest'), 'Kinnan, Bonder Prodigy', 'Command Tower Lite', 'Commander Will'];

  it('CR 903.4: Command Tower makes only colors in the commander’s identity', () => {
    const g = toStep(start({ format: 'commander', extra: [tower, will], decks: { alice: deck, bob: deck }, commanders: { alice: ['Kinnan, Bonder Prodigy'] } }), 'main1');
    const t = give(g, 'alice', 'Command Tower Lite', 'battlefield');
    const choices = legalActions(g, 'alice').filter((a) => a.type === 'activate_mana' && a.object === t).map((a) => (a as { choice: string }).choice);
    expect(choices.sort()).toEqual(['G', 'U']); // Kinnan is green-blue
    expect(illegal(g, { type: 'activate_mana', player: 'alice', object: t, ability: 0, choice: 'R' })).toMatch(/mana/);
    // Bob has no commander: no mana at all (CR 903.4f).
    expect(anyColorChoices(g, 'bob', true)).toEqual([]);
  });

  it('“If you control a commander as you cast this spell, you may choose both instead.”', () => {
    let g = toStep(start({ format: 'commander', extra: [tower, will], decks: { alice: deck, bob: deck }, commanders: { alice: ['Kinnan, Bonder Prodigy'] } }), 'main1');
    give(g, 'alice', 'Forest', 'battlefield');
    const spell = give(g, 'alice', 'Commander Will', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: spell, autoTap: true, modes: [0, 1] })).toMatch(/mode/);
    const kinnan = g.zones.command.find((id) => g.objects[id]!.commander)!;
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: kinnan, to: 'battlefield' } });
    const hand = g.zones.hand.alice!.length;
    g = passRound(act(g, { type: 'cast', player: 'alice', object: spell, autoTap: true, modes: [0, 1] }));
    expect(g.players.alice!.life).toBe(42);
    expect(g.zones.hand.alice!.length).toBe(hand);
  });
});
