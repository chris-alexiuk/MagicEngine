import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Archfiend of Ifnir', type_line: 'Creature — Demon', mana_cost: '{0}', power: '5', toughness: '4', oracle_text: 'Flying\nWhenever you cycle or discard another card, put a -1/-1 counter on each creature your opponents control.\nCycling {2}' }),
  makeCard({ name: 'Notion Thief', type_line: 'Creature — Human Rogue', mana_cost: '{0}', power: '3', toughness: '1', oracle_text: 'Flash\nIf an opponent would draw a card except the first one they draw in each of their draw steps, instead that player skips that draw and you draw a card.' }),
  makeCard({ name: 'Tekuthal, Inquiry Dominus', type_line: 'Legendary Creature — Phyrexian Horror', mana_cost: '{0}', power: '3', toughness: '5', oracle_text: 'Flying\nIf you would proliferate, proliferate twice instead.' }),
  makeCard({ name: 'Aven Mindcensor', type_line: 'Creature — Bird Wizard', mana_cost: '{0}', power: '2', toughness: '1', oracle_text: 'Flash\nFlying\nIf an opponent would search a library, that player searches the top four cards of that library instead.' }),
  makeCard({ name: 'The Darkness Crystal', type_line: 'Legendary Artifact', mana_cost: '{0}', oracle_text: 'If a nontoken creature an opponent controls would die, instead exile it and you gain 2 life.\n{4}{B}{B}, {T}: Put target creature card exiled with The Darkness Crystal onto the battlefield tapped under your control with two additional +1/+1 counters on it.' }),
  makeCard({ name: 'Mind Rot', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target player discards two cards.' }),
  makeCard({ name: 'Loot It', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Discard a card, then draw a card.' }),
  makeCard({ name: 'Divination', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw two cards.' }),
  makeCard({ name: 'Grow', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Proliferate.' }),
  makeCard({ name: 'Find', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Search your library for a card, put that card into your hand, then shuffle.' }),
  makeCard({ name: 'Murder', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Destroy target creature.' }),
  makeCard({ name: 'Ram Through', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Target creature you control deals damage equal to its power to target creature you don't control. If the creature you control has trample, excess damage is dealt to that creature's controller instead." }),
  makeCard({ name: 'Hell to Pay', type_line: 'Sorcery', mana_cost: '{X}', oracle_text: 'Hell to Pay deals X damage to target creature. Create a number of tapped Treasure tokens equal to the amount of excess damage dealt to that creature this way.' }),
  makeCard({ name: 'Trampler', type_line: 'Creature — Beast', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: 'Trample' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{0}', power: '5', toughness: '5', oracle_text: '' }),
  makeCard({ name: "Hunter's Insight", type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Choose target creature you control. Whenever that creature deals combat damage to a player or planeswalker this turn, draw that many cards.' }),
  makeCard({ name: 'Massacre Girl', type_line: 'Legendary Creature — Human Assassin', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: 'Menace\nWhen Massacre Girl enters, each other creature gets -1/-1 until end of turn. Whenever a creature dies this turn, each creature other than Massacre Girl gets -1/-1 until end of turn.' }),
  makeCard({ name: 'Elf', type_line: 'Creature — Elf', mana_cost: '{0}', power: '1', toughness: '1', oracle_text: '' }),
  makeCard({ name: 'Wall', type_line: 'Creature — Wall', mana_cost: '{0}', power: '0', toughness: '3', oracle_text: '' }),
  makeCard({ name: 'Unstable Mutation', type_line: 'Enchantment — Aura', mana_cost: '{0}', oracle_text: "Enchant creature\nEnchanted creature gets +3/+3.\nAt the beginning of the upkeep of enchanted creature's controller, put a -1/-1 counter on that creature." }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{0}', power: '2', toughness: '2', oracle_text: '' }),
];

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
function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const obj = (id: string) => ({ kind: 'object' as const, object: id });

describe('staples (slice 172)', () => {
  it('Archfiend of Ifnir: a -1/-1 counter on each opposing creature whenever you discard another card', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Archfiend of Ifnir', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g.zones.hand.alice!.length = 0;
    give(g, 'alice', 'Bear', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Loot It', 'hand') }));
    if (g.pending?.kind === 'discard') g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'discard', objects: g.zones.hand.alice!.slice(0, 1) } } as never));
    g = settle(g);
    expect(g.objects[bear]!.counters['-1/-1']).toBe(1);
  });

  it('Notion Thief: an opponent\'s extra draws are yours instead', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Notion Thief', 'battlefield');
    const [a, b] = [g.zones.hand.alice!.length, g.zones.hand.bob!.length];
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Divination', 'hand') }));
    expect(g.zones.hand.bob!.length).toBe(b);
    expect(g.zones.hand.alice!.length).toBe(a + 2);
    // Its controller's own draws are untouched.
    g = toStep(g, 'main1', 'alice');
    const a2 = g.zones.hand.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Divination', 'hand') }));
    expect(g.zones.hand.alice!.length).toBe(a2 + 2);
  });

  it('Tekuthal: proliferate twice', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Tekuthal, Inquiry Dominus', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g.objects[bear]!.counters['+1/+1'] = 1;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Grow', 'hand') }));
    for (let i = 0; i < 2; i++) {
      expect(g.pending?.kind).toBe('proliferate');
      g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'proliferate', objects: [bear], players: [] } } as never));
    }
    expect(g.objects[bear]!.counters['+1/+1']).toBe(3);
  });

  it('Aven Mindcensor: an opponent searches only the top four cards', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    give(g, 'alice', 'Aven Mindcensor', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'bob', object: give(g, 'bob', 'Find', 'hand') }));
    expect(g.pending?.kind).toBe('search');
    const top = g.zones.library.bob!.slice(0, 4);
    expect([...(g.pending as { candidates: string[] }).candidates].sort()).toEqual([...top].sort());
  });

  it('The Darkness Crystal: an opposing creature that would die is exiled with it, then returns under your control', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const crystal = give(g, 'alice', 'The Darkness Crystal', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const life = g.players.alice!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Murder', 'hand'), targets: [[obj(bear)]] }));
    expect(g.objects[bear]!.zone).toBe('exile');
    expect(g.players.alice!.life).toBe(life + 2);
    g.players.alice!.pool.B = 2;
    g.players.alice!.pool.C = 4;
    g = settle(act(g, { type: 'activate', player: 'alice', object: crystal, ability: 0, targets: [[obj(bear)]] }));
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.objects[bear]!.controller).toBe('alice');
    expect(g.objects[bear]!.tapped).toBe(true);
    expect(g.objects[bear]!.counters['+1/+1']).toBe(2);
  });
  it('Ram Through: with trample, the excess goes to that creature\'s controller', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const tr = give(g, 'alice', 'Trampler', 'battlefield');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    const [b1, b2] = [0, 1].map(() => give(g, 'bob', 'Bear', 'battlefield'));
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ram Through', 'hand'), targets: [[obj(tr)], [obj(b1!)]] }));
    expect(g.objects[b1!]!.zone).toBe('graveyard');
    expect(g.players.bob!.life).toBe(life - 3);
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Ram Through', 'hand'), targets: [[obj(ogre)], [obj(b2!)]] }));
    expect(g.objects[b2!]!.zone).toBe('graveyard');
    expect(g.players.bob!.life).toBe(life - 3);
  });

  it('Hell to Pay: a Treasure for each point of excess damage', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g.players.alice!.pool.C = 5;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Hell to Pay', 'hand'), x: 5, targets: [[obj(bear)]] }));
    expect(g.objects[bear]!.zone).toBe('graveyard');
    expect(g.zones.battlefield.filter((id) => g.objects[id]!.token && g.objects[id]!.tapped).length).toBe(3);
  });
  it("Hunter's Insight: draws as many cards as that creature deals combat damage this turn", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const ogre = give(g, 'alice', 'Ogre', 'battlefield');
    g.objects[ogre]!.sick = false;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', "Hunter's Insight", 'hand'), targets: [[obj(ogre)]] }));
    const hand = g.zones.hand.alice!.length;
    g = toAttack(toStep(g, 'beginning_of_combat'));
    g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'declare_attackers', attacks: [{ attacker: ogre, target: { kind: 'player', player: 'bob' } }] } });
    g = settle(finishCombat(g, 'bob'));
    expect(g.zones.hand.alice!.length).toBe(hand + 5);
  });

  it('Massacre Girl: each death this turn shrinks the others again', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const elf = give(g, 'bob', 'Elf', 'battlefield');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const wall = give(g, 'bob', 'Wall', 'battlefield');
    const girl = give(g, 'alice', 'Massacre Girl', 'hand');
    g = settle(act(g, { type: 'cast', player: 'alice', object: girl }));
    for (let i = 0; i < 10 && g.stack.length; i++) g = settle(g);
    // -1/-1 kills the Elf; that death gives -1/-1 again (the Bear dies), and again (the Wall, now 0/0, dies).
    expect(g.objects[elf]!.zone).toBe('graveyard');
    expect(g.objects[bear]!.zone).toBe('graveyard');
    expect(g.objects[wall]!.zone).toBe('graveyard');
    expect(g.objects[girl]!.zone).toBe('battlefield');
  });
  it("Unstable Mutation: the -1/-1 counter goes on the enchanted creature, not the Aura", () => {
    let g = toStep(start({ extra: CARDS }), 'end', 'alice');
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const aura = give(g, 'alice', 'Unstable Mutation', 'battlefield');
    g.objects[aura]!.attachedTo = { id: bear, zcc: g.objects[bear]!.zcc };
    g = settle(toStep(g, 'upkeep', 'bob'));
    g = settle(g);
    expect(g.objects[bear]!.counters['-1/-1']).toBe(1);
    expect(g.objects[aura]!.counters['-1/-1'] ?? 0).toBe(0);
  });
});
