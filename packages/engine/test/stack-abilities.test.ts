import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{1}', ...extra });

const CARDS = [
  card('Stifle Lite', 'Instant', 'Counter target activated or triggered ability.', { mana_cost: '{U}' }),
  card('Squelch Lite', 'Instant', 'Counter target activated ability.', { mana_cost: '{U}' }),
  card('Rust Lite', 'Instant', 'Counter target activated ability from an artifact source.', { mana_cost: '{G}' }),
  card('Consign Lite', 'Instant', 'Counter target triggered ability or colorless spell.', { mana_cost: '{U}' }),
  card('Healer Bear', 'Creature — Bear', 'When this creature enters, you gain 3 life.', { power: '2', toughness: '2' }),
  card('Ping Rod', 'Artifact', '{T}: This artifact deals 1 damage to any target.'),
  card('Life Totem', 'Creature — Spirit', '{T}: You gain 2 life.', { power: '1', toughness: '1' }),
  card('Resonator Lite', 'Artifact', '{2}, {T}: Copy target triggered ability you control. You may choose new targets for the copy.'),
  card('Lithoform Lite', 'Artifact', '{2}, {T}: Copy target activated or triggered ability you control. You may choose new targets for the copy.'),
  card('Rings Lite', 'Artifact', "Whenever you activate an ability, if it isn't a mana ability, you may pay {2}. If you do, copy that ability. You may choose new targets for the copy."),
  card('Shaman Lite', 'Creature — Centaur Shaman', "Whenever a player activates an ability that isn't a mana ability, this creature deals 1 damage to that player.", { power: '2', toughness: '2' }),
  card('Talent Lite', 'Enchantment', 'Whenever you activate a loyalty ability, you gain 1 life.'),
  card('Walker Lite', 'Legendary Planeswalker — Testwalker', '+1: You gain 1 life.', { loyalty: '3' }),
  card('Grey Golem', 'Artifact Creature — Golem', '', { power: '2', toughness: '2', mana_cost: '{2}' }),
];

const bob = { kind: 'player' as const, player: 'bob' };
const alice = { kind: 'player' as const, player: 'alice' };
const ability = (entry: string) => ({ kind: 'ability' as const, entry });
const topId = (g: GameState) => {
  const top = g.stack[g.stack.length - 1]!;
  return top.kind === 'ability' ? top.id : top.object;
};

function setup(): GameState {
  const g = toStep(start({ extra: CARDS }), 'main1');
  g.players.alice!.pool = { W: 0, U: 5, B: 0, R: 0, G: 5, C: 10 };
  g.players.bob!.pool = { W: 0, U: 5, B: 0, R: 0, G: 5, C: 10 };
  return g;
}
/** Hands priority to `player` (everyone before them passes). */
function priorityTo(g: GameState, player: string): GameState {
  while (g.priority && g.priority !== player) g = act(g, { type: 'pass', player: g.priority });
  return g;
}
function cast(g: GameState, player: string, name: string, targets?: unknown[][]): GameState {
  g = priorityTo(g, player);
  return act(g, { type: 'cast', player, object: give(g, player, name, 'hand'), ...(targets ? { targets } : {}) } as never);
}
/** Puts Healer Bear onto the battlefield so its trigger waits on the stack. */
function bearTrigger(g: GameState): GameState {
  g = passRound(cast(g, 'alice', 'Healer Bear'));
  expect(g.stack).toHaveLength(1);
  expect(g.stack[0]!.kind).toBe('ability');
  return g;
}
/** Passes priority until the stack is empty, answering “may” and “pay” questions yes. */
function settle(g: GameState): GameState {
  for (let i = 0; i < 40 && (g.stack.length || g.pending); i++) {
    const p = g.pending;
    if (p?.kind === 'pay' || p?.kind === 'may') g = act(g, { type: 'choose', player: p.player, answer: { kind: p.kind, ...(p.kind === 'pay' ? { pay: true } : { yes: true }) } as never });
    else if (p?.kind === 'copy_targets') g = act(g, { type: 'choose', player: p.player, answer: { kind: 'copy_targets' } });
    else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
  }
  return g;
}

describe('CR 701.6a: countering abilities on the stack', () => {
  it('“Counter target activated or triggered ability” — the trigger never resolves', () => {
    let g = bearTrigger(setup());
    g = cast(g, 'bob', 'Stifle Lite', [[ability(topId(g))]]);
    g = settle(g);
    expect(g.players.alice!.life).toBe(20);
  });

  it('“Counter target activated ability” can’t target a triggered ability, but can an activated one', () => {
    let g = bearTrigger(setup());
    const trig = topId(g);
    g = priorityTo(g, 'bob');
    expect(illegal(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Squelch Lite', 'hand'), targets: [[ability(trig)]] })).toMatch(/legal target/);
    g = settle(g);
    expect(g.players.alice!.life).toBe(23);

    g = priorityTo(g, 'alice');
    const totem = give(g, 'alice', 'Life Totem', 'battlefield');
    g = act(g, { type: 'activate', player: 'alice', object: totem, ability: 0 });
    g = settle(cast(g, 'bob', 'Squelch Lite', [[ability(topId(g))]]));
    expect(g.players.alice!.life).toBe(23);
  });

  it('“from an artifact source”: an artifact’s ability, not a creature’s', () => {
    let g = setup();
    const rod = give(g, 'alice', 'Ping Rod', 'battlefield');
    const totem = give(g, 'alice', 'Life Totem', 'battlefield');
    g = act(g, { type: 'activate', player: 'alice', object: totem, ability: 0 });
    const totemAbility = topId(g);
    g = act(g, { type: 'activate', player: 'alice', object: rod, ability: 0, targets: [[bob]] });
    const rodAbility = topId(g);
    g = priorityTo(g, 'bob');
    expect(illegal(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Rust Lite', 'hand'), targets: [[ability(totemAbility)]] })).toMatch(/legal target/);
    g = settle(cast(g, 'bob', 'Rust Lite', [[ability(rodAbility)]]));
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([22, 20]);
  });

  it('“target triggered ability or colorless spell” — a colorless spell is a legal choice too', () => {
    let g = setup();
    g = cast(g, 'alice', 'Grey Golem');
    const golem = topId(g);
    g = settle(cast(g, 'bob', 'Consign Lite', [[{ kind: 'object', object: golem }]]));
    expect(g.objects[golem]!.zone).toBe('graveyard');
  });
});

describe('CR 707.10: copying abilities', () => {
  it('“Copy target triggered ability you control” — the trigger resolves twice', () => {
    let g = bearTrigger(setup());
    const resonator = give(g, 'alice', 'Resonator Lite', 'battlefield');
    g = act(g, { type: 'activate', player: 'alice', object: resonator, ability: 0, targets: [[ability(topId(g))]] });
    g = settle(g);
    expect(g.players.alice!.life).toBe(26);
  });

  it('CR 707.10c: the copy of an activated ability can get new targets', () => {
    let g = setup();
    const rod = give(g, 'alice', 'Ping Rod', 'battlefield');
    const engine = give(g, 'alice', 'Lithoform Lite', 'battlefield');
    g = act(g, { type: 'activate', player: 'alice', object: rod, ability: 0, targets: [[bob]] });
    g = act(g, { type: 'activate', player: 'alice', object: engine, ability: 0, targets: [[ability(topId(g))]] });
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'copy_targets', ability: true });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'copy_targets', targets: [[alice]] } });
    g = settle(g);
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([19, 19]);
  });

  it('“Whenever you activate an ability, if it isn’t a mana ability, you may pay {2}. If you do, copy that ability.”', () => {
    let g = setup();
    give(g, 'alice', 'Rings Lite', 'battlefield');
    const rod = give(g, 'alice', 'Ping Rod', 'battlefield');
    g = act(g, { type: 'activate', player: 'alice', object: rod, ability: 0, targets: [[bob]] });
    g = settle(g);
    expect(g.players.bob!.life).toBe(18);
  });

  it('a copy of an ability isn’t activated (CR 707.10), so it doesn’t trigger again', () => {
    let g = setup();
    give(g, 'alice', 'Rings Lite', 'battlefield');
    give(g, 'alice', 'Rings Lite', 'battlefield');
    const rod = give(g, 'alice', 'Ping Rod', 'battlefield');
    g = act(g, { type: 'activate', player: 'alice', object: rod, ability: 0, targets: [[bob]] });
    g = settle(g);
    expect(g.players.bob!.life).toBe(17);
  });
});

describe('CR 602.2: “Whenever … activates an ability”', () => {
  it('“that player” is whoever activated it; mana abilities don’t count', () => {
    let g = setup();
    give(g, 'alice', 'Shaman Lite', 'battlefield');
    const rod = give(g, 'bob', 'Ping Rod', 'battlefield');
    g = act(g, { type: 'pass', player: 'alice' });
    g = act(g, { type: 'activate', player: 'bob', object: rod, ability: 0, targets: [[alice]] });
    g = settle(g);
    expect([g.players.alice!.life, g.players.bob!.life]).toEqual([19, 19]);
  });

  it('“Whenever you activate a loyalty ability”', () => {
    let g = setup();
    give(g, 'alice', 'Talent Lite', 'battlefield');
    const walker = give(g, 'alice', 'Walker Lite', 'battlefield');
    g.objects[walker]!.counters.loyalty = 3;
    g = act(g, { type: 'activate', player: 'alice', object: walker, ability: 0 });
    g = settle(g);
    expect(g.players.alice!.life).toBe(22);
  });
});
