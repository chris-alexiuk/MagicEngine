import { describe, expect, it } from 'vitest';
import { chars, legalActions, viewFor } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Ragavan', type_line: 'Legendary Creature — Monkey Pirate', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: "Whenever Ragavan deals combat damage to a player, create a Treasure token and exile the top card of that player's library. Until end of turn, you may cast that card." }),
  makeCard({ name: 'Necro', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Pay 1 life: Exile the top card of your library face down. Put that card into your hand at the beginning of your next end step.' }),
  makeCard({ name: 'Adeline', type_line: 'Legendary Creature — Human Knight', mana_cost: '{0}', power: '2', toughness: '4', oracle_text: "Vigilance\nWhenever you attack, for each opponent, create a 1/1 white Human creature token that's tapped and attacking that player or a planeswalker they control." }),
  makeCard({ name: 'Manufactor', type_line: 'Artifact Creature — Assembly-Worker', mana_cost: '{0}', power: '1', toughness: '3', oracle_text: 'If you would create a Clue, Food, or Treasure token, instead create one of each.' }),
  makeCard({ name: 'Treasure Call', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Create a Treasure token.' }),
  makeCard({ name: 'Project', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Whenever a nontoken creature you control enters, if it doesn't have the same name as another creature you control or a creature card in your graveyard, draw a card." }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Elk', type_line: 'Creature — Elk', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Mangara', type_line: 'Legendary Creature — Human Cleric', mana_cost: '{0}', power: '2', toughness: '4', oracle_text: 'Lifelink\nWhenever an opponent attacks with creatures, if two or more of those creatures are attacking you and/or planeswalkers you control, draw a card.' }),
  makeCard({ name: 'Veil', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Draw a card if an opponent has cast a blue or black spell this turn. Spells you control can't be countered this turn. You and permanents you control gain hexproof from blue and from black until end of turn." }),
  makeCard({ name: 'Counterspell', type_line: 'Instant', mana_cost: '{U}', cmc: 1, colors: ['U'], color_identity: ['U'], oracle_text: 'Counter target spell.' }),
  makeCard({ name: 'Blue Ping', type_line: 'Instant', mana_cost: '{U}', cmc: 1, colors: ['U'], color_identity: ['U'], oracle_text: 'Blue Ping deals 1 damage to any target.' }),
  makeCard({ name: 'Ozolith', type_line: 'Legendary Artifact', mana_cost: '{0}', oracle_text: 'Whenever a creature you control leaves the battlefield, if it had counters on it, put those counters on Ozolith.\nAt the beginning of combat on your turn, if Ozolith has counters on it, you may move all counters from Ozolith onto target creature.' }),
  makeCard({ name: 'Murder', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target creature.' }),
  makeCard({ name: 'Vault', type_line: 'Artifact', mana_cost: '{0}', oracle_text: "{0}: Exile the top card of your library face down.\n{1}, Sacrifice this artifact: Put all cards exiled with this artifact into their owner's hand." }),
  makeCard({ name: "Urza's Saga", type_line: "Enchantment Land — Urza's Saga", mana_cost: '', oracle_text: "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — This Saga gains \"{T}: Add {C}.\"\nII — This Saga gains \"{2}, {T}: Create a 0/0 colorless Construct artifact creature token with 'This token gets +1/+1 for each artifact you control.'\"\nIII — Search your library for an artifact card with mana cost {0} or {1}, put it onto the battlefield, then shuffle." }),
  makeCard({ name: 'Zero Rock', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '' }),
  makeCard({ name: 'X Rock', type_line: 'Artifact', mana_cost: '{X}', oracle_text: '' }),
  makeCard({ name: 'Walker', type_line: 'Legendary Planeswalker — Test', mana_cost: '{0}', loyalty: '5', oracle_text: '+1: You gain 1 life.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const tokens = (g: GameState, p: string) => g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.controller === p);
const toAttack = (g: GameState) => {
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  return g;
};
function finishCombat(g: GameState, defender: string): GameState {
  for (let i = 0; i < 40 && g.step !== 'end_of_combat' && g.step !== 'main2'; i++) {
    if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: defender, answer: { kind: 'declare_blockers', blocks: [] } } as never);
    else if (g.pending) break;
    else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
    else break;
  }
  return g;
}

describe('staples (slice 161)', () => {
  it("Ragavan: a Treasure and the top of that player's library, castable this turn", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const rag = give(g, 'alice', 'Ragavan', 'battlefield');
    const lib = g.zones.library.bob!;
    const bear = give(g, 'bob', 'Bear', 'library');
    lib.splice(lib.indexOf(bear), 1);
    lib.unshift(bear);
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: rag, target: { kind: 'player', player: 'bob' } }] } });
    g = finishCombat(g, 'bob');
    expect(tokens(g, 'alice')).toHaveLength(1);
    expect(g.objects[bear]!.zone).toBe('exile');
    g = toStep(g, 'main2', 'alice');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === bear)).toBe(true);
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.objects[bear]!.controller).toBe('alice');
    expect(g.objects[bear]!.owner).toBe('bob');
  });

  it('Necropotence: face down until your end step, then into your hand', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const necro = give(g, 'alice', 'Necro', 'battlefield');
    const top = g.zones.library.alice![0]!;
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'activate', player: 'alice', object: necro, ability: 0 }));
    expect(g.players.alice!.life).toBe(life - 1);
    expect(g.objects[top]!.zone).toBe('exile');
    expect(viewFor(g, 'bob').objects[top]!.card).not.toBe(g.objects[top]!.card);
    g = settle(toStep(g, 'end', 'alice'));
    expect(g.objects[top]!.zone).toBe('hand');
  });

  it('Adeline: a Human attacking each opponent — or one of their planeswalkers', () => {
    let g = start({ extra: CARDS, players: 3 });
    g = toStep(g, 'main1', 'alice');
    const adeline = give(g, 'alice', 'Adeline', 'battlefield');
    const walker = give(g, 'carol', 'Walker', 'battlefield');
    g.objects[walker]!.counters.loyalty = 5;
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: adeline, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 10 && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
    // Carol has a planeswalker: Alice chooses.
    expect(g.pending?.kind).toBe('choose_option');
    const options = (g.pending as { options: string[] }).options;
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_option', choice: options.find((o) => o.includes(walker))! } });
    const humans = tokens(g, 'alice');
    expect(humans).toHaveLength(2);
    const targets = humans.map((id) => g.combat!.attackers[id]!.target);
    expect(targets).toContainEqual({ kind: 'player', player: 'bob' });
    expect(targets).toContainEqual({ kind: 'planeswalker', object: walker });
    for (const id of humans) expect(g.objects[id]!.tapped).toBe(true);
  });

  it('Academy Manufactor: one of each; with two, three of each', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Manufactor', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Treasure Call', 'hand') }));
    const kinds = () => tokens(g, 'alice').map((id) => g.cards[g.objects[id]!.card]!.name).sort();
    expect(kinds()).toEqual(['Clue', 'Food', 'Treasure']);
    give(g, 'alice', 'Manufactor', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Treasure Call', 'hand') }));
    expect(kinds().filter((n) => n === 'Clue')).toHaveLength(4);
    expect(tokens(g, 'alice')).toHaveLength(12);
    // An opponent's Treasure isn't changed.
    g = toStep(g, 'main1', 'bob');
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Treasure Call', 'hand') }));
    expect(tokens(g, 'bob')).toHaveLength(1);
  });

  it("Guardian Project: a card only for a creature with a new name", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Project', 'battlefield');
    give(g, 'alice', 'Bear', 'battlefield');
    give(g, 'alice', 'Elk', 'graveyard');
    let hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Bear', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(hand);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Elk', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(hand);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mangara', 'hand') }));
    hand = g.zones.hand.alice!.length;
    expect(hand).toBeGreaterThan(0);
    expect(g.zones.library.alice!.length).toBeLessThan(g.zones.library.bob!.length);
  });

  it('Mangara: an opponent attacking you with two or more creatures', () => {
    let g = start({ extra: CARDS, players: 3 });
    g = toStep(g, 'main1', 'bob');
    give(g, 'alice', 'Mangara', 'battlefield');
    const a = give(g, 'bob', 'Bear', 'battlefield');
    const b = give(g, 'bob', 'Elk', 'battlefield');
    g = toAttack(toStep(g, 'beginning_of_combat', 'bob'));
    const hand = g.zones.hand.alice!.length;
    // One at Alice, one at Carol: no card.
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [{ attacker: a, target: { kind: 'player', player: 'alice' } }, { attacker: b, target: { kind: 'player', player: 'carol' } }] } });
    g = settle(g);
    expect(g.zones.hand.alice!.length).toBe(hand);
    g = toStep(g, 'main1', 'carol');
    g = toStep(g, 'main1', 'alice');
    g = toStep(g, 'beginning_of_combat', 'bob');
    g = toAttack(g);
    const hand2 = g.zones.hand.alice!.length;
    g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_attackers', attacks: [a, b].map((attacker) => ({ attacker, target: { kind: 'player' as const, player: 'alice' } })) } });
    g = settle(g);
    expect(g.zones.hand.alice!.length).toBe(hand2 + 1);
  });

  it("Veil of Summer: a card after a blue spell; can't be countered; hexproof from blue", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    g.players.bob!.pool.U = 2;
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Blue Ping', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] }));
    const hand = g.zones.hand.alice!.length;
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const veil = give(g, 'alice', 'Veil', 'hand');
    g = act(g, { type: 'pass', player: 'bob' });
    g = act(g, { type: 'cast', player: 'alice', object: veil });
    g = settle(g);
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
    const ping = give(g, 'bob', 'Blue Ping', 'hand');
    expect(illegal(g, { type: 'cast', player: 'bob', object: ping, targets: [[{ kind: 'player', player: 'alice' }]] })).toBeTruthy();
    expect(illegal(g, { type: 'cast', player: 'bob', object: ping, targets: [[{ kind: 'object', object: bear }]] })).toBeTruthy();
    // Alice's spells can't be countered.
    g = toStep(g, 'main1', 'alice');
    const veil2 = give(g, 'alice', 'Veil', 'hand');
    g = act(g, { type: 'cast', player: 'alice', object: veil2 });
    g = act(g, { type: 'pass', player: 'alice' });
    g.players.bob!.pool.U = 1;
    g = act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Counterspell', 'hand'), targets: [[{ kind: 'object', object: veil2 }]] });
    g = settle(g);
    expect(g.objects[veil2]!.zone).toBe('graveyard');
  });

  it('The Ozolith keeps the counters of creatures that leave, and hands them on', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const oz = give(g, 'alice', 'Ozolith', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g.objects[bear]!.counters['+1/+1'] = 2;
    g.objects[bear]!.counters.flying = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[oz]!.counters).toMatchObject({ '+1/+1': 2, flying: 1 });
    const elk = give(g, 'alice', 'Elk', 'battlefield');
    g = toStep(g, 'beginning_of_combat', 'alice');
    for (let i = 0; i < 10 && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
    if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'object', object: elk }]] } });
    g = settle(g);
    if (g.pending?.kind === 'may') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } }));
    expect(g.objects[elk]!.counters).toMatchObject({ '+1/+1': 2, flying: 1 });
    expect(Object.keys(g.objects[oz]!.counters).filter((k) => g.objects[oz]!.counters[k])).toHaveLength(0);
  });

  it('Cards exiled face down from the top are linked to their source and hidden from everyone (CR 406.3a, 607.2a)', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const vault = give(g, 'alice', 'Vault', 'battlefield');
    const [a, b] = g.zones.library.alice!.slice(0, 2);
    g = settle(act(g, { type: 'activate', player: 'alice', object: vault, ability: 0 }));
    g = settle(act(g, { type: 'activate', player: 'alice', object: vault, ability: 0 }));
    expect(viewFor(g, 'alice').objects[a!]!.card).not.toBe(g.objects[a!]!.card);
    g.players.alice!.pool.C = 1;
    g = settle(act(g, { type: 'activate', player: 'alice', object: vault, ability: 1 }));
    expect(g.objects[a!]!.zone).toBe('hand');
    expect(g.objects[b!]!.zone).toBe('hand');
  });

  it("Urza's Saga: a mana ability, then Constructs, then an artifact with mana cost {0} or {1}", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const saga = give(g, 'alice', "Urza's Saga", 'hand');
    const zero = give(g, 'alice', 'Zero Rock', 'library');
    const x = give(g, 'alice', 'X Rock', 'library');
    g = settle(act(g, { type: 'play_land', player: 'alice', object: saga }));
    expect(g.objects[saga]!.counters.lore).toBe(1);
    g = act(g, { type: 'activate_mana', player: 'alice', object: saga, ability: 0 });
    expect(g.players.alice!.pool.C).toBe(1);
    g = toStep(g, 'main1', 'bob');
    g = settle(toStep(g, 'main1', 'alice'));
    expect(g.objects[saga]!.counters.lore).toBe(2);
    g.players.alice!.pool.C = 2;
    g = settle(act(g, { type: 'activate', player: 'alice', object: saga, ability: 0 }));
    const [construct] = tokens(g, 'alice');
    expect(chars(g, g.objects[construct!]!).power).toBe(1);
    give(g, 'alice', 'Zero Rock', 'battlefield');
    expect(chars(g, g.objects[construct!]!).power).toBe(2);
    g = toStep(g, 'main1', 'bob');
    g = settle(toStep(g, 'main1', 'alice'));
    expect(g.pending?.kind).toBe('search');
    const p = g.pending as { candidates: string[] };
    expect(p.candidates).toContain(zero);
    expect(p.candidates).not.toContain(x);
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'search', objects: [zero] } }));
    expect(g.objects[zero]!.zone).toBe('battlefield');
    expect(g.objects[saga]!.zone).toBe('graveyard');
  });
});
