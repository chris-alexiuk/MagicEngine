import { describe, expect, it } from 'vitest';
import { apply, choiceModes, choicePrompts, legalActions, type Action, type GameState } from '../src/index.js';
import { give, makeCard, start, toStep } from './helpers.js';

const mountain = makeCard({ name: 'Mountain', type_line: 'Basic Land — Mountain', oracle_text: '({T}: Add {R}.)' });
const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, string> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{G}', ...extra });
const charm = card('Test Charm', 'Instant', 'Choose one —\n• Target player draws two cards.\n• Target creature gets -2/-2 until end of turn.');
const pacifism = card('Pacifism', 'Enchantment — Aura', "Enchant creature\nEnchanted creature can't attack or block.");
const pinger = card('Pinger', 'Creature — Goblin', '{T}: Pinger deals 1 damage to any target.', { power: '1', toughness: '1' });

function setup(): GameState {
  const g = toStep(start({ extra: [mountain, charm, pacifism, pinger] }), 'main1');
  for (let i = 0; i < 2; i++) give(g, 'alice', 'Forest', 'battlefield');
  give(g, 'alice', 'Mountain', 'battlefield');
  return g;
}

const listed = (g: GameState, object: string) => legalActions(g, 'alice').find((a) => 'object' in a && a.object === object) as Extract<Action, { type: 'cast' | 'activate' }>;

describe('UI helpers: what a listed action asks for', () => {
  it('lists every legal target for a spell, and the engine accepts each one', () => {
    const g = setup();
    const bears = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const bolt = give(g, 'alice', 'Lightning Bolt', 'hand');
    const a = listed(g, bolt);
    const [prompt] = choicePrompts(g, a);
    expect(prompt!.count).toBe(1);
    expect(prompt!.candidates).toContainEqual({ kind: 'object', object: bears });
    expect(prompt!.candidates).toContainEqual({ kind: 'player', player: 'bob' });
    for (const t of prompt!.candidates) expect(apply(g, { ...a, targets: [[t]] }).ok).toBe(true);
  });

  it("reads an Aura's enchant target and an activated ability's targets", () => {
    const g = setup();
    const bears = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const aura = give(g, 'alice', 'Pacifism', 'hand');
    expect(choicePrompts(g, listed(g, aura))[0]!.candidates).toEqual([{ kind: 'object', object: bears }]);
    const goblin = give(g, 'alice', 'Pinger', 'battlefield');
    const ping = choicePrompts(g, listed(g, goblin));
    expect(ping[0]!.candidates).toContainEqual({ kind: 'object', object: goblin });
    expect(ping[0]!.candidates).toContainEqual({ kind: 'player', player: 'alice' });
  });

  it("offers a modal spell's modes and each mode's own targets", () => {
    const g = setup();
    const bears = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const c = give(g, 'alice', 'Test Charm', 'hand');
    const a = listed(g, c);
    const menu = choiceModes(g, a)!;
    expect(menu).toMatchObject({ min: 1, max: 1, repeat: false, used: [] });
    expect(menu.options.map((o) => o.text)).toEqual(['Target player draws two cards.', 'Target creature gets -2/-2 until end of turn.']);
    expect(choicePrompts(g, a, [1])[0]!.candidates).toEqual([{ kind: 'object', object: bears }]);
    expect(choicePrompts(g, a, [0])[0]!.candidates.every((t) => t.kind === 'player')).toBe(true);
    expect(apply(g, { ...a, modes: [1], targets: [[{ kind: 'object', object: bears }]] }).ok).toBe(true);
    expect(() => choicePrompts(g, a, [0, 1])).toThrow();
  });

  it('a spell without targets has no prompts and no modes', () => {
    const g = setup();
    const bears = give(g, 'alice', 'Grizzly Bears', 'hand');
    const a = listed(g, bears);
    expect(choicePrompts(g, a)).toEqual([]);
    expect(choiceModes(g, a)).toBeNull();
  });
});
