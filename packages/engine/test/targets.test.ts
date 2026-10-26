import type { SpellAbility } from '@mtg/schema';
import { describe, expect, it } from 'vitest';
import { legalActions, targetCandidates, type GameState, type Target } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

const mountain = makeCard({ name: 'Mountain', type_line: 'Basic Land — Mountain', oracle_text: '({T}: Add {R}.)' });
const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, string> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{G}', ...extra });

const doomBlade = card('Doom Blade', 'Instant', 'Destroy target nonblack creature.');
const giantGrowth = card('Giant Growth', 'Instant', 'Target creature gets +3/+3 until end of turn.');
const twoShot = card('Twin Bolt', 'Instant', 'Twin Bolt deals 2 damage to each of two target creatures.');
const upTo = card('Scatter', 'Sorcery', "Return up to two target creatures to their owners' hands.");
const charm = card('Test Charm', 'Instant', 'Choose one —\n• Target player draws two cards.\n• Target creature gets -2/-2 until end of turn.');
const oddCharm = card('Odd Charm', 'Instant', 'Choose one —\n• Target player draws two cards.\n• Learn.');
const hexBear = card('Hexproof Bear', 'Creature — Bear', 'Hexproof', { power: '2', toughness: '2' });
const shroudBear = card('Shroud Bear', 'Creature — Bear', 'Shroud', { power: '2', toughness: '2' });
const proBear = card('Pro-Red Bear', 'Creature — Bear', 'Protection from red', { power: '2', toughness: '2' });
const blackBear = makeCard({ name: 'Black Bear', type_line: 'Creature — Bear', mana_cost: '{1}{B}', power: '2', toughness: '2' });
const flashBear = card('Flash Bear', 'Creature — Bear', 'Flash', { power: '2', toughness: '2' });
const stubborn = card('Stubborn Bear', 'Creature — Bear', "Flash\nThis spell can't be countered.", { power: '2', toughness: '2' });
const pacifism = card('Pacifism', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature can’t attack or block.'.replace(/’/g, "'"));
const EXTRA = [mountain, doomBlade, giantGrowth, twoShot, upTo, charm, oddCharm, hexBear, shroudBear, proBear, blackBear, pacifism, flashBear, stubborn];

function setup(): GameState {
  const g = toStep(start({ extra: EXTRA }), 'main1');
  for (let i = 0; i < 3; i++) give(g, 'alice', 'Forest', 'battlefield');
  for (let i = 0; i < 2; i++) give(g, 'alice', 'Mountain', 'battlefield');
  return g;
}

const obj = (object: string): Target => ({ kind: 'object', object });
const player = (p: string): Target => ({ kind: 'player', player: p });

describe('choosing targets (CR 115, CR 601.2c)', () => {
  it('CR 115.4: "any target" means a creature, player, planeswalker or battle', () => {
    let g = setup();
    const bears = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const bolt = give(g, 'alice', 'Lightning Bolt', 'hand');
    const spec = g.cards['Lightning Bolt']!.faces[0]!.abilities[0]!;
    expect(spec).toMatchObject({ kind: 'spell', targets: [{ what: 'any' }] });
    const choices = targetCandidates(g, 'alice', (spec as SpellAbility).targets![0]!, g.objects[bolt]!);
    expect(choices).toContainEqual(player('bob'));
    expect(choices).toContainEqual(obj(bears));
    expect(choices).not.toContainEqual(obj(g.zones.battlefield[0]!)); // a land isn't a legal "any target"

    g = act(g, { type: 'cast', player: 'alice', object: bolt, autoTap: true, targets: [[obj(bears)]] });
    g = passRound(g);
    expect(g.objects[bears]!.zone).toBe('graveyard');
    expect(g.objects[bolt]!.zone).toBe('graveyard');
  });

  it('CR 601.2c: a spell needs its targets chosen, and only legal ones', () => {
    const g = setup();
    const blackBears = give(g, 'bob', 'Black Bear', 'battlefield');
    const blade = give(g, 'alice', 'Doom Blade', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: blade, autoTap: true })).toMatch(/Choose targets: target nonblack creature/);
    expect(illegal(g, { type: 'cast', player: 'alice', object: blade, autoTap: true, targets: [[obj(blackBears)]] })).toMatch(/isn’t a legal target/);
    expect(illegal(g, { type: 'cast', player: 'alice', object: blade, autoTap: true, targets: [[player('bob')]] })).toMatch(/isn’t a legal target/);
    // With no legal target at all, the spell isn't offered.
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === blade)).toBe(false);
  });

  it('CR 115.3: one instance of "target" can’t pick the same creature twice', () => {
    let g = setup();
    const a = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const b = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const spell = give(g, 'alice', 'Twin Bolt', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: spell, autoTap: true, targets: [[obj(a), obj(a)]] })).toMatch(/chosen twice/);
    expect(illegal(g, { type: 'cast', player: 'alice', object: spell, autoTap: true, targets: [[obj(a)]] })).toMatch(/Choose 2/);
    g = act(g, { type: 'cast', player: 'alice', object: spell, autoTap: true, targets: [[obj(a), obj(b)]] });
    g = passRound(g);
    expect([g.objects[a]!.zone, g.objects[b]!.zone]).toEqual(['graveyard', 'graveyard']);
  });

  it('CR 115.6: "up to two" allows fewer, even none', () => {
    let g = setup();
    const a = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const spell = give(g, 'alice', 'Scatter', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: spell, autoTap: true, targets: [[obj(a)]] });
    g = passRound(g);
    expect(g.objects[a]!.zone).toBe('hand');
  });

  it('CR 702.11b: hexproof stops opponents’ spells but not its controller’s', () => {
    const g = setup();
    const theirs = give(g, 'bob', 'Hexproof Bear', 'battlefield');
    const mine = give(g, 'alice', 'Hexproof Bear', 'battlefield');
    const growth = give(g, 'alice', 'Giant Growth', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: growth, autoTap: true, targets: [[obj(theirs)]] })).toMatch(/legal target/);
    act(g, { type: 'cast', player: 'alice', object: growth, autoTap: true, targets: [[obj(mine)]] });
  });

  it('CR 702.18a: shroud stops everyone, its controller too', () => {
    const g = setup();
    const mine = give(g, 'alice', 'Shroud Bear', 'battlefield');
    const growth = give(g, 'alice', 'Giant Growth', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: growth, autoTap: true, targets: [[obj(mine)]] })).toMatch(/legal target/);
  });

  it('CR 702.16b: protection from red can’t be targeted by red spells', () => {
    const g = setup();
    const pro = give(g, 'bob', 'Pro-Red Bear', 'battlefield');
    const bolt = give(g, 'alice', 'Lightning Bolt', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: bolt, autoTap: true, targets: [[obj(pro)]] })).toMatch(/legal target/);
  });

  it('CR 608.2b: if every target is illegal on resolution, the spell doesn’t resolve', () => {
    let g = setup();
    const bears = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const growth = give(g, 'alice', 'Giant Growth', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: growth, autoTap: true, targets: [[obj(bears)]] });
    // Bob's creature leaves before Giant Growth resolves: it's a new object now (CR 400.7).
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: bears, to: 'hand' } });
    const r = passRound(g);
    expect(r.objects[growth]!.zone).toBe('graveyard');
    expect(r.effects).toEqual([]);
  });

  it('CR 701.6a: a countered spell goes to its owner’s graveyard', () => {
    let g = setup();
    const counter = give(g, 'alice', 'Counterspell', 'hand');
    g.cards.Counterspell = { ...g.cards.Counterspell!, faces: [{ ...g.cards.Counterspell!.faces[0]!, manaCost: '{G}' }] };
    const bears = give(g, 'bob', 'Flash Bear', 'hand');
    give(g, 'bob', 'Forest', 'battlefield');
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'cast', player: 'bob', object: bears, autoTap: true });
    g = act(g, { type: 'pass', player: 'bob' });
    g = act(g, { type: 'cast', player: 'alice', object: counter, autoTap: true, targets: [[obj(bears)]] });
    g = passRound(g);
    expect(g.objects[bears]!.zone).toBe('graveyard');
    expect(g.objects[counter]!.zone).toBe('graveyard');
    expect(g.stack).toEqual([]);
  });

  it('CR 101.2: a spell that can’t be countered stays on the stack', () => {
    let g = setup();
    const counter = give(g, 'alice', 'Counterspell', 'hand');
    g.cards.Counterspell = { ...g.cards.Counterspell!, faces: [{ ...g.cards.Counterspell!.faces[0]!, manaCost: '{G}' }] };
    const bear = give(g, 'bob', 'Stubborn Bear', 'hand');
    give(g, 'bob', 'Forest', 'battlefield');
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'cast', player: 'bob', object: bear, autoTap: true });
    g = act(g, { type: 'pass', player: 'bob' });
    g = act(g, { type: 'cast', player: 'alice', object: counter, autoTap: true, targets: [[obj(bear)]] });
    g = passRound(g);
    expect(g.objects[bear]!.zone).toBe('stack');
    g = passRound(g);
    expect(g.objects[bear]!.zone).toBe('battlefield');
  });

  it('CR 700.2: a modal spell uses the chosen mode and that mode’s targets', () => {
    let g = setup();
    const bears = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const spell = give(g, 'alice', 'Test Charm', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: spell, autoTap: true, targets: [] })).toMatch(/Choose 1 mode/);
    expect(illegal(g, { type: 'cast', player: 'alice', object: spell, autoTap: true, modes: [0, 1], targets: [[], []] })).toMatch(/mode/);
    g = act(g, { type: 'cast', player: 'alice', object: spell, autoTap: true, modes: [1], targets: [[obj(bears)]] });
    g = passRound(g);
    expect(g.objects[bears]!.zone).toBe('graveyard');
    const hand = g.zones.hand.alice!.length;
    const second = give(g, 'alice', 'Test Charm', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: second, autoTap: true, modes: [0], targets: [[player('alice')]] });
    g = passRound(g);
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
  });
});

describe('modes the compiler can’t read', () => {
  it('the readable mode runs; the other one is resolved by hand', () => {
    let g = setup();
    const hand = g.zones.hand.alice!.length;
    g = passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Odd Charm', 'hand'), autoTap: true, modes: [0], targets: [[player('alice')]] }));
    expect(g.zones.hand.alice!.length).toBe(hand + 2);
    g = passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Odd Charm', 'hand'), autoTap: true, modes: [1], targets: [] }));
    expect(g.pending).toMatchObject({ kind: 'manual_resolution', sourceName: 'Odd Charm' });
  });

  it('the default choice prefers modes the engine runs', () => {
    const g = setup();
    const charm = give(g, 'alice', 'Odd Charm', 'hand');
    expect(legalActions(g, 'alice')).toContainEqual(expect.objectContaining({ type: 'cast', object: charm, modes: [0] }));
  });
});

describe('Auras (CR 303.4)', () => {
  it('CR 303.4a / CR 608.3c: an Aura spell targets what it will enchant and enters attached to it', () => {
    let g = setup();
    const bears = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const aura = give(g, 'alice', 'Pacifism', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: aura, autoTap: true })).toMatch(/Choose targets/);
    g = act(g, { type: 'cast', player: 'alice', object: aura, autoTap: true, targets: [[obj(bears)]] });
    g = passRound(g);
    expect(g.objects[aura]).toMatchObject({ zone: 'battlefield', attachedTo: { id: bears } });
  });

  it('CR 704.5m: an Aura whose creature leaves goes to the graveyard', () => {
    let g = setup();
    const bears = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const aura = give(g, 'alice', 'Pacifism', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: aura, autoTap: true, targets: [[obj(bears)]] });
    g = passRound(g);
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: bears, to: 'hand' } });
    expect(g.objects[aura]!.zone).toBe('graveyard');
  });

  it('CR 608.3b: an Aura spell whose target is gone doesn’t resolve', () => {
    let g = setup();
    const bears = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const aura = give(g, 'alice', 'Pacifism', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: aura, autoTap: true, targets: [[obj(bears)]] });
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: bears, to: 'hand' } });
    g = passRound(g);
    expect(g.objects[aura]!.zone).toBe('graveyard');
  });
});
