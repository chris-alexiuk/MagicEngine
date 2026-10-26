import { describe, expect, it } from 'vitest';
import { viewFor, type GameState } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{G}', ...extra });
const creature = (name: string, text: string, pt: string) =>
  card(name, 'Creature — Human', text, { power: pt.split('/')[0], toughness: pt.split('/')[1] });

const CARDS = [
  creature('Herald', 'Whenever this creature enters or attacks, you gain 1 life.', '1/1'),
  creature('Martyr', 'When this creature enters or dies, you gain 2 life.', '1/1'),
  creature('Hero', 'Heroic — Whenever you cast a spell that targets this creature, put a +1/+1 counter on this creature.', '1/1'),
  creature('Tapper', 'Whenever this creature becomes tapped, you gain 1 life.', '1/1'),
  creature('Bolsterer', 'When this creature enters, bolster 2.', '3/3'),
  creature('Supporter', 'When this creature enters, support 2.', '1/1'),
  creature('Enduring', 'When this creature enters, it endures 2.', '1/1'),
  creature('Oracle', 'When this creature enters, look at the top three cards of your library, then put them back in any order.', '1/1'),
  card('Mind Rot Plus', 'Sorcery', 'Target opponent reveals their hand. You choose a nonland card from it. That player discards that card.', { mana_cost: '{B}' }),
  card('Edict', 'Sorcery', 'Target player sacrifices a creature of their choice.', { mana_cost: '{B}' }),
  card('Giant Growth', 'Instant', 'Target creature gets +3/+3 until end of turn.'),
  card('Zap', 'Instant', 'Zap deals 1 damage to any target.', { mana_cost: '{R}' }),
];
const bob = { kind: 'player' as const, player: 'bob' };
const obj = (object: string) => ({ kind: 'object' as const, object });

function setup(): GameState {
  return toStep(start({ extra: CARDS }), 'main1');
}
const cast = (g: GameState, name: string, extra: Record<string, unknown> = {}) => {
  g.players.alice!.pool.G += 2;
  g.players.alice!.pool.B += 1;
  g.players.alice!.pool.R += 1;
  return passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), ...extra }));
};
const settle = (g: GameState) => {
  while (g.stack.length && !g.pending) g = passRound(g);
  return g;
};

describe('two trigger events, one ability (CR 603.2)', () => {
  it('“enters or attacks”', () => {
    let g = settle(cast(setup(), 'Herald'));
    expect(g.players.alice!.life).toBe(21);
    const herald = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Herald')!;
    g.objects[herald]!.sick = false;
    g = passRound(toStep(g, 'beginning_of_combat'));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: herald, target: bob }] } }));
    expect(g.players.alice!.life).toBe(22);
  });

  it('“enters or dies” looks back in time for the death (CR 603.10a)', () => {
    let g = settle(cast(setup(), 'Martyr'));
    expect(g.players.alice!.life).toBe(22);
    const martyr = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Martyr')!;
    g = settle(cast(g, 'Zap', { targets: [[obj(martyr)]] }));
    expect(g.objects[martyr]!.zone).toBe('graveyard');
    expect(g.players.alice!.life).toBe(24);
  });
});

describe('more triggers', () => {
  it('heroic: a spell that targets it', () => {
    let g = setup();
    const hero = give(g, 'alice', 'Hero', 'battlefield');
    const other = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = settle(cast(g, 'Giant Growth', { targets: [[obj(other)]] }));
    expect(g.objects[hero]!.counters['+1/+1'] ?? 0).toBe(0);
    g = settle(cast(g, 'Giant Growth', { targets: [[obj(hero)]] }));
    expect(g.objects[hero]!.counters['+1/+1']).toBe(1);
  });

  it('“becomes tapped”', () => {
    let g = setup();
    const tapper = give(g, 'alice', 'Tapper', 'battlefield');
    g = passRound(toStep(g, 'beginning_of_combat'));
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: tapper, target: bob }] } }));
    expect(g.players.alice!.life).toBe(21);
  });
});

describe('keyword actions and choices', () => {
  it('bolster (CR 701.39a): the creature with the least toughness', () => {
    let g = setup();
    const small = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = settle(cast(g, 'Bolsterer'));
    expect(g.objects[small]!.counters['+1/+1']).toBe(2);
  });

  it('support (CR 701.41a): up to N other target creatures', () => {
    let g = setup();
    const a = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    const b = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = cast(g, 'Supporter');
    if (g.pending?.kind === 'trigger_targets') {
      const supporter = g.zones.battlefield.find((id) => g.objects[id]!.card === 'Supporter')!;
      expect(g.pending.prompts[0]!.candidates).not.toContainEqual(obj(supporter));
      g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[obj(a), obj(b)]] } });
    }
    g = settle(g);
    expect(g.objects[a]!.counters['+1/+1']).toBe(1);
    expect(g.objects[b]!.counters['+1/+1']).toBe(1);
  });

  it('endure (CR 701.63a): counters, or else a Spirit token', () => {
    let g = cast(setup(), 'Enduring');
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'may', player: 'alice' });
    const tokens = () => g.zones.battlefield.filter((id) => g.objects[id]!.token).length;
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: false } }));
    expect(tokens()).toBe(1);
    g = cast(g, 'Enduring');
    g = passRound(g);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    const second = g.zones.battlefield.filter((id) => g.objects[id]!.card === 'Enduring')[1]!;
    expect(g.objects[second]!.counters['+1/+1']).toBe(2);
    expect(tokens()).toBe(1);
  });

  it('“look at the top three cards, then put them back in any order”', () => {
    let g = cast(setup(), 'Oracle');
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'scry', reorder: true });
    const top = [...g.zones.library.alice!.slice(0, 3)];
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'scry', top: top.slice(1), bottom: [top[0]!] } })).toMatch(/back on top/);
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'scry', top: [...top].reverse(), bottom: [] } });
    expect(g.zones.library.alice!.slice(0, 3)).toEqual([...top].reverse());
  });

  it('“reveals their hand. You choose a nonland card from it. That player discards that card.”', () => {
    let g = setup();
    for (const id of [...g.zones.hand.bob!]) g.objects[id]!.zone = 'library', g.zones.library.bob!.push(id);
    g.zones.hand.bob = [];
    const land = give(g, 'bob', 'Forest', 'hand');
    const bears = give(g, 'bob', 'Grizzly Bears', 'hand');
    const zap = give(g, 'bob', 'Zap', 'hand');
    g = cast(g, 'Mind Rot Plus', { targets: [[bob]] });
    expect(g.pending).toMatchObject({ kind: 'choose_objects', player: 'alice', candidates: [bears, zap] });
    // Alice sees the revealed hand; so does Bob.
    expect(viewFor(g, 'alice').objects[land]).toBeDefined();
    expect(illegal(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [land] } })).toBeTruthy();
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [zap] } });
    expect(g.objects[zap]!.zone).toBe('graveyard');
    expect(g.objects[bears]!.zone).toBe('hand');
  });

  it('“sacrifices a creature of their choice”', () => {
    let g = setup();
    const bears = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = settle(cast(g, 'Edict', { targets: [[bob]] }));
    expect(g.objects[bears]!.zone).toBe('graveyard');
  });
});
