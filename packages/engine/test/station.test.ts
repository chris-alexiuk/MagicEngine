import { describe, expect, it } from 'vitest';
import { hasKeyword, hasType, legalActions, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({
    name: 'Greenhouse Lite',
    type_line: 'Artifact — Spacecraft',
    oracle_text: "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 8+.)\n8+ | Flying, trample",
    mana_cost: '{4}',
    power: '5',
    toughness: '5',
  }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', oracle_text: '', mana_cost: '{3}', power: '4', toughness: '4' }),
];

function setup(): GameState {
  return toStep(start({ extra: CARDS }), 'main1');
}

describe('CR 702.184 / 721: station', () => {
  it('tapping a creature puts its power in charge counters; at 8+ it is an artifact creature with its abilities', () => {
    let g = setup();
    const ship = give(g, 'alice', 'Greenhouse Lite', 'battlefield');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    expect(hasType(g, g.objects[ship]!, 'Creature')).toBe(false);
    const station = legalActions(g, 'alice').find((a) => a.type === 'activate' && a.object === ship);
    expect(station).toMatchObject({ costs: { crew: [ogre] } });
    g = act(g, station!);
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.objects[ship]!.counters.charge).toBe(4);
    expect(g.objects[ogre]!.tapped).toBe(true);
    expect(hasType(g, g.objects[ship]!, 'Creature')).toBe(false);
    g.objects[ogre]!.tapped = false;
    g = act(g, { type: 'activate', player: 'alice', object: ship, ability: 0, costs: { crew: [ogre] } });
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'pass', player: 'bob' });
    expect(g.objects[ship]!.counters.charge).toBe(8);
    expect(hasType(g, g.objects[ship]!, 'Creature')).toBe(true);
    expect(hasKeyword(g, g.objects[ship]!, 'flying')).toBe(true);
    expect(hasKeyword(g, g.objects[ship]!, 'trample')).toBe(true);
  });
});
