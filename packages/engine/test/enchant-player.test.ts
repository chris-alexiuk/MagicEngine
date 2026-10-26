import { describe, expect, it } from 'vitest';
import { legalActions, power, type GameState, type PlayerId } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

const curse = (name: string, text: string, enchant = 'player') =>
  makeCard({ name, type_line: 'Enchantment — Aura Curse', mana_cost: '{G}', oracle_text: `Enchant ${enchant}\n${text}` });

const CARDS = [
  curse('Withering Curse', 'Creatures enchanted player controls get -1/-1.'),
  curse('Bleeding Curse', "At the beginning of enchanted player's upkeep, that player loses 1 life."),
  curse('Rival Curse', 'Creatures enchanted player controls get -1/-1.', 'opponent'),
  curse('Curse of Plenty', 'Whenever enchanted player is attacked, you gain 2 life. Each opponent attacking that player does the same.'),
  curse('Curse of Trades', 'Whenever a player attacks enchanted player with one or more creatures, that attacking player may discard a card. If the player does, they draw a card.'),
  curse('Curse of Prying', 'Whenever enchanted player draws a card, they lose 2 life and you gain 2 life.'),
  curse('Curse of Emptiness', "At the beginning of enchanted player's end step, that player discards their hand."),
  curse('Curse of the Hunt', 'Whenever a creature attacks enchanted player, put a +1/+1 counter on it.'),
];

const player = (p: PlayerId) => ({ kind: 'player' as const, player: p });

function setup(players = 2): GameState {
  const g = toStep(start({ extra: CARDS, players }), 'main1');
  for (let i = 0; i < 3; i++) give(g, 'alice', 'Forest', 'battlefield');
  return g;
}
function castCurse(g: GameState, name: string, on: PlayerId): { g: GameState; id: string } {
  const id = give(g, 'alice', name, 'hand');
  g = passRound(act(g, { type: 'cast', player: 'alice', object: id, autoTap: true, targets: [[player(on)]] }));
  return { g, id };
}
function attack(g: GameState, who: PlayerId, attackers: string[], target: PlayerId): GameState {
  g = passRound(toStep(g, 'beginning_of_combat', who));
  return act(g, { type: 'choose', player: who, answer: { kind: 'declare_attackers', attacks: attackers.map((attacker) => ({ attacker, target: player(target) })) } });
}

describe('CR 303.4: Auras that enchant players', () => {
  it('an Aura spell with “enchant player” targets a player and enters attached to them', () => {
    const r = castCurse(setup(), 'Withering Curse', 'bob');
    const o = r.g.objects[r.id]!;
    expect(o.zone).toBe('battlefield');
    expect(o.attachedToPlayer).toBe('bob');
    expect(o.attachedTo).toBeUndefined();
  });

  it('“creatures enchanted player controls” affects only that player’s creatures', () => {
    let g = setup();
    const theirs = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const mine = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = castCurse(g, 'Withering Curse', 'bob').g;
    expect(power(g, g.objects[theirs]!)).toBe(1);
    expect(power(g, g.objects[mine]!)).toBe(2);
  });

  it('“enchant opponent” can’t target its caster', () => {
    const g = setup();
    const id = give(g, 'alice', 'Rival Curse', 'hand');
    expect(illegal(g, { type: 'cast', player: 'alice', object: id, autoTap: true, targets: [[player('alice')]] })).toMatch(/target|opponent/i);
    const casts = legalActions(g, 'alice').filter((a) => a.type === 'cast' && a.object === id);
    expect(casts.length).toBeGreaterThan(0);
  });

  it('CR 704.5m: when the enchanted player leaves the game, the Aura goes to the graveyard', () => {
    let { g, id } = castCurse(setup(3), 'Bleeding Curse', 'bob');
    g = act(g, { type: 'concede', player: 'bob' });
    expect(g.objects[id]!.zone).toBe('graveyard');
  });

  it('“at the beginning of enchanted player’s upkeep” triggers on their turn only', () => {
    let g = castCurse(setup(), 'Bleeding Curse', 'bob').g;
    g = toStep(g, 'draw', 'bob');
    expect(g.players.bob!.life).toBe(19);
    g = toStep(g, 'draw', 'alice');
    expect(g.players.alice!.life).toBe(20);
    expect(g.players.bob!.life).toBe(19);
  });

  it('“whenever enchanted player draws a card”', () => {
    let g = castCurse(setup(), 'Curse of Prying', 'bob').g;
    g = toStep(g, 'main1', 'bob');
    expect(g.players.bob!.life).toBe(18);
    expect(g.players.alice!.life).toBe(22);
  });

  it('“that player discards their hand” at their end step', () => {
    let g = castCurse(setup(), 'Curse of Emptiness', 'bob').g;
    g = passRound(toStep(g, 'end', 'bob'));
    expect(g.zones.hand.bob).toHaveLength(0);
    expect(g.zones.hand.alice!.length).toBeGreaterThan(0);
  });
});

describe('Curses that trigger when their player is attacked', () => {
  it('“each opponent attacking that player does the same”', () => {
    let g = castCurse(setup(3), 'Curse of Plenty', 'carol').g;
    g = toStep(g, 'main1', 'bob');
    const bears = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = passRound(attack(g, 'bob', [bears], 'carol'));
    expect(g.players.alice!.life).toBe(22);
    expect(g.players.bob!.life).toBe(22);
    expect(g.players.carol!.life).toBe(20);
  });

  it('attacking someone else doesn’t trigger it', () => {
    let g = castCurse(setup(3), 'Curse of Plenty', 'carol').g;
    g = toStep(g, 'main1', 'bob');
    const bears = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = passRound(attack(g, 'bob', [bears], 'alice'));
    expect(g.players.alice!.life).toBe(20);
    expect(g.players.bob!.life).toBe(20);
  });

  it('“that attacking player may discard a card. If the player does, they draw a card.”', () => {
    let g = castCurse(setup(3), 'Curse of Trades', 'carol').g;
    g = toStep(g, 'main1', 'bob');
    const bears = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = attack(g, 'bob', [bears], 'carol');
    g = passRound(g);
    expect(g.pending).toMatchObject({ kind: 'may', player: 'bob' });
    const hand = g.zones.hand.bob!.length;
    const graveyard = g.zones.graveyard.bob!.length;
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'may', yes: true } });
    if (g.pending?.kind === 'discard') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'discard', objects: [g.zones.hand.bob![0]!] } });
    expect(g.zones.hand.bob!.length).toBe(hand);
    expect(g.zones.graveyard.bob!.length).toBe(graveyard + 1);
  });

  it('“whenever a creature attacks enchanted player, put a +1/+1 counter on it”', () => {
    let g = castCurse(setup(3), 'Curse of the Hunt', 'carol').g;
    g = toStep(g, 'main1', 'bob');
    const a = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    const b = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = passRound(attack(g, 'bob', [a, b], 'carol'));
    g = passRound(g);
    expect([g.objects[a]!.counters['+1/+1'], g.objects[b]!.counters['+1/+1']]).toEqual([1, 1]);
  });
});
