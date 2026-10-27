import { describe, expect, it } from 'vitest';
import { type GameState } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{R}', ...extra });

const CARDS = [
  card('Goading Shout', 'Sorcery', 'Goad target creature.'),
  card('Forked Bolt', 'Sorcery', 'This spell deals 3 damage divided as you choose among one, two, or three targets.'),
  card('Victory', 'Sorcery', 'You win the game.'),
  card('Double Clue', 'Sorcery', 'Investigate twice.'),
];
const bob = { kind: 'player' as const, player: 'bob' };
const alice = { kind: 'player' as const, player: 'alice' };
const obj = (object: string) => ({ kind: 'object' as const, object });

function setup(): GameState {
  return toStep(start({ extra: CARDS }), 'main1');
}
const settle = (g: GameState) => {
  while (g.stack.length && !g.pending) g = passRound(g);
  return g;
};

describe('CR 701.15: goad', () => {
  it('a goaded creature attacks each combat if able, until the goader’s next turn', () => {
    let g = setup();
    const theirs = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g.players.alice!.pool.R = 1;
    g = settle(passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Goading Shout', 'hand'), targets: [[obj(theirs)]] })));
    expect(g.objects[theirs]!.goadedBy).toEqual(['alice']);
    g = passRound(toStep(g, 'beginning_of_combat', 'bob'));
    expect(illegal(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [] } })).toMatch(/goaded/);
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: theirs, target: alice }] } });
    g = toStep(g, 'main1', 'alice');
    expect(g.objects[theirs]!.goadedBy).toBeUndefined();
  });
});

describe('CR 601.2d: divided damage', () => {
  it('divided as announced; even by default', () => {
    let g = setup();
    const a = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const b = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g.players.alice!.pool.R = 1;
    const bolt = give(g, 'alice', 'Forked Bolt', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: bolt, targets: [[obj(a), obj(b)]], divide: [3, 0] })).toMatch(/at least 1/);
    g = settle(passRound(act(g, { type: 'cast', player: 'alice', object: bolt, targets: [[obj(a), bob]], divide: [2, 1] })));
    expect(g.objects[a]!.zone).toBe('graveyard');
    expect(g.players.bob!.life).toBe(19);
    g.players.alice!.pool.R = 1;
    g = settle(passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Forked Bolt', 'hand'), targets: [[obj(b), bob, alice]] })));
    expect(g.objects[b]!.damage).toBe(1);
    expect(g.players.bob!.life).toBe(18);
    expect(g.players.alice!.life).toBe(19);
  });
});

describe('repeats and results', () => {
  it('“Investigate twice.”', () => {
    let g = setup();
    g.players.alice!.pool.R = 1;
    g = settle(passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Double Clue', 'hand') })));
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token)).toHaveLength(2);
  });

  it('“You win the game.” (CR 104.2a)', () => {
    let g = setup();
    g.players.alice!.pool.R = 1;
    g = settle(passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Victory', 'hand') })));
    expect(g.players.bob!.lost).toBe(true);
    expect(g.over).toBeTruthy();
  });
});
