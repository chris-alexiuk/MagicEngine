import { describe, expect, it } from 'vitest';
import { legalActions, power, type GameState } from '../src/index.js';
import { act, give, makeCard, passRound, start, toStep } from './helpers.js';

const card = (name: string, type_line: string, oracle_text: string, extra: Record<string, unknown> = {}) =>
  makeCard({ name, type_line, oracle_text, mana_cost: '{1}{G}', ...extra });

const CARDS = [
  card('Lore Anthem', 'Enchantment', 'Creatures you control have "When this creature dies, draw a card."'),
  card('Mana Grove', 'Enchantment', 'Creatures you control have "{T}: Add {G}."'),
  card('Ember Gift', 'Instant', 'Target creature gains "{T}: This creature deals 1 damage to any target." until end of turn.'),
  card('Spore Caller', 'Sorcery', 'Create a 1/1 green Saproling creature token with "When this token dies, you gain 2 life."'),
  card('Twin Former', 'Artifact', '{T}: Create a token that\'s a copy of target creature you control, except it has haste and "At the beginning of the end step, sacrifice this token."'),
  card('Scion Brood', 'Sorcery', 'Create two 1/1 colorless Eldrazi Scion creature tokens. They have "Sacrifice this token: Add {C}."'),
  card('Ajani Lite', 'Legendary Planeswalker — Ajani', '−6: You get an emblem with "Creatures you control get +2/+2."\n−7: You get an emblem with "At the beginning of your end step, you gain 3 life."', { loyalty: '10' }),
  card('Charm Blade', 'Artifact — Equipment', 'Equipped creature has "Whenever this creature attacks, you gain 1 life."\nEquip {1}'),
];

function setup(): GameState {
  const g = toStep(start({ extra: CARDS }), 'main1');
  for (let i = 0; i < 4; i++) give(g, 'alice', 'Forest', 'battlefield');
  return g;
}
const cast = (g: GameState, name: string, extra: Record<string, unknown> = {}) =>
  passRound(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', name, 'hand'), autoTap: true, ...extra }));

describe('CR 113.1a: quoted abilities granted by effects (layer 6)', () => {
  it('a granted “when this creature dies” ability triggers as it dies (CR 603.10a)', () => {
    let g = setup();
    give(g, 'alice', 'Lore Anthem', 'battlefield');
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: bears, to: 'graveyard' } });
    g = passRound(g);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('a granted mana ability can be used', () => {
    const g = setup();
    give(g, 'alice', 'Mana Grove', 'battlefield');
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    const acts = legalActions(g, 'alice').filter((a) => a.type === 'activate_mana' && a.object === bears);
    expect(acts.length).toBeGreaterThan(0);
    const next = act(g, acts[0]!);
    expect(next.players.alice!.pool.G).toBe(1);
  });

  it('“gains "{T}: …" until end of turn”', () => {
    let g = setup();
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = cast(g, 'Ember Gift', { targets: [[{ kind: 'object', object: bears }]] });
    g = passRound(act(g, { type: 'activate', player: 'alice', object: bears, ability: 0, targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.players.bob!.life).toBe(19);
  });

  it('an Equipment grants a quoted triggered ability', () => {
    let g = setup();
    const blade = give(g, 'alice', 'Charm Blade', 'battlefield');
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = passRound(act(g, { type: 'activate', player: 'alice', object: blade, ability: 0, autoTap: true, targets: [[{ kind: 'object', object: bears }]] }));
    g = passRound(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: bears, target: { kind: 'player', player: 'bob' } }] } });
    g = passRound(g);
    expect(g.players.alice!.life).toBe(21);
  });
});

describe('tokens with quoted abilities', () => {
  it('“a 1/1 Saproling token with "When this token dies, you gain 2 life."”', () => {
    let g = setup();
    g = cast(g, 'Spore Caller');
    const token = g.zones.battlefield.find((id) => g.objects[id]!.token)!;
    g = act(g, { type: 'manual', player: 'alice', op: { kind: 'move', object: token, to: 'graveyard' } });
    g = passRound(g);
    expect(g.players.alice!.life).toBe(22);
  });

  it('a token copy “except it has haste and "At the beginning of the end step, sacrifice this token."”', () => {
    let g = setup();
    const former = give(g, 'alice', 'Twin Former', 'battlefield');
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = passRound(act(g, { type: 'activate', player: 'alice', object: former, ability: 0, targets: [[{ kind: 'object', object: bears }]] }));
    const token = g.zones.battlefield.find((id) => g.objects[id]!.token)!;
    expect(token).toBeDefined();
    g = passRound(toStep(g, 'end'));
    expect(g.objects[token]).toBeUndefined();
  });
});

describe('“It has / They have …” after creating tokens', () => {
  it('Eldrazi Scions with a sacrifice mana ability', () => {
    let g = setup();
    g = cast(g, 'Scion Brood');
    const scions = g.zones.battlefield.filter((id) => g.objects[id]!.token);
    expect(scions).toHaveLength(2);
    const acts = legalActions(g, 'alice').filter((a) => a.type === 'activate_mana' && a.object === scions[0]);
    expect(acts).toHaveLength(1);
    g = act(g, acts[0]!);
    expect(g.players.alice!.pool.C).toBe(1);
    expect(g.objects[scions[0]!]).toBeUndefined();
  });
});

describe('CR 114: emblems', () => {
  it('an emblem’s static and triggered abilities work from the command zone', () => {
    let g = setup();
    const ajani = give(g, 'alice', 'Ajani Lite', 'battlefield');
    g.objects[ajani]!.counters.loyalty = 13;
    const bears = give(g, 'alice', 'Grizzly Bears', 'battlefield');
    g = passRound(act(g, { type: 'activate', player: 'alice', object: ajani, ability: 0 }));
    const emblem = g.zones.command.find((id) => g.objects[id]!.emblem)!;
    expect(emblem).toBeDefined();
    expect(power(g, g.objects[bears]!)).toBe(4);
    g = toStep(g, 'main1', 'bob');
    g = toStep(g, 'main1', 'alice');
    g = passRound(act(g, { type: 'activate', player: 'alice', object: ajani, ability: 1 }));
    g = passRound(toStep(g, 'end'));
    expect(g.players.alice!.life).toBe(23);
  });
});
