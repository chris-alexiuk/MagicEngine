import { describe, expect, it } from 'vitest';
import { legalActions, type GameState } from '../src/index.js';
import { act, give, illegal, makeCard, passRound, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{G}', ...extra });

const CARDS = [
  card('Coin Trick', 'Sorcery', 'Flip a coin. If you win the flip, draw two cards. If you lose the flip, you lose 2 life.'),
  card('Populate Spell', 'Sorcery', 'Populate.'),
  card('Peek', 'Sorcery', "Look at target opponent's hand. Draw a card."),
  card('Toggler', 'Creature — Human', 'When this creature enters, you may tap or untap target creature.', { power: '1', toughness: '1' }),
  card('Day Tapper', 'Creature — Human', '{T}: You gain 1 life. Activate only during your turn.', { power: '1', toughness: '1' }),
  card('Island Tapper', 'Creature — Human', '{T}: You gain 1 life. Activate only if you control an Island.', { power: '1', toughness: '1' }),
  card('Ambusher', 'Creature — Human', 'Whenever this creature blocks a creature, destroy that creature at end of combat.', { power: '0', toughness: '5' }),
  card('Explore Plus', 'Sorcery', 'You may put a land card from your hand onto the battlefield.'),
  card('Howling Mine', 'Artifact', "At the beginning of each player's draw step, that player draws an additional card.", { mana_cost: '{2}' }),
];
const bob = { kind: 'player' as const, player: 'bob' };
const obj = (object: string) => ({ kind: 'object' as const, object });

function setup(): GameState {
  return toStep(start({ extra: CARDS }), 'main1');
}
const settle = (g: GameState) => {
  while (g.stack.length && !g.pending) g = passRound(g);
  return g;
};
const cast = (g: GameState, name: string, extra: Record<string, unknown> = {}) => {
  g.players.alice!.pool.G += 1;
  return passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), ...extra }));
};

describe('slice 23: one-liners', () => {
  it('flip a coin (CR 705): one of the two results happens', () => {
    const g = settle(cast(setup(), 'Coin Trick'));
    const hand = g.zones.hand.alice!.length;
    const won = hand > 7;
    expect(won ? g.players.alice!.life : 18).toBe(won ? 20 : g.players.alice!.life);
  });

  it('populate (CR 701.30a)', () => {
    let g = setup();
    const t = makeCard({ name: 'Soldier Token', type_line: 'Token Creature — Soldier', oracle_text: '', power: '1', toughness: '1' });
    g.cards[t.name] = t;
    const soldier = give(g, 'alice', 'Soldier Token', 'battlefield');
    g.objects[soldier]!.token = true;
    g = settle(cast(g, 'Populate Spell'));
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token)).toHaveLength(2);
  });

  it('“Look at target opponent’s hand” shows it to the caster, then goes on', () => {
    let g = cast(setup(), 'Peek', { targets: [[bob]] });
    expect(g.pending).toMatchObject({ kind: 'choose_objects', player: 'alice', max: 0 });
    const card0 = g.zones.hand.bob![0]!;
    if (g.pending?.kind === 'choose_objects') expect(g.pending.seen).toContain(card0);
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [] } }));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('“tap or untap target creature”', () => {
    let g = setup();
    const bears = give(g, 'bob', 'Grizzly Bears', 'battlefield');
    g = cast(g, 'Toggler');
    if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[obj(bears)]] } });
    g = passRound(g);
    // "You may" — then whether to tap or untap it.
    expect(g.pending).toMatchObject({ kind: 'may' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    expect(g.pending).toMatchObject({ kind: 'may', text: expect.stringMatching(/^Tap/) });
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    expect(g.objects[bears]!.tapped).toBe(true);
  });

  it('activation restrictions (CR 602.5b): during your turn; only if you control an Island', () => {
    let g = setup();
    const day = give(g, 'alice', 'Day Tapper', 'battlefield');
    const isl = give(g, 'alice', 'Island Tapper', 'battlefield');
    expect(illegal(g, { type: 'activate', player: 'alice', object: isl, ability: 0 })).toBeTruthy();
    give(g, 'alice', 'Island', 'battlefield');
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate' && a.object === isl)).toBe(true);
    g = toStep(g, 'upkeep', 'bob');
    g = act(g, { type: 'pass', player: 'bob' });
    expect(illegal(g, { type: 'activate', player: 'alice', object: day, ability: 0 })).toBeTruthy();
  });

  it('“destroy that creature at end of combat” — the creature it blocked', () => {
    let g = setup();
    const ambusher = give(g, 'bob', 'Ambusher', 'battlefield');
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = passRound(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: bears, target: bob }] } });
    g = passRound(g);
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: ambusher, attacker: bears }] } });
    for (let i = 0; i < 8 && g.step !== 'main2'; i++) g = passRound(g);
    expect(g.objects[bears]!.zone).toBe('graveyard');
    expect(g.objects[ambusher]!.zone).toBe('battlefield');
  });

  it('“You may put a land card from your hand onto the battlefield”', () => {
    let g = setup();
    const land = give(g, 'alice', 'Forest', 'hand');
    g = cast(g, 'Explore Plus');
    expect(g.pending).toMatchObject({ kind: 'may' });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    if (g.pending?.kind === 'choose_objects') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [land] } });
    expect(g.objects[land]!.zone).toBe('battlefield');
  });

  it('“At the beginning of each player’s draw step, that player draws an additional card”', () => {
    let g = setup();
    give(g, 'alice', 'Howling Mine', 'battlefield');
    const before = g.zones.hand.bob!.length;
    g = toStep(g, 'main1', 'bob');
    expect(g.zones.hand.bob!.length).toBe(before + 2);
  });
});
