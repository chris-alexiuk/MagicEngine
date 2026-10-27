import { describe, expect, it } from 'vitest';
import { power, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{0}', cmc: 0, ...extra });
const creature = (name: string, oracle = '', p = '1', t = '1') => card(name, 'Creature — Human', oracle, { power: p, toughness: t });

const CARDS = [
  creature('Delirious', 'Delirium — This creature gets +2/+2 as long as there are four or more card types among cards in your graveyard.'),
  card('Domain Pump', 'Instant', 'Target creature gets +1/+1 until end of turn for each basic land type among lands you control.'),
  creature('Corrupt', 'Corrupted — As long as an opponent has three or more poison counters, this creature gets +2/+2.'),
  creature('Coven Lady', 'Coven — At the beginning of combat on your turn, if you control three or more creatures with different powers, you gain 3 life.'),
  creature('Revolter', 'Revolt — When this creature enters, if a permanent you controlled left the battlefield this turn, you gain 2 life.'),
  creature('Formidable', 'Formidable — {0}: This creature gets +1/+1 until end of turn. Activate only if creatures you control have total power 8 or greater.'),
  creature('Celebrant', 'Celebration — At the beginning of combat on your turn, if two or more nonland permanents entered the battlefield under your control this turn, you gain 4 life.'),
  creature('Descender', 'Descend 4 — This creature gets +2/+2 as long as there are four or more permanent cards in your graveyard.'),
  creature('Valiant One', 'Valiant — Whenever this creature becomes the target of a spell or ability you control for the first time each turn, you gain 1 life.'),
  card('Pump', 'Instant', 'Target creature gets +1/+0 until end of turn.'),
  creature('Bear', '', '2', '2'),
  creature('Ogre', '', '3', '3'),
  creature('Giant', '', '6', '6'),
  card('Rock', 'Artifact', ''),
  card('Ember', 'Instant', ''),
  card('Spark', 'Sorcery', ''),
  card('Sac Outlet', 'Artifact', 'Sacrifice an artifact: You gain 0 life.'),
  card('Plains Land', 'Land — Plains', ''),
  card('Island Land', 'Land — Island', ''),
];

const cast = (g: GameState, name: string, extra: Record<string, unknown> = {}) => {
  g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), ...extra } as never);
  while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
  return g;
};
const setup = () => toStep(start({ extra: CARDS }), 'main1');
const life = (g: GameState) => g.players.alice!.life;

describe('ability words: the conditions and counts behind them', () => {
  it('delirium (card types in your graveyard), descend (permanent cards in your graveyard)', () => {
    const g = setup();
    const d = give(g, 'alice', 'Delirious', 'battlefield');
    const s = give(g, 'alice', 'Descender', 'battlefield');
    for (const n of ['Rock', 'Ember', 'Spark']) give(g, 'alice', n, 'graveyard');
    expect(power(g, g.objects[d]!)).toBe(1);
    give(g, 'alice', 'Bear', 'graveyard');
    expect(power(g, g.objects[d]!)).toBe(3);
    // Rock and Bear are permanent cards: two of four.
    expect(power(g, g.objects[s]!)).toBe(1);
    give(g, 'alice', 'Ogre', 'graveyard');
    give(g, 'alice', 'Rock', 'graveyard');
    expect(power(g, g.objects[s]!)).toBe(3);
  });

  it('domain counts basic land types among lands you control', () => {
    let g = setup();
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    for (const n of ['Plains Land', 'Island Land', 'Island Land']) give(g, 'alice', n, 'battlefield');
    g = cast(g, 'Domain Pump', { targets: [[{ kind: 'object', object: bear }]] });
    expect(power(g, g.objects[bear]!)).toBe(4);
  });

  it('corrupted (an opponent with three or more poison counters)', () => {
    const g = setup();
    const c = give(g, 'alice', 'Corrupt', 'battlefield');
    g.players.bob!.poison = 2;
    expect(power(g, g.objects[c]!)).toBe(1);
    g.players.bob!.poison = 3;
    expect(power(g, g.objects[c]!)).toBe(3);
  });

  it('coven (three different powers) and celebration (two nonland permanents entered this turn)', () => {
    let g = setup();
    give(g, 'alice', 'Coven Lady', 'battlefield');
    give(g, 'alice', 'Bear', 'battlefield');
    g = cast(g, 'Celebrant');
    g = toStep(g, 'beginning_of_combat');
    while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
    // Powers 1, 2, 1: no coven. Only Celebrant entered (give() isn't entering): no celebration.
    expect(life(g)).toBe(20);
    g = toStep(g, 'main1', 'alice');
    give(g, 'alice', 'Ogre', 'battlefield');
    g = cast(g, 'Bear');
    g = cast(g, 'Rock');
    g = toStep(g, 'beginning_of_combat');
    while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
    expect(life(g)).toBe(27);
  });

  it('revolt (a permanent you controlled left the battlefield this turn)', () => {
    let g = setup();
    g = cast(g, 'Revolter');
    expect(life(g)).toBe(20);
    const rock = give(g, 'alice', 'Rock', 'battlefield');
    const outlet = give(g, 'alice', 'Sac Outlet', 'battlefield');
    g = act(g, { type: 'activate', player: 'alice', object: outlet, ability: 0, costs: { sacrifice: [rock] } } as never);
    while (g.stack.length) g = act(g, { type: 'pass', player: g.priority! });
    g = cast(g, 'Revolter');
    expect(life(g)).toBe(22);
  });

  it('formidable (total power 8 or greater) gates an activation', () => {
    const g = setup();
    const f = give(g, 'alice', 'Formidable', 'battlefield');
    expect(() => act(g, { type: 'activate', player: 'alice', object: f, ability: 0 })).toThrow();
    give(g, 'alice', 'Giant', 'battlefield');
    give(g, 'alice', 'Bear', 'battlefield');
    expect(() => act(g, { type: 'activate', player: 'alice', object: f, ability: 0 })).not.toThrow();
  });

  it('valiant: the first time each turn you target it', () => {
    let g = setup();
    const v = give(g, 'alice', 'Valiant One', 'battlefield');
    g = cast(g, 'Pump', { targets: [[{ kind: 'object', object: v }]] });
    g = cast(g, 'Pump', { targets: [[{ kind: 'object', object: v }]] });
    expect(life(g)).toBe(21);
  });
});
