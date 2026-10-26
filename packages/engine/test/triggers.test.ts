import { describe, expect, it } from 'vitest';
import type { GameState, Target } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

const creature = (name: string, oracle_text: string, pt = '1') =>
  makeCard({ name, type_line: 'Creature — Elf', oracle_text, mana_cost: '{G}', power: pt, toughness: pt });

const CARDS = [
  creature('Visionary', 'When this creature enters, draw a card.'),
  creature('Pinger', 'When this creature enters, it deals 1 damage to any target.'),
  creature('Maybe Elf', 'When this creature enters, you may draw a card.'),
  creature('Artifact Hater', 'When this creature enters, destroy target artifact.'),
  creature('Mourner', 'Whenever another creature dies, each opponent loses 1 life.'),
  creature('Last Words', 'When this creature dies, draw a card.'),
  creature('Brave Elf', 'Whenever this creature attacks, it gets +1/+0 until end of turn.', '2'),
  creature('Spy', 'Whenever this creature deals combat damage to a player, that player discards a card.', '2'),
  creature('Morning Elf', 'At the beginning of your upkeep, you gain 1 life.'),
  creature('Everyone Elf', 'At the beginning of each upkeep, you gain 1 life.'),
  creature('Spellwatcher', 'Whenever you cast a noncreature spell, put a +1/+1 counter on this creature.'),
  makeCard({ name: 'Divination', type_line: 'Sorcery', oracle_text: 'Draw two cards.', mana_cost: '{G}' }),
  makeCard({ name: 'Shatter Wave', type_line: 'Sorcery', oracle_text: 'Destroy all creatures.', mana_cost: '{G}' }),
];

function setup(): GameState {
  const g = toStep(start({ extra: CARDS }), 'main1');
  for (let i = 0; i < 4; i++) give(g, 'alice', 'Forest', 'battlefield');
  return g;
}
const player = (p: string): Target => ({ kind: 'player', player: p });

function cast(g: GameState, name: string, who = 'alice'): GameState {
  const id = give(g, who, name, 'hand');
  return act(g, { type: 'cast', player: who, object: id, autoTap: true });
}

describe('triggered abilities (CR 603)', () => {
  it('CR 603.6a / CR 603.3: an enters trigger goes on the stack before anyone gets priority', () => {
    let g = setup();
    const hand = g.zones.hand.alice!.length;
    g = passRound(cast(g, 'Visionary'));
    expect(g.stack).toMatchObject([{ kind: 'ability', sourceName: 'Visionary', text: 'When this creature enters, draw a card.' }]);
    expect(g.priority).toBe('alice');
    g = passRound(g);
    expect(g.stack).toEqual([]);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('CR 603.3d: targets are chosen as the trigger goes on the stack', () => {
    let g = setup();
    g = passRound(cast(g, 'Pinger'));
    expect(g.pending).toMatchObject({ kind: 'trigger_targets', player: 'alice', sourceName: 'Pinger', prompts: [{ text: 'any target', count: 1 }] });
    expect(g.priority).toBe('alice');
    expect(illegal(g, { type: 'pass', player: 'alice' })).toMatch(/Waiting/);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[player('bob')]] } });
    expect(g.stack).toHaveLength(1);
    g = passRound(g);
    expect(g.players.bob!.life).toBe(19);
  });

  it('CR 603.3d: a trigger with no legal targets is removed', () => {
    let g = setup();
    g = passRound(cast(g, 'Artifact Hater'));
    expect(g.pending).toBeNull();
    expect(g.stack).toEqual([]);
    expect(g.triggers).toEqual([]);
  });

  it('CR 603.5: "you may" is decided as the ability resolves', () => {
    let g = setup();
    const hand = g.zones.hand.alice!.length;
    g = passRound(passRound(cast(g, 'Maybe Elf')));
    expect(g.pending).toMatchObject({ kind: 'may', player: 'alice', sourceName: 'Maybe Elf' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: false } });
    expect(g.zones.hand.alice!.length).toBe(hand);
    expect(g.stack).toEqual([]);
  });

  it('CR 700.4 / CR 603.10a: dies triggers look back — creatures dying together see each other die', () => {
    let g = setup();
    give(g, 'alice', 'Mourner', 'battlefield');
    give(g, 'bob', 'Grizzly Bears', 'battlefield');
    give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = passRound(cast(g, 'Shatter Wave'));
    // The Mourner died at the same time as the two Bears: it triggers for each of them, not for itself.
    expect(g.stack.filter((e) => e.kind === 'ability')).toHaveLength(2);
    g = passRound(passRound(g));
    expect(g.players.bob!.life).toBe(18);
  });

  it('CR 603.6c: "when this creature dies" triggers from the graveyard', () => {
    let g = setup();
    give(g, 'alice', 'Last Words', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = passRound(cast(g, 'Shatter Wave'));
    expect(g.stack).toMatchObject([{ kind: 'ability', sourceName: 'Last Words' }]);
    g = passRound(g);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('attack triggers, and "it" meaning the attacking creature', () => {
    let g = setup();
    const elf = give(g, 'alice', 'Brave Elf', 'battlefield');
    g = passRound(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: elf, target: { kind: 'player', player: 'bob' } }] } });
    expect(g.stack).toMatchObject([{ kind: 'ability', sourceName: 'Brave Elf' }]);
    g = passRound(g);
    g = toStep(g, 'end_of_combat');
    expect(g.players.bob!.life).toBe(17);
  });

  it('combat damage triggers know the player who was dealt damage', () => {
    let g = setup();
    const spy = give(g, 'alice', 'Spy', 'battlefield');
    g = passRound(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: spy, target: { kind: 'player', player: 'bob' } }] } });
    g = toStep(g, 'combat_damage');
    expect(g.stack).toMatchObject([{ kind: 'ability', sourceName: 'Spy', trigger: { player: 'bob' } }]);
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'discard', player: 'bob', count: 1 });
  });

  it('CR 603.2b: "at the beginning of your upkeep" triggers only on your turn', () => {
    let g = setup();
    give(g, 'alice', 'Morning Elf', 'battlefield');
    g = toStep(g, 'upkeep', 'bob');
    expect(g.stack).toEqual([]);
    g = toStep(g, 'draw', 'bob');
    g = toStep(g, 'upkeep', 'alice');
    expect(g.stack).toMatchObject([{ kind: 'ability', controller: 'alice' }]);
    g = passRound(g);
    expect(g.players.alice!.life).toBe(21);
  });

  it('CR 603.3b: triggers go on the stack in APNAP order, so the active player’s resolve last', () => {
    let g = setup();
    give(g, 'alice', 'Everyone Elf', 'battlefield');
    give(g, 'bob', 'Everyone Elf', 'battlefield');
    g = toStep(g, 'upkeep', 'bob');
    expect(g.stack.map((e) => e.controller)).toEqual(['bob', 'alice']);
  });

  it('cast triggers, filtered by the kind of spell', () => {
    let g = setup();
    const watcher = give(g, 'alice', 'Spellwatcher', 'battlefield');
    g = passRound(cast(g, 'Grizzly Bears'));
    expect(g.stack).toEqual([]);
    g = cast(g, 'Divination');
    // The trigger goes on the stack above the spell.
    expect(g.stack.map((e) => e.kind)).toEqual(['spell', 'ability']);
    g = passRound(g);
    expect(g.objects[watcher]!.counters['+1/+1']).toBe(1);
  });
});
