import { describe, expect, it } from 'vitest';
import { manaAbilities, parseManaCost, payFromPool } from '../src/index.js';
import { emptyPool } from '../src/mana.js';
import { act, give, illegal, start, toStep } from './helpers.js';

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
    expect(parseManaCost('{G/P}').unsupported).toEqual(['G/P']);
  });
});
