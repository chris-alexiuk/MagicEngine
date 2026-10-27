import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Blighter', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}, Blight 1: You gain 2 life.' }),
  makeCard({ name: 'Forager', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '{T}, Forage: You gain 3 life.' }),
  makeCard({ name: 'Rite', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'When this enchantment enters, you may blight 1. If you do, you gain 3 life.' }),
  makeCard({ name: 'Spite', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target opponent blights 2.' }),
  makeCard({ name: 'Embrace', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'As an additional cost to cast this spell, blight 1 or pay {3}.\nYou gain 1 life.' }),
  makeCard({ name: 'Squirrel Pal', type_line: 'Creature — Squirrel', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Whenever you forage, put a +1/+1 counter on this creature.\nAt the beginning of combat on your turn, you may forage.' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Ox', type_line: 'Creature — Ox', mana_cost: '{3}', power: '2', toughness: '4', oracle_text: '' }),
  makeCard({ name: 'Snack', type_line: 'Artifact — Food', mana_cost: '{0}', oracle_text: '{2}, {T}, Sacrifice this artifact: You gain 3 life.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 30 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}

describe('blight (CR 701.68) and forage (CR 701.61)', () => {
  it('"{T}, Blight 1": a -1/-1 counter on a creature you control; the toughest by default', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const blighter = give(g, 'alice', 'Blighter', 'battlefield');
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === blighter)).toBe(false);
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const ox = give(g, 'alice', 'Ox', 'battlefield');
    const a = legalActions(g, 'alice').find((x) => x.type === 'activate' && x.object === blighter);
    expect(a).toMatchObject({ costs: { blighted: [ox] } });
    expect(illegal(g, { type: 'activate', player: 'alice', object: blighter, ability: 0 })).toMatch(/blight/);
    g = settle(act(g, { type: 'activate', player: 'alice', object: blighter, ability: 0, costs: { blighted: [bear] } }));
    expect(g.objects[bear]!.counters['-1/-1']).toBe(1);
    expect(g.players.alice!.life).toBe(22);
  });

  it('"you may blight 1. If you do": only with a creature to blight (CR 701.68b)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Rite', 'hand') }));
    expect(g.pending).toBeNull();
    expect(g.players.alice!.life).toBe(20);
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Rite', 'hand') }));
    expect(g.pending).toMatchObject({ kind: 'may' });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    expect(g.objects[bear]!.counters['-1/-1']).toBe(1);
    expect(g.players.alice!.life).toBe(23);
  });

  it('"Target opponent blights 2": they choose the creature', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'bob', 'Bear', 'battlefield');
    const ox = give(g, 'bob', 'Ox', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Spite', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.pending).toMatchObject({ kind: 'choose_objects', player: 'bob', min: 1, max: 1 });
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'choose_objects', objects: [ox] } }));
    expect(g.objects[ox]!.counters['-1/-1']).toBe(2);
  });

  it('"blight 1 or pay {3}"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const embrace = give(g, 'alice', 'Embrace', 'hand');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === embrace)).toBe(false);
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: embrace, extras: ['choice1'], costs: { blighted: [bear] } }));
    expect(g.objects[bear]!.counters['-1/-1']).toBe(1);
    expect(g.players.alice!.life).toBe(21);
  });

  it('forage as a cost: three cards from the graveyard, or a Food', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const forager = give(g, 'alice', 'Forager', 'battlefield');
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === forager)).toBe(false);
    const yard = [give(g, 'alice', 'Bear', 'graveyard'), give(g, 'alice', 'Bear', 'graveyard'), give(g, 'alice', 'Ox', 'graveyard')];
    expect(legalActions(g, 'alice').find((a) => a.type === 'activate' && a.object === forager)).toMatchObject({ costs: { exile: yard } });
    const snack = give(g, 'alice', 'Snack', 'battlefield');
    expect(legalActions(g, 'alice').find((a) => a.type === 'activate' && a.object === forager)).toMatchObject({ costs: { sacrifice: [snack], forageFood: true } });
    expect(illegal(g, { type: 'activate', player: 'alice', object: forager, ability: 0, costs: { exile: yard.slice(0, 2) } })).toMatch(/three cards/);
    g = settle(act(g, { type: 'activate', player: 'alice', object: forager, ability: 0, costs: { exile: yard } }));
    expect(yard.map((id) => g.objects[id]!.zone)).toEqual(['exile', 'exile', 'exile']);
    expect(g.objects[snack]!.zone).toBe('battlefield');
    expect(g.players.alice!.life).toBe(23);
  });

  it('"you may forage" and "Whenever you forage"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const pal = give(g, 'alice', 'Squirrel Pal', 'battlefield');
    const snack = give(g, 'alice', 'Snack', 'battlefield');
    g = toStep(g, 'beginning_of_combat', 'alice');
    for (let i = 0; i < 30 && (g.stack.length || g.pending); i++) {
      if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
      else if (!g.pending) g = act(g, { type: 'pass', player: g.priority! });
      else break;
    }
    expect(g.objects[snack]!.zone).toBe('graveyard');
    expect(g.objects[pal]!.counters['+1/+1']).toBe(1);
  });
});
