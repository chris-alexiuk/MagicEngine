import { describe, expect, it } from 'vitest';
import { legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';
import { hasKeyword } from '../src/index.js';

const CARDS = [
  makeCard({ name: 'Amber', type_line: 'Legendary Artifact', mana_cost: '{0}', oracle_text: '{T}: Add one mana of any color among legendary creatures and planeswalkers you control.' }),
  makeCard({ name: 'Blue Legend', type_line: 'Legendary Creature — Human Wizard', mana_cost: '{U}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Tender', type_line: 'Creature — Elf Druid', mana_cost: '{G}', power: '1', toughness: '1', oracle_text: 'Vivid — {T}: For each color among permanents you control, add one mana of that color.' }),
  makeCard({ name: 'Reservoir', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "Whenever you cast a spell, you gain 1 life for each spell you've cast this turn." }),
  makeCard({ name: 'Ping', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'You gain 1 life.' }),
  makeCard({ name: 'Blue Ping', type_line: 'Instant', mana_cost: '{U}', oracle_text: 'You gain 1 life.' }),
  makeCard({ name: 'Grounding', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Target creature loses flying until end of turn.' }),
  makeCard({ name: 'Bird', type_line: 'Creature — Bird', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Flying' }),
  makeCard({ name: 'Clip Wings', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Creatures your opponents control lose flying.' }),
  makeCard({ name: 'Taunt', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Target creature attacks this turn if able.' }),
  makeCard({ name: 'Blast', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Counter target spell if it's blue." }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 30 && g.stack.length; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}

describe('staples (slices 120–121)', () => {
  it('Mox Amber: only colors among legendary creatures and planeswalkers you control', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const amber = give(g, 'alice', 'Amber', 'battlefield');
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate_mana' && a.object === amber)).toBe(false);
    give(g, 'alice', 'Blue Legend', 'battlefield');
    const choices = legalActions(g, 'alice').filter((a) => a.type === 'activate_mana' && a.object === amber).map((a) => (a as { choice?: unknown }).choice);
    expect(choices).toEqual(['U']);
  });

  it('Bloom Tender: one mana of each color among permanents you control', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const tender = give(g, 'alice', 'Tender', 'battlefield', { sick: false });
    give(g, 'alice', 'Blue Legend', 'battlefield');
    const r = act(g, { type: 'activate_mana', player: 'alice', object: tender, ability: 0 });
    expect(r.players.alice!.pool).toMatchObject({ G: 1, U: 1 });
  });

  it('Aetherflux Reservoir counts the spells cast this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Reservoir', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ping', 'hand') }));
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ping', 'hand') }));
    // 1 + 1 (Pings) + 1 + 2 (Reservoir)
    expect(g.players.alice!.life).toBe(25);
  });

  it('Pyroblast: "Counter target spell if it\'s blue."', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g.players.alice!.pool.U = 1;
    const blue = give(g, 'alice', 'Blue Ping', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: blue });
    g = act(g, { type: 'pass', player: 'alice' });
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Blast', 'hand'), targets: [[{ kind: 'object', object: blue }]] }));
    expect(g.objects[blue]!.zone).toBe('graveyard');
    expect(g.players.alice!.life).toBe(20);
    const ping = give(g, 'alice', 'Ping', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: ping });
    g = act(g, { type: 'pass', player: 'alice' });
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Blast', 'hand'), targets: [[{ kind: 'object', object: ping }]] }));
    expect(g.players.alice!.life).toBe(21);
  });

  it('layer 6 keyword loss: "loses flying until end of turn", "Creatures your opponents control lose flying"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bird = give(g, 'bob', 'Bird', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Grounding', 'hand'), targets: [[{ kind: 'object', object: bird }]] }));
    expect(hasKeyword(g, g.objects[bird]!, 'flying')).toBe(false);
    g = toStep(g, 'main1', 'bob');
    expect(hasKeyword(g, g.objects[bird]!, 'flying')).toBe(true);
    give(g, 'alice', 'Clip Wings', 'battlefield');
    expect(hasKeyword(g, g.objects[bird]!, 'flying')).toBe(false);
    const mine = give(g, 'alice', 'Bird', 'battlefield');
    expect(hasKeyword(g, g.objects[mine]!, 'flying')).toBe(true);
  });

  it('"Target creature attacks this turn if able."', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const bird = give(g, 'bob', 'Bird', 'battlefield', { sick: false });
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Taunt', 'hand'), targets: [[{ kind: 'object', object: bird }]] }));
    for (let i = 0; i < 10 && g.pending?.kind !== 'declare_attackers'; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [] } })).toMatch(/attacks each combat/);
  });
});
