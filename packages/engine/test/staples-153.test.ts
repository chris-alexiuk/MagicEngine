import { describe, expect, it } from 'vitest';
import { hasKeyword, legalActions } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, illegal, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Tribute', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever a creature you control enters, draw a card if its power is 3 or greater. Otherwise, put two +1/+1 counters on it.' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{0}', power: '3', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Konrad', type_line: 'Legendary Creature — Human Knight', mana_cost: '{0}', power: '5', toughness: '4', oracle_text: 'Whenever another creature dies, or a creature card is put into a graveyard from anywhere other than the battlefield, or a creature card leaves your graveyard, Konrad deals 1 damage to each opponent.' }),
  makeCard({ name: 'Mill Two', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Mill two cards.' }),
  makeCard({ name: 'Field', type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {C}.\nWhenever this land or another land you control enters, if you control seven or more lands with different names, create a 2/2 black Zombie creature token.' }),
  makeCard({ name: 'Maze', type_line: 'Land', mana_cost: '', oracle_text: "{T}: Untap target attacking creature. Prevent all combat damage that would be dealt to and dealt by that creature this turn." }),
  makeCard({ name: 'Druid', type_line: 'Creature — Elf Druid', mana_cost: '{0}', power: '0', toughness: '2', oracle_text: '{T}: Add one mana of any type that a land you control could produce. If this creature has a +1/+1 counter on it, add three mana of that type instead.' }),
  makeCard({ name: 'Ghalta', type_line: 'Legendary Creature — Dinosaur', mana_cost: '{0}', power: '12', toughness: '12', oracle_text: 'When Ghalta enters, put any number of creature cards from your hand onto the battlefield.' }),
  makeCard({ name: 'Syphon', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each other player discards a card. You draw a card for each card discarded this way.' }),
  makeCard({ name: 'Dust', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Each player sacrifices all permanents they control that are one or more colors.' }),
  makeCard({ name: 'Green Bear', type_line: 'Creature — Bear', mana_cost: '{G}', cmc: 1, colors: ['G'], color_identity: ['G'], power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Burgeoning', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever an opponent plays a land, you may put a land card from your hand onto the battlefield.' }),
  makeCard({ name: 'Tempest', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'Whenever a Dragon you control enters, it deals X damage to any target, where X is the number of Dragons you control.' }),
  makeCard({ name: 'Dragon', type_line: 'Creature — Dragon', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: 'Flying' }),
  makeCard({ name: 'Devoted', type_line: 'Creature — Human Druid', mana_cost: '{0}', power: '0', toughness: '2', oracle_text: '{T}: Add {G}.\nPut a -1/-1 counter on this creature: Untap this creature.' }),
  makeCard({ name: 'Omniscience', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'You may cast spells from your hand without paying their mana costs.' }),
  makeCard({ name: 'Big', type_line: 'Creature — Giant', mana_cost: '{7}', cmc: 7, power: '7', toughness: '7', oracle_text: '' }),
  makeCard({ name: 'Narset', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: "Each opponent can't draw more than one card each turn." }),
  makeCard({ name: 'Divination', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw two cards.' }),
  makeCard({ name: 'Decimate', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Destroy target artifact and target creature.' }),
  makeCard({ name: 'Rock', type_line: 'Artifact', mana_cost: '{0}', oracle_text: '' }),
  makeCard({ name: 'Wurmcoil', type_line: 'Artifact Creature — Phyrexian Wurm', mana_cost: '{0}', power: '6', toughness: '6', oracle_text: 'When this creature dies, create a 3/3 colorless Phyrexian Wurm artifact creature token with deathtouch and a 3/3 colorless Phyrexian Wurm artifact creature token with lifelink.' }),
  ...['L1', 'L2', 'L3', 'L4', 'L5'].map((name) => makeCard({ name, type_line: 'Land', mana_cost: '', oracle_text: '{T}: Add {C}.' })),
  makeCard({ name: 'Wrath', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Destroy all creatures.' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 40 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const yes = (g: GameState) => (g.pending?.kind === 'may' ? act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'may', yes: true } }) : g);

describe('staples (slice 153)', () => {
  it('Tribute to the World Tree: "… if its power is 3 or greater. Otherwise, …"', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Tribute', 'battlefield');
    const hand = g.zones.hand.alice!.length;
    const bear = give(g, 'alice', 'Bear', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: bear }));
    expect(g.objects[bear]!.counters['+1/+1']).toBe(2);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ogre', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
  });

  it('Syr Konrad: deaths, milled creature cards and creature cards leaving the graveyard', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Konrad', 'battlefield');
    const life = g.players.bob!.life;
    const lib = g.zones.library.alice!;
    const a = give(g, 'alice', 'Bear', 'library');
    const b = give(g, 'alice', 'Ogre', 'library');
    g.zones.library.alice = [a, b, ...lib.filter((id) => id !== a && id !== b)];
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mill Two', 'hand') }));
    g = settle(g);
    expect(g.players.bob!.life).toBe(life - 2);
  });

  it('Field of the Dead: seven lands with different names', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (const n of ['Forest', 'L1', 'L2', 'L3', 'L4', 'Maze']) give(g, 'alice', n, 'battlefield');
    g = settle(act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Field', 'hand') }));
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token)).toHaveLength(1);
  });

  it('Field of the Dead: duplicate names do not count', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    for (const n of ['Forest', 'Forest', 'L1', 'L2', 'L3', 'L4']) give(g, 'alice', n, 'battlefield');
    g = settle(act(g, { type: 'play_land', player: 'alice', object: give(g, 'alice', 'Field', 'hand') }));
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token)).toHaveLength(0);
  });

  it('Maze of Ith: untaps the attacker and prevents its combat damage', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    const maze = give(g, 'bob', 'Maze', 'battlefield');
    g = toStep(g, 'beginning_of_combat');
    while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
    const life = g.players.bob!.life;
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: ogre, target: { kind: 'player', player: 'bob' } }] } });
    for (let i = 0; i < 6 && g.priority !== 'bob'; i++) g = act(g, { type: 'pass', player: g.priority! });
    expect(g.objects[ogre]!.tapped).toBe(true);
    g = settle(act(g, { type: 'activate', player: 'bob', object: maze, ability: 0, targets: [[{ kind: 'object', object: ogre }]] }));
    expect(g.objects[ogre]!.tapped).toBe(false);
    for (let i = 0; i < 20 && g.step !== 'end_of_combat' && g.step !== 'main2'; i++) {
      if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: 'bob', answer: { kind: 'declare_blockers', blocks: [] } } as never);
      else if (g.priority) g = act(g, { type: 'pass', player: g.priority });
      else break;
    }
    expect(g.players.bob!.life).toBe(life);
  });

  it('Incubation Druid: three mana with a +1/+1 counter', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Forest', 'battlefield');
    const druid = give(g, 'alice', 'Druid', 'battlefield');
    expect(legalActions(g, 'alice').some((a) => a.type === 'activate_mana' && a.object === druid && (a as { choice?: string }).choice === 'G')).toBe(true);
    g.objects[druid]!.counters['+1/+1'] = 1;
    g = act(g, { type: 'activate_mana', player: 'alice', object: druid, ability: 0, choice: 'G' });
    expect(g.players.alice!.pool.G).toBe(3);
  });

  it('Ghalta puts any number of creatures from the hand onto the battlefield', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const a = give(g, 'alice', 'Bear', 'hand');
    const b = give(g, 'alice', 'Ogre', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ghalta', 'hand') }));
    expect(g.pending?.kind).toBe('choose_objects');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [a, b] } }));
    expect(g.objects[a]!.zone).toBe('battlefield');
    expect(g.objects[b]!.zone).toBe('battlefield');
  });

  it('Syphon Mind and All Is Dust', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const hand = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Syphon', 'hand') }));
    if (g.pending?.kind === 'discard') g = settle(act(g, { type: 'choose', player: 'bob', answer: { kind: 'discard', objects: [g.zones.hand.bob![0]!] } }));
    expect(g.zones.hand.alice!.length).toBe(hand + 1);
    const green = give(g, 'bob', 'Green Bear', 'battlefield');
    const rock = give(g, 'bob', 'Rock', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Dust', 'hand') }));
    expect(g.objects[green]!.zone).toBe('graveyard');
    expect(g.objects[rock]!.zone).toBe('battlefield');
  });

  it('Burgeoning: a land of your own when an opponent plays one', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Burgeoning', 'battlefield');
    const mine = give(g, 'alice', 'Maze', 'hand');
    g = act(g, { type: 'play_land', player: 'bob', object: give(g, 'bob', 'Field', 'hand') });
    g = settle(yes(settle(g)));
    if (g.pending?.kind === 'choose_objects') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [mine] } }));
    expect(g.objects[mine]!.zone).toBe('battlefield');
  });

  it('Dragon Tempest: the Dragon deals the damage', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Tempest', 'battlefield');
    give(g, 'alice', 'Dragon', 'battlefield');
    const life = g.players.bob!.life;
    const dragon = give(g, 'alice', 'Dragon', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: dragon }));
    if (g.pending?.kind === 'trigger_targets') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'trigger_targets', targets: [[{ kind: 'player', player: 'bob' }]] } });
    const r = settle(g);
    expect(r.players.bob!.life).toBe(life - 2);
  });

  it('Devoted Druid: a -1/-1 counter as a cost', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const druid = give(g, 'alice', 'Devoted', 'battlefield');
    g = act(g, { type: 'activate_mana', player: 'alice', object: druid, ability: 0 });
    expect(g.objects[druid]!.tapped).toBe(true);
    g = settle(act(g, { type: 'activate', player: 'alice', object: druid, ability: 0 }));
    expect(g.objects[druid]!.tapped).toBe(false);
    expect(g.objects[druid]!.counters['-1/-1']).toBe(1);
  });

  it('Omniscience: spells from the hand for free', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Omniscience', 'battlefield');
    const big = give(g, 'alice', 'Big', 'hand');
    expect(legalActions(g, 'alice').some((a) => a.type === 'cast' && a.object === big && a.alt === 'free')).toBe(true);
    g = settle(act(g, { type: 'cast', player: 'alice', object: big, alt: 'free' }));
    expect(g.objects[big]!.zone).toBe('battlefield');
  });

  it("Narset: opponents can't draw more than one card each turn", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Narset', 'battlefield');
    const hand = g.zones.hand.bob!.length;
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Divination', 'hand') }));
    // Bob drew in his draw step already, so neither card is drawn.
    expect(g.zones.hand.bob!.length).toBe(hand);
    expect(g.players.bob!.lost).toBeFalsy();
  });

  it('Decimate-style lists of targets; Wurmcoil Engine', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const rock = give(g, 'bob', 'Rock', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    expect(illegal(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Decimate', 'hand'), targets: [[{ kind: 'object', object: rock }]] })).toBeTruthy();
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Decimate', 'hand'), targets: [[{ kind: 'object', object: rock }], [{ kind: 'object', object: bear }]] }));
    expect(g.objects[rock]!.zone).toBe('graveyard');
    expect(g.objects[bear]!.zone).toBe('graveyard');
    give(g, 'alice', 'Wurmcoil', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Wrath', 'hand') }));
    g = settle(g);
    const wurms = g.zones.battlefield.filter((id) => g.objects[id]!.token);
    expect(wurms).toHaveLength(2);
    expect(wurms.some((id) => hasKeyword(g, g.objects[id]!, 'deathtouch'))).toBe(true);
    expect(wurms.some((id) => hasKeyword(g, g.objects[id]!, 'lifelink'))).toBe(true);
  });
});
