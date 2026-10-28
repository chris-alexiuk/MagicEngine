import { describe, expect, it } from 'vitest';
import { chars, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Lion Sash', type_line: 'Artifact Creature — Equipment Cat', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '{W}: Exile target card from a graveyard. If it was a permanent card, put a +1/+1 counter on this permanent.' }),
  makeCard({ name: 'Oversold Cemetery', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'At the beginning of your upkeep, if you have four or more creature cards in your graveyard, you may return target creature card from your graveyard to your hand.' }),
  makeCard({ name: 'Aurelia, the Law Above', type_line: 'Legendary Creature — Angel', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: 'Whenever a player attacks with three or more creatures, you draw a card.' }),
  makeCard({ name: 'Blast Zone', type_line: 'Land', mana_cost: '', oracle_text: '{3}, {T}, Sacrifice this land: Destroy each nonland permanent with mana value equal to the number of charge counters on this land.' }),
  makeCard({ name: 'Gingerbrute', type_line: 'Artifact Creature — Food Golem', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: "{1}: This creature can't be blocked this turn except by creatures with haste." }),
  makeCard({ name: 'Sword of Truth and Justice', type_line: 'Artifact — Equipment', mana_cost: '{0}', oracle_text: 'Whenever equipped creature deals combat damage to a player, put a +1/+1 counter on a creature you control, then proliferate.\nEquip {0}' }),
  makeCard({ name: 'Giada, Font of Hope', type_line: 'Legendary Creature — Angel', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: 'Each other Angel you control enters with an additional +1/+1 counter on it for each Angel you already control.' }),
  makeCard({ name: 'Arwen, Weaver of Hope', type_line: 'Legendary Creature — Elf Noble', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: "Each other creature you control enters with a number of additional +1/+1 counters on it equal to Arwen's toughness." }),
  makeCard({ name: 'Excalibur, Sword of Eden', type_line: 'Legendary Artifact — Equipment', mana_cost: '{10}', cmc: 10, oracle_text: 'This spell costs {X} less to cast, where X is the total mana value of historic permanents you control.' }),
  makeCard({ name: 'Shield Up', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Put a shield counter on a creature you control. It gains flying until end of turn.' }),
  makeCard({ name: 'Chalice of the Void', type_line: 'Artifact', mana_cost: '{X}{X}', oracle_text: 'This artifact enters with X charge counters on it.\nWhenever a player casts a spell with mana value equal to the number of charge counters on this artifact, counter that spell.' }),
  makeCard({ name: 'Aether Vial', type_line: 'Artifact', mana_cost: '{1}', oracle_text: '{T}: You may put a creature card with mana value equal to the number of charge counters on this artifact from your hand onto the battlefield.' }),
  makeCard({ name: 'Bolt', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Bolt deals 3 damage to any target.' }),
  makeCard({ name: 'Murder', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target creature.' }),
  makeCard({ name: 'Bauble', type_line: 'Artifact', mana_cost: '{1}', cmc: 1, oracle_text: '' }),
  makeCard({ name: 'Angel', type_line: 'Creature — Angel', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Relic', type_line: 'Artifact', mana_cost: '{2}', cmc: 2, oracle_text: '' }),
  makeCard({ name: 'Idol', type_line: 'Legendary Artifact', mana_cost: '{5}', cmc: 5, oracle_text: '' }),
  makeCard({ name: 'Quickling', type_line: 'Creature — Faerie', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: 'Haste' }),
  makeCard({ name: 'Think', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw a card.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const obj = (id: string) => ({ kind: 'object' as const, object: id });
const toAttack = (g: GameState) => {
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return g;
};

describe('staples (slice 178)', () => {
  it('Lion Sash: a counter only for a permanent card', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const sash = give(g, 'alice', 'Lion Sash', 'battlefield');
    g.players.alice!.pool.W = 2;
    g = settle(act(g, { type: 'activate', player: 'alice', object: sash, ability: 0, targets: [[obj(give(g, 'bob', 'Think', 'graveyard'))]] }));
    expect(g.objects[sash]!.counters['+1/+1'] ?? 0).toBe(0);
    g = settle(act(g, { type: 'activate', player: 'alice', object: sash, ability: 0, targets: [[obj(give(g, 'bob', 'Relic', 'graveyard'))]] }));
    expect(g.objects[sash]!.counters['+1/+1']).toBe(1);
  });

  it('Oversold Cemetery: only with four or more creature cards in your graveyard', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Oversold Cemetery', 'battlefield');
    for (let i = 0; i < 3; i++) give(g, 'alice', 'Bear', 'graveyard');
    g = toStep(g, 'draw', 'alice');
    expect(g.zones.graveyard.alice!.length).toBe(3);
    give(g, 'alice', 'Bear', 'graveyard');
    g = toStep(toStep(g, 'main1', 'bob'), 'upkeep', 'alice');
    expect(g.pending?.kind).toBe('trigger_targets');
  });

  it('Aurelia: a card when any player attacks with three or more creatures', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Aurelia, the Law Above', 'battlefield');
    const bears = [0, 1, 2].map(() => give(g, 'bob', 'Bear', 'battlefield'));
    for (const b of bears) g.objects[b]!.sick = false;
    const hand = g.zones.hand.alice!.length;
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: bears.map((attacker) => ({ attacker, target: { kind: 'player' as const, player: 'alice' } })) } });
    g = settle(g);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('Blast Zone: destroys nonland permanents with mana value equal to its charge counters', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const zone = give(g, 'alice', 'Blast Zone', 'battlefield');
    g.objects[zone]!.counters.charge = 2;
    const relic = give(g, 'bob', 'Relic', 'battlefield');
    const idol = give(g, 'bob', 'Idol', 'battlefield');
    g.players.alice!.pool.C = 3;
    g = settle(act(g, { type: 'activate', player: 'alice', object: zone, ability: 0 }));
    expect(g.objects[relic]!.zone).toBe('graveyard');
    expect(g.objects[idol]!.zone).toBe('battlefield');
  });

  it('Gingerbrute: only creatures with haste can block it this turn', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const brute = give(g, 'alice', 'Gingerbrute', 'battlefield');
    g.objects[brute]!.sick = false;
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const quick = give(g, 'bob', 'Quickling', 'battlefield');
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'activate', player: 'alice', object: brute, ability: 0 }));
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: brute, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 10 && g.pending?.kind !== 'declare_blockers'; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect(() => act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: bear, attacker: brute }] } } as never)).toThrow();
    expect(() => act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [{ blocker: quick, attacker: brute }] } } as never)).not.toThrow();
  });

  it('Sword of Truth and Justice: a +1/+1 counter on a creature you choose, then proliferate', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g.objects[bear]!.sick = false;
    const other = give(g, 'alice', 'Angel', 'battlefield');
    const sword = give(g, 'alice', 'Sword of Truth and Justice', 'battlefield');
    g = settle(act(g, { type: 'activate', player: 'alice', object: sword, ability: 0, targets: [[obj(bear)]] }));
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: bear, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 30 && g.pending?.kind !== 'choose_objects'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } } as never);
      else g = act(g, { type: 'pass', player: g.priority! });
    }
    expect(g.pending).toMatchObject({ kind: 'choose_objects', candidates: expect.arrayContaining([bear, other]) });
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [other] } });
    expect(g.pending?.kind).toBe('proliferate');
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'proliferate', objects: [other], players: [] } });
    g = settle(g);
    expect(g.objects[other]!.counters['+1/+1']).toBe(2);
  });

  it('Giada and Arwen: counters as other creatures enter', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Giada, Font of Hope', 'battlefield');
    give(g, 'alice', 'Angel', 'battlefield');
    const third = give(g, 'alice', 'Angel', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: third }));
    expect(g.objects[third]!.counters['+1/+1']).toBe(2);
    give(g, 'alice', 'Arwen, Weaver of Hope', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'hand');
    g.players.alice!.pool.G = 1;
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear }));
    expect(g.objects[bear]!.counters['+1/+1']).toBe(3);
  });

  it('Excalibur: costs less by the total mana value of historic permanents you control', () => {
    const g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Idol', 'battlefield');
    give(g, 'alice', 'Relic', 'battlefield');
    const sword = give(g, 'alice', 'Excalibur, Sword of Eden', 'hand');
    g.players.alice!.pool.C = 3;
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === sword)).toBe(true);
  });
});

describe('staples (slice 178): shield counters and counted mana values', () => {
  it('a shield counter is removed instead of damage or destruction (CR 122.1c); "It" is the creature chosen', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Shield Up', 'hand') }));
    if (g.pending?.kind === 'choose_objects') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [bear] } }));
    expect(g.objects[bear]!.counters.shield).toBe(1);
    expect(chars(g, g.objects[bear]!).keywords.some((k) => k.id === 'flying')).toBe(true);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bolt', 'hand'), targets: [[obj(bear)]] }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.objects[bear]!.damage).toBe(0);
    expect(g.objects[bear]!.counters.shield ?? 0).toBe(0);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder', 'hand'), targets: [[obj(bear)]] }));
    expect(g.objects[bear]!.zone).toBe('graveyard');
  });

  it('Chalice of the Void counters spells with mana value equal to its charge counters', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const chalice = give(g, 'alice', 'Chalice of the Void', 'battlefield');
    g.objects[chalice]!.counters.charge = 1;
    g.players.bob!.pool.C = 3;
    const bauble = give(g, 'bob', 'Bauble', 'hand');
    g = settle(act(g, { type: 'cast', player: 'bob', object: bauble }));
    expect(g.objects[bauble]!.zone).toBe('graveyard');
    const relic = give(g, 'bob', 'Relic', 'hand');
    g = settle(act(g, { type: 'cast', player: 'bob', object: relic }));
    expect(g.objects[relic]!.zone).toBe('battlefield');
  });

  it('Aether Vial: a creature card with mana value equal to its charge counters', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const vial = give(g, 'alice', 'Aether Vial', 'battlefield');
    g.objects[vial]!.counters.charge = 2;
    const bear = give(g, 'alice', 'Bear', 'hand');
    give(g, 'alice', 'Angel', 'hand');
    g = act(g, { type: 'activate', player: 'alice', object: vial, ability: 0 });
    g = settle(g);
    if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    // Only the Bear has mana value 2: it's the one put onto the battlefield.
    if (g.pending?.kind === 'choose_objects') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [bear] } });
    g = settle(g);
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.zones.hand.alice!.some((id) => g.cards[g.objects[id]!.card]?.name === 'Angel')).toBe(true);
  });
});
