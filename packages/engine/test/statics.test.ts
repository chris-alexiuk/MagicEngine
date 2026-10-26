import { describe, expect, it } from 'vitest';
import { chars, hasKeyword, power, toughness, type GameState } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';
import { legalActions } from '../src/index.js';

const make = (name: string, type_line: string, oracle_text: string, pt?: string) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{G}', ...(pt ? { power: pt.split('/')[0], toughness: pt.split('/')[1] ?? pt } : {}) });

const CARDS = [
  make('Dawn Duelist', 'Creature — Human Knight', 'During your turn, this creature has first strike.', '2'),
  make('Aerial Engineer', 'Creature — Human Artificer', 'As long as you control an artifact, this creature gets +2/+0 and has flying.', '2/4'),
  make('Armed Assailant', 'Creature — Human Warrior', 'As long as this creature is equipped, it gets +2/+0 and has menace.', '2'),
  make('Akki War Paint', 'Enchantment — Aura', 'Enchant permanent\nAs long as enchanted permanent is a creature, it gets +2/+1.'),
  make('Castle Raptors', 'Creature — Bird', 'Flying\nAs long as this creature is untapped, it gets +0/+2.', '3'),
  make('Demon Wall', 'Creature — Demon Wall', 'Defender\nAs long as this creature has a counter on it, it can attack as though it didn’t have defender.', '3'),
  make('Adanto Vanguard', 'Creature — Vampire Soldier', 'As long as this creature is attacking, it gets +2/+0.', '1'),
  make('Clawing Torment', 'Enchantment — Aura', 'Enchant permanent\nAs long as enchanted permanent is a creature, it gets -1/-1 and can’t block.'),
  make('Big Friend Seeker', 'Creature — Elf', 'As long as you control another creature with power 4 or greater, this creature gets +2/+2.', '3'),
  make('Blood Baron', 'Creature — Vampire', 'As long as you have 30 or more life and an opponent has 10 or less life, this creature gets +6/+6.', '4'),
  make('Ornithopter', 'Artifact Creature — Thopter', 'Flying', '0/2'),
  make('Abzan Devotee', 'Creature — Dog', '{1}: Return this card from your graveyard to your hand.', '2'),
  make('Blood Speaker', 'Creature — Ogre', 'Whenever a Demon you control enters, return this card from your graveyard to your hand.', '3'),
  make('Lesser Demon', 'Creature — Demon', '', '3'),
  make('Bonebind Orator', 'Creature — Skeleton', '{1}, Exile this card from your graveyard: Return another target creature card from your graveyard to your hand.', '2'),
  make('Reliquary Tower', 'Land', 'You have no maximum hand size.\n{T}: Add {C}.'),
  make('Explorer', 'Creature — Human Scout', 'You may play an additional land on each of your turns.', '1'),
  make('Null Profusion', 'Enchantment', 'Skip your draw step.'),
  make('Hinterland Harbor', 'Land', 'This land enters tapped unless you control a Forest or an Island.\n{T}: Add {G} or {U}.'),
  make('Botanical Sanctum', 'Land', 'This land enters tapped unless you control two or fewer other lands.\n{T}: Add {G} or {U}.'),
  make('Shock Pool', 'Land — Forest Island', "As this land enters, you may pay 2 life. If you don't, it enters tapped."),
  make('Reveal Ford', 'Land', "As this land enters, you may reveal a Forest or Island card from your hand. If you don't, this land enters tapped.\n{T}: Add {G} or {U}."),
  make('Thriving Grove', 'Land', 'This land enters tapped. As it enters, choose a color other than green.\n{T}: Add {G} or one mana of the chosen color.'),
  make('Kindred Banner', 'Artifact', 'As this artifact enters, choose a creature type.\nCreatures you control of the chosen type get +1/+1.'),
  make('Homing Ghost', 'Creature — Spirit', 'When this creature dies, return this card from your graveyard to your hand.', '1'),
]
  .concat([makeCard({ name: 'Regrowth', type_line: 'Sorcery', oracle_text: 'Return target permanent card from your graveyard to your hand.', mana_cost: '{G}' })]);

function setup(): GameState {
  const g = toStep(start({ extra: CARDS }), 'main1');
  for (let i = 0; i < 4; i++) give(g, 'alice', 'Forest', 'battlefield');
  return g;
}

describe('conditional static abilities (CR 611.3a)', () => {
  it('“During your turn, ~ has first strike.”', () => {
    let g = setup();
    const duelist = give(g, 'alice', 'Dawn Duelist', 'battlefield');
    expect(hasKeyword(g, g.objects[duelist]!, 'first_strike')).toBe(true);
    g = toStep(g, 'upkeep', 'bob');
    expect(hasKeyword(g, g.objects[duelist]!, 'first_strike')).toBe(false);
  });

  it('“As long as you control an artifact” is checked continuously', () => {
    const g = setup();
    const engineer = give(g, 'alice', 'Aerial Engineer', 'battlefield');
    expect(chars(g, g.objects[engineer]!)).toMatchObject({ power: 2 });
    expect(hasKeyword(g, g.objects[engineer]!, 'flying')).toBe(false);
    const thopter = give(g, 'alice', 'Ornithopter', 'battlefield');
    expect(chars(g, g.objects[engineer]!)).toMatchObject({ power: 4 });
    expect(hasKeyword(g, g.objects[engineer]!, 'flying')).toBe(true);
    const r = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: thopter, to: 'graveyard' } });
    expect(power(r, r.objects[engineer]!)).toBe(2);
  });

  it('CR 301.5: “as long as ~ is equipped”', () => {
    const g = setup();
    const assailant = give(g, 'alice', 'Armed Assailant', 'battlefield');
    const sword = give(g, 'alice', 'Bonesplitter', 'battlefield');
    expect(power(g, g.objects[assailant]!)).toBe(2);
    g.objects[sword]!.attachedTo = { id: assailant, zcc: g.objects[assailant]!.zcc };
    // +2/+0 from Bonesplitter, +2/+0 and menace from being equipped.
    expect(power(g, g.objects[assailant]!)).toBe(6);
    expect(hasKeyword(g, g.objects[assailant]!, 'menace')).toBe(true);
  });

  it('“As long as enchanted permanent is a creature, it gets +2/+1” — “it” is the enchanted permanent', () => {
    const g = setup();
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    const forest = g.zones.battlefield[0]!;
    const paint = give(g, 'alice', 'Akki War Paint', 'battlefield');
    g.objects[paint]!.attachedTo = { id: bears, zcc: g.objects[bears]!.zcc };
    expect(chars(g, g.objects[bears]!)).toMatchObject({ power: 4, toughness: 3 });
    const torment = give(g, 'alice', 'Clawing Torment', 'battlefield');
    g.objects[torment]!.attachedTo = { id: forest, zcc: g.objects[forest]!.zcc };
    expect(chars(g, g.objects[forest]!).rules.has('cant_block')).toBe(false);
    g.objects[torment]!.attachedTo = { id: bears, zcc: g.objects[bears]!.zcc };
    expect(chars(g, g.objects[bears]!)).toMatchObject({ power: 3, toughness: 2 });
    expect(chars(g, g.objects[bears]!).rules.has('cant_block')).toBe(true);
  });

  it('“as long as ~ is untapped” / “is attacking”', () => {
    let g = setup();
    const raptors = give(g, 'alice', 'Castle Raptors', 'battlefield');
    const vanguard = give(g, 'alice', 'Adanto Vanguard', 'battlefield');
    expect(toughness(g, g.objects[raptors]!)).toBe(5);
    expect(power(g, g.objects[vanguard]!)).toBe(1);
    g = passRound(toStep(g, 'beginning_of_combat'));
    g = act(g, {
      type: 'choose',
      player: 'alice',
      answer: { kind: 'declare_attackers', attacks: [raptors, vanguard].map((attacker) => ({ attacker, target: { kind: 'player', player: 'bob' } })) },
    });
    expect(toughness(g, g.objects[raptors]!)).toBe(3); // tapped by attacking
    expect(power(g, g.objects[vanguard]!)).toBe(3);
  });

  it('CR 702.3b: “can attack as though it didn’t have defender”', () => {
    let g = setup();
    const wall = give(g, 'alice', 'Demon Wall', 'battlefield');
    g = passRound(toStep(g, 'beginning_of_combat'));
    expect(g.pending).toBeNull(); // nothing can attack, so no declaration
    g = toStep(g, 'main1', 'alice');
    g.objects[wall]!.counters['+1/+1'] = 1;
    g = passRound(toStep(g, 'beginning_of_combat'));
    expect(g.pending).toMatchObject({ kind: 'declare_attackers', attackers: [wall] });
  });

  it('a condition that looks at power doesn’t loop, and “another” excludes itself', () => {
    const g = setup();
    const seeker = give(g, 'alice', 'Big Friend Seeker', 'battlefield');
    expect(power(g, g.objects[seeker]!)).toBe(3);
    const other = give(g, 'alice', 'Big Friend Seeker', 'battlefield');
    // Each sees the other at 3 — not 4 or greater.
    expect(power(g, g.objects[other]!)).toBe(3);
    const giant = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g.objects[giant]!.counters['+1/+1'] = 2;
    expect([seeker, other].map((id) => power(g, g.objects[id]!))).toEqual([5, 5]);
  });

  it('“and” joins conditions', () => {
    const g = setup();
    const baron = give(g, 'alice', 'Blood Baron', 'battlefield');
    g.players.alice!.life = 30;
    expect(power(g, g.objects[baron]!)).toBe(4);
    g.players.bob!.life = 10;
    expect(power(g, g.objects[baron]!)).toBe(10);
  });
});

describe('abilities that work from the graveyard (CR 113.6m)', () => {
  it('“{1}: Return this card from your graveyard to your hand.” — only from the graveyard', () => {
    let g = setup();
    const dog = give(g, 'alice', 'Abzan Devotee', 'battlefield');
    expect(illegal(g, { type: 'activate', player: 'alice', object: dog, ability: 0, autoTap: true })).toMatch(/no such ability/);
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: dog, to: 'graveyard' } });
    expect(legalActions(g, 'alice')).toContainEqual(expect.objectContaining({ type: 'activate', object: dog, ability: 0 }));
    g = passRound(act(g, { type: 'activate', player: 'alice', object: dog, ability: 0, autoTap: true }));
    expect(g.objects[dog]!.zone).toBe('hand');
  });

  it('a triggered ability that works from the graveyard', () => {
    let g = setup();
    const speaker = give(g, 'alice', 'Blood Speaker', 'graveyard');
    const demon = give(g, 'alice', 'Lesser Demon', 'hand');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: demon, autoTap: true }));
    expect(g.stack).toMatchObject([{ kind: 'ability', sourceName: 'Blood Speaker' }]);
    g = passRound(g);
    expect(g.objects[speaker]!.zone).toBe('hand');
    // From the battlefield it doesn't trigger.
    const onField = give(g, 'alice', 'Blood Speaker', 'battlefield');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Lesser Demon', 'hand'), autoTap: true }));
    expect(g.stack).toEqual([]);
    expect(g.objects[onField]!.zone).toBe('battlefield');
  });

  it('“Exile this card from your graveyard” as a cost', () => {
    let g = setup();
    const orator = give(g, 'alice', 'Bonebind Orator', 'graveyard');
    const bears = give(g, 'alice', 'Grizzly Bears', 'graveyard');
    g = passRound(act(g, { type: 'activate', player: 'alice', object: orator, ability: 0, autoTap: true, targets: [[{ kind: 'object', object: bears }]] }));
    expect(g.objects[orator]!.zone).toBe('exile');
    expect(g.objects[bears]!.zone).toBe('hand');
  });

  it('“When this creature dies, return this card from your graveyard” is a battlefield ability about the card that died', () => {
    let g = setup();
    const ghost = give(g, 'alice', 'Homing Ghost', 'battlefield');
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: ghost, to: 'graveyard' } });
    g = passRound(g);
    expect(g.objects[ghost]!.zone).toBe('hand');
  });

  it('CR 110.4b: “permanent card” means a card with a permanent type', () => {
    const g = setup();
    const bolt = give(g, 'alice', 'Lightning Bolt', 'graveyard');
    const bears = give(g, 'alice', 'Grizzly Bears', 'graveyard');
    const regrowth = give(g, 'alice', 'Regrowth', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: regrowth, autoTap: true, targets: [[{ kind: 'object', object: bolt }]] })).toMatch(/legal target/);
    const r = passRound(act(g, { type: 'cast', player: 'alice', object: regrowth, autoTap: true, targets: [[{ kind: 'object', object: bears }]] }));
    expect(r.objects[bears]!.zone).toBe('hand');
  });
});

describe('rules changes for players', () => {
  it('CR 402.2: “You have no maximum hand size.”', () => {
    let g = setup();
    for (let i = 0; i < 4; i++) give(g, 'alice', 'Grizzly Bears', 'hand');
    expect(g.zones.hand.alice!.length).toBeGreaterThan(7);
    give(g, 'alice', 'Reliquary Tower', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = toStep(g, 'upkeep', 'bob');
    expect(g.zones.hand.alice!.length).toBe(hand);
  });

  it('CR 305.2a: an additional land each turn', () => {
    let g = setup();
    give(g, 'alice', 'Explorer', 'battlefield');
    g = act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Forest', 'hand') });
    g = act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Forest', 'hand') });
    expect(illegal(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Forest', 'hand') })).toMatch(/already played/);
  });

  it('CR 614.10: “Skip your draw step.”', () => {
    let g = setup();
    give(g, 'alice', 'Null Profusion', 'battlefield');
    g = toStep(g, 'upkeep', 'alice');
    const hand = g.zones.hand.alice!.length;
    g = toStep(g, 'main1', 'alice');
    expect(g.zones.hand.alice!.length).toBe(hand);
  });
});

describe('CR 614.12: lands that check as they enter', () => {
  it('checkland: “enters tapped unless you control a Forest or an Island”', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const first = give(g, 'alice', 'Hinterland Harbor', 'hand');
    g = act(g, { type: 'play_land', player: 'alice', object: first });
    expect(g.objects[first]!.tapped).toBe(true); // it doesn't see itself
    g.players.alice!.landsPlayedThisTurn = 0;
    give(g, 'alice', 'Forest', 'battlefield');
    const second = give(g, 'alice', 'Hinterland Harbor', 'hand');
    g = act(g, { type: 'play_land', player: 'alice', object: second });
    expect(g.objects[second]!.tapped).toBe(false);
  });

  it('fastland: “unless you control two or fewer other lands”', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    give(g, 'alice', 'Forest', 'battlefield');
    give(g, 'alice', 'Forest', 'battlefield');
    const early = give(g, 'alice', 'Botanical Sanctum', 'hand');
    g = act(g, { type: 'play_land', player: 'alice', object: early });
    expect(g.objects[early]!.tapped).toBe(false);
    g.players.alice!.landsPlayedThisTurn = 0;
    const late = give(g, 'alice', 'Botanical Sanctum', 'hand');
    g = act(g, { type: 'play_land', player: 'alice', object: late });
    expect(g.objects[late]!.tapped).toBe(true);
  });
});

describe('CR 614.12: choices made as a permanent enters', () => {
  const answer = (g: GameState, a: object) => act(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', ...a } as never });

  it('shockland: pay 2 life, or it enters tapped', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const paid = give(g, 'alice', 'Shock Pool', 'hand');
    g = act(g, { type: 'play_land', player: 'alice', object: paid });
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'pay_life', amount: 2 });
    expect(g.priority).toBe('alice');
    g = answer(g, { pay: true });
    expect(g.objects[paid]!.tapped).toBe(false);
    expect(g.players.alice!.life).toBe(18);
    g.players.alice!.landsPlayedThisTurn = 0;
    const declined = give(g, 'alice', 'Shock Pool', 'hand');
    g = answer(act(g, { type: 'play_land', player: 'alice', object: declined }), { pay: false });
    expect(g.objects[declined]!.tapped).toBe(true);
    expect(g.players.alice!.life).toBe(18);
    // CR 119.4: not without the life to pay.
    g.players.alice!.landsPlayedThisTurn = 0;
    g.players.alice!.life = 1;
    const broke = act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Shock Pool', 'hand') });
    expect(illegal(broke, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', pay: true } })).toMatch(/life to pay/);
  });

  it('reveal land: only a card that qualifies', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const forest = give(g, 'alice', 'Forest', 'hand');
    const ford = give(g, 'alice', 'Reveal Ford', 'hand');
    g = act(g, { type: 'play_land', player: 'alice', object: ford });
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'reveal' });
    const bears = give(g, 'alice', 'Grizzly Bears', 'hand');
    const candidates = (g.pending as { candidates: string[] }).candidates;
    expect(candidates).toContain(forest);
    expect(candidates.every((id) => /Forest|Island/.test(g.objects[id]!.card))).toBe(true);
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', reveal: bears } })).toMatch(/qualify/);
    g = answer(g, { reveal: forest });
    expect(g.objects[ford]!.tapped).toBe(false);
  });

  it('“choose a color” — remembered for “one mana of the chosen color”', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const grove = give(g, 'alice', 'Thriving Grove', 'hand');
    g = act(g, { type: 'play_land', player: 'alice', object: grove });
    expect(g.objects[grove]!.tapped).toBe(true);
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'color', options: ['W', 'U', 'B', 'R'] });
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'as_enters', choice: 'G' } })).toMatch(/Choose one of/);
    g = answer(g, { choice: 'B' });
    g.objects[grove]!.tapped = false;
    g = act(g, { type: 'activate_mana', player: 'alice', object: grove, ability: 0, choice: 1 });
    expect(g.players.alice!.pool.B).toBe(1);
  });

  it('“choose a creature type” — “creatures you control of the chosen type”', () => {
    let g = setup();
    const elf = give(g, 'alice', 'Llanowar Elves', 'battlefield');
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Kindred Banner', 'hand'), autoTap: true });
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'as_enters', choice: 'creature_type' });
    g = answer(g, { choice: 'Elf' });
    expect([elf, bears].map((id) => power(g, g.objects[id]!))).toEqual([2, 2]);
  });
});
