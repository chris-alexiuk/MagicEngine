import { describe, expect, it } from 'vitest';
import { power, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{1}', ...extra });

const CARDS = [
  card('Champion Lite', 'Creature — Human Warrior', 'You may exert this creature as it attacks. When you do, it gets +2/+2 until end of turn.', { power: '2', toughness: '2' }),
  card('Boggart Lite', 'Creature — Goblin', 'When this creature enters, clash with an opponent. If you win, put a +1/+1 counter on this creature.', { power: '2', toughness: '2' }),
  card('Big Spell', 'Sorcery', '', { mana_cost: '{7}', cmc: 7 }),
  card('Tiny Spell', 'Sorcery', '', { mana_cost: '{0}', cmc: 0 }),
];

function setup(): GameState {
  const g = toStep(start({ extra: CARDS }), 'main1');
  g.players.alice!.pool = { W: 0, U: 0, B: 0, R: 5, G: 5, C: 5 };
  return g;
}
function settle(g: GameState): GameState {
  for (let i = 0; i < 40 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
function toAttack(g: GameState): GameState {
  g = toStep(g, 'beginning_of_combat');
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return g;
}
const bob = { kind: 'player' as const, player: 'bob' };

describe('CR 701.43: exert', () => {
  it('exerting is chosen with the attackers; the linked trigger fires; it skips the next untap step', () => {
    let g = setup();
    const champ = give(g, 'alice', 'Champion Lite', 'battlefield');
    g = toAttack(g);
    expect(g.pending).toMatchObject({ kind: 'declare_attackers', exertable: [champ] });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: champ, target: bob }], exert: [champ] } });
    g = settle(g);
    expect(power(g, g.objects[champ]!)).toBe(4);
    // Through bob's turn and back to alice's: it stays tapped this once.
    g = toStep(g, 'upkeep', 'bob');
    g = toStep(g, 'upkeep', 'alice');
    expect(g.objects[champ]!.tapped).toBe(true);
    g = toStep(g, 'upkeep', 'bob');
    g = toStep(g, 'upkeep', 'alice');
    expect(g.objects[champ]!.tapped).toBe(false);
  });

  it('not exerting: no trigger, it untaps as usual', () => {
    let g = setup();
    const champ = give(g, 'alice', 'Champion Lite', 'battlefield');
    g = toAttack(g);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: champ, target: bob }] } });
    g = settle(g);
    expect(power(g, g.objects[champ]!)).toBe(2);
    g = toStep(g, 'upkeep', 'bob');
    g = toStep(g, 'upkeep', 'alice');
    expect(g.objects[champ]!.tapped).toBe(false);
  });

  it('only an attacker can be exerted', () => {
    let g = setup();
    const champ = give(g, 'alice', 'Champion Lite', 'battlefield');
    g = toAttack(g);
    expect(() => act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [], exert: [champ] } })).toThrow(/attacking/);
  });
});

describe('CR 701.30: clash', () => {
  const clashWith = (mine: string, theirs: string, keepBoth = true) => {
    let g = setup();
    give(g, 'alice', mine, 'library');
    give(g, 'bob', theirs, 'library');
    // give() appends; put them on top.
    for (const p of ['alice', 'bob']) {
      const lib = g.zones.library[p]!;
      lib.unshift(lib.pop()!);
    }
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Boggart Lite', 'hand') });
    g = settle(g);
    // The trigger: alice, then bob, decide whether their revealed card goes to the bottom (APNAP).
    const asked: string[] = [];
    while (g.pending?.kind === 'may' || g.stack.length) {
      if (g.pending?.kind === 'may') {
        asked.push(g.pending.player);
        g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'may', yes: !keepBoth } });
      } else g = act(g, { type: 'pass', player: g.priority! });
    }
    const goblin = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Boggart Lite')!;
    return { g, goblin, asked };
  };

  it('you win with the higher mana value', () => {
    const { g, goblin, asked } = clashWith('Big Spell', 'Tiny Spell');
    expect(asked).toEqual(['alice', 'bob']);
    expect(g.objects[goblin]!.counters['+1/+1']).toBe(1);
  });

  it('a lower or equal mana value doesn’t win; cards may go to the bottom', () => {
    const { g, goblin } = clashWith('Tiny Spell', 'Big Spell', false);
    expect(g.objects[goblin]!.counters['+1/+1']).toBeUndefined();
    const bottom = (p: string) => g.objects[g.zones.library[p]!.at(-1)!]!.card;
    expect([bottom('alice'), bottom('bob')]).toEqual(['Tiny Spell', 'Big Spell']);
  });
});
