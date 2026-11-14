import { apply, costPrompts, legalActions, withCostAnswers, type Action } from '@mtg/engine';
import { describe, expect, it } from 'vitest';
import { needsChoices, openCostPrompts, type Choosing } from './flow';
import { extraCasts } from './probes';
import { card, compiled, scene, soloSetup } from './testkit';

// What pays a cost is the player's choice (CR 601.2h): the table asks, with what the engine says each part of the cost
// takes. Before this the listed action's default went through unasked — the first creature was sacrificed, the first
// cards discarded — and a "discard X cards" spell could only ever be cast with X = 0.

const cards = compiled([
  card('Test Altar', 'Artifact', '{1}', 'Sacrifice a creature: Draw a card.'),
  card('Test Tower', 'Land', '', '{T}, Sacrifice a creature: Add {B}{B}.'),
  card('Test Bear', 'Creature — Bear', '{1}{G}', '', ['2', '2']),
  card('Test Storm', 'Instant', '{G}', 'As an additional cost to cast this spell, discard X cards.\nTest Storm deals X damage to each of X targets.'),
  card('Test Cart', 'Artifact — Vehicle', '{2}', 'Crew 1', ['3', '3']),
]);
const listedFor = (g: ReturnType<typeof scene>['g'], id: string) => legalActions(g, 'p1').filter((a): a is Choosing => (a.type === 'cast' || a.type === 'activate' || a.type === 'activate_mana') && a.object === id);

describe('the table asks what pays a cost', () => {
  it('"Sacrifice a creature" with two creatures: a choice; with one: none', () => {
    const two = scene(soloSetup(['Test Altar', 'Test Bear', 'Test Bear']), cards, ['Test Altar', 'Test Bear', 'Test Bear']);
    const [a] = listedFor(two.g, two.id('Test Altar'));
    expect(needsChoices(two.g, a!)).toBe(true);
    const prompts = openCostPrompts(two.g, a!);
    expect(prompts.map((p) => [p.text, p.candidates.length])).toEqual([['Choose a creature to sacrifice.', 2]]);
    // The second Bear, not the default.
    const second = prompts[0]!.candidates[1]!;
    two.run(withCostAnswers(a!, prompts, [[second]]));
    expect(two.g.objects[second]!.zone).toBe('graveyard');
    expect(two.g.objects[prompts[0]!.candidates[0]!]!.zone).toBe('battlefield');

    const one = scene(soloSetup(['Test Altar', 'Test Bear']), cards, ['Test Altar', 'Test Bear']);
    expect(needsChoices(one.g, listedFor(one.g, one.id('Test Altar'))[0]!)).toBe(false);
  });

  it('a land that sacrifices a creature for mana asks too; a plain land never does', () => {
    const s = scene(soloSetup(['Test Tower', 'Test Bear', 'Test Bear']), cards, ['Test Tower', 'Test Bear', 'Test Bear', 'Forest']);
    const [tower] = listedFor(s.g, s.id('Test Tower'));
    expect(tower!.type).toBe('activate_mana');
    expect(needsChoices(s.g, tower!)).toBe(true);
    const forest = legalActions(s.g, 'p1').find((a) => a.type === 'activate_mana' && s.g.objects[a.object]!.card === 'Forest');
    expect(forest && needsChoices(s.g, forest)).toBe(false);
  });

  it('crewing starts from the engine’s pick and can be changed', () => {
    const s = scene(soloSetup(['Test Cart', 'Test Bear', 'Test Bear']), cards, ['Test Cart', 'Test Bear', 'Test Bear']);
    const [crew] = listedFor(s.g, s.id('Test Cart'));
    const [p] = costPrompts(s.g, crew!);
    expect(p).toMatchObject({ list: 'crew', verb: 'tap', min: 0 });
    expect(p!.chosen).toHaveLength(1);
    expect(needsChoices(s.g, crew!)).toBe(true);
  });
});

describe('"discard X cards" as a cost: each X with its own cards', () => {
  it('the X menu offers every X there are cards for, and the engine takes each', () => {
    const s = scene(soloSetup(['Test Storm']), cards, ['Forest'], ['Test Storm']);
    const id = s.inHand('Test Storm');
    const others = s.g.zones.hand.p1!.filter((x) => x !== id);
    const listed = legalActions(s.g, 'p1');
    // Payable up to every other card in hand…
    expect(listed.find((a) => a.type === 'cast' && a.object === id)).toMatchObject({ x: 0, xMax: others.length });
    // …and offered for as many targets as there are: the two players.
    const options = extraCasts(s.g, 'p1', id, listed) as Extract<Action, { type: 'cast' }>[];
    expect(options.map((a) => a.x)).toEqual([0, 1, 2]);
    for (const a of options) {
      expect(a.costs?.discard ?? []).toHaveLength(a.x ?? 0);
      expect(apply(s.g, a).ok).toBe(true);
    }
    // And at X = 2 the player is asked which two.
    const two = options[2]!;
    expect(needsChoices(s.g, two)).toBe(true);
    expect(openCostPrompts(s.g, two).map((p) => [p.list, p.min, p.max])).toEqual([['discard', 2, 2]]);
  });
});
