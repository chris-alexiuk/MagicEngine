import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId } from '../src/index.js';
import { legalActions } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

/**
 * One description of what a spell targets (schema TargetsFilter, targets-filter.ts) for every ability that names a spell
 * so: a trigger on casting it, what it costs. (Flash "if it targets …": offered-accepted.test.ts, staples-185.)
 */
const card = (name: string, type_line: string, oracle_text: string, more: Record<string, string> = {}) => makeCard({ name, type_line, oracle_text, mana_cost: '{0}', ...more });
const CARDS = [
  card('Zap', 'Instant', 'Zap deals 1 damage to any target.'),
  card('Pounce', 'Instant', 'This spell costs {2} less to cast if it targets a tapped creature.\nDestroy target creature.', { mana_cost: '{2}' }),
  card('Hero', 'Creature — Human Soldier', 'Whenever you cast a spell that targets this creature, put a +1/+1 counter on this creature.', { power: '1', toughness: '3' }),
  card('Grudge', 'Enchantment', 'Whenever an opponent casts a spell that targets you or a creature you control, you gain 1 life.'),
  card('Siege', 'Enchantment', 'Spells your opponents cast that target you or a permanent you control cost {2} more to cast.'),
];
const board = (player: PlayerId = 'alice'): GameState => toStep(start({ extra: CARDS }), 'main1', player);
const settle = (g: GameState): GameState => {
  for (let i = 0; i < 20 && g.stack.length && !g.pending; i++) g = passRound(g);
  return g;
};
const at = (g: GameState, target: string) => [[g.players[target] ? { kind: 'player' as const, player: target } : { kind: 'object' as const, object: target }]];
const zap = (g: GameState, player: PlayerId, target: string): GameState => settle(act(g, { type: 'cast', player, object: give(g, player, 'Zap', 'hand'), autoTap: true, targets: at(g, target) }));

describe('what a spell targets', () => {
  it('"that targets this creature": the permanent with the ability, and no other', () => {
    let g = board();
    const hero = give(g, 'alice', 'Hero', 'battlefield');
    const other = give(g, 'alice', 'Hero', 'battlefield');
    g = zap(g, 'alice', hero);
    expect([g.objects[hero]!.counters['+1/+1'] ?? 0, g.objects[other]!.counters['+1/+1'] ?? 0]).toEqual([1, 0]);
    // A spell that targets a player isn't one that targets it.
    g = zap(g, 'alice', 'bob');
    expect(g.objects[hero]!.counters['+1/+1']).toBe(1);
  });

  it('"that targets you or a creature you control": the player with the ability, or such a creature — not the caster\'s own', () => {
    let g = board('bob');
    give(g, 'alice', 'Grudge', 'battlefield');
    const mine = give(g, 'alice', 'Hero', 'battlefield');
    const theirs = give(g, 'bob', 'Hero', 'battlefield');
    g = zap(g, 'bob', 'alice');
    expect(g.players.alice!.life).toBe(20);
    g = zap(g, 'bob', mine);
    expect(g.players.alice!.life).toBe(21);
    g = zap(g, 'bob', theirs);
    g = zap(g, 'bob', 'bob');
    expect(g.players.alice!.life).toBe(21);
  });

  it('a cost: {2} more for a spell that targets you or a permanent you control; {2} less if it targets a tapped creature', () => {
    let g = board('bob');
    give(g, 'alice', 'Siege', 'battlefield');
    const mine = give(g, 'alice', 'Hero', 'battlefield');
    const bolt = give(g, 'bob', 'Zap', 'hand');
    const cast = (target: string) => ({ type: 'cast' as const, player: 'bob', object: bolt, autoTap: true, targets: at(g, target) });
    // Bob has no lands: free at himself, {2} at Alice or her creature.
    expect(illegal(g, cast('alice'))).toMatch(/pay|mana|afford/i);
    expect(illegal(g, cast(mine))).toMatch(/pay|mana|afford/i);
    const lands = [give(g, 'bob', 'Forest', 'battlefield'), give(g, 'bob', 'Forest', 'battlefield')];
    g = settle(act(g, cast(mine)));
    expect(g.objects[mine]!.damage).toBe(1);
    expect(lands.every((id) => g.objects[id]!.tapped)).toBe(true);
    // At himself it costs nothing more.
    g = zap(g, 'bob', 'bob');
    expect(g.players.bob!.life).toBe(19);

    let h = board();
    const bear = give(h, 'bob', 'Grizzly Bears', 'battlefield');
    const pounce = give(h, 'alice', 'Pounce', 'hand');
    const castable = (game: GameState) => legalActions(game, 'alice').some((a) => a.type === 'cast' && a.object === pounce);
    expect(castable(h)).toBe(false);
    h.objects[bear]!.tapped = true;
    expect(castable(h)).toBe(true);
    h = settle(act(h, { type: 'cast', player: 'alice', object: pounce, targets: at(h, bear) }));
    expect(h.objects[bear]!.zone).toBe('graveyard');
  });
});
