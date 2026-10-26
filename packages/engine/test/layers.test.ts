import { describe, expect, it } from 'vitest';
import { activatedAbilities, chars, hasKeyword, power, toughness, type GameState, type Target } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

const make = (name: string, type_line: string, oracle_text: string, pt?: string) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{G}', ...(pt ? { power: pt, toughness: pt } : {}) });

const CARDS = [
  make('Glorious Anthem', 'Enchantment', 'Creatures you control get +1/+1.'),
  make('Elf Lord', 'Creature — Elf', 'Other Elf creatures you control get +1/+1.', '2'),
  make('War Drums', 'Enchantment', 'Creatures you control have haste.'),
  make('Wall of Thorns', 'Creature — Wall', "This creature can't block.", '2'),
  make('Berserker', 'Creature — Human Berserker', 'This creature attacks each combat if able.', '2'),
  make('Sleepy Giant', 'Creature — Giant', "This creature doesn't untap during your untap step.", '4'),
  make('Pacifism', 'Enchantment — Aura', "Enchant creature\nEnchanted creature can't attack or block."),
  make('Holy Strength', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+2 and has vigilance.'),
  make('Blood Tithe', 'Creature — Vampire', '{T}, Pay 2 life: Draw a card. Activate only once each turn.', '1'),
  make('Sacrificial Imp', 'Creature — Imp', 'Sacrifice this creature: Target player loses 2 life.', '1'),
];

function setup(): GameState {
  const g = toStep(start({ extra: CARDS }), 'main1');
  for (let i = 0; i < 4; i++) give(g, 'alice', 'Forest', 'battlefield');
  return g;
}
const obj = (object: string): Target => ({ kind: 'object', object });

describe('static abilities and layers (CR 611.3, CR 613)', () => {
  it('CR 611.3a: an anthem isn’t locked in — it covers creatures that arrive later, and stops when it leaves', () => {
    const g = setup();
    const anthem = give(g, 'alice', 'Glorious Anthem', 'battlefield');
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    const theirs = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    expect(power(g, g.objects[bears]!)).toBe(3);
    expect(power(g, g.objects[theirs]!)).toBe(2);
    const later = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    expect(toughness(g, g.objects[later]!)).toBe(3);
    const r = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: anthem, to: 'graveyard' } });
    expect(power(r, r.objects[bears]!)).toBe(2);
  });

  it('“Other Elf creatures you control”: not itself, not other types, not opponents’', () => {
    const g = setup();
    const lord = give(g, 'alice', 'Elf Lord', 'battlefield');
    const elves = give(g, 'alice', 'Llanowar Elves', 'battlefield');
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    const theirElves = give(g, 'bob', 'Llanowar Elves', 'battlefield');
    expect([lord, elves, bears, theirElves].map((id) => power(g, g.objects[id]!))).toEqual([2, 2, 2, 1]);
  });

  it('CR 613.4c: P/T changes from effects and counters add up in layer 7c', () => {
    let g = setup();
    give(g, 'alice', 'Glorious Anthem', 'battlefield');
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g.objects[bears]!.counters['+1/+1'] = 2;
    g.objects[bears]!.counters['-1/-1'] = 1;
    expect(chars(g, g.objects[bears]!)).toMatchObject({ power: 4, toughness: 4 });
    // CR 704.5q: the counters then annihilate in pairs, which doesn't change the total.
    g = act(g, { type: 'pass', player: 'alice' });
    expect(g.objects[bears]!.counters).toEqual({ '+1/+1': 1, '-1/-1': 0 });
    expect(power(g, g.objects[bears]!)).toBe(4);
  });

  it('CR 613.1f: an ability-granting static lets a new creature attack (haste)', () => {
    let g = setup();
    give(g, 'alice', 'War Drums', 'battlefield');
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield', { sick: true });
    expect(hasKeyword(g, g.objects[bears]!, 'haste')).toBe(true);
    g = passRound(toStep(g, 'beginning_of_combat'));
    expect(g.pending).toMatchObject({ kind: 'declare_attackers', attackers: [bears] });
  });

  it('"can\'t block" removes a creature from the blockers', () => {
    let g = setup();
    const attacker = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    give(g, 'bob', 'Wall of Thorns', 'battlefield');
    const bears = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = passRound(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker, target: { kind: 'player', player: 'bob' } }] } });
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'declare_blockers', blockers: [bears] });
  });

  it('CR 508.1d: a creature that attacks each combat if able must be declared', () => {
    let g = setup();
    const berserker = give(g, 'alice', 'Berserker', 'battlefield');
    g = passRound(toStep(g, 'beginning_of_combat'));
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [] } })).toMatch(/attacks each combat/);
    act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: berserker, target: { kind: 'player', player: 'bob' } }] } });
  });

  it('CR 502.3: a permanent that "doesn’t untap" stays tapped in the untap step', () => {
    let g = setup();
    const giant = give(g, 'alice', 'Sleepy Giant', 'battlefield');
    g.objects[giant]!.tapped = true;
    g = toStep(g, 'upkeep', 'alice');
    expect(g.objects[giant]!.tapped).toBe(true);
  });

  it('an Aura’s static ability applies to the creature it enchants', () => {
    let g = setup();
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    const aura = give(g, 'alice', 'Holy Strength', 'hand');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: aura, autoTap: true, targets: [[obj(bears)]] }));
    expect(chars(g, g.objects[bears]!)).toMatchObject({ power: 3, toughness: 4 });
    expect(hasKeyword(g, g.objects[bears]!, 'vigilance')).toBe(true);
  });

  it('Pacifism: the enchanted creature can’t attack', () => {
    let g = setup();
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    const other = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    const aura = give(g, 'alice', 'Pacifism', 'hand');
    g = passRound(act(g, { type: 'cast', player: 'alice', object: aura, autoTap: true, targets: [[obj(bears)]] }));
    g = passRound(toStep(g, 'beginning_of_combat'));
    expect(g.pending).toMatchObject({ kind: 'declare_attackers', attackers: [other] });
  });
});

describe('Equipment (CR 301.5, CR 702.6)', () => {
  it('CR 702.6a: equip attaches to a creature you control, as a sorcery; the bonus follows it', () => {
    let g = setup();
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    const theirs = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const sword = give(g, 'alice', 'Bonesplitter', 'battlefield');
    expect(activatedAbilities(g, g.objects[sword]!).map((a) => a.text)).toEqual(['Equip {1}']);
    expect(illegal(g, { type: 'activate', player: 'alice', object: sword, ability: 0, autoTap: true, targets: [[obj(theirs)]] })).toMatch(/legal target/);
    g = act(g, { type: 'activate', player: 'alice', object: sword, ability: 0, autoTap: true, targets: [[obj(bears)]] });
    expect(g.stack).toMatchObject([{ kind: 'ability', text: 'Equip {1}' }]);
    // Sorcery timing: not while something is on the stack.
    expect(illegal(g, { type: 'activate', player: 'alice', object: sword, ability: 0, autoTap: true, targets: [[obj(bears)]] })).toMatch(/as a sorcery/);
    g = passRound(g);
    expect(g.objects[sword]!.attachedTo).toEqual({ id: bears, zcc: g.objects[bears]!.zcc });
    expect(power(g, g.objects[bears]!)).toBe(4);
  });

  it('CR 704.5n: an Equipment whose creature leaves becomes unattached and stays', () => {
    let g = setup();
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    const sword = give(g, 'alice', 'Bonesplitter', 'battlefield');
    g = passRound(act(g, { type: 'activate', player: 'alice', object: sword, ability: 0, autoTap: true, targets: [[obj(bears)]] }));
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: bears, to: 'hand' } });
    expect(g.objects[sword]).toMatchObject({ zone: 'battlefield' });
    expect(g.objects[sword]!.attachedTo).toBeUndefined();
  });
});

describe('activated abilities (CR 602)', () => {
  it('CR 119.4 / CR 602.2: costs with life payments, once each turn', () => {
    let g = setup();
    const vamp = give(g, 'alice', 'Blood Tithe', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'activate', player: 'alice', object: vamp, ability: 0 });
    expect(g.players.alice!.life).toBe(18);
    g = passRound(g);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
    g.objects[vamp]!.tapped = false;
    expect(illegal(g, { type: 'activate', player: 'alice', object: vamp, ability: 0 })).toMatch(/once each turn/);
    g.players.alice!.life = 1;
    g.turn++;
    expect(illegal(g, { type: 'activate', player: 'alice', object: vamp, ability: 0 })).toMatch(/2 life/);
  });

  it('CR 701.21a: a sacrifice cost; the ability resolves without its source', () => {
    let g = setup();
    const imp = give(g, 'alice', 'Sacrificial Imp', 'battlefield');
    g = act(g, { type: 'activate', player: 'alice', object: imp, ability: 0, targets: [[{ kind: 'player', player: 'bob' }]] });
    expect(g.objects[imp]!.zone).toBe('graveyard');
    g = passRound(g);
    expect(g.players.bob!.life).toBe(18);
  });

  it('CR 606.3 / CR 606.4: a compiled loyalty ability', () => {
    let g = setup();
    const jace = give(g, 'alice', 'Jace, the Mind Sculptor', 'battlefield');
    g.objects[jace]!.counters.loyalty = 3;
    const bears = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    // "−1: Return target creature to its owner's hand."
    g = act(g, { type: 'activate', player: 'alice', object: jace, ability: 0, targets: [[obj(bears)]] });
    expect(g.objects[jace]!.counters.loyalty).toBe(2);
    g = passRound(g);
    expect(g.objects[bears]!.zone).toBe('hand');
    expect(illegal(g, { type: 'activate', player: 'alice', object: jace, ability: 0, targets: [[]] })).toMatch(/already activated/);
  });
});
