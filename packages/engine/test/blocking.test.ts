import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

const make = (name: string, type_line: string, oracle_text: string, pt = '2') =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{G}', power: pt, toughness: pt });

const CARDS = [
  make('Fleet Raider', 'Creature — Human Rogue', "This creature can't be blocked by creatures with power 2 or less."),
  make('Lone Duelist', 'Creature — Human Warrior', "This creature can't be blocked by more than one creature."),
  make('Mob Ogre', 'Creature — Ogre', "This creature can't be blocked except by three or more creatures."),
  make('Sky Watcher', 'Creature — Bird Soldier', 'Reach\nThis creature can block only creatures with flying.'),
  make('Taunting Elf', 'Creature — Elf', 'This creature must be blocked if able.'),
  make('Lure Beast', 'Creature — Beast', 'All creatures able to block this creature do so.'),
  make('Big Bear', 'Creature — Bear', '', '3'),
];

function attackWith(names: string[], blockers: string[]): { g: GameState; attackers: string[]; blockers: string[] } {
  let g = toStep(start({ extra: CARDS }), 'main1');
  const attackers = names.map((n) => give(g, 'alice', n, 'battlefield'));
  const bs = blockers.map((n) => give(g, 'bob', n, 'battlefield'));
  g = passRound(toStep(g, 'beginning_of_combat'));
  g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: attackers.map((attacker) => ({ attacker, target: { kind: 'player', player: 'bob' } })) } });
  g = passRound(g);
  expect(g.pending).toMatchObject({ kind: 'declare_blockers', player: 'bob' });
  return { g, attackers, blockers: bs };
}
const block = (g: GameState, blocks: [string, string][]) => ({
  type: 'choose' as const,
  player: 'bob',
  answer: { kind: 'declare_blockers' as const, blocks: blocks.map(([blocker, attacker]) => ({ blocker, attacker })) },
});

describe('blocking restrictions (CR 509.1b)', () => {
  it('“can’t be blocked by creatures with power 2 or less”', () => {
    const { g, attackers: [raider], blockers: [bears, big] } = attackWith(['Fleet Raider'], ['Grizzly Bears', 'Big Bear']);
    expect(illegal(g, block(g, [[bears!, raider!]]))).toMatch(/can’t be blocked by/);
    act(g, block(g, [[big!, raider!]]));
  });

  it('“can’t be blocked by more than one creature”', () => {
    const { g, attackers: [duelist], blockers: [a, b] } = attackWith(['Lone Duelist'], ['Grizzly Bears', 'Grizzly Bears']);
    expect(illegal(g, block(g, [[a!, duelist!], [b!, duelist!]]))).toMatch(/more than one/);
    act(g, block(g, [[a!, duelist!]]));
  });

  it('“can’t be blocked except by three or more creatures”', () => {
    const { g, attackers: [ogre], blockers } = attackWith(['Mob Ogre'], ['Grizzly Bears', 'Grizzly Bears', 'Grizzly Bears']);
    expect(illegal(g, block(g, [[blockers[0]!, ogre!], [blockers[1]!, ogre!]]))).toMatch(/3 or more/);
    act(g, block(g, blockers.map((b) => [b, ogre!] as [string, string])));
  });

  it('“can block only creatures with flying”', () => {
    const { g, attackers: [bears], blockers: [watcher] } = attackWith(['Grizzly Bears'], ['Sky Watcher']);
    expect(illegal(g, block(g, [[watcher!, bears!]]))).toMatch(/can’t block/);
  });
});

describe('blocking requirements (CR 509.1c)', () => {
  it('“must be blocked if able”: someone has to block it', () => {
    const { g, attackers: [elf, bears], blockers: [b] } = attackWith(['Taunting Elf', 'Grizzly Bears'], ['Grizzly Bears']);
    expect(illegal(g, block(g, []))).toMatch(/must be blocked/);
    expect(illegal(g, block(g, [[b!, bears!]]))).toMatch(/must be blocked/);
    act(g, block(g, [[b!, elf!]]));
  });

  it('lure: every creature able to block it must', () => {
    const { g, attackers: [lure], blockers: [a, b, watcher] } = attackWith(['Lure Beast'], ['Grizzly Bears', 'Grizzly Bears', 'Sky Watcher']);
    expect(illegal(g, block(g, [[a!, lure!]]))).toMatch(/must block/);
    // Sky Watcher can't block it (no flying), so it isn't required to.
    expect(watcher).toBeDefined();
    act(g, block(g, [[a!, lure!], [b!, lure!]]));
  });

  it('a requirement that would break a restriction doesn’t apply', () => {
    const { g } = attackWith(['Taunting Elf'], ['Sky Watcher']);
    act(g, block(g, []));
  });
});
