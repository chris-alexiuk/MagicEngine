import { describe, expect, it } from 'vitest';
import { power, type GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{0}', cmc: 0, ...extra });

const CARDS = [
  card('Test Dungeon', 'Dungeon', 'Entry — You gain 1 life. (Leads to: Left, Right)\nLeft — Draw a card. (Leads to: Bottom)\nRight — You gain 5 life. (Leads to: Bottom)\nBottom — You gain 10 life.'),
  card('Test Undercity', 'Dungeon — Undercity', 'You can\'t enter this dungeon unless you "venture into Undercity."\nGate — You gain 2 life. (Leads to: End)\nEnd — You gain 3 life.'),
  card('Delve Lite', 'Sorcery', 'Venture into the dungeon.'),
  card('Explore Lite', 'Sorcery', 'You take the initiative.'),
  card('Veteran', 'Creature — Human', "As long as you've completed a dungeon, this creature gets +3/+0.", { power: '1', toughness: '1' }),
  card('Raider', 'Creature — Orc', '', { power: '2', toughness: '2' }),
];

function settle(g: GameState, room?: string): GameState {
  for (let i = 0; i < 40 && (g.stack.length || g.pending); i++) {
    const p = g.pending;
    if (p?.kind === 'choose_option') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'choose_option', choice: room && p.options.includes(room) ? room : p.options[0]! } });
    else if (p?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'declare_blockers', blocks: [] } });
    else if (p) break;
    else g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
}
const cast = (g: GameState, name: string, room?: string) => settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand') }), room);
const life = (g: GameState, p = 'alice') => g.players[p]!.life;

describe('CR 309 / 701.49: dungeons', () => {
  it('venturing enters the topmost room, follows a chosen arrow, and completes the dungeon (CR 704.5t)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    const vet = give(g, 'alice', 'Veteran', 'battlefield');
    g = cast(g, 'Delve Lite');
    // Undercity can only be entered by venturing into Undercity (CR 701.49d).
    expect(g.players.alice!.dungeon).toEqual({ card: 'Test Dungeon', room: 'Entry' });
    expect(life(g)).toBe(21);
    g = act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Delve Lite', 'hand') });
    g = act(act(g, { type: 'pass', player: 'alice' }), { type: 'pass', player: 'bob' });
    expect(g.pending).toMatchObject({ kind: 'choose_option', options: ['Left', 'Right'] });
    g = settle(g, 'Right');
    expect(life(g)).toBe(26);
    expect(power(g, g.objects[vet]!)).toBe(1);
    g = cast(g, 'Delve Lite');
    expect(life(g)).toBe(36);
    expect(g.players.alice!.dungeon).toBeUndefined();
    expect(g.players.alice!.completed).toEqual(['Test Dungeon']);
    expect(power(g, g.objects[vet]!)).toBe(4);
  });

  it('CR 726: the initiative — venture into Undercity as you take it and at your upkeep; combat damage steals it', () => {
    let g = toStep(start({ extra: CARDS }), 'main1');
    g = cast(g, 'Explore Lite');
    expect(g.initiative).toBe('alice');
    expect(g.players.alice!.dungeon).toEqual({ card: 'Test Undercity', room: 'Gate' });
    expect(life(g)).toBe(22);
    const raider = give(g, 'bob', 'Raider', 'battlefield');
    g = toStep(g, 'beginning_of_combat', 'bob');
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: raider, target: { kind: 'player', player: 'alice' } }] } }));
    while (g.step !== 'main2') g = settle(act(g, { type: 'pass', player: g.priority! }));
    expect(g.initiative).toBe('bob');
    expect(g.players.bob!.dungeon).toEqual({ card: 'Test Undercity', room: 'Gate' });
    expect(life(g, 'bob')).toBe(22);
    g = settle(toStep(g, 'upkeep', 'alice'));
    g = settle(toStep(g, 'upkeep', 'bob'));
    // Bob's upkeep: End (and the dungeon is completed).
    expect(life(g, 'bob')).toBe(25);
    expect(g.players.bob!.completed).toEqual(['Test Undercity']);
  });
});
