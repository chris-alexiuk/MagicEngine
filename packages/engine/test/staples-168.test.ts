import { describe, expect, it } from 'vitest';
import { chars, hasKeyword } from '../src/index.js';
import type { GameState } from '../src/index.js';
import { act, give, makeCard, start, toStep } from './helpers.js';

const CARDS = [
  makeCard({ name: 'Sneak Attack', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: '{R}: You may put a creature card from your hand onto the battlefield. That creature gains haste. Sacrifice the creature at the beginning of the next end step.' }),
  makeCard({ name: 'Obscuring Haze', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Prevent all damage that would be dealt this turn by creatures your opponents control.' }),
  makeCard({ name: 'Final Fortune', type_line: 'Instant', mana_cost: '{0}', oracle_text: "Take an extra turn after this one. At the beginning of that turn's end step, you lose the game." }),
  makeCard({ name: 'Fell the Mighty', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: "Destroy all creatures with power greater than target creature's power." }),
  makeCard({ name: 'Gratuitous Violence', type_line: 'Enchantment', mana_cost: '{0}', oracle_text: 'If a creature you control would deal damage to a permanent or player, it deals double that damage instead.' }),
  makeCard({ name: 'Dark Depths', type_line: 'Legendary Land', oracle_text: 'Dark Depths enters with ten ice counters on it.\n{3}: Remove an ice counter from Dark Depths.\nWhen Dark Depths has no ice counters on it, sacrifice it. If you do, create Marit Lage, a legendary 20/20 black Avatar creature token with flying and indestructible.' }),
  makeCard({ name: 'The Water Crystal', type_line: 'Legendary Artifact', mana_cost: '{0}', oracle_text: 'Blue spells you cast cost {1} less to cast.\nIf an opponent would mill one or more cards, they mill that many cards plus four instead.' }),
  makeCard({ name: 'Coral Atoll', type_line: 'Land', oracle_text: "This land enters tapped.\nWhen this land enters, sacrifice it unless you return an untapped Island you control to its owner's hand.\n{T}: Add {C}{U}." }),
  makeCard({ name: 'Stubborn Denial', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Counter target noncreature spell unless its controller pays {1}.\nFerocious — If you control a creature with power 4 or greater, counter that spell instead.' }),
  makeCard({ name: 'Sylvan Basilisk', type_line: 'Creature — Basilisk', mana_cost: '{0}', power: '2', toughness: '4', oracle_text: 'Whenever this creature becomes blocked by a creature, destroy that creature.' }),
  makeCard({ name: 'Engulfing Slagwurm', type_line: 'Creature — Wurm', mana_cost: '{0}', power: '7', toughness: '7', oracle_text: "Whenever this creature blocks or becomes blocked by a creature, destroy that creature. You gain life equal to that creature's toughness." }),
  makeCard({ name: 'Arrogant Bloodlord', type_line: 'Creature — Vampire Knight', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: 'Whenever this creature blocks or becomes blocked by a creature with power 1 or less, destroy this creature at end of combat.' }),
  makeCard({ name: 'Gloom Sower', type_line: 'Creature — Horror', mana_cost: '{0}', power: '8', toughness: '6', oracle_text: "Whenever this creature becomes blocked by a creature, that creature's controller loses 2 life and you gain 2 life." }),
  makeCard({ name: 'Mill Two', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Target player mills two cards.' }),
  makeCard({ name: 'Divination', type_line: 'Sorcery', mana_cost: '{0}', oracle_text: 'Draw two cards.' }),
  makeCard({ name: 'Bear', type_line: 'Creature — Bear', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], power: '2', toughness: '2', oracle_text: '' }),
  makeCard({ name: 'Ogre', type_line: 'Creature — Ogre', mana_cost: '{4}', cmc: 4, power: '4', toughness: '4', oracle_text: '' }),
  makeCard({ name: 'Flash Ogre', type_line: 'Creature — Ogre', mana_cost: '{0}', power: '4', toughness: '4', oracle_text: 'Flash\nHaste' }),
  makeCard({ name: 'Shock', type_line: 'Instant', mana_cost: '{0}', oracle_text: 'Shock deals 2 damage to any target.' }),
  makeCard({ name: 'Island Card', type_line: 'Basic Land — Island', oracle_text: '({T}: Add {U}.)' }),
];

function settle(g: GameState): GameState {
  for (let i = 0; i < 60 && g.stack.length && !g.pending; i++) g = act(g, { type: 'pass', player: g.priority! });
  return g;
}
const combat = (g: GameState, attackers: string[], blocks: { blocker: string; attacker: string }[] = []): GameState => {
  g = toStep(g, 'beginning_of_combat');
  while (!g.pending && g.priority) g = act(g, { type: 'pass', player: g.priority });
  g = act(g, { type: 'choose', player: g.active, answer: { kind: 'declare_attackers', attacks: attackers.map((attacker) => ({ attacker, target: { kind: 'player', player: g.active === 'alice' ? 'bob' : 'alice' } })) } });
  for (let i = 0; i < 60 && g.step !== 'end_of_combat'; i++) {
    if (g.pending?.kind === 'declare_blockers') g = act(g, { type: 'choose', player: g.pending.player, answer: { kind: 'declare_blockers', blocks } } as never);
    else if (g.pending) break;
    else g = act(g, { type: 'pass', player: g.priority! });
  }
  return g;
};

describe('staples (slice 168)', () => {
  it('Sneak Attack: a creature with haste, sacrificed at the next end step', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const sneak = give(g, 'alice', 'Sneak Attack', 'battlefield');
    const ogre = give(g, 'alice', 'Ogre', 'hand');
    g.players.alice!.pool.R = 1;
    g = settle(act(g, { type: 'activate', player: 'alice', object: sneak, ability: 0 }));
    if (g.pending?.kind === 'may') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'may', yes: true } });
    if (g.pending?.kind === 'choose_objects') g = act(g, { type: 'choose', player: 'alice', answer: { kind: 'choose_objects', objects: [ogre] } });
    g = settle(g);
    expect(g.objects[ogre]!.zone).toBe('battlefield');
    expect(hasKeyword(g, g.objects[ogre]!, 'haste')).toBe(true);
    g = toStep(g, 'end', 'alice');
    g = settle(g);
    expect(g.objects[ogre]!.zone).toBe('graveyard');
  });

  it('Obscuring Haze: covers creatures that arrive after it resolves', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    g.objects[ogre]!.sick = false;
    g = act(g, { type: 'pass', player: 'bob' });
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Obscuring Haze', 'hand') }));
    const life = g.players.alice!.life;
    // A creature Bob flashes in afterwards.
    const late = give(g, 'bob', 'Flash Ogre', 'battlefield');
    g = combat(g, [ogre, late]);
    expect(g.players.alice!.life).toBe(life);
  });

  it("Final Fortune: an extra turn, lost at that turn's end step (not this one's)", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Final Fortune', 'hand') }));
    const turn = g.turn;
    g = toStep(g, 'end', 'alice');
    g = settle(g);
    expect(g.over).toBeFalsy();
    g = toStep(g, 'upkeep', 'alice');
    expect(g.turn).toBe(turn + 1);
    g = toStep(g, 'end', 'alice');
    g = settle(g);
    expect(g.players.alice!.lost).toBe(true);
  });

  it("Fell the Mighty: power greater than the target's", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    const bear2 = give(g, 'bob', 'Bear', 'battlefield');
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Fell the Mighty', 'hand'), targets: [[{ kind: 'object', object: bear }]] }));
    expect(g.objects[ogre]!.zone).toBe('graveyard');
    expect(g.objects[bear]!.zone).toBe('battlefield');
    expect(g.objects[bear2]!.zone).toBe('battlefield');
  });

  it('Gratuitous Violence: only creatures you control deal double', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'Gratuitous Violence', 'battlefield');
    const bear = give(g, 'alice', 'Bear', 'battlefield');
    g.objects[bear]!.sick = false;
    const life = g.players.bob!.life;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Shock', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.players.bob!.life).toBe(life - 2);
    g = combat(g, [bear]);
    expect(g.players.bob!.life).toBe(life - 6);
  });

  it('Dark Depths: no ice counters, then Marit Lage', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const depths = give(g, 'alice', 'Dark Depths', 'battlefield');
    g.objects[depths]!.counters.ice = 1;
    g.players.alice!.pool.C = 3;
    g = settle(act(g, { type: 'activate', player: 'alice', object: depths, ability: 0 }));
    g = settle(g);
    expect(g.objects[depths]!.zone).toBe('graveyard');
    const lage = g.zones.battlefield.find((id) => g.objects[id]!.token && g.objects[id]!.controller === 'alice')!;
    const c = chars(g, g.objects[lage]!);
    expect([c.name, c.power, c.toughness]).toEqual(['Marit Lage', 20, 20]);
    expect(c.supertypes).toContain('Legendary');
    expect(hasKeyword(g, g.objects[lage]!, 'indestructible')).toBe(true);
  });

  it('The Water Crystal: opponents mill four more', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    give(g, 'alice', 'The Water Crystal', 'battlefield');
    const lib = g.zones.library.bob!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mill Two', 'hand'), targets: [[{ kind: 'player', player: 'bob' }]] }));
    expect(g.zones.library.bob!.length).toBe(lib - 6);
    const mine = g.zones.library.alice!.length;
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Mill Two', 'hand'), targets: [[{ kind: 'player', player: 'alice' }]] }));
    expect(g.zones.library.alice!.length).toBe(mine - 2);
  });

  it('Coral Atoll: return an untapped Island, or sacrifice it', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const island = give(g, 'alice', 'Island Card', 'battlefield');
    const atoll = give(g, 'alice', 'Coral Atoll', 'hand');
    g = settle(act(g, { type: 'play_land', player: 'alice', object: atoll }));
    expect(g.pending?.kind).toBe('pay');
    g = settle(act(g, { type: 'choose', player: 'alice', answer: { kind: 'pay', pay: true } }));
    expect(g.objects[island]!.zone).toBe('hand');
    expect(g.objects[atoll]!.zone).toBe('battlefield');
    // With no Island to return, it's sacrificed.
    g = toStep(toStep(g, 'main1', 'bob'), 'main1', 'alice');
    const atoll2 = give(g, 'alice', 'Coral Atoll', 'hand');
    g = settle(act(g, { type: 'play_land', player: 'alice', object: atoll2 }));
    expect(g.objects[atoll2]!.zone).toBe('graveyard');
  });

  it('Stubborn Denial: a hard counter with ferocious', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'bob');
    const div = give(g, 'bob', 'Divination', 'hand');
    g.players.bob!.pool.C = 1;
    g = act(g, { type: 'cast', player: 'bob', object: div });
    give(g, 'alice', 'Ogre', 'battlefield');
    g = act(g, { type: 'pass', player: 'bob' });
    g = settle(act(g, { type: 'cast', player: 'alice', object: give(g, 'alice', 'Stubborn Denial', 'hand'), targets: [[{ kind: 'object', object: div }]] }));
    expect(g.objects[div]!.zone).toBe('graveyard');
    expect(g.players.bob!.pool.C).toBe(1);
  });

  it('Sylvan Basilisk: destroys the creature blocking it, not itself', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const basilisk = give(g, 'alice', 'Sylvan Basilisk', 'battlefield');
    g.objects[basilisk]!.sick = false;
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = combat(g, [basilisk], [{ blocker: bear, attacker: basilisk }]);
    expect(g.objects[bear]!.zone).toBe('graveyard');
    expect(g.objects[basilisk]!.zone).toBe('battlefield');
  });

  it('Engulfing Slagwurm: the creature on the other side, and its toughness as it last existed', () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const wurm = give(g, 'alice', 'Engulfing Slagwurm', 'battlefield');
    g.objects[wurm]!.sick = false;
    const ogre = give(g, 'bob', 'Ogre', 'battlefield');
    const life = g.players.alice!.life;
    g = combat(g, [wurm], [{ blocker: ogre, attacker: wurm }]);
    expect(g.objects[ogre]!.zone).toBe('graveyard');
    expect(g.objects[wurm]!.zone).toBe('battlefield');
    expect(g.players.alice!.life).toBe(life + 4);
  });

  it("Arrogant Bloodlord: only when the other creature's power is 1 or less", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const lord = give(g, 'alice', 'Arrogant Bloodlord', 'battlefield');
    g.objects[lord]!.sick = false;
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    g = combat(g, [lord], [{ blocker: bear, attacker: lord }]);
    expect(g.objects[lord]!.zone).toBe('battlefield');
  });

  it("Gloom Sower: the blocking creature's controller loses the life", () => {
    let g = toStep(start({ extra: CARDS }), 'main1', 'alice');
    const sower = give(g, 'alice', 'Gloom Sower', 'battlefield');
    g.objects[sower]!.sick = false;
    const bear = give(g, 'bob', 'Bear', 'battlefield');
    const [a, b] = [g.players.alice!.life, g.players.bob!.life];
    g = combat(g, [sower], [{ blocker: bear, attacker: sower }]);
    expect(g.players.bob!.life).toBe(b - 2);
    expect(g.players.alice!.life).toBe(a + 2);
  });
});
